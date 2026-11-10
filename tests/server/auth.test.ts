import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EngineError } from '@/engine/types';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as logoutRoute } from '@/app/api/auth/logout/route';
import { POST as secretRoute } from '@/app/api/auth/secret/route';
import { GET as meRoute } from '@/app/api/me/route';
import { GET as revRoute } from '@/app/api/rev/route';
import { createAccount } from '@/server/auth/accounts';
import { requireAdmin, requireWorker, withApi } from '@/server/auth/guard';
import { hashSecret, verifySecret } from '@/server/auth/hash';
import { changeSecret, login } from '@/server/auth/login';
import { readSession, signSession, type Session } from '@/server/auth/session';
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

const NOW = new Date('2026-11-10T00:00:00Z');
const min = (n: number) => new Date(NOW.getTime() + n * 60_000);

async function workerSetup(mustChange = true, pin = '482917', opts: { empNo?: string } = {}) {
  const s = await seedCompany(db);
  const [co] = await db.select().from(t.companies).where(eq(t.companies.id, s.companyId));
  await createAccount(db, {
    companyId: s.companyId,
    kind: 'worker',
    loginId: opts.empNo ?? '1001',
    secret: pin,
    personId: s.personIds[0],
    mustChange,
  });
  return { s, code: co.code };
}
const wl = (code: string, secret: string, now = NOW, loginId = '1001') =>
  login(db, { companyCode: code, kind: 'worker', loginId, secret, now });
const accountOf = async (companyId: string) =>
  (await db.select().from(t.accounts).where(eq(t.accounts.companyId, companyId)))[0];

describe('hash', () => {
  test('scrypt 해시 검증 성공/실패', async () => {
    const h = await hashSecret('correct horse');
    expect(h).not.toContain('correct horse');
    expect(await verifySecret('correct horse', h)).toBe(true);
    expect(await verifySecret('wrong', h)).toBe(false);
    expect(await verifySecret('x', 'garbage')).toBe(false);
    expect(await hashSecret('correct horse')).not.toBe(h); // salted
  });
});

describe('session', () => {
  const base: Session = { accountId: 'a', companyId: 'c', kind: 'admin', personId: null, exp: NOW.getTime() + 1000 };
  test('서명 변조된 쿠키는 null, 만료된 세션은 null', () => {
    const tok = signSession(base);
    expect(readSession(tok, NOW)).toEqual(base);
    const [p, sig] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ ...base, kind: 'worker', exp: base.exp + 1e9 })).toString('base64url');
    expect(readSession(`${forged}.${sig}`, NOW)).toBeNull();
    expect(readSession(`${p}.${sig.slice(0, -2)}AA`, NOW)).toBeNull();
    expect(readSession('nodot', NOW)).toBeNull();
    expect(readSession(tok, new Date(base.exp))).toBeNull();
    expect(readSession(tok, new Date(base.exp + 1))).toBeNull();
  });
  test('SESSION_SECRET 32자 미만이면 throw (메시지에 값 미포함)', () => {
    const old = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'short-secret';
    try {
      expect(() => signSession(base)).toThrow();
      expect(() => signSession(base)).not.toThrow(/short-secret/);
    } finally {
      process.env.SESSION_SECRET = old;
    }
  });
});

describe('login', () => {
  test('성공: 세션·mustChange 반환', async () => {
    const { code, s } = await workerSetup();
    const r = await wl(code, '482917');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mustChange).toBe(true);
      expect(r.session).toMatchObject({
        companyId: s.companyId,
        kind: 'worker',
        personId: s.personIds[0],
        exp: NOW.getTime() + 30 * 86400_000,
      });
    }
  });

  test('5회 실패 → LOCKED, 올바른 PIN도 10분간 거부, 10분 뒤 성공하면 failed_count 0', async () => {
    const { code, s } = await workerSetup();
    for (let i = 0; i < 4; i++) expect(await wl(code, '000111')).toEqual({ ok: false, code: 'INVALID' });
    const fifth = await wl(code, '000111');
    expect(fifth).toMatchObject({ ok: false, code: 'LOCKED' });
    expect(fifth.ok === false && fifth.lockedUntil).toEqual(min(10));
    const locked = await wl(code, '482917', min(5));
    expect(locked).toMatchObject({ ok: false, code: 'LOCKED', lockedUntil: min(10) });
    expect((await accountOf(s.companyId)).failedCount).toBe(0);
    expect((await wl(code, '482917', min(10))).ok).toBe(true);
    const after = await accountOf(s.companyId);
    expect(after.failedCount).toBe(0);
    expect(after.lockedUntil).toBeNull();
    expect(after.lastLoginAt).toEqual(min(10));
  });

  test('성공하면 누적 실패 횟수 초기화', async () => {
    const { code, s } = await workerSetup();
    for (let i = 0; i < 3; i++) await wl(code, '000111');
    expect((await accountOf(s.companyId)).failedCount).toBe(3);
    expect((await wl(code, '482917')).ok).toBe(true);
    expect((await accountOf(s.companyId)).failedCount).toBe(0);
  });

  test('퇴사자 근무자 계정은 INVALID', async () => {
    const { code, s } = await workerSetup();
    await db.update(t.persons).set({ active: false }).where(eq(t.persons.id, s.personIds[0]));
    expect(await wl(code, '482917')).toEqual({ ok: false, code: 'INVALID' });
  });

  test('다른 회사 코드로는 같은 사번 로그인 불가', async () => {
    const a = await workerSetup(true, '482917');
    const b = await workerSetup(true, '739104');
    expect((await wl(a.code, '482917')).ok).toBe(true);
    expect((await wl(b.code, '739104')).ok).toBe(true);
    expect(await wl(b.code, '482917')).toEqual({ ok: false, code: 'INVALID' });
    expect(await wl(a.code, '739104')).toEqual({ ok: false, code: 'INVALID' });
    expect(await wl('no-such-company', '482917')).toEqual({ ok: false, code: 'INVALID' });
    expect(await wl(a.code, '482917', NOW, '9999')).toEqual({ ok: false, code: 'INVALID' });
  });

  test('동시 요청 폭주: 검증은 최대 5번, 잠금 유지, 늦은 정답도 LOCKED', async () => {
    const { code, s } = await workerSetup();
    const burst = await Promise.all([
      ...Array.from({ length: 20 }, () => wl(code, '000111')),
      wl(code, '482917'),
    ]);
    expect(burst.filter((r) => r.ok).length).toBe(0);
    expect(burst.filter((r) => !r.ok && r.code === 'INVALID').length).toBeLessThanOrEqual(4);
    const acc = await accountOf(s.companyId);
    expect(acc.lockedUntil).not.toBeNull();
    expect(acc.lockedUntil!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(await wl(code, '482917')).toMatchObject({ ok: false, code: 'LOCKED' });
  });

  test('잠금 중에는 성공 경로가 잠금을 지우지 못한다', async () => {
    const { code, s } = await workerSetup();
    for (let i = 0; i < 5; i++) await wl(code, '000111');
    const before = await accountOf(s.companyId);
    expect(await wl(code, '482917', min(1))).toMatchObject({ ok: false, code: 'LOCKED' });
    expect((await accountOf(s.companyId)).lockedUntil).toEqual(before.lockedUntil);
  });

  test('관리자 로그인은 kind가 일치해야 한다', async () => {
    const s = await seedCompany(db);
    const [co] = await db.select().from(t.companies).where(eq(t.companies.id, s.companyId));
    await createAccount(db, { companyId: s.companyId, kind: 'admin', loginId: 'boss', secret: 'longpassword' });
    const ok = await login(db, { companyCode: co.code, kind: 'admin', loginId: 'boss', secret: 'longpassword', now: NOW });
    expect(ok).toMatchObject({ ok: true, mustChange: false });
    const wrongKind = await login(db, { companyCode: co.code, kind: 'worker', loginId: 'boss', secret: 'longpassword', now: NOW });
    expect(wrongKind).toMatchObject({ ok: false, code: 'INVALID' });
  });
});

describe('changeSecret', () => {
  test('PIN 123456 / 111111 / 12345 거부, 482917 허용, 변경 후 mustChange false', async () => {
    const { code } = await workerSetup();
    const r = await wl(code, '482917');
    if (!r.ok) throw new Error('login failed');
    for (const bad of ['123456', '111111', '12345', '000000', '654321', 'abcdef', '1234567'])
      expect(await changeSecret(db, r.session, { current: '482917', next: bad })).toEqual({ ok: false, code: 'WEAK_SECRET' });
    expect(await changeSecret(db, r.session, { current: 'wrong1', next: '739104' })).toEqual({ ok: false, code: 'INVALID' });
    expect(await changeSecret(db, r.session, { current: '482917', next: '739104' })).toEqual({ ok: true });
    expect(await wl(code, '739104')).toMatchObject({ ok: true, mustChange: false });
    expect((await wl(code, '482917')).ok).toBe(false);
  });

  test('changeSecret도 current 오답 5회에 잠기고 이후 정답도 거부', async () => {
    const { code, s } = await workerSetup();
    const r = await wl(code, '482917');
    if (!r.ok) throw new Error('login failed');
    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => changeSecret(db, r.session, { current: '000111', next: '739104' })),
    );
    expect(results.filter((x) => !x.ok && x.code === 'INVALID').length).toBeLessThanOrEqual(4);
    expect(results.some((x) => x.ok)).toBe(false);
    expect(await changeSecret(db, r.session, { current: '482917', next: '739104' })).toMatchObject({ ok: false, code: 'LOCKED' });
    expect((await accountOf(s.companyId)).lockedUntil!.getTime()).toBeGreaterThan(now.getTime());
    expect((await wl(code, '482917', new Date())).ok).toBe(false);
  });

  test('관리자 비밀번호는 8자 이상', async () => {
    const s = await seedCompany(db);
    const acc = await createAccount(db, { companyId: s.companyId, kind: 'admin', loginId: 'a1', secret: 'longpassword' });
    const sess: Session = { accountId: acc.id, companyId: s.companyId, kind: 'admin', personId: null, exp: NOW.getTime() + 1e9 };
    expect(await changeSecret(db, sess, { current: 'longpassword', next: 'short' })).toEqual({ ok: false, code: 'WEAK_SECRET' });
    expect(await changeSecret(db, sess, { current: 'longpassword', next: 'eightchars' })).toEqual({ ok: true });
  });
});

describe('guards & routes', () => {
  const far = Date.now() + 1e10;
  const workerSession = async (s: { companyId: string; personIds: string[] }): Promise<Session> => ({
    accountId: (await accountOf(s.companyId)).id,
    companyId: s.companyId,
    kind: 'worker',
    personId: s.personIds[0],
    exp: far,
  });

  test('근무자 세션으로 /api/admin/* 호출 → 403', async () => {
    const { s } = await workerSetup(false);
    const worker = await workerSession(s);
    const adminRoute = withApi(async (req) => {
      await requireAdmin(req);
      return Response.json({ ok: true });
    });
    expect(await callRoute(adminRoute, { session: worker })).toMatchObject({ status: 403, json: { error: 'FORBIDDEN' } });
    expect(await callRoute(adminRoute)).toMatchObject({ status: 401, json: { error: 'UNAUTHENTICATED' } });
    const wRoute = withApi(async (req) => Response.json({ p: (await requireWorker(req)).personId }));
    expect((await callRoute(wRoute, { session: worker })).json).toEqual({ p: s.personIds[0] });
    expect((await callRoute(wRoute, { headers: { cookie: 'otl_session=abc.def' } })).status).toBe(401);
  });

  test('퇴사한 근무자의 기존 세션은 401', async () => {
    const { s } = await workerSetup(false);
    const worker = await workerSession(s);
    await db.update(t.persons).set({ active: false }).where(eq(t.persons.id, s.personIds[0]));
    const wRoute = withApi(async (req) => Response.json({ p: (await requireWorker(req)).personId }));
    expect((await callRoute(wRoute, { session: worker })).status).toBe(401);
  });

  test('서명은 유효하지만 계정과 companyId/personId가 다른 세션은 401', async () => {
    const { s } = await workerSetup(false);
    const other = await seedCompany(db);
    const good = await workerSession(s);
    const wRoute = withApi(async (req) => Response.json({ p: (await requireWorker(req)).personId }));
    expect((await callRoute(wRoute, { session: good })).status).toBe(200);
    expect((await callRoute(wRoute, { session: { ...good, companyId: other.companyId } })).status).toBe(401);
    expect((await callRoute(wRoute, { session: { ...good, personId: s.personIds[1] } })).status).toBe(401);
    expect((await callRoute(wRoute, { session: { ...good, personId: null } })).status).toBe(401);
  });

  test('must_change 근무자는 allowMustChange 없이는 403 MUST_CHANGE_PIN', async () => {
    const { s } = await workerSetup(true);
    const worker = await workerSession(s);
    const strict = withApi(async (req) => Response.json({ p: (await requireWorker(req)).personId }));
    const lenient = withApi(async (req) =>
      Response.json({ p: (await requireWorker(req, { allowMustChange: true })).personId }),
    );
    expect(await callRoute(strict, { session: worker })).toMatchObject({ status: 403, json: { error: 'MUST_CHANGE_PIN' } });
    expect((await callRoute(lenient, { session: worker })).status).toBe(200);
    // me / secret remain reachable
    expect((await callRoute(meRoute, { session: worker })).status).toBe(200);
  });

  test('withApi: EngineError → 400 code, zod → BAD_INPUT, 기타 → 500 (내부 메시지 비노출)', async () => {
    const eng = withApi(async () => {
      throw new EngineError('NO_SUCH', 'internal detail');
    });
    expect(await callRoute(eng)).toMatchObject({ status: 400, json: { error: 'NO_SUCH' } });
    const { z } = await import('zod');
    const zr = withApi(async () => {
      z.object({ a: z.string() }).parse({});
      return Response.json({});
    });
    expect(await callRoute(zr)).toMatchObject({ status: 400, json: { error: 'BAD_INPUT' } });
    const boom = withApi(async () => {
      throw new Error('db password=hunter2');
    });
    const orig = console.error;
    console.error = () => {};
    try {
      const r = await callRoute(boom);
      expect(r).toMatchObject({ status: 500, json: { error: 'INTERNAL' } });
      expect(JSON.stringify(r.json)).not.toContain('hunter2');
    } finally {
      console.error = orig;
    }
  });

  test('login/me/rev/secret/logout 라우트 흐름', async () => {
    const { code } = await workerSetup();
    const bad = await callRoute(loginRoute, { body: { company: code, kind: 'worker', loginId: '1001', secret: '000111' } });
    expect(bad).toMatchObject({ status: 401, json: { error: 'INVALID' } });
    expect(bad.setCookie).toBeNull();
    expect(await callRoute(loginRoute, { body: { kind: 'worker' } })).toMatchObject({
      status: 400,
      json: { error: 'BAD_INPUT' },
    });

    const ok = await callRoute(loginRoute, { body: { company: code, kind: 'worker', loginId: '1001', secret: '482917' } });
    expect(ok).toMatchObject({ status: 200, json: { ok: true, mustChange: true } });
    expect(ok.setCookie).toMatch(/^otl_session=[^;]+; .*HttpOnly/);
    expect(ok.setCookie).toMatch(/SameSite=Lax/);
    expect(ok.setCookie).toMatch(/Max-Age=2592000/);
    expect(ok.setCookie).toMatch(/Path=\//);
    const cookie = ok.setCookie!.split(';')[0];

    expect(await callRoute(meRoute, { headers: { cookie } })).toMatchObject({
      status: 200,
      json: { kind: 'worker', name: '근무자1', empNo: '1001', companyName: '테스트 회사', mustChange: true },
    });
    expect((await callRoute(meRoute)).status).toBe(401);
    expect(await callRoute(revRoute, { headers: { cookie } })).toMatchObject({ status: 200, json: { rev: 0 } });

    expect(await callRoute(secretRoute, { headers: { cookie }, body: { current: '482917', next: '111111' } })).toMatchObject({
      status: 400,
      json: { error: 'WEAK_SECRET' },
    });
    expect((await callRoute(secretRoute, { headers: { cookie }, body: { current: '482917', next: '739104' } })).status).toBe(200);
    expect((await callRoute(meRoute, { headers: { cookie } })).json.mustChange).toBe(false);

    const out = await callRoute(logoutRoute, { method: 'POST' });
    expect(out.status).toBe(200);
    expect(out.setCookie).toMatch(/^otl_session=;.*Max-Age=0/);
  });

  test('잠금 라우트 → 423 + lockedUntil', async () => {
    const { code } = await workerSetup();
    let r;
    for (let i = 0; i < 5; i++)
      r = await callRoute(loginRoute, { body: { company: code, kind: 'worker', loginId: '1001', secret: '000111' } });
    expect(r!.status).toBe(423);
    expect(r!.json.error).toBe('LOCKED');
    expect(typeof r!.json.lockedUntil).toBe('string');
  });
});
