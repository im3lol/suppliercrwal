/**
 * Crawl Service — Standalone microservice for Amazon AOD price crawling
 *
 * Runs on port 3003. Accepts crawl requests via HTTP,
 * uses agent-browser to scrape real AOD prices.
 *
 * Prices come from AOD (All Offers Display) ONLY.
 * If AOD has no offers → return N/A.
 */

import { execFile } from 'child_process'

const PORT = 3003

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REGION CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface RegionConfig {
  domain: string
  region: string
  currency: string
  currencyCookie: string
  languageParam: string
  postalCode?: string
  tldPath: string
}

const REGIONS: Record<string, RegionConfig> = {
  COM: {
    domain: 'amazon.com',
    region: 'COM',
    currency: 'USD',
    currencyCookie: 'USD',
    languageParam: 'en_US',
    postalCode: '99950',
    tldPath: '',
  },
  EG: {
    domain: 'amazon.eg',
    region: 'EG',
    currency: 'EGP',
    currencyCookie: 'EGP',
    languageParam: 'en_US',
    tldPath: '',
  },
  DE: {
    domain: 'amazon.de',
    region: 'DE',
    currency: 'EUR',
    currencyCookie: 'EUR',
    languageParam: 'en_US',
    postalCode: '80331',
    tldPath: '-/en',
  },
  SA: {
    domain: 'amazon.sa',
    region: 'SA',
    currency: 'SAR',
    currencyCookie: 'SAR',
    languageParam: 'en_US',
    tldPath: '-/en',
  },
  AE: {
    domain: 'amazon.ae',
    region: 'AE',
    currency: 'AED',
    currencyCookie: 'AED',
    languageParam: 'en_US',
    tldPath: '-/en',
  },
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  EGP: 'EGP ',
  SAR: 'SAR ',
  AED: 'AED ',
}

const SYMBOL_TO_CURRENCY: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  'EGP': 'EGP',
  'SAR': 'SAR',
  'AED': 'AED',
  'USD': 'USD',
  'EUR': 'EUR',
  'HKD': 'HKD',
  'JPY': 'JPY',
  'ر.س': 'SAR',
  'ر.ق': 'SAR',
  'د.إ': 'AED',
  'ج.م': 'EGP',
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BROWSER HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function runBrowser(args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile('agent-browser', args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !stdout) {
        console.error(`[agent-browser] error for ${args.join(' ')}:`, error.message?.substring(0, 200))
        resolve(stderr?.trim() || '')
        return
      }
      resolve(stdout?.trim() || '')
    })
    setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already dead */ }
    }, timeout + 2000)
  })
}

async function killBrowser(): Promise<void> {
  try { await runBrowser(['close'], 5000) } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 1000))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PRICE HELPERS
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

function parsePriceParts(
  data: { symbol: string; whole: string; fraction: string; offscreen: string } | null,
  defaultCurrency: string
): { price: string; currency: string } | null {
  if (!data) return null
  if (data.whole) {
    const wholeClean = data.whole.replace(/[.,\s]/g, '').trim()
    const fractionClean = data.fraction?.trim() || '00'
    if (wholeClean && /^\d+$/.test(wholeClean) && /^\d+$/.test(fractionClean)) {
      const priceStr = `${wholeClean}.${fractionClean}`
      const priceNum = parseFloat(priceStr)
      if (priceNum > 0) {
        const currency = SYMBOL_TO_CURRENCY[data.symbol?.trim()] || defaultCurrency
        return { price: priceStr, currency }
      }
    }
  }
  if (data.offscreen) {
    const nums = data.offscreen.match(/[\d,]+\.?\d*/g)
    if (nums && nums.length > 0) {
      const value = nums[0].replace(/,/g, '')
      const numVal = parseFloat(value)
      if (numVal > 0) {
        let currency = defaultCurrency
        for (const [sym, code] of Object.entries(SYMBOL_TO_CURRENCY)) {
          if (data.offscreen.includes(sym)) { currency = code; break }
        }
        return { price: value, currency }
      }
    }
  }
  return null
}

function parseAtcLabel(label: string, defaultCurrency: string): { price: string; currency: string } | null {
  if (!label) return null
  const match = label.match(/price\s+([€$£]|EGP|SAR|AED|USD|EUR)?\s*([\d,]+\.?\d*)/i)
  if (match) {
    const symbol = match[1] || ''
    const rawPrice = match[2].replace(/,/g, '')
    const priceNum = parseFloat(rawPrice)
    if (priceNum > 0) {
      const currency = SYMBOL_TO_CURRENCY[symbol.trim()] || defaultCurrency
      return { price: rawPrice, currency }
    }
  }
  return null
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AOD EXTRACT JS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const AOD_EXTRACT_JS = `JSON.stringify({
  hasAod: !!document.querySelector('#aod-container'),
  noOffers: !!document.querySelector('#aod-asin-no-offers, .aod-no-offer, #aod-unqualified-no-offer'),
  pinnedPrice: (() => {
    try {
      const pinned = document.querySelector('#aod-pinned-offer');
      if (!pinned) return null;
      const priceEl = pinned.querySelector('.a-price');
      if (!priceEl) return null;
      return {
        symbol: priceEl.querySelector('.a-price-symbol')?.textContent?.trim() || '',
        whole: priceEl.querySelector('.a-price-whole')?.textContent?.trim() || '',
        fraction: priceEl.querySelector('.a-price-fraction')?.textContent?.trim() || '',
        offscreen: priceEl.querySelector('.a-offscreen')?.textContent?.trim() || '',
      };
    } catch(e) { return null; }
  })(),
  price0: (() => {
    try {
      const el = document.querySelector('#aod-price-0');
      if (!el) return null;
      const priceEl = el.querySelector('.a-price');
      if (!priceEl) return null;
      return {
        symbol: priceEl.querySelector('.a-price-symbol')?.textContent?.trim() || '',
        whole: priceEl.querySelector('.a-price-whole')?.textContent?.trim() || '',
        fraction: priceEl.querySelector('.a-price-fraction')?.textContent?.trim() || '',
        offscreen: priceEl.querySelector('.a-offscreen')?.textContent?.trim() || '',
      };
    } catch(e) { return null; }
  })(),
  atcLabel: (() => {
    try {
      const btn = document.querySelector('input[name="submit.addToCart"]');
      return btn?.getAttribute('aria-label') || null;
    } catch(e) { return null; }
  })(),
  name: (() => {
    try {
      return document.querySelector('#aod-asin-title-text')?.textContent?.trim() || null;
    } catch(e) { return null; }
  })(),
  image: (() => {
    try {
      return document.querySelector('#aod-asin-image-id')?.src || null;
    } catch(e) { return null; }
  })(),
})`

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
    return { domain: '', region: regionKey, name: `Product ${asin}`, image: '', price: 'N/A', currency: '', priceDisplay: 'N/A', asin, error: 'Unknown region' }
  }

  const na: CrawlResult = {
    domain: region.domain, region: region.region, name: `Product ${asin}`, image: '',
    price: 'N/A', currency: region.currency, priceDisplay: 'N/A', asin,
  }

  try {
    await killBrowser()

    const homeUrl = `https://www.${region.domain}/${region.tldPath ? region.tldPath + '/' : ''}`
    console.log(`[crawlRegion] Opening ${homeUrl}...`)
    await runBrowser(['open', homeUrl], 25000)

    const cookieScript = `document.cookie='i18n-prefs=${region.currencyCookie};path=/;domain=.${region.domain}';document.cookie='lc-main=${region.languageParam};path=/;domain=.${region.domain}';'done'`
    await runBrowser(['eval', cookieScript], 8000)

    const aodUrl = `https://www.${region.domain}/${region.tldPath ? region.tldPath + '/' : ''}dp/${asin}/ref=olp-opf-redir?aod=1&language=${region.languageParam}${region.postalCode ? `&postalCode=${region.postalCode}` : ''}`
    console.log(`[crawlRegion] Navigating to AOD: ${aodUrl}`)
    await runBrowser(['open', aodUrl], 45000)

    await runBrowser(['wait', '5000'], 8000)

    console.log(`[crawlRegion] Extracting AOD data for ${asin} on ${region.domain}...`)
    const rawResult = await runBrowser(['eval', AOD_EXTRACT_JS], 15000)

    let aodData: any
    try {
      const cleaned = rawResult.replace(/^"/, '').replace(/"$/, '').replace(/\\"/g, '"')
      aodData = JSON.parse(cleaned)
    } catch (e) {
      console.error(`[crawlRegion] Failed to parse AOD data:`, rawResult?.substring(0, 200))
      return { ...na, error: 'Failed to parse AOD data' }
    }

    console.log(`[crawlRegion] AOD data for ${asin} on ${region.domain}:`, JSON.stringify(aodData))

    if (aodData.noOffers) {
      return { ...na, name: aodData.name || na.name, image: aodData.image || na.image }
    }

    if (!aodData.hasAod) {
      return { ...na, name: aodData.name || na.name, image: aodData.image || na.image, error: 'AOD container not found' }
    }

    let priceResult: { price: string; currency: string } | null = null
    priceResult = parsePriceParts(aodData.pinnedPrice, region.currency)
    if (!priceResult) priceResult = parsePriceParts(aodData.price0, region.currency)
    if (!priceResult && aodData.atcLabel) priceResult = parseAtcLabel(aodData.atcLabel, region.currency)

    if (!priceResult || isNaN(parseFloat(priceResult.price)) || parseFloat(priceResult.price) <= 0) {
      return { ...na, name: aodData.name || na.name, image: aodData.image || na.image }
    }

    return {
      domain: region.domain, region: region.region,
      name: aodData.name || na.name, image: aodData.image || na.image,
      price: priceResult.price, currency: priceResult.currency,
      priceDisplay: formatPrice(priceResult.price, priceResult.currency),
      asin,
    }
  } catch (e) {
    console.error(`[crawlRegion] Error for ${asin} on ${region.domain}:`, e)
    return { ...na, error: String(e) }
  } finally {
    await killBrowser()
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HTTP SERVER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'crawl-service' })
    }

    // Crawl endpoint: POST /crawl
    if (url.pathname === '/crawl' && req.method === 'POST') {
      try {
        const body = await req.json() as { asin: string; regions: string[] }
        const { asin, regions } = body

        if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) {
          return Response.json({ success: false, error: 'Invalid ASIN' }, { status: 400 })
        }

        const cleanAsin = asin.trim().toUpperCase()
        const regionKeys = regions || Object.keys(REGIONS)

        console.log(`[crawl] Starting crawl for ${cleanAsin} in regions: ${regionKeys.join(',')}`)

        const results: CrawlResult[] = []
        for (const key of regionKeys) {
          const result = await crawlRegion(cleanAsin, key)
          results.push(result)
          if (regionKeys.indexOf(key) < regionKeys.length - 1) {
            await new Promise((r) => setTimeout(r, 2000))
          }
        }

        console.log(`[crawl] Results for ${cleanAsin}:`, JSON.stringify(results.map(r => ({ region: r.region, price: r.priceDisplay, error: r.error }))))

        return Response.json({ success: true, asin: cleanAsin, data: results })
      } catch (e) {
        console.error('[crawl] Error:', e)
        return Response.json({ success: false, error: String(e) }, { status: 500 })
      }
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  },
})

console.log(`🚀 Crawl service running on port ${PORT}`)
