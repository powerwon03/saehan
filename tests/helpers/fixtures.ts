import type { Ctx, Factory, Person, Post, Settings, Snapshot } from '@/engine/types';

export const COMPANY = 'co-1';

export function makeSettings(over: Partial<Settings> = {}): Settings {
  return {
    companyId: COMPANY,
    shiftDayStart: '07:00',
    shiftNightStart: '19:00',
    shiftCreditHours: 8,
    maxWeekHours: 52,
    warnWeekHours: 44,
    requestExpiryMin: 20,
    weights: { samePost: 15, sameProduct: 3, sameFactory: 1, roleMatch: 5, roleMismatch: 20, recentSub: 25 },
    skillRates: [0.3, 0.6, 0.9, 1.0],
    ...over,
  };
}

export function makeFactory(over: Partial<Factory> = {}): Factory {
  return {
    id: 'f1',
    companyId: COMPANY,
    code: 'F1',
    name: '1공장',
    approval: 'confirm',
    leaderPhone: null,
    cycleBaseDate: '2025-04-27',
    sort: 0,
    ...over,
  };
}

export function makePerson(over: Partial<Person> = {}): Person {
  return {
    id: 'p1',
    companyId: COMPANY,
    empNo: '1001',
    name: '홍길동',
    affiliation: 'direct',
    crew: 'A',
    role: null,
    gender: null,
    phone: null,
    factoryId: 'f1',
    lang: 'ko',
    fixedPostId: null,
    active: true,
    hiredAt: null,
    leftAt: null,
    ...over,
  };
}

export function makePost(over: Partial<Post> = {}): Post {
  return {
    id: 'post1',
    companyId: COMPANY,
    factoryId: 'f1',
    code: 'L1',
    name: '1라인',
    kind: 'line',
    role: null,
    unmanned: false,
    priority: 0,
    defaultNeed: 1,
    active: true,
    sort: 0,
    ...over,
  };
}

export function makeSnapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    companyId: COMPANY,
    settings: makeSettings(),
    factories: [
      makeFactory(),
      makeFactory({ id: 'f2', code: 'F2', name: '2공장', cycleBaseDate: '2025-04-28', sort: 1 }),
    ],
    posts: [],
    products: [],
    standards: [],
    plans: [],
    persons: [],
    skills: [],
    experience: {},
    assignments: [],
    boards: [],
    absences: [],
    subRequests: [],
    leaves: [],
    ...over,
  };
}

/** Context at a fixed instant with sequential ids id-1, id-2, ... */
export function ctxAt(iso: string): Ctx {
  let n = 0;
  return { now: new Date(iso), newId: () => `id-${++n}` };
}
