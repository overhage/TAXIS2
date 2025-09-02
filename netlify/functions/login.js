// netlify/functions/login.js
const auth = require('./auth');

exports.handler = (event, context) => {
  return auth.handler(event, context);
};
