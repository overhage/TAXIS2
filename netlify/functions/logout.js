const { destroySession } = require('./utils/auth');

exports.handler = async function (event, context) {
  const cookies = (event.headers.cookie || '').split(/;\s*/);
  let sessionToken = null;
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === 'session') {
      const [token] = decodeURIComponent(value).split(':');
      sessionToken = token;
      break;
    }
  }
  if (sessionToken) {
    await destroySession(sessionToken);
  }
  return {
    statusCode: 302,
    headers: {
      'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      Location: '/login',
    },
  };
};