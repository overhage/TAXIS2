// netlify/functions/admin-llm-cache.js — pure JS, Prisma-safe, JSON responses
// Endpoint(s):
//   /.netlify/functions/admin-llm-cache   (default Netlify path)
//   /admin-llm-cache                      (pretty path via export const config)
// Ops:
//   ?op=tail&n=5[&jobId=...]    -> { rows, columns }
//   ?op=stats[&jobId=...]       -> { calls, sumPrompt, sumCompletion, sumTotal, avgPerCall }
//   ?op=download[&jobId=...]    -> CSV download

import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

export const config = { path: '/admin-llm-cache' };

async function requireAdmin(request) {
  // Best-effort: use your shared admin check if available; otherwise allow.
  try {
    const mod = await import('../../lib/auth.js').catch(() => import('../../lib/auth'));
    if (mod && typeof mod.requireAdmin === 'function') {
      return await mod.requireAdmin(request);
    }
  } catch {}
  return true;
}

function rawTable(name) {
  // Quote if any uppercase letters exist (Postgres case-sensitive identifiers)
  const needsQuotes = /[A-Z]/.test(name);
  const safe = String(name).replaceAll('"', '""');
  return Prisma.raw(needsQuotes ? `"${safe}"` : safe);
}

async function resolveTableRef() {
  const candidates = ['LLMCache', 'LlmCache', 'llm_cache', 'llmcache'];
  for (const t of candidates) {
    try {
      // If table doesn't exist, this throws
      await prisma.$queryRaw(Prisma.sql`SELECT 1 FROM ${rawTable(t)} LIMIT 1`);
      return rawTable(t);
    } catch (e) {
      // try next
    }
  }
  throw new Error('LLM cache table not found. Tried: LLMCache, LlmCache, llm_cache, llmcache');
}

function toCsv(rows) {
  if (!rows || !rows.length) return '';
  const cols = Array.from(rows.reduce((s, r) => { Object.keys(r || {}).forEach((k) => s.add(k)); return s; }, new Set()));
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return (s.includes('"') || s.includes(',') || s.includes('\n')) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  const header = cols.join(',');
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\n');
  return header + '\n' + body;
}

function computeStats(rows) {
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : Number(x) || 0);
  let calls = 0, sumPrompt = 0, sumCompletion = 0, sumTotal = 0;
  for (const r of rows || []) {
    if (!r) continue; calls += 1;
    const p = num(r.promptTokens ?? r.prompt_tokens);
    const c = num(r.completionTokens ?? r.completion_tokens);
    const t = num(r.totalTokens ?? r.total_tokens ?? (Number.isFinite(p + c) ? p + c : 0));
    sumPrompt += p; sumCompletion += c; sumTotal += t;
  }
  const avgPerCall = calls ? Math.round((sumTotal / calls) * 100) / 100 : 0;
  return { calls, sumPrompt, sumCompletion, sumTotal, avgPerCall };
}

export default async (request) => {
  const url = new URL(request.url);
  const op = url.searchParams.get('op') || 'tail';
  const n = Math.min(500, Math.max(1, Number(url.searchParams.get('n') || '5')));
  const jobId = url.searchParams.get('jobId') || undefined;

  try {
    if (!(await requireAdmin(request))) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403, headers: { 'content-type': 'application/json; charset=utf-8' } });
    }

    const table = await resolveTableRef();

    if (op === 'tail') {
      let sql;
      if (jobId) {
        sql = Prisma.sql`
          SELECT * FROM ${table}
          WHERE job_id = ${jobId} OR "jobId" = ${jobId}
          ORDER BY COALESCE(created_at, "createdAt") DESC NULLS LAST
          LIMIT ${Number(n)}
        `;
      } else {
        sql = Prisma.sql`
          SELECT * FROM ${table}
          ORDER BY COALESCE(created_at, "createdAt") DESC NULLS LAST
          LIMIT ${Number(n)}
        `;
      }
      const rows = await prisma.$queryRaw(sql);
      return new Response(JSON.stringify({ rows, columns: rows[0] ? Object.keys(rows[0]) : [] }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    }

    if (op === 'stats') {
      let sql;
      if (jobId) {
        sql = Prisma.sql`
          SELECT * FROM ${table}
          WHERE job_id = ${jobId} OR "jobId" = ${jobId}
          ORDER BY COALESCE(created_at, "createdAt") DESC NULLS LAST
          LIMIT 5000
        `;
      } else {
        sql = Prisma.sql`
          SELECT * FROM ${table}
          ORDER BY COALESCE(created_at, "createdAt") DESC NULLS LAST
          LIMIT 5000
        `;
      }
      const rows = await prisma.$queryRaw(sql);
      const stats = computeStats(rows);
      return new Response(JSON.stringify(stats), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    }

    if (op === 'download') {
      let sql;
      if (jobId) {
        sql = Prisma.sql`
          SELECT * FROM ${table}
          WHERE job_id = ${jobId} OR "jobId" = ${jobId}
          ORDER BY COALESCE(created_at, "createdAt") DESC NULLS LAST
        `;
      } else {
        sql = Prisma.sql`
          SELECT * FROM ${table}
          ORDER BY COALESCE(created_at, "createdAt") DESC NULLS LAST
        `;
      }
      const rows = await prisma.$queryRaw(sql);
      const csv = toCsv(rows);
      return new Response(csv, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="llmcache${jobId ? '-' + jobId : ''}.csv"` } });
    }

    return new Response(JSON.stringify({ error: `unknown op: ${op}` }), { status: 400, headers: { 'content-type': 'application/json; charset=utf-8' } });
  } catch (err) {
    console.error('admin-llm-cache error', err);
    return new Response(JSON.stringify({ error: String(err && err.message ? err.message : err) }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
};
