import { and, eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { GET as attendanceGet } from '@/app/api/admin/export/attendance/route';
import { POST as importPost } from '@/app/api/admin/import/route';
import { GET as templateGet } from '@/app/api/admin/template/route';
import { createAccount } from '@/server/auth/accounts';
import type { Session } from '@/server/auth/session';
import { setNowForTests } from '@/server/clock';
import { setDbForTests, type DB } from '@/server/db/client';
import * as t from '@/server/db/schema';
import { MAX_BYTES, detectKind } from '@/server/excel/detect';
import { callRoute } from '../helpers/http';
import { createTestDb, seedCompany } from '../helpers/testDb';

let db: DB;
beforeAll(async () => {
  db = await createTestDb();
  setDbForTests(db);
});
afterAll(() => setDbForTests(null));
afterEach(() => setNowForTests(null));

const NOW = new Date('2025-05-10T03:00:00Z');
const exp = Date.now() + 86_400_000;
const U = 'http://localhost/api/admin';

async function setup() {
  setNowForTests(NOW);
  const s = await seedCompany(db);
  const admin = await createAccount(db, { companyId: s.companyId, kind: 'admin', loginId: 'admin', secret: 'pw-123456' });
  const adm: Session = { accountId: admin.id, companyId: s.companyId, kind: 'admin', personId: null, exp };
  const wacc = await createAccount(db, { companyId: s.companyId, kind: 'worker', loginId: '1001', secret: '482913', personId: s.personIds[0] });
  const wrk: Session = { accountId: wacc.id, companyId: s.companyId, kind: 'worker', personId: s.personIds[0], exp };
  return { s, adm, wrk };
}

const sheet = (aoa: unknown[][]): Buffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa as never, { cellDates: true }), 'S');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
const form = (buf: Buffer | Uint8Array, mode: string) => {
  const f = new FormData();
  f.set('file', new File([new Uint8Array(buf)], 'in.xlsx'));
  f.set('mode', mode);
  return f;
};
const upload = (adm: Session, aoa: unknown[][], mode: 'preview' | 'commit') =>
  callRoute(importPost, { url: `${U}/import`, session: adm, body: form(sheet(aoa), mode) });
const readRows = (buf: Buffer): unknown[][] => {
  const wb = XLSX.read(buf, { type: 'buffer' });
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
};

const ROSTER_H = ['사번', '이름', '소속', '조', '역할', '성별', '전화', '공장', '언어', '입사일', '퇴사일', '지정자리', 'L1', 'L2'];
const PLAN_H = ['날짜', '교대', '공장', '라인', '제품', '상태'];

describe('양식', () => {
  test('양식 받기 → 다시 올리면 detectKind가 같은 종류', async () => {
    const { adm } = await setup();
    for (const [type, kind] of [['roster', 'roster'], ['plan', 'plan']] as const) {
      const r = await callRoute(templateGet, { url: `${U}/template?type=${type}`, session: adm });
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(r.headers.get('content-disposition')).toBe(`attachment; filename="${type}-template.xlsx"`);
      const rows = readRows(r.body);
      expect(rows).toHaveLength(2);
      expect(detectKind(rows[0].map(String))).toBe(kind);
      const up = await callRoute(importPost, { url: `${U}/import`, session: adm, body: form(r.body, 'preview') });
      expect(up.json.kind).toBe(kind);
    }
    const roster = readRows((await callRoute(templateGet, { url: `${U}/template?type=roster`, session: adm })).body);
    expect(roster[0]).toEqual(expect.arrayContaining(['L1', 'L2', 'Q1']));
    expect(roster[1]).toEqual(expect.arrayContaining(['1007', '1공장']));
    const plan = readRows((await callRoute(templateGet, { url: `${U}/template?type=plan`, session: adm })).body);
    expect(plan[1]).toEqual(['2025-05-10', '주간', '1공장', 'L1', 'P1', '가동']);
    expect((await callRoute(templateGet, { url: `${U}/template?type=x`, session: adm })).status).toBe(400);
  });
});

describe('명단', () => {
  test('새 사번 add, 기존 사번 update(빈 칸은 유지), 숙련도·퇴사일 반영', async () => {
    const { s, adm } = await setup();
    await db.update(t.persons).set({ role: 'qc', phone: '010-1' }).where(eq(t.persons.id, s.personIds[0]));
    await db.insert(t.assignments).values({ companyId: s.companyId, date: '2025-05-12', shift: 'day', factoryId: s.factoryId, postId: s.postIds[0], personId: s.personIds[1], source: 'manual' });
    const aoa = [
      ROSTER_H,
      ['2001', '신입', '협력사', 'B', '', '여', '', '1공장', '베트남어', 45778, '', 'L2', 3, 0],
      ['1001', '개명', '', 'C', '', '', '', 'F1', '', '', '', '', 2, ''],
      ['1002', '근무자2', '', 'A', '', '', '', '1공장', '', '', '2025-05-11', '', '', ''],
    ];
    const pre = await upload(adm, aoa, 'preview');
    expect(pre.status).toBe(200);
    expect(pre.json).toMatchObject({ kind: 'roster', counts: { add: 1, update: 2, error: 0 } });
    expect(pre.json.rows.map((r: { row: number; action: string; key: string }) => [r.row, r.action, r.key])).toEqual([[2, 'add', '2001'], [3, 'update', '1001'], [4, 'update', '1002']]);
    expect(await db.select().from(t.persons).where(eq(t.persons.empNo, '2001'))).toHaveLength(0); // preview writes nothing

    const done = await upload(adm, aoa, 'commit');
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ ok: true, kind: 'roster', counts: { add: 1, update: 2, error: 0 } });

    const [np] = await db.select().from(t.persons).where(and(eq(t.persons.companyId, s.companyId), eq(t.persons.empNo, '2001')));
    expect(np).toMatchObject({ name: '신입', affiliation: 'partner', crew: 'B', gender: 'F', lang: 'vi', hiredAt: '2025-05-01', fixedPostId: s.postIds[1], active: true });
    const [acc] = await db.select().from(t.accounts).where(eq(t.accounts.personId, np.id));
    expect(acc).toMatchObject({ kind: 'worker', loginId: '2001', secretHash: '!', mustChange: true });
    const sk = await db.select().from(t.skills).where(eq(t.skills.personId, np.id));
    expect(sk.map((x) => [x.postId, x.level]).sort()).toEqual([[s.postIds[0], 3], [s.postIds[1], 0]].sort());

    const [p1] = await db.select().from(t.persons).where(eq(t.persons.id, s.personIds[0]));
    expect(p1).toMatchObject({ name: '개명', crew: 'C', role: 'qc', phone: '010-1', active: true });
    expect((await db.select().from(t.skills).where(eq(t.skills.personId, s.personIds[0])))[0]).toMatchObject({ postId: s.postIds[0], level: 2 });

    const [p2] = await db.select().from(t.persons).where(eq(t.persons.id, s.personIds[1]));
    expect(p2).toMatchObject({ active: false, leftAt: '2025-05-11' });
    expect(await db.select().from(t.assignments).where(eq(t.assignments.personId, s.personIds[1]))).toHaveLength(0);
  });

  test('사번 중복 행과 없는 공장 이름 행은 error, 나머지 commit 반영', async () => {
    const { s, adm } = await setup();
    const aoa = [
      ROSTER_H,
      ['3001', '가', '', 'A', '', '', '', '1공장', '', '', '', '', '', ''],
      ['3001', '중복', '', 'A', '', '', '', '1공장', '', '', '', '', '', ''],
      ['3002', '나', '', 'A', '', '', '', '없는공장', '', '', '', '', '', ''],
      ['3003', '다', '', 'A', '', '', '', '1공장', '', '', '', '', 4, ''],
      ['', '사번없음', '', 'A', '', '', '', '1공장', '', '', '', '', '', ''],
      ['3004', '라', '', 'A', '', '', '', '1공장', '', '', '', '', 1, ''],
    ];
    const pre = await upload(adm, aoa, 'preview');
    expect(pre.json.counts).toEqual({ add: 2, update: 0, error: 4 });
    const bad = pre.json.rows.filter((r: { action: string }) => r.action === 'error');
    expect(bad.map((r: { row: number }) => r.row)).toEqual([3, 4, 5, 6]);
    expect(bad.every((r: { errors: string[] }) => r.errors.length > 0)).toBe(true);

    const done = await upload(adm, aoa, 'commit');
    expect(done.json.counts).toEqual({ add: 2, update: 0, error: 4 });
    const all = await db.select().from(t.persons).where(eq(t.persons.companyId, s.companyId));
    expect(all.map((p) => p.empNo).filter((e) => e.startsWith('30')).sort()).toEqual(['3001', '3004']);
    expect(all.find((p) => p.empNo === '3001')!.name).toBe('가'); // first occurrence wins
  });
});

describe('생산계획', () => {
  test('없는 제품 코드 error, 정상 행만 plan_cells upsert (날짜는 일련번호·점 표기 모두)', async () => {
    const { s, adm } = await setup();
    await db.insert(t.planCells).values({ companyId: s.companyId, date: '2025-05-01', shift: 'day', postId: s.postIds[0], productId: null, status: 'off' });
    const aoa = [
      PLAN_H,
      [45778, '주간', '1공장', 'L1', 'P1', '가동'], // existing cell → update
      [45779, 'night', 'F1', 'L2', '', 'unmanned'], // 2025-05-02
      ['2025.05.03', '야간', '1공장', 'L1', 'NOPE', '가동'], // unknown product
      ['2025-05-03', '주간', '1공장', 'L1', 'P1', '가동'],
      ['2025-05-03', '주간', '1공장', 'L1', 'P1', '쉼'], // duplicate key
      ['2025-05-04', '주간', '1공장', 'L1', '', '쉼'],
      ['2025-05-04', '주간', '1공장', 'ZZ', '', '쉼'], // unknown line
    ];
    const pre = await upload(adm, aoa, 'preview');
    expect(pre.json).toMatchObject({ kind: 'plan', counts: { add: 3, update: 1, error: 3 } });
    expect(pre.json.rows[0]).toMatchObject({ row: 2, action: 'update', key: '2025-05-01/주간/1공장/L1' });

    const done = await upload(adm, aoa, 'commit');
    expect(done.json.counts).toEqual({ add: 3, update: 1, error: 3 });
    const cells = await db.select().from(t.planCells).where(eq(t.planCells.companyId, s.companyId));
    const get = (d: string, sh: string, post: number) => cells.find((c) => c.date === d && c.shift === sh && c.postId === s.postIds[post]);
    // 05-01 day had its own cell; 05-02 night, 05-03 day and 05-04 day each materialise all 3 posts first
    expect(pre.json.inherited).toBe(6);
    expect(cells).toHaveLength(10);
    expect(get('2025-05-01', 'day', 0)).toMatchObject({ productId: s.productId, status: 'run' });
    expect(get('2025-05-01', 'day', 1)).toBeUndefined();
    expect(get('2025-05-02', 'night', 1)).toMatchObject({ productId: null, status: 'unmanned' });
    expect(get('2025-05-02', 'night', 0)).toMatchObject({ productId: null, status: 'run' });
    expect(get('2025-05-03', 'day', 0)).toMatchObject({ productId: s.productId, status: 'run' });
    expect(get('2025-05-04', 'day', 0)).toMatchObject({ productId: null, status: 'off' });
    expect(get('2025-05-04', 'day', 1)).toMatchObject({ productId: null, status: 'run' });
    expect(get('2025-05-03', 'night', 0)).toBeUndefined();
  });

  test('일부 라인만 올려도 나머지 라인은 직전 계획을 그대로 이어 쓴다', async () => {
    const { s, adm } = await setup();
    // yesterday: L1, Q1 run P1 and L2 off
    await db.insert(t.planCells).values([
      { companyId: s.companyId, date: '2025-05-09', shift: 'day', postId: s.postIds[0], productId: s.productId, status: 'run' },
      { companyId: s.companyId, date: '2025-05-09', shift: 'day', postId: s.postIds[1], productId: null, status: 'off' },
      { companyId: s.companyId, date: '2025-05-09', shift: 'day', postId: s.postIds[2], productId: s.productId, status: 'run' },
    ]);
    const aoa = [PLAN_H, ['2025-05-10', '주간', '1공장', 'L1', '', '쉼']];

    const pre = await upload(adm, aoa, 'preview');
    expect(pre.json).toMatchObject({ kind: 'plan', counts: { add: 1, update: 0, error: 0 }, inherited: 2 });

    expect((await upload(adm, aoa, 'commit')).json.counts).toEqual({ add: 1, update: 0, error: 0 });
    const today = await db
      .select()
      .from(t.planCells)
      .where(and(eq(t.planCells.companyId, s.companyId), eq(t.planCells.date, '2025-05-10')));
    const get = (post: number) => today.find((c) => c.postId === s.postIds[post]);
    expect(today).toHaveLength(3);
    expect(get(0)).toMatchObject({ shift: 'day', productId: null, status: 'off' });
    expect(get(1)).toMatchObject({ shift: 'day', productId: null, status: 'off' });
    expect(get(2)).toMatchObject({ shift: 'day', productId: s.productId, status: 'run' });
  });

  test('쉼·무인 행은 그 날짜·교대·라인의 배치를 지운다 (고정 배치 포함)', async () => {
    const { s, adm } = await setup();
    const asg = (postIdx: number, personIdx: number, locked: boolean) => ({
      companyId: s.companyId,
      date: '2025-05-10',
      shift: 'day' as const,
      factoryId: s.factoryId,
      postId: s.postIds[postIdx],
      personId: s.personIds[personIdx],
      source: 'manual' as const,
      locked,
    });
    await db.insert(t.assignments).values([asg(0, 0, true), asg(1, 1, false), asg(1, 2, true)]);
    const aoa = [PLAN_H, ['2025-05-10', '주간', '1공장', 'L1', '', '쉼'], ['2025-05-10', '주간', '1공장', 'L2', 'P1', '가동']];
    expect((await upload(adm, aoa, 'commit')).status).toBe(200);
    const left = await db.select().from(t.assignments).where(eq(t.assignments.companyId, s.companyId));
    expect(left.map((a) => a.personId).sort()).toEqual([s.personIds[1], s.personIds[2]].sort());

    await upload(adm, [PLAN_H, ['2025-05-10', '주간', '1공장', 'L2', '', '무인']], 'commit');
    expect(await db.select().from(t.assignments).where(eq(t.assignments.companyId, s.companyId))).toHaveLength(0);
  });
});

describe('형식 검사', () => {
  test('모르는 양식은 sample 반환, commit 시 UNKNOWN_FORMAT', async () => {
    const { s, adm } = await setup();
    const aoa = Array.from({ length: 15 }, (_, i) => [`열${i}`, i, '값']);
    const pre = await upload(adm, aoa, 'preview');
    expect(pre.status).toBe(200);
    expect(pre.json.kind).toBe('unknown');
    expect(pre.json.sample).toHaveLength(10);
    expect(pre.json.sample[0]).toEqual(['열0', '0', '값']);
    expect(await upload(adm, aoa, 'commit')).toMatchObject({ status: 400, json: { error: 'UNKNOWN_FORMAT' } });
    expect(await db.select().from(t.persons).where(eq(t.persons.companyId, s.companyId))).toHaveLength(6);
  });

  test('4MB 초과 업로드(Vercel 본문 한도 4.5MB 아래)와 파일 없음은 400', async () => {
    expect(MAX_BYTES).toBe(4 * 1024 * 1024);
    const { adm } = await setup();
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    expect(await callRoute(importPost, { url: `${U}/import`, session: adm, body: form(big, 'preview') })).toMatchObject({ status: 400, json: { error: 'BAD_INPUT' } });
    const none = new FormData();
    none.set('mode', 'preview');
    expect((await callRoute(importPost, { url: `${U}/import`, session: adm, body: none })).status).toBe(400);
    const badMode = form(sheet([PLAN_H]), 'nope');
    expect((await callRoute(importPost, { url: `${U}/import`, session: adm, body: badMode })).status).toBe(400);
  });
});

describe('근태표', () => {
  test('정규 주간 근무 칸 "주", 대체 투입 "대", 결근 "결"', async () => {
    const { s, adm } = await setup();
    // 1001 crew A (day 04-27..30, night 05-03..06): absent 04-28. 1003 crew B (off 04-29): sub placement 04-29.
    await db.insert(t.absences).values({ companyId: s.companyId, date: '2025-04-28', shift: 'day', factoryId: s.factoryId, personId: s.personIds[0], kind: 'absent', reportedBy: 'leader', status: 'decided' });
    await db.insert(t.assignments).values({ companyId: s.companyId, date: '2025-04-29', shift: 'day', factoryId: s.factoryId, postId: s.postIds[0], personId: s.personIds[2], source: 'sub' });
    await db.update(t.persons).set({ active: false, leftAt: '2025-03-01' }).where(eq(t.persons.id, s.personIds[5])); // left before the month
    await db.update(t.persons).set({ active: false, leftAt: '2025-04-15' }).where(eq(t.persons.id, s.personIds[4])); // left inside the month

    const r = await callRoute(attendanceGet, { url: `${U}/export/attendance?month=2025-04`, session: adm });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="attendance-2025-04.xlsx"');
    const rows = readRows(r.body);
    expect(rows[0].slice(0, 5)).toEqual(['사번', '이름', '공장', '조', '1']);
    expect(rows[0].slice(-5)).toEqual(['30', '주간', '야간', '대체', '결근']);
    expect(rows.slice(1).map((x) => x[0])).toEqual(['1001', '1002', '1003', '1004', '1005']);
    const cell = (emp: string, day: number) => rows.find((x) => x[0] === emp)![3 + day];
    expect(cell('1001', 27)).toBe('주');
    expect(cell('1001', 28)).toBe('결');
    expect(cell('1001', 29)).toBe('주');
    expect(cell('1001', 26)).toBe('휴');
    expect(cell('1003', 27)).toBe('야');
    expect(cell('1003', 29)).toBe('대');
    expect(cell('1005', 20)).toBe(''); // after leftAt

    const row = rows.find((x) => x[0] === '1001')!;
    const tail = row.slice(-4) as number[];
    const cells = row.slice(4, -4);
    expect(tail).toEqual([cells.filter((c) => c === '주').length, cells.filter((c) => c === '야').length, 0, 1]);
    expect(tail[0]).toBeGreaterThan(0);
    const r3 = rows.find((x) => x[0] === '1003')!;
    expect((r3.slice(-4) as number[])[2]).toBe(1);
    // '대' counts toward 주간 as well: the day-shift sub on the 29th
    expect((r3.slice(-4) as number[])[0]).toBe(r3.slice(4, -4).filter((c) => c === '주').length + 1);
  });

  test('오늘 이후 날짜는 빈 칸, 잘못된 month는 400', async () => {
    const { adm } = await setup(); // today = 2025-05-10
    const rows = readRows((await callRoute(attendanceGet, { url: `${U}/export/attendance?month=2025-05`, session: adm })).body);
    const row = rows.find((x) => x[0] === '1001')!;
    expect(rows[0]).toHaveLength(4 + 31 + 4);
    expect(row[3 + 10]).not.toBe('');
    expect(row[3 + 11]).toBe('');
    expect(row[3 + 31]).toBe('');
    for (const m of ['2025-5', '2025-13', 'abc']) expect((await callRoute(attendanceGet, { url: `${U}/export/attendance?month=${m}`, session: adm })).status).toBe(400);
    expect((await callRoute(attendanceGet, { url: `${U}/export/attendance`, session: adm })).status).toBe(400);
  });
});

describe('경계·격리·롤백', () => {
  test('데이터 5001행은 400 BAD_INPUT, 5000행은 통과', async () => {
    const { adm } = await setup();
    const rows = (n: number) => [PLAN_H, ...Array.from({ length: n }, () => ['2025-05-01', '주간', '1공장', 'L1', 'P1', '가동'])];
    expect(await upload(adm, rows(5001), 'preview')).toMatchObject({ status: 400, json: { error: 'BAD_INPUT' } });
    expect((await upload(adm, rows(5000), 'preview')).status).toBe(200);
  });

  test('xlsx가 아닌 임의 바이트는 500이 아니다(400 또는 unknown), 아무것도 쓰지 않는다', async () => {
    const { s, adm } = await setup();
    const junk = new Uint8Array(2048).map((_, i) => (i * 131 + 7) % 256);
    for (const mode of ['preview', 'commit']) {
      const r = await callRoute(importPost, { url: `${U}/import`, session: adm, body: form(junk, mode) });
      expect(r.status, mode).not.toBe(500);
      expect([200, 400]).toContain(r.status);
      if (r.status === 200) expect(r.json.kind).toBe('unknown');
      else expect(['BAD_INPUT', 'UNKNOWN_FORMAT']).toContain(r.json.error);
    }
    expect(await db.select().from(t.persons).where(eq(t.persons.companyId, s.companyId))).toHaveLength(6);
  });

  test('다른 회사에만 있는 사번은 이 회사에서 add, 다른 회사 사람은 그대로', async () => {
    const { s, adm } = await setup();
    const other = await seedCompany(db);
    // company A has no empNo 9001; give B one
    await db.update(t.persons).set({ empNo: '9001' }).where(eq(t.persons.id, other.personIds[0]));
    const bRow = (await db.select().from(t.persons).where(eq(t.persons.id, other.personIds[0])))[0];
    const aoa2 = [ROSTER_H, ['9001', '에이사람', '', 'A', '', '', '', '1공장', '', '', '', '', '', '']];
    const pre = await upload(adm, aoa2, 'preview');
    expect(pre.json.counts).toEqual({ add: 1, update: 0, error: 0 });
    expect((await upload(adm, aoa2, 'commit')).json.counts).toEqual({ add: 1, update: 0, error: 0 });
    expect((await db.select().from(t.persons).where(eq(t.persons.id, other.personIds[0])))[0]).toEqual(bRow);
    const a = await db.select().from(t.persons).where(and(eq(t.persons.companyId, s.companyId), eq(t.persons.empNo, '9001')));
    expect(a).toHaveLength(1);
    expect(a[0].factoryId).toBe(s.factoryId);
  });

  test('commit 도중 두 번째 쓰기가 DB 제약으로 실패하면 첫 번째도 롤백', async () => {
    const { s, adm } = await setup();
    // a pre-existing account with login id 7002 (no person) makes the 2nd row's account insert violate accounts_company_kind_login_uq
    await createAccount(db, { companyId: s.companyId, kind: 'worker', loginId: '7002', secret: '482913' });
    const aoa = [
      ROSTER_H,
      ['7001', '첫째', '', 'A', '', '', '', '1공장', '', '', '', '', 3, ''],
      ['7002', '둘째', '', 'A', '', '', '', '1공장', '', '', '', '', '', ''],
    ];
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {}); // withApi logs the unhandled error
    const r = await upload(adm, aoa, 'commit');
    quiet.mockRestore();
    expect(r.status).toBe(500);
    expect(await db.select().from(t.persons).where(and(eq(t.persons.companyId, s.companyId), eq(t.persons.empNo, '7001')))).toHaveLength(0);
    expect(await db.select().from(t.persons).where(eq(t.persons.companyId, s.companyId))).toHaveLength(6);
    expect(await db.select().from(t.skills).where(eq(t.skills.companyId, s.companyId))).toHaveLength(0);
  });
});

describe('권한', () => {
  test('근무자 세션은 세 경로 모두 403, 세션 없으면 401', async () => {
    const { wrk } = await setup();
    const calls: [string, () => Promise<{ status: number }>][] = [
      ['import', () => callRoute(importPost, { url: `${U}/import`, session: wrk, body: form(sheet([PLAN_H]), 'preview') })],
      ['template', () => callRoute(templateGet, { url: `${U}/template?type=roster`, session: wrk })],
      ['attendance', () => callRoute(attendanceGet, { url: `${U}/export/attendance?month=2025-04`, session: wrk })],
    ];
    for (const [name, call] of calls) expect((await call()).status, name).toBe(403);
    expect((await callRoute(templateGet, { url: `${U}/template?type=roster` })).status).toBe(401);
  });
});
