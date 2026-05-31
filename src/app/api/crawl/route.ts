import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { crawlRegion, REGIONS } from '@/lib/aod-crawler'
import type { CrawlResult } from '@/lib/aod-crawler'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AOD CRAWLER API
//
// Crawl ASIN(s) via Crawleo API across all specified regions.
// Each region is processed sequentially via Python subprocess (Crawleo API).
//
// CRITICAL RULES:
// - Prices come from AOD ONLY (All Offers Display)
// - If AOD has no offers → return N/A
// - Takes ~15s per region, so 5 regions ≈ 80s total
//
// Timeout: This route needs a long timeout since Crawleo API calls take time.
// Next.js API routes have a default maxDuration which we must respect.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Increase the max duration for this API route (5 regions × ~20s each + buffer)
export const maxDuration = 300 // 5 minutes

interface CrawlResultItem {
  domain: string
  region: string
  name: string
  image: string
  price: string
  currency: string
  priceDisplay: string
  asin: string
  error?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { asin, asins, regions, results: preCrawledResults, crawleoApiKey } = body

    // ── Mode 2: Save pre-crawled results directly ──
    if (preCrawledResults && Array.isArray(preCrawledResults) && asin) {
      return await saveResults(asin, preCrawledResults)
    }

    // ── Mode 1: Trigger crawl via Crawleo API ──
    const asinList: string[] = asins || (asin ? [asin] : [])
    const regionKeys: string[] = regions || Object.keys(REGIONS)

    if (asinList.length === 0) {
      return NextResponse.json({ error: 'No ASIN provided' }, { status: 400 })
    }

    if (!crawleoApiKey) {
      return NextResponse.json({ error: 'Crawleo API key is required' }, { status: 400 })
    }

    const allResults: { asin: string; results?: CrawlResultItem[]; error?: string }[] = []

    for (const a of asinList) {
      const cleanAsin = a.trim().toUpperCase()

      if (!/^[A-Z0-9]{10}$/.test(cleanAsin)) {
        allResults.push({ asin: cleanAsin, error: 'Invalid ASIN format', results: [] })
        continue
      }

      console.log(`[Crawl API] Starting crawl for ${cleanAsin} regions: ${regionKeys.join(',')}`)

      // Crawl each region SEQUENTIALLY
      const crawlResults: CrawlResult[] = []

      for (const regionKey of regionKeys) {
        console.log(`[Crawl API] Crawling ${cleanAsin} on ${regionKey}...`)
        const result = await crawlRegion(cleanAsin, regionKey, crawleoApiKey)
        crawlResults.push(result)
        console.log(`[Crawl API] ${cleanAsin} on ${regionKey}: price=${result.price} display=${result.priceDisplay}`)

        // Small delay between regions
        if (regionKeys.indexOf(regionKey) < regionKeys.length - 1) {
          await new Promise((r) => setTimeout(r, 500))
        }
      }

      // Save results to DB
      await saveResultsToDB(cleanAsin, crawlResults)
      allResults.push({ asin: cleanAsin, results: crawlResults })
    }

    return NextResponse.json({ success: true, data: allResults })
  } catch (e) {
    console.error('[Crawl API Error]:', e)
    return NextResponse.json({ error: 'Crawl failed', details: String(e) }, { status: 500 })
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SAVE RESULTS TO DB
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function saveResults(asin: string, crawlResults: CrawlResultItem[]) {
  const result = await saveResultsToDB(asin, crawlResults)
  return result
}

async function saveResultsToDB(asin: string, crawlResults: CrawlResultItem[]) {
  const cleanAsin = asin.trim().toUpperCase()

  let product = await db.product.findUnique({ where: { asin: cleanAsin } })

  const bestResult = crawlResults.find(
    (r) =>
      r.name &&
      r.name !== `Product ${cleanAsin}` &&
      !r.name.toLowerCase().includes('no other sellers') &&
      !r.name.toLowerCase().includes('no featured')
  ) || crawlResults.find((r) => r.name && r.name !== `Product ${cleanAsin}`) || crawlResults[0]

  if (!product) {
    product = await db.product.create({
      data: {
        asin: cleanAsin,
        name: bestResult?.name || `Product ${cleanAsin}`,
        image: bestResult?.image || '',
      },
    })
  } else {
    if (bestResult?.name && bestResult.name !== `Product ${cleanAsin}`) {
      await db.product.update({
        where: { id: product.id },
        data: { name: bestResult.name, image: bestResult.image || product.image, updatedAt: new Date() },
      })
    }
  }

  for (const result of crawlResults) {
    if (!result.domain) continue
    await db.price.upsert({
      where: { productId_domain: { productId: product.id, domain: result.domain } },
      create: { productId: product.id, domain: result.domain, region: result.region, price: result.price, currency: result.currency, priceDisplay: result.priceDisplay },
      update: { price: result.price, currency: result.currency, priceDisplay: result.priceDisplay, updatedAt: new Date() },
    })
  }

  return NextResponse.json({ success: true, asin: cleanAsin, results: crawlResults })
}
