// netlify/functions/upload.js — blob-only clean fix (CommonJS)
// Persist files to Netlify Blobs; no filesystem (no path/fs) usage.

const Busboy = require('busboy');
const XLSX = require('xlsx');
const parseCsv = require('csv-parse/sync').parse;
const prisma = require('./utils/prisma');
const { getUserFromRequest } = require('./utils/auth');
const { Configuration, OpenAIApi } = require('openai');

// Accept either env var name for OpenAI
const openaiApiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
let openaiClient = null;
if (openaiApiKey) {
  const configuration = new Configuration({ apiKey: openaiApiKey });
  openaiClient = new OpenAIApi(configuration);
}

// Required columns for uploaded files
const REQUIRED_COLUMNS = [
  'concept_a',
  'concept_b',
  'concept_a_t',
  'concept_b_t',
  'system_a',
  'system_b',
  'cooc_event_count',
  'lift_lower_95',
  'lift_upper_95',
];

// --- helpers ---------------------------------------------------------------

function normalizeHeaders(h) {
  if (!h) return {};
  const out = {};
  for (const k of Object.keys(h)) out[k.toLowerCase()] = h[k];
  return out;
}

function getExt(filename, mime) {
  if (filename && filename.includes('.')) return filename.toLowerCase().slice(filename.lastIndexOf('.'));
  if (mime && /excel|sheet/i.test(mime)) return '.xlsx';
  return '.csv';
}

function toCsv(rows, headers) {
  const esc = (v) => {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const head = headers.join(',');
  const body = rows.map((r) => headers.map((k) => esc(r[k])).join(',')).join('\n');
  return head + '\n' + body + (body ? '\n' : '');
}

async function classifyRow(row) {
  if (!openaiClient) {
    return { rel_type: 11, rel_type_t: 'No clear relationship', rationale: 'No API key provided' };
  }
  const events_ab = row.cooc_event_count;
  const lift_lower = parseFloat(row.lift_lower_95);
  const lift_upper = parseFloat(row.lift_upper_95);
  const events_ab_ae = ((lift_lower + lift_upper) / 2) || 1;
  const prompt = `You are an expert diagnostician skilled at identifying clinical relationships between ICD-10-CM diagnosis concepts.\nStatistical indicators provided:\n- events_ab (co-occurrences): ${events_ab}\n- events_ab_ae (actual-to-expected ratio): ${events_ab_ae.toFixed(2)}\n\nInterpretation guidelines:\n- ≥ 2.0: Strong statistical evidence; carefully consider relationships.\n- 1.5–1.99: Moderate evidence; cautious evaluation.\n- 1.0–1.49: Weak evidence; rely primarily on clinical knowledge.\n- < 1.0: Minimal evidence; avoid indirect/speculative claims.\n\nExplicit guidelines to avoid speculation:\n- Direct causation: Only if explicit and clinically accepted.\n- Indirect causation: Only with explicit and named intermediate diagnosis.\n- Common cause: Only with clearly documented third diagnosis.\n- Treatment-caused: Only if explicitly well-documented.\n- Similar presentations: Only if clinically documented similarity exists.\n- Subset relationship: Explicitly broader or unspecified form.\nIf evidence or explicit documentation is lacking, choose category 11 (No clear relationship).\n\nClassify explicitly the relationship between:\n- Concept A: ${row.concept_a_t}\n- Concept B: ${row.concept_b_t}\n\nCategories:\n1: A causes B\n2: B causes A\n3: A indirectly causes B (explicit intermediate required)\n4: B indirectly causes A (explicit intermediate required)\n5: A and B share common cause (explicit third condition required)\n6: Treatment of A causes B (explicit treatment documentation required)\n7: Treatment of B causes A (explicit treatment documentation required)\n8: A and B have similar initial presentations\n9: A is subset of B\n10: B is subset of A\n11: No clear relationship (default)\n\nAnswer exactly as "<number>: <short description>: <concise rationale>".`;
  try {
    const response = await openaiClient.createChatCompletion({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    });
    const reply = (response.data.choices[0].message.content || '').trim();
    const parts = reply.split(':');
    const rel_type = parseInt((parts[0] || '').trim(), 10) || 11;
    const rel_type_t = (parts[1] || '').trim();
    const rationale = (parts.slice(2).join(':') || '').trim();
    return { rel_type, rel_type_t, rationale };
  } catch (_) {
    return { rel_type: 11, rel_type_t: 'No clear relationship', rationale: 'API error' };
  }
}

function parseAndValidate(buffer, filename, mimeType) {
  const ext = getExt(filename, mimeType);
  let rows = [];
  if (ext === '.csv') {
    const text = buffer.toString('utf-8');
    rows = parseCsv(text, { columns: true, skip_empty_lines: true, trim: true });
  } else if (ext === '.xlsx' || ext === '.xls') {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.SheetNames[0];
    rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' });
  } else {
    return { error: 'Unsupported file type' };
  }
  if (!rows || rows.length === 0) return { error: 'File contains no data' };
  // remove completely blank rows
  rows = rows.filter((r) => Object.values(r).some((v) => String(v ?? '').trim() !== ''));
  // header check (case-insensitive)
  const header = Object.keys(rows[0]).map((h) => h.toLowerCase());
  for (const col of REQUIRED_COLUMNS) if (!header.includes(col)) return { error: `Missing required column: ${col}` };
  return { rows };
}

function readMultipart(event) {
  return new Promise((resolve, reject) => {
    const headers = normalizeHeaders(event.headers);
    const contentType = headers['content-type'] || headers['content_type'];
    if (!contentType) return reject(new Error('Missing content-type'));

    const bb = Busboy({ headers: { 'content-type': contentType } });
    const chunks = [];
    let filename = '';
    let mimeType = '';

    // Support both Busboy signatures
    bb.on('file', (name, file, infoOrFilename, encoding, mimetype) => {
      if (infoOrFilename && typeof infoOrFilename === 'object') {
        filename = infoOrFilename.filename || 'upload.csv';
        mimeType = infoOrFilename.mimeType || 'text/csv';
      } else {
        filename = infoOrFilename || 'upload.csv';
        mimeType = mimetype || 'text/csv';
      }
      file.on('data', (d) => chunks.push(d));
    });
    bb.on('error', reject);
    bb.on('close', () => resolve({ buffer: Buffer.concat(chunks), filename, mimeType }));

    const bodyBuf = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '');
    bb.end(bodyBuf);
  });
}

// --- handler ---------------------------------------------------------------

exports.handler = async function (event) {
  try {
    const user = await getUserFromRequest(event);
    if (!user) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    // Blobs dynamic import (works in CommonJS)
    const { getStore } = await import('@netlify/blobs');
    const uploadsStore = getStore({ name: 'uploads' });
    const outputsStore = getStore({ name: 'outputs' });

    const { buffer, filename, mimeType } = await readMultipart(event);
    if (!buffer || !buffer.length) return { statusCode: 400, body: JSON.stringify({ error: 'No file provided' }) };

    // Validate & parse
    const parsed = parseAndValidate(buffer, filename, mimeType);
    if (parsed.error) return { statusCode: 400, body: JSON.stringify({ error: parsed.error }) };
    let rows = parsed.rows;

    // Save original upload to Blobs
    const userId = user.id;
    const stamp = Date.now();
    const base = (filename || 'file').replace(/\.[^./]+$/, '') || 'file';
    const ext = getExt(filename, mimeType);
    const uploadKey = `${userId}/${stamp}_${base}${ext}`;

    await uploadsStore.set(uploadKey, buffer, {
      contentType: mimeType || (ext === '.csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      metadata: { originalName: filename },
    });

    // (Optional) classify each row
    const outputRows = [];
    for (const row of rows) {
      const c = await classifyRow(row);
      outputRows.push({ ...row, REL_TYPE: c.rel_type, REL_TYPE_T: c.rel_type_t, RATIONALE: c.rationale });
    }

    // Create validated CSV
    const outHeaders = Array.from(new Set([...Object.keys(outputRows[0] || {}), 'REL_TYPE', 'REL_TYPE_T', 'RATIONALE']));
    const outputCsv = toCsv(outputRows.length ? outputRows : rows, outHeaders);

    const outputKey = `${userId}/${stamp}_${base}.validated.csv`;
    await outputsStore.set(outputKey, Buffer.from(outputCsv), { contentType: 'text/csv', metadata: { source: uploadKey } });

    // Create Upload + Job rows if your schema supports them (best-effort)
    try {
      const uploadRecord = await prisma.upload.create({
        data: {
          userId: userId,
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
          fileName: filename,
          status: 'completed',
          rowsTotal: rows.length,
          rowsProcessed: rows.length,
          userId: userId,
          outputBlobKey: outputKey,
          createdAt: new Date(),
          finishedAt: new Date(),
        },
      });
    } catch (e) {
      console.error('DB write (upload/job) failed; continuing:', e && e.message);
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, outputKey }) };
  } catch (err) {
    console.error('upload_handler_error', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
