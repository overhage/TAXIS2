const prisma = require('./utils/prisma');
const { getUserFromRequest } = require('./utils/auth');

exports.handler = async function (event) {
  const user = await getUserFromRequest(event);
  if (!user || !user.isAdmin) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }
  const rows = await prisma.masterRecord.findMany();
  // Convert to CSV
  const headers = Object.keys(rows[0] || {});
  const csvLines = [];
  csvLines.push(headers.join(','));
  for (const row of rows) {
    csvLines.push(headers.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) return '';
      const escaped = String(val).replace(/"/g, '""');
      return `"${escaped}"`;
    }).join(','));
  }
  const csv = csvLines.join('\n');
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="MasterRecord.csv"',
    },
    body: csv,
  };
};