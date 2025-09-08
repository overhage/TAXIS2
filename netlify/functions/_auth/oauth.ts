// netlify/functions/_auth/oauth.ts
import { randomBytes } from 'node:crypto';


export type Provider = 'google'|'github';

export function makeStateCookie(): { value: string, header: string } {
  const state = randomBytes(16).toString('hex');
  const cookie = [
    `oauth_state=${state}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=600`,
    `Secure`
  ].join('; ');
  return { value: state, header: cookie };
}

export function readStateFromCookie(cookieHeader?: string) {
  if (!cookieHeader) return null;
  const item = cookieHeader.split(/;\s*/).find(c => c.startsWith('oauth_state='));
  return item ? item.split('=')[1] : null;
}

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export function authUrl(provider: 'google'|'github') {
  if (provider === 'google') {
    const redirect = requireEnv('GOOGLE_REDIRECT_URI');   // <— throws if missing
    const params = new URLSearchParams({
      client_id: requireEnv('GOOGLE_CLIENT_ID'),
      redirect_uri: redirect,
      response_type: 'code',
      scope: 'openid email profile',
      include_granted_scopes: 'true',
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  } else {
    const redirect = requireEnv('GITHUB_REDIRECT_URI');
    const params = new URLSearchParams({
      client_id: requireEnv('GITHUB_CLIENT_ID'),
      redirect_uri: redirect,
      scope: 'read:user user:email',
      allow_signup: 'true'
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }
}
