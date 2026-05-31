import { NextRequest, NextResponse } from 'next/server'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRAWLEO API TEST ENDPOINT
//
// GET /api/test-crawleo?apiKey=xxx
// Tests the Crawleo API key by making a simple request.
// This helps diagnose "sandbox is inactive" and other API errors.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const maxDuration = 30

export async function GET(request: NextRequest) {
  const apiKey = request.nextUrl.searchParams.get('apiKey')

  if (!apiKey) {
    return NextResponse.json({ error: 'apiKey parameter required' }, { status: 400 })
  }

  const results: {
    step: string
    status: 'success' | 'error' | 'info'
    details: string
    timingMs: number
  }[] = []

  // ── Test 1: Simple GET without render_js ──
  const startTime1 = Date.now()
  try {
    results.push({ step: 'Test 1: Simple GET (no JS render)', status: 'info', details: 'Testing basic API connectivity...', timingMs: 0 })

    const params = new URLSearchParams({
      urls: 'https://example.com',
      render_js: 'false',
      raw_html: 'false',
    })
    const apiUrl = `https://api.crawleo.dev/crawl?${params.toString()}`

    const res = await fetch(apiUrl, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(15000),
    })

    const timingMs = Date.now() - startTime1

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      results.push({
        step: 'Test 1 Result',
        status: 'error',
        details: `HTTP ${res.status}: ${body.slice(0, 300)}`,
        timingMs,
      })
      return NextResponse.json({ success: false, results })
    }

    const data = await res.json()

    if (data.error) {
      results.push({
        step: 'Test 1 Result',
        status: 'error',
        details: `API returned error: ${JSON.stringify(data.error)}`,
        timingMs,
      })
      return NextResponse.json({ success: false, results })
    }

    results.push({
      step: 'Test 1 Result',
      status: 'success',
      details: `OK — Status: ${res.status}, Credits: ${data.credits ?? 'N/A'}, Results: ${data.results?.length ?? 0}`,
      timingMs,
    })
  } catch (e) {
    results.push({
      step: 'Test 1 Result',
      status: 'error',
      details: `Network error: ${e instanceof Error ? e.message : String(e)}`,
      timingMs: Date.now() - startTime1,
    })
    return NextResponse.json({ success: false, results })
  }

  // ── Test 2: GET with render_js=true ──
  const startTime2 = Date.now()
  try {
    results.push({ step: 'Test 2: GET with JS rendering', status: 'info', details: 'Testing JavaScript rendering capability (sandbox)...', timingMs: 0 })

    const params = new URLSearchParams({
      urls: 'https://example.com',
      render_js: 'true',
      raw_html: 'true',
    })
    const apiUrl = `https://api.crawleo.dev/crawl?${params.toString()}`

    const res = await fetch(apiUrl, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(30000),
    })

    const timingMs = Date.now() - startTime2

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      results.push({
        step: 'Test 2 Result',
        status: 'error',
        details: `HTTP ${res.status}: ${body.slice(0, 300)}`,
        timingMs,
      })
    } else {
      const data = await res.json()

      if (data.error) {
        results.push({
          step: 'Test 2 Result',
          status: 'error',
          details: `Sandbox error: ${JSON.stringify(data.error)}. This means JS rendering is not available — the sandbox might be inactive, expired, or rate limited.`,
          timingMs,
        })
      } else {
        results.push({
          step: 'Test 2 Result',
          status: 'success',
          details: `OK — JS rendering works! Credits: ${data.credits ?? 'N/A'}, HTML size: ${(data.results?.[0]?.raw_html ?? '').length} chars`,
          timingMs,
        })
      }
    }
  } catch (e) {
    results.push({
      step: 'Test 2 Result',
      status: 'error',
      details: `Network error: ${e instanceof Error ? e.message : String(e)}`,
      timingMs: Date.now() - startTime2,
    })
  }

  // ── Test 3: Amazon offer-listing page ──
  const startTime3 = Date.now()
  try {
    results.push({ step: 'Test 3: Amazon offer-listing (COM)', status: 'info', details: 'Testing real Amazon offer-listing page with JS rendering...', timingMs: 0 })

    const params = new URLSearchParams({
      urls: 'https://www.amazon.com/gp/offer-listing/B09V3KXJPB/',
      render_js: 'true',
      raw_html: 'true',
      geolocation: 'us',
    })
    const apiUrl = `https://api.crawleo.dev/crawl?${params.toString()}`

    const res = await fetch(apiUrl, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(120000),
    })

    const timingMs = Date.now() - startTime3

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      results.push({
        step: 'Test 3 Result',
        status: 'error',
        details: `HTTP ${res.status}: ${body.slice(0, 300)}`,
        timingMs,
      })
    } else {
      const data = await res.json()

      if (data.error) {
        results.push({
          step: 'Test 3 Result',
          status: 'error',
          details: `API error: ${JSON.stringify(data.error)}`,
          timingMs,
        })
      } else {
        const html = data.results?.[0]?.raw_html ?? ''
        const hasPrices = html.includes('a-price') || html.includes('olpOfferPrice') || html.includes('a-offscreen')
        results.push({
          step: 'Test 3 Result',
          status: hasPrices ? 'success' : 'info',
          details: `OK — Page: ${data.results?.[0]?.status_code}, HTML: ${html.length} chars, Price elements: ${hasPrices ? 'FOUND' : 'NOT FOUND'}, Credits: ${data.credits ?? 'N/A'}`,
          timingMs,
        })
      }
    }
  } catch (e) {
    results.push({
      step: 'Test 3 Result',
      status: 'error',
      details: `Error: ${e instanceof Error ? e.message : String(e)}`,
      timingMs: Date.now() - startTime3,
    })
  }

  const allSuccess = results.filter(r => r.status === 'success').length >= 2
  return NextResponse.json({ success: allSuccess, results })
}
