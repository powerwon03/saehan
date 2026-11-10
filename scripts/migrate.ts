import { closeDb, migrateDb } from '../src/server/db/client';

// DATABASE_URL set → migrate that Postgres; otherwise migrate the local PGlite at ./.data/pglite.
async function main() {
  await migrateDb();
  await closeDb();
  console.log(process.env.DATABASE_URL ? 'migrated DATABASE_URL' : 'migrated ./.data/pglite');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
