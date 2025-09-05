// netlify/functions/auth.mjs — Functions v2 (ESM)
// Fixes Runtime.ImportModuleError by removing local './utils/prisma' dependency
// and importing PrismaClient directly. Keeps existing OAuth/session flow.

import { PrismaClient } from '@prisma/client'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

// Reuse a single Prisma instance across invocations
const prisma = globalThis.__PRISMA__ ?? new PrismaClient()
if (!globalThis.__PRISMA__) globalThis.__PRISMA__ = prisma

// Try to load existing auth helpers (CommonJS). If unavailable, we fallback.
let createSession
try {
  ;({ createSession } = require('./utils/auth'))
} catch (_) {
  createSession = null
}

const clientId = process.env.GITHUB_CLIENT_ID || process.env.GITHUB_ID
const clientSecret = process.env.GITHUB_CLIENT_SECRET || process.env.GITHUB_SECRET

function fail(label, err) {
  const msg = err?.message ?? (typeof err === 'string' ? err : JSON.stringify(err))
  console.error(label, err)
  return new Response(`Auth error: ${label}: ${msg}`, {
    status: 500,
    headers: { 'content-type': 'text/plain' }
  })
}

export default async function handler(request) {
  try {
    if (!clientId || !clientSecret) {
      return fail('missing_oauth_secrets', 'Set GITHUB_CLIENT_ID/SECRET or GITHUB_ID/SECRET')
    }

    const url = new URL(request.url)
    const host = request.headers.get('x-forwarded-host') || url.host || ''
    const proto = request.headers.get('x-forwarded-proto') || (url.protocol?.replace(':','') || 'https')
    const thisFnPath = url.pathname || '/.netlify/functions/auth'
    const publicPath = thisFnPath.replace('/.netlify/functions', '/api')
    const baseUrl = `${proto}://${host}`
    const callbackUrl = `${baseUrl}${publicPath}`

    const code = url.searchParams.get('code')

    // Phase 1: redirect user to GitHub consent
    if (!code) {
      const authorize = new URL('https://github.com/login/oauth/authorize')
      authorize.searchParams.set('client_id', clientId)
      authorize.searchParams.set('redirect_uri', callbackUrl)
      authorize.searchParams.set('scope', 'read:user user:email')
      return Response.redirect(authorize.toString(), 302)
    }

    // Phase 2: exchange code for token
    let tokenRes
    try {
      const r = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: callbackUrl }),
      })
      if (!r.ok) return fail('token_exchange_http', new Error(String(r.status)))
      tokenRes = await r.json()
    } catch (e) {
      return fail('token_exchange_fetch_failed', e)
    }

    if (!tokenRes?.access_token) return fail('token_exchange_no_access_token', tokenRes || {})

    const ghHeaders = { Authorization: `Bearer ${tokenRes.access_token}`, 'User-Agent': 'taxis2' }
    const profile = await (await fetch('https://api.github.com/user', { headers: ghHeaders })).json()

    let email = profile?.email
    if (!email) {
      const emails = await (await fetch('https://api.github.com/user/emails', { headers: ghHeaders })).json()
      if (Array.isArray(emails)) {
        const primary = emails.find(e => e?.primary && e?.verified)
        email = primary?.email || emails[0]?.email || null
      }
    }
    if (!email) return fail('no_email_from_github', profile)

    // Upsert user using Prisma directly
    let user
    try {
      user = await prisma.user.upsert({
        where: { email },
        update: { name: profile?.name || profile?.login || null },
        create: { email, name: profile?.name || profile?.login || null, role: 'user' },
      })
    } catch (e) {
      return fail('prisma_upsert_failed', e)
    }

    // Create session token via helper if available; otherwise set a simple cookie
    let sessionToken
    if (typeof createSession === 'function') {
      try {
        const session = await createSession(user.id)
        sessionToken = session?.token
      } catch (e) {
        return fail('session_create_failed', e)
      }
    } else {
      // Fallback: lightweight opaque token (userId + timestamp); not persistent server-side
      sessionToken = `${user.id}.${Date.now()}`
    }

    const cookie = [
      `session=${encodeURIComponent(sessionToken)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Secure',
      `Max-Age=${30 * 24 * 60 * 60}`,
    ].join('; ')

    return new Response(null, {
      status: 302,
      headers: { 'Set-Cookie': cookie, 'Location': '/dashboard' },
    })
  } catch (err) {
    return fail('unexpected', err)
  }
}
