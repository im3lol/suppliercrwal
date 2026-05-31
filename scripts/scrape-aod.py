#!/usr/bin/env python3
"""
Amazon AOD Price Scraper — Using Scrapling + AOD AJAX Endpoint

ALL prices come from AOD (All Offers Display) ONLY.
Uses the AOD AJAX endpoint: /gp/product/ajax/aodAjaxMain/?asin={ASIN}
No browser needed — pure HTTP request with Scrapling anti-bot headers.

CRITICAL RULES:
- Prices MUST come from #aod-offer-list or #aod-pinned-offer ONLY
- NO fallback to main page prices
- NO alternative/recommended product prices
- If AOD has no offers → return "N/A"
"""

import sys
import json
import re

try:
    from scrapling import Fetcher
except ImportError:
    print(json.dumps({"success": False, "error": "scrapling not installed"}))
    sys.exit(1)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# REGION CONFIG
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REGIONS = {
    "COM": {
        "domain": "amazon.com",
        "currency": "USD",
        "cookie_currency": "USD",
        "postal_code": "99950",
    },
    "EG": {
        "domain": "amazon.eg",
        "currency": "EGP",
        "cookie_currency": "EGP",
    },
    "DE": {
        "domain": "amazon.de",
        "currency": "EUR",
        "cookie_currency": "EUR",
        "postal_code": "80331",
    },
    "SA": {
        "domain": "amazon.sa",
        "currency": "SAR",
        "cookie_currency": "SAR",
    },
    "AE": {
        "domain": "amazon.ae",
        "currency": "AED",
        "cookie_currency": "AED",
    },
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
# HELPERS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def convert_arabic_numerals(text):
    """Convert Arabic-Indic digits to Western digits."""
    result = []
    for c in text:
        code = ord(c)
        if 0x0660 <= code <= 0x0669:
            result.append(str(code - 0x0660))
        elif c == '\u066b':  # Arabic decimal separator
            result.append('.')
        elif c == '\u066c':  # Arabic thousands separator
            result.append(',')
        else:
            result.append(c)
    return ''.join(result)


def clean_text(text):
    """Clean text: convert Arabic numerals, strip whitespace."""
    if not text:
        return ""
    text = convert_arabic_numerals(text)
    text = text.replace('\xa0', ' ').replace('\u00a0', ' ')
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def format_price(price_str, currency):
    """Format price for display."""
    if price_str == "N/A":
        return "N/A"
    try:
        num = float(price_str)
        if not isNaN(num):
            symbol = CURRENCY_SYMBOLS.get(currency, currency + " ")
            return f"{symbol}{num:,.2f}"
    except:
        pass
    return price_str


def isNaN(v):
    return v != v  # Python NaN check


def parse_price_from_parts(symbol_text, whole_text, fraction_text, default_currency):
    """Parse price from symbol + whole + fraction parts.
    
    This matches the AOD HTML structure:
    <span class="a-price-symbol">$</span>
    <span class="a-price-whole">29<span class="a-price-decimal">.</span></span>
    <span class="a-price-fraction">99</span>
    """
    symbol = clean_text(symbol_text) if symbol_text else ""
    whole = clean_text(whole_text) if whole_text else ""
    fraction = clean_text(fraction_text) if fraction_text else ""

    # Remove decimal separator from whole (e.g., "29." -> "29")
    whole = whole.replace('.', '').replace(',', '').strip()
    fraction = fraction.strip()

    if not whole or not whole.isdigit():
        return None

    if not fraction:
        fraction = "00"

    price_num = f"{whole}.{fraction}"

    # Detect currency from symbol
    currency_map = {
        '$': 'USD',
        '\u20ac': 'EUR',
        '\u00a3': 'GBP',
        'EGP': 'EGP',
        'SAR': 'SAR',
        'AED': 'AED',
        'HKD': 'HKD',
        'USD': 'USD',
        'EUR': 'EUR',
    }

    currency = default_currency
    for sym, code in currency_map.items():
        if sym in symbol:
            currency = code
            break

    try:
        val = float(price_num)
        if val > 0:
            return {"price": price_num, "currency": currency}
    except:
        pass

    return None


def parse_price_from_apex(apex_text, default_currency):
    """Parse price from apex-pricetopay-accessibility-label text.
    
    Examples:
      "$29.99"
      "$20.25 with 12 percent savings"
      "HKD 158.70 with 12 percent savings"
      "€8.93"
      "EGP 280.00"
    """
    text = clean_text(apex_text)
    if not text:
        return None

    # Remove "with X percent savings" suffix
    text = re.sub(r'\s+with\s+.*$', '', text)

    # Currency detection
    currency_map = {
        '$': 'USD',
        '\u20ac': 'EUR',
        '\u00a3': 'GBP',
        'EGP': 'EGP',
        'SAR': 'SAR',
        'AED': 'AED',
        'HKD': 'HKD',
        'USD': 'USD',
        'EUR': 'EUR',
    }

    currency = default_currency
    for sym, code in currency_map.items():
        if sym in text:
            currency = code
            break

    # German/European format: "9,49 €" → 9.49
    euro_match = re.match(r'(\d{1,3}(?:\.\d{3})*),(\d{2})', text)
    if euro_match and currency == 'EUR':
        whole = euro_match.group(1).replace('.', '')
        return {"price": f"{whole}.{euro_match.group(2)}", "currency": currency}

    # Standard: extract number
    num_match = re.search(r'([\d,]+\.?\d*)', text)
    if num_match:
        num_str = num_match.group(1).replace(',', '')
        try:
            val = float(num_str)
            if val > 0:
                return {"price": num_str, "currency": currency}
        except:
            pass

    return None


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# AOD SCRAPER
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def scrape_aod(asin, region_key):
    """Scrape AOD for a single ASIN on a single region using Scrapling."""
    
    region = REGIONS.get(region_key)
    if not region:
        return {
            "domain": "",
            "region": region_key,
            "name": f"Product {asin}",
            "image": "",
            "price": "N/A",
            "currency": "",
            "priceDisplay": "N/A",
            "asin": asin,
            "error": "Unknown region",
        }

    domain = region["domain"]
    default_currency = region["currency"]
    
    result = {
        "domain": domain,
        "region": region_key,
        "name": f"Product {asin}",
        "image": "",
        "price": "N/A",
        "currency": default_currency,
        "priceDisplay": "N/A",
        "asin": asin,
    }

    try:
        # Build AOD AJAX URL
        aod_url = f"https://www.{domain}/gp/product/ajax/aodAjaxMain/?asin={asin}"
        
        # Set cookies for currency and language
        cookies = {
            'i18n-prefs': region['cookie_currency'],
            'lc-main': 'en_US',
        }
        
        # Add postal code cookie if specified
        if region.get('postal_code'):
            cookies['sp-cdn'] = f'lc-main=en_US; postalCode={region["postal_code"]}'

        fetcher = Fetcher()
        response = fetcher.get(aod_url, cookies=cookies)

        if response.status != 200:
            result["error"] = f"HTTP {response.status}"
            return result

        # ── Check for no offers ──
        no_offer_texts = [
            'No featured offers available',
            'no featured offers',
            'currently unavailable',
            'keine empfohlenen angebote',
            'keine angebote',
            'derzeit nicht verfügbar',
            'لا توجد عروض مميزة',
            'غير متوفر حالياً',
        ]
        
        # Check in the pinned offer section specifically
        pinned_section = response.css('#aod-pinned-offer')
        sticky_section = response.css('#aod-sticky-pinned-offer')
        
        for section in [sticky_section, pinned_section]:
            if section:
                section_text = section[0].text.lower() if section[0].text else ''
                for phrase in no_offer_texts:
                    if phrase.lower() in section_text:
                        # "No featured offers" in pinned section means no pinned offer,
                        # but there might still be offers in the offer list
                        # Check if offer list exists with prices
                        offer_list = response.css('#aod-offer-list')
                        if offer_list:
                            offer_prices = offer_list[0].css('.a-price-whole')
                            if not offer_prices:
                                result["error"] = "No offers available"
                                return result
                        break

        # ── Extract product name ──
        name_el = response.css('#aod-asin-title-text')
        if name_el:
            name = clean_text(name_el[0].text)
            if name:
                result["name"] = name

        # ── Extract product image ──
        img_el = response.css('#aod-asin-image-id')
        if img_el:
            src = img_el[0].attrib.get('src', '')
            if src and src.startswith('http'):
                result["image"] = src

        # ── Extract price from AOD offer list ──
        # Priority: offer list first (sorted by price+delivery), then pinned offer
        
        price_data = None
        
        # Method 1: Try apex-pricetopay-accessibility-label (most reliable)
        # These are inside #aod-offer-list or #aod-pinned-offer
        offer_list = response.css('#aod-offer-list')
        if offer_list:
            apex_labels = offer_list[0].css('.apex-pricetopay-accessibility-label')
            if apex_labels:
                # First price in offer list = lowest price (sorted by price+delivery)
                for label in apex_labels:
                    parsed = parse_price_from_apex(label.text, default_currency)
                    if parsed:
                        price_data = parsed
                        break

        # Method 2: Try a-price-symbol + a-price-whole + a-price-fraction
        if not price_data and offer_list:
            symbols = offer_list[0].css('.a-price-symbol')
            wholes = offer_list[0].css('.a-price-whole')
            fractions = offer_list[0].css('.a-price-fraction')
            
            if symbols and wholes and fractions:
                # Find the first valid price in the offer list
                for i in range(min(len(symbols), len(wholes), len(fractions))):
                    parsed = parse_price_from_parts(
                        symbols[i].text, wholes[i].text, fractions[i].text, default_currency
                    )
                    if parsed:
                        price_data = parsed
                        break

        # Method 3: Try pinned offer price
        if not price_data and pinned_section:
            # Try apex label in pinned section
            pinned_apex = pinned_section[0].css('.apex-pricetopay-accessibility-label')
            if pinned_apex:
                for label in pinned_apex:
                    parsed = parse_price_from_apex(label.text, default_currency)
                    if parsed:
                        price_data = parsed
                        break

            # Try parts in pinned section
            if not price_data:
                pinned_symbols = pinned_section[0].css('.a-price-symbol')
                pinned_wholes = pinned_section[0].css('.a-price-whole')
                pinned_fractions = pinned_section[0].css('.a-price-fraction')
                
                if pinned_symbols and pinned_wholes and pinned_fractions:
                    for i in range(min(len(pinned_symbols), len(pinned_wholes), len(pinned_fractions))):
                        parsed = parse_price_from_parts(
                            pinned_symbols[i].text, pinned_wholes[i].text,
                            pinned_fractions[i].text, default_currency
                        )
                        if parsed:
                            price_data = parsed
                            break

        # Method 4: Try ATC button aria-label (contains price info)
        if not price_data:
            atc_buttons = response.css('input[name="submit.addToCart"]')
            for btn in atc_buttons:
                aria_label = btn.attrib.get('aria-label', '')
                if 'price' in aria_label.lower():
                    # Pattern: "Add to Cart from seller XXX and price $29.99"
                    price_match = re.search(
                        r'price\s+([€$£]|EGP|SAR|AED|USD|EUR|HKD)?\s*([\d,]+\.?\d*)',
                        aria_label, re.IGNORECASE
                    )
                    if price_match:
                        sym = price_match.group(1) or ''
                        raw_price = price_match.group(2).replace(',', '')
                        try:
                            val = float(raw_price)
                            if val > 0:
                                # Detect currency from symbol
                                currency = default_currency
                                sym_map = {
                                    '$': 'USD', '\u20ac': 'EUR', '\u00a3': 'GBP',
                                    'EGP': 'EGP', 'SAR': 'SAR', 'AED': 'AED',
                                }
                                for s, c in sym_map.items():
                                    if s in sym:
                                        currency = c
                                        break
                                price_data = {"price": raw_price, "currency": currency}
                                break
                        except:
                            pass

        # ── Build result ──
        if price_data:
            result["price"] = price_data["price"]
            result["currency"] = price_data["currency"]
            result["priceDisplay"] = format_price(price_data["price"], price_data["currency"])
        else:
            # Check if there's truly no offers
            offer_count_el = response.css('#aod-total-offer-count')
            has_offers = False
            if offer_count_el:
                count = offer_count_el[0].attrib.get('value', '0')
                try:
                    has_offers = int(count) > 0
                except:
                    pass
            
            if not has_offers:
                result["price"] = "N/A"
                result["priceDisplay"] = "N/A"
            else:
                # There are offers but we couldn't extract price
                result["price"] = "N/A"
                result["priceDisplay"] = "N/A"
                result["error"] = "Could not extract price from AOD"

    except Exception as e:
        result["error"] = str(e)

    return result


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# MAIN
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: scrape-aod.py ASIN REGION1,REGION2,..."}))
        sys.exit(1)

    asin = sys.argv[1].strip().upper()
    region_keys = [r.strip().upper() for r in sys.argv[2].split(",")]

    results = []
    for region_key in region_keys:
        if region_key not in REGIONS:
            results.append({
                "domain": "",
                "region": region_key,
                "name": f"Product {asin}",
                "image": "",
                "price": "N/A",
                "currency": "",
                "priceDisplay": "N/A",
                "asin": asin,
                "error": "Unknown region",
            })
            continue

        data = scrape_aod(asin, region_key)
        results.append(data)

    output = {
        "success": True,
        "asin": asin,
        "data": results,
    }

    print(json.dumps(output, ensure_ascii=False))
