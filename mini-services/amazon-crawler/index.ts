/**
 * Amazon Crawler Mini-Service
 * AOD-only price extraction for 5 Amazon regions
 * Port: 3031
 */

export default {
  port: 3031,
  hostname: '0.0.0.0',
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    if (url.pathname === '/api/crawl' && req.method === 'POST') {
      try {
        const body = await req.json() as { asin: string; regions?: string[] }
        const { asin, regions } = body

        if (!asin) {
          return Response.json({ error: 'ASIN required' }, { status: 400 })
        }

        const regionList = regions || ['COM', 'EG', 'DE', 'SA', 'AE']
        const results = await crawlAllRegions(asin, regionList)

        return Response.json({ success: true, asin, results })
      } catch (e) {
        console.error('[Crawl Error]', e)
        return Response.json({ error: String(e) }, { status: 500 })
      }
    }

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'amazon-crawler' })
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  },
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWL LOGIC — Direct fetch with browser-like headers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface RegionConfig {
  domain: string
  region: string
  currency: string
  cookiePrefix: string
  postalCode?: string
}

const REGIONS: Record<string, RegionConfig> = {
  COM: { domain: 'amazon.com', region: 'COM', currency: 'USD', cookiePrefix: 'USD', postalCode: '99950' },
  EG: { domain: 'amazon.eg', region: 'EG', currency: 'EGP', cookiePrefix: 'EGP' },
  DE: { domain: 'amazon.de', region: 'DE', currency: 'EUR', cookiePrefix: 'EUR', postalCode: '80331' },
  SA: { domain: 'amazon.sa', region: 'SA', currency: 'SAR', cookiePrefix: 'SAR' },
  AE: { domain: 'amazon.ae', region: 'AE', currency: 'AED', cookiePrefix: 'AED' },
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', EGP: 'EGP ', SAR: 'SAR ', AED: 'AED ',
}

function cleanText(text: string | null | undefined): string {
  if (!text) return ''
  return text.replace(/\xa0/g, ' ').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim()
}

function isBlocked(html: string): boolean {
  if (!html || html.length < 1000) return true
  const lower = html.toLowerCase()
  return ['robot check', 'type the characters you see', 'dp-recaptcha'].some(s => lower.includes(s))
}

const AOD_NO_OFFER_PHRASES = [
  'no featured offers available',
  'no other sellers matching your location',
  'currently unavailable',
  'keine empfohlenen angebote',
  'keine angebote verfügbar',
  'derzeit nicht verfügbar',
  'لا توجد عروض مميزة متاحة',
  'غير متوفر حالياً',
]

function aodHasOffers(html: string): boolean {
  if (!html || isBlocked(html)) return false

  // Check 1: Explicit "no offer" container IDs — these are definitive
  const lower = html.toLowerCase()
  if (
    lower.includes('aod-asin-no-offers') ||
    lower.includes('aod-no-offer') ||
    lower.includes('aod-unqualified-no-offer') ||
    lower.includes('aod-olp-no-offer-bar')
  ) {
    return false
  }

  // Check 2: Must have price element inside buybox scopes
  // The aod-pinned-offer or aod-offer-list must contain a-price
  // This is the PRIMARY check — if there's a price in buybox, there IS an offer
  const hasPinnedPrice =
    (html.includes('aod-pinned-offer') || html.includes('aod-pinned-offer-wrapper')) &&
    html.includes('a-price')

  const hasListPrice =
    html.includes('aod-offer-list') &&
    html.includes('a-price')

  // If we found prices in buybox scopes, there ARE offers
  // Even if "no other sellers" text appears elsewhere in the HTML
  if (hasPinnedPrice || hasListPrice) {
    return true
  }

  // Check 3: No prices found — check for no-offer phrases as secondary confirmation
  // Only check these when NO prices were found, to avoid false negatives
  for (const phrase of AOD_NO_OFFER_PHRASES) {
    if (lower.includes(phrase)) return false
  }

  return false
}

function formatPrice(price: string, currency: string): string {
  if (price === 'N/A') return 'N/A'
  try {
    const num = parseFloat(price)
    if (!isNaN(num)) {
      const symbol = CURRENCY_SYMBOLS[currency] || currency + ' '
      return `${symbol}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
  } catch { /* keep */ }
  return price
}

function parsePriceText(text: string, defaultCurrency: string): { price: string; currency: string } | null {
  const cleaned = cleanText(text)
  if (!cleaned) return null

  // German/European: 9,49 €
  const euroMatch = cleaned.match(/(\d{1,3}(?:\.\d{3})*),(\d{2})\s*€?/)
  if (euroMatch) {
    const whole = euroMatch[1].replace(/\./g, '')
    return { price: `${whole}.${euroMatch[2]}`, currency: 'EUR' }
  }

  const currencyMap: Record<string, string> = { '$': 'USD', '€': 'EUR', '£': 'GBP', 'EGP': 'EGP', 'SAR': 'SAR', 'AED': 'AED' }
  let currency = defaultCurrency
  for (const [sym, code] of Object.entries(currencyMap)) {
    if (cleaned.includes(sym)) { currency = code; break }
  }

  const nums = cleaned.match(/[\d,.]+/g)
  if (nums && nums.length > 0) {
    return { price: nums[0].replace(/,/g, ''), currency }
  }
  return null
}

function extractAodPrice(html: string, currency: string): { price: string; currency: string; priceDisplay: string } {
  const na = { price: 'N/A', currency, priceDisplay: 'N/A' }
  if (!aodHasOffers(html)) return na

  // Method 1: a-offscreen prices
  const offscreenMatches = [...html.matchAll(/class="[^"]*a-offscreen[^"]*"[^>]*>([^<]+)[<]/g)]
  for (const match of offscreenMatches) {
    const raw = cleanText(match[1])
    if (raw) {
      const parsed = parsePriceText(raw, currency)
      if (parsed && parsed.price !== '0') {
        return { ...parsed, priceDisplay: formatPrice(parsed.price, parsed.currency) }
      }
    }
  }

  // Method 2: whole + fraction + symbol
  const wholeMatch = html.match(/class="[^"]*a-price-whole[^"]*"[^>]*>([^<]*)[<]/)
  if (wholeMatch) {
    const fracMatch = html.match(/class="[^"]*a-price-fraction[^"]*"[^>]*>([^<]*)[<]/)
    const symMatch = html.match(/class="[^"]*a-price-symbol[^"]*"[^>]*>([^<]*)[<]/)
    const whole = wholeMatch[1].replace(/[,]/g, '').trim()
    const fraction = fracMatch?.[1].trim() || '00'
    if (whole && /^\d+$/.test(whole)) {
      const price = `${whole}.${fraction}`
      const currencySym = symMatch?.[1].trim() || ''
      // Determine currency from symbol
      let cur = currency
      if (currencySym === '$') cur = 'USD'
      else if (currencySym === '€') cur = 'EUR'
      else if (currencySym === 'EGP') cur = 'EGP'
      else if (currencySym === 'SAR') cur = 'SAR'
      else if (currencySym === 'AED') cur = 'AED'
      else if (currencySym === '£') cur = 'GBP'
      return { price, currency: cur, priceDisplay: formatPrice(price, cur) }
    }
  }

  return na
}

function extractProductInfoAod(html: string, asin: string): { name: string; image: string } {
  let name = `Product ${asin}`
  let image = ''

  const titleMatch = html.match(/id="aod-asin-title-text"[^>]*>([^<]+)[<]/)
    || html.match(/class="[^"]*aod-asin-title[^"]*"[^>]*>([^<]+)[<]/)
  if (titleMatch) {
    const t = cleanText(titleMatch[1])
    if (t) name = t
  }

  const imgMatch = html.match(/src="(https:\/\/m\.media-amazon[^"]+)"/)
  if (imgMatch) {
    image = imgMatch[1]
  }

  return { name, image }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWLER — fetch AOD directly for each region
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function crawlRegion(asin: string, regionKey: string): Promise<{
  domain: string
  region: string
  name: string
  image: string
  price: string
  currency: string
  priceDisplay: string
  asin: string
  error?: string
}> {
  const region = REGIONS[regionKey]
  if (!region) {
    return {
      domain: '', region: regionKey, name: `Product ${asin}`, image: '',
      price: 'N/A', currency: '', priceDisplay: 'N/A', asin, error: 'Unknown region'
    }
  }

  const aodUrl = `https://www.${region.domain}/gp/product/ajax/aodAjaxMain/?asin=${asin}&m=&pcid=&offeringID=&filters=%7B%22all%22%3Atrue%7D&experienceId=aodAjaxMain`
  const referer = `https://www.${region.domain}/dp/${asin}/`

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer,
    'Cookie': `i18n-prefs=${region.cookiePrefix}; lc-main=en_US`,
  }

  try {
    const res = await fetch(aodUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(30000) })
    const html = await res.text()

    if (res.status !== 200 || isBlocked(html)) {
      return {
        domain: region.domain, region: region.region,
        name: `Product ${asin}`, image: '',
        price: 'N/A', currency: region.currency, priceDisplay: 'N/A',
        asin, error: `HTTP ${res.status} or blocked`
      }
    }

    // Extract product info from AOD
    const { name, image } = extractProductInfoAod(html, asin)

    // Extract price from AOD ONLY
    const priceData = extractAodPrice(html, region.currency)

    return {
      domain: region.domain,
      region: region.region,
      name,
      image,
      price: priceData.price,
      currency: priceData.currency,
      priceDisplay: priceData.price !== 'N/A' ? formatPrice(priceData.price, priceData.currency) : 'N/A',
      asin,
    }
  } catch (e) {
    return {
      domain: region.domain, region: region.region,
      name: `Product ${asin}`, image: '',
      price: 'N/A', currency: region.currency, priceDisplay: 'N/A',
      asin, error: String(e)
    }
  }
}

async function crawlAllRegions(asin: string, regions: string[]) {
  // Crawl all regions in parallel
  const promises = regions.map(r => crawlRegion(asin, r))
  return Promise.all(promises)
}

// Start server
console.log(`🚀 Amazon Crawler service running on port 3031`)
