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

function resolveEmailFrom(event, user) {
  const hdr = event.headers || {};
  const headerEmail = hdr['x-user-email'] || hdr['X-User-Email'] || hdr['x-user'] || hdr['X-User'];
  return (user && user.email) || headerEmail || '';
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

    // Resolve user from your existing auth util (cookie/JWT based)
    let user = null;
    try {
      user = await getUserFromRequest(event);
    } catch (e) {
      console.warn('[admin-jobs] getUserFromRequest failed:', e?.message || e);
    }

    const email = resolveEmailFrom(event, user);
    const allowed = isAdminUser(email, user);

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
