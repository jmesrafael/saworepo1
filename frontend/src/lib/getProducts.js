// Fetch products from Supabase (primary), fallback to local backend
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SUPABASE_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000'

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null

export async function getProducts() {
  // Try Supabase first
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_deleted', false)

      if (!error && data && Array.isArray(data) && data.length > 0) {
        console.log('[getProducts] Loaded from Supabase')
        return data
      }
    } catch (err) {
      console.warn('[getProducts] Supabase unavailable:', err.message)
    }
  }

  // Fall back to local backend
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

  console.error('[getProducts] Failed to load from all sources')
  return []
}

export async function getProductBySlug(slug) {
  const products = await getProducts()
  return products.find(p => p.slug === slug) ?? null
}
