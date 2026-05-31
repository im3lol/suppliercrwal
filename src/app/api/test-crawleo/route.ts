import { NextResponse } from 'next/server'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PAGE READER TEST ENDPOINT (was Crawleo test — Crawleo removed)
//
// GET /api/test-crawleo
// Tests the built-in page_reader (z-ai-web-dev-sdk) connectivity.
// Crawleo API has been removed due to "sandbox is inactive" error.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const maxDuration = 30

export async function GET() {
  const results: {
    step: string
    status: 'success' | 'error' | 'info'
    details: string
    timingMs: number
  }[] = []

  // ── Test 1: page_reader basic connectivity ──
  const startTime1 = Date.now()
  try {
    results.push({ step: 'Test 1: Page Reader — Basic', status: 'info', details: 'Testing page_reader with example.com...', timingMs: 0 })

    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const result = await zai.functions.invoke('page_reader', { url: 'https://example.com' })

    const timingMs = Date.now() - startTime1

    if (!result || !result.data) {
      results.push({
        step: 'Test 1 Result',
        status: 'error',
        details: 'Page reader returned no data',
        timingMs,
      })
    } else {
      const html = result.data.html || ''
      results.push({
        step: 'Test 1 Result',
        status: html.length > 100 ? 'success' : 'error',
        details: html.length > 100
          ? `OK — HTML: ${html.length} chars, Title: ${result.data.title || 'N/A'}`
          : `Suspicious — HTML too small: ${html.length} chars`,
        timingMs,
      })
    }
  } catch (e) {
    results.push({
      step: 'Test 1 Result',
      status: 'error',
      details: `Error: ${e instanceof Error ? e.message : String(e)}`,
      timingMs: Date.now() - startTime1,
    })
  }

  // ── Test 2: page_reader with Amazon offer-listing ──
  const startTime2 = Date.now()
  try {
    results.push({ step: 'Test 2: Page Reader — Amazon Offer Listing', status: 'info', details: 'Testing page_reader with Amazon offer-listing page...', timingMs: 0 })

    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const result = await zai.functions.invoke('page_reader', {
      url: 'https://www.amazon.com/gp/offer-listing/B09V3KXJPB/'
    })

    const timingMs = Date.now() - startTime2

    if (!result || !result.data) {
      results.push({
        step: 'Test 2 Result',
        status: 'error',
        details: 'Page reader returned no data for Amazon page',
        timingMs,
      })
    } else {
      const html = result.data.html || ''
      const hasPrices = html.includes('a-price') || html.includes('olpOfferPrice') || html.includes('a-offscreen')
      results.push({
        step: 'Test 2 Result',
        status: html.length > 1000 ? 'success' : 'error',
        details: `HTML: ${html.length} chars, Price elements: ${hasPrices ? 'FOUND' : 'NOT FOUND'}, Title: ${result.data.title || 'N/A'}`,
        timingMs,
      })
    }
  } catch (e) {
    results.push({
      step: 'Test 2 Result',
      status: 'error',
      details: `Error: ${e instanceof Error ? e.message : String(e)}`,
      timingMs: Date.now() - startTime2,
    })
  }

  const successCount = results.filter(r => r.status === 'success').length
  return NextResponse.json({
    success: successCount >= 1,
    results,
    note: 'Crawleo API has been removed (sandbox inactive). Using built-in page_reader instead.'
  })
}
