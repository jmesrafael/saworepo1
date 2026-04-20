import { Octokit } from '@octokit/rest'

const octokit = new Octokit({ auth: process.env.GITHUB_PAT })

const OWNER       = process.env.GITHUB_OWNER
const MAIN_REPO   = process.env.MAIN_REPO   || 'saworepo1'
const IMAGES_REPO = process.env.IMAGES_REPO || 'saworepo2'

// internal: get current file SHA (required for updates)

async function getFileSha(repo, path) {
  try {
    const { data } = await octokit.repos.getContent({ owner: OWNER, repo, path })
    return data.sha
  } catch {
    return null
  }
}

// internal: commit any file to any repo

async function commitFile(repo, path, base64Content, message) {
  const sha = await getFileSha(repo, path)
  await octokit.repos.createOrUpdateFileContents({
    owner: OWNER, repo, path, message, content: base64Content,
    ...(sha ? { sha } : {})
  })
}

// upload a product image to saworepo2/images/

export async function uploadImage(filename, buffer) {
  const path = `images/${filename}`
  await commitFile(IMAGES_REPO, path, buffer.toString('base64'), `chore: add image ${filename}`)
  return `https://cdn.jsdelivr.net/gh/${OWNER}/${IMAGES_REPO}@main/${path}`
}

// upload a product PDF to saworepo2/pdfs/

export async function uploadPdf(filename, buffer) {
  const path = `pdfs/${filename}`
  await commitFile(IMAGES_REPO, path, buffer.toString('base64'), `chore: add pdf ${filename}`)
  return `https://cdn.jsdelivr.net/gh/${OWNER}/${IMAGES_REPO}@main/${path}`
}

// read current products.json (bypasses CDN cache via GitHub API)

export async function fetchCurrentProducts() {
  try {
    const { data } = await octokit.repos.getContent({
      owner: OWNER, repo: MAIN_REPO, path: 'products.json'
    })
    const decoded = Buffer.from(data.content, 'base64').toString('utf8')
    return JSON.parse(decoded).products ?? []
  } catch {
    return []
  }
}

// rewrite full products.json in saworepo1

// Always pass the COMPLETE product array – this is a full rewrite, not an append.
export async function rewriteProductsJson(products) {
  const payload = { updatedAt: new Date().toISOString(), products }
  const base64  = Buffer.from(JSON.stringify(payload, null, 2)).toString('base64')
  await commitFile(
    MAIN_REPO,
    'products.json',
    base64,
    `chore: update products.json (${products.length} products)`
  )
}
