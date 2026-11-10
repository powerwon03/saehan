import { describe, expect, test } from 'vitest';
import { assignPerson, confirmBoard, setPlan, swap, toggleStop, unassign } from '@/engine/board';
import type { Assignment, Board, PlanCell } from '@/engine/types';
import { COMPANY, ctxAt, makePerson, makePost, makeSnapshot } from '../helpers/fixtures';

// 2026-04-22: crew A = day, crew B = night, crew C = off.
const D = '2026-04-22';
const ctx = () => ctxAt('2026-04-21T09:00:00+09:00');
const line = (id: string, sort = 0) => makePost({ id, code: id, kind: 'line', sort, defaultNeed: 1 });
const asg = (over: Partial<Assignment>): Assignment => ({
  id: 'a',
  companyId: COMPANY,
  date: D,
  shift: 'day',
  factoryId: 'f1',
  postId: 'L1',
  personId: 'p1',
  source: 'auto',
  locked: false,
  reason: null,
  flags: [],
  createdAt: new Date('2026-04-20T00:00:00Z'),
  ...over,
});
const cell = (over: Partial<PlanCell>): PlanCell => ({
  companyId: COMPANY,
  date: D,
  shift: 'day',
  postId: 'L1',
  productId: null,
  status: 'run',
  ...over,
});
const board = (over: Partial<Board> = {}): Board => ({
  companyId: COMPANY,
  date: D,
  shift: 'day',
  factoryId: 'f1',
  status: 'draft',
  stoppedPostIds: [],
  confirmedAt: null,
  confirmedBy: null,
  ...over,
});
const key = { factoryId: 'f1', date: D, shift: 'day' as const };

describe('setPlan', () => {
  test('라인을 off로 바꾸면 locked 배치까지 삭제된다', () => {
    const snap = makeSnapshot({
      posts: [line('L1'), line('L2', 1)],
      persons: [makePerson({ id: 'p1' }), makePerson({ id: 'p2', empNo: '2' })],
      plans: [cell({ postId: 'L1' }), cell({ postId: 'L2' })],
      assignments: [
        asg({ id: 'a1', postId: 'L1', personId: 'p1', locked: true }),
        asg({ id: 'a2', postId: 'L2', personId: 'p2' }),
      ],
    });
    const c = setPlan(snap, { ...key, postId: 'L1', productId: null, status: 'off' }, ctx());
    expect(c.remove.assignments).toEqual(['a1']);
    const rows = c.upsert.plans as PlanCell[];
    expect(rows.find((r) => r.postId === 'L1')?.status).toBe('off');
  });

  test('unmanned로 바꿔도 배치를 삭제하고 run이면 삭제하지 않는다', () => {
    const snap = makeSnapshot({
      posts: [line('L1')],
      plans: [cell({})],
      assignments: [asg({ id: 'a1' })],
    });
    expect(setPlan(snap, { ...key, postId: 'L1', productId: null, status: 'unmanned' }, ctx()).remove.assignments).toEqual(['a1']);
    expect(setPlan(snap, { ...key, postId: 'L1', productId: 'pr', status: 'run' }, ctx()).remove.assignments).toBeUndefined();
  });

  test('그날 계획이 없을 때 setPlan은 최근 계획 전체를 복사한 뒤 한 칸만 바꾼다', () => {
    const snap = makeSnapshot({
      posts: [line('L1'), line('L2', 1), line('L3', 2)],
      plans: [
        cell({ date: '2026-04-20', postId: 'L1', productId: 'pa' }),
        cell({ date: '2026-04-20', postId: 'L2', productId: 'pb' }),
      ],
    });
    const rows = setPlan(snap, { ...key, postId: 'L2', productId: 'pz', status: 'run' }, ctx()).upsert.plans as PlanCell[];
    expect(rows).toHaveLength(3); // L3 only had a default
    expect(rows.every((r) => r.date === D && r.shift === 'day' && r.companyId === COMPANY)).toBe(true);
    const by = Object.fromEntries(rows.map((r) => [r.postId, r]));
    expect(by.L1).toMatchObject({ productId: 'pa', status: 'run' });
    expect(by.L2).toMatchObject({ productId: 'pz', status: 'run' });
    expect(by.L3).toMatchObject({ productId: null, status: 'run' });
  });

  test('그날 계획이 이미 있으면 그 칸 하나만 upsert', () => {
    const snap = makeSnapshot({
      posts: [line('L1'), line('L2', 1)],
      plans: [cell({ postId: 'L1' })],
    });
    const rows = setPlan(snap, { ...key, postId: 'L2', productId: 'x', status: 'run' }, ctx()).upsert.plans as PlanCell[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ postId: 'L2', productId: 'x' });
  });
});

describe('toggleStop', () => {
  test('세우면 board에 추가하고 locked 포함 배치를 삭제, 다시 누르면 해제', () => {
    const snap = makeSnapshot({
      posts: [line('L1')],
      assignments: [asg({ id: 'a1', locked: true })],
    });
    const c = toggleStop(snap, { ...key, postId: 'L1' }, ctx());
    expect(c.upsert.boards).toEqual([board({ stoppedPostIds: ['L1'] })]);
    expect(c.remove.assignments).toEqual(['a1']);

    const stopped = makeSnapshot({ posts: [line('L1')], boards: [board({ stoppedPostIds: ['L1', 'L2'] })] });
    const c2 = toggleStop(stopped, { ...key, postId: 'L1' }, ctx());
    expect(c2.upsert.boards).toEqual([board({ stoppedPostIds: ['L2'] })]);
    expect(c2.remove.assignments).toBeUndefined();
  });
});

describe('assignPerson', () => {
  const base = () =>
    makeSnapshot({
      posts: [line('L1'), line('L2', 1)],
      persons: [makePerson({ id: 'p1', crew: 'A' }), makePerson({ id: 'p2', empNo: '2', crew: 'A' })],
    });

  test('정규 근무자 신규 배치는 locked/manual', () => {
    const c = assignPerson(base(), { ...key, postId: 'L1', personId: 'p1' }, ctx());
    expect(c.upsert.assignments).toMatchObject([
      { personId: 'p1', postId: 'L1', factoryId: 'f1', locked: true, source: 'manual', reason: null },
    ]);
    expect(c.remove.assignments).toBeUndefined();
  });

  test('assignPerson: 다른 자리에 있던 사람은 이동, locked/manual', () => {
    const snap = base();
    snap.assignments = [asg({ id: 'old', postId: 'L1', personId: 'p1' })];
    const c = assignPerson(snap, { ...key, postId: 'L2', personId: 'p1' }, ctx());
    expect(c.remove.assignments).toEqual(['old']);
    expect(c.upsert.assignments).toMatchObject([{ postId: 'L2', personId: 'p1', locked: true, source: 'manual' }]);
  });

  test('같은 자리면 아무 일도 하지 않는다', () => {
    const snap = base();
    snap.assignments = [asg({ id: 'old', postId: 'L1', personId: 'p1' })];
    const c = assignPerson(snap, { ...key, postId: 'L1', personId: 'p1' }, ctx());
    expect(c).toEqual({ upsert: {}, remove: {}, messages: [] });
  });

  test('assignPerson: 전날 야간 근무자를 주간에 넣으면 EngineError NIGHT_BEFORE_DAY', () => {
    // crew C is off on D; give p3 a night assignment on D-1.
    const snap = base();
    snap.persons.push(makePerson({ id: 'p3', empNo: '3', crew: 'C' }));
    snap.assignments = [asg({ id: 'n', personId: 'p3', date: '2026-04-21', shift: 'night' })];
    expect(() => assignPerson(snap, { ...key, postId: 'L1', personId: 'p3' }, ctx())).toThrowError(
      expect.objectContaining({ name: 'EngineError', code: 'NIGHT_BEFORE_DAY' }),
    );
  });

  test('쉬는 사람도 검사를 통과하면 배치된다', () => {
    const snap = base();
    snap.persons.push(makePerson({ id: 'p3', empNo: '3', crew: 'C' }));
    const c = assignPerson(snap, { ...key, postId: 'L1', personId: 'p3' }, ctx());
    expect(c.upsert.assignments).toMatchObject([{ personId: 'p3', locked: true, source: 'manual' }]);
  });

  test('다른 공장 자리는 BAD_INPUT', () => {
    const snap = base();
    snap.posts.push(makePost({ id: 'X', factoryId: 'f2' }));
    expect(() => assignPerson(snap, { ...key, postId: 'X', personId: 'p1' }, ctx())).toThrowError(
      expect.objectContaining({ code: 'BAD_INPUT' }),
    );
  });
});

describe('swap / unassign', () => {
  const snap = () =>
    makeSnapshot({
      posts: [line('L1'), line('L2', 1)],
      persons: [makePerson({ id: 'p1' }), makePerson({ id: 'p2', empNo: '2' })],
      assignments: [
        asg({ id: 'a1', postId: 'L1', personId: 'p1' }),
        asg({ id: 'a2', postId: 'L2', personId: 'p2' }),
        asg({ id: 'a3', postId: 'L2', personId: 'p2', shift: 'night' }),
      ],
    });

  test('swap: 두 사람 자리 교환, 둘 다 locked', () => {
    const rows = swap(snap(), { assignmentIdA: 'a1', assignmentIdB: 'a2' }, ctx()).upsert.assignments as Assignment[];
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.a1).toMatchObject({ personId: 'p1', postId: 'L2', locked: true, source: 'manual' });
    expect(by.a2).toMatchObject({ personId: 'p2', postId: 'L1', locked: true, source: 'manual' });
  });

  test('swap: 교대가 다르면 BAD_INPUT', () => {
    expect(() => swap(snap(), { assignmentIdA: 'a1', assignmentIdB: 'a3' }, ctx())).toThrowError(
      expect.objectContaining({ code: 'BAD_INPUT' }),
    );
  });

  test('unassign: 행 삭제', () => {
    expect(unassign(snap(), { assignmentId: 'a1' }, ctx()).remove.assignments).toEqual(['a1']);
  });
});

describe('confirmBoard', () => {
  test('confirmBoard: status confirmed + 배치 인원 수만큼 todayWork 메시지', () => {
    const snap = makeSnapshot({
      posts: [line('L1'), line('L2', 1)],
      persons: [makePerson({ id: 'p1' }), makePerson({ id: 'p2', empNo: '2' })],
      assignments: [
        asg({ id: 'a1', postId: 'L1', personId: 'p1' }),
        asg({ id: 'a2', postId: 'L2', personId: 'p2' }),
        asg({ id: 'a3', postId: 'L2', personId: 'p3', shift: 'night' }),
      ],
      boards: [board({ stoppedPostIds: ['Z'] })],
    });
    const c = confirmBoard(snap, key, ctx());
    expect(c.upsert.boards).toEqual([
      board({ status: 'confirmed', stoppedPostIds: ['Z'], confirmedAt: ctx().now, confirmedBy: null }),
    ]);
    expect(c.messages).toEqual([
      { companyId: COMPANY, personId: 'p1', bodyKey: 'todayWork', params: { date: D, shift: 'day', postId: 'L1' }, channel: 'push' },
      { companyId: COMPANY, personId: 'p2', bodyKey: 'todayWork', params: { date: D, shift: 'day', postId: 'L2' }, channel: 'push' },
    ]);
  });

  test('배치표가 없어도 confirmed board를 만든다', () => {
    const c = confirmBoard(makeSnapshot(), key, ctx());
    expect(c.upsert.boards).toEqual([board({ status: 'confirmed', confirmedAt: ctx().now })]);
    expect(c.messages).toEqual([]);
  });
});
