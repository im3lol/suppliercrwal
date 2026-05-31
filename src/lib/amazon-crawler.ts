/**
 * Amazon AOD Price Crawler — TypeScript Implementation
 * 
 * ALL prices come from AOD (All Offers Display) ONLY.
 * No fallback to main product page.
 * No ATC button prices.
 * No alternative product prices.
 */

import ZAI from 'z-ai-web-dev-sdk'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface RegionConfig {
  domain: string
  region: string
  currency: string
  postalCode?: string
  cookiePrefix: string
}

export const REGIONS: Record<string, RegionConfig> = {
  COM: {
    domain: 'amazon.com',
    region: 'COM',
    currency: 'USD',
    postalCode: '99950',
    cookiePrefix: 'USD',
  },
  EG: {
    domain: 'amazon.eg',
    region: 'EG',
    currency: 'EGP',
    cookiePrefix: 'EGP',
  },
  DE: {
    domain: 'amazon.de',
    region: 'DE',
    currency: 'EUR',
    postalCode: '80331',
    cookiePrefix: 'EUR',
  },
  SA: {
    domain: 'amazon.sa',
    region: 'SA',
    currency: 'SAR',
    cookiePrefix: 'SAR',
  },
  AE: {
    domain: 'amazon.ae',
    region: 'AE',
    currency: 'AED',
    cookiePrefix: 'AED',
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AOD NO-OFFER PHRASES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const AOD_NO_OFFER_PHRASES = [
  'no featured offers available',
  'no other sellers matching your location',
  'currently unavailable',
  'keine empfohlenen angebote',
  'keine angebote verfügbar',
  'derzeit nicht verfügbar',
  'actuellement indisponible',
  'no hay ofertas destacadas',
  // Arabic variants
  'لا توجد عروض مميزة متاحة',
  'لا يوجد بائعون آخرون',
  'غير متوفر حالياً',
]

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HTML HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function cleanText(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .replace(/\xa0/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
}

function isBlocked(html: string): boolean {
  if (!html || html.length < 1000) return true
  const lower = html.toLowerCase()
  return ['robot check', 'type the characters you see', 'dp-recaptcha'].some(
    (s) => lower.includes(s)
  )
}

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
// AOD PRICE EXTRACTION — AOD ONLY, NO FALLBACKS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function aodHasOffers(html: string): boolean {
  if (!html || isBlocked(html)) return false

  const lower = html.toLowerCase()

  // Check 1: Explicit "no offer" indicators
  if (
    lower.includes('aod-asin-no-offers') ||
    lower.includes('aod-no-offer') ||
    lower.includes('aod-unqualified-no-offer') ||
    lower.includes('aod-olp-no-offer-bar')
  ) {
    return false
  }

  // Check 2: "No offer" phrases in text
  for (const phrase of AOD_NO_OFFER_PHRASES) {
    if (lower.includes(phrase)) return false
  }

  // Check 3: Must have price element inside pinned offer or offer list
  const hasPinnedPrice =
    html.includes('aod-pinned-offer') &&
    (html.includes('a-price') || html.includes('aod-offer-price'))

  const hasListPrice =
    html.includes('aod-offer-list') &&
    (html.includes('a-price') || html.includes('aod-offer'))

  if (!hasPinnedPrice && !hasListPrice) return false

  return true
}

function extractAodPrice(html: string, currency: string): {
  price: string
  currency: string
  priceDisplay: string
} {
  const na = { price: 'N/A', currency, priceDisplay: 'N/A' }

  if (!aodHasOffers(html)) return na

  // ── Extract from pinned offer ──
  const pinnedMatch = html.match(
    /id="aod-pinned-offer"[\s\S]*?<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>([^<]+)<\/span>/
  )
  if (pinnedMatch) {
    const raw = cleanText(pinnedMatch[1])
    const parsed = parsePriceText(raw, currency)
    if (parsed) return { ...parsed, priceDisplay: formatPrice(parsed.price, parsed.currency) }
  }

  // ── Extract from pinned offer — whole+fraction parts ──
  const pinnedSection = html.match(/id="aod-pinned-offer"[\s\S]*?(?=id="aod-offer-list"|<\/div>\s*<\/div>\s*<\/div>)/)
  if (pinnedSection) {
    const parsed = extractFromWholeFraction(pinnedSection[0], currency)
    if (parsed) return { ...parsed, priceDisplay: formatPrice(parsed.price, parsed.currency) }
  }

  // ── Extract from offer list ──
  const offerListMatches = html.matchAll(
    /class="[^"]*aod-offer[^"]*"[\s\S]*?<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>([^<]+)<\/span>/g
  )
  for (const match of offerListMatches) {
    const raw = cleanText(match[1])
    const parsed = parsePriceText(raw, currency)
    if (parsed) return { ...parsed, priceDisplay: formatPrice(parsed.price, parsed.currency) }
  }

  // ── Offer list — whole+fraction parts ──
  const offerListSection = html.match(/id="aod-offer-list"[\s\S]*/)?.[0]
  if (offerListSection) {
    const parsed = extractFromWholeFraction(offerListSection, currency)
    if (parsed) return { ...parsed, priceDisplay: formatPrice(parsed.price, parsed.currency) }
  }

  return na
}

function extractFromWholeFraction(
  html: string,
  currency: string
): { price: string; currency: string } | null {
  const wholeMatch = html.match(
    /class="[^"]*a-price-whole[^"]*"[^>]*>([^<]*)</
  )
  if (wholeMatch) {
    const fractionMatch = html.match(
      /class="[^"]*a-price-fraction[^"]*"[^>]*>([^<]*)</
    )
    const whole = wholeMatch[1].replace(/[.,]/g, '').trim()
    const fraction = fractionMatch?.[1].trim() || '00'
    if (whole && /^\d+$/.test(whole)) {
      return { price: `${whole}.${fraction}`, currency }
    }
  }
  return null
}

function parsePriceText(
  text: string,
  defaultCurrency: string
): { price: string; currency: string } | null {
  const cleaned = cleanText(text)
  if (!cleaned) return null

  // German/European: 9,49 €
  const euroMatch = cleaned.match(/(\d{1,3}(?:\.\d{3})*),(\d{2})\s*€?/)
  if (euroMatch) {
    const whole = euroMatch[1].replace(/\./g, '')
    return { price: `${whole}.${euroMatch[2]}`, currency: 'EUR' }
  }

  // Standard: extract numeric value
  const currencyMap: Record<string, string> = {
    $: 'USD',
    '€': 'EUR',
    '£': 'GBP',
    EGP: 'EGP',
    SAR: 'SAR',
    AED: 'AED',
  }

  let currency = defaultCurrency
  for (const [sym, code] of Object.entries(currencyMap)) {
    if (cleaned.includes(sym)) {
      currency = code
      break
    }
  }

  const nums = cleaned.match(/[\d,.]+/g)
  if (nums && nums.length > 0) {
    const value = nums[0].replace(/,/g, '')
    return { price: value, currency }
  }

  return null
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN PRODUCT INFO EXTRACTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function extractProductInfo(html: string, asin: string): { name: string; image: string } {
  let name = `Product ${asin}`
  let image = ''

  // Title
  const titleMatch = html.match(
    /id="productTitle"[^>]*>([^<]+)[<]/
  ) || html.match(/<h1[^>]*>\s*<span[^>]*>([^<]+)[<]/)
  if (titleMatch) {
    name = cleanText(titleMatch[1])
  }

  // Image
  const imgMatch = html.match(
    /id="landingImage"[^>]*data-old-hires="([^"]+)"/
  ) || html.match(/id="landingImage"[^>]*src="([^"]+)"/) || html.match(/class="[^"]*a-dynamic-image[^"]*"[^>]*src="([^"]+)"/)
  if (imgMatch) {
    image = imgMatch[1]
  }

  return { name, image }
}

function extractProductInfoAod(html: string, asin: string): { name: string; image: string } {
  let name = `Product ${asin}`
  let image = ''

  const titleMatch = html.match(
    /id="aod-asin-title-text"[^>]*>([^<]+)[<]/
  ) || html.match(/class="[^"]*aod-asin-title[^"]*"[^>]*>([^<]+)[<]/)
  if (titleMatch) {
    const t = cleanText(titleMatch[1])
    if (t) name = t
  }

  const imgMatch = html.match(
    /id="aod-asin-image-id"[^>]*src="([^"]+)"/
  )
  if (imgMatch) {
    image = imgMatch[1]
  }

  return { name, image }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWLER
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

let zaiInstance: InstanceType<typeof ZAI> | null = null

async function getZAI() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create()
  }
  return zaiInstance
}

async function fetchPage(url: string): Promise<string> {
  const zai = await getZAI()
  try {
    const result = await zai.functions.invoke('page_reader', { url })
    if (result?.data?.html) {
      return result.data.html
    }
    return ''
  } catch (e) {
    console.error(`[fetchPage] Error fetching ${url}:`, e)
    return ''
  }
}

export async function crawlAsin(
  asin: string,
  regionKeys: string[] = Object.keys(REGIONS)
): Promise<CrawlResult[]> {
  const results: CrawlResult[] = []

  for (const key of regionKeys) {
    const region = REGIONS[key]
    if (!region) continue

    try {
      const mainUrl = `https://www.${region.domain}/dp/${asin}/?language=en_US&currency=${region.currency}${region.postalCode ? `&postalCode=${region.postalCode}` : ''}`
      const aodUrl = `https://www.${region.domain}/gp/product/ajax/aodAjaxMain/?asin=${asin}&m=&pcid=&offeringID=&filters=%7B%22all%22%3Atrue%7D&experienceId=aodAjaxMain`

      // ── Step 1: Get product name & image from main page ──
      let name = `Product ${asin}`
      let image = ''

      const mainHtml = await fetchPage(mainUrl)
      if (mainHtml && !isBlocked(mainHtml)) {
        const info = extractProductInfo(mainHtml, asin)
        name = info.name
        image = info.image
      }

      // ── Step 2: Get price from AOD ONLY ──
      let priceData = { price: 'N/A', currency: region.currency, priceDisplay: 'N/A' }

      const aodHtml = await fetchPage(aodUrl)
      if (aodHtml && !isBlocked(aodHtml)) {
        priceData = extractAodPrice(aodHtml, region.currency)

        // Also try to get better name/image from AOD
        if (priceData.price !== 'N/A') {
          const aodInfo = extractProductInfoAod(aodHtml, asin)
          if (aodInfo.name && aodInfo.name !== `Product ${asin}`) {
            name = aodInfo.name
          }
          if (aodInfo.image) {
            image = aodInfo.image
          }
        }
      }

      results.push({
        domain: region.domain,
        region: region.region,
        name,
        image,
        price: priceData.price,
        currency: priceData.currency,
        priceDisplay: priceData.price !== 'N/A'
          ? formatPrice(priceData.price, priceData.currency)
          : 'N/A',
        asin,
      })
    } catch (e) {
      console.error(`[crawlAsin] Error for ${asin} on ${region.domain}:`, e)
      results.push({
        domain: region.domain,
        region: region.region,
        name: `Product ${asin}`,
        image: '',
        price: 'N/A',
        currency: region.currency,
        priceDisplay: 'N/A',
        asin,
        error: String(e),
      })
    }
  }

  return results
}
