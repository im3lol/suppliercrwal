import { NextRequest, NextResponse } from 'next/server'
import {
  findProductByAsin,
  createProduct,
  updateProduct,
  upsertPrice,
} from '@/lib/db-supabase'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWL SAVE API — Saves crawl results from the frontend to Supabase
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

    // Find existing product
    let product = await findProductByAsin(cleanAsin)

    const bestResult = results.find(
      (r) =>
        r.name &&
        r.name !== `Product ${cleanAsin}` &&
        !r.name.toLowerCase().includes('no other sellers') &&
        !r.name.toLowerCase().includes('no featured')
    ) || results.find((r) => r.name && r.name !== `Product ${cleanAsin}`) || results[0]

    if (!product) {
      product = await createProduct(
        cleanAsin,
        bestResult?.name || `Product ${cleanAsin}`,
        bestResult?.image || ''
      )
    } else {
      if (bestResult?.name && bestResult.name !== `Product ${cleanAsin}`) {
        await updateProduct(
          product.id,
          bestResult.name,
          bestResult.image || product.image
        )
      }
    }

    // Upsert prices
    for (const result of results) {
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

    return NextResponse.json({ success: true, asin: cleanAsin })
  } catch (e) {
    console.error('[Crawl Save API Error]:', e)
    return NextResponse.json({ error: 'Save failed', details: String(e) }, { status: 500 })
  }
}
