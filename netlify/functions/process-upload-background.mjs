// netlify/functions/process-upload-background.mjs


import { getStore } from '@netlify/blobs'
import { parse as parseCsv } from 'csv-parse/sync'
import * as XLSX from 'xlsx'
import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'

const prisma = globalThis.__prisma ?? new PrismaClient()

if (!globalThis.__prisma) {
  globalThis.__prisma = prisma
}

export { prisma }

// ===== Configs =====
const MAX_RUN_MS = Number(process.env.MAX_RUN_MS || 12 * 60 * 1000)
const FLUSH_EVERY_ROWS = Number(process.env.FLUSH_EVERY_ROWS || 50)
const FLUSH_EVERY_MS = Number(process.env.FLUSH_EVERY_MS || 5000)
const PRIMARY_MODEL = process.env.OPENAI_API_MODEL || 'gpt-4o-mini'
const MODEL_FALLBACKS = [PRIMARY_MODEL, 'gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'].filter(Boolean)
const LLM_CACHE_STORE = process.env.LLM_CACHE_STORE || 'cache'
const LLM_CACHE_BLOB_KEY = process.env.LLM_CACHE_BLOB_KEY || 'llmcache.csv'

// Where to find the MasterRecord mapping spreadsheet
const CONFIG_STORE = process.env.CONFIG_STORE || 'config'
const FIELD_MAP_CANDIDATE_KEYS = [
  'MasterRecord Fields.xlsx',
  'MasterRecord Fields.csv',
  'masterrecord_fields.xlsx',
  'masterrecord_fields.csv',
  'MasterRecordFields.xlsx',
  'MasterRecordFields.csv'
]

// ===== Relationship categories (unchanged) =====
const RELATIONSHIP_TYPES = {
  1: 'A causes B',
  2: 'B causes A',
  3: 'A indirectly causes B',
  4: 'B indirectly causes A',
  5: 'A and B share common cause',
  6: 'Treatment of A causes B',
  7: 'Treatment of B causes A',
  8: 'A and B have similar initial presentations',
  9: 'A is subset of B',
  10: 'B is subset of A',
  11: 'No clear relationship'
}

const ALLOWED_TYPES = new Set(['condition', 'procedure', 'medication', 'other'])
const normalizeOptionalType = (v) => {
  if (v == null) return null
  const s = String(v).trim().toLowerCase()
  if (!s) return null
  return ALLOWED_TYPES.has(s) ? s: 'other'
}
const numOrZero = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const makePairId = ({ system_a, code_a, system_b, code_b }) => [system_a, code_a, system_b, code_b].map(x => String(x ?? '').trim().toUpperCase()).join('|')

// Fields that are Ints in Prisma (all lower-case for matching)
const INT_FIELDS = new Set([
  'cooc_obs','cooc_event_count','a_before_b','same_day','b_before_a',
  'na', 'nb', 'total_persons', 'source_count', 'relationshipcode'
])

// Fields that are numeric/decimal in Prisma (all lower-case)
const FLOAT_FIELDS = new Set([
  'lift','lift_lower_95','lift_upper_95','z_score',
  'ab_h','a_only_h','b_only_h','neither_h',
  'odds_ratio','or_lower_95','or_upper_95',
  'directionality_ratio','dir_prop_a_before_b',
  'dir_lower_95','dir_upper_95',
  'confidence_a_to_b','confidence_b_to_a'
])

const toFloatOrNull = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function stablePromptKey(row) {
  // Include only the fields that define the prompt/response semantics
  const payload = {
    model: row.model ?? '',
    pairId: row.pairId ?? '',
    system_a: row.system_a ?? '',
    code_a: row.code_a ?? '',
    system_b: row.system_b ?? '',
    code_b: row.code_b ?? '',
    concept_a_t: row.concept_a_t ?? '',
    concept_b_t: row.concept_b_t ?? '',
    relationship_code: row.relationship_code ?? '',
    relationship_type: row.relationship_type ?? '',
    prompt_version: process.env.PROMPT_VERSION ?? 'v1'
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function getExtFromName (name = '') { const i = name.lastIndexOf('.'); return i >= 0 ? name.slice(i).toLowerCase() : '.csv' }

function parseUploadBufferToRows (buffer, originalName) {
  const ext = getExtFromName(originalName)
  if (ext === '.csv') {
    const text = Buffer.from(buffer).toString('utf-8')
    return parseCsv(text, { columns: true, skip_empty_lines: true, trim: true })
  }
  if (ext === '.xlsx' || ext === '.xls') {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const sheet = wb.SheetNames[0]
    return XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' })
  }
  throw new Error(`Unsupported file type: ${ext}`)
}

function pickEventsAb (row) { const v = row.cooc_event_count ?? row.events_ab ?? row.cooc_obs ?? 0; return Number(v) || 0 }
function pickEventsAe (row) {
  if (row.events_ab_ae != null) return Number(row.events_ab_ae) || 1.0
  if (row.lift != null) return Number(row.lift) || 1.0
  const lo = Number(row.lift_lower_95 ?? NaN), hi = Number(row.lift_upper_95 ?? NaN)
  if (Number.isFinite(lo) && Number.isFinite(hi)) return (lo + hi) / 2
  return 1.0
}

// ===== Field map loader =====
const normalizeKey = (s) => String(s || '').trim()
const lc = (s) => normalizeKey(s).toLowerCase()
const looksLike = (s, ...needles) => {
  const L = lc(s)
  return needles.some(n => L.includes(n))
}

async function loadFieldMap () {
  const store = getStore(CONFIG_STORE)
  for (const key of FIELD_MAP_CANDIDATE_KEYS) {
    try {
      const buf = await store.get(key, { type: 'arrayBuffer' })
      if (!buf) continue
      const ext = getExtFromName(key)
      let rows
      if (ext === '.csv') {
        const text = Buffer.from(buf).toString('utf-8')
        rows = parseCsv(text, { columns: true, skip_empty_lines: true, trim: true })
      } else {
        const wb = XLSX.read(buf, { type: 'buffer' })
        const sheet = wb.SheetNames[0]
        rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' })
      }
      if (!rows || rows.length === 0) continue

      const header = Object.keys(rows[0] || {})
      const findCol = (predicates) => header.find(h => predicates(lc(h)))
      const uploadColName = findCol(h => looksLike(h, 'upload spreadsheet column', 'upload', 'spreadsheet'))
      const prismaColName = findCol(h => looksLike(h, 'prisma master', 'prisma mater', 'prisma', 'field'))
      const categoryColName = findCol(h => looksLike(h, 'category'))
      if (!uploadColName || !prismaColName) {
        console.warn('[field-map] Missing expected headers in', key, header)
        continue
      }
      const map = []
      for (const r of rows) {
        const upload = normalizeKey(r[uploadColName])
        const prisma = normalizeKey(r[prismaColName])
        const category = normalizeKey(categoryColName ? r[categoryColName] : '')
        if (!upload || !prisma) continue
        map.push({ uploadCol: upload, prismaField: prisma, category })
      }
      if (map.length) {
        console.log(`[field-map] loaded ${map.length} mappings from`, key)
        return map
      }
    } catch (e) {
      console.warn('[field-map] failed to load', key, e?.message || e)
    }
  }
  console.warn('[field-map] No mapping file found in config store; falling back to legacy behavior')
  return []
}

const isCountCategory = (c) => /^(count|counts)$/i.test(String(c || ''))
const isStatCategory = (c) => /^stat/i.test(String(c || '')) // e.g., 'Stat', 'Statistical'

function buildCreateDataFromRow (row, fieldMap) {
  const data = {}
  for (const m of fieldMap) {
    const src = row[m.uploadCol]
    if (src === undefined) continue

    const field = m.prismaField
    const fieldLc = String(field || '').toLowerCase()

    // Prefer category hints first…
    if (isCountCategory(m.category)) {
      data[field] = numOrZero(src)               // Int
    } else if (isStatCategory(m.category)) {
      data[field] = toFloatOrNull(src)           // Float/Decimal
    } else {
      // …then fall back to explicit field lists (case-insensitive)
      if (INT_FIELDS.has(fieldLc)) data[field] = numOrZero(src)
      else if (FLOAT_FIELDS.has(fieldLc)) data[field] = toFloatOrNull(src)
      else data[field] = src ?? null
    }
  }
  return data
}


function buildUpdateDataFromRow (existing, row, fieldMap) {
  const data = {}
  for (const m of fieldMap) {
    const src = row[m.uploadCol]
    if (src === undefined) continue
    const field = m.prismaField
    const fieldLc = String(field || '').toLowerCase()

    if (isCountCategory(m.category)) {
      data[field] = numOrZero(existing?.[field]) + numOrZero(src)
    } else if (isStatCategory(m.category)) {
      // skip statistical fields
      continue
    } else if (INT_FIELDS.has(fieldLc)) {
      // additive for counts even if category missing
      data[field] = numOrZero(existing?.[field]) + numOrZero(src)
    } else {
      // only backfill non-numeric fields when empty
      const cur = existing?.[field]
      const isEmpty = cur === null || cur === undefined || (typeof cur === 'string' && cur.trim() === '')
      if (isEmpty) data[field] = src
    }
  }
  data.source_count = numOrZero(existing?.source_count) + 1
  return data
}

function toIntStrict(v) {
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) return null;        // reject "123abc", "1.2", "", "I10"
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;  // guard against > 2^53-1
}

// ===== OMOP Concept lookup =====
const conceptCache = new Map()
async function lookupConceptMeta (conceptId) {
  const cid = toIntStrict(conceptId)
  if (cid == null) return null
  if (conceptCache.has(cid)) return conceptCache.get(cid)
  try {
    console.log(`[lookupConceptMetaByAny] inside try  codeOrId=${String(conceptId)}  cid=${String(cid)}`) 
    const c = await prisma.omopCdmConcept.findUnique({ where: { concept_id: cid } })
      .catch(async () => await prisma.omopCdmConcept.findFirst({ where: { concept_id: cid } }))
    console.log(`[lookupConceptMetaByAny] before not check concept_id=${String(conceptId)}  cid=${String(cid)}  name="${c?.concept_name ?? ''}"  vocabulary_id=${c?.vocabulary_id ?? ''}  concept_class_id=${c?.concept_class_id ?? ''}  domain_id=${c?.domain_id ?? ''}`)  
    if (!c) { conceptCache.set(cid, null); return null }
    console.log(`[lookupConceptMetaByAny] OUT concept_id=${String(conceptId)}  cid=${String(cid)}  name="${c?.concept_name ?? ''}"  vocabulary_id=${c?.vocabulary_id ?? ''}  concept_class_id=${c?.concept_class_id ?? ''}  domain_id=${c?.domain_id ?? ''}`)
    const meta = { concept_name: c.concept_name || '', vocabulary_id: c.vocabulary_id || '', concept_class_id: c.concept_class_id || '' }
    conceptCache.set(cid, meta)
    return meta
  } catch {
    conceptCache.set(cid, null)
    return null
  }
}
function coalesceType (metaClassId, uploadType) {
  if (metaClassId && String(metaClassId).trim()) return String(metaClassId)
  const n = normalizeOptionalType(uploadType)
  return typeof n === 'string' ? n : null
}

// ===== LLM classification (unchanged) =====
async function classifyRelationship ({ conceptAText, conceptBText, events_ab, events_ab_ae }) {
  const prompt = (
    `You are an expert diagnostician skilled at identifying clinical relationships between ICD-10-CM diagnosis concepts.\n` +
    `Statistical indicators provided:\n` +
    `- events_ab (co-occurrences): ${events_ab}\n` +
    `- events_ab_ae (actual-to-expected ratio): ${Number(events_ab_ae ?? 0).toFixed(2)}\n\n` +
    `Interpretation guidelines:\n` +
    `- ≥ 2.0: Strong statistical evidence; carefully consider relationships.\n` +
    `- 1.5–1.99: Moderate evidence; cautious evaluation.\n` +
    `- 1.0–1.49: Weak evidence; rely primarily on clinical knowledge.\n` +
    `- < 1.0: Minimal evidence; avoid indirect/speculative claims.\n\n` +
    `Explicit guidelines to avoid speculation:\n` +
    `- Direct causation: Only if explicit and clinically accepted.\n` +
    `  Example: Pneumonia causes cough.\n\n` +
    `- Indirect causation: Only with explicit and named intermediate diagnosis.\n` +
    `  Example: Pneumonia → sepsis → acute kidney injury.\n\n` +
    `- Common cause: Only with clearly documented third diagnosis.\n` +
    `  Example: Obesity clearly causing both diabetes type 2 and osteoarthritis.\n\n` +
    `- Treatment-caused: Only if explicitly well-documented.\n` +
    `  Example: Chemotherapy for cancer causing nausea.\n\n` +
    `- Similar presentations: Only if clinically documented similarity exists.\n\n` +
    `- Subset relationship: Explicitly broader or unspecified form.\n\n` +
    `If evidence or explicit documentation is lacking, choose category 11 (No clear relationship).\n\n` +
    `Classify explicitly the relationship between:\n` +
    `- Concept A: ${conceptAText}\n` +
    `- Concept B: ${conceptBText}\n\n` +
    `Categories:\n` +
    `1: A causes B\n2: B causes A\n3: A indirectly causes B (explicit intermediate required)\n4: B indirectly causes A (explicit intermediate required)\n5: A and B share common cause (explicit third condition required)\n6: Treatment of A causes B (explicit treatment documentation required)\n7: Treatment of B causes A (explicit treatment documentation required)\n8: A and B have similar initial presentations\n9: A is subset of B\n10: B is subset of A\n11: No clear relationship (default)\n\n` +
    `Answer exactly as "<number>: <short description>: <concise rationale>".`
  )

  console.log('[LLM] model candidates:', MODEL_FALLBACKS.join(', '))
  let lastErrText = ''
  for (const model of MODEL_FALLBACKS) {
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'user', content: prompt }] })
      })
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        console.error('[LLM] HTTP error', resp.status, text)
        lastErrText = text
        if (resp.status === 403 || resp.status === 404 || /model_not_found/.test(text)) continue
        break
      }
      const data = await resp.json()
      const reply = data?.choices?.[0]?.message?.content?.trim() || ''
      const parts = reply.split(': ')
      const relCode = parseInt(parts[0]?.trim(), 10)
      const relType = (parts[1] || '').trim() || RELATIONSHIP_TYPES[relCode] || RELATIONSHIP_TYPES[11]
      const rationalText = (parts.slice(2).join(': ') || '').trim() || '—'
      const safeCode = Number.isFinite(relCode) ? relCode : 11
      const usage = data?.usage || {}
      return { relCode: safeCode, relType, rationalText, usedModel: model, usage }
    } catch (e) {
      console.error('[LLM] exception for model', model, e?.message || e)
    }
  }
  return { relCode: 11, relType: RELATIONSHIP_TYPES[11], rationalText: lastErrText ? `LLM error: ${lastErrText.slice(0, 200)}` : 'LLM unavailable', usedModel: MODEL_FALLBACKS[0], usage: {} }
}

// (re)define CSV line helper (may have been dropped during edits)
function rowToCsvLine (row, headers) {
  const esc = (v) => {
    const s = String(v ?? '')
    // Quote if the field contains a quote, comma, or newline (CR or LF)
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return headers.map((h) => esc(row[h])).join(',')
}

function ensureHeader (existingCsvText, headersFromSample) {
  if (existingCsvText && existingCsvText.length > 0) {
    const firstNl = existingCsvText.indexOf('\n')
    const headerLine = firstNl >= 0 ? existingCsvText.slice(0, firstNl) : existingCsvText
    const headers = headerLine.split(',')
    return { headers, csvText: existingCsvText, headerExists: true }
  }
  const uniq = Array.from(new Set(headersFromSample || []))
  const headerLine = uniq.join(',') + '\n'
  return { headers: uniq, csvText: headerLine, headerExists: false }
}

// Coerce numeric fields (case-insensitive) right before DB writes
function coerceTypesInPlace(obj) {
  for (const key of Object.keys(obj || {})) {
    const lc = key.toLowerCase()
    if (INT_FIELDS.has(lc)) {
      obj[key] = numOrZero(obj[key])
    } else if (FLOAT_FIELDS.has(lc)) {
      obj[key] = toFloatOrNull(obj[key])
    }
  }
  return obj
}

export default async (req) => {
  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { 'content-type': 'text/plain; charset=utf-8' } })
    const { jobId } = await req.json()
    if (!jobId) return new Response(JSON.stringify({ error: 'Missing jobId' }), { status: 400, headers: { 'content-type': 'application/json' } })

    const job = await prisma.job.findUnique({ where: { id: jobId } })
    if (!job) return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
    if (job.status === 'completed' || job.status === 'failed') return new Response(JSON.stringify({ ok: true, status: job.status }), { status: 202, headers: { 'content-type': 'application/json' } })

    await prisma.job.update({ where: { id: jobId }, data: { status: 'running', startedAt: job.startedAt ?? new Date() } })

    const upload = await prisma.upload.findUnique({ where: { id: job.uploadId } })
    if (!upload) throw new Error('Upload record not found')

    const uploadsStore = getStore('uploads')
    const outputsStore = getStore('outputs')
    const cacheStore = getStore(LLM_CACHE_STORE)

    const buffer = await uploadsStore.get(upload.blobKey, { type: 'arrayBuffer' })
    if (!buffer) throw new Error('Uploaded blob not found')

    const rows = parseUploadBufferToRows(buffer, upload.originalName || upload.blobKey)

    // Load field mapping once per run (may be empty)
    const fieldMap = await loadFieldMap()

    const rowsTotal = job.rowsTotal && job.rowsTotal > 0 ? job.rowsTotal : rows.length
    if (rowsTotal !== job.rowsTotal) await prisma.job.update({ where: { id: jobId }, data: { rowsTotal } })

    let offset = job.rowsProcessed || 0
    if (offset >= rowsTotal) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'completed', finishedAt: new Date() } })
      return new Response(JSON.stringify({ ok: true, status: 'completed' }), { status: 202, headers: { 'content-type': 'application/json' } })
    }

    const outputBlobKey = job.outputBlobKey || `outputs/${jobId}.csv`
    if (!job.outputBlobKey) await prisma.job.update({ where: { id: jobId }, data: { outputBlobKey } })

    let mainCsvText = (await outputsStore.get(outputBlobKey, { type: 'text' })) || ''

    let llmCacheText = null
    let llmCacheHeaders = ['timestamp','jobId','uploadId','userId','rowIndex','pairId','system_a','code_a','system_b','code_b','concept_a_t','concept_b_t','model','relationship_code','relationship_type','prompt_tokens','completion_tokens','total_tokens']
    const llmCacheBatch = []

    const start = Date.now()
    let lastFlush = Date.now()
    let processedThisRun = 0
    let mainHeader = null

    for (; offset < rowsTotal; offset++) {
      const row = rows[offset]
      // Raw values from upload
      const system_a_raw = String(row.system_a ?? '').trim()
      const system_b_raw = String(row.system_b ?? '').trim()
      const code_a_raw = String(row.code_a ?? row.concept_a ?? '').trim()
      const code_b_raw = String(row.code_b ?? row.concept_b ?? '').trim()
      const type_a_raw = row.type_a
      const type_b_raw = row.type_b

      // OMOP lookups by concept_id
      const [metaA, metaB] = await Promise.all([
        lookupConceptMeta(code_a_raw),
        lookupConceptMeta(code_b_raw)
      ])

      // Effective values (prefer OMOP)
      const code_a = code_a_raw
      const code_b = code_b_raw
      const concept_a_name = (metaA?.concept_name || '').trim() || String(row.concept_a ?? code_a)
      const concept_b_name = (metaB?.concept_name || '').trim() || String(row.concept_b ?? code_b)
      const system_a_eff = (metaA?.vocabulary_id || '').trim() || system_a_raw
      const system_b_eff = (metaB?.vocabulary_id || '').trim() || system_b_raw
      const type_a_eff = coalesceType(metaA?.concept_class_id, type_a_raw)
      const type_b_eff = coalesceType(metaB?.concept_class_id, type_b_raw)

      const pairId = makePairId({ system_a: system_a_eff, code_a, system_b: system_b_eff, code_b })

      let existing = null
      try { existing = await prisma.masterRecord.findUnique({ where: { pairId } }) } catch { existing = await prisma.masterRecord.findFirst({ where: { pairId } }) }

      let relCode, relType, rationalText, usedModel, usage

      if (!existing) {
        const events_ab = pickEventsAb(row)
        const events_ab_ae = pickEventsAe(row)
        const cls = await classifyRelationship({ conceptAText: concept_a_name, conceptBText: concept_b_name, events_ab, events_ab_ae })
        ;({ relCode, relType, rationalText, usedModel, usage } = cls)

        // Base create data (authoritative from OMOP for identity fields)
        const baseCreate = {
          pairId,
          concept_a: concept_a_name,
          code_a,
          concept_b: concept_b_name,
          code_b,
          system_a: system_a_eff,
          system_b: system_b_eff,
          type_a: typeof type_a_eff === 'string' ? type_a_eff : null,
          type_b: typeof type_b_eff === 'string' ? type_b_eff : null,
          relationshipType: relType,
          relationshipCode: Number(relCode),
          rational: rationalText,
          llm_name: 'OpenAI Chat Completions',
          llm_version: usedModel || PRIMARY_MODEL,
          llm_date: new Date(),
          source_count: 1
        }

        // Copy mapped fields (guard identity/LLM fields to avoid clobbering OMOP-derived fields)
        const mappedCreate = fieldMap.length ? buildCreateDataFromRow(row, fieldMap) : {}
        const guarded = { ...mappedCreate }
        delete guarded.pairId
        delete guarded.relationshipType
        delete guarded.relationshipCode
        delete guarded.rational
        delete guarded.llm_name
        delete guarded.llm_version
        delete guarded.llm_date
        delete guarded.source_count
        delete guarded.concept_a
        delete guarded.concept_b
        delete guarded.system_a
        delete guarded.system_b
        delete guarded.type_a
        delete guarded.type_b
        delete guarded.code_a
        delete guarded.code_b

        const createData = coerceTypesInPlace({ ...baseCreate, ...guarded })


        console.log('[dbg] mappedCreate keys', Object.keys(mappedCreate))
        console.log('[dbg] guarded cooc_obs typeof=', typeof guarded.cooc_obs, 'value=', guarded.cooc_obs)
        console.log('[dbg] createData cooc_obs typeof=', typeof createData.cooc_obs, 'value=', createData.cooc_obs)

        await prisma.masterRecord.create({ data: createData })

        // previous verison, can revert and delete the const createData once debugged
        // await prisma.masterRecord.create({ data: coerceTypesInPlace({ ...baseCreate, ...guarded }) })

        // LLM cache line
        llmCacheBatch.push({
          timestamp: new Date().toISOString(),
          jobId,
          uploadId: job.uploadId,
          userId: job.userId,
          rowIndex: String(offset),
          pairId,
          system_a: system_a_eff,
          code_a,
          system_b: system_b_eff,
          code_b,
          concept_a_t: concept_a_name,
          concept_b_t: concept_b_name,
          model: usedModel || PRIMARY_MODEL,
          relationship_code: String(relCode),
          relationship_type: relType,
          prompt_tokens: String(usage?.prompt_tokens ?? ''),
          completion_tokens: String(usage?.completion_tokens ?? ''),
          total_tokens: String(usage?.total_tokens ?? '')
        })
      } else {
        // Preserve previous classification fields
        relCode = Number(existing.relationshipCode ?? 11) || 11
        relType = String(existing.relationshipType ?? RELATIONSHIP_TYPES[11])
        rationalText = String(existing.rational ?? '')
        usedModel = existing.llm_version || PRIMARY_MODEL

        // Mapping-driven updates (adds counts; skip stats; increments source_count)
        let mappedUpdate = fieldMap.length ? buildUpdateDataFromRow(existing, row, fieldMap) : {
          cooc_event_count: numOrZero(existing?.cooc_event_count) + numOrZero(row.cooc_event_count),
          source_count: numOrZero(existing?.source_count) + 1
        }

        // Refresh concept/system/type fields from OMOP (authoritative)
        mappedUpdate = {
          ...mappedUpdate,
          concept_a: concept_a_name || existing.concept_a,
          concept_b: concept_b_name || existing.concept_b,
          system_a: system_a_eff || existing.system_a,
          system_b: system_b_eff || existing.system_b,
          ...(typeof type_a_eff === 'string' ? { type_a: type_a_eff } : {}),
          ...(typeof type_b_eff === 'string' ? { type_b: type_b_eff } : {}),
          updatedAt: new Date()
        }

        await prisma.masterRecord.update({
          where: existing?.id ? { id: existing.id } : { pairId },
          data: coerceTypesInPlace(mappedUpdate)
        })
      }

      const enriched = {
        ...row,
        code_a,
        code_b,
        system_a: system_a_eff,
        system_b: system_b_eff,
        concept_a: concept_a_name,
        concept_b: concept_b_name,
        type_a: typeof type_a_eff === 'string' ? type_a_eff : '',
        type_b: typeof type_b_eff === 'string' ? type_b_eff : '',
        relationship_type: relType,
        relationship_code: String(relCode),
        rational: rationalText
      }

      if (!mainHeader) {
        const prime = ensureHeader(mainCsvText, Object.keys(enriched))
        mainHeader = prime.headers; mainCsvText = prime.csvText
      }
      mainCsvText += rowToCsvLine(enriched, mainHeader) + '\n'

      processedThisRun += 1
      const now = Date.now()
      const timeUp = now - start > MAX_RUN_MS - 15_000
      const needFlush = processedThisRun % FLUSH_EVERY_ROWS === 0 || now - lastFlush > FLUSH_EVERY_MS || timeUp

      if (needFlush) {
        await outputsStore.set(outputBlobKey, mainCsvText, { contentType: 'text/csv' })
        if (llmCacheBatch.length > 0) {
          if (llmCacheText == null) llmCacheText = (await cacheStore.get(LLM_CACHE_BLOB_KEY, { type: 'text' })) || ''
          const prime = ensureHeader(llmCacheText, llmCacheHeaders)
          const headers = prime.headers; llmCacheText = prime.csvText
          for (const cacheRow of llmCacheBatch) llmCacheText += rowToCsvLine(cacheRow, headers) + '\n'
          await cacheStore.set(LLM_CACHE_BLOB_KEY, llmCacheText, { contentType: 'text/csv' })
          llmCacheBatch.length = 0
        }
        await prisma.job.update({ where: { id: jobId }, data: { rowsProcessed: offset + 1, outputBlobKey } })
        lastFlush = now
      }

if (llmCacheBatch.length) {
  const rowsForDb = llmCacheBatch.map(r => ({
    promptKey: stablePromptKey(r),
    // Store the whole row so you keep everything you already capture
    result: JSON.stringify(r),
    tokensIn: Number.isFinite(+r.prompt_tokens) ? +r.prompt_tokens : null,
    tokensOut: Number.isFinite(+r.completion_tokens) ? +r.completion_tokens : null,
    model: r.model ?? null
  }))

  try {
    // Fast path for Postgres; ignores duplicates by promptKey
    await prisma.llmCache.createMany({ data: rowsForDb, skipDuplicates: true })
  } catch (e) {
    // Fallback: idempotent upserts (slower, but safe everywhere)
    for (const d of rowsForDb) {
      try {
        await prisma.llmCache.upsert({
          where: { promptKey: d.promptKey },
          create: d,
          update: {
            // If you want “first write wins”, remove this update block
            result: d.result,
            tokensIn: d.tokensIn,
            tokensOut: d.tokensOut,
            model: d.model
          }
        })
      } catch (e2) {
        console.warn('[llmcache.upsert] failed', e2?.message || e2)
      }
    }
  }

  // Clear the in-memory batch (you already do this for the blob path)
  llmCacheBatch.length = 0
}


      if (timeUp) break
    }

    await getStore('outputs').set(outputBlobKey, mainCsvText, { contentType: 'text/csv' })
    if (llmCacheBatch.length > 0) {
      const cacheStore2 = getStore(LLM_CACHE_STORE)
      let cacheText2 = (await cacheStore2.get(LLM_CACHE_BLOB_KEY, { type: 'text' })) || ''
      const prime = ensureHeader(cacheText2, llmCacheHeaders)
      const headers = prime.headers; cacheText2 = prime.csvText
      for (const cacheRow of llmCacheBatch) cacheText2 += rowToCsvLine(cacheRow, headers) + '\n'
      await cacheStore2.set(LLM_CACHE_BLOB_KEY, cacheText2, { contentType: 'text/csv' })
    }
    await prisma.job.update({ where: { id: jobId }, data: { rowsProcessed: offset, outputBlobKey } })

    if (offset >= rowsTotal) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'completed', finishedAt: new Date() } })
      return new Response(JSON.stringify({ ok: true, status: 'completed' }), { status: 202, headers: { 'content-type': 'application/json' } })
    }

    // re‑invoke to continue
    try {
      const host = req.headers.get('x-forwarded-host')
      const proto = req.headers.get('x-forwarded-proto') || 'https'
      const origin = process.env.URL || (host ? `${proto}://${host}` : '')
      if (origin) {
        await fetch(`${origin}/.netlify/functions/process-upload-background`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId }) })
      }
    } catch (e) {
      console.warn('[self-chain] failed to re-invoke background function:', e?.message || e)
    }

    return new Response(JSON.stringify({ ok: true, status: 'running' }), { status: 202, headers: { 'content-type': 'application/json' } })
  } catch (err) {
    console.error('[process-upload-background] ERROR', err)
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), { status: 500, headers: { 'content-type': 'application/json' } })
  }
}
