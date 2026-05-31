/**
 * Amazon AOD Price Crawler — Using agent-browser (headless browser)
 * 
 * ALL prices come from AOD (All Offers Display) ONLY.
 * Uses agent-browser CLI snapshot to extract AOD data.
 * No fallback to main page price.
 * If AOD has no offers → return N/A.
 */

import { execFile } from 'child_process'

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

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '\u20AC',
  GBP: '\u00A3',
  EGP: 'EGP ',
  SAR: 'SAR ',
  AED: 'AED ',
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BROWSER HELPERS (ASYNC)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function runBrowser(args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolve) => {
    execFile('agent-browser', args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !stdout) {
        resolve(stderr?.trim() || '')
        return
      }
      resolve(stdout?.trim() || '')
    })
  })
}

async function runBrowserJSON(args: string[], timeout = 30000): Promise<unknown> {
  const raw = await runBrowser([...args, '--json'], timeout)
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FORMAT HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function formatPrice(price: string, currency: string): string {
  if (price === 'N/A') return 'N/A'
  try {
    const num = parseFloat(price)
    if (!isNaN(num)) {
      const symbol = CURRENCY_SYMBOLS[currency] || currency + ' '
      return `${symbol}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
  } catch {
    /* keep original */
  }
  return price
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SNAPSHOT PARSING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface SnapshotRef {
  name: string
  role: string
}

interface SnapshotData {
  hasPinnedOffer: boolean
  noOffers: boolean
  price: string
  currencySymbol: string
  name: string
  image: string
}

/**
 * Parse the AOD snapshot JSON to extract price info.
 * 
 * The snapshot contains refs with element names. We look for:
 * 1. A button containing "price" → extract the price from it
 * 2. "no other sellers" / "no featured offers" → no offers
 * 3. Product name from heading
 */
function parseAodSnapshot(snapshotJson: unknown): SnapshotData {
  const result: SnapshotData = {
    hasPinnedOffer: false,
    noOffers: false,
    price: '',
    currencySymbol: '',
    name: '',
    image: '',
  }

  if (!snapshotJson || typeof snapshotJson !== 'object') return result

  const data = snapshotJson as { data?: { refs?: Record<string, SnapshotRef>; snapshot?: string } }
  const refs = data.data?.refs || {}

  // Check for "no offers" indicators in element names
  // IMPORTANT: "no other sellers" does NOT mean no offers — it means no OTHER
  // sellers besides the pinned offer. Only "no featured offers" means truly no offers.
  const trulyNoOfferPatterns = [
    'no featured offers available',
    'no featured offers',
    'currently unavailable',
    'keine empfohlenen angebote',
    'keine angebote verfügbar',
    'derzeit nicht verfügbar',
    'لا توجد عروض مميزة متاحة',
    'غير متوفر حالياً',
  ]

  for (const ref of Object.values(refs)) {
    const nameLower = (ref.name || '').toLowerCase()
    for (const pattern of trulyNoOfferPatterns) {
      if (nameLower.includes(pattern)) {
        result.noOffers = true
        break
      }
    }
  }

  // Extract price from "Add to basket from seller ... and price X" button
  // This is the most reliable source for the AOD selling price
  for (const ref of Object.values(refs)) {
    if (ref.role === 'button' && ref.name) {
      const nameLower = ref.name.toLowerCase()
      if (nameLower.includes('price')) {
        result.hasPinnedOffer = true

        // Pattern: "Add to basket from seller XXX and price €8.93"
        // or: "Add to basket from seller XXX and price $12.99"
        // or: "Add to basket from seller XXX and price EGP 2800.00"
        const priceMatch = ref.name.match(
          /price\s+([€$£]|EGP|SAR|AED|USD|EUR|HKD)?\s*([\d,]+\.?\d*)/i
        )
        if (priceMatch) {
          result.currencySymbol = priceMatch[1] || ''
          const rawPrice = priceMatch[2].replace(/,/g, '')
          if (rawPrice && parseFloat(rawPrice) > 0) {
            result.price = rawPrice
            // If we found a price from a pinned offer, it's NOT "no offers"
            // even if "no other sellers" text is present
            result.noOffers = false
          }
        }
        break
      }
    }
  }

  // If no price from button, try to find StaticText price in the snapshot
  // (The snapshot text sometimes contains the price directly)
  if (!result.price) {
    const snapshot = data.data?.snapshot || ''
    // Look for price patterns in snapshot text
    const staticPriceMatch = snapshot.match(
      /StaticText\s+"([€$£]|EGP|SAR|AED|USD|EUR)\s*([\d,]+\.?\d*)"/
    )
    if (staticPriceMatch) {
      result.currencySymbol = staticPriceMatch[1]
      result.price = staticPriceMatch[2].replace(/,/g, '')
    }
  }

  // Extract product name from heading — skip "no sellers" / "didn't find" headings
  const badNamePatterns = [
    'no other sellers',
    'no featured offers',
    'didn\'t find',
    'did not find',
    'currently there are no',
    'currently unavailable',
  ]
  for (const ref of Object.values(refs)) {
    if (ref.role === 'heading' && ref.name && ref.name.length > 5) {
      const nameLower = ref.name.toLowerCase()
      let isBadName = false
      for (const pattern of badNamePatterns) {
        if (nameLower.includes(pattern)) {
          isBadName = true
          break
        }
      }
      if (!isBadName) {
        result.name = ref.name.trim()
        break
      }
    }
  }

  return result
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWL ONE REGION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface CrawlResult {
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

/**
 * Crawl a single ASIN on a single region using agent-browser.
 * 
 * Flow:
 * 1. Open the Amazon homepage for the region
 * 2. Set currency/language cookies
 * 3. Navigate to the AOD URL (?aod=1)
 * 4. Wait for AOD content to load
 * 5. Take a snapshot of #aod-pinned-offer
 * 6. Parse the snapshot to extract price
 * 7. If no pinned offer, take full page snapshot to check for "no offers"
 */
export async function crawlRegion(
  asin: string,
  regionKey: string
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
    // ── Step 1: Open region homepage to set base cookies ──
    console.log(`[crawlRegion] Opening ${region.domain}...`)
    await runBrowser(['open', `https://www.${region.domain}/`], 20000)

    // ── Step 2: Set currency and language cookies ──
    const cookieScript = `document.cookie='i18n-prefs=${region.currencyCookie};path=/;domain=.${region.domain}';document.cookie='lc-main=en_US;path=/;domain=.${region.domain}';'done'`
    await runBrowser(['eval', cookieScript], 8000)

    // ── Step 3: Navigate to AOD page ──
    const aodUrl = `https://www.${region.domain}/dp/${asin}/ref=olp-opf-redir?aod=1&language=en_US${region.postalCode ? `&postalCode=${region.postalCode}` : ''}`
    console.log(`[crawlRegion] Navigating to AOD: ${aodUrl}`)
    await runBrowser(['open', aodUrl], 35000)

    // ── Step 4: Wait for AOD content to render ──
    await runBrowser(['wait', '3000'], 5000)

    // ── Step 5: Take snapshot of the AOD section ──
    console.log(`[crawlRegion] Taking AOD snapshot for ${asin} on ${region.domain}...`)
    
    // First try the pinned offer section
    let snapshotData = await runBrowserJSON(
      ['snapshot', '-s', '#aod-pinned-offer'],
      10000
    )

    let extracted = parseAodSnapshot(snapshotData)

    // If no pinned offer found, try the full AOD container
    if (!extracted.hasPinnedOffer && !extracted.noOffers) {
      snapshotData = await runBrowserJSON(
        ['snapshot', '-s', '#aod-offer-list'],
        10000
      )
      const offerListExtracted = parseAodSnapshot(snapshotData)
      if (offerListExtracted.price) {
        extracted = offerListExtracted
      }
    }

    // If still no data, try a full page snapshot to check for no-offer indicators
    if (!extracted.hasPinnedOffer && !extracted.noOffers && !extracted.price) {
      snapshotData = await runBrowserJSON(
        ['snapshot', '-s', '#aod-container'],
        10000
      )
      extracted = parseAodSnapshot(snapshotData)
    }

    console.log(`[crawlRegion] Extracted for ${asin} on ${region.domain}:`, JSON.stringify(extracted))

    // ── Step 6: Get product image ──
    let image = ''
    try {
      const imgResult = await runBrowser(
        ['eval', "document.getElementById('aod-asin-image-id')?.src || document.getElementById('landingImage')?.src || ''"],
        8000
      )
      // Parse the eval result (it's wrapped in quotes)
      image = imgResult.replace(/^"|"$/g, '').replace(/\\"/g, '"')
      if (image.startsWith('http')) {
        // valid URL
      } else {
        image = ''
      }
    } catch {
      // ignore
    }

    // ── Step 7: Build the result ──
    if (extracted.noOffers || (!extracted.price && !extracted.hasPinnedOffer)) {
      return {
        ...na,
        name: extracted.name || na.name,
        image: image || na.image,
      }
    }

    // Map currency symbol to code
    const symbolToCode: Record<string, string> = {
      '$': 'USD',
      '\u20AC': 'EUR',
      '\u00A3': 'GBP',
      'EGP': 'EGP',
      'SAR': 'SAR',
      'AED': 'AED',
      'HKD': 'HKD',
      'EUR': 'EUR',
      'USD': 'USD',
    }

    let currencyCode = region.currency
    if (extracted.currencySymbol) {
      const mapped = symbolToCode[extracted.currencySymbol]
      if (mapped) currencyCode = mapped
    }

    const priceNum = parseFloat(extracted.price)
    if (!extracted.price || isNaN(priceNum) || priceNum <= 0) {
      return {
        ...na,
        name: extracted.name || na.name,
        image: image || na.image,
      }
    }

    return {
      domain: region.domain,
      region: region.region,
      name: extracted.name || na.name,
      image: image || na.image,
      price: extracted.price,
      currency: currencyCode,
      priceDisplay: formatPrice(extracted.price, currencyCode),
      asin,
    }
  } catch (e) {
    console.error(`[crawlRegion] Error for ${asin} on ${region.domain}:`, e)
    return { ...na, error: String(e) }
  }
}

/**
 * Crawl a single ASIN across all specified regions.
 */
export async function crawlAsin(
  asin: string,
  regionKeys: string[] = Object.keys(REGIONS)
): Promise<CrawlResult[]> {
  const results: CrawlResult[] = []

  // Ensure browser is closed before starting
  await runBrowser(['close'], 5000)

  for (const key of regionKeys) {
    const result = await crawlRegion(asin, key)
    results.push(result)

    // Small delay between regions
    if (regionKeys.indexOf(key) < regionKeys.length - 1) {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  // Close browser when done
  await runBrowser(['close'], 5000)

  return results
}
