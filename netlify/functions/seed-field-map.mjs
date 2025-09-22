// netlify/functions/seed-field-map.mjs
import { getStore } from '@netlify/blobs'

const CONFIG_STORE = process.env.CONFIG_STORE || 'config'

// Keep in sync with your reader’s candidate list
const FIELD_MAP_CANDIDATE_KEYS = [
  'MasterRecord Fields.xlsx',
  'MasterRecord Fields.csv',
  'masterrecord_fields.xlsx',
  'masterrecord_fields.csv',
  'MasterRecordFields.xlsx',
  'MasterRecordFields.csv'
]

export default async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    // Accept a raw CSV (recommended) or JSON body
    const contentType = req.headers.get('content-type') || ''
    const store = getStore(CONFIG_STORE)

    // Read query flags
    const url = new URL(req.url)
    const key = url.searchParams.get('key') || 'MasterRecord Fields.csv'
    const purgeOthers = url.searchParams.get('purgeOthers') === 'true'  // ← delete .xlsx and other aliases
    const text = contentType.includes('application/json')
      ? JSON.stringify(await req.json())
      : await req.text()

    if (!text?.trim()) {
      return new Response(JSON.stringify({ error: 'Empty body' }), {
        status: 400, headers: { 'content-type': 'application/json' }
      })
    }

    // 1) Write the new map
    await store.set(key, text, { contentType: 'text/csv; charset=utf-8' })

    // 2) Optionally delete the alternates so the loader can’t pick a stale file
    let deleted = []
    if (purgeOthers) {
      for (const k of FIELD_MAP_CANDIDATE_KEYS) {
        if (k !== key) {
          try { await store.delete(k); deleted.push(k) } catch {}
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, wrote: key, deleted }), {
      status: 200, headers: { 'content-type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { 'content-type': 'application/json' }
    })
  }
}
