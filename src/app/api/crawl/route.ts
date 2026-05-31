import { NextRequest, NextResponse } from 'next/server'
import { crawlRegion } from '@/lib/aod-crawler'
import {
  findProductByAsin,
  createProduct,
  updateProduct,
  upsertPrice,
} from '@/lib/db-supabase'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AOD CRAWLER API — z-ai-web-dev-sdk page_reader + Supabase
//
// Crawl ASIN on a single region.
// Uses z-ai-web-dev-sdk's page_reader exclusively (no external API key needed).
// Crawleo API has been removed (sandbox inactive error).
// Results are saved to Supabase (PostgreSQL).
//
// CRITICAL RULES:
// - Prices come from AOD ONLY (All Offers Display)
// - If AOD has no offers → return N/A
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const maxDuration = 60

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
  debug?: {
    url: string
    fetchMethod: string
    pageStatusCode: number
    htmlSize: number
    markdownSize: number
    credits: number
    timingMs: number
    retryCount: number
    errorMsg: string
    aodOfferCount: number
    aPriceCount: number
    parseStrategy: string
    rawPriceText: string
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { asin, region } = body

    const cleanAsin = (asin || '').trim().toUpperCase()

    if (!cleanAsin || !/^[A-Z0-9]{10}$/.test(cleanAsin)) {
      return NextResponse.json({ error: 'Valid ASIN required' }, { status: 400 })
    }

    const regionKey = (region || 'COM').trim().toUpperCase()

    // Always use page_reader — Crawleo API removed (sandbox inactive)
    console.log(`[Crawl API] Crawling ${cleanAsin} on ${regionKey} via page_reader...`)

    // Call TypeScript crawler — always uses page_reader (no external API needed)
    const result: CrawlResultItem = await crawlRegion(cleanAsin, regionKey)

    // Save to Supabase
    await saveResultsToDB(cleanAsin, [result])

    console.log(`[Crawl API] ${cleanAsin} on ${regionKey}: price=${result.price} display=${result.priceDisplay}`)

    return NextResponse.json({
      success: true,
      asin: cleanAsin,
      results: [result],
    })
  } catch (e) {
    console.error('[Crawl API Error]:', e)
    return NextResponse.json({ error: 'Crawl failed', details: String(e) }, { status: 500 })
  }
}

async function saveResultsToDB(asin: string, crawlResults: CrawlResultItem[]) {
  const cleanAsin = asin.trim().toUpperCase()

  // Find existing product
  let product = await findProductByAsin(cleanAsin)

  const bestResult = crawlResults.find(
    (r) => r.name && r.name !== `Product ${cleanAsin}` &&
      !r.name.toLowerCase().includes('no other sellers') &&
      !r.name.toLowerCase().includes('no featured')
  ) || crawlResults.find((r) => r.name && r.name !== `Product ${cleanAsin}`) || crawlResults[0]

  if (!product) {
    // Create new product
    product = await createProduct(
      cleanAsin,
      bestResult?.name || `Product ${cleanAsin}`,
      bestResult?.image || ''
    )
  } else {
    // Update existing product if we have better data
    if (bestResult?.name && bestResult.name !== `Product ${cleanAsin}`) {
      await updateProduct(
        product.id,
        bestResult.name,
        bestResult.image || product.image
      )
    }
  }

  // Upsert prices for each region result
  for (const result of crawlResults) {
    if (!result.domain) continue
    await upsertPrice(
      product.id,
      result.domain,
      result.region,
      result.price,
      result.currency,
      result.priceDisplay
    )
  }
}
