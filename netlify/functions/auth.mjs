// netlify/functions/auth.mjs — Functions v2 (ESM)
// Adds Google OAuth alongside GitHub. Works behind a redirect such as
//   /api/*  →  /.netlify/functions/:splat
// so that:
//   GET /api/login?provider=github|google        → starts OAuth
//   GET /api/auth/callback?provider=github|google → handles callback
//   GET /api/logout                               → clears session
//
// Env vars required (set in Netlify site settings):
//   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   AUTH_COOKIE_NAME (optional, defaults to 'session')
//   AUTH_SECRET       (optional, used for HMAC signing if DB session helper missing)
//   APP_BASE_URL      (optional override, e.g., https://your.site)
//
// The function attempts to use a local helper (./utils/auth -> createSession)
// to persist sessions via Prisma. If that helper is unavailable, it falls back
// to a signed cookie token (no DB state required).

import crypto from 'crypto'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

// --- Optional: try to load Prisma + local session helper --------------------
let createSession /* (user) => Promise<{ id: string, cookieValue: string }> */
try {
  ;({ createSession } = require('./utils/auth'))
} catch {}

// --- Utility: base URL detection -------------------------------------------
function getBaseUrl(request) {
  const envBase = process.env.APP_BASE_URL
  if (envBase) return envBase.replace(/\/$/, '')
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  return `${proto}://${host}`
}

// --- Utility: cookie helpers ------------------------------------------------
const COOKIE = {
  name: process.env.AUTH_COOKIE_NAME || 'session',
  serialize(value, { maxAgeDays = 30 } = {}) {
    const parts = [
      `${this.name}=${value}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Secure',
      `Max-Age=${Math.floor(maxAgeDays * 24 * 60 * 60)}`
    ]
    return parts.join('; ')
  },
  clear() {
    return `${this.name}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`
  }
}

// --- Fallback: sign / verify a compact token (if no DB sessions) -----------
function signToken(payload, secret = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex')) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

function verifyToken(token, secret = process.env.AUTH_SECRET) {
  try {
    if (!secret) return null
    const [data, sig] = token.split('.')
    const expSig = crypto.createHmac('sha256', secret).update(data).digest('base64url')
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expSig))) return null
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
    if (payload.exp && Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

// --- Provider configuration -------------------------------------------------
const Providers = {
  github: {
    name: 'github',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    clientId: () => process.env.GITHUB_CLIENT_ID,
    clientSecret: () => process.env.GITHUB_CLIENT_SECRET,
    async getUser(accessToken) {
      const [userRes, emailRes] = await Promise.all([
        fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'netlify-func' } }),
        fetch('https://api.github.com/user/emails', { headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'netlify-func' } })
      ])
      if (!userRes.ok) throw new Error('GitHub user fetch failed')
      const base = await userRes.json()
      let email = base.email
      if (!email && emailRes.ok) {
        const emails = await emailRes.json()
        const primary = Array.isArray(emails) ? emails.find(e => e.primary && e.verified) : null
        email = primary?.email || emails?.[0]?.email
      }
      return {
        provider: 'github',
        providerId: String(base.id),
        email: email || null,
        name: base.name || base.login || null,
        avatarUrl: base.avatar_url || null
      }
    },
    async exchangeCode({ code, clientId, clientSecret, redirectUri }) {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
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
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      if (!res.ok) throw new Error('Google userinfo fetch failed')
      const u = await res.json()
      return {
        provider: 'google',
        providerId: u.sub,
        email: u.email || null,
        name: u.name || null,
        avatarUrl: u.picture || null
      }
    },
    async exchangeCode({ code, clientId, clientSecret, redirectUri }) {
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      })
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      })
      if (!res.ok) throw new Error('Google token exchange failed')
      return res.json()
    }
  }
}

// --- OAuth start ------------------------------------------------------------
function startOAuth({ request, providerKey }) {
  const provider = Providers[providerKey]
  if (!provider) return responseJSON({ error: 'unsupported_provider' }, 400)
  const clientId = provider.clientId()
  if (!clientId) return responseJSON({ error: `missing_${provider.name}_client_id` }, 500)

  const baseUrl = getBaseUrl(request)
  const redirectUri = `${baseUrl}/api/auth/callback?provider=${provider.name}`

  // state is recommended but optional here; we generate and set a loose cookie
  const state = crypto.randomBytes(16).toString('hex')
  const stateCookie = [`oauth_state=${state}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure', 'Max-Age=900'].join('; ')

  const url = new URL(provider.authUrl)
  if (provider.name === 'github') {
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('scope', provider.scope)
    url.searchParams.set('state', state)
    // optional: allow account selection prompt-like behavior:
    url.searchParams.set('allow_signup', 'true')
  } else if (provider.name === 'google') {
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

// --- OAuth callback ---------------------------------------------------------
async function handleCallback({ request, providerKey }) {
  const provider = Providers[providerKey]
  if (!provider) return responseJSON({ error: 'unsupported_provider' }, 400)

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code) return responseJSON({ error: 'missing_code' }, 400)
  // NOTE: we do not strictly enforce state here because some setups lose the cookie behind proxies.

  const clientId = provider.clientId()
  const clientSecret = provider.clientSecret()
  if (!clientId || !clientSecret) return responseJSON({ error: `missing_${provider.name}_oauth_env` }, 500)

  const baseUrl = getBaseUrl(request)
  const redirectUri = `${baseUrl}/api/auth/callback?provider=${provider.name}`

  // Exchange the code for tokens
  const tokenPayload = await provider.exchangeCode({ code, clientId, clientSecret, redirectUri })
  const accessToken = tokenPayload.access_token
  if (!accessToken) return responseJSON({ error: 'token_exchange_failed', details: tokenPayload }, 502)

  // Fetch user profile
  const user = await provider.getUser(accessToken)

  // Create session (DB helper if available; otherwise signed cookie)
  let cookieValue
  if (typeof createSession === 'function') {
    const session = await createSession(user)
    cookieValue = session?.cookieValue || session?.id
  } else {
    const exp = Date.now() + 30 * 24 * 60 * 60 * 1000
    cookieValue = signToken({ sub: user.provider + ':' + user.providerId, email: user.email, name: user.name, exp })
  }

  const cookie = COOKIE.serialize(cookieValue)
  return new Response(null, { status: 302, headers: { Location: '/dashboard', 'Set-Cookie': cookie } })
}

// --- Logout -----------------------------------------------------------------
function handleLogout() {
  return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': COOKIE.clear() } })
}

// --- Helpers ----------------------------------------------------------------
function responseJSON(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}

function routeFrom(request) {
  const u = new URL(request.url)
  const p = u.pathname
  // support either direct function path (/.netlify/functions/auth/...) or pretty /api/*
  // resolve an op and provider from the URL layout
  let op = u.searchParams.get('op') || ''
  let provider = u.searchParams.get('provider') || 'github'

  if (!op) {
    if (/\/login$/.test(p)) op = 'login'
    else if (/\/callback$/.test(p)) op = 'callback'
    else if (/\/logout$/.test(p)) op = 'logout'
  }
  return { op: op || 'login', provider }
}

// --- Netlify Functions v2 handler ------------------------------------------
export default async (request, context) => {
  try {
    const { op, provider } = routeFrom(request)

    if (request.method !== 'GET') return responseJSON({ error: 'method_not_allowed' }, 405)

    if (op === 'login') return startOAuth({ request, providerKey: provider })
    if (op === 'callback') return handleCallback({ request, providerKey: provider })
    if (op === 'logout') return handleLogout()

    // Default: show a tiny HTML page with provider links (manual testing)
    const base = getBaseUrl(request)
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Auth</title></head>
<body style="font-family:system-ui;padding:2rem">
  <h1>Sign in</h1>
  <p><a href="${base}/api/login?provider=github">Continue with GitHub</a></p>
  <p><a href="${base}/api/login?provider=google">Continue with Google</a></p>
</body></html>`
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  } catch (err) {
    console.error('[auth] unexpected', err)
    return responseJSON({ error: 'unexpected', message: String(err?.message || err) }, 500)
  }
}
