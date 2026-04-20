// CMS helper for GitHub-based product operations (Phase 2)

import {
  uploadImage,
  uploadPdf,
  fetchCurrentProducts,
  rewriteProductsJson,
} from './githubStorage'
import { v4 as uuidv4 } from 'uuid'

async function toBuffer(file) {
  return Buffer.from(await file.arrayBuffer())
}

// Create new product â GitHub only
export async function createProduct(formData, thumbnailFile, imageFiles, specFiles, pdfFiles) {
  const productId = uuidv4()
  const slug      = formData.slug

  // Upload images to saworepo2
  const githubThumbUrl = thumbnailFile
    ? await uploadImage(`${slug}-thumb.webp`, await toBuffer(thumbnailFile))
    : null

  const githubImageUrls = []
  for (const [i, file] of imageFiles.entries()) {
    const url = await uploadImage(`${slug}-img-${i}.webp`, await toBuffer(file))
    githubImageUrls.push(url)
  }

  const githubSpecUrls = []
  for (const [i, file] of specFiles.entries()) {
    const url = await uploadImage(`${slug}-spec-${i}.webp`, await toBuffer(file))
    githubSpecUrls.push(url)
  }

  // Upload PDFs to saworepo2
  const githubFileObjects = []
  for (const pdfFile of pdfFiles) {
    const url = await uploadPdf(`${slug}-${pdfFile.name}`, await toBuffer(pdfFile))
    githubFileObjects.push({ name: pdfFile.name, url })
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

  // Append to products.json in saworepo1
  const currentProducts = await fetchCurrentProducts()
  await rewriteProductsJson([...currentProducts, newProduct])

  return newProduct
}

// Edit existing product â GitHub only
export async function editProduct(productId, formData, newThumbnailFile, newImageFiles, newSpecFiles, newPdfFiles) {
  const slug = formData.slug

  // Upload any new files to saworepo2
  const githubThumbUrl = newThumbnailFile
    ? await uploadImage(`${slug}-thumb.webp`, await toBuffer(newThumbnailFile))
    : null

  const newImageUrls = []
  for (const [i, file] of newImageFiles.entries()) {
    newImageUrls.push(await uploadImage(`${slug}-img-${i}.webp`, await toBuffer(file)))
  }

  const newSpecUrls = []
  for (const [i, file] of newSpecFiles.entries()) {
    newSpecUrls.push(await uploadImage(`${slug}-spec-${i}.webp`, await toBuffer(file)))
  }

  const newFileObjects = []
  for (const pdfFile of newPdfFiles) {
    const url = await uploadPdf(`${slug}-${pdfFile.name}`, await toBuffer(pdfFile))
    newFileObjects.push({ name: pdfFile.name, url })
  }

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
  await rewriteProductsJson(synced)
}

// Delete product â GitHub only
export async function deleteProduct(productId) {
  const currentProducts = await fetchCurrentProducts()
  const remaining = currentProducts.filter(p => p.id !== productId)
  await rewriteProductsJson(remaining)

  // Note: image/PDF files in saworepo2 are intentionally left in place.
  // saworepo2 is append-only – old files don't break anything and serve as history.
}
