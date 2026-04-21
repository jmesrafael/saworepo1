import { Octokit } from '@octokit/rest'

const OWNER       = process.env.REACT_APP_GITHUB_OWNER
const GITHUB_PAT  = process.env.REACT_APP_GITHUB_PAT
const MAIN_REPO   = process.env.REACT_APP_MAIN_REPO   || 'saworepo1'
const IMAGES_REPO = process.env.REACT_APP_IMAGES_REPO || 'saworepo2'

if (!GITHUB_PAT || !OWNER) {
  console.error('❌ GitHub credentials missing! Set REACT_APP_GITHUB_PAT and REACT_APP_GITHUB_OWNER in .env')
} else {
  console.log('✅ GitHub credentials loaded:', {
    owner: OWNER,
    mainRepo: MAIN_REPO,
    imagesRepo: IMAGES_REPO,
    patExists: !!GITHUB_PAT,
    patLength: GITHUB_PAT.length
  })
}

const octokit = new Octokit({ auth: GITHUB_PAT })

// Debug helper - can be called from browser console
if (typeof window !== 'undefined') {
  window.__debugGitHub = {
    testConnection: async () => {
      try {
        const { data } = await octokit.repos.getContent({
          owner: OWNER, repo: MAIN_REPO, path: 'products.json'
        })
        console.log('✅ GitHub connection OK')
        console.log('File SHA:', data.sha)
        return true
      } catch (err) {
        console.error('❌ GitHub connection FAILED:', err.message)
        return false
      }
    },
    checkAuth: () => {
      console.log('Owner:', OWNER)
      console.log('Main Repo:', MAIN_REPO)
      console.log('Images Repo:', IMAGES_REPO)
      console.log('GitHub PAT exists:', !!GITHUB_PAT)
      console.log('GitHub PAT length:', GITHUB_PAT?.length)
    },
    getOctokit: () => octokit
  }
}

// Browser-compatible base64 helpers
function base64ToUtf8(base64) {
  return decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''))
}

function utf8ToBase64(utf8) {
  return btoa(encodeURIComponent(utf8).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))))
}

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
  try {
    if (!OWNER) throw new Error('REACT_APP_GITHUB_OWNER not set in environment')
    if (!GITHUB_PAT) throw new Error('REACT_APP_GITHUB_PAT not set in environment')

    let sha;
    try {
      sha = await getFileSha(repo, path)
    } catch (err) {
      console.warn(`[GitHub] Could not get SHA for ${path}, assuming new file:`, err.message)
    }

    try {
      const result = await octokit.repos.createOrUpdateFileContents({
        owner: OWNER, repo, path, message, content: base64Content,
        ...(sha ? { sha } : {})
      })
      console.log(`✅ [GitHub] Successfully committed ${path} to ${repo}:`, result.data.commit.sha)
      return result
    } catch (err) {
      console.error(`[GitHub] Failed to commit ${path} to ${repo}:`, err.message)
      if (err.status === 409) {
        throw new Error(`Merge conflict when updating ${path}. Please refresh and try again.`)
      } else if (err.status === 422) {
        throw new Error(`Validation error updating ${path}. The file may be too large or have invalid content.`)
      } else if (err.status === 401 || err.status === 403) {
        throw new Error(`Authentication failed. Check your GitHub credentials.`)
      }
      throw new Error(`GitHub upload failed: ${err.message}`)
    }
  } catch (err) {
    console.error('[GitHub] Unexpected error in commitFile:', err)
    throw err
  }
}

// internal: delete any file from any repo

async function deleteFile(repo, path, message) {
  try {
    if (!OWNER) throw new Error('REACT_APP_GITHUB_OWNER not set in environment')
    if (!GITHUB_PAT) throw new Error('REACT_APP_GITHUB_PAT not set in environment')

    let sha;
    try {
      sha = await getFileSha(repo, path)
    } catch (err) {
      console.warn(`[GitHub] File ${path} not found, skipping delete:`, err.message)
      return null
    }

    if (!sha) {
      console.warn(`[GitHub] Could not get SHA for ${path}, skipping delete`)
      return null
    }

    try {
      const result = await octokit.repos.deleteFile({
        owner: OWNER, repo, path, message, sha
      })
      console.log(`✅ [GitHub] Successfully deleted ${path} from ${repo}:`, result.data.commit.sha)
      return result
    } catch (err) {
      console.error(`[GitHub] Failed to delete ${path} from ${repo}:`, err.message)
      if (err.status === 401 || err.status === 403) {
        throw new Error(`Authentication failed. Check your GitHub credentials.`)
      }
      throw new Error(`GitHub delete failed: ${err.message}`)
    }
  } catch (err) {
    console.error('[GitHub] Unexpected error in deleteFile:', err)
    throw err
  }
}

// delete a product image from saworepo2/images/

export async function deleteImage(filename) {
  try {
    if (!filename || typeof filename !== 'string') {
      throw new Error(`Invalid filename: expected string, got ${typeof filename}`)
    }

    const path = `images/${filename}`
    console.log(`🗑️ [GitHub] Deleting image ${filename} from ${IMAGES_REPO}...`)
    await deleteFile(IMAGES_REPO, path, `chore: remove image ${filename}`)
    console.log(`✅ [GitHub] Image deleted: ${filename}`)
  } catch (err) {
    console.error(`[GitHub] Failed to delete image ${filename}:`, err)
    throw new Error(`Failed to delete image ${filename}: ${err.message}`)
  }
}

// upload a product image to saworepo2/images/

export async function uploadImage(filename, base64Content) {
  try {
    if (!filename || typeof filename !== 'string') {
      throw new Error(`Invalid filename: expected string, got ${typeof filename}`)
    }
    if (!base64Content || typeof base64Content !== 'string') {
      throw new Error(`Invalid base64 content for ${filename}`)
    }

    const path = `images/${filename}`
    console.log(`📤 [GitHub] Uploading image ${filename} to ${IMAGES_REPO}...`)
    await commitFile(IMAGES_REPO, path, base64Content, `chore: add image ${filename}`)
    const url = `https://cdn.jsdelivr.net/gh/${OWNER}/${IMAGES_REPO}@main/${path}`
    console.log(`✅ [GitHub] Image uploaded: ${url}`)
    return url
  } catch (err) {
    console.error(`[GitHub] Failed to upload image ${filename}:`, err)
    throw new Error(`Failed to upload image ${filename}: ${err.message}`)
  }
}

// delete a product PDF from saworepo2/pdfs/

export async function deletePdf(filename) {
  try {
    if (!filename || typeof filename !== 'string') {
      throw new Error(`Invalid filename: expected string, got ${typeof filename}`)
    }

    const path = `pdfs/${filename}`
    console.log(`🗑️ [GitHub] Deleting PDF ${filename} from ${IMAGES_REPO}...`)
    await deleteFile(IMAGES_REPO, path, `chore: remove pdf ${filename}`)
    console.log(`✅ [GitHub] PDF deleted: ${filename}`)
  } catch (err) {
    console.error(`[GitHub] Failed to delete PDF ${filename}:`, err)
    throw new Error(`Failed to delete PDF ${filename}: ${err.message}`)
  }
}

// upload a product PDF to saworepo2/pdfs/

export async function uploadPdf(filename, base64Content) {
  try {
    if (!filename || typeof filename !== 'string') {
      throw new Error(`Invalid filename: expected string, got ${typeof filename}`)
    }
    if (!base64Content || typeof base64Content !== 'string') {
      throw new Error(`Invalid base64 content for ${filename}`)
    }

    const path = `pdfs/${filename}`
    console.log(`📤 [GitHub] Uploading PDF ${filename} to ${IMAGES_REPO}...`)
    await commitFile(IMAGES_REPO, path, base64Content, `chore: add pdf ${filename}`)
    const url = `https://cdn.jsdelivr.net/gh/${OWNER}/${IMAGES_REPO}@main/${path}`
    console.log(`✅ [GitHub] PDF uploaded: ${url}`)
    return url
  } catch (err) {
    console.error(`[GitHub] Failed to upload PDF ${filename}:`, err)
    throw new Error(`Failed to upload PDF ${filename}: ${err.message}`)
  }
}

// read current products.json (bypasses CDN cache via GitHub API)

export async function fetchCurrentProducts() {
  try {
    console.log(`📖 [GitHub] Fetching current products.json from ${MAIN_REPO}...`)
    const { data } = await octokit.repos.getContent({
      owner: OWNER, repo: MAIN_REPO, path: 'products.json'
    })
    const decoded = base64ToUtf8(data.content)
    const parsed = JSON.parse(decoded)
    const products = parsed.products ?? []
    console.log(`✅ [GitHub] Fetched ${products.length} products from products.json`)
    return products
  } catch (err) {
    console.error(`[GitHub] Failed to fetch products.json:`, err.message)
    throw new Error(`Failed to fetch products from GitHub: ${err.message}`)
  }
}

// rewrite full products.json in saworepo1

// Always pass the COMPLETE product array – this is a full rewrite, not an append.
export async function rewriteProductsJson(products) {
  try {
    if (!Array.isArray(products)) {
      throw new Error(`Invalid products array: expected array, got ${typeof products}`)
    }

    const payload = { updatedAt: new Date().toISOString(), products }
    let base64;

    try {
      base64 = utf8ToBase64(JSON.stringify(payload, null, 2))
    } catch (err) {
      console.error('[GitHub] Error serializing products to JSON:', err)
      throw new Error(`Failed to serialize products: ${err.message}`)
    }

    console.log(`📝 [GitHub] Updating products.json with ${products.length} products...`)
    await commitFile(
      MAIN_REPO,
      'products.json',
      base64,
      `chore: update products.json (${products.length} products)`
    )
    console.log(`✅ [GitHub] Successfully updated products.json`)
  } catch (err) {
    console.error('[GitHub] Failed to rewrite products.json:', err)
    throw err
  }
}
