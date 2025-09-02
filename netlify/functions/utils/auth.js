// netlify/functions/utils/auth.js
const crypto = require('crypto');
const prisma = require('./prisma');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

// Create a 48-char random token
function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Create a session row and return the token
async function createSession(userId) {
  const token = generateToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await prisma.session.create({
    data: {
      sessionToken: token,
      userId,
      expires,
    },
  });
  return { token, expires };
}

// Parse cookies from event.headers.cookie
function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(/;\s*/)) {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const k = part.slice(0, idx);
      const v = part.slice(idx + 1);
      out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

// Look up session + user
async function getUserFromRequest(event) {
  const cookies = parseCookies(event.headers && event.headers.cookie);
  const token = cookies && cookies.session;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { sessionToken: token },
    include: { user: true },
  });

  if (!session || !session.user) return null;
  if (session.expires && session.expires < new Date()) return null;

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name || null,
    isAdmin: ADMIN_EMAILS.includes((session.user.email || '').toLowerCase()),
  };
  return user;
}

// Destroy session (logout)
async function destroySessionByToken(token) {
  try {
    await prisma.session.delete({ where: { sessionToken: token } });
  } catch (_) {}
}

module.exports = {
  createSession,
  getUserFromRequest,
  destroySessionByToken,
};
