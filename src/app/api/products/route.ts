import { NextRequest, NextResponse } from 'next/server'
import {
  getAllProducts,
  deleteProducts,
  deleteAllProducts,
} from '@/lib/db-supabase'

// GET /api/products — List all products with prices
export async function GET() {
  try {
    const products = await getAllProducts()

    const formatted = products.map((p) => ({
      id: p.id,
      asin: p.asin,
      name: p.name,
      image: p.image,
      lastScan: p.updatedAt,
      prices: Object.fromEntries(
        (p.prices || []).map((pr) => [
          pr.region,
          {
            price: pr.price,
            currency: pr.currency,
            priceDisplay: pr.priceDisplay,
            domain: pr.domain,
            updatedAt: pr.updatedAt,
          },
        ])
      ),
    }))

    return NextResponse.json({ success: true, data: formatted, total: formatted.length })
  } catch (e: unknown) {
    console.error('[Products API Error]:', e)
    const message = e instanceof Error ? e.message : String(e)
    // Check if the error is about missing tables
    if (message && (message.includes('Could not find the table') || message.includes('does not exist'))) {
      return NextResponse.json({
        error: 'Database tables not found. Please run the SQL migration in the Supabase Dashboard SQL Editor.',
        needsSetup: true,
      }, { status: 500 })
    }
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 })
  }
}

// DELETE /api/products — Delete selected products
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { ids, all } = body

    if (all) {
      await deleteAllProducts()
      return NextResponse.json({ success: true, deleted: 'all' })
    }

    if (ids && Array.isArray(ids) && ids.length > 0) {
      await deleteProducts(ids)
      return NextResponse.json({ success: true, deleted: ids.length })
    }

    return NextResponse.json({ error: 'No IDs provided' }, { status: 400 })
  } catch (e) {
    console.error('[Products DELETE Error]:', e)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
