// ─────────────────────────────────────────────────────────────────────────────
// File: netlify/functions/upload.mjs (REVISED)
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
'same_day",
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


}