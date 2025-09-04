// ─────────────────────────────────────────────────────────────────────────────
// File: netlify/functions/upload.mjs  (REVISED)
// Adds: required-field discovery endpoint (GET) + header validation on POST.
// Displays missing columns in the error payload.
// ─────────────────────────────────────────────────────────────────────────────

import { getStore } from '@netlify/blobs'
import { parse as parseCsv } from 'csv-parse/sync'
import * as XLSX from 'xlsx'
import { PrismaClient } from '@prisma/client'
import authUtilsCjs from './utils/auth.js'

const prisma = globalThis.__prisma || new PrismaClient()
// @ts-ignore
globalThis.__prisma = prisma
const { getUserFromRequest } = authUtilsCjs

// === Single source of truth for required spreadsheet headers ===
// NOTE: Keep in sync with your "MasterRecord Fields" spreadsheet's Required column.
// If you update the spreadsheet, update this list (or wire a small build script to auto-generate).
export const REQUIRED_FIELDS = [
  'concept_a',
  'concept_b',
  'cooc_obs',
  'cooc_event_count',
  'a_before_b',
  'same_day',
  'b_before_a',
  'nA',
  'nB',
  'total_person',
]

function getExt(filename, mime) {
  if (filename && filename.includes('.')) return filename.toLowerCase().slice(filename.lastIndexOf('.'))
  if (mime && /excel|sheet/i.test(mime)) return '.xlsx'
  return '.csv'
}

function normalizeHeaders(hdrs) {
  return Array.from(new Set((hdrs || []).map((h) => String(h || '').trim()))).filter(Boolean)
}

function extractHeadersFromBuffer(buffer, filename, mimeType) {
  const ext = getExt(filename, mimeType)
  if (ext === '.csv') {
    const text = Buffer.from(buffer).toString('utf-8')
    try {
      const recs = parseCsv(text, { columns: true, skip_empty_lines: true, trim: true })
      if (Array.isArray(recs) && recs.length > 0) return normalizeHeaders(Object.keys(recs[0]))
    } catch {}
    // Fallback: parse first line only
    try {
      const firstLine = (text.split(/\r?\n/, 1)[0] ?? '')
      const cells = parseCsv(firstLine)[0] || []
      return normalizeHeaders(cells)
    } catch {}
    return []
  }
  if (ext === '.xlsx' || ext === '.xls') {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const sheet = wb.SheetNames[0]
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false })
    const header = Array.isArray(rows?.[0]) ? rows[0] : []
    return normalizeHeaders(header)
  }
  return []
}

export default async (req) => {
  try {
    // ── GET: expose required headers for UI
    if (req.method === 'GET') {
      return new Response(
        JSON.stringify({ requiredFields: REQUIRED_FIELDS }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    // ── POST: upload + validate headers before enqueuing job
    const eventLike = { headers: { cookie: req.headers.get('cookie') || '' } }
    const user = await getUserFromRequest(eventLike)
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { 'content-type': 'application/json' } })
    }
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: { 'content-type': 'text/plain; charset=utf-8' } })
    }

    const form = await req.formData()
    const file = form.get('file')
    if (!file || typeof file.arrayBuffer !== 'function') {
      return new Response(JSON.stringify({ error: 'No file provided' }), { status: 400, headers: { 'content-type': 'application/json' } })
    }

    const filename = file.name || 'upload.csv'
    const mimeType = file.type || 'text/csv'
    const buffer = Buffer.from(await file.arrayBuffer())

    // ✓ Validate header row before persisting
    const headers = extractHeadersFromBuffer(buffer, filename, mimeType)
    if (!headers || headers.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Could not locate a header row in the file.', requiredFields: REQUIRED_FIELDS }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    }

    const headerSet = new Set(headers.map((h) => h.toLowerCase()))
    const missing = REQUIRED_FIELDS.filter((f) => !headerSet.has(f.toLowerCase()))
    if (missing.length > 0) {
      return new Response(
        JSON.stringify({
          error: `Missing required columns: ${missing.join(', ')}`,
          missing,
          requiredFields: REQUIRED_FIELDS,
          headersFound: headers,
          originalName: filename,
        }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    }

    // save input blob (only after validation succeeds)
    const uploadsStore = getStore('uploads')
    const outputsStore = getStore('outputs') // ensure bucket exists for background writes

    const stamp = Date.now()
    const base = (filename || 'file').replace(/\.[^./]+$/, '') || 'file'
    const userId = user.id

    const ext = getExt(filename, mimeType)
    const uploadKey = `${userId}/${stamp}_${base}${ext}`
    await uploadsStore.set(uploadKey, buffer, { contentType: mimeType, metadata: { originalName: filename } })

    // create upload + job records
    const uploadRecord = await prisma.upload.create({
      data: {
        userId,
        blobKey: uploadKey,
        originalName: filename,
        store: 'blob',
        contentType: mimeType,
        size: buffer.length,
      },
    })

    const job = await prisma.job.create({
      data: {
        uploadId: uploadRecord.id,
        status: 'queued',
        rowsTotal: 0,
        rowsProcessed: 0,
        userId,
        outputBlobKey: `outputs/${uploadRecord.id}.csv`,
        createdAt: new Date(),
      },
    })

    // fire-and-forget background run
    try {
      const host = req.headers.get('x-forwarded-host')
      const proto = req.headers.get('x-forwarded-proto') || 'https'
      const origin = process.env.URL || (host ? `${proto}://${host}` : '')
      if (origin) {
        await fetch(`${origin}/.netlify/functions/process-upload-background`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jobId: job.id }),
        })
      }
    } catch (e) {
      console.warn('[upload] failed to trigger background worker:', e?.message || e)
    }

    return new Response(
      JSON.stringify({ ok: true, jobId: job.id, inputBlobKey: uploadKey, outputBlobKey: job.outputBlobKey }),
      { status: 202, headers: { 'content-type': 'application/json' } }
    )
  } catch (err) {
    console.error('[upload] ERROR', err)
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), { status: 500, headers: { 'content-type': 'application/json' } })
  }
}