import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { GET as revGet } from '@/app/api/rev/route';
import { createAccount } from '@/server/auth/accounts';
import type { Session } from '@/server/auth/session';
import { setNowForTests } from '@/server/clock';
import { setDbForTests, type DB } from '@/server/db/client';
import * as t from '@/server/db/schema';
import { getRev } from '@/server/runAction';
import { callRoute } from '../helpers/http';
import { createTestDb, seedCompany, type Seeded } from '../helpers/testDb';

const URL = 'http://localhost/api/rev';
const EXPIRES = new Date('2026-11-10T00:50:00.000Z'); // 09:50 Seoul
const exp = Date.now() + 86_400_000;

let db: DB;
beforeAll(async () => {
  db = await createTestDb();
  setDbForTests(db);
});
afterAll(() => setDbForTests(null));
afterEach(() => setNowForTests(null));

/** An in-progress absence with one `sent` sub request expiring at 09:50 Seoul. */
async function sentRequest(s: Seeded): Promise<{ requestId: string; absenceId: string }> {
  const absenceId = randomUUID();
  await db.insert(t.absences).values({
    id: absenceId,
    companyId: s.companyId,
    date: '2026-11-10',
    shift: 'day',
    factoryId: s.factoryId,
    personId: s.personIds[0],
    postId: s.postIds[0],
    kind: 'absent',
    reportedBy: 'self',
    status: 'in-progress',
    round: 1,
    createdAt: new Date('2026-11-09T23:00:00.000Z'),
  });
  const requestId = randomUUID();
  await db.insert(t.subRequests).values({
    id: requestId,
    companyId: s.companyId,
    absenceId,
    personId: s.personIds[1],
    round: 1,
    rank: 1,
    status: 'sent',
    sentAt: new Date('2026-11-10T00:30:00.000Z'),
    expiresAt: EXPIRES,
  });
  return { requestId, absenceId };
}

async function session(s: Seeded): Promise<Session> {
  const admin = await createAccount(db, { companyId: s.companyId, kind: 'admin', loginId: 'admin', secret: 'pw-123456' });
  return { accountId: admin.id, companyId: s.companyId, kind: 'admin', personId: null, exp };
}

const statusOf = async (table: typeof t.subRequests | typeof t.absences, id: string) =>
  (await db.select({ status: table.status }).from(table).where(eq(table.id, id)))[0].status;

describe('GET /api/rev', () => {
  test('기한이 지난 sent 요청이 있으면 쓰기 없이도 만료 처리하고 rev를 올린다', async () => {
    const s = await seedCompany(db);
    const { requestId, absenceId } = await sentRequest(s);
    setNowForTests(new Date(EXPIRES.getTime() + 1000));

    const sess = await session(s);
    const r = await callRoute(revGet, { url: URL, session: sess });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ rev: 1 });
    expect(await statusOf(t.subRequests, requestId)).toBe('expired');
    expect(await statusOf(t.absences, absenceId)).toBe('failed');

    // nothing left to expire: the next poll does not bump again
    expect((await callRoute(revGet, { url: URL, session: sess })).json).toEqual({ rev: 1 });
  });

  test('아직 기한 전이면 아무것도 바꾸지 않고 rev도 그대로', async () => {
    const s = await seedCompany(db);
    const { requestId } = await sentRequest(s);
    setNowForTests(new Date(EXPIRES.getTime() - 60_000));

    const r = await callRoute(revGet, { url: URL, session: await session(s) });
    expect(r.json).toEqual({ rev: 0 });
    expect(await statusOf(t.subRequests, requestId)).toBe('sent');
    expect(await getRev(s.companyId, { db })).toBe(0);
  });
});
