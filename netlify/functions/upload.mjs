// netlify/functions/upload.mjs  (Functions v2, ESM)
// Enqueue-only uploader: saves blob + creates job, then triggers background worker and returns 202
// Keeps schema-aligned fields for any metadata we persist to DB

import { getStore } from '@netlify/blobs';
import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

// Project-side Prisma initialization
import prismaCjs from './utils/prisma.js';
import { PrismaClient } from '@prisma/client';
import authUtilsCjs from './utils/auth.js';

const prisma = globalThis.__prisma || new PrismaClient();
// @ts-ignore
globalThis.__prisma = prisma;
const { getUserFromRequest } = authUtilsCjs;

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
      return new Response('Method Not Allowed', { status: 405, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      return new Response(JSON.stringify({ error: 'No file provided' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }

    const filename = file.name || 'upload.csv';
    const mimeType = file.type || 'text/csv';
    const buffer = Buffer.from(await file.arrayBuffer());

    // save input blob
    const uploadsStore = getStore('uploads');
    const outputsStore = getStore('outputs'); // ensure bucket exists for background writes

    const stamp = Date.now();
    const base = (filename || 'file').replace(/\.[^./]+$/, '') || 'file';
    const userId = user.id;

    const ext = getExt(filename, mimeType);
    const uploadKey = `${userId}/${stamp}_${base}${ext}`;
    await uploadsStore.set(uploadKey, buffer, { contentType: mimeType, metadata: { originalName: filename } });

    // create upload + job records
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

    const job = await prisma.job.create({
      data: {
        uploadId: uploadRecord.id,
        status: 'queued',
        rowsTotal: 0,
        rowsProcessed: 0,
        userId,
        // allow worker to set outputBlobKey if not provided here
        outputBlobKey: `outputs/${uploadRecord.id}.csv`,
        createdAt: new Date(),
      },
    });

    // fire-and-forget background run (resumable worker)
    try {
      const host = req.headers.get('x-forwarded-host');
      const proto = req.headers.get('x-forwarded-proto') || 'https';
      const origin = process.env.URL || (host ? `${proto}://${host}` : '');
      if (origin) {
        await fetch(`${origin}/.netlify/functions/process-upload-background`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jobId: job.id }),
        });
      }
    } catch (e) {
      console.warn('[upload] failed to trigger background worker:', e?.message || e);
    }

    return new Response(
      JSON.stringify({ ok: true, jobId: job.id, inputBlobKey: uploadKey, outputBlobKey: job.outputBlobKey }),
      { status: 202, headers: { 'content-type': 'application/json' } }
    );
  } catch (err) {
    console.error('[upload] ERROR', err);
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}