// upload.mjs — ultra-defensive debug version
// Adds top-level try/catch, console flush, and forced JSON responses for any uncaught error.

import { getStore } from '@netlify/blobs'
import { PrismaClient } from '@prisma/client'
import { requireUser } from './_admin-gate.mjs'

console.log('[upload] ultra-debug mode starting')

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
    console.log(`[upload] handling ${method} request`)

    if (method === 'OPTIONS') {
      return new Response('', { status: 204, headers: corsHeaders() })
    }

    if (method === 'GET') {
      try {
        console.log('[upload GET] starting signed URL creation')
        const storeName = process.env.UPLOADS_STORE || 'uploads'
        const store = getStore(storeName)
        if (!store?.getUploadUrl) {
          console.error('[upload GET] getUploadUrl missing, likely old @netlify/blobs version')
          return new Response(JSON.stringify({ ok: false, error: 'Netlify Blobs v5+ required' }), {
            status: 500,
            headers: { ...corsHeaders(), 'content-type': 'application/json' }
          })
        }
        const key = `${storeName}/${Date.now()}-${Math.random().toString(36).slice(2)}`
        const { url } = await store.getUploadUrl(key, { access: 'public' })
        console.log('[upload GET] success, returning key:', key)
        return new Response(JSON.stringify({ ok: true, uploadUrl: url, blobKey: key }), {
          status: 200,
          headers: { ...corsHeaders(), 'content-type': 'application/json' }
        })
      } catch (err) {
        console.error('[upload GET fatal]', err.stack || err)
        return new Response(JSON.stringify({ ok: false, stage: 'get', error: err.message }), {
          status: 500,
          headers: { ...corsHeaders(), 'content-type': 'application/json' }
        })
      }
    }

    if (method === 'POST') {
      console.log('[upload POST] parsing JSON body...')
      let bodyText = ''
      try {
        bodyText = await req.text()
        console.log('[upload POST] raw body text:', bodyText.slice(0, 200))
      } catch (err) {
        console.error('[upload POST] failed to read body text', err)
      }
      let body = {}
      try {
        body = JSON.parse(bodyText || '{}')
      } catch (err) {
        console.error('[upload POST] invalid JSON:', err)
        return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON body' }), {
          status: 400,
          headers: { ...corsHeaders(), 'content-type': 'application/json' }
        })
      }

      console.log('[upload POST] parsed body:', body)
      const { blobKey, originalName, contentType, size } = body
      if (!blobKey || !originalName) {
        console.error('[upload POST] missing required fields')
        return new Response(JSON.stringify({ ok: false, error: 'Missing blobKey or originalName' }), {
          status: 400,
          headers: { ...corsHeaders(), 'content-type': 'application/json' }
        })
      }

      let user = null
      try {
        user = await requireUser(req)
        console.log('[upload POST] user resolved:', user)
      } catch (err) {
        console.error('[upload POST] requireUser failed:', err)
      }

      const userId = user?.sub || null
      console.log('[upload POST] userId:', userId)

      if (userId) {
        try {
          await prisma.user.upsert({
            where: { id: userId },
            update: { email: user?.email, name: user?.name, provider: user?.provider },
            create: { id: userId, email: user?.email, name: user?.name, provider: user?.provider }
          })
          console.log('[upload POST] ensured user in DB')
        } catch (err) {
          console.error('[upload POST] prisma.user.upsert failed', err)
        }
      }

      try {
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
        console.log('[upload POST] uploadRow created:', uploadRow.id)

        const jobRow = await prisma.job.create({
          data: {
            uploadId: uploadRow.id,
            status: 'queued',
            rowsProcessed: 0
          }
        })
        console.log('[upload POST] jobRow created:', jobRow.id)

        // Trigger background job
        try {
          const base = process.env.URL || process.env.DEPLOY_URL || process.env.NETLIFY_BASE_URL || 'https://taxis2.netlify.app'
          const resp = await fetch(`${base}/.netlify/functions/process-upload-background`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jobId: jobRow.id })
          })
          console.log('[upload POST] triggered background worker, status', resp.status)
        } catch (err) {
          console.error('[upload POST] failed to trigger background worker', err)
        }

        return new Response(JSON.stringify({ ok: true, uploadId: uploadRow.id, jobId: jobRow.id }), {
          status: 200,
          headers: { ...corsHeaders(), 'content-type': 'application/json' }
        })
      } catch (err) {
        console.error('[upload POST fatal]', err.stack || err)
        return new Response(JSON.stringify({ ok: false, stage: 'post', error: err.message }), {
          status: 500,
          headers: { ...corsHeaders(), 'content-type': 'application/json' }
        })
      }
    }

    console.warn('[upload] unsupported method', method)
    return new Response(JSON.stringify({ ok: false, error: 'Unsupported method' }), {
      status: 405,
      headers: { ...corsHeaders(), 'content-type': 'application/json' }
    })
  } catch (err) {
    console.error('[upload top-level fatal]', err.stack || err)
    return new Response(JSON.stringify({ ok: false, stage: 'top', error: err.message }), {
      status: 500,
      headers: { ...corsHeaders(), 'content-type': 'application/json' }
    })
  }
}
