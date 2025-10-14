/*
 * Instrumented Netlify Function: upload.mjs
 * Drop-in replacement (or merge) to trace "upload failed" causes.
 *
 * What it adds:
 *  - Structured JSON logging with a per-request ID
 *  - Timing marks for each phase (parse → validate → store → respond)
 *  - Header & size introspection (Content-Length, Content-Type, body bytes)
 *  - Clear, serialized error objects (name, message, stack, cause)
 *  - Optional ultra-verbose TRACE mode (dumps limited header/body previews)
 *
 * Enable locally:
 *   DEBUG_UPLOAD=1 TRACE_UPLOAD=0 netlify functions:serve --port 9999 upload
 * In production (Netlify UI → Env vars): set DEBUG_UPLOAD=1 while debugging.
 */

// ======= Config =======
const DEBUG = process.env.DEBUG_UPLOAD === "1";        // emit structured logs
const TRACE = process.env.TRACE_UPLOAD === "1";        // emit body/header previews
const MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES || 50 * 1024 * 1024); // 50MB default
const HARD_TIMEOUT_MS = Number(process.env.UPLOAD_TIMEOUT_MS || 60_000);    // 60s

// Optional: whitelist MIME types (empty = allow all)
const MIME_ALLOW_LIST = (process.env.UPLOAD_MIME_ALLOW || "").split(",").map(s => s.trim()).filter(Boolean);

// ======= Utilities =======
const now = () => (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
const hr = () => {
  const t = process.hrtime();
  return t[0] * 1000 + t[1] / 1e6; // ms
};

function rid(len = 10) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let out = ""; for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function safeStringify(obj) {
  try { return JSON.stringify(obj); } catch { return JSON.stringify(String(obj)); }
}

function logJSON(eventType, reqId, payload) {
  if (!DEBUG) return;
  const base = { t: new Date().toISOString(), type: eventType, reqId };
  // Use one-line JSON (easy to grep in Netlify logs)
  console.log(safeStringify({ ...base, ...payload }));
}

function previewHeaders(h) {
  const keys = ["content-type", "content-length", "x-forwarded-for", "user-agent", "origin", "referer"];
  const out = {};
  for (const k of keys) if (h[k]) out[k] = h[k];
  return out;
}

function pick(obj, keys = []) { const o = {}; for (const k of keys) if (k in obj) o[k] = obj[k]; return o; }

function serializeError(err) {
  if (!err) return null;
  const base = {
    name: err.name,
    message: err.message,
    stack: err.stack ? String(err.stack).split("\n").slice(0, 6).join("\n") : undefined,
  };
  // capture nested causes if any
  const cause = err.cause ? pick(err.cause, ["name", "message"]) : undefined;
  return cause ? { ...base, cause } : base;
}

function withTimeout(promise, ms, label = "operation") {
  let to;
  const timeout = new Promise((_, rej) => { to = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms); });
  return Promise.race([promise.finally(() => clearTimeout(to)), timeout]);
}

// ======= Core handler =======
export async function handler(event, context) {
  const started = now();
  const startHr = hr();
  const reqId = context?.awsRequestId || rid();

  // Normalize headers (lowercase keys)
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const method = (event.httpMethod || headers[":method"] || "").toUpperCase();

  logJSON("start", reqId, {
    method,
    path: event.path,
    query: event.queryStringParameters || {},
    headers: previewHeaders(headers),
    isBase64: Boolean(event.isBase64Encoded),
  });

  const marks = { start: startHr };
  function mark(name) { marks[name] = hr(); }

  try {
    // Method guard
    if (method !== "POST") {
      const res = json(405, { ok: false, error: `Method ${method} not allowed`, reqId });
      logJSON("reject_method", reqId, { status: res.statusCode });
      return res;
    }

    // Check raw body presence/size early (covers small test files too)
    mark("pre-parse");
    let rawBytes = 0;
    let bodyBuf;
    if (typeof event.body === "string") {
      bodyBuf = event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(event.body);
      rawBytes = bodyBuf.byteLength;
    } else {
      bodyBuf = Buffer.alloc(0);
    }

    const hdrLen = Number(headers["content-length"] || 0);
    const ctype = headers["content-type"] || "";

    logJSON("body_info", reqId, {
      hdrContentLength: isNaN(hdrLen) ? null : hdrLen,
      bodyBytes: rawBytes,
      mime: ctype,
      limit: MAX_BYTES,
    });

    if (rawBytes > MAX_BYTES || hdrLen > MAX_BYTES) {
      const res = json(413, { ok: false, error: `Payload too large (>${MAX_BYTES} bytes)`, reqId, bytes: rawBytes });
      logJSON("reject_size", reqId, { status: res.statusCode, bytes: rawBytes, hdrLen });
      return res;
    }

    if (!rawBytes) {
      // Some runtimes stream multipart without putting full body in event.body.
      // We still log this so you can verify if upstream proxy stripped it.
      logJSON("no_body_warning", reqId, { note: "event.body empty; multipart may require streaming parser" });
    }

    if (MIME_ALLOW_LIST.length && ctype && !MIME_ALLOW_LIST.some(m => ctype.startsWith(m))) {
      const res = json(415, { ok: false, error: `Unsupported media type: ${ctype}`, reqId });
      logJSON("reject_mime", reqId, { status: res.statusCode, ctype, allow: MIME_ALLOW_LIST });
      return res;
    }

    // ===== Phase: parse multipart OR accept as binary =====
    mark("parse_start");
    let fileMeta = null; // { filename, mime, size }
    let fileBuffer = bodyBuf; // default to entire body unless parsed below

    if (ctype.startsWith("multipart/form-data")) {
      // NOTE: For production, parse using busboy or undici's FormData parser *streaming* to avoid buffering large files.
      // Here we log and pass through to your existing parser if present.
      logJSON("multipart_hint", reqId, { hint: "multipart detected; ensure you're streaming with busboy to /tmp" });
      // TODO: If you already have parsing logic, keep it and add logs around each emitted 'file'/'field'.
      // Example placeholder:
      // const { files, fields } = await parseMultipart(event, headers);
      // fileMeta = files[0]?.meta; fileBuffer = files[0]?.buffer;
    } else if (!ctype) {
      logJSON("no_content_type", reqId, { note: "No Content-Type header provided." });
    }

    if (TRACE) {
      logJSON("preview", reqId, {
        headerSample: previewHeaders(headers),
        bodyHeadBase64: bodyBuf.subarray(0, Math.min(bodyBuf.length, 256)).toString("base64"),
      });
    }
    mark("parse_end");

    // ===== Phase: store/upload to your backend (S3, R2, Blob, DB, etc.) =====
    mark("store_start");

    // ---- REPLACE THIS with your real storage call. ----
    // Example skeleton with timeout & status logging:
    async function storePlaceholder() {
      // Simulate a quick no-op to prove timings/logs work
      return { ok: true, url: null, etag: null, bytes: rawBytes };
    }

    const storeRes = await withTimeout(storePlaceholder(), HARD_TIMEOUT_MS, "store");
    mark("store_end");

    logJSON("store_result", reqId, { storeRes });

    // ===== Phase: respond =====
    mark("respond_start");
    const mem = process.memoryUsage ? process.memoryUsage() : {};
    const timings = summarizeTimings(marks);

    const payload = {
      ok: true,
      reqId,
      bytes: rawBytes,
      mime: ctype || null,
      filename: fileMeta?.filename || null,
      storage: storeRes,
      timings,
      sys: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        node: process.version,
      },
    };

    const response = json(200, payload);
    logJSON("done", reqId, { status: 200, timings });
    return response;
  } catch (err) {
    const errObj = serializeError(err);
    const mem = process.memoryUsage ? process.memoryUsage() : {};
    const timings = summarizeTimings(marks);

    logJSON("error", reqId, { err: errObj, timings });
    return json(500, { ok: false, reqId, error: errObj, timings, sys: { node: process.version, rss: mem.rss } });
  }
}

function summarizeTimings(marks) {
  const keys = Object.keys(marks).sort((a, b) => marks[a] - marks[b]);
  const out = { marks: {} };
  let prev = null;
  for (const k of keys) {
    out.marks[k] = Number(marks[k].toFixed(3));
    if (prev) out[`${prev}→${k}`] = Number((marks[k] - marks[prev]).toFixed(3));
    prev = k;
  }
  if (keys.length) out.totalMs = Number((marks[keys[keys.length - 1]] - marks[keys[0]]).toFixed(3));
  return out;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

/* =====================
 * OPTIONAL: Multipart parser (Busboy) with logs
 *
 * Install: npm i busboy
 * Then uncomment and wire below to replace the placeholder.
 *
import Busboy from 'busboy';

async function parseMultipart(event, headers) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers });
    const files = []; const fields = {};

    bb.on('file', (name, file, info) => {
      const { filename, mimeType } = info;
      const chunks = [];
      file.on('data', (d) => chunks.push(d));
      file.on('limit', () => { /* track limits */ /* });
      file.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (DEBUG) console.log(JSON.stringify({ t: new Date().toISOString(), type: 'file_end', name, filename, mimeType, bytes: buffer.length }));
        files.push({ name, buffer, meta: { filename, mime: mimeType, size: buffer.length } });
      });
    });

    bb.on('field', (name, val) => { fields[name] = val; if (DEBUG) console.log(JSON.stringify({ t: new Date().toISOString(), type: 'field', name })); });
    bb.on('error', reject);
    bb.on('close', () => resolve({ files, fields }));

    // Feed body to busboy
    const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '');
    bb.end(body);
  });
}
 * ===================== */
