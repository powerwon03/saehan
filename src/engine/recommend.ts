import { rosterFor } from './autoAssign';
import { effectivePlan } from './demand';
import { canWorkExtra } from './eligibility';
import { postExperience, productExperience, skillLevel } from './skill';
import type { DateStr, Shift, Snapshot } from './types';
import { recentSubCount, weekHours } from './worklog';

export type Candidate = {
  personId: string;
  kind: 'idle' | 'rest';
  factoryId: string;
  skill: 0 | 1 | 2 | 3;
  reasons: ('exp' | 'product' | 'otherFactory')[];
  warnings: ('lowSkill' | 'role' | 'gender' | 'hours')[];
  weekHours: number;
  recentSubs: number;
};

export type RecommendTarget = {
  factoryId: string;
  date: DateStr;
  shift: Shift;
  postId: string;
  gender: 'M' | 'F' | null;
};

/** 그 교대 대기 인원: rosterFor 중 같은 날짜·교대에 어느 공장에도 배치가 없는 사람. */
export function idlePeople(snap: Snapshot, factoryId: string, date: DateStr, shift: Shift): string[] {
  const placed = new Set(
    snap.assignments.filter((a) => a.date === date && a.shift === shift).map((a) => a.personId),
  );
  return rosterFor(snap, factoryId, date, shift).filter((id) => !placed.has(id));
}

/** 대체 후보(대기 인원 + 쉬는 사람)를 추천 순서대로 돌려준다. */
export function recommendFor(snap: Snapshot, target: RecommendTarget): Candidate[] {
  const { factoryId, date, shift, postId } = target;
  const post = snap.posts.find((p) => p.id === postId);
  const productId = effectivePlan(snap, factoryId, date, shift).get(postId)?.productId ?? null;
  const idle = new Set(idlePeople(snap, factoryId, date, shift));
  const placed = new Set(
    snap.assignments.filter((a) => a.date === date && a.shift === shift).map((a) => a.personId),
  );

  const out: Candidate[] = [];
  for (const person of snap.persons) {
    if (!person.active) continue;
    let kind: 'idle' | 'rest';
    if (idle.has(person.id)) {
      kind = 'idle';
    } else {
      if (placed.has(person.id)) continue;
      if (!canWorkExtra(snap, person.id, date, shift).ok) continue;
      kind = 'rest';
    }
    if (target.gender !== null && person.gender !== null && person.gender !== target.gender) continue;

    const skill = skillLevel(snap, person.id, postId);
    const hours = weekHours(snap, person.id, date);
    const reasons: Candidate['reasons'] = [];
    if (skill >= 1 || postExperience(snap, person.id, postId) > 0) reasons.push('exp');
    if (productId !== null && productExperience(snap, person.id, productId) > 0) reasons.push('product');
    if (person.factoryId !== factoryId) reasons.push('otherFactory');

    const warnings: Candidate['warnings'] = [];
    if (skill <= 1) warnings.push('lowSkill');
    if (post && post.role !== null && post.role !== person.role) warnings.push('role');
    if (target.gender !== null && person.gender === null) warnings.push('gender');
    if (hours >= snap.settings.warnWeekHours) warnings.push('hours');

    out.push({
      personId: person.id,
      kind,
      factoryId: person.factoryId,
      skill,
      reasons,
      warnings,
      weekHours: hours,
      recentSubs: recentSubCount(snap, person.id, date),
    });
  }

  const empNo = (id: string) => snap.persons.find((p) => p.id === id)?.empNo ?? '';
  const has = (c: Candidate, r: Candidate['reasons'][number]) => (c.reasons.includes(r) ? 0 : 1);
  return out.sort(
    (a, b) =>
      (a.kind === 'rest' ? 0 : 1) - (b.kind === 'rest' ? 0 : 1) ||
      has(a, 'exp') - has(b, 'exp') ||
      has(a, 'product') - has(b, 'product') ||
      a.recentSubs - b.recentSubs ||
      b.skill - a.skill ||
      (a.factoryId === factoryId ? 0 : 1) - (b.factoryId === factoryId ? 0 : 1) ||
      a.weekHours - b.weekHours ||
      (empNo(a.personId) < empNo(b.personId) ? -1 : empNo(a.personId) > empNo(b.personId) ? 1 : 0),
  );
}
