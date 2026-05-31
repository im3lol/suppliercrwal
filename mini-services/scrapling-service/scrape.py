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
    "COM": {"domain": "amazon.com",  "currency": "USD"},
    "EG":  {"domain": "amazon.eg",   "currency": "EGP"},
    "DE":  {"domain": "amazon.de",   "currency": "EUR"},
    "SA":  {"domain": "amazon.sa",   "currency": "SAR"},
    "AE":  {"domain": "amazon.ae",   "currency": "AED"},
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
    return text.translate(ARABIC_DIGITS)

def convert_arabic_decimal(text):
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

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CRAWLEO API FETCH
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRAWLEO_API_URL = "https://api.crawleo.dev/crawl"

def fetch_with_crawleo(url, api_key, max_retries=2):
    """Fetch AOD page using Crawleo API with retry logic."""
    encoded_url = urllib.parse.quote(url, safe='')
    api_url = f"{CRAWLEO_API_URL}?url={encoded_url}"

    for attempt in range(max_retries + 1):
        try:
            if attempt > 0:
                print(f"[Crawleo] Retry attempt {attempt} for: {url}", file=sys.stderr)
                import time
                time.sleep(1 * attempt)
            else:
                print(f"[Crawleo] Fetching: {url}", file=sys.stderr)

            req = urllib.request.Request(
                api_url,
                headers={"x-api-key": api_key}
            )

            with urllib.request.urlopen(req, timeout=60) as response:
                data = json.loads(response.read().decode('utf-8'))

                if not data.get("results") or len(data["results"]) == 0:
                    print(f"[Crawleo] No results returned", file=sys.stderr)
                    if attempt < max_retries:
                        continue
                    return None

                result = data["results"][0]
                status_code = result.get("status_code", 0)
                if status_code != 200:
                    print(f"[Crawleo] Page status: {status_code}", file=sys.stderr)
                    if attempt < max_retries:
                        continue
                    return None

                markdown = result.get("markdown", "")
                enhanced_html = result.get("enhanced_html", "")
                credits = data.get("credits", 0)

                print(f"[Crawleo] Success! Credits used: {credits}", file=sys.stderr)
                return {"markdown": markdown, "enhanced_html": enhanced_html}

        except Exception as e:
            print(f"[Crawleo] Error (attempt {attempt + 1}/{max_retries + 1}): {e}", file=sys.stderr)
            if attempt < max_retries:
                continue
            return None

    return None

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PRICE PARSING FROM CRAWLEO MARKDOWN
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def parse_price_from_crawleo(markdown, enhanced_html, region_key):
    """
    Parse price from Crawleo markdown response.

    Price patterns by region:
      DE: "10,63 \u20ac mit 24 Prozent Einsparungen" or "10,63\u20ac"
      COM: "$20.25" or "$20.25 with ..."
      SA: "SAR 113.38" or "SAR113.38"
      AE: "AED 76.38" or "AED76.38"
      EG: "EGP 150.00" or "EGP150.00" or Arabic numerals
    """
    region = REGIONS.get(region_key, REGIONS["COM"])
    default_currency = region["currency"]

    # Convert Arabic numerals
    md = convert_arabic_numerals(markdown)
    md = convert_arabic_decimal(md)
    html = convert_arabic_numerals(enhanced_html)
    html = convert_arabic_decimal(html)

    # Check for no-offer indicators
    lower_md = md.lower()
    for phrase in NO_OFFER_PHRASES:
        if phrase.lower() in lower_md:
            return {"price": "N/A", "currency": default_currency, "name": "", "image": ""}

    # Extract product name (first heading in markdown, before ratings)
    name = ""
    name_match = re.match(r'^#{1,5}\s+(.+?)(?:\n|$)', md)
    if name_match:
        raw_name = name_match.group(1).strip()
        # Truncate at rating patterns
        rating_cut = re.match(
            r'^(.+?)(?:\s+\d+[.,]\d+\s+(?:von|out of)\s+5\s+(?:Sternen|stars)|\s+\d+\s+(?:Sternebewertungen|ratings))',
            raw_name
        )
        if rating_cut:
            name = rating_cut.group(1).strip()
        else:
            name = raw_name[:200].strip()

    # Extract product image from HTML
    image = ""
    img_match = re.search(r'src=["\']?(https?://[^"\'>\s]*images-amazon[^"\'>\s]*/images/I/[^"\'>\s]+)', html)
    if img_match:
        image = img_match.group(1)

    # ── Price extraction strategies ──

    # Strategy 1: Price with savings text (German/European format)
    # "10,63 \u20ac mit 24 Prozent Einsparungen"
    euro_savings_match = re.search(r'(\d{1,3}(?:\.\d{3})?),(\d{2})\s*\u20ac\s+mit\s+\d+', md)
    if euro_savings_match:
        whole = euro_savings_match.group(1).replace(".", "")
        frac = euro_savings_match.group(2)
        return {"price": f"{whole}.{frac}", "currency": "EUR", "name": name, "image": image}

    # Strategy 2: "10,63\u20ac" format (compact, no space)
    euro_compact_match = re.search(r'(\d{1,3}(?:\.\d{3})?),(\d{2})\s*\u20ac', md)
    if euro_compact_match:
        whole = euro_compact_match.group(1).replace(".", "")
        frac = euro_compact_match.group(2)
        return {"price": f"{whole}.{frac}", "currency": "EUR", "name": name, "image": image}

    # Strategy 3: "\u20ac10.63" or "\u20ac10,63" format
    euro_prefix_match = re.search(r'\u20ac\s*(\d{1,3}(?:[,.\s]\d{3})*?)[.,](\d{2})', md)
    if euro_prefix_match:
        whole = euro_prefix_match.group(1).replace(",", "").replace(".", "").replace(" ", "")
        frac = euro_prefix_match.group(2)
        return {"price": f"{whole}.{frac}", "currency": "EUR", "name": name, "image": image}

    # Strategy 4: SAR price "SAR 113.38" or "SAR113.38"
    sar_match = re.search(r'SAR\s*(\d{1,3}(?:[,.\s]\d{3})*?)[.,](\d{2})', md)
    if sar_match:
        whole = sar_match.group(1).replace(",", "").replace(".", "").replace(" ", "")
        frac = sar_match.group(2)
        return {"price": f"{whole}.{frac}", "currency": "SAR", "name": name, "image": image}

    # Strategy 5: AED price "AED 76.38" or "AED76.38"
    aed_match = re.search(r'AED\s*(\d{1,3}(?:[,.\s]\d{3})*?)[.,](\d{2})', md)
    if aed_match:
        whole = aed_match.group(1).replace(",", "").replace(".", "").replace(" ", "")
        frac = aed_match.group(2)
        return {"price": f"{whole}.{frac}", "currency": "AED", "name": name, "image": image}

    # Strategy 6: EGP price "EGP 150.00" or "EGP150.00"
    egp_match = re.search(r'EGP\s*(\d{1,3}(?:[,.\s]\d{3})*?)[.,](\d{2})', md)
    if egp_match:
        whole = egp_match.group(1).replace(",", "").replace(".", "").replace(" ", "")
        frac = egp_match.group(2)
        return {"price": f"{whole}.{frac}", "currency": "EGP", "name": name, "image": image}

    # Strategy 7: USD price "$20.25" or "$ 20.25"
    usd_match = re.search(r'\$\s*(\d{1,3}(?:[,.\s]\d{3})*?)[.,](\d{2})', md)
    if usd_match:
        whole = usd_match.group(1).replace(",", "").replace(".", "").replace(" ", "")
        frac = usd_match.group(2)
        return {"price": f"{whole}.{frac}", "currency": "USD", "name": name, "image": image}

    # Strategy 8: "with X percent savings" pattern
    savings_match = re.search(r'(\d{1,3}(?:[,.\s]\d{3})*?)[.,](\d{2})\s+with\s+\d+\s+percent\s+savings', md)
    if savings_match:
        whole = savings_match.group(1).replace(",", "").replace(".", "").replace(" ", "")
        frac = savings_match.group(2)
        return {"price": f"{whole}.{frac}", "currency": default_currency, "name": name, "image": image}

    # Strategy 9: Generic price pattern
    generic_match = re.search(r'(\d{1,3}(?:[,.\s]\d{3})*?)[.,](\d{2})', md)
    if generic_match:
        whole = generic_match.group(1).replace(",", "").replace(".", "").replace(" ", "")
        frac = generic_match.group(2)
        price_val = float(f"{whole}.{frac}")
        if price_val > 0:
            return {"price": f"{whole}.{frac}", "currency": default_currency, "name": name, "image": image}

    return {"price": "N/A", "currency": default_currency, "name": name, "image": image}

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

    # Build AOD URL (no postal code - Crawleo handles geo-targeting)
    url = f"https://www.{domain}/gp/product/ajax/aodAjaxMain/?asin={asin}"

    print(f"[Scrape] Fetching AOD for {asin} on {region_key} via Crawleo: {url}", file=sys.stderr)

    # Fetch via Crawleo API
    crawleo_result = fetch_with_crawleo(url, crawleo_api_key)

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

    # Parse the Crawleo response
    parsed = parse_price_from_crawleo(
        crawleo_result["markdown"],
        crawleo_result["enhanced_html"],
        region_key
    )

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
