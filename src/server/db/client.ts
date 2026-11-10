import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from './schema';

/** Drizzle handle usable for both drivers (postgres-js in production, PGlite locally and in tests). */
export type DB = PgDatabase<any, typeof schema>;
/** Transaction handle passed to `db.transaction(fn)`. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
/** Either a database handle or a transaction: read/write helpers accept both. */
export type Executor = DB | Tx;

const MIGRATIONS = path.resolve(process.cwd(), 'drizzle');
const DEFAULT_LOCAL_DIR = './.data/pglite';

type Opened = { db: DB; close: () => Promise<void>; migrate: () => Promise<void> };
let testDb: DB | null = null;

/** Tests: make getDb() return this handle (null restores normal behaviour). */
export function setDbForTests(db: DB | null): void {
  testDb = db;
}

const g = globalThis as typeof globalThis & { __onetouchDb?: Promise<Opened> };

/**
 * `DATABASE_URL` set → postgres-js (`prepare: false`, Supabase pooler compatible).
 * Otherwise PGlite at `$PGLITE_DIR` (default `./.data/pglite`), migrated on first call. Cached on globalThis (Next dev hot reload).
 */
export async function getDb(): Promise<DB> {
  if (testDb) return testDb;
  return (await opened()).db;
}

/** Apply pending migrations from ./drizzle to the getDb() database. */
export async function migrateDb(): Promise<void> {
  await (await opened()).migrate();
}

/** Close the cached connection (scripts). */
export async function closeDb(): Promise<void> {
  const cur = g.__onetouchDb;
  g.__onetouchDb = undefined;
  if (cur) await (await cur).close();
}

function opened(): Promise<Opened> {
  if (!g.__onetouchDb) {
    g.__onetouchDb = open();
    g.__onetouchDb.catch(() => {
      g.__onetouchDb = undefined;
    });
  }
  return g.__onetouchDb;
}

async function open(): Promise<Opened> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import('postgres');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    const client = postgres(url, { prepare: false });
    const db = drizzle(client, { schema });
    return { db, close: () => client.end(), migrate: () => migrate(db, { migrationsFolder: MIGRATIONS }) };
  }
  const localDir = process.env.PGLITE_DIR || DEFAULT_LOCAL_DIR;
  mkdirSync(localDir, { recursive: true });
  const { db, close } = await openPglite(localDir);
  return { db, close, migrate: async () => {} };
}

/** PGlite database (in-memory when dataDir is omitted) with all migrations applied. */
export async function openPglite(dataDir?: string): Promise<{ db: DB; close: () => Promise<void> }> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => client.close() };
}
