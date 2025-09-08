// netlify/functions/_auth/cookies.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'taxis_session';
const ALGO = 'sha256';
const SEP = '.'; // payload.signature
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

type Session = {
  sub: string;           // stable user id
  email?: string;
  name?: string;
  provider: 'google'|'github';
  iat: number;           // issued at (unix)
  exp: number;           // expiry (unix)
  roles?: string[];
};

const b64url = (buf: Buffer|string) =>
  Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

const fromB64url = (s: string) =>
  Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8');

function sign(payload: string, secret: string) {
  return createHmac(ALGO, secret).update(payload).digest();
}

export function createSessionCookie(session: Omit<Session,'iat'|'exp'>, secret: string, secure = true) {
  const now = Math.floor(Date.now() / 1000);
  const full: Session = { ...session, iat: now, exp: now + MAX_AGE_SEC };
  const json = JSON.stringify(full);
  const payload = b64url(json);
  const sig = sign(payload, secret);
  const value = `${payload}${SEP}${b64url(sig)}`;
  const cookie = [
    `${COOKIE_NAME}=${value}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${MAX_AGE_SEC}`,
    secure ? `Secure` : '',
  ].filter(Boolean).join('; ');
  return { cookie, session: full };
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
}

export function readSessionFromCookie(cookieHeader: string|undefined, secret: string): Session|null {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(/;\s*/).find(c => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const value = match.substring(COOKIE_NAME.length + 1);
  const [payload, sigB64] = value.split(SEP);
  if (!payload || !sigB64) return null;

  const expected = sign(payload, secret);
  const actual = Buffer.from(sigB64.replace(/-/g,'+').replace(/_/g,'/'), 'base64');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const json = fromB64url(payload);
    const sess: Session = JSON.parse(json);
    if (!sess.exp || Math.floor(Date.now()/1000) > sess.exp) return null;
    return sess;
  } catch {
    return null;
  }
}
