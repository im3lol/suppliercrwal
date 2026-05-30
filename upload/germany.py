from scrapling.fetchers import AsyncFetcher
import httpx
from .base_worker import (
    MARKETPLACE_CURRENCY,
    extract_basic_info,
    extract_basic_info_aod,
    extract_price_aod,
    is_blocked,
    _get_html,
    format_price,
)


CRAWLEO_API_KEY = "sk_3bc649fd_27bf05dac0eefed97f0312200ee986e587db69f235677d5289f0e1d683c5efe4"
CRAWLEO_API_URL = "https://api.crawleo.dev/crawl"


async def scrape_de(asin: str):
    domain = "amazon.de"
    currency = MARKETPLACE_CURRENCY.get(domain, "EUR")
    postal_code = "80331"

    main_url = (
        f"https://www.{domain}/dp/{asin}/"
        f"?language=en_US&currency={currency}"
        f"&postalCode={postal_code}"
    )

    aod_url = (
        f"https://www.{domain}/gp/product/ajax/aodAjaxMain/"
        f"?asin={asin}&m=&pcid=&offeringID="
        f"&filters=%7B%22all%22%3Atrue%7D&experienceId=aodAjaxMain"
    )

    try:
        name = f"Product {asin}"
        image = ""

        main_res = await AsyncFetcher.get(
            main_url,
            timeout=30000,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": main_url,
                "Cookie": "i18n-prefs=EUR; lc-main=en_US; sp-cdn=sp-cdn-on",
            },
        )

        if main_res.status == 200:
            html = _get_html(main_res)
            if not is_blocked(html):
                name, image = extract_basic_info(main_res, asin)

        price_data = {
            "price": "N/A",
            "currency": currency,
            "price_display": "N/A",
        }

        async with httpx.AsyncClient() as crawleo_client:
            resp = await crawleo_client.get(
                CRAWLEO_API_URL,
                params={
                    "urls": aod_url,
                    "render_js": "false",
                    "raw_html": "true",
                    "enhanced_html": "false",
                    "page_text": "false",
                    "markdown": "false",
                    "screenshot": "false",
                    "screenshot_full_page": "false",
                },
                headers={
                    "x-api-key": CRAWLEO_API_KEY,
                    "Accept": "application/json",
                },
                timeout=60.0,
            )

            if resp.status_code == 200:
                data = resp.json()
                results = data.get("results", [])

                if results and results[0].get("status_code") == 200:
                    aod_html = results[0].get("raw_html", "")

                    if aod_html and not is_blocked(aod_html, require_min_length=False):
                        class _FakeRes:
                            def __init__(self, text):
                                self.text = text

                        fake = _FakeRes(aod_html)
                        price_data = extract_price_aod(fake, currency)

                        if price_data["price"] != "N/A":
                            n, i = extract_basic_info_aod(fake, asin)
                            if n and n != f"Product {asin}":
                                name = n
                            if i:
                                image = i

        if price_data["price"] != "N/A":
            price_data["price_display"] = format_price(price_data["price"], currency)

        return [{
            "domain": domain,
            "name": name,
            "image": image,
            "price": price_data["price"],
            "currency": price_data["currency"],
            "price_display": price_data["price_display"],
            "is_main": True,
            "ASIN": asin,
        }]

    except Exception as e:
        print(f"[Worker DE] Error: {e}")

    return []
