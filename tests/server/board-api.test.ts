import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GET, POST } from '@/app/api/admin/board/route';
import { createAccount } from '@/server/auth/accounts';
import type { Session } from '@/server/auth/session';
import { setDbForTests, type DB } from '@/server/db/client';
import * as t from '@/server/db/schema';
import { boardView } from '@/server/views/boardView';
import { makePerson, makePost, makeSnapshot } from '../helpers/fixtures';
import { callRoute } from '../helpers/http';
import { createTestDb, seedCompany, type Seeded } from '../helpers/testDb';

let db: DB;
beforeAll(async () => {
  db = await createTestDb();
  setDbForTests(db);
});
afterAll(() => setDbForTests(null));

// factory cycle base 2025-04-27: crew A works day, B night, C off on this date
const DAY = '2025-04-27';
const exp = Date.now() + 86_400_000;
type Crews = ('A' | 'B' | 'C' | 'D')[];

async function setup(crews?: Crews) {
  const s = await seedCompany(db, { crews });
  const admin = await createAccount(db, { companyId: s.companyId, kind: 'admin', loginId: 'admin', secret: 'pw-123456' });
  const session: Session = { accountId: admin.id, companyId: s.companyId, kind: 'admin', personId: null, exp };
  const post = (body: object) => callRoute(POST, { url: 'http://localhost/api/admin/board', body, session });
  const get = (qs = `date=${DAY}&shift=day`) => callRoute(GET, { url: `http://localhost/api/admin/board?${qs}`, session });
  const auto = () => post({ type: 'autoAssign', factoryId: s.factoryId, date: DAY, shift: 'day' });
  return { s, session, post, get, auto };
}

const planBodies = (s: Seeded) =>
  [0, 1].map((i) => ({
    type: 'setPlan',
    factoryId: s.factoryId,
    date: DAY,
    shift: 'day',
    postId: s.postIds[i],
    productId: s.productId,
    status: 'run',
  }));

const firstPlaced = (v: any): string => v.lines.flatMap((l: any) => l.people)[0].personId;

describe('admin board API', () => {
  test('계획 → autoAssign → GET: 필요=배치+빈자리, 같은 사람 중복 없음', async () => {
    const { s, post, get, auto } = await setup();
    for (const b of planBodies(s)) expect((await post(b)).status).toBe(200);
    const r = await auto();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, rev: expect.any(Number) });

    const v = (await get()).json;
    expect(v.status).toBe('draft');
    const placed = v.lines.flatMap((l: any) => l.people.map((p: any) => p.personId));
    expect(new Set(placed).size).toBe(placed.length);
    const vacancies = v.lines.reduce((n: number, l: any) => n + l.vacancies, 0);
    expect(v.summary.need).toBe(placed.length + vacancies);
    expect(v.summary.need).toBe(3); // L1, L2, Q1
    expect(placed).toHaveLength(2); // crew A has two people
    expect(v.summary.diff).toBe(v.summary.present - v.summary.need);
  });

  test('confirm 후 status confirmed (confirmedBy 기록)', async () => {
    const { s, session, post, get, auto } = await setup();
    await auto();
    expect((await post({ type: 'confirm', factoryId: s.factoryId, date: DAY, shift: 'day' })).status).toBe(200);
    expect((await get()).json.status).toBe('confirmed');
    const [row] = await db.select().from(t.boards).where(eq(t.boards.companyId, s.companyId));
    expect(row.confirmedBy).toBe(session.accountId);
  });

  test('reportAbsence(관리자) → absences[0].status decided, candidates 존재', async () => {
    const { post, get, auto } = await setup();
    await auto();
    const victim = firstPlaced((await get()).json);
    const r = await post({ type: 'reportAbsence', date: DAY, shift: 'day', personId: victim, kind: 'sick' });
    expect(r.status).toBe(200);
    const v = (await get()).json;
    expect(v.absences[0].status).toBe('decided');
    expect(v.absences[0].person.personId).toBe(victim);
    expect(v.absences[0].candidates.length).toBeGreaterThan(0);
    expect(v.absences[0].candidates[0]).toMatchObject({ name: expect.any(String), empNo: expect.any(String), factoryName: '1공장' });
  });

  test('requestSubs 후 GET에 requests 3건 sent', async () => {
    const { post, get, auto } = await setup(['A', 'A', 'B', 'B', 'C', 'C', 'C', 'C']);
    await auto();
    const victim = firstPlaced((await get()).json);
    await post({ type: 'reportAbsence', date: DAY, shift: 'day', personId: victim, kind: 'absent' });
    const absence = (await get()).json.absences[0];
    const ids = absence.candidates.slice(0, 3).map((c: any) => c.personId);
    expect(ids).toHaveLength(3);
    expect((await post({ type: 'requestSubs', date: DAY, shift: 'day', absenceId: absence.id, personIds: ids })).status).toBe(200);
    const v = (await get()).json;
    expect(v.absences[0].status).toBe('in-progress');
    expect(v.absences[0].requests).toHaveLength(3);
    expect(v.absences[0].requests.every((q: any) => q.status === 'sent')).toBe(true);
  });

  test('assign으로 전날 야간자 주간 배치 → 400 {error:"NIGHT_BEFORE_DAY"}', async () => {
    const { s, post } = await setup();
    // 2025-05-07: crew A is off after working the night of 05-06
    const r = await post({
      type: 'assign',
      factoryId: s.factoryId,
      date: '2025-05-07',
      shift: 'day',
      postId: s.postIds[0],
      personId: s.personIds[0],
    });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: 'NIGHT_BEFORE_DAY' });
  });

  test('swap · unassign · toggleStop · cancelAbsence · placeSub · assign 성공 경로', async () => {
    const { s, post, get, auto } = await setup();
    for (const b of planBodies(s)) await post(b);
    await auto();
    let v = (await get()).json;
    const [a1, a2] = v.lines.flatMap((l: any) => l.people).map((p: any) => p.assignmentId);
    expect((await post({ type: 'swap', date: DAY, shift: 'day', assignmentIdA: a1, assignmentIdB: a2 })).status).toBe(200);
    expect((await post({ type: 'unassign', date: DAY, shift: 'day', assignmentId: a1 })).status).toBe(200);
    expect((await post({ type: 'toggleStop', factoryId: s.factoryId, date: DAY, shift: 'day', postId: s.postIds[1] })).status).toBe(200);
    v = (await get()).json;
    expect(v.lines.find((l: any) => l.post.id === s.postIds[1]).stopped).toBe(true);

    const victim = firstPlaced(v);
    await post({ type: 'reportAbsence', date: DAY, shift: 'day', personId: victim, kind: 'late' });
    const abs = (await get()).json.absences[0];
    expect((await post({ type: 'cancelAbsence', date: DAY, shift: 'day', absenceId: abs.id })).status).toBe(200);
    expect((await get()).json.absences).toHaveLength(0);

    // crew C is resting that day: assign one of them to a vacant post, then use another as a sub
    const rested = s.personIds[4];
    expect((await post({ type: 'assign', factoryId: s.factoryId, date: DAY, shift: 'day', postId: s.postIds[2], personId: rested })).status).toBe(200);
    v = (await get()).json;
    expect(v.lines.find((l: any) => l.post.id === s.postIds[2]).people[0]).toMatchObject({ personId: rested, source: 'manual', locked: true });

    await post({ type: 'reportAbsence', date: DAY, shift: 'day', personId: victim, kind: 'absent' });
    const abs2 = (await get()).json.absences[0];
    expect(abs2.status).toBe('decided');
    const sub = s.personIds[5];
    expect((await post({ type: 'placeSub', date: DAY, shift: 'day', absenceId: abs2.id, personId: sub })).status).toBe(200);
    const done = (await get()).json.absences[0];
    expect(done.status).toBe('resolved');
    expect(done.resolvedPerson.personId).toBe(sub);
  });

  test('인증: 세션 없음 401, 근무자 403', async () => {
    const { s } = await setup();
    const url = `http://localhost/api/admin/board?date=${DAY}&shift=day`;
    expect((await callRoute(GET, { url })).status).toBe(401);
    expect((await callRoute(POST, { url, body: { type: 'autoAssign' } })).status).toBe(401);
    const w = await createAccount(db, { companyId: s.companyId, kind: 'worker', loginId: '1001', secret: '482917', personId: s.personIds[0] });
    const worker: Session = { accountId: w.id, companyId: s.companyId, kind: 'worker', personId: s.personIds[0], exp };
    expect((await callRoute(GET, { url, session: worker })).status).toBe(403);
    expect((await callRoute(POST, { url, body: { type: 'autoAssign' }, session: worker })).status).toBe(403);
  });

  test('입력 검증: 알 수 없는 type·다른 공장 id·잘못된 날짜 → 400 BAD_INPUT', async () => {
    const { post, get } = await setup();
    expect((await post({ type: 'nope' })).json).toEqual({ error: 'BAD_INPUT' });
    const foreign = '00000000-0000-4000-8000-000000000000';
    expect((await get(`date=${DAY}&shift=day&factory=${foreign}`)).json).toEqual({ error: 'BAD_INPUT' });
    expect((await get('date=bogus')).json).toEqual({ error: 'BAD_INPUT' });
    expect((await get('shift=swing')).json).toEqual({ error: 'BAD_INPUT' });
  });

  test('GET 응답 어디에도 phone 키가 없다', async () => {
    const { s, post, get, auto } = await setup(['A', 'A', 'B', 'B', 'C', 'C', 'C', 'C']);
    await db.update(t.persons).set({ phone: '010-1234-5678' }).where(eq(t.persons.companyId, s.companyId));
    await auto();
    const victim = firstPlaced((await get()).json);
    await post({ type: 'reportAbsence', date: DAY, shift: 'day', personId: victim, kind: 'absent' });
    const json = (await get()).json;
    const keys: string[] = [];
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object')
        for (const [k, v] of Object.entries(x)) {
          keys.push(k);
          walk(v);
        }
    };
    walk(json);
    expect(json.absences[0].candidates.length).toBeGreaterThan(0);
    expect(keys.some((k) => k.toLowerCase().includes('phone'))).toBe(false);
    expect(JSON.stringify(json)).not.toContain('010-1234');
  });
});

describe('boardView (pure)', () => {
  test('summary 계산: present = 명단 + 타 교대 sub, vacancies = max(0, need - people)', () => {
    const asg = (id: string, postId: string, personId: string, over: object = {}) => ({
      id,
      companyId: 'co-1',
      date: DAY,
      shift: 'day' as const,
      factoryId: 'f1',
      postId,
      personId,
      source: 'auto' as const,
      locked: false,
      reason: null,
      flags: [],
      createdAt: new Date(),
      ...over,
    });
    const snap = makeSnapshot({
      posts: [makePost({ id: 'l1', code: 'L1', defaultNeed: 2, sort: 0 }), makePost({ id: 'l2', code: 'L2', defaultNeed: 1, sort: 1 })],
      // crew A works day on 2025-04-27; crew B works night -> p3 is an outsider for the day shift
      persons: [
        makePerson({ id: 'p1', empNo: '1', crew: 'A' }),
        makePerson({ id: 'p2', empNo: '2', crew: 'A' }),
        makePerson({ id: 'p3', empNo: '3', crew: 'B' }),
      ],
      assignments: [asg('a1', 'l1', 'p1', { flags: ['low-skill'] }), asg('a2', 'l2', 'p3', { source: 'sub', locked: true })],
    });
    const v = boardView(snap, { factoryId: 'f1', date: DAY, shift: 'day' });
    expect(v.status).toBe('none');
    expect(v.summary).toEqual({ need: 3, present: 3, diff: 0 }); // roster p1,p2 + sub p3
    expect(v.lines.map((l) => [l.post.code, l.need, l.people.length, l.vacancies])).toEqual([
      ['L1', 2, 1, 1],
      ['L2', 1, 1, 0],
    ]);
    expect(v.lines[0].people[0]).toMatchObject({ assignmentId: 'a1', flags: ['low-skill'], source: 'auto', locked: false });
    expect(v.idle.map((p) => p.personId)).toEqual(['p2']);
  });

  test('초과 배치는 vacancies 0, diff 양수', () => {
    const snap = makeSnapshot({
      posts: [makePost({ id: 'l1', defaultNeed: 1 })],
      persons: [makePerson({ id: 'p1', empNo: '1', crew: 'A' }), makePerson({ id: 'p2', empNo: '2', crew: 'A' })],
    });
    const v = boardView(snap, { factoryId: 'f1', date: DAY, shift: 'day' });
    expect(v.summary).toEqual({ need: 1, present: 2, diff: 1 });
    expect(v.lines[0].vacancies).toBe(1);
    expect(v.idle).toHaveLength(2);
  });
});
