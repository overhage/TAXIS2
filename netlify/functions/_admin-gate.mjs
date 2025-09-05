import { PrismaClient } from '@prisma/client'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)


// Prisma singleton (safe for functions v2)
const prisma = globalThis.__PRISMA__ ?? new PrismaClient()
if (!globalThis.__PRISMA__) globalThis.__PRISMA__ = prisma


// Try to use existing auth util if available (optional)
let getUserFromRequest
try { ({ getUserFromRequest } = require('./utils/auth')) } catch { getUserFromRequest = null }


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


async function userFromLegacy(request) {
if (typeof getUserFromRequest !== 'function') return null
try {
// Minimal v1‑style event shim to satisfy existing helper
const url = new URL(request.url)
const event = {
headers: Object.fromEntries(request.headers.entries()),
httpMethod: request.method,
path: url.pathname,
queryStringParameters: Object.fromEntries(url.searchParams.entries()),
}
return await getUserFromRequest(event)
} catch { return null }
}


async function userFromCookie(request) {
const token = readSessionCookie(request)
if (!token) return null
const dot = token.indexOf('.')
const userId = dot === -1 ? token : token.slice(0, dot)
if (!userId) return null
try { return await prisma.user.findUnique({ where: { id: userId } }) } catch { return null }
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
}