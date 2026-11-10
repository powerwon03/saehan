import { describe, expect, test } from 'vitest';
import { idlePeople, recommendFor } from '@/engine/recommend';
import { EngineError, type Absence, type Assignment, type PlanCell, type Snapshot } from '@/engine/types';
import { COMPANY, makePerson, makePost, makeSettings, makeSnapshot } from '../helpers/fixtures';

// 2026-04-22: f1 -> crew A day, B night, C off. f2 (base +1 day) -> crew A off, B night, C day.
const D = '2026-04-22';
const target = { factoryId: 'f1', date: D, shift: 'day' as const, postId: 'L1', gender: null };

const rest = (id: string, over: Partial<Parameters<typeof makePerson>[0]> = {}) =>
  makePerson({ id, empNo: id, crew: 'C', ...over }); // f1, off on D
const idle = (id: string, over: Partial<Parameters<typeof makePerson>[0]> = {}) =>
  makePerson({ id, empNo: id, crew: 'A', ...over }); // f1, day on D
const exp = (personId: string, n: number, postId = 'L1') => ({ [personId]: { post: { [postId]: n }, product: {} } });
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
// maxWeekHours 56 lets a 48h person still take one more shift; 56h is over the limit.
const settings = makeSettings({ maxWeekHours: 56 });
const snapOf = (over: Partial<Snapshot> = {}) =>
  makeSnapshot({ settings, posts: [makePost({ id: 'L1', code: 'L1' })], ...over });
const ids = (snap: Snapshot) => recommendFor(snap, target).map((c) => c.personId);
// Crew C (f1) regularly works 5 shifts in this week (40h) and is off on 04-22 and 04-23.
// extraShifts adds up to 2 extra shifts on the off day 04-23 (+8h each).
const extraShifts = (personId: string, n: 1 | 2) =>
  (['day', 'night'] as const)
    .slice(0, n)
    .map((shift) => asg({ id: `${personId}-${shift}`, personId, date: '2026-04-23', shift, source: 'auto' }));

describe('idlePeople', () => {
  test('roster members without an assignment in that date+shift (any factory)', () => {
    const snap = snapOf({
      persons: [idle('i1'), idle('i2'), idle('i3')],
      assignments: [asg({ personId: 'i2' }), asg({ id: 'b', personId: 'i3', factoryId: 'f2' })],
    });
    expect(idlePeople(snap, 'f1', D, 'day')).toEqual(['i1']);
  });
});

describe('recommendFor', () => {
  test('쉬는 사람이 대기 인원보다 앞선다(경험 없어도)', () => {
    const snap = snapOf({
      persons: [idle('i1'), rest('r1')],
      skills: [{ personId: 'i1', postId: 'L1', level: 3 }],
      experience: exp('i1', 40),
    });
    expect(recommendFor(snap, target).map((c) => [c.personId, c.kind])).toEqual([
      ['r1', 'rest'],
      ['i1', 'idle'],
    ]);
  });

  test('같은 kind면 업무 경험 있는 사람이 앞선다', () => {
    const snap = snapOf({ persons: [rest('r1'), rest('r2'), rest('r3')], experience: exp('r3', 2) });
    const res = recommendFor(snap, target);
    expect(res[0].personId).toBe('r3');
    expect(res[0].reasons).toContain('exp');
  });

  test('그다음 오늘 제품 경험', () => {
    const plan: PlanCell = { companyId: COMPANY, date: D, shift: 'day', postId: 'L1', productId: 'prod1', status: 'run' };
    const snap = snapOf({
      persons: [rest('r1'), rest('r2')],
      plans: [plan],
      experience: { r1: { post: { L1: 1 }, product: {} }, r2: { post: { L1: 1 }, product: { prod1: 3 } } },
    });
    const res = recommendFor(snap, target);
    expect(res.map((c) => c.personId)).toEqual(['r2', 'r1']);
    expect(res[0].reasons).toEqual(['exp', 'product']);
    expect(res[1].reasons).toEqual(['exp']);
  });

  test('그다음 최근 30일 대체·직접 배치가 적은 사람', () => {
    const snap = snapOf({
      persons: [rest('r1'), rest('r2')],
      assignments: [asg({ id: 'h', personId: 'r1', date: '2026-04-10', source: 'sub' })],
    });
    const res = recommendFor(snap, target);
    expect(res.map((c) => c.personId)).toEqual(['r2', 'r1']);
    expect(res[1].recentSubs).toBe(1);
  });

  test('동점: 숙련도 높은 → 같은 공장 → 이번 주 시간 적은 → empNo', () => {
    const lvl = (personId: string, level: 0 | 1 | 2 | 3) => ({ personId, postId: 'L1', level });
    // skill desc (both have exp via level>=1)
    let snap = snapOf({ persons: [rest('r1'), rest('r2')], skills: [lvl('r1', 1), lvl('r2', 2)] });
    expect(ids(snap)).toEqual(['r2', 'r1']);

    // same factory first (f2 crew A is off on D)
    snap = snapOf({
      persons: [makePerson({ id: 'a', empNo: '1', crew: 'A', factoryId: 'f2' }), rest('b', { empNo: '2' })],
    });
    expect(ids(snap)).toEqual(['b', 'a']);

    // week hours ascending
    snap = snapOf({ persons: [rest('r1'), rest('r2')], assignments: extraShifts('r1', 1) });
    expect(ids(snap)).toEqual(['r2', 'r1']);

    // empNo string compare
    snap = snapOf({ persons: [rest('x', { empNo: '1002' }), rest('y', { empNo: '1001' })] });
    expect(ids(snap)).toEqual(['y', 'x']);
  });

  test('다른 공장 쉬는 사람도 포함되고 reasons에 otherFactory', () => {
    const snap = snapOf({ persons: [makePerson({ id: 'o', empNo: 'o', crew: 'A', factoryId: 'f2' })] });
    const res = recommendFor(snap, target);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ personId: 'o', kind: 'rest', factoryId: 'f2' });
    expect(res[0].reasons).toContain('otherFactory');
  });

  test('canWorkExtra 실패자, 성별 조건 불일치자는 제외(대기 인원은 성별만 검사)', () => {
    const snap = snapOf({
      persons: [
        rest('ok', { gender: 'F' }),
        rest('male', { gender: 'M' }),
        rest('unknown', { gender: null }),
        rest('inactive', { active: false }),
        rest('weekFull'), // 40h + 2 extra = 56h
        rest('nightPrev'), // night the day before -> NIGHT_BEFORE_DAY
        idle('idleM', { gender: 'M' }),
        idle('idleF', { gender: 'F' }),
      ],
      assignments: [
        ...extraShifts('weekFull', 2),
        asg({ id: 'np', personId: 'nightPrev', date: '2026-04-21', shift: 'night' }),
      ],
    });
    const res = recommendFor(snap, { ...target, gender: 'F' });
    expect(res.map((c) => c.personId).sort()).toEqual(['idleF', 'ok', 'unknown']);
    expect(res.find((c) => c.personId === 'unknown')!.warnings).toContain('gender');
    expect(res.find((c) => c.personId === 'ok')!.warnings).not.toContain('gender');
  });

  test('warnings: 숙련도1 lowSkill, 역할 다름 role, weekHours≥44 hours', () => {
    const snap = makeSnapshot({
      settings,
      posts: [makePost({ id: 'L1', role: 'op' })],
      persons: [rest('plain', { role: 'op' }), rest('low', { role: 'lead' }), rest('busy', { role: 'op' })],
      skills: [
        { personId: 'plain', postId: 'L1', level: 3 },
        { personId: 'low', postId: 'L1', level: 1 },
        { personId: 'busy', postId: 'L1', level: 3 },
      ],
      assignments: [],
    });
    const by = Object.fromEntries(recommendFor(snap, target).map((c) => [c.personId, c]));
    expect(by.plain.warnings).toEqual([]);
    expect(by.low.warnings).toEqual(['lowSkill', 'role']);
    expect(by.busy.weekHours).toBe(40);
    expect(by.busy.warnings).toEqual([]);

    const snap2 = { ...snap, assignments: extraShifts('busy', 1) }; // 48h
    const busy = recommendFor(snap2, target).find((c) => c.personId === 'busy')!;
    expect(busy.weekHours).toBe(48);
    expect(busy.warnings).toEqual(['hours']);
  });

  test('결근한 사람은 후보에 없다', () => {
    const absence = {
      id: 'ab', companyId: COMPANY, date: D, shift: 'day', factoryId: 'f1', personId: 'gone', status: 'pending-board',
    } as Absence;
    const snap = snapOf({ persons: [idle('gone'), idle('here'), rest('r')], absences: [absence] });
    expect(ids(snap)).toEqual(['r', 'here']);
    const restAbsent = snapOf({
      persons: [rest('gone2')],
      absences: [{ ...absence, id: 'ab2', personId: 'gone2' }],
    });
    expect(ids(restAbsent)).toEqual([]);
  });

  test('canWorkExtra DATA_INTEGRITY is propagated', () => {
    const snap = snapOf({ persons: [rest('bad', { factoryId: 'nope' })] });
    expect(() => recommendFor(snap, target)).toThrow(EngineError);
  });
});
