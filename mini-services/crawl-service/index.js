/**
 * Crawl Microservice — Standalone HTTP server for Amazon AOD crawling
 * 
 * Runs on port 3003. Completely isolated from Next.js server.
 * Uses agent-browser to scrape real Amazon AOD prices.
 * 
 * Prices come from AOD (All Offers Display) ONLY.
 * If AOD has no offers → return N/A.
 */

const http = require('http')
const { execFile } = require('child_process')
const { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')

const PORT = 3003
const TMP_DIR = '/tmp/crawl-results'

// Ensure temp dir
try { mkdirSync(TMP_DIR, { recursive: true }) } catch {}

// Region config
const REGIONS = {
  COM: { domain: 'amazon.com', region: 'COM', currency: 'USD', currencyCookie: 'USD', languageParam: 'en_US', postalCode: '99950', tldPath: '' },
  EG: { domain: 'amazon.eg', region: 'EG', currency: 'EGP', currencyCookie: 'EGP', languageParam: 'en_US', tldPath: '' },
  DE: { domain: 'amazon.de', region: 'DE', currency: 'EUR', currencyCookie: 'EUR', languageParam: 'en_US', postalCode: '80331', tldPath: '-/en' },
  SA: { domain: 'amazon.sa', region: 'SA', currency: 'SAR', currencyCookie: 'SAR', languageParam: 'en_US', tldPath: '-/en' },
  AE: { domain: 'amazon.ae', region: 'AE', currency: 'AED', currencyCookie: 'AED', languageParam: 'en_US', tldPath: '-/en' },
}

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', EGP: 'EGP ', SAR: 'SAR ', AED: 'AED ' }
const SYMBOL_TO_CURRENCY = { '$':'USD','€':'EUR','£':'GBP','EGP':'EGP','SAR':'SAR','AED':'AED','USD':'USD','EUR':'EUR','HKD':'HKD' }

function runBrowser(args, timeout = 30000) {
  return new Promise((resolve) => {
    const child = execFile('agent-browser', args, { timeout, maxBuffer: 10*1024*1024 }, (error, stdout, stderr) => {
      if (error && !stdout) { resolve(stderr?.trim() || ''); return }
      resolve(stdout?.trim() || '')
    })
    setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, timeout + 3000)
  })
}

async function killBrowser() {
  try { await runBrowser(['close'], 5000) } catch {}
  await new Promise(r => setTimeout(r, 1000))
}

function formatPrice(price, currency) {
  if (price === 'N/A') return 'N/A'
  const num = parseFloat(price)
  if (!isNaN(num)) { const sym = CURRENCY_SYMBOLS[currency]||currency+' '; return `${sym}${num.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}` }
  return price
}

function parsePriceParts(data, defaultCurrency) {
  if (!data) return null
  if (data.whole) {
    const wholeClean = data.whole.replace(/[.,\s]/g,'').trim()
    const fractionClean = data.fraction?.trim()||'00'
    if (wholeClean&&/^\d+$/.test(wholeClean)&&/^\d+$/.test(fractionClean)) {
      const priceStr = `${wholeClean}.${fractionClean}`
      if (parseFloat(priceStr)>0) return { price:priceStr, currency:SYMBOL_TO_CURRENCY[data.symbol?.trim()]||defaultCurrency }
    }
  }
  if (data.offscreen) {
    const nums = data.offscreen.match(/[\d,]+\.?\d*/g)
    if (nums?.length>0) {
      const value=nums[0].replace(/,/g,'')
      if (parseFloat(value)>0) return { price:value, currency:defaultCurrency }
    }
  }
  return null
}

function parseAtcLabel(label, defaultCurrency) {
  if (!label) return null
  const match = label.match(/price\s+([€$£]|EGP|SAR|AED|USD|EUR)?\s*([\d,]+\.?\d*)/i)
  if (match) {
    const rawPrice=match[2].replace(/,/g,'')
    if (parseFloat(rawPrice)>0) return { price:rawPrice, currency:SYMBOL_TO_CURRENCY[match[1]?.trim()]||defaultCurrency }
  }
  return null
}

const AOD_EXTRACT_JS = `JSON.stringify({
  hasAod: !!document.querySelector('#aod-container'),
  noOffers: !!document.querySelector('#aod-asin-no-offers, .aod-no-offer, #aod-unqualified-no-offer'),
  pinnedPrice: (() => { try { const p=document.querySelector('#aod-pinned-offer'); if(!p)return null; const e=p.querySelector('.a-price'); if(!e)return null; return {symbol:e.querySelector('.a-price-symbol')?.textContent?.trim()||'',whole:e.querySelector('.a-price-whole')?.textContent?.trim()||'',fraction:e.querySelector('.a-price-fraction')?.textContent?.trim()||'',offscreen:e.querySelector('.a-offscreen')?.textContent?.trim()||''}; } catch(e){return null;} })(),
  price0: (() => { try { const el=document.querySelector('#aod-price-0'); if(!el)return null; const e=el.querySelector('.a-price'); if(!e)return null; return {symbol:e.querySelector('.a-price-symbol')?.textContent?.trim()||'',whole:e.querySelector('.a-price-whole')?.textContent?.trim()||'',fraction:e.querySelector('.a-price-fraction')?.textContent?.trim()||'',offscreen:e.querySelector('.a-offscreen')?.textContent?.trim()||''}; } catch(e){return null;} })(),
  atcLabel: (() => { try { return document.querySelector('input[name="submit.addToCart"]')?.getAttribute('aria-label')||null; } catch(e){return null;} })(),
  name: (() => { try { return document.querySelector('#aod-asin-title-text')?.textContent?.trim()||null; } catch(e){return null;} })(),
  image: (() => { try { return document.querySelector('#aod-asin-image-id')?.src||null; } catch(e){return null;} })(),
})`

async function crawlRegion(asin, regionKey) {
  const region = REGIONS[regionKey]
  if (!region) return { domain:'',region:regionKey,name:`Product ${asin}`,image:'',price:'N/A',currency:'',priceDisplay:'N/A',asin,error:'Unknown region' }
  const na = { domain:region.domain,region:region.region,name:`Product ${asin}`,image:'',price:'N/A',currency:region.currency,priceDisplay:'N/A',asin }

  try {
    await killBrowser()
    const homeUrl = `https://www.${region.domain}/${region.tldPath?region.tldPath+'/':''}`
    console.error(`[crawlRegion] ${regionKey}: Opening ${homeUrl}...`)
    await runBrowser(['open', homeUrl], 25000)
    await runBrowser(['eval', `document.cookie='i18n-prefs=${region.currencyCookie};path=/;domain=.${region.domain}';document.cookie='lc-main=${region.languageParam};path=/;domain=.${region.domain}';'done'`], 8000)
    const aodUrl = `https://www.${region.domain}/${region.tldPath?region.tldPath+'/':''}dp/${asin}/ref=olp-opf-redir?aod=1&language=${region.languageParam}${region.postalCode?`&postalCode=${region.postalCode}`:''}`
    console.error(`[crawlRegion] ${regionKey}: Navigating to AOD...`)
    await runBrowser(['open', aodUrl], 45000)
    await runBrowser(['wait', '5000'], 8000)
    const rawResult = await runBrowser(['eval', AOD_EXTRACT_JS], 15000)

    let aodData
    try { aodData = JSON.parse(rawResult.replace(/^"/,'').replace(/"$/,'').replace(/\\"/g,'"')) }
    catch { return { ...na, error:'Failed to parse AOD data' } }

    if (aodData.noOffers) return { ...na, name:aodData.name||na.name, image:aodData.image||na.image }
    if (!aodData.hasAod) return { ...na, name:aodData.name||na.name, image:aodData.image||na.image, error:'AOD container not found' }

    let priceResult = parsePriceParts(aodData.pinnedPrice, region.currency)
    if (!priceResult) priceResult = parsePriceParts(aodData.price0, region.currency)
    if (!priceResult&&aodData.atcLabel) priceResult = parseAtcLabel(aodData.atcLabel, region.currency)

    if (!priceResult||isNaN(parseFloat(priceResult.price))||parseFloat(priceResult.price)<=0)
      return { ...na, name:aodData.name||na.name, image:aodData.image||na.image }

    return { domain:region.domain,region:region.region,name:aodData.name||na.name,image:aodData.image||na.image,price:priceResult.price,currency:priceResult.currency,priceDisplay:formatPrice(priceResult.price,priceResult.currency),asin }
  } catch(e) {
    console.error(`[crawlRegion] ${regionKey} error:`, e.message)
    return { ...na, error:String(e) }
  } finally {
    await killBrowser()
  }
}

// ━━━ HTTP Server ━━━

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.url === '/health') {
    res.writeHead(200, {'Content-Type':'application/json'})
    res.end(JSON.stringify({status:'ok',service:'crawl-service'}))
    return
  }

  if (req.url === '/crawl' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { asin, regions } = JSON.parse(body)
        if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) {
          res.writeHead(400, {'Content-Type':'application/json'})
          res.end(JSON.stringify({success:false,error:'Invalid ASIN'}))
          return
        }
        const cleanAsin = asin.trim().toUpperCase()
        const regionKeys = regions || Object.keys(REGIONS)
        console.error(`[crawl] Starting crawl for ${cleanAsin} in ${regionKeys.join(',')}`)

        const results = []
        for (const key of regionKeys) {
          const result = await crawlRegion(cleanAsin, key)
          results.push(result)
          if (regionKeys.indexOf(key) < regionKeys.length - 1)
            await new Promise(r => setTimeout(r, 2000))
        }

        console.error(`[crawl] Done: ${results.map(r=>`${r.region}=${r.priceDisplay}`).join(', ')}`)
        res.writeHead(200, {'Content-Type':'application/json'})
        res.end(JSON.stringify({success:true,asin:cleanAsin,data:results}))
      } catch(e) {
        console.error('[crawl] Error:', e.message)
        res.writeHead(500, {'Content-Type':'application/json'})
        res.end(JSON.stringify({success:false,error:String(e)}))
      }
    })
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => console.error(`🚀 Crawl service running on port ${PORT}`))
