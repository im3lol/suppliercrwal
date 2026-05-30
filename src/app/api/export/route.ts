import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/export — Export products as CSV
export async function GET() {
  try {
    const products = await db.product.findMany({
      include: { prices: true },
      orderBy: { updatedAt: 'desc' },
    })

    const regions = ['COM', 'EG', 'DE', 'SA', 'AE']
    const headers = ['ASIN', 'Product Name', ...regions.map((r) => `${r} Price`), 'Last Scan']

    const rows = products.map((p) => {
      const priceMap = Object.fromEntries(p.prices.map((pr) => [pr.region, pr.priceDisplay]))
      return [
        p.asin,
        `"${p.name.replace(/"/g, '""')}"`,
        ...regions.map((r) => priceMap[r] || 'N/A'),
        p.updatedAt.toISOString(),
      ]
    })

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename=suppliercrawl-export.csv',
      },
    })
  } catch (e) {
    console.error('[Export API Error]:', e)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
