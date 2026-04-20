// CMS helper for GitHub-based product operations (Phase 2)

import {
  uploadImage,
  uploadPdf,
  fetchCurrentProducts,
  rewriteProductsJson,
} from './githubStorage'
import { v4 as uuidv4 } from 'uuid'

// Optional local save (fire and forget, don't block on failures)
async function saveLocallyAsync(product) {
  try {
    const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000'
    const body = Array.isArray(product) ? product : [product]
    fetch(`${API_URL}/api/products/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updatedAt: new Date().toISOString(), products: body })
    }).catch(() => {}) // Silently ignore failures
  } catch (_) {}
}

async function fileToBase64(file) {
  const arrayBuffer = await file.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// Create new product â GitHub only
export async function createProduct(formData, thumbnailFile, imageFiles, specFiles, pdfFiles) {
  const productId = uuidv4()
  const slug      = formData.slug

  // Upload images to saworepo2
  const githubThumbUrl = thumbnailFile
    ? await uploadImage(`${slug}-thumb.webp`, await fileToBase64(thumbnailFile))
    : (formData.thumbnail || null)

  const githubImageUrls = imageFiles.length > 0
    ? await Promise.all(imageFiles.map(async (file, i) => uploadImage(`${slug}-img-${i}.webp`, await fileToBase64(file))))
    : (formData.images || [])

  const githubSpecUrls = specFiles.length > 0
    ? await Promise.all(specFiles.map(async (file, i) => uploadImage(`${slug}-spec-${i}.webp`, await fileToBase64(file))))
    : (formData.spec_images || [])

  // Upload PDFs to saworepo2
  const githubFileObjects = pdfFiles.length > 0
    ? await Promise.all(pdfFiles.map(async pdfFile => { const url = await uploadPdf(`${slug}-${pdfFile.name}`, await fileToBase64(pdfFile)); return { name: pdfFile.name, url }; }))
    : (formData.files || [])

  // Build the product object with all schema fields
  const now = new Date().toISOString()
  const newProduct = {
    id:                  productId,
    name:                formData.name,
    slug,
    description:         formData.description         ?? '',
    short_description:   formData.short_description   ?? '',
    brand:               formData.brand               ?? '',
    type:                formData.type                ?? null,
    spec_table:          formData.spec_table          ?? null,
    resources:           formData.resources           ?? null,
    status:              formData.status              ?? 'draft',
    visible:             formData.visible             ?? true,
    featured:            formData.featured            ?? false,
    sort_order:          formData.sort_order          ?? 0,
    categories:          formData.categories          ?? [],
    tags:                formData.tags                ?? [],
    features:            formData.features            ?? [],
    auto_tag_columns:    formData.auto_tag_columns    ?? [],
    thumbnail:           githubThumbUrl,
    images:              githubImageUrls,
    spec_images:         githubSpecUrls,
    files:               githubFileObjects,
    created_by:          formData.created_by          ?? null,
    created_by_username: formData.created_by_username ?? null,
    updated_by_username: formData.updated_by_username ?? null,
    created_at:          now,
    updated_at:          now,
    is_deleted:          false,
  }

  // Save locally first (fast reflection)
  saveLocallyAsync(newProduct) // Fire and forget

  // Append to products.json in saworepo1
  const currentProducts = await fetchCurrentProducts()
  await rewriteProductsJson([...currentProducts, newProduct])

  return newProduct
}

// Edit existing product â GitHub only
export async function editProduct(productId, formData, newThumbnailFile, newImageFiles, newSpecFiles, newPdfFiles) {
  const slug = formData.slug

  // Upload any new files to saworepo2, or use existing URLs from formData
  const githubThumbUrl = newThumbnailFile
    ? await uploadImage(`${slug}-thumb.webp`, await fileToBase64(newThumbnailFile))
    : (formData.thumbnail || null)

  const newImageUrls = newImageFiles.length > 0
    ? await Promise.all(newImageFiles.map(async (file, i) => uploadImage(`${slug}-img-${i}.webp`, await fileToBase64(file))))
    : (formData.images || [])

  const newSpecUrls = newSpecFiles.length > 0
    ? await Promise.all(newSpecFiles.map(async (file, i) => uploadImage(`${slug}-spec-${i}.webp`, await fileToBase64(file))))
    : (formData.spec_images || [])

  const newFileObjects = newPdfFiles.length > 0
    ? await Promise.all(newPdfFiles.map(async pdfFile => { const url = await uploadPdf(`${slug}-${pdfFile.name}`, await fileToBase64(pdfFile)); return { name: pdfFile.name, url }; }))
    : (formData.files || [])

  // Patch the matching product in products.json
  const currentProducts = await fetchCurrentProducts()
  const now = new Date().toISOString()
  const synced = currentProducts.map(p => {
    if (p.id !== productId) return p
    return {
      ...p,
      name:                formData.name,
      slug,
      description:         formData.description,
      short_description:   formData.short_description,
      brand:               formData.brand,
      type:                formData.type                ?? p.type,
      spec_table:          formData.spec_table          ?? p.spec_table,
      resources:           formData.resources           ?? p.resources,
      status:              formData.status,
      visible:             formData.visible,
      featured:            formData.featured            ?? p.featured,
      sort_order:          formData.sort_order,
      categories:          formData.categories          ?? [],
      tags:                formData.tags                ?? [],
      features:            formData.features            ?? [],
      auto_tag_columns:    formData.auto_tag_columns    ?? p.auto_tag_columns,
      thumbnail:           githubThumbUrl               ?? p.thumbnail,
      images:              newImageUrls.length          ? newImageUrls : p.images,
      spec_images:         newSpecUrls.length           ? newSpecUrls  : p.spec_images,
      files:               newFileObjects.length        ? newFileObjects : p.files,
      updated_by_username: formData.updated_by_username ?? p.updated_by_username,
      updated_at:          now,
    }
  })

  // Update GitHub
  await rewriteProductsJson(synced)

  // Save locally (fire and forget)
  const updated = synced.find(p => p.id === productId)
  saveLocallyAsync(updated)
}

// Delete product from GitHub and local storage
export async function deleteProduct(productId) {
  const currentProducts = await fetchCurrentProducts()
  const remaining = currentProducts.filter(p => p.id !== productId)
  await rewriteProductsJson(remaining)

  // Delete locally (fire and forget)
  try {
    const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000'
    fetch(`${API_URL}/api/products/${productId}`, { method: 'DELETE' }).catch(() => {})
  } catch (_) {}

  // Note: image/PDF files in saworepo2 are intentionally left in place.
  // saworepo2 is append-only – old files don't break anything and serve as history.
}
