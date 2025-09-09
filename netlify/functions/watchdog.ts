// netlify/functions/watchdog.mjs
import { schedule } from '@netlify/functions'
import { prisma } from './_db.mjs'

export const handler = schedule('* * * * *', async () => {
  const STALE_MS = 2 * 60 * 1000
  const cutoff = new Date(Date.now() - STALE_MS)

  // Find “running” jobs with stale or missing heartbeat
  const stale = await prisma.job.findMany({
    where: {
      status: 'running',
      OR: [{ lastHeartbeat: null }, { lastHeartbeat: { lt: cutoff } }]
    },
    select: { id: true, cursor: true, processedRows: true }
  })

  if (!stale.length) return { statusCode: 200, body: 'ok' }

  for (const j of stale) {
    await prisma.job.update({
      where: { id: j.id },
      data: {
        status: 'queued',
        cursor: Math.max(j.cursor ?? 0, j.processedRows ?? 0),
        restartedAt: new Date(),
        lockedAt: null,
        lockedBy: null
      }
    })
    // Kick the background worker
    const base =
      process.env.URL || process.env.DEPLOY_URL || 'https://taxis2.netlify.app'
    await fetch(`${base}/.netlify/functions/process-upload-background`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: j.id })
    }).catch(() => {})
  }
  return { statusCode: 200, body: `requeued ${stale.length}` }
})
