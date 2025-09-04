// scripts/put-config.js
import { getStore } from '@netlify/blobs'
import fs from 'node:fs'
import path from 'node:path'


const siteID = process.env.NETLIFY_SITE_ID
const token = process.env.NETLIFY_BLOBS_TOKEN
if (!siteID || !token) {
console.error('Missing NETLIFY_SITE_ID or NETLIFY_BLOBS_TOKEN')
process.exit(1)
}


const localPath = process.argv[2]
if (!localPath) {
console.error('Usage: node scripts/put-config.js <path-to-file> [keyName]')
process.exit(1)
}


const key = process.argv[3] || path.basename(localPath)
const allowed = new Set([
'MasterRecord Fields.xlsx',
'MasterRecord Fields.csv',
'masterrecord_fields.xlsx',
'masterrecord_fields.csv',
'MasterRecordFields.xlsx',
'MasterRecordFields.csv'
])
if (!allowed.has(key)) {
console.warn(`Key “${key}” is not one of the auto-discovery names. Proceeding, but the app won’t find it unless you use one of the expected names.`)
}


const store = getStore('config', { siteID, token })
const buf = fs.readFileSync(localPath)
const lower = key.toLowerCase()
const contentType = lower.endsWith('.csv')
? 'text/csv'
: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


await store.set(key, buf, { contentType })
console.log('Uploaded to Blobs config store as:', key)