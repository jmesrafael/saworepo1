// Fetch products from local backend (primary, zero egress), fallback to GitHub CDN
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000'
const GITHUB_OWNER = process.env.REACT_APP_GITHUB_OWNER
const MAIN_REPO = process.env.REACT_APP_MAIN_REPO || 'saworepo1'
const GITHUB_RAW_URL = `https://cdn.jsdelivr.net/gh/${GITHUB_OWNER}/${MAIN_REPO}@main/products.json`

export async function getProducts() {
  // Local backend (primary — zero egress)
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
    console.warn('[getProducts] Local backend unavailable:', err.message)
  }

  // GitHub CDN fallback (when backend is offline)
  try {
    const res = await fetch(`${GITHUB_RAW_URL}?t=${Date.now()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    })
    if (res.ok) {
      const json = await res.json()
      const data = json.products || []
      if (data.length > 0) {
        console.log('[getProducts] Loaded from GitHub CDN')
        return data
      }
    }
  } catch (err) {
    console.warn('[getProducts] GitHub fallback unavailable:', err.message)
  }

  console.error('[getProducts] Failed to load from all sources')
  return []
}

export async function getProductBySlug(slug) {
  const products = await getProducts()
  return products.find(p => p.slug === slug) ?? null
}
