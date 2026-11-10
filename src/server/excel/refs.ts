import { eq } from 'drizzle-orm';
import type { Snapshot } from '@/engine/types';
import type { Executor } from '@/server/db/client';
import * as t from '@/server/db/schema';

/** The master data an import validates against (a Snapshot satisfies it too). */
export type Refs = Pick<Snapshot, 'factories' | 'posts' | 'products' | 'persons'>;

export async function loadRefs(tx: Executor, companyId: string): Promise<Refs> {
  const [factories, posts, products, persons] = await Promise.all([
    tx.select().from(t.factories).where(eq(t.factories.companyId, companyId)),
    tx.select().from(t.posts).where(eq(t.posts.companyId, companyId)),
    tx.select().from(t.products).where(eq(t.products.companyId, companyId)),
    tx.select().from(t.persons).where(eq(t.persons.companyId, companyId)),
  ]);
  return { factories, posts, products, persons };
}
