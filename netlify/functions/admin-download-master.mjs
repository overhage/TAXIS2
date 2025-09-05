// netlify/functions/admin-download-master.mjs — Functions v2 (ESM)
// Use shared admin gate helper and stream MasterRecord as CSV

import { PrismaClient } from '@prisma/client'
import { requireAdmin } from './_admin-gate.mjs'

// Reuse Prisma between invocations
const prisma = globalThis.__PRISMA__ ?? new PrismaClient()
if (!globalThis.__PRISMA__) globalThis.__PRISMA__ = prisma

function csvEscape(v) {
  if (v === null || v === undefined) return ''
  const s = String(v).replace(/"/g, '""')
  return '"' + s + '"'
}

export default async function handler(request) {
  // Admin gate (env ADMIN_EMAILS, DB flags, or legacy utils)
  const gate = await requireAdmin(request)
  if (!gate.allowed) return gate.forbidden()

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const write = (s) => controller.enqueue(enc.encode(s))

      const TAKE = 2000
      let skip = 0
      let cols = null

      try {
        for (;;) {
          const rows = await prisma.masterRecord.findMany({ take: TAKE, skip })
          if (rows.length === 0) break

          if (!cols) {
            cols = Object.keys(rows[0])
            write(cols.join(',') + '\n')
          }

          for (const row of rows) {
            const line = cols.map((h) => csvEscape(row[h])).join(',') + '\n'
            write(line)
          }

          skip += rows.length
          if (rows.length < TAKE) break
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
