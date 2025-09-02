// netlify/functions/auth.js
const prisma = require('./utils/prisma');
const { createSession } = require('./utils/auth');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Support either var name
const clientId = process.env.GITHUB_CLIENT_ID || process.env.GITHUB_ID;
const clientSecret = process.env.GITHUB_CLIENT_SECRET || process.env.GITHUB_SECRET;

exports.handler = async function (event) {
  const logAnd500 = (label, errObj) => {
    console.error(label, errObj);
    const msg = typeof errObj === 'string' ? errObj : (errObj && errObj.message) || 'unknown';
    // Temporary: include short reason in body to speed up debugging
    return { statusCode: 500, body: `Auth error: ${label}: ${msg}` };
  };

  try {
    const host = event.headers['x-forwarded-host'] || event.headers.host;
    const proto = event.headers['x-forwarded-proto'] || 'https';
    const thisFnPath = event.path; // "/.netlify/functions/login" or "/.netlify/functions/auth"
    const publicPath = thisFnPath.replace('/.netlify/functions', '/api');
    const baseUrl = `${proto}://${host}`;
    const callbackUrl = `${baseUrl}${publicPath}`;

    if (!clientId || !clientSecret) {
      return logAnd500('missing_oauth_secrets', 'GITHUB_CLIENT_ID/SECRET (or GITHUB_ID/SECRET) not set');
    }

    const url = new URL(event.rawUrl || `${baseUrl}${publicPath}`);
    const code = url.searchParams.get('code');

    // Phase 1: send to GitHub
    if (!code) {
      const authorize = new URL('https://github.com/login/oauth/authorize');
      authorize.searchParams.set('client_id', clientId);
      authorize.searchParams.set('redirect_uri', callbackUrl);
      authorize.searchParams.set('scope', 'read:user user:email');
      return { statusCode: 302, headers: { Location: authorize.toString() } };
    }

    // Phase 2: exchange code
    let tokenRes;
    try {
      tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: callbackUrl }),
      }).then(r => r.json());
    } catch (e) {
      return logAnd500('token_exchange_fetch_failed', e);
    }

    if (!tokenRes || !tokenRes.access_token) {
      return logAnd500('token_exchange_no_access_token', tokenRes || {});
    }

    const ghHeaders = { Authorization: `Bearer ${tokenRes.access_token}`, 'User-Agent': 'taxis2' };
    const profile = await fetch('https://api.github.com/user', { headers: ghHeaders }).then(r => r.json());
    let email = profile.email;
    if (!email) {
      const emails = await fetch('https://api.github.com/user/emails', { headers: ghHeaders }).then(r => r.json());
      const primary = Array.isArray(emails) ? emails.find(e => e.primary && e.verified) : null;
      email = (primary && primary.email) || (Array.isArray(emails) && emails[0] && emails[0].email) || null;
    }
    if (!email) return logAnd500('no_email_from_github', profile);

    // DB write (most common failure if tables are missing or DB unreachable)
    let user;
    try {
      user = await prisma.user.upsert({
        where: { email },
        update: { name: profile.name || profile.login || null },
        create: { email, name: profile.name || profile.login || null, role: 'user' },
      });
    } catch (e) {
      return logAnd500('prisma_upsert_failed', e);
    }

    // Session + cookie
    let session;
    try {
      session = await createSession(user.id);
    } catch (e) {
      return logAnd500('session_create_failed', e);
    }

    const cookie = [
      `session=${encodeURIComponent(session.token)}:${session.signature}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Secure',
      `Max-Age=${30 * 24 * 60 * 60}`,
    ].join('; ');

    return {
      statusCode: 302,
      headers: { 'Set-Cookie': cookie, Location: '/dashboard' },
    };
  } catch (err) {
    return logAnd500('unexpected', err);
  }
};
