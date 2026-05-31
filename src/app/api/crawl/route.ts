import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { execFile } from 'child_process'
import { join } from 'path'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AOD CRAWLER API — Uses standalone crawl script (separate process)
// 
// The standalone script uses agent-browser (headless browser) to:
//   - Navigate to Amazon AOD pages for each region
//   - Extract real prices from AOD pinned offers ONLY
//   - Return N/A if no AOD offers are available
//   - Close browser after each region to free memory
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CRAWL_SCRIPT = join(process.cwd(), 'scripts', 'crawl-standalone.js')

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { asin, asins, regions } = body

    const asinList: string[] = asins || (asin ? [asin] : [])
    const regionKeys: string[] = regions || ['COM', 'EG', 'DE', 'SA', 'AE']

    if (asinList.length === 0) {
      return NextResponse.json({ error: 'No ASIN provided' }, { status: 400 })
    }

    const allResults = []

    for (const a of asinList) {
      const cleanAsin = a.trim().toUpperCase()

      if (!/^[A-Z0-9]{10}$/.test(cleanAsin)) {
        allResults.push({ asin: cleanAsin, error: 'Invalid ASIN format', results: [] })
        continue
      }

      // Run the standalone crawl script as a separate process
      const regionArg = regionKeys.join(',')
      const crawlResult = await new Promise<string>((resolve, reject) => {
        execFile(
          'node',
          [CRAWL_SCRIPT, cleanAsin, regionArg],
          { timeout: 300000, maxBuffer: 10 * 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error) {
              console.error(`[Crawl API] Script error for ${cleanAsin}:`, error.message)
              console.error(`[Crawl API] stderr:`, stderr?.substring(0, 500))
              // Try to parse partial output
              if (stdout) {
                resolve(stdout.trim())
              } else {
                reject(error)
              }
              return
            }
            resolve(stdout.trim())
          }
        )
      })

      // Parse the JSON output
      let crawlData: { success?: boolean; data?: Array<{ asin: string; results: any[] }>; error?: string }
      try {
        crawlData = JSON.parse(crawlResult)
      } catch {
        console.error(`[Crawl API] Failed to parse crawl output for ${cleanAsin}:`, crawlResult?.substring(0, 200))
        allResults.push({ asin: cleanAsin, error: 'Failed to parse crawl data', results: [] })
        continue
      }

      if (!crawlData.success || !crawlData.data?.[0]?.results) {
        allResults.push({ asin: cleanAsin, error: crawlData.error || 'Crawl failed', results: [] })
        continue
      }

      const crawlResults = crawlData.data[0].results

      // Upsert product in database
      let product = await db.product.findUnique({ where: { asin: cleanAsin } })

      // Find the best product name (skip "no sellers" text)
      const bestResult = crawlResults.find(
        (r: { name: string; price: string }) =>
          r.name &&
          r.name !== `Product ${cleanAsin}` &&
          !r.name.toLowerCase().includes('no other sellers') &&
          !r.name.toLowerCase().includes('no featured') &&
          !r.name.toLowerCase().includes('currently there are no')
      ) || crawlResults.find(
        (r: { name: string }) => r.name && r.name !== `Product ${cleanAsin}`
      ) || crawlResults[0]

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

      // Upsert prices for each region
      for (const result of crawlResults) {
        if (!result.domain) continue

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

      allResults.push({ asin: cleanAsin, results: crawlResults })
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
