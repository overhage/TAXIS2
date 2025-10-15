import { getStore } from '@netlify/blobs'
import { PrismaClient } from '@prisma/client'
import { requireUser } from './_admin-gate.mjs'

const prisma = globalThis.__prisma ?? new PrismaClient()
if (!globalThis.__prisma) globalThis.__prisma = prisma

export default async (req, context) => {
  console.info('[upload] Netlify Function running in v2 mode')

  try {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const formData = await req.formData()
    const blob = formData.get('file')
    if (!blob || typeof blob.arrayBuffer !== 'function') {
      return new Response(JSON.stringify({ error: 'Missing or invalid file field' }), { status: 400 })
    }

    const user = await requireUser(req)
    if (!user) {
      return new Response(JSON.stringify({ error: 'not_authenticated' }), { status: 401 })
    }

    const buf = Buffer.from(await blob.arrayBuffer())
    const blobKey = `uploads/${context.params.uploadId || 'default'}/${blob.name}`
    const store = getStore('uploads')
    await store.set(blobKey, buf, { contentType: blob.type })

    const record = await prisma.upload.create({
      data: {
        blobKey,
        originalName: blob.name,
        contentType: blob.type,
        size: buf.length,
        store: 'uploads',
        userId: user.id
      }
    })

    return new Response(JSON.stringify({ ok: true, uploadId: record.id }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  } catch (err) {
    console.error('[upload error]', err)
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    })
  }
}