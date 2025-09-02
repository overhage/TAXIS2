const fs = require('fs');
const path = require('path');
const prisma = require('./utils/prisma');
const { getUserFromRequest } = require('./utils/auth');

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

exports.handler = async function (event) {
  const user = await getUserFromRequest(event);
  if (!user || !user.isAdmin) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }
  if (event.httpMethod === 'GET') {
    // Return all jobs with details
    const jobs = await prisma.job.findMany({
      include: { upload: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const results = jobs.map((job) => {
      return {
        id: job.id,
        fileName: job.upload.originalName,
        userEmail: job.upload.user.email,
        rowCount: job.rowsTotal || 0,
        createdAt: job.createdAt,
        status: job.status,
        outputUrl: job.outputBlobKey ? `/api/download?jobId=${job.id}` : undefined,
      };
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(results),
    };
  }
  if (event.httpMethod === 'DELETE') {
    try {
      const filters = JSON.parse(event.body || '{}');
      const whereClauses = [];
      // Filter by date (delete jobs uploaded on or before date)
      if (filters.date) {
        const dateObj = new Date(filters.date);
        if (!isNaN(dateObj)) {
          whereClauses.push({ createdAt: { lte: dateObj } });
        }
      }
      // Filter by status
      if (filters.status) {
        whereClauses.push({ status: filters.status });
      }
      // Filter by user email
      let userIdFilter = null;
      if (filters.user) {
        const filterUser = await prisma.user.findUnique({ where: { email: filters.user } });
        if (filterUser) {
          userIdFilter = filterUser.id;
          whereClauses.push({ upload: { userId: userIdFilter } });
        }
      }
      // Compose where clause (AND across each filter)
      const where = whereClauses.length > 0 ? { AND: whereClauses } : {};
      // Find jobs to delete
      const jobsToDelete = await prisma.job.findMany({ where, include: { upload: true } });
      for (const job of jobsToDelete) {
        // Delete output file if exists
        if (job.outputBlobKey) {
          const outputPath = path.join(uploadsDir, job.outputBlobKey);
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        }
        // Delete upload file
        if (job.upload && job.upload.blobKey) {
          const uploadPath = path.join(uploadsDir, job.upload.blobKey);
          if (fs.existsSync(uploadPath)) {
            fs.unlinkSync(uploadPath);
          }
        }
      }
      // Delete jobs and their uploads from DB
      const jobIds = jobsToDelete.map((j) => j.id);
      await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
      const uploadIds = jobsToDelete.map((j) => j.uploadId);
      await prisma.upload.deleteMany({ where: { id: { in: uploadIds } } });
      return { statusCode: 200, body: JSON.stringify({ deleted: jobIds.length }) };
    } catch (err) {
      return { statusCode: 400, body: JSON.stringify({ error: err.message }) };
    }
  }
  return { statusCode: 405, body: 'Method Not Allowed' };
};