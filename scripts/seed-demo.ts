import { count, eq } from 'drizzle-orm';
import { closeDb, getDb, migrateDb } from '../src/server/db/client';
import * as t from '../src/server/db/schema';
import { seedDemo } from '../src/server/seed/demoData';

// npm run seed:demo -- --pin=<6digits> --admin-password=<pw> [--reset] [--seed=N]
async function main() {
  const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const pin = flag('pin');
  const adminPassword = flag('admin-password');
  const seed = flag('seed');
  if (!pin || !adminPassword) {
    console.error('usage: npm run seed:demo -- --pin=<6digits> --admin-password=<pw> [--reset] [--seed=N]');
    process.exit(1);
  }
  await migrateDb();
  const db = await getDb();
  try {
    const { companyId } = await seedDemo(db, {
      code: 'demo',
      pin,
      adminPassword,
      seed: seed === undefined ? undefined : Number(seed),
      reset: process.argv.includes('--reset'),
    });
    const n = async (table: typeof t.persons | typeof t.posts | typeof t.products | typeof t.factories | typeof t.accounts) => {
      const [row] = await db.select({ n: count() }).from(table).where(eq(table.companyId, companyId));
      return row.n;
    };
    console.log(
      `데모 생성: factories=${await n(t.factories)} posts=${await n(t.posts)} products=${await n(t.products)} persons=${await n(t.persons)} accounts=${await n(t.accounts)}`,
    );
  } finally {
    await closeDb();
  }
}

main().catch((e: unknown) => {
  console.error((e as { code?: string }).code ?? (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
