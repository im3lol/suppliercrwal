import { NextRequest, NextResponse } from 'next/server'
import { getLogs, getLogById, clearLogs } from '@/lib/crawl-logger'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEBUG LOGS API
//
// GET /api/logs           — List all logs (paginated)
// GET /api/logs?id=xxx    — Get single log entry by ID
// DELETE /api/logs        — Clear all logs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    // Get single log by ID
    if (id) {
      const log = getLogById(id)
      if (!log) {
        return NextResponse.json({ error: 'Log not found' }, { status: 404 })
      }
      return NextResponse.json({ success: true, log })
    }

    // Get all logs (paginated)
    const result = getLogs(limit, offset)
    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (e) {
    console.error('[Logs API Error]:', e)
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    clearLogs()
    return NextResponse.json({ success: true, message: 'All logs cleared' })
  } catch (e) {
    console.error('[Logs API Error]:', e)
    return NextResponse.json({ error: 'Failed to clear logs' }, { status: 500 })
  }
}
