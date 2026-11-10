import { skillLevel } from '@/engine/skill';
import { EngineError, type Snapshot } from '@/engine/types';

export type SkillGrid = {
  persons: { id: string; empNo: string; name: string; crew: string }[];
  posts: { id: string; code: string; name: string; kind: 'line' | 'fixed' }[];
  cells: { personId: string; postId: string; level: 0 | 1 | 2 | 3; manual: boolean }[];
};

/**
 * 숙련도 표 of one factory: its active persons (사번 order) × its active posts (sort order), each cell the
 * engine's skillLevel and whether a manual skills row decides it. No phone or other personal fields.
 */
export function skillGrid(snap: Snapshot, factoryId: string): SkillGrid {
  if (!snap.factories.some((f) => f.id === factoryId)) throw new EngineError('BAD_INPUT', 'unknown factory');
  const persons = snap.persons.filter((p) => p.active && p.factoryId === factoryId);
  const posts = snap.posts.filter((p) => p.active && p.factoryId === factoryId); // snapshot keeps sort, code order
  const manual = new Set(snap.skills.map((s) => `${s.personId}:${s.postId}`));
  return {
    persons: persons.map((p) => ({ id: p.id, empNo: p.empNo, name: p.name, crew: p.crew })),
    posts: posts.map((p) => ({ id: p.id, code: p.code, name: p.name, kind: p.kind })),
    cells: persons.flatMap((p) =>
      posts.map((post) => ({ personId: p.id, postId: post.id, level: skillLevel(snap, p.id, post.id), manual: manual.has(`${p.id}:${post.id}`) })),
    ),
  };
}
