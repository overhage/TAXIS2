// netlify/functions/upload.mjs  (Functions v2, ESM)
// Adds MasterRecord upsert + LLM classification + enriched CSV output

import { getStore } from '@netlify/blobs';
import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

import prismaCjs from './utils/prisma.js';
import { PrismaClient } from '@prisma/client';
import authUtilsCjs from './utils/auth.js';
const prisma = globalThis.__prisma || new PrismaClient();
// @ts-ignore
globalThis.__prisma = prisma;
const { getUserFromRequest } = authUtilsCjs;

// === NEW: exact category mapping from rel_dx_classifier_TEXT (1).txt ===
const RELATIONSHIP_TYPES = {
  1: "A causes B",
  2: "B causes A",
  3: "A indirectly causes B",
  4: "B indirectly causes A",
  5: "A and B share common cause",
  6: "Treatment of A causes B",
  7: "Treatment of B causes A",
  8: "A and B have similar initial presentations",
  9: "A is subset of B",
  10: "B is subset of A",
  11: "No clear relationship",
};

// === NEW: LLM call using EXACT prompt text from your file ===
const DEFAULT_MODEL = process.env.OPENAI_API_MODEL || 'gpt-4-turbo';
async function classifyRelationship({ conceptAText, conceptBText, events_ab, events_ab_ae }) {
  const prompt = `
    You are an expert diagnostician skilled at identifying clinical relationships between ICD-10-CM diagnosis concepts. 
    Statistical indicators provided:
    - events_ab (co-occurrences): ${events_ab}
    - events_ab_ae (actual-to-expected ratio): ${Number(events_ab_ae ?? 0).toFixed(2)}

    Interpretation guidelines:
    - ≥ 2.0: Strong statistical evidence; carefully consider relationships.
    - 1.5–1.99: Moderate evidence; cautious evaluation.
    - 1.0–1.49: Weak evidence; rely primarily on clinical knowledge.
    - < 1.0: Minimal evidence; avoid indirect/speculative claims.

    Explicit guidelines to avoid speculation:
    - Direct causation: Only if explicit and clinically accepted.
      Example: Pneumonia causes cough.

    - Indirect causation: Only with explicit and named intermediate diagnosis.
      Example: Pneumonia → sepsis → acute kidney injury.

    - Common cause: Only with clearly documented third diagnosis.
      Example: Obesity clearly causing both diabetes type 2 and osteoarthritis.

    - Treatment-caused: Only if explicitly well-documented.
      Example: Chemotherapy for cancer causing nausea.

    - Similar presentations: Only if clinically documented similarity exists.

    - Subset relationship: Explicitly broader or unspecified form.

    If evidence or explicit documentation is lacking, choose category 11 (No clear relationship).

    Classify explicitly the relationship between:
    - Concept A: ${conceptAText}
    - Concept B: ${conceptBText}

    Categories:
    1: A causes B
    2: B causes A
    3: A indirectly causes B (explicit intermediate required)
    4: B indirectly causes A (explicit intermediate required)
    5: A and B share common cause (explicit third condition required)
    6: Treatment of A causes B (explicit treatment documentation required)
    7: Treatment of B causes A (explicit treatment documentation required)
    8: A and B have similar initial presentations
    9: A is subset of B
    10: B is subset of A
    11: No clear relationship (default)

    Answer exactly as "<number>: <short description>: <concise rationale>".
  `.trim();

  console.log('[LLM] model:', DEFAULT_MODEL);
  console.log('[LLM] pair:', conceptAText, '↔', conceptBText);
  // (early debugging) log a shortened prompt preview
  console.log('[LLM] prompt preview:', prompt.slice(0, 280), '...');

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error('[LLM] HTTP error', resp.status, text);
    return { relCode: 11, relType: RELATIONSHIP_TYPES[11], rationale: 'API error occurred' };
  }

  const data = await resp.json();
  const reply = data?.choices?.[0]?.message?.content?.trim() || '';
  console.log('[LLM] raw reply:', reply);

  try {
    const parts = reply.split(': ');
    const relCode = parseInt(parts[0].trim(), 10);
    const relType = (parts[1] || '').trim() || RELATIONSHIP_TYPES[relCode] || RELATIONSHIP_TYPES[11];
    const rationale = (parts.slice(2).join(': ') || '').trim() || '—';
    const safeCode = Number.isFinite(relCode) ? relCode : 11;
    return { relCode: safeCode, relType, rationale };
  } catch (e) {
    console.warn('[LLM] parse error -> defaulting to 11');
    return { relCode: 11, relType: RELATIONSHIP_TYPES[11], rationale: 'Unable to parse response' };
  }
}

// === existing header check (keep, you can expand later if you like) ===
const REQUIRED_COLUMNS = [
  'concept_a','concept_b','concept_a_t','concept_b_t',
  'system_a','system_b','cooc_event_count','lift_lower_95','lift_upper_95'
];

// helpers
function toCsv(rows, headers) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = headers.join(',');
  const body = rows.map(r => headers.map(k => esc(r[k])).join(',')).join('\n');
  return head + '\n' + body + (body ? '\n' : '');
}
function getExt(filename, mime) {
  if (filename && filename.includes('.')) return filename.toLowerCase().slice(filename.lastIndexOf('.'));
  if (mime && /excel|sheet/i.test(mime)) return '.xlsx';
  return '.csv';
}

// === NEW: derive inputs the LLM prompt expects, even if column names vary ===
function pickConceptText(row) {
  return {
    a: String(row.concept_a_t ?? row.concept_a ?? '').trim(),
    b: String(row.concept_b_t ?? row.concept_b ?? '').trim(),
  };
}
function pickEventsAb(row) {
  // Prefer event count; fall back to observed persons if present; else 0
  const v = row.cooc_event_count ?? row.events_ab ?? row.cooc_obs ?? 0;
  return Number(v) || 0;
}
function pickEventsAe(row) {
  // Prefer explicit ratio if present; else lift; else midpoint of CI; else 1.0
  if (row.events_ab_ae != null) return Number(row.events_ab_ae) || 1.0;
  if (row.lift != null) return Number(row.lift) || 1.0;
  const lo = Number(row.lift_lower_95 ?? NaN);
  const hi = Number(row.lift_upper_95 ?? NaN);
  if (Number.isFinite(lo) && Number.isFinite(hi)) return (lo + hi) / 2;
  return 1.0;
}

export default async (req) => {
  try {
    const eventLike = { headers: { cookie: req.headers.get('cookie') || '' } };
    const user = await getUserFromRequest(eventLike);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { 'content-type': 'application/json' } });
    }
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      return new Response(JSON.stringify({ error: 'No file provided' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    const filename = file.name || 'upload.csv';
    const mimeType = file.type || 'text/csv';
    const buffer = Buffer.from(await file.arrayBuffer());

    const ext = getExt(filename, mimeType);
    let rows = [];
    if (ext === '.csv') {
      rows = parseCsv(buffer.toString('utf-8'), { columns: true, skip_empty_lines: true, trim: true });
    } else if (ext === '.xlsx' || ext === '.xls') {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const sheet = wb.SheetNames[0];
      rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' });
    } else {
      return new Response(JSON.stringify({ error: 'Unsupported file type' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }

    if (!rows.length) {
      return new Response(JSON.stringify({ error: 'File contains no data' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }

    // Drop completely blank rows
    rows = rows.filter(r => Object.values(r).some(v => String(v ?? '').trim() !== ''));

    // Required header check (case-insensitive) — matches your current version
    const header = Object.keys(rows[0]).map(h => h.toLowerCase());
    for (const col of REQUIRED_COLUMNS) {
      if (!header.includes(col)) {
        return new Response(JSON.stringify({ error: `Missing required column: ${col}` }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
    }

    // ——— NEW: process each pair against MasterRecord ———
    const uploadsStore = getStore('uploads');
    const outputsStore = getStore('outputs');

    const stamp = Date.now();
    const base = (filename || 'file').replace(/\.[^./]+$/, '') || 'file';
    const userId = user.id;

    const uploadKey = `${userId}/${stamp}_${base}${ext}`;
    await uploadsStore.set(uploadKey, buffer, {
      contentType: mimeType,
      metadata: { originalName: filename },
    });

    const enriched = [];
    let i = 0;
    for (const row of rows) {
      i += 1;

      // Normalize identifiers used to key the MasterRecord
      const system_a = String(row.system_a ?? '').trim();
      const system_b = String(row.system_b ?? '').trim();
      const code_a = String(row.code_a ?? row.concept_a ?? '').trim();
      const code_b = String(row.code_b ?? row.concept_b ?? '').trim();

      // Fetch any existing MasterRecord (adjust field names if your Prisma differs)
      const existing = await prisma.masterRecord.findFirst({
        where: { system_a, code_a, system_b, code_b },
      });

      let relCode, relType, rationale;

      if (!existing) {
        // Build prompt inputs
        const { a: conceptAText, b: conceptBText } = pickConceptText(row);
        const events_ab = pickEventsAb(row);
        const events_ab_ae = pickEventsAe(row);

        // Call LLM only when we don't already have a record
        const cls = await classifyRelationship({ conceptAText, conceptBText, events_ab, events_ab_ae });
        relCode = cls.relCode;
        relType = cls.relType;
        rationale = cls.rationale;

        // Insert MasterRecord seeded with upload values
        await prisma.masterRecord.create({
          data: {
            system_a, code_a,
            system_b, code_b,
            // copy of key descriptive fields (add/adjust as your schema defines)
            concept_a: row.concept_a ?? null,
            concept_b: row.concept_b ?? null,
            concept_a_t: row.concept_a_t ?? null,
            concept_b_t: row.concept_b_t ?? null,

            // relationship fields
            relationship_type: relType,                 // text
            relationship_code: String(relCode),        // text
            rationale: rationale,                      // long text

            // LLM provenance
            LLM_name: 'OpenAI Chat Completions',
            LLM_version: DEFAULT_MODEL,
            LLM_date: new Date(),

            // counters / accumulators
            cooc_event_count: Number(row.cooc_event_count ?? 0) || 0,
            source_count: 1,
          },
        });
      } else {
        // Use stored relationship fields (no LLM call)
        relCode = Number(existing.relationship_code ?? 11) || 11;
        relType = String(existing.relationship_type ?? RELATIONSHIP_TYPES[11]);
        rationale = String(existing.rationale ?? '');

        // Accumulate counts + source count
        await prisma.masterRecord.update({
          where: { id: existing.id },
          data: {
            cooc_event_count: Number(existing.cooc_event_count || 0) + (Number(row.cooc_event_count ?? 0) || 0),
            source_count: Number(existing.source_count || 0) + 1,
            updatedAt: new Date(),
          },
        });
      }

      // Enrich output row
      enriched.push({
        ...row,
        relationship_type: relType,
        relationship_code: String(relCode),
        rationale,
      });

      if (i === 1 || i % 10 === 0 || i === rows.length) {
        console.log(`[progress] processed ${i}/${rows.length}`);
      }
    }

    // Write enriched CSV
    const outHeaders = Array.from(
      enriched.reduce((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s; }, new Set())
    );
    const outputCsv = toCsv(enriched, outHeaders);
    const outputKey = `${userId}/${stamp}_${base}.enriched.csv`;

    await outputsStore.set(outputKey, Buffer.from(outputCsv), {
      contentType: 'text/csv',
      metadata: { source: uploadKey },
    });

    // Minimal DB bookkeeping
    try {
      const uploadRecord = await prisma.upload.create({
        data: {
          userId,
          blobKey: uploadKey,
          originalName: filename,
          store: 'blob',
          contentType: mimeType,
          size: buffer.length,
        },
      });
      await prisma.job.create({
        data: {
          uploadId: uploadRecord.id,
          status: 'completed',
          rowsTotal: rows.length,
          rowsProcessed: rows.length,
          userId,
          outputBlobKey: outputKey,
          createdAt: new Date(),
          finishedAt: new Date(),
        },
      });
    } catch (e) {
      console.warn('[db] job bookkeeping failed:', e?.message || e);
    }

    return new Response(JSON.stringify({
      ok: true,
      message: 'Upload processed and enriched.',
      inputBlobKey: uploadKey,
      outputBlobKey: outputKey,
      rows: rows.length,
    }), { status: 200, headers: { 'content-type': 'application/json' } });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
