// netlify/functions/admin-download-master.mjs — Functions v2 (ESM)
// Fixes runtime module error by removing local './utils/prisma' dependency.
// Uses PrismaClient directly and streams a CSV of MasterRecord rows.


import { PrismaClient } from '@prisma/client'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)


// Reuse Prisma between invocations
const prisma = globalThis.__PRISMA__ ?? new PrismaClient()
if (!globalThis.__PRISMA__) globalThis.__PRISMA__ = prisma


let getUserFromRequest
try { ({ getUserFromRequest } = require('./utils/auth')) } catch (_) { getUserFromRequest = null }


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


function csvEscape(v) {
if (v === null || v === undefined) return ''
const s = String(v).replace(/"/g, '""')
return '"' + s + '"'
}


export default async function handler(request) {
// Require admin
if (!getUserFromRequest) {
return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } })
}
const user = await getUserFromRequest(toEventShim(request))
if (!user || !(user.isAdmin || user.role === 'admin')) {
return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } })
}


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