// Netlify Function: streaming CSV upload with early validation
// - Reads only the first N lines to validate structure (header + a few rows)
// - If valid, streams the file into Netlify Blobs without buffering the whole body
//
// Expected multipart field name: "file"
// Optional text fields: "dataset", "owner", etc. captured into metadata
//
// ENV:
//   BLOB_STORE = name of the blob bucket (default "taxis-uploads")
//   VALIDATION_SAMPLE_LINES = integer (default 100)
//   REQUIRED_HEADERS = comma-separated required column names (case-insensitive)
//
// Notes:
// - Uses Busboy to stream multipart uploads (avoid request.formData()).
// - Works for small and large files; no race when the stream ends before sampleLines.

import Busboy from 'busboy';
import { PassThrough, Readable } from 'node:stream';
import { blobs } from '@netlify/blobs';

// ---------- Utilities ----------

function detectDelimiter(headerLine) {
  const commas = (headerLine.match(/,/g) || []).length;
  const tabs = (headerLine.match(/\t/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

function splitHeader(headerLine, delimiter) {
  return headerLine
    .split(delimiter)
    .map((h) => h.trim().replace(/^"|"$/g, ''))
    .map((h) => h.toLowerCase());
}

function hasRequiredHeaders(csvHeaderLine, requiredHeaders, delimiter) {
  const delim = delimiter || detectDelimiter(csvHeaderLine);
  const headerSet = new Set(splitHeader(csvHeaderLine, delim));
  return {
    ok: requiredHeaders.every((req) => headerSet.has(String(req).toLowerCase())),
    delimiter: delim,
  };
}

function extractFirstNLinesFromChunks(chunks, n) {
  const text = Buffer.concat(chunks).toString('utf8');
  const lines = text.split(/\r?\n/);
  if (lines.length <= n) return lines.join('\n');
  return lines.slice(0, n).join('\n');
}

function getHeaderLine(sampleText) {
  const firstLine = sampleText.split(/\r?\n/)[0] || '';
  return firstLine;
}

// Default required headers for TAXIS step_5 uploads (case-insensitive)
const DEFAULT_REQUIRED_HEADERS = [
  'concept_a',
  'concept_a_t',
  'concept_b',
  'concept_b_t',
  'cooc_obs',
  'na', // will match nA
  'nb', // will match nB
  'total_persons',
  'cooc_event_count',
  'a_before_b',
  'b_before_a',
  'expected_obs',
  'lift',
  'z_score',
  'odds_ratio',
  'directionality_ratio',
];

// ---------- Function route ----------

export const config = {
  path: '/.netlify/functions/upload',
};

export default async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  const storeName = process.env.BLOB_STORE || 'taxis-uploads';
  const sampleLines = Number(process.env.VALIDATION_SAMPLE_LINES || 100);
  const requiredHeaders = (process.env.REQUIRED_HEADERS
    ? process.env.REQUIRED_HEADERS.split(',').map((s) => s.trim())
    : DEFAULT_REQUIRED_HEADERS);

  return new Promise((resolve) => {
    const bb = Busboy({ headers: event.headers });

    const meta = {};
    let uploadHandled = false;
    let responded = false;

    function safeResolve(resp) {
      if (!responded) {
        responded = true;
        resolve(resp);
      }
    }

    bb.on('field', (name, val) => {
      meta[name] = val;
    });

    bb.on('file', (name, fileStream, info) => {
      if (name !== 'file') {
        fileStream.resume();
        return;
      }
      uploadHandled = true;
      const { filename, mimeType } = info;

      // --- Validation & streaming state ---
      const bufferedChunks = [];
      let bufferedText = '';
      let collectedLines = 0;
      let validationDone = false;
      let validationFailed = false;
      let detectedDelimiter = ',';

      // Uploader to Netlify Blobs
      const uploader = new PassThrough({ highWaterMark: 1024 * 1024 });
      let blobWriteStarted = false;
      let blobKey = null;

      function startBlobWrite(metaInfo) {
        if (blobWriteStarted) return;
        blobWriteStarted = true;
        const keyBase = meta.dataset || 'uploads';
        blobKey = `${keyBase}/${Date.now()}_${filename}`;
        (async () => {
          try {
            await blobs.set({
              bucket: storeName,
              key: blobKey,
              data: uploader,
              metadata: metaInfo,
              contentType: mimeType || 'text/csv',
              cacheControl: 'no-store',
            });
          } catch (e) {
            if (!responded) {
              safeResolve({
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: String(e) }),
              });
            }
          }
        })();
      }

      // Stream in data; validate as soon as we reach sampleLines
      fileStream.on('data', (chunk) => {
        if (validationFailed) return; // drain but ignore
        bufferedChunks.push(chunk);

        if (!validationDone) {
          bufferedText += chunk.toString('utf8');
          const lines = bufferedText.split(/\r?\n/);
          collectedLines = lines.length - 1; // count complete lines

          if (collectedLines >= sampleLines) {
            const sample = extractFirstNLinesFromChunks(bufferedChunks, sampleLines);
            const headerLine = getHeaderLine(sample);
            const { ok: headerOk, delimiter } = hasRequiredHeaders(headerLine, requiredHeaders);
            if (!headerOk) {
              validationFailed = true;
              return; // handled in 'end'
            }
            detectedDelimiter = delimiter;
            validationDone = true;

            // Begin blob write and flush buffered data
            startBlobWrite({ filename, mimeType, delimiter: detectedDelimiter, ...meta });
            for (const c of bufferedChunks) uploader.write(c);
            bufferedChunks.length = 0;
          }
        } else {
          // Already validated: write chunks straight to uploader
          uploader.write(chunk);
        }
      });

      fileStream.on('end', async () => {
        try {
          if (validationFailed) {
            return safeResolve({
              statusCode: 400,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                error: 'Validation failed: required columns missing in header',
                required: requiredHeaders,
              }),
            });
          }

          // Tiny files: validate whatever we buffered
          if (!validationDone) {
            const sample = extractFirstNLinesFromChunks(bufferedChunks, sampleLines);
            const headerLine = getHeaderLine(sample);
            const { ok: headerOk, delimiter } = hasRequiredHeaders(headerLine, requiredHeaders);
            if (!headerOk) {
              return safeResolve({
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  error: 'Validation failed: required columns missing in header',
                  required: requiredHeaders,
                }),
              });
            }
            detectedDelimiter = delimiter;
            validationDone = true;

            // Start blob write and send only buffered content
            startBlobWrite({ filename, mimeType, delimiter: detectedDelimiter, ...meta });
            for (const c of bufferedChunks) uploader.write(c);
          }

          // Finalize uploader
          uploader.end();

          // Let the microtask queue flush
          await new Promise((res) => setImmediate(res));

          return safeResolve({
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ok: true,
              bucket: storeName,
              key: blobKey,
              metadata: { delimiter: detectedDelimiter, ...meta },
            }),
          });
        } catch (err) {
          return safeResolve({
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: String(err) }),
          });
        }
      });
    }); // <-- closes bb.on('file')

    bb.on('error', (err) => {
      safeResolve({
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: String(err) }),
      });
    });

    bb.on('finish', () => {
      if (!uploadHandled) {
        safeResolve({
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'No file field named "file" found.' }),
        });
      }
      // Otherwise response was already resolved in the file handler
    });

    // Feed raw body to Busboy (supports base64 bodies too)
    const isBase64 = event.isBase64Encoded;
    const bodyBuffer = Buffer.from(event.body || '', isBase64 ? 'base64' : 'utf8');
    const reqStream = Readable.from(bodyBuffer);
    reqStream.pipe(bb);
  });
};

// ============================
// V2: Direct-to-Blob flow (optional for massive files)
// ============================

export const config_presign = {
  path: '/.netlify/functions/create-upload-url',
};

export async function handler_create_upload_url(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const storeName = process.env.BLOB_STORE || 'taxis-uploads';
    const requiredHeaders = (process.env.REQUIRED_HEADERS
      ? process.env.REQUIRED_HEADERS.split(',').map((s) => s.trim())
      : DEFAULT_REQUIRED_HEADERS);

    const { filename, mimeType, sampleBase64, meta = {} } = JSON.parse(event.body || '{}');
    if (!filename || !sampleBase64) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'filename and sampleBase64 are required' }),
      };
    }

    const sampleText = Buffer.from(sampleBase64, 'base64').toString('utf8');
    const headerLine = getHeaderLine(sampleText);
    const { ok: headerOk, delimiter } = hasRequiredHeaders(headerLine, requiredHeaders);
    if (!headerOk) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Validation failed: required columns missing in header',
          required: requiredHeaders,
          header: headerLine,
        }),
      };
    }

    const keyBase = meta.dataset || 'uploads';
    const key = `${keyBase}/${Date.now()}_${filename}`;

    const { uploadURL } = await blobs.createPresignedUploadURL({
      bucket: storeName,
      key,
      contentType: mimeType || 'text/csv',
      metadata: { filename, mimeType, delimiter, ...meta },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, key, putUrl: uploadURL, delimiter }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: String(err) }),
    };
  }
}

/*
Minimal browser usage for presigned flow:

async function readFirstNLines(file, n = 100) {
  const chunk = await file.slice(0, 1024 * 64).arrayBuffer();
  const text = new TextDecoder().decode(chunk);
  const lines = text.split(/\r?\n/).slice(0, n).join('\n');
  return btoa(unescape(encodeURIComponent(lines)));
}

async function uploadLargeCsv(file, meta = {}) {
  const sampleBase64 = await readFirstNLines(file, 100);
  const presignRes = await fetch('/.netlify/functions/create-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || 'text/csv',
      sampleBase64,
      meta
    }),
  }).then(r => r.json());

  if (!presignRes.ok) throw new Error(presignRes.error || 'Validation failed');
  const putResp = await fetch(presignRes.putUrl, { method: 'PUT', body: file });
  if (!putResp.ok) throw new Error('Blob upload failed');
  return { key: presignRes.key, delimiter: presignRes.delimiter };
}
*/
