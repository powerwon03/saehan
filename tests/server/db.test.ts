import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import type { DB } from '@/server/db/client';
import * as t from '@/server/db/schema';
import { loadSnapshot } from '@/server/repo/snapshot';
import { applyChanges } from '@/server/repo/apply';
import { expireCompany, getRev, runAction } from '@/server/runAction';
import {
  EngineError,
  emptyChanges,
  type Absence,
  type Assignment,
  type Board,
  type LeaveRequest,
  type PlanCell,
  type SubRequest,
} from '@/engine/types';
import { createTestDb, seedCompany, type Seeded } from '../helpers/testDb';

const AROUND = '2026-11-10';
const NOW = new Date('2026-11-10T01:00:00.000Z'); // 10:00 Seoul

let db: DB;
beforeAll(async () => {
  db = await createTestDb();
});

function pgCode(e: unknown): string | undefined {
  let cur = e as { code?: string; cause?: unknown } | undefined;
  while (cur) {
    if (typeof cur.code === 'string') return cur.code;
    cur = cur.cause as typeof cur;
  }
  return undefined;
}

function assignmentOf(s: Seeded, over: Partial<Assignment> = {}): Assignment {
  return {
    id: randomUUID(),
    companyId: s.companyId,
    date: AROUND,
    shift: 'day',
    factoryId: s.factoryId,
    postId: s.postIds[0],
    personId: s.personIds[0],
    source: 'auto',
    locked: false,
    reason: null,
    flags: [],
    createdAt: new Date('2026-11-09T22:00:00.000Z'),
    ...over,
  };
}

function boardOf(s: Seeded, over: Partial<Board> = {}): Board {
  return {
    companyId: s.companyId,
    date: AROUND,
    shift: 'day',
    factoryId: s.factoryId,
    status: 'draft',
    stoppedPostIds: [],
    confirmedAt: null,
    confirmedBy: null,
    ...over,
  };
}

function absenceOf(s: Seeded, over: Partial<Absence> = {}): Absence {
  return {
    id: randomUUID(),
    companyId: s.companyId,
    date: AROUND,
    shift: 'day',
    factoryId: s.factoryId,
    personId: s.personIds[0],
    postId: s.postIds[0],
    kind: 'absent',
    reportedBy: 'self',
    reason: null,
    status: 'in-progress',
    resolvedPersonId: null,
    round: 1,
    restore: null,
    createdAt: new Date('2026-11-09T23:00:00.000Z'),
    resolvedAt: null,
    ...over,
  };
}

function subRequestOf(s: Seeded, absenceId: string, over: Partial<SubRequest> = {}): SubRequest {
  return {
    id: randomUUID(),
    companyId: s.companyId,
    absenceId,
    personId: s.personIds[1],
    round: 1,
    rank: 1,
    status: 'sent',
    sentAt: new Date('2026-11-10T00:30:00.000Z'),
    expiresAt: new Date('2026-11-10T00:50:00.000Z'),
    respondedAt: null,
    ...over,
  };
}

describe('schema constraints', () => {
  test('같은 교대 같은 사람 배치 두 번 insert → unique 위반', async () => {
    const s = await seedCompany(db);
    await db.insert(t.assignments).values(assignmentOf(s));
    const err = await db
      .insert(t.assignments)
      .values(assignmentOf(s, { postId: s.postIds[1] }))
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(pgCode(err)).toBe('23505');
  });

  test('취소되지 않은 결근은 (회사,날짜,교대,사람)마다 하나, 취소된 것은 여럿 허용', async () => {
    const s = await seedCompany(db);
    await db.insert(t.absences).values(absenceOf(s, { status: 'cancelled' }));
    await db.insert(t.absences).values(absenceOf(s, { status: 'cancelled' }));
    await db.insert(t.absences).values(absenceOf(s));
    const err = await db
      .insert(t.absences)
      .values(absenceOf(s))
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(pgCode(err)).toBe('23505');
  });
});

describe('applyChanges / loadSnapshot', () => {
  test('applyChanges 후 loadSnapshot이 같은 행을 돌려준다', async () => {
    const s = await seedCompany(db);
    const a = assignmentOf(s, { flags: ['soloOk'], reason: 'r', locked: true, source: 'manual' });
    const b = boardOf(s, {
      status: 'confirmed',
      stoppedPostIds: [s.postIds[1]],
      confirmedAt: new Date('2026-11-09T21:00:00.000Z'),
      confirmedBy: 'admin',
    });
    const restore = assignmentOf(s, { postId: s.postIds[1], personId: s.personIds[2] });
    const ab = absenceOf(s, { personId: s.personIds[2], restore });
    const sr = subRequestOf(s, ab.id);
    const lv: LeaveRequest = {
      id: randomUUID(),
      companyId: s.companyId,
      personId: s.personIds[3],
      date: '2026-11-12',
      kind: 'annual',
      status: 'pending',
      createdAt: new Date('2026-11-08T00:00:00.000Z'),
      decidedAt: null,
    };
    const pc: PlanCell = {
      companyId: s.companyId,
      date: AROUND,
      shift: 'day',
      postId: s.postIds[0],
      productId: s.productId,
      status: 'run',
    };
    const c = emptyChanges();
    c.upsert = { assignments: [a], boards: [b], absences: [ab], subRequests: [sr], leaves: [lv], plans: [pc] };
    c.messages = [{ companyId: s.companyId, personId: s.personIds[0], bodyKey: 'todayWork', params: { x: 1 }, channel: 'push' }];

    await db.transaction((tx) => applyChanges(tx, s.companyId, c, NOW));
    const snap = await db.transaction((tx) => loadSnapshot(tx, s.companyId, AROUND));

    expect(snap.assignments).toEqual([a]);
    expect(snap.boards).toEqual([b]);
    expect(snap.absences).toEqual([ab]);
    expect((snap.absences[0].restore as Assignment).createdAt).toBeInstanceOf(Date);
    expect(snap.subRequests).toEqual([sr]);
    expect(snap.leaves).toEqual([lv]);
    expect(snap.plans).toEqual([pc]);
    const msgs = await db.select().from(t.messages).where(eq(t.messages.companyId, s.companyId));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ bodyKey: 'todayWork', params: { x: 1 }, channel: 'push', createdAt: NOW });

    // upsert by id updates in place
    const c2 = emptyChanges();
    c2.upsert = { subRequests: [{ ...sr, status: 'declined', respondedAt: NOW }], boards: [{ ...b, status: 'draft' }] };
    await db.transaction((tx) => applyChanges(tx, s.companyId, c2, NOW));
    const snap2 = await db.transaction((tx) => loadSnapshot(tx, s.companyId, AROUND));
    expect(snap2.subRequests).toEqual([{ ...sr, status: 'declined', respondedAt: NOW }]);
    expect(snap2.boards).toEqual([{ ...b, status: 'draft' }]);
  });

  test('remove를 upsert보다 먼저 적용한다(같은 사람을 다른 자리로 옮기기)', async () => {
    const s = await seedCompany(db);
    const a = assignmentOf(s);
    const c1 = emptyChanges();
    c1.upsert.assignments = [a];
    await db.transaction((tx) => applyChanges(tx, s.companyId, c1, NOW));

    const moved = assignmentOf(s, { postId: s.postIds[1], source: 'move' });
    const c2 = emptyChanges();
    c2.upsert.assignments = [moved];
    c2.remove.assignments = [a.id];
    await db.transaction((tx) => applyChanges(tx, s.companyId, c2, NOW));
    const snap = await db.transaction((tx) => loadSnapshot(tx, s.companyId, AROUND));
    expect(snap.assignments).toEqual([moved]);
  });

  test('기간: 배치는 around−35 ~ around+15, 계획은 around−60 ~ around+15', async () => {
    const s = await seedCompany(db);
    const c = emptyChanges();
    c.upsert.assignments = [
      assignmentOf(s, { date: '2026-10-05', personId: s.personIds[0] }), // −36: out
      assignmentOf(s, { date: '2026-10-06', personId: s.personIds[1] }), // −35: in
      assignmentOf(s, { date: '2026-11-25', personId: s.personIds[2] }), // +15: in
      assignmentOf(s, { date: '2026-11-26', personId: s.personIds[3] }), // +16: out
    ];
    const plan = (date: string): PlanCell => ({
      companyId: s.companyId,
      date,
      shift: 'day',
      postId: s.postIds[0],
      productId: null,
      status: 'run',
    });
    c.upsert.plans = [plan('2026-09-10'), plan('2026-09-11'), plan('2026-11-25'), plan('2026-11-26')];
    await db.transaction((tx) => applyChanges(tx, s.companyId, c, NOW));
    const snap = await db.transaction((tx) => loadSnapshot(tx, s.companyId, AROUND));
    expect(snap.assignments.map((x) => x.date).sort()).toEqual(['2026-10-06', '2026-11-25']);
    expect(snap.plans.map((x) => x.date).sort()).toEqual(['2026-09-11', '2026-11-25']);
  });

  test('마스터와 설정을 엔진 모양으로 읽는다', async () => {
    const s = await seedCompany(db);
    const snap = await db.transaction((tx) => loadSnapshot(tx, s.companyId, AROUND));
    expect(snap.companyId).toBe(s.companyId);
    expect(snap.settings).toEqual({
      companyId: s.companyId,
      shiftDayStart: '07:00',
      shiftNightStart: '19:00',
      shiftCreditHours: 8,
      maxWeekHours: 52,
      warnWeekHours: 44,
      requestExpiryMin: 20,
      weights: { samePost: 15, sameProduct: 3, sameFactory: 1, roleMatch: 5, roleMismatch: 20, recentSub: 25 },
      skillRates: [0.3, 0.6, 0.9, 1.0],
    });
    expect(snap.factories).toEqual([
      {
        id: s.factoryId,
        companyId: s.companyId,
        code: 'F1',
        name: '1공장',
        approval: 'confirm',
        leaderPhone: null,
        cycleBaseDate: '2025-04-27',
        sort: 0,
      },
    ]);
    expect(snap.posts.map((p) => p.id)).toEqual(s.postIds);
    expect(snap.products.map((p) => p.id)).toEqual([s.productId]);
    expect(snap.persons.map((p) => p.id)).toEqual(s.personIds);
    expect(snap.persons.map((p) => p.crew)).toEqual(['A', 'A', 'B', 'B', 'C', 'C']);
    expect(snap.persons[0]).toEqual({
      id: s.personIds[0],
      companyId: s.companyId,
      empNo: '1001',
      name: '근무자1',
      affiliation: 'direct',
      crew: 'A',
      role: null,
      gender: null,
      phone: null,
      factoryId: s.factoryId,
      lang: 'ko',
      fixedPostId: null,
      active: true,
      hiredAt: null,
      leftAt: null,
    });
  });

  test('experience 집계: base 2 + 확정 보드 배치 1 → 3; draft 보드 배치는 세지 않음', async () => {
    const s = await seedCompany(db);
    const [p0] = s.personIds;
    const [post0] = s.postIds;
    await db.insert(t.experienceBase).values({ companyId: s.companyId, personId: p0, postId: post0, productId: null, count: 2 });
    const c = emptyChanges();
    c.upsert.boards = [boardOf(s, { date: '2026-11-01', status: 'confirmed' }), boardOf(s, { date: '2026-11-02' })];
    c.upsert.assignments = [assignmentOf(s, { date: '2026-11-01' }), assignmentOf(s, { date: '2026-11-02' })];
    await db.transaction((tx) => applyChanges(tx, s.companyId, c, NOW));
    const snap = await db.transaction((tx) => loadSnapshot(tx, s.companyId, AROUND));
    expect(snap.experience[p0].post[post0]).toBe(3);
  });

  test('experience 집계: sub 배치는 draft여도 한 번만 세고, 제품은 계획 칸의 제품으로 센다; 기간 밖 이력도 센다', async () => {
    const s = await seedCompany(db);
    const p1 = s.personIds[1];
    const [post0, post1] = s.postIds;
    await db.insert(t.experienceBase).values({ companyId: s.companyId, personId: p1, postId: null, productId: s.productId, count: 4 });
    const c = emptyChanges();
    c.upsert.boards = [boardOf(s, { date: '2025-01-01', status: 'confirmed' }), boardOf(s, { date: '2026-11-03' })];
    c.upsert.plans = [
      { companyId: s.companyId, date: '2025-01-01', shift: 'day', postId: post0, productId: s.productId, status: 'run' },
    ];
    c.upsert.assignments = [
      assignmentOf(s, { date: '2025-01-01', personId: p1, source: 'sub' }), // confirmed + sub → once; product via plan
      assignmentOf(s, { date: '2026-11-03', personId: p1, postId: post1, source: 'sub' }), // draft but sub; no plan cell
    ];
    await db.transaction((tx) => applyChanges(tx, s.companyId, c, NOW));
    const snap = await db.transaction((tx) => loadSnapshot(tx, s.companyId, AROUND));
    expect(snap.experience[p1]).toEqual({ post: { [post0]: 1, [post1]: 1 }, product: { [s.productId]: 5 } });
  });

  test('다른 회사 행은 loadSnapshot에 나오지 않는다', async () => {
    const a = await seedCompany(db);
    const b = await seedCompany(db);
    const c = emptyChanges();
    c.upsert.assignments = [assignmentOf(b)];
    c.upsert.boards = [boardOf(b, { status: 'confirmed' })];
    await db.transaction((tx) => applyChanges(tx, b.companyId, c, NOW));
    await db.insert(t.experienceBase).values({ companyId: b.companyId, personId: b.personIds[0], postId: b.postIds[0], productId: null, count: 9 });

    const snap = await db.transaction((tx) => loadSnapshot(tx, a.companyId, AROUND));
    expect(snap.factories.map((f) => f.id)).toEqual([a.factoryId]);
    expect(snap.posts.every((p) => p.companyId === a.companyId)).toBe(true);
    expect(snap.persons.every((p) => p.companyId === a.companyId)).toBe(true);
    expect(snap.products.map((p) => p.id)).toEqual([a.productId]);
    expect(snap.assignments).toEqual([]);
    expect(snap.boards).toEqual([]);
    expect(snap.experience).toEqual({});
  });

  test('applyChanges는 company_id를 강제하고 다른 회사 행을 지우지 않는다', async () => {
    const a = await seedCompany(db);
    const b = await seedCompany(db);
    const bRow = assignmentOf(b);
    const cb = emptyChanges();
    cb.upsert.assignments = [bRow];
    await db.transaction((tx) => applyChanges(tx, b.companyId, cb, NOW));

    const ca = emptyChanges();
    ca.remove.assignments = [bRow.id];
    ca.upsert.assignments = [assignmentOf(a, { companyId: b.companyId })];
    ca.messages = [{ companyId: b.companyId, personId: null, bodyKey: 'k', params: {}, channel: 'admin' }];
    await db.transaction((tx) => applyChanges(tx, a.companyId, ca, NOW));

    const snapB = await db.transaction((tx) => loadSnapshot(tx, b.companyId, AROUND));
    expect(snapB.assignments).toEqual([bRow]);
    const snapA = await db.transaction((tx) => loadSnapshot(tx, a.companyId, AROUND));
    expect(snapA.assignments).toHaveLength(1);
    expect(snapA.assignments[0].companyId).toBe(a.companyId);
    const msgs = await db.select().from(t.messages).where(eq(t.messages.companyId, a.companyId));
    expect(msgs).toHaveLength(1);
  });
});

describe('runAction', () => {
  test('runAction은 rev를 1 올리고, EngineError면 롤백되어 rev 그대로', async () => {
    const s = await seedCompany(db);
    expect(await getRev(s.companyId, { db })).toBe(0);

    const a = assignmentOf(s);
    const result = await runAction(
      s.companyId,
      AROUND,
      (snap) => {
        expect(snap.companyId).toBe(s.companyId);
        const changes = emptyChanges();
        changes.upsert.assignments = [a];
        return { changes, result: 'ok' };
      },
      { db, now: NOW },
    );
    expect(result).toBe('ok');
    expect(await getRev(s.companyId, { db })).toBe(1);

    // plain Changes return → result undefined, rev +1
    const r2 = await runAction(s.companyId, AROUND, () => emptyChanges(), { db, now: NOW });
    expect(r2).toBeUndefined();
    expect(await getRev(s.companyId, { db })).toBe(2);

    // an expired request exists: its expiry is rolled back together with the failed fn
    const ab = absenceOf(s, { personId: s.personIds[4] });
    const sr = subRequestOf(s, ab.id);
    const c = emptyChanges();
    c.upsert = { absences: [ab], subRequests: [sr] };
    await db.transaction((tx) => applyChanges(tx, s.companyId, c, NOW));

    const err = await runAction(
      s.companyId,
      AROUND,
      () => {
        throw new EngineError('NOT_ELIGIBLE');
      },
      { db, now: NOW },
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe('NOT_ELIGIBLE');
    expect(await getRev(s.companyId, { db })).toBe(2);
    const [row] = await db.select().from(t.subRequests).where(eq(t.subRequests.id, sr.id));
    expect(row.status).toBe('sent');
  });

  test('runAction은 없는 회사면 BAD_INPUT', async () => {
    const err = await runAction(randomUUID(), AROUND, () => emptyChanges(), { db, now: NOW }).then(
      () => null,
      (e: unknown) => e,
    );
    expect((err as EngineError).code).toBe('BAD_INPUT');
  });

  test('runAction은 fn 전에 만료 요청을 정리한다(만료 sent → expired 상태로 fn에 전달)', async () => {
    const s = await seedCompany(db);
    const ab = absenceOf(s);
    const sr = subRequestOf(s, ab.id); // expires 00:50Z, now 01:00Z
    const c = emptyChanges();
    c.upsert = { absences: [ab], subRequests: [sr] };
    await db.transaction((tx) => applyChanges(tx, s.companyId, c, NOW));

    let seen: SubRequest[] = [];
    await runAction(
      s.companyId,
      AROUND,
      (snap) => {
        seen = snap.subRequests;
        return emptyChanges();
      },
      { db, now: NOW },
    );
    expect(seen.map((r) => r.status)).toEqual(['expired']);
    const [row] = await db.select().from(t.subRequests).where(eq(t.subRequests.id, sr.id));
    expect(row.status).toBe('expired');
    expect(await getRev(s.companyId, { db })).toBe(1);
  });

  test('expireCompany는 만료할 것이 있을 때만 rev를 올린다', async () => {
    const s = await seedCompany(db);
    expect(await expireCompany(s.companyId, { db, now: NOW })).toBe(false);
    expect(await getRev(s.companyId, { db })).toBe(0);

    const ab = absenceOf(s);
    const sr = subRequestOf(s, ab.id);
    const c = emptyChanges();
    c.upsert = { absences: [ab], subRequests: [sr] };
    await db.transaction((tx) => applyChanges(tx, s.companyId, c, NOW));

    expect(await expireCompany(s.companyId, { db, now: NOW })).toBe(true);
    expect(await getRev(s.companyId, { db })).toBe(1);
    const [row] = await db.select().from(t.subRequests).where(eq(t.subRequests.id, sr.id));
    expect(row.status).toBe('expired');
  });
});
