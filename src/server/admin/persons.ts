import { and, asc, eq, gte, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import { seoulDate } from '@/engine/time';
import { EngineError, type DateStr } from '@/engine/types';
import { createAccount } from '@/server/auth/accounts';
import { strongEnough } from '@/server/auth/login';
import { hashSecret } from '@/server/auth/hash';
import type { Executor as Tx } from '@/server/db/client';
import * as t from '@/server/db/schema';
import { dateStr, id } from './common';

type PersonRow = typeof t.persons.$inferSelect;

/** Next employee number: the numerically largest trailing number + 1, same prefix and zero-padded width. */
export function suggestEmpNo(existing: string[]): string {
  let best: { prefix: string; digits: string; n: bigint } | null = null;
  for (const e of existing) {
    const m = /^(.*?)(\d+)$/.exec(e);
    if (!m) continue;
    const n = BigInt(m[2]);
    if (!best || n > best.n) best = { prefix: m[1], digits: m[2], n };
  }
  if (!best) return '0001';
  return best.prefix + (best.n + 1n).toString().padStart(best.digits.length, '0');
}

const pin = z.string().refine((p) => strongEnough('worker', p));
const text = z.string().trim().min(1).max(100);
const optText = z.string().trim().max(100).nullable().optional();

const fields = {
  empNo: z.string().trim().min(1).max(30),
  name: text,
  affiliation: z.enum(['direct', 'partner', 'temp']),
  crew: z.enum(['A', 'B', 'C', 'D']),
  role: optText,
  gender: z.enum(['M', 'F']).nullable().optional(),
  phone: optText,
  factoryId: id,
  lang: z.enum(['ko', 'en', 'mn', 'vi']),
  fixedPostId: id.nullable().optional(),
  hiredAt: dateStr.nullable().optional(),
};

export const CreatePerson = z.object({
  ...fields,
  empNo: fields.empNo.optional(),
  lang: fields.lang.default('ko'),
  pin,
});
export const PatchPerson = z.object(fields).partial();
export const PersonAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('retire'), date: dateStr.optional() }),
  z.object({ action: z.literal('rehire') }),
]);
export const SkillBody = z.object({ personId: id, postId: id, level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).nullable() });
export const AccountBody = z.discriminatedUnion('action', [
  z.object({ personId: id, action: z.literal('unlock') }),
  z.object({ personId: id, action: z.literal('resetPin'), pin }),
]);

const bad = (msg: string) => new EngineError('BAD_INPUT', msg);

async function assertFactory(tx: Tx, companyId: string, factoryId: string): Promise<void> {
  const [r] = await tx.select({ id: t.factories.id }).from(t.factories).where(and(eq(t.factories.id, factoryId), eq(t.factories.companyId, companyId)));
  if (!r) throw bad('unknown factory');
}
async function assertPost(tx: Tx, companyId: string, postId: string): Promise<void> {
  const [r] = await tx.select({ id: t.posts.id }).from(t.posts).where(and(eq(t.posts.id, postId), eq(t.posts.companyId, companyId)));
  if (!r) throw bad('unknown post');
}
export async function getPerson(tx: Tx, companyId: string, personId: string): Promise<PersonRow> {
  const [r] = await tx.select().from(t.persons).where(and(eq(t.persons.id, personId), eq(t.persons.companyId, companyId)));
  if (!r) throw bad('unknown person');
  return r;
}
async function empNoTaken(tx: Tx, companyId: string, empNo: string, exceptId?: string): Promise<boolean> {
  const rows = await tx.select({ id: t.persons.id }).from(t.persons).where(and(eq(t.persons.companyId, companyId), eq(t.persons.empNo, empNo)));
  return rows.some((r) => r.id !== exceptId);
}

export async function listPersons(
  tx: Tx,
  companyId: string,
  f: { q?: string; active: 'true' | 'false' | 'all' },
): Promise<PersonRow[]> {
  const conds = [eq(t.persons.companyId, companyId)];
  if (f.active !== 'all') conds.push(eq(t.persons.active, f.active === 'true'));
  const q = f.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(t.persons.name, like), ilike(t.persons.empNo, like))!);
  }
  return tx.select().from(t.persons).where(and(...conds)).orderBy(asc(t.persons.empNo));
}

export async function createPerson(tx: Tx, companyId: string, input: z.infer<typeof CreatePerson>): Promise<PersonRow> {
  await assertFactory(tx, companyId, input.factoryId);
  if (input.fixedPostId) await assertPost(tx, companyId, input.fixedPostId);
  let empNo = input.empNo;
  if (!empNo) {
    const all = await tx.select({ e: t.persons.empNo }).from(t.persons).where(eq(t.persons.companyId, companyId));
    empNo = suggestEmpNo(all.map((r) => r.e));
  }
  if (await empNoTaken(tx, companyId, empNo)) throw new EngineError('DUPLICATE_CODE');
  const { pin: initialPin, empNo: _omit, ...rest } = input;
  const [person] = await tx
    .insert(t.persons)
    .values({ ...rest, companyId, empNo, role: rest.role ?? null, gender: rest.gender ?? null, phone: rest.phone ?? null, fixedPostId: rest.fixedPostId ?? null, hiredAt: rest.hiredAt ?? null })
    .returning();
  await createAccount(tx, { companyId, kind: 'worker', loginId: empNo, secret: initialPin, personId: person.id, mustChange: true });
  return person;
}

export async function updatePerson(tx: Tx, companyId: string, personId: string, patch: z.infer<typeof PatchPerson>): Promise<PersonRow> {
  const cur = await getPerson(tx, companyId, personId);
  if (patch.factoryId) await assertFactory(tx, companyId, patch.factoryId);
  if (patch.fixedPostId) await assertPost(tx, companyId, patch.fixedPostId);
  if (patch.empNo && patch.empNo !== cur.empNo) {
    if (await empNoTaken(tx, companyId, patch.empNo, personId)) throw new EngineError('DUPLICATE_CODE');
    await tx
      .update(t.accounts)
      .set({ loginId: patch.empNo })
      .where(and(eq(t.accounts.companyId, companyId), eq(t.accounts.personId, personId), eq(t.accounts.kind, 'worker')));
  }
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (Object.keys(set).length === 0) return cur;
  const [row] = await tx.update(t.persons).set(set).where(and(eq(t.persons.id, personId), eq(t.persons.companyId, companyId))).returning();
  return row;
}

/**
 * Retire: inactive + leftAt; remove placements from max(leftAt, today) on, cancel their open sub requests
 * ('sent') and pending leave requests. Exported for Task 12.
 */
export async function retirePerson(tx: Tx, companyId: string, personId: string, leftAt: DateStr, now: Date): Promise<void> {
  await getPerson(tx, companyId, personId);
  const today = seoulDate(now);
  const from = leftAt > today ? leftAt : today;
  await tx.update(t.persons).set({ active: false, leftAt }).where(and(eq(t.persons.id, personId), eq(t.persons.companyId, companyId)));
  await tx.delete(t.assignments).where(and(eq(t.assignments.companyId, companyId), eq(t.assignments.personId, personId), gte(t.assignments.date, from)));
  await tx
    .update(t.subRequests)
    .set({ status: 'cancelled' })
    .where(and(eq(t.subRequests.companyId, companyId), eq(t.subRequests.personId, personId), eq(t.subRequests.status, 'sent')));
  await tx
    .update(t.leaveRequests)
    .set({ status: 'cancelled', decidedAt: now })
    .where(and(eq(t.leaveRequests.companyId, companyId), eq(t.leaveRequests.personId, personId), eq(t.leaveRequests.status, 'pending')));
}

export async function rehirePerson(tx: Tx, companyId: string, personId: string): Promise<void> {
  await getPerson(tx, companyId, personId);
  await tx.update(t.persons).set({ active: true, leftAt: null }).where(and(eq(t.persons.id, personId), eq(t.persons.companyId, companyId)));
}

export async function deletePerson(tx: Tx, companyId: string, personId: string): Promise<void> {
  await getPerson(tx, companyId, personId);
  const has = async (q: Promise<unknown[]>) => (await q).length > 0;
  const history =
    (await has(tx.select({ x: t.assignments.id }).from(t.assignments).where(eq(t.assignments.personId, personId)).limit(1))) ||
    (await has(tx.select({ x: t.absences.id }).from(t.absences).where(or(eq(t.absences.personId, personId), eq(t.absences.resolvedPersonId, personId))).limit(1))) ||
    (await has(tx.select({ x: t.subRequests.id }).from(t.subRequests).where(eq(t.subRequests.personId, personId)).limit(1))) ||
    (await has(tx.select({ x: t.leaveRequests.id }).from(t.leaveRequests).where(eq(t.leaveRequests.personId, personId)).limit(1)));
  if (history) throw new EngineError('HAS_HISTORY');
  await tx.delete(t.skills).where(eq(t.skills.personId, personId));
  await tx.delete(t.experienceBase).where(eq(t.experienceBase.personId, personId));
  await tx.delete(t.messages).where(eq(t.messages.personId, personId));
  await tx.delete(t.accounts).where(and(eq(t.accounts.personId, personId), eq(t.accounts.companyId, companyId)));
  await tx.delete(t.persons).where(and(eq(t.persons.id, personId), eq(t.persons.companyId, companyId)));
}

/** level null removes the manual value (skillLevel falls back to fixed-post rules / experience). */
export async function setSkill(tx: Tx, companyId: string, a: z.infer<typeof SkillBody>): Promise<void> {
  await getPerson(tx, companyId, a.personId);
  await assertPost(tx, companyId, a.postId);
  if (a.level === null) {
    await tx.delete(t.skills).where(and(eq(t.skills.companyId, companyId), eq(t.skills.personId, a.personId), eq(t.skills.postId, a.postId)));
    return;
  }
  await tx
    .insert(t.skills)
    .values({ companyId, personId: a.personId, postId: a.postId, level: a.level })
    .onConflictDoUpdate({ target: [t.skills.personId, t.skills.postId], set: { level: a.level } });
}

export async function listWorkerAccounts(tx: Tx, companyId: string) {
  return tx
    .select({
      personId: t.accounts.personId,
      name: t.persons.name,
      empNo: t.persons.empNo,
      failedCount: t.accounts.failedCount,
      lockedUntil: t.accounts.lockedUntil,
      mustChange: t.accounts.mustChange,
    })
    .from(t.accounts)
    .innerJoin(t.persons, eq(t.persons.id, t.accounts.personId))
    .where(and(eq(t.accounts.companyId, companyId), eq(t.accounts.kind, 'worker')))
    .orderBy(asc(t.persons.empNo));
}

export async function accountAction(tx: Tx, companyId: string, a: z.infer<typeof AccountBody>): Promise<void> {
  await getPerson(tx, companyId, a.personId);
  const where = and(eq(t.accounts.companyId, companyId), eq(t.accounts.personId, a.personId), eq(t.accounts.kind, 'worker'));
  const set =
    a.action === 'unlock'
      ? { failedCount: 0, lockedUntil: null }
      : { secretHash: await hashSecret(a.pin), mustChange: true, failedCount: 0, lockedUntil: null };
  const done = await tx.update(t.accounts).set(set).where(where).returning({ id: t.accounts.id });
  if (done.length === 0) throw bad('no worker account');
}

