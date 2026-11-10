import { describe, expect, test } from 'vitest';
import { bulkTargets, minutesLeft, resolvedMinutes, seoulHm, visibleCandidates } from '@/components/admin/absence/logic';

const cand = (personId: string, kind: 'idle' | 'rest' = 'rest') => ({ personId, kind });
const req = (personId: string, status = 'sent') => ({ personId, status });

describe('visibleCandidates', () => {
  const list = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => cand(id));

  test('처음 3명만 보이고 나머지 수를 센다', () => {
    const r = visibleCandidates(list, [], false);
    expect(r.shown.map((c) => c.personId)).toEqual(['a', 'b', 'c']);
    expect(r.hidden).toBe(3);
  });

  test('요청 보낸 사람은 순서를 지킨 채 항상 보인다', () => {
    const r = visibleCandidates(list, [req('e', 'declined')], false);
    expect(r.shown.map((c) => c.personId)).toEqual(['a', 'b', 'c', 'e']);
    expect(r.hidden).toBe(2);
  });

  test('모두 보기면 전부', () => {
    const r = visibleCandidates(list, [], true);
    expect(r.shown).toHaveLength(6);
    expect(r.hidden).toBe(0);
  });
});

describe('bulkTargets', () => {
  test('아직 요청하지 않은 쉬는 사람 앞에서부터 3명 (대기 인원 제외)', () => {
    const list = [cand('i', 'idle'), cand('a'), cand('b'), cand('c'), cand('d')];
    expect(bulkTargets(list, [req('a', 'expired')])).toEqual(['b', 'c', 'd']);
  });

  test('남은 사람이 적으면 그만큼', () => {
    expect(bulkTargets([cand('a'), cand('b')], [req('b')])).toEqual(['a']);
  });
});

describe('time helpers', () => {
  const at = (iso: string) => new Date(iso);

  test('minutesLeft: 올림, 지나면 0', () => {
    expect(minutesLeft(at('2026-11-10T00:20:00Z'), Date.parse('2026-11-10T00:05:30Z'))).toBe(15);
    expect(minutesLeft(at('2026-11-10T00:20:00Z'), Date.parse('2026-11-10T00:21:00Z'))).toBe(0);
  });

  test('JSON 문자열 날짜도 받는다', () => {
    expect(minutesLeft('2026-11-10T00:20:00.000Z' as unknown as Date, Date.parse('2026-11-10T00:10:00Z'))).toBe(10);
  });

  test('resolvedMinutes: 반올림, 최소 1분', () => {
    expect(resolvedMinutes(at('2026-11-10T00:00:00Z'), at('2026-11-10T00:07:20Z'))).toBe(7);
    expect(resolvedMinutes(at('2026-11-10T00:00:00Z'), at('2026-11-10T00:00:10Z'))).toBe(1);
  });

  test('seoulHm: 서울 시각 HH:MM (+09:00 고정)', () => {
    expect(seoulHm(at('2026-11-09T22:05:00Z'))).toBe('07:05');
  });
});
