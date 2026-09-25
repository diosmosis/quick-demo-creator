// Just enough of the GitHub REST API to hand Claude a pull request.
import { truncate } from './text.js'

const API = 'https://api.github.com'

// Accepts a PR URL (with or without a trailing /files, /commits, …) or the
// `owner/repo#123` shorthand.
export function parsePrUrl(input) {
  const text = String(input || '').trim()
  let m = text.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i)
  if (!m) m = text.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/)
  if (!m) return null
  const [, owner, repo, number] = m
  return { owner, repo, number: Number(number), url: `https://github.com/${owner}/${repo}/pull/${number}` }
}

// `fetchImpl` is Electron's net.fetch in the app: unlike Node's fetch it goes
// through Chromium's network stack and so honours the system proxy.
async function request(fetchImpl, path, token, accept = 'application/vnd.github+json') {
  const headers = {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'quick-demo-creator'
  }
  if (token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetchImpl(API + path, { headers })
  } catch (err) {
    throw new Error(`couldn't reach GitHub: ${err.cause?.message || err.message}`)
  }
  if (res.ok) return accept.endsWith('json') ? res.json() : res.text()

  let detail = ''
  try {
    detail = (await res.json()).message || ''
  } catch {
    // not JSON; the status says enough
  }
  if (res.status === 404 && !token) {
    throw new Error('Pull request not found. If the repository is private, add a GitHub token in Settings.')
  }
  if (res.status === 401) throw new Error('GitHub rejected the token (401). Check it in Settings.')
  throw new Error(`GitHub ${res.status}${detail ? `: ${detail}` : ''}`)
}

export async function verifyToken(token, fetchImpl = fetch) {
  const user = await request(fetchImpl, '/user', token)
  return { login: user.login }
}

export async function fetchPr(pr, token, maxDiffChars, fetchImpl = fetch) {
  const base = `/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`
  const [info, diff] = await Promise.all([
    request(fetchImpl, base, token),
    request(fetchImpl, base, token, 'application/vnd.github.diff')
  ])
  return {
    title: info.title,
    author: info.user?.login || '',
    state: info.merged_at ? 'merged' : info.state,
    base: info.base?.ref || '',
    head: info.head?.ref || '',
    body: info.body || '',
    changedFiles: info.changed_files,
    diff: truncate(diff, maxDiffChars, 'diff truncated')
  }
}

// The block appended to the planning prompt, so Claude doesn't need its own
// access to GitHub (which matters for private repositories).
export function formatPrContext(details) {
  return [
    '---',
    "The pull request's details were fetched for you below, so you don't need to access GitHub yourself.",
    '',
    `Title: ${details.title}`,
    `Author: ${details.author}`,
    `State: ${details.state}`,
    `Branches: ${details.head} → ${details.base}`,
    `Changed files: ${details.changedFiles}`,
    '',
    'Description:',
    details.body.trim() || '(no description)',
    '',
    'Diff:',
    '```diff',
    details.diff,
    '```'
  ].join('\n')
}
