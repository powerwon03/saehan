import type { Settings, Snapshot } from './types';

export function postExperience(snap: Snapshot, personId: string, postId: string): number {
  return snap.experience[personId]?.post[postId] ?? 0;
}

export function productExperience(snap: Snapshot, personId: string, productId: string): number {
  return snap.experience[personId]?.product[productId] ?? 0;
}

/** 우선순위: skills 표의 값 → 고정 자리 규칙 → 이력 횟수 */
export function skillLevel(snap: Snapshot, personId: string, postId: string): 0 | 1 | 2 | 3 {
  const manual = snap.skills.find((s) => s.personId === personId && s.postId === postId);
  if (manual) return manual.level;

  const post = snap.posts.find((p) => p.id === postId);
  if (post?.kind === 'fixed') {
    const person = snap.persons.find((p) => p.id === personId);
    if (person?.fixedPostId === postId) return 3;
    if (person && post.role !== null && person.role === post.role) return 2;
    return 0;
  }

  const n = postExperience(snap, personId, postId);
  if (n >= 30) return 3;
  if (n >= 10) return 2;
  if (n >= 1) return 1;
  return 0;
}

export function skillRate(level: 0 | 1 | 2 | 3, settings: Settings): number {
  return settings.skillRates[level];
}
