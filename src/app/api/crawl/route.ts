import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { crawlRegion } from '@/lib/aod-crawler'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AOD CRAWLER API — Pure TypeScript (no Python subprocess)
//
// Crawl ASIN on a single region via Crawleo API directly.
// Uses aod-crawler.ts which calls Crawleo API and parses AOD HTML.
//
// CRITICAL RULES:
// - Prices come from AOD ONLY (All Offers Display)
// - If AOD has no offers → return N/A
//
// This route is fully compatible with Vercel/GitHub/Supabase deployment.
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
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { asin, region, crawleoApiKey } = body

    const cleanAsin = (asin || '').trim().toUpperCase()

    if (!cleanAsin || !/^[A-Z0-9]{10}$/.test(cleanAsin)) {
      return NextResponse.json({ error: 'Valid ASIN required' }, { status: 400 })
    }

    if (!crawleoApiKey) {
      return NextResponse.json({ error: 'Crawleo API key required' }, { status: 400 })
    }

    const regionKey = (region || 'COM').trim().toUpperCase()

    console.log(`[Crawl API] Crawling ${cleanAsin} on ${regionKey} via Crawleo (TypeScript)...`)

    // Call TypeScript crawler directly — no Python subprocess needed!
    const result: CrawlResultItem = await crawlRegion(cleanAsin, regionKey, crawleoApiKey)

    // Save to DB
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

  let product = await db.product.findUnique({ where: { asin: cleanAsin } })

  const bestResult = crawlResults.find(
    (r) => r.name && r.name !== `Product ${cleanAsin}` &&
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
}
