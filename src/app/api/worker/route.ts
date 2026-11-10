import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { cancelAbsence, reportAbsence, respondSub } from '@/engine/absence';
import { cancelLeave, requestLeave } from '@/engine/leave';
import { seoulDate } from '@/engine/time';
import { EngineError, type Changes, type Ctx, type Snapshot } from '@/engine/types';
import { requireWorker, withApi } from '@/server/auth/guard';
import { nowFn } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { companies, persons } from '@/server/db/schema';
import { loadSnapshot } from '@/server/repo/snapshot';
import { getRev, runAction } from '@/server/runAction';
import { workerView } from '@/server/views/workerView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s));

const Body = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reportAbsence') }),
  z.object({ type: z.literal('cancelAbsence'), absenceId: id }),
  z.object({ type: z.literal('respond'), requestId: id, accept: z.boolean() }),
  z.object({ type: z.literal('requestLeave'), date }),
  z.object({ type: z.literal('cancelLeave'), leaveId: id }),
  z.object({ type: z.literal('setLang'), lang: z.enum(['ko', 'en', 'mn', 'vi']) }),
]);
type Action = z.infer<typeof Body>;

/** personId always comes from the session, never from the body. */
function dispatch(a: Exclude<Action, { type: 'setLang' }>, personId: string): (snap: Snapshot, ctx: Ctx) => { changes: Changes; result?: unknown } | Changes {
  switch (a.type) {
    case 'reportAbsence':
      return (snap, ctx) => {
        const { today, canReportAbsence } = workerView(snap, personId, ctx.now);
        if (!canReportAbsence || today.shift === 'off') throw new EngineError('CANNOT_REPORT');
        return reportAbsence(snap, { personId, date: today.date, shift: today.shift, kind: 'absent', reportedBy: 'self' }, ctx);
      };
    case 'cancelAbsence':
      return (snap, ctx) => {
        const absence = snap.absences.find((x) => x.id === a.absenceId);
        if (!absence) throw new EngineError('BAD_INPUT', 'unknown absence');
        if (absence.personId !== personId || absence.reportedBy !== 'self') throw new EngineError('FORBIDDEN');
        return cancelAbsence(snap, { absenceId: a.absenceId, by: 'self' }, ctx);
      };
    case 'respond':
      return (snap, ctx) => {
        const { changes, outcome } = respondSub(snap, { requestId: a.requestId, personId, accept: a.accept }, ctx);
        return { changes, result: outcome };
      };
    case 'requestLeave':
      return (snap, ctx) => requestLeave(snap, { personId, date: a.date }, ctx);
    case 'cancelLeave':
      return (snap, ctx) => cancelLeave(snap, { leaveId: a.leaveId, personId }, ctx);
  }
}

export const GET = withApi(async (req) => {
  const s = await requireWorker(req);
  const now = nowFn();
  const db = await getDb();
  // The snapshot window (35 days back) always covers the current month's start, so one load around today is enough.
  const view = await db.transaction(async (tx) => workerView(await loadSnapshot(tx, s.companyId, seoulDate(now)), s.personId!, now));
  return Response.json(view);
});

export const POST = withApi(async (req) => {
  const s = await requireWorker(req);
  const body = Body.parse(await req.json().catch(() => null));
  const personId = s.personId!;
  const now = nowFn();

  if (body.type === 'setLang') {
    const db = await getDb();
    await db.transaction(async (tx) => {
      await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, s.companyId)).for('update');
      await tx.update(persons).set({ lang: body.lang }).where(and(eq(persons.id, personId), eq(persons.companyId, s.companyId)));
      await tx.update(companies).set({ rev: sql`${companies.rev} + 1` }).where(eq(companies.id, s.companyId));
    });
    return Response.json({ ok: true, rev: await getRev(s.companyId) });
  }
  const result = await runAction(s.companyId, seoulDate(now), dispatch(body, personId), { now });
  const rev = await getRev(s.companyId);
  return Response.json(body.type === 'respond' ? { ok: true, outcome: result, rev } : { ok: true, rev });
});
