#!/usr/bin/env node
/* eslint-disable */
/**
 * Standalone crawl script — runs in a separate process to avoid memory issues.
 * Usage: node crawl-standalone.js <asin> [region1,region2,...]
 * Output: JSON to stdout
 */

const { execFile } = require('child_process')

function runBrowser(args, timeout) {
  timeout = timeout || 30000
  return new Promise(function(resolve) {
    execFile('agent-browser', args, { timeout: timeout, maxBuffer: 10485760 }, function(error, stdout, stderr) {
      if (error && !stdout) { resolve((stderr || '').trim()); return }
      resolve((stdout || '').trim())
    })
  })
}

function runBrowserJSON(args, timeout) {
  timeout = timeout || 30000
  return runBrowser(args.concat(['--json']), timeout).then(function(raw) {
    try { return JSON.parse(raw) } catch { return null }
  })
}

var REGIONS = {
  COM: { domain: 'amazon.com', region: 'COM', currency: 'USD', cookie: 'USD', postal: '99950' },
  EG: { domain: 'amazon.eg', region: 'EG', currency: 'EGP', cookie: 'EGP' },
  DE: { domain: 'amazon.de', region: 'DE', currency: 'EUR', cookie: 'EUR', postal: '80331' },
  SA: { domain: 'amazon.sa', region: 'SA', currency: 'SAR', cookie: 'SAR' },
  AE: { domain: 'amazon.ae', region: 'AE', currency: 'AED', cookie: 'AED' },
}

var CURRENCY_SYMBOLS = { USD: '$', EUR: '\u20AC', GBP: '\u00A3', EGP: 'EGP ', SAR: 'SAR ', AED: 'AED ' }
var symbolToCode = { '$': 'USD', '\u20AC': 'EUR', '\u00A3': 'GBP', 'EGP': 'EGP', 'SAR': 'SAR', 'AED': 'AED', 'HKD': 'HKD' }

function formatPrice(price, currency) {
  if (price === 'N/A') return 'N/A'
  var num = parseFloat(price)
  if (!isNaN(num)) {
    var symbol = CURRENCY_SYMBOLS[currency] || currency + ' '
    return symbol + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return price
}

function parseAodSnapshot(snapshotJson) {
  var result = { hasPinnedOffer: false, noOffers: false, price: '', currencySymbol: '', name: '' }
  if (!snapshotJson || typeof snapshotJson !== 'object') return result
  var refs = (snapshotJson.data && snapshotJson.data.refs) || {}

  var trulyNoOfferPatterns = [
    'no featured offers available', 'no featured offers', 'currently unavailable',
    'keine empfohlenen angebote', 'keine angebote verfügbar', 'derzeit nicht verfügbar',
  ]
  for (var refId in refs) {
    var ref = refs[refId]
    var nameLower = (ref.name || '').toLowerCase()
    for (var i = 0; i < trulyNoOfferPatterns.length; i++) {
      if (nameLower.includes(trulyNoOfferPatterns[i])) { result.noOffers = true; break }
    }
  }

  for (var refId2 in refs) {
    var ref2 = refs[refId2]
    if (ref2.role === 'button' && ref2.name) {
      var nameLower2 = ref2.name.toLowerCase()
      if (nameLower2.includes('price')) {
        result.hasPinnedOffer = true
        var priceMatch = ref2.name.match(/price\s+([€$£]|EGP|SAR|AED|USD|EUR|HKD)?\s*([\d,]+\.?\d*)/i)
        if (priceMatch) {
          result.currencySymbol = priceMatch[1] || ''
          var rawPrice = priceMatch[2].replace(/,/g, '')
          if (rawPrice && parseFloat(rawPrice) > 0) { result.price = rawPrice; result.noOffers = false }
        }
        break
      }
    }
  }

  if (!result.price) {
    var snapshot = (snapshotJson.data && snapshotJson.data.snapshot) || ''
    var staticPriceMatch = snapshot.match(/StaticText\s+"([€$£]|EGP|SAR|AED|USD|EUR)\s*([\d,]+\.?\d*)"/)
    if (staticPriceMatch) {
      result.currencySymbol = staticPriceMatch[1]
      var rawPrice2 = staticPriceMatch[2].replace(/,/g, '')
      if (rawPrice2 && parseFloat(rawPrice2) > 0) result.price = rawPrice2
    }
  }

  var badNamePatterns = ['no other sellers', 'no featured offers', "didn't find", 'did not find', 'currently there are no', 'currently unavailable']
  for (var refId3 in refs) {
    var ref3 = refs[refId3]
    if (ref3.role === 'heading' && ref3.name && ref3.name.length > 5) {
      var nameLower3 = ref3.name.toLowerCase()
      var isBadName = false
      for (var j = 0; j < badNamePatterns.length; j++) {
        if (nameLower3.includes(badNamePatterns[j])) { isBadName = true; break }
      }
      if (!isBadName) { result.name = ref3.name.trim(); break }
    }
  }

  return result
}

async function crawlRegion(asin, regionKey) {
  var region = REGIONS[regionKey]
  if (!region) return { domain: '', region: regionKey, name: 'Product ' + asin, image: '', price: 'N/A', currency: '', priceDisplay: 'N/A', asin: asin, error: 'Unknown region' }
  var na = { domain: region.domain, region: region.region, name: 'Product ' + asin, image: '', price: 'N/A', currency: region.currency, priceDisplay: 'N/A', asin: asin }

  try {
    await runBrowser(['close'], 5000)
    await new Promise(function(r) { setTimeout(r, 500) })
    console.error('[crawl] Opening ' + region.domain + '...')
    await runBrowser(['open', 'https://www.' + region.domain + '/'], 20000)
    var cookieScript = "document.cookie='i18n-prefs=" + region.cookie + ";path=/;domain=." + region.domain + "';document.cookie='lc-main=en_US;path=/;domain=." + region.domain + "';'done'"
    await runBrowser(['eval', cookieScript], 8000)
    var aodUrl = 'https://www.' + region.domain + '/dp/' + asin + '/ref=olp-opf-redir?aod=1&language=en_US'
    if (region.postal) aodUrl += '&postalCode=' + region.postal
    console.error('[crawl] Navigating to ' + aodUrl)
    await runBrowser(['open', aodUrl], 35000)
    await runBrowser(['wait', '3000'], 5000)

    var snapshotData = await runBrowserJSON(['snapshot', '-s', '#aod-pinned-offer'], 10000)
    var extracted = parseAodSnapshot(snapshotData)
    if (!extracted.hasPinnedOffer && !extracted.noOffers && !extracted.price) {
      snapshotData = await runBrowserJSON(['snapshot', '-s', '#aod-offer-list'], 10000)
      var offerListExtracted = parseAodSnapshot(snapshotData)
      if (offerListExtracted.price) extracted = offerListExtracted
    }
    if (!extracted.hasPinnedOffer && !extracted.noOffers && !extracted.price) {
      snapshotData = await runBrowserJSON(['snapshot', '-s', '#aod-container'], 10000)
      var containerExtracted = parseAodSnapshot(snapshotData)
      if (containerExtracted.noOffers || containerExtracted.price) extracted = containerExtracted
    }

    console.error('[crawl] ' + regionKey + ': price=' + extracted.price + ' noOffers=' + extracted.noOffers)
    await runBrowser(['close'], 5000)

    if (extracted.noOffers || (!extracted.price && !extracted.hasPinnedOffer)) {
      return Object.assign({}, na, { name: extracted.name || na.name })
    }
    var currencyCode = region.currency
    if (extracted.currencySymbol) { var mapped = symbolToCode[extracted.currencySymbol]; if (mapped) currencyCode = mapped }
    var priceNum = parseFloat(extracted.price)
    if (!extracted.price || isNaN(priceNum) || priceNum <= 0) {
      return Object.assign({}, na, { name: extracted.name || na.name })
    }
    return { domain: region.domain, region: region.region, name: extracted.name || na.name, image: '', price: extracted.price, currency: currencyCode, priceDisplay: formatPrice(extracted.price, currencyCode), asin: asin }
  } catch (e) {
    console.error('[crawl] Error: ' + e.message)
    try { await runBrowser(['close'], 5000) } catch (err) { /* ignore */ }
    return Object.assign({}, na, { error: String(e) })
  }
}

async function main() {
  var asin = process.argv[2]
  var regionArg = process.argv[3]
  var regionKeys = regionArg ? regionArg.split(',') : Object.keys(REGIONS)
  if (!asin) { console.log(JSON.stringify({ error: 'No ASIN provided' })); process.exit(1) }

  var results = []
  for (var i = 0; i < regionKeys.length; i++) {
    var result = await crawlRegion(asin, regionKeys[i])
    results.push(result)
    if (i < regionKeys.length - 1) await new Promise(function(r) { setTimeout(r, 1000) })
  }
  try { await runBrowser(['close'], 5000) } catch (e) { /* ignore */ }
  console.log(JSON.stringify({ success: true, data: [{ asin: asin, results: results }] }))
}

main().catch(function(e) { console.log(JSON.stringify({ error: String(e) })); process.exit(1) })
