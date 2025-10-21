// Enhanced upload.mjs with detailed debug logging and robust error guards
// Supports direct-to-Blobs large file uploads

import { getStore } from '@netlify/blobs'
import { PrismaClient } from '@prisma/client'
import { requireUser } from './_admin-gate.mjs'

console.log('[upload] Direct-to-Blobs mode with extended logging enabled')

const prisma = globalThis.__prisma ?? new PrismaClient()
if (!globalThis.__prisma) globalThis.__prisma = prisma

function corsHeaders() {
  const origin = process.env.CORS_ALLOW_ORIGIN || '*'
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization'
  }
}

export default async (req) => {
  const method = req.method?.toUpperCase?.() || 'UNKNOWN'
  console.info(`[upload] request method: ${method}`)

  if (method === 'OPTIONS') {
    return new Response('', { status: 204, headers: corsHeaders() })
  }

  // --- GET: issue signed upload URL ---
  if (method === 'GET') {
    try {
      console.info('[upload GET] issuing signed URL...')
      const storeName = process.env.UPLOADS_STORE || 'uploads'
      const store = getStore(storeName)
      if (!store?.getUploadUrl) {
        throw new Error('getUploadUrl not available — ensure @netlify/blobs@>=5.0.0 is installed')
      }

      const key = `${storeName}/${Date.now()}-${Math.random().toString(36).slice(2)}`
      const { url } = await store.getUploadUrl(key, {
        access: 'public',
        metadata: { issuedAt: new Date().toISOString() }
      })

      console.info('[upload GET] signed URL issued for key:', key)
      return new Response(JSON.stringify({ ok: true, uploadUrl: url, blobKey: key }), {
        status: 200,
        headers: { ...corsHeaders(), 'content-type': 'application/json' }
      })
    } catch (err) {
      console.error('[upload GET error]', err.stack || err)
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500,
        headers: { ...corsHeaders(), 'content-type': 'application/json' }
      })
    }
  }

  // --- POST: client notifies after uploading to Blobs ---
  if (method === 'POST') {
    let body = {}
    try {
      body = await req.json()
    } catch (e) {
      console.error('[upload POST] invalid or non-JSON body')
      return new Response(JSON.stringify({ ok: false, error: 'Expected JSON body' }), {
        status: 400,
        headers: { ...corsHeaders(), 'content-type': 'application/json' }
      })
    }

    console.info('[upload POST] received body:', body)

    try {
      const { blobKey, originalName, contentType, size } = body || {}

      if (!blobKey || !originalName) {
        console.warn('[upload POST] missing blobKey or originalName')
        return new Response(JSON.stringify({ ok: false, error: 'Missing blobKey or originalName' }), {
          status: 400,
          headers: { ...corsHeaders(), 'content-type': 'application/json' }
        })
      }

      // --- user context ---
      let user = null
      try {
        user = await requireUser(req)
        console.info('[upload POST] user resolved:', user)
      } catch (err) {
        console.error('[upload POST] requireUser failed:', err)
      }

      const userId = user?.sub || null
      console.info('[upload POST] using userId:', userId)

      if (userId) {
        await prisma.user.upsert({
          where: { id: userId },
          update: { email: user?.email, name: user?.name, provider: user?.provider },
          create: { id: userId, email: user?.email, name: user?.name, provider: user?.provider }
        })
        console.info('[upload POST] ensured user record:', userId)
      }

      // --- create upload + job entries ---
      const uploadRow = await prisma.upload.create({
        data: {
          blobKey,
          originalName,
          contentType: contentType || 'application/octet-stream',
          size: size || 0,
          store: process.env.UPLOADS_STORE || 'uploads',
          userId
        }
      })
      console.info('[upload POST] uploadRow created:', uploadRow.id)

      const jobRow = await prisma.job.create({
        data: {
          uploadId: uploadRow.id,
          status: 'queued',
          rowsProcessed: 0
        }
      })
      console.info('[upload POST] jobRow created:', jobRow.id)

      // --- trigger background processor ---
      try {
        const base = process.env.URL || process.env.DEPLOY_URL || process.env.NETLIFY_BASE_URL || 'https://taxis2.netlify.app'
        const res = await fetch(`${base}/.netlify/functions/process-upload-background`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jobId: jobRow.id })
        })
        console.info('[upload POST] triggered background worker, status:', res.status)
      } catch (err) {
        console.error('[upload POST] failed to trigger background worker:', err)
      }

      return new Response(JSON.stringify({ ok: true, uploadId: uploadRow.id, jobId: jobRow.id }), {
        status: 200,
        headers: { ...corsHeaders(), 'content-type': 'application/json' }
      })
    } catch (err) {
      console.error('[upload POST error]', err.stack || err)
      return new Response(JSON.stringify({ ok: false, error: err.message, stack: err.stack }), {
        status: 500,
        headers: { ...corsHeaders(), 'content-type': 'application/json' }
      })
    }
  }

  // --- fallback ---
  console.warn('[upload] unsupported method:', method)
  return new Response(JSON.stringify({ ok: false, error: 'Unsupported method' }), {
    status: 405,
    headers: { ...corsHeaders(), 'content-type': 'application/json' }
  })
}
