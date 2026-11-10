import { rosterFor } from '@/engine/autoAssign';
import { computeSlots, effectivePlan, postNeed } from '@/engine/demand';
import { idlePeople, recommendFor, type Candidate } from '@/engine/recommend';
import type { Absence, AbsenceKind, DateStr, Post, Shift, Snapshot, SubRequest } from '@/engine/types';

const CANDIDATE_STATUSES: Absence['status'][] = ['decided', 'in-progress', 'failed'];

type PersonRef = { personId: string; name: string; empNo: string };

export type BoardView = {
  factory: { id: string; code: string; name: string };
  date: DateStr;
  shift: Shift;
  status: 'none' | 'draft' | 'confirmed';
  summary: { need: number; present: number; diff: number };
  lines: {
    post: Pick<Post, 'id' | 'code' | 'name' | 'kind' | 'role'>;
    plan: { productId: string | null; status: 'run' | 'off' | 'unmanned' };
    stopped: boolean;
    need: number;
    people: (PersonRef & { assignmentId: string; source: string; locked: boolean; flags: string[] })[];
    vacancies: number;
  }[];
  idle: PersonRef[];
  absences: {
    id: string;
    person: PersonRef;
    post: { id: string; code: string; name: string } | null;
    kind: AbsenceKind;
    status: Absence['status'];
    createdAt: Date;
    resolvedAt: Date | null;
    resolvedPerson: PersonRef | null;
    requests: { id: string; personId: string; name: string; status: SubRequest['status']; expiresAt: Date }[];
    candidates: (Candidate & { name: string; empNo: string; factoryName: string })[];
  }[];
  products: { id: string; code: string; name: string }[];
};

/** Pure admin board view model. Reasons/warnings/flags stay as codes; the screen maps them through the dictionary. */
export function boardView(
  snap: Snapshot,
  { factoryId, date, shift }: { factoryId: string; date: DateStr; shift: Shift },
): BoardView {
  const factory = snap.factories.find((f) => f.id === factoryId);
  if (!factory) throw new Error(`factory ${factoryId} not in snapshot`);

  const personRef = (id: string): PersonRef => {
    const p = snap.persons.find((x) => x.id === id);
    return { personId: id, name: p?.name ?? '', empNo: p?.empNo ?? '' };
  };
  const inSlot = (a: { date: DateStr; shift: Shift; factoryId: string }) =>
    a.factoryId === factoryId && a.date === date && a.shift === shift;

  const board = snap.boards.find((b) => inSlot(b));
  const plan = effectivePlan(snap, factoryId, date, shift);
  const needs = postNeed(snap, factoryId, date, shift);
  const stopped = new Set(board?.stoppedPostIds ?? []);
  const assignments = snap.assignments.filter(inSlot);

  const lines = snap.posts
    .filter((p) => p.factoryId === factoryId && p.active)
    .sort((a, b) => a.sort - b.sort || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((p) => {
      const need = needs.get(p.id) ?? 0;
      const people = assignments
        .filter((a) => a.postId === p.id)
        .map((a) => ({
          assignmentId: a.id,
          ...personRef(a.personId),
          source: a.source,
          locked: a.locked,
          flags: a.flags,
        }));
      return {
        post: { id: p.id, code: p.code, name: p.name, kind: p.kind, role: p.role },
        plan: plan.get(p.id) ?? { productId: null, status: 'run' as const },
        stopped: stopped.has(p.id),
        need,
        people,
        vacancies: Math.max(0, need - people.length),
      };
    });

  const roster = rosterFor(snap, factoryId, date, shift);
  const rosterSet = new Set(roster);
  const present = roster.length + assignments.filter((a) => !rosterSet.has(a.personId)).length;
  const need = lines.reduce((sum, l) => sum + l.need, 0);

  const absences = snap.absences
    .filter((a) => inSlot(a) && a.status !== 'cancelled')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((a) => {
      const post = a.postId ? snap.posts.find((p) => p.id === a.postId) : undefined;
      let candidates: BoardView['absences'][number]['candidates'] = [];
      if (post && CANDIDATE_STATUSES.includes(a.status)) {
        const gender = computeSlots(snap, factoryId, date, shift).find((s) => s.postId === post.id)?.gender ?? null;
        candidates = recommendFor(snap, { factoryId, date, shift, postId: post.id, gender }).map((c) => ({
          ...c,
          name: personRef(c.personId).name,
          empNo: personRef(c.personId).empNo,
          factoryName: snap.factories.find((f) => f.id === c.factoryId)?.name ?? '',
        }));
      }
      return {
        id: a.id,
        person: personRef(a.personId),
        post: post ? { id: post.id, code: post.code, name: post.name } : null,
        kind: a.kind,
        status: a.status,
        createdAt: a.createdAt,
        resolvedAt: a.resolvedAt,
        resolvedPerson: a.resolvedPersonId ? personRef(a.resolvedPersonId) : null,
        requests: snap.subRequests
          .filter((r) => r.absenceId === a.id)
          .map((r) => ({ id: r.id, personId: r.personId, name: personRef(r.personId).name, status: r.status, expiresAt: r.expiresAt })),
        candidates,
      };
    });

  return {
    factory: { id: factory.id, code: factory.code, name: factory.name },
    date,
    shift,
    status: board ? board.status : 'none',
    summary: { need, present, diff: present - need },
    lines,
    idle: idlePeople(snap, factoryId, date, shift).map(personRef),
    absences,
    products: snap.products.filter((p) => p.active).map((p) => ({ id: p.id, code: p.code, name: p.name })),
  };
}
