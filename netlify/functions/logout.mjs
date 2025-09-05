// netlify/functions/logout.mjs — Functions v2 (ESM)
// Rewrites the v1 (zisi) handler to v2 using the Web Fetch API.
// Parses the session cookie, optionally destroys the server-side session,
// then clears the cookie and redirects to /login.

import { createRequire } from 'module'
const require = createRequire(import.meta.url)

let destroySession
try {
  ;({ destroySession } = require('./utils/auth'))
} catch (e) {
  // If utils/auth is not available or you want this function to be tiny and DB-free,
  // we fallback to a no-op; cookie will still be cleared below.
  destroySession = async () => {}
}

function parseSessionCookie(cookieHeader) {
  const cookies = (cookieHeader || '').split(/;\s*/)
  for (const c of cookies) {
    const [name, rawVal] = c.split('=')
    if (name === 'session') {
      const [token] = decodeURIComponent(rawVal || '').split(':')
      return token || null
    }
  }
  return null
}

export default async function handler(request) {
  try {
    const token = parseSessionCookie(request.headers.get('cookie'))

    if (token && destroySession) {
      try { await destroySession(token) } catch { /* ignore revoke errors */ }
    }

    const clear = [
      'session=',
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Secure',
      'Max-Age=0',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ].join('; ')

    return new Response(null, {
      status: 302,
      headers: {
        'Set-Cookie': clear,
        'Location': '/login',
      },
    })
  } catch (err) {
    const msg = err?.message || String(err)
    return new Response(`Logout error: ${msg}` , {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    })
  }
}
