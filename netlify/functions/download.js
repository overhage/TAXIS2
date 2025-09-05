import { PrismaClient } from '@prisma/client'
import { getStore } from '@netlify/blobs'
import { requireAdmin, requireUser } from './_admin-gate.mjs'

const prisma = globalThis.__prisma || new PrismaClient()
// @ts-ignore
globalThis.__prisma = prisma

export default async function handler(req) {
  try {
    if (req.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const url = new URL(req.url)
    const jobId = url.searchParams.get('job')
    if (!jobId) return new Response('Missing job', { status: 400 })

    // Load job first (we need userId to decide access)
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, userId: true, outputBlobKey: true }
    })
    if (!job) return new Response('Not found', { status: 404 })

    // Allow if admin OR owner
    const gate = await requireAdmin(req)
    let user = null
    if (!gate.allowed) {
      user = await requireUser(req)
      if (!user || user.id !== job.userId) {
        return new Response('Unauthorized', { status: 401 })
      }
    }

    if (!job.outputBlobKey) {
      return new Response('Output not ready', { status: 404 })
    }

    const outputs = getStore('outputs')
    const stream = await outputs.get(job.outputBlobKey, { type: 'stream' })
    if (!stream) return new Response('Not found', { status: 404 })

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="job-${job.id}.csv"`,
        'cache-control': 'no-store'
      }
    })
  } catch (err) {
    console.error('[download] ERROR', err)
    return new Response('Server error', { status: 500 })
  }
}
