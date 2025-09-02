const prisma = require('./utils/prisma');
const { getUserFromRequest } = require('./utils/auth');

exports.handler = async function (event) {
  const user = await getUserFromRequest(event);
  if (!user || !user.isAdmin) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }
  const count = await prisma.masterRecord.count();
  // Find the most recent updatedAt value
  const latest = await prisma.masterRecord.findFirst({ orderBy: { updatedAt: 'desc' } });
  const lastUpdated = latest ? latest.updatedAt : null;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count, lastUpdated }),
  };
};