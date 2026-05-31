"""
Scrapling AOD AJAX Crawler Service
===================================
Uses Scrapling library to fetch Amazon AOD (All Offers Display) AJAX pages
and extract real prices from the HTML.

CRITICAL RULES:
- Prices MUST come from AOD ONLY (#aod-price-0, #aod-price-1, etc.)
- NO fallback to main page prices
- NO ATC button prices from non-AOD sections
- NO alternative/recommended product prices
- If AOD has no offers -> return "N/A"

AOD AJAX URL pattern:
  https://www.amazon.{region}/gp/product/ajax/aodAjaxMain/?asin={ASIN}
"""

import re
import json
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from scrapling import Fetcher, StealthyFetcher

app = FastAPI(title="Scrapling AOD Crawler")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# REGION CONFIG
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REGIONS = {
    "COM": {"domain": "amazon.com",  "currency": "USD", "postal_code": "99950", "currency_cookie": "USD"},
    "EG":  {"domain": "amazon.eg",   "currency": "EGP", "currency_cookie": "EGP"},
    "DE":  {"domain": "amazon.de",   "currency": "EUR", "postal_code": "80331", "currency_cookie": "EUR"},
    "SA":  {"domain": "amazon.sa",   "currency": "SAR", "currency_cookie": "SAR"},
    "AE":  {"domain": "amazon.ae",   "currency": "AED", "currency_cookie": "AED"},
}

CURRENCY_SYMBOLS = {
    "USD": "$",
    "EUR": "\u20ac",
    "GBP": "\u00a3",
    "EGP": "EGP ",
    "SAR": "SAR ",
    "AED": "AED ",
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# NO-OFFER DETECTION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ARABIC NUMERAL CONVERSION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ARABIC_DIGITS = str.maketrans(
    "\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669",
    "0123456789"
)

def convert_arabic_numerals(text: str) -> str:
    return text.translate(ARABIC_DIGITS)

def convert_arabic_decimal(text: str) -> str:
    return text.replace("\u066b", ".")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PRICE PARSING
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def parse_price_from_text(text: str, default_currency: str) -> dict | None:
    """
    Parse price from text like:
    - "€10.63 with 24 percent savings"
    - "$29.99"
    - "$29.99 with 15 percent savings"
    - "EGP 280.00"
    - "SAR 45.00"
    Returns {"price": "10.63", "currency": "EUR"} or None.
    """
    if not text:
        return None

    text = convert_arabic_numerals(text)
    text = convert_arabic_decimal(text)
    text = text.replace("\u00a0", " ").strip()

    if not text:
        return None

    # Detect currency from text
    currency = default_currency
    if "\u20ac" in text or "EUR" in text:
        currency = "EUR"
    elif "$" in text and "USD" not in text and "HKD" not in text:
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
        # HKD means server returned wrong currency - keep default
        currency = default_currency

    # Extract numeric price
    # Pattern: currency symbol + number
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

    # Try just a number
    match = re.search(r'(\d+\.\d{2})', text)
    if match:
        try:
            val = float(match.group(1))
            if val > 0:
                return {"price": match.group(1), "currency": currency}
        except ValueError:
            pass

    return None


def detect_currency(symbol: str, default_currency: str) -> str:
    """Map currency symbol to ISO code."""
    mapping = {
        "$": "USD",
        "\u20ac": "EUR",
        "\u00a3": "GBP",
        "EGP": "EGP",
        "SAR": "SAR",
        "AED": "AED",
        "USD": "USD",
        "EUR": "EUR",
        "HKD": default_currency,  # Wrong currency from server, use default
    }
    return mapping.get(symbol.strip(), default_currency)


def format_price_display(price: str, currency: str) -> str:
    """Format price with currency symbol for display."""
    if price == "N/A":
        return "N/A"
    try:
        num = float(price)
        symbol = CURRENCY_SYMBOLS.get(currency, currency + " ")
        return f"{symbol}{num:,.2f}"
    except ValueError:
        return price

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# AOD HTML PARSING
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def parse_aod_response(page, region_key: str, asin: str) -> dict:
    """
    Parse the AOD AJAX Scrapling Response and extract price data.

    Selectors (confirmed from actual Amazon AOD AJAX HTML):
    - Price containers: #aod-price-0 (pinned), #aod-price-1, #aod-price-2, etc.
    - Price accessibility label: span.aok-offscreen.apex-pricetopay-accessibility-label
    - Price visual: span.a-price > span.a-price-symbol + span.a-price-whole + span.a-price-fraction
    - Product name: #aod-asin-title-text
    - Product image: #aod-asin-image-id img src
    - No offers: #aod-asin-no-offers
    - Total offers: input#aod-total-offer-count
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

    if page is None:
        result["error"] = "No response from Amazon"
        return result

    # ── Check for no-offer indicators ──
    no_offers_el = page.css('#aod-asin-no-offers')
    if no_offers_el:
        return result

    # Check for no-offer phrases in the HTML text
    html_text = str(page.html_content) if hasattr(page, 'html_content') else str(page)
    html_lower = html_text.lower()
    for phrase in NO_OFFER_PHRASES:
        if phrase in html_lower:
            # Verify there's no actual price in AOD sections
            aod_prices = page.css('[id^="aod-price-"]')
            if not aod_prices:
                return result
            break

    # ── Extract product name ──
    name_els = page.css('#aod-asin-title-text')
    if name_els:
        name_text = name_els[0].text.strip() if hasattr(name_els[0], 'text') else ""
        if name_text:
            result["name"] = name_text

    # ── Extract product image ──
    img_els = page.css('#aod-asin-image-id')
    if img_els:
        src = img_els[0].attrib.get('src', '')
        if src and src.startswith('http'):
            result["image"] = src
    if not result["image"]:
        # Try finding any product image
        for img in page.css('img'):
            src = img.attrib.get('src', '')
            if src and 'images-amazon' in src and '/images/I/' in src:
                result["image"] = src
                break

    # ── Extract price from AOD ──
    # Strategy:
    # 1. Try #aod-price-0 (pinned offer - may not exist)
    # 2. Try #aod-price-1 (first offer in list)
    # 3. Try any [id^="aod-price-"]
    # For each: first try accessibility label, then visual parts

    extracted_price = None
    extracted_currency = default_currency

    # Find all price containers
    price_container = None

    # Try #aod-price-0 first (pinned offer)
    price_0_els = page.css('#aod-price-0')
    if price_0_els:
        price_container = price_0_els[0]

    # If no #aod-price-0, try #aod-price-1
    if not price_container:
        price_1_els = page.css('#aod-price-1')
        if price_1_els:
            price_container = price_1_els[0]

    # If still nothing, try any aod-price-N
    if not price_container:
        all_price_els = page.css('[id^="aod-price-"]')
        if all_price_els:
            price_container = all_price_els[0]

    if price_container:
        # Method 1: Accessibility label (MOST RELIABLE)
        # Contains clean price like "€10.63 with 24 percent savings" or "$29.99"
        acc_labels = price_container.css('span.aok-offscreen.apex-pricetopay-accessibility-label')
        if acc_labels:
            acc_text = acc_labels[0].text.strip() if hasattr(acc_labels[0], 'text') else ""
            if acc_text:
                parsed = parse_price_from_text(acc_text, default_currency)
                if parsed:
                    extracted_price = parsed["price"]
                    extracted_currency = parsed["currency"]
                    print(f"[Parse] Price from accessibility label: {extracted_price} {extracted_currency} (text: {acc_text[:80]})")

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

                    # Convert Arabic numerals
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
                                print(f"[Parse] Price from visual parts: {extracted_price} {extracted_currency} (symbol={symbol_text}, whole={whole_text}, frac={fraction_text})")
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
                        print(f"[Parse] Price from offscreen: {extracted_price} {extracted_currency} (text: {offscreen_text[:80]})")

    # Method 4: Try #aod-offer-list directly if no price yet
    if not extracted_price:
        offer_list_els = page.css('#aod-offer-list')
        if offer_list_els:
            offer_list = offer_list_els[0]
            # Try accessibility labels in offer list
            acc_labels = offer_list.css('span.aok-offscreen.apex-pricetopay-accessibility-label')
            if acc_labels:
                acc_text = acc_labels[0].text.strip()
                if acc_text:
                    parsed = parse_price_from_text(acc_text, default_currency)
                    if parsed:
                        extracted_price = parsed["price"]
                        extracted_currency = parsed["currency"]
                        print(f"[Parse] Price from offer list accessibility: {extracted_price} {extracted_currency}")

            # Try visual price parts in offer list
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
                                    print(f"[Parse] Price from offer list visual: {extracted_price} {extracted_currency}")
                            except ValueError:
                                pass

    # ── Build final result ──
    if extracted_price:
        result["price"] = extracted_price
        result["currency"] = extracted_currency
        result["priceDisplay"] = format_price_display(extracted_price, extracted_currency)
    else:
        # Check if there's any AOD structure at all
        has_aod_structure = bool(
            page.css('#aod-offer-list') or
            page.css('[id^="aod-price-"]') or
            page.css('#aod-pinned-offer')
        )
        if not has_aod_structure:
            result["error"] = "No AOD structure found (might be blocked or redirected)"

    return result

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FETCH AOD PAGE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def build_aod_url(asin: str, region_key: str) -> str:
    """Build the AOD AJAX URL for a given ASIN and region."""
    region = REGIONS.get(region_key, REGIONS["COM"])
    domain = region["domain"]
    url = f"https://www.{domain}/gp/product/ajax/aodAjaxMain/?asin={asin}"
    # Add postal code if configured
    if region.get("postal_code"):
        url += f"&pc={region['postal_code']}"
    return url


def fetch_aod_fetcher(url: str, region_key: str) -> object | None:
    """Fetch AOD page using Scrapling Fetcher (basic HTTP with anti-bot)."""
    try:
        region = REGIONS.get(region_key, REGIONS["COM"])
        domain = region["domain"]
        currency_cookie = region.get("currency_cookie", region["currency"])

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
            return page
        print(f"[Fetcher] Status {page.status} for {url}")
        return None
    except Exception as e:
        print(f"[Fetcher] Error fetching {url}: {e}")
        return None


def fetch_aod_stealth(url: str, region_key: str) -> object | None:
    """Fetch AOD page using Scrapling StealthyFetcher (Playwright with stealth)."""
    try:
        region = REGIONS.get(region_key, REGIONS["COM"])
        domain = region["domain"]

        page = StealthyFetcher.fetch(
            url,
            headless=True,
            disable_resources=True,
            timeout=60000,
        )
        if page and page.status == 200:
            return page
        print(f"[StealthyFetcher] Status {page.status} for {url}")
        return None
    except Exception as e:
        print(f"[StealthyFetcher] Error fetching {url}: {e}")
        return None

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# API ENDPOINTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@app.get("/scrape")
async def scrape_aod(
    asin: str = Query(..., description="Amazon ASIN (10 chars)"),
    region: str = Query("COM", description="Region key: COM, EG, DE, SA, AE"),
    method: str = Query("fetcher", description="Fetch method: fetcher or stealth"),
):
    """
    Scrape AOD prices for a given ASIN and region.
    Uses Scrapling library to bypass anti-bot measures.
    Prices come from AOD ONLY. If no offers -> N/A.
    """
    asin = asin.strip().upper()
    region = region.strip().upper()

    # Validate ASIN
    if not re.match(r'^[A-Z0-9]{10}$', asin):
        return JSONResponse(
            status_code=400,
            content={"error": f"Invalid ASIN format: {asin}"}
        )

    # Validate region
    if region not in REGIONS:
        return JSONResponse(
            status_code=400,
            content={"error": f"Invalid region: {region}. Must be one of: {', '.join(REGIONS.keys())}"}
        )

    url = build_aod_url(asin, region)
    print(f"[Scrape] Fetching AOD for {asin} on {region}: {url}")

    # Fetch the page
    page = None

    if method == "stealth":
        page = fetch_aod_stealth(url, region)
    else:
        page = fetch_aod_fetcher(url, region)

    # If Fetcher failed, try StealthyFetcher as fallback
    if page is None and method == "fetcher":
        print(f"[Scrape] Fetcher failed, trying StealthyFetcher for {asin} on {region}...")
        page = fetch_aod_stealth(url, region)

    if page is None:
        return JSONResponse(
            status_code=502,
            content={
                "domain": REGIONS[region]["domain"],
                "region": region,
                "name": f"Product {asin}",
                "image": "",
                "price": "N/A",
                "currency": REGIONS[region]["currency"],
                "priceDisplay": "N/A",
                "asin": asin,
                "error": "Failed to fetch AOD page from Amazon",
            }
        )

    # Parse the response
    result = parse_aod_response(page, region, asin)
    print(f"[Scrape] Result for {asin} on {region}: price={result['price']} display={result['priceDisplay']}")

    return JSONResponse(content=result)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "scrapling-aod-crawler"}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# RUN
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3035)
