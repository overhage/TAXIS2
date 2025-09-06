// netlify/functions/admin-llm-cache.ts
import type { Handler } from '@netlify/functions'
import { PrismaClient } from '@prisma/client'

// Reuse Prisma across warm invocations to avoid connection storms
const g = globalThis as any
const prisma: PrismaClient = g.__prisma ?? new PrismaClient({ log: ['warn', 'error'] })
if (!g.__prisma) g.__prisma = prisma

function toCsv(rows: any[]): string {
  const esc = (v: any) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const headers = rows.length ? Object.keys(rows[0]) : []
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n')
}

export const handler: Handler = async (event) => {
  try {
    const params = event.queryStringParameters ?? {}
    const op = params.op ?? 'tail'
    const n = Math.max(1, Math.min(100, parseInt(params.n ?? '5', 10)))

    if (op === 'tail') {
      const dbRows = await prisma.llmCache.findMany({
        orderBy: { createdAt: 'desc' },
        take: n * 3, // tiny overfetch in case some results aren't JSON parseable
      })

      const rows = dbRows.slice(0, n).map(r => {
        let parsed: any = null
        try { parsed = JSON.parse(r.result) } catch { /* keep null */ }
        const previewSrc =
          parsed?.result_text ??
          parsed?.relationship_type ??
          parsed?.rationale ??
          r.result

        const preview = String(previewSrc ?? '').replace(/\s+/g, ' ').slice(0, 160) +
          (String(previewSrc ?? '').length > 160 ? '…' : '')

        return {
          createdAt: r.createdAt.toISOString(),
          promptKey: r.promptKey,
          model: r.model ?? '',
          tokensIn: r.tokensIn ?? 0,
          tokensOut: r.tokensOut ?? 0,
          totalTokens: (r.tokensIn ?? 0) + (r.tokensOut ?? 0),
          preview,
        }
      })

      const columns = rows.length ? Object.keys(rows[0]) : []
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        body: JSON.stringify({ columns, rows }),
      }
    }

    if (op === 'stats') {
      const agg = await prisma.llmCache.aggregate({
        _count: { _all: true },
        _sum: { tokensIn: true, tokensOut: true },
      })
      const calls = agg._count._all ?? 0
      const sumPrompt = agg._sum.tokensIn ?? 0
      const sumCompletion = agg._sum.tokensOut ?? 0
      const sumTotal = sumPrompt + sumCompletion
      const avgPerCall = calls ? Math.round((sumTotal / calls) * 10) / 10 : 0

      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        body: JSON.stringify({ calls, sumPrompt, sumCompletion, sumTotal, avgPerCall }),
      }
    }

    if (op === 'download') {
      const dbRows = await prisma.llmCache.findMany({
        orderBy: { createdAt: 'desc' },
        take: 1000,
      })
      const rows = dbRows.map(r => ({
        createdAt: r.createdAt.toISOString(),
        promptKey: r.promptKey,
        model: r.model ?? '',
        tokensIn: r.tokensIn ?? '',
        tokensOut: r.tokensOut ?? '',
        result: String(r.result ?? '').replace(/\r?\n/g, ' ').slice(0, 4000),
      }))
      const csv = toCsv(rows)
      return {
        statusCode: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="llmcache.csv"',
          'cache-control': 'no-store',
        },
        body: csv,
      }
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown op' }) }
  } catch (e: any) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: e?.message || 'Server error' }),
    }
  }
}