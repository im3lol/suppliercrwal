/**
 * Amazon Offer Listing Price Crawler — z-ai-web-dev-sdk page_reader (TypeScript)
 *
 * ALL prices come from the Offer Listing page (All Offers Display) ONLY.
 * Uses z-ai-web-dev-sdk's page_reader function to fetch offer listing pages
 * with full HTML content (including JS-rendered prices).
 *
 * Previous Crawleo API approach has been replaced because the sandbox API key
 * expired ("sandbox is inactive" error). The z-ai-web-dev-sdk page_reader
 * provides the same functionality without needing an external API key.
 *
 * CRITICAL RULES:
 * - Prices MUST come from Offer Listing / AOD page ONLY
 * - URL pattern: https://www.amazon.{region}/gp/offer-listing/{ASIN}
 * - The offer-listing page shows all seller offers (same as AOD overlay)
 * - NO fallback to main page prices
 * - NO ATC button prices from non-AOD sections
 * - NO alternative/recommended product prices
 * - If no offers → return "N/A"
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface RegionConfig {
  domain: string
  region: string
  currency: string
  currencyCookie: string
  geo: string
  postalCode?: string
  offerListingPath: string
}

export const REGIONS: Record<string, RegionConfig> = {
  COM: {
    domain: 'amazon.com',
    region: 'COM',
    currency: 'USD',
    currencyCookie: 'USD',
    geo: 'us',
    postalCode: '99950',
    offerListingPath: '/gp/offer-listing/',
  },
  EG: {
    domain: 'amazon.eg',
    region: 'EG',
    currency: 'EGP',
    currencyCookie: 'EGP',
    geo: 'eg',
    offerListingPath: '/-/en/gp/offer-listing/',
  },
  DE: {
    domain: 'amazon.de',
    region: 'DE',
    currency: 'EUR',
    currencyCookie: 'EUR',
    geo: 'de',
    postalCode: '80331',
    offerListingPath: '/gp/offer-listing/',
  },
  SA: {
    domain: 'amazon.sa',
    region: 'SA',
    currency: 'SAR',
    currencyCookie: 'SAR',
    geo: 'sa',
    offerListingPath: '/-/en/gp/offer-listing/',
  },
  AE: {
    domain: 'amazon.ae',
    region: 'AE',
    currency: 'AED',
    currencyCookie: 'AED',
    geo: 'ae',
    offerListingPath: '/-/en/gp/offer-listing/',
  },
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '\u20ac',
  GBP: '\u00a3',
  EGP: 'EGP ',
  SAR: 'SAR ',
  AED: 'AED ',
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWL RESULT TYPE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface CrawlDebugInfo {
  url: string                // The URL that was fetched
  fetchMethod: string        // 'page_reader' or 'crawleo'
  pageStatusCode: number     // HTTP status of the crawled page
  htmlSize: number           // Size of raw HTML response
  markdownSize: number       // Size of markdown response (0 for page_reader)
  credits: number            // API credits used (0 for page_reader)
  timingMs: number           // Time taken for this crawl
  retryCount: number         // Number of retries
  errorMsg: string           // Error if any
  aodOfferCount: number      // AOD offer count found
  aPriceCount: number        // Number of a-price elements found
  parseStrategy: string      // Which parse strategy found the price
  rawPriceText: string       // The raw price text before parsing
}

export interface CrawlResult {
  domain: string
  region: string
  name: string
  image: string
  price: string       // numeric like "10.63" or "N/A"
  currency: string    // "EUR", "USD", etc.
  priceDisplay: string // formatted like "€10.63" or "N/A"
  asin: string
  error?: string
  debug?: CrawlDebugInfo
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PAGE READER FETCH (z-ai-web-dev-sdk)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface PageReaderResult {
  html: string
  title: string
  errorMsg: string
  retryCount: number
}

// Lazy-initialized ZAI singleton
let _zaiInstance: any = null

async function getZAI() {
  if (!_zaiInstance) {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    _zaiInstance = await ZAI.create()
  }
  return _zaiInstance
}

async function fetchWithPageReader(
  url: string,
  maxRetries = 2
): Promise<PageReaderResult> {
  let lastErrorMsg = ''

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[PageReader] Retry attempt ${attempt} for: ${url}`)
        await new Promise((r) => setTimeout(r, 2000 * attempt))
      } else {
        console.log(`[PageReader] Fetching: ${url}`)
      }

      const zai = await getZAI()
      const result = await zai.functions.invoke('page_reader', { url })

      // Check response structure
      if (!result || !result.data) {
        lastErrorMsg = 'Page reader returned no data'
        console.error(`[PageReader] No data returned (attempt ${attempt + 1}/${maxRetries + 1})`)
        if (attempt < maxRetries) continue
        return { html: '', title: '', errorMsg: lastErrorMsg, retryCount: attempt }
      }

      const html = result.data.html || ''
      const title = result.data.title || ''

      if (!html) {
        lastErrorMsg = 'Page reader returned empty HTML'
        console.error(`[PageReader] Empty HTML (attempt ${attempt + 1}/${maxRetries + 1})`)
        if (attempt < maxRetries) continue
        return { html: '', title: '', errorMsg: lastErrorMsg, retryCount: attempt }
      }

      console.log(`[PageReader] Success! HTML: ${html.length} chars, title: ${title}`)
      return { html, title, errorMsg: '', retryCount: attempt }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      lastErrorMsg = `PageReader error: ${msg}`
      console.error(`[PageReader] Error (attempt ${attempt + 1}/${maxRetries + 1}): ${msg}`)
      if (attempt < maxRetries) continue
      return { html: '', title: '', errorMsg: lastErrorMsg, retryCount: attempt }
    }
  }

  return { html: '', title: '', errorMsg: lastErrorMsg || 'Max retries exceeded', retryCount: maxRetries }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWLEO API FETCH (DEPRECATED — sandbox inactive, no longer used)
// This code is kept for reference but is never called anymore.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CRAWLEO_API_URL = 'https://api.crawleo.dev/crawl'

interface CrawleoResult {
  raw_html: string
  enhanced_html: string
  markdown: string
  debug: {
    crawleoHttpStatus: number
    pageStatusCode: number
    credits: number
    errorMsg: string
    retryCount: number
  }
}

async function fetchWithCrawleo(
  url: string,
  apiKey: string,
  geolocation?: string,
  maxRetries = 2
): Promise<CrawleoResult | null> {
  const params = new URLSearchParams({
    urls: url,
    render_js: 'true',
    raw_html: 'true',
    enhanced_html: 'true',
    markdown: 'true',
  })
  if (geolocation) {
    params.set('geolocation', geolocation)
  }

  const apiURL = `${CRAWLEO_API_URL}?${params.toString()}`
  let lastCrawleoStatus = 0
  let lastPageStatus = 0
  let lastErrorMsg = ''
  let lastCredits = 0

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[Crawleo] Retry attempt ${attempt} for: ${url}`)
        await new Promise((r) => setTimeout(r, 2000 * attempt))
      } else {
        console.log(`[Crawleo] Fetching: ${url} (geo=${geolocation})`)
      }

      const response = await fetch(apiURL, {
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(120000),
      })

      lastCrawleoStatus = response.status

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        lastErrorMsg = `Crawleo API HTTP ${response.status}: ${body.slice(0, 500)}`
        console.error(`[Crawleo] HTTP ${response.status} (attempt ${attempt + 1}/${maxRetries + 1}): ${body.slice(0, 300)}`)

        // Special handling for "sandbox is inactive" — retry with longer delay
        if (body.includes('sandbox is inactive')) {
          const sandboxDelay = 5000 * (attempt + 1)
          console.log(`[Crawleo] Sandbox inactive detected, waiting ${sandboxDelay}ms before retry...`)
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, sandboxDelay))
            continue
          }
          lastErrorMsg = `Crawleo API "sandbox is inactive" — Your API plan's sandbox/free tier has expired or been paused. Use the built-in page_reader method instead (no API key needed).`
        }

        if (attempt < maxRetries) continue
        return {
          raw_html: '', enhanced_html: '', markdown: '',
          debug: { crawleoHttpStatus: lastCrawleoStatus, pageStatusCode: 0, credits: 0, errorMsg: lastErrorMsg, retryCount: attempt }
        }
      }

      const data = await response.json()
      lastCredits = data.credits ?? 0

      if (data.error) {
        const errMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error)
        lastErrorMsg = `Crawleo API error: ${errMsg}`
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 2000 * attempt))
          continue
        }
        return {
          raw_html: '', enhanced_html: '', markdown: '',
          debug: { crawleoHttpStatus: lastCrawleoStatus, pageStatusCode: 0, credits: lastCredits, errorMsg: lastErrorMsg, retryCount: attempt }
        }
      }

      if (!data.results || data.results.length === 0) {
        lastErrorMsg = 'Crawleo returned no results'
        if (attempt < maxRetries) continue
        return {
          raw_html: '', enhanced_html: '', markdown: '',
          debug: { crawleoHttpStatus: lastCrawleoStatus, pageStatusCode: 0, credits: lastCredits, errorMsg: lastErrorMsg, retryCount: attempt }
        }
      }

      const result = data.results[0]
      const statusCode = result.status_code ?? 0
      lastPageStatus = statusCode
      const errorMsg = result.error ?? ''
      lastErrorMsg = errorMsg

      if (errorMsg) {
        if (attempt < maxRetries) continue
        return {
          raw_html: result.raw_html ?? '', enhanced_html: result.enhanced_html ?? '', markdown: result.markdown ?? '',
          debug: { crawleoHttpStatus: lastCrawleoStatus, pageStatusCode: statusCode, credits: lastCredits, errorMsg, retryCount: attempt }
        }
      }

      const rawHtml = result.raw_html ?? ''
      const enhancedHtml = result.enhanced_html ?? ''
      const markdown = result.markdown ?? ''
      const credits = data.credits ?? 0

      console.log(`[Crawleo] Success! Credits: ${credits}, raw_html: ${rawHtml.length} chars, markdown: ${markdown.length} chars`)
      return { raw_html: rawHtml, enhanced_html: enhancedHtml, markdown, debug: { crawleoHttpStatus: lastCrawleoStatus, pageStatusCode: statusCode, credits, errorMsg: '', retryCount: attempt } }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      lastErrorMsg = `Fetch error: ${msg}`
      console.error(`[Crawleo] Error (attempt ${attempt + 1}/${maxRetries + 1}): ${msg}`)
      if (attempt < maxRetries) continue
      return {
        raw_html: '', enhanced_html: '', markdown: '',
        debug: { crawleoHttpStatus: lastCrawleoStatus, pageStatusCode: 0, credits: lastCredits, errorMsg: lastErrorMsg, retryCount: attempt }
      }
    }
  }

  return {
    raw_html: '', enhanced_html: '', markdown: '',
    debug: { crawleoHttpStatus: lastCrawleoStatus, pageStatusCode: lastPageStatus, credits: lastCredits, errorMsg: lastErrorMsg || 'Max retries exceeded', retryCount: maxRetries }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function formatPriceDisplay(price: string, currency: string): string {
  if (price === 'N/A') return 'N/A'
  const num = parseFloat(price)
  if (isNaN(num)) return price
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency + ' '
  return `${symbol}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Remove thousands separators from whole number part */
function cleanWhole(wholeStr: string): string {
  return wholeStr.replace(/[,.\s\u200e\u200f]/g, '')
}

/** Identify currency from symbol or text */
function identifyCurrency(symbol: string, defaultCurrency: string): string {
  const s = symbol.trim().replace(/[\u200e\u200f]/g, '')
  if (s === '$') return 'USD'
  if (s === '\u20ac') return 'EUR'
  if (s === '\u00a3') return 'GBP'
  if (s.toUpperCase() === 'SAR') return 'SAR'
  if (s.toUpperCase() === 'AED') return 'AED'
  if (s.toUpperCase() === 'EGP') return 'EGP'
  // Arabic currency names
  if (s === '\u062c\u0646\u064a\u0647' || s === '\u062c.\u0645') return 'EGP'  // جنيه or ج.م
  if (s === '\u0631\u064a\u0627\u0644' || s === '\u0631.\u0633') return 'SAR'  // ريال or ر.س
  if (s === '\u062f\u0631\u0647\u0645' || s === '\u062f.\u0625') return 'AED'  // درهم or د.إ
  return defaultCurrency
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PRICE PARSING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface PriceResult {
  price: string
  currency: string
}

interface ParsedResult {
  price: string
  currency: string
  name: string
  image: string
  parseStrategy: string
  rawPriceText: string
  aodOfferCount: number
  aPriceCount: number
}

function parseNumberWithCurrency(numberStr: string, currency: string): PriceResult | null {
  const ns = numberStr.trim()

  const lastDot = ns.lastIndexOf('.')
  const lastComma = ns.lastIndexOf(',')

  if (lastDot === -1 && lastComma === -1) {
    const val = parseInt(ns, 10)
    if (val > 0) return { price: `${val}.00`, currency }
    return null
  }

  if (lastDot > lastComma) {
    // US/UK format: 3,400.00
    const wholePart = ns.slice(0, lastDot)
    const fracPart = ns.slice(lastDot + 1)
    if (fracPart.length === 2) {
      const wholeClean = cleanWhole(wholePart)
      const val = parseFloat(`${wholeClean}.${fracPart}`)
      if (val > 0) return { price: `${wholeClean}.${fracPart}`, currency }
    } else if (fracPart.length === 1) {
      const wholeClean = cleanWhole(wholePart)
      const val = parseFloat(`${wholeClean}.${fracPart}0`)
      if (val > 0) return { price: `${wholeClean}.${fracPart}0`, currency }
    }
  } else if (lastComma > lastDot) {
    // European format: 10,63 or 3.400,00
    const wholePart = ns.slice(0, lastComma)
    const fracPart = ns.slice(lastComma + 1)
    if (fracPart.length === 2) {
      const wholeClean = cleanWhole(wholePart)
      const val = parseFloat(`${wholeClean}.${fracPart}`)
      if (val > 0) return { price: `${wholeClean}.${fracPart}`, currency }
    }
  } else if (lastComma > -1) {
    // Only commas, no dots
    const fracPart = ns.slice(lastComma + 1)
    const wholePart = ns.slice(0, lastComma)
    if (fracPart.length === 2 && wholePart.length <= 3) {
      // European decimal: "10,63"
      const wholeClean = cleanWhole(wholePart)
      const val = parseFloat(`${wholeClean}.${fracPart}`)
      if (val > 0) return { price: `${wholeClean}.${fracPart}`, currency }
    } else if (fracPart.length === 3) {
      // Thousands separator: "1,200"
      const wholeClean = cleanWhole(ns)
      const val = parseFloat(wholeClean)
      if (val > 0) return { price: `${wholeClean}.00`, currency }
    }
  } else if (lastDot > -1) {
    // Only dots, no commas
    const fracPart = ns.slice(lastDot + 1)
    const wholePart = ns.slice(0, lastDot)
    if (fracPart.length === 2) {
      const wholeClean = cleanWhole(wholePart)
      const val = parseFloat(`${wholeClean}.${fracPart}`)
      if (val > 0) return { price: `${wholeClean}.${fracPart}`, currency }
    }
  }

  return null
}

function extractPriceFromText(text: string, defaultCurrency: string): PriceResult | null {
  if (!text) return null

  // Strip savings suffix
  let clean = text.replace(/\s+(with|mit|\u0645\u0639)\s+\d+\s+(percent|Prozent|\u0628\u0627\u0644\u0645\u0626\u0629|%)\s+(savings|Einsparungen|\u062a\u0648\u0641\u064a\u0631)/gi, '')
  clean = clean.trim()

  // Remove HTML entities and RTL/LTR marks
  clean = clean.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[\u200e\u200f]/g, '').trim()

  // Try EUR: "€10.63" or "€10,63"
  let m = clean.match(/\u20ac\s*([\d.,]+)/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'EUR')
    if (r) return r
  }

  // Try EUR reversed: "10,63 €"
  m = clean.match(/([\d.,]+)\s*\u20ac/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'EUR')
    if (r) return r
  }

  // Try USD: "$20.25"
  m = clean.match(/\$\s*([\d.,]+)/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'USD')
    if (r) return r
  }

  // Try SAR: "SAR 113.38"
  m = clean.match(/SAR\s*([\d.,]+)/i)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'SAR')
    if (r) return r
  }

  // Try AED: "AED 76.38"
  m = clean.match(/AED\s*([\d.,]+)/i)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'AED')
    if (r) return r
  }

  // Try EGP: "EGP 150.00"
  m = clean.match(/EGP\s*([\d.,]+)/i)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'EGP')
    if (r) return r
  }

  // Arabic "جنيه" (EGP)
  m = clean.match(/\u062c\u0646\u064a\u0647\s*([\d.,]+)/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'EGP')
    if (r) return r
  }
  m = clean.match(/([\d.,]+)\s*\u062c\u0646\u064a\u0647/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'EGP')
    if (r) return r
  }

  // Arabic "ريال" (SAR)
  m = clean.match(/\u0631\u064a\u0627\u0644\s*([\d.,]+)/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'SAR')
    if (r) return r
  }
  m = clean.match(/([\d.,]+)\s*\u0631\u064a\u0627\u0644/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'SAR')
    if (r) return r
  }

  // Arabic "ر.س" (SAR abbreviation)
  m = clean.match(/\u0631\.\u0633\s*([\d.,]+)/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'SAR')
    if (r) return r
  }

  // Arabic "درهم" (AED)
  m = clean.match(/\u062f\u0631\u0647\u0645\s*([\d.,]+)/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'AED')
    if (r) return r
  }
  m = clean.match(/([\d.,]+)\s*\u062f\u0631\u0647\u0645/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'AED')
    if (r) return r
  }

  // Arabic "د.إ" (AED abbreviation)
  m = clean.match(/\u062f\.\u0625\s*([\d.,]+)/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'AED')
    if (r) return r
  }

  // Last resort: just a number
  m = clean.match(/([\d.,]+)/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], defaultCurrency)
    if (r) return r
  }

  return null
}

function extractPriceFromMarkdown(md: string, defaultCurrency: string): PriceResult | null {
  let m: RegExpMatchArray | null

  // "10,63 €" compact
  m = md.match(/([\d.,]+)\s*\u20ac/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'EUR')
    if (r) return r
  }

  // "€10.63" prefix
  m = md.match(/\u20ac\s*([\d.,]+)/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'EUR')
    if (r) return r
  }

  // "$17.49"
  m = md.match(/\$\s*([\d.,]+)/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'USD')
    if (r) return r
  }

  // SAR
  m = md.match(/SAR\s*([\d.,]+)/i)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'SAR')
    if (r) return r
  }

  // AED
  m = md.match(/AED\s*([\d.,]+)/i)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'AED')
    if (r) return r
  }

  // EGP
  m = md.match(/EGP\s*([\d.,]+)/i)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'EGP')
    if (r) return r
  }

  // Arabic "جنيه" (EGP)
  m = md.match(/\u062c\u0646\u064a\u0647\s*([\d.,]+)/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'EGP')
    if (r) return r
  }
  m = md.match(/([\d.,]+)\s*\u062c\u0646\u064a\u0647/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'EGP')
    if (r) return r
  }

  // Arabic "ريال" (SAR)
  m = md.match(/\u0631\u064a\u0627\u0644\s*([\d.,]+)/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'SAR')
    if (r) return r
  }
  m = md.match(/([\d.,]+)\s*\u0631\u064a\u0627\u0644/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'SAR')
    if (r) return r
  }

  // Arabic "درهم" (AED)
  m = md.match(/\u062f\u0631\u0647\u0645\s*([\d.,]+)/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'AED')
    if (r) return r
  }
  m = md.match(/([\d.,]+)\s*\u062f\u0631\u0647\u0645/)
  if (m) {
    const r = parseNumberWithCurrency(m[1], 'AED')
    if (r) return r
  }

  return null
}

function parsePrice(rawHtml: string, markdown: string, regionKey: string): ParsedResult {
  const region = REGIONS[regionKey] ?? REGIONS.COM!
  const defaultCurrency = region.currency

  // Strip RTL/LTR marks for cleaner matching
  const htmlClean = rawHtml.replace(/[\u200e\u200f]/g, '')
  const mdClean = markdown.replace(/[\u200e\u200f]/g, '')

  // ── Extract product name ──
  let name = ''
  const titleMatch = htmlClean.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch) {
    let rawTitle = titleMatch[1].trim()
    rawTitle = rawTitle.replace(/\s*[:|]\s*Amazon\.\w+\s*$/, '')
    rawTitle = rawTitle.replace(/\s*:\s*Online.*$/i, '')
    // Remove rating patterns in all languages
    rawTitle = rawTitle.replace(/\s+\d+[.,]\d+\s+(von|out of|من)\s+\d+\s+(Sternen|stars|نجوم).*$/i, '')
    // Remove "new" / "neu" / "جديد" and everything after
    rawTitle = rawTitle.replace(/\s+(neu|new|جديد|تمت الإضافة).*$/i, '')
    if (rawTitle) name = rawTitle.slice(0, 300).trim()
  }

  // Fallback: first heading in markdown
  if (!name) {
    const nameMatch = mdClean.match(/^#{1,5}\s+(.+?)(?:\n|$)/)
    if (nameMatch) {
      let rawName = nameMatch[1].trim()
      // Truncate at rating patterns
      const ratingCut = rawName.match(/^(.+?)(?:\s+\d+[.,]\d+\s+(von|out of|من)\s+\d+\s+(Sternen|stars|نجوم))/)
      if (ratingCut) {
        name = ratingCut[1].trim().slice(0, 300)
      } else {
        name = rawName.slice(0, 300)
      }
    }
  }

  // Clean up name: remove trailing price/coupon text
  name = name.replace(/\s+\d+[.,]\d+\s*(جنيه|ريال|درهم|EGP|SAR|AED|\$|€).*$/i, '')
  name = name.replace(/\s+(تسجيل الدخول|Sign in|Anmelden).*$/i, '')
  name = name.trim()

  // ── Extract product image ──
  let image = ''
  const imgMatch = htmlClean.match(/src=["']?(https?:\/\/[^"'>\s]*images-amazon[^"'>\s]*\/images\/I\/[^"'>\s]+)/)
  if (imgMatch) {
    image = imgMatch[1]
  }

  // ── Check for truly no offers ──
  const offerCountMatch =
    htmlClean.match(/id="aod-total-offer-count"[^>]*value="(\d+)"/) ??
    htmlClean.match(/value="(\d+)"[^>]*id="aod-total-offer-count"/)

  const totalOffers = offerCountMatch ? parseInt(offerCountMatch[1], 10) : -1
  console.log(`[Parse] aod-total-offer-count = ${totalOffers}`)

  const priceElements = htmlClean.match(/id="aod-price-\d+"/g) ?? []
  const hasPriceElements = priceElements.length > 0
  console.log(`[Parse] aod-price-* elements found: ${priceElements.length}`)

  // Also check for a-price elements (used on offer-listing pages)
  const aPriceElements = htmlClean.match(/class="[^"]*a-price[^"]*"/g) ?? []
  const hasAPriceElements = aPriceElements.length > 0
  console.log(`[Parse] a-price elements found: ${aPriceElements.length}`)

  // Check for no-offer phrases
  const lowerHtml = htmlClean.toLowerCase()
  const lowerMd = mdClean.toLowerCase()
  const noOfferPhrases = [
    'no featured offers available',
    'no featured offers',
    'currently unavailable',
    'no offers available',
    'no sellers',
    'لا يوجد بائعون',
    'لا يتوفر',
  ]
  const hasNoOfferPhrase = noOfferPhrases.some(p => lowerHtml.includes(p) || lowerMd.includes(p))

  // Only return N/A if confirmed no offers
  if (totalOffers === 0 && !hasPriceElements && !hasAPriceElements) {
    console.log(`[Parse] No offers at all (offer-count=0, no price elements) → N/A`)
    return { price: 'N/A', currency: defaultCurrency, name, image, parseStrategy: 'no-offers', rawPriceText: `offerCount=${totalOffers}, aPriceCount=${aPriceElements.length}`, aodOfferCount: totalOffers, aPriceCount: aPriceElements.length }
  }

  if (hasNoOfferPhrase && !hasAPriceElements && !hasPriceElements) {
    console.log(`[Parse] No offers detected (no-offer phrases, no price elements) → N/A`)
    return { price: 'N/A', currency: defaultCurrency, name, image, parseStrategy: 'no-offer-phrases', rawPriceText: `no-offer phrases found`, aodOfferCount: totalOffers, aPriceCount: aPriceElements.length }
  }

  // ━━━ Strategy 1: Accessibility label (BEST) ━━━
  const accRegex = /<span[^>]*class="[^"]*aok-offscreen[^"]*apex-pricetopay[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/g
  let accMatch: RegExpExecArray | null
  while ((accMatch = accRegex.exec(htmlClean)) !== null) {
    const accText = accMatch[1].trim()
    const priceResult = extractPriceFromText(accText, defaultCurrency)
    if (priceResult) {
      console.log(`[Parse] Price from accessibility label: ${accText} -> ${JSON.stringify(priceResult)}`)
      return { ...priceResult, name, image, parseStrategy: 'accessibility-label', rawPriceText: accText, aodOfferCount: totalOffers, aPriceCount: aPriceElements.length }
    }
  }

  // ━━━ Strategy 2: a-price components ━━━
  const priceBlockRegex =
    /<span[^>]*class="[^"]*a-price[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*a-price-symbol[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>[\s\S]*?<span[^>]*class="[^"]*a-price-whole[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]*class="[^"]*a-price-fraction[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/g

  const priceBlock = priceBlockRegex.exec(htmlClean)
  if (priceBlock) {
    const symbol = priceBlock[1].trim()
    // Strip any inner HTML tags from the "whole" part (e.g. <span class="a-price-decimal">.</span>)
    const wholeRaw = priceBlock[2].trim().replace(/<[^>]+>/g, '').replace(/[,.]$/, '')
    const fraction = priceBlock[3].trim()
    const wholeClean = cleanWhole(wholeRaw)
    try {
      const priceVal = parseFloat(`${wholeClean}.${fraction}`)
      if (priceVal > 0) {
        const currency = identifyCurrency(symbol, defaultCurrency)
        console.log(`[Parse] Price from a-price components: ${symbol}${wholeRaw}.${fraction} -> ${wholeClean}.${fraction} ${currency}`)
        return { price: `${wholeClean}.${fraction}`, currency, name, image, parseStrategy: 'a-price-components', rawPriceText: `${symbol}${wholeRaw}.${fraction}`, aodOfferCount: totalOffers, aPriceCount: aPriceElements.length }
      }
    } catch {
      // fall through
    }
  }

  // ━━━ Strategy 3: a-offscreen text ━━━
  // a-offscreen can contain both prices and non-price content (product names, etc.)
  // We must require an explicit currency indicator to avoid false matches
  const CURRENCY_INDICATORS = /[\$€£]|\b(USD|EUR|GBP|EGP|SAR|AED)\b|\u062c\u0646\u064a\u0647|\u0631\u064a\u0627\u0644|\u062f\u0631\u0647\u0645|\u062c\.\u0645|\u0631\.\u0633|\u062f\.\u0625/i
  const aOffscreenRegex = /<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/g
  let offscreenMatch: RegExpExecArray | null
  while ((offscreenMatch = aOffscreenRegex.exec(htmlClean)) !== null) {
    const priceText = offscreenMatch[1].trim()
    // Skip text that doesn't contain a currency indicator (e.g. product names like "Apple 2022 iPad Air")
    if (!CURRENCY_INDICATORS.test(priceText)) {
      continue
    }
    const priceResult = extractPriceFromText(priceText, defaultCurrency)
    if (priceResult) {
      try {
        const val = parseFloat(priceResult.price)
        if (val >= 0.5) {
          console.log(`[Parse] Price from a-offscreen: ${priceText} -> ${JSON.stringify(priceResult)}`)
          return { ...priceResult, name, image, parseStrategy: 'a-offscreen', rawPriceText: priceText, aodOfferCount: totalOffers, aPriceCount: aPriceElements.length }
        }
      } catch {
        // fall through
      }
    }
  }

  // ━━━ Strategy 4: Markdown patterns ━━━
  const mdPriceResult = extractPriceFromMarkdown(mdClean, defaultCurrency)
  if (mdPriceResult) {
    console.log(`[Parse] Price from markdown: ${JSON.stringify(mdPriceResult)}`)
    return { ...mdPriceResult, name, image, parseStrategy: 'markdown', rawPriceText: mdClean.slice(0, 100), aodOfferCount: totalOffers, aPriceCount: aPriceElements.length }
  }

  // ── Fallback: check for no-offer phrases if we couldn't find a price ──
  if (!hasAPriceElements && !hasPriceElements) {
    const noOtherSellers = lowerHtml.includes('no other sellers') || lowerMd.includes('no other sellers')
    const noSellersAr = lowerHtml.includes('\u0644\u0627 \u064a\u0648\u062c\u062f \u0628\u0627\u0626\u0639\u0648\u0646 \u0622\u062e\u0631\u0648\u0646') || lowerHtml.includes('\u0644\u0627 \u064a\u0648\u062c\u062f \u062d\u0627\u0644\u064a\u0627\u064b \u0628\u0627\u0626\u0639\u0648\u0646')

    if (hasNoOfferPhrase && (noOtherSellers || noSellersAr || totalOffers === -1)) {
      console.log(`[Parse] No offers detected (no featured + no other sellers) → N/A`)
      return { price: 'N/A', currency: defaultCurrency, name, image, parseStrategy: 'fallback-no-offers', rawPriceText: 'no other sellers', aodOfferCount: totalOffers, aPriceCount: aPriceElements.length }
    }
  }

  console.log(`[Parse] No price found for ${regionKey} → N/A`)
  return { price: 'N/A', currency: defaultCurrency, name, image, parseStrategy: 'no-price-found', rawPriceText: '', aodOfferCount: totalOffers, aPriceCount: aPriceElements.length }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWL ONE REGION — z-ai page_reader only (Crawleo removed)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Crawl a single ASIN on a single region.
 *
 * Uses z-ai-web-dev-sdk's page_reader exclusively (no API key needed).
 * Crawleo API has been removed because the sandbox is inactive.
 *
 * Prices come from Offer Listing page ONLY. If no offers → N/A.
 */
export async function crawlRegion(
  asin: string,
  regionKey: string,
  _crawleoApiKey?: string  // kept for API compatibility but ignored
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

  // Initialize the detailed log builder
  const { CrawlLogBuilder, addLog } = await import('./crawl-logger')
  const logBuilder = new CrawlLogBuilder(asin, regionKey)

  try {
    console.log(`[crawlRegion] Crawling ${asin} on ${region.domain}...`)
    const startTime = Date.now()

    // Build offer-listing URL
    const offerPath = region.offerListingPath || '/gp/offer-listing/'
    const url = `https://www.${region.domain}${offerPath}${asin}`

    // Log request details
    logBuilder.setRequest({
      crawleoApiUrl: 'z-ai page_reader (Crawleo removed — sandbox inactive)',
      targetUrl: url,
      geolocation: region.geo,
      apiKey: '(page_reader - no key needed)',
    })

    console.log(`[crawlRegion] Request: URL=${url}, method=page_reader`)

    let rawHtml = ''
    let markdown = ''
    let errorMsg = ''
    let retryCount = 0

    // ── Always use z-ai-web-dev-sdk page_reader (no API key needed) ──
    const prResult = await fetchWithPageReader(url)
    rawHtml = prResult.html
    errorMsg = prResult.errorMsg
    retryCount = prResult.retryCount

    // page_reader returns HTML content directly — no separate markdown
    // We can generate a simple text version from the HTML for markdown-based parsing
    markdown = rawHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000)

    const timingMs = Date.now() - startTime

    // Log response details
    logBuilder.setResponse({
      crawleoHttpStatus: 200,
      pageStatusCode: 200,
      credits: 0,
      retryCount: retryCount,
      timingMs,
      errorMsg: errorMsg,
    })

    console.log(`[crawlRegion] Response: method=page_reader, html=${rawHtml.length} chars, md=${markdown.length} chars, time=${timingMs}ms`)

    const debugBase: CrawlDebugInfo = {
      url,
      fetchMethod: 'page_reader',
      pageStatusCode: 200,
      htmlSize: rawHtml.length,
      markdownSize: markdown.length,
      credits: 0,
      timingMs,
      retryCount,
      errorMsg,
      aodOfferCount: -1,
      aPriceCount: -1,
      parseStrategy: '',
      rawPriceText: '',
    }

    if (!rawHtml) {
      const errMsg = errorMsg || 'Failed to fetch offer listing page'
      logBuilder.setResult('N/A', 'N/A', errMsg)
      addLog(logBuilder.build())
      return { ...na, error: errMsg, debug: debugBase }
    }

    // Log content analysis
    logBuilder.setContent(rawHtml, markdown)

    console.log(`[crawlRegion] Content analysis: htmlSize=${rawHtml.length}, mdSize=${markdown.length}`)

    const parsed = parsePrice(rawHtml, markdown, regionKey)

    // Log parsing details with step-by-step strategy attempts
    const strategyLog = buildStrategyLog(rawHtml, markdown, regionKey, parsed)
    logBuilder.setParsing({
      strategy: parsed.parseStrategy,
      rawPriceText: parsed.rawPriceText,
      parsedPrice: parsed.price,
      currency: parsed.currency,
      aodOfferCount: parsed.aodOfferCount,
      aPriceCount: parsed.aPriceCount,
    })
    for (const sl of strategyLog) {
      logBuilder.addStrategyLog(sl)
    }

    const result: CrawlResult = {
      domain: region.domain,
      region: region.region,
      name: parsed.name || `Product ${asin}`,
      image: parsed.image || '',
      price: parsed.price,
      currency: parsed.currency,
      priceDisplay: formatPriceDisplay(parsed.price, parsed.currency),
      asin,
      debug: {
        ...debugBase,
        aodOfferCount: parsed.aodOfferCount,
        aPriceCount: parsed.aPriceCount,
        parseStrategy: parsed.parseStrategy,
        rawPriceText: parsed.rawPriceText,
      },
    }

    logBuilder.setResult(result.price, result.priceDisplay, result.error || '')
    addLog(logBuilder.build())

    console.log(`[crawlRegion] Result for ${asin} on ${region.domain}: price=${result.price} display=${result.priceDisplay} (${parsed.parseStrategy}, ${timingMs}ms)`)
    return result
  } catch (e) {
    const errMsg = String(e)
    console.error(`[crawlRegion] Error for ${asin} on ${region.domain}:`, e)
    logBuilder.setResult('N/A', 'N/A', errMsg)
    addLog(logBuilder.build())
    return { ...na, error: errMsg }
  }
}

/**
 * Build step-by-step strategy log for debugging price parsing
 */
function buildStrategyLog(html: string, markdown: string, regionKey: string, parsed: ParsedResult): import('./crawl-logger').StrategyLogEntry[] {
  const logs: import('./crawl-logger').StrategyLogEntry[] = []
  const region = REGIONS[regionKey] ?? REGIONS.COM!
  const htmlClean = html.replace(/[\u200e\u200f]/g, '')
  const mdClean = markdown.replace(/[\u200e\u200f]/g, '')

  // Strategy 0: No-offer detection
  const lowerHtml = htmlClean.toLowerCase()
  const lowerMd = mdClean.toLowerCase()
  const noOfferPhrases = ['no featured offers', 'currently unavailable', 'no offers', 'no sellers', 'no other sellers']
  const foundNoOffer = noOfferPhrases.filter(p => lowerHtml.includes(p) || lowerMd.includes(p))
  logs.push({
    strategy: 'no-offer-detection',
    attempted: true,
    matched: foundNoOffer.length > 0,
    rawMatch: foundNoOffer.join(', ') || 'none',
    parsedValue: '',
    notes: foundNoOffer.length > 0 ? `Found phrases: ${foundNoOffer.join(', ')}` : 'No no-offer phrases found',
  })

  // Strategy 1: Accessibility label
  const accRegex = /<span[^>]*class="[^"]*aok-offscreen[^"]*apex-pricetopay[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/g
  let accMatch: RegExpExecArray | null
  const accMatches: string[] = []
  while ((accMatch = accRegex.exec(htmlClean)) !== null) {
    accMatches.push(accMatch[1].trim())
  }
  logs.push({
    strategy: 'accessibility-label',
    attempted: true,
    matched: accMatches.length > 0 && parsed.parseStrategy === 'accessibility-label',
    rawMatch: accMatches.join(' | ') || 'none',
    parsedValue: parsed.parseStrategy === 'accessibility-label' ? parsed.price : '',
    notes: accMatches.length > 0 ? `Found ${accMatches.length} accessibility label(s)` : 'No accessibility labels found',
  })

  // Strategy 2: a-price components
  const priceBlockRegex = /<span[^>]*class="[^"]*a-price[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*a-price-symbol[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>[\s\S]*?<span[^>]*class="[^"]*a-price-whole[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]*class="[^"]*a-price-fraction[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/g
  const priceBlock = priceBlockRegex.exec(htmlClean)
  logs.push({
    strategy: 'a-price-components',
    attempted: true,
    matched: !!priceBlock && parsed.parseStrategy === 'a-price-components',
    rawMatch: priceBlock ? `symbol=${priceBlock[1]}, whole=${priceBlock[2].replace(/<[^>]+>/g, '')}, fraction=${priceBlock[3]}` : 'none',
    parsedValue: parsed.parseStrategy === 'a-price-components' ? parsed.price : '',
    notes: priceBlock ? 'Found a-price component block' : 'No a-price component blocks found',
  })

  // Strategy 3: a-offscreen
  const offscreenRegex = /<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/g
  const offscreenMatches: string[] = []
  let osMatch: RegExpExecArray | null
  while ((osMatch = offscreenRegex.exec(htmlClean)) !== null) {
    offscreenMatches.push(osMatch[1].trim())
  }
  logs.push({
    strategy: 'a-offscreen',
    attempted: true,
    matched: offscreenMatches.length > 0 && parsed.parseStrategy === 'a-offscreen',
    rawMatch: offscreenMatches.slice(0, 5).join(' | ') || 'none',
    parsedValue: parsed.parseStrategy === 'a-offscreen' ? parsed.price : '',
    notes: offscreenMatches.length > 0 ? `Found ${offscreenMatches.length} a-offscreen element(s)` : 'No a-offscreen elements found',
  })

  // Strategy 4: Markdown
  const mdPricePatterns = [
    { name: 'EUR postfix', regex: /([\d.,]+)\s*\u20ac/ },
    { name: 'EUR prefix', regex: /\u20ac\s*([\d.,]+)/ },
    { name: 'USD', regex: /\$\s*([\d.,]+)/ },
    { name: 'SAR', regex: /SAR\s*([\d.,]+)/i },
    { name: 'AED', regex: /AED\s*([\d.,]+)/i },
    { name: 'EGP', regex: /EGP\s*([\d.,]+)/i },
  ]
  const mdMatches: string[] = []
  for (const pat of mdPricePatterns) {
    const m = mdClean.match(pat.regex)
    if (m) mdMatches.push(`${pat.name}=${m[0]}`)
  }
  logs.push({
    strategy: 'markdown',
    attempted: true,
    matched: parsed.parseStrategy === 'markdown',
    rawMatch: mdMatches.join(', ') || 'none',
    parsedValue: parsed.parseStrategy === 'markdown' ? parsed.price : '',
    notes: mdMatches.length > 0 ? `Found ${mdMatches.length} markdown price pattern(s)` : 'No markdown price patterns found',
  })

  return logs
}
