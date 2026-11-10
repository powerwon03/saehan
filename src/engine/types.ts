export type DateStr = string; // YYYY-MM-DD, Seoul time
export type Shift = 'day' | 'night';
export type ShiftOrOff = Shift | 'off';
export type Crew = 'A' | 'B' | 'C' | 'D';

export type Factory = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  approval: 'confirm' | 'draft-decide';
  leaderPhone: string | null;
  cycleBaseDate: DateStr;
  sort: number;
};

export type Post = {
  id: string;
  companyId: string;
  factoryId: string;
  code: string;
  name: string;
  kind: 'line' | 'fixed';
  role: string | null;
  unmanned: boolean;
  priority: number;
  defaultNeed: number;
  active: boolean;
  sort: number;
};

export type Product = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  urgent: boolean;
  active: boolean;
};

export type Standard = {
  id: string;
  companyId: string;
  postId: string;
  productId: string | null; // null = line default
  need: number;
  gender: 'M' | 'F' | null;
};

export type PlanCell = {
  companyId: string;
  date: DateStr;
  shift: Shift;
  postId: string;
  productId: string | null;
  status: 'run' | 'off' | 'unmanned';
};

export type Person = {
  id: string;
  companyId: string;
  empNo: string;
  name: string;
  affiliation: 'direct' | 'partner' | 'temp';
  crew: Crew;
  role: string | null;
  gender: 'M' | 'F' | null;
  phone: string | null;
  factoryId: string;
  lang: 'ko' | 'en' | 'mn' | 'vi';
  fixedPostId: string | null;
  active: boolean;
  hiredAt: DateStr | null;
  leftAt: DateStr | null;
};

export type SkillRow = {
  personId: string;
  postId: string;
  level: 0 | 1 | 2 | 3;
};

export type Assignment = {
  id: string;
  companyId: string;
  date: DateStr;
  shift: Shift;
  factoryId: string;
  postId: string;
  personId: string;
  source: 'auto' | 'manual' | 'sub' | 'move';
  locked: boolean;
  reason: string | null;
  flags: string[];
  createdAt: Date;
};

export type Board = {
  companyId: string;
  date: DateStr;
  shift: Shift;
  factoryId: string;
  status: 'draft' | 'confirmed';
  stoppedPostIds: string[];
  confirmedAt: Date | null;
  confirmedBy: string | null;
};

export type AbsenceKind = 'absent' | 'sick' | 'early' | 'late' | 'leave';
export type AbsenceStatus =
  | 'pending-board'
  | 'not-needed'
  | 'decided'
  | 'in-progress'
  | 'resolved'
  | 'failed'
  | 'cancelled';

export type Absence = {
  id: string;
  companyId: string;
  date: DateStr;
  shift: Shift;
  factoryId: string;
  personId: string;
  postId: string | null;
  kind: AbsenceKind;
  reportedBy: 'self' | 'leader' | 'support';
  reason: string | null;
  status: AbsenceStatus;
  resolvedPersonId: string | null;
  round: number;
  restore: unknown;
  createdAt: Date;
  resolvedAt: Date | null;
};

export type SubRequest = {
  id: string;
  companyId: string;
  absenceId: string;
  personId: string;
  round: number;
  rank: number;
  status: 'sent' | 'accepted' | 'declined' | 'expired' | 'cancelled';
  sentAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
};

export type LeaveRequest = {
  id: string;
  companyId: string;
  personId: string;
  date: DateStr;
  kind: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  createdAt: Date;
  decidedAt: Date | null;
};

export type Message = {
  id: string;
  companyId: string;
  personId: string | null; // null = admin
  bodyKey: string;
  params: Record<string, unknown>;
  channel: 'push' | 'alimtalk' | 'sms' | 'admin';
  createdAt: Date;
};

export type Weights = {
  samePost: number;
  sameProduct: number;
  sameFactory: number;
  roleMatch: number;
  roleMismatch: number;
  recentSub: number;
};

export type Settings = {
  companyId: string;
  shiftDayStart: string; // 'HH:MM'
  shiftNightStart: string; // 'HH:MM'
  shiftCreditHours: number;
  maxWeekHours: number;
  warnWeekHours: number;
  requestExpiryMin: number;
  weights: Weights;
  skillRates: [number, number, number, number];
};

export type ExperienceCounts = Record<
  string,
  { post: Record<string, number>; product: Record<string, number> }
>;

export type Snapshot = {
  companyId: string;
  settings: Settings;
  factories: Factory[];
  posts: Post[];
  products: Product[];
  standards: Standard[];
  plans: PlanCell[];
  persons: Person[];
  skills: SkillRow[];
  experience: ExperienceCounts;
  assignments: Assignment[];
  boards: Board[];
  absences: Absence[];
  subRequests: SubRequest[];
  leaves: LeaveRequest[];
};

export type Ctx = { now: Date; newId: () => string };

export type TableName = 'assignments' | 'boards' | 'absences' | 'subRequests' | 'leaves' | 'plans';

export type Changes = {
  upsert: Partial<Record<TableName, object[]>>;
  remove: Partial<Record<TableName, string[]>>;
  messages: Omit<Message, 'id' | 'createdAt'>[];
};

export function emptyChanges(): Changes {
  return { upsert: {}, remove: {}, messages: [] };
}

export function mergeChanges(a: Changes, b: Changes): Changes {
  const out = emptyChanges();
  for (const src of [a, b]) {
    for (const [t, rows] of Object.entries(src.upsert) as [TableName, object[]][]) {
      out.upsert[t] = [...(out.upsert[t] ?? []), ...rows];
    }
    for (const [t, ids] of Object.entries(src.remove) as [TableName, string[]][]) {
      out.remove[t] = [...(out.remove[t] ?? []), ...ids];
    }
    out.messages.push(...src.messages);
  }
  return out;
}

export class EngineError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'EngineError';
    this.code = code;
  }
}
