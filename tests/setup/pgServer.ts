import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { TestProject } from 'vitest/node';
import { openPostgres } from '../../src/server/db/client';

declare module 'vitest' {
  export interface ProvidedContext {
    pgUrl: string;
  }
}

/**
 * `npm run test:pg` global setup: an in-memory PGlite served over the Postgres wire protocol on a free local port,
 * migrated through the production postgres-js migrator. Test files connect to it with postgres-js (tests/helpers/testDb.ts).
 */
export default async function setup(project: TestProject) {
  const pg = await PGlite.create();
  const server = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0, maxConnections: 50 });
  await server.start();
  const port = server.getServerConn().split(':').pop();
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;

  const migrated = await openPostgres(url, { max: 1 });
  await migrated.migrate();
  await migrated.close();

  project.provide('pgUrl', url);
  return async () => {
    await server.stop();
    await pg.close();
  };
}
