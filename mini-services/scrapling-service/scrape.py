#!/usr/bin/env python3
"""
Crawleo AOD Crawler — Standalone Script
========================================
Called via subprocess from Next.js.

Usage:
  python3 scrape.py <ASIN> <REGION> <CRAWLEO_API_KEY>

Uses Crawleo API (https://api.crawleo.dev/crawl) to fetch AOD AJAX pages
with JavaScript rendering and correct geolocation-based prices.

CRITICAL RULES:
- Prices MUST come from AOD AJAX endpoint ONLY
- URL: https://www.amazon.{region}/gp/product/ajax/aodAjaxMain/?asin={ASIN}
- If AOD has no offers → return "N/A"
"""

import re
import sys
import json
import urllib.request
import urllib.parse
import urllib.error

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# REGION CONFIG
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REGIONS = {
    "COM": {"domain": "amazon.com",  "currency": "USD", "geo": "us"},
    "EG":  {"domain": "amazon.eg",   "currency": "EGP", "geo": "eg"},
    "DE":  {"domain": "amazon.de",   "currency": "EUR", "geo": "de"},
    "SA":  {"domain": "amazon.sa",   "currency": "SAR", "geo": "sa"},
    "AE":  {"domain": "amazon.ae",   "currency": "AED", "geo": "ae"},
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

def convert_arabic_numerals(text):
    """Convert Arabic-Indic digits (٠-٩) to Western digits (0-9)."""
    return text.translate(ARABIC_DIGITS)

def convert_arabic_decimal(text):
    """Convert Arabic decimal separator (٫) to period."""
    return text.replace("\u066b", ".")

def format_price_display(price, currency):
    if price == "N/A":
        return "N/A"
    try:
        num = float(price)
        symbol = CURRENCY_SYMBOLS.get(currency, currency + " ")
        return f"{symbol}{num:,.2f}"
    except ValueError:
        return price

def clean_whole(whole_str):
    """Remove thousands separators from whole number part.
    
    Handles: "3,400" → "3400", "1.234" → "1234", "10" → "10"
    """
    return whole_str.replace(",", "").replace(".", "").replace(" ", "").replace("\u200e", "").replace("\u200f", "")

def identify_currency(symbol, default):
    """Identify currency from symbol or text."""
    symbol = symbol.strip().replace("\u200e", "").replace("\u200f", "")
    if symbol == "$":
        return "USD"
    if symbol == "\u20ac":
        return "EUR"
    if symbol == "\u00a3":
        return "GBP"
    if symbol.upper() == "SAR":
        return "SAR"
    if symbol.upper() == "AED":
        return "AED"
    if symbol.upper() == "EGP":
        return "EGP"
    # Arabic currency names
    if symbol == "\u062c\u0646\u064a\u0647" or symbol == "\u062c.\u0645":  # جنيه or ج.م (EGP)
        return "EGP"
    if symbol == "\u0631\u064a\u0627\u0644" or symbol == "\u0631.\u0633":  # ريال or ر.س (SAR)
        return "SAR"
    if symbol == "\u062f\u0631\u0647\u0645" or symbol == "\u062f.\u0625":  # درهم or د.إ (AED)
        return "AED"
    return default

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CRAWLEO API FETCH
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRAWLEO_API_URL = "https://api.crawleo.dev/crawl"

def fetch_with_crawleo(url, api_key, geolocation=None, max_retries=2):
    """Fetch AOD page using Crawleo API with JavaScript rendering and geolocation.

    Crawleo API docs: https://docs.crawleo.dev/api-reference/endpoint/crawler
    - GET https://api.crawleo.dev/crawl
    - Required: urls=<URL>
    - render_js=true for JavaScript rendering (10 credits/URL)
    - geolocation=<ISO 3166-1 alpha-2> for geo-targeted content
    - raw_html=true to get raw HTML
    - enhanced_html=true for cleaned HTML
    - markdown=true for markdown output
    """
    params = {
        "urls": url,
        "render_js": "true",
        "raw_html": "true",
        "enhanced_html": "true",
        "markdown": "true",
    }
    if geolocation:
        params["geolocation"] = geolocation

    query_string = urllib.parse.urlencode(params)
    api_url = f"{CRAWLEO_API_URL}?{query_string}"

    for attempt in range(max_retries + 1):
        try:
            if attempt > 0:
                print(f"[Crawleo] Retry attempt {attempt} for: {url}", file=sys.stderr)
                import time
                time.sleep(2 * attempt)
            else:
                print(f"[Crawleo] Fetching: {url} (geo={geolocation})", file=sys.stderr)

            req = urllib.request.Request(
                api_url,
                headers={"x-api-key": api_key}
            )

            with urllib.request.urlopen(req, timeout=90) as response:
                data = json.loads(response.read().decode('utf-8'))

                if not data.get("results") or len(data["results"]) == 0:
                    print(f"[Crawleo] No results returned", file=sys.stderr)
                    if attempt < max_retries:
                        continue
                    return None

                result = data["results"][0]
                status_code = result.get("status_code", 0)

                error_msg = result.get("error", "")
                if error_msg:
                    print(f"[Crawleo] Error in result: {error_msg}", file=sys.stderr)
                    if attempt < max_retries:
                        continue
                    return None

                if status_code not in (200, 404):
                    print(f"[Crawleo] Page status: {status_code}", file=sys.stderr)
                    if attempt < max_retries:
                        continue
                    return None

                raw_html = result.get("raw_html", "")
                enhanced_html = result.get("enhanced_html", "")
                markdown = result.get("markdown", "")
                credits = data.get("credits", 0)

                print(f"[Crawleo] Success! Credits: {credits}, raw_html: {len(raw_html)} chars, markdown: {len(markdown)} chars", file=sys.stderr)
                return {"raw_html": raw_html, "enhanced_html": enhanced_html, "markdown": markdown}

        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode('utf-8', errors='replace')
            except:
                pass
            print(f"[Crawleo] HTTP Error {e.code} (attempt {attempt + 1}/{max_retries + 1}): {body[:300]}", file=sys.stderr)
            if attempt < max_retries:
                continue
            return None
        except Exception as e:
            print(f"[Crawleo] Error (attempt {attempt + 1}/{max_retries + 1}): {e}", file=sys.stderr)
            if attempt < max_retries:
                continue
            return None

    return None

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PRICE PARSING
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def parse_price(raw_html, markdown, region_key):
    """
    Parse price from Crawleo response (raw HTML + markdown).

    The AOD page HTML has these key elements:
    - span.aok-offscreen.apex-pricetopay-accessibility-label: "€10.63 with 24 percent savings"
    - span.a-price > span.a-price-symbol + span.a-price-whole + span.a-price-fraction
    - span.a-offscreen: Contains price text

    We try these in order of reliability:
    1. Accessibility label (screen reader text - most reliable)
    2. a-price components (symbol + whole + fraction)
    3. a-offscreen text
    4. Markdown patterns
    """
    region = REGIONS.get(region_key, REGIONS["COM"])
    default_currency = region["currency"]

    # Convert Arabic numerals
    md = convert_arabic_numerals(markdown)
    md = convert_arabic_decimal(md)
    html = convert_arabic_numerals(raw_html)
    html = convert_arabic_decimal(html)

    # Strip RTL/LTR marks for cleaner matching
    html_clean = html.replace("\u200e", "").replace("\u200f", "")
    md_clean = md.replace("\u200e", "").replace("\u200f", "")

    # ── Extract product name (BEFORE offer count check so it's available for N/A returns) ──
    name = ""
    # From HTML title tag
    title_match = re.search(r'<title[^>]*>(.*?)</title>', html_clean, re.IGNORECASE | re.DOTALL)
    if title_match:
        raw_title = title_match.group(1).strip()
        raw_title = re.sub(r'\s*[:|]\s*Amazon\.\w+\s*$', '', raw_title)
        raw_title = re.sub(r'\s*:\s*Online.*$', '', raw_title, flags=re.IGNORECASE)
        if raw_title:
            name = raw_title[:300].strip()

    # Fallback: first heading in markdown
    if not name:
        name_match = re.match(r'^#{1,5}\s+(.+?)(?:\n|$)', md_clean)
        if name_match:
            raw_name = name_match.group(1).strip()
            # Truncate at rating patterns
            rating_cut = re.match(
                r'^(.+?)(?:\s+\d+[.,]\d+\s+(?:von|out of|من)\s+\d+\s+(?:Sternen|stars|نجوم))',
                raw_name
            )
            if rating_cut:
                name = rating_cut.group(1).strip()
            else:
                name = raw_name[:300].strip()

    # ── Extract product image ──
    image = ""
    img_match = re.search(r'src=["\']?(https?://[^"\'>\s]*images-amazon[^"\'>\s]*/images/I/[^"\'>\s]+)', html_clean)
    if img_match:
        image = img_match.group(1)

    # ── Check for truly no offers ──
    # "No featured offers available" does NOT mean no offers at all —
    # it just means no PINNED/featured offer.
    # Also, aod-total-offer-count only counts "other sellers", NOT pinned offers.
    # So aod-total-offer-count=0 can still have a pinned offer with a price.
    # We need to check BOTH: offer count AND presence of #aod-price-* elements.
    lower_md = md_clean.lower()
    lower_html = html_clean.lower()

    # Check aod-total-offer-count (counts "other sellers" only)
    offer_count_match = re.search(
        r'id="aod-total-offer-count"[^>]*value="(\d+)"',
        html_clean
    )
    if not offer_count_match:
        # Try alternate pattern (value before id)
        offer_count_match = re.search(
            r'value="(\d+)"[^>]*id="aod-total-offer-count"',
            html_clean
        )

    total_offers = int(offer_count_match.group(1)) if offer_count_match else -1
    print(f"[Parse] aod-total-offer-count = {total_offers}", file=sys.stderr)

    # Check for #aod-price-* elements (these indicate actual price offers exist)
    price_elements = re.findall(r'id="aod-price-\d+"', html_clean)
    has_price_elements = len(price_elements) > 0
    print(f"[Parse] aod-price-* elements found: {len(price_elements)} ({price_elements[:5]})", file=sys.stderr)

    # Only return N/A if BOTH: no other sellers (offer count = 0) AND no price elements at all
    if total_offers == 0 and not has_price_elements:
        print(f"[Parse] No offers at all (offer-count=0, no aod-price elements) → N/A", file=sys.stderr)
        return {"price": "N/A", "currency": default_currency, "name": name, "image": image}

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # PRICE EXTRACTION — Strategy 1: Accessibility label (BEST)
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    # Accessibility label pattern: "€10.63 with 24 percent savings" or "$17.49 with 24 percent savings"
    # or "SAR 130.00" or Arabic "جنيه3,400.00 مع 24 بالمئة توفير"
    acc_matches = re.findall(
        r'<span[^>]*class="[^"]*aok-offscreen[^"]*apex-pricetopay[^"]*"[^>]*>\s*([^<]+?)\s*</span>',
        html_clean
    )
    if acc_matches:
        for acc_text in acc_matches:
            price_result = extract_price_from_text(acc_text.strip(), default_currency)
            if price_result:
                print(f"[Parse] Price from accessibility label: {acc_text.strip()} -> {price_result}", file=sys.stderr)
                return {"price": price_result["price"], "currency": price_result["currency"], "name": name, "image": image}

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # PRICE EXTRACTION — Strategy 2: a-price components
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    # Look for a-price-symbol + a-price-whole + a-price-fraction
    price_blocks = re.findall(
        r'<span[^>]*class="[^"]*a-price[^"]*"[^>]*>.*?'
        r'<span[^>]*class="[^"]*a-price-symbol[^"]*"[^>]*>\s*([^<]+?)\s*</span>.*?'
        r'<span[^>]*class="[^"]*a-price-whole[^"]*"[^>]*>\s*([^<]+?)\s*</span>.*?'
        r'<span[^>]*class="[^"]*a-price-fraction[^"]*"[^>]*>\s*([^<]+?)\s*</span>',
        html_clean, re.DOTALL
    )
    if price_blocks:
        symbol = price_blocks[0][0].strip()
        whole = price_blocks[0][1].strip().rstrip(',').rstrip('.')
        fraction = price_blocks[0][2].strip()
        whole_clean = clean_whole(whole)
        try:
            price_val = float(f"{whole_clean}.{fraction}")
            if price_val > 0:
                currency = identify_currency(symbol, default_currency)
                print(f"[Parse] Price from a-price components: {symbol}{whole}.{fraction} -> {whole_clean}.{fraction} {currency}", file=sys.stderr)
                return {"price": f"{whole_clean}.{fraction}", "currency": currency, "name": name, "image": image}
        except ValueError:
            pass

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # PRICE EXTRACTION — Strategy 3: a-offscreen text
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    a_offscreen_matches = re.findall(
        r'<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>\s*([^<]+?)\s*</span>',
        html_clean
    )
    if a_offscreen_matches:
        for price_text in a_offscreen_matches:
            price_result = extract_price_from_text(price_text.strip(), default_currency)
            if price_result:
                # Skip per-unit prices like "$1.09/fl oz" - they tend to be small
                # Only accept if it seems like a real product price (not per-unit)
                try:
                    val = float(price_result["price"])
                    # Heuristic: if the price seems too small for a real product, skip it
                    # But we can't be sure, so let's take the first reasonable one
                    if val >= 0.5:
                        print(f"[Parse] Price from a-offscreen: {price_text.strip()} -> {price_result}", file=sys.stderr)
                        return {"price": price_result["price"], "currency": price_result["currency"], "name": name, "image": image}
                except ValueError:
                    pass

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # PRICE EXTRACTION — Strategy 4: Markdown patterns
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    price_result = extract_price_from_markdown(md_clean, default_currency)
    if price_result:
        print(f"[Parse] Price from markdown: {price_result}", file=sys.stderr)
        return {"price": price_result["price"], "currency": price_result["currency"], "name": name, "image": image}

    # ── Fallback: check for no-offer phrases if we couldn't find a price ──
    # Only use NO_OFFER_PHRASES as a last-resort indicator,
    # NOT as an early return (because "No featured offers" ≠ no offers at all).
    if total_offers == -1 and not has_price_elements:
        # We couldn't find aod-total-offer-count OR aod-price elements in HTML
        # Check if BOTH "no featured offers" AND "no other sellers" are present
        has_no_featured = any(p.lower() in lower_html or p.lower() in lower_md for p in NO_OFFER_PHRASES[:3])
        no_other_sellers = "no other sellers" in lower_html or "no other sellers" in lower_md
        no_sellers_ar = "\u0644\u0627 \u064a\u0648\u062c\u062f \u0628\u0627\u0626\u0639\u0648\u0646 \u0622\u062e\u0631\u0648\u0646" in lower_html or "\u0644\u0627 \u064a\u0648\u062c\u062f \u062d\u0627\u0644\u064a\u064b\u0627 \u0628\u0627\u0626\u0639\u0648\u0646" in lower_html  # لا يوجد بائعون آخرون / لا يوجد حاليا بائعون
        if has_no_featured and (no_other_sellers or no_sellers_ar):
            print(f"[Parse] No offers detected (no featured + no other sellers) → N/A", file=sys.stderr)
            return {"price": "N/A", "currency": default_currency, "name": name, "image": image}

    print(f"[Parse] No price found for {region_key} → N/A", file=sys.stderr)
    return {"price": "N/A", "currency": default_currency, "name": name, "image": image}


def extract_price_from_text(text, default_currency):
    """Extract price from a text string like '€10.63 with 24 percent savings' or '$20.25' or 'جنيه3,400.00'."""
    if not text:
        return None

    # Strip savings suffix
    clean = re.sub(r'\s+(with|mit|مع)\s+\d+\s+(percent|Prozent|بالمئة|%)\s+(savings|Einsparungen|توفير)', '', text, flags=re.IGNORECASE)
    clean = clean.strip()

    # Remove HTML entities and RTL/LTR marks
    clean = clean.replace('&nbsp;', ' ').replace('&amp;', '&').replace('\u200e', '').replace('\u200f', '')
    clean = clean.strip()

    # Try EUR: "€10.63" or "€10,63" or "10,63 €"
    euro_match = re.search(r'[\u20ac]\s*(\d[\d.,]*)', clean)
    if euro_match:
        price_result = parse_number_with_currency(euro_match.group(1), "EUR")
        if price_result:
            return price_result

    # Try EUR reversed: "10,63 €" or "10.63€"
    euro_rev_match = re.search(r'(\d[\d.,]*)\s*[\u20ac]', clean)
    if euro_rev_match:
        price_result = parse_number_with_currency(euro_rev_match.group(1), "EUR")
        if price_result:
            return price_result

    # Try USD: "$20.25" or "$ 20.25"
    usd_match = re.search(r'\$\s*(\d[\d.,]*)', clean)
    if usd_match:
        price_result = parse_number_with_currency(usd_match.group(1), "USD")
        if price_result:
            return price_result

    # Try SAR: "SAR 113.38" or "SAR113.38"
    sar_match = re.search(r'SAR\s*(\d[\d.,]*)', clean, re.IGNORECASE)
    if sar_match:
        price_result = parse_number_with_currency(sar_match.group(1), "SAR")
        if price_result:
            return price_result

    # Try AED: "AED 76.38" or "AED76.38"
    aed_match = re.search(r'AED\s*(\d[\d.,]*)', clean, re.IGNORECASE)
    if aed_match:
        price_result = parse_number_with_currency(aed_match.group(1), "AED")
        if price_result:
            return price_result

    # Try EGP: "EGP 150.00" or "EGP150.00"
    egp_match = re.search(r'EGP\s*(\d[\d.,]*)', clean, re.IGNORECASE)
    if egp_match:
        price_result = parse_number_with_currency(egp_match.group(1), "EGP")
        if price_result:
            return price_result

    # Try Arabic "جنيه" (Egyptian pound): "جنيه3,400.00" or "3,400.00 جنيه"
    gnh_match = re.search(r'\u062c\u0646\u064a\u0647\s*(\d[\d.,]*)', clean)
    if gnh_match:
        price_result = parse_number_with_currency(gnh_match.group(1), "EGP")
        if price_result:
            return price_result
    gnh_rev_match = re.search(r'(\d[\d.,]*)\s*\u062c\u0646\u064a\u0647', clean)
    if gnh_rev_match:
        price_result = parse_number_with_currency(gnh_rev_match.group(1), "EGP")
        if price_result:
            return price_result

    # Try Arabic "ريال" (SAR)
    sar_ar_match = re.search(r'\u0631\u064a\u0627\u0644\s*(\d[\d.,]*)', clean)
    if sar_ar_match:
        price_result = parse_number_with_currency(sar_ar_match.group(1), "SAR")
        if price_result:
            return price_result
    sar_ar_rev = re.search(r'(\d[\d.,]*)\s*\u0631\u064a\u0627\u0644', clean)
    if sar_ar_rev:
        price_result = parse_number_with_currency(sar_ar_rev.group(1), "SAR")
        if price_result:
            return price_result
    # Try Arabic "ر.س" (SAR abbreviation)
    sar_abbr_match = re.search(r'\u0631\.\u0633\s*(\d[\d.,]*)', clean)
    if sar_abbr_match:
        price_result = parse_number_with_currency(sar_abbr_match.group(1), "SAR")
        if price_result:
            return price_result
    # Try Arabic "درهم" (AED)
    aed_ar_match = re.search(r'\u062f\u0631\u0647\u0645\s*(\d[\d.,]*)', clean)
    if aed_ar_match:
        price_result = parse_number_with_currency(aed_ar_match.group(1), "AED")
        if price_result:
            return price_result
    aed_ar_rev = re.search(r'(\d[\d.,]*)\s*\u062f\u0631\u0647\u0645', clean)
    if aed_ar_rev:
        price_result = parse_number_with_currency(aed_ar_rev.group(1), "AED")
        if price_result:
            return price_result
    # Try Arabic "د.إ" (AED abbreviation)
    aed_abbr_match = re.search(r'\u062f\.\u0625\s*(\d[\d.,]*)', clean)
    if aed_abbr_match:
        price_result = parse_number_with_currency(aed_abbr_match.group(1), "AED")
        if price_result:
            return price_result

    # Last resort: just a number if it looks like a price
    num_match = re.search(r'(\d[\d.,]*)', clean)
    if num_match:
        price_result = parse_number_with_currency(num_match.group(1), default_currency)
        if price_result:
            return price_result

    return None


def parse_number_with_currency(number_str, currency):
    """Parse a number string like '3,400.00' or '10,63' into a price dict.

    Handles both US format (3,400.00) and European format (10,63).
    Returns {"price": "3400.00", "currency": "USD"} or None.
    """
    number_str = number_str.strip()

    # Strategy: count the number of digits after the last separator
    # If there are exactly 2 digits after the last separator, that's the fraction
    # Everything before is the whole number

    # Find all potential separators (comma or period)
    # Split by the last separator
    last_dot = number_str.rfind('.')
    last_comma = number_str.rfind(',')

    if last_dot == -1 and last_comma == -1:
        # No separator at all - just an integer
        try:
            val = int(number_str)
            if val > 0:
                return {"price": f"{val}.00", "currency": currency}
        except ValueError:
            return None

    # Determine which separator is the decimal point
    if last_dot > last_comma:
        # Last separator is a dot → US/UK format: 3,400.00
        whole_part = number_str[:last_dot]
        frac_part = number_str[last_dot + 1:]
        if len(frac_part) == 2:
            whole_clean = clean_whole(whole_part)
            try:
                val = float(f"{whole_clean}.{frac_part}")
                if val > 0:
                    return {"price": f"{whole_clean}.{frac_part}", "currency": currency}
            except ValueError:
                pass
        elif len(frac_part) == 1:
            whole_clean = clean_whole(whole_part)
            try:
                val = float(f"{whole_clean}.{frac_part}0")
                if val > 0:
                    return {"price": f"{whole_clean}.{frac_part}0", "currency": currency}
            except ValueError:
                pass
    elif last_comma > last_dot:
        # Last separator is a comma → European format: 10,63 or 3.400,00
        whole_part = number_str[:last_comma]
        frac_part = number_str[last_comma + 1:]
        if len(frac_part) == 2:
            whole_clean = clean_whole(whole_part)
            try:
                val = float(f"{whole_clean}.{frac_part}")
                if val > 0:
                    return {"price": f"{whole_clean}.{frac_part}", "currency": currency}
            except ValueError:
                pass
    elif last_comma > -1:
        # Only commas, no dots
        # Could be European decimal: "10,63" or US thousands: "1,200" 
        # Check digits after comma
        frac_part = number_str[last_comma + 1:]
        whole_part = number_str[:last_comma]
        if len(frac_part) == 2 and len(whole_part) <= 3:
            # Likely European decimal: "10,63"
            whole_clean = clean_whole(whole_part)
            try:
                val = float(f"{whole_clean}.{frac_part}")
                if val > 0:
                    return {"price": f"{whole_clean}.{frac_part}", "currency": currency}
            except ValueError:
                pass
        elif len(frac_part) == 3:
            # Likely thousands separator: "1,200"
            whole_clean = clean_whole(number_str)
            try:
                val = float(whole_clean)
                if val > 0:
                    return {"price": f"{whole_clean}.00", "currency": currency}
            except ValueError:
                pass
    elif last_dot > -1:
        # Only dots, no commas
        frac_part = number_str[last_dot + 1:]
        whole_part = number_str[:last_dot]
        if len(frac_part) == 2:
            whole_clean = clean_whole(whole_part)
            try:
                val = float(f"{whole_clean}.{frac_part}")
                if val > 0:
                    return {"price": f"{whole_clean}.{frac_part}", "currency": currency}
            except ValueError:
                pass

    return None


def extract_price_from_markdown(md, default_currency):
    """Extract price from markdown text as fallback."""
    # Price with savings text (German format): "10,63 € mit 24 Prozent Einsparungen"
    euro_savings_match = re.search(r'(\d[\d.,]*)\s*\u20ac\s+mit\s+\d+', md)
    if euro_savings_match:
        price_result = parse_number_with_currency(euro_savings_match.group(1), "EUR")
        if price_result:
            return price_result

    # "10,63€" compact
    euro_compact_match = re.search(r'(\d[\d.,]*)\s*\u20ac', md)
    if euro_compact_match:
        price_result = parse_number_with_currency(euro_compact_match.group(1), "EUR")
        if price_result:
            return price_result

    # "€10.63" prefix
    euro_prefix_match = re.search(r'\u20ac\s*(\d[\d.,]*)', md)
    if euro_prefix_match:
        price_result = parse_number_with_currency(euro_prefix_match.group(1), "EUR")
        if price_result:
            return price_result

    # "$17.49 with X percent savings"
    usd_savings_match = re.search(r'\$\s*(\d[\d.,]*)\s+with\s+\d+\s+percent\s+savings', md)
    if usd_savings_match:
        price_result = parse_number_with_currency(usd_savings_match.group(1), "USD")
        if price_result:
            return price_result

    # "$20.25"
    usd_match = re.search(r'\$\s*(\d[\d.,]*)', md)
    if usd_match:
        price_result = parse_number_with_currency(usd_match.group(1), "USD")
        if price_result:
            return price_result

    # SAR price
    sar_match = re.search(r'SAR\s*(\d[\d.,]*)', md)
    if sar_match:
        price_result = parse_number_with_currency(sar_match.group(1), "SAR")
        if price_result:
            return price_result

    # AED price
    aed_match = re.search(r'AED\s*(\d[\d.,]*)', md)
    if aed_match:
        price_result = parse_number_with_currency(aed_match.group(1), "AED")
        if price_result:
            return price_result

    # EGP price
    egp_match = re.search(r'EGP\s*(\d[\d.,]*)', md)
    if egp_match:
        price_result = parse_number_with_currency(egp_match.group(1), "EGP")
        if price_result:
            return price_result

    # Arabic "جنيه" (EGP)
    gnh_match = re.search(r'\u062c\u0646\u064a\u0647\s*(\d[\d.,]*)', md)
    if gnh_match:
        price_result = parse_number_with_currency(gnh_match.group(1), "EGP")
        if price_result:
            return price_result
    gnh_rev_match = re.search(r'(\d[\d.,]*)\s*\u062c\u0646\u064a\u0647', md)
    if gnh_rev_match:
        price_result = parse_number_with_currency(gnh_rev_match.group(1), "EGP")
        if price_result:
            return price_result
    # Arabic "ريال" (SAR)
    sar_ar_md = re.search(r'\u0631\u064a\u0627\u0644\s*(\d[\d.,]*)', md)
    if sar_ar_md:
        price_result = parse_number_with_currency(sar_ar_md.group(1), "SAR")
        if price_result:
            return price_result
    sar_ar_md_rev = re.search(r'(\d[\d.,]*)\s*\u0631\u064a\u0627\u0644', md)
    if sar_ar_md_rev:
        price_result = parse_number_with_currency(sar_ar_md_rev.group(1), "SAR")
        if price_result:
            return price_result
    # Arabic "درهم" (AED)
    aed_ar_md = re.search(r'\u062f\u0631\u0647\u0645\s*(\d[\d.,]*)', md)
    if aed_ar_md:
        price_result = parse_number_with_currency(aed_ar_md.group(1), "AED")
        if price_result:
            return price_result
    aed_ar_md_rev = re.search(r'(\d[\d.,]*)\s*\u062f\u0631\u0647\u0645', md)
    if aed_ar_md_rev:
        price_result = parse_number_with_currency(aed_ar_md_rev.group(1), "AED")
        if price_result:
            return price_result

    # "X.XX with N percent savings" (any currency)
    savings_match = re.search(r'(\d[\d.,]*)\s+with\s+\d+\s+percent\s+savings', md)
    if savings_match:
        price_result = parse_number_with_currency(savings_match.group(1), default_currency)
        if price_result:
            return price_result

    # Generic: first decimal number that looks like a price
    generic_match = re.search(r'(\d[\d.,]*)', md)
    if generic_match:
        price_result = parse_number_with_currency(generic_match.group(1), default_currency)
        if price_result:
            try:
                val = float(price_result["price"])
                if val > 0:
                    return price_result
            except ValueError:
                pass

    return None

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# MAIN
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Usage: scrape.py <ASIN> <REGION> <CRAWLEO_API_KEY>"}))
        sys.exit(1)

    asin = sys.argv[1].strip().upper()
    region_key = sys.argv[2].strip().upper()
    crawleo_api_key = sys.argv[3].strip()

    if not re.match(r'^[A-Z0-9]{10}$', asin):
        print(json.dumps({"error": f"Invalid ASIN: {asin}"}))
        sys.exit(1)

    if region_key not in REGIONS:
        print(json.dumps({"error": f"Invalid region: {region_key}"}))
        sys.exit(1)

    region = REGIONS[region_key]
    domain = region["domain"]
    default_currency = region["currency"]
    geolocation = region["geo"]

    # Build AOD AJAX URL — this is the ONLY source for prices
    url = f"https://www.{domain}/gp/product/ajax/aodAjaxMain/?asin={asin}"

    print(f"[Scrape] Fetching AOD for {asin} on {region_key} (geo={geolocation}) via Crawleo: {url}", file=sys.stderr)

    # Fetch via Crawleo API with JavaScript rendering and geolocation
    crawleo_result = fetch_with_crawleo(url, crawleo_api_key, geolocation=geolocation)

    if crawleo_result is None:
        print(json.dumps({
            "domain": domain,
            "region": region_key,
            "name": f"Product {asin}",
            "image": "",
            "price": "N/A",
            "currency": default_currency,
            "priceDisplay": "N/A",
            "asin": asin,
            "error": "Failed to fetch AOD page from Crawleo",
        }))
        sys.exit(0)

    # Parse the Crawleo response — prefer raw_html for accurate price extraction
    raw_html = crawleo_result.get("raw_html", "")
    markdown = crawleo_result.get("markdown", "")
    enhanced_html = crawleo_result.get("enhanced_html", "")

    # Use raw_html for parsing (most reliable for AOD price elements)
    html_for_parsing = raw_html or enhanced_html

    parsed = parse_price(html_for_parsing, markdown, region_key)

    result = {
        "domain": domain,
        "region": region_key,
        "name": parsed.get("name") or f"Product {asin}",
        "image": parsed.get("image", ""),
        "price": parsed["price"],
        "currency": parsed["currency"],
        "priceDisplay": format_price_display(parsed["price"], parsed["currency"]),
        "asin": asin,
        "error": None,
    }

    print(f"[Scrape] Result for {asin} on {region_key}: price={result['price']} display={result['priceDisplay']}", file=sys.stderr)
    print(json.dumps(result))
