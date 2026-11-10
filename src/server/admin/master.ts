import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { EngineError } from '@/engine/types';
import type { Executor as Tx } from '@/server/db/client';
import * as t from '@/server/db/schema';
import { dateStr, id } from './common';

export const KINDS = ['factories', 'posts', 'products', 'standards'] as const;
export type Kind = (typeof KINDS)[number];
export const Kind = z.enum(KINDS);

const text = z.string().trim().min(1).max(100);
const int = (min: number, max: number) => z.number().int().min(min).max(max);

// Spec §2 columns of each table, minus id and company_id (never from the client).
const create = {
  factories: z.object({
    code: text,
    name: text,
    approval: z.enum(['confirm', 'draft-decide']).optional(),
    leaderPhone: z.string().trim().max(50).nullable().optional(),
    cycleBaseDate: dateStr,
    sort: int(0, 9999).optional(),
  }),
  posts: z.object({
    factoryId: id,
    code: text,
    name: text,
    kind: z.enum(['line', 'fixed']),
    role: z.string().trim().max(50).nullable().optional(),
    unmanned: z.boolean().optional(),
    priority: int(0, 9999).optional(),
    defaultNeed: int(0, 99).optional(),
    active: z.boolean().optional(),
    sort: int(0, 9999).optional(),
  }),
  products: z.object({ code: text, name: text, urgent: z.boolean().optional(), active: z.boolean().optional() }),
  standards: z.object({ postId: id, productId: id.nullable().optional(), need: int(0, 99), gender: z.enum(['M', 'F']).nullable().optional() }),
} as const;

export const createSchema = (k: Kind) => create[k];
export const patchSchema = (k: Kind) => create[k].partial().extend({ id });

const bad = (msg: string) => new EngineError('BAD_INPUT', msg);
const TABLE = { factories: t.factories, posts: t.posts, products: t.products, standards: t.standards } as const;
// One localized loosening: the four tables share id/company_id columns but have no common drizzle type.
const tbl = (k: Kind) => TABLE[k] as unknown as typeof t.products;

type Row = Record<string, unknown>;

export async function listMaster(tx: Tx, companyId: string, k: Kind): Promise<Row[]> {
  const T = tbl(k);
  const order =
    k === 'factories' ? [asc(t.factories.sort), asc(t.factories.code)]
    : k === 'posts' ? [asc(t.posts.sort), asc(t.posts.code)]
    : k === 'products' ? [asc(t.products.code)]
    : [asc(t.standards.postId), asc(t.standards.id)];
  return tx.select().from(T).where(eq(T.companyId, companyId)).orderBy(...order);
}

async function getRow(tx: Tx, companyId: string, k: Kind, rowId: string): Promise<Row> {
  const T = tbl(k);
  const [r] = await tx.select().from(T).where(and(eq(T.id, rowId), eq(T.companyId, companyId)));
  if (!r) throw bad(`unknown ${k} row`);
  return r;
}

async function own(tx: Tx, companyId: string, k: Kind, rowId: string): Promise<void> {
  await getRow(tx, companyId, k, rowId);
}

/** Referenced ids must belong to the company; `v` is the final (merged) row. */
async function checkRefs(tx: Tx, companyId: string, k: Kind, v: Row): Promise<void> {
  if (k === 'posts') await own(tx, companyId, 'factories', v.factoryId as string);
  if (k === 'standards') {
    await own(tx, companyId, 'posts', v.postId as string);
    if (v.productId) await own(tx, companyId, 'products', v.productId as string);
  }
}

async function isDuplicate(tx: Tx, companyId: string, k: Kind, v: Row, selfId?: string): Promise<boolean> {
  const notSelf = (col: AnyPgColumn) => (selfId ? [ne(col, selfId)] : []);
  if (k === 'factories') {
    const r = await tx.select({ id: t.factories.id }).from(t.factories).where(and(eq(t.factories.companyId, companyId), eq(t.factories.code, v.code as string), ...notSelf(t.factories.id)));
    return r.length > 0;
  }
  if (k === 'posts') {
    const r = await tx.select({ id: t.posts.id }).from(t.posts).where(and(eq(t.posts.companyId, companyId), eq(t.posts.factoryId, v.factoryId as string), eq(t.posts.code, v.code as string), ...notSelf(t.posts.id)));
    return r.length > 0;
  }
  if (k === 'products') {
    const r = await tx.select({ id: t.products.id }).from(t.products).where(and(eq(t.products.companyId, companyId), eq(t.products.code, v.code as string), ...notSelf(t.products.id)));
    return r.length > 0;
  }
  const productMatch = v.productId ? eq(t.standards.productId, v.productId as string) : sql`${t.standards.productId} is null`;
  const r = await tx.select({ id: t.standards.id }).from(t.standards).where(and(eq(t.standards.companyId, companyId), eq(t.standards.postId, v.postId as string), productMatch, ...notSelf(t.standards.id)));
  return r.length > 0;
}

export async function createMaster(tx: Tx, companyId: string, k: Kind, input: Row): Promise<Row> {
  await checkRefs(tx, companyId, k, input);
  if (await isDuplicate(tx, companyId, k, input)) throw new EngineError('DUPLICATE_CODE');
  const T = tbl(k);
  const [row] = await tx.insert(T).values({ ...input, companyId } as never).returning();
  return row;
}

export async function updateMaster(tx: Tx, companyId: string, k: Kind, rowId: string, patch: Row): Promise<Row> {
  const cur = await getRow(tx, companyId, k, rowId);
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (Object.keys(set).length === 0) return cur;
  const merged = { ...cur, ...set };
  await checkRefs(tx, companyId, k, merged);
  if (await isDuplicate(tx, companyId, k, merged, rowId)) throw new EngineError('DUPLICATE_CODE');
  const T = tbl(k);
  const [row] = await tx.update(T).set(set as never).where(and(eq(T.id, rowId), eq(T.companyId, companyId))).returning();
  return row;
}

const any = async (q: Promise<unknown[]>) => (await q).length > 0;

/** Hard delete when unreferenced; products/posts in use are deactivated instead; factories in use are refused. */
export async function deleteMaster(tx: Tx, companyId: string, k: Kind, rowId: string): Promise<{ softDeleted: boolean }> {
  await getRow(tx, companyId, k, rowId);
  const T = tbl(k);
  const hardDelete = async () => {
    await tx.delete(T).where(and(eq(T.id, rowId), eq(T.companyId, companyId)));
    return { softDeleted: false };
  };
  if (k === 'standards') return hardDelete();

  if (k === 'factories') {
    const used =
      (await any(tx.select({ x: t.posts.id }).from(t.posts).where(eq(t.posts.factoryId, rowId)).limit(1))) ||
      (await any(tx.select({ x: t.persons.id }).from(t.persons).where(eq(t.persons.factoryId, rowId)).limit(1))) ||
      (await any(tx.select({ x: t.assignments.id }).from(t.assignments).where(eq(t.assignments.factoryId, rowId)).limit(1))) ||
      (await any(tx.select({ x: t.absences.id }).from(t.absences).where(eq(t.absences.factoryId, rowId)).limit(1))) ||
      (await any(tx.select({ x: t.boards.factoryId }).from(t.boards).where(eq(t.boards.factoryId, rowId)).limit(1)));
    if (used) throw new EngineError('IN_USE');
    return hardDelete();
  }

  const used =
    k === 'products'
      ? (await any(tx.select({ x: t.planCells.postId }).from(t.planCells).where(eq(t.planCells.productId, rowId)).limit(1))) ||
        (await any(tx.select({ x: t.standards.id }).from(t.standards).where(eq(t.standards.productId, rowId)).limit(1))) ||
        (await any(tx.select({ x: t.experienceBase.id }).from(t.experienceBase).where(eq(t.experienceBase.productId, rowId)).limit(1)))
      : (await any(tx.select({ x: t.planCells.postId }).from(t.planCells).where(eq(t.planCells.postId, rowId)).limit(1))) ||
        (await any(tx.select({ x: t.standards.id }).from(t.standards).where(eq(t.standards.postId, rowId)).limit(1))) ||
        (await any(tx.select({ x: t.assignments.id }).from(t.assignments).where(eq(t.assignments.postId, rowId)).limit(1))) ||
        (await any(tx.select({ x: t.absences.id }).from(t.absences).where(eq(t.absences.postId, rowId)).limit(1))) ||
        (await any(tx.select({ x: t.skills.postId }).from(t.skills).where(eq(t.skills.postId, rowId)).limit(1))) ||
        (await any(tx.select({ x: t.experienceBase.id }).from(t.experienceBase).where(eq(t.experienceBase.postId, rowId)).limit(1))) ||
        (await any(tx.select({ x: t.persons.id }).from(t.persons).where(eq(t.persons.fixedPostId, rowId)).limit(1)));
  if (!used) return hardDelete();
  await tx.update(T).set({ active: false } as never).where(and(eq(T.id, rowId), eq(T.companyId, companyId)));
  return { softDeleted: true };
}
