// Netlify Function: admin-jobs
// Purpose: list/delete jobs for admins. Admin = user.isAdmin OR email in ADMIN_EMAILS
// This version performs robust email extraction from:
//  1) your existing getUserFromRequest(event)
//  2) x-user-email header
//  3) Authorization: Bearer <JWT> (Netlify Identity/JWT)
//  4) nf_jwt cookie (Netlify Identity)

const prisma = require('./utils/prisma');
const { getUserFromRequest } = require('./utils/auth');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function allowOriginHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Email',
  };
}

function base64UrlToBase64(s) {
  if (!s) return '';
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  return s;
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length < 2) return null;
    const b64 = base64UrlToBase64(parts[1]);
    const json = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

function getCookie(name, cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const c of cookies) {
    const idx = c.indexOf('=');
    if (idx === -1) continue;
    const k = c.slice(0, idx);
    const v = c.slice(idx + 1);
    if (k === name) return decodeURIComponent(v);
  }
  return null;
}

function extractEmailFromJwt(token) {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return (
    payload.email ||
    (Array.isArray(payload.emails) && payload.emails[0]) ||
    payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] ||
    null
  );
}

function resolveEmailFrom(event, user) {
  const hdrs = event.headers || {};
  const headerEmail = hdrs['x-user-email'] || hdrs['X-User-Email'] || hdrs['x-user'] || hdrs['X-User'];
  if (user && user.email) return user.email;
  if (headerEmail) return headerEmail;

  // Authorization: Bearer <jwt>
  const auth = hdrs.authorization || hdrs.Authorization;
  if (auth && /^Bearer\s+/i.test(auth)) {
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    const email = extractEmailFromJwt(token);
    if (email) return email;
  }

  // nf_jwt cookie (Netlify Identity)
  const cookieJwt = getCookie('nf_jwt', hdrs.cookie || hdrs.Cookie);
  if (cookieJwt) {
    const email = extractEmailFromJwt(cookieJwt);
    if (email) return email;
  }

  return '';
}

function isAdminUser(email, user) {
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const emailOk = email && list.includes(String(email).toLowerCase());
  return Boolean((user && user.isAdmin) || emailOk);
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: allowOriginHeaders(), body: '' };
    }

    console.log('[admin-jobs] invoked', {
      method: event.httpMethod,
      path: event.path,
      qs: event.queryStringParameters,
    });

    // Resolve user via your auth util
    let user = null;
    try {
      user = await getUserFromRequest(event);
    } catch (e) {
      console.warn('[admin-jobs] getUserFromRequest failed:', e?.message || e);
    }

    const email = resolveEmailFrom(event, user);
    const allowed = isAdminUser(email, user);

    console.log('[admin-jobs] auth check', {
      email: email || '(none)',
      envAdmins: (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean),
      userIsAdminFlag: Boolean(user && user.isAdmin),
      allowed,
    });

    if (!allowed) {
      return json(403, { error: 'Forbidden', who: email || '(unknown)' });
    }

    if (event.httpMethod === 'GET') {
      try {
        const jobs = await prisma.job.findMany({
          include: { upload: { include: { user: true } } },
          orderBy: { createdAt: 'desc' },
        });
        const results = jobs.map((job) => ({
          id: job.id,
          fileName: job.upload?.originalName ?? '(unknown)',
          userEmail: job.upload?.user?.email ?? '',
          rowCount: job.rowsTotal ?? 0,
          createdAt: job.createdAt instanceof Date ? job.createdAt.toISOString() : String(job.createdAt),
          status: job.status,
          outputUrl: job.outputBlobKey ? `/api/download?job=${encodeURIComponent(job.id)}` : undefined,
        }));
        return json(200, results);
      } catch (err) {
        console.error('[admin-jobs] GET failed', err);
        return json(500, { error: err?.message || 'Failed to load jobs' });
      }
    }

    if (event.httpMethod === 'DELETE') {
      try {
        const body = event.body ? JSON.parse(event.body) : {};
        /** @type {import('@prisma/client').Prisma.JobWhereInput} */
        const where = {};

        if (body.date) {
          const d = new Date(body.date);
          if (!isNaN(d)) where.createdAt = { lte: d };
        }
        if (body.status) where.status = body.status;
        if (body.user) where.upload = { is: { user: { is: { email: body.user } } } };

        const jobsToDelete = await prisma.job.findMany({ where, include: { upload: true } });
        const jobIds = jobsToDelete.map((j) => j.id);
        const uploadIds = jobsToDelete.map((j) => j.uploadId).filter(Boolean);

        await prisma.$transaction([
          prisma.job.deleteMany({ where: { id: { in: jobIds } } }),
          prisma.upload.deleteMany({ where: { id: { in: uploadIds } } }),
        ]);

        return json(200, { deleted: jobIds.length });
      } catch (err) {
        console.error('[admin-jobs] DELETE failed', err);
        return json(400, { error: err?.message || 'Delete failed' });
      }
    }

    return { statusCode: 405, headers: { 'Content-Type': 'text/plain' }, body: 'Method Not Allowed' };
  } catch (e) {
    console.error('[admin-jobs] unhandled', e);
    return json(500, { error: 'Unhandled error', detail: String(e?.message || e) });
  }
};
