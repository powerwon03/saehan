import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { GET as cronGet } from '@/app/api/cron/expire/route';
import { setNowForTests } from '@/server/clock';
import { setDbForTests, type DB } from '@/server/db/client';
import * as t from '@/server/db/schema';
import { getRev } from '@/server/runAction';
import { callRoute } from '../helpers/http';
import { createTestDb, seedCompany, type Seeded } from '../helpers/testDb';

const URL = 'http://localhost/api/cron/expire';
const SECRET = 'cron-test-secret-0123456789abcdef';
const NOW = new Date('2026-11-10T01:00:00.000Z'); // 10:00 Seoul, after the requests below expired (09:50)

let db: DB;
beforeAll(async () => {
  db = await createTestDb();
  setDbForTests(db);
});
afterAll(() => setDbForTests(null));
afterEach(() => {
  setNowForTests(null);
  delete process.env.CRON_SECRET;
});

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

/** An in-progress absence on 2026-11-10 with one `sent` sub request that expired at 09:50 Seoul. */
async function overdueRequest(s: Seeded): Promise<string> {
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
    expiresAt: new Date('2026-11-10T00:50:00.000Z'),
  });
  return requestId;
}

describe('GET /api/cron/expire', () => {
  test('CRON_SECRET 미설정 → 503 CRON_DISABLED (헤더가 있어도)', async () => {
    const r = await callRoute(cronGet, { method: 'GET', url: URL, headers: bearer('anything') });
    expect(r.status).toBe(503);
    expect(r.json).toEqual({ error: 'CRON_DISABLED' });
  });

  test('비밀 없이 호출 → 401', async () => {
    process.env.CRON_SECRET = SECRET;
    const none = await callRoute(cronGet, { method: 'GET', url: URL });
    expect(none.status).toBe(401);
    expect(none.json).toEqual({ error: 'UNAUTHENTICATED' });
    const wrong = await callRoute(cronGet, { method: 'GET', url: URL, headers: bearer(`${SECRET}x`) });
    expect(wrong.status).toBe(401);
    const noScheme = await callRoute(cronGet, { method: 'GET', url: URL, headers: { authorization: SECRET } });
    expect(noScheme.status).toBe(401);
  });

  test('만료된 sent 요청이 있는 회사 2곳 → 둘 다 expired 처리, 응답 expired 수 일치', async () => {
    process.env.CRON_SECRET = SECRET;
    setNowForTests(NOW);
    const a = await seedCompany(db);
    const b = await seedCompany(db);
    const quiet = await seedCompany(db);
    const reqA = await overdueRequest(a);
    const reqB = await overdueRequest(b);

    const r = await callRoute(cronGet, { method: 'GET', url: URL, headers: bearer(SECRET) });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ expired: 2 });

    for (const id of [reqA, reqB]) {
      const [row] = await db.select({ status: t.subRequests.status }).from(t.subRequests).where(eq(t.subRequests.id, id));
      expect(row.status).toBe('expired');
    }
    expect(await getRev(a.companyId, { db })).toBe(1);
    expect(await getRev(b.companyId, { db })).toBe(1);
    expect(await getRev(quiet.companyId, { db })).toBe(0);

    // nothing left to expire: a second run changes nothing
    const again = await callRoute(cronGet, { method: 'GET', url: URL, headers: bearer(SECRET) });
    expect(again.json).toEqual({ expired: 0 });
  });
});
