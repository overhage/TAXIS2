// netlify/functions/auth-start.ts
import type { Handler } from '@netlify/functions';
import { authUrl, makeStateCookie } from './_auth/oauth';

export const handler: Handler = async (event) => {
  const provider = (event.queryStringParameters?.provider ?? '') as 'google'|'github';
  if (!['google','github'].includes(provider)) {
    return { statusCode: 400, body: 'Unknown provider' };
  }
  const url = new URL(authUrl(provider));
  // attach state on the query and as a cookie (double-submit)
  const { value: state, header } = makeStateCookie();
  url.searchParams.set('state', `${provider}:${state}`);

  console.log('[auth-start] redirecting to', url.toString())

  return {
    statusCode: 302,
    headers: { Location: url.toString(), 'Set-Cookie': header },
  };
};
