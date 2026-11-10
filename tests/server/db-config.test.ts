import { afterEach, describe, expect, test } from 'vitest';
import { closeDb, getDb, setDbForTests } from '@/server/db/client';

const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, DATABASE_URL: env.DATABASE_URL };

afterEach(async () => {
  env.NODE_ENV = saved.NODE_ENV;
  env.DATABASE_URL = saved.DATABASE_URL;
  await closeDb();
});

describe('getDb', () => {
  test('production에서 DATABASE_URL이 없으면 PGlite로 넘어가지 않고 분명한 오류', async () => {
    setDbForTests(null);
    await closeDb();
    env.NODE_ENV = 'production';
    delete env.DATABASE_URL;
    await expect(getDb()).rejects.toThrow(/DATABASE_URL/);
  });
});
