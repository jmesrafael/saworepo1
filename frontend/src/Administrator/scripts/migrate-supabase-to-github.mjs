import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { Octokit }      from '@octokit/rest'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const octokit = new Octokit({ auth: process.env.GITHUB_PAT })

const OWNER        = process.env.GITHUB_OWNER
const MAIN_REPO    = process.env.MAIN_REPO
const IMAGES_REPO  = process.env.IMAGES_REPO
const IMAGE_BUCKET = process.env.SUPABASE_IMAGE_BUCKET || 'product-images'
const PDF_BUCKET   = process.env.SUPABASE_PDF_BUCKET   || 'product-pdf'

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Safely parse a value that might already be an array, a JSON string, or null.
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

// ─── github helpers ──────────────────────────────────────────────────────────

async function getFileSha(repo, path) {
  try {
    const { data } = await octokit.repos.getContent({ owner: OWNER, repo, path })
    return data.sha
  } catch { return null }
}

async function commitToGitHub(repo, path, base64, message) {
  const sha = await getFileSha(repo, path)
  await octokit.repos.createOrUpdateFileContents({
    owner: OWNER, repo, path, message, content: base64,
    ...(sha ? { sha } : {})
  })
}

function cdnUrl(repo, path) {
  return `https://cdn.jsdelivr.net/gh/${OWNER}/${repo}@main/${path}`
}

// fetch existing products from GitHub
async function fetchCurrentProducts() {
  try {
    const { data } = await octokit.repos.getContent({
      owner: OWNER, repo: MAIN_REPO, path: 'products.json'
    })
    const decoded = Buffer.from(data.content, 'base64').toString('utf8')
    const payload = JSON.parse(decoded)
    return payload.products ?? []
  } catch (err) {
    throw new Error(`Failed to fetch products.json: ${err.message}`)
  }
}

// ─── supabase helpers (read-only) ────────────────────────────────────────────

async function downloadFromBucket(bucket, storagePath) {
  const { data, error } = await supabase.storage.from(bucket).download(storagePath)
  if (error) throw new Error(`[${bucket}/${storagePath}] ${error.message}`)
  return Buffer.from(await data.arrayBuffer())
}

function extractFilename(urlOrPath) {
  if (!urlOrPath) return null
  return decodeURIComponent(urlOrPath).split('/').pop()
}

// ─── migrate one image ───────────────────────────────────────────────────────

async function migrateImage(supabasePath) {
  if (!supabasePath) return null
  const filename   = extractFilename(supabasePath)
  const githubPath = `images/${filename}`
  try {
    const buffer = await downloadFromBucket(IMAGE_BUCKET, filename)
    await commitToGitHub(IMAGES_REPO, githubPath, buffer.toString('base64'), `chore: migrate image ${filename}`)
    console.log(`    ✓ image  ${filename}`)
    return cdnUrl(IMAGES_REPO, githubPath)
  } catch (err) {
    console.warn(`    ✗ image  ${filename}: ${err.message}`)
    return null
  }
}

// ─── migrate all assets for one product ─────────────────────────────────────

async function migrateProductAssets(product) {
  const thumbnail   = await migrateImage(product.thumbnail)
  const images      = []
  const spec_images = []
  const files       = []

  for (const p of toArray(product.images))      { const u = await migrateImage(p); if (u) images.push(u) }
  for (const p of toArray(product.spec_images)) { const u = await migrateImage(p); if (u) spec_images.push(u) }

  // ── files: handle all possible shapes from Supabase ──────────────────────
  const rawFiles = toArray(product.files)

  console.log(`    📎 raw files count: ${rawFiles.length}`)

  for (const f of rawFiles) {
    // shape 1: { name, url }  ← your current format (external URL)
    if (f && typeof f === 'object' && f.url) {
      files.push({
        name: f.name || extractFilename(f.url) || 'file',
        url:  f.url
      })
      console.log(`    ✓ file   ${f.name || f.url}`)
      continue
    }

    // shape 2: plain string path/url
    if (f && typeof f === 'string') {
      files.push({
        name: extractFilename(f) || 'file',
        url:  f
      })
      console.log(`    ✓ file   ${f}`)
      continue
    }

    console.warn(`    ✗ file   unrecognised shape: ${JSON.stringify(f)}`)
  }

  return { thumbnail, images, spec_images, files }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function migrate() {
  console.log('=== Supabase → GitHub migration (Supabase is read-only) ===')
  console.log(`Image bucket : ${IMAGE_BUCKET}`)
  console.log(`PDF bucket   : ${PDF_BUCKET}`)
  console.log(`Asset repo   : ${IMAGES_REPO}`)
  console.log(`Main repo    : ${MAIN_REPO}\n`)

  // Fetch existing products from GitHub
  console.log('Checking existing products in GitHub...')
  let existingProducts = []
  try {
    existingProducts = await fetchCurrentProducts()
  } catch (err) {
    console.warn(`  ⚠ No existing products.json or error reading it (first run?)\n  ${err.message}\n`)
  }

  const existingIds = new Set(existingProducts.map(p => p.id))
  console.log(`  Found ${existingIds.size} existing products in GitHub\n`)

  const { data: rawProducts, error } = await supabase
    .from('products')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) throw new Error(`Supabase query failed: ${error.message}`)
  console.log(`Found ${rawProducts.length} total products in Supabase`)

  // DEBUG: log files field shape for first few products so you can verify
  console.log('\n── files field sample (first 3 products) ──')
  for (const p of rawProducts.slice(0, 3)) {
    console.log(`  ${p.name}: files = ${JSON.stringify(p.files)}`)
  }
  console.log('────────────────────────────────────────────\n')

  // Filter to only new products
  const productsToMigrate = rawProducts.filter(p => !existingIds.has(p.id))
  console.log(`  → ${productsToMigrate.length} products need migration`)
  console.log(`  → ${existingIds.size} products already migrated\n`)

  const migrated = [...existingProducts]
  const failed   = []

  for (const [idx, product] of productsToMigrate.entries()) {
    console.log(`[${idx + 1}/${productsToMigrate.length}] ${product.name}`)
    try {
      const assets = await migrateProductAssets(product)
      migrated.push({
        id:                    product.id,
        name:                  product.name,
        slug:                  product.slug,
        description:           product.description           ?? '',
        short_description:     product.short_description     ?? '',
        brand:                 product.brand                 ?? '',
        type:                  product.type                  ?? null,
        spec_table:            product.spec_table            ?? null,
        resources:             product.resources             ?? null,
        status:                product.status                ?? 'draft',
        visible:               product.visible               ?? true,
        featured:              product.featured              ?? false,
        sort_order:            product.sort_order            ?? 0,
        categories:            toArray(product.categories),
        tags:                  toArray(product.tags),
        features:              toArray(product.features),
        auto_tag_columns:      toArray(product.auto_tag_columns),
        thumbnail:             assets.thumbnail,
        images:                assets.images,
        spec_images:           assets.spec_images,
        files:                 assets.files,
        created_by:            product.created_by            ?? null,
        created_by_username:   product.created_by_username   ?? null,
        updated_by_username:   product.updated_by_username   ?? null,
        created_at:            product.created_at,
        updated_at:            product.updated_at            ?? product.created_at,
        is_deleted:            product.is_deleted            ?? false,
      })
    } catch (err) {
      console.error(`  ✗ ${product.name}: ${err.message}`)
      failed.push({ id: product.id, name: product.name, error: err.message })
    }
  }

  // Commit final products.json
  const payload = {
    updatedAt: new Date().toISOString(),
    source:    'migrated-from-supabase',
    products:  migrated
  }
  const base64 = Buffer.from(JSON.stringify(payload, null, 2)).toString('base64')
  const sha    = await getFileSha(MAIN_REPO, 'products.json')
  await octokit.repos.createOrUpdateFileContents({
    owner: OWNER, repo: MAIN_REPO, path: 'products.json',
    message: `chore: migrate ${migrated.length} products from Supabase`,
    content: base64,
    ...(sha ? { sha } : {})
  })

  console.log(`\n=== Migration Summary ===`)
  console.log(`Total in products.json: ${migrated.length}`)
  console.log(`New products migrated : ${productsToMigrate.length}`)
  console.log(`Already had           : ${existingIds.size}`)
  console.log(`Failed in this run    : ${failed.length}`)
  if (failed.length) {
    console.log(`\nFailed products:`)
    failed.forEach(f => console.log(`  - ${f.name}: ${f.error}`))
  }
  console.log(`\n✓ products.json updated in ${MAIN_REPO}`)
  console.log(`✓ Supabase remains untouched - read-only migration`)
}

migrate().catch(err => { console.error('Fatal:', err.message); process.exit(1) })