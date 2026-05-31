import { createServerClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/**
 * Create a Supabase server client for API routes.
 * This client uses the anon/publishable key and works with RLS policies.
 */
export function getSupabaseClient() {
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return []
      },
      setAll() {
        // No-op for API routes
      },
    },
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DATABASE TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ProductRow {
  id: string
  asin: string
  name: string
  image: string
  createdAt: string
  updatedAt: string
}

export interface PriceRow {
  id: string
  productId: string
  domain: string
  region: string
  price: string
  currency: string
  priceDisplay: string
  createdAt: string
  updatedAt: string
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DATABASE OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Get all products with their prices
 */
export async function getAllProducts() {
  const supabase = getSupabaseClient();

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('*, prices(*)')
    .order('updatedAt', { ascending: false });

  if (productsError) {
    console.error('[DB] Error fetching products:', productsError);
    throw new Error(`Failed to fetch products: ${productsError.message}`);
  }

  return products as (ProductRow & { prices: PriceRow[] })[];
}

/**
 * Find a product by ASIN
 */
export async function findProductByAsin(asin: string) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('products')
    .select('*, prices(*)')
    .eq('asin', asin)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = not found
    console.error('[DB] Error finding product:', error);
  }

  return data as (ProductRow & { prices: PriceRow[] }) | null;
}

/**
 * Create a new product
 */
export async function createProduct(asin: string, name: string, image: string) {
  const supabase = getSupabaseClient();

  const id = crypto.randomUUID();

  const { data, error } = await supabase
    .from('products')
    .insert({
      id,
      asin,
      name,
      image,
    })
    .select('*, prices(*)')
    .single();

  if (error) {
    console.error('[DB] Error creating product:', error);
    throw new Error(`Failed to create product: ${error.message}`);
  }

  return data as ProductRow & { prices: PriceRow[] };
}

/**
 * Update a product
 */
export async function updateProduct(id: string, name: string, image: string) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('products')
    .update({ name, image, updatedAt: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[DB] Error updating product:', error);
    throw new Error(`Failed to update product: ${error.message}`);
  }

  return data as ProductRow;
}

/**
 * Upsert a price record (insert or update by productId + domain)
 */
export async function upsertPrice(
  productId: string,
  domain: string,
  region: string,
  price: string,
  currency: string,
  priceDisplay: string
) {
  const supabase = getSupabaseClient();

  // First try to find existing price
  const { data: existing } = await supabase
    .from('prices')
    .select('id')
    .eq('productId', productId)
    .eq('domain', domain)
    .single();

  if (existing) {
    // Update existing price
    const { error } = await supabase
      .from('prices')
      .update({
        price,
        currency,
        priceDisplay,
        region,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', existing.id);

    if (error) {
      console.error('[DB] Error updating price:', error);
      throw new Error(`Failed to update price: ${error.message}`);
    }
  } else {
    // Insert new price
    const id = crypto.randomUUID();
    const { error } = await supabase
      .from('prices')
      .insert({
        id,
        productId,
        domain,
        region,
        price,
        currency,
        priceDisplay,
      });

    if (error) {
      console.error('[DB] Error inserting price:', error);
      throw new Error(`Failed to insert price: ${error.message}`);
    }
  }
}

/**
 * Delete products by IDs (and their prices via CASCADE)
 */
export async function deleteProducts(ids: string[]) {
  const supabase = getSupabaseClient();

  // Delete prices first (in case CASCADE doesn't work)
  for (const id of ids) {
    await supabase.from('prices').delete().eq('productId', id);
  }

  // Delete products
  const { error } = await supabase
    .from('products')
    .delete()
    .in('id', ids);

  if (error) {
    console.error('[DB] Error deleting products:', error);
    throw new Error(`Failed to delete products: ${error.message}`);
  }
}

/**
 * Delete all products and prices
 */
export async function deleteAllProducts() {
  const supabase = getSupabaseClient();

  // Delete all prices first
  const { error: priceError } = await supabase
    .from('prices')
    .delete()
    .neq('id', ''); // Delete all rows

  if (priceError) {
    console.error('[DB] Error deleting all prices:', priceError);
  }

  // Delete all products
  const { error } = await supabase
    .from('products')
    .delete()
    .neq('id', ''); // Delete all rows

  if (error) {
    console.error('[DB] Error deleting all products:', error);
    throw new Error(`Failed to delete all products: ${error.message}`);
  }
}
