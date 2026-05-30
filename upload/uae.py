from scrapling.fetchers import AsyncFetcher
from .base_worker import (
    MARKETPLACE_CURRENCY, extract_basic_info, extract_basic_info_aod,
    extract_price_aod, is_blocked, _get_html, format_price
)

async def scrape_ae(asin: str):
    domain = "amazon.ae"
    currency = MARKETPLACE_CURRENCY.get(domain, "AED")

    main_url = f"https://www.{domain}/dp/{asin}/?language=en_US&currency={currency}"
    aod_url = (
        f"https://www.{domain}/gp/product/ajax/aodAjaxMain/"
        f"?asin={asin}&m=&pcid=&offeringID="
        f"&filters=%7B%22all%22%3Atrue%7D&experienceId=aodAjaxMain"
    )

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": main_url,
        "Cookie": f"i18n-prefs=AED; lc-main=en_US",
    }

    try:
        name = f"Product {asin}"
        image = ""

        main_res = await AsyncFetcher.get(main_url, timeout=30000, headers=headers)
        if main_res.status == 200:
            html = _get_html(main_res)
            if not is_blocked(html):
                name, image = extract_basic_info(main_res, asin)

        price_data = {"price": "N/A", "currency": currency, "price_display": "N/A"}
        aod_res = await AsyncFetcher.get(aod_url, timeout=60000, headers=headers)
        if aod_res.status == 200:
            aod_html = _get_html(aod_res)
            if not is_blocked(aod_html, require_min_length=False):
                price_data = extract_price_aod(aod_res, currency)
                if price_data["price"] != "N/A":
                    n, i = extract_basic_info_aod(aod_res, asin)
                    if n != f"Product {asin}":
                        name = n
                    if i:
                        image = i

        price_data["currency"] = currency
        if price_data["price"] != "N/A":
            price_data["price_display"] = format_price(price_data["price"], currency)

        return [{
            "domain": domain, "name": name, "image": image,
            "price": price_data["price"], "currency": price_data["currency"],
            "price_display": price_data["price_display"],
            "is_main": True, "ASIN": asin,
        }]

    except Exception as e:
        print(f"[Worker AE] Error: {e}")
    return []