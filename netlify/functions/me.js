const { getUserFromRequest } = require('./utils/auth');

exports.handler = async function (event, context) {
  const user = await getUserFromRequest(event);
  if (!user) {
    return { statusCode: 200, body: JSON.stringify({}) };
  }
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(user),
  };
};