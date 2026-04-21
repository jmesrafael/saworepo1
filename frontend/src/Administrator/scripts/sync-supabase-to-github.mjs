import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { Octokit } from '@octokit/rest'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const octokit = new Octokit({ auth: process.env.GITHUB_PAT })

const OWNER = process.env.GITHUB_OWNER
const MAIN_REPO = process.env.MAIN_REPO

// ─── helpers ────────────────────────────────────────────────────────────────

function toArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

// ─── github helpers ──────────────────────────────────────────────────────────

async function getFileSha(repo, path) {
  try {
    const { data } = await octokit.repos.getContent({ owner: OWNER, repo, path })
    return data.sha
  } catch { return null }
}

async function fetchCurrentProducts() {
  try {
    const { data } = await octokit.repos.getContent({
      owner: OWNER, repo: MAIN_REPO, path: 'products.json'
    })
    const decoded = Buffer.from(data.content, 'base64').toString('utf8')
    return JSON.parse(decoded).products ?? []
  } catch (err) {
    throw new Error(`Failed to fetch products.json: ${err.message}`)
  }
}

async function updateProductsJson(products) {
  const payload = { updatedAt: new Date().toISOString(), products }
  const base64 = Buffer.from(JSON.stringify(payload, null, 2)).toString('base64')
  try {
    const { data: existing } = await octokit.repos.getContent({
      owner: OWNER, repo: MAIN_REPO, path: 'products.json'
    })
    await octokit.repos.createOrUpdateFileContents({
      owner: OWNER,
      repo: MAIN_REPO,
      path: 'products.json',
      message: 'chore: sync products from supabase',
      content: base64,
      sha: existing.sha
    })
  } catch (err) {
    throw new Error(`Failed to update products.json: ${err.message}`)
  }
}

// ─── sync logic ──────────────────────────────────────────────────────────────

function productsAreEqual(existing, supabase) {
  const fieldsToCompare = [
    'name', 'slug', 'description', 'short_description', 'brand',
    'type', 'spec_table', 'resources', 'status', 'visible', 'featured',
    'sort_order', 'is_deleted'
  ]

  for (const field of fieldsToCompare) {
    if (existing[field] !== supabase[field]) return false
  }

  const arrayFields = ['categories', 'tags', 'features']
  for (const field of arrayFields) {
    const existingArr = toArray(existing[field])
    const supabaseArr = toArray(supabase[field])
    if (existingArr.length !== supabaseArr.length ||
        !existingArr.every((v, i) => v === supabaseArr[i])) {
      return false
    }
  }

  return true
}

function normalizeSupabaseProduct(supProduct) {
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
    categories: toArray(supProduct.categories),
    tags: toArray(supProduct.tags),
    features: toArray(supProduct.features),
    auto_tag_columns: supProduct.auto_tag_columns || null,
    thumbnail: supProduct.thumbnail || null,
    images: toArray(supProduct.images),
    spec_images: toArray(supProduct.spec_images),
    files: toArray(supProduct.files),
    created_by: supProduct.created_by || null,
    created_by_username: supProduct.created_by_username || null,
    updated_by_username: supProduct.updated_by_username || null,
    created_at: supProduct.created_at || new Date().toISOString(),
    updated_at: supProduct.updated_at || new Date().toISOString(),
    is_deleted: supProduct.is_deleted === true,
    source: 'supabase'
  }
}

function enrichSupabaseProduct(existing, supProduct) {
  const normalized = normalizeSupabaseProduct(supProduct)
  return {
    ...existing,
    ...normalized,
    updated_by_username: existing.updated_by_username,
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function sync() {
  console.log('=== Syncing products from Supabase to GitHub ===\n')

  console.log('📖 Reading products.json from GitHub...')
  const migratedProducts = await fetchCurrentProducts()
  console.log(`✅ Loaded ${migratedProducts.length} products\n`)

  console.log('🔄 Fetching products from Supabase...')
  const { data: supabaseProducts, error } = await supabase
    .from('products')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) throw new Error(`Supabase query failed: ${error.message}`)
  console.log(`✅ Loaded ${supabaseProducts.length} products from Supabase\n`)

  // Index existing products by ID
  const existingIds = new Set(migratedProducts.map(p => p.id))

  let added = 0
  let updated = 0
  let kept = 0
  const addedList = []
  const updatedList = []
  const keptList = []

  const synced = [...migratedProducts]

  // Process Supabase products
  console.log('🔀 Merging products...\n')
  for (const supProduct of supabaseProducts) {
    if (existingIds.has(supProduct.id)) {
      // Product exists in GitHub
      const existing = migratedProducts.find(p => p.id === supProduct.id)

      if (existing.source === 'supabase') {
        // Only update if product is from Supabase AND data changed
        if (!productsAreEqual(existing, supProduct)) {
          const idx = synced.findIndex(p => p.id === supProduct.id)
          synced[idx] = enrichSupabaseProduct(existing, supProduct)
          console.log(`🔄 [UPDATE] ${synced[idx].slug || synced[idx].name}`)
          updated++
          updatedList.push({ id: synced[idx].id, name: synced[idx].name, slug: synced[idx].slug })
        } else {
          console.log(`⏭️  [SKIP] ${supProduct.slug || supProduct.name}: no changes`)
          kept++
          keptList.push({ id: supProduct.id, name: supProduct.name, slug: supProduct.slug })
        }
      } else {
        // Product created locally - don't touch
        console.log(`📌 [SKIP] ${supProduct.slug || supProduct.name}: locally created`)
        kept++
        keptList.push({ id: supProduct.id, name: supProduct.name, slug: supProduct.slug })
      }
    } else {
      // NEW product from Supabase
      const newProduct = normalizeSupabaseProduct(supProduct)
      synced.push(newProduct)
      console.log(`✨ [ADD] ${newProduct.slug || newProduct.name}`)
      added++
      addedList.push({ id: newProduct.id, name: newProduct.name, slug: newProduct.slug })
    }
  }

  // Keep products in GitHub that aren't in Supabase (locally created)
  const localOnly = migratedProducts.filter(p => !supabaseProducts.find(sp => sp.id === p.id))
  if (localOnly.length > 0) {
    console.log(`\n📌 Keeping ${localOnly.length} products not in Supabase`)
    kept += localOnly.length
    localOnly.forEach(p => {
      keptList.push({ id: p.id, name: p.name, slug: p.slug })
    })
  }

  console.log(`\n── Summary ──`)
  console.log(`  Scanned     : ${supabaseProducts.length}`)
  console.log(`  Added       : ${added}`)
  console.log(`  Updated     : ${updated}`)
  console.log(`  Protected   : ${kept}`)

  if (added === 0 && updated === 0) {
    console.log('\n✓ No changes needed')
    return
  }

  console.log('\n📤 Updating products.json on GitHub...')
  await updateProductsJson(synced)
  console.log('✓ Sync complete!')
}

sync().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
