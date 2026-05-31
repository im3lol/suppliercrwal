import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { exec } from 'child_process'
import { join } from 'path'

// Kill leftover agent-browser/chromium processes after crawl
function cleanupBrowserProcesses(): void {
  try {
    exec('pkill -f "agent-browser" 2>/dev/null; pkill -f "chromium.*headless" 2>/dev/null', () => {})
  } catch { /* ignore */ }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AOD CRAWLER API
//
// Two modes:
// 1. { asin, regions }: Triggers crawl via standalone script, saves results
// 2. { asin, results }: Saves pre-crawled results to DB (from frontend)
//
// The standalone script (scripts/crawl-aod.js) uses agent-browser
// to scrape real Amazon AOD prices. Prices come from AOD ONLY.
// If AOD has no offers → return N/A.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CRAWL_SCRIPT = join(process.cwd(), 'scripts', 'crawl-aod.js')

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
    const { asin, asins, regions, results: preCrawledResults } = body

    // ── Mode 2: Save pre-crawled results directly ──
    if (preCrawledResults && Array.isArray(preCrawledResults) && asin) {
      return await saveResults(asin, preCrawledResults)
    }

    // ── Mode 1: Trigger crawl via standalone script ──
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

      // Run the standalone crawl script in a new session (setsid)
      // This isolates Chromium from the Next.js process group
      const regionArg = regionKeys.join(',')
      console.log(`[Crawl API] Running crawl script for ${cleanAsin} regions: ${regionArg}`)

      const crawlResult = await new Promise<string>((resolve, reject) => {
        // Use setsid to run the script in a new session, preventing
        // Chromium from killing the Next.js server process group
        const cmd = `setsid node ${CRAWL_SCRIPT} ${cleanAsin} ${regionArg} 2>/dev/null`
        exec(
          cmd,
          { timeout: 300000, maxBuffer: 10 * 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error) {
              console.error(`[Crawl API] Script error for ${cleanAsin}:`, error.message?.substring(0, 200))
              if (stdout) resolve(stdout.trim())
              else reject(error)
              return
            }
            resolve(stdout.trim())
          }
        )
      })

      // Parse the JSON output
      let crawlData: { success?: boolean; asin?: string; data?: CrawlResultItem[]; error?: string }
      try {
        crawlData = JSON.parse(crawlResult)
      } catch {
        console.error(`[Crawl API] Failed to parse output for ${cleanAsin}:`, crawlResult?.substring(0, 200))
        allResults.push({ asin: cleanAsin, error: 'Failed to parse crawl data', results: [] })
        continue
      }

      if (!crawlData.success || !crawlData.data) {
        allResults.push({ asin: cleanAsin, error: crawlData.error || 'Crawl failed', results: [] })
        continue
      }

      // Save results to DB
      await saveResults(cleanAsin, crawlData.data)
      allResults.push({ asin: cleanAsin, results: crawlData.data })
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
