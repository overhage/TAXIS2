import { getStore } from '@netlify/blobs'


export default async (req) => {
if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })


const contentType = req.headers.get('content-type') || ''
if (!contentType.includes('multipart/form-data')) {
return new Response('Upload a file with form field name "file"', { status: 400 })
}


const form = await req.formData()
const file = form.get('file')
let key = form.get('key') || file?.name
if (!file || !key) return new Response('Missing file or key', { status: 400 })


const allowed = new Set([
'MasterRecord Fields.xlsx','MasterRecord Fields.csv',
'masterrecord_fields.xlsx','masterrecord_fields.csv',
'MasterRecordFields.xlsx','MasterRecordFields.csv'
])
if (!allowed.has(key)) return new Response('Key must match one of the allowed names', { status: 400 })


const arrBuf = await file.arrayBuffer()
const store = getStore('config') // Running in Netlify → no token needed
await store.set(key, arrBuf, { contentType: file.type || 'application/octet-stream' })
return new Response(JSON.stringify({ ok: true, key }), { status: 200, headers: { 'content-type': 'application/json' } })