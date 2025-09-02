const prisma = require('./utils/prisma');
const { createSession } = require('./utils/auth');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const clientId = process.env.GITHUB_CLIENT_ID;
const clientSecret = process.env.GITHUB_CLIENT_SECRET;

exports.handler = async function (event, context) {
  const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}`);
  const code = url.searchParams.get('code');
  // Step 1: If no code, start OAuth flow by redirecting the user to GitHub
  if (!code) {
    const redirectUri = `${url.origin}/api/login`;
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&scope=user:email`;
    return {
      statusCode: 302,
      headers: {
        Location: githubAuthUrl,
      },
    };
  }
  // Step 2: Exchange code for an access token
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Failed to obtain access token' }),
      };
    }
    // Step 3: Fetch user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    });
    const userJson = await userRes.json();
    // Step 4: Fetch user emails to find primary email
    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    });
    const emails = await emailRes.json();
    let primaryEmail = null;
    if (Array.isArray(emails)) {
      const primary = emails.find((e) => e.primary) || emails[0];
      primaryEmail = primary && primary.email;
    }
    if (!primaryEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Unable to determine primary email' }),
      };
    }
    // Create or update user record
    const existing = await prisma.user.findUnique({ where: { email: primaryEmail } });
    let dbUser;
    if (existing) {
      dbUser = await prisma.user.update({
        where: { email: primaryEmail },
        data: { name: userJson.name || existing.name || null },
      });
    } else {
      dbUser = await prisma.user.create({
        data: { email: primaryEmail, name: userJson.name || '', role: 'user' },
      });
    }
    // Create session
    const { cookie } = await createSession(dbUser.id);
    // Redirect to dashboard
    return {
      statusCode: 302,
      headers: {
        'Set-Cookie': cookie,
        Location: `${url.origin}/dashboard`,
      },
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'GitHub OAuth error', details: err.message }),
    };
  }
};