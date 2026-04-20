/**
 * supabaseReader.js
 * src/local-storage/supabaseReader.js
 *
 * Fetches live data from GitHub (products) and Supabase (reference data: categories, tags).
 * Products now come from GitHub's products.json (Phase 2 migration).
 * Used by admin CMS and frontend for real-time data.
 *
 * ─── USAGE ────────────────────────────────────────────────────────────────────
 *  import { getAllProductsLive, getAllCategoriesLive, getAllTagsLive } from '../local-storage/supabaseReader';
 *
 *  // Fetch all products from GitHub
 *  const products = await getAllProductsLive();
 *
 *  // Fetch categories/tags from Supabase (reference data)
 *  const categories = await getAllCategoriesLive();
 */

import { supabase } from "../Administrator/supabase";
import { getProducts } from "../lib/getProducts";

/**
 * Fetch all products live from GitHub (products.json)
 */
export async function getAllProductsLive() {
  try {
    const products = await getProducts();
    return products || [];
  } catch (err) {
    console.error("[supabaseReader] Failed to fetch products:", err);
    return [];
  }
}

/**
 * Fetch all categories live from Supabase
 */
export async function getAllCategoriesLive() {
  try {
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("[supabaseReader] Failed to fetch categories:", err);
    return [];
  }
}

/**
 * Fetch all tags live from Supabase
 */
export async function getAllTagsLive() {
  try {
    const { data, error } = await supabase
      .from("tags")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("[supabaseReader] Failed to fetch tags:", err);
    return [];
  }
}

/**
 * Fetch a single product by ID live from GitHub
 */
export async function getProductByIdLive(id) {
  try {
    const products = await getProducts();
    return products.find(p => p.id === id) ?? null;
  } catch (err) {
    console.error("[supabaseReader] Failed to fetch product:", err);
    return null;
  }
}

/**
 * Fetch a single product by slug live from GitHub
 */
export async function getProductBySlugLive(slug) {
  try {
    const products = await getProducts();
    return products.find(p => p.slug === slug) ?? null;
  } catch (err) {
    console.error("[supabaseReader] Failed to fetch product by slug:", err);
    return null;
  }
}

/**
 * Get visible (published & visible) products live from GitHub
 */
export async function getVisibleProductsLive() {
  try {
    const products = await getAllProductsLive();
    return products.filter(p =>
      p.visible !== false && p.status === 'published'
    );
  } catch (err) {
    console.error("[supabaseReader] Failed to fetch visible products:", err);
    return [];
  }
}

/**
 * Search products live from Supabase
 */
export async function searchProductsLive(query) {
  try {
    const products = await getAllProductsLive();
    const q = query.toLowerCase().trim();
    if (!q) return products;
    return products.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      p.short_description?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q) ||
      p.brand?.toLowerCase().includes(q)
    );
  } catch (err) {
    console.error("[supabaseReader] Failed to search products:", err);
    return [];
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SMART CACHING LAYER — Reduces egress via memory, localStorage, and selective fields
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_KEY = "sawo_visible_products_v1";
let _cache = null;
let _cacheTime = 0;
let _inflight = null;

/**
 * Get visible products with smart caching.
 * Checks: memory (this session) → localStorage (5 min TTL) → GitHub products.json
 * Deduplicates in-flight requests.
 *
 * @param {boolean} force - Skip caches, force fresh GitHub fetch
 * @returns {Promise<Array>} Array of visible published products
 */
export async function getVisibleProductsCached(force = false) {
  const now = Date.now();

  // ─── Step 1: Check in-memory cache (fastest, deduplicates concurrent requests) ───
  if (!force && _inflight) {
    // Concurrent request in-flight, reuse same Promise
    return _inflight;
  }

  if (!force && _cache && (now - _cacheTime) < CACHE_TTL_MS) {
    // In-memory cache still fresh
    return _cache;
  }

  // ─── Step 2: Check localStorage cache (survives page refresh) ───
  if (!force) {
    try {
      const stored = localStorage.getItem(CACHE_KEY);
      if (stored) {
        const { data, time } = JSON.parse(stored);
        if (data && (now - time) < CACHE_TTL_MS) {
          // localStorage cache still fresh; hydrate memory for this session
          _cache = data;
          _cacheTime = time;
          return data;
        }
      }
    } catch (err) {
      console.warn("[supabaseReader] localStorage parse failed:", err);
    }
  }

  // ─── Step 3: Fetch from GitHub products.json ───
  const fetchPromise = (async () => {
    try {
      const allProducts = await getProducts();
      const products = allProducts.filter(p => p.status === 'published' && p.visible !== false);

      // ─── Write to both caches ───
      _cache = products;
      _cacheTime = now;
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ data: products, time: now }));
      } catch (e) {
        console.warn("[supabaseReader] localStorage write failed (quota?):", e);
      }

      return products;
    } catch (err) {
      console.error("[supabaseReader] Failed to fetch visible products:", err);
      return [];
    } finally {
      _inflight = null;
    }
  })();

  _inflight = fetchPromise;
  return fetchPromise;
}

/**
 * Bust the cached products (call after admin sync to force refresh)
 */
export function bustProductCache() {
  _cache = null;
  _cacheTime = 0;
  _inflight = null;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch (e) {
    // ignore
  }
}
