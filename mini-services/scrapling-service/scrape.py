#!/usr/bin/env python3
"""
Scrapling AOD AJAX Crawler — Standalone Script
================================================
Called via subprocess from Next.js.

Usage:
  python3 scrape.py <ASIN> <REGION>

Uses scrape.do API with geoCode for correct geolocation-based prices,
then parses the HTML with Scrapling for reliable extraction.

If no SCRAPE_DO_TOKEN env var is set, falls back to Scrapling Fetcher.

CRITICAL RULES:
- Prices MUST come from AOD AJAX endpoint ONLY
- URL: https://www.amazon.{region}/gp/product/ajax/aodAjaxMain/?asin={ASIN}
- If AOD has no offers → return "N/A"
"""

import re
import os
import sys
import json
import requests as req_lib
from scrapling import Fetcher, StealthyFetcher
from scrapling.parser import Adaptor

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# REGION CONFIG
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REGIONS = {
    "COM": {"domain": "amazon.com",  "currency": "USD", "postal_code": "99950", "currency_cookie": "USD", "geo_code": "us"},
    "EG":  {"domain": "amazon.eg",   "currency": "EGP", "currency_cookie": "EGP", "geo_code": "eg"},
    "DE":  {"domain": "amazon.de",   "currency": "EUR", "postal_code": "80331", "currency_cookie": "EUR", "geo_code": "de"},
    "SA":  {"domain": "amazon.sa",   "currency": "SAR", "currency_cookie": "SAR", "geo_code": "sa"},
    "AE":  {"domain": "amazon.ae",   "currency": "AED", "currency_cookie": "AED", "geo_code": "ae"},
}

CURRENCY_SYMBOLS = {
    "USD": "$",
    "EUR": "\u20ac",
    "GBP": "\u00a3",
    "EGP": "EGP ",
    "SAR": "SAR ",
    "AED": "AED ",
}

NO_OFFER_PHRASES = [
    "no featured offers available",
    "no featured offers",
    "currently unavailable",
    "keine empfohlenen angebote",
    "keine angebote verf\u00fcgbar",
    "derzeit nicht verf\u00fcgbar",
    "\u0644\u0627 \u062a\u0648\u062c\u062f \u0639\u0631\u0648\u0636 \u0645\u0645\u064a\u0632\u0629 \u0645\u062a\u0627\u062d\u0629",
    "\u0644\u0627 \u064a\u0648\u062c\u062f \u0628\u0627\u0626\u0639\u0648\u0646 \u0622\u062e\u0631\u0648\u0646",
    "\u063a\u064a\u0631 \u0645\u062a\u0648\u0641\u0631 \u062d\u0627\u0644\u064a\u0627\u064b",
]

ARABIC_DIGITS = str.maketrans(
    "\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669",
    "0123456789"
)

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# HELPERS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def convert_arabic_numerals(text: str) -> str:
    return text.translate(ARABIC_DIGITS)

def convert_arabic_decimal(text: str) -> str:
    return text.replace("\u066b", ".")

def detect_currency(symbol: str, default_currency: str) -> str:
    mapping = {
        "$": "USD", "\u20ac": "EUR", "\u00a3": "GBP",
        "EGP": "EGP", "SAR": "SAR", "AED": "AED",
        "USD": "USD", "EUR": "EUR", "HKD": default_currency,
    }
    return mapping.get(symbol.strip(), default_currency)

def format_price_display(price: str, currency: str) -> str:
    if price == "N/A":
        return "N/A"
    try:
        num = float(price)
        symbol = CURRENCY_SYMBOLS.get(currency, currency + " ")
        return f"{symbol}{num:,.2f}"
    except ValueError:
        return price

def parse_price_from_text(text: str, default_currency: str) -> dict | None:
    if not text:
        return None
    text = convert_arabic_numerals(text)
    text = convert_arabic_decimal(text)
    text = text.replace("\u00a0", " ").strip()
    if not text:
        return None

    currency = default_currency
    if "\u20ac" in text or "EUR" in text:
        currency = "EUR"
    elif "$" in text and "HKD" not in text:
        currency = "USD"
    elif "USD" in text:
        currency = "USD"
    elif "EGP" in text:
        currency = "EGP"
    elif "SAR" in text:
        currency = "SAR"
    elif "AED" in text:
        currency = "AED"
    elif "HKD" in text:
        currency = default_currency

    # Handle German format: "8,93 €" → 8.93
    if currency == "EUR":
        euro_match = re.search(r'([\d]+(?:\.\d{3})*),(\d{2})\s*\u20ac', text)
        if euro_match:
            whole = euro_match.group(1).replace(".", "")
            frac = euro_match.group(2)
            return {"price": f"{whole}.{frac}", "currency": "EUR"}

    match = re.search(
        r'(?:[\$\u20ac\u00a3]|EGP|SAR|AED|USD|EUR|HKD)\s*([\d,]+\.?\d*)',
        text
    )
    if match:
        price_str = match.group(1).replace(",", "")
        try:
            val = float(price_str)
            if val > 0:
                return {"price": price_str, "currency": currency}
        except ValueError:
            pass

    match = re.search(r'(\d+\.\d{2})', text)
    if match:
        try:
            val = float(match.group(1))
            if val > 0:
                return {"price": match.group(1), "currency": currency}
        except ValueError:
            pass

    return None

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# AOD HTML PARSING (Using Scrapling Adaptor)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def parse_aod_html(html_text: str, region_key: str, asin: str) -> dict:
    """
    Parse AOD AJAX HTML using Scrapling's Adaptor.
    This is the core parser that works with HTML from any source
    (scrape.do, Fetcher, StealthyFetcher, etc.)
    """
    region = REGIONS.get(region_key, REGIONS["COM"])
    default_currency = region["currency"]

    result = {
        "domain": region["domain"],
        "region": region_key,
        "name": f"Product {asin}",
        "image": "",
        "price": "N/A",
        "currency": default_currency,
        "priceDisplay": "N/A",
        "asin": asin,
        "error": None,
    }

    if not html_text:
        result["error"] = "Empty HTML response"
        return result

    page = Adaptor(html_text)

    # Check for no-offer indicators
    no_offers_el = page.css('#aod-asin-no-offers')
    if no_offers_el:
        return result

    html_lower = html_text.lower()
    for phrase in NO_OFFER_PHRASES:
        if phrase in html_lower:
            aod_prices = page.css('[id^="aod-price-"]')
            if not aod_prices:
                return result
            break

    # Extract product name
    name_els = page.css('#aod-asin-title-text')
    if name_els:
        name_text = name_els[0].text.strip() if hasattr(name_els[0], 'text') else ""
        if name_text:
            result["name"] = name_text

    # Extract product image
    img_els = page.css('#aod-asin-image-id')
    if img_els:
        src = img_els[0].attrib.get('src', '')
        if src and src.startswith('http'):
            result["image"] = src
    if not result["image"]:
        for img in page.css('img'):
            src = img.attrib.get('src', '')
            if src and 'images-amazon' in src and '/images/I/' in src:
                result["image"] = src
                break

    # ── Extract price from AOD ──
    # Strategy priority:
    # 1. #aod-price-0 accessibility label (MOST RELIABLE - contains clean price)
    # 2. #aod-price-0 visual parts (symbol + whole + fraction)
    # 3. #aod-price-1 (first offer in list)
    # 4. #aod-offer-list any price
    extracted_price = None
    extracted_currency = default_currency

    # Find price container: #aod-price-0 > #aod-price-1 > any #aod-price-N
    price_container = None
    for selector in ['#aod-price-0', '#aod-price-1']:
        els = page.css(selector)
        if els:
            price_container = els[0]
            break
    if not price_container:
        all_price_els = page.css('[id^="aod-price-"]')
        if all_price_els:
            price_container = all_price_els[0]

    if price_container:
        # Method 1: Accessibility label (MOST RELIABLE)
        # Contains clean price like "€10.63 with 24 percent savings" or "8,93 € mit 24 Prozent Einsparungen"
        acc_labels = price_container.css('span.aok-offscreen.apex-pricetopay-accessibility-label')
        if acc_labels:
            acc_text = acc_labels[0].text.strip() if hasattr(acc_labels[0], 'text') else ""
            if acc_text:
                parsed = parse_price_from_text(acc_text, default_currency)
                if parsed:
                    extracted_price = parsed["price"]
                    extracted_currency = parsed["currency"]
                    print(f"[Parse] Price from accessibility label: {extracted_price} {extracted_currency} (text: {acc_text[:80]})", file=sys.stderr)

        # Method 2: Visual price parts (symbol + whole + fraction)
        if not extracted_price:
            a_prices = price_container.css('span.a-price')
            if a_prices:
                a_price = a_prices[0]
                sym_els = a_price.css('span.a-price-symbol')
                whole_els = a_price.css('span.a-price-whole')
                frac_els = a_price.css('span.a-price-fraction')

                if whole_els and frac_els:
                    symbol_text = sym_els[0].text.strip() if sym_els else ""
                    whole_text = whole_els[0].text.strip()
                    fraction_text = frac_els[0].text.strip()

                    whole_text = convert_arabic_numerals(whole_text)
                    fraction_text = convert_arabic_numerals(fraction_text)
                    # Strip trailing decimal/dot from whole part
                    whole_clean = re.sub(r'[.,]$', '', whole_text)
                    fraction_clean = fraction_text.strip()

                    if whole_clean and fraction_clean:
                        try:
                            price_val = float(f"{whole_clean}.{fraction_clean}")
                            if price_val > 0:
                                extracted_price = f"{whole_clean}.{fraction_clean}"
                                if symbol_text:
                                    extracted_currency = detect_currency(symbol_text, default_currency)
                                print(f"[Parse] Price from visual parts: {extracted_price} {extracted_currency} (symbol={symbol_text}, whole={whole_text}, frac={fraction_text})", file=sys.stderr)
                        except ValueError:
                            pass

        # Method 3: a-offscreen span
        if not extracted_price:
            offscreen_els = price_container.css('span.a-offscreen')
            if offscreen_els:
                offscreen_text = offscreen_els[0].text.strip()
                if offscreen_text:
                    parsed = parse_price_from_text(offscreen_text, default_currency)
                    if parsed:
                        extracted_price = parsed["price"]
                        extracted_currency = parsed["currency"]
                        print(f"[Parse] Price from offscreen: {extracted_price} {extracted_currency} (text: {offscreen_text[:80]})", file=sys.stderr)

    # Method 4: Try #aod-offer-list directly
    if not extracted_price:
        offer_list_els = page.css('#aod-offer-list')
        if offer_list_els:
            offer_list = offer_list_els[0]
            acc_labels = offer_list.css('span.aok-offscreen.apex-pricetopay-accessibility-label')
            if acc_labels:
                acc_text = acc_labels[0].text.strip()
                if acc_text:
                    parsed = parse_price_from_text(acc_text, default_currency)
                    if parsed:
                        extracted_price = parsed["price"]
                        extracted_currency = parsed["currency"]

            if not extracted_price:
                a_prices = offer_list.css('span.a-price')
                if a_prices:
                    a_price = a_prices[0]
                    sym_els = a_price.css('span.a-price-symbol')
                    whole_els = a_price.css('span.a-price-whole')
                    frac_els = a_price.css('span.a-price-fraction')
                    if whole_els and frac_els:
                        symbol_text = sym_els[0].text.strip() if sym_els else ""
                        whole_text = whole_els[0].text.strip()
                        fraction_text = frac_els[0].text.strip()
                        whole_text = convert_arabic_numerals(whole_text)
                        fraction_text = convert_arabic_numerals(fraction_text)
                        whole_clean = re.sub(r'[.,]$', '', whole_text)
                        fraction_clean = fraction_text.strip()
                        if whole_clean and fraction_clean:
                            try:
                                price_val = float(f"{whole_clean}.{fraction_clean}")
                                if price_val > 0:
                                    extracted_price = f"{whole_clean}.{fraction_clean}"
                                    if symbol_text:
                                        extracted_currency = detect_currency(symbol_text, default_currency)
                            except ValueError:
                                pass

    # Build final result
    if extracted_price:
        result["price"] = extracted_price
        result["currency"] = extracted_currency
        result["priceDisplay"] = format_price_display(extracted_price, extracted_currency)
    else:
        has_aod_structure = bool(
            page.css('#aod-offer-list') or
            page.css('[id^="aod-price-"]') or
            page.css('#aod-pinned-offer')
        )
        if not has_aod_structure:
            result["error"] = "No AOD structure found (might be blocked or redirected)"

    return result

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FETCH AOD PAGE — scrape.do API with geoCode
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def build_aod_url(asin: str, region_key: str) -> str:
    region = REGIONS.get(region_key, REGIONS["COM"])
    domain = region["domain"]
    url = f"https://www.{domain}/gp/product/ajax/aodAjaxMain/?asin={asin}"
    if region.get("postal_code"):
        url += f"&pc={region['postal_code']}"
    return url


def fetch_with_scrape_do(url: str, region_key: str) -> str | None:
    """
    Fetch AOD page using scrape.do API with geoCode.
    This routes the request through a proxy in the target country,
    ensuring Amazon returns the correct regional prices.
    
    Requires SCRAPE_DO_TOKEN environment variable.
    """
    token = os.environ.get("SCRAPE_DO_TOKEN", "")
    if not token:
        return None
    
    region = REGIONS.get(region_key, REGIONS["COM"])
    geo_code = region.get("geo_code", "us")
    
    api_url = f"https://api.scrape.do/?token={token}&url={req_lib.utils.quote(url, safe='')}&geoCode={geo_code}"
    
    try:
        print(f"[scrape.do] Fetching via {geo_code} proxy: {url}", file=sys.stderr)
        response = req_lib.get(api_url, timeout=60)
        if response.status_code == 200:
            print(f"[scrape.do] Success! Length: {len(response.text)}", file=sys.stderr)
            return response.text
        else:
            print(f"[scrape.do] Failed with status {response.status_code}", file=sys.stderr)
            return None
    except Exception as e:
        print(f"[scrape.do] Error: {e}", file=sys.stderr)
        return None


def fetch_with_fetcher(url: str, region_key: str) -> str | None:
    """Fetch AOD page using Scrapling Fetcher (basic HTTP with anti-bot)."""
    region = REGIONS.get(region_key, REGIONS["COM"])
    domain = region["domain"]
    currency_cookie = region.get("currency_cookie", region["currency"])

    try:
        fetcher = Fetcher()
        page = fetcher.get(
            url,
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "Referer": f"https://www.{domain}/",
                "Cookie": f"i18n-prefs={currency_cookie}; lc-main=en_US",
            },
            timeout=30,
        )
        if page and page.status == 200:
            html = str(page.html_content) if hasattr(page, 'html_content') else str(page)
            print(f"[Fetcher] Success! Length: {len(html)}", file=sys.stderr)
            return html
        print(f"[Fetcher] Status {page.status} for {url}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[Fetcher] Error: {e}", file=sys.stderr)
        return None


def fetch_with_stealth(url: str, region_key: str) -> str | None:
    """Fetch AOD page using Scrapling StealthyFetcher (Playwright with stealth)."""
    try:
        page = StealthyFetcher.fetch(
            url,
            headless=True,
            disable_resources=True,
            timeout=60000,
        )
        if page and page.status == 200:
            html = str(page.html_content) if hasattr(page, 'html_content') else str(page)
            print(f"[StealthyFetcher] Success! Length: {len(html)}", file=sys.stderr)
            return html
        print(f"[StealthyFetcher] Status {page.status} for {url}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[StealthyFetcher] Error: {e}", file=sys.stderr)
        return None


def fetch_aod(url: str, region_key: str) -> str | None:
    """
    Fetch AOD page HTML using the best available method.
    
    Priority:
    1. scrape.do API with geoCode (correct geolocation → correct prices)
    2. Scrapling Fetcher (fast, but may get IP-based different prices)
    3. Scrapling StealthyFetcher (slower, Playwright-based)
    """
    # Try scrape.do first (correct geolocation)
    html = fetch_with_scrape_do(url, region_key)
    if html:
        return html
    
    # Fall back to Scrapling Fetcher
    html = fetch_with_fetcher(url, region_key)
    if html:
        return html
    
    # Last resort: StealthyFetcher
    html = fetch_with_stealth(url, region_key)
    if html:
        return html
    
    return None

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# MAIN
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: scrape.py <ASIN> <REGION>"}))
        sys.exit(1)

    asin = sys.argv[1].strip().upper()
    region_key = sys.argv[2].strip().upper()

    if not re.match(r'^[A-Z0-9]{10}$', asin):
        print(json.dumps({"error": f"Invalid ASIN: {asin}"}))
        sys.exit(1)

    if region_key not in REGIONS:
        print(json.dumps({"error": f"Invalid region: {region_key}"}))
        sys.exit(1)

    url = build_aod_url(asin, region_key)
    print(f"[Scrape] Fetching AOD for {asin} on {region_key}: {url}", file=sys.stderr)

    # Check if scrape.do token is available
    scrape_do_token = os.environ.get("SCRAPE_DO_TOKEN", "")
    if scrape_do_token:
        print(f"[Scrape] Using scrape.do API with geoCode={REGIONS[region_key].get('geo_code', 'us')}", file=sys.stderr)
    else:
        print(f"[Scrape] No SCRAPE_DO_TOKEN set, using Scrapling Fetcher (prices may differ by IP geolocation)", file=sys.stderr)

    html = fetch_aod(url, region_key)

    if html is None:
        region = REGIONS[region_key]
        print(json.dumps({
            "domain": region["domain"],
            "region": region_key,
            "name": f"Product {asin}",
            "image": "",
            "price": "N/A",
            "currency": region["currency"],
            "priceDisplay": "N/A",
            "asin": asin,
            "error": "Failed to fetch AOD page from Amazon",
        }))
        sys.exit(0)

    # Parse HTML with Scrapling Adaptor
    result = parse_aod_html(html, region_key, asin)
    print(f"[Scrape] Result for {asin} on {region_key}: price={result['price']} display={result['priceDisplay']}", file=sys.stderr)
    print(json.dumps(result))
