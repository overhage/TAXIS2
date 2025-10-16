import { getStore } from '@netlify/blobs'
import { PrismaClient } from '@prisma/client'
import { requireAdmin, requireUser } from './_admin-gate.mjs'

const prisma = globalThis.__prisma || new PrismaClient()
globalThis.__prisma = prisma

export default async function handler(req, context) {
  console.info('[upload] Function executing in v2 mode')

  try {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    // Authenticate user or admin similar to download.mjs
    const adminGate = await requireAdmin(req)
    let user = null
    if (!adminGate.allowed) {
      user = await requireUser(req)
      if (!user) {
        return new Response('Unauthorized', { status: 401 })
      }
    } else {
      user = adminGate.user
    }

    const formData = await req.formData()
    const blob = formData.get('file')

    if (!blob || typeof blob.arrayBuffer !== 'function') {
      return new Response(JSON.stringify({ error: 'Missing or invalid file field' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    }

    const buf = Buffer.from(await blob.arrayBuffer())
    const blobKey = `uploads/${context.params?.uploadId || 'default'}/${blob.name}`

    const store = getStore('uploads')
    await store.set(blobKey, buf, { contentType: blob.type })

    const record = await prisma.upload.create({
      data: {
        blobKey,
        originalName: blob.name,
        contentType: blob.type,
        size: buf.length,
        store: 'uploads',
        userId: user?.id || null
      }
    })

    return new Response(JSON.stringify({ ok: true, uploadId: record.id }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  } catch (err) {
    console.error('[upload] ERROR', err)
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    })
  }
}
