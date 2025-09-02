const prisma = require('./utils/prisma');
const { getUserFromRequest } = require('./utils/auth');

exports.handler = async function (event) {
  const user = await getUserFromRequest(event);
  if (!user || !user.isAdmin) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }
  const queryParams = event.queryStringParameters || {};
  const query = queryParams.query;
  if (!query || query.trim() === '') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    };
  }
  const results = await prisma.masterRecord.findMany({
    where: {
      OR: [
        { concept_a_t: { contains: query, mode: 'insensitive' } },
        { concept_b_t: { contains: query, mode: 'insensitive' } },
      ],
    },
    take: 50,
    orderBy: { updatedAt: 'desc' },
    select: {
      pairId: true,
      concept_a: true,
      concept_a_t: true,
      concept_b: true,
      concept_b_t: true,
      cooc_event_count: true,
      lift_lower_95: true,
      lift_upper_95: true,
    },
  });
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results),
  };
};