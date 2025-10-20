// netlify/functions/auth-callback.ts — patched to ensure cookie is set correctly
// - Added minimal Prisma upsert to create/update User record using sub as id
// - Uses multiValueHeaders.Set-Cookie for multiple cookies (AWS/Netlify requirement)
// - Robust https detection
// - Fallback to AUTH_SECRET if SESSION_SECRET is unset
// - Provider determined from `state` (no ?provider=)

import type { Handler } from '@netlify/functions'
import { readStateFromCookie } from './_auth/oauth'
import { createSessionCookie } from './_auth/cookies'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function exchangeGoogle(code: string) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: 'authorization_code',
      code
    })
  }).then(r => r.json())
  if (!tokenRes?.access_token) throw new Error('google token exchange failed')
  const userInfo = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenRes.access_token}` }
  }).then(r => r.json())
  return { id: userInfo.sub, email: userInfo.email, name: userInfo.name }
}

async function exchangeGitHub(code: string) {
  const token = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID!,
      client_secret: process.env.GITHUB_CLIENT_SECRET!,
      redirect_uri: process.env.GITHUB_REDIRECT_URI!,
      code
    })
  }).then(r => r.json())
  if (!token?.access_token) throw new Error('github token exchange failed')
  const profile = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token.access_token}`, 'User-Agent': 'taxis-app' }
  }).then(r => r.json())
  let email = profile.email
  if (!email) {
    const emails = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${token.access_token}`, 'User-Agent': 'taxis-app' }
    }).then(r => r.json())
    email = (emails.find((e: any) => e.primary && e.verified)?.email) || emails[0]?.email
  }
  return { id: String(profile.id), email, name: profile.name || profile.login }
}

export const handler: Handler = async (event) => {
  const qs = event.queryStringParameters || {}
  const code = qs.code
  const stateParam = qs.state // format: "provider:random"
  const cookieState = readStateFromCookie(event.headers.cookie)
  if (!code || !stateParam || !cookieState) {
    return { statusCode: 400, body: 'Missing code/state' }
  }

  const [provider, state] = String(stateParam).split(':')
  if (!['google', 'github'].includes(provider) || state !== cookieState) {
    return { statusCode: 400, body: 'Invalid state' }
  }

  try {
    const xfproto = (event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'] || '').toString().toLowerCase()
    const secure = xfproto === 'https'

    const user = provider === 'google' ? await exchangeGoogle(code) : await exchangeGitHub(code)

    const session = {
      sub: `${provider}:${user.id}`,
      email: user.email,
      name: user.name,
      provider: provider as 'google' | 'github',
      roles: [] as string[]
    }

    const admins = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)

    if (user.email && admins.includes(user.email.toLowerCase())) {
      session.roles.push('admin')
    }

    // --- Minimal addition: ensure User record exists in Prisma ---
    await prisma.user.upsert({
      where: { id: session.sub },
      update: { email: user.email, name: user.name, provider },
      create: { id: session.sub, email: user.email, name: user.name, provider }
    })

    const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET
    if (!secret) {
      console.error('[auth-callback] Missing SESSION_SECRET/AUTH_SECRET')
      return { statusCode: 500, body: 'Server misconfigured: missing SESSION_SECRET' }
    }

    const { cookie } = createSessionCookie(session, secret, secure)
    const clearState = 'oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secure ? '; Secure' : '')

    return {
      statusCode: 302,
      headers: {
        Location: '/dashboard',
        'Cache-Control': 'no-store'
      },
      multiValueHeaders: {
        'Set-Cookie': [cookie, clearState]
      }
    } as any
  } catch (e: any) {
    console.error('[auth-callback] error', e)
    return { statusCode: 500, body: `Auth failed: ${e?.message || e}` }
  }
}

export default handler
