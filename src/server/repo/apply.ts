import { and, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Changes, TableName } from '@/engine/types';
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

/** Keeps each statement well under Postgres' 65535 bind-parameter limit. */
const CHUNK = 500;

/**
 * Persist engine Changes for one company: all removes, then upserts, then messages.
 * company_id is always forced to `companyId`; rows of other companies are never touched.
 */
export async function applyChanges(tx: Tx, companyId: string, changes: Changes, now: Date): Promise<void> {
  for (const [name, ids] of Object.entries(changes.remove) as [TableName, string[]][]) {
    if (ids.length === 0) continue;
    if (!(name in REMOVABLE)) throw new Error(`applyChanges: remove is not supported for ${name}`);
    const table = REMOVABLE[name as keyof typeof REMOVABLE];
    await tx.delete(table).where(and(eq(table.companyId, companyId), inArray(table.id, ids)));
  }

  for (const [name, rows] of Object.entries(changes.upsert) as [TableName, object[]][]) {
    const { table, key } = TABLES[name];
    const forced: Row[] = rows.map((r) => ({ ...(r as Row), companyId }));
    const unique = [...new Map(forced.map((r) => [key.map((k) => String(r[k])).join('|'), r])).values()];
    for (let i = 0; i < unique.length; i += CHUNK) {
      await upsert(tx, table, key, unique.slice(i, i + CHUNK));
    }
  }

  if (changes.messages.length > 0) {
    await tx.insert(t.messages).values(changes.messages.map((m) => ({ ...m, companyId, createdAt: now })));
  }
}

async function upsert(tx: Tx, table: PgTable, key: readonly string[], rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  const cols = getTableColumns(table);
  const set: Record<string, SQL> = {};
  for (const [field, col] of Object.entries(cols)) {
    if (!key.includes(field)) set[field] = sql`excluded.${sql.identifier(col.name)}`;
  }
  await tx
    .insert(table)
    .values(rows as PgTable['$inferInsert'][])
    .onConflictDoUpdate({ target: key.map((k) => cols[k]), set });
}
