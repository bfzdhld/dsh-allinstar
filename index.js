/**
 * dsh-allinstar — Host half.
 *
 * One job: star the GitHub repository behind an installed plugin, from inside
 * the harness. The Client half only renders; every decision that touches the
 * network, the file system, or a credential happens here, so the Web UI and the
 * agent tool call exactly the same code path.
 *
 * Token resolution follows the three-source chain the rest of the ecosystem
 * uses, most explicit first:
 *   1. DSH_GITHUB_TOKEN in the process environment
 *   2. a token the person saved in the panel (credential record, never config)
 *   3. an already-authenticated GitHub CLI
 * Nothing is required to browse; starring is what needs an account.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'

const NS = 'dsh-allinstar'
const ROUTE_BASE = '/dsh-allinstar'
const CREDENTIAL_KEY = 'dsh-allinstar/pat'
const ENV_TOKEN = 'DSH_GITHUB_TOKEN'
const API = 'https://api.github.com'
const USER_AGENT = 'dsh-allinstar/1.0'

/** Official packages are not community work and are not candidates for starring. */
const OFFICIAL_SCOPE = '@deepseek-ai/'

function profileDir() {
  const fromEnv = process.env.DSH_PROFILE_DIR
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'profiles', process.env.DSH_PROFILE || 'desktop')
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

function prefsFile() {
  return path.join(dshHome(), 'dsh-allinstar.json')
}

/**
 * The preferences written before the rename. Reading them keeps the "don't warn
 * me again" choice the person already made instead of showing the notice twice.
 */
function readPreferences() {
  const current = readJson(prefsFile())
  if (current !== undefined && current !== null && typeof current === 'object') return current
  const legacy = readJson(path.join(dshHome(), 'dsh-github-star.json'))
  return legacy !== undefined && legacy !== null && typeof legacy === 'object' ? legacy : {}
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

/* ---------------------------------------------------------------------------
 * Repository resolution
 * ------------------------------------------------------------------------- */

/**
 * Turn any of the shapes a manifest may use into `owner/repo`.
 * Covers git+https, git://, ssh, `github:o/r`, a bare `o/r`, and a plain URL
 * that may carry a deep path (which is truncated to the first two segments).
 */
export function parseRepository(input) {
  if (typeof input === 'string') {
    const raw = input.trim()
    if (raw === '') return undefined
    if (raw.startsWith('github:')) return normalizeSlug(raw.slice('github:'.length))
    const direct = normalizeSlug(raw.replace(/\.git$/i, ''))
    if (direct !== undefined && !raw.includes('://')) return direct
    const url = raw.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://')
    try {
      const parsed = new URL(url)
      if (!/(^|\.)github\.com$/i.test(parsed.hostname)) return undefined
      return normalizeSlug(parsed.pathname.replace(/^\/+/, '').replace(/\.git$/i, ''))
    } catch {
      return undefined
    }
  }
  if (input !== null && typeof input === 'object' && typeof input.url === 'string') {
    return parseRepository(input.url)
  }
  return undefined
}

function normalizeSlug(value) {
  const parts = value.split('/').filter((part) => part !== '')
  if (parts.length < 2) return undefined
  const owner = parts[0]
  const repo = parts[1].replace(/\.git$/i, '')
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) return undefined
  return `${owner}/${repo}`
}

/** Display title from the plugin's own locale, so the list reads like the app. */
function localeTitle(packageDir, packageName) {
  for (const candidate of ['locale/zh.json', 'locale/en.json']) {
    const doc = readJson(path.join(packageDir, candidate))
    const title = doc && doc.meta && typeof doc.meta.title === 'string' ? doc.meta.title.trim() : ''
    if (title !== '') return title
  }
  return packageName
}

/**
 * Everything installed in this profile, with the GitHub home each one declares.
 * A package with no GitHub repository is still listed: hiding it would make the
 * panel quietly disagree with the Plugins page it sits next to.
 */
function installedPlugins() {
  const dir = profileDir()
  const manifest = readJson(path.join(dir, 'package.json'))
  const dependencies = manifest && typeof manifest.dependencies === 'object' && manifest.dependencies !== null
    ? manifest.dependencies
    : {}
  const names = Object.keys(dependencies)
    .filter((name) => !name.startsWith(OFFICIAL_SCOPE))
    .sort((left, right) => left.localeCompare(right))

  const plugins = []
  for (const name of names) {
    const packageDir = path.join(dir, 'node_modules', name)
    const pkg = readJson(path.join(packageDir, 'package.json'))
    const spec = String(dependencies[name] ?? '')
    const repo = pkg ? parseRepository(pkg.repository ?? pkg.homepage) : undefined
    plugins.push({
      packageName: name,
      title: pkg ? localeTitle(packageDir, name) : name,
      version: pkg && typeof pkg.version === 'string' ? pkg.version : '',
      description: pkg && typeof pkg.description === 'string' ? pkg.description : '',
      repo: repo ?? null,
      repoUrl: repo === undefined ? null : `https://github.com/${repo}`,
      source: spec,
      local: /^(link|file):/i.test(spec),
    })
  }
  return { profile: nameOfProfile(dir), root: dir, plugins }
}

function nameOfProfile(dir) {
  return path.basename(dir)
}

/* ---------------------------------------------------------------------------
 * Token
 * ------------------------------------------------------------------------- */

let ghTokenCache = { value: null, expires: 0 }

function envToken() {
  const raw = process.env[ENV_TOKEN]
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

/** Records written under the plugin's earlier names, read once and migrated. */
const LEGACY_CREDENTIAL_KEYS = ['dsh-AllInStar/pat', 'dsh-github-star/pat']

function readApiKeyRecord(credentials, key) {
  return credentials.readRecord(key).then((record) => {
    if (record === undefined || record === null) return undefined
    if (record.kind !== 'api-key') return undefined
    const value = typeof record.key === 'string' ? record.key.trim() : ''
    return value === '' ? undefined : value
  }).catch(() => undefined)
}

async function storedToken(ctx) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return undefined
  const current = await readApiKeyRecord(credentials, CREDENTIAL_KEY)
  if (current !== undefined) return current
  // Renaming the package moved the record's address; without this, a token the
  // person already saved would look unconfigured. Move it across on first read.
  for (const legacy of LEGACY_CREDENTIAL_KEYS) {
    const found = await readApiKeyRecord(credentials, legacy)
    if (found === undefined) continue
    try {
      await credentials.modifyRecord(CREDENTIAL_KEY, async () => ({ kind: 'api-key', key: found }))
      await credentials.deleteRecord(legacy)
    } catch {
      /* keep using the value even if the migration write is refused */
    }
    return found
  }
  return undefined
}

/** Ask an already-signed-in GitHub CLI, with a deadline so a hang cannot stall a read. */
function cliToken() {
  if (Date.now() < ghTokenCache.expires) return Promise.resolve(ghTokenCache.value)
  const command = process.platform === 'win32' ? 'gh.exe' : 'gh'
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      ghTokenCache = { value, expires: Date.now() + (value ? 10 * 60_000 : 30_000) }
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), 1500)
    try {
      execFile(command, ['auth', 'token'], { timeout: 1400, windowsHide: true }, (error, stdout) => {
        clearTimeout(timer)
        if (error) return finish(null)
        const value = String(stdout || '').trim()
        finish(value === '' ? null : value)
      })
    } catch {
      clearTimeout(timer)
      finish(null)
    }
  })
}

/** Resolve the effective token and say where it came from. */
async function resolveToken(ctx) {
  const fromEnv = envToken()
  if (fromEnv !== undefined) return { token: fromEnv, source: 'env' }
  const stored = await storedToken(ctx)
  if (stored !== undefined) return { token: stored, source: 'stored' }
  const cli = await cliToken()
  if (cli !== null) return { token: cli, source: 'gh' }
  return { token: undefined, source: 'none' }
}

/* ---------------------------------------------------------------------------
 * GitHub
 * ------------------------------------------------------------------------- */

class GitHubError extends Error {
  constructor(message, status, detail) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
    this.detail = detail
  }
}

async function github(pathname, { token, method = 'GET', body } = {}) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': USER_AGENT,
    'x-github-api-version': '2022-11-28',
  }
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  let response
  try {
    response = await fetch(`${API}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    // A bare "fetch failed" hides the transport reason (DNS, TLS, proxy), and
    // that reason is the only thing that makes it actionable.
    const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : undefined
    const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : ''
    const detail = cause instanceof Error ? cause.message : cause === undefined ? '' : String(cause)
    const reason = [code, detail].filter((part) => part !== '').join(' ')
    throw new GitHubError(
      `Could not reach api.github.com: ${error instanceof Error ? error.message : String(error)}${reason === '' ? '' : ` (${reason})`}`,
      0
    )
  }
  const remaining = response.headers.get('x-ratelimit-remaining')
  const reset = response.headers.get('x-ratelimit-reset')
  if (response.status === 401) {
    throw new GitHubError('GitHub rejected the token', 401)
  }
  if (response.status === 403 && remaining === '0') {
    const at = reset ? new Date(Number(reset) * 1000) : undefined
    throw new GitHubError('Rate limit exceeded', 403, { resetAt: at ? at.toISOString() : undefined })
  }
  return { response, remaining, reset }
}

async function isStarred(repo, token) {
  if (!token) return null
  const { response } = await github(`/user/starred/${repo}`, { token })
  if (response.status === 204) return true
  if (response.status === 404) return false
  if (response.status === 401) throw new GitHubError('GitHub rejected the token', 401)
  return null
}

async function setStar(repo, token, starred) {
  const { response } = await github(`/user/starred/${repo}`, {
    token,
    method: starred ? 'PUT' : 'DELETE',
    body: starred ? undefined : undefined,
  })
  if (response.status === 204 || response.status === 200) return true
  if (response.status === 401) throw new GitHubError('GitHub rejected the token', 401)
  if (response.status === 404) throw new GitHubError(`Repository ${repo} was not found, or the token cannot see it`, 404)
  throw new GitHubError(`GitHub answered ${response.status}`, response.status)
}

async function repoFacts(repo, token) {
  const { response } = await github(`/repos/${repo}`, { token })
  if (response.status === 404) throw new GitHubError(`Repository ${repo} was not found`, 404)
  if (!response.ok) throw new GitHubError(`GitHub answered ${response.status}`, response.status)
  const data = await response.json()
  return {
    repo,
    htmlUrl: data.html_url,
    description: data.description ?? '',
    stars: data.stargazers_count ?? 0,
    language: data.language ?? '',
    archived: data.archived === true,
  }
}

/* ---------------------------------------------------------------------------
 * HTTP plumbing
 * ------------------------------------------------------------------------- */

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(body.length),
  })
  response.end(body)
}

function readBody(request, limit = 16 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        request.destroy()
        resolve('')
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', () => resolve(''))
  })
}

/**
 * Refuse a browser request that names another origin. Requests with no Origin
 * header (curl, the agent's own calls) are not browser form posts and pass.
 */
function crossOrigin(request) {
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin === '') return false
  try {
    const host = new URL(origin).host
    return host !== request.headers.host
  } catch {
    return true
  }
}

/* ---------------------------------------------------------------------------
 * Shared operations — the one implementation both callers use
 * ------------------------------------------------------------------------- */

function createOperations(ctx, routeStatus) {
  const preferences = () => readPreferences()
  const setPreference = (key, value) => {
    const next = { ...preferences(), [key]: value }
    writeJson(prefsFile(), next)
    return next
  }

  const state = async () => {
    const { profile, root, plugins } = installedPlugins()
    const { token, source } = await resolveToken(ctx)
    const known = plugins.filter((plugin) => plugin.repo !== null)
    const statuses = new Map()

    if (token) {
      // Bounded fan-out: enough to feel instant, low enough not to look like a
      // burst to GitHub's secondary limits.
      const queue = known.slice()
      const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
        for (;;) {
          const plugin = queue.shift()
          if (plugin === undefined) return
          try {
            statuses.set(plugin.packageName, await isStarred(plugin.repo, token))
          } catch {
            statuses.set(plugin.packageName, null)
          }
        }
      })
      await Promise.all(workers)
    }

    return {
      profile,
      root,
      authenticated: token !== undefined,
      tokenSource: source,
      firstStarNotice: preferences().firstStarNoticeAcknowledged === true,
      routes: routeStatus,
      plugins: plugins.map((plugin) => ({
        ...plugin,
        starred: token ? statuses.get(plugin.packageName) ?? null : null,
      })),
    }
  }

  const star = async ({ repo, packageName, starred }) => {
    const { token } = await resolveToken(ctx)
    if (token === undefined) {
      throw new GitHubError('No GitHub token is configured', 401, { code: 'token-missing' })
    }
    let target = repo
    if (target === undefined && packageName !== undefined) {
      const found = installedPlugins().plugins.find((plugin) => plugin.packageName === packageName)
      if (found === undefined) throw new GitHubError(`No installed plugin named ${packageName}`, 404)
      if (found.repo === null) throw new GitHubError(`${packageName} declares no GitHub repository`, 404, { code: 'no-repo' })
      target = found.repo
    }
    const normalized = normalizeSlug(String(target ?? ''))
    if (normalized === undefined) throw new GitHubError(`Not an owner/repo pair: ${String(target)}`, 400)
    await setStar(normalized, token, starred)
    return { repo: normalized, starred, url: `https://github.com/${normalized}` }
  }

  const saveToken = async (value) => {
    const cleaned = String(value ?? '').trim()
    if (cleaned === '') throw new GitHubError('An empty token cannot be saved', 400)
    const credentials = ctx.get('credentials')
    if (credentials === undefined) throw new GitHubError('This profile has no credential store', 501)
    // Prove it before keeping it: a bad token that looks saved is worse than a
    // rejected one that says so.
    try {
      await github('/user', { token: cleaned })
    } catch (error) {
      if (error instanceof GitHubError && error.status === 401) {
        throw new GitHubError('GitHub rejected this token', 401)
      }
      throw error
    }
    await credentials.modifyRecord(CREDENTIAL_KEY, async () => ({ kind: 'api-key', key: cleaned }))
    ghTokenCache = { value: null, expires: 0 }
    return { saved: true }
  }

  const clearToken = async () => {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) await credentials.deleteRecord(CREDENTIAL_KEY)
    ghTokenCache = { value: null, expires: 0 }
    return { cleared: true }
  }

  return { state, star, saveToken, clearToken, setPreference, preferences }
}

/* ---------------------------------------------------------------------------
 * Plugin
 * ------------------------------------------------------------------------- */

export const inject = ['tools']

export function apply(ctx) {
  // Diagnostics the panel and the tool can report honestly: a route that failed
  // to register must not look like a network problem later on.
  const routeStatus = { registered: [], failed: [] }
  const operations = createOperations(ctx, routeStatus)

  // `ctx.get('webServer')` reads the service too early in this composition and
  // yields undefined, which silently registered no routes at all while the tool
  // half still worked. Declaring the dependency is what waits for it.
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.webServer
    if (webServer === undefined) {
      routeStatus.failed.push({ path: '*', reason: 'webServer service unavailable in this composition' })
      return
    }

    const route = (path, handler) => {
      const full = `${ROUTE_BASE}${path}`
      try {
        const dispose = webServer.register({
          kind: 'exact',
          path: full,
          handler: async (request, response) => {
            if (crossOrigin(request)) {
              sendJson(response, 403, { error: 'cross-origin request refused' })
              return
            }
            try {
              await handler(request, response)
            } catch (error) {
              const status = error instanceof GitHubError ? (error.status || 500) : 500
              sendJson(response, status === 0 ? 502 : status, {
                error: error instanceof Error ? error.message : String(error),
                detail: error instanceof GitHubError ? error.detail : undefined,
              })
            }
          },
        })
        // The fiber owns the route so unloading releases the path; the
        // registration is what can fail, so it is observed before claiming it.
        webCtx.effect(() => dispose)
        routeStatus.registered.push(full)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        routeStatus.failed.push({ path: full, reason })
        console.warn(`[dsh-allinstar] route ${full} did not register: ${reason}`)
      }
    }

    route('/state', async (request, response) => {
      if (request.method !== 'GET') return sendJson(response, 405, { error: 'GET only' })
      sendJson(response, 200, await operations.state())
    })

    route('/star', async (request, response) => {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'POST only' })
      const body = JSON.parse((await readBody(request)) || '{}')
      const result = await operations.star({
        repo: typeof body.repo === 'string' ? body.repo : undefined,
        packageName: typeof body.packageName === 'string' ? body.packageName : undefined,
        starred: body.starred !== false,
      })
      sendJson(response, 200, result)
    })

    route('/token', async (request, response) => {
      if (request.method === 'POST') {
        const body = JSON.parse((await readBody(request)) || '{}')
        sendJson(response, 200, await operations.saveToken(body.token))
        return
      }
      if (request.method === 'DELETE') {
        sendJson(response, 200, await operations.clearToken())
        return
      }
      if (request.method === 'GET') {
        const { token, source } = await resolveToken(ctx)
        sendJson(response, 200, { configured: token !== undefined, source })
        return
      }
      sendJson(response, 405, { error: 'GET, POST or DELETE' })
    })

    route('/preferences', async (request, response) => {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'POST only' })
      const body = JSON.parse((await readBody(request)) || '{}')
      if (body.firstStarNoticeAcknowledged !== undefined) {
        operations.setPreference('firstStarNoticeAcknowledged', body.firstStarNoticeAcknowledged === true)
      }
      sendJson(response, 200, { saved: true })
    })

    route('/repo', async (request, response) => {
      if (request.method !== 'GET') return sendJson(response, 405, { error: 'GET only' })
      const url = new URL(request.url ?? '/', 'http://localhost')
      const repo = normalizeSlug(url.searchParams.get('repo') ?? '')
      if (repo === undefined) return sendJson(response, 400, { error: 'repo must be owner/repo' })
      const { token } = await resolveToken(ctx)
      sendJson(response, 200, await repoFacts(repo, token))
    })
  })

  const tools = ctx.get('tools')
  if (tools !== undefined) {
    ctx.effect(() => tools.register({
      name: 'github_stars',
      description: [
        'Star or unstar the GitHub repositories behind installed DSH plugins.',
        'Without a token this reports what is installed and which repositories it declares; starring needs a GitHub token (DSH_GITHUB_TOKEN, a token saved in the plugin panel, or an authenticated gh CLI).',
        'A star is public: it appears on the user\'s GitHub profile.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'star', 'unstar'],
            description: 'list: what is installed and its GitHub repository; star/unstar: change one repository or one installed plugin.',
          },
          packageName: {
            type: 'string',
            description: 'An installed plugin by package name. Its declared repository is the target.',
          },
          repo: {
            type: 'string',
            description: 'An explicit owner/repo, for a repository that is not installed here.',
          },
          all: {
            type: 'boolean',
            description: 'With star: apply to every installed plugin that declares a GitHub repository. Ignored by unstar.',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  packageName: { type: 'string' },
                  repo: { type: 'string' },
                  starred: { type: 'boolean' },
                  url: { type: 'string' },
                  error: { type: 'string' },
                },
                additionalProperties: true,
              },
            },
          },
          additionalProperties: true,
        },
        render(_args, value) {
          const text = value && typeof value.summary === 'string' ? value.summary : 'No result.'
          return [{ type: 'text', text }]
        },
      },
      async execute(args) {
        const input = args !== null && typeof args === 'object' ? args : {}
        const action = String(input.action ?? 'list')

        if (action === 'list') {
          const current = await operations.state()
          const known = current.plugins.filter((plugin) => plugin.repo !== null)
          const missing = current.plugins.filter((plugin) => plugin.repo === null)
          const lines = [
            `${known.length} of ${current.plugins.length} installed plugins declare a GitHub repository.`,
            current.authenticated
              ? `GitHub token present (${current.tokenSource}).`
              : 'No GitHub token: starring is unavailable until one is configured.',
            ...known.map((plugin) => {
              const mark = plugin.starred === true ? 'starred' : plugin.starred === false ? 'not starred' : 'status unknown'
              return `- ${plugin.packageName} → ${plugin.repo} (${mark})`
            }),
            ...(missing.length > 0 ? ['No GitHub repository:', ...missing.map((plugin) => `- ${plugin.packageName}`)] : []),
          ]
          return {
            summary: lines.join('\n'),
            results: current.plugins.map((plugin) => ({
              packageName: plugin.packageName,
              repo: plugin.repo ?? '',
              starred: plugin.starred === true,
              url: plugin.repoUrl ?? '',
            })),
          }
        }

        const results = []
        if (input.all === true && action === 'star') {
          const current = await operations.state()
          for (const plugin of current.plugins) {
            if (plugin.repo === null) continue
            if (plugin.starred === true) {
              results.push({ packageName: plugin.packageName, repo: plugin.repo, starred: true, url: plugin.repoUrl ?? '' })
              continue
            }
            try {
              await operations.star({ repo: plugin.repo, starred: true })
              results.push({ packageName: plugin.packageName, repo: plugin.repo, starred: true, url: plugin.repoUrl ?? '' })
            } catch (error) {
              results.push({
                packageName: plugin.packageName,
                repo: plugin.repo,
                starred: false,
                url: plugin.repoUrl ?? '',
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }
        } else {
          const target = {
            repo: typeof input.repo === 'string' ? input.repo : undefined,
            packageName: typeof input.packageName === 'string' ? input.packageName : undefined,
            starred: action === 'star',
          }
          if (target.repo === undefined && target.packageName === undefined) {
            throw new Error('Provide packageName or repo.')
          }
          const result = await operations.star(target)
          results.push(result)
        }

        const ok = results.filter((entry) => entry.error === undefined)
        const failed = results.filter((entry) => entry.error !== undefined)
        const verb = action === 'star' ? 'Starred' : 'Unstarred'
        const summary = [
          `${verb} ${ok.length} ${ok.length === 1 ? 'repository' : 'repositories'}.`,
          ...ok.map((entry) => `- ${entry.repo}`),
          ...(failed.length > 0
            ? ['Failed:', ...failed.map((entry) => `- ${entry.repo || entry.packageName}: ${entry.error}`)]
            : []),
        ].join('\n')
        return { summary, results }
      },
    }))
  }
}
