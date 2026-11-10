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
 * Otherwise, outside production, PGlite at `$PGLITE_DIR` (default `./.data/pglite`), migrated on first call; in production
 * a missing `DATABASE_URL` throws. Cached on globalThis (Next dev hot reload).
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
  if (url) return openPostgres(url);
  if (process.env.NODE_ENV === 'production') {
    // a deployment without its connection string must fail loudly, not run on a throwaway local PGlite
    throw new Error('DATABASE_URL is not set: production needs a Postgres connection string (see .env.example)');
  }
  const localDir = process.env.PGLITE_DIR || DEFAULT_LOCAL_DIR;
  mkdirSync(localDir, { recursive: true });
  const { db, close } = await openPglite(localDir);
  return { db, close, migrate: async () => {} };
}

/**
 * postgres-js database (the production driver), not migrated. `npm run test:pg` runs it against a PGlite socket
 * server with `max: 1`: that server multiplexes connections onto one PGlite session message by message, which is only
 * safe for one connection at a time.
 */
export async function openPostgres(url: string, opts: { max?: number } = {}): Promise<Opened> {
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  // prepare: false for the Supabase transaction pooler; a small pool per serverless instance; fail fast when unreachable.
  const client = postgres(url, { prepare: false, max: opts.max ?? 5, idle_timeout: 20, connect_timeout: 10 });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end(), migrate: () => migrate(db, { migrationsFolder: MIGRATIONS }) };
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
