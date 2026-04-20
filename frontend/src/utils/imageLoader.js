// Image loader utility for product images
// Handles conversion of local image paths to proper URLs

export const IMAGE_BASE_PATH = '/product-images';

export function getImageUrl(imagePath) {
  // If it's already a local path like /product-images/filename.webp, return as-is
  if (typeof imagePath === 'string' && imagePath.startsWith('/product-images/')) {
    return imagePath;
  }

  // If it's still a Supabase URL (migration fallback), return it
  if (typeof imagePath === 'string' && imagePath.startsWith('http')) {
    return imagePath;
  }

  // If it's just a filename, prepend the base path
  if (typeof imagePath === 'string') {
    return `${IMAGE_BASE_PATH}/${imagePath}`;
  }

  return null;
}

export function getProductImageUrl(product, imageType = 'thumbnail') {
  switch (imageType) {
    case 'thumbnail':
      return getImageUrl(product.thumbnail);
    case 'images':
      return Array.isArray(product.images) ? product.images.map(getImageUrl) : [];
    case 'spec_images':
      return Array.isArray(product.spec_images) ? product.spec_images.map(getImageUrl) : [];
    default:
      return null;
  }
}
