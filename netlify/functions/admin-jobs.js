// netlify/functions/admin-jobs.js — Admin jobs API using unified admin gate
// Uses shared gate helper: ./_admin-gate.mjs
// Supports:
//   GET    /api/admin-jobs                       -> list jobs
//   GET    /api/admin-jobs?op=count&...          -> count jobs matching filters
//   DELETE /api/admin-jobs { date, status, user }-> delete matching jobs

import { PrismaClient } from '@prisma/client'
import { requireAdmin } from './_admin-gate.mjs'

// Prisma (singleton across invocations)
const prisma = globalThis.__prisma || new PrismaClient()
// @ts-ignore
globalThis.__prisma = prisma

/* -------------------
   small JSON helper
------------------- */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/* -----------------------------------------
   date helper (unchanged from your version)
----------------------------------------- */
function endOfDayISO(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(+d)) return null
  d.setUTCHours(23, 59, 59, 999)
  return d
}

async function buildWhere({ date, status, user }) {
  const where = {}
  if (date) {
    const by = endOfDayISO(date)
    if (by) where.createdAt = { lte: by }
  }
  if (status) where.status = String(status)
  if (user) {
    // try to resolve user by email -> userId
    const u = await prisma.user.findUnique({ where: { email: String(user) } }).catch(() => null)
    if (u) where.userId = u.id
    else where.userId = '__no_match__' // ensures zero results if email not found
  }
  return where
}

/* -------------------------------
   Main handler
-------------------------------- */
export default async (req) => {
  try {
    const me = requireAdmin(event);
    if (!me) return { statusCode: 403, body: 'forbidden' };

    const url = new URL(req.url)
    const method = req.method.toUpperCase()

    if (method === 'GET') {
      const op = url.searchParams.get('op') || ''
      if (op === 'count') {
        const date = url.searchParams.get('date') || ''
        const status = url.searchParams.get('status') || ''
        const who = url.searchParams.get('user') || ''
        const where = await buildWhere({ date, status, user: who })
        const count = await prisma.job.count({ where })
        return json({ date, status, user: who, count })
      }

      // Default list
      const rows = await prisma.job.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          uploadId: true,
          status: true,
          rowsTotal: true,
          rowsProcessed: true,
          userId: true,
          outputBlobKey: true,
          createdAt: true,
          finishedAt: true,
        },
      })
      // hydrate user email + filename if helpful
      const users = await prisma.user.findMany({ where: { id: { in: Array.from(new Set(rows.map((r) => r.userId))) } }, select: { id: true, email: true } })
      const userMap = new Map(users.map((u) => [u.id, u.email]))
      const uploads = await prisma.upload.findMany({ where: { id: { in: Array.from(new Set(rows.map((r) => r.uploadId))) } }, select: { id: true, originalName: true } })
      const uploadMap = new Map(uploads.map((u) => [u.id, u.originalName]))
      const shaped = rows.map((r) => ({
        id: r.id,
        status: r.status,
        rowCount: r.rowsTotal,
        userEmail: userMap.get(r.userId) || null,
        fileName: uploadMap.get(r.uploadId) || r.uploadId,
        createdAt: r.createdAt,
        outputUrl: r.outputBlobKey ? `/api/download?job=${encodeURIComponent(r.id)}` : null,
      }))
      return json(shaped)
    }

    if (method === 'DELETE') {
      const body = await req.json().catch(() => ({}))
      const { date = '', status = '', user: who = '' } = body || {}
      const where = await buildWhere({ date, status, user: who })
      const count = await prisma.job.count({ where })
      const res = await prisma.job.deleteMany({ where })
      return json({ requested: count, deleted: res.count })
    }

    return json({ error: 'Unsupported method' }, 405)
  } catch (err) {
    console.error('[admin-jobs] ERROR', err)
    return json({ error: String(err?.message ?? err) }, 500)
  }
}
