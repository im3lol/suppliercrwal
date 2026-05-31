/**
 * Centralized Crawl Logger — Stores detailed debug logs for every crawl operation
 *
 * This logger captures:
 * - Crawleo API request details (URL, params, headers)
 * - Crawleo API response (status, timing, credits)
 * - HTML content received (size, snippets)
 * - Price parsing steps (which strategy matched, regex results)
 * - Errors with full stack traces
 * - All intermediate values for debugging
 *
 * Logs are stored in memory (up to 500 entries) and accessible via API.
 */

export interface CrawlLogEntry {
  id: string
  timestamp: string
  asin: string
  region: string

  // Request details
  request: {
    crawleoApiUrl: string
    targetUrl: string
    geolocation: string
    renderJs: boolean
    rawHtml: boolean
    apiKeyPrefix: string  // Only first 8 chars of API key for security
  }

  // Response details
  response: {
    crawleoHttpStatus: number
    pageStatusCode: number
    credits: number
    retryCount: number
    timingMs: number
    errorMsg: string
  }

  // Content details
  content: {
    htmlSize: number
    markdownSize: number
    htmlSnippet: string    // First 2000 chars of HTML for debugging
    markdownSnippet: string // First 1000 chars of markdown
    title: string          // Page title
    hasOfferListing: boolean  // Does HTML contain offer-listing markers?
    hasAodContainer: boolean  // Does HTML contain AOD container?
    hasPriceElements: boolean // Does HTML contain price elements?
    detectedNoOffers: boolean // Were no-offer phrases detected?
  }

  // Parsing details
  parsing: {
    strategy: string         // Which strategy found the price
    rawPriceText: string     // The raw text before parsing
    parsedPrice: string      // Final parsed price
    currency: string         // Currency detected
    aodOfferCount: number    // Number of offers detected
    aPriceCount: number      // Number of a-price elements
    strategyLog: StrategyLogEntry[]  // Step-by-step log of each parsing attempt
  }

  // Final result
  result: {
    price: string
    priceDisplay: string
    error: string
  }
}

export interface StrategyLogEntry {
  strategy: string
  attempted: boolean
  matched: boolean
  rawMatch: string
  parsedValue: string
  notes: string
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IN-MEMORY LOG STORE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const MAX_LOGS = 500
const logStore: CrawlLogEntry[] = []

let logCounter = 0

export function addLog(entry: CrawlLogEntry): void {
  logStore.unshift(entry) // Newest first
  if (logStore.length > MAX_LOGS) {
    logStore.pop()
  }
}

export function getLogs(limit = 100, offset = 0): { logs: CrawlLogEntry[]; total: number } {
  return {
    logs: logStore.slice(offset, offset + limit),
    total: logStore.length,
  }
}

export function getLogById(id: string): CrawlLogEntry | undefined {
  return logStore.find((l) => l.id === id)
}

export function clearLogs(): void {
  logStore.length = 0
  logCounter = 0
}

export function nextLogId(): string {
  logCounter++
  return `log_${Date.now()}_${logCounter}`
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LOG BUILDER — Helper to build log entries step by step
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class CrawlLogBuilder {
  private entry: Partial<CrawlLogEntry>

  constructor(asin: string, region: string) {
    this.entry = {
      id: nextLogId(),
      timestamp: new Date().toISOString(),
      asin,
      region,
      request: {
        crawleoApiUrl: '',
        targetUrl: '',
        geolocation: '',
        renderJs: true,
        rawHtml: true,
        apiKeyPrefix: '',
      },
      response: {
        crawleoHttpStatus: 0,
        pageStatusCode: 0,
        credits: 0,
        retryCount: 0,
        timingMs: 0,
        errorMsg: '',
      },
      content: {
        htmlSize: 0,
        markdownSize: 0,
        htmlSnippet: '',
        markdownSnippet: '',
        title: '',
        hasOfferListing: false,
        hasAodContainer: false,
        hasPriceElements: false,
        detectedNoOffers: false,
      },
      parsing: {
        strategy: '',
        rawPriceText: '',
        parsedPrice: '',
        currency: '',
        aodOfferCount: -1,
        aPriceCount: -1,
        strategyLog: [],
      },
      result: {
        price: '',
        priceDisplay: '',
        error: '',
      },
    }
  }

  setRequest(opts: {
    crawleoApiUrl: string
    targetUrl: string
    geolocation: string
    apiKey: string
  }): this {
    this.entry.request!.crawleoApiUrl = opts.crawleoApiUrl
    this.entry.request!.targetUrl = opts.targetUrl
    this.entry.request!.geolocation = opts.geolocation
    this.entry.request!.apiKeyPrefix = opts.apiKey ? `${opts.apiKey.slice(0, 8)}...` : '(empty)'
    return this
  }

  setResponse(opts: {
    crawleoHttpStatus: number
    pageStatusCode: number
    credits: number
    retryCount: number
    timingMs: number
    errorMsg: string
  }): this {
    this.entry.response!.crawleoHttpStatus = opts.crawleoHttpStatus
    this.entry.response!.pageStatusCode = opts.pageStatusCode
    this.entry.response!.credits = opts.credits
    this.entry.response!.retryCount = opts.retryCount
    this.entry.response!.timingMs = opts.timingMs
    this.entry.response!.errorMsg = opts.errorMsg
    return this
  }

  setContent(html: string, markdown: string): this {
    const content = this.entry.content!
    content.htmlSize = html.length
    content.markdownSize = markdown.length
    content.htmlSnippet = html.slice(0, 2000)
    content.markdownSnippet = markdown.slice(0, 1000)

    const lowerHtml = html.toLowerCase()
    const lowerMd = markdown.toLowerCase()

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    content.title = titleMatch ? titleMatch[1].trim().slice(0, 200) : ''

    // Detect offer-listing markers
    content.hasOfferListing =
      lowerHtml.includes('offer-listing') ||
      lowerHtml.includes('olpOfferPrice') ||
      lowerHtml.includes('olpOffer')

    // Detect AOD container
    content.hasAodContainer =
      lowerHtml.includes('aod-container') ||
      lowerHtml.includes('aod-total-offer-count') ||
      lowerHtml.includes('aod-price-')

    // Detect price elements
    content.hasPriceElements =
      lowerHtml.includes('a-price-whole') ||
      lowerHtml.includes('a-offscreen') ||
      lowerHtml.includes('aok-offscreen') ||
      lowerHtml.includes('olpOfferPrice')

    // Detect no-offer phrases
    const noOfferPhrases = [
      'no featured offers available',
      'no featured offers',
      'currently unavailable',
      'no offers available',
      'no sellers',
      'no other sellers',
      '\u0644\u0627 \u064a\u0648\u062c\u062f \u0628\u0627\u0626\u0639\u0648\u0646',
      '\u0644\u0627 \u064a\u062a\u0648\u0641\u0631',
    ]
    content.detectedNoOffers = noOfferPhrases.some(p => lowerHtml.includes(p) || lowerMd.includes(p))

    return this
  }

  addStrategyLog(log: StrategyLogEntry): this {
    this.entry.parsing!.strategyLog.push(log)
    return this
  }

  setParsing(opts: {
    strategy: string
    rawPriceText: string
    parsedPrice: string
    currency: string
    aodOfferCount: number
    aPriceCount: number
  }): this {
    this.entry.parsing!.strategy = opts.strategy
    this.entry.parsing!.rawPriceText = opts.rawPriceText
    this.entry.parsing!.parsedPrice = opts.parsedPrice
    this.entry.parsing!.currency = opts.currency
    this.entry.parsing!.aodOfferCount = opts.aodOfferCount
    this.entry.parsing!.aPriceCount = opts.aPriceCount
    return this
  }

  setResult(price: string, priceDisplay: string, error: string): this {
    this.entry.result!.price = price
    this.entry.result!.priceDisplay = priceDisplay
    this.entry.result!.error = error
    return this
  }

  build(): CrawlLogEntry {
    return this.entry as CrawlLogEntry
  }
}
