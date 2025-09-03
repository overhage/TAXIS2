// netlify/functions/admin-master-record.js
// Admin API for MasterRecord: summary + search
// ESM function compatible with Netlify Functions v2

import { PrismaClient } from '@prisma/client'
import authUtilsCjs from './utils/auth.js'

const prisma = globalThis.__prisma || new PrismaClient()
// @ts-ignore
globalThis.__prisma = prisma
const { getUserFromRequest } = authUtilsCjs

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function isAdmin(user) {
  if (!user) return false
  // allow either a flag on the user OR an env list of admin emails
  if (user.isAdmin === true) return true
  const allow = (process.env.ADMIN_EMAILS || '')
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase())
  return allow.includes(String(user.email || '').toLowerCase())
}

export default async (req) => {
  try {
    const eventLike = { headers: { cookie: req.headers.get('cookie') || '' } }
    const user = await getUserFromRequest(eventLike)
    if (!user || !isAdmin(user)) {
      return json({ error: 'You do not have admin access' }, 403)
    }

    const url = new URL(req.url)
    const op = url.searchParams.get('op') || 'summary'

    if (op === 'summary') {
      // Count rows and get most recent updatedAt
      const [countRes, maxRes] = await Promise.all([
        prisma.masterRecord.count(),
        prisma.masterRecord.aggregate({ _max: { updatedAt: true } }),
      ])
      const lastUpdated = maxRes?._max?.updatedAt || null
      return json({ rows: countRes, lastUpdated })
    }

    if (op === 'search') {
      const q = (url.searchParams.get('q') || '').trim()
      const take = Math.min(Number(url.searchParams.get('limit') || 50), 200)
      if (!q) return json({ error: 'Missing q' }, 400)

      const rows = await prisma.masterRecord.findMany({
        where: {
          OR: [
            { concept_a: { contains: q, mode: 'insensitive' } },
            { concept_b: { contains: q, mode: 'insensitive' } },
            { code_a: { contains: q, mode: 'insensitive' } },
            { code_b: { contains: q, mode: 'insensitive' } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take,
        select: {
          pairId: true,
          concept_a: true,
          code_a: true,
          system_a: true,
          type_a: true,
          concept_b: true,
          code_b: true,
          system_b: true,
          type_b: true,
          relationshipType: true,
          relationshipCode: true,
          rational: true,
          source_count: true,
          llm_name: true,
          llm_version: true,
          llm_date: true,
          human_reviewer: true,
          human_comment: true,
          human_date: true,
          status: true,
          updatedAt: true,
        },
      })
      return json({ q, count: rows.length, rows })
    }

    return json({ error: 'Unsupported op' }, 400)
  } catch (err) {
    console.error('[admin-master-record] ERROR', err)
    return json({ error: String(err?.message ?? err) }, 500)
  }
}
