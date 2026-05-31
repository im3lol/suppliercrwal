import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SETUP API — Creates database tables in Supabase
//
// Call this endpoint once to set up the database schema.
// It uses the Supabase publishable key with RLS policies.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { serviceRoleKey } = body

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    // Use service role key if provided, otherwise fall back to publishable key
    const supabaseKey = serviceRoleKey || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() { return [] },
        setAll() {},
      },
    })

    // Check if products table exists by trying to select from it
    const { error: checkError } = await supabase
      .from('products')
      .select('id')
      .limit(1)

    if (!checkError) {
      return NextResponse.json({
        success: true,
        message: 'Database tables already exist. No setup needed.',
      })
    }

    // If we get here, tables don't exist yet.
    // We need the service role key to create tables via SQL.
    if (!serviceRoleKey) {
      return NextResponse.json({
        success: false,
        needsServiceKey: true,
        message: 'Database tables need to be created. Please provide the Supabase service_role key, or run the SQL migration manually in the Supabase Dashboard SQL Editor.',
        sql: getMigrationSQL(),
      }, { status: 400 })
    }

    // Try to create tables using the service role key
    // Note: Supabase JS client doesn't support DDL directly,
    // but we can try using RPC if the exec_sql function exists
    return NextResponse.json({
      success: false,
      needsManualSetup: true,
      message: 'Please run the SQL migration in the Supabase Dashboard SQL Editor.',
      sql: getMigrationSQL(),
      instructions: [
        '1. Go to https://supabase.com/dashboard/project/vrnpfmuzpvycewbuikxj/sql/new',
        '2. Paste the SQL below',
        '3. Click "Run" to execute',
        '4. The tables will be created automatically',
      ],
    })
  } catch (e) {
    console.error('[Setup API Error]:', e)
    return NextResponse.json({ error: 'Setup failed', details: String(e) }, { status: 500 })
  }
}

function getMigrationSQL(): string {
  return `-- SupplierCrawl Database Schema for Supabase
-- Run this SQL in the Supabase SQL Editor (Dashboard > SQL Editor)

-- PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  asin TEXT UNIQUE NOT NULL,
  name TEXT DEFAULT '',
  image TEXT DEFAULT '',
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- PRICES TABLE
CREATE TABLE IF NOT EXISTS prices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "productId" TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  region TEXT NOT NULL,
  price TEXT DEFAULT 'N/A',
  currency TEXT DEFAULT '',
  "priceDisplay" TEXT DEFAULT 'N/A',
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE("productId", domain)
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_prices_product_id ON prices("productId");
CREATE INDEX IF NOT EXISTS idx_products_asin ON products(asin);
CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products("updatedAt" DESC);

-- ENABLE RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES (Allow all operations with anon key)
CREATE POLICY "Allow all operations on products" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on prices" ON prices FOR ALL USING (true) WITH CHECK (true);

-- AUTO-UPDATE updatedAt TRIGGER
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_prices_updated_at ON prices;
CREATE TRIGGER update_prices_updated_at
  BEFORE UPDATE ON prices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();`
}

// GET endpoint returns the migration SQL for easy copy-paste
export async function GET() {
  return NextResponse.json({
    sql: getMigrationSQL(),
    instructions: [
      '1. Go to https://supabase.com/dashboard/project/vrnpfmuzpvycewbuikxj/sql/new',
      '2. Paste the SQL from the "sql" field',
      '3. Click "Run" to execute',
      '4. The tables will be created automatically',
    ],
  })
}
