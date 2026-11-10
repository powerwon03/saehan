import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { POST as boardPost } from '@/app/api/admin/board/route';
import { GET as leavesGet, POST as leavesPost } from '@/app/api/admin/leaves/route';
import { GET as workerGet, POST as workerPost } from '@/app/api/worker/route';
import { reportAbsence, requestSubs } from '@/engine/absence';
import type { Assignment, Changes, Ctx, Snapshot } from '@/engine/types';
import { createAccount } from '@/server/auth/accounts';
import type { Session } from '@/server/auth/session';
import { setNowForTests } from '@/server/clock';
import { setDbForTests, type DB } from '@/server/db/client';
import * as t from '@/server/db/schema';
import { runAction } from '@/server/runAction';
import { monthlyRecord } from '@/server/views/monthlyRecord';
import { makePerson, makeSnapshot } from '../helpers/fixtures';
import { callRoute } from '../helpers/http';
import { createTestDb, seedCompany } from '../helpers/testDb';

let db: DB;
beforeAll(async () => {
  db = await createTestDb();
  setDbForTests(db);
});
afterAll(() => setDbForTests(null));
afterEach(() => setNowForTests(null));

// factory cycle base 2025-04-27: crew A works day, B night, C off on DAY
const DAY = '2025-04-27';
const BEFORE_DAY_SHIFT = new Date('2025-04-26T20:00:00Z'); // 05:00 KST on DAY
const NIGHT_02_KST = new Date('2025-04-26T17:00:00Z'); // 02:00 KST on DAY (crew B is mid night shift of 04-26)
const exp = Date.now() + 86_400_000;
const URL_W = 'http://localhost/api/worker';
const URL_L = 'http://localhost/api/admin/leaves';
const URL_B = 'http://localhost/api/admin/board';

const NAMES = ['김철수', '이영희', '박민수', '최지우', '정다은', '한서준'];
const PHONES = ['010-1111-0001', '010-1111-0002', '010-1111-0003', '010-1111-0004', '010-1111-0005', '010-1111-0006'];

async function setup(now: Date = BEFORE_DAY_SHIFT) {
  setNowForTests(now);
  const s = await seedCompany(db);
  for (const [i, id] of s.personIds.entries()) {
    await db.update(t.persons).set({ name: NAMES[i], phone: PHONES[i] }).where(eq(t.persons.id, id));
  }
  const admin = await createAccount(db, { companyId: s.companyId, kind: 'admin', loginId: 'admin', secret: 'pw-123456' });
  const adminSession: Session = { accountId: admin.id, companyId: s.companyId, kind: 'admin', personId: null, exp };
  const sessions: Session[] = [];
  for (const [i, personId] of s.personIds.entries()) {
    const acc = await createAccount(db, { companyId: s.companyId, kind: 'worker', loginId: `${1001 + i}`, secret: '1234', personId });
    sessions.push({ accountId: acc.id, companyId: s.companyId, kind: 'worker', personId, exp });
  }
  const get = (i: number) => callRoute(workerGet, { url: URL_W, session: sessions[i] });
  const post = (i: number, body: object) => callRoute(workerPost, { url: URL_W, body, session: sessions[i] });
  const admBoard = (body: object) => callRoute(boardPost, { url: URL_B, body, session: adminSession });
  const act = (fn: (snap: Snapshot, ctx: Ctx) => Changes) => runAction(s.companyId, DAY, fn, { now });
  const planAndAssign = async () => {
    for (const i of [0, 1]) {
      await admBoard({ type: 'setPlan', factoryId: s.factoryId, date: DAY, shift: 'day', postId: s.postIds[i], productId: s.productId, status: 'run' });
    }
    expect((await admBoard({ type: 'autoAssign', factoryId: s.factoryId, date: DAY, shift: 'day' })).status).toBe(200);
  };
  return { s, adminSession, sessions, get, post, act, planAndAssign };
}

/** Crew A (persons 0,1) is placed on DAY/day; person 0 reports absent; persons 4,5 (crew C, off) get sub requests. */
async function requestScenario(ctx: Awaited<ReturnType<typeof setup>>) {
  const { s, act, planAndAssign } = ctx;
  await planAndAssign();
  await act((snap, c) => reportAbsence(snap, { personId: s.personIds[0], date: DAY, shift: 'day', kind: 'absent', reportedBy: 'self' }, c));
  const [absence] = await db.select().from(t.absences).where(eq(t.absences.companyId, s.companyId));
  await act((snap, c) => requestSubs(snap, { absenceId: absence.id, personIds: [s.personIds[4], s.personIds[5]] }, c));
  const reqs = await db.select().from(t.subRequests).where(eq(t.subRequests.companyId, s.companyId));
  const reqOf = (personId: string) => reqs.find((r) => r.personId === personId)!.id;
  return { absence, reqOf };
}

describe('GET /api/worker', () => {
  test('응답 JSON 어디에도 다른 사람 phone/name이 없다 (대타 요청 시나리오 포함)', async () => {
    const ctx = await setup();
    const { get } = ctx;
    await requestScenario(ctx);

    for (const me of [4, 5, 0, 1, 2]) {
      const r = await get(me);
      expect(r.status).toBe(200);
      const text = JSON.stringify(r.json);
      expect(text).toContain(NAMES[me]);
      NAMES.forEach((n, i) => i !== me && expect(text, `name of #${i} leaked to #${me}`).not.toContain(n));
      PHONES.forEach((p, i) => expect(text, `phone #${i} leaked to #${me}`).not.toContain(p));
    }
    const b = (await get(4)).json;
    expect(b.request).toMatchObject({ date: DAY, shift: 'day', factoryName: '1공장', postName: expect.any(String) });
    expect(Object.keys(b.request).sort()).toEqual(['date', 'expiresAt', 'factoryName', 'id', 'postName', 'shift']);
  });

  test('02:00 KST 야간 근무자: today.date는 전날, shift night, canReportAbsence false', async () => {
    const { get } = await setup(NIGHT_02_KST);
    const r = await get(2); // crew B
    expect(r.status).toBe(200);
    expect(r.json.today).toMatchObject({ date: '2025-04-26', shift: 'night', start: '19:00', end: '07:00' });
    expect(r.json.canReportAbsence).toBe(false);
    expect(r.json.me).toEqual({ name: NAMES[2], empNo: '1003', lang: 'ko', factoryName: '1공장' });
  });

  test('근무 전 주간 근무자: today 주간, canReportAbsence true, tomorrow도 계산', async () => {
    const { get } = await setup();
    const r = await get(0);
    expect(r.json.today).toMatchObject({ date: DAY, shift: 'day', start: '07:00', end: '19:00' });
    expect(r.json.canReportAbsence).toBe(true);
    expect(r.json.tomorrow).toMatchObject({ date: '2025-04-28', shift: 'day' });
    expect((await get(4)).json.today).toMatchObject({ date: DAY, shift: 'off' }); // crew C off
  });

  test('must_change 근무자는 403 MUST_CHANGE_PIN', async () => {
    const { s } = await setup();
    const acc = await createAccount(db, { companyId: s.companyId, kind: 'worker', loginId: 'mc', secret: '1234', personId: s.personIds[0], mustChange: true });
    const session: Session = { accountId: acc.id, companyId: s.companyId, kind: 'worker', personId: s.personIds[0], exp };
    expect(await callRoute(workerGet, { url: URL_W, session })).toMatchObject({ status: 403, json: { error: 'MUST_CHANGE_PIN' } });
  });

  test('관리자 세션은 /api/worker 403, 근무자 세션은 /api/admin/leaves 403', async () => {
    const { adminSession, sessions } = await setup();
    expect((await callRoute(workerGet, { url: URL_W, session: adminSession })).status).toBe(403);
    expect((await callRoute(workerPost, { url: URL_W, session: adminSession, body: { type: 'setLang', lang: 'en' } })).status).toBe(403);
    expect((await callRoute(leavesGet, { url: URL_L, session: sessions[0] })).status).toBe(403);
    const body = { leaveId: '00000000-0000-4000-8000-000000000000', approve: true };
    expect((await callRoute(leavesPost, { url: URL_L, session: sessions[0], body })).status).toBe(403);
  });
});

describe('POST /api/worker', () => {
  test('동시 수락: Promise.all로 두 명 respond accept → 배치 1건, 하나는 takenByOther', async () => {
    const ctx = await setup();
    const { s, post, get } = ctx;
    const { absence, reqOf } = await requestScenario(ctx);

    const [a, b] = await Promise.all([
      post(4, { type: 'respond', requestId: reqOf(s.personIds[4]), accept: true }),
      post(5, { type: 'respond', requestId: reqOf(s.personIds[5]), accept: true }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.json.outcome, b.json.outcome].sort()).toEqual(['accepted', 'takenByOther']);
    const subs = (await db.select().from(t.assignments).where(eq(t.assignments.companyId, s.companyId))).filter((x) => x.source === 'sub');
    expect(subs).toHaveLength(1);
    expect(subs[0].reason).toBe(`absence:${absence.id}`);

    const loser = a.json.outcome === 'takenByOther' ? 4 : 5;
    const winner = loser === 4 ? 5 : 4;
    const lv = (await get(loser)).json;
    expect(lv.request).toBeNull();
    expect(lv.requestOutcome).toBe('takenByOther');
    const wv = (await get(winner)).json;
    expect(wv.requestOutcome).toBeNull();
    expect(wv.today).toMatchObject({ date: DAY, shift: 'day', factoryName: '1공장' });
  });

  test('남의 requestId로 respond → 403 FORBIDDEN', async () => {
    const ctx = await setup();
    const { s, post } = ctx;
    const { reqOf } = await requestScenario(ctx);
    const r = await post(4, { type: 'respond', requestId: reqOf(s.personIds[5]), accept: true });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: 'FORBIDDEN' });
  });

  test('휴무 신청 → 관리자 승인 → 그날 근무일이면 결근 카드 생성', async () => {
    const { s, adminSession, post, get } = await setup();
    const NEXT = '2025-04-28'; // crew A day
    expect((await post(0, { type: 'requestLeave', date: NEXT })).status).toBe(200);
    expect((await get(0)).json.leaves).toEqual([{ id: expect.any(String), date: NEXT, status: 'pending' }]);

    const list = await callRoute(leavesGet, { url: URL_L, session: adminSession });
    expect(list.json).toEqual([
      expect.objectContaining({ personId: s.personIds[0], name: NAMES[0], empNo: '1001', date: NEXT, status: 'pending', regularShift: 'day' }),
    ]);
    const done = await callRoute(leavesPost, { url: URL_L, session: adminSession, body: { leaveId: list.json[0].id, approve: true } });
    expect(done.status).toBe(200);
    const rows = await db.select().from(t.absences).where(eq(t.absences.companyId, s.companyId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ personId: s.personIds[0], date: NEXT, shift: 'day', kind: 'leave' });
    expect((await callRoute(leavesGet, { url: URL_L, session: adminSession })).json).toEqual([]); // no longer pending
    expect((await callRoute(leavesGet, { url: `${URL_L}?status=approved`, session: adminSession })).json).toHaveLength(1);
    expect((await get(0)).json.leaves[0].status).toBe('approved');
  });

  test('휴무 승인: 알 수 없는 leaveId는 400 BAD_INPUT, cancelLeave는 본인 것만', async () => {
    const { s, adminSession, post } = await setup();
    const bad = await callRoute(leavesPost, {
      url: URL_L,
      session: adminSession,
      body: { leaveId: '00000000-0000-4000-8000-000000000000', approve: true },
    });
    expect(bad).toMatchObject({ status: 400, json: { error: 'BAD_INPUT' } });
    await post(0, { type: 'requestLeave', date: '2025-04-29' });
    const [leave] = await db.select().from(t.leaveRequests).where(eq(t.leaveRequests.companyId, s.companyId));
    expect((await post(1, { type: 'cancelLeave', leaveId: leave.id })).status).toBe(403);
    expect((await post(0, { type: 'cancelLeave', leaveId: leave.id })).status).toBe(200);
  });

  test('신고 후 cancelAbsence → 원래 배치 복원', async () => {
    const ctx = await setup();
    const { s, post, get, planAndAssign } = ctx;
    await planAndAssign();
    const placed = () => db.select().from(t.assignments).where(eq(t.assignments.personId, s.personIds[0]));
    const before = await placed();
    expect(before).toHaveLength(1);

    expect((await post(0, { type: 'reportAbsence' })).status).toBe(200);
    expect(await placed()).toHaveLength(0);
    const mid = (await get(0)).json;
    expect(mid.canReportAbsence).toBe(false);
    expect(mid.myAbsence).toMatchObject({ id: expect.any(String) });

    expect((await post(0, { type: 'cancelAbsence', absenceId: mid.myAbsence.id })).status).toBe(200);
    const after = await placed();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ postId: before[0].postId, date: DAY, shift: 'day' });
    const back = (await get(0)).json;
    expect(back.myAbsence).toBeNull();
    expect(back.canReportAbsence).toBe(true);
  });

  test('쉬는 날·근무 시작 후 신고는 400 CANNOT_REPORT, 남의 absenceId 취소는 403', async () => {
    const { s, post } = await setup();
    expect(await post(4, { type: 'reportAbsence' })).toMatchObject({ status: 400, json: { error: 'CANNOT_REPORT' } });
    await post(0, { type: 'reportAbsence' });
    const [row] = await db.select().from(t.absences).where(eq(t.absences.companyId, s.companyId));
    expect((await post(1, { type: 'cancelAbsence', absenceId: row.id })).status).toBe(403);
    setNowForTests(new Date('2025-04-26T23:00:00Z')); // 08:00 KST, shift started
    expect(await post(1, { type: 'reportAbsence' })).toMatchObject({ status: 400, json: { error: 'CANNOT_REPORT' } });
  });

  test('setLang은 본인 언어만 바꾸고 rev가 오른다; 잘못된 본문은 400', async () => {
    const { s, post, get } = await setup();
    const rev = async () => (await db.select().from(t.companies).where(eq(t.companies.id, s.companyId)))[0].rev;
    const r0 = await rev();
    const r = await post(0, { type: 'setLang', lang: 'mn' });
    expect(r.json).toMatchObject({ ok: true, rev: r0 + 1 });
    expect((await get(0)).json.me.lang).toBe('mn');
    expect((await get(1)).json.me.lang).toBe('ko');
    expect((await post(0, { type: 'setLang', lang: 'xx' })).status).toBe(400);
    expect((await post(0, { type: 'respond', requestId: 'nope', accept: true })).status).toBe(400);
  });
});

describe('monthlyRecord', () => {
  test('월 범위·오늘까지만 집계: 근무일·주야·시간·대타·결근', () => {
    const person = makePerson({ id: 'p1', crew: 'A' });
    const sub: Assignment = {
      id: 'as1', companyId: 'co-1', date: '2025-04-20', shift: 'night', factoryId: 'f1', postId: 'post1', personId: 'p1',
      source: 'sub', locked: true, reason: null, flags: [], createdAt: new Date('2025-04-19T00:00:00Z'),
    };
    const absence = {
      id: 'ab1', companyId: 'co-1', date: '2025-04-03', shift: 'day' as const, factoryId: 'f1', personId: 'p1', postId: null,
      kind: 'absent' as const, reportedBy: 'self' as const, reason: null, status: 'not-needed' as const, resolvedPersonId: null,
      round: 1, restore: null, createdAt: new Date('2025-04-02T00:00:00Z'), resolvedAt: null,
    };
    const snap = makeSnapshot({ persons: [person], assignments: [sub], absences: [absence] });

    // crew A (base 04-27): day 04-03..06, 04-15..18, 04-27..30; night 04-09..12, 04-21..24; 04-03 is absent
    expect(monthlyRecord(snap, 'p1', '2025-04', '2025-04-30')).toEqual({
      workDays: 20, dayCount: 11, nightCount: 9, hours: 160, subCount: 1, missedDays: 1,
    });
    expect(monthlyRecord(snap, 'p1', '2025-04', '2025-04-10')).toEqual({
      workDays: 5, dayCount: 3, nightCount: 2, hours: 40, subCount: 0, missedDays: 1,
    });
    expect(monthlyRecord(snap, 'p1', '2025-03', '2025-04-10').missedDays).toBe(0);
  });
});
