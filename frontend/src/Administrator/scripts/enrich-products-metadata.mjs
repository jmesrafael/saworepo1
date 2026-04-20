import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { Octokit } from '@octokit/rest'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const octokit = new Octokit({ auth: process.env.GITHUB_PAT })

const OWNER     = process.env.GITHUB_OWNER
const MAIN_REPO = process.env.MAIN_REPO

// Get current products.json from GitHub
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

// Update products.json on GitHub
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
      message: 'chore: enrich products with metadata',
      content: base64,
      sha: existing.sha
    })
  } catch (err) {
    throw new Error(`Failed to update products.json: ${err.message}`)
  }
}

// Main enrichment
async function enrich() {
  console.log('=== Enriching products with Supabase metadata ===\n')

  // Fetch current products from GitHub
  console.log('Reading products.json from GitHub...')
  const migratedProducts = await fetchCurrentProducts()
  console.log(`Found ${migratedProducts.length} products\n`)

  // Fetch all product metadata from Supabase (no file downloads)
  console.log('Fetching metadata from Supabase...')
  const { data: supabaseProducts, error } = await supabase
    .from('products')
    .select('*')

  if (error) throw new Error(`Supabase query failed: ${error.message}`)

  // Index Supabase products by ID for quick lookup
  const supabaseById = Object.fromEntries(
    supabaseProducts.map(p => [p.id, p])
  )

  // Merge: add missing fields from Supabase to GitHub products
  const enriched = migratedProducts.map(githubProduct => {
    const supabaseProduct = supabaseById[githubProduct.id]
    if (!supabaseProduct) {
      console.warn(`⚠ Product ${githubProduct.id} not found in Supabase`)
      return githubProduct
    }

    return {
      ...githubProduct,
      // Add fields that weren't in original migration
      type:              supabaseProduct.type                ?? null,
      spec_table:        supabaseProduct.spec_table          ?? null,
      resources:         supabaseProduct.resources           ?? null,
      featured:          supabaseProduct.featured            ?? false,
      is_deleted:        supabaseProduct.is_deleted          ?? false,
      auto_tag_columns:  supabaseProduct.auto_tag_columns    ?? [],
      created_by:        supabaseProduct.created_by          ?? null,
      created_by_username: supabaseProduct.created_by_username ?? null,
      updated_by_username: supabaseProduct.updated_by_username ?? null,
      updated_at:        supabaseProduct.updated_at          ?? githubProduct.createdAt,
    }
  })

  console.log(`Enriched ${enriched.length} products\n`)

  // Write back to GitHub
  console.log('Updating products.json on GitHub...')
  await updateProductsJson(enriched)

  console.log('✓ Enrichment complete!')
  console.log(`All products now have complete metadata.`)
}

enrich().catch(err => { console.error('Fatal:', err.message); process.exit(1) })
