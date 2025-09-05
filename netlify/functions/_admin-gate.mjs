// netlify/functions/_admin-gate.mjs — shared admin gate
// Robust across ESM/CJS bundling. No createRequire/import.meta.url.
// Uses dynamic import() to try loading legacy ./utils/auth.* if present.

import { PrismaClient } from '@prisma/client'

// Prisma singleton across invocations
const prisma = globalThis.__PRISMA__ ?? new PrismaClient()
if (!globalThis.__PRISMA__) globalThis.__PRISMA__ = prisma

function readSessionCookie(request) {
  const cookieHeader = request.headers.get('cookie') || ''
  for (const part of cookieHeader.split(';')) {
    const seg = part.trim()
    const i = seg.indexOf('=')
    if (i === -1) continue
    if (seg.slice(0, i) === 'session') return decodeURIComponent(seg.slice(i + 1))
  }
  return null
}

function adminsFromEnv() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

async function tryGetUserFromRequestHelper() {
  const candidates = ['./utils/auth.js', './utils/auth.mjs', './utils/auth.cjs', './utils/auth']
  for (const p of candidates) {
    try {
      const mod = await import(p)
      const fn = mod?.getUserFromRequest || mod?.default?.getUserFromRequest
      if (typeof fn === 'function') return fn
    } catch (_) {
      // continue to next candidate
    }
  }
  return null
}

async function userFromLegacy(request) {
  const getUserFromRequest = await tryGetUserFromRequestHelper()
  if (!getUserFromRequest) return null
  try {
    const url = new URL(request.url)
    const event = {
      headers: Object.fromEntries(request.headers.entries()),
      httpMethod: request.method,
      path: url.pathname,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    }
    return await getUserFromRequest(event)
  } catch {
    return null
  }
}

async function userFromCookie(request) {
  const token = readSessionCookie(request)
  if (!token) return null
  const dot = token.indexOf('.')
  const userId = dot === -1 ? token : token.slice(0, dot)
  if (!userId) return null
  try {
    return await prisma.user.findUnique({ where: { id: userId } })
  } catch {
    return null
  }
}

function isAdminUser(user, envAdmins) {
  if (!user) return false
  const email = (user.email || '').toLowerCase()
  return Boolean(user.isAdmin || user.role === 'admin' || envAdmins.includes(email))
}

export async function requireAdmin(request) {
  const envAdmins = adminsFromEnv()
  let user = await userFromLegacy(request)
  if (!user) user = await userFromCookie(request)
  const allowed = isAdminUser(user, envAdmins)
  const forbidden = () => new Response(
    JSON.stringify({ error: 'forbidden', reason: 'not_admin', email: user?.email ?? null, envAdmins }),
    { status: 403, headers: { 'content-type': 'application/json' } }
  )
  return { allowed, user, forbidden }
}

export async function requireUser(request) {
  let user = await userFromLegacy(request)
  if (!user) user = await userFromCookie(request)
  if (user) return user
  return null
}
