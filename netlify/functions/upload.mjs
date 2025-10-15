/*
 * upload.mjs — Netlify Functions v2 (ESM default export)
 * - Handles multipart upload via Busboy
 * - Stores file in Netlify Blobs
 * - Creates Upload + Job rows in Prisma
 * - Invokes background process function
 */

import { getStore } from '@netlify/blobs'
import Busboy from 'busboy'
import { PrismaClient } from '@prisma/client'

console.log('[upload] Netlify Function running in v2 mode')

const DEBUG = process.env.DEBUG_UPLOAD === '1'
const TRACE = process.env.TRACE_UPLOAD === '1'
const MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES || 50 * 1024 * 1024)

// Prisma client reuse
const prisma = globalThis.__prisma ?? new PrismaClient()
if (!globalThis.__prisma) globalThis.__prisma = prisma

// ===== Utilities =====
function rid(len = 10) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}
function safeJSON(o) { try { return JSON.stringify(o) } catch { return JSON.stringify(String(o)) } }
function serializeError(err) {
  if (!err) return null
  return { name: err.name, message: err.message, stack: err.stack?.split('\n').slice(0, 6).join('\n') }
}
function corsHeaders() {
  const origin = process.env.CORS_ALLOW_ORIGIN || '*'
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization'
  }
}

// Parse multipart form
async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: Object.fromEntries(req.headers) })
    const files = []
    const fields = {}
    bb.on('file', (name, file, info) => {
      const { filename, mimeType } = info
      const chunks = []
      file.on('data', (d) => chunks.push(d))
      file.on('end', () => {
        const buffer = Buffer.concat(chunks)
        files.push({ name, buffer, meta: { filename, mime: mimeType, size: buffer.length } })
      })
    })
    bb.on('field', (name, val) => { fields[name] = val })
    bb.on('error', reject)
    bb.on('close', () => resolve({ files, fields }))
    req.arrayBuffer().then((buf) => {
      bb.end(Buffer.from(buf))
    }).catch(reject)
  })
}

// ===== Function Handler (v2) =====
export default async (req, context) => {
  const reqId = rid()
  const method = req.method.toUpperCase()

  if (method === 'OPTIONS') {
    return new Response('', { status: 204, headers: corsHeaders() })
  }

  if (method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: `Method ${method} not allowed`, reqId }), {
      status: 405,
      headers: { ...corsHeaders(), 'content-type': 'application/json' }
    })
  }

  try {
    const headers = Object.fromEntries(req.headers)
    const ctype = headers['content-type'] || ''
    const uploadsStoreName = process.env.UPLOADS_STORE || 'uploads'
    const uploadsStore = getStore(uploadsStoreName)

    let fileBuffer, fileMime, filename

    if (ctype.startsWith('multipart/form-data')) {
      const parsed = await parseMultipart(req)
      const first = parsed.files?.[0]
      if (!first) {
        return new Response(JSON.stringify({ ok: false, error: 'No file found', reqId }), {
          status: 400,
          headers: { ...corsHeaders(), 'content-type': 'application/json' }
        })
      }
      fileBuffer = first.buffer
      filename = first.meta.filename || 'upload.bin'
      fileMime = first.meta.mime || 'application/octet-stream'
    } else {
      const arrBuf = await req.arrayBuffer()
      fileBuffer = Buffer.from(arrBuf)
      filename = 'upload.bin'
      fileMime = ctype || 'application/octet-stream'
    }

    if (fileBuffer.length > MAX_BYTES) {
      return new Response(JSON.stringify({ ok: false, error: `Payload too large (> ${MAX_BYTES} bytes)` }), {
        status: 413,
        headers: { ...corsHeaders(), 'content-type': 'application/json' }
      })
    }

    const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_')
    const blobKey = `${uploadsStoreName}/${reqId}/${safeName}`

    await uploadsStore.set(blobKey, fileBuffer, { contentType: fileMime })

    const uploadRow = await prisma.upload.create({
      data: {
        blobKey,
        originalName: safeName,
        contentType: fileMime,
        size: fileBuffer.length,
        store: uploadsStoreName,
        userId: null
      }
    })

    const jobRow = await prisma.job.create({
      data: {
        uploadId: uploadRow.id,
        status: 'queued',
        rowsProcessed: 0
      }
    })

    const origin = process.env.URL || `https://${req.headers.get('x-forwarded-host')}`
    const bgName = process.env.BG_FUNCTION_NAME || 'process-upload-background'
    const bgUrl = `${origin.replace(/\/$/, '')}/.netlify/functions/${bgName}`
    let enqueueStatus = null
    try {
      const resp = await fetch(bgUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: jobRow.id })
      })
      enqueueStatus = { ok: resp.ok, status: resp.status }
    } catch (e) {
      console.error('Background enqueue error', e)
    }

    const payload = {
      ok: true,
      reqId,
      upload: {
        blobKey,
        bytes: fileBuffer.length,
        mime: fileMime,
        filename: safeName,
        id: uploadRow.id
      },
      job: { id: jobRow.id, enqueue: enqueueStatus }
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders(), 'content-type': 'application/json' }
    })
  } catch (err) {
    const errObj = serializeError(err)
    console.error('[upload error]', errObj)
    return new Response(JSON.stringify({ ok: false, error: errObj.message, detail: errObj }), {
      status: 500,
      headers: { ...corsHeaders(), 'content-type': 'application/json' }
    })
  }
}
