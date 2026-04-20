import 'dotenv/config'

const OWNER = process.env.GITHUB_OWNER
const REPO1 = process.env.MAIN_REPO

const url = `https://raw.githubusercontent.com/${OWNER}/${REPO1}/main/products.json`
console.log('Fetching:', url)

const res  = await fetch(url)
if (!res.ok) { console.error(`HTTP ${res.status}`); process.exit(1) }

const data = await res.json()
const last = data.products.at(-1)

console.log(`\nTotal products  : ${data.products.length}`)
console.log(`Last updated    : ${data.updatedAt}`)
console.log(`Latest product  : ${last?.name}`)
console.log(`Slug            : ${last?.slug}`)
console.log(`Thumbnail URL   : ${last?.thumbnail}`)
console.log(`images[]        : ${last?.images?.length ?? 0} items`)
console.log(`spec_images[]   : ${last?.spec_images?.length ?? 0} items`)
console.log(`files[]         : ${last?.files?.length ?? 0} items`)

const cdnOk = last?.thumbnail?.startsWith('https://cdn.jsdelivr.net')
console.log(cdnOk ? '\n✓ CDN URLs look correct' : '\n✗ Thumbnail URL is not a jsDelivr CDN URL')
