require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 5000;
const PRODUCTS_FILE = path.join(__dirname, '..', 'products.json');
const SAWOREPO2_IMAGES = path.join(__dirname, '..', 'frontend', 'saworepo2', 'images');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Static file serving for local image cache
app.use('/images', express.static(SAWOREPO2_IMAGES, { maxAge: '1d' }));

// Test route
app.get('/', (req, res) => {
  res.send('Hello from Express backend!');
});

// Get all products
app.get('/api/products', async (req, res) => {
  try {
    const data = await fs.readFile(PRODUCTS_FILE, 'utf8');
    const json = JSON.parse(data);
    res.json(json.products || []);
  } catch (err) {
    console.error('Error reading products:', err);
    res.status(500).json({ error: 'Failed to read products' });
  }
});

// Save products (upsert)
app.post('/api/products/save', async (req, res) => {
  try {
    const { updatedAt, products } = req.body;
    if (!Array.isArray(products)) {
      return res.status(400).json({ error: 'products must be an array' });
    }

    const payload = {
      updatedAt: updatedAt || new Date().toISOString(),
      source: 'local-admin',
      products
    };

    await fs.writeFile(PRODUCTS_FILE, JSON.stringify(payload, null, 2), 'utf8');
    res.json({ success: true, count: products.length });
  } catch (err) {
    console.error('Error saving products:', err);
    res.status(500).json({ error: 'Failed to save products' });
  }
});

// Delete product by ID
app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await fs.readFile(PRODUCTS_FILE, 'utf8');
    const json = JSON.parse(data);
    const filtered = (json.products || []).filter(p => p.id !== id);

    const payload = {
      updatedAt: new Date().toISOString(),
      source: 'local-admin',
      products: filtered
    };

    await fs.writeFile(PRODUCTS_FILE, JSON.stringify(payload, null, 2), 'utf8');
    res.json({ success: true, removed: id });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Seed products.json from GitHub (useful for fresh dev setups)
app.post('/api/products/seed-from-github', async (req, res) => {
  try {
    const GITHUB_OWNER = process.env.REACT_APP_GITHUB_OWNER;
    const MAIN_REPO = process.env.REACT_APP_MAIN_REPO || 'saworepo1';
    if (!GITHUB_OWNER) {
      return res.status(400).json({ error: 'REACT_APP_GITHUB_OWNER not set' });
    }

    const githubUrl = `https://cdn.jsdelivr.net/gh/${GITHUB_OWNER}/${MAIN_REPO}@main/products.json?t=${Date.now()}`;
    const response = await fetch(githubUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch from GitHub: HTTP ${response.status}`);
    }

    const json = await response.json();
    const payload = {
      updatedAt: new Date().toISOString(),
      source: 'seeded-from-github',
      products: json.products || []
    };

    await fs.writeFile(PRODUCTS_FILE, JSON.stringify(payload, null, 2), 'utf8');
    res.json({ success: true, count: payload.products.length, message: 'Products seeded from GitHub' });
  } catch (err) {
    console.error('Error seeding from GitHub:', err);
    res.status(500).json({ error: `Failed to seed: ${err.message}` });
  }
});

// Sync local to GitHub (manual trigger)
app.post('/api/products/sync-github', async (req, res) => {
  try {
    const data = await fs.readFile(PRODUCTS_FILE, 'utf8');
    const json = JSON.parse(data);
    res.json({ synced: json.products.length, message: 'Ready to sync to GitHub' });
  } catch (err) {
    console.error('Error syncing:', err);
    res.status(500).json({ error: 'Failed to prepare sync' });
  }
});

// Sync product images from CDN to local cache
app.post('/api/products/sync-images', async (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls)) {
    return res.status(400).json({ error: 'urls must be an array' });
  }

  // Ensure images directory exists
  try {
    if (!fsSync.existsSync(SAWOREPO2_IMAGES)) {
      await fs.mkdir(SAWOREPO2_IMAGES, { recursive: true });
    }
  } catch (err) {
    console.error('Error creating images directory:', err);
  }

  const results = [];
  for (const url of urls) {
    if (!url || typeof url !== 'string') continue;

    try {
      const filename = url.split('/').pop();
      const dest = path.join(SAWOREPO2_IMAGES, filename);

      // Skip if already cached
      if (fsSync.existsSync(dest)) {
        results.push({ url, status: 'cached', filename });
        continue;
      }

      // Download and save
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const buffer = await response.buffer();
      await fs.writeFile(dest, buffer);
      results.push({ url, status: 'downloaded', filename });
    } catch (err) {
      results.push({ url, status: 'error', filename: url.split('/').pop(), message: err.message });
    }
  }

  res.json({ success: true, results });
});

// Auto-seed from GitHub if products.json is missing/empty
async function ensureProductsExist() {
  try {
    const data = await fs.readFile(PRODUCTS_FILE, 'utf8');
    const json = JSON.parse(data);
    const count = (json.products || []).length;
    if (count > 0) {
      console.log(`✓ Loaded ${count} products from local ${PRODUCTS_FILE}`);
      return;
    }
  } catch (_) {}

  // File missing or empty — seed from GitHub
  try {
    console.log('📥 Local products.json empty/missing. Auto-seeding from GitHub...');
    const GITHUB_OWNER = process.env.REACT_APP_GITHUB_OWNER;
    const MAIN_REPO = process.env.REACT_APP_MAIN_REPO || 'saworepo1';
    if (!GITHUB_OWNER) {
      console.warn('⚠ REACT_APP_GITHUB_OWNER not set — skipping auto-seed');
      return;
    }

    const githubUrl = `https://cdn.jsdelivr.net/gh/${GITHUB_OWNER}/${MAIN_REPO}@main/products.json?t=${Date.now()}`;
    const response = await fetch(githubUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const json = await response.json();
    const payload = {
      updatedAt: new Date().toISOString(),
      source: 'seeded-from-github',
      products: json.products || []
    };

    await fs.writeFile(PRODUCTS_FILE, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`✓ Auto-seeded ${payload.products.length} products from GitHub`);
  } catch (err) {
    console.error('✗ Auto-seed failed:', err.message);
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  await ensureProductsExist();
});