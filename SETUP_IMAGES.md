# Product Images Setup

This guide explains how product images are synced and served in the frontend.

## Overview

Product images are:
1. **Downloaded** from Supabase during sync
2. **Stored** in `frontend/saworepo2/images/` (versioned in git)
3. **Served** from the frontend public folder as `/product-images/`

## Setup Instructions

### 1. After first sync, create a symlink (recommended for development)

On Linux/Mac:
```bash
cd frontend/public
ln -s ../saworepo2/images product-images
```

On Windows (PowerShell as Admin):
```powershell
cd frontend\public
New-Item -ItemType SymbolicLink -Name product-images -Target ..\saworepo2\images
```

On Windows (Git Bash):
```bash
cd frontend/public
ln -s ../saworepo2/images product-images
```

### 2. Or copy images during build (for production)

Add to your build script in `package.json`:
```json
{
  "scripts": {
    "build": "npm run copy:images && vite build",
    "copy:images": "cp -r ../saworepo2/images ./public/product-images 2>/dev/null || true"
  }
}
```

### 3. Verify Setup

After setup, you should have:
- `frontend/public/product-images/` → contains all downloaded product images
- `products.json` → has image URLs like `/product-images/1776156727881_b483atddk2v.webp`

## How Syncing Works

When you run the sync:
```bash
cd backend
node syncSupabaseProducts.js
```

The script will:
1. **Download** images from Supabase URLs
2. **Convert** image URLs in `products.json` to local paths (`/product-images/...`)
3. **Detect** unused images and remove them
4. **Commit** changes to `frontend/saworepo2/` repository

## Using Images in Components

Import the utility in your React component:

```javascript
import { getImageUrl, getProductImageUrl } from '@/utils/imageLoader';

// Convert a single image path
const thumbnailUrl = getImageUrl(product.thumbnail);

// Or use the convenience function
const thumbnail = getProductImageUrl(product, 'thumbnail');
const images = getProductImageUrl(product, 'images'); // returns array
```

Then use in JSX:
```jsx
<img src={thumbnailUrl} alt={product.name} />

{/* For image gallery */}
{images.map((img, idx) => (
  <img key={idx} src={getImageUrl(img)} alt={`${product.name} ${idx}`} />
))}
```

## Cleanup

Unused images are automatically removed during sync. When a product is deleted from Supabase:
- The image is no longer referenced in `products.json`
- The sync script detects it as unused
- The image file is deleted
- Changes are committed to `saworepo2/`

## Migration from Supabase URLs

Products imported from Supabase still have URLs like:
```
https://qsdfdfuooeythaioucpx.supabase.co/storage/v1/object/public/product-images/...
```

These are automatically converted to local paths during sync. If you encounter any Supabase URLs in `products.json`, re-run the sync to update them.
