// netlify/functions/seed-field-map.mjs
import { getStore } from '@netlify/blobs'

const CONFIG_STORE = process.env.CONFIG_STORE || 'config'
const FIELD_MAP_CANDIDATE_KEYS = [
  'MasterRecord Fields.xlsx',
  'MasterRecord Fields.csv',
  'masterrecord_fields.xlsx',
  'masterrecord_fields.csv',
  'MasterRecordFields.xlsx',
  'MasterRecordFields.csv'
]

export default async (req) => {
  const store = getStore(CONFIG_STORE)

  if (req.method === 'GET') {
    const html = `
      <form method="POST">
        <p>Key (default: MasterRecord Fields.csv): <input name="key" value="MasterRecord Fields.csv"></p>
        <p>Purge others? <input type="checkbox" name="purgeOthers" value="true" checked></p>
        <p><textarea name="csv" rows="12" cols="80" placeholder="Paste CSV here"></textarea></p>
        <button type="submit">Upload</button>
      </form>`
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }

  // Accept form-encoded or raw text/json
  const ct = req.headers.get('content-type') || ''
  let params = {}
  let bodyText = ''
  if (ct.includes('application/json')) {
    const j = await req.json()
    params.key = j.key
    params.purgeOthers = j.purgeOthers
    bodyText = j.csv || j.text || ''
  } else if (ct.includes('application/x-www-form-urlencoded')) {
    const form = new URLSearchParams(await req.text())
    params.key = form.get('key')
    params.purgeOthers = form.get('purgeOthers')
    bodyText = form.get('csv') || ''
  } else {
    // Fallback: query string and raw text body
    const url = new URL(req.url)
    params.key = url.searchParams.get('key')
    params.purgeOthers = url.searchParams.get('purgeOthers')
    bodyText = await req.text()
  }

  const key = (params.key && params.key.trim()) || 'MasterRecord Fields.csv'
  const purgeOthers = String(params.purgeOthers).toLowerCase() === 'true'

  if (!bodyText?.trim()) {
    return new Response(JSON.stringify({ error: 'Empty CSV' }), {
      status: 400, headers: { 'content-type': 'application/json' }
    })
  }

  // 1) Write the CSV
  await store.set(key, bodyText, { contentType: 'text/csv; charset=utf-8' })

  // 2) Optionally delete alternates (including stale xlsx)
  const deleted = []
  if (purgeOthers) {
    for (const k of FIELD_MAP_CANDIDATE_KEYS) {
      if (k !== key) {
        try { await store.delete(k); deleted.push(k) } catch {}
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, wrote: key, deleted }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      // CORS (if you’ll call this from your app)
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  })
}
