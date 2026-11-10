import { describe, expect, test } from 'vitest';
import { computeSlots, effectivePlan, postNeed } from '@/engine/demand';
import type { Board, PlanCell, Standard } from '@/engine/types';
import { COMPANY, makePost, makeSnapshot } from '../helpers/fixtures';

const D = '2026-03-10';
const cell = (over: Partial<PlanCell>): PlanCell => ({
  companyId: COMPANY,
  date: D,
  shift: 'day',
  postId: 'L1',
  productId: null,
  status: 'run',
  ...over,
});
const std = (over: Partial<Standard>): Standard => ({
  id: 's',
  companyId: COMPANY,
  postId: 'L1',
  productId: null,
  need: 1,
  gender: null,
  ...over,
});
const board = (over: Partial<Board>): Board => ({
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
const line = (id: string, sort: number, defaultNeed = 2) =>
  makePost({ id, code: id, kind: 'line', sort, defaultNeed });

describe('effectivePlan', () => {
  test('그날 계획 없으면 가장 최근 같은 교대 계획을 이어 씀(다른 교대 계획은 무시)', () => {
    const snap = makeSnapshot({
      posts: [line('L1', 0)],
      plans: [
        cell({ date: '2026-03-05', productId: 'old' }),
        cell({ date: '2026-03-08', productId: 'recent' }),
        cell({ date: '2026-03-09', shift: 'night', productId: 'night' }),
        cell({ date: '2026-03-11', productId: 'future' }),
      ],
    });
    expect(effectivePlan(snap, 'f1', D, 'day').get('L1')).toEqual({ productId: 'recent', status: 'run' });
  });

  test('그날 계획이 있으면 그것을 쓰고 빠진 자리는 기본값', () => {
    const snap = makeSnapshot({
      posts: [line('L1', 0), line('L2', 1), makePost({ id: 'U', kind: 'line', unmanned: true, sort: 2 })],
      plans: [cell({ productId: 'a' }), cell({ date: '2026-03-01', postId: 'L2', productId: 'x' })],
    });
    const p = effectivePlan(snap, 'f1', D, 'day');
    expect(p.get('L1')).toEqual({ productId: 'a', status: 'run' });
    expect(p.get('L2')).toEqual({ productId: null, status: 'run' });
    expect(p.get('U')).toEqual({ productId: null, status: 'unmanned' });
  });

  test('다른 공장 자리와 비활성 자리는 제외', () => {
    const snap = makeSnapshot({
      posts: [line('L1', 0), makePost({ id: 'X', factoryId: 'f2' }), makePost({ id: 'I', active: false })],
    });
    expect([...effectivePlan(snap, 'f1', D, 'day').keys()]).toEqual(['L1']);
  });
});

describe('postNeed', () => {
  test('표준(post, product) > 표준(post, null) > post.defaultNeed', () => {
    const base = { posts: [line('L1', 0, 2)], plans: [cell({ productId: 'a' })] };
    const need = (standards: Standard[]) =>
      postNeed(makeSnapshot({ ...base, standards }), 'f1', D, 'day').get('L1');
    expect(need([])).toBe(2);
    expect(need([std({ need: 3 })])).toBe(3);
    expect(need([std({ need: 3 }), std({ id: 's2', productId: 'a', need: 5 })])).toBe(5);
    expect(need([std({ need: 3 }), std({ id: 's3', productId: 'other', need: 9 })])).toBe(3);
  });

  test('off·unmanned·board.stoppedPostIds 라인은 0', () => {
    const snap = makeSnapshot({
      posts: [
        line('L1', 0),
        line('L2', 1),
        line('L3', 2),
        makePost({ id: 'U', kind: 'line', unmanned: true, sort: 3 }),
        line('L4', 4),
      ],
      plans: [cell({ postId: 'L1', status: 'off' }), cell({ postId: 'L2', status: 'unmanned' })],
      boards: [board({ stoppedPostIds: ['L3'] })],
    });
    const n = postNeed(snap, 'f1', D, 'day');
    expect([n.get('L1'), n.get('L2'), n.get('L3'), n.get('U'), n.get('L4')]).toEqual([0, 0, 0, 0, 2]);
  });

  test('다른 날·교대·공장의 보드는 무시', () => {
    const snap = makeSnapshot({
      posts: [line('L1', 0)],
      boards: [
        board({ date: '2026-03-11', stoppedPostIds: ['L1'] }),
        board({ shift: 'night', stoppedPostIds: ['L1'] }),
        board({ factoryId: 'f2', stoppedPostIds: ['L1'] }),
      ],
    });
    expect(postNeed(snap, 'f1', D, 'day').get('L1')).toBe(2);
  });

  test('가동 라인 0개면 고정 자리 0, 1개 이상이면 defaultNeed', () => {
    const fixed = makePost({ id: 'F', kind: 'fixed', defaultNeed: 2, sort: 9 });
    const none = makeSnapshot({ posts: [line('L1', 0), fixed], plans: [cell({ status: 'off' })] });
    expect(postNeed(none, 'f1', D, 'day').get('F')).toBe(0);
    const some = makeSnapshot({ posts: [line('L1', 0), fixed] });
    expect(postNeed(some, 'f1', D, 'day').get('F')).toBe(2);
  });

  test('가동 라인 6개면 role 운반 자리 +1(sort 가장 낮은 것), 5개면 그대로', () => {
    const carriers = [
      makePost({ id: 'C2', kind: 'fixed', role: '운반', defaultNeed: 1, sort: 20 }),
      makePost({ id: 'C1', kind: 'fixed', role: '운반', defaultNeed: 1, sort: 10 }),
      makePost({ id: 'Z', kind: 'fixed', role: '포장', defaultNeed: 1, sort: 5 }),
    ];
    const lines = (n: number) => Array.from({ length: n }, (_, i) => line(`L${i}`, i));
    const five = postNeed(makeSnapshot({ posts: [...lines(5), ...carriers] }), 'f1', D, 'day');
    expect([five.get('C1'), five.get('C2'), five.get('Z')]).toEqual([1, 1, 1]);
    const six = postNeed(makeSnapshot({ posts: [...lines(6), ...carriers] }), 'f1', D, 'day');
    expect([six.get('C1'), six.get('C2'), six.get('Z')]).toEqual([2, 1, 1]);
  });

  test('unmanned 고정 자리는 항상 0', () => {
    const snap = makeSnapshot({ posts: [line('L1', 0), makePost({ id: 'F', kind: 'fixed', unmanned: true })] });
    expect(postNeed(snap, 'f1', D, 'day').get('F')).toBe(0);
  });
});

describe('computeSlots', () => {
  test('sort 순으로 need 개수만큼 index 0.. 칸을 만들고, 성별 조건 표준이면 gender가 붙음', () => {
    const snap = makeSnapshot({
      posts: [line('B', 1, 1), line('A', 0, 2)],
      plans: [cell({ postId: 'A', productId: 'p' }), cell({ postId: 'B' })],
      standards: [
        std({ postId: 'A', need: 2, gender: 'F' }),
        std({ id: 's2', postId: 'A', productId: 'p', need: 2, gender: 'M' }),
      ],
    });
    expect(computeSlots(snap, 'f1', D, 'day')).toEqual([
      { postId: 'A', index: 0, gender: 'M' },
      { postId: 'A', index: 1, gender: 'M' },
      { postId: 'B', index: 0, gender: null },
    ]);
  });

  test('post+product 표준이 없으면 post+null 표준의 성별을 씀', () => {
    const snap = makeSnapshot({
      posts: [line('A', 0, 1)],
      plans: [cell({ postId: 'A', productId: 'p' })],
      standards: [std({ postId: 'A', need: 1, gender: 'F' })],
    });
    expect(computeSlots(snap, 'f1', D, 'day')).toEqual([{ postId: 'A', index: 0, gender: 'F' }]);
  });
});
