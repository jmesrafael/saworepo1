// Sync products from Supabase to products.json
// Merges data without removing existing products
// Run with: node syncSupabaseProducts.js

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PRODUCTS_FILE = path.join(__dirname, '..', 'products.json');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function syncProducts() {
  const syncResult = {
    scanned: 0,
    added: 0,
    updated: 0,
    kept: 0,
    added_products: [],
    updated_products: [],
    kept_products: [],
    error: null
  };

  try {
    console.log('📊 [SYNC] Starting product sync from Supabase...\n');

    // Step 1: Read current products.json
    console.log('📖 Reading current products.json...');
    let currentData;
    try {
      const content = await fs.readFile(PRODUCTS_FILE, 'utf8');
      currentData = JSON.parse(content);
    } catch (err) {
      console.warn('⚠️ products.json not found, starting with empty array');
      currentData = { updatedAt: new Date().toISOString(), products: [] };
    }
    const currentProducts = currentData.products || [];
    console.log(`✅ Loaded ${currentProducts.length} products from products.json\n`);

    // Step 2: Fetch products from Supabase
    console.log('🔄 Fetching products from Supabase...');
    const { data: supabaseProducts, error } = await supabase
      .from('products')
      .select('*');

    if (error) {
      console.error('❌ Failed to fetch from Supabase:', error.message);
      syncResult.error = error.message;
      return syncResult;
    }

    syncResult.scanned = supabaseProducts.length;
    console.log(`✅ Loaded ${supabaseProducts.length} products from Supabase\n`);

    // Step 3: Merge products intelligently
    console.log('🔀 Merging products...\n');
    const { mergedProducts, stats } = mergeProducts(currentProducts, supabaseProducts);
    syncResult.added = stats.added;
    syncResult.updated = stats.updated;
    syncResult.kept = stats.kept;
    syncResult.added_products = stats.addedList;
    syncResult.updated_products = stats.updatedList;
    syncResult.kept_products = stats.keptList;

    // Step 4: Save merged products
    console.log(`💾 Saving ${mergedProducts.length} products to products.json...\n`);
    const newData = {
      updatedAt: new Date().toISOString(),
      products: mergedProducts,
      syncSource: 'supabase-merge',
      syncedAt: new Date().toISOString()
    };

    await fs.writeFile(PRODUCTS_FILE, JSON.stringify(newData, null, 2), 'utf8');
    console.log('✅ Sync completed successfully!\n');

    // Step 5: Print summary
    printSummary(currentProducts, supabaseProducts, mergedProducts, stats);
    return syncResult;

  } catch (err) {
    console.error('❌ Unexpected error:', err.message);
    process.exit(1);
  }
}

function mergeProducts(currentProducts, supabaseProducts) {
  const merged = [...currentProducts];
  let addedCount = 0;
  let updatedCount = 0;
  const addedList = [];
  const updatedList = [];

  for (const supProduct of supabaseProducts) {
    const existingIndex = merged.findIndex(p => p.id === supProduct.id);

    if (existingIndex === -1) {
      // Product doesn't exist in current → ADD IT
      const newProduct = normalizeSupabaseProduct(supProduct);
      merged.push(newProduct);
      console.log(`✨ [ADD] ${newProduct.slug || newProduct.name}`);
      addedCount++;
      addedList.push({ id: newProduct.id, name: newProduct.name, slug: newProduct.slug });
    } else {
      // Product exists → MERGE (Supabase data updates existing, but keeps CMS fields)
      const existing = merged[existingIndex];
      const updated_product = mergeProductData(existing, supProduct);
      merged[existingIndex] = updated_product;
      console.log(`🔄 [UPDATE] ${updated_product.slug || updated_product.name}`);
      updatedCount++;
      updatedList.push({ id: updated_product.id, name: updated_product.name, slug: updated_product.slug });
    }
  }

  // Keep any products from currentProducts that aren't in Supabase
  // (These are products created via CMS/GitHub that shouldn't be deleted)
  const keptProducts = currentProducts.filter(p => !supabaseProducts.find(sp => sp.id === p.id));
  const keptList = keptProducts.map(p => ({ id: p.id, name: p.name, slug: p.slug }));
  if (keptProducts.length > 0) {
    console.log(`\n📌 Keeping ${keptProducts.length} products created via CMS (not in Supabase)`);
  }

  return {
    mergedProducts: merged,
    stats: {
      added: addedCount,
      updated: updatedCount,
      kept: keptProducts.length,
      addedList,
      updatedList,
      keptList
    }
  };
}

function normalizeSupabaseProduct(supProduct) {
  // Convert Supabase product to our standard format
  return {
    id: supProduct.id,
    name: supProduct.name || '',
    slug: supProduct.slug || '',
    description: supProduct.description || '',
    short_description: supProduct.short_description || '',
    brand: supProduct.brand || 'SAWO',
    type: supProduct.type || null,
    spec_table: supProduct.spec_table || null,
    resources: supProduct.resources || null,
    status: supProduct.status || 'draft',
    visible: supProduct.visible !== false,
    featured: supProduct.featured === true,
    sort_order: supProduct.sort_order || 0,
    categories: supProduct.categories || [],
    tags: supProduct.tags || [],
    features: supProduct.features || [],
    auto_tag_columns: supProduct.auto_tag_columns || null,
    thumbnail: supProduct.thumbnail || null,
    images: supProduct.images || [],
    spec_images: supProduct.spec_images || [],
    files: supProduct.files || [],
    created_by: supProduct.created_by || null,
    created_by_username: supProduct.created_by_username || null,
    updated_by_username: supProduct.updated_by_username || null,
    created_at: supProduct.created_at || new Date().toISOString(),
    updated_at: supProduct.updated_at || new Date().toISOString(),
    is_deleted: supProduct.is_deleted === true,
    source: 'supabase' // Mark as from Supabase
  };
}

function mergeProductData(existing, supProduct) {
  // Keep existing CMS data, but update from Supabase
  // Strategy: Supabase updates non-CMS fields, but CMS-specific fields are preserved
  const normalized = normalizeSupabaseProduct(supProduct);

  return {
    ...existing, // Keep all existing CMS data as base
    ...normalized, // Override with Supabase data
    // But preserve these CMS-specific fields if they exist
    ...(existing.updated_by_username && { updated_by_username: existing.updated_by_username }),
    updated_at: new Date(normalized.updated_at) > new Date(existing.updated_at)
      ? normalized.updated_at
      : existing.updated_at,
  };
}

function printSummary(before, supabase, after, stats) {
  console.log('═══════════════════════════════════════');
  console.log('          SYNC SUMMARY');
  console.log('═══════════════════════════════════════');
  console.log(`Before: ${before.length} products`);
  console.log(`From Supabase: ${supabase.length} products`);
  console.log(`After: ${after.length} products`);
  console.log(`---`);
  console.log(`✨ Added: ${stats.added}`);
  console.log(`🔄 Updated: ${stats.updated}`);
  console.log(`📌 Protected: ${stats.kept}`);
  console.log('═══════════════════════════════════════\n');
}

// Export for use as module
module.exports = { syncProducts };

// Run the sync if called directly
if (require.main === module) {
  syncProducts().then(result => {
    if (result.error) {
      console.error('Sync failed:', result.error);
      process.exit(1);
    }
    process.exit(0);
  }).catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });
}
