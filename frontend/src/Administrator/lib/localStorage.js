// Local storage helper for fast product persistence
// Saves to public/products.json for immediate reflection

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000'

// Save products to local JSON file via API
export async function saveProductsLocally(products) {
  try {
    const response = await fetch(`${API_URL}/api/products/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updatedAt: new Date().toISOString(),
        products: Array.isArray(products) ? products : [products]
      })
    })
    if (!response.ok) throw new Error('Failed to save products locally')
    return await response.json()
  } catch (err) {
    console.warn('[localStorage] Failed to save locally:', err)
    // Don't throw – allow GitHub save to proceed
    return null
  }
}

// Create product locally (returns immediately for fast UI update)
export async function createProductLocally(product) {
  return saveProductsLocally(product)
}

// Update product locally
export async function updateProductLocally(productId, updatedProduct) {
  return saveProductsLocally(updatedProduct)
}

// Delete product locally
export async function deleteProductLocally(productId) {
  try {
    const response = await fetch(`${API_URL}/api/products/${productId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    })
    if (!response.ok) throw new Error('Failed to delete product locally')
    return await response.json()
  } catch (err) {
    console.warn('[localStorage] Failed to delete locally:', err)
    return null
  }
}
