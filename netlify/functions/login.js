// netlify/functions/login.js
const auth = require('./auth');

exports.handler = async (event, context) => {
  // Just forward to the real handler
  return auth.handler(event, context);
};
