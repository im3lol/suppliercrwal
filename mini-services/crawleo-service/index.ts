/**
 * Crawleo AOD Crawler Mini-Service
 *
 * Fetches Amazon AOD pages via Crawleo API and extracts prices.
 * Runs on port 3002 to avoid crashing the Next.js dev server.
 *
 * CRITICAL RULES:
 * - Prices MUST come from AOD AJAX endpoint ONLY
 * - If AOD has no offers → return N/A
 */

import { serve } from 'bun'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const PORT = 3002

interface RegionConfig {
  domain: string
  currency: string
  geo: string
}

const REGIONS: Record<string, RegionConfig> = {
  COM: { domain: 'amazon.com', currency: 'USD', geo: 'us' },
  EG: { domain: 'amazon.eg', currency: 'EGP', geo: 'eg' },
  DE: { domain: 'amazon.de', currency: 'EUR', geo: 'de' },
  SA: { domain: 'amazon.sa', currency: 'SAR', geo: 'sa' },
  AE: { domain: 'amazon.ae', currency: 'AED', geo: 'ae' },
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '\u20ac',
  GBP: '\u00a3',
  EGP: 'EGP ',
  SAR: 'SAR ',
  AED: 'AED ',
}

const CRAWLEO_API_URL = 'https://api.crawleo.dev/crawl'

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

function cleanWhole(wholeStr: string): string {
  return wholeStr.replace(/[,.\s\u200e\u200f]/g, '')
}

function identifyCurrency(symbol: string, defaultCurrency: string): string {
  const s = symbol.trim().replace(/[\u200e\u200f]/g, '')
  if (s === '$') return 'USD'
  if (s === '\u20ac') return 'EUR'
  if (s === '\u00a3') return 'GBP'
  if (s.toUpperCase() === 'SAR') return 'SAR'
  if (s.toUpperCase() === 'AED') return 'AED'
  if (s.toUpperCase() === 'EGP') return 'EGP'
  if (s === '\u062c\u0646\u064a\u0647' || s === '\u062c.\u0645') return 'EGP'
  if (s === '\u0631\u064a\u0627\u0644' || s === '\u0631.\u0633') return 'SAR'
  if (s === '\u062f\u0631\u0647\u0645' || s === '\u062f.\u0625') return 'AED'
  return defaultCurrency
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWLEO API FETCH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface CrawleoResult {
  raw_html: string
  enhanced_html: string
  markdown: string
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

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[Crawleo] Retry attempt ${attempt} for: ${url}`)
        await new Promise((r) => setTimeout(r, 2000 * attempt))
      } else {
        console.log(`[Crawleo] Fetching: ${url} (geo=${geolocation})`)
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 120000)

      const response = await fetch(apiURL, {
        headers: { 'x-api-key': apiKey },
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        console.error(`[Crawleo] HTTP ${response.status} (attempt ${attempt + 1}/${maxRetries + 1}): ${body.slice(0, 300)}`)
        if (attempt < maxRetries) continue
        return null
      }

      const data = await response.json() as any

      if (!data.results || data.results.length === 0) {
        console.error(`[Crawleo] No results returned`)
        if (attempt < maxRetries) continue
        return null
      }

      const result = data.results[0]
      const statusCode = result.status_code ?? 0
      const errorMsg = result.error ?? ''

      if (errorMsg) {
        console.error(`[Crawleo] Error in result: ${errorMsg}`)
        if (attempt < maxRetries) continue
        return null
      }

      if (![200, 404].includes(statusCode)) {
        console.error(`[Crawleo] Page status: ${statusCode}`)
        if (attempt < maxRetries) continue
        return null
      }

      const rawHtml = result.raw_html ?? ''
      const enhancedHtml = result.enhanced_html ?? ''
      const markdown = result.markdown ?? ''
      const credits = data.credits ?? 0

      console.log(`[Crawleo] Success! Credits: ${credits}, raw_html: ${rawHtml.length} chars, markdown: ${markdown.length} chars`)
      return { raw_html: rawHtml, enhanced_html: enhancedHtml, markdown }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[Crawleo] Error (attempt ${attempt + 1}/${maxRetries + 1}): ${msg}`)
      if (attempt < maxRetries) continue
      return null
    }
  }

  return null
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
    const wholePart = ns.slice(0, lastComma)
    const fracPart = ns.slice(lastComma + 1)
    if (fracPart.length === 2) {
      const wholeClean = cleanWhole(wholePart)
      const val = parseFloat(`${wholeClean}.${fracPart}`)
      if (val > 0) return { price: `${wholeClean}.${fracPart}`, currency }
    }
  } else if (lastComma > -1) {
    const fracPart = ns.slice(lastComma + 1)
    const wholePart = ns.slice(0, lastComma)
    if (fracPart.length === 2 && wholePart.length <= 3) {
      const wholeClean = cleanWhole(wholePart)
      const val = parseFloat(`${wholeClean}.${fracPart}`)
      if (val > 0) return { price: `${wholeClean}.${fracPart}`, currency }
    } else if (fracPart.length === 3) {
      const wholeClean = cleanWhole(ns)
      const val = parseFloat(wholeClean)
      if (val > 0) return { price: `${wholeClean}.00`, currency }
    }
  } else if (lastDot > -1) {
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

  let clean = text.replace(/\s+(with|mit|\u0645\u0639)\s+\d+\s+(percent|Prozent|\u0628\u0627\u0644\u0645\u0626\u0629|%)\s+(savings|Einsparungen|\u062a\u0648\u0641\u064a\u0631)/gi, '')
  clean = clean.trim()
  clean = clean.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[\u200e\u200f]/g, '').trim()

  let m: RegExpMatchArray | null

  m = clean.match(/\u20ac\s*([\d.,]+)/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'EUR'); if (r) return r }
  m = clean.match(/([\d.,]+)\s*\u20ac/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'EUR'); if (r) return r }
  m = clean.match(/\$\s*([\d.,]+)/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'USD'); if (r) return r }
  m = clean.match(/SAR\s*([\d.,]+)/i)
  if (m) { const r = parseNumberWithCurrency(m[1], 'SAR'); if (r) return r }
  m = clean.match(/AED\s*([\d.,]+)/i)
  if (m) { const r = parseNumberWithCurrency(m[1], 'AED'); if (r) return r }
  m = clean.match(/EGP\s*([\d.,]+)/i)
  if (m) { const r = parseNumberWithCurrency(m[1], 'EGP'); if (r) return r }
  m = clean.match(/\u062c\u0646\u064a\u0647\s*([\d.,]+)/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'EGP'); if (r) return r }
  m = clean.match(/([\d.,]+)\s*\u062c\u0646\u064a\u0647/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'EGP'); if (r) return r }
  m = clean.match(/\u0631\u064a\u0627\u0644\s*([\d.,]+)/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'SAR'); if (r) return r }
  m = clean.match(/([\d.,]+)\s*\u0631\u064a\u0627\u0644/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'SAR'); if (r) return r }
  m = clean.match(/\u0631\.\u0633\s*([\d.,]+)/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'SAR'); if (r) return r }
  m = clean.match(/\u062f\u0631\u0647\u0645\s*([\d.,]+)/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'AED'); if (r) return r }
  m = clean.match(/([\d.,]+)\s*\u062f\u0631\u0647\u0645/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'AED'); if (r) return r }
  m = clean.match(/\u062f\.\u0625\s*([\d.,]+)/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'AED'); if (r) return r }

  m = clean.match(/([\d.,]+)/)
  if (m) { const r = parseNumberWithCurrency(m[1], defaultCurrency); if (r) return r }

  return null
}

function extractPriceFromMarkdown(md: string, defaultCurrency: string): PriceResult | null {
  let m: RegExpMatchArray | null

  m = md.match(/([\d.,]+)\s*\u20ac/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'EUR'); if (r) return r }
  m = md.match(/\u20ac\s*([\d.,]+)/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'EUR'); if (r) return r }
  m = md.match(/\$\s*([\d.,]+)/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'USD'); if (r) return r }
  m = md.match(/SAR\s*([\d.,]+)/i)
  if (m) { const r = parseNumberWithCurrency(m[1], 'SAR'); if (r) return r }
  m = md.match(/AED\s*([\d.,]+)/i)
  if (m) { const r = parseNumberWithCurrency(m[1], 'AED'); if (r) return r }
  m = md.match(/EGP\s*([\d.,]+)/i)
  if (m) { const r = parseNumberWithCurrency(m[1], 'EGP'); if (r) return r }
  m = md.match(/\u062c\u0646\u064a\u0647\s*([\d.,]+)/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'EGP'); if (r) return r }
  m = md.match(/([\d.,]+)\s*\u062c\u0646\u064a\u0647/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'EGP'); if (r) return r }
  m = md.match(/\u0631\u064a\u0627\u0644\s*([\d.,]+)/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'SAR'); if (r) return r }
  m = md.match(/([\d.,]+)\s*\u0631\u064a\u0627\u0644/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'SAR'); if (r) return r }
  m = md.match(/\u062f\u0631\u0647\u0645\s*([\d.,]+)/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'AED'); if (r) return r }
  m = md.match(/([\d.,]+)\s*\u062f\u0631\u0647\u0645/)
  if (m) { const r = parseNumberWithCurrency(m[1], 'AED'); if (r) return r }

  return null
}

function parsePrice(rawHtml: string, markdown: string, regionKey: string): ParsedResult {
  const region = REGIONS[regionKey] ?? REGIONS.COM!
  const defaultCurrency = region.currency

  const htmlClean = rawHtml.replace(/[\u200e\u200f]/g, '')
  const mdClean = markdown.replace(/[\u200e\u200f]/g, '')

  // ── Extract product name ──
  let name = ''
  const titleMatch = htmlClean.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch) {
    let rawTitle = titleMatch[1].trim()
    rawTitle = rawTitle.replace(/\s*[:|]\s*Amazon\.\w+\s*$/, '')
    rawTitle = rawTitle.replace(/\s*:\s*Online.*$/i, '')
    rawTitle = rawTitle.replace(/\s+\d+[.,]\d+\s+(von|out of|\u0645\u0646)\s+\d+\s+(Sternen|stars|\u0646\u062c\u0648\u0645).*$/i, '')
    rawTitle = rawTitle.replace(/\s+(neu|new|\u062c\u062f\u064a\u062f|\u062a\u0645\u062a \u0627\u0644\u0625\u0636\u0627\u0641\u0629).*$/i, '')
    if (rawTitle) name = rawTitle.slice(0, 300).trim()
  }

  if (!name) {
    const nameMatch = mdClean.match(/^#{1,5}\s+(.+?)(?:\n|$)/)
    if (nameMatch) {
      let rawName = nameMatch[1].trim()
      const ratingCut = rawName.match(/^(.+?)(?:\s+\d+[.,]\d+\s+(von|out of|\u0645\u0646)\s+\d+\s+(Sternen|stars|\u0646\u062c\u0648\u0645))/)
      if (ratingCut) {
        name = ratingCut[1].trim().slice(0, 300)
      } else {
        name = rawName.slice(0, 300)
      }
    }
  }

  name = name.replace(/\s+\d+[.,]\d+\s*(\u062c\u0646\u064a\u0647|\u0631\u064a\u0627\u0644|\u062f\u0631\u0647\u0645|EGP|SAR|AED|\$|\u20ac).*$/i, '')
  name = name.replace(/\s+(\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644|Sign in|Anmelden).*$/i, '')
  name = name.trim()

  // ── Extract product image ──
  let image = ''
  const imgMatch = htmlClean.match(/src=["']?(https?:\/\/[^"'>\s]*images-amazon[^"'>\s]*\/images\/I\/[^"'>\s]+)/)
  if (imgMatch) image = imgMatch[1]

  // ── Check for truly no offers ──
  const offerCountMatch =
    htmlClean.match(/id="aod-total-offer-count"[^>]*value="(\d+)"/) ??
    htmlClean.match(/value="(\d+)"[^>]*id="aod-total-offer-count"/)

  const totalOffers = offerCountMatch ? parseInt(offerCountMatch[1], 10) : -1
  console.log(`[Parse] aod-total-offer-count = ${totalOffers}`)

  const priceElements = htmlClean.match(/id="aod-price-\d+"/g) ?? []
  const hasPriceElements = priceElements.length > 0
  console.log(`[Parse] aod-price-* elements found: ${priceElements.length}`)

  if (totalOffers === 0 && !hasPriceElements) {
    console.log(`[Parse] No offers at all → N/A`)
    return { price: 'N/A', currency: defaultCurrency, name, image }
  }

  // Strategy 1: Accessibility label
  const accRegex = /<span[^>]*class="[^"]*aok-offscreen[^"]*apex-pricetopay[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/g
  let accMatch: RegExpExecArray | null
  while ((accMatch = accRegex.exec(htmlClean)) !== null) {
    const priceResult = extractPriceFromText(accMatch[1].trim(), defaultCurrency)
    if (priceResult) {
      console.log(`[Parse] Price from accessibility label -> ${JSON.stringify(priceResult)}`)
      return { ...priceResult, name, image }
    }
  }

  // Strategy 2: a-price components
  const priceBlockRegex =
    /<span[^>]*class="[^"]*a-price[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*a-price-symbol[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>[\s\S]*?<span[^>]*class="[^"]*a-price-whole[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]*class="[^"]*a-price-fraction[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/g

  const priceBlock = priceBlockRegex.exec(htmlClean)
  if (priceBlock) {
    const symbol = priceBlock[1].trim()
    const whole = priceBlock[2].trim().replace(/[,.]$/, '')
    const fraction = priceBlock[3].trim()
    const wholeClean = cleanWhole(whole)
    const priceVal = parseFloat(`${wholeClean}.${fraction}`)
    if (priceVal > 0) {
      const currency = identifyCurrency(symbol, defaultCurrency)
      console.log(`[Parse] Price from a-price components -> ${wholeClean}.${fraction} ${currency}`)
      return { price: `${wholeClean}.${fraction}`, currency, name, image }
    }
  }

  // Strategy 3: a-offscreen text
  const aOffscreenRegex = /<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/g
  let offscreenMatch: RegExpExecArray | null
  while ((offscreenMatch = aOffscreenRegex.exec(htmlClean)) !== null) {
    const priceResult = extractPriceFromText(offscreenMatch[1].trim(), defaultCurrency)
    if (priceResult) {
      const val = parseFloat(priceResult.price)
      if (val >= 0.5) {
        console.log(`[Parse] Price from a-offscreen -> ${JSON.stringify(priceResult)}`)
        return { ...priceResult, name, image }
      }
    }
  }

  // Strategy 4: Markdown patterns
  const mdPriceResult = extractPriceFromMarkdown(mdClean, defaultCurrency)
  if (mdPriceResult) {
    console.log(`[Parse] Price from markdown -> ${JSON.stringify(mdPriceResult)}`)
    return { ...mdPriceResult, name, image }
  }

  // Fallback
  if (totalOffers === -1 && !hasPriceElements) {
    const lowerHtml = htmlClean.toLowerCase()
    const lowerMd = mdClean.toLowerCase()
    const hasNoFeatured = ['no featured offers available', 'no featured offers', 'currently unavailable']
      .some(p => lowerHtml.includes(p) || lowerMd.includes(p))
    const noOtherSellers = lowerHtml.includes('no other sellers') || lowerMd.includes('no other sellers')
    const noSellersAr = lowerHtml.includes('\u0644\u0627 \u064a\u0648\u062c\u062f \u0628\u0627\u0626\u0639\u0648\u0646 \u0622\u062e\u0631\u0648\u0646') || lowerHtml.includes('\u0644\u0627 \u064a\u0648\u062c\u062f \u062d\u0627\u0644\u064a\u0627\u064b \u0628\u0627\u0626\u0639\u0648\u0646')
    if (hasNoFeatured && (noOtherSellers || noSellersAr)) {
      console.log(`[Parse] No offers detected → N/A`)
      return { price: 'N/A', currency: defaultCurrency, name, image }
    }
  }

  console.log(`[Parse] No price found → N/A`)
  return { price: 'N/A', currency: defaultCurrency, name, image }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWL ONE REGION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function crawlRegion(asin: string, regionKey: string, crawleoApiKey: string) {
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

  const url = `https://www.${region.domain}/gp/product/ajax/aodAjaxMain/?asin=${asin}`
  console.log(`[crawlRegion] Crawling ${asin} on ${region.domain} via Crawleo...`)

  const crawleoResult = await fetchWithCrawleo(url, crawleoApiKey, region.geo)

  if (!crawleoResult) {
    return {
      domain: region.domain,
      region: regionKey,
      name: `Product ${asin}`,
      image: '',
      price: 'N/A',
      currency: region.currency,
      priceDisplay: 'N/A',
      asin,
      error: 'Failed to fetch AOD page from Crawleo',
    }
  }

  const htmlForParsing = crawleoResult.raw_html || crawleoResult.enhanced_html
  const parsed = parsePrice(htmlForParsing, crawleoResult.markdown, regionKey)

  const result = {
    domain: region.domain,
    region: regionKey,
    name: parsed.name || `Product ${asin}`,
    image: parsed.image || '',
    price: parsed.price,
    currency: parsed.currency,
    priceDisplay: formatPriceDisplay(parsed.price, parsed.currency),
    asin,
  }

  console.log(`[crawlRegion] Result: price=${result.price} display=${result.priceDisplay}`)
  return result
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HTTP SERVER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

serve({
  port: PORT,
  async fetch(req) {
    // CORS headers
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    try {
      const body = await req.json() as { asin?: string; region?: string; crawleoApiKey?: string }
      const { asin, region, crawleoApiKey } = body

      if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) {
        return Response.json({ error: 'Valid ASIN required' }, { status: 400 })
      }

      if (!crawleoApiKey) {
        return Response.json({ error: 'Crawleo API key required' }, { status: 400 })
      }

      const cleanAsin = asin.trim().toUpperCase()
      const regionKey = (region || 'COM').trim().toUpperCase()

      if (!REGIONS[regionKey]) {
        return Response.json({ error: `Invalid region: ${regionKey}` }, { status: 400 })
      }

      console.log(`[API] Crawling ${cleanAsin} on ${regionKey}`)
      const result = await crawlRegion(cleanAsin, regionKey, crawleoApiKey)

      return Response.json({
        success: true,
        asin: cleanAsin,
        results: [result],
      }, {
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
    } catch (e) {
      console.error('[API Error]:', e)
      return Response.json(
        { error: 'Crawl failed', details: String(e) },
        { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
      )
    }
  },
})

console.log(`🚀 Crawleo AOD Crawler service running on port ${PORT}`)
