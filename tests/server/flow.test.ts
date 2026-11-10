import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, test } from 'vitest';
import { reportAbsence, requestSubs, respondSub } from '@/engine/absence';
import { autoAssign } from '@/engine/autoAssign';
import { confirmBoard } from '@/engine/board';
import { addDays } from '@/engine/dates';
import { recommendFor } from '@/engine/recommend';
import { shiftWindow } from '@/engine/time';
import { EngineError, type DateStr, type Shift, type Snapshot } from '@/engine/types';
import { shiftsWorked, weekHours } from '@/engine/worklog';
import { login } from '@/server/auth/login';
import type { DB } from '@/server/db/client';
import * as t from '@/server/db/schema';
import { loadSnapshot } from '@/server/repo/snapshot';
import { runAction } from '@/server/runAction';
import { createCompany } from '@/server/seed/createCompany';
import { seedDemo } from '@/server/seed/demoData';
import { createTestDb } from '../helpers/testDb';

const START: DateStr = '2026-11-09';
const DAYS = 6;
const PIN = '482915';
const ADMIN_PW = 'demo-admin-pw';

let db: DB;
let companyId: string;
beforeAll(async () => {
  db = await createTestDb();
  ({ companyId } = await seedDemo(db, { code: 'demo', pin: PIN, adminPassword: ADMIN_PW, seed: 7 }));
}, 60_000);

async function assertNoDuplicates() {
  const rows = await db.select().from(t.assignments).where(eq(t.assignments.companyId, companyId));
  const keys = rows.map((a) => `${a.date}|${a.shift}|${a.personId}`);
  expect(new Set(keys).size).toBe(keys.length);
}

/** A sub never breaks canWorkExtra's rules: no night the day before a day sub, no day after a night sub, week <= max. */
function assertSubRules(snap: Snapshot, personId: string, date: DateStr, shift: Shift) {
  const other = shift === 'day' ? addDays(date, -1) : addDays(date, 1);
  const forbidden: Shift = shift === 'day' ? 'night' : 'day';
  expect(shiftsWorked(snap, personId, other, other).some((w) => w.shift === forbidden)).toBe(false);
  expect(weekHours(snap, personId, date)).toBeLessThanOrEqual(snap.settings.maxWeekHours);
}

describe('6일 연속 흐름', () => {
  test('매일 주간·야간 × 2공장: 계획→자동 배치→확정→결근 1건→3명 동시 요청→1명 수락→해결', async () => {
    let resolved = 0;
    for (let i = 0; i < DAYS; i++) {
      const date = addDays(START, i);
      for (const shift of ['day', 'night'] as const) {
        const factoryIds = (await loadSnapshot(db, companyId, date)).factories.map((f) => f.id);
        expect(factoryIds).toHaveLength(2);
        for (const factoryId of factoryIds) {
          await runAction(companyId, date, (snap, ctx) => autoAssign(snap, factoryId, date, shift, ctx), { db });
          await runAction(companyId, date, (snap, ctx) => confirmBoard(snap, { factoryId, date, shift }, ctx), { db });
          await assertNoDuplicates();

          let snap = await loadSnapshot(db, companyId, date);
          const linePosts = new Set(snap.posts.filter((p) => p.factoryId === factoryId && p.kind === 'line').map((p) => p.id));
          const target = snap.assignments.find(
            (a) => a.factoryId === factoryId && a.date === date && a.shift === shift && linePosts.has(a.postId),
          );
          expect(target, `${date} ${shift} ${factoryId} has a line worker`).toBeDefined();
          if (!target) continue;

          const now = new Date(shiftWindow(date, shift, snap.settings).start.getTime() - 3_600_000);
          await runAction(
            companyId,
            date,
            (s, ctx) => reportAbsence(s, { personId: target.personId, date, shift, kind: 'absent', reportedBy: 'leader' }, ctx),
            { db, now },
          );
          snap = await loadSnapshot(db, companyId, date);
          const absence = snap.absences.find((a) => a.personId === target.personId && a.date === date && a.shift === shift)!;
          expect(absence.status).toBe('decided');
          await assertNoDuplicates();

          const picks = recommendFor(snap, { factoryId, date, shift, postId: target.postId, gender: null })
            .filter((c) => c.kind === 'rest')
            .slice(0, 3)
            .map((c) => c.personId);
          expect(picks).toHaveLength(3);
          await runAction(companyId, date, (s, ctx) => requestSubs(s, { absenceId: absence.id, personIds: picks }, ctx), { db, now });

          snap = await loadSnapshot(db, companyId, date);
          const sent = snap.subRequests.filter((r) => r.absenceId === absence.id && r.status === 'sent');
          expect(sent).toHaveLength(3);
          const first = sent.find((r) => r.personId === picks[0])!;
          const outcome = await runAction(
            companyId,
            date,
            (s, ctx) => {
              const r = respondSub(s, { requestId: first.id, personId: first.personId, accept: true }, ctx);
              return { changes: r.changes, result: r.outcome };
            },
            { db, now: new Date(now.getTime() + 60_000) },
          );
          expect(outcome).toBe('accepted');

          snap = await loadSnapshot(db, companyId, date);
          const done = snap.absences.find((a) => a.id === absence.id)!;
          expect(done.status).toBe('resolved');
          expect(done.resolvedPersonId).toBe(picks[0]);
          const sub = snap.assignments.filter((a) => a.date === date && a.shift === shift && a.personId === picks[0]);
          expect(sub).toHaveLength(1);
          expect(sub[0]).toMatchObject({ postId: target.postId, source: 'sub' });
          const requests = snap.subRequests.filter((r) => r.absenceId === absence.id);
          expect(requests.filter((r) => r.status === 'accepted')).toHaveLength(1);
          expect(requests.filter((r) => r.status === 'cancelled')).toHaveLength(2);
          assertSubRules(snap, picks[0], date, shift);
          await assertNoDuplicates();
          resolved++;
        }
      }
    }
    expect(resolved).toBe(DAYS * 2 * 2);
  }, 180_000);
});

describe('회사·시드 스크립트', () => {
  test('createCompany 후 관리자 로그인 성공', async () => {
    const { companyId: id } = await createCompany(db, { code: 'acme-1', name: '에이씨엠이', adminId: 'boss', adminPassword: 'long-enough-pw' });
    const ok = await login(db, { companyCode: 'acme-1', kind: 'admin', loginId: 'boss', secret: 'long-enough-pw' });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.session).toMatchObject({ companyId: id, kind: 'admin', personId: null });
      expect(ok.mustChange).toBe(false);
    }
    const [s] = await db.select().from(t.settings).where(eq(t.settings.companyId, id));
    expect(s).toMatchObject({ shiftDayStart: '07:00', maxWeekHours: 52, requestExpiryMin: 20 });
    expect(await db.select().from(t.factories).where(eq(t.factories.companyId, id))).toHaveLength(0);
    const bad = await login(db, { companyCode: 'acme-1', kind: 'admin', loginId: 'boss', secret: 'wrong-password' });
    expect(bad).toMatchObject({ ok: false, code: 'INVALID' });
  });

  test('createCompany 입력 검증: 코드 형식 BAD_INPUT, 짧은 비밀번호 WEAK_SECRET, 중복 DUPLICATE_CODE', async () => {
    const base = { name: '회사', adminId: 'a', adminPassword: 'long-enough-pw' };
    await expect(createCompany(db, { ...base, code: 'Bad Code' })).rejects.toMatchObject({ code: 'BAD_INPUT' });
    await expect(createCompany(db, { ...base, code: 'x' })).rejects.toMatchObject({ code: 'BAD_INPUT' });
    await expect(createCompany(db, { ...base, code: 'short-pw', adminPassword: '1234567' })).rejects.toMatchObject({ code: 'WEAK_SECRET' });
    await createCompany(db, { ...base, code: 'dup-co' });
    await expect(createCompany(db, { ...base, code: 'dup-co' })).rejects.toMatchObject({ code: 'DUPLICATE_CODE' });
    await expect(createCompany(db, { ...base, code: 'dup-co' })).rejects.toBeInstanceOf(EngineError);
  });

  test('seedDemo: 규모·언어 분포·결정성, 재실행은 DUPLICATE_CODE, reset은 demo만', async () => {
    const snap = await loadSnapshot(db, companyId, START);
    expect(snap.persons).toHaveLength(120);
    expect(snap.factories.map((f) => f.code)).toEqual(['F1', 'F2']);
    expect(snap.products).toHaveLength(7);
    const f1 = snap.factories[0].id;
    const f2 = snap.factories[1].id;
    expect(snap.persons.filter((p) => p.factoryId === f1)).toHaveLength(72);
    expect(snap.persons.filter((p) => p.factoryId === f2)).toHaveLength(48);
    const postsOf = (f: string) => snap.posts.filter((p) => p.factoryId === f);
    expect(postsOf(f1).map((p) => p.code)).toEqual(expect.arrayContaining(['L-1', 'L-8', 'OP', 'BOX']));
    expect(postsOf(f2).some((p) => p.code === 'BOX')).toBe(false);
    expect(postsOf(f2).filter((p) => p.unmanned).map((p) => p.code).sort()).toEqual(['P-1', 'P-2']);
    const need = (code: string) => postsOf(f2).find((p) => p.code === code)!.defaultNeed;
    expect([need('S-1'), need('S-2'), need('S-6')]).toEqual([2, 1, 2]);
    const langs = new Map<string, number>();
    for (const p of snap.persons) langs.set(p.lang, (langs.get(p.lang) ?? 0) + 1);
    expect(langs.get('ko')!).toBeGreaterThan(langs.get('vi')!);
    expect([...langs.keys()].sort()).toEqual(['en', 'ko', 'mn', 'vi']);
    const accounts = await db.select().from(t.accounts).where(eq(t.accounts.companyId, companyId));
    expect(accounts.filter((a) => a.kind === 'worker' && a.mustChange)).toHaveLength(120);
    expect(accounts.filter((a) => a.kind === 'admin')).toHaveLength(1);

    await expect(seedDemo(db, { code: 'demo', pin: PIN, adminPassword: ADMIN_PW })).rejects.toMatchObject({ code: 'DUPLICATE_CODE' });
    await expect(seedDemo(db, { code: 'other', pin: PIN, adminPassword: ADMIN_PW, reset: true })).rejects.toMatchObject({ code: 'BAD_INPUT' });
    await expect(seedDemo(db, { code: 'demo2', pin: '123456', adminPassword: ADMIN_PW })).rejects.toMatchObject({ code: 'WEAK_SECRET' });

    const db2 = await createTestDb();
    const again = await seedDemo(db2, { code: 'demo', pin: PIN, adminPassword: ADMIN_PW, seed: 7 });
    const snap2 = await loadSnapshot(db2, again.companyId, START);
    const view = (s: Snapshot) => s.persons.map((p) => [p.empNo, p.name, p.crew, p.lang, p.gender, p.affiliation, p.role, p.phone].join('|'));
    expect(view(snap2)).toEqual(view(snap));
  });

  test('seedDemo reset: demo 회사를 지우고 다시 만든다', async () => {
    const db3 = await createTestDb();
    const first = await seedDemo(db3, { code: 'demo', pin: PIN, adminPassword: ADMIN_PW, seed: 1 });
    const second = await seedDemo(db3, { code: 'demo', pin: PIN, adminPassword: ADMIN_PW, seed: 2, reset: true });
    expect(second.companyId).not.toBe(first.companyId);
    expect(await db3.select().from(t.companies)).toHaveLength(1);
    expect(await db3.select().from(t.persons)).toHaveLength(120);
  });
});
