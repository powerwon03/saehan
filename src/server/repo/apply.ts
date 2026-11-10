import { and, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { EngineError, type Changes, type TableName } from '@/engine/types';
import type { Tx } from '../db/client';
import * as t from '../db/schema';

type Row = Record<string, unknown>;

/** Engine table name → DB table and the key its upserts conflict on (Drizzle field names). */
const TABLES = {
  assignments: { table: t.assignments, key: ['id'] },
  absences: { table: t.absences, key: ['id'] },
  subRequests: { table: t.subRequests, key: ['id'] },
  leaves: { table: t.leaveRequests, key: ['id'] },
  boards: { table: t.boards, key: ['companyId', 'date', 'shift', 'factoryId'] },
  plans: { table: t.planCells, key: ['companyId', 'date', 'shift', 'postId'] },
} as const satisfies Record<TableName, { table: PgTable; key: readonly string[] }>;

const REMOVABLE = {
  assignments: t.assignments,
  absences: t.absences,
  subRequests: t.subRequests,
  leaves: t.leaveRequests,
} as const;

/** Upserts run parents-first so FKs between rows of one Changes (subRequests → absences) always resolve. */
const UPSERT_ORDER: readonly TableName[] = ['boards', 'plans', 'absences', 'assignments', 'subRequests', 'leaves'];

/** Keeps each statement well under Postgres' 65535 bind-parameter limit. */
const CHUNK = 500;

/**
 * Persist engine Changes for one company: all removes, then upserts, then messages.
 * company_id is always forced to `companyId`; rows of other companies are never touched: an upsert whose
 * key already belongs to another company throws DATA_INTEGRITY (rolling back the transaction).
 */
export async function applyChanges(tx: Tx, companyId: string, changes: Changes, now: Date): Promise<void> {
  for (const [name, ids] of Object.entries(changes.remove) as [TableName, string[]][]) {
    if (ids.length === 0) continue;
    if (!(name in REMOVABLE)) throw new Error(`applyChanges: remove is not supported for ${name}`);
    const table = REMOVABLE[name as keyof typeof REMOVABLE];
    await tx.delete(table).where(and(eq(table.companyId, companyId), inArray(table.id, ids)));
  }

  for (const name of UPSERT_ORDER) {
    const rows = changes.upsert[name];
    if (!rows || rows.length === 0) continue;
    const { table, key } = TABLES[name];
    const forced: Row[] = rows.map((r) => ({ ...(r as Row), companyId }));
    const unique = [...new Map(forced.map((r) => [key.map((k) => String(r[k])).join('|'), r])).values()];
    for (let i = 0; i < unique.length; i += CHUNK) {
      await upsert(tx, companyId, table, key, unique.slice(i, i + CHUNK));
    }
  }

  if (changes.messages.length > 0) {
    await tx.insert(t.messages).values(changes.messages.map((m) => ({ ...m, companyId, createdAt: now })));
  }
}

async function upsert(tx: Tx, companyId: string, table: PgTable, key: readonly string[], rows: Row[]): Promise<void> {
  const cols = getTableColumns(table);
  const set: Record<string, SQL> = {};
  for (const [field, col] of Object.entries(cols)) {
    if (field !== 'companyId' && !key.includes(field)) set[field] = sql`excluded.${sql.identifier(col.name)}`;
  }
  // A conflicting row of another company fails setWhere, is neither updated nor returned → count mismatch.
  const written = await tx
    .insert(table)
    .values(rows as PgTable['$inferInsert'][])
    .onConflictDoUpdate({ target: key.map((k) => cols[k]), set, setWhere: eq(cols.companyId, companyId) })
    .returning({ one: sql<number>`1` });
  if (written.length !== rows.length) {
    throw new EngineError('DATA_INTEGRITY', 'upsert key belongs to another company');
  }
}
