// netlify/functions/auth-callback.ts
import type { Handler } from '@netlify/functions';
import { readStateFromCookie } from './_auth/oauth';
import { createSessionCookie } from './_auth/cookies';

async function exchangeGoogle(code: string) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type':'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: 'authorization_code',
      code
    })
  }).then(r=>r.json());
  if (!tokenRes.id_token && !tokenRes.access_token) throw new Error('google token exchange failed');

  // fetch profile via OpenID (id_token) or userinfo endpoint
  const userInfo = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenRes.access_token}` }
  }).then(r=>r.json());

  return {
    id: userInfo.sub,
    email: userInfo.email,
    name: userInfo.name
  };
}

async function exchangeGitHub(code: string) {
  // exchange code for access_token
  const token = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID!,
      client_secret: process.env.GITHUB_CLIENT_SECRET!,
      redirect_uri: process.env.GITHUB_REDIRECT_URI!,
      code
    })
  }).then(r=>r.json());
  if (!token.access_token) throw new Error('github token exchange failed');

  const profile = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token.access_token}`, 'User-Agent': 'taxis-app' }
  }).then(r=>r.json());

  // get primary email if needed
  let email = profile.email;
  if (!email) {
    const emails = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${token.access_token}`, 'User-Agent':'taxis-app' }
    }).then(r=>r.json());
    email = (emails.find((e:any)=>e.primary && e.verified)?.email) || emails[0]?.email;
  }

  return { id: String(profile.id), email, name: profile.name || profile.login };
}

export const handler: Handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const code = qs.code;
  const stateParam = qs.state; // format: "provider:random"
  const cookies = event.headers.cookie;
  const cookieState = readStateFromCookie(cookies);

  if (!code || !stateParam || !cookieState) {
    return { statusCode: 400, body: 'Missing code/state' };
  }

  const [provider, state] = String(stateParam).split(':');
  if (!['google','github'].includes(provider) || state !== cookieState) {
    return { statusCode: 400, body: 'Invalid state' };
  }

  try {
    const secure = event.headers['x-forwarded-proto'] === 'https';
    const user = provider === 'google' ? await exchangeGoogle(code) : await exchangeGitHub(code);

    const session = {
      sub: `${provider}:${user.id}`,
      email: user.email,
      name: user.name,
      provider: provider as 'google'|'github',
      roles: [] as string[]
    };

    const { cookie } = createSessionCookie(session, process.env.SESSION_SECRET!, secure);

    // Clear oauth_state and set the session
    return {
      statusCode: 302,
      headers: {
        Location: '/dashboard',
        'Set-Cookie': [
          cookie,
          'oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure'
        ].join(', ')
      }
    };
  } catch (e: any) {
    return { statusCode: 500, body: `Auth failed: ${e?.message || e}` };
  }
};
