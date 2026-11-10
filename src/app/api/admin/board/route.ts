import { z } from 'zod';
import { cancelAbsence, placeSub, reportAbsence, requestSubs } from '@/engine/absence';
import { autoAssign } from '@/engine/autoAssign';
import { assignPerson, confirmBoard, setPlan, swap, toggleStop, unassign } from '@/engine/board';
import { seoulDate, currentShift } from '@/engine/time';
import { EngineError, type Changes, type Ctx, type Snapshot } from '@/engine/types';
import { requireAdmin, withApi } from '@/server/auth/guard';
import { getDb } from '@/server/db/client';
import { loadSnapshot } from '@/server/repo/snapshot';
import { getRev, runAction } from '@/server/runAction';
import { boardView } from '@/server/views/boardView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s));
const shift = z.enum(['day', 'night']);
const slot = { date, shift };
const inFactory = { ...slot, factoryId: id };

const Body = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('setPlan'),
    ...inFactory,
    postId: id,
    productId: id.nullable(),
    status: z.enum(['run', 'off', 'unmanned']),
  }),
  z.object({ type: z.literal('toggleStop'), ...inFactory, postId: id }),
  z.object({ type: z.literal('autoAssign'), ...inFactory }),
  z.object({ type: z.literal('confirm'), ...inFactory }),
  z.object({ type: z.literal('assign'), ...inFactory, postId: id, personId: id }),
  z.object({ type: z.literal('swap'), ...slot, assignmentIdA: id, assignmentIdB: id }),
  z.object({ type: z.literal('unassign'), ...slot, assignmentId: id }),
  z.object({
    type: z.literal('reportAbsence'),
    ...slot,
    personId: id,
    kind: z.enum(['absent', 'sick', 'early', 'late', 'leave']),
    reason: z.string().max(500).optional(),
    reportedBy: z.enum(['leader', 'support']).default('support'),
  }),
  z.object({ type: z.literal('cancelAbsence'), ...slot, absenceId: id }),
  z.object({ type: z.literal('placeSub'), ...slot, absenceId: id, personId: id }),
  z.object({ type: z.literal('requestSubs'), ...slot, absenceId: id, personIds: z.array(id).min(1).max(10) }),
]);
type Action = z.infer<typeof Body>;

const Query = z.object({ date: date.optional(), shift: shift.optional(), factory: id.optional() });

function dispatch(a: Action, accountId: string): (snap: Snapshot, ctx: Ctx) => Changes {
  const fn = dispatchUnchecked(a, accountId);
  return (snap, ctx) => {
    // ids come from the client: every referenced factory/product must belong to the session company's snapshot
    if ('factoryId' in a && !snap.factories.some((f) => f.id === a.factoryId)) throw new EngineError('BAD_INPUT', 'unknown factory');
    if (a.type === 'setPlan' && a.productId !== null && !snap.products.some((p) => p.id === a.productId)) {
      throw new EngineError('BAD_INPUT', 'unknown product');
    }
    return fn(snap, ctx);
  };
}

function dispatchUnchecked(a: Action, accountId: string): (snap: Snapshot, ctx: Ctx) => Changes {
  switch (a.type) {
    case 'setPlan':
      return (snap, ctx) => setPlan(snap, a, ctx);
    case 'toggleStop':
      return (snap, ctx) => toggleStop(snap, a, ctx);
    case 'autoAssign':
      return (snap, ctx) => autoAssign(snap, a.factoryId, a.date, a.shift, ctx);
    case 'confirm':
      return (snap, ctx) => {
        const changes = confirmBoard(snap, a, ctx);
        changes.upsert.boards = (changes.upsert.boards ?? []).map((b) => ({ ...b, confirmedBy: accountId }));
        return changes;
      };
    case 'assign':
      return (snap, ctx) => assignPerson(snap, a, ctx);
    case 'swap':
      return (snap, ctx) => swap(snap, a, ctx);
    case 'unassign':
      return (snap, ctx) => unassign(snap, a, ctx);
    case 'reportAbsence':
      return (snap, ctx) => reportAbsence(snap, a, ctx);
    case 'cancelAbsence':
      return (snap, ctx) => cancelAbsence(snap, { absenceId: a.absenceId, by: 'admin' }, ctx);
    case 'placeSub':
      return (snap, ctx) => placeSub(snap, a, ctx);
    case 'requestSubs':
      return (snap, ctx) => requestSubs(snap, a, ctx);
  }
}

export const GET = withApi(async (req) => {
  const s = await requireAdmin(req);
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const now = new Date();
  const today = seoulDate(now);
  const db = await getDb();
  const view = await db.transaction(async (tx) => {
    // The first load is centred on today only to read settings (needed for currentShift). The snapshot covers a
    // limited window around its centre date, so when the requested/default date differs we must reload around it.
    let snap = await loadSnapshot(tx, s.companyId, q.date ?? today);
    const dflt = currentShift(now, snap.settings);
    const day = q.date ?? (q.shift ? today : dflt.date);
    const sh = q.shift ?? dflt.shift;
    if (day !== (q.date ?? today)) snap = await loadSnapshot(tx, s.companyId, day);
    const factory = q.factory ? snap.factories.find((f) => f.id === q.factory) : snap.factories[0];
    if (!factory) throw new EngineError('BAD_INPUT', 'unknown factory');
    return boardView(snap, { factoryId: factory.id, date: day, shift: sh });
  });
  return Response.json(view);
});

export const POST = withApi(async (req) => {
  const s = await requireAdmin(req);
  const body = Body.parse(await req.json().catch(() => null));
  await runAction(s.companyId, body.date, dispatch(body, s.accountId));
  return Response.json({ ok: true, rev: await getRev(s.companyId) });
});
