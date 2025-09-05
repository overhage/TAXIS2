// netlify/functions/login.mjs — Functions v2 (ESM)
// Minimal entry that defers the OAuth flow to /api/auth (handled by auth.mjs)
// This keeps the bundle tiny and avoids importing any heavy dependencies.

export default async function handler(request) {
  const url = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') || url.host || ''
  const proto = request.headers.get('x-forwarded-proto') || (url.protocol?.replace(':', '') || 'https')
  const base = `${proto}://${host}`

  // Our netlify.toml maps /api/* -> /.netlify/functions/:splat
  const authEntry = `${base}/api/auth`
  return Response.redirect(authEntry, 302)
}
