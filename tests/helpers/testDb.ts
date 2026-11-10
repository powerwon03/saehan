import { randomUUID } from 'node:crypto';
import { openPglite, type DB } from '@/server/db/client';
import * as t from '@/server/db/schema';

/** Fresh in-memory PGlite with all migrations applied. Create one per test file (seed a company per test). */
export async function createTestDb(): Promise<DB> {
  return (await openPglite()).db;
}

export type Seeded = {
  companyId: string;
  factoryId: string;
  /** [L1 line, L2 line, Q1 fixed] in sort order */
  postIds: string[];
  productId: string;
  /** empNo 1001..1006, crews A,A,B,B,C,C, all direct, factory F1, lang ko */
  personIds: string[];
};

/**
 * One company (unique random code) with a default settings row, factory F1 '1공장' (cycle_base_date 2025-04-27,
 * approval confirm), posts L1/L2 (line, default_need 1) + Q1 (fixed, role 'qc'), product P1, and six persons.
 */
export async function seedCompany(db: DB, over: { code?: string; name?: string } = {}): Promise<Seeded> {
  const [company] = await db
    .insert(t.companies)
    .values({ code: over.code ?? `co-${randomUUID().slice(0, 8)}`, name: over.name ?? '테스트 회사' })
    .returning({ id: t.companies.id });
  const companyId = company.id;
  await db.insert(t.settings).values({ companyId });

  const [factory] = await db
    .insert(t.factories)
    .values({ companyId, code: 'F1', name: '1공장', cycleBaseDate: '2025-04-27', sort: 0 })
    .returning({ id: t.factories.id });
  const factoryId = factory.id;

  const posts = await db
    .insert(t.posts)
    .values([
      { companyId, factoryId, code: 'L1', name: '1라인', kind: 'line', sort: 0 },
      { companyId, factoryId, code: 'L2', name: '2라인', kind: 'line', sort: 1 },
      { companyId, factoryId, code: 'Q1', name: '검사', kind: 'fixed', role: 'qc', sort: 2 },
    ])
    .returning({ id: t.posts.id });

  const [product] = await db
    .insert(t.products)
    .values({ companyId, code: 'P1', name: '제품1' })
    .returning({ id: t.products.id });

  const crews = ['A', 'A', 'B', 'B', 'C', 'C'] as const;
  const persons = await db
    .insert(t.persons)
    .values(crews.map((crew, i) => ({ companyId, empNo: `${1001 + i}`, name: `근무자${i + 1}`, crew, factoryId })))
    .returning({ id: t.persons.id });

  return {
    companyId,
    factoryId,
    postIds: posts.map((p) => p.id),
    productId: product.id,
    personIds: persons.map((p) => p.id),
  };
}
