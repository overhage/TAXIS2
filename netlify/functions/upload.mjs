// netlify/functions/upload.mjs — Revised for large files using direct client-to-Blobs upload
// This function no longer handles file binary data directly.
// Instead, it issues a signed upload URL the client uses to upload large files directly to Netlify Blobs.
// After upload completion, the client POSTs metadata back to this endpoint to create Upload and Job records.

import { getStore } from '@netlify/blobs'
import { PrismaClient } from '@prisma/client'
import { requireUser } from './_admin-gate.mjs'

console.log('[upload] Direct-to-Blobs mode enabled')

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
  const method = req.method.toUpperCase()

  if (method === 'OPTIONS') {
    return new Response('', { status: 204, headers: corsHeaders() })
  }

  // Step 1: issue signed upload URL (client requests this first)
  if (method === 'GET') {
    try {
      const storeName = process.env.UPLOADS_STORE || 'uploads'
      const store = getStore(storeName)
      const key = `${storeName}/${Date.now()}-${Math.random().toString(36).slice(2)}`

      const { url } = await store.getUploadUrl(key, {
        access: 'public',
        metadata: { issuedAt: new Date().toISOString() }
      })

      return new Response(JSON.stringify({ ok: true, uploadUrl: url, blobKey: key }), {
        status: 200,
        headers: { ...corsHeaders(), 'content-type': 'application/json' }
      })
    } catch (err) {
      console.error('[upload GET error]', err)
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500,
        headers: { ...corsHeaders(), 'content-type': 'application/json' }
      })
    }
  }

  // Step 2: client POSTs metadata after completing the upload
  if (method === 'POST') {
    try {
      const body = await req.json()
      const { blobKey, originalName, contentType, size } = body || {}

      if (!blobKey || !originalName) {
        return new Response(JSON.stringify({ ok: false, error: 'Missing blobKey or originalName' }), {
          status: 400,
          headers: { ...corsHeaders(), 'content-type': 'application/json' }
        })
      }

      // Get user context
      let user = null
      try {
        user = await requireUser(req)
      } catch (err) {
        console.error('[upload] requireUser failed:', err)
      }

      const userId = user?.sub || null
      console.info('[upload] using userId:', userId)

      // Ensure User record exists
      if (userId) {
        await prisma.user.upsert({
          where: { id: userId },
          update: { email: user?.email, name: user?.name, provider: user?.provider },
          create: { id: userId, email: user?.email, name: user?.name, provider: user?.provider }
        })
      }

      // Create upload + job records
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

      const jobRow = await prisma.job.create({
        data: {
          uploadId: uploadRow.id,
          status: 'queued',
          rowsProcessed: 0
        }
      })

      // Trigger background processing
      try {
        const base =
          process.env.URL || process.env.DEPLOY_URL || process.env.NETLIFY_BASE_URL || 'https://taxis2.netlify.app'
        await fetch(`${base}/.netlify/functions/process-upload-background`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jobId: jobRow.id })
        })
        console.info('[upload] triggered process-upload-background for job:', jobRow.id)
      } catch (err) {
        console.error('[upload] failed to trigger background worker:', err)
      }

      return new Response(JSON.stringify({ ok: true, uploadId: uploadRow.id, jobId: jobRow.id }), {
        status: 200,
        headers: { ...corsHeaders(), 'content-type': 'application/json' }
      })
    } catch (err) {
      console.error('[upload POST error]', err)
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500,
        headers: { ...corsHeaders(), 'content-type': 'application/json' }
      })
    }
  }

  return new Response(JSON.stringify({ ok: false, error: 'Unsupported method' }), {
    status: 405,
    headers: { ...corsHeaders(), 'content-type': 'application/json' }
  })
}
