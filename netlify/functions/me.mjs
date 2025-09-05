// netlify/functions/me.mjs — Functions v2 (ESM)
// Updated: authenticate via either utils/auth OR fallback cookie token.
// Fallback parses the `session` cookie, extracts userId from token of the form
// user.id + "." + Date.now(), and looks up the user via Prisma.


import { PrismaClient } from '@prisma/client'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)


// Prisma singleton across invocations
const prisma = globalThis.__PRISMA__ ?? new PrismaClient()
if (!globalThis.__PRISMA__) globalThis.__PRISMA__ = prisma


let getUserFromRequest
try {
;({ getUserFromRequest } = require('./utils/auth'))
} catch (_) {
getUserFromRequest = null
}


function toEventShim(request) {
const url = new URL(request.url)
return {
httpMethod: request.method,
path: url.pathname,
headers: Object.fromEntries(request.headers.entries()),
queryStringParameters: Object.fromEntries(url.searchParams.entries()),
body: null,
isBase64Encoded: false,
}
}


function readSessionCookie(request) {
const cookieHeader = request.headers.get('cookie') || ''
for (const part of cookieHeader.split(';')) {
const seg = part.trim()
const eq = seg.indexOf('=')
if (eq === -1) continue
const k = seg.slice(0, eq)
const v = seg.slice(eq + 1)
if (k === 'session') return decodeURIComponent(v || '')
}
return null
}


async function userFromFallbackCookie(request) {
const token = readSessionCookie(request)
if (!token) return null
const idx = token.indexOf('.')
const userId = idx === -1 ? token : token.slice(0, idx)
if (!userId) return null
try {
const user = await prisma.user.findUnique({ where: { id: userId } })
return user || null
} catch {
return null
}
}


export default async function handler(request) {
try {
let user = null


if (typeof getUserFromRequest === 'function') {
user = await getUserFromRequest(toEventShim(request))
}
if (!user) {
user = await userFromFallbackCookie(request)
}


const admins = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean)

const isAdmin = user
  ? Boolean(user.isAdmin || user.role === 'admin' || admins.includes((user.email || '').toLowerCase()))
  : false

const payload = user
  ? {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isAdmin,
    }
  : {}


return new Response(JSON.stringify(payload), {
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
