// netlify/functions/admin-download-master.mjs — Functions v2 (ESM)
// Converts the previous v1 (zisi/CommonJS) handler to v2 using the Web Fetch API.
// Streams a CSV export of MasterRecord rows. Requires Prisma (scoped in netlify.toml).

import { createRequire } from 'module'
const require = createRequire(import.meta.url)

// Interop with existing CommonJS utils without rewriting them right now
const prisma = require('./utils/prisma')
const { getUserFromRequest } = require('./utils/auth')

function toEventShim(request) {
  const url = new URL(request.url)
  return {
    httpMethod: request.method,
    path: url.pathname,
    headers: Object.fromEntries(request.headers.entries()),
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    body: null,
    isBase64Encoded: false,
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const s = String(value).replace(/"/g, '""')
  return '"' + s + '"'
}

export default async function handler(request) {
  // AuthZ: only admins can download
  const event = toEventShim(request)
  const user = await getUserFromRequest(event)
  if (!user || !(user.isAdmin || user.role === 'admin')) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })
  }

  // Stream CSV so we don't hold the whole file in memory
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const write = (chunk) => controller.enqueue(encoder.encode(chunk))

      // Page through results to avoid huge single queries
      const TAKE = 2000
      let skip = 0
      let wroteHeader = false

      try {
        for (;;) {
          const rows = await prisma.masterRecord.findMany({ take: TAKE, skip })
          if (!rows.length) break

          // Determine columns once from the first page
          if (!wroteHeader) {
            const headers = Object.keys(rows[0])
            write(headers.join(',') + '\n')
            controller.headers = headers // stash for later rows
            wroteHeader = true
          }

          const headers = controller.headers
          for (const row of rows) {
            const line = headers.map((h) => csvEscape(row[h])).join(',') + '\n'
            write(line)
          }

          skip += rows.length
          if (rows.length < TAKE) break // last page
        }

        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="MasterRecord.csv"',
      'cache-control': 'no-store',
    },
  })
}
