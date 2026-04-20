// Fetch products from local backend first, then GitHub

const OWNER = process.env.REACT_APP_GITHUB_OWNER || 'jmesrafael'
const REPO1 = 'saworepo1'

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000'
const GITHUB_URL = process.env.NODE_ENV === 'development'
  ? `https://raw.githubusercontent.com/${OWNER}/${REPO1}/main/products.json`
  : `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO1}@main/products.json`

export async function getProducts() {
  // Try local backend first
  try {
    const res = await fetch(`${API_URL}/api/products`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    })
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) {
        console.log('[getProducts] Loaded from local backend')
        return data
      }
    }
  } catch (err) {
    console.warn('[getProducts] Local backend unavailable, trying GitHub:', err.message)
  }

  // Fall back to GitHub
  try {
    const res = await fetch(GITHUB_URL, { next: { revalidate: 60 } })
    if (!res.ok) throw new Error(`Failed to load products: ${res.status}`)
    const data = await res.json()
    console.log('[getProducts] Loaded from GitHub')
    return data.products ?? []
  } catch (err) {
    console.error('[getProducts] Failed to load from both sources:', err)
    return []
  }
}

export async function getProductBySlug(slug) {
  const products = await getProducts()
  return products.find(p => p.slug === slug) ?? null
}
