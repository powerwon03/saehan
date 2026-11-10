import type { listPersons, listWorkerAccounts } from '@/server/admin/persons';

// Pure helpers for the 근로자 screen (no React).

export type PersonRow = Awaited<ReturnType<typeof listPersons>>[number];
/** GET /api/admin/accounts row; dates arrive as ISO strings. */
export type AccountRow = Omit<Awaited<ReturnType<typeof listWorkerAccounts>>[number], 'lockedUntil'> & { lockedUntil: string | null };

/** Form state: every control is a string ('' = empty). */
export type PersonForm = {
  empNo: string;
  name: string;
  affiliation: PersonRow['affiliation'];
  crew: PersonRow['crew'];
  role: string;
  gender: '' | 'M' | 'F';
  phone: string;
  factoryId: string;
  lang: PersonRow['lang'];
  fixedPostId: string;
  hiredAt: string;
  pin: string;
};

export function emptyForm(factoryId: string, empNo: string): PersonForm {
  return { empNo, name: '', affiliation: 'direct', crew: 'A', role: '', gender: '', phone: '', factoryId, lang: 'ko', fixedPostId: '', hiredAt: '', pin: '' };
}

export function formFromPerson(p: PersonRow): PersonForm {
  return {
    empNo: p.empNo,
    name: p.name,
    affiliation: p.affiliation,
    crew: p.crew,
    role: p.role ?? '',
    gender: p.gender ?? '',
    phone: p.phone ?? '',
    factoryId: p.factoryId,
    lang: p.lang,
    fixedPostId: p.fixedPostId ?? '',
    hiredAt: p.hiredAt ?? '',
    pin: '',
  };
}

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/** Fields shared by create and edit; blank optional fields become null (clears them on edit). */
function common(f: PersonForm) {
  return {
    name: f.name.trim(),
    affiliation: f.affiliation,
    crew: f.crew,
    role: orNull(f.role),
    gender: f.gender === '' ? null : f.gender,
    phone: orNull(f.phone),
    factoryId: f.factoryId,
    lang: f.lang,
    fixedPostId: orNull(f.fixedPostId),
    hiredAt: orNull(f.hiredAt),
  };
}

/** POST /api/admin/persons body: a blank 사번 is left out so the server suggests one. */
export function createPayload(f: PersonForm) {
  const empNo = f.empNo.trim();
  return { ...(empNo ? { empNo } : {}), ...common(f), pin: f.pin };
}

/** PATCH /api/admin/persons/[id] body (no PIN: that is reset from the row menu). */
export function patchPayload(f: PersonForm) {
  return { empNo: f.empNo.trim(), ...common(f) };
}

/** Locked = lockedUntil still in the future. */
export function isLocked(a: Pick<AccountRow, 'lockedUntil'> | undefined, now: Date): boolean {
  return !!a?.lockedUntil && Date.parse(a.lockedUntil) > now.getTime();
}
