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
      message: 'chore: enrich products with files/PDFs',
      content: base64,
      sha: existing.sha
    })
  } catch (err) {
    throw new Error(`Failed to update products.json: ${err.message}`)
  }
}

// Main enrichment
async function enrich() {
  console.log('=== Enriching products with files (PDFs) ===\n')

  // Fetch current products from GitHub
  console.log('Reading products.json from GitHub...')
  const migratedProducts = await fetchCurrentProducts()
  console.log(`Found ${migratedProducts.length} products\n`)

  // Fetch all product files from Supabase
  console.log('Fetching files from Supabase...')
  const { data: supabaseProducts, error } = await supabase
    .from('products')
    .select('id, files')

  if (error) throw new Error(`Supabase query failed: ${error.message}`)

  // Index Supabase files by product ID
  const filesById = Object.fromEntries(
    supabaseProducts
      .filter(p => p.files && Array.isArray(p.files) && p.files.length > 0)
      .map(p => [p.id, p.files])
  )

  console.log(`Found files for ${Object.keys(filesById).length} products\n`)

  // Merge: add files from Supabase to GitHub products
  let updated = 0
  const enriched = migratedProducts.map(githubProduct => {
    const supabaseFiles = filesById[githubProduct.id]

    if (!supabaseFiles || supabaseFiles.length === 0) {
      return githubProduct
    }

    // Files already exist in products.json
    if (githubProduct.files && githubProduct.files.length > 0) {
      console.log(`  ${githubProduct.name}: already has ${githubProduct.files.length} files`)
      return githubProduct
    }

    // Copy files from Supabase (keep external URLs as-is)
    console.log(`  ${githubProduct.name}: adding ${supabaseFiles.length} file(s)`)
    updated++

    return {
      ...githubProduct,
      files: supabaseFiles.map(f => ({
        name: f.name || extractFilename(f.url),
        url:  f.url
      }))
    }
  })

  console.log(`\nUpdated ${updated} products with files\n`)

  // Write back to GitHub
  console.log('Updating products.json on GitHub...')
  await updateProductsJson(enriched)

  console.log('✓ File enrichment complete!')
  console.log(`All products now have PDF/file data.`)
}

function extractFilename(url) {
  if (!url) return 'file'
  return decodeURIComponent(url).split('/').pop()
}

enrich().catch(err => { console.error('Fatal:', err.message); process.exit(1) })
