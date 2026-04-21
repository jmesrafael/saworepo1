#!/usr/bin/env node
import 'dotenv/config'
import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function runScript(scriptName, description) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`▶  ${description}`)
  console.log(`${'═'.repeat(60)}\n`)

  try {
    execSync(`node ${scriptName}`, {
      cwd: __dirname,
      stdio: 'inherit'
    })
    console.log(`\n✅ ${description} completed\n`)
    return true
  } catch (err) {
    console.error(`\n❌ ${description} failed:`, err.message)
    return false
  }
}

async function fullSync() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                 FULL SUPABASE SYNC PROCESS                ║
║     [1] Sync products  [2] Enrich files  [3] Enrich MD     ║
╚═══════════════════════════════════════════════════════════╝
  `)

  const scripts = [
    { name: 'sync-supabase-to-github.mjs', desc: '[Step 1/3] Syncing products from Supabase' },
    { name: 'enrich-products-files.mjs', desc: '[Step 2/3] Enriching products with files' },
    { name: 'enrich-products-metadata.mjs', desc: '[Step 3/3] Enriching products with metadata' }
  ]

  let completed = 0
  let failed = 0

  for (const { name, desc } of scripts) {
    const success = await runScript(name, desc)
    if (success) {
      completed++
    } else {
      failed++
      console.warn(`⚠️  Continuing despite error in ${name}...\n`)
    }
  }

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    SYNC SUMMARY                           ║
╚═══════════════════════════════════════════════════════════╝
  Steps completed: ${completed}/${scripts.length}
  ${completed === scripts.length ? '✅ All sync steps completed successfully!' : `⚠️  ${failed} step(s) had issues`}
  `)

  if (failed > 0) process.exit(1)
}

fullSync().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
