import type { Handler } from '@netlify/functions';
import { clearSessionCookie } from './_auth/cookies';

export const handler: Handler = async () => ({
  statusCode: 302,
  headers: { 'Location': '/', 'Set-Cookie': clearSessionCookie() }
});
