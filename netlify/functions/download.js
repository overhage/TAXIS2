const fs = require('fs');
const path = require('path');
const prisma = require('./utils/prisma');
const { getUserFromRequest } = require('./utils/auth');

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

exports.handler = async function (event) {
  const user = await getUserFromRequest(event);
  if (!user) {
    return { statusCode: 401, body: 'Unauthorized' };
  }
  const params = event.queryStringParameters || {};
  const jobId = params.jobId;
  if (!jobId) {
    return { statusCode: 400, body: 'jobId parameter is required' };
  }
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { upload: true, User: true } });
  if (!job || !job.outputBlobKey) {
    return { statusCode: 404, body: 'File not found' };
  }
  // Only allow if user is owner or admin
  const isOwner = job.upload.userId === user.id || job.userId === user.id;
  if (!isOwner && !user.isAdmin) {
    return { statusCode: 403, body: 'Forbidden' };
  }
  const filePath = path.join(uploadsDir, job.outputBlobKey);
  if (!fs.existsSync(filePath)) {
    return { statusCode: 404, body: 'File not found' };
  }
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  let contentType = 'application/octet-stream';
  if (ext === '.csv') contentType = 'text/csv';
  if (ext === '.xlsx') contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return {
    statusCode: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${job.upload.originalName.replace(/\.[^.]+$/, '')}_validated${ext}"`,
    },
    body: buffer.toString('base64'),
    isBase64Encoded: true,
  };
};