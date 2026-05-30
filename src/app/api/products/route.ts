import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/products — List all products with prices
export async function GET() {
  try {
    const products = await db.product.findMany({
      include: { prices: true },
      orderBy: { updatedAt: 'desc' },
    })

    const formatted = products.map((p) => ({
      id: p.id,
      asin: p.asin,
      name: p.name,
      image: p.image,
      lastScan: p.updatedAt.toISOString(),
      prices: Object.fromEntries(
        p.prices.map((pr) => [
          pr.region,
          {
            price: pr.price,
            currency: pr.currency,
            priceDisplay: pr.priceDisplay,
            domain: pr.domain,
            updatedAt: pr.updatedAt.toISOString(),
          },
        ])
      ),
    }))

    return NextResponse.json({ success: true, data: formatted, total: formatted.length })
  } catch (e) {
    console.error('[Products API Error]:', e)
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 })
  }
}

// DELETE /api/products — Delete selected products
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { ids, all } = body

    if (all) {
      await db.price.deleteMany()
      await db.product.deleteMany()
      return NextResponse.json({ success: true, deleted: 'all' })
    }

    if (ids && Array.isArray(ids) && ids.length > 0) {
      await db.price.deleteMany({ where: { productId: { in: ids } } })
      await db.product.deleteMany({ where: { id: { in: ids } } })
      return NextResponse.json({ success: true, deleted: ids.length })
    }

    return NextResponse.json({ error: 'No IDs provided' }, { status: 400 })
  } catch (e) {
    console.error('[Products DELETE Error]:', e)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
