/**
 * AOD Crawler Module — Re-exports from browser-crawler
 *
 * The actual crawling is done by browser-crawler.ts which uses
 * agent-browser CLI to scrape real Amazon AOD prices.
 *
 * This module re-exports the types and config for backward compatibility.
 */

export { REGIONS, type RegionConfig, type CrawlResult, crawlRegion, crawlAsin } from '@/lib/browser-crawler'
