import { and, asc, between, eq, getTableColumns, isNotNull, or, sql } from 'drizzle-orm';
import { addDays } from '@/engine/dates';
import { EngineError, type Absence, type DateStr, type ExperienceCounts, type Snapshot } from '@/engine/types';
import type { Executor } from '../db/client';
import * as t from '../db/schema';

/** Days loaded around `around` for assignments, absences, requests, leaves and boards. */
export const WINDOW_BEFORE = 35;
/** Plans reach further back (product history for recommendations). */
export const PLAN_WINDOW_BEFORE = 60;
export const WINDOW_AFTER = 15;

/** Read one company's rows into the engine's Snapshot shape. Every query is scoped to companyId. */
export async function loadSnapshot(tx: Executor, companyId: string, around: DateStr): Promise<Snapshot> {
  const from = addDays(around, -WINDOW_BEFORE);
  const to = addDays(around, WINDOW_AFTER);
  const planFrom = addDays(around, -PLAN_WINDOW_BEFORE);

  const [settings] = await tx.select().from(t.settings).where(eq(t.settings.companyId, companyId));
  if (!settings) throw new EngineError('DATA_INTEGRITY', `settings missing for company ${companyId}`);

  const factories = await tx
    .select()
    .from(t.factories)
    .where(eq(t.factories.companyId, companyId))
    .orderBy(asc(t.factories.sort), asc(t.factories.code));
  const posts = await tx
    .select()
    .from(t.posts)
    .where(eq(t.posts.companyId, companyId))
    .orderBy(asc(t.posts.sort), asc(t.posts.code));
  const products = await tx
    .select()
    .from(t.products)
    .where(eq(t.products.companyId, companyId))
    .orderBy(asc(t.products.code));
  const standards = await tx
    .select()
    .from(t.standards)
    .where(eq(t.standards.companyId, companyId))
    .orderBy(asc(t.standards.id));
  const persons = await tx
    .select()
    .from(t.persons)
    .where(eq(t.persons.companyId, companyId))
    .orderBy(asc(t.persons.empNo));
  const skills = await tx
    .select({ personId: t.skills.personId, postId: t.skills.postId, level: t.skills.level })
    .from(t.skills)
    .where(eq(t.skills.companyId, companyId));

  const plans = await tx
    .select()
    .from(t.planCells)
    .where(and(eq(t.planCells.companyId, companyId), between(t.planCells.date, planFrom, to)))
    .orderBy(asc(t.planCells.date), asc(t.planCells.shift), asc(t.planCells.postId));
  const boards = await tx
    .select()
    .from(t.boards)
    .where(and(eq(t.boards.companyId, companyId), between(t.boards.date, from, to)))
    .orderBy(asc(t.boards.date), asc(t.boards.shift), asc(t.boards.factoryId));
  const assignments = await tx
    .select()
    .from(t.assignments)
    .where(and(eq(t.assignments.companyId, companyId), between(t.assignments.date, from, to)))
    .orderBy(asc(t.assignments.date), asc(t.assignments.shift), asc(t.assignments.createdAt), asc(t.assignments.id));
  const absences = await tx
    .select()
    .from(t.absences)
    .where(and(eq(t.absences.companyId, companyId), between(t.absences.date, from, to)))
    .orderBy(asc(t.absences.date), asc(t.absences.createdAt), asc(t.absences.id));
  const subRequests = await tx
    .select(getTableColumns(t.subRequests))
    .from(t.subRequests)
    .innerJoin(t.absences, eq(t.absences.id, t.subRequests.absenceId))
    .where(and(eq(t.subRequests.companyId, companyId), between(t.absences.date, from, to)))
    .orderBy(asc(t.subRequests.sentAt), asc(t.subRequests.rank), asc(t.subRequests.id));
  const leaves = await tx
    .select()
    .from(t.leaveRequests)
    .where(and(eq(t.leaveRequests.companyId, companyId), between(t.leaveRequests.date, from, to)))
    .orderBy(asc(t.leaveRequests.date), asc(t.leaveRequests.createdAt), asc(t.leaveRequests.id));

  return {
    companyId,
    settings,
    factories,
    posts,
    products,
    standards,
    plans,
    persons,
    skills,
    experience: await loadExperience(tx, companyId),
    assignments,
    boards,
    absences: absences.map(reviveRestore),
    subRequests,
    leaves,
  };
}

/** restore jsonb holds an Assignment whose createdAt was serialized to an ISO string. */
function reviveRestore(a: Absence): Absence {
  const r = a.restore as { createdAt?: unknown } | null;
  if (r === null || typeof r !== 'object' || typeof r.createdAt !== 'string') return a;
  return { ...a, restore: { ...r, createdAt: new Date(r.createdAt) } };
}

/**
 * Experience over all history (not windowed): experience_base rows + assignments on a confirmed board
 * + assignments with source 'sub' (each assignment counted once). Product experience uses the plan cell
 * for the assignment's (date, shift, post); no plan cell or no product → not counted for product.
 */
async function loadExperience(tx: Executor, companyId: string): Promise<ExperienceCounts> {
  const n = sql<number>`count(*)::int`;
  const total = sql<number>`sum(${t.experienceBase.count})::int`;
  const board = and(
    eq(t.boards.companyId, t.assignments.companyId),
    eq(t.boards.date, t.assignments.date),
    eq(t.boards.shift, t.assignments.shift),
    eq(t.boards.factoryId, t.assignments.factoryId),
  );
  const counted = and(
    eq(t.assignments.companyId, companyId),
    or(eq(t.assignments.source, 'sub'), eq(t.boards.status, 'confirmed')),
  );

  const basePost = await tx
    .select({ personId: t.experienceBase.personId, key: t.experienceBase.postId, n: total })
    .from(t.experienceBase)
    .where(and(eq(t.experienceBase.companyId, companyId), isNotNull(t.experienceBase.postId)))
    .groupBy(t.experienceBase.personId, t.experienceBase.postId);
  const baseProduct = await tx
    .select({ personId: t.experienceBase.personId, key: t.experienceBase.productId, n: total })
    .from(t.experienceBase)
    .where(and(eq(t.experienceBase.companyId, companyId), isNotNull(t.experienceBase.productId)))
    .groupBy(t.experienceBase.personId, t.experienceBase.productId);
  const workedPost = await tx
    .select({ personId: t.assignments.personId, key: t.assignments.postId, n })
    .from(t.assignments)
    .leftJoin(t.boards, board)
    .where(counted)
    .groupBy(t.assignments.personId, t.assignments.postId);
  const workedProduct = await tx
    .select({ personId: t.assignments.personId, key: t.planCells.productId, n })
    .from(t.assignments)
    .leftJoin(t.boards, board)
    .innerJoin(
      t.planCells,
      and(
        eq(t.planCells.companyId, t.assignments.companyId),
        eq(t.planCells.date, t.assignments.date),
        eq(t.planCells.shift, t.assignments.shift),
        eq(t.planCells.postId, t.assignments.postId),
      ),
    )
    .where(and(counted, isNotNull(t.planCells.productId)))
    .groupBy(t.assignments.personId, t.planCells.productId);

  const out: ExperienceCounts = {};
  const add = (dim: 'post' | 'product', rows: { personId: string; key: string | null; n: number }[]) => {
    for (const r of rows) {
      if (r.key === null) continue;
      const e = (out[r.personId] ??= { post: {}, product: {} });
      e[dim][r.key] = (e[dim][r.key] ?? 0) + Number(r.n);
    }
  };
  add('post', basePost);
  add('post', workedPost);
  add('product', baseProduct);
  add('product', workedProduct);
  return out;
}
