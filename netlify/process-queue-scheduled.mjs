// netlify/functions/process-queue-scheduled.mjs
// Scheduled watchdog to keep long-running uploads progressing
// Runs every minute, finds jobs that are queued or stalled, and (re)invokes the background worker

import { schedule } from '@netlify/functions'
import { PrismaClient } from '@prisma/client'

const prisma = globalThis.__prisma || new PrismaClient()
// @ts-ignore
globalThis.__prisma = prisma

const STALE_MS = Number(process.env.JOB_STALE_MS || 2 * 60 * 1000) // 2 minutes of no heartbeat

export const handler = schedule('*/1 * * * *', async () => {
  try {
    const now = new Date()
    const staleBefore = new Date(now.getTime() - STALE_MS)

    // Find jobs that need attention
    const jobs = await prisma.job.findMany({
      where: {
        OR: [
          { status: 'queued' },
          { status: 'running', lastHeartbeat: { lt: staleBefore } },
        ],
      },
      take: 10, // avoid stampede; we can run every minute
      orderBy: { createdAt: 'asc' },
    })

    if (jobs.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, picked: 0 }) }
    }

    // Determine origin for invoking the background function
    const origin = process.env.URL
    if (!origin) {
      console.warn('[watchdog] process.env.URL is not set; invocations may fail')
    }

    let picked = 0
    for (const job of jobs) {
      // skip jobs that already finished between query and now
      if (job.status === 'completed' || job.status === 'failed') continue

      try {
        const url = `${origin || ''}/.netlify/functions/process-upload-background`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jobId: job.id }),
        })
        if (!res.ok) {
          const txt = await res.text().catch(() => '')
          console.warn('[watchdog] worker returned', res.status, txt)
        }
        picked += 1
      } catch (e) {
        console.error('[watchdog] invoke failed for job', job.id, e?.message || e)
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, picked }) }
  } catch (err) {
    console.error('[watchdog] ERROR', err)
    return { statusCode: 500, body: JSON.stringify({ error: String(err?.message ?? err) }) }
  }
})
