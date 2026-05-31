/**
 * Crawler Service — Headless browser-based Amazon AOD price crawler
 * 
 * Runs on port 3031. Accepts crawl requests and returns real AOD prices.
 * Uses agent-browser CLI for headless browser automation.
 */

import { execFile } from 'child_process'
import { createServer } from 'http'

const PORT = 3031

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface RegionConfig {
  domain: string
  region: string
  currency: string
  cookie: string
  postal?: string
}

const REGIONS: Record<string, RegionConfig> = {
  COM: { domain: 'amazon.com', region: 'COM', currency: 'USD', cookie: 'USD', postal: '99950' },
  EG: { domain: 'amazon.eg', region: 'EG', currency: 'EGP', cookie: 'EGP' },
  DE: { domain: 'amazon.de', region: 'DE', currency: 'EUR', cookie: 'EUR', postal: '80331' },
  SA: { domain: 'amazon.sa', region: 'SA', currency: 'SAR', cookie: 'SAR' },
  AE: { domain: 'amazon.ae', region: 'AE', currency: 'AED', cookie: 'AED' },
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', EGP: 'EGP ', SAR: 'SAR ', AED: 'AED ',
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BROWSER HELPERS
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

async function runBrowserJSON(args: string[], timeout = 30000): Promise<any> {
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
  } catch { /* keep original */ }
  return price
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SNAPSHOT PARSING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface SnapshotRef {
  name: string
  role: string
}

interface ParsedAod {
  hasPinnedOffer: boolean
  noOffers: boolean
  price: string
  currencySymbol: string
  name: string
}

function parseAodSnapshot(snapshotJson: any): ParsedAod {
  const result: ParsedAod = {
    hasPinnedOffer: false,
    noOffers: false,
    price: '',
    currencySymbol: '',
    name: '',
  }

  if (!snapshotJson || typeof snapshotJson !== 'object') return result

  const refs: Record<string, SnapshotRef> = snapshotJson.data?.refs || {}

  // Check for "no offers" — only "no featured offers" means truly no offers
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
  for (const ref of Object.values(refs)) {
    if (ref.role === 'button' && ref.name) {
      const nameLower = ref.name.toLowerCase()
      if (nameLower.includes('price')) {
        result.hasPinnedOffer = true

        const priceMatch = ref.name.match(
          /price\s+([€$£]|EGP|SAR|AED|USD|EUR|HKD)?\s*([\d,]+\.?\d*)/i
        )
        if (priceMatch) {
          result.currencySymbol = priceMatch[1] || ''
          const rawPrice = priceMatch[2].replace(/,/g, '')
          if (rawPrice && parseFloat(rawPrice) > 0) {
            result.price = rawPrice
            result.noOffers = false // Found price = has offers
          }
        }
        break
      }
    }
  }

  // Fallback: try StaticText price in snapshot
  if (!result.price) {
    const snapshot: string = snapshotJson.data?.snapshot || ''
    const staticPriceMatch = snapshot.match(
      /StaticText\s+"([€$£]|EGP|SAR|AED|USD|EUR)\s*([\d,]+\.?\d*)"/
    )
    if (staticPriceMatch) {
      result.currencySymbol = staticPriceMatch[1]
      const rawPrice = staticPriceMatch[2].replace(/,/g, '')
      if (rawPrice && parseFloat(rawPrice) > 0) {
        result.price = rawPrice
      }
    }
  }

  // Product name from heading — but skip "no sellers" / "didn't find" headings
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

interface CrawlResult {
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

async function crawlRegion(asin: string, regionKey: string): Promise<CrawlResult> {
  const region = REGIONS[regionKey]
  if (!region) {
    return {
      domain: '', region: regionKey, name: `Product ${asin}`, image: '',
      price: 'N/A', currency: '', priceDisplay: 'N/A', asin, error: 'Unknown region',
    }
  }

  const na: CrawlResult = {
    domain: region.domain, region: region.region, name: `Product ${asin}`, image: '',
    price: 'N/A', currency: region.currency, priceDisplay: 'N/A', asin,
  }

  try {
    // Open region homepage
    console.log(`[crawlRegion] Opening ${region.domain}...`)
    await runBrowser(['open', `https://www.${region.domain}/`], 20000)

    // Set cookies
    const cookieScript = `document.cookie='i18n-prefs=${region.cookie};path=/;domain=.${region.domain}';document.cookie='lc-main=en_US;path=/;domain=.${region.domain}';'done'`
    await runBrowser(['eval', cookieScript], 8000)

    // Navigate to AOD page
    const aodUrl = `https://www.${region.domain}/dp/${asin}/ref=olp-opf-redir?aod=1&language=en_US${region.postal ? `&postalCode=${region.postal}` : ''}`
    console.log(`[crawlRegion] Navigating to AOD: ${aodUrl}`)
    await runBrowser(['open', aodUrl], 35000)

    // Wait for AOD
    await runBrowser(['wait', '3000'], 5000)

    // Take snapshot
    console.log(`[crawlRegion] Taking snapshot for ${asin} on ${region.domain}...`)
    let snapshotData = await runBrowserJSON(['snapshot', '-s', '#aod-pinned-offer'], 10000)
    let extracted = parseAodSnapshot(snapshotData)

    // If no pinned offer, try offer list
    if (!extracted.hasPinnedOffer && !extracted.noOffers && !extracted.price) {
      snapshotData = await runBrowserJSON(['snapshot', '-s', '#aod-offer-list'], 10000)
      const offerListExtracted = parseAodSnapshot(snapshotData)
      if (offerListExtracted.price) {
        extracted = offerListExtracted
      }
    }

    // If still nothing, try AOD container
    if (!extracted.hasPinnedOffer && !extracted.noOffers && !extracted.price) {
      snapshotData = await runBrowserJSON(['snapshot', '-s', '#aod-container'], 10000)
      const containerExtracted = parseAodSnapshot(snapshotData)
      if (containerExtracted.noOffers || containerExtracted.price) {
        extracted = containerExtracted
      }
    }

    console.log(`[crawlRegion] Extracted for ${asin} on ${region.domain}:`, JSON.stringify(extracted).substring(0, 200))

    // Get product image
    let image = ''
    try {
      // Try AOD image first, then main page image
      const imgResult = await runBrowser(['get', 'attr', '@aod-asin-image-id', 'src'], 8000)
      if (imgResult && imgResult.startsWith('http')) {
        image = imgResult.replace(/^"|"$/g, '')
      }
    } catch { /* ignore */ }

    // Build result
    if (extracted.noOffers || (!extracted.price && !extracted.hasPinnedOffer)) {
      return { ...na, name: extracted.name || na.name, image: image || na.image }
    }

    // Map currency symbol to code
    const symbolToCode: Record<string, string> = {
      '$': 'USD', '€': 'EUR', '£': 'GBP',
      'EGP': 'EGP', 'SAR': 'SAR', 'AED': 'AED',
      'HKD': 'HKD', 'EUR': 'EUR', 'USD': 'USD',
    }

    let currencyCode = region.currency
    if (extracted.currencySymbol) {
      const mapped = symbolToCode[extracted.currencySymbol]
      if (mapped) currencyCode = mapped
    }

    const priceNum = parseFloat(extracted.price)
    if (!extracted.price || isNaN(priceNum) || priceNum <= 0) {
      return { ...na, name: extracted.name || na.name, image: image || na.image }
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
    // Ensure browser is closed on error too
    await runBrowser(['close'], 5000)
    return { ...na, error: String(e) }
  } finally {
    // Always close browser after each region to free memory
    try { await runBrowser(['close'], 5000) } catch { /* ignore */ }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWL ASIN (ALL REGIONS)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function crawlAsin(asin: string, regionKeys: string[] = Object.keys(REGIONS)): Promise<CrawlResult[]> {
  const results: CrawlResult[] = []

  // Close any existing browser
  await runBrowser(['close'], 5000)

  for (const key of regionKeys) {
    // Close and reopen browser for each region to free memory
    await runBrowser(['close'], 5000)
    await new Promise((r) => setTimeout(r, 500))

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HTTP SERVER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const server = createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  if (req.method === 'POST' && req.url === '/crawl') {
    try {
      const body = await new Promise<string>((resolve) => {
        let data = ''
        req.on('data', (chunk) => { data += chunk })
        req.on('end', () => resolve(data))
      })

      const { asin, asins, regions } = JSON.parse(body)
      const asinList: string[] = asins || (asin ? [asin] : [])
      const regionKeys: string[] = regions || Object.keys(REGIONS)

      if (asinList.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'No ASIN provided' }))
        return
      }

      const allResults = []

      for (const a of asinList) {
        const cleanAsin = a.trim().toUpperCase()
        if (!/^[A-Z0-9]{10}$/.test(cleanAsin)) {
          allResults.push({ asin: cleanAsin, error: 'Invalid ASIN format', results: [] })
          continue
        }

        const crawlResults = await crawlAsin(cleanAsin, regionKeys)
        allResults.push({ asin: cleanAsin, results: crawlResults })
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, data: allResults }))
    } catch (e) {
      console.error('[Crawl Service Error]:', e)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Crawl failed', details: String(e) }))
    }
    return
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', service: 'crawler-service' }))
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, () => {
  console.log(`[Crawler Service] Running on port ${PORT}`)
})
