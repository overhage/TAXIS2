// netlify/functions/session.ts — returns 200 with user if signed cookie is valid, else 401
import type { Handler } from '@netlify/functions'
import { readSessionFromCookie } from './_auth/cookies'

export const handler: Handler = async (event) => {
  const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET
  if (!secret) return { statusCode: 500, body: 'Missing SESSION_SECRET' }

  const cookie = event.headers.cookie || ''
  const sess = readSessionFromCookie(cookie, secret)
  if (!sess) return { statusCode: 401, body: 'Unauthorized' }

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify({
      user: { sub: sess.sub, email: sess.email, name: sess.name, provider: (sess as any).provider, roles: (sess as any).roles || [] }
    })
  }
}

export default handler
