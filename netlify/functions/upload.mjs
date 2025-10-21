// upload.mjs — Three-step direct-to-Blobs upload flow
// 1️⃣ GET → Issue signed upload URL for client to PUT the file.
// 2️⃣ POST → Client notifies after upload to create Upload + Job records.
// Includes structured debug logging and robust validation.

import { getStore } from '@netlify/blobs'
import { PrismaClient } from '@prisma/client'
import { requireUser } from './_admin-gate.mjs'

console.log('[upload] Three-step upload flow enabled')

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
  try {
    const method = req.method?.toUpperCase?.() || 'UNKNOWN'
    console.info(`[upload] Handling ${method} request`)

    if (method === 'OPTIONS') {
      return new Response('', { status: 204, headers: corsHeaders() })
    }

    // 1️⃣ GET → Issue signed upload URL for the client
    if (method === 'GET') {
      try {
        const storeName = process.env.UPLOADS_STORE || 'uploads'
        const store = getStore(storeName)

        if (!store?.getUploadUrl) {
          throw new Error('getUploadUrl missing — ensure @netlify/blobs@^5.0.0 is installed')
        }

        const key = `${storeName}/${Date.now()}-${Math.random().toString(36).slice(2)}`
        const { url } = await store.getUploadUrl(key, {
          access: 'public',
          metadata: { issuedAt: new Date().toISOString() }
        })

        console.info('[upload GET] Issued upload URL for key:', key)

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

    // 2️⃣ POST → Notify after upload, create DB entries, and trigger background job
    if (method === 'POST') {
      let bodyText = ''
      try {
        bodyText = await req.text()
      } catch (err) {
        console.error('[upload POST] Failed to read body', err)
      }

      let body = {}
      try {
        body = JSON.parse(bodyText || '{}')
      } catch (err) {
        console.error('[upload POST] Invalid JSON', err)
        return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON body' }), {
          status: 400,
          headers: { ...corsHeaders(), 'content-type': 'application/json' }
        })
      }

      console.info('[upload POST] Parsed body:', body)
      const { blobKey, originalName, contentType, size } = body

      if (!blobKey || !originalName) {
        return new Response(JSON.stringify({ ok: false, error: 'Missing blobKey or originalName' }), {
          status: 400,
          headers: { ...corsHeaders(), 'content-type': 'application/json' }
        })
      }

      // Get authenticated user
      let user = null
      try {
        user = await requireUser(req)
        console.info('[upload POST] User resolved:', user)
      } catch (err) {
        console.warn('[upload POST] No valid user:', err.message)
      }

      const userId = user?.sub || null
      if (userId) {
        await prisma.user.upsert({
          where: { id: userId },
          update: { email: user?.email, name: user?.name, provider: user?.provider },
          create: { id: userId, email: user?.email, name: user?.name, provider: user?.provider }
        })
      }

      // Create Upload record
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

      // Create Job record
      const jobRow = await prisma.job.create({
        data: {
          uploadId: uploadRow.id,
          status: 'queued',
          rowsProcessed: 0
        }
      })

      console.info('[upload POST] Created Upload:', uploadRow.id, 'Job:', jobRow.id)

      // Trigger process-upload-background function
      try {
        const base = process.env.URL || process.env.DEPLOY_URL || process.env.NETLIFY_BASE_URL || 'https://taxis2.netlify.app'
        const trigger = await fetch(`${base}/.netlify/functions/process-upload-background`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jobId: jobRow.id })
        })
        console.info('[upload POST] Triggered background job, status:', trigger.status)
      } catch (err) {
        console.error('[upload POST] Failed to trigger background job:', err)
      }

      return new Response(JSON.stringify({ ok: true, uploadId: uploadRow.id, jobId: jobRow.id }), {
        status: 200,
        headers: { ...corsHeaders(), 'content-type': 'application/json' }
      })
    }

    // Unsupported method
    return new Response(JSON.stringify({ ok: false, error: `Unsupported method ${method}` }), {
      status: 405,
      headers: { ...corsHeaders(), 'content-type': 'application/json' }
    })
  } catch (err) {
    console.error('[upload top-level error]', err.stack || err)
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders(), 'content-type': 'application/json' }
    })
  }
}