import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AOD CRAWLER — Selling price from AOD ONLY
// Rules:
//   - ONLY extract the SELLING price (what customer pays)
//   - NEVER use RRP / strikethrough / list price / was price
//   - NEVER use prices from alternative product sections
//   - If no real AOD offer → N/A
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface RegionConfig {
  domain: string
  region: string
  currency: string
  cookiePrefix: string
}

const REGIONS: Record<string, RegionConfig> = {
  COM: { domain: 'amazon.com', region: 'COM', currency: 'USD', cookiePrefix: 'USD' },
  EG: { domain: 'amazon.eg', region: 'EG', currency: 'EGP', cookiePrefix: 'EGP' },
  DE: { domain: 'amazon.de', region: 'DE', currency: 'EUR', cookiePrefix: 'EUR' },
  SA: { domain: 'amazon.sa', region: 'SA', currency: 'SAR', cookiePrefix: 'SAR' },
  AE: { domain: 'amazon.ae', region: 'AE', currency: 'AED', cookiePrefix: 'AED' },
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', EGP: 'EGP ', SAR: 'SAR ', AED: 'AED ',
}

const AOD_NO_OFFER_PHRASES = [
  'no featured offers available',
  'currently unavailable',
  'see all buying options',
  'keine empfohlenen angebote',
  'keine angebote verfügbar',
  'derzeit nicht verfügbar',
  'لا توجد عروض مميزة متاحة',
  'غير متوفر حالياً',
  'لا يوجد بائعون آخرون',
]

function cleanText(text: string | null | undefined): string {
  if (!text) return ''
  return text.replace(/\xa0/g, ' ').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim()
}

function isBlocked(html: string): boolean {
  if (!html || html.length < 500) return true
  const lower = html.toLowerCase()
  return ['robot check', 'type the characters you see', 'dp-recaptcha'].some(s => lower.includes(s))
}

/**
 * Check if the AOD actually has real offers.
 */
function aodHasOffers(html: string): boolean {
  if (!html || isBlocked(html)) return false

  const lower = html.toLowerCase()

  // Explicit "no offer" indicators
  if (
    lower.includes('aod-asin-no-offers') ||
    lower.includes('aod-no-offer') ||
    lower.includes('aod-unqualified-no-offer') ||
    lower.includes('aod-olp-no-offer-bar')
  ) {
    return false
  }

  // No-offer text phrases
  for (const phrase of AOD_NO_OFFER_PHRASES) {
    if (lower.includes(phrase)) return false
  }

  // Must have offer structure with price
  const hasOfferStructure =
    (lower.includes('aod-pinned-offer') || lower.includes('aod-offer-list')) &&
    lower.includes('a-price')

  return hasOfferStructure
}

/**
 * Extract ONLY the pinned offer section HTML.
 * This is the most reliable section for the selling price.
 */
function getPinnedOfferHtml(html: string): string {
  // Find the pinned offer div and everything up to the offer-list or alternatives
  const startIdx = html.indexOf('id="aod-pinned-offer"')
  if (startIdx === -1) return ''

  // Find the end: either aod-offer-list, aod-asin-alternatives, or aod-footer
  let endIdx = html.length
  for (const marker of ['id="aod-offer-list"', 'id="aod-asin-alternatives"', 'class="aod-footer"']) {
    const idx = html.indexOf(marker, startIdx)
    if (idx > startIdx && idx < endIdx) endIdx = idx
  }

  return html.substring(startIdx, endIdx)
}

/**
 * Check if a position in HTML is inside an RRP/strikethrough price block.
 * RRP prices have class="a-text-price" and/or data-a-strike="true"
 */
function isInsideRRP(html: string, position: number): boolean {
  // Look backwards from position for RRP indicators
  const lookback = html.substring(Math.max(0, position - 500), position).toLowerCase()
  return (
    lookback.includes('a-text-price') ||
    lookback.includes('data-a-strike') ||
    lookback.includes('apex-basisprice-value') ||
    lookback.includes('basispricelegalmessage')
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
  } catch { /* keep */ }
  return price
}

/**
 * Extract the SELLING price from AOD HTML.
 *
 * Strategy:
 * 1. Get the pinned offer section only
 * 2. Find a-price-whole + a-price-fraction + a-price-symbol that are NOT inside RRP blocks
 * 3. Never use a-offscreen from RRP/strikethrough blocks
 * 4. If no price found in pinned offer → N/A
 */
function extractAodPrice(html: string, currency: string): { price: string; currency: string; priceDisplay: string } {
  const na = { price: 'N/A', currency, priceDisplay: 'N/A' }
  if (!aodHasOffers(html)) return na

  // Step 1: Get only the pinned offer section
  const pinnedHtml = getPinnedOfferHtml(html)
  if (!pinnedHtml) return na

  // Step 2: Find all a-price-whole occurrences in the pinned offer
  const wholeMatches = [...pinnedHtml.matchAll(/a-price-whole[^>]*>([\s\S]*?)<\/span>/g)]

  for (const wholeMatch of wholeMatches) {
    const matchStart = wholeMatch.index ?? 0

    // Skip if this is inside an RRP block
    if (isInsideRRP(pinnedHtml, matchStart)) continue

    // Extract the whole number - strip all HTML tags and non-digit chars
    const rawWhole = wholeMatch[1].replace(/<[^>]+>/g, '').replace(/[^0-9]/g, '').trim()
    if (!rawWhole || !/^\d+$/.test(rawWhole)) continue

    // Find a-price-fraction after this whole match
    const afterWhole = pinnedHtml.substring(matchStart)
    const fracMatch = afterWhole.match(/a-price-fraction[^>]*>([\s\S]*?)<\/span>/)
    const fraction = fracMatch ? fracMatch[1].replace(/<[^>]+>/g, '').trim() : '00'
    if (!fraction || !/^\d+$/.test(fraction)) continue

    // Find a-price-symbol — it appears BEFORE a-price-whole in the HTML
    // Look in a 200-char window before the whole match, plus after
    const beforeWhole = pinnedHtml.substring(Math.max(0, matchStart - 200), matchStart + 200)
    const symMatch = beforeWhole.match(/a-price-symbol[^>]*>([\s\S]*?)<\/span>/)
    const sym = symMatch ? symMatch[1].replace(/<[^>]+>/g, '').trim() : ''

    const price = `${rawWhole}.${fraction}`
    let cur = currency
    if (sym === '$') cur = 'USD'
    else if (sym === '€') cur = 'EUR'
    else if (sym === 'EGP') cur = 'EGP'
    else if (sym === 'SAR') cur = 'SAR'
    else if (sym === 'AED') cur = 'AED'
    else if (sym === '£') cur = 'GBP'

    // Validate: price must be positive
    const numPrice = parseFloat(price)
    if (numPrice > 0) {
      return { price, currency: cur, priceDisplay: formatPrice(price, cur) }
    }
  }

  // Step 3: Try a-offscreen but ONLY from non-RRP sections
  // (This handles cases where the price is shown differently)
  const offscreenMatches = [...pinnedHtml.matchAll(/a-offscreen[^>]*>([^<]+)/g)]
  for (const match of offscreenMatches) {
    const matchStart = match.index ?? 0
    if (isInsideRRP(pinnedHtml, matchStart)) continue

    const raw = cleanText(match[1])
    if (!raw || raw === ' ') continue

    const parsed = parsePriceText(raw, currency)
    if (parsed && parseFloat(parsed.price) > 0) {
      return { ...parsed, priceDisplay: formatPrice(parsed.price, parsed.currency) }
    }
  }

  return na
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
// CRAWL ONE REGION
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
    'Accept-Encoding': 'gzip, deflate',
    'Referer': referer,
    'Cookie': `i18n-prefs=${region.cookiePrefix}; lc-main=en_US`,
  }

  try {
    const res = await fetch(aodUrl, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    })
    const html = await res.text()

    if (res.status !== 200 || isBlocked(html)) {
      return {
        domain: region.domain, region: region.region,
        name: `Product ${asin}`, image: '',
        price: 'N/A', currency: region.currency, priceDisplay: 'N/A',
        asin, error: `HTTP ${res.status} or blocked`
      }
    }

    const { name, image } = extractProductInfoAod(html, asin)
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API ROUTE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

      const crawlResults = await Promise.all(
        regionKeys.map(r => crawlRegion(cleanAsin, r))
      )

      let product = await db.product.findUnique({ where: { asin: cleanAsin } })

      if (!product) {
        const mainResult = crawlResults.find(r => r.name !== `Product ${cleanAsin}`) || crawlResults[0]
        product = await db.product.create({
          data: {
            asin: cleanAsin,
            name: mainResult?.name || `Product ${cleanAsin}`,
            image: mainResult?.image || '',
          },
        })
      } else {
        const mainResult = crawlResults.find(r => r.name !== `Product ${cleanAsin}`)
        if (mainResult) {
          await db.product.update({
            where: { id: product.id },
            data: {
              name: mainResult.name,
              image: mainResult.image || product.image,
              updatedAt: new Date(),
            },
          })
        }
      }

      for (const result of crawlResults) {
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
