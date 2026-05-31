import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWL SAVE API — Saves crawl results from the frontend to the DB
//
// The frontend calls the crawl microservice directly (port 3003),
// then sends the results here to be persisted.
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
    const { asin, results } = body as { asin: string; results: CrawlResultItem[] }

    if (!asin || !results || !Array.isArray(results)) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }

    const cleanAsin = asin.trim().toUpperCase()

    // Upsert product
    let product = await db.product.findUnique({ where: { asin: cleanAsin } })

    const bestResult = results.find(
      (r) =>
        r.name &&
        r.name !== `Product ${cleanAsin}` &&
        !r.name.toLowerCase().includes('no other sellers') &&
        !r.name.toLowerCase().includes('no featured')
    ) || results.find((r) => r.name && r.name !== `Product ${cleanAsin}`) || results[0]

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
          data: {
            name: bestResult.name,
            image: bestResult.image || product.image,
            updatedAt: new Date(),
          },
        })
      }
    }

    // Upsert prices
    for (const result of results) {
      if (!result.domain) continue
      await db.price.upsert({
        where: { productId_domain: { productId: product.id, domain: result.domain } },
        create: {
          productId: product.id,
          domain: result.domain,
          region: result.region,
          price: result.price,
          currency: result.currency,
          priceDisplay: result.priceDisplay,
        },
        update: {
          price: result.price,
          currency: result.currency,
          priceDisplay: result.priceDisplay,
          updatedAt: new Date(),
        },
      })
    }

    return NextResponse.json({ success: true, asin: cleanAsin })
  } catch (e) {
    console.error('[Crawl Save API Error]:', e)
    return NextResponse.json({ error: 'Save failed', details: String(e) }, { status: 500 })
  }
}
