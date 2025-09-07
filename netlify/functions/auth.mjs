// netlify/functions/auth.mjs — Functions v2 (ESM)
// Google + GitHub OAuth with DEV‑SAFE cookies and a /api/session endpoint.
//
// Endpoints (assuming a redirect like /api/* → /.netlify/functions/:splat):
//   GET /api/login?provider=github|google           → start OAuth
//   GET /api/auth/callback?provider=github|google   → finish OAuth, set cookie, redirect /dashboard
//   GET /api/logout                                 → clear cookie, redirect /
//   GET /api/session                                → returns { authenticated, user }
//
// Required env vars (Netlify Site Settings → Environment variables):
//   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
// Optional env vars:
//   AUTH_COOKIE_NAME (default: 'session')
//   AUTH_SECRET       (used for HMAC token signing when no DB session helper)
//   APP_BASE_URL      (override base URL if needed)
//
// Optional DB session helpers (co‑located util):
//   ./utils/auth exports: createSession(user) and getSession(id)
//     - createSession(user) → { id, cookieValue? }
//     - getSession(id) → { user } | null

import crypto from 'crypto'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

let createSession, getSession // optional helpers
try { ({ createSession, getSession } = require('./utils/auth')) } catch {}

// ---------- utilities -------------------------------------------------------
function getBaseUrl(request) {
  const envBase = process.env.APP_BASE_URL
  if (envBase) return envBase.replace(/\/$/, '')
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  return `${proto}://${host}`
}

function isSecureRequest(request) {
  const xfp = (request.headers.get('x-forwarded-proto') || '').toLowerCase()
  if (xfp) return xfp === 'https'
  try { return new URL(request.url).protocol === 'https:' } catch { return true }
}

const COOKIE = {
  name: process.env.AUTH_COOKIE_NAME || 'session',
  serialize(value, { maxAgeDays = 30, secure = true } = {}) {
    const parts = [
      `${this.name}=${value}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${Math.floor(maxAgeDays * 24 * 60 * 60)}`
    ]
    if (secure) parts.push('Secure')
    return parts.join('; ')
  },
  clear({ secure = true } = {}) {
    const parts = [ `${this.name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` ]
    if (secure) parts.push('Secure')
    return parts.join('; ')
  }
}

function parseCookies(request) {
  const raw = request.headers.get('cookie') || ''
  const out = {}
  raw.split(';').forEach(kv => {
    const i = kv.indexOf('=')
    if (i > -1) out[kv.slice(0, i).trim()] = decodeURIComponent(kv.slice(i + 1).trim())
  })
  return out
}

function signToken(payload, secret = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex')) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

function verifyToken(token, secret = process.env.AUTH_SECRET) {
  try {
    if (!secret) return null
    const [data, sig] = token.split('.')
    if (!data || !sig) return null
    const expSig = crypto.createHmac('sha256', secret).update(data).digest('base64url')
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expSig))) return null
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
    if (payload.exp && Date.now() > payload.exp) return null
    return payload
  } catch { return null }
}

// ---------- providers -------------------------------------------------------
const Providers = {
  github: {
    name: 'github',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    clientId: () => process.env.GITHUB_CLIENT_ID,
    clientSecret: () => process.env.GITHUB_CLIENT_SECRET,
    async getUser(accessToken) {
      const [uRes, eRes] = await Promise.all([
        fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'netlify-func' } }),
        fetch('https://api.github.com/user/emails', { headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'netlify-func' } })
      ])
      if (!uRes.ok) throw new Error('GitHub user fetch failed')
      const base = await uRes.json()
      let email = base.email
      if (!email && eRes.ok) {
        const emails = await eRes.json()
        const primary = Array.isArray(emails) ? emails.find(e => e.primary && e.verified) : null
        email = primary?.email || emails?.[0]?.email
      }
      return { provider: 'github', providerId: String(base.id), email: email || null, name: base.name || base.login || null, avatarUrl: base.avatar_url || null }
    },
    async exchangeCode({ code, clientId, clientSecret, redirectUri }) {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri })
      })
      if (!res.ok) throw new Error('GitHub token exchange failed')
      return res.json()
    }
  },
  google: {
    name: 'google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    async getUser(accessToken) {
      const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!r.ok) throw new Error('Google userinfo fetch failed')
      const u = await r.json()
      return { provider: 'google', providerId: u.sub, email: u.email || null, name: u.name || null, avatarUrl: u.picture || null }
    },
    async exchangeCode({ code, clientId, clientSecret, redirectUri }) {
      const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri })
      const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() })
      if (!res.ok) throw new Error('Google token exchange failed')
      return res.json()
    }
  }
}

// ---------- routes ----------------------------------------------------------
function routeFrom(request) {
  const u = new URL(request.url)
  const p = u.pathname
  let op = u.searchParams.get('op') || ''
  let provider = u.searchParams.get('provider') || 'github'
  if (!op) {
    if (/\/login$/.test(p)) op = 'login'
    else if (/\/callback$/.test(p)) op = 'callback'
    else if (/\/logout$/.test(p)) op = 'logout'
    else if (/\/session$/.test(p)) op = 'session'
  }
  return { op: op || 'login', provider }
}

function responseJSON(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}

// ---------- handlers --------------------------------------------------------
function startOAuth({ request, providerKey }) {
  const provider = Providers[providerKey]
  if (!provider) return responseJSON({ error: 'unsupported_provider' }, 400)
  const clientId = provider.clientId()
  if (!clientId) return responseJSON({ error: `missing_${provider.name}_client_id` }, 500)

  const baseUrl = getBaseUrl(request)
  const redirectUri = `${baseUrl}/api/auth/callback?provider=${provider.name}`

  const state = crypto.randomBytes(16).toString('hex')
  const stateCookie = [
    `oauth_state=${state}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax', isSecureRequest(request) ? 'Secure' : '', 'Max-Age=900'
  ].filter(Boolean).join('; ')

  const url = new URL(provider.authUrl)
  if (provider.name === 'github') {
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('scope', provider.scope)
    url.searchParams.set('state', state)
    url.searchParams.set('allow_signup', 'true')
  } else {
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', provider.scope)
    url.searchParams.set('include_granted_scopes', 'true')
    url.searchParams.set('access_type', 'online')
    url.searchParams.set('prompt', 'select_account')
    url.searchParams.set('state', state)
  }

  return new Response(null, { status: 302, headers: { Location: url.toString(), 'Set-Cookie': stateCookie } })
}

async function handleCallback({ request, providerKey }) {
  const provider = Providers[providerKey]
  if (!provider) return responseJSON({ error: 'unsupported_provider' }, 400)
  const u = new URL(request.url)
  const code = u.searchParams.get('code')
  if (!code) return responseJSON({ error: 'missing_code' }, 400)

  const clientId = provider.clientId()
  const clientSecret = provider.clientSecret()
  if (!clientId || !clientSecret) return responseJSON({ error: `missing_${provider.name}_oauth_env` }, 500)

  const baseUrl = getBaseUrl(request)
  const redirectUri = `${baseUrl}/api/auth/callback?provider=${provider.name}`

  const tokenPayload = await provider.exchangeCode({ code, clientId, clientSecret, redirectUri })
  const accessToken = tokenPayload.access_token
  if (!accessToken) return responseJSON({ error: 'token_exchange_failed', details: tokenPayload }, 502)

  const user = await provider.getUser(accessToken)

  let cookieValue
  if (typeof createSession === 'function') {
    const session = await createSession(user)
    cookieValue = session?.cookieValue || session?.id
  } else {
    const exp = Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
    cookieValue = signToken({ sub: `${user.provider}:${user.providerId}`, email: user.email, name: user.name, exp })
  }

  const cookie = COOKIE.serialize(cookieValue, { secure: isSecureRequest(request) })
  return new Response(null, { status: 302, headers: { Location: '/dashboard', 'Set-Cookie': cookie } })
}

function handleLogout(request) {
  const clear = COOKIE.clear({ secure: isSecureRequest(request) })
  return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': clear } })
}

async function handleSession(request) {
  const cookies = parseCookies(request)
  const raw = cookies[COOKIE.name]
  if (!raw) return responseJSON({ authenticated: false }, 200)

  // DB session path
  if (typeof getSession === 'function' && !raw.includes('.')) {
    try {
      const sess = await getSession(raw)
      if (sess && sess.user) return responseJSON({ authenticated: true, user: sess.user }, 200)
    } catch {}
    return responseJSON({ authenticated: false }, 200)
  }

  // Signed token path
  const payload = verifyToken(raw)
  if (payload) {
    const { email, name, sub } = payload
    return responseJSON({ authenticated: true, user: { email, name, sub } }, 200)
  }
  return responseJSON({ authenticated: false }, 200)
}

// ---------- function export -------------------------------------------------
export default async (request, context) => {
  try {
    const { op, provider } = routeFrom(request)
    if (request.method !== 'GET') return responseJSON({ error: 'method_not_allowed' }, 405)

    if (op === 'login') return startOAuth({ request, providerKey: provider })
    if (op === 'callback') return handleCallback({ request, providerKey: provider })
    if (op === 'logout') return handleLogout(request)
    if (op === 'session') return handleSession(request)

    const base = getBaseUrl(request)
    const redirectUri = provider.name === 'github'
      ? `${baseUrl}/api/auth/callback`
      : `${baseUrl}/api/auth/callback?provider=${provider.name}`
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Auth</title></head>
<body style="font-family:system-ui;padding:2rem">
  <h1>Sign in</h1>
  <p><a href="${base}/api/login?provider=google">Continue with Google</a></p>
  <p><a href="${base}/api/login?provider=github">Continue with GitHub</a></p>
  <p style="margin-top:2rem"><a href="${base}/api/session">Check session (JSON)</a></p>
</body></html>`
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  } catch (err) {
    console.error('[auth] unexpected', err)
    return responseJSON({ error: 'unexpected', message: String(err?.message || err) }, 500)
  }
}
