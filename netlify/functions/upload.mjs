// netlify/functions/upload.mjs  (Functions v2, ESM)
// Enqueue-only uploader: saves blob + creates job, then triggers background worker and returns 202
// Updated to use the new SIGNED-COOKIE auth (no legacy utils/auth.js)

import { getStore } from '@netlify/blobs'
import { parse as parseCsv } from 'csv-parse/sync'
import * as XLSX from 'xlsx'
import { PrismaClient } from '@prisma/client'
import { readSessionFromCookie } from './_auth/cookies.ts'

// Prisma singleton
const prisma = globalThis.__prisma || new PrismaClient()
// @ts-ignore
globalThis.__prisma = prisma

function getExt (filename, mime) {
  if (filename && filename.includes('.')) return filename.toLowerCase().slice(filename.lastIndexOf('.'))
  if (mime && /excel|sheet/i.test(mime)) return '.xlsx'
  return '.csv'
}

// --- AUTH: signed cookie → ensure DB user exists so we have user.id ---
async function requireUser (req) {
  const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET
  if (!secret) return null

  const cookieHeader = req.headers.get('cookie') || ''
  let sess = null
  try {
    sess = readSessionFromCookie(cookieHeader, secret)
  } catch (_) {
    sess = null
  }
  if (!sess) return null

  // Try to locate the DB user by email; create if missing
  const email = sess.email || `${sess.sub}@user.invalid`
  const name = sess.name || null

  let user = null
  try {
    // If email is unique in your schema, this will be fast
    user = await prisma.user.findUnique({ where: { email } })
  } catch (_) {}
  if (!user) {
    try {
      // If email is not marked @unique, findFirst will still work
      user = await prisma.user.findFirst({ where: { email } })
    } catch (_) {}
  }
  if (!user) {
    try {
      // Create a minimal user record; extend fields if your schema requires
      user = await prisma.user.create({ data: { email, name } })
    } catch (e) {
      // As a last resort, attempt upsert if email is unique
      try {
        user = await prisma.user.upsert({ where: { email }, update: { name }, create: { email, name } })
      } catch (_) {
        return null
      }
    }
  }
  return user
}
// --- END AUTH ---

export default async (req) => {
  try {
    const user = await requireUser(req)
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

    // save input blob
    const uploadsStore = getStore('uploads')
    const outputsStore = getStore('outputs') // ensure bucket exists for background writes

    const stamp = Date.now()
    const base = (filename || 'file').replace(/\.[^./]+$/, '') || 'file'
    const userId = user.id

    const ext = getExt(filename, mimeType)
    const uploadKey = `${userId}/${stamp}_${base}${ext}`

    // validate the uploaded file
    const allowedExt = new Set(['.csv', '.xlsx', '.xls'])
    if (!allowedExt.has(ext)) {
      return new Response(
        JSON.stringify({ error: `Unsupported file type ${ext}. Upload a CSV or Excel file (.xlsx/.xls).` }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    }

    // Parse just enough to validate header + row count
    let header = []
    let rowCount = 0

    try {
      if (ext === '.csv') {
        const text = buffer.toString('utf8')
        // arrays-of-arrays; first row is header
        const rows = parseCsv(text, { bom: true, relax_column_count: true, skip_empty_lines: true })
        if (!rows?.length) {
          return new Response(JSON.stringify({ error: 'Empty file.' }), { status: 400, headers: { 'content-type': 'application/json' } })
        }
        header = (rows[0] || []).map(h => String(h).trim())
        rowCount = Math.max(0, rows.length - 1)
      } else {
        // Excel (XLSX/XLS)
        const wb = XLSX.read(buffer, { type: 'buffer' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) // first row = header
        header = (aoa[0] || []).map(h => String(h).trim())
        rowCount = Math.max(0, (aoa.length || 0) - 1)
      }
    } catch (e) {
      return new Response(
        JSON.stringify({ error: `Failed to parse file: ${String(e?.message || e)}` }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    }

    const requiredColumns = [
      'concept_a', 'concept_b', 'cooc_obs', 'cooc_event_count', 'a_before_b', 'same_day', 'b_before_a', 'nA', 'nB', 'total_persons'
    ]

    const headerSet = new Set(header.map(h => h.toLowerCase()))
    const missing = requiredColumns.filter(c => !headerSet.has(c.toLowerCase()))

    if (missing.length) {
      return new Response(
        JSON.stringify({ error: 'Missing required columns', missing, header }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    }

    if (rowCount < 1) {
      return new Response(
        JSON.stringify({ error: 'No data rows found (need ≥ 1 row under the header).' }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    }

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
        // allow worker to set outputBlobKey if not provided here
        outputBlobKey: `outputs/${uploadRecord.id}.csv`,
        createdAt: new Date(),
      },
    })

    // fire-and-forget background run (resumable worker)
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
    return new Response(
      JSON.stringify({ error: String(err?.message ?? err) }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    )
  }
}
