const fs = require('fs');
const path = require('path');
const prisma = require('./utils/prisma');
const { getUserFromRequest } = require('./utils/auth');

// NOTE: Local filesystem paths won't exist on Netlify when using Blobs.
// We guard all fs calls so they never crash if using remote storage.
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

exports.handler = async function (event) {
  // CORS (optional; harmless if same-origin)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    };
  }

  const user = await getUserFromRequest(event);
  if (!user || !user.isAdmin) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  if (event.httpMethod === 'GET') {
    try {
      // Return all jobs with details
      const jobs = await prisma.job.findMany({
        include: { upload: { include: { user: true } } },
        orderBy: { createdAt: 'desc' },
      });

      const results = jobs.map((job) => ({
        id: job.id,
        fileName: job.upload?.originalName ?? '(unknown)',
        userEmail: job.upload?.user?.email ?? '',
        rowCount: job.rowsTotal ?? 0,
        createdAt: job.createdAt instanceof Date ? job.createdAt.toISOString() : job.createdAt,
        status: job.status,
        // Align with the main dashboard/linking convention
        outputUrl: job.outputBlobKey ? `/api/download?job=${encodeURIComponent(job.id)}` : undefined,
      }));

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(results),
      };
    } catch (err) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err?.message || 'Failed to load jobs' }),
      };
    }
  }

  if (event.httpMethod === 'DELETE') {
    try {
      const filters = safeJsonParse(event.body) || {};

      // Build a Prisma where clause safely
      /** @type {import('@prisma/client').Prisma.JobWhereInput} */
      const where = {};

      if (filters.date) {
        const dateObj = new Date(filters.date);
        if (!isNaN(dateObj)) {
          where.createdAt = { lte: dateObj };
        }
      }

      if (filters.status) {
        where.status = filters.status;
      }

      if (filters.user) {
        // Filter by user email through the Upload -> User relation
        where.upload = { is: { user: { is: { email: filters.user } } } };
      }

      // Find jobs (with uploads) to delete
      const jobsToDelete = await prisma.job.findMany({ where, include: { upload: true } });

      // Best-effort: remove any local files if present (no-op on Blobs setups)
      for (const job of jobsToDelete) {
        try {
          if (job.outputBlobKey) {
            const outputPath = path.join(uploadsDir, job.outputBlobKey);
            if (uploadsDir && fs.existsSync(uploadsDir) && fs.existsSync(outputPath)) {
              fs.unlinkSync(outputPath);
            }
          }
          if (job.upload?.blobKey) {
            const uploadPath = path.join(uploadsDir, job.upload.blobKey);
            if (uploadsDir && fs.existsSync(uploadsDir) && fs.existsSync(uploadPath)) {
              fs.unlinkSync(uploadPath);
            }
          }
        } catch (_) {
          // ignore file deletion errors
        }
      }

      const jobIds = jobsToDelete.map((j) => j.id);
      const uploadIds = jobsToDelete.map((j) => j.uploadId).filter(Boolean);

      // Delete in a transaction to keep DB consistent
      await prisma.$transaction([
        prisma.job.deleteMany({ where: { id: { in: jobIds } } }),
        prisma.upload.deleteMany({ where: { id: { in: uploadIds } } }),
      ]);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleted: jobIds.length }),
      };
    } catch (err) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err?.message || 'Delete failed' }),
      };
    }
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};

function safeJsonParse(input) {
  try {
    return input ? JSON.parse(input) : null;
  } catch (_) {
    return null;
  }
}
