import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AOD CRAWLER API — Save Results to DB
//
// The frontend calls the Crawleo mini-service (port 3002) directly
// for price fetching, then calls this endpoint to save results to DB.
//
// CRITICAL RULES:
// - Prices come from AOD ONLY (All Offers Display)
// - If AOD has no offers → return N/A
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
    const { asin, results } = body

    if (!asin) {
      return NextResponse.json({ error: 'ASIN required' }, { status: 400 })
    }

    if (!results || !Array.isArray(results) || results.length === 0) {
      return NextResponse.json({ error: 'Results array required' }, { status: 400 })
    }

    const cleanAsin = asin.trim().toUpperCase()
    const crawlResults: CrawlResultItem[] = results

    await saveResultsToDB(cleanAsin, crawlResults)

    return NextResponse.json({
      success: true,
      asin: cleanAsin,
      results: crawlResults,
    })
  } catch (e) {
    console.error('[Crawl API Error]:', e)
    return NextResponse.json({ error: 'Save failed', details: String(e) }, { status: 500 })
  }
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
}
