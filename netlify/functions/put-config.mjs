// netlify/functions/put-config.mjs
// A single endpoint that renders an HTML upload form on GET and
// uploads the provided mapping file to the Netlify Blobs "config" store on POST.
// Usage:
//   Deployed:   https://<YOUR_SITE_DOMAIN>/.netlify/functions/put-config
//   Local dev:  http://localhost:8888/.netlify/functions/put-config

import { getStore } from '@netlify/blobs'

const ALLOWED_KEYS = [
  'MasterRecord Fields.xlsx',
  'MasterRecord Fields.csv',
  'masterrecord_fields.xlsx',
  'masterrecord_fields.csv',
  'MasterRecordFields.xlsx',
  'MasterRecordFields.csv'
]

const html = ({ message = '', isError = false, origin = '' } = {}) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Upload “MasterRecord Fields” → Netlify Blobs (config)</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height: 1.4; padding: 2rem; max-width: 720px; margin: 0 auto; }
    .box { border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.25rem; }
    .msg { margin: 1rem 0; padding: .75rem 1rem; border-radius: 8px; }
    .msg.ok { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    .msg.err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
    label { display: block; margin: .5rem 0 .25rem; font-weight: 600; }
    input[type="text"], input[type="file"] { width: 100%; padding: .5rem; border: 1px solid #d1d5db; border-radius: 8px; }
    button { display: inline-flex; align-items: center; gap: .5rem; margin-top: 1rem; padding: .6rem 1rem; border-radius: 8px; border: 1px solid #d1d5db; background: #111827; color: white; cursor: pointer; }
    ul { margin: .25rem 0 .75rem 1rem; }
    code { background: #f3f4f6; padding: .1rem .3rem; border-radius: 4px; }
    small { color: #6b7280; }
  </style>
</head>
<body>
  <h1>Upload <em>MasterRecord Fields</em> → Netlify Blobs (<code>config</code> store)</h1>
  <div class="box">
    ${message ? `<div class="msg ${isError ? 'err' : 'ok'}">${message}</div>` : ''}
    <form method="POST" action="${origin || ''}" enctype="multipart/form-data">
      <label for="file">File (CSV or XLSX)</label>
      <input id="file" type="file" name="file" required accept=".csv,.xlsx,.xls" />

      <label for="key">Key (optional; must match one of the allowed names)</label>
      <input id="key" type="text" name="key" list="allowed-keys" placeholder="MasterRecord Fields.xlsx" />
      <datalist id="allowed-keys">
        ${ALLOWED_KEYS.map(k => `<option>${k}</option>`).join('')}
      </datalist>

      <button type="submit">Upload to Blobs</button>
      <div><small>POST target: <code>${origin || '/.netlify/functions/put-config'}</code></small></div>
    </form>
    <p><strong>Allowed keys</strong> the app will auto-discover:</p>
    <ul>
      ${ALLOWED_KEYS.map(k => `<li><code>${k}</code></li>`).join('')}
    </ul>
    <p><small>Local dev? Start <code>netlify dev</code> and visit <code>http://localhost:8888/.netlify/functions/put-config</code>.</small></p>
  </div>
</body>
</html>`

const inferContentType = (filename = '', fallback = 'application/octet-stream') => {
  const lower = String(filename).toLowerCase()
  if (lower.endsWith('.csv')) return 'text/csv'
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel'
  return fallback
}

export default async (req) => {
  try {
    const url = new URL(req.url)
    const selfPath = `${url.origin}${url.pathname}` // used to keep form action pointing here

    if (req.method === 'GET') {
      return new Response(html({ origin: selfPath }), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }

    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, POST' } })
    }

    const ct = req.headers.get('content-type') || ''
    if (!ct.includes('multipart/form-data')) {
      return new Response(html({ origin: selfPath, isError: true, message: 'Expected multipart/form-data with a file field named “file”.' }), { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } })
    }

    const form = await req.formData()
    const file = form.get('file')
    let key = (form.get('key') || '').toString().trim()

    if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
      return new Response(html({ origin: selfPath, isError: true, message: 'Missing file.' }), { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } })
    }

    if (!key) key = file.name
    if (!key) {
      return new Response(html({ origin: selfPath, isError: true, message: 'Missing key name and file has no name.' }), { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } })
    }

    if (!ALLOWED_KEYS.includes(key)) {
      return new Response(html({ origin: selfPath, isError: true, message: `Key “${key}” is not allowed. Choose one of: ${ALLOWED_KEYS.join(', ')}` }), { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } })
    }

    const arrBuf = await file.arrayBuffer()
    const store = getStore('config') // In Netlify, siteID/token are inferred
    const contentType = file.type || inferContentType(key)

    await store.set(key, arrBuf, { contentType })

    return new Response(html({ origin: selfPath, isError: false, message: `✅ Uploaded to Blobs config store as “${key}”.` }), { headers: { 'content-type': 'text/html; charset=utf-8' } })
  } catch (err) {
    const msg = String(err?.message ?? err)
    return new Response(html({ isError: true, message: `Upload failed: ${msg}` }), { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
}
