import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as XLSX from 'xlsx'

// GET /api/export — Export products as Excel (.xlsx) or CSV
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') || 'xlsx' // xlsx or csv

    const products = await db.product.findMany({
      include: { prices: true },
      orderBy: { updatedAt: 'desc' },
    })

    const regions = ['COM', 'EG', 'DE', 'SA', 'AE']
    const regionDomains: Record<string, string> = {
      COM: 'amazon.com',
      EG: 'amazon.eg',
      DE: 'amazon.de',
      SA: 'amazon.sa',
      AE: 'amazon.ae',
    }

    // ━━━ Summary Sheet ━━━
    const summaryHeaders = [
      'ASIN',
      'Product Name',
      'Image URL',
      '🇺🇸 COM Price',
      '🇪🇬 EG Price',
      '🇩🇪 DE Price',
      '🇸🇦 SA Price',
      '🇦🇪 AE Price',
      'Product Link',
      'Last Scan',
    ]

    const summaryRows = products.map((p) => {
      const priceMap = Object.fromEntries(p.prices.map((pr) => [pr.region, pr]))
      const domain = priceMap.COM?.domain || 'amazon.com'
      const link = `https://www.${domain}/dp/${p.asin}/`

      return [
        p.asin,
        p.name,
        p.image || '',
        priceMap.COM?.priceDisplay || 'N/A',
        priceMap.EG?.priceDisplay || 'N/A',
        priceMap.DE?.priceDisplay || 'N/A',
        priceMap.SA?.priceDisplay || 'N/A',
        priceMap.AE?.priceDisplay || 'N/A',
        link,
        p.updatedAt.toISOString(),
      ]
    })

    // ━━━ Detailed Sheet (one row per product-region) ━━━
    const detailHeaders = [
      'ASIN',
      'Product Name',
      'Region',
      'Domain',
      'Price',
      'Currency',
      'Price Display',
      'Product Link',
      'Last Updated',
    ]

    const detailRows: (string | number)[][] = []
    for (const p of products) {
      for (const region of regions) {
        const pr = p.prices.find((x) => x.region === region)
        const domain = pr?.domain || regionDomains[region] || ''
        const link = `https://www.${domain}/dp/${p.asin}/`
        detailRows.push([
          p.asin,
          p.name,
          region,
          domain,
          pr?.price || 'N/A',
          pr?.currency || '',
          pr?.priceDisplay || 'N/A',
          link,
          pr?.updatedAt?.toISOString() || '',
        ])
      }
    }

    if (format === 'csv') {
      const csvHeaders = summaryHeaders
      const csv = [
        csvHeaders.join(','),
        ...summaryRows.map((r) =>
          r.map((cell) => {
            const s = String(cell)
            if (s.includes(',') || s.includes('"') || s.includes('\n')) {
              return `"${s.replace(/"/g, '""')}"`
            }
            return s
          }).join(',')
        ),
      ].join('\n')

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename=suppliercrawl-export.csv',
        },
      })
    }

    // ━━━ XLSX Export ━━━
    const wb = XLSX.utils.book_new()

    // Summary sheet
    const summaryWs = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows])

    // Set column widths
    summaryWs['!cols'] = [
      { wch: 12 },  // ASIN
      { wch: 50 },  // Product Name
      { wch: 40 },  // Image URL
      { wch: 14 },  // COM
      { wch: 14 },  // EG
      { wch: 14 },  // DE
      { wch: 14 },  // SA
      { wch: 14 },  // AE
      { wch: 45 },  // Link
      { wch: 22 },  // Last Scan
    ]
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary')

    // Detail sheet
    const detailWs = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailRows])
    detailWs['!cols'] = [
      { wch: 12 },  // ASIN
      { wch: 50 },  // Product Name
      { wch: 8 },   // Region
      { wch: 14 },  // Domain
      { wch: 12 },  // Price
      { wch: 8 },   // Currency
      { wch: 14 },  // Price Display
      { wch: 45 },  // Link
      { wch: 22 },  // Last Updated
    ]
    XLSX.utils.book_append_sheet(wb, detailWs, 'Detailed')

    // Generate buffer
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename=suppliercrawl-export.xlsx',
      },
    })
  } catch (e) {
    console.error('[Export API Error]:', e)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
