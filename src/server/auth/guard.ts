import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { EngineError } from '@/engine/types';
import { getDb } from '@/server/db/client';
import { accounts, persons } from '@/server/db/schema';
import { sessionFromRequest, type Session } from './session';

const reply = (status: number, error: string) => Response.json({ error }, { status });

async function authorize(
  req: Request,
  kind: Session['kind'] | null,
  allowMustChange = false,
): Promise<Session> {
  const s = sessionFromRequest(req);
  if (!s) throw reply(401, 'UNAUTHENTICATED');
  if (kind && s.kind !== kind) throw reply(403, 'FORBIDDEN');
  const db = await getDb();
  const [row] = await db
    .select({
      companyId: accounts.companyId,
      kind: accounts.kind,
      personId: accounts.personId,
      mustChange: accounts.mustChange,
      personActive: persons.active,
    })
    .from(accounts)
    .leftJoin(persons, eq(persons.id, accounts.personId))
    .where(eq(accounts.id, s.accountId));
  if (!row || row.companyId !== s.companyId || row.kind !== s.kind || row.personId !== s.personId)
    throw reply(401, 'UNAUTHENTICATED');
  if (s.kind === 'worker' && row.personActive !== true) throw reply(401, 'UNAUTHENTICATED');
  if (s.kind === 'worker' && row.mustChange && !allowMustChange) throw reply(403, 'MUST_CHANGE_PIN');
  return s;
}

/** Throws a 401/403 Response when the caller is not a valid admin. */
export const requireAdmin = (req: Request): Promise<Session> => authorize(req, 'admin');
/** Throws 401/403 when not a valid (active) worker; 403 MUST_CHANGE_PIN while must_change unless allowMustChange. */
export const requireWorker = (req: Request, opts: { allowMustChange?: boolean } = {}): Promise<Session> =>
  authorize(req, 'worker', opts.allowMustChange);
/** Any valid logged-in account (/api/me, /api/rev, /api/auth/secret). */
export const requireSession = (req: Request): Promise<Session> => authorize(req, null, true);

/** Route wrapper: thrown Response passes through; EngineError/ZodError become 400; anything else is a 500 with no detail. */
export function withApi<A extends unknown[]>(
  handler: (req: Request, ...rest: A) => Promise<Response> | Response,
): (req: Request, ...rest: A) => Promise<Response> {
  return async (req, ...rest) => {
    try {
      return await handler(req, ...rest);
    } catch (e) {
      if (e instanceof Response) return e;
      if (e instanceof EngineError) return reply(400, e.code);
      if (e instanceof ZodError) return reply(400, 'BAD_INPUT');
      console.error('[api] unhandled error:', e instanceof Error ? e.name : typeof e);
      return reply(500, 'INTERNAL');
    }
  };
}
