/**
 * Amazon AOD Price Crawler — Using Scrapling Python Service
 *
 * ALL prices come from AOD (All Offers Display) ONLY.
 * Uses a Python script (Scrapling library) via subprocess to fetch
 * AOD AJAX pages and extract real prices from the HTML.
 *
 * CRITICAL RULES:
 * - Prices MUST come from AOD AJAX endpoint ONLY
 * - URL pattern: https://www.amazon.{region}/gp/product/ajax/aodAjaxMain/?asin={ASIN}
 * - NO fallback to main page prices
 * - NO ATC button prices from non-AOD sections
 * - NO alternative/recommended product prices
 * - If AOD has no offers → return "N/A"
 */

import { execFile } from 'child_process'
import path from 'path'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface RegionConfig {
  domain: string
  region: string
  currency: string
  currencyCookie: string
  postalCode?: string
}

export const REGIONS: Record<string, RegionConfig> = {
  COM: {
    domain: 'amazon.com',
    region: 'COM',
    currency: 'USD',
    currencyCookie: 'USD',
    postalCode: '99950',
  },
  EG: {
    domain: 'amazon.eg',
    region: 'EG',
    currency: 'EGP',
    currencyCookie: 'EGP',
  },
  DE: {
    domain: 'amazon.de',
    region: 'DE',
    currency: 'EUR',
    currencyCookie: 'EUR',
    postalCode: '80331',
  },
  SA: {
    domain: 'amazon.sa',
    region: 'SA',
    currency: 'SAR',
    currencyCookie: 'SAR',
  },
  AE: {
    domain: 'amazon.ae',
    region: 'AE',
    currency: 'AED',
    currencyCookie: 'AED',
  },
}

// Path to the Scrapling Python script
const SCRAPE_SCRIPT = path.join(process.cwd(), 'mini-services', 'scrapling-service', 'scrape.py')

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWL RESULT TYPE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface CrawlResult {
  domain: string
  region: string
  name: string
  image: string
  price: string       // numeric like "8.93" or "N/A"
  currency: string    // "EUR", "USD", etc.
  priceDisplay: string // formatted like "€8.93" or "N/A"
  asin: string
  error?: string
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWL ONE REGION — Calls Scrapling Python Script
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Crawl a single ASIN on a single region using the Scrapling Python script.
 *
 * The Python script uses the Scrapling library to:
 * 1. Fetch the AOD AJAX endpoint: /gp/product/ajax/aodAjaxMain/?asin={ASIN}
 * 2. Parse the HTML using CSS selectors
 * 3. Extract price from accessibility labels (most reliable)
 * 4. Fall back to visual price parts (symbol + whole + fraction)
 *
 * Prices come from AOD ONLY. If no offers → N/A.
 */
export async function crawlRegion(
  asin: string,
  regionKey: string,
  scrapeDoToken?: string
): Promise<CrawlResult> {
  const region = REGIONS[regionKey]
  if (!region) {
    return {
      domain: '',
      region: regionKey,
      name: `Product ${asin}`,
      image: '',
      price: 'N/A',
      currency: '',
      priceDisplay: 'N/A',
      asin,
      error: 'Unknown region',
    }
  }

  const na: CrawlResult = {
    domain: region.domain,
    region: region.region,
    name: `Product ${asin}`,
    image: '',
    price: 'N/A',
    currency: region.currency,
    priceDisplay: 'N/A',
    asin,
  }

  try {
    console.log(`[crawlRegion] Scraping ${asin} on ${region.domain} via Scrapling...`)

    // Call the Python Scrapling script
    // Pass SCRAPE_DO_TOKEN env var for geolocation-based fetching
    const env = { ...process.env }
    if (scrapeDoToken) {
      env.SCRAPE_DO_TOKEN = scrapeDoToken
    }
    const result = await new Promise<CrawlResult>((resolve) => {
      execFile(
        'python3',
        [SCRAPE_SCRIPT, asin, regionKey],
        { timeout: 90000, maxBuffer: 10 * 1024 * 1024, env },
        (error, stdout, stderr) => {
          if (error && !stdout) {
            console.error(`[crawlRegion] Scrapling script error: ${error.message}`)
            console.error(`[crawlRegion] stderr: ${stderr?.slice(0, 500)}`)
            resolve({ ...na, error: `Scrapling error: ${error.message}` })
            return
          }

          try {
            // Parse JSON from stdout (skip any non-JSON lines like warnings)
            const lines = stdout.trim().split('\n')
            let jsonLine = lines[lines.length - 1] // Last line should be JSON

            // Find the JSON line (starts with {)
            for (const line of lines) {
              if (line.trim().startsWith('{')) {
                jsonLine = line.trim()
                break
              }
            }

            const data = JSON.parse(jsonLine)

            resolve({
              domain: data.domain || region.domain,
              region: data.region || region.region,
              name: data.name || na.name,
              image: data.image || '',
              price: data.price || 'N/A',
              currency: data.currency || region.currency,
              priceDisplay: data.priceDisplay || 'N/A',
              asin,
              error: data.error || undefined,
            })
          } catch (parseError) {
            console.error(`[crawlRegion] Failed to parse Scrapling output: ${parseError}`)
            console.error(`[crawlRegion] stdout: ${stdout?.slice(0, 500)}`)
            resolve({ ...na, error: `Parse error: ${String(parseError)}` })
          }
        }
      )
    })

    console.log(`[crawlRegion] Result for ${asin} on ${region.domain}: price=${result.price} display=${result.priceDisplay}`)
    return result
  } catch (e) {
    console.error(`[crawlRegion] Error for ${asin} on ${region.domain}:`, e)
    return { ...na, error: String(e) }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWL ACROSS MULTIPLE REGIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Crawl a single ASIN across all specified regions.
 * Regions are processed SEQUENTIALLY with a small delay between each
 * to avoid rate limiting.
 */
export async function crawlAsin(
  asin: string,
  regionKeys: string[] = Object.keys(REGIONS),
  scrapeDoToken?: string
): Promise<CrawlResult[]> {
  const results: CrawlResult[] = []

  for (const key of regionKeys) {
    const result = await crawlRegion(asin, key, scrapeDoToken)
    results.push(result)

    // Small delay between regions to avoid rate limiting
    if (regionKeys.indexOf(key) < regionKeys.length - 1) {
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  return results
}
