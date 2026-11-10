import { eq } from 'drizzle-orm';
import { EngineError, type Crew } from '@/engine/types';
import { createAccount } from '@/server/auth/accounts';
import { strongEnough } from '@/server/auth/login';
import type { DB, Executor } from '@/server/db/client';
import * as t from '@/server/db/schema';
import { createCompany } from './createCompany';

// Spec §6 demo company. Everything here is fictional; names are generated from syllable lists.

export type SeedDemoInput = {
  code?: string;
  pin: string;
  adminPassword: string;
  seed?: number;
  reset?: boolean;
};

type Lang = 'ko' | 'vi' | 'mn' | 'en';
type Prng = () => number;

/** mulberry32: small deterministic PRNG (no Math.random). */
function mulberry32(seed: number): Prng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rand: Prng, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const int = (rand: Prng, lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));

function shuffled<T>(rand: Prng, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const KO_SURNAME = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권'];
const KO_SYLLABLE = ['민', '서', '준', '하', '지', '현', '우', '영', '수', '진', '도', '은', '재', '태', '나', '윤', '성', '아', '연', '호'];
const VI_FAMILY = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Ngô'];
const VI_MIDDLE = ['Văn', 'Thị', 'Minh', 'Hữu', 'Quốc', 'Ngọc', 'Thanh', 'Đức'];
const VI_GIVEN = ['An', 'Bình', 'Cường', 'Dũng', 'Hà', 'Hạnh', 'Khoa', 'Lan', 'Linh', 'Nam', 'Phúc', 'Quân', 'Sơn', 'Trang', 'Tuấn', 'Yến'];
const MN_PREFIX = ['Bat', 'Sukh', 'Gan', 'Enkh', 'Tsog', 'Nar', 'Oyun', 'Dorj', 'Bold', 'Munkh', 'Altan', 'Erde'];
const MN_SUFFIX = ['bayar', 'bold', 'tuya', 'erdene', 'tsetseg', 'baatar', 'saikhan', 'zul', 'gerel', 'od'];
const EN_GIVEN = ['Alex', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Taylor', 'Jamie', 'Quinn'];
const EN_FAMILY = ['Brooks', 'Hale', 'Reed', 'Ward', 'Lowe', 'Nash', 'Pratt', 'Vance'];

function nameFor(rand: Prng, lang: Lang): string {
  switch (lang) {
    case 'ko':
      return pick(rand, KO_SURNAME) + pick(rand, KO_SYLLABLE) + pick(rand, KO_SYLLABLE);
    case 'vi':
      return `${pick(rand, VI_FAMILY)} ${pick(rand, VI_MIDDLE)} ${pick(rand, VI_GIVEN)}`;
    case 'mn':
      return `${pick(rand, MN_PREFIX)}${pick(rand, MN_SUFFIX)} ${pick(rand, MN_PREFIX)}${pick(rand, MN_SUFFIX)}`;
    case 'en':
      return `${pick(rand, EN_GIVEN)} ${pick(rand, EN_FAMILY)}`;
  }
}

const langFor = (r: number): Lang => (r < 0.7 ? 'ko' : r < 0.85 ? 'vi' : r < 0.95 ? 'mn' : 'en');
const genderFor = (r: number): 'M' | 'F' | null => (r < 0.6 ? 'M' : r < 0.95 ? 'F' : null);
const affiliationFor = (r: number): 'direct' | 'partner' | 'temp' => (r < 0.7 ? 'direct' : r < 0.9 ? 'partner' : 'temp');

const FIXED: { code: string; role: string; priority: number }[] = [
  { code: 'OP', role: 'OP', priority: 3 },
  { code: 'BOX', role: 'BOX', priority: 2 },
  { code: '운반', role: '운반', priority: 2 },
  { code: '반장', role: '반장', priority: 5 },
  { code: '설비관리', role: '설비관리', priority: 4 },
  { code: '생산관리', role: '생산관리', priority: 1 },
];

const PRODUCTS: { code: string; name: string; urgent?: boolean }[] = [
  { code: 'PRD-01', name: '생수 500ml 프리폼' },
  { code: 'PRD-02', name: '생수 2L' },
  { code: 'PRD-03', name: '세제 1L' },
  { code: 'PRD-04', name: '샴푸 500ml' },
  { code: 'PRD-05', name: '화장품 용기 150ml', urgent: true },
  { code: 'PRD-06', name: '음료 350ml' },
  { code: 'PRD-07', name: '식용유 1.8L' },
];

const CREW_ABC: Crew[] = ['A', 'B', 'C'];

type FactorySpec = {
  code: string;
  name: string;
  sort: number;
  cycleBaseDate: string;
  lineRole: string;
  lines: { code: string; name: string; need: number; unmanned?: boolean }[];
  fixed: string[]; // FIXED codes present in this factory
  perCrew: number;
  dayCrew: string[]; // roles of the 6 weekday-only (D) workers
};

const FACTORIES: FactorySpec[] = [
  {
    code: 'F1',
    name: '1공장',
    sort: 1,
    cycleBaseDate: '2025-04-27',
    lineRole: '성형',
    lines: Array.from({ length: 8 }, (_, i) => ({ code: `L-${i + 1}`, name: `성형 ${i + 1}호기`, need: 2 })),
    fixed: ['OP', 'BOX', '운반', '반장', '설비관리'],
    perCrew: 22,
    dayCrew: ['생산관리', '설비관리', '운반', 'OP', '성형', '성형'],
  },
  {
    code: 'F2',
    name: '2공장',
    sort: 2,
    cycleBaseDate: '2025-04-28',
    lineRole: '사출',
    lines: [
      ...Array.from({ length: 6 }, (_, i) => ({
        code: `S-${i + 1}`,
        name: `사출 ${i + 1}호기`,
        need: i === 0 || i === 5 ? 2 : 1,
      })),
      ...Array.from({ length: 2 }, (_, i) => ({ code: `P-${i + 1}`, name: `프리폼 ${i + 1}호기`, need: 0, unmanned: true })),
    ],
    fixed: ['OP', '운반', '반장', '설비관리', '생산관리'],
    perCrew: 14,
    dayCrew: ['생산관리', '설비관리', '운반', '사출', '사출', '사출'],
  },
];

/** Delete every row of one company (all tables, FK-safe order). */
async function wipeCompany(tx: Executor, companyId: string): Promise<void> {
  const scoped = [
    t.messages,
    t.subRequests,
    t.absences,
    t.assignments,
    t.boards,
    t.planCells,
    t.leaveRequests,
    t.experienceBase,
    t.skills,
    t.accounts,
    t.loginFailures,
    t.standards,
    t.persons,
    t.products,
    t.posts,
    t.factories,
    t.settings,
  ] as const;
  for (const table of scoped) await tx.delete(table).where(eq(table.companyId, companyId));
  await tx.delete(t.companies).where(eq(t.companies.id, companyId));
}

/**
 * Create the demo company (spec §6): 2 factories, posts, 7 products, 120 fictional workers with experience history,
 * an admin account and a worker account per person (PIN, must change). Deterministic for a given `seed`.
 */
export async function seedDemo(db: DB, input: SeedDemoInput): Promise<{ companyId: string }> {
  const code = input.code ?? 'demo';
  const seed = input.seed ?? 1;
  if (input.reset && code !== 'demo') throw new EngineError('BAD_INPUT', 'reset is only allowed for the demo company');
  if (!strongEnough('worker', input.pin) || !strongEnough('admin', input.adminPassword)) throw new EngineError('WEAK_SECRET');

  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: t.companies.id }).from(t.companies).where(eq(t.companies.code, code));
    if (existing) {
      if (!input.reset) throw new EngineError('DUPLICATE_CODE');
      await wipeCompany(tx, existing.id);
    }
    const { companyId } = await createCompany(tx, {
      code,
      name: '데모 회사',
      adminId: 'admin',
      adminPassword: input.adminPassword,
    });
    const rand = mulberry32(seed);

    const productRows = await tx
      .insert(t.products)
      .values(PRODUCTS.map((p) => ({ companyId, code: p.code, name: p.name, urgent: p.urgent ?? false })))
      .returning({ id: t.products.id, code: t.products.code });
    const productId = new Map(productRows.map((p) => [p.code, p.id]));

    let empSeq = 1001;
    const experience: (typeof t.experienceBase.$inferInsert)[] = [];
    const skillRows: (typeof t.skills.$inferInsert)[] = [];
    const accountsToCreate: { loginId: string; personId: string }[] = [];
    const lineWorkers: { personId: string; linePostIds: string[] }[] = [];

    for (const spec of FACTORIES) {
      const [factory] = await tx
        .insert(t.factories)
        .values({ companyId, code: spec.code, name: spec.name, sort: spec.sort, cycleBaseDate: spec.cycleBaseDate })
        .returning({ id: t.factories.id });
      const factoryId = factory.id;

      const lineRows = await tx
        .insert(t.posts)
        .values(
          spec.lines.map((l, i) => ({
            companyId,
            factoryId,
            code: l.code,
            name: l.name,
            kind: 'line' as const,
            role: spec.lineRole,
            unmanned: l.unmanned ?? false,
            defaultNeed: l.need,
            priority: 1,
            sort: i,
          })),
        )
        .returning({ id: t.posts.id, code: t.posts.code });
      const fixedSpecs = FIXED.filter((f) => spec.fixed.includes(f.code));
      const fixedRows = await tx
        .insert(t.posts)
        .values(
          fixedSpecs.map((f, i) => ({
            companyId,
            factoryId,
            code: f.code,
            name: f.code,
            kind: 'fixed' as const,
            role: f.role,
            defaultNeed: 1,
            priority: f.priority,
            sort: spec.lines.length + i,
          })),
        )
        .returning({ id: t.posts.id, code: t.posts.code });
      const fixedPostId = new Map(fixedRows.map((p) => [p.code, p.id]));
      const manned = lineRows.filter((p) => !spec.lines.find((l) => l.code === p.code)!.unmanned);

      // Standards: the urgent product needs 1 on every 성형 line; one gendered example on S-1.
      if (spec.code === 'F1') {
        await tx.insert(t.standards).values(manned.map((p) => ({ companyId, postId: p.id, productId: productId.get('PRD-05')!, need: 1 })));
      } else {
        const s1 = lineRows.find((p) => p.code === 'S-1')!;
        await tx.insert(t.standards).values({ companyId, postId: s1.id, productId: productId.get('PRD-03')!, need: 1, gender: 'F' });
      }

      type Draft = typeof t.persons.$inferInsert & { linePostIds: string[] };
      const drafts: Draft[] = [];
      const draft = (crew: Crew, role: string, fixed: string | null) => {
        const lang = langFor(rand());
        const empNo = `${empSeq++}`;
        drafts.push({
          companyId,
          empNo,
          name: nameFor(rand, lang),
          affiliation: affiliationFor(rand()),
          crew,
          role,
          gender: genderFor(rand()),
          phone: `010-0000-${String(int(rand, 0, 9999)).padStart(4, '0')}`,
          factoryId,
          lang,
          fixedPostId: fixed,
          linePostIds: [],
        });
      };
      for (const crew of CREW_ABC) {
        for (const f of fixedSpecs) draft(crew, f.role, fixedPostId.get(f.code)!);
        for (let n = fixedSpecs.length; n < spec.perCrew; n++) draft(crew, spec.lineRole, null);
      }
      for (const role of spec.dayCrew) draft('D', role, null);

      const inserted = await tx
        .insert(t.persons)
        .values(drafts.map(({ linePostIds: _unused, ...p }) => p))
        .returning({ id: t.persons.id, empNo: t.persons.empNo });
      const idByEmp = new Map(inserted.map((p) => [p.empNo, p.id]));
      for (const d of drafts) {
        const personId = idByEmp.get(d.empNo)!;
        accountsToCreate.push({ loginId: d.empNo, personId });
        if (d.role === spec.lineRole) lineWorkers.push({ personId, linePostIds: manned.map((p) => p.id) });
      }
    }

    // Experience history for line workers: 2-4 posts of their factory, 1-3 products.
    const allProducts = [...productId.values()];
    for (const w of lineWorkers) {
      for (const postId of shuffled(rand, w.linePostIds).slice(0, int(rand, 2, 4))) {
        experience.push({ companyId, personId: w.personId, postId, count: int(rand, 0, 60) });
      }
      for (const pid of shuffled(rand, allProducts).slice(0, int(rand, 1, 3))) {
        experience.push({ companyId, personId: w.personId, productId: pid, count: int(rand, 1, 40) });
      }
    }
    // A few manual skill ratings.
    for (const w of shuffled(rand, lineWorkers).slice(0, 10)) {
      skillRows.push({ companyId, personId: w.personId, postId: pick(rand, w.linePostIds), level: int(rand, 0, 3) as 0 | 1 | 2 | 3 });
    }
    await tx.insert(t.experienceBase).values(experience);
    await tx.insert(t.skills).values(skillRows);

    for (const a of accountsToCreate) {
      await createAccount(tx, { companyId, kind: 'worker', loginId: a.loginId, personId: a.personId, secret: input.pin, mustChange: true });
    }
    return { companyId };
  });
}
