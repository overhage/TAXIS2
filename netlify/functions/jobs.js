const prisma = require('./utils/prisma');
const { getUserFromRequest } = require('./utils/auth');

exports.handler = async function (event, context) {
  const user = await getUserFromRequest(event);
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  }
  const jobs = await prisma.job.findMany({
    where: {
      OR: [
        { userId: user.id },
        { upload: { userId: user.id } },
      ],
    },
    include: {
      upload: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
  const results = jobs.map((job) => {
    const createdAt = job.createdAt;
    const finishedAt = job.finishedAt;
    return {
      id: job.id,
      fileName: job.upload.originalName,
      status: job.status,
      createdAt: createdAt,
      finishedAt: finishedAt,
      outputUrl: job.outputBlobKey ? `/api/download?jobId=${job.id}` : undefined,
    };
  });
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results),
  };
};