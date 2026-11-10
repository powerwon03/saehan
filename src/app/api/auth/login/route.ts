import { z } from 'zod';
import { EngineError } from '@/engine/types';
import { withApi } from '@/server/auth/guard';
import { login } from '@/server/auth/login';
import { sessionCookie } from '@/server/auth/session';
import { nowFn } from '@/server/clock';
import { getDb } from '@/server/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  company: z.string().min(1).optional(),
  kind: z.enum(['admin', 'worker']),
  loginId: z.string().min(1).max(100),
  secret: z.string().min(1).max(200),
});

/** Company code: the body's, else DEFAULT_COMPANY; the 'demo' fallback is for development only. */
function companyCode(given: string | undefined): string {
  const code = given ?? process.env.DEFAULT_COMPANY;
  if (code) return code;
  if (process.env.NODE_ENV === 'production') throw new EngineError('BAD_INPUT', 'company is required');
  return 'demo';
}

export const POST = withApi(async (req) => {
  const body = Body.parse(await req.json().catch(() => null));
  const r = await login(await getDb(), {
    companyCode: companyCode(body.company),
    kind: body.kind,
    loginId: body.loginId,
    secret: body.secret,
    now: nowFn(),
  });
  if (r.ok)
    return Response.json(
      { ok: true, mustChange: r.mustChange },
      { headers: { 'Set-Cookie': sessionCookie(r.session) } },
    );
  if (r.code === 'LOCKED') return Response.json({ error: 'LOCKED', lockedUntil: r.lockedUntil }, { status: 423 });
  return Response.json({ error: 'INVALID' }, { status: 401 });
});
