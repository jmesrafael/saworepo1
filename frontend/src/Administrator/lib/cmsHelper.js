// CMS helper for GitHub-based product operations (Phase 2)

import {
  uploadImage,
  uploadPdf,
  fetchCurrentProducts,
  rewriteProductsJson,
} from './githubStorage'
import { v4 as uuidv4 } from 'uuid'

const DEV_MODE = process.env.REACT_APP_DEV_MODE === 'true'

// Save full products array to local backend (fire and forget, but with logging)
async function saveLocallyAsync(products) {
  try {
    if (!Array.isArray(products)) products = [products];
    const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000'
    console.log(`📤 [saveLocallyAsync] Saving ${products.length} products to local backend at ${API_URL}...`)
    fetch(`${API_URL}/api/products/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updatedAt: new Date().toISOString(), products })
    }).then(res => {
      if (res.ok) {
        console.log('✅ [saveLocallyAsync] Successfully saved to local backend')
      } else {
        console.error(`❌ [saveLocallyAsync] Backend returned status ${res.status}`)
      }
    }).catch(err => {
      console.error('❌ [saveLocallyAsync] Network error:', err.message)
    })
  } catch (err) {
    console.error('❌ [saveLocallyAsync] Unexpected error:', err)
  }
}

// Download product images to local cache (fire and forget, but with logging)
async function syncImagesAsync(imageUrls) {
  try {
    const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000'
    const urls = imageUrls.filter(u => u && typeof u === 'string')
    if (urls.length === 0) {
      console.log('📸 [syncImagesAsync] No images to sync')
      return
    }
    console.log(`📸 [syncImagesAsync] Syncing ${urls.length} image(s) to local backend...`)
    fetch(`${API_URL}/api/products/sync-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls })
    }).then(res => {
      if (res.ok) {
        console.log('✅ [syncImagesAsync] Successfully synced images')
      } else {
        console.warn(`⚠️ [syncImagesAsync] Backend returned status ${res.status}`)
      }
    }).catch(err => {
      console.warn('⚠️ [syncImagesAsync] Network error (non-critical):', err.message)
    })
  } catch (err) {
    console.warn('⚠️ [syncImagesAsync] Unexpected error (non-critical):', err)
  }
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

  try {
    if (DEV_MODE) {
      // Dev mode: skip GitHub, use placeholder URLs
      try {
        githubThumbUrl = thumbnailFile ? `data:image/webp;base64,${await fileToBase64(thumbnailFile)}` : (formData.thumbnail || null)
      } catch (err) {
        console.error('Error converting thumbnail to base64:', err)
        throw new Error(`Failed to process thumbnail: ${err.message}`)
      }
      githubImageUrls = imageFiles.length > 0 ? imageFiles.map((_, i) => `[LOCAL] ${slug}-img-${i}.webp`) : (formData.images || [])
      githubSpecUrls = specFiles.length > 0 ? specFiles.map((_, i) => `[LOCAL] ${slug}-spec-${i}.webp`) : (formData.spec_images || [])
      githubFileObjects = pdfFiles.length > 0 ? pdfFiles.map(f => ({ name: f.name, url: `[LOCAL] ${slug}-${f.name}` })) : (formData.files || [])
      console.log('🔧 DEV_MODE: Saving locally only (GitHub skipped)')
    } else {
      // Upload images to saworepo2
      try {
        githubThumbUrl = thumbnailFile
          ? await uploadImage(`${slug}-thumb.webp`, await fileToBase64(thumbnailFile))
          : (formData.thumbnail || null)
      } catch (err) {
        console.error('Error uploading thumbnail:', err)
        throw new Error(`Failed to upload thumbnail: ${err.message}`)
      }

      try {
        githubImageUrls = imageFiles.length > 0
          ? await Promise.all(imageFiles.map(async (file, i) => {
              try {
                return await uploadImage(`${slug}-img-${i}.webp`, await fileToBase64(file))
              } catch (err) {
                console.error(`Error uploading image ${i}:`, err)
                throw new Error(`Failed to upload image ${i}: ${err.message}`)
              }
            }))
          : (formData.images || [])
      } catch (err) {
        console.error('Error uploading images:', err)
        throw new Error(`Failed to upload images: ${err.message}`)
      }

      try {
        githubSpecUrls = specFiles.length > 0
          ? await Promise.all(specFiles.map(async (file, i) => {
              try {
                return await uploadImage(`${slug}-spec-${i}.webp`, await fileToBase64(file))
              } catch (err) {
                console.error(`Error uploading spec image ${i}:`, err)
                throw new Error(`Failed to upload spec image ${i}: ${err.message}`)
              }
            }))
          : (formData.spec_images || [])
      } catch (err) {
        console.error('Error uploading spec images:', err)
        throw new Error(`Failed to upload spec images: ${err.message}`)
      }

      // Upload PDFs to saworepo2
      try {
        githubFileObjects = pdfFiles.length > 0
          ? await Promise.all(pdfFiles.map(async pdfFile => {
              try {
                const url = await uploadPdf(`${slug}-${pdfFile.name}`, await fileToBase64(pdfFile))
                return { name: pdfFile.name, url }
              } catch (err) {
                console.error(`Error uploading PDF ${pdfFile.name}:`, err)
                throw new Error(`Failed to upload PDF ${pdfFile.name}: ${err.message}`)
              }
            }))
          : (formData.files || [])
      } catch (err) {
        console.error('Error uploading PDFs:', err)
        throw new Error(`Failed to upload PDFs: ${err.message}`)
      }
    }
  } catch (err) {
    console.error('Error during file upload phase:', err)
    throw err
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
    try {
      const currentProducts = await fetchCurrentProducts()
      allProducts = [...currentProducts, newProduct]
      await rewriteProductsJson(allProducts)
      console.log(`✅ Product created and committed to GitHub: ${slug}`)
    } catch (err) {
      console.error('Error writing products.json to GitHub:', err)
      throw new Error(`Failed to save product to GitHub: ${err.message}`)
    }
  } else {
    // In dev mode, just use the new product (next load will merge with local)
    try {
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000'
      const res = await fetch(`${API_URL}/api/products`)
      if (res.ok) {
        const existing = await res.json()
        allProducts = [...existing, newProduct]
      }
    } catch (err) {
      console.error('Error fetching products in dev mode:', err)
    }
  }

  // Save locally with full array
  try {
    saveLocallyAsync(allProducts)
  } catch (err) {
    console.error('Error saving products locally:', err)
  }

  // Download images to local cache
  try {
    const imageUrls = [
      newProduct.thumbnail,
      ...(newProduct.images || []),
      ...(newProduct.spec_images || [])
    ]
    syncImagesAsync(imageUrls)
  } catch (err) {
    console.error('Error syncing images:', err)
  }

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
    try {
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
      console.log(`✅ Product updated and committed to GitHub: ${slug}`)
    } catch (err) {
      console.error('Error updating products.json on GitHub:', err)
      throw new Error(`Failed to update product in GitHub: ${err.message}`)
    }
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
    try {
      const currentProducts = await fetchCurrentProducts()
      remaining = currentProducts.filter(p => p.id !== productId)
      await rewriteProductsJson(remaining)
      console.log(`✅ Product deleted and committed to GitHub: ${productId}`)
    } catch (err) {
      console.error('Error deleting product from GitHub:', err)
      throw new Error(`Failed to delete product from GitHub: ${err.message}`)
    }
  } else {
    // Dev mode: fetch from local, remove, save back
    try {
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000'
      const res = await fetch(`${API_URL}/api/products`)
      if (res.ok) {
        const existing = await res.json()
        remaining = existing.filter(p => p.id !== productId)
      }
    } catch (err) {
      console.error('Error fetching products in dev mode for deletion:', err)
      throw new Error(`Failed to fetch products for deletion: ${err.message}`)
    }
    console.log('🔧 DEV_MODE: Product deleted locally only (GitHub skipped)')
  }

  // Update local storage with full remaining array
  try {
    saveLocallyAsync(remaining)
  } catch (err) {
    console.error('Error saving products locally after delete:', err)
  }

  // Note: image/PDF files in saworepo2 are intentionally left in place.
  // saworepo2 is append-only – old files don't break anything and serve as history.
}
