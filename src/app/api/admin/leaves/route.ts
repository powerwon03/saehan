import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { crewShift } from '@/engine/calendar';
import { decideLeave } from '@/engine/leave';
import { EngineError } from '@/engine/types';
import { requireAdmin, withApi } from '@/server/auth/guard';
import { nowFn } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { factories, leaveRequests, persons } from '@/server/db/schema';
import { getRev, runAction } from '@/server/runAction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).default('pending') });
const Body = z.object({ leaveId: z.string().uuid(), approve: z.boolean() });

export const GET = withApi(async (req) => {
  const s = await requireAdmin(req);
  const { status } = Query.parse({ status: new URL(req.url).searchParams.get('status') ?? undefined });
  const db = await getDb();
  const rows = await db
    .select({
      id: leaveRequests.id,
      personId: leaveRequests.personId,
      name: persons.name,
      empNo: persons.empNo,
      date: leaveRequests.date,
      kind: leaveRequests.kind,
      status: leaveRequests.status,
      createdAt: leaveRequests.createdAt,
      crew: persons.crew,
      cycleBaseDate: factories.cycleBaseDate,
    })
    .from(leaveRequests)
    .innerJoin(persons, eq(persons.id, leaveRequests.personId))
    .innerJoin(factories, eq(factories.id, persons.factoryId))
    .where(and(eq(leaveRequests.companyId, s.companyId), eq(leaveRequests.status, status)))
    .orderBy(asc(leaveRequests.date), asc(leaveRequests.createdAt), asc(leaveRequests.id));
  return Response.json(
    rows.map(({ crew, cycleBaseDate, ...r }) => ({ ...r, regularShift: crewShift(cycleBaseDate, crew, r.date) })),
  );
});

export const POST = withApi(async (req) => {
  const s = await requireAdmin(req);
  const body = Body.parse(await req.json().catch(() => null));
  const db = await getDb();
  const [leave] = await db
    .select({ date: leaveRequests.date })
    .from(leaveRequests)
    .where(and(eq(leaveRequests.id, body.leaveId), eq(leaveRequests.companyId, s.companyId)));
  if (!leave) throw new EngineError('BAD_INPUT', 'unknown leave');
  await runAction(s.companyId, leave.date, (snap, ctx) => decideLeave(snap, body, ctx), { now: nowFn() });
  return Response.json({ ok: true, rev: await getRev(s.companyId) });
});
