require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const PRODUCTS_FILE = path.join(__dirname, '..', 'products.json');

// Middleware
app.use(cors());
app.use(express.json());

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

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});