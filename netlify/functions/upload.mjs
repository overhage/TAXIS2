/*
 * Revised upload.mjs
 * - Keeps minimal changes to start background processing (process-upload-background)
 * - Preserves structured logging
 * - Returns error **string** at top level and rich object in `errorDetail`
 * - Handles CORS/OPTIONS
 * - Parses multipart (single file) via Busboy
 * - Stores file in Netlify Blobs
 * - Creates Upload + Job via Prisma and POSTs jobId to background fn
 */

import { getStore } from '@netlify/blobs'
import Busboy from 'busboy'
import { PrismaClient } from '@prisma/client'

// ======= Config flags =======
const DEBUG = process.env.DEBUG_UPLOAD === '1'
const TRACE = process.env.TRACE_UPLOAD === '1'
const MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES || 50 * 1024 * 1024)

// Prisma (reuse across invocations)
const prisma = globalThis.__prisma ?? new PrismaClient()
if (!globalThis.__prisma) globalThis.__prisma = prisma

// ======= Utilities =======
function rid (len = 10) {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}
function safeJSON (o) { try { return JSON.stringify(o) } catch { return JSON.stringify(String(o)) } }
function logJSON (type, reqId, extra) { if (DEBUG) console.log(safeJSON({ t: new Date().toISOString(), type, reqId, ...extra })) }
function previewHeaders (h) {
  const keys = ['content-type','content-length','x-forwarded-for','x-forwarded-host','x-forwarded-proto','user-agent','origin','referer']
  const out = {}; for (const k of keys) if (h[k]) out[k] = h[k]; return out
}
function serializeError (err) { if (!err) return null; return { name: err.name, message: err.message, stack: err.stack?.split('\n').slice(0,6).join('\n') } }
function summarizeTimings (marks) {
  const keys = Object.keys(marks).sort((a,b)=>marks[a]-marks[b])
  const out = { marks: {} }; let prev = null
  for (const k of keys) { out.marks[k] = Number(marks[k].toFixed(3)); if (prev) out[`${prev}→${k}`] = Number((marks[k]-marks[prev]).toFixed(3)); prev = k }
  if (keys.length) out.totalMs = Number((marks[keys[keys.length-1]]-marks[keys[0]]).toFixed(3))
  return out
}
function corsHeaders () {
  const origin = process.env.CORS_ALLOW_ORIGIN || '*'
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization'
  }
}
function json (statusCode, body) {
  return {
    statusCode,
    headers: { ...corsHeaders(), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(body)
  }
}

function getUploadsStore(name) {
  const siteID =
    process.env.NETLIFY_SITE_ID?.trim();
  const token =
    process.env.NETLIFY_BLOBS_TOKEN?.trim();

  const isValidManualCreds = (
    siteID && token &&
    siteID !== 'set' &&
    token !== 'set' &&
    !siteID.toLowerCase().includes('example')
  );

  try {
    if (isValidManualCreds) {
      // Explicit creds — used only in local dev or CI
      console.log(`[upload] using manual siteID/token`);
      return getStore(name, { siteID, token });
    }

    // Let Netlify inject creds automatically in production
    console.log(`[upload] using Netlify-injected Blobs creds`);
    return getStore(name);
  } catch (e) {
    const msg =
      `Netlify Blobs not configured. Provide NETLIFY_SITE_ID and NETLIFY_BLOBS_TOKEN ` +
      `(or run via netlify dev). Got siteID=${siteID ? 'set' : 'missing'}, token=${token ? 'set' : 'missing'}`;
    console.error('[upload] blobs_error', msg, e);
    throw new Error(msg);
  }
}


// ===================== Multipart parser (single file) =====================
async function parseMultipart (event, headers) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers })
    const files = []; const fields = {}
    bb.on('file', (name, file, info) => {
      const { filename, mimeType } = info
      const chunks = []
      file.on('data', d => chunks.push(d))
      file.on('end', () => {
        const buffer = Buffer.concat(chunks)
        if (DEBUG) console.log(safeJSON({ t: new Date().toISOString(), type: 'file_end', name, filename, mimeType, bytes: buffer.length }))
        files.push({ name, buffer, meta: { filename, mime: mimeType, size: buffer.length } })
      })
    })
    bb.on('field', (name, val) => { fields[name] = val; if (DEBUG) console.log(safeJSON({ t: new Date().toISOString(), type: 'field', name })) })
    bb.on('error', reject)
    bb.on('close', () => resolve({ files, fields }))
    const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '')
    bb.end(body)
  })
}

// ===================== Handler =====================
export async function handler (event, context) {
  const uploadsStore = getStore(process.env.UPLOADS_STORE || 'uploads');
  const marks = { start: performance?.now?.() ?? Date.now() }
  const reqId = context?.awsRequestId || rid()

  // Preflight
  if (event?.httpMethod?.toUpperCase() === 'OPTIONS') {
    console.log(safeJSON({ t: new Date().toISOString(), type: 'preflight' }))
    return { statusCode: 204, headers: corsHeaders(), body: '' }
  }

  try {
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k,v]) => [k.toLowerCase(), v]))
    const method = (event.httpMethod || headers[':method'] || '').toUpperCase()

    logJSON('start', reqId, { method, path: event.path, query: event.queryStringParameters || {}, headers: previewHeaders(headers), isBase64: !!event.isBase64Encoded })

    if (method !== 'POST') return json(405, { ok: false, error: `Method ${method} not allowed`, reqId })

    // Body + limits
    let bodyBuf = Buffer.alloc(0)
    if (typeof event.body === 'string') bodyBuf = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body)
    const rawBytes = bodyBuf.byteLength
    const hdrLen = Number(headers['content-length'] || 0)
    const ctype = headers['content-type'] || ''

    logJSON('body_info', reqId, { hdrContentLength: isNaN(hdrLen) ? null : hdrLen, bodyBytes: rawBytes, mime: ctype, limit: MAX_BYTES })

    if (rawBytes > MAX_BYTES || hdrLen > MAX_BYTES) return json(413, { ok: false, error: `Payload too large (> ${MAX_BYTES} bytes)`, reqId })

    // Parse (multipart supported)
    let filename = null
    let fileMime = ctype || 'application/octet-stream'
    let fileBufferFinal = bodyBuf

    if (ctype.startsWith('multipart/form-data')) {
      logJSON('multipart_hint', reqId, { hint: 'multipart detected; streaming parse' })
      const parsed = await parseMultipart(event, headers)
      const first = parsed.files?.[0]
      if (!first) return json(400, { ok: false, error: 'No file in multipart payload', reqId })
      filename = first?.meta?.filename || 'upload.bin'
      fileMime = first?.meta?.mime || fileMime
      fileBufferFinal = first?.buffer || Buffer.alloc(0)
    } else if (!ctype) {
      logJSON('no_content_type', reqId, { note: 'No Content-Type provided' })
    }

    if (TRACE) logJSON('preview', reqId, { bodyHeadBase64: fileBufferFinal.subarray(0, Math.min(fileBufferFinal.length, 256)).toString('base64') })

    // Store to Netlify Blobs
    const uploadsStoreName = process.env.UPLOADS_STORE || 'uploads'
    const uploadsStore = getUploadsStore(uploadsStoreName)
    const safeName = (filename || 'upload.bin').replace(/[^A-Za-z0-9._-]/g, '_')
    const blobKey = `${uploadsStoreName}/${reqId}/${safeName}`
    await uploadsStore.set(blobKey, fileBufferFinal, { contentType: fileMime })
    const storeRes = { ok: true, blobKey, bytes: fileBufferFinal.length, mime: fileMime, filename: safeName }
    logJSON('store_result', reqId, { storeRes })

    // Create Upload + Job rows
    let uploadRow = null, jobRow = null; let enqueueStatus = null
    try {
      uploadRow = await prisma.upload.create({ data: {
        blobKey,
        originalName: safeName,
        mime: fileMime,
        bytes: fileBufferFinal.length,
        userId: null
      }})
      jobRow = await prisma.job.create({ data: {
        uploadId: uploadRow.id,
        status: 'queued',
        rowsProcessed: 0
      }})

      // Invoke background function
      const host = headers['x-forwarded-host']
      const proto = headers['x-forwarded-proto'] || 'https'
      const origin = process.env.URL || (host ? `${proto}://${host}` : '')
      if (!origin) throw new Error('Cannot resolve site origin for background call')
      const bgName = process.env.BG_FUNCTION_NAME || 'process-upload-background'
      const bgUrl = `${origin.replace(/\/$/, '')}/.netlify/functions/${bgName}`
      const resp = await fetch(bgUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: jobRow.id }) })
      enqueueStatus = { status: resp.status, ok: resp.ok }
      logJSON('enqueue_done', reqId, { jobId: jobRow.id, enqueueStatus })
    } catch (e) {
      const errObj = serializeError(e)
      logJSON('enqueue_error', reqId, { error: errObj })
      // Continue; UI can still poll job id if created
    }

    // Respond
    const payload = {
      ok: true,
      reqId,
      upload: {
        blobKey: storeRes.blobKey,
        bytes: storeRes.bytes,
        mime: storeRes.mime,
        filename: storeRes.filename,
        id: uploadRow?.id || null
      },
      job: { id: jobRow?.id || null, enqueue: enqueueStatus },
    }
    return json(200, payload)
  } catch (err) {
    const errObj = serializeError(err)
    logJSON('error', reqId, { err: errObj })
    return json(500, {
      ok: false,
      reqId,
      error: errObj?.message || 'Upload failed',  // string for UI rendering
      errorDetail: errObj                          // rich object for debugging
    })
  }
}