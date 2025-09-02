// netlify/functions/download.js
const prisma = require('./utils/prisma');
const { getUserFromRequest } = require('./utils/auth');

exports.handler = async (event) => {
  const user = await getUserFromRequest(event);
  if (!user) return { statusCode: 401, body: 'Unauthorized' };

  const jobId = (event.queryStringParameters && event.queryStringParameters.job) || null;
  if (!jobId) return { statusCode: 400, body: 'Missing job id' };

  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { upload: true, User: true } });
  if (!job) return { statusCode: 404, body: 'Job not found' };

  // Only owner (or admin) can download
  const isOwner = job.userId === user.id;
  const isAdmin = user.isAdmin;
  if (!isOwner && !isAdmin) return { statusCode: 403, body: 'Forbidden' };

  if (!job.outputBlobKey) return { statusCode: 404, body: 'No output available' };

  // Dynamic import of Blobs in CommonJS
  const { getStore } = await import('@netlify/blobs');
  const outputsStore = getStore({ name: 'outputs' });

  const arrayBuf = await outputsStore.get(job.outputBlobKey, { type: 'arrayBuffer' });
  if (!arrayBuf) return { statusCode: 404, body: 'Output not found' };

  const buf = Buffer.from(arrayBuf);

  // Suggest a filename from the key
  const suggested = job.outputBlobKey.split('/').pop() || 'output.csv';

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${suggested}"`,
    },
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
};
