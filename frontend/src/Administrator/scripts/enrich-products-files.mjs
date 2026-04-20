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

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Safely parse a value that might be an array, a JSON string, or null.
 * Always returns an array.
 */
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

function extractFilename(url) {
  if (!url) return 'file'
  return decodeURIComponent(url).split('/').pop()
}

// ─── github helpers ──────────────────────────────────────────────────────────

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
      message: 'chore: enrich products with files/PDFs',
      content: base64,
      sha: existing.sha
    })
  } catch (err) {
    throw new Error(`Failed to update products.json: ${err.message}`)
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function enrich() {
  console.log('=== Enriching products with files (PDFs) ===\n')

  console.log('Reading products.json from GitHub...')
  const migratedProducts = await fetchCurrentProducts()
  console.log(`Found ${migratedProducts.length} products\n`)

  console.log('Fetching files from Supabase...')
  const { data: supabaseProducts, error } = await supabase
    .from('products')
    .select('id, files')

  if (error) throw new Error(`Supabase query failed: ${error.message}`)

  // DEBUG: show raw files shape for first 3 products
  console.log('── raw files sample from Supabase (first 3) ──')
  for (const p of supabaseProducts.slice(0, 3)) {
    console.log(`  type=${typeof p.files} isArray=${Array.isArray(p.files)} value=${JSON.stringify(p.files)?.slice(0, 120)}`)
  }
  console.log('──────────────────────────────────────────────\n')

  // Index Supabase files by product ID — use toArray() to handle JSON strings
  const filesById = {}
  for (const p of supabaseProducts) {
    const arr = toArray(p.files)
    if (arr.length > 0) filesById[p.id] = arr
  }

  console.log(`Found files for ${Object.keys(filesById).length} products\n`)

  let updated = 0
  let skipped = 0
  let alreadyHas = 0

  const enriched = migratedProducts.map(githubProduct => {
    const supabaseFiles = filesById[githubProduct.id]

    // No files in Supabase for this product
    if (!supabaseFiles || supabaseFiles.length === 0) {
      skipped++
      return githubProduct
    }

    // Already has files in GitHub — skip to avoid overwriting
    const existingFiles = toArray(githubProduct.files)
    if (existingFiles.length > 0) {
      console.log(`  ⏭  ${githubProduct.name}: already has ${existingFiles.length} file(s), skipping`)
      alreadyHas++
      return githubProduct
    }

    // Add files from Supabase
    const files = supabaseFiles.map(f => ({
      name: f.name || extractFilename(f.url) || 'file',
      url:  f.url
    }))

    console.log(`  ✓  ${githubProduct.name}: adding ${files.length} file(s)`)
    files.forEach(f => console.log(`       • ${f.name} → ${f.url}`))
    updated++

    return { ...githubProduct, files }
  })

  console.log(`\n── Summary ──`)
  console.log(`  Updated   : ${updated}`)
  console.log(`  Already had files : ${alreadyHas}`)
  console.log(`  No files in Supabase : ${skipped}`)

  if (updated === 0) {
    console.log('\n⚠  Nothing to update — all products either already have files or Supabase has none.')
    console.log('   If you expected updates, check the debug output above for raw Supabase shapes.')
    return
  }

  console.log('\nUpdating products.json on GitHub...')
  await updateProductsJson(enriched)
  console.log('✓ File enrichment complete!')
}

enrich().catch(err => { console.error('Fatal:', err.message); process.exit(1) })
