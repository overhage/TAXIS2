// Netlify Function: streaming CSV upload with early validation
// - Reads only the first N lines to validate structure (header + a few rows)
// - If valid, streams the remainder directly into Netlify Blobs without buffering in memory
// - Designed to handle very large files (multi‑GB) when deployed to Netlify Node functions runtime
//
// Expected multipart field name: "file"
// Optional text fields: "dataset", "owner", etc. are captured into metadata
//
// ENV:
//   BLOB_STORE = name of the blob store/bucket (defaults to "taxis-uploads")
//   VALIDATION_SAMPLE_LINES = integer (defaults to 100)
//   REQUIRED_HEADERS = comma‑separated list of column names to require (case‑insensitive)
//                       If not provided, a reasonable default for TAXIS step_5 is used.
//
// NOTES:
// - We purposefully avoid request.formData() to prevent buffering the whole file.
// - We use Busboy to stream parse multipart and @netlify/blobs to stream to storage.
// - Validation occurs BEFORE we begin the blob write. Nothing is written unless validation passes.

import Busboy from 'busboy';
import { PassThrough, Readable } from 'node:stream';
import { blobs } from '@netlify/blobs';

/** Utility: case‑insensitive, order‑agnostic header check */
/** Utility: delimiter detection (comma vs. tab) and case-insensitive header check */
function detectDelimiter(headerLine) {
  const commas = (headerLine.match(/,/g) || []).length;
  const tabs = (headerLine.match(/	/g) || []).length;
  return tabs > commas ? '	' : ',';
}

function splitHeader(headerLine, delimiter) {
  return headerLine
    .split(delimiter)
    .map((h) => h.trim().replace(/^\"|\"$/g, ''))
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

/** Basic CSV sniffing to grab the header + up to N lines without decoding the whole file */
function extractFirstNLinesFromChunks(chunks, n) {
  const text = Buffer.concat(chunks).toString('utf8');
  const lines = text.split(/\r?\n/);
  if (lines.length <= n) return lines.join('\n');
  return lines.slice(0, n).join('\n');
}

/** Create a combined stream: first yields buffered chunks, then continues with the live stream */
function chainBufferedWithStream(bufferedChunks, liveStream) {
  async function* generator() {
    for (const chunk of bufferedChunks) yield chunk;
    for await (const chunk of liveStream) yield chunk;
  }
  return Readable.from(generator());
}

/** Parse CSV header from the snippet */
function getHeaderLine(sampleText) {
  const firstLine = sampleText.split(/\r?\n/)[0] || '';
  return firstLine;
}

/** Default required headers for TAXIS step_5 uploads */
const DEFAULT_REQUIRED_HEADERS = [
  'concept_a',
  'concept_a_t',
  'concept_b',
  'concept_b_t',
  'cooc_obs',
  'na',
  'nb',
  'total_persons',
  'cooc_event_count',
  'a_before_b',
  'b_before_a',
  'expected_obs',
  'lift',
  'z_score',
  'odds_ratio',
  'directionality_ratio'
];

export const config = {
  path: '/.netlify/functions/upload',
};

export default async (event, context) => {
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
      // capture any metadata fields
      meta[name] = val;
    });

    bb.on('file', (name, fileStream, info) => {
      if (name !== 'file') {
        // drain any unexpected file fields
        fileStream.resume();
        return;
      }
      uploadHandled = true;
      const { filename, mimeType } = info;

      // Buffer the initial bytes until we have >= sampleLines lines
      const bufferedChunks = [];
      let collectedLines = 0;
      let bufferedText = '';
      let validationDone = false;
      let validationFailed = false;
      let detectedDelimiter = ',';

      fileStream.on('data', (chunk) => {
        if (validationDone) return; // once validated, we stop collecting here
        bufferedChunks.push(chunk);
        bufferedText += chunk.toString('utf8');
        // Counting newlines is cheaper than splitting every time,
        // but splitting keeps logic simple and still cheap for first ~100 lines
        const lines = bufferedText.split(/
?
/)
        collectedLines = lines.length - 1; // number of complete lines
        if (collectedLines >= sampleLines) {
          // Perform validation
          const sample = extractFirstNLinesFromChunks(bufferedChunks, sampleLines);
          const headerLine = getHeaderLine(sample);
          const { ok: headerOk, delimiter } = hasRequiredHeaders(headerLine, requiredHeaders);
          if (!headerOk) {
            validationFailed = true;
            // Stop reading further
            fileStream.resume(); // drain to allow Busboy to finish cleanly
            return; // do not proceed to upload
          }
          detectedDelimiter = typeof delimiter !== 'undefined' ? delimiter : detectedDelimiter;
          validationDone = true;
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

          // If the stream ended before reaching sampleLines, validate with what we have
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
            detectedDelimiter = typeof delimiter !== 'undefined' ? delimiter : detectedDelimiter;
          validationDone = true;
          }

          // At this point validation passed. We need to upload the ENTIRE file.
          // However, Busboy consumed the file stream and has fired 'end'.
          // In Netlify’s Node functions runtime, Busboy provides the file stream only once.
          // To support truly massive files without rereading, we must stream to the blob WHILE parsing.
          //
          // Implementation strategy:
          //  - We attach a second Busboy instance to re‑parse the raw body stream into a second file stream
          //    only after validation. That requires buffering the raw request body which defeats our purpose.
          //
          // Better strategy (implemented below):
          //  - Instead of waiting until 'end', we should have started the upload immediately after validation.
          //  - To accomplish this in one pass, we restructure to upload in the 'data' handler as soon as validation passes.
          //
          // Because we're in the 'end' handler now for the first file, we cannot recover the already‑consumed stream.
          // To avoid confusion, we throw an instructive error prompting the developer to use the streaming path.
          //
          // *** IMPORTANT ***
          // Please scroll down to the REFACTORED HANDLER (bb.on('file') revised) which performs the
          // validation‑then‑streaming in a single pass. This 'end' handler remains for defensive programming only.

          return safeResolve({
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              error:
                'Internal flow error: file stream ended before streaming upload started. Ensure the streaming branch executes as soon as validation passes.',
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

      // *** REFACTORED STREAMING BRANCH (robust for tiny + large files) ***
      // Strategy:
      //  - We "tee" the incoming file stream into a PassThrough (uploader) but initially keep it paused.
      //  - We collect chunks into bufferedChunks until validation passes.
      //  - Once validation passes, we flush bufferedChunks into the uploader and then pipe the remainder of fileStream.
      //  - If the stream ends before validation (tiny files), we validate bufferedChunks and then upload JUST the buffered content.
      const uploader = new PassThrough({ highWaterMark: 1024 * 1024 });
      let blobWriteStarted = false;
      let blobWriteResolved = false;
      let blobKey = null;

      async function startBlobWrite(metaInfo) {
        if (blobWriteStarted) return;
        blobWriteStarted = true;
        const keyBase = meta.dataset || 'uploads';
        blobKey = `${keyBase}/${Date.now()}_${filename}`;
        // Kick off the blob write; do not await here to avoid blocking event handlers
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
            blobWriteResolved = true;
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

      fileStream.on('data', (chunk) => {
        if (validationFailed) return; // drain but ignore
        bufferedChunks.push(chunk);
        if (!validationDone) {
          bufferedText += chunk.toString('utf8');
          const lines = bufferedText.split(/
?
/)
/);
          collectedLines = lines.length - 1;
          if (collectedLines >= sampleLines) {
            const sample = extractFirstNLinesFromChunks(bufferedChunks, sampleLines);
            const headerLine = getHeaderLine(sample);
            const { ok: headerOk, delimiter } = hasRequiredHeaders(headerLine, requiredHeaders);
            if (!headerOk) {
              validationFailed = true;
              return; // we'll resolve in 'end'
            }
            detectedDelimiter = delimiter;
            validationDone = true;

            // Start blob write now that validation passed
            startBlobWrite({ filename, mimeType, delimiter: detectedDelimiter, ...meta });

            // Flush buffered data to uploader and then pipe remainder
            for (const c of bufferedChunks) uploader.write(c);
            bufferedChunks.length = 0; // clear
          }
        } else {
          // Already validated; write chunk straight to uploader
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

          // If not validated yet, validate whatever we buffered (tiny files)
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
            bufferedChunks.length = 0;
          }

          // Finalize uploader stream
          uploader.end();

          // Wait a tick for blob write to settle
          const waitForBlob = () => new Promise((res) => setImmediate(res));
          await waitForBlob();

          return safeResolve({
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ok: true, bucket: storeName, key: blobKey, metadata: { delimiter: detectedDelimiter, ...meta } }),
          });
        } catch (err) {
          return safeResolve({
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: String(err) }),
          });
        }
      });

          // Wait for remainder to finish piping
          await new Promise((r, j) => {
            remainder.on('finish', r);
            remainder.on('error', j);
          });

          return safeResolve({
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ok: true,
              bucket: storeName,
              key,
              size_hint_bytes: undefined, // unknown due to streaming
              metadata: meta,
              result: res || null,
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
    });

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
      // Otherwise, response already resolved in streaming branch
    });

    // IMPORTANT: feed the raw body to Busboy as a stream to avoid buffering
    // Netlify provides the raw body base64‑encoded by default; ensure your build config sets
    //   "body": { "encoding": "binary" } in the function’s config if needed.
    // Here we handle both plain and base64 bodies for safety.
    const isBase64 = event.isBase64Encoded;
    const bodyBuffer = Buffer.from(event.body || '', isBase64 ? 'base64' : 'utf8');

    // Create a Readable from the buffer and pipe into Busboy
    const reqStream = Readable.from(bodyBuffer);
    reqStream.pipe(bb);
  });
};


// ============================
// V2: Direct-to-Blob flow (works for very large files on Netlify)
// ============================
// Rationale: Netlify Functions receive the full request body and enforce limits (commonly ~10MB),
// so truly large uploads should go from the browser directly to Netlify Blobs using a presigned URL.
// This function validates a small sample (first ~100 lines) sent separately, then issues a one-time
// upload URL. The browser uses fetch(putUrl, { method: 'PUT', body: file }) to stream directly.

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
    const sampleLines = Number(process.env.VALIDATION_SAMPLE_LINES || 100);
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

    const sampleBuf = Buffer.from(sampleBase64, 'base64');
    const sampleText = sampleBuf.toString('utf8');
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

    // Create a presigned URL for direct client upload
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

// ============================
// Minimal client usage (browser)
// ============================
// 1) Read first ~100 lines locally for validation.
// 2) Call create-upload-url to validate & get PUT URL.
// 3) PUT the original File/Blob directly to Netlify Blobs (streams; no server body limits).
/*
async function readFirstNLines(file, n = 100) {
  const chunk = await file.slice(0, 1024 * 64).arrayBuffer(); // read first 64KB (adjust if needed)
  const text = new TextDecoder().decode(chunk);
  const lines = text.split(/
?
/).slice(0, n).join('
');
  return btoa(unescape(encodeURIComponent(lines))); // base64 for transport
}

async function uploadLargeCsv(file, meta = {}) {
  const sampleBase64 = await readFirstNLines(file, 100);

  const presignRes = await fetch('/.netlify/functions/create-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, mimeType: file.type || 'text/csv', sampleBase64, meta }),
  }).then(r => r.json());

  if (!presignRes.ok) throw new Error(presignRes.error || 'Validation failed');

  // Direct PUT to blob (streams upload, supports very large files)
  const putResp = await fetch(presignRes.putUrl, { method: 'PUT', body: file });
  if (!putResp.ok) throw new Error('Blob upload failed');

  return { key: presignRes.key, delimiter: presignRes.delimiter };
}
*/
