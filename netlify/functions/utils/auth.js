const crypto = require('crypto');
const prisma = require('./prisma');

const SESSION_SECRET = process.env.SESSION_SECRET || 'default_secret';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase());

/**
 * Generate a random session token.
 */
function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Compute an HMAC signature for a value using the SESSION_SECRET.
 */
function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

/**
 * Create a new session for a given userId. Returns the cookie string.
 */
async function createSession(userId) {
  const token = generateToken();
  const signature = sign(token);
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await prisma.session.create({
    data: {
      sessionToken: token,
      userId,
      expires,
    },
  });
  const cookieVal = `${token}:${signature}`;
  return {
    cookie: `session=${cookieVal}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expires.toUTCString()}`,
    expires,
  };
}

/**
 * Remove a session from the database.
 */
async function destroySession(sessionToken) {
  await prisma.session.deleteMany({ where: { sessionToken } });
}

/**
 * Parse cookies from a request header string.
 */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  const pairs = cookieHeader.split(/;\s*/);
  for (const pair of pairs) {
    const [key, ...rest] = pair.split('=');
    cookies[key] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

/**
 * Validate a session cookie and return the associated user.
 */
async function getUserFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionCookie = cookies['session'];
  if (!sessionCookie) return null;
  const [token, signature] = sessionCookie.split(':');
  if (!token || !signature) return null;
  const expectedSig = sign(token);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return null;
  }
  const session = await prisma.session.findUnique({ where: { sessionToken: token }, include: { user: true } });
  if (!session || session.expires < new Date()) {
    return null;
  }
  if (!session.user) return null;
  const user = session.user;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: ADMIN_EMAILS.includes(user.email.toLowerCase()),
  };
}

module.exports = {
  createSession,
  destroySession,
  getUserFromRequest,
};