// netlify/functions/me.js
const { getUserFromRequest } = require('./utils/auth');

exports.handler = async function (event) {
  const user = await getUserFromRequest(event);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user || {}),
  };
};
