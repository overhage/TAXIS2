// netlify/functions/_db.mjs
import { PrismaClient } from '@prisma/client'

// One client per function instance
globalThis.__prisma ??= new PrismaClient({
  log: ['warn', 'error', 'info'] // drop query-level logs in prod
})

export const prisma = globalThis.__prisma
