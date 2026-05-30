import asyncio
from typing import List
from pydantic import BaseModel

from workers.egypt import scrape_eg
from workers.usa import scrape_com
from workers.saudi import scrape_sa
from workers.uae import scrape_ae
from workers.germany import scrape_de


class ProductOffer(BaseModel):
    domain: str
    name: str
    image: str
    price: str
    currency: str = "USD"
    price_display: str = "N/A"
    is_main: bool = False
    ASIN: str = ""


class ScrapeRequest(BaseModel):
    asin: str


async def crew_scrape(asin: str) -> List[ProductOffer]:
    """
    Scrape ONE ASIN across all domains in parallel.
    """

    tasks = [
        scrape_eg(asin),
        scrape_com(asin),
        scrape_sa(asin),
        scrape_ae(asin),
        scrape_de(asin),
    ]

    all_results = await asyncio.gather(*tasks)

    flat_results = []

    for sublist in all_results:
        for item in sublist:

            if isinstance(item, dict):
                flat_results.append(ProductOffer(**item))
            else:
                flat_results.append(item)

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # GLOBAL NAME + IMAGE RESOLUTION
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    fallback_name = f"Product {asin}"

    best_name = fallback_name
    best_image = ""

    for r in flat_results:

        if (
            r.name
            and r.name != fallback_name
            and len(r.name) > len(best_name)
        ):
            best_name = r.name

        if r.image and not best_image:
            best_image = r.image

    # apply globally

    for r in flat_results:

        if r.name == fallback_name and best_name != fallback_name:
            r.name = best_name

        if not r.image and best_image:
            r.image = best_image

    return flat_results


async def crew_scrape_bulk(asins: List[str]) -> List[ProductOffer]:
    """
    Sequential bulk scraping.
    ONE PRODUCT AT A TIME.
    """

    all_results = []

    for i, asin in enumerate(asins):

        print(f"[Bulk] Processing {i+1}/{len(asins)}: {asin}")

        try:
            results = await crew_scrape(asin)

            all_results.extend(results)

        except Exception as e:
            print(f"[Bulk] Error for {asin}: {e}")

        # delay between products

        if i < len(asins) - 1:

            delay = 5

            print(f"[Bulk] Waiting {delay}s before next product...")

            await asyncio.sleep(delay)

    return all_results