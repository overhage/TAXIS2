// netlify/functions/jobs.js — Functions v2 (ESM)
// Uses shared requireUser from _admin-gate.mjs to avoid createRequire/import.meta.url issues
// Returns the current user's jobs; 401 if not authenticated.

import { PrismaClient } from '@prisma/client'
import { requireUser } from './_admin-gate.mjs'

// Prisma singleton across invocations
const prisma = globalThis.__prisma || new PrismaClient()
// @ts-ignore
globalThis.__prisma = prisma

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export default async (req) => {
  try {
    if (req.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405)

    const user = await requireUser(req)
    if (!user) return json({ error: 'not_authenticated' }, 401)

    const url = new URL(req.url)
    const take = Math.min(Number(url.searchParams.get('limit') || 50), 200)

    // Pull each Job and its related Upload's originalName (and blobKey as a fallback)
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
        upload: {
          select: { originalName: true, blobKey: true },
        },
      },
    })

    const shaped = rows.map((r) => {
      const uploadName = r.upload?.originalName ?? null
      const uploadKeyLeaf = r.upload?.blobKey ? r.upload.blobKey.split('/').pop() : null
      const outputKeyLeaf = r.outputBlobKey ? r.outputBlobKey.split('/').pop() : null

      return {
        id: r.id,
        status: r.status,
        rowsTotal: r.rowsTotal,
        rowsProcessed: r.rowsProcessed,
        createdAt: r.createdAt,
        finishedAt: r.finishedAt,
        // normalized filename for the UI: prefer Upload.originalName, then blob key leaf, then output key leaf
        fileName: uploadName ?? uploadKeyLeaf ?? outputKeyLeaf ?? '—',
        // keep existing output URL behavior
        outputUrl: r.outputBlobKey ? `/api/download?job=${encodeURIComponent(r.id)}` : null,
      }
    })

    return json({ jobs: shaped })
  } catch (err) {
    console.error('[jobs] ERROR', err)
    return json({ error: String(err?.message ?? err) }, 500)
  }
}
