// netlify/functions/jobs.js — Functions v2 (ESM)
// Fixes "failed to fetch jobs" by authenticating with either legacy utils/auth
// or a fallback cookie-based path (session = `${userId}.${timestamp}`).
// Returns the current user's jobs.

import { PrismaClient } from '@prisma/client'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

// Prisma singleton across invocations
const prisma = globalThis.__prisma || new PrismaClient()
// @ts-ignore
globalThis.__prisma = prisma

// Try to import legacy auth helper if present
let getUserFromRequest
try { ({ getUserFromRequest } = require('./utils/auth')) } catch { getUserFromRequest = null }

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function readSessionCookie(req) {
  const cookieHeader = req.headers.get('cookie') || ''
  for (const part of cookieHeader.split(';')) {
    const seg = part.trim()
    const i = seg.indexOf('=')
    if (i === -1) continue
    if (seg.slice(0, i) === 'session') return decodeURIComponent(seg.slice(i + 1))
  }
  return null
}

async function requireUser(req) {
  // 1) try legacy helper
  if (typeof getUserFromRequest === 'function') {
    try {
      const url = new URL(req.url)
      const event = {
        headers: Object.fromEntries(req.headers.entries()),
        httpMethod: req.method,
        path: url.pathname,
        queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      }
      const u = await getUserFromRequest(event)
      if (u) return u
    } catch {}
  }
  // 2) fallback: parse `${userId}.${ts}` from cookie and look up user
  const token = readSessionCookie(req)
  if (!token) return null
  const dot = token.indexOf('.')
  const userId = dot === -1 ? token : token.slice(0, dot)
  if (!userId) return null
  try { return await prisma.user.findUnique({ where: { id: userId } }) } catch { return null }
}

export default async (req) => {
  try {
    if (req.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405)

    const user = await requireUser(req)
    if (!user) return json({ error: 'not_authenticated' }, 401)

    const url = new URL(req.url)
    const take = Math.min(Number(url.searchParams.get('limit') || 50), 200)

    const rows = await prisma.job.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        status: true,
        rowsTotal: true,
        rowsProcessed: true,
        createdAt: true,
        finishedAt: true,
        outputBlobKey: true,
      },
    })

    const shaped = rows.map((r) => ({
      id: r.id,
      status: r.status,
      rowsTotal: r.rowsTotal,
      rowsProcessed: r.rowsProcessed,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      outputUrl: r.outputBlobKey ? `/api/download?job=${encodeURIComponent(r.id)}` : null,
    }))

    return json({ jobs: shaped })
  } catch (err) {
    console.error('[jobs] ERROR', err)
    return json({ error: String(err?.message ?? err) }, 500)
  }
}
