import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { GET as accountsGet, POST as accountsPost } from '@/app/api/admin/accounts/route';
import { POST as boardPost } from '@/app/api/admin/board/route';
import { DELETE as masterDelete, GET as masterGet, PATCH as masterPatch, POST as masterPost } from '@/app/api/admin/master/[kind]/route';
import { DELETE as personDelete, PATCH as personPatch, POST as personAction } from '@/app/api/admin/persons/[id]/route';
import { GET as personsGet, POST as personsPost } from '@/app/api/admin/persons/route';
import { GET as settingsGet, PUT as settingsPut } from '@/app/api/admin/settings/route';
import { POST as skillsPost } from '@/app/api/admin/skills/route';
import { skillLevel } from '@/engine/skill';
import { createAccount } from '@/server/auth/accounts';
import { verifySecret } from '@/server/auth/hash';
import type { Session } from '@/server/auth/session';
import { setNowForTests } from '@/server/clock';
import { setDbForTests, type DB } from '@/server/db/client';
import * as t from '@/server/db/schema';
import { suggestEmpNo } from '@/server/admin/persons';
import { loadSnapshot } from '@/server/repo/snapshot';
import { callRoute } from '../helpers/http';
import { createTestDb, seedCompany } from '../helpers/testDb';

let db: DB;
beforeAll(async () => {
  db = await createTestDb();
  setDbForTests(db);
});
afterAll(() => setDbForTests(null));
afterEach(() => setNowForTests(null));

const DAY = '2025-04-27'; // crew A works day
const NOW = new Date('2025-04-26T20:00:00Z'); // 05:00 KST on DAY
const exp = Date.now() + 86_400_000;
const U = 'http://localhost/api/admin';

async function setup() {
  setNowForTests(NOW);
  const s = await seedCompany(db);
  const admin = await createAccount(db, { companyId: s.companyId, kind: 'admin', loginId: 'admin', secret: 'pw-123456' });
  const adm: Session = { accountId: admin.id, companyId: s.companyId, kind: 'admin', personId: null, exp };
  const wacc = await createAccount(db, { companyId: s.companyId, kind: 'worker', loginId: '1001', secret: '482913', personId: s.personIds[0] });
  const wrk: Session = { accountId: wacc.id, companyId: s.companyId, kind: 'worker', personId: s.personIds[0], exp };
  const other = await seedCompany(db);
  return { s, adm, wrk, other };
}
const newPerson = (s: Awaited<ReturnType<typeof setup>>['s'], over: object = {}) => ({
  name: '신입', affiliation: 'direct', crew: 'A', factoryId: s.factoryId, pin: '482913', ...over,
});

describe('persons', () => {
  test('suggestEmpNo: 최대 번호+1, 접두·자릿수 유지', () => {
    expect(suggestEmpNo(['A0118', 'A0119', 'A0007'])).toBe('A0120');
    expect(suggestEmpNo(['1001', '1006'])).toBe('1007');
    expect(suggestEmpNo(['0099'])).toBe('0100');
    expect(suggestEmpNo(['ABC'])).toBe('0001');
    expect(suggestEmpNo([])).toBe('0001');
  });

  test('사번 생략 시 최대 사번+1 제안, 근무자 계정이 mustChange로 함께 생성된다', async () => {
    const { s, adm } = await setup();
    const r = await callRoute(personsPost, { url: `${U}/persons`, session: adm, body: newPerson(s) });
    expect(r.status).toBe(200);
    expect(r.json.person.empNo).toBe('1007');
    const [acc] = await db.select().from(t.accounts).where(and(eq(t.accounts.companyId, s.companyId), eq(t.accounts.personId, r.json.person.id)));
    expect(acc).toMatchObject({ kind: 'worker', loginId: '1007', mustChange: true });
    expect(await verifySecret('482913', acc.secretHash)).toBe(true);
    // A0119 -> A0120 form
    for (const [i, id] of s.personIds.entries()) await db.update(t.persons).set({ empNo: `A${String(114 + i).padStart(4, '0')}` }).where(eq(t.persons.id, id));
    await db.delete(t.accounts).where(eq(t.accounts.personId, r.json.person.id));
    await db.delete(t.persons).where(eq(t.persons.id, r.json.person.id));
    const r2 = await callRoute(personsPost, { url: `${U}/persons`, session: adm, body: newPerson(s) });
    expect(r2.json.person.empNo).toBe('A0120');
  });

  test('약한 PIN·다른 회사 공장·중복 사번은 거절', async () => {
    const { s, adm, other } = await setup();
    const post = (b: object) => callRoute(personsPost, { url: `${U}/persons`, session: adm, body: b });
    expect((await post(newPerson(s, { pin: '111111' }))).json.error).toBe('BAD_INPUT');
    expect((await post(newPerson(s, { pin: '12' }))).json.error).toBe('BAD_INPUT');
    expect(await post(newPerson(s, { factoryId: other.factoryId }))).toMatchObject({ status: 400, json: { error: 'BAD_INPUT' } });
    expect(await post(newPerson(s, { fixedPostId: other.postIds[0] }))).toMatchObject({ status: 400, json: { error: 'BAD_INPUT' } });
    expect(await post(newPerson(s, { empNo: '1001' }))).toMatchObject({ status: 400, json: { error: 'DUPLICATE_CODE' } });
  });

  test('PATCH: 부분 수정, 사번 변경 시 로그인 ID 동기화, 중복은 DUPLICATE_CODE', async () => {
    const { s, adm } = await setup();
    const url = `${U}/persons/${s.personIds[0]}`;
    const params = { id: s.personIds[0] };
    const r = await callRoute(personPatch, { url, method: 'PATCH', session: adm, params, body: { name: '새이름', empNo: '2001', phone: '010-0000-0000' } });
    expect(r.status).toBe(200);
    const [p] = await db.select().from(t.persons).where(eq(t.persons.id, s.personIds[0]));
    expect(p).toMatchObject({ name: '새이름', empNo: '2001' });
    const [acc] = await db.select().from(t.accounts).where(eq(t.accounts.personId, s.personIds[0]));
    expect(acc.loginId).toBe('2001');
    expect((await callRoute(personPatch, { url, method: 'PATCH', session: adm, params, body: { empNo: '1002' } })).json.error).toBe('DUPLICATE_CODE');
  });

  test('GET: q·active 필터, 비밀 해시 없음', async () => {
    const { s, adm } = await setup();
    await db.update(t.persons).set({ active: false }).where(eq(t.persons.id, s.personIds[5]));
    const act = await callRoute(personsGet, { url: `${U}/persons`, session: adm });
    expect(act.json.persons).toHaveLength(5);
    expect(JSON.stringify(act.json)).not.toContain('secret');
    expect((await callRoute(personsGet, { url: `${U}/persons?active=false`, session: adm })).json.persons).toHaveLength(1);
    expect((await callRoute(personsGet, { url: `${U}/persons?active=all`, session: adm })).json.persons).toHaveLength(6);
    expect((await callRoute(personsGet, { url: `${U}/persons?q=${encodeURIComponent('근무자3')}`, session: adm })).json.persons).toHaveLength(1);
    expect((await callRoute(personsGet, { url: `${U}/persons?q=1002`, session: adm })).json.persons[0].empNo).toBe('1002');
  });

  test('퇴사: 오늘 이후 배치·sent 요청·pending 휴무 정리, 자동 배치 후보에서 제외', async () => {
    const { s, adm } = await setup();
    const board = (body: object) => callRoute(boardPost, { url: `${U}/board`, session: adm, body });
    for (const i of [0, 1]) await board({ type: 'setPlan', factoryId: s.factoryId, date: DAY, shift: 'day', postId: s.postIds[i], productId: s.productId, status: 'run' });
    await board({ type: 'autoAssign', factoryId: s.factoryId, date: DAY, shift: 'day' });
    const mine = () => db.select().from(t.assignments).where(eq(t.assignments.personId, s.personIds[0]));
    expect(await mine()).toHaveLength(1);
    // an old assignment (before today) must survive
    await db.insert(t.assignments).values({ companyId: s.companyId, date: '2025-04-20', shift: 'day', factoryId: s.factoryId, postId: s.postIds[0], personId: s.personIds[0], source: 'manual' });
    const [abs] = await db.insert(t.absences).values({ companyId: s.companyId, date: DAY, shift: 'day', factoryId: s.factoryId, personId: s.personIds[1], kind: 'absent', reportedBy: 'leader', status: 'pending-board' }).returning();
    await db.insert(t.subRequests).values({ companyId: s.companyId, absenceId: abs.id, personId: s.personIds[0], round: 1, rank: 1, status: 'sent', sentAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000) });
    await db.insert(t.leaveRequests).values({ companyId: s.companyId, personId: s.personIds[0], date: '2025-05-02', kind: 'leave', status: 'pending' });
    await db.insert(t.leaveRequests).values({ companyId: s.companyId, personId: s.personIds[0], date: '2025-05-03', kind: 'leave', status: 'approved' });

    const r = await callRoute(personAction, { url: `${U}/persons/${s.personIds[0]}`, session: adm, params: { id: s.personIds[0] }, body: { action: 'retire' } });
    expect(r.status).toBe(200);
    const [p] = await db.select().from(t.persons).where(eq(t.persons.id, s.personIds[0]));
    expect(p).toMatchObject({ active: false, leftAt: DAY });
    expect((await mine()).map((a) => a.date)).toEqual(['2025-04-20']);
    expect((await db.select().from(t.subRequests).where(eq(t.subRequests.personId, s.personIds[0])))[0].status).toBe('cancelled');
    const leaves = await db.select().from(t.leaveRequests).where(eq(t.leaveRequests.personId, s.personIds[0]));
    expect(leaves.find((l) => l.date === '2025-05-02')!.status).toBe('cancelled');
    expect(leaves.find((l) => l.date === '2025-05-03')!.status).toBe('approved');

    // never a candidate again
    await board({ type: 'autoAssign', factoryId: s.factoryId, date: DAY, shift: 'day' });
    expect((await mine()).map((a) => a.date)).toEqual(['2025-04-20']);

    // rehire
    const rr = await callRoute(personAction, { url: `${U}/persons/${s.personIds[0]}`, session: adm, params: { id: s.personIds[0] }, body: { action: 'rehire' } });
    expect(rr.status).toBe(200);
    expect((await db.select().from(t.persons).where(eq(t.persons.id, s.personIds[0])))[0]).toMatchObject({ active: true, leftAt: null });
  });

  test('이력 있는 사람 DELETE → 400 HAS_HISTORY, 이력 없으면 계정까지 삭제', async () => {
    const { s, adm } = await setup();
    await db.insert(t.assignments).values({ companyId: s.companyId, date: '2025-04-20', shift: 'day', factoryId: s.factoryId, postId: s.postIds[0], personId: s.personIds[0], source: 'manual' });
    const del = (i: number) => callRoute(personDelete, { url: `${U}/persons/${s.personIds[i]}`, method: 'DELETE', session: adm, params: { id: s.personIds[i] } });
    expect(await del(0)).toMatchObject({ status: 400, json: { error: 'HAS_HISTORY' } });
    await db.insert(t.skills).values({ companyId: s.companyId, personId: s.personIds[1], postId: s.postIds[0], level: 2 });
    expect((await del(1)).status).toBe(200);
    expect(await db.select().from(t.persons).where(eq(t.persons.id, s.personIds[1]))).toHaveLength(0);
    expect(await db.select().from(t.skills).where(eq(t.skills.personId, s.personIds[1]))).toHaveLength(0);
  });
});

describe('skills · accounts', () => {
  test('숙련도 칸 3 저장 후 skillLevel 3, null이면 이력 기반으로 복귀', async () => {
    const { s, adm } = await setup();
    const post = (body: object) => callRoute(skillsPost, { url: `${U}/skills`, session: adm, body });
    const level = async () => skillLevel(await db.transaction((tx) => loadSnapshot(tx, s.companyId, DAY)), s.personIds[0], s.postIds[0]);
    expect(await level()).toBe(0);
    expect((await post({ personId: s.personIds[0], postId: s.postIds[0], level: 3 })).status).toBe(200);
    expect(await level()).toBe(3);
    expect((await post({ personId: s.personIds[0], postId: s.postIds[0], level: 1 })).status).toBe(200); // upsert
    expect(await level()).toBe(1);
    expect((await post({ personId: s.personIds[0], postId: s.postIds[0], level: null })).status).toBe(200);
    expect(await level()).toBe(0);
    expect((await post({ personId: s.personIds[0], postId: s.postIds[0], level: 4 })).json.error).toBe('BAD_INPUT');
  });

  test('resetPin → mustChange true, unlock → failedCount 0, 목록에는 잠긴 계정이 보인다', async () => {
    const { s, adm } = await setup();
    const pid = s.personIds[0];
    await db.update(t.accounts).set({ failedCount: 4, lockedUntil: new Date(Date.now() + 600_000), mustChange: false }).where(eq(t.accounts.personId, pid));
    const list = await callRoute(accountsGet, { url: `${U}/accounts`, session: adm });
    expect(list.json.accounts.find((a: any) => a.personId === pid)).toMatchObject({ empNo: '1001', failedCount: 4, mustChange: false });
    expect(JSON.stringify(list.json)).not.toContain('scrypt');
    const acc = () => db.select().from(t.accounts).where(eq(t.accounts.personId, pid)).then((r) => r[0]);
    expect((await callRoute(accountsPost, { url: `${U}/accounts`, session: adm, body: { personId: pid, action: 'unlock' } })).status).toBe(200);
    expect(await acc()).toMatchObject({ failedCount: 0, lockedUntil: null });
    expect((await callRoute(accountsPost, { url: `${U}/accounts`, session: adm, body: { personId: pid, action: 'resetPin', pin: '000000' } })).json.error).toBe('BAD_INPUT');
    expect((await callRoute(accountsPost, { url: `${U}/accounts`, session: adm, body: { personId: pid, action: 'resetPin', pin: '739105' } })).status).toBe(200);
    const a = await acc();
    expect(a).toMatchObject({ mustChange: true, failedCount: 0, lockedUntil: null });
    expect(await verifySecret('739105', a.secretHash)).toBe(true);
  });

  test('다른 회사 사람·자리 id는 400', async () => {
    const { s, adm, other } = await setup();
    expect((await callRoute(skillsPost, { url: `${U}/skills`, session: adm, body: { personId: other.personIds[0], postId: s.postIds[0], level: 2 } })).json.error).toBe('BAD_INPUT');
    expect((await callRoute(skillsPost, { url: `${U}/skills`, session: adm, body: { personId: s.personIds[0], postId: other.postIds[0], level: 2 } })).json.error).toBe('BAD_INPUT');
    expect((await callRoute(accountsPost, { url: `${U}/accounts`, session: adm, body: { personId: other.personIds[0], action: 'unlock' } })).status).toBe(400);
    expect((await callRoute(personPatch, { url: `${U}/persons/x`, method: 'PATCH', session: adm, params: { id: other.personIds[0] }, body: { name: 'x' } })).status).toBe(400);
    expect((await callRoute(personDelete, { url: `${U}/persons/x`, method: 'DELETE', session: adm, params: { id: other.personIds[0] } })).status).toBe(400);
    expect((await db.select().from(t.persons).where(eq(t.persons.id, other.personIds[0])))[0].name).not.toBe('x');
  });
});

describe('master data', () => {
  const m = (kind: string) => `${U}/master/${kind}`;

  test('제품 코드 중복 → DUPLICATE_CODE, 생성·수정·목록', async () => {
    const { adm } = await setup();
    const p = { kind: 'products' };
    const c = await callRoute(masterPost, { url: m('products'), session: adm, params: p, body: { code: 'P2', name: '제품2', urgent: true } });
    expect(c.status).toBe(200);
    expect(await callRoute(masterPost, { url: m('products'), session: adm, params: p, body: { code: 'P1', name: '중복' } })).toMatchObject({ status: 400, json: { error: 'DUPLICATE_CODE' } });
    expect((await callRoute(masterPatch, { url: m('products'), method: 'PATCH', session: adm, params: p, body: { id: c.json.row.id, code: 'P1' } })).json.error).toBe('DUPLICATE_CODE');
    expect((await callRoute(masterPatch, { url: m('products'), method: 'PATCH', session: adm, params: p, body: { id: c.json.row.id, name: '바뀜' } })).status).toBe(200);
    const list = await callRoute(masterGet, { url: m('products'), session: adm, params: p });
    expect(list.json.rows.map((r: any) => r.code)).toEqual(['P1', 'P2']);
    expect(list.json.rows[1].name).toBe('바뀜');
  });

  test('자리: 공장 소속 검증, 같은 공장 내 코드 중복', async () => {
    const { s, adm, other } = await setup();
    const p = { kind: 'posts' };
    const body = { factoryId: s.factoryId, code: 'L3', name: '3라인', kind: 'line' };
    expect((await callRoute(masterPost, { url: m('posts'), session: adm, params: p, body })).status).toBe(200);
    expect((await callRoute(masterPost, { url: m('posts'), session: adm, params: p, body })).json.error).toBe('DUPLICATE_CODE');
    expect((await callRoute(masterPost, { url: m('posts'), session: adm, params: p, body: { ...body, code: 'L4', factoryId: other.factoryId } })).json.error).toBe('BAD_INPUT');
  });

  test('표준 인원: 자리·제품 소속 검증, 중복 조합 거절, 하드 삭제', async () => {
    const { s, adm, other } = await setup();
    const p = { kind: 'standards' };
    const body = { postId: s.postIds[0], productId: s.productId, need: 3 };
    const c = await callRoute(masterPost, { url: m('standards'), session: adm, params: p, body });
    expect(c.status).toBe(200);
    expect((await callRoute(masterPost, { url: m('standards'), session: adm, params: p, body })).json.error).toBe('DUPLICATE_CODE');
    expect((await callRoute(masterPost, { url: m('standards'), session: adm, params: p, body: { ...body, postId: other.postIds[0] } })).json.error).toBe('BAD_INPUT');
    expect((await callRoute(masterPost, { url: m('standards'), session: adm, params: p, body: { ...body, productId: other.productId } })).json.error).toBe('BAD_INPUT');
    expect((await callRoute(masterDelete, { url: `${m('standards')}?id=${c.json.row.id}`, method: 'DELETE', session: adm, params: p })).json).toMatchObject({ ok: true });
    expect(await db.select().from(t.standards).where(eq(t.standards.companyId, s.companyId))).toHaveLength(0);
  });

  test('사용 중인 제품·자리는 비활성화, 미사용은 삭제, 공장은 IN_USE', async () => {
    const { s, adm } = await setup();
    const del = (kind: string, id: string) => callRoute(masterDelete, { url: `${m(kind)}?id=${id}`, method: 'DELETE', session: adm, params: { kind } });
    // product referenced by a standard -> soft
    await db.insert(t.standards).values({ companyId: s.companyId, postId: s.postIds[0], productId: s.productId, need: 2 });
    expect((await del('products', s.productId)).json).toMatchObject({ ok: true, softDeleted: true });
    expect((await db.select().from(t.products).where(eq(t.products.id, s.productId)))[0].active).toBe(false);
    // unreferenced product -> hard
    const np = await callRoute(masterPost, { url: m('products'), session: adm, params: { kind: 'products' }, body: { code: 'PX', name: 'x' } });
    const hard = (await del('products', np.json.row.id)).json;
    expect(hard.ok).toBe(true);
    expect(hard.softDeleted).toBeUndefined();
    expect(await db.select().from(t.products).where(eq(t.products.id, np.json.row.id))).toHaveLength(0);
    // post referenced by a skill -> soft; by a person's fixed post -> soft
    await db.insert(t.skills).values({ companyId: s.companyId, personId: s.personIds[0], postId: s.postIds[1], level: 1 });
    expect((await del('posts', s.postIds[1])).json).toMatchObject({ ok: true, softDeleted: true });
    await db.update(t.persons).set({ fixedPostId: s.postIds[2] }).where(eq(t.persons.id, s.personIds[1]));
    expect((await del('posts', s.postIds[2])).json).toMatchObject({ ok: true, softDeleted: true });
    // unreferenced post -> hard
    const nq = await callRoute(masterPost, { url: m('posts'), session: adm, params: { kind: 'posts' }, body: { factoryId: s.factoryId, code: 'Z9', name: 'z', kind: 'line' } });
    expect((await del('posts', nq.json.row.id)).json.softDeleted).toBeUndefined();
    expect(await db.select().from(t.posts).where(eq(t.posts.id, nq.json.row.id))).toHaveLength(0);
    // factory with posts/persons -> IN_USE
    expect(await del('factories', s.factoryId)).toMatchObject({ status: 400, json: { error: 'IN_USE' } });
    const nf = await callRoute(masterPost, { url: m('factories'), session: adm, params: { kind: 'factories' }, body: { code: 'F2', name: '2공장', cycleBaseDate: '2025-04-27', approval: 'draft-decide' } });
    expect(nf.status).toBe(200);
    expect((await del('factories', nf.json.row.id)).json.ok).toBe(true);
  });

  test('다른 회사 행 삭제·수정은 거절, 알 수 없는 kind는 400', async () => {
    const { adm, other } = await setup();
    expect((await callRoute(masterDelete, { url: `${m('products')}?id=${other.productId}`, method: 'DELETE', session: adm, params: { kind: 'products' } })).status).toBe(400);
    expect((await callRoute(masterPatch, { url: m('products'), method: 'PATCH', session: adm, params: { kind: 'products' }, body: { id: other.productId, name: 'x' } })).status).toBe(400);
    expect((await db.select().from(t.products).where(eq(t.products.id, other.productId)))[0].name).not.toBe('x');
    expect((await callRoute(masterGet, { url: m('nope'), session: adm, params: { kind: 'nope' } })).status).toBe(400);
  });
});

describe('settings', () => {
  const valid = {
    shiftDayStart: '07:00', shiftNightStart: '19:00', shiftCreditHours: 8, maxWeekHours: 52, warnWeekHours: 44, requestExpiryMin: 20,
    weights: { samePost: 15, sameProduct: 3, sameFactory: 1, roleMatch: 5, roleMismatch: 20, recentSub: 25 },
    skillRates: [0.3, 0.6, 0.9, 1],
  };
  const put = (session: Session, body: object) => callRoute(settingsPut, { url: `${U}/settings`, method: 'PUT', session, body });

  test('settings maxWeekHours 100 → BAD_INPUT, 잘못된 값 전부 거절, 유효하면 저장 + rev 증가', async () => {
    const { s, adm } = await setup();
    expect(await put(adm, { ...valid, maxWeekHours: 100 })).toMatchObject({ status: 400, json: { error: 'BAD_INPUT' } });
    const bad: object[] = [
      { shiftDayStart: '7:00' }, { shiftDayStart: '25:00' }, { shiftDayStart: '20:00' },
      { shiftCreditHours: 0 }, { shiftCreditHours: 13 }, { maxWeekHours: 39 }, { warnWeekHours: 60 }, { warnWeekHours: 0 },
      { requestExpiryMin: 4 }, { requestExpiryMin: 121 },
      { weights: { samePost: 1 } }, { weights: { ...valid.weights, samePost: -1 } },
      { skillRates: [0.3, 0.6, 0.9] }, { skillRates: [0.3, 0.6, 0.5, 1] }, { skillRates: [0.3, 0.6, 0.9, 1.5] },
    ];
    for (const b of bad) expect((await put(adm, { ...valid, ...b })).json.error, JSON.stringify(b)).toBe('BAD_INPUT');
    const rev0 = (await db.select().from(t.companies).where(eq(t.companies.id, s.companyId)))[0].rev;
    expect((await put(adm, { ...valid, maxWeekHours: 60 })).status).toBe(200);
    const got = await callRoute(settingsGet, { url: `${U}/settings`, session: adm });
    expect(got.json.settings).toMatchObject({ maxWeekHours: 60, requestExpiryMin: 20, skillRates: [0.3, 0.6, 0.9, 1] });
    expect((await db.select().from(t.companies).where(eq(t.companies.id, s.companyId)))[0].rev).toBe(rev0 + 1);
  });
});

describe('writes bump rev and guard access', () => {
  test('쓰기는 rev를 올린다', async () => {
    const { s, adm } = await setup();
    const rev = async () => (await db.select().from(t.companies).where(eq(t.companies.id, s.companyId)))[0].rev;
    const r0 = await rev();
    await callRoute(personsPost, { url: `${U}/persons`, session: adm, body: newPerson(s) });
    await callRoute(skillsPost, { url: `${U}/skills`, session: adm, body: { personId: s.personIds[0], postId: s.postIds[0], level: 2 } });
    await callRoute(masterPost, { url: `${U}/master/products`, session: adm, params: { kind: 'products' }, body: { code: 'RV', name: 'r' } });
    expect(await rev()).toBe(r0 + 3);
  });

  test('근무자 세션은 모든 관리자 API에서 403, 세션 없음은 401', async () => {
    const { s, wrk } = await setup();
    const id = s.personIds[0];
    const calls: [string, () => Promise<{ status: number }>][] = [
      ['persons GET', () => callRoute(personsGet, { url: `${U}/persons`, session: wrk })],
      ['persons POST', () => callRoute(personsPost, { url: `${U}/persons`, session: wrk, body: newPerson(s) })],
      ['person PATCH', () => callRoute(personPatch, { url: `${U}/persons/${id}`, method: 'PATCH', session: wrk, params: { id }, body: { name: 'x' } })],
      ['person action', () => callRoute(personAction, { url: `${U}/persons/${id}`, session: wrk, params: { id }, body: { action: 'retire' } })],
      ['person DELETE', () => callRoute(personDelete, { url: `${U}/persons/${id}`, method: 'DELETE', session: wrk, params: { id } })],
      ['skills', () => callRoute(skillsPost, { url: `${U}/skills`, session: wrk, body: { personId: id, postId: s.postIds[0], level: 3 } })],
      ['accounts GET', () => callRoute(accountsGet, { url: `${U}/accounts`, session: wrk })],
      ['accounts POST', () => callRoute(accountsPost, { url: `${U}/accounts`, session: wrk, body: { personId: id, action: 'unlock' } })],
      ['master GET', () => callRoute(masterGet, { url: `${U}/master/products`, session: wrk, params: { kind: 'products' } })],
      ['master POST', () => callRoute(masterPost, { url: `${U}/master/products`, session: wrk, params: { kind: 'products' }, body: { code: 'W', name: 'w' } })],
      ['master PATCH', () => callRoute(masterPatch, { url: `${U}/master/products`, method: 'PATCH', session: wrk, params: { kind: 'products' }, body: { id: s.productId, name: 'w' } })],
      ['master DELETE', () => callRoute(masterDelete, { url: `${U}/master/products?id=${s.productId}`, method: 'DELETE', session: wrk, params: { kind: 'products' } })],
      ['settings GET', () => callRoute(settingsGet, { url: `${U}/settings`, session: wrk })],
      ['settings PUT', () => callRoute(settingsPut, { url: `${U}/settings`, method: 'PUT', session: wrk, body: {} })],
    ];
    for (const [name, call] of calls) expect((await call()).status, name).toBe(403);
    expect((await callRoute(personsGet, { url: `${U}/persons` })).status).toBe(401);
    expect((await db.select().from(t.persons).where(eq(t.persons.id, id)))[0].active).toBe(true);
  });
});
