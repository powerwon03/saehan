import { describe, expect, test } from 'vitest';
import { postExperience, productExperience, skillLevel, skillRate } from '@/engine/skill';
import { makePerson, makePost, makeSettings, makeSnapshot } from '../helpers/fixtures';

function snapWith(count: number | undefined, manual?: 0 | 1 | 2 | 3) {
  return makeSnapshot({
    persons: [makePerson({ id: 'p1' })],
    posts: [makePost({ id: 'post1' })],
    skills: manual === undefined ? [] : [{ personId: 'p1', postId: 'post1', level: manual }],
    experience: count === undefined ? {} : { p1: { post: { post1: count }, product: { prod1: 7 } } },
  });
}

describe('skillLevel', () => {
  test('직접 값이 이력보다 우선', () => {
    expect(skillLevel(snapWith(50, 1), 'p1', 'post1')).toBe(1);
    expect(skillLevel(snapWith(0, 3), 'p1', 'post1')).toBe(3);
    expect(skillLevel(snapWith(undefined, 0), 'p1', 'post1')).toBe(0);
  });

  test('이력 0/1/10/30회 → 0/1/2/3', () => {
    expect(skillLevel(snapWith(undefined), 'p1', 'post1')).toBe(0);
    expect(skillLevel(snapWith(0), 'p1', 'post1')).toBe(0);
    expect(skillLevel(snapWith(1), 'p1', 'post1')).toBe(1);
    expect(skillLevel(snapWith(9), 'p1', 'post1')).toBe(1);
    expect(skillLevel(snapWith(10), 'p1', 'post1')).toBe(2);
    expect(skillLevel(snapWith(29), 'p1', 'post1')).toBe(2);
    expect(skillLevel(snapWith(30), 'p1', 'post1')).toBe(3);
  });

  test('고정 자리: 지정 사람 3, 같은 역할 2, 그 외 0 (직접 값 없을 때)', () => {
    const fixed = makePost({ id: 'fx', kind: 'fixed', role: '운반' });
    const s = makeSnapshot({
      posts: [fixed],
      persons: [
        makePerson({ id: 'owner', fixedPostId: 'fx', role: null }),
        makePerson({ id: 'same', role: '운반' }),
        makePerson({ id: 'other', role: '검사' }),
      ],
      skills: [{ personId: 'owner', postId: 'fx', level: 1 }],
      experience: { other: { post: { fx: 40 }, product: {} } },
    });
    expect(skillLevel(s, 'same', 'fx')).toBe(2);
    expect(skillLevel(s, 'other', 'fx')).toBe(0);
    expect(skillLevel(s, 'owner', 'fx')).toBe(1); // 직접 값 우선
    const s2 = makeSnapshot({ ...s, skills: [] });
    expect(skillLevel(s2, 'owner', 'fx')).toBe(3);
  });
});

test('가동률 = settings.skillRates[level]', () => {
  const settings = makeSettings({ skillRates: [0.1, 0.2, 0.3, 0.4] });
  expect(skillRate(0, settings)).toBe(0.1);
  expect(skillRate(3, settings)).toBe(0.4);
});

test('경험 횟수 조회', () => {
  const s = snapWith(12);
  expect(postExperience(s, 'p1', 'post1')).toBe(12);
  expect(postExperience(s, 'p1', 'nope')).toBe(0);
  expect(postExperience(s, 'zzz', 'post1')).toBe(0);
  expect(productExperience(s, 'p1', 'prod1')).toBe(7);
  expect(productExperience(s, 'p1', 'x')).toBe(0);
});
