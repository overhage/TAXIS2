// netlify/functions/me.mjs — Functions v2 (ESM)
// Rewrites the v1 (zisi/CommonJS) handler to v2 using the Web Fetch API.
// Tries to use existing getUserFromRequest from ./utils/auth (CommonJS),
// but stays DB-free and tiny if that module is unavailable.

import { createRequire } from 'module'
const require = createRequire(import.meta.url)

let getUserFromRequest
try {
  // If your utils are still CommonJS, this will interop without bundling ESM shims
  ;({ getUserFromRequest } = require('./utils/auth'))
} catch (_) {
  getUserFromRequest = null
}

function toEventShim(request) {
  const url = new URL(request.url)
  // Create a minimal Netlify v1-style event so existing helpers keep working
  return {
    httpMethod: request.method,
    path: url.pathname,
    headers: Object.fromEntries(request.headers.entries()),
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    body: null, // me endpoint is GET-only
    isBase64Encoded: false,
  }
}

export default async function handler(request) {
  try {
    let user = null

    if (typeof getUserFromRequest === 'function') {
      const event = toEventShim(request)
      user = await getUserFromRequest(event)
    }

    // Always return JSON; empty object if unauthenticated/unknown
    return new Response(JSON.stringify(user || {}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    const msg = err?.message || String(err)
    return new Response(JSON.stringify({ error: 'me_failed', message: msg }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}
