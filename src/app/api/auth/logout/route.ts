import { withApi } from '@/server/auth/guard';
import { clearSessionCookie } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi(async () =>
  Response.json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } }),
);
