import { describe, expect, test } from 'vitest';
import { placementOf, planFromValue, planValue, replaceActions } from '@/components/admin/board/logic';
import type { BoardView } from '@/server/views/boardView';

type Line = BoardView['lines'][number];
const line = (postId: string, people: [assignmentId: string, personId: string][]): Line => ({
  post: { id: postId, code: postId.toUpperCase(), name: `라인 ${postId}`, kind: 'line', role: null },
  plan: { productId: null, status: 'run' },
  stopped: false,
  need: 2,
  people: people.map(([assignmentId, personId]) => ({ assignmentId, personId, name: personId, empNo: personId, source: 'auto', locked: false, flags: [] })),
  vacancies: 0,
});
const view = { lines: [line('p1', [['a1', 'kim'], ['a2', 'lee']]), line('p2', [['a3', 'park']])] } as Pick<BoardView, 'lines'>;

describe('placementOf', () => {
  test('보드에 있는 사람의 배치와 자리', () => {
    expect(placementOf(view, 'park')).toEqual({ assignmentId: 'a3', postId: 'p2', postCode: 'P2', postName: '라인 p2' });
  });
  test('없으면 null', () => {
    expect(placementOf(view, 'choi')).toBeNull();
  });
});

describe('replaceActions', () => {
  const chip = { assignmentId: 'a1', personId: 'kim', postId: 'p1' };

  test('같은 교대 다른 자리 사람이면 맞바꿈', () => {
    expect(replaceActions(view, chip, 'park')).toEqual([{ type: 'swap', assignmentIdA: 'a1', assignmentIdB: 'a3' }]);
  });

  test('이미 같은 자리에 있는 사람이면 아무것도 안 한다', () => {
    expect(replaceActions(view, chip, 'lee')).toEqual([]);
  });

  test('자기 자신이면 아무것도 안 한다', () => {
    expect(replaceActions(view, chip, 'kim')).toEqual([]);
  });

  test('보드에 없는 사람이면 넣고 원래 사람을 뺀다', () => {
    expect(replaceActions(view, chip, 'choi')).toEqual([
      { type: 'assign', postId: 'p1', personId: 'choi' },
      { type: 'unassign', assignmentId: 'a1' },
    ]);
  });
});

describe('plan select value', () => {
  test('상태·제품 ↔ 드롭다운 값', () => {
    expect(planValue({ productId: 'x', status: 'run' })).toBe('x');
    expect(planValue({ productId: null, status: 'run' })).toBe('');
    expect(planValue({ productId: null, status: 'off' })).toBe('off');
    expect(planValue({ productId: 'x', status: 'unmanned' })).toBe('unmanned');
    expect(planFromValue('x')).toEqual({ productId: 'x', status: 'run' });
    expect(planFromValue('')).toEqual({ productId: null, status: 'run' });
    expect(planFromValue('off')).toEqual({ productId: null, status: 'off' });
    expect(planFromValue('unmanned')).toEqual({ productId: null, status: 'unmanned' });
  });
});
