// netlify/functions/auth.js
const prisma = require('./utils/prisma');
const { createSession } = require('./utils/auth');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Accept either var set
const clientId = process.env.GITHUB_CLIENT_ID || process.env.GITHUB_ID;
const clientSecret = process.env.GITHUB_CLIENT_SECRET || process.env.GITHUB_SECRET;

exports.handler = async function (event) {
  try {
    const host = event.headers['x-forwarded-host'] || event.headers.host;
    const proto = (event.headers['x-forwarded-proto'] || 'https');
    // event.path will be like "/.netlify/functions/login" or "/.netlify/functions/auth"
    const thisFnPath = event.path; // serverless mount
    // Public URL path that the browser used (via your redirect rule): replace the mount with /api/<name>
    const publicPath = thisFnPath.replace('/.netlify/functions', '/api');
    const baseUrl = `${proto}://${host}`;
    const callbackUrl = `${baseUrl}${publicPath}`;

    const url = new URL(event.rawUrl || `${baseUrl}${publicPath}`);
    const code = url.searchParams.get('code');

    // Phase 1: redirect to GitHub authorization
    if (!code) {
      if (!clientId || !clientSecret) {
        return { statusCode: 500, body: 'GitHub OAuth not configured' };
      }
      const authorize = new URL('https://github.com/login/oauth/authorize');
      authorize.searchParams.set('client_id', clientId);
      authorize.searchParams.set('redirect_uri', callbackUrl);
      authorize.searchParams.set('scope', 'read:user user:email');

      return {
        statusCode: 302,
        headers: { Location: authorize.toString() },
      };
    }

    // Phase 2: exchange code for token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callbackUrl,
      }),
    }).then(r => r.json());

    if (!tokenRes.access_token) {
      console.error('OAuth token error', tokenRes);
      return { statusCode: 401, body: 'GitHub OAuth failed (no token)' };
    }

    const ghHeaders = { Authorization: `Bearer ${tokenRes.access_token}`, 'User-Agent': 'taxis2' };
    const profile = await fetch('https://api.github.com/user', { headers: ghHeaders }).then(r => r.json());
    // Try primary verified email
    let email = profile.email;
    if (!email) {
      const emails = await fetch('https://api.github.com/user/emails', { headers: ghHeaders }).then(r => r.json());
      const primary = Array.isArray(emails) ? emails.find(e => e.primary && e.verified) : null;
      email = (primary && primary.email) || (Array.isArray(emails) && emails[0] && emails[0].email) || null;
    }

    if (!email) {
      return { statusCode: 400, body: 'Unable to obtain email from GitHub' };
    }

    // Upsert user
    const user = await prisma.user.upsert({
      where: { email },
      update: { name: profile.name || profile.login || null },
      create: {
        email,
        name: profile.name || profile.login || null,
        role: 'user',
      },
    });

    // Create session + cookie
    const session = await createSession(user.id);
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
      headers: {
        'Set-Cookie': cookie,
        // Send user to the app (dashboard route exists in the SPA)
        Location: '/dashboard',
      },
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Auth error' };
  }
};
