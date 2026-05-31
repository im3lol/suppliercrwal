/**
 * Crawleo AOD Crawler Mini-Service (Node.js)
 *
 * Uses Node.js http/https modules instead of Bun fetch for stability.
 * The Crawleo API returns large responses (100KB+) that crash Bun/Next.js fetch.
 *
 * Port: 3002
 */

const http = require('http')
const https = require('https')

const PORT = 3002

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const REGIONS = {
  COM: { domain: 'amazon.com', currency: 'USD', geo: 'us' },
  EG: { domain: 'amazon.eg', currency: 'EGP', geo: 'eg' },
  DE: { domain: 'amazon.de', currency: 'EUR', geo: 'de' },
  SA: { domain: 'amazon.sa', currency: 'SAR', geo: 'sa' },
  AE: { domain: 'amazon.ae', currency: 'AED', geo: 'ae' },
}

const CURRENCY_SYMBOLS = {
  USD: '$', EUR: '\u20ac', GBP: '\u00a3',
  EGP: 'EGP ', SAR: 'SAR ', AED: 'AED ',
}

const CRAWLEO_API_URL = 'https://api.crawleo.dev/crawl'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function formatPriceDisplay(price, currency) {
  if (price === 'N/A') return 'N/A'
  const num = parseFloat(price)
  if (isNaN(num)) return price
  const symbol = CURRENCY_SYMBOLS[currency] || currency + ' '
  return symbol + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function cleanWhole(s) { return s.replace(/[,.\s\u200e\u200f]/g, '') }

function identifyCurrency(symbol, def) {
  const s = symbol.trim().replace(/[\u200e\u200f]/g, '')
  if (s === '$') return 'USD'; if (s === '\u20ac') return 'EUR'; if (s === '\u00a3') return 'GBP'
  if (s.toUpperCase() === 'SAR') return 'SAR'; if (s.toUpperCase() === 'AED') return 'AED'; if (s.toUpperCase() === 'EGP') return 'EGP'
  if (s === '\u062c\u0646\u064a\u0647' || s === '\u062c.\u0645') return 'EGP'
  if (s === '\u0631\u064a\u0627\u0644' || s === '\u0631.\u0633') return 'SAR'
  if (s === '\u062f\u0631\u0647\u0645' || s === '\u062f.\u0625') return 'AED'
  return def
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWLEO API FETCH (using https module)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function fetchWithCrawleo(url, apiKey, geolocation) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      urls: url, render_js: 'true', raw_html: 'true',
      enhanced_html: 'true', markdown: 'true',
    })
    if (geolocation) params.set('geolocation', geolocation)

    const apiUrl = `${CRAWLEO_API_URL}?${params.toString()}`
    console.log(`[Crawleo] Fetching: ${url} (geo=${geolocation})`)

    const req = https.get(apiUrl, {
      headers: { 'x-api-key': apiKey },
      timeout: 120000,
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (!parsed.results || parsed.results.length === 0) {
            console.error('[Crawleo] No results returned')
            resolve(null)
            return
          }
          const result = parsed.results[0]
          if (result.error) {
            console.error(`[Crawleo] Error: ${result.error}`)
            resolve(null)
            return
          }
          const rawHtml = result.raw_html || ''
          const markdown = result.markdown || ''
          const credits = parsed.credits || 0
          console.log(`[Crawleo] Success! Credits: ${credits}, raw_html: ${rawHtml.length} chars`)
          resolve({ raw_html: rawHtml, enhanced_html: result.enhanced_html || '', markdown })
        } catch (e) {
          console.error(`[Crawleo] Parse error: ${e.message}`)
          resolve(null)
        }
      })
    })

    req.on('error', (e) => {
      console.error(`[Crawleo] Request error: ${e.message}`)
      resolve(null)
    })

    req.on('timeout', () => {
      console.error('[Crawleo] Request timeout')
      req.destroy()
      resolve(null)
    })
  })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PRICE PARSING (same logic as Python scraper)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function parseNumberWithCurrency(ns, currency) {
  ns = ns.trim()
  const lastDot = ns.lastIndexOf('.')
  const lastComma = ns.lastIndexOf(',')

  if (lastDot === -1 && lastComma === -1) {
    const val = parseInt(ns, 10)
    if (val > 0) return { price: val + '.00', currency }
    return null
  }

  let wholePart, fracPart
  if (lastDot > lastComma) {
    wholePart = ns.slice(0, lastDot); fracPart = ns.slice(lastDot + 1)
    if (fracPart.length === 2 || fracPart.length === 1) {
      const wc = cleanWhole(wholePart)
      const val = parseFloat(wc + '.' + (fracPart.length === 1 ? fracPart + '0' : fracPart))
      if (val > 0) return { price: wc + '.' + (fracPart.length === 1 ? fracPart + '0' : fracPart), currency }
    }
  } else if (lastComma > lastDot) {
    wholePart = ns.slice(0, lastComma); fracPart = ns.slice(lastComma + 1)
    if (fracPart.length === 2) {
      const wc = cleanWhole(wholePart)
      const val = parseFloat(wc + '.' + fracPart)
      if (val > 0) return { price: wc + '.' + fracPart, currency }
    }
  } else if (lastComma > -1) {
    fracPart = ns.slice(lastComma + 1); wholePart = ns.slice(0, lastComma)
    if (fracPart.length === 2 && wholePart.length <= 3) {
      const wc = cleanWhole(wholePart)
      const val = parseFloat(wc + '.' + fracPart)
      if (val > 0) return { price: wc + '.' + fracPart, currency }
    } else if (fracPart.length === 3) {
      const wc = cleanWhole(ns)
      const val = parseFloat(wc)
      if (val > 0) return { price: wc + '.00', currency }
    }
  } else if (lastDot > -1) {
    fracPart = ns.slice(lastDot + 1); wholePart = ns.slice(0, lastDot)
    if (fracPart.length === 2) {
      const wc = cleanWhole(wholePart)
      const val = parseFloat(wc + '.' + fracPart)
      if (val > 0) return { price: wc + '.' + fracPart, currency }
    }
  }
  return null
}

function extractPriceFromText(text, defaultCurrency) {
  if (!text) return null
  let clean = text.replace(/\s+(with|mit|\u0645\u0639)\s+\d+\s+(percent|Prozent|\u0628\u0627\u0644\u0645\u0626\u0629|%)\s+(savings|Einsparungen|\u062a\u0648\u0641\u064a\u0631)/gi, '').trim()
  clean = clean.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[\u200e\u200f]/g, '').trim()

  const patterns = [
    [/\u20ac\s*([\d.,]+)/, 'EUR'], [/([\d.,]+)\s*\u20ac/, 'EUR'],
    [/\$\s*([\d.,]+)/, 'USD'], [/SAR\s*([\d.,]+)/i, 'SAR'],
    [/AED\s*([\d.,]+)/i, 'AED'], [/EGP\s*([\d.,]+)/i, 'EGP'],
    [/\u062c\u0646\u064a\u0647\s*([\d.,]+)/, 'EGP'], [/([\d.,]+)\s*\u062c\u0646\u064a\u0647/, 'EGP'],
    [/\u0631\u064a\u0627\u0644\s*([\d.,]+)/, 'SAR'], [/([\d.,]+)\s*\u0631\u064a\u0627\u0644/, 'SAR'],
    [/\u0631\.\u0633\s*([\d.,]+)/, 'SAR'],
    [/\u062f\u0631\u0647\u0645\s*([\d.,]+)/, 'AED'], [/([\d.,]+)\s*\u062f\u0631\u0647\u0645/, 'AED'],
    [/\u062f\.\u0625\s*([\d.,]+)/, 'AED'],
    [/([\d.,]+)/, defaultCurrency],
  ]

  for (const [regex, curr] of patterns) {
    const m = clean.match(regex)
    if (m) {
      const r = parseNumberWithCurrency(m[1], curr)
      if (r) return r
    }
  }
  return null
}

function extractPriceFromMarkdown(md, defaultCurrency) {
  const patterns = [
    [/([\d.,]+)\s*\u20ac/, 'EUR'], [/\u20ac\s*([\d.,]+)/, 'EUR'],
    [/\$\s*([\d.,]+)/, 'USD'], [/SAR\s*([\d.,]+)/i, 'SAR'],
    [/AED\s*([\d.,]+)/i, 'AED'], [/EGP\s*([\d.,]+)/i, 'EGP'],
    [/\u062c\u0646\u064a\u0647\s*([\d.,]+)/, 'EGP'], [/([\d.,]+)\s*\u062c\u0646\u064a\u0647/, 'EGP'],
    [/\u0631\u064a\u0627\u0644\s*([\d.,]+)/, 'SAR'], [/([\d.,]+)\s*\u0631\u064a\u0627\u0644/, 'SAR'],
    [/\u062f\u0631\u0647\u0645\s*([\d.,]+)/, 'AED'], [/([\d.,]+)\s*\u062f\u0631\u0647\u0645/, 'AED'],
  ]
  for (const [regex, curr] of patterns) {
    const m = md.match(regex)
    if (m) { const r = parseNumberWithCurrency(m[1], curr); if (r) return r }
  }
  return null
}

function parsePrice(rawHtml, markdown, regionKey) {
  const region = REGIONS[regionKey] || REGIONS.COM
  const defaultCurrency = region.currency
  const htmlClean = rawHtml.replace(/[\u200e\u200f]/g, '')
  const mdClean = markdown.replace(/[\u200e\u200f]/g, '')

  // Extract name
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
    const nm = mdClean.match(/^#{1,5}\s+(.+?)(?:\n|$)/)
    if (nm) name = nm[1].trim().slice(0, 300)
  }
  name = name.replace(/\s+\d+[.,]\d+\s*(\u062c\u0646\u064a\u0647|\u0631\u064a\u0627\u0644|\u062f\u0631\u0647\u0645|EGP|SAR|AED|\$|\u20ac).*$/i, '')
  name = name.replace(/\s+(\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644|Sign in|Anmelden).*$/i, '').trim()

  // Extract image
  let image = ''
  const imgMatch = htmlClean.match(/src=["']?(https?:\/\/[^"'>\s]*images-amazon[^"'>\s]*\/images\/I\/[^"'>\s]+)/)
  if (imgMatch) image = imgMatch[1]

  // Check offers
  const offerCountMatch = htmlClean.match(/id="aod-total-offer-count"[^>]*value="(\d+)"/)
    || htmlClean.match(/value="(\d+)"[^>]*id="aod-total-offer-count"/)
  const totalOffers = offerCountMatch ? parseInt(offerCountMatch[1], 10) : -1
  const priceElements = htmlClean.match(/id="aod-price-\d+"/g) || []
  const hasPriceElements = priceElements.length > 0

  console.log(`[Parse] offer-count=${totalOffers}, price-elements=${priceElements.length}`)

  if (totalOffers === 0 && !hasPriceElements) {
    return { price: 'N/A', currency: defaultCurrency, name, image }
  }

  // Strategy 1: Accessibility label
  const accRegex = /<span[^>]*class="[^"]*aok-offscreen[^"]*apex-pricetopay[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/g
  let accMatch
  while ((accMatch = accRegex.exec(htmlClean)) !== null) {
    const r = extractPriceFromText(accMatch[1].trim(), defaultCurrency)
    if (r) { console.log(`[Parse] From accessibility: ${JSON.stringify(r)}`); return { ...r, name, image } }
  }

  // Strategy 2: a-price components
  const pbRegex = /<span[^>]*class="[^"]*a-price[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*a-price-symbol[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>[\s\S]*?<span[^>]*class="[^"]*a-price-whole[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]*class="[^"]*a-price-fraction[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/
  const pb = pbRegex.exec(htmlClean)
  if (pb) {
    const symbol = pb[1].trim()
    const whole = cleanWhole(pb[2].trim().replace(/[,.]$/, ''))
    const fraction = pb[3].trim()
    const val = parseFloat(whole + '.' + fraction)
    if (val > 0) {
      const curr = identifyCurrency(symbol, defaultCurrency)
      console.log(`[Parse] From a-price: ${whole}.${fraction} ${curr}`)
      return { price: whole + '.' + fraction, currency: curr, name, image }
    }
  }

  // Strategy 3: a-offscreen
  const offRegex = /<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/g
  let offMatch
  while ((offMatch = offRegex.exec(htmlClean)) !== null) {
    const r = extractPriceFromText(offMatch[1].trim(), defaultCurrency)
    if (r && parseFloat(r.price) >= 0.5) {
      console.log(`[Parse] From a-offscreen: ${JSON.stringify(r)}`)
      return { ...r, name, image }
    }
  }

  // Strategy 4: Markdown
  const mr = extractPriceFromMarkdown(mdClean, defaultCurrency)
  if (mr) { console.log(`[Parse] From markdown: ${JSON.stringify(mr)}`); return { ...mr, name, image } }

  // Fallback
  if (totalOffers === -1 && !hasPriceElements) {
    const lh = htmlClean.toLowerCase()
    const lm = mdClean.toLowerCase()
    const hasNoFeatured = ['no featured offers available', 'no featured offers'].some(p => lh.includes(p) || lm.includes(p))
    const noOtherSellers = lh.includes('no other sellers') || lm.includes('no other sellers')
    if (hasNoFeatured && noOtherSellers) return { price: 'N/A', currency: defaultCurrency, name, image }
  }

  console.log(`[Parse] No price found → N/A`)
  return { price: 'N/A', currency: defaultCurrency, name, image }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN CRAWL FUNCTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function crawlRegion(asin, regionKey, crawleoApiKey) {
  const region = REGIONS[regionKey]
  if (!region) {
    return { domain: '', region: regionKey, name: `Product ${asin}`, image: '', price: 'N/A', currency: '', priceDisplay: 'N/A', asin, error: 'Unknown region' }
  }

  const url = `https://www.${region.domain}/gp/product/ajax/aodAjaxMain/?asin=${asin}`
  console.log(`[crawlRegion] ${asin} on ${regionKey}...`)

  const crawleoResult = await fetchWithCrawleo(url, crawleoApiKey, region.geo)
  if (!crawleoResult) {
    return { domain: region.domain, region: regionKey, name: `Product ${asin}`, image: '', price: 'N/A', currency: region.currency, priceDisplay: 'N/A', asin, error: 'Crawleo fetch failed' }
  }

  const html = crawleoResult.raw_html || crawleoResult.enhanced_html
  const parsed = parsePrice(html, crawleoResult.markdown, regionKey)

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

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method !== 'POST') { res.writeHead(405); res.end('Method not allowed'); return }

  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', async () => {
    try {
      const { asin, region, crawleoApiKey } = JSON.parse(body)
      const cleanAsin = (asin || '').trim().toUpperCase()
      const regionKey = (region || 'COM').trim().toUpperCase()

      if (!cleanAsin || !/^[A-Z0-9]{10}$/.test(cleanAsin)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Valid ASIN required' }))
        return
      }

      if (!crawleoApiKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Crawleo API key required' }))
        return
      }

      if (!REGIONS[regionKey]) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `Invalid region: ${regionKey}` }))
        return
      }

      console.log(`[API] ${cleanAsin} on ${regionKey}`)
      const result = await crawlRegion(cleanAsin, regionKey, crawleoApiKey)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, asin: cleanAsin, results: [result] }))
    } catch (e) {
      console.error('[API Error]:', e)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Crawl failed', details: String(e) }))
    }
  })
})

server.listen(PORT, () => {
  console.log(`🚀 Crawleo AOD Crawler service running on port ${PORT} (Node.js)`)
})
