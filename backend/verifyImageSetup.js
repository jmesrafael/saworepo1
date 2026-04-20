#!/usr/bin/env node
// Verify image sync setup and configuration

const fs = require('fs');
const path = require('path');

const checks = {
  passed: [],
  failed: [],
  warnings: []
};

function check(name, condition, details = '') {
  if (condition) {
    checks.passed.push({ name, details });
    console.log(`✅ ${name}`);
  } else {
    checks.failed.push({ name, details });
    console.log(`❌ ${name}`);
  }
  if (details) console.log(`   ${details}`);
}

function warn(name, details = '') {
  checks.warnings.push({ name, details });
  console.log(`⚠️  ${name}`);
  if (details) console.log(`   ${details}`);
}

console.log('🔍 Verifying Image Sync Setup\n');

// Check 1: products.json exists
const productsPath = path.join(__dirname, '..', 'products.json');
check('products.json exists', fs.existsSync(productsPath), productsPath);

// Check 2: Check products.json for local image paths
if (fs.existsSync(productsPath)) {
  try {
    const data = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
    const totalProducts = data.products?.length || 0;
    let productsWithLocalImages = 0;
    let productsWithRemoteImages = 0;

    data.products?.forEach(p => {
      const hasRemote = [
        p.thumbnail,
        ...(p.images || []),
        ...(p.spec_images || [])
      ].some(img => typeof img === 'string' && img.startsWith('http'));

      if (hasRemote) productsWithRemoteImages++;
      else productsWithLocalImages++;
    });

    check('Products use local image paths',
      productsWithRemoteImages === 0,
      `${productsWithLocalImages} local, ${productsWithRemoteImages} remote`);

    if (productsWithRemoteImages > 0) {
      warn('Run sync to convert remaining Supabase URLs', 'node syncSupabaseProducts.js');
    }
  } catch (e) {
    checks.failed.push({ name: 'Parse products.json', details: e.message });
    console.log(`❌ Parse products.json: ${e.message}`);
  }
}

// Check 3: saworepo2 directory
const saworepo2Path = path.join(__dirname, '..', 'frontend', 'saworepo2');
check('saworepo2 directory exists', fs.existsSync(saworepo2Path), saworepo2Path);

// Check 4: saworepo2 images directory
const imagesPath = path.join(saworepo2Path, 'images');
check('saworepo2/images directory exists', fs.existsSync(imagesPath), imagesPath);

// Check 5: Images in saworepo2
if (fs.existsSync(imagesPath)) {
  const files = fs.readdirSync(imagesPath);
  const imageFiles = files.filter(f => f.endsWith('.webp') || f.endsWith('.jpg') || f.endsWith('.png'));
  warn(`${imageFiles.length} images in saworepo2/images`, imageFiles.slice(0, 3).join(', ') + (imageFiles.length > 3 ? '...' : ''));
}

// Check 6: Frontend public directory
const publicPath = path.join(__dirname, '..', 'frontend', 'public');
check('Frontend public directory exists', fs.existsSync(publicPath), publicPath);

// Check 7: Image serving configured
const productImagesPath = path.join(publicPath, 'product-images');
const linkExists = fs.existsSync(productImagesPath);
check('Image serving configured (product-images symlink/folder)',
  linkExists,
  linkExists ? productImagesPath : 'See SETUP_IMAGES.md for setup instructions');

// Check 8: .env configured
const envPath = path.join(__dirname, '..', '.env');
const hasEnv = fs.existsSync(envPath);
if (hasEnv) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const hasUrl = envContent.includes('SUPABASE_URL');
    const hasKey = envContent.includes('SUPABASE_SERVICE_KEY');
    check('Supabase credentials in .env', hasUrl && hasKey, '.env configured');
  } catch {
    warn('Cannot read .env file');
  }
} else {
  warn('.env file not found', 'Create .env with SUPABASE_URL and SUPABASE_SERVICE_KEY');
}

// Summary
console.log('\n' + '═'.repeat(50));
console.log(`Passed: ${checks.passed.length} | Failed: ${checks.failed.length} | Warnings: ${checks.warnings.length}`);

if (checks.failed.length > 0) {
  console.log('\n⚠️  Setup incomplete. Issues to fix:');
  checks.failed.forEach((f, i) => {
    console.log(`${i + 1}. ${f.name}`);
    if (f.details) console.log(`   → ${f.details}`);
  });
}

if (checks.failed.length === 0) {
  console.log('\n✅ All checks passed! Image sync is ready.');
} else {
  console.log('\n📖 Read SETUP_IMAGES.md for configuration instructions');
}
