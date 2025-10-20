import { getStore } from '@netlify/blobs'
import Busboy from 'busboy'
import { PrismaClient } from '@prisma/client'
import { requireUser } from './_admin-gate.mjs'

console.log('[upload] Netlify Function running in v2 mode')

const prisma = globalThis.__prisma ?? new PrismaClient()
if (!globalThis.__prisma) globalThis.__prisma = prisma

function rid(len = 10) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function corsHeaders() {
  const origin = process.env.CORS_ALLOW_ORIGIN || '*'
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization'
  }
}

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

export default async (req) => {
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

    const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_')
    const blobKey = `${uploadsStoreName}/${reqId}/${safeName}`

    await uploadsStore.set(blobKey, fileBuffer, { contentType: fileMime })

    // Get user
    let user = null
    try {
      user = await requireUser(req)
      console.info('[upload] user resolved:', user)
    } catch (err) {
      console.error('[upload] requireUser failed:', err)
    }

    // Use sub for foreign key consistency
    const userId = user?.sub || null
    console.info('[upload] using userId:', userId)

    // Ensure User record exists (aligns with new schema where id = sub)
    let dbUser = null
    if (userId) {
      dbUser = await prisma.user.upsert({
        where: { id: userId },
        update: { email: user?.email, name: user?.name, provider: user?.provider },
        create: { id: userId, email: user?.email, name: user?.name, provider: user?.provider }
      })
      console.info('[upload] ensured user record:', dbUser.id)
    }

    // Attempt upload record creation
    try {
      const uploadRow = await prisma.upload.create({
        data: {
          blobKey,
          originalName: safeName,
          contentType: fileMime,
          size: fileBuffer.length,
          store: uploadsStoreName,
          userId: userId
        }
      })

      console.info('[upload] uploadRow created:', uploadRow.id)

      const jobRow = await prisma.job.create({
        data: {
          uploadId: uploadRow.id,
          status: 'queued',
          rowsProcessed: 0
        }
      })

      console.info('[upload] jobRow created:', jobRow.id)

      return new Response(JSON.stringify({ ok: true, uploadId: uploadRow.id, jobId: jobRow.id }), {
        status: 200,
        headers: { ...corsHeaders(), 'content-type': 'application/json' }
      })
    } catch (err) {
      console.error('[upload] Prisma insert failed:', err)
      throw err
    }
  } catch (err) {
    console.error('[upload error]', err)
    return new Response(JSON.stringify({ ok: false, error: err.message, stack: err.stack }), {
      status: 500,
      headers: { ...corsHeaders(), 'content-type': 'application/json' }
    })
  }
}
