import type { Handler } from '@netlify/functions';
import { readSessionFromCookie } from './_auth/cookies';

export const handler: Handler = async (event) => {
  const sess = readSessionFromCookie(event.headers.cookie, process.env.SESSION_SECRET!);
  if (!sess) return { statusCode: 401, body: 'Unauthorized' };
  return {
    statusCode: 200,
    headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store' },
    body: JSON.stringify({ user: { sub: sess.sub, email: sess.email, name: sess.name, provider: sess.provider, roles: sess.roles || [] }})
  };
};
