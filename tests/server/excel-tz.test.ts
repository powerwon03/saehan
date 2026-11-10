// Excel date cells must not shift with the server time zone (KST in production): set before any Date is created.
process.env.TZ = process.env.EXCEL_TEST_TZ ?? 'Asia/Seoul';

import { and, eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { POST as importPost } from '@/app/api/admin/import/route';
import { createAccount } from '@/server/auth/accounts';
import type { Session } from '@/server/auth/session';
import { setDbForTests, type DB } from '@/server/db/client';
import * as t from '@/server/db/schema';
import { callRoute } from '../helpers/http';
import { createTestDb, seedCompany } from '../helpers/testDb';

let db: DB;
beforeAll(async () => {
  db = await createTestDb();
  setDbForTests(db);
});
afterAll(() => setDbForTests(null));

/** Header row via aoa, then the date cell replaced by a real Excel date: numeric serial + date number format. */
function dateSheet(aoa: unknown[][], col: string, serial: number): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa as never);
  ws[`${col}2`] = { t: 'n', v: serial, z: 'yyyy-mm-dd' };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'S');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
const send = (adm: Session, buf: Buffer) => {
  const f = new FormData();
  f.set('file', new File([new Uint8Array(buf)], 'in.xlsx'));
  f.set('mode', 'commit');
  return callRoute(importPost, { url: 'http://localhost/api/admin/import', session: adm, body: f });
};

test(`엑셀 날짜 셀(일련번호 45779)은 서버 시간대(${process.env.TZ})와 무관하게 2025-05-02`, async () => {
  const s = await seedCompany(db);
  const a = await createAccount(db, { companyId: s.companyId, kind: 'admin', loginId: 'admin', secret: 'pw-123456' });
  const adm: Session = { accountId: a.id, companyId: s.companyId, kind: 'admin', personId: null, exp: Date.now() + 86_400_000 };

  const roster = [['사번', '이름', '조', '공장', '입사일'], ['5001', '날짜', 'A', '1공장', 'x']];
  expect((await send(adm, dateSheet(roster, 'E', 45779))).json.counts).toMatchObject({ add: 1, error: 0 });
  const [p] = await db.select().from(t.persons).where(and(eq(t.persons.companyId, s.companyId), eq(t.persons.empNo, '5001')));
  expect(p.hiredAt).toBe('2025-05-02');

  const plan = [['날짜', '교대', '공장', '라인', '제품', '상태'], ['x', '주간', '1공장', 'L1', 'P1', '가동']];
  expect((await send(adm, dateSheet(plan, 'A', 45779))).json.counts).toMatchObject({ add: 1, error: 0 });
  const [c] = await db.select().from(t.planCells).where(eq(t.planCells.companyId, s.companyId));
  expect(c.date).toBe('2025-05-02');
});
