// /netlify/functions/_notify.mjs
import { PrismaClient } from '@prisma/client'

globalThis.__prisma ??= new PrismaClient({ log: ['warn','error'] })
const prisma = globalThis.__prisma

const PROVIDER = (process.env.MAIL_PROVIDER || 'resend').toLowerCase() // 'resend' | 'sendgrid'
const FROM = process.env.MAIL_FROM || 'TAXIS <no-reply@taxis2.example>'
const BASE = process.env.APP_BASE_URL || process.env.URL || process.env.DEPLOY_URL || 'https://taxis2.netlify.app'

export async function notifyJobEvent ({ jobId, event, error }) {
  // Load job + user to find recipient
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { user: true, upload: true }
  }).catch(() => null)
  if (!job) return

  const to = job.user?.email || job.notifyEmail || job.email || null
  if (!to) { console.warn('[notify] no recipient email for job', jobId); return }

  const subject = event === 'completed'
    ? `TAXIS job ${jobId} completed (${job.rowsProcessed}/${job.rowsTotal})`
    : `TAXIS job ${jobId} failed`

  const dashUrl = `${BASE}/dashboard?job=${encodeURIComponent(jobId)}`
  const text = event === 'completed'
    ? `Your job has completed.\nProcessed ${job.rowsProcessed}/${job.rowsTotal}.\nOpen: ${dashUrl}`
    : `Your job failed.\nLast progress: ${job.rowsProcessed}/${job.rowsTotal}.\nOpen: ${dashUrl}\n\n${error ? String(error).slice(0,1000) : ''}`

  const html = `
    <p>Job <strong>${jobId}</strong> ${event}.</p>
    <p>Progress: ${job.rowsProcessed}/${job.rowsTotal}</p>
    <p><a href="${dashUrl}">Open the dashboard</a> to view or download results.</p>
    ${event === 'failed' && error ? `<pre style="white-space:pre-wrap">${escapeHtml(String(error).slice(0,1000))}</pre>` : ''}
  `

  try {
    if (PROVIDER === 'resend') await sendViaResend({ to, subject, text, html })
    else if (PROVIDER === 'sendgrid') await sendViaSendGrid({ to, subject, text, html })
    else console.log('[notify] (dry-run) would email', to, subject)
  } catch (e) {
    console.warn('[notify] send failed', e?.message || e)
  }
}

function escapeHtml(s=''){return s.replace(/[&<>"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]))}

async function sendViaResend ({ to, subject, text, html }) {
  const api = process.env.RESEND_API_KEY
  if (!api) throw new Error('Missing RESEND_API_KEY')
  const from = FROM
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${api}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text, html })
  })
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text().catch(()=> '')}`)
}

async function sendViaSendGrid ({ to, subject, text, html }) {
  const api = process.env.SENDGRID_API_KEY
  if (!api) throw new Error('Missing SENDGRID_API_KEY')
  const fromEmail = FROM.includes('<') ? FROM.match(/<(.*)>/)?.[1] : FROM
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${api}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail },
      subject,
      content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }]
    })
  })
  if (!r.ok) throw new Error(`SendGrid ${r.status}: ${await r.text().catch(()=> '')}`)
}
