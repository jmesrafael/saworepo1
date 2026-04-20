// Fetch products from GitHub (Phase 2 source of truth)

const OWNER = process.env.REACT_APP_GITHUB_OWNER || 'jmesrafael'
const REPO1 = 'saworepo1'

const JSON_URL = process.env.NODE_ENV === 'development'
  ? `https://raw.githubusercontent.com/${OWNER}/${REPO1}/main/products.json`
  : `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO1}@main/products.json`

export async function getProducts() {
  const res = await fetch(JSON_URL, { next: { revalidate: 60 } })
  if (!res.ok) throw new Error(`Failed to load products: ${res.status}`)
  const data = await res.json()
  return data.products ?? []
}

export async function getProductBySlug(slug) {
  const products = await getProducts()
  return products.find(p => p.slug === slug) ?? null
}
