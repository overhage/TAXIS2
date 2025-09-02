// netlify/functions/auth.js
const prisma = require('./utils/prisma');
const { createSession } = require('./utils/auth');

// Accept either var name from env
const clientId = process.env.GITHUB_CLIENT_ID || process.env.GITHUB_ID;
const clientSecret = process.env.GITHUB_CLIENT_SECRET || process.env.GITHUB_SECRET;

exports.handler = async function (event) {
  const fail = (label, err) => {
    const msg = (err && err.message) ? err.message : (typeof err === 'string' ? err : 'unknown');
    console.error(label, err);
    return { statusCode: 500, body: `Auth error: ${label}: ${msg}` };
  };

  try {
    const host = event.headers['x-forwarded-host'] || event.headers.host || '';
    const proto = event.headers['x-forwarded-proto'] || 'https';
    const thisFnPath = event.path || '/.netlify/functions/login'; // "/.netlify/functions/login"
    const publicPath = thisFnPath.replace('/.netlify/functions', '/api'); // "/api/login"
    const baseUrl = `${proto}://${host}`;
    const callbackUrl = `${baseUrl}${publicPath}`;

    if (!clientId || !clientSecret) {
      return fail('missing_oauth_secrets', 'Set GITHUB_CLIENT_ID/SECRET or GITHUB_ID/SECRET');
    }

    const url = new URL(event.rawUrl || callbackUrl);
    const code = url.searchParams.get('code');

    // Phase 1: send user to GitHub
    if (!code) {
      const authorize = new URL('https://github.com/login/oauth/authorize');
      authorize.searchParams.set('client_id', clientId);
      authorize.searchParams.set('redirect_uri', callbackUrl);
      authorize.searchParams.set('scope', 'read:user user:email');
      return { statusCode: 302, headers: { Location: authorize.toString() } };
    }

    // Phase 2: exchange code for token
    let tokenRes;
    try {
      const r = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: callbackUrl,
        }),
      });
      tokenRes = await r.json();
    } catch (e) {
      return fail('token_exchange_fetch_failed', e);
    }

    if (!tokenRes || !tokenRes.access_token) {
      return fail('token_exchange_no_access_token', tokenRes || {});
    }

    const ghHeaders = {
      Authorization: `Bearer ${tokenRes.access_token}`,
      'User-Agent': 'taxis2',
    };

    const profile = await (await fetch('https://api.github.com/user', { headers: ghHeaders })).json();

    // Determine email
    let email = profile && profile.email;
    if (!email) {
      const emails = await (await fetch('https://api.github.com/user/emails', { headers: ghHeaders })).json();
      if (Array.isArray(emails)) {
        const primary = emails.find(e => e && e.primary && e.verified);
        email = (primary && primary.email) || (emails[0] && emails[0].email) || null;
      }
    }
    if (!email) return fail('no_email_from_github', profile);

    // Upsert user
    let user;
    try {
      user = await prisma.user.upsert({
        where: { email },
        update: { name: (profile && (profile.name || profile.login)) || null },
        create: { email, name: (profile && (profile.name || profile.login)) || null, role: 'user' },
      });
    } catch (e) {
      return fail('prisma_upsert_failed', e);
    }

    // Create session + cookie (simple token only)
    let session;
    try {
      session = await createSession(user.id);
    } catch (e) {
      return fail('session_create_failed', e);
    }

    const cookie = [
      `session=${encodeURIComponent(session.token)}`,
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
    return fail('unexpected', err);
  }
};
