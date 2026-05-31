#!/usr/bin/env node
/**
 * Standalone AOD Crawl Script
 *
 * Usage: node crawl-aod.js <ASIN> <REGIONS_COMMA_SEPARATED>
 * Output: JSON to stdout
 *
 * Uses agent-browser to scrape real Amazon AOD prices.
 * Prices come from AOD (All Offers Display) ONLY.
 * If AOD has no offers → return N/A.
 */

const { execFile } = require('child_process')

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REGION CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const REGIONS = {
  COM: { domain: 'amazon.com', region: 'COM', currency: 'USD', currencyCookie: 'USD', languageParam: 'en_US', postalCode: '99950', tldPath: '' },
  EG: { domain: 'amazon.eg', region: 'EG', currency: 'EGP', currencyCookie: 'EGP', languageParam: 'en_US', tldPath: '' },
  DE: { domain: 'amazon.de', region: 'DE', currency: 'EUR', currencyCookie: 'EUR', languageParam: 'en_US', postalCode: '80331', tldPath: '-/en' },
  SA: { domain: 'amazon.sa', region: 'SA', currency: 'SAR', currencyCookie: 'SAR', languageParam: 'en_US', tldPath: '-/en' },
  AE: { domain: 'amazon.ae', region: 'AE', currency: 'AED', currencyCookie: 'AED', languageParam: 'en_US', tldPath: '-/en' },
}

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', EGP: 'EGP ', SAR: 'SAR ', AED: 'AED ' }

const SYMBOL_TO_CURRENCY = {
  '$': 'USD', '€': 'EUR', '£': 'GBP', 'EGP': 'EGP', 'SAR': 'SAR', 'AED': 'AED',
  'USD': 'USD', 'EUR': 'EUR', 'HKD': 'HKD',
  'ر.س': 'SAR', 'د.إ': 'AED', 'ج.م': 'EGP',
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BROWSER HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function runBrowser(args, timeout = 30000) {
  return new Promise((resolve) => {
    const child = execFile('agent-browser', args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !stdout) {
        console.error(`[agent-browser] error:`, error.message?.substring(0, 200))
        resolve(stderr?.trim() || '')
        return
      }
      resolve(stdout?.trim() || '')
    })
    setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, timeout + 3000)
  })
}

async function killBrowser() {
  try { await runBrowser(['close'], 5000) } catch {}
  await new Promise(r => setTimeout(r, 1000))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PRICE HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function formatPrice(price, currency) {
  if (price === 'N/A') return 'N/A'
  const num = parseFloat(price)
  if (!isNaN(num)) {
    const symbol = CURRENCY_SYMBOLS[currency] || currency + ' '
    return `${symbol}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return price
}

function parsePriceParts(data, defaultCurrency) {
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
      if (parseFloat(value) > 0) {
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

function parseAtcLabel(label, defaultCurrency) {
  if (!label) return null
  const match = label.match(/price\s+([€$£]|EGP|SAR|AED|USD|EUR)?\s*([\d,]+\.?\d*)/i)
  if (match) {
    const symbol = match[1] || ''
    const rawPrice = match[2].replace(/,/g, '')
    if (parseFloat(rawPrice) > 0) {
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

async function crawlRegion(asin, regionKey) {
  const region = REGIONS[regionKey]
  if (!region) return { domain: '', region: regionKey, name: `Product ${asin}`, image: '', price: 'N/A', currency: '', priceDisplay: 'N/A', asin, error: 'Unknown region' }

  const na = { domain: region.domain, region: region.region, name: `Product ${asin}`, image: '', price: 'N/A', currency: region.currency, priceDisplay: 'N/A', asin }

  try {
    await killBrowser()

    const homeUrl = `https://www.${region.domain}/${region.tldPath ? region.tldPath + '/' : ''}`
    console.error(`[crawlRegion] Opening ${homeUrl}...`)
    await runBrowser(['open', homeUrl], 25000)

    const cookieScript = `document.cookie='i18n-prefs=${region.currencyCookie};path=/;domain=.${region.domain}';document.cookie='lc-main=${region.languageParam};path=/;domain=.${region.domain}';'done'`
    await runBrowser(['eval', cookieScript], 8000)

    const aodUrl = `https://www.${region.domain}/${region.tldPath ? region.tldPath + '/' : ''}dp/${asin}/ref=olp-opf-redir?aod=1&language=${region.languageParam}${region.postalCode ? `&postalCode=${region.postalCode}` : ''}`
    console.error(`[crawlRegion] Navigating to AOD: ${aodUrl}`)
    await runBrowser(['open', aodUrl], 45000)

    await runBrowser(['wait', '5000'], 8000)

    console.error(`[crawlRegion] Extracting AOD data for ${asin} on ${region.domain}...`)
    const rawResult = await runBrowser(['eval', AOD_EXTRACT_JS], 15000)

    let aodData
    try {
      const cleaned = rawResult.replace(/^"/, '').replace(/"$/, '').replace(/\\"/g, '"')
      aodData = JSON.parse(cleaned)
    } catch (e) {
      console.error(`[crawlRegion] Failed to parse AOD data:`, rawResult?.substring(0, 200))
      return { ...na, error: 'Failed to parse AOD data' }
    }

    console.error(`[crawlRegion] AOD data for ${asin} on ${region.domain}:`, JSON.stringify(aodData))

    if (aodData.noOffers) return { ...na, name: aodData.name || na.name, image: aodData.image || na.image }
    if (!aodData.hasAod) return { ...na, name: aodData.name || na.name, image: aodData.image || na.image, error: 'AOD container not found' }

    let priceResult = null
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
      priceDisplay: formatPrice(priceResult.price, priceResult.currency), asin,
    }
  } catch (e) {
    console.error(`[crawlRegion] Error for ${asin} on ${region.domain}:`, e)
    return { ...na, error: String(e) }
  } finally {
    await killBrowser()
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  const asin = process.argv[2]
  const regionKeys = process.argv[3] ? process.argv[3].split(',') : Object.keys(REGIONS)
  const resultFile = process.argv[4] || null // Optional: path to write results to

  if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) {
    const output = JSON.stringify({ success: false, error: 'Invalid ASIN' })
    if (resultFile) {
      require('fs').writeFileSync(resultFile, output)
    } else {
      console.log(output)
    }
    process.exit(1)
  }

  const cleanAsin = asin.trim().toUpperCase()
  console.error(`[main] Crawling ${cleanAsin} in regions: ${regionKeys.join(',')}`)

  const results = []
  for (const key of regionKeys) {
    const result = await crawlRegion(cleanAsin, key)
    results.push(result)
    if (regionKeys.indexOf(key) < regionKeys.length - 1) {
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  console.error(`[main] Done: ${results.map(r => `${r.region}=${r.priceDisplay}`).join(', ')}`)
  const output = JSON.stringify({ success: true, asin: cleanAsin, data: results })

  if (resultFile) {
    require('fs').writeFileSync(resultFile, output)
    console.error(`[main] Results written to ${resultFile}`)
  } else {
    console.log(output)
  }
}

main().catch(e => {
  console.log(JSON.stringify({ success: false, error: String(e) }))
  process.exit(1)
})
