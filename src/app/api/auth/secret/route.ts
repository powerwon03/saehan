import { z } from 'zod';
import { requireSession, withApi } from '@/server/auth/guard';
import { changeSecret } from '@/server/auth/login';
import { getDb } from '@/server/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) });

export const POST = withApi(async (req) => {
  const session = await requireSession(req);
  const body = Body.parse(await req.json().catch(() => null));
  const r = await changeSecret(await getDb(), session, body);
  if (r.ok) return Response.json({ ok: true });
  if (r.code === 'LOCKED') return Response.json({ error: 'LOCKED', lockedUntil: r.lockedUntil }, { status: 423 });
  return Response.json({ error: r.code }, { status: 400 });
});
