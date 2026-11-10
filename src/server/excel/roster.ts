import { and, eq } from 'drizzle-orm';
import type { Crew, DateStr, Person } from '@/engine/types';
import { retirePerson } from '@/server/admin/persons';
import type { Tx } from '@/server/db/client';
import * as t from '@/server/db/schema';
import { headerIndex, isBlankRow, parseDate, summarize, text, type ImportPreview, type SheetRows } from './detect';
import { loadRefs, type Refs } from './refs';

const AFFILIATION: Record<string, Person['affiliation']> = {
  직영: 'direct', direct: 'direct', 협력사: 'partner', partner: 'partner', 임시: 'temp', temp: 'temp',
};
const CREW: Record<string, Crew> = { A: 'A', B: 'B', C: 'C', 주간: 'D', D: 'D' };
const GENDER: Record<string, 'M' | 'F'> = { 남: 'M', M: 'M', 여: 'F', F: 'F' };
const LANG: Record<string, Person['lang']> = { 한국어: 'ko', ko: 'ko', 영어: 'en', en: 'en', 몽골어: 'mn', mn: 'mn', 베트남어: 'vi', vi: 'vi' };

export const ROSTER_HEADERS = ['사번', '이름', '소속', '조', '역할', '성별', '전화', '공장', '언어', '입사일', '퇴사일', '지정자리'] as const;

type Fields = Partial<{
  name: string;
  affiliation: Person['affiliation'];
  crew: Crew;
  role: string | null;
  gender: 'M' | 'F' | null;
  phone: string | null;
  factoryId: string;
  lang: Person['lang'];
  fixedPostId: string | null;
  hiredAt: DateStr | null;
}>;
type Parsed = {
  row: number;
  key: string;
  errors: string[];
  existing: Person | undefined;
  empNo: string;
  /** Only the columns to write: for an update a blank cell is absent (= keep); for an add blanks carry defaults. */
  fields: Fields;
  skills: { postId: string; level: 0 | 1 | 2 | 3 }[];
  leftAt: DateStr | null;
};

function lookup<V>(map: Record<string, V>, v: string): V | undefined {
  return map[v] ?? map[v.toUpperCase()] ?? map[v.toLowerCase()];
}

function parseRoster(refs: Refs, rows: SheetRows): Parsed[] {
  const idx = headerIndex(rows);
  const baseHeaders = new Set<string>(ROSTER_HEADERS);
  const postCodes = new Set(refs.posts.map((p) => p.code));
  const skillCols = [...idx].filter(([h]) => !baseHeaders.has(h) && postCodes.has(h));
  const byEmpNo = new Map(refs.persons.map((p) => [p.empNo, p]));
  const seen = new Set<string>();
  const out: Parsed[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (isBlankRow(r)) continue;
    const cell = (h: string) => (idx.has(h) ? r[idx.get(h)!] : null);
    const val = (h: string) => text(cell(h));
    const errors: string[] = [];
    const fields: Fields = {};
    const empNo = val('사번');
    const existing = empNo ? byEmpNo.get(empNo) : undefined;
    const isAdd = !existing;
    const p: Parsed = { row: i + 1, key: empNo, errors, existing, empNo, fields, skills: [], leftAt: null };
    out.push(p);

    if (!empNo) errors.push('사번이 없습니다');
    else if (seen.has(empNo)) errors.push('파일 안에서 사번이 중복됩니다');
    else seen.add(empNo);

    const name = val('이름');
    if (!name) errors.push('이름이 없습니다');
    else fields.name = name;

    /** Mapped enum column: blank → `dflt` (only when adding), otherwise a bad value is an error. */
    const mapped = <V>(h: string, map: Record<string, V>, dflt: V | undefined, set: (v: V) => void) => {
      const v = val(h);
      if (!v) {
        if (isAdd && dflt !== undefined) set(dflt);
        return;
      }
      const m = lookup(map, v);
      if (m === undefined) errors.push(`${h} 값이 올바르지 않습니다: ${v}`);
      else set(m);
    };
    mapped('소속', AFFILIATION, 'direct', (v) => (fields.affiliation = v));
    mapped('성별', GENDER, undefined, (v) => (fields.gender = v));
    if (isAdd && !val('성별')) fields.gender = null;
    mapped('언어', LANG, 'ko', (v) => (fields.lang = v));
    if (!val('조')) errors.push('조가 없습니다');
    else mapped('조', CREW, undefined, (v) => (fields.crew = v));

    for (const [h, key] of [['역할', 'role'], ['전화', 'phone']] as const) {
      const v = val(h);
      if (v) fields[key] = v;
      else if (isAdd) fields[key] = null;
    }

    const dateOf = (h: string): DateStr | null => {
      if (val(h) === '') return null;
      const d = parseDate(cell(h));
      if (!d) errors.push(`${h} 날짜가 올바르지 않습니다`);
      return d;
    };
    const hired = dateOf('입사일');
    if (hired) fields.hiredAt = hired;
    else if (isAdd) fields.hiredAt = null;
    p.leftAt = dateOf('퇴사일');

    const fname = val('공장');
    let factoryId: string | null = null;
    if (!fname) errors.push('공장이 없습니다');
    else {
      const f = refs.factories.find((x) => x.name === fname) ?? refs.factories.find((x) => x.code === fname);
      if (!f) errors.push(`없는 공장: ${fname}`);
      else {
        factoryId = f.id;
        fields.factoryId = f.id;
      }
    }

    const fixed = val('지정자리');
    if (fixed) {
      if (factoryId) {
        const post = refs.posts.find((x) => x.factoryId === factoryId && x.code === fixed);
        if (!post) errors.push(`없는 지정자리: ${fixed}`);
        else fields.fixedPostId = post.id;
      }
    } else if (isAdd) fields.fixedPostId = null;

    for (const [h, col] of skillCols) {
      const raw = r[col];
      if (text(raw) === '') continue;
      const n = typeof raw === 'number' ? raw : Number(text(raw));
      if (!Number.isInteger(n) || n < 0 || n > 3) {
        errors.push(`숙련도(${h})는 0~3이어야 합니다: ${text(raw)}`);
        continue;
      }
      if (!factoryId) continue;
      const post = refs.posts.find((x) => x.factoryId === factoryId && x.code === h);
      if (!post) errors.push(`숙련도(${h}): 해당 공장에 없는 자리`);
      else p.skills.push({ postId: post.id, level: n as 0 | 1 | 2 | 3 });
    }
  }
  return out;
}

export function previewRoster(snap: Refs, rows: SheetRows): ImportPreview {
  return summarize(
    'roster',
    parseRoster(snap, rows).map((p) => ({
      row: p.row,
      action: p.errors.length ? 'error' : p.existing ? 'update' : 'add',
      key: p.key,
      errors: p.errors,
    })),
  );
}

/**
 * Apply every valid row (error rows are skipped) inside the caller's transaction. New persons get a worker account
 * with an unusable secret ('!', mustChange): the admin must reset the PIN before they can log in.
 */
export async function commitRoster(tx: Tx, companyId: string, rows: SheetRows, now: Date): Promise<ImportPreview['counts']> {
  const counts = { add: 0, update: 0, error: 0 };
  for (const p of parseRoster(await loadRefs(tx, companyId), rows)) {
    if (p.errors.length) {
      counts.error++;
      continue;
    }
    let personId: string;
    if (p.existing) {
      personId = p.existing.id;
      if (Object.keys(p.fields).length > 0) {
        await tx.update(t.persons).set(p.fields).where(and(eq(t.persons.id, personId), eq(t.persons.companyId, companyId)));
      }
      counts.update++;
    } else {
      const f = p.fields;
      const [row] = await tx
        .insert(t.persons)
        .values({
          companyId,
          empNo: p.empNo,
          name: f.name!,
          crew: f.crew!,
          factoryId: f.factoryId!,
          affiliation: f.affiliation ?? 'direct',
          lang: f.lang ?? 'ko',
          role: f.role ?? null,
          gender: f.gender ?? null,
          phone: f.phone ?? null,
          fixedPostId: f.fixedPostId ?? null,
          hiredAt: f.hiredAt ?? null,
        })
        .returning({ id: t.persons.id });
      personId = row.id;
      await tx.insert(t.accounts).values({ companyId, kind: 'worker', loginId: p.empNo, personId, secretHash: '!', mustChange: true });
      counts.add++;
    }
    for (const s of p.skills) {
      await tx
        .insert(t.skills)
        .values({ companyId, personId, postId: s.postId, level: s.level })
        .onConflictDoUpdate({ target: [t.skills.personId, t.skills.postId], set: { level: s.level } });
    }
    if (p.leftAt) await retirePerson(tx, companyId, personId, p.leftAt, now);
  }
  return counts;
}
