/**
 * Amazon AOD Price Crawler — Using agent-browser (headless browser)
 *
 * ALL prices come from AOD (All Offers Display) ONLY.
 * Uses agent-browser CLI to open Amazon pages, set cookies, and extract
 * prices directly from the DOM via eval + snapshot as fallback.
 *
 * CRITICAL RULES:
 * - Prices MUST come from #aod-pinned-offer or #aod-offer-list ONLY
 * - NO fallback to main page prices
 * - NO ATC button prices from non-AOD sections
 * - NO alternative/recommended product prices
 * - If AOD has no offers → return "N/A"
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
// ARABIC NUMERAL CONVERSION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function convertArabicNumerals(text: string): string {
  // Convert Arabic-Indic digits ٠-٩ to 0-9
  return text.replace(/[\u0660-\u0669]/g, (c) =>
    String(c.charCodeAt(0) - 0x0660)
  )
}

function convertArabicDecimal(text: string): string {
  // Convert Arabic decimal separator ٫ to .
  return text.replace(/٫/g, '.')
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PRICE PARSING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Parse a raw price string extracted from the DOM into a numeric string.
 * Handles formats:
 *   EUR: "€8.93" or "8,93 €" or "EUR 8.93"
 *   USD: "$12.99"
 *   EGP: "EGP 280.00" or "٢٨٠٫٠٠ ج.م"
 *   SAR: "SAR 45.00" or "٤٥٫٠٠ ر.س"
 *   AED: "AED 35.00" or "٣٥٫٠٠ د.إ"
 */
function parsePriceText(raw: string, defaultCurrency: string): { price: string; currency: string } | null {
  if (!raw) return null

  // Step 1: Convert Arabic numerals and decimal separators
  let text = convertArabicNumerals(raw)
  text = convertArabicDecimal(text)
  // Clean nbsp and extra whitespace
  text = text.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim()

  if (!text) return null

  // Step 2: Detect currency from the text
  const currencyMap: Record<string, string> = {
    '$': 'USD',
    '\u20AC': 'EUR',
    '\u00A3': 'GBP',
    'EGP': 'EGP',
    'SAR': 'SAR',
    'AED': 'AED',
    'USD': 'USD',
    'EUR': 'EUR',
  }

  let currency = defaultCurrency
  for (const [sym, code] of Object.entries(currencyMap)) {
    if (text.includes(sym)) {
      currency = code
      break
    }
  }

  // Step 3: Extract the numeric price
  // German/European format: "9,49 €" → 9.49 (comma as decimal, dots as thousands)
  const euroFormatMatch = text.match(/(\d{1,3}(?:\.\d{3})*),(\d{2})/)
  if (euroFormatMatch && (currency === 'EUR' || text.includes('\u20AC'))) {
    const whole = euroFormatMatch[1].replace(/\./g, '')
    return { price: `${whole}.${euroFormatMatch[2]}`, currency }
  }

  // Standard format: extract number after currency symbol or standalone
  // Try pattern: [currency] number
  const afterSymbolMatch = text.match(/(?:\$|\u20AC|\u00A3|EGP|SAR|AED|USD|EUR)\s*([\d,]+\.?\d*)/i)
  if (afterSymbolMatch) {
    const numStr = afterSymbolMatch[1].replace(/,/g, '')
    if (numStr && !isNaN(parseFloat(numStr)) && parseFloat(numStr) > 0) {
      return { price: numStr, currency }
    }
  }

  // Try pattern: number [currency]
  const beforeSymbolMatch = text.match(/([\d,]+\.?\d*)\s*(?:\$|\u20AC|\u00A3|EGP|SAR|AED|USD|EUR)/i)
  if (beforeSymbolMatch) {
    const numStr = beforeSymbolMatch[1].replace(/,/g, '')
    if (numStr && !isNaN(parseFloat(numStr)) && parseFloat(numStr) > 0) {
      return { price: numStr, currency }
    }
  }

  // Fallback: just grab the first number
  const numMatch = text.match(/([\d,]+\.?\d*)/)
  if (numMatch) {
    const numStr = numMatch[1].replace(/,/g, '')
    if (numStr && !isNaN(parseFloat(numStr)) && parseFloat(numStr) > 0) {
      return { price: numStr, currency }
    }
  }

  return null
}

/**
 * Map currency symbol found in text to ISO currency code.
 */
const SYMBOL_TO_CODE: Record<string, string> = {
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NO-OFFER DETECTION PHRASES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const NO_OFFER_PHRASES = [
  'no featured offers available',
  'no featured offers',
  'currently unavailable',
  'keine empfohlenen angebote',
  'keine angebote verfügbar',
  'derzeit nicht verfügbar',
  'لا توجد عروض مميزة متاحة',
  'لا يوجد بائعون آخرون',
  'غير متوفر حالياً',
]

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SNAPSHOT PARSING (FALLBACK)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface SnapshotRef {
  name: string
  role: string
}

interface SnapshotExtract {
  hasPinnedOffer: boolean
  noOffers: boolean
  price: string
  currencySymbol: string
}

/**
 * Parse the AOD snapshot JSON to extract price info as a fallback
 * when eval-based extraction fails.
 */
function parseAodSnapshot(snapshotJson: unknown): SnapshotExtract {
  const result: SnapshotExtract = {
    hasPinnedOffer: false,
    noOffers: false,
    price: '',
    currencySymbol: '',
  }

  if (!snapshotJson || typeof snapshotJson !== 'object') return result

  const data = snapshotJson as { data?: { refs?: Record<string, SnapshotRef>; snapshot?: string } }
  const refs = data.data?.refs || {}

  // Check for "no offers" indicators in element names
  for (const ref of Object.values(refs)) {
    const nameLower = (ref.name || '').toLowerCase()
    for (const phrase of NO_OFFER_PHRASES) {
      if (nameLower.includes(phrase)) {
        result.noOffers = true
        break
      }
    }
  }

  // Extract price from "Add to basket from seller ... and price X" button
  for (const ref of Object.values(refs)) {
    if (ref.role === 'button' && ref.name) {
      const nameLower = ref.name.toLowerCase()
      // Exclude "Other recommended products" section
      if (nameLower.includes('recommended')) continue

      if (nameLower.includes('price')) {
        result.hasPinnedOffer = true

        // Pattern: "Add to basket from seller XXX and price €8.93"
        const priceMatch = ref.name.match(
          /price\s+([€$£]|EGP|SAR|AED|USD|EUR|HKD)?\s*([\d,]+\.?\d*)/i
        )
        if (priceMatch) {
          result.currencySymbol = priceMatch[1] || ''
          const rawPrice = priceMatch[2].replace(/,/g, '')
          if (rawPrice && parseFloat(rawPrice) > 0) {
            result.price = rawPrice
            result.noOffers = false
          }
        }
        break
      }
    }
  }

  // If no price from button, try to find StaticText price in the snapshot
  if (!result.price) {
    const snapshot = data.data?.snapshot || ''
    const staticPriceMatch = snapshot.match(
      /StaticText\s+"([€$£]|EGP|SAR|AED|USD|EUR)\s*([\d,]+\.?\d*)"/
    )
    if (staticPriceMatch) {
      result.currencySymbol = staticPriceMatch[1]
      result.price = staticPriceMatch[2].replace(/,/g, '')
    }
  }

  return result
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWL ONE REGION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Crawl a single ASIN on a single region using agent-browser.
 *
 * Flow:
 * 1. Close any existing browser
 * 2. Open the Amazon homepage for the region
 * 3. Set currency/language cookies
 * 4. Navigate to the AOD URL (?aod=1)
 * 5. Wait for AOD content to load
 * 6. Extract price via eval (direct DOM access)
 * 7. Extract name via eval
 * 8. Extract image via eval
 * 9. If no price found, check snapshot for no-offer indicators
 * 10. Close browser
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
    // ── Step 1: Close any existing browser ──
    console.log(`[crawlRegion] Closing existing browser...`)
    await runBrowser(['close'], 5000)

    // ── Step 2: Open region homepage to set base cookies ──
    console.log(`[crawlRegion] Opening ${region.domain}...`)
    await runBrowser(['open', `https://www.${region.domain}/`], 20000)

    // ── Step 3: Set currency and language cookies ──
    const cookieScript = `document.cookie='i18n-prefs=${region.currencyCookie};path=/;domain=.${region.domain}';document.cookie='lc-main=en_US;path=/;domain=.${region.domain}';'done'`
    console.log(`[crawlRegion] Setting cookies for ${region.domain}...`)
    await runBrowser(['eval', cookieScript], 8000)

    // ── Step 4: Navigate to AOD page ──
    const aodUrl = `https://www.${region.domain}/dp/${asin}/ref=olp-opf-redir?aod=1&language=en_US&th=1${region.postalCode ? `&postalCode=${region.postalCode}` : ''}`
    console.log(`[crawlRegion] Navigating to AOD: ${aodUrl}`)
    await runBrowser(['open', aodUrl], 30000)

    // ── Step 5: Wait for AOD content to render ──
    console.log(`[crawlRegion] Waiting 3s for AOD content...`)
    await runBrowser(['wait', '3000'], 5000)

    // ── Step 6: Extract price via eval (direct DOM access) ──
    console.log(`[crawlRegion] Extracting price via eval for ${asin} on ${region.domain}...`)

    const priceEvalScript = `(function() {
      // Try #aod-pinned-offer first (the main/default offer)
      var pinnedEl = document.querySelector('#aod-pinned-offer .a-price .a-offscreen');
      if (pinnedEl && pinnedEl.textContent) return pinnedEl.textContent.trim();

      // Try #aod-price-0 (first offer in the list)
      var price0El = document.querySelector('#aod-price-0 .a-price .a-offscreen');
      if (price0El && price0El.textContent) return price0El.textContent.trim();

      // Try any offer in the offer list
      var offerPriceEl = document.querySelector('#aod-offer-list .a-price .a-offscreen');
      if (offerPriceEl && offerPriceEl.textContent) return offerPriceEl.textContent.trim();

      // Fallback: whole+fraction+symbol parts in pinned offer
      var pinnedSection = document.querySelector('#aod-pinned-offer');
      if (pinnedSection) {
        var whole = pinnedSection.querySelector('.a-price-whole');
        var fraction = pinnedSection.querySelector('.a-price-fraction');
        var symbol = pinnedSection.querySelector('.a-price-symbol');
        if (whole && fraction) {
          var w = whole.textContent.replace(/[.,]/g, '').trim();
          var f = fraction.textContent.trim();
          var s = symbol ? symbol.textContent.trim() : '';
          return s + w + '.' + f;
        }
      }

      // Fallback: whole+fraction+symbol parts in offer list
      var offerList = document.querySelector('#aod-offer-list');
      if (offerList) {
        var whole2 = offerList.querySelector('.a-price-whole');
        var fraction2 = offerList.querySelector('.a-price-fraction');
        var symbol2 = offerList.querySelector('.a-price-symbol');
        if (whole2 && fraction2) {
          var w2 = whole2.textContent.replace(/[.,]/g, '').trim();
          var f2 = fraction2.textContent.trim();
          var s2 = symbol2 ? symbol2.textContent.trim() : '';
          return s2 + w2 + '.' + f2;
        }
      }

      return '';
    })()`

    const rawPriceText = await runBrowser(['eval', priceEvalScript], 10000)
    // The eval output is wrapped in quotes, strip them
    const priceText = rawPriceText.replace(/^"|"$/g, '').replace(/\\"/g, '"').trim()
    console.log(`[crawlRegion] Raw price from eval: "${priceText}"`)

    // ── Step 7: Extract product name via eval ──
    console.log(`[crawlRegion] Extracting product name...`)
    const nameEvalScript = `(function() {
      var el = document.querySelector('#aod-asin-title-text');
      if (el && el.textContent) return el.textContent.trim();
      var el2 = document.querySelector('#productTitle');
      if (el2 && el2.textContent) return el2.textContent.trim();
      return '';
    })()`

    const rawNameText = await runBrowser(['eval', nameEvalScript], 10000)
    const nameText = rawNameText.replace(/^"|"$/g, '').replace(/\\"/g, '"').trim()
    console.log(`[crawlRegion] Product name from eval: "${nameText}"`)

    // ── Step 8: Extract product image via eval ──
    console.log(`[crawlRegion] Extracting product image...`)
    const imageEvalScript = `(function() {
      var el = document.querySelector('#aod-asin-image-id');
      if (el && el.src) return el.src;
      var el2 = document.querySelector('#landingImage');
      if (el2 && el2.src) return el2.src;
      return '';
    })()`

    const rawImageText = await runBrowser(['eval', imageEvalScript], 10000)
    let imageText = rawImageText.replace(/^"|"$/g, '').replace(/\\"/g, '"').trim()
    if (imageText && !imageText.startsWith('http')) {
      imageText = ''
    }
    console.log(`[crawlRegion] Product image from eval: "${imageText ? 'found' : 'not found'}"`)

    // ── Step 9: Check for no-offer indicators ──
    let noOffers = false

    // Use eval to check DOM for no-offer elements
    const noOfferEvalScript = `(function() {
      // Check for no-offer container
      var noOfferEl = document.querySelector('#aod-asin-no-offers');
      if (noOfferEl) return 'no-offers-element';
      // Check text content of AOD container for no-offer phrases
      var container = document.querySelector('#aod-container');
      if (container) {
        var text = container.textContent.toLowerCase();
        if (text.includes('no featured offers') || text.includes('currently unavailable') ||
            text.includes('keine empfohlenen angebote') || text.includes('derzeit nicht verfügbar') ||
            text.includes('لا توجد عروض مميزة') || text.includes('غير متوفر حالياً')) {
          return 'no-offers-text';
        }
      }
      // Also check if there's a pinned offer or offer list with prices
      var hasPinned = document.querySelector('#aod-pinned-offer .a-price');
      var hasOffer = document.querySelector('#aod-offer-list .a-price');
      if (!hasPinned && !hasOffer) return 'no-prices-found';
      return '';
    })()`

    const noOfferCheck = await runBrowser(['eval', noOfferEvalScript], 10000)
    const noOfferResult = noOfferCheck.replace(/^"|"$/g, '').trim()
    console.log(`[crawlRegion] No-offer check: "${noOfferResult}"`)

    if (noOfferResult && noOfferResult !== '') {
      noOffers = true
    }

    // If eval-based price extraction found a price, don't mark as no-offers
    if (priceText && priceText.length > 0) {
      noOffers = false
    }

    // ── Step 9b: If no price from eval, try snapshot as fallback ──
    let extractedPrice = ''
    let extractedCurrency = region.currency

    if (priceText) {
      // Parse the price text we got from eval
      const parsed = parsePriceText(priceText, region.currency)
      if (parsed && parseFloat(parsed.price) > 0) {
        extractedPrice = parsed.price
        extractedCurrency = parsed.currency
      }
    }

    // If eval didn't yield a price, try snapshot approach
    if (!extractedPrice) {
      console.log(`[crawlRegion] No price from eval, trying snapshot fallback...`)

      // Try pinned offer snapshot
      let snapshotData = await runBrowserJSON(
        ['snapshot', '-s', '#aod-pinned-offer'],
        15000
      )
      let extracted = parseAodSnapshot(snapshotData)

      // If no pinned offer, try the offer list
      if (!extracted.hasPinnedOffer && !extracted.noOffers && !extracted.price) {
        snapshotData = await runBrowserJSON(
          ['snapshot', '-s', '#aod-offer-list'],
          15000
        )
        const offerListExtracted = parseAodSnapshot(snapshotData)
        if (offerListExtracted.price) {
          extracted = offerListExtracted
        } else if (offerListExtracted.noOffers) {
          extracted = offerListExtracted
        }
      }

      // If still nothing, try the full AOD container
      if (!extracted.hasPinnedOffer && !extracted.noOffers && !extracted.price) {
        snapshotData = await runBrowserJSON(
          ['snapshot', '-s', '#aod-container'],
          15000
        )
        extracted = parseAodSnapshot(snapshotData)
      }

      console.log(`[crawlRegion] Snapshot fallback result:`, JSON.stringify(extracted))

      if (extracted.noOffers) {
        noOffers = true
      }

      if (extracted.price) {
        extractedPrice = extracted.price
        if (extracted.currencySymbol) {
          const mapped = SYMBOL_TO_CODE[extracted.currencySymbol]
          if (mapped) extractedCurrency = mapped
        }
        // If we found a price from snapshot, it's not "no offers"
        noOffers = false
      }
    }

    // ── Step 10: Close browser ──
    console.log(`[crawlRegion] Closing browser...`)
    await runBrowser(['close'], 5000)

    // ── Build the result ──
    const resultName = nameText || na.name
    const resultImage = imageText || na.image

    if (noOffers || !extractedPrice) {
      return {
        ...na,
        name: resultName,
        image: resultImage,
        price: 'N/A',
        priceDisplay: 'N/A',
      }
    }

    const priceNum = parseFloat(extractedPrice)
    if (isNaN(priceNum) || priceNum <= 0) {
      return {
        ...na,
        name: resultName,
        image: resultImage,
        price: 'N/A',
        priceDisplay: 'N/A',
      }
    }

    return {
      domain: region.domain,
      region: region.region,
      name: resultName,
      image: resultImage,
      price: extractedPrice,
      currency: extractedCurrency,
      priceDisplay: formatPrice(extractedPrice, extractedCurrency),
      asin,
    }
  } catch (e) {
    console.error(`[crawlRegion] Error for ${asin} on ${region.domain}:`, e)

    // Try to close browser on error
    try {
      await runBrowser(['close'], 5000)
    } catch {
      // ignore
    }

    return { ...na, error: String(e) }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWL ACROSS MULTIPLE REGIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Crawl a single ASIN across all specified regions.
 * Regions are processed SEQUENTIALLY to avoid browser conflicts.
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
