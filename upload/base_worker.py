import re
from bs4 import BeautifulSoup
from parsel import Selector


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CURRENCY CONFIG
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CURRENCY_PATTERNS: list[tuple[str, str]] = [
    (r"US\s*\$", "USD"),
    (r"AU\s*\$", "AUD"),
    (r"C\s*\$", "CAD"),
    (r"MX\s*\$", "MXN"),
    (r"R\s*\$", "BRL"),
    (r"SG\s*\$", "SGD"),
    (r"HK\s*\$", "HKD"),
    (r"\$", "USD"),

    (r"EGP", "EGP"),
    (r"E£", "EGP"),
    (r"ج\.?\s*م", "EGP"),

    (r"SAR", "SAR"),
    (r"ر\.?\s*س", "SAR"),
    (r"ريال", "SAR"),

    (r"AED", "AED"),
    (r"د\.?\s*إ", "AED"),
    (r"درهم", "AED"),

    (r"€", "EUR"),
    (r"£", "GBP"),
    (r"¥", "JPY"),
    (r"￥", "CNY"),
    (r"₹", "INR"),
]

MARKETPLACE_CURRENCY: dict[str, str] = {
    "amazon.com": "USD",
    "amazon.eg": "EGP",
    "amazon.sa": "SAR",
    "amazon.ae": "AED",
    "amazon.co.uk": "GBP",
    "amazon.de": "EUR",
}

CURRENCY_SYMBOLS: dict[str, str] = {
    "USD": "$",
    "EUR": "€",
    "GBP": "£",
    "EGP": "EGP ",
    "SAR": "SAR ",
    "AED": "AED ",
    "JPY": "¥",
    "INR": "₹",
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEXT HELPERS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def clean_text(text: str | None) -> str:
    if not text:
        return ""

    text = text.replace("\xa0", " ")
    text = text.replace("\xc2\xa0", " ")
    text = text.translate(_ARABIC_DIGITS)
    text = text.replace("٫", ".")
    text = text.replace("٬", ",")

    return re.sub(r"\s+", " ", text).strip()


def clean_price(price_text: str):
    if not price_text:
        return None

    price_text = clean_text(price_text)

    currency_map = {
        "$": "USD",
        "€": "EUR",
        "£": "GBP",
        "AED": "AED",
        "SAR": "SAR",
        "EGP": "EGP",
    }

    currency = None

    for symbol, code in currency_map.items():
        if symbol in price_text:
            currency = code
            break

    numeric = re.findall(r"[\d,.]+", price_text)

    if not numeric:
        return None

    value = numeric[0].replace(",", "")

    return {
        "price": value,
        "currency": currency,
        "price_display": price_text,
    }


def format_price(price: str, currency: str) -> str:
    if price == "N/A":
        return "N/A"

    try:
        price_float = float(price)
        price = f"{price_float:,.2f}"
    except:
        pass

    symbol = CURRENCY_SYMBOLS.get(currency, currency + " ")

    return f"{symbol}{price}"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# HTML HELPERS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _get_html(response) -> str:
    if hasattr(response, 'text'):
        if isinstance(response.text, str) and len(response.text) > 50:
            return response.text

    if hasattr(response, 'body'):
        b = response.body
        if isinstance(b, str):
            return b
        if isinstance(b, bytes):
            return b.decode("utf-8", errors="ignore")

    if hasattr(response, 'content'):
        c = response.content
        if isinstance(c, str):
            return c
        if isinstance(c, bytes):
            return c.decode("utf-8", errors="ignore")

    return ""


def is_blocked(html: str, *, require_min_length: bool = True) -> bool:
    if not html:
        return True

    if require_min_length and len(html) < 1000:
        return True

    indicators = [
        "Robot Check",
        "Type the characters you see",
        "dp-recaptcha",
        "api-services-support@amazon.com",
    ]

    html_lower = html.lower()

    return any(x.lower() in html_lower for x in indicators)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PRODUCT INFO
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def extract_basic_info(response, asin: str) -> tuple[str, str]:
    html = _get_html(response)
    soup = BeautifulSoup(html, "html.parser")

    name = f"Product {asin}"
    image = ""

    title_el = soup.select_one("#productTitle") or soup.select_one("h1 span")

    if title_el:
        name = clean_text(title_el.text)

    img_el = soup.select_one("#landingImage") or soup.select_one("img.a-dynamic-image")

    if img_el:
        image = img_el.get("data-old-hires") or img_el.get("src") or ""

    return name, image


def extract_basic_info_aod(response, asin: str) -> tuple[str, str]:
    html = _get_html(response)
    soup = BeautifulSoup(html, "html.parser")

    name = f"Product {asin}"
    image = ""

    title_el = soup.select_one("h5#aod-asin-title-text")

    if title_el:
        name = clean_text(title_el.text)

    img_el = soup.select_one("img#aod-asin-image-id")

    if img_el:
        image = img_el.get("src", "")

    return name, image


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# AOD (All Offers Display) — price must come from buybox offers ONLY
# No fallback to main page, no ATC button, no alternative products
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_AOD_NO_OFFER_PHRASES = (
    "no featured offers available",
    "no other sellers matching your location",
    "currently unavailable",
    "keine empfohlenen angebote",
    "keine angebote verfügbar",
    "derzeit nicht verfügbar",
    "actuellement indisponible",
    "no hay ofertas destacadas",
    # Arabic variants
    "لا توجد عروض مميزة متاحة",
    "لا يوجد بائعون آخرون",
    "غير متوفر حالياً",
)

# Alternative product sections to EXCLUDE — these are NOT offers for this ASIN
_AOD_ALTERNATIVE_SELECTORS = (
    "#aod-asin-alternatives",
    ".aod-alternative-asin",
    "#aod-alternative-offers",
    "[id^='aod-alternative']",
    ".aod-alternatives-section",
)

# Only these scopes contain REAL buybox offers for the current ASIN
_AOD_OFFER_SCOPES = (
    "#aod-pinned-offer",
    "#aod-offer-list .aod-offer",
    '#aod-offer-list [id^="aod-offer-"]',
)


def _aod_selector(html: str) -> Selector:
    return Selector(text=html)


def _aod_has_alternative_products(html: str) -> bool:
    """Check if AOD contains alternative product sections (different ASINs)."""
    sel = _aod_selector(html)
    for alt_sel in _AOD_ALTERNATIVE_SELECTORS:
        if sel.css(alt_sel).get():
            return True
    return False


def _aod_text_contains_no_offer(text: str) -> bool:
    """Check if text contains any 'no offer' phrases."""
    text_lower = text.lower()
    for phrase in _AOD_NO_OFFER_PHRASES:
        if phrase in text_lower:
            return True
    return False


def aod_has_offers(html: str) -> bool:
    """True only when AOD contains a real buybox/offer row for this ASIN.
    
    Returns False if:
    - Page is blocked/empty
    - No-offer indicators are present
    - No actual offer price elements exist in buybox scopes
    - Only alternative products are shown (different ASINs)
    """
    if not html or is_blocked(html, require_min_length=False):
        return False

    sel = _aod_selector(html)

    # ── Check 1: Explicit "no offer" containers ──
    if sel.css(
        "#aod-asin-no-offers, #aod-no-offer, "
        "#aod-unqualified-no-offer, #aod-olp-no-offer-bar"
    ).get():
        return False

    # ── Check 2: "No offer" phrases in the AOD container text ──
    container_html = (
        sel.css("#aod-container").get()
        or sel.css("#aod-sticky-pinned-container").get()
        or sel.css("#aod-pinned-offer-wrapper").get()
    )
    if container_html:
        container_text = clean_text(
            " ".join(_aod_selector(container_html).css("::text").getall())
        )
        if _aod_text_contains_no_offer(container_text):
            return False

    # ── Check 3: Verify real offer price exists INSIDE buybox scopes ──
    # Must find a price element inside #aod-pinned-offer or #aod-offer-list
    # NOT inside alternative product sections
    has_pinned_price = sel.css(
        "#aod-pinned-offer .a-price, "
        "#aod-pinned-offer #aod-offer-price .a-price"
    ).get()

    has_list_price = sel.css(
        "#aod-offer-list .aod-offer .a-price, "
        '#aod-offer-list [id^="aod-offer-"] .a-price'
    ).get()

    if not has_pinned_price and not has_list_price:
        # No price in any buybox offer scope → no real offer
        return False

    # ── Check 4: Verify offer row exists (not just price text floating) ──
    offer_row = sel.css(
        "#aod-pinned-offer #aod-offer-price, "
        "#aod-offer-list .aod-offer, "
        '#aod-offer-list [id^="aod-offer-"]'
    ).get()

    if not offer_row:
        return False

    # ── Check 5: Extra safety — verify pinned offer is not a "see more" stub ──
    pinned_section = sel.css("#aod-pinned-offer").get()
    if pinned_section and not has_pinned_price:
        # Pinned section exists but has no price → might be an empty stub
        # Only pass if offer-list has a real price
        if not has_list_price:
            return False

    return True


def _parse_decimal_price(text: str, currency: str = "USD") -> dict | None:
    text = clean_text(text)
    if not text:
        return None

    # German/European comma decimal: 9,49 €
    m = re.search(r"(\d{1,3}(?:\.\d{3})*),(\d{2})\s*(?:€|EUR)?", text)
    if m:
        whole = m.group(1).replace(".", "")
        return {"price": f"{whole}.{m.group(2)}", "currency": currency or "EUR", "price_display": text}

    result = clean_price(text)
    return result


def _extract_scoped_aod_price(sel: Selector, scope: str, currency: str) -> dict | None:
    """Extract price only inside a single AOD offer scope.
    
    IMPORTANT: No ATC button fallback — ATC aria-labels can contain
    prices from alternative products or stale data.
    Only extracts from explicit price elements within the offer.
    """
    # ── Method 1: Explicit price-to-pay label ──
    for css in (
        f"{scope} span[data-pricetopay-label]::text",
        f"{scope} .a-price .a-offscreen::text",
        f"{scope} #aod-price-0 .a-offscreen::text",
    ):
        raw = sel.css(css).get()
        if raw and raw.strip():
            parsed = _parse_decimal_price(raw.strip(), currency)
            if parsed:
                return {
                    "price": parsed["price"],
                    "currency": parsed.get("currency") or currency,
                    "price_display": parsed.get("price_display") or raw.strip(),
                }

    # ── Method 2: Whole + fraction + symbol parts ──
    whole = sel.css(f"{scope} .a-price-whole::text").get()
    if whole:
        fraction = sel.css(f"{scope} .a-price-fraction::text").get() or "00"
        symbol = sel.css(f"{scope} .a-price-symbol::text").get() or ""
        w = whole.strip().rstrip(".").rstrip(",").replace(".", "").replace(",", "")
        f = fraction.strip()
        price = f"{w}.{f}"
        display = f"{symbol}{whole.strip()}{fraction.strip() if fraction else ''}".strip()
        return {
            "price": price,
            "currency": currency,
            "price_display": display or format_price(price, currency),
        }

    # ── NO ATC BUTTON FALLBACK ──
    # Previously: we extracted price from input[name="submit.addToCart"] aria-label
    # This was REMOVED because ATC buttons can contain prices from:
    # - Alternative products shown in AOD bottom section
    # - Stale or incorrect pricing data
    # - Products the user didn't search for

    return None


def extract_price_aod(response, currency: str = "EUR") -> dict:
    """Price from AOD buybox offers ONLY.
    
    Returns N/A if:
    - Page is blocked
    - No real offer exists (aod_has_offers == False)
    - No price found inside buybox offer scopes
    - Only alternative products are shown
    
    Does NOT fall back to main product page.
    Does NOT read alternative product prices.
    Does NOT use ATC button prices.
    """
    html = _get_html(response)

    if is_blocked(html, require_min_length=False) or not aod_has_offers(html):
        return {"price": "N/A", "currency": currency, "price_display": "N/A"}

    sel = _aod_selector(html)

    # ── Extract from buybox scopes only ──
    # Scopes are limited to #aod-pinned-offer and #aod-offer-list
    # which only contain offers for THIS ASIN, not alternative products
    for scope in _AOD_OFFER_SCOPES:
        result = _extract_scoped_aod_price(sel, scope, currency)
        if result:
            result["currency"] = result.get("currency") or currency
            if result["price"] != "N/A":
                result["price_display"] = format_price(result["price"], result["currency"])
            return result

    return {"price": "N/A", "currency": currency, "price_display": "N/A"}
