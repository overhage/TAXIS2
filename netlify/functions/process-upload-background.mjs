// netlify/functions/process-upload-background.mjs (LLM cache linked)
// Background worker: resumable, time‑boxed, single CSV merged as it goes
// Adds per‑LLM‑call logging to a Blobs CSV cache (job‑linked) for later analytics.

import { getStore } from '@netlify/blobs';
import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';

const prisma = globalThis.__prisma || new PrismaClient();
// @ts-ignore
globalThis.__prisma = prisma;

// ===== Configs =====
const MAX_RUN_MS = Number(process.env.MAX_RUN_MS || 12 * 60 * 1000); // ~12 minutes
const FLUSH_EVERY_ROWS = Number(process.env.FLUSH_EVERY_ROWS || 50);
const FLUSH_EVERY_MS = Number(process.env.FLUSH_EVERY_MS || 5000);
const PRIMARY_MODEL = process.env.OPENAI_API_MODEL || 'gpt-4o-mini';
const MODEL_FALLBACKS = [PRIMARY_MODEL, 'gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'].filter(Boolean);
const LLM_CACHE_STORE = process.env.LLM_CACHE_STORE || 'cache';
const LLM_CACHE_BLOB_KEY = process.env.LLM_CACHE_BLOB_KEY || 'llmcache.csv';

// ===== Relationship categories (labels only used for sanity fallback) =====
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
  11: 'No clear relationship',
};

const ALLOWED_TYPES = new Set(['condition', 'procedure', 'medication', 'other']);
const normalizeOptionalType = (v) => {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  return ALLOWED_TYPES.has(s) ? s : 'other';
};
const numOrZero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const makePairId = ({ system_a, code_a, system_b, code_b }) => {
  const norm = (x) => String(x ?? '').trim().toUpperCase();
  return [norm(system_a), norm(code_a), norm(system_b), norm(code_b)].join('|');
};

function getExtFromName(name = '') {
  if (!name) return '.csv';
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '.csv';
}

function parseUploadBufferToRows(buffer, originalName) {
  const ext = getExtFromName(originalName);
  if (ext === '.csv') {
    const text = Buffer.from(buffer).toString('utf-8');
    return parseCsv(text, { columns: true, skip_empty_lines: true, trim: true });
  }
  if (ext === '.xlsx' || ext === '.xls') {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.SheetNames[0];
    return XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' });
  }
  throw new Error(`Unsupported file type: ${ext}`);
}

function pickConceptText(row) {
  return {
    a: String(row.concept_a_t ?? row.concept_a ?? '').trim(),
    b: String(row.concept_b_t ?? row.concept_b ?? '').trim(),
  };
}
function pickEventsAb(row) {
  const v = row.cooc_event_count ?? row.events_ab ?? row.cooc_obs ?? 0;
  return Number(v) || 0;
}
function pickEventsAe(row) {
  if (row.events_ab_ae != null) return Number(row.events_ab_ae) || 1.0;
  if (row.lift != null) return Number(row.lift) || 1.0;
  const lo = Number(row.lift_lower_95 ?? NaN);
  const hi = Number(row.lift_upper_95 ?? NaN);
  if (Number.isFinite(lo) && Number.isFinite(hi)) return (lo + hi) / 2;
  return 1.0;
}

async function classifyRelationship({ conceptAText, conceptBText, events_ab, events_ab_ae }) {
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
      `1: A causes B\n` +
      `2: B causes A\n` +
      `3: A indirectly causes B (explicit intermediate required)\n` +
      `4: B indirectly causes A (explicit intermediate required)\n` +
      `5: A and B share common cause (explicit third condition required)\n` +
      `6: Treatment of A causes B (explicit treatment documentation required)\n` +
      `7: Treatment of B causes A (explicit treatment documentation required)\n` +
      `8: A and B have similar initial presentations\n` +
      `9: A is subset of B\n` +
      `10: B is subset of A\n` +
      `11: No clear relationship (default)\n\n` +
      `Answer exactly as "<number>: <short description>: <concise rationale>".`
  );

  console.log('[LLM] model candidates:', MODEL_FALLBACKS.join(', '));
  let lastErrText = '';
  for (const model of MODEL_FALLBACKS) {
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.error('[LLM] HTTP error', resp.status, text);
        lastErrText = text;
        if (resp.status === 403 || resp.status === 404 || /model_not_found/.test(text)) continue; // try next
        break; // other error; stop trying
      }
      const data = await resp.json();
      const reply = data?.choices?.[0]?.message?.content?.trim() || '';
      const parts = reply.split(': ');
      const relCode = parseInt(parts[0]?.trim(), 10);
      const relType = (parts[1] || '').trim() || RELATIONSHIP_TYPES[relCode] || RELATIONSHIP_TYPES[11];
      const rationalText = (parts.slice(2).join(': ') || '').trim() || '—';
      const safeCode = Number.isFinite(relCode) ? relCode : 11;
      const usage = data?.usage || {};
      return { relCode: safeCode, relType, rationalText, usedModel: model, usage };
    } catch (e) {
      console.error('[LLM] exception for model', model, e?.message || e);
    }
  }
  return { relCode: 11, relType: RELATIONSHIP_TYPES[11], rationalText: lastErrText ? `LLM error: ${lastErrText.slice(0, 200)}` : 'LLM unavailable', usedModel: MODEL_FALLBACKS[0], usage: {} };
}

function ensureHeader(existingCsvText, headersFromSample) {
  if (existingCsvText && existingCsvText.length > 0) {
    const firstNl = existingCsvText.indexOf('\n');
    const headerLine = firstNl >= 0 ? existingCsvText.slice(0, firstNl) : existingCsvText;
    const headers = headerLine.split(','); // assumes header has no commas that need quoting
    return { headers, csvText: existingCsvText, headerExists: true };
  }
  const uniq = Array.from(new Set(headersFromSample || []));
  const headerLine = uniq.join(',') + '\n';
  return { headers: uniq, csvText: headerLine, headerExists: false };
}

function rowToCsvLine(row, headers) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return headers.map((h) => esc(row[h])).join(',');
}

export default async (req) => {
  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    const { jobId } = await req.json();
    if (!jobId) return new Response(JSON.stringify({ error: 'Missing jobId' }), { status: 400, headers: { 'content-type': 'application/json' } });

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    if (job.status === 'completed' || job.status === 'failed') return new Response(JSON.stringify({ ok: true, status: job.status }), { status: 202, headers: { 'content-type': 'application/json' } });

    await prisma.job.update({ where: { id: jobId }, data: { status: 'running', lastHeartbeat: new Date() } });

    const upload = await prisma.upload.findUnique({ where: { id: job.uploadId } });
    if (!upload) throw new Error('Upload record not found');

    const uploadsStore = getStore('uploads');
    const outputsStore = getStore('outputs');
    const cacheStore = getStore(LLM_CACHE_STORE);

    const buffer = await uploadsStore.get(upload.blobKey, { type: 'arrayBuffer' });
    if (!buffer) throw new Error('Uploaded blob not found');

    const rows = parseUploadBufferToRows(buffer, upload.originalName || upload.blobKey);

    const rowsTotal = job.rowsTotal && job.rowsTotal > 0 ? job.rowsTotal : rows.length;
    if (rowsTotal !== job.rowsTotal) {
      await prisma.job.update({ where: { id: jobId }, data: { rowsTotal } });
    }

    let offset = job.rowsProcessed || 0; // resume from here
    if (offset >= rowsTotal) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'completed', finishedAt: new Date() } });
      return new Response(JSON.stringify({ ok: true, status: 'completed' }), { status: 202, headers: { 'content-type': 'application/json' } });
    }

    const outputBlobKey = job.outputBlobKey || `outputs/${jobId}.csv`;
    if (!job.outputBlobKey) {
      await prisma.job.update({ where: { id: jobId }, data: { outputBlobKey } });
    }

    // Load existing main CSV once per run
    let mainCsvText = (await outputsStore.get(outputBlobKey, { type: 'text' })) || '';
    // Prepare LLM cache batch; we will flush alongside main CSV flushes
    let llmCacheText = null; // lazy-load once when first LLM entry is produced
    let llmCacheHeaders = [
      'timestamp', 'jobId', 'uploadId', 'userId', 'rowIndex', 'pairId',
      'system_a', 'code_a', 'system_b', 'code_b', 'concept_a_t', 'concept_b_t',
      'model', 'relationship_code', 'relationship_type',
      'prompt_tokens', 'completion_tokens', 'total_tokens'
    ];
    const llmCacheBatch = [];

    const start = Date.now();
    let lastFlush = Date.now();
    let processedThisRun = 0;

    // Prime main header from existing CSV, otherwise from first enriched row we see
    let mainHeader = null; // string[]

    for (; offset < rowsTotal; offset++) {
      const row = rows[offset];

      const system_a = String(row.system_a ?? '').trim();
      const system_b = String(row.system_b ?? '').trim();
      const code_a = String(row.code_a ?? row.concept_a ?? '').trim();
      const code_b = String(row.code_b ?? row.concept_b ?? '').trim();
      const type_a = normalizeOptionalType(row.type_a);
      const type_b = normalizeOptionalType(row.type_b);
      const pairId = makePairId({ system_a, code_a, system_b, code_b });

      let existing = null;
      try {
        existing = await prisma.masterRecord.findUnique({ where: { pairId } });
      } catch {
        existing = await prisma.masterRecord.findFirst({ where: { pairId } });
      }

      let relCode, relType, rationalText, usedModel, usage;

      if (!existing) {
        const { a: conceptAText, b: conceptBText } = pickConceptText(row);
        const events_ab = pickEventsAb(row);
        const events_ab_ae = pickEventsAe(row);
        const cls = await classifyRelationship({ conceptAText, conceptBText, events_ab, events_ab_ae });
        ({ relCode, relType, rationalText, usedModel, usage } = cls);

        await prisma.masterRecord.create({
          data: {
            pairId,
            concept_a: row.concept_a ?? String(code_a),
            code_a,
            concept_b: row.concept_b ?? String(code_b),
            code_b,
            system_a,
            system_b,
            type_a: typeof type_a === 'string' ? type_a : null,
            type_b: typeof type_b === 'string' ? type_b : null,
            relationshipType: relType,
            relationshipCode: Number(relCode),
            rational: rationalText,
            llm_name: 'OpenAI Chat Completions',
            llm_version: usedModel || PRIMARY_MODEL,
            llm_date: new Date(),
            cooc_event_count: numOrZero(row.cooc_event_count),
            source_count: 1,
          },
        });

        // Queue LLM cache line (per LLM call)
        const cacheRow = {
          timestamp: new Date().toISOString(),
          jobId,
          uploadId: job.uploadId,
          userId: job.userId,
          rowIndex: String(offset),
          pairId,
          system_a,
          code_a,
          system_b,
          code_b,
          concept_a_t: String(row.concept_a_t ?? row.concept_a ?? ''),
          concept_b_t: String(row.concept_b_t ?? row.concept_b ?? ''),
          model: usedModel || PRIMARY_MODEL,
          relationship_code: String(relCode),
          relationship_type: relType,
          prompt_tokens: String(usage?.prompt_tokens ?? ''),
          completion_tokens: String(usage?.completion_tokens ?? ''),
          total_tokens: String(usage?.total_tokens ?? ''),
        };
        llmCacheBatch.push(cacheRow);
      } else {
        relCode = Number(existing.relationshipCode ?? 11) || 11;
        relType = String(existing.relationshipType ?? RELATIONSHIP_TYPES[11]);
        rationalText = String(existing.rational ?? '');
        usedModel = existing.llm_version || PRIMARY_MODEL;

        await prisma.masterRecord.update({
          where: existing?.id ? { id: existing.id } : { pairId },
          data: {
            cooc_event_count: numOrZero(existing?.cooc_event_count) + numOrZero(row.cooc_event_count),
            source_count: numOrZero(existing?.source_count) + 1,
            updatedAt: new Date(),
          },
        });
      }

      // Enriched output row (file output)
      const enriched = {
        ...row,
        type_a: typeof type_a === 'string' ? type_a : '',
        type_b: typeof type_b === 'string' ? type_b : '',
        relationship_type: relType,
        relationship_code: String(relCode),
        rational: rationalText,
      };

      if (!mainHeader) {
        // if main CSV already has a header, read it; else derive from enriched keys
        const prime = ensureHeader(mainCsvText, Object.keys(enriched));
        mainHeader = prime.headers;
        mainCsvText = prime.csvText;
      }
      const line = rowToCsvLine(enriched, mainHeader);
      mainCsvText += line + '\n';

      processedThisRun += 1;

      const now = Date.now();
      const timeUp = now - start > MAX_RUN_MS - 15_000; // keep buffer
      const needFlush = processedThisRun % FLUSH_EVERY_ROWS === 0 || now - lastFlush > FLUSH_EVERY_MS || timeUp;

      if (needFlush) {
        // Flush main CSV
        await outputsStore.set(outputBlobKey, mainCsvText, { contentType: 'text/csv' });
        // Flush LLM cache if we have items
        if (llmCacheBatch.length > 0) {
          if (llmCacheText == null) {
            llmCacheText = (await cacheStore.get(LLM_CACHE_BLOB_KEY, { type: 'text' })) || '';
          }
          const prime = ensureHeader(llmCacheText, llmCacheHeaders);
          const headers = prime.headers;
          llmCacheText = prime.csvText;
          for (const cacheRow of llmCacheBatch) {
            llmCacheText += rowToCsvLine(cacheRow, headers) + '\n';
          }
          await cacheStore.set(LLM_CACHE_BLOB_KEY, llmCacheText, { contentType: 'text/csv' });
          llmCacheBatch.length = 0;
        }
        // Heartbeat + checkpoint
        await prisma.job.update({ where: { id: jobId }, data: { rowsProcessed: offset + 1, outputBlobKey, lastHeartbeat: new Date() } });
        lastFlush = now;
      }

      if (timeUp) break;
    }

    // Final flush of this run
    await getStore('outputs').set(job.outputBlobKey || `outputs/${jobId}.csv`, mainCsvText, { contentType: 'text/csv' });
    if (llmCacheBatch.length > 0) {
      const cacheStore2 = getStore(LLM_CACHE_STORE);
      let cacheText2 = (await cacheStore2.get(LLM_CACHE_BLOB_KEY, { type: 'text' })) || '';
      const prime = ensureHeader(cacheText2, llmCacheHeaders);
      const headers = prime.headers;
      cacheText2 = prime.csvText;
      for (const cacheRow of llmCacheBatch) cacheText2 += rowToCsvLine(cacheRow, headers) + '\n';
      await cacheStore2.set(LLM_CACHE_BLOB_KEY, cacheText2, { contentType: 'text/csv' });
    }
    await prisma.job.update({ where: { id: jobId }, data: { rowsProcessed: offset, outputBlobKey: outputBlobKey, lastHeartbeat: new Date() } });

    if (offset >= rowsTotal) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'completed', finishedAt: new Date() } });
      return new Response(JSON.stringify({ ok: true, status: 'completed' }), { status: 202, headers: { 'content-type': 'application/json' } });
    }

    // Not done — re‑invoke ourselves to continue
    try {
      const host = req.headers.get('x-forwarded-host');
      const proto = req.headers.get('x-forwarded-proto') || 'https';
      const origin = process.env.URL || (host ? `${proto}://${host}` : '');
      if (origin) {
        await fetch(`${origin}/.netlify/functions/process-upload-background`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jobId }),
        });
      }
    } catch (e) {
      console.warn('[self-chain] failed to re-invoke background function:', e?.message || e);
    }

    return new Response(JSON.stringify({ ok: true, status: 'running' }), { status: 202, headers: { 'content-type': 'application/json' } });
  } catch (err) {
    console.error('[process-upload-background] ERROR', err);
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
