import { getStore } from '@netlify/blobs'
import { PrismaClient } from '@prisma/client'

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

    const buf = Buffer.from(await blob.arrayBuffer())
    const blobKey = `uploads/${context.params.uploadId}/${blob.name}`
    const store = getStore('uploads')
    await store.set(blobKey, buf, { contentType: blob.type })

    // Extract userId from session or headers
    let userId = null
    const claimsJson = req.headers.get('x-netlify-cms-user') || req.headers.get('x-user')
    if (claimsJson) {
      try {
        const claims = JSON.parse(claimsJson)
        userId = claims.sub || claims.id || claims.userid || claims.userId || null
      } catch {}
    }

    const record = await prisma.upload.create({
      data: {
        blobKey,
        originalName: blob.name,
        contentType: blob.type,
        size: buf.length,
        store: 'uploads',
        userId: userId ?? null
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
