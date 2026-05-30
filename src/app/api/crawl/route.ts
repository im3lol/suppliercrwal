import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { crawlAsin } from '@/lib/amazon-crawler'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { asin, asins, regions } = body

    // Support single ASIN or bulk
    const asinList: string[] = asins || (asin ? [asin] : [])
    const regionKeys: string[] = regions || ['COM', 'EG', 'DE', 'SA', 'AE']

    if (asinList.length === 0) {
      return NextResponse.json({ error: 'No ASIN provided' }, { status: 400 })
    }

    const allResults = []

    for (const a of asinList) {
      const cleanAsin = a.trim().toUpperCase()

      // Validate ASIN format (10 alphanumeric)
      if (!/^[A-Z0-9]{10}$/.test(cleanAsin)) {
        allResults.push({
          asin: cleanAsin,
          error: 'Invalid ASIN format',
          results: [],
        })
        continue
      }

      // Crawl all regions
      const crawlResults = await crawlAsin(cleanAsin, regionKeys)

      // Save to database
      let product = await db.product.findUnique({ where: { asin: cleanAsin } })

      if (!product) {
        // Use the first non-error result for product info
        const mainResult = crawlResults.find((r) => r.name !== `Product ${cleanAsin}`) || crawlResults[0]
        product = await db.product.create({
          data: {
            asin: cleanAsin,
            name: mainResult?.name || `Product ${cleanAsin}`,
            image: mainResult?.image || '',
          },
        })
      } else {
        // Update name/image if we got better data
        const mainResult = crawlResults.find((r) => r.name !== `Product ${cleanAsin}`)
        if (mainResult) {
          await db.product.update({
            where: { id: product.id },
            data: {
              name: mainResult.name,
              image: mainResult.image || product.image,
              updatedAt: new Date(),
            },
          })
        }
      }

      // Save/update prices for each region
      for (const result of crawlResults) {
        await db.price.upsert({
          where: {
            productId_domain: {
              productId: product.id,
              domain: result.domain,
            },
          },
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

      allResults.push({
        asin: cleanAsin,
        results: crawlResults,
      })
    }

    return NextResponse.json({ success: true, data: allResults })
  } catch (e) {
    console.error('[Crawl API Error]:', e)
    return NextResponse.json(
      { error: 'Crawl failed', details: String(e) },
      { status: 500 }
    )
  }
}
