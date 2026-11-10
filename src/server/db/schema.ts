import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  AbsenceKind,
  AbsenceStatus,
  Assignment,
  Board,
  Crew,
  Factory,
  LeaveRequest,
  Message,
  Person,
  PlanCell,
  Post,
  Shift,
  SubRequest,
  Weights,
} from '@/engine/types';

// Spec §2. Column names snake_case; field names match src/engine/types.ts.

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const companyRef = () =>
  uuid('company_id')
    .notNull()
    .references(() => companies.id);

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  rev: bigint('rev', { mode: 'number' }).notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const settings = pgTable('settings', {
  companyId: uuid('company_id')
    .primaryKey()
    .references(() => companies.id),
  shiftDayStart: text('shift_day_start').notNull().default('07:00'),
  shiftNightStart: text('shift_night_start').notNull().default('19:00'),
  shiftCreditHours: doublePrecision('shift_credit_hours').notNull().default(8),
  maxWeekHours: doublePrecision('max_week_hours').notNull().default(52),
  warnWeekHours: doublePrecision('warn_week_hours').notNull().default(44),
  requestExpiryMin: integer('request_expiry_min').notNull().default(20),
  weights: jsonb('weights')
    .$type<Weights>()
    .notNull()
    .default({ samePost: 15, sameProduct: 3, sameFactory: 1, roleMatch: 5, roleMismatch: 20, recentSub: 25 }),
  skillRates: jsonb('skill_rates')
    .$type<[number, number, number, number]>()
    .notNull()
    .default([0.3, 0.6, 0.9, 1.0]),
});

export const factories = pgTable('factories', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: companyRef(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  approval: text('approval').$type<Factory['approval']>().notNull().default('confirm'),
  leaderPhone: text('leader_phone'),
  cycleBaseDate: day('cycle_base_date').notNull(),
  sort: integer('sort').notNull().default(0),
});

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: companyRef(),
    factoryId: uuid('factory_id')
      .notNull()
      .references(() => factories.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').$type<Post['kind']>().notNull(),
    role: text('role'),
    unmanned: boolean('unmanned').notNull().default(false),
    priority: integer('priority').notNull().default(0),
    defaultNeed: integer('default_need').notNull().default(1),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [unique('posts_company_factory_code_uq').on(t.companyId, t.factoryId, t.code)],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: companyRef(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    urgent: boolean('urgent').notNull().default(false),
    active: boolean('active').notNull().default(true),
  },
  (t) => [unique('products_company_code_uq').on(t.companyId, t.code)],
);

export const standards = pgTable(
  'standards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: companyRef(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id),
    productId: uuid('product_id').references(() => products.id),
    need: integer('need').notNull(),
    gender: text('gender').$type<'M' | 'F'>(),
  },
  (t) => [
    uniqueIndex('standards_post_product_uq').on(
      t.postId,
      sql`coalesce(${t.productId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
  ],
);

export const planCells = pgTable(
  'plan_cells',
  {
    companyId: companyRef(),
    date: day('date').notNull(),
    shift: text('shift').$type<Shift>().notNull(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id),
    productId: uuid('product_id').references(() => products.id),
    status: text('status').$type<PlanCell['status']>().notNull().default('run'),
  },
  (t) => [primaryKey({ name: 'plan_cells_pk', columns: [t.companyId, t.date, t.shift, t.postId] })],
);

export const persons = pgTable(
  'persons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: companyRef(),
    empNo: text('emp_no').notNull(),
    name: text('name').notNull(),
    affiliation: text('affiliation').$type<Person['affiliation']>().notNull().default('direct'),
    crew: text('crew').$type<Crew>().notNull(),
    role: text('role'),
    gender: text('gender').$type<'M' | 'F'>(),
    phone: text('phone'),
    factoryId: uuid('factory_id')
      .notNull()
      .references(() => factories.id),
    lang: text('lang').$type<Person['lang']>().notNull().default('ko'),
    fixedPostId: uuid('fixed_post_id').references(() => posts.id),
    active: boolean('active').notNull().default(true),
    hiredAt: day('hired_at'),
    leftAt: day('left_at'),
  },
  (t) => [unique('persons_company_emp_no_uq').on(t.companyId, t.empNo)],
);

export const skills = pgTable(
  'skills',
  {
    companyId: companyRef(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id),
    level: integer('level').$type<0 | 1 | 2 | 3>().notNull(),
  },
  (t) => [primaryKey({ name: 'skills_pk', columns: [t.personId, t.postId] }), index('skills_company_idx').on(t.companyId)],
);

export const experienceBase = pgTable(
  'experience_base',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: companyRef(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id),
    postId: uuid('post_id').references(() => posts.id),
    productId: uuid('product_id').references(() => products.id),
    count: integer('count').notNull(),
  },
  (t) => [index('experience_base_company_idx').on(t.companyId)],
);

export const boards = pgTable(
  'boards',
  {
    companyId: companyRef(),
    date: day('date').notNull(),
    shift: text('shift').$type<Shift>().notNull(),
    factoryId: uuid('factory_id')
      .notNull()
      .references(() => factories.id),
    status: text('status').$type<Board['status']>().notNull().default('draft'),
    stoppedPostIds: uuid('stopped_post_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    confirmedAt: ts('confirmed_at'),
    confirmedBy: text('confirmed_by'),
  },
  (t) => [primaryKey({ name: 'boards_pk', columns: [t.companyId, t.date, t.shift, t.factoryId] })],
);

export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: companyRef(),
    date: day('date').notNull(),
    shift: text('shift').$type<Shift>().notNull(),
    factoryId: uuid('factory_id')
      .notNull()
      .references(() => factories.id),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id),
    source: text('source').$type<Assignment['source']>().notNull(),
    locked: boolean('locked').notNull().default(false),
    reason: text('reason'),
    flags: text('flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [unique('assignments_company_date_shift_person_uq').on(t.companyId, t.date, t.shift, t.personId)],
);

export const absences = pgTable(
  'absences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: companyRef(),
    date: day('date').notNull(),
    shift: text('shift').$type<Shift>().notNull(),
    factoryId: uuid('factory_id')
      .notNull()
      .references(() => factories.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id),
    postId: uuid('post_id').references(() => posts.id),
    kind: text('kind').$type<AbsenceKind>().notNull(),
    reportedBy: text('reported_by').$type<'self' | 'leader' | 'support'>().notNull(),
    reason: text('reason'),
    status: text('status').$type<AbsenceStatus>().notNull(),
    resolvedPersonId: uuid('resolved_person_id').references(() => persons.id),
    round: integer('round').notNull().default(0),
    restore: jsonb('restore').$type<unknown>(),
    createdAt: ts('created_at').notNull().defaultNow(),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [
    uniqueIndex('absences_open_uq')
      .on(t.companyId, t.date, t.shift, t.personId)
      .where(sql`${t.status} <> 'cancelled'`),
    index('absences_company_date_idx').on(t.companyId, t.date),
  ],
);

export const subRequests = pgTable(
  'sub_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: companyRef(),
    absenceId: uuid('absence_id')
      .notNull()
      .references(() => absences.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id),
    round: integer('round').notNull(),
    rank: integer('rank').notNull(),
    status: text('status').$type<SubRequest['status']>().notNull(),
    sentAt: ts('sent_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    respondedAt: ts('responded_at'),
  },
  (t) => [index('sub_requests_absence_idx').on(t.absenceId)],
);

export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: companyRef(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id),
    date: day('date').notNull(),
    kind: text('kind').notNull(),
    status: text('status').$type<LeaveRequest['status']>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    decidedAt: ts('decided_at'),
  },
  (t) => [
    uniqueIndex('leave_requests_open_uq')
      .on(t.personId, t.date)
      .where(sql`${t.status} in ('pending', 'approved')`),
    index('leave_requests_company_date_idx').on(t.companyId, t.date),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: companyRef(),
    personId: uuid('person_id').references(() => persons.id),
    bodyKey: text('body_key').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    channel: text('channel').$type<Message['channel']>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('messages_company_created_idx').on(t.companyId, t.createdAt)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: companyRef(),
    kind: text('kind').$type<'admin' | 'worker'>().notNull(),
    loginId: text('login_id').notNull(),
    personId: uuid('person_id').references(() => persons.id),
    secretHash: text('secret_hash').notNull(),
    mustChange: boolean('must_change').notNull().default(false),
    failedCount: integer('failed_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    lastLoginAt: ts('last_login_at'),
  },
  (t) => [unique('accounts_company_kind_login_uq').on(t.companyId, t.kind, t.loginId)],
);
