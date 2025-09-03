// netlify/functions/admin-llmcache.js (with job filters & stats)
// Admin API for inspecting & downloading the LLM cache CSV stored in Netlify Blobs
// Endpoints:
//   GET /api/admin-llmcache?op=tail&n=5[&jobId=...]  -> last N records (optionally filtered by jobId)
//   GET /api/admin-llmcache?op=download[&jobId=...]   -> raw CSV (all or filtered subset)
//   GET /api/admin-llmcache?op=summary[&jobId=...]    -> { rows, tokens }
//   GET /api/admin-llmcache?op=stats&jobId=...        -> per-job stats { calls, sumPrompt, sumCompletion, sumTotal }

import { getStore } from '@netlify/blobs'
import { parse as parseCsv } from 'csv-parse/sync'
import { PrismaClient } from '@prisma/client'
import authUtilsCjs from './utils/auth.js'

const prisma = globalThis.__prisma || new PrismaClient()
// @ts-ignore
globalThis.__prisma = prisma
const { getUserFromRequest } = authUtilsCjs

const STORE_NAME = process.env.LLM_CACHE_STORE || 'cache'
const CACHE_KEY = process.env.LLM_CACHE_BLOB_KEY || 'llmcache.csv'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function isAdmin(user) {
  if (!user) return false
  if (user.isAdmin === true) return true
  const allow = (process.env.ADMIN_EMAILS || '').split(/[\s,]+/).filter(Boolean).map((s) => s.toLowerCase())
  return allow.includes(String(user.email || '').toLowerCase())
}

async function readCsvRows() {
  const store = getStore(STORE_NAME)
  const text = await store.get(CACHE_KEY, { type: 'text' })
  if (!text) return { rows: [], columns: [], raw: '' }
  const rows = parseCsv(text, { columns: true, skip_empty_lines: true, trim: true })
  const columns = rows.length ? Object.keys(rows[0]) : []
  return { rows, columns, raw: text }
}

function filterByJob(rows, jobId) {
  if (!jobId) return rows
  const jid = String(jobId)
  return rows.filter((r) => String(r.jobId) === jid)
}

function statsFor(rows) {
  const toN = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  let calls = 0, sumPrompt = 0, sumCompletion = 0, sumTotal = 0
  for (const r of rows) {
    calls += 1
    sumPrompt += toN(r.prompt_tokens)
    sumCompletion += toN(r.completion_tokens)
    sumTotal += toN(r.total_tokens)
  }
  return { calls, sumPrompt, sumCompletion, sumTotal, avgPerCall: calls ? Math.round((sumTotal / calls) * 100) / 100 : 0 }
}

export default async (req) => {
  try {
    const eventLike = { headers: { cookie: req.headers.get('cookie') || '' } }
    const user = await getUserFromRequest(eventLike)
    if (!isAdmin(user)) return json({ error: 'Forbidden' }, 403)

    const url = new URL(req.url)
    const op = url.searchParams.get('op') || 'tail'
    const jobId = url.searchParams.get('jobId') || ''

    if (op === 'download') {
      const { rows, columns } = await readCsvRows()
      const filtered = filterByJob(rows, jobId)
      const header = columns.length ? columns : Object.keys(filtered[0] || {})
      const esc = (v) => /[",\n]/.test(String(v ?? '')) ? '"' + String(v ?? '').replace(/"/g, '""') + '"' : String(v ?? '')
      let out = ''
      if (header.length) out += header.join(',') + '\n'
      for (const r of filtered) {
        out += header.map((h) => esc(r[h])).join(',') + '\n'
      }
      return new Response(out, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="llmcache.csv"' } })
    }

    if (op === 'summary' || op === 'stats') {
      const { rows } = await readCsvRows()
      const filtered = filterByJob(rows, jobId)
      const s = statsFor(filtered)
      return json({ rows: filtered.length, ...s })
    }

    // default: tail
    const n = Math.max(1, Math.min(100, Number(url.searchParams.get('n') || 5)))
    const { rows, columns } = await readCsvRows()
    const filtered = filterByJob(rows, jobId)
    const tail = filtered.slice(-n)
    return json({ columns, rows: tail, count: tail.length })
  } catch (err) {
    console.error('[admin-llmcache] ERROR', err)
    return json({ error: String(err?.message ?? err) }, 500)
  }
}
