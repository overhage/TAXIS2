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

export function authUrl(provider: Provider) {
  const base = process.env.APP_BASE_URL!;
  if (provider === 'google') {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      response_type: 'code',
      scope: 'openid email profile',
      include_granted_scopes: 'true',
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  } else {
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID!,
      redirect_uri: process.env.GITHUB_REDIRECT_URI!,
      scope: 'read:user user:email',
      allow_signup: 'true'
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }
}
