import { closeDb, getDb, migrateDb } from '../src/server/db/client';
import { createCompany } from '../src/server/seed/createCompany';

// npm run company:create -- <code> <name> --admin=<id> --password=<pw>
async function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const [code, name] = positional;
  const adminId = flag('admin');
  const adminPassword = flag('password');
  if (!code || !name || !adminId || !adminPassword) {
    console.error('usage: npm run company:create -- <code> <name> --admin=<id> --password=<pw>');
    process.exit(1);
  }
  await migrateDb();
  try {
    await createCompany(await getDb(), { code, name, adminId, adminPassword });
    console.log(`회사 생성: ${code} (${adminId})`);
  } finally {
    await closeDb();
  }
}

main().catch((e: unknown) => {
  console.error((e as { code?: string }).code ?? (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
