// netlify/functions/upload.mjs  (Functions v2, ESM)
// Updated: removed unsupported prisma Job field `fileName` in job.create()

import { getStore } from '@netlify/blobs';
import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

import prismaCjs from './utils/prisma.js';
import authUtilsCjs from './utils/auth.js';
const prisma = prismaCjs;
const { getUserFromRequest } = authUtilsCjs;

const REQUIRED_COLUMNS = [
  'concept_a','concept_b','concept_a_t','concept_b_t',
  'system_a','system_b','cooc_event_count','lift_lower_95','lift_upper_95'
];

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

    // Required header check (case-insensitive)
    const header = Object.keys(rows[0]).map(h => h.toLowerCase());
    for (const col of REQUIRED_COLUMNS) {
      if (!header.includes(col)) {
        return new Response(JSON.stringify({ error: `Missing required column: ${col}` }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
    }

    // Blobs stores (auto-config in v2)
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

    // Create validated CSV (no enrichment here)
    const outHeaders = Array.from(new Set([...Object.keys(rows[0] || {})]));
    const outputCsv = toCsv(rows, outHeaders);
    const outputKey = `${userId}/${stamp}_${base}.validated.csv`;

    await outputsStore.set(outputKey, Buffer.from(outputCsv), {
      contentType: 'text/csv',
      metadata: { source: uploadKey },
    });

    // Best-effort DB bookkeeping — remove unsupported `fileName`
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
          // If your schema has a different field for filename (e.g., `name`),
          // add it here as: name: filename,
        },
      });
    } catch (e) {
      console.error('DB write (upload/job) failed; continuing:\n', e?.message || e);
    }

    return new Response(JSON.stringify({ ok: true, outputKey }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err) {
    console.error('upload_v2_error', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
};
