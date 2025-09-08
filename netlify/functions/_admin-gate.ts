// netlify/functions/_admin-gate.ts — shared admin gate (TypeScript, lean version)
// Signed-cookie only. No legacy utils/auth, no DB-session fallback.

import { readSessionFromCookie as readSignedSession } from './_auth/cookies'

// ---------- Types ----------
export type AdminGateUser = {
  email?: string | null
  name?: string | null
  sub?: string
  roles?: string[]
  role?: string | null
  isAdmin?: boolean
}

// ---------- Helpers ----------
function adminsFromEnv(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function userFromSignedCookie(request: Request): AdminGateUser | null {
  const cookieHeader = request.headers.get('cookie') || undefined
  const secret = process.env.SESSION_SECRET
  if (!secret) return null
  const sess = readSignedSession(cookieHeader, secret)
  if (!sess) return null
  return {
    email: sess.email ?? null,
    name: sess.name ?? null,
    sub: sess.sub,
    roles: Array.isArray(sess.roles) ? sess.roles : undefined,
  }
}

function isAdminUser(user: AdminGateUser | null, envAdmins: string[]): boolean {
  if (!user) return false
  const email = (user.email || '').toLowerCase()
  const byEnv = email ? envAdmins.includes(email) : false
  const byRole = Boolean(user.isAdmin || user.role === 'admin' || user.roles?.includes?.('admin'))
  return byEnv || byRole
}

// ---------- Public API ----------
export async function requireAdmin(request: Request): Promise<{
  allowed: boolean
  user: AdminGateUser | null
  forbidden: () => Response
}> {
  const envAdmins = adminsFromEnv()
  const user: AdminGateUser | null = userFromSignedCookie(request)
  const allowed = isAdminUser(user, envAdmins)
  const forbidden = () =>
    new Response(
      JSON.stringify({ error: 'forbidden', reason: 'not_admin', email: user?.email ?? null, envAdmins }),
      { status: 403, headers: { 'content-type': 'application/json' } }
    )
  return { allowed, user, forbidden }
}

export async function requireUser(request: Request): Promise<AdminGateUser | null> {
  return userFromSignedCookie(request)
}
