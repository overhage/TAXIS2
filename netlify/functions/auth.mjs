// netlify/functions/auth.mjs — Functions v2 (ESM)
// Converts the previous v1 (zisi) handler to v2 (nft/Node 22) style.
// Keeps existing logic, but uses the Web Fetch API Response/Request interface.
// NOTE: If your utils are CommonJS, we interop via createRequire so you don't
// have to rewrite them right now.

import { createRequire } from 'module'
const require = createRequire(import.meta.url)

// If utils/prisma and utils/auth are CommonJS modules, this will work.
// If you later convert them to ESM, change these to `import ... from ...`.
const prisma = require('./utils/prisma')
const { createSession } = require('./utils/auth')

// Accept either var name from env
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

export default async function handler(request, context) {
  try {
    if (!clientId || !clientSecret) {
      return fail('missing_oauth_secrets', 'Set GITHUB_CLIENT_ID/SECRET or GITHUB_ID/SECRET')
    }

    const url = new URL(request.url)

    // Derive canonical callback URL
    const host = request.headers.get('x-forwarded-host') || url.host || ''
    const proto = request.headers.get('x-forwarded-proto') || (url.protocol?.replace(':','') || 'https')
    const thisFnPath = url.pathname || '/.netlify/functions/auth'
    // If you have a redirect from /api/* -> functions, present a friendly public path
    const publicPath = thisFnPath.replace('/.netlify/functions', '/api')
    const baseUrl = `${proto}://${host}`
    const callbackUrl = `${baseUrl}${publicPath}`

    const code = url.searchParams.get('code')

    // Phase 1: send user to GitHub
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
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: callbackUrl,
        }),
      })
      if (!r.ok) return fail('token_exchange_http', new Error(String(r.status)))
      tokenRes = await r.json()
    } catch (e) {
      return fail('token_exchange_fetch_failed', e)
    }

    if (!tokenRes || !tokenRes.access_token) {
      return fail('token_exchange_no_access_token', tokenRes || {})
    }

    const ghHeaders = {
      Authorization: `Bearer ${tokenRes.access_token}`,
      'User-Agent': 'taxis2',
    }

    const profile = await (await fetch('https://api.github.com/user', { headers: ghHeaders })).json()

    // Determine email (some profiles hide it; fetch /user/emails)
    let email = profile && profile.email
    if (!email) {
      const emails = await (await fetch('https://api.github.com/user/emails', { headers: ghHeaders })).json()
      if (Array.isArray(emails)) {
        const primary = emails.find(e => e && e.primary && e.verified)
        email = (primary && primary.email) || (emails[0] && emails[0].email) || null
      }
    }
    if (!email) return fail('no_email_from_github', profile)

    // Upsert user in DB (requires Prisma engines; ensure auth is configured in netlify.toml
    // with external_node_modules ["@prisma/client", "prisma"] and included_files
    // ["node_modules/.prisma/client/**"]) if you keep this block.
    let user
    try {
      user = await prisma.user.upsert({
        where: { email },
        update: { name: (profile && (profile.name || profile.login)) || null },
        create: { email, name: (profile && (profile.name || profile.login)) || null, role: 'user' },
      })
    } catch (e) {
      return fail('prisma_upsert_failed', e)
    }

    // Create session + cookie
    let session
    try {
      session = await createSession(user.id)
    } catch (e) {
      return fail('session_create_failed', e)
    }

    const cookie = [
      `session=${encodeURIComponent(session.token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Secure',
      `Max-Age=${30 * 24 * 60 * 60}`,
    ].join('; ')

    return new Response(null, {
      status: 302,
      headers: {
        'Set-Cookie': cookie,
        'Location': '/dashboard',
      },
    })
  } catch (err) {
    return fail('unexpected', err)
  }
}
