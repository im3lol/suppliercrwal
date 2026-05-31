-- SupplierCrawl Database Schema for Supabase
-- Run this SQL in the Supabase SQL Editor (Dashboard > SQL Editor)

-- ========================================
-- PRODUCTS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  asin TEXT UNIQUE NOT NULL,
  name TEXT DEFAULT '',
  image TEXT DEFAULT '',
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- PRICES TABLE
-- ========================================
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

-- ========================================
-- INDEXES
-- ========================================
CREATE INDEX IF NOT EXISTS idx_prices_product_id ON prices("productId");
CREATE INDEX IF NOT EXISTS idx_products_asin ON products(asin);
CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products("updatedAt" DESC);

-- ========================================
-- ENABLE RLS (Row Level Security)
-- ========================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices ENABLE ROW LEVEL SECURITY;

-- ========================================
-- RLS POLICIES - Allow all operations with anon key
-- (For production, you should restrict these policies)
-- ========================================
CREATE POLICY "Allow all operations on products" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on prices" ON prices FOR ALL USING (true) WITH CHECK (true);

-- ========================================
-- AUTO-UPDATE updatedAt TRIGGER
-- ========================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_prices_updated_at
  BEFORE UPDATE ON prices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
