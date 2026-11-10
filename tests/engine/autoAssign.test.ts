import { describe, expect, test } from 'vitest';
import { autoAssign, flagsFor, placementScore, rosterFor } from '@/engine/autoAssign';
import type { Absence, Assignment, Changes, Snapshot } from '@/engine/types';
import { COMPANY, ctxAt, makePerson, makePost, makeSnapshot } from '../helpers/fixtures';

// 2026-04-22: crew A = day, crew B = night, crew C = off, crew D (Wed) = day.
const D = '2026-04-22';
const ctx = () => ctxAt('2026-04-21T09:00:00+09:00');

const day = (id: string, over: Partial<Parameters<typeof makePerson>[0]> = {}) =>
  makePerson({ id, empNo: id, crew: 'A', ...over });
const line = (id: string, sort: number, over: Partial<Parameters<typeof makePost>[0]> = {}) =>
  makePost({ id, code: id, kind: 'line', sort, defaultNeed: 1, ...over });
const asg = (over: Partial<Assignment>): Assignment => ({
  id: 'a',
  companyId: COMPANY,
  date: D,
  shift: 'day',
  factoryId: 'f1',
  postId: 'L1',
  personId: 'x',
  source: 'auto',
  locked: false,
  reason: null,
  flags: [],
  createdAt: new Date('2026-04-20T00:00:00Z'),
  ...over,
});
const absence = (personId: string): Absence =>
  ({
    id: `ab-${personId}`,
    companyId: COMPANY,
    date: D,
    shift: 'day',
    factoryId: 'f1',
    personId,
    status: 'pending-board',
  }) as Absence;
const skill = (personId: string, postId: string, level: 0 | 1 | 2 | 3) => ({ personId, postId, level });
const added = (c: Changes) => (c.upsert.assignments ?? []) as Assignment[];
const pairs = (c: Changes) =>
  added(c)
    .map((a) => `${a.postId}:${a.personId}`)
    .sort();

describe('rosterFor', () => {
  test('휴무 승인·결근 신고자는 빠지고 교대·재직·공장이 다른 사람도 빠진다', () => {
    const snap = makeSnapshot({
      persons: [
        day('p1'),
        day('p2'),
        day('p3', { crew: 'B' }),
        day('p4', { active: false }),
        day('p5', { factoryId: 'f2' }),
        day('p6'),
      ],
      absences: [absence('p2')],
      leaves: [
        { id: 'l', companyId: COMPANY, personId: 'p6', date: D, kind: 'x', status: 'approved', createdAt: new Date(), decidedAt: null },
      ],
    });
    expect(rosterFor(snap, 'f1', D, 'day')).toEqual(['p1']);
  });
});

describe('autoAssign', () => {
  test('결과 배치에 같은 사람이 두 번 나오지 않는다', () => {
    const snap = makeSnapshot({
      posts: [line('L1', 0, { defaultNeed: 3 }), line('L2', 1, { defaultNeed: 3 })],
      persons: [day('p1'), day('p2'), day('p3'), day('p4')],
    });
    const rows = added(autoAssign(snap, 'f1', D, 'day', ctx()));
    const ids = rows.map((r) => r.personId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.source === 'auto' && !r.locked && r.reason === null)).toBe(true);
    expect(rows[0].createdAt).toEqual(ctx().now);
  });

  test('locked 배치는 유지되고 그 칸만큼 덜 채운다; unlocked 기존 배치는 재계산', () => {
    const snap = makeSnapshot({
      posts: [line('L1', 0, { defaultNeed: 2 })],
      persons: [day('p1'), day('p2'), day('p3')],
      assignments: [
        asg({ id: 'keep', personId: 'p1', locked: true }),
        asg({ id: 'drop', personId: 'p2', locked: false }),
      ],
    });
    const c = autoAssign(snap, 'f1', D, 'day', ctx());
    expect(c.remove.assignments).toEqual(['drop']);
    const rows = added(c);
    expect(rows).toHaveLength(1); // 2 slots - 1 locked
    expect(rows[0].personId).not.toBe('p1');
  });

  test('다른 공장의 locked 배치를 가진 사람은 후보에서 빠진다', () => {
    const snap = makeSnapshot({
      posts: [line('L1', 0, { defaultNeed: 2 })],
      persons: [day('p1'), day('p2')],
      assignments: [asg({ id: 'o', personId: 'p1', factoryId: 'f2', postId: 'X', locked: true })],
    });
    expect(pairs(autoAssign(snap, 'f1', D, 'day', ctx()))).toEqual(['L1:p2']);
  });

  test('fixedPostId 지정자는 고정 자리에 먼저 들어간다', () => {
    const snap = makeSnapshot({
      posts: [line('L1', 0), makePost({ id: 'F1', code: 'F1', kind: 'fixed', sort: 1, defaultNeed: 1 })],
      persons: [day('p1', { fixedPostId: 'F1' }), day('p2')],
      skills: [skill('p1', 'L1', 3)],
    });
    // p1 would score higher at L1, but is designated for F1.
    expect(pairs(autoAssign(snap, 'f1', D, 'day', ctx()))).toEqual(['F1:p1', 'L1:p2']);
  });

  test('단독 가능(숙련도≥2) 후보가 적은 자리부터 채운다', () => {
    // Y sorts first, but X has a single capable person (p1) while Y has two (p1, p2).
    const snap = makeSnapshot({
      posts: [line('Y', 0), line('X', 1)],
      persons: [day('p1'), day('p2')],
      skills: [skill('p1', 'X', 3), skill('p1', 'Y', 3), skill('p2', 'Y', 3)],
    });
    expect(pairs(autoAssign(snap, 'f1', D, 'day', ctx()))).toEqual(['X:p1', 'Y:p2']);
  });

  test('단독 가능 수는 남은 후보 기준으로 다시 센다', () => {
    const snap = makeSnapshot({
      posts: [line('A', 0, { defaultNeed: 2 }), line('Q', 1), line('B', 2)],
      persons: [day('p1'), day('p2'), day('p3'), day('p7')],
      skills: [
        skill('p1', 'A', 3), skill('p1', 'B', 3),
        skill('p2', 'A', 3), skill('p2', 'B', 3),
        skill('p3', 'B', 3), skill('p3', 'Q', 3),
        skill('p7', 'Q', 2),
      ],
    });
    expect(pairs(autoAssign(snap, 'f1', D, 'day', ctx()))).toEqual(['A:p1', 'A:p2', 'B:p3', 'Q:p7']);
  });

  test('단독 가능 수가 같으면 priority 높은 자리부터', () => {
    const snap = makeSnapshot({
      posts: [line('A1', 0, { priority: 0 }), line('B1', 1, { priority: 5 })],
      persons: [day('p1'), day('p2')],
      skills: [skill('p1', 'A1', 3), skill('p1', 'B1', 3), skill('p2', 'A1', 2), skill('p2', 'B1', 2)],
    });
    // B1 is filled first and takes the better-scoring p1.
    expect(pairs(autoAssign(snap, 'f1', D, 'day', ctx()))).toEqual(['A1:p2', 'B1:p1']);
  });

  test('점수 동점이면 empNo 오름차순', () => {
    const snap = makeSnapshot({
      posts: [line('L1', 0)],
      persons: [day('p9', { empNo: '2000' }), day('p8', { empNo: '1000' })],
    });
    expect(pairs(autoAssign(snap, 'f1', D, 'day', ctx()))).toEqual(['L1:p8']);
  });

  test('성별 조건 칸에는 일치하는 후보만 들어간다', () => {
    const snap = makeSnapshot({
      posts: [line('L1', 0)],
      standards: [{ id: 's', companyId: COMPANY, postId: 'L1', productId: null, need: 1, gender: 'F' }],
      persons: [day('p1', { gender: 'M', empNo: '1' }), day('p2', { gender: 'F', empNo: '2' })],
    });
    expect(pairs(autoAssign(snap, 'f1', D, 'day', ctx()))).toEqual(['L1:p2']);
  });

  test('휴무 승인·결근 신고자는 후보에서 빠진다', () => {
    const snap = makeSnapshot({
      posts: [line('L1', 0, { defaultNeed: 2 })],
      persons: [day('p1'), day('p2')],
      absences: [absence('p1')],
    });
    expect(pairs(autoAssign(snap, 'f1', D, 'day', ctx()))).toEqual(['L1:p2']);
  });

  test('남은 사람은 배치되지 않고(대기), 못 채운 칸은 Changes에 없다', () => {
    const many = makeSnapshot({
      posts: [line('L1', 0)],
      persons: [day('p1'), day('p2'), day('p3')],
    });
    expect(added(autoAssign(many, 'f1', D, 'day', ctx()))).toHaveLength(1);
    const few = makeSnapshot({
      posts: [line('L1', 0, { defaultNeed: 3 })],
      persons: [day('p1')],
    });
    expect(added(autoAssign(few, 'f1', D, 'day', ctx()))).toHaveLength(1);
  });

  test('배치표가 없으면 draft board를 만들고 있으면 만들지 않는다', () => {
    const base = { posts: [line('L1', 0)], persons: [day('p1')] };
    const c = autoAssign(makeSnapshot(base), 'f1', D, 'day', ctx());
    expect(c.upsert.boards).toEqual([
      { companyId: COMPANY, date: D, shift: 'day', factoryId: 'f1', status: 'draft', stoppedPostIds: [], confirmedAt: null, confirmedBy: null },
    ]);
    const withBoard = makeSnapshot({
      ...base,
      boards: [{ companyId: COMPANY, date: D, shift: 'day', factoryId: 'f1', status: 'confirmed', stoppedPostIds: [], confirmedAt: null, confirmedBy: null }],
    });
    expect(autoAssign(withBoard, 'f1', D, 'day', ctx()).upsert.boards).toBeUndefined();
  });
});

describe('placementScore', () => {
  const sctx = { factoryId: 'f1', date: D, shift: 'day' as const, productId: 'pr1', isSubstitute: false };
  const base = (): Snapshot =>
    makeSnapshot({
      posts: [line('L1', 0, { role: 'R' })],
      persons: [day('p1', { role: 'R' })],
      skills: [skill('p1', 'L1', 3)],
      experience: { p1: { post: { L1: 60 }, product: { pr1: 4 } } },
      assignments: [asg({ id: 'prev', personId: 'p1', date: '2026-04-21', postId: 'L1' })],
    });

  test('placementScore: 숙련도3 가동률1.0, 지난번 이 자리, 같은 제품, 같은 공장, 역할 일치 → 100+15+0.2*min(n,50)+3+1+5', () => {
    expect(placementScore(base(), 'p1', 'L1', sctx)).toBeCloseTo(100 + 15 + 0.2 * 50 + 3 + 1 + 5);
  });

  test('역할이 다르면 감점, 대체 후보일 때만 최근 대체 수락 감점', () => {
    const snap = base();
    snap.persons[0].role = 'Z';
    snap.assignments.push(asg({ id: 'sub', personId: 'p1', date: '2026-04-10', source: 'sub', postId: 'other' }));
    // 100+15+10+3+1-20 ; the 04-10 assignment is not the most recent one
    expect(placementScore(snap, 'p1', 'L1', sctx)).toBeCloseTo(109);
    expect(placementScore(snap, 'p1', 'L1', { ...sctx, isSubstitute: true })).toBeCloseTo(109 - 25);
  });

  test('주 40시간 초과분은 시간당 0.5 감점', () => {
    const snap = base();
    // regular Wed-Sat (4) + Tue + Mon assignments = 6 shifts = 48h
    snap.assignments.push(asg({ id: 'mon', personId: 'p1', date: '2026-04-20', postId: 'other' }));
    expect(placementScore(snap, 'p1', 'L1', sctx)).toBeCloseTo(100 + 15 + 10 + 3 + 1 + 5 - 4);
  });

  test('같은 날 주간 배치는 야간보다 앞선 배치로 본다', () => {
    const snap = base();
    snap.assignments = [asg({ id: 'd', personId: 'p1', date: D, shift: 'day', postId: 'L1' })];
    const night = { ...sctx, shift: 'night' as const };
    const withBonus = placementScore(snap, 'p1', 'L1', night);
    snap.assignments = [];
    expect(withBonus - placementScore(snap, 'p1', 'L1', night)).toBeCloseTo(15);
  });
});

describe('flagsFor', () => {
  test('no-exp, low-skill, role, gender, hours', () => {
    const snap = makeSnapshot({
      posts: [line('L1', 0, { role: 'R' })],
      persons: [day('p1', { role: 'Z', gender: 'M' })],
    });
    const slot = { postId: 'L1', index: 0, gender: 'F' as const };
    expect([...flagsFor(snap, 'p1', 'L1', slot, D)].sort()).toEqual(['gender', 'low-skill', 'no-exp', 'role']);

    const ok = makeSnapshot({
      posts: [line('L1', 0)],
      persons: [day('p1')],
      skills: [skill('p1', 'L1', 2)],
      experience: { p1: { post: { L1: 12 }, product: {} } },
    });
    const open = { postId: 'L1', index: 0, gender: null };
    expect(flagsFor(ok, 'p1', 'L1', open, D)).toEqual([]);

    ok.settings.warnWeekHours = 32; // regular Wed-Sat = 32h
    expect(flagsFor(ok, 'p1', 'L1', open, D)).toEqual(['hours']);
  });

  test('경험이 있으면 no-exp는 없고 low-skill만 남는다', () => {
    const snap = makeSnapshot({
      posts: [line('L1', 0)],
      persons: [day('p1')],
      experience: { p1: { post: { L1: 3 }, product: {} } },
    });
    expect(flagsFor(snap, 'p1', 'L1', { postId: 'L1', index: 0, gender: null }, D)).toEqual(['low-skill']);
  });
});
