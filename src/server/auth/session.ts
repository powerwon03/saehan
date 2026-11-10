import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'otl_session';
export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

export type Session = {
  accountId: string;
  companyId: string;
  kind: 'admin' | 'worker';
  personId: string | null;
  /** epoch milliseconds */
  exp: number;
};

function secretKey(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 characters');
  return s;
}

function mac(payload: string): Buffer {
  return createHmac('sha256', secretKey()).update(payload).digest();
}

export function signSession(s: Session): string {
  const payload = Buffer.from(JSON.stringify(s)).toString('base64url');
  return `${payload}.${mac(payload).toString('base64url')}`;
}

export function readSession(token: string, now: Date = new Date()): Session | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const given = Buffer.from(sig, 'base64url');
  const expected = mac(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let s: Partial<Session> | null;
  try {
    s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    !s ||
    typeof s.accountId !== 'string' ||
    typeof s.companyId !== 'string' ||
    (s.kind !== 'admin' && s.kind !== 'worker') ||
    !(typeof s.personId === 'string' || s.personId === null) ||
    typeof s.exp !== 'number' ||
    s.exp <= now.getTime()
  )
    return null;
  return s as Session;
}

/** Set-Cookie value for a fresh session. */
export function sessionCookie(s: Session): string {
  return cookie(signSession(s), SESSION_MAX_AGE_SEC);
}

export function clearSessionCookie(): string {
  return cookie('', 0);
}

function cookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/** Session from a request's Cookie header (no next/headers dependency); null when absent or invalid. */
export function sessionFromRequest(req: Request, now: Date = new Date()): Session | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return readSession(part.slice(i + 1).trim(), now);
  }
  return null;
}
