// CMS helper for GitHub-based product operations (Phase 2)

import {
  uploadImage,
  uploadPdf,
  fetchCurrentProducts,
  rewriteProductsJson,
} from './githubStorage'
import { v4 as uuidv4 } from 'uuid'

const DEV_MODE = process.env.REACT_APP_DEV_MODE === 'true'

// Save full products array to local backend (fire and forget)
async function saveLocallyAsync(products) {
  try {
    if (!Array.isArray(products)) products = [products];
    const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000'
    fetch(`${API_URL}/api/products/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updatedAt: new Date().toISOString(), products })
    }).catch(() => {})
  } catch (_) {}
}

// Download product images to local cache (fire and forget)
async function syncImagesAsync(imageUrls) {
  try {
    const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000'
    const urls = imageUrls.filter(u => u && typeof u === 'string')
    if (urls.length === 0) return
    fetch(`${API_URL}/api/products/sync-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls })
    }).catch(() => {})
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

// Create new product – GitHub (or local only in dev mode)
export async function createProduct(formData, thumbnailFile, imageFiles, specFiles, pdfFiles) {
  const productId = uuidv4()
  const slug      = formData.slug

  let githubThumbUrl, githubImageUrls, githubSpecUrls, githubFileObjects;

  if (DEV_MODE) {
    // Dev mode: skip GitHub, use placeholder URLs
    githubThumbUrl = thumbnailFile ? `data:image/webp;base64,${await fileToBase64(thumbnailFile)}` : (formData.thumbnail || null)
    githubImageUrls = imageFiles.length > 0 ? imageFiles.map((_, i) => `[LOCAL] ${slug}-img-${i}.webp`) : (formData.images || [])
    githubSpecUrls = specFiles.length > 0 ? specFiles.map((_, i) => `[LOCAL] ${slug}-spec-${i}.webp`) : (formData.spec_images || [])
    githubFileObjects = pdfFiles.length > 0 ? pdfFiles.map(f => ({ name: f.name, url: `[LOCAL] ${slug}-${f.name}` })) : (formData.files || [])
    console.log('🔧 DEV_MODE: Saving locally only (GitHub skipped)')
  } else {
    // Upload images to saworepo2
    githubThumbUrl = thumbnailFile
      ? await uploadImage(`${slug}-thumb.webp`, await fileToBase64(thumbnailFile))
      : (formData.thumbnail || null)

    githubImageUrls = imageFiles.length > 0
      ? await Promise.all(imageFiles.map(async (file, i) => uploadImage(`${slug}-img-${i}.webp`, await fileToBase64(file))))
      : (formData.images || [])

    githubSpecUrls = specFiles.length > 0
      ? await Promise.all(specFiles.map(async (file, i) => uploadImage(`${slug}-spec-${i}.webp`, await fileToBase64(file))))
      : (formData.spec_images || [])

    // Upload PDFs to saworepo2
    githubFileObjects = pdfFiles.length > 0
      ? await Promise.all(pdfFiles.map(async pdfFile => { const url = await uploadPdf(`${slug}-${pdfFile.name}`, await fileToBase64(pdfFile)); return { name: pdfFile.name, url }; }))
      : (formData.files || [])
  }

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

  // Append to products.json (GitHub if prod, local-only if dev)
  let allProducts = [newProduct]
  if (!DEV_MODE) {
    const currentProducts = await fetchCurrentProducts()
    allProducts = [...currentProducts, newProduct]
    await rewriteProductsJson(allProducts)
  } else {
    // In dev mode, just use the new product (next load will merge with local)
    try {
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000'
      const res = await fetch(`${API_URL}/api/products`)
      if (res.ok) {
        const existing = await res.json()
        allProducts = [...existing, newProduct]
      }
    } catch (_) {}
  }

  // Save locally with full array
  saveLocallyAsync(allProducts)

  // Download images to local cache
  const imageUrls = [
    newProduct.thumbnail,
    ...(newProduct.images || []),
    ...(newProduct.spec_images || [])
  ]
  syncImagesAsync(imageUrls)

  return newProduct
}

// Edit existing product – GitHub (or local only in dev mode)
export async function editProduct(productId, formData, newThumbnailFile, newImageFiles, newSpecFiles, newPdfFiles) {
  const slug = formData.slug

  let githubThumbUrl, newImageUrls, newSpecUrls, newFileObjects;

  if (DEV_MODE) {
    // Dev mode: skip GitHub, use placeholder URLs
    githubThumbUrl = newThumbnailFile ? `data:image/webp;base64,${await fileToBase64(newThumbnailFile)}` : (formData.thumbnail || null)
    newImageUrls = newImageFiles.length > 0 ? newImageFiles.map((_, i) => `[LOCAL] ${slug}-img-${i}.webp`) : (formData.images || [])
    newSpecUrls = newSpecFiles.length > 0 ? newSpecFiles.map((_, i) => `[LOCAL] ${slug}-spec-${i}.webp`) : (formData.spec_images || [])
    newFileObjects = newPdfFiles.length > 0 ? newPdfFiles.map(f => ({ name: f.name, url: `[LOCAL] ${slug}-${f.name}` })) : (formData.files || [])
    console.log('🔧 DEV_MODE: Editing locally only (GitHub skipped)')
  } else {
    // Upload any new files to saworepo2, or use existing URLs from formData
    githubThumbUrl = newThumbnailFile
      ? await uploadImage(`${slug}-thumb.webp`, await fileToBase64(newThumbnailFile))
      : (formData.thumbnail || null)

    newImageUrls = newImageFiles.length > 0
      ? await Promise.all(newImageFiles.map(async (file, i) => uploadImage(`${slug}-img-${i}.webp`, await fileToBase64(file))))
      : (formData.images || [])

    newSpecUrls = newSpecFiles.length > 0
      ? await Promise.all(newSpecFiles.map(async (file, i) => uploadImage(`${slug}-spec-${i}.webp`, await fileToBase64(file))))
      : (formData.spec_images || [])

    newFileObjects = newPdfFiles.length > 0
      ? await Promise.all(newPdfFiles.map(async pdfFile => { const url = await uploadPdf(`${slug}-${pdfFile.name}`, await fileToBase64(pdfFile)); return { name: pdfFile.name, url }; }))
      : (formData.files || [])
  }

  // Patch the matching product in products.json (GitHub if prod, local-only if dev)
  const now = new Date().toISOString()
  let synced;

  if (!DEV_MODE) {
    const currentProducts = await fetchCurrentProducts()
    synced = currentProducts.map(p => {
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
  } else {
    // Dev mode: fetch current from local and patch
    try {
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000'
      const res = await fetch(`${API_URL}/api/products`)
      if (res.ok) {
        const existing = await res.json()
        synced = existing.map(p => {
          if (p.id !== productId) return p
          return {
            ...p,
            name: formData.name, slug, description: formData.description,
            short_description: formData.short_description, brand: formData.brand,
            type: formData.type ?? p.type, spec_table: formData.spec_table ?? p.spec_table,
            resources: formData.resources ?? p.resources, status: formData.status,
            visible: formData.visible, featured: formData.featured ?? p.featured,
            sort_order: formData.sort_order, categories: formData.categories ?? [],
            tags: formData.tags ?? [], features: formData.features ?? [],
            auto_tag_columns: formData.auto_tag_columns ?? p.auto_tag_columns,
            thumbnail: githubThumbUrl ?? p.thumbnail,
            images: newImageUrls.length ? newImageUrls : p.images,
            spec_images: newSpecUrls.length ? newSpecUrls : p.spec_images,
            files: newFileObjects.length ? newFileObjects : p.files,
            updated_by_username: formData.updated_by_username ?? p.updated_by_username,
            updated_at: now,
          }
        })
      }
    } catch (_) {}
    console.log('🔧 DEV_MODE: Product updated locally only (GitHub skipped)')
  }

  // Save locally with full array
  saveLocallyAsync(synced)

  // Download images to local cache
  const updated = synced.find(p => p.id === productId)
  if (updated) {
    const imageUrls = [
      updated.thumbnail,
      ...(updated.images || []),
      ...(updated.spec_images || [])
    ]
    syncImagesAsync(imageUrls)
  }
}

// Delete product from GitHub and local storage
export async function deleteProduct(productId) {
  let remaining;

  if (!DEV_MODE) {
    const currentProducts = await fetchCurrentProducts()
    remaining = currentProducts.filter(p => p.id !== productId)
    await rewriteProductsJson(remaining)
  } else {
    // Dev mode: fetch from local, remove, save back
    try {
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000'
      const res = await fetch(`${API_URL}/api/products`)
      if (res.ok) {
        const existing = await res.json()
        remaining = existing.filter(p => p.id !== productId)
      }
    } catch (_) {}
    console.log('🔧 DEV_MODE: Product deleted locally only (GitHub skipped)')
  }

  // Update local storage with full remaining array
  saveLocallyAsync(remaining)

  // Note: image/PDF files in saworepo2 are intentionally left in place.
  // saworepo2 is append-only – old files don't break anything and serve as history.
}
