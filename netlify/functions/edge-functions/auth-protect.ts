// netlify/edge-functions/auth-protect.ts
// Edge-safe (Deno) cookie verifier. No Node imports. No 'netlify:edge' import.

/** ---- helpers ---- **/
const COOKIE_NAME = 'taxis_session';
const SEP = '.'; // payload.signature

function base64urlToUint8Array(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function uint8ArrayToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
async function hmacSha256(message: string, secret: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return new Uint8Array(sig);
}
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function getCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const parts = header.split(/;\s*/);
  for (const p of parts) if (p.startsWith(name + '=')) return decodeURIComponent(p.slice(name.length + 1));
  return null;
}
type Session = { sub: string; email?: string; name?: string; provider: 'google'|'github'; iat: number; exp: number; roles?: string[] };

async function readSessionFromCookie(cookieHeader: string | null, secret: string): Promise<Session | null> {
  const raw = getCookie(cookieHeader, COOKIE_NAME);
  if (!raw) return null;
  const [payloadB64, sigB64] = raw.split(SEP);
  if (!payloadB64 || !sigB64) return null;

  const expected = await hmacSha256(payloadB64, secret);
  const actual = base64urlToUint8Array(sigB64);
  if (!timingSafeEqual(expected, actual)) return null;

  try {
    const json = uint8ArrayToString(base64urlToUint8Array(payloadB64));
    const sess = JSON.parse(json) as Session;
    if (!sess.exp || Math.floor(Date.now() / 1000) > sess.exp) return null;
    return sess;
  } catch { return null; }
}

/** ---- edge entry ---- **/
export default async (request: Request, context: any) => {
  // Prefer context.env (Edge standard). Fallback to Netlify global if present.
const secret =
  context?.env?.SESSION_SECRET ??
  context?.env?.AUTH_SECRET ??
  (globalThis as any)?.Netlify?.env?.get?.('SESSION_SECRET') ??
  (globalThis as any)?.Netlify?.env?.get?.('AUTH_SECRET') ??
  '';

  // If misconfigured, let traffic pass so you can fix env without locking out the app.
  if (!secret) return;

  const url = new URL(request.url);
  // Don’t guard login or function endpoints
  if (url.pathname.startsWith('/login') || url.pathname.startsWith('/.netlify/functions')) return;

  const sess = await readSessionFromCookie(request.headers.get('cookie'), String(secret));
  if (sess) return; // authenticated → allow

  return Response.redirect(new URL('/login', request.url), 302);
};

export const config = {
  path: ['/dashboard/*', '/app/*'], // adjust to your protected routes
};
