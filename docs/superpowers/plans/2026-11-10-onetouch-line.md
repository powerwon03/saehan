# 원터치 라인 1차 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 교대제 공장의 자동 인력 배치·결원 대체 요청 웹 서비스(관리자 PC + 근무자 모바일)를 실제 운영용으로 구현한다.

**Architecture:** Next.js 15 App Router 한 프로젝트. 업무 규칙은 `src/engine/`의 순수 함수로, 입력 `Snapshot` + `Ctx{now,newId}`를 받아 결과 또는 `Changes`(표별 upsert/remove 목록)를 돌려준다. 서버는 `runAction`에서 회사 행을 잠근 트랜잭션 안에서 "만료 처리 → 스냅샷 로드 → 엔진 → Changes 적용 → rev+1"을 수행한다.

**Tech Stack:** Next.js 15, React 19, TypeScript 5 (strict), Tailwind CSS 4, Drizzle ORM + drizzle-kit, `postgres`(postgres-js) / `@electric-sql/pglite`, zod, SheetJS(`xlsx` 0.20.3, `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), Vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-11-10-onetouch-line-design.md` (이하 "스펙 §n")

## Global Constraints

- 모든 날짜는 서울 시각 기준 `YYYY-MM-DD` 문자열(`DateStr`). 서버는 UTC로 돌 수 있으므로 서울 변환은 고정 +09:00 산술로만 한다(`Intl` 시스템 시간대에 의존 금지).
- 야간 교대는 시작 날짜로 기록한다. 주(週)는 월~일, 교대는 시작 날짜가 속한 주에 센다.
- 엔진(`src/engine/**`)은 DB·Next·`Date.now()`·`Math.random()`을 import/호출하지 않는다. 시각과 id는 `Ctx`로 받는다.
- 회사 확인 전 가정값은 코드 상수가 아니라 `settings` 행에서 읽는다(스펙 §9). 기본값: 주간 시작 `07:00`, 야간 시작 `19:00`, 인정 8시간, 주 최대 52, 주의 44, 요청 기한 20분, 가동률 `[0.3,0.6,0.9,1.0]`, 가중치 `{samePost:15, sameProduct:3, sameFactory:1, roleMatch:5, roleMismatch:20, recentSub:25}`.
- 공장 달력 기준일 기본값: 1공장 `2025-04-27`, 2공장 `2025-04-28`.
- 모든 서버 쿼리는 세션의 `companyId`로 범위를 제한한다. 근무자 응답에는 본인 외 사람의 `phone`을 절대 넣지 않는다.
- 쓰기 동작은 하나의 트랜잭션 + `companies.rev` 1 증가.
- 근무자 화면: 버튼 높이 ≥ 56px, 본문 ≥ 18px, 글자 입력 없음(PIN 숫자 키패드만), 모든 문구는 `src/i18n/{ko,en,mn,vi}.ts` 사전에서만.
- 비밀 값(`DATABASE_URL`, `SESSION_SECRET`, `CRON_SECRET`)은 저장소에 커밋하지 않는다. `.env.example`만 커밋.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **자정 넘은 야간**: 02:00에 근무자가 앱을 열면 "오늘 내 근무"는 전날 날짜의 야간이어야 하고 「오늘 못 나와요」는 숨겨져야 한다 → Task 1 `currentShift` 테스트, Task 10 worker view 테스트.
2. **확정 후 계획 변경**: 잠긴(manual/sub) 배치가 있는 라인을 「쉼」으로 바꾸면 그 배치(잠금 포함)는 지워지고 사람은 대기로 간다 → Task 4 테스트.
3. **퇴사 처리**: 퇴사시키면 오늘 이후 배치·보낸 요청이 정리되고 자동 배치·추천에서 빠진다 → Task 11 테스트.
4. **해결 후 신고 취소**: 대체가 이미 들어온 뒤 「잘못 눌렀어요」는 거부되고(`ALREADY_RESOLVED`) 배치는 그대로다 → Task 6 테스트.
5. **엑셀 부분 오류**: 사번 중복·없는 제품 코드가 섞인 파일은 미리보기에서 오류 행으로 보이고, 저장 시 오류 행만 건너뛰며 정상 행은 반영된다(전부 실패하지 않음) → Task 12 테스트.

---

## File Structure

```
src/engine/types.ts        엔진 공용 타입(Snapshot, Ctx, Changes, 행 타입)
src/engine/dates.ts        DateStr 산술(addDays, diffDays, weekStart, dow)
src/engine/calendar.ts     12일 교대 달력
src/engine/time.ts         서울 시각·교대 창
src/engine/worklog.ts      사람별 실제 근무 교대 목록·주 시간
src/engine/eligibility.ts  대체 근무 가능 판단
src/engine/skill.ts        숙련도·가동률·경험
src/engine/demand.ts       유효 계획·필요 인원 칸
src/engine/autoAssign.ts   자동 배치·배치 점수
src/engine/recommend.ts    대체 추천
src/engine/absence.ts      결근·요청·만료 상태 전이
src/engine/leave.ts        휴무 전이
src/engine/board.ts        수동 배치·맞바꿈·계획 변경·확정
src/server/db/schema.ts    Drizzle 스키마
src/server/db/client.ts    getDb(): Postgres 또는 PGlite
src/server/repo/snapshot.ts loadSnapshot
src/server/repo/apply.ts   applyChanges
src/server/runAction.ts    트랜잭션·잠금·만료·rev
src/server/auth/*.ts       hash, session, login, guard
src/server/views/*.ts      boardView, workerView, monthlyRecord
src/server/excel/*.ts      import(parse/preview/commit), templates, export
src/app/api/**/route.ts    API (스펙 §4.2)
src/app/(admin)/admin/**   관리자 화면
src/app/w/**               근무자 화면
src/i18n/*.ts              사전
scripts/create-company.ts, scripts/seed-demo.ts
tests/engine/*.test.ts, tests/server/*.test.ts, tests/helpers/*.ts
```

---

### Task 1: 프로젝트 골격 + 날짜·달력·시각

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `postcss.config.mjs`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`(→ `/w`로 redirect), `.env.example`
- Create: `src/engine/types.ts`, `src/engine/dates.ts`, `src/engine/calendar.ts`, `src/engine/time.ts`
- Test: `tests/engine/calendar.test.ts`, `tests/engine/time.test.ts`, `tests/helpers/fixtures.ts`

**Interfaces:**
- Produces (`types.ts`): `DateStr = string`, `Shift = 'day'|'night'`, `ShiftOrOff = Shift|'off'`, `Crew = 'A'|'B'|'C'|'D'`, 행 타입 `Factory, Post, Product, Standard, PlanCell, Person, SkillRow, Assignment, Board, Absence, SubRequest, LeaveRequest, Message, Settings` (필드는 스펙 §2 표의 열을 camelCase로), `ExperienceCounts = Record<personId, {post: Record<postId,number>, product: Record<productId,number>}>`, `Snapshot = { companyId, settings, factories, posts, products, standards, plans, persons, skills, experience: ExperienceCounts, assignments, boards, absences, subRequests, leaves }`, `Ctx = { now: Date; newId: () => string }`, `Changes = { upsert: Partial<Record<TableName, object[]>>; remove: Partial<Record<TableName, string[]>>; messages: Omit<Message,'id'|'createdAt'>[] }`, `TableName = 'assignments'|'boards'|'absences'|'subRequests'|'leaves'|'plans'`, `emptyChanges(): Changes`, `mergeChanges(a,b): Changes`, `class EngineError extends Error { code: string }`.
- Produces (`dates.ts`): `addDays(d, n): DateStr`, `diffDays(a, b): number`(a−b), `dow(d): 0..6`(0=일), `weekStart(d): DateStr`(월요일).
- Produces (`calendar.ts`): `crewShift(baseDate: DateStr, crew: Crew, date: DateStr): ShiftOrOff`, `regularShift(person: Person, factory: Factory, date: DateStr): ShiftOrOff`, `crewsOn(baseDate, date): {day: Crew, night: Crew, off: Crew}`.
- Produces (`time.ts`): `seoulDate(now: Date): DateStr`, `shiftWindow(date, shift, settings): {start: Date; end: Date}`, `hasShiftStarted(now, date, shift, settings): boolean`, `currentShift(now, settings): {date: DateStr; shift: Shift}`.
- Produces (`tests/helpers/fixtures.ts`): `makeSettings(over?)`, `makeSnapshot(over?: Partial<Snapshot>): Snapshot`, `makePerson(over)`, `makePost(over)`, `ctxAt(iso: string): Ctx`(순번 id 생성).

- [ ] **Step 1: 골격 생성**

`npx create-next-app@15 . --ts --tailwind --app --src-dir --eslint --no-import-alias --use-npm` 대신 수동 작성도 가능. `package.json` scripts: `dev`, `build`, `start`, `test`(`vitest run`), `test:watch`, `typecheck`(`tsc --noEmit`), `db:generate`(`drizzle-kit generate`), `db:migrate`(`tsx scripts/migrate.ts`), `company:create`, `seed:demo`. 경로 별칭 `@/*` → `src/*`(tsconfig + vitest).

- [ ] **Step 2: 달력 실패 테스트 작성**

```ts
// tests/engine/calendar.test.ts
test('A조는 기준일부터 주간4·휴무2·야간4·휴무2', () => {
  const seq = Array.from({length:12}, (_,i) => crewShift('2025-04-27','A', addDays('2025-04-27', i)));
  expect(seq).toEqual(['day','day','day','day','off','off','night','night','night','night','off','off']);
});
test('매일 주간·야간·휴무 각 1개 조 (기준일 전후 400일)', () => {
  for (let i = -200; i < 200; i++) {
    const d = addDays('2025-04-27', i);
    const s = (['A','B','C'] as const).map(c => crewShift('2025-04-27', c, d)).sort();
    expect(s).toEqual(['day','night','off']);
  }
});
test('야간 바로 다음 날 주간이 되는 조는 없다', () => { /* 모든 조·400일: night 다음 날 !== 'day' */ });
test('2공장(기준일 하루 늦음)은 1공장의 전날 패턴', () => {
  expect(crewShift('2025-04-28','A','2025-05-01')).toBe(crewShift('2025-04-27','A','2025-04-30'));
});
test('주간조 D는 평일 주간, 주말 휴무', () => {
  expect(crewShift('2025-04-27','D','2026-11-09')).toBe('day');  // 월
  expect(crewShift('2025-04-27','D','2026-11-08')).toBe('off');  // 일
});
```

- [ ] **Step 3: 실행해 실패 확인** — `npx vitest run tests/engine/calendar.test.ts` → FAIL(모듈 없음)

- [ ] **Step 4: `dates.ts`, `calendar.ts` 구현**

`pos = mod(diffDays(date, base) - offset*4, 12)`, offset A=0,B=1,C=2; pos 0–3 day, 6–9 night, 나머지 off. `mod`는 음수에서도 0..11. DateStr 산술은 `Date.UTC`로 정수 일수 변환.

- [ ] **Step 5: 시각 실패 테스트 작성**

```ts
// tests/engine/time.test.ts
const s = makeSettings();
test('서울 날짜', () => expect(seoulDate(new Date('2026-11-09T16:30:00Z'))).toBe('2026-11-10'));
test('야간 창은 19:00~다음날 07:00 KST', () => {
  const w = shiftWindow('2026-11-10','night',s);
  expect(w.start.toISOString()).toBe('2026-11-10T10:00:00.000Z');
  expect(w.end.toISOString()).toBe('2026-11-10T22:00:00.000Z');
});
test('02:00 KST의 현재 교대는 전날 야간', () =>
  expect(currentShift(new Date('2026-11-10T17:00:00Z'), s)).toEqual({date:'2026-11-10', shift:'night'}));
// 2026-11-11 02:00 KST = 2026-11-10T17:00Z
test('06:59 KST 주간 미시작, 07:00 시작', () => {
  expect(hasShiftStarted(new Date('2026-11-10T21:59:00Z'),'2026-11-11','day',s)).toBe(false);
  expect(hasShiftStarted(new Date('2026-11-10T22:00:00Z'),'2026-11-11','day',s)).toBe(true);
});
```

- [ ] **Step 6: `time.ts` 구현 후 통과 확인** — `npx vitest run tests/engine` → PASS, `npm run typecheck` → 0 errors

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(engine): 프로젝트 골격, 12일 교대 달력, 서울 시각"`

---

### Task 2: 근무 기록·근무 가능 판단·숙련도

**Files:**
- Create: `src/engine/worklog.ts`, `src/engine/eligibility.ts`, `src/engine/skill.ts`
- Test: `tests/engine/eligibility.test.ts`, `tests/engine/skill.test.ts`

**Interfaces:**
- Consumes: Task 1 전부.
- Produces (`worklog.ts`): `shiftsWorked(snap, personId, from: DateStr, to: DateStr): {date: DateStr; shift: Shift}[]` — 정규 교대(취소 안 된 결근·승인 휴무가 없는 날, 그날 그 공장 배치표가 있거나 날짜가 과거) ∪ 배치 행; 중복 제거. `weekHours(snap, personId, date): number` = `weekStart(date)`~`date+6` 교대 수 × `settings.shiftCreditHours`. `isOff(snap, personId, date): boolean`(취소 안 된 결근 또는 approved 휴무). `recentSubCount(snap, personId, date, days=30): number`(source sub 또는 manual, date−30 ~ date−1).
- Produces (`eligibility.ts`): `type IneligibleReason = 'INACTIVE'|'OFF_OR_ABSENT'|'ALREADY_WORKING'|'NIGHT_BEFORE_DAY'|'DAY_AFTER_NIGHT'|'WEEK_HOURS'`, `canWorkExtra(snap, personId, date, shift): {ok: true} | {ok: false; reason: IneligibleReason}`.
- Produces (`skill.ts`): `skillLevel(snap, personId, postId): 0|1|2|3`, `skillRate(level, settings): number`, `postExperience(snap, personId, postId): number`, `productExperience(snap, personId, productId): number`.

- [ ] **Step 1: 실패 테스트 작성**

```ts
// eligibility.test.ts — 기준일 2025-04-27, A조: 11/10 기준 위치 계산은 fixture에서 crewShift로 찾아 쓴다
test('재직 안 함 → INACTIVE')
test('그날 approved 휴무 → OFF_OR_ABSENT; pending 휴무는 통과')
test('같은 날 주간 배치가 있으면 야간 추가 → ALREADY_WORKING')
test('전날 야간 근무자가 오늘 주간 → NIGHT_BEFORE_DAY')
test('오늘 야간 후보가 내일 정규 주간 → DAY_AFTER_NIGHT')
test('이번 주 6교대(48h) + 8 = 56 > 52 → WEEK_HOURS; 5교대(40h)+8=48 → ok')
test('일요일 야간은 그 주(월~일)에 센다', () => {
  // 일요일 2026-11-15 야간 배치 + 같은 주 월~토 5교대 → weekHours('2026-11-15') === 48
});
// skill.test.ts
test('직접 값이 이력보다 우선')
test('이력 0/1/10/30회 → 0/1/2/3')
test('고정 자리: 지정 사람 3, 같은 역할 2, 그 외 0 (직접 값 없을 때)')
test('가동률 = settings.skillRates[level]')
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/engine/eligibility.test.ts tests/engine/skill.test.ts` → FAIL
- [ ] **Step 3: 구현** — 스펙 §3.3·§3.5. 경험 횟수 = `snap.experience` 값(서버가 base + 확정 배치로 집계해 넣음).
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS
- [ ] **Step 5: Commit** — `feat(engine): 근무 가능 판단과 숙련도`

---

### Task 3: 필요 인원

**Files:**
- Create: `src/engine/demand.ts`
- Test: `tests/engine/demand.test.ts`

**Interfaces:**
- Produces: `type Slot = { postId: string; index: number; gender: 'M'|'F'|null }`, `effectivePlan(snap, factoryId, date, shift): Map<postId, {productId: string|null; status: 'run'|'off'|'unmanned'}>`(그날 없으면 같은 공장·교대의 가장 최근 날짜 계획), `postNeed(snap, factoryId, date, shift): Map<postId, number>`, `computeSlots(snap, factoryId, date, shift): Slot[]`.

- [ ] **Step 1: 실패 테스트 작성**

```ts
test('그날 계획 없으면 가장 최근 같은 교대 계획을 이어 씀(다른 교대 계획은 무시)')
test('표준(post, product) > 표준(post, null) > post.defaultNeed')
test('off·unmanned·board.stoppedPostIds 라인은 0')
test('가동 라인 0개면 고정 자리 0, 1개 이상이면 defaultNeed')
test('가동 라인 6개면 role 운반 자리 +1, 5개면 그대로')
test('성별 조건 표준이면 칸에 gender가 붙음')
```

- [ ] **Step 2–4: 실패 확인 → 구현(스펙 §3.4) → `npx vitest run tests/engine/demand.test.ts` PASS**
- [ ] **Step 5: Commit** — `feat(engine): 필요 인원 계산`

---

### Task 4: 자동 배치·수동 배치·확정

**Files:**
- Create: `src/engine/autoAssign.ts`, `src/engine/board.ts`
- Test: `tests/engine/autoAssign.test.ts`, `tests/engine/board.test.ts`

**Interfaces:**
- Consumes: `computeSlots`, `skillLevel`, `skillRate`, `regularShift`, `isOff`, `weekHours`, `recentSubCount`, `canWorkExtra`.
- Produces (`autoAssign.ts`): `placementScore(snap, personId, postId, ctx: {factoryId; date; shift; productId: string|null; isSubstitute: boolean}): number`, `flagsFor(snap, personId, postId, slot: Slot, date): string[]`, `autoAssign(snap, factoryId, date, shift, ctx: Ctx): Changes`, `rosterFor(snap, factoryId, date, shift): string[]`(정규 근무자 중 재직·비휴무·비결근 personId).
- Produces (`board.ts`): `setPlan(snap, {factoryId, date, shift, postId, productId, status}, ctx): Changes`(그날 계획이 없으면 effectivePlan 전체를 그날로 복사한 뒤 해당 칸 변경; status가 off/unmanned로 바뀌면 그 자리 배치를 잠금 포함 삭제), `toggleStop(snap, {factoryId,date,shift,postId}, ctx): Changes`(세우면 그 자리 배치 삭제), `assignPerson(snap, {factoryId,date,shift,postId,personId}, ctx): Changes`(그 사람이 같은 교대 다른 자리에 있으면 이동, 정규 근무자가 아니면 `canWorkExtra` 실패 시 `EngineError(reason)`; 결과 locked=true, source='manual'), `swap(snap, {assignmentIdA, assignmentIdB}, ctx): Changes`(둘 다 locked), `unassign(snap, {assignmentId}, ctx): Changes`, `confirmBoard(snap, {factoryId,date,shift}, ctx): Changes`(status confirmed + 배치된 사람마다 message `{bodyKey:'todayWork'}`).

- [ ] **Step 1: 실패 테스트 작성**

```ts
// autoAssign.test.ts
test('결과 배치에 같은 사람이 두 번 나오지 않는다')
test('locked 배치는 유지되고 그 칸만큼 덜 채운다; unlocked 기존 배치는 재계산')
test('fixedPostId 지정자는 고정 자리에 먼저 들어간다')
test('단독 가능(숙련도≥2) 후보가 적은 자리부터 채운다', () => {
  // 자리 X: 숙련자 1명만 있음, 자리 Y: 숙련자 2명 → X에 그 1명이 들어간다
});
test('점수 동점이면 empNo 오름차순')
test('휴무 승인·결근 신고자는 후보에서 빠진다')
test('남은 사람은 배치되지 않고(대기), 못 채운 칸은 Changes에 없다')
test('placementScore: 숙련도3 가동률1.0, 지난번 이 자리, 같은 제품, 같은 공장, 역할 일치 → 100+15+0.2*min(n,50)+3+1+5')
// board.test.ts
test('라인을 off로 바꾸면 locked 배치까지 삭제된다')   // Review Focus 2
test('그날 계획이 없을 때 setPlan은 최근 계획 전체를 복사한 뒤 한 칸만 바꾼다')
test('assignPerson: 다른 자리에 있던 사람은 이동, locked/manual')
test('assignPerson: 전날 야간 근무자를 주간에 넣으면 EngineError NIGHT_BEFORE_DAY')
test('swap: 두 사람 자리 교환, 둘 다 locked')
test('confirmBoard: status confirmed + 배치 인원 수만큼 todayWork 메시지')
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/engine/autoAssign.test.ts tests/engine/board.test.ts` → FAIL
- [ ] **Step 3: 구현** — 스펙 §3.6~3.8. 칸 채우기 순서: 칸을 자리별로 묶어 `(단독가능 후보 수 ASC, post.priority DESC, post.sort ASC)`로 정렬하고, 각 칸에서 남은 후보 중 `placementScore` 최대(동점 empNo) 선택. 성별 조건 칸은 성별 일치 후보만. 반환 Changes: 기존 unlocked 배치 remove + 새 배치 upsert(source 'auto', locked false, flags) + board 없으면 draft board upsert.
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: Commit** — `feat(engine): 자동 배치, 수동 배치, 확정`

---

### Task 5: 대체 추천

**Files:**
- Create: `src/engine/recommend.ts`
- Test: `tests/engine/recommend.test.ts`

**Interfaces:**
- Produces: `type Candidate = { personId: string; kind: 'idle'|'rest'; factoryId: string; skill: 0|1|2|3; reasons: ('exp'|'product'|'otherFactory')[]; warnings: ('lowSkill'|'role'|'gender'|'hours')[]; weekHours: number; recentSubs: number }`, `idlePeople(snap, factoryId, date, shift): string[]`(그 교대 rosterFor 중 배치 없는 사람), `recommendFor(snap, target: {factoryId; date; shift; postId; gender: 'M'|'F'|null}): Candidate[]`(정렬 완료).

- [ ] **Step 1: 실패 테스트 작성**

```ts
test('쉬는 사람이 대기 인원보다 앞선다(경험 없어도)')
test('같은 kind면 업무 경험 있는 사람이 앞선다')
test('그다음 오늘 제품 경험')
test('그다음 최근 30일 대체·직접 배치가 적은 사람')
test('동점: 숙련도 높은 → 같은 공장 → 이번 주 시간 적은 → empNo')
test('다른 공장 쉬는 사람도 포함되고 reasons에 otherFactory')
test('canWorkExtra 실패자, 성별 조건 불일치자는 제외(대기 인원은 같은 교대라 eligibility 대신 성별만 검사)')
test('warnings: 숙련도1 lowSkill, 역할 다름 role, weekHours≥44 hours')
```

- [ ] **Step 2–4: 실패 확인 → 구현(스펙 §3.10, 튜플 비교 정렬) → PASS**
- [ ] **Step 5: Commit** — `feat(engine): 대체 인력 추천`

---

### Task 6: 결근·요청·만료·휴무 전이

**Files:**
- Create: `src/engine/absence.ts`, `src/engine/leave.ts`
- Test: `tests/engine/absence.test.ts`, `tests/engine/leave.test.ts`

**Interfaces:**
- Consumes: `postNeed`, `canWorkExtra`, `idlePeople`, `recommendFor`.
- Produces (`absence.ts`) — 모두 `(snap, input, ctx) => Changes`, 위반 시 `EngineError(code)`:
  - `reportAbsence(snap, {personId, date, shift, kind, reportedBy, reason?})` — 중복이면 빈 Changes. 배치 삭제 + `restore` 보관, 상태 `pending-board|not-needed|decided`, 관리자 메시지 `absenceReported`.
  - `cancelAbsence(snap, {absenceId, by: 'self'|'admin'})` — resolved면 `ALREADY_RESOLVED`; self는 교대 시작 후 `SHIFT_STARTED`. sent 요청 cancelled, restore 복원(그 자리에 이미 다른 사람이 있으면 복원 생략), 상태 cancelled.
  - `placeSub(snap, {absenceId, personId})` — idle이면 이동, rest면 `canWorkExtra`; sub 배치(locked) + resolved + 다른 sent 요청 cancelled(+`takenByOther` 메시지).
  - `requestSubs(snap, {absenceId, personIds: string[]})` — 각 사람 `canWorkExtra` 통과자만 sent, `expiresAt = now + requestExpiryMin`, rank = 순서, round = absence.round; absence in-progress; 메시지 `subRequest`.
  - `respondSub(snap, {requestId, personId, accept: boolean})` — 본인 요청 아님 `FORBIDDEN`; absence가 resolved/cancelled면 요청 cancelled + `TAKEN_BY_OTHER` 오류 코드를 결과로 반환(throw 아님: `{changes, outcome: 'accepted'|'declined'|'takenByOther'|'expired'}`); 만료 시각 지났으면 `expired`; 수락 시 `canWorkExtra` 재검사.
  - `expireRequests(snap, ctx): Changes` — 만료 sent → expired; sent가 하나도 안 남은 in-progress absence → failed, round+1, 관리자 메시지 `subFailed`.
  - `respondSub`의 시그니처: `(snap, input, ctx) => { changes: Changes; outcome: ... }`.
- Produces (`leave.ts`): `requestLeave(snap, {personId, date}, ctx)`(오늘+1~오늘+14 아니면 `OUT_OF_RANGE`, 같은 날 pending/approved 있으면 빈 Changes), `cancelLeave(snap, {leaveId, personId}, ctx)`(pending만), `decideLeave(snap, {leaveId, approve: boolean}, ctx)`(approve이고 정규 근무일이면 `reportAbsence(kind 'leave', reportedBy 'support')` Changes 병합).

- [ ] **Step 1: 실패 테스트 작성**

```ts
test('같은 사람·날짜·교대 중복 신고는 빈 Changes')
test('배치표 없으면 pending-board, 남은 인원 ≥ 필요면 not-needed, 아니면 decided')
test('신고 시 배치 삭제, restore에 원래 배치')
test('requestSubs 3명 → sent 3건, expiresAt = now+20분, absence in-progress')
test('먼저 수락한 1명: sub 배치 locked, absence resolved, 나머지 cancelled + takenByOther 메시지')
test('resolved 뒤 늦은 수락 → outcome takenByOther, 배치 변화 없음')
test('모두 거절 후 expireRequests → failed, round 2')
test('20분 지나면 expired; 하나라도 sent 남으면 in-progress 유지')
test('cancelAbsence: 해결 전이면 원래 배치 복원 + sent 요청 cancelled')
test('cancelAbsence: resolved면 EngineError ALREADY_RESOLVED')   // Review Focus 4
test('cancelAbsence by self: 교대 시작 후 SHIFT_STARTED')
test('placeSub idle: 대기 인원이 결근 자리로 이동, resolved')
// leave.test.ts
test('15일 뒤 신청 → OUT_OF_RANGE')
test('approve + 정규 근무일 → leave 결근 생성, 비근무일이면 결근 없음')
test('cancelLeave는 pending만')
```

- [ ] **Step 2–4: 실패 확인 → 구현(스펙 §3.9, §3.11) → `npx vitest run tests/engine` 전부 PASS**
- [ ] **Step 5: Commit** — `feat(engine): 결근·대체 요청·만료·휴무 흐름`

---

### Task 7: DB 스키마·연결·스냅샷·runAction

**Files:**
- Create: `drizzle.config.ts`, `src/server/db/schema.ts`, `src/server/db/client.ts`, `src/server/repo/snapshot.ts`, `src/server/repo/apply.ts`, `src/server/runAction.ts`, `scripts/migrate.ts`, `drizzle/*`(generate 결과)
- Test: `tests/server/db.test.ts`, `tests/helpers/testDb.ts`

**Interfaces:**
- Consumes: 엔진 타입, `expireRequests`.
- Produces: `type DB` (PgDatabase), `getDb(): Promise<DB>`(`DATABASE_URL` 있으면 postgres-js(`prepare:false`, Supabase pooler 호환), 없으면 PGlite `./.data/pglite` + 자동 migrate), `createTestDb(): Promise<DB>`(메모리 PGlite + migrate), `loadSnapshot(tx, companyId, around: DateStr): Promise<Snapshot>`(배치·결근·요청·휴무·보드는 around−35 ~ around+15, 계획은 around−60 ~ around+15, experience는 experience_base + 확정 보드의 배치 + source sub 배치를 SQL 집계), `applyChanges(tx, companyId, changes): Promise<void>`, `runAction<T>(companyId, around: DateStr, fn: (snap: Snapshot, ctx: Ctx) => {changes: Changes; result?: T} | Changes, opts?: {db?: DB; now?: Date}): Promise<T|undefined>` — 트랜잭션 시작 → `SELECT … FROM companies WHERE id=$1 FOR UPDATE` → `expireRequests` 적용 → 스냅샷 재로드 → fn → apply → rev+1. `EngineError`는 그대로 throw(트랜잭션 롤백). 회사 행 잠금이 스펙 §3.9의 결근 행 잠금을 대신한다(회사 단위 쓰기 직렬화 → 선착 1명 보장이 더 단순하고 강함). `expireCompany(companyId, opts?)`, `getRev(companyId): Promise<number>`.
- 스키마: 스펙 §2 표 그대로. 유일 제약: `assignments(company_id,date,shift,person_id)`, `plan_cells(company_id,date,shift,post_id)`, `boards(company_id,date,shift,factory_id)`, `persons(company_id,emp_no)`, `products(company_id,code)`, `posts(company_id,factory_id,code)`, `standards(post_id, coalesce(product_id,'00000000-0000-0000-0000-000000000000'))`, partial unique `absences(company_id,date,shift,person_id) WHERE status <> 'cancelled'`, partial unique `leave_requests(person_id,date) WHERE status IN ('pending','approved')`. id는 uuid(`gen_random_uuid()`), 엔진 `newId`는 `crypto.randomUUID()`.
- 마이그레이션 마지막에 모든 표 `ENABLE ROW LEVEL SECURITY`(정책 없음).

- [ ] **Step 1: 실패 테스트 작성**

```ts
test('같은 교대 같은 사람 배치 두 번 insert → unique 위반')
test('applyChanges 후 loadSnapshot이 같은 행을 돌려준다')
test('runAction은 rev를 1 올리고, EngineError면 롤백되어 rev 그대로')
test('runAction은 fn 전에 만료 요청을 정리한다(만료 sent → expired 상태로 fn에 전달)')
test('experience 집계: base 2 + 확정 보드 배치 1 → 3; draft 보드 배치는 세지 않음')
test('다른 회사 행은 loadSnapshot에 나오지 않는다')
```

- [ ] **Step 2: 스키마 작성 후 `npm run db:generate`** → `drizzle/0000_*.sql` 생성, RLS 문을 별도 마이그레이션 `0001_rls.sql`로 추가
- [ ] **Step 3: 나머지 구현, `npx vitest run tests/server/db.test.ts` → PASS**
- [ ] **Step 4: Commit** — `feat(server): DB 스키마, 스냅샷 로드, 트랜잭션 동작 실행기`

---

### Task 8: 인증

**Files:**
- Create: `src/server/auth/hash.ts`, `src/server/auth/session.ts`, `src/server/auth/login.ts`, `src/server/auth/guard.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/api/auth/secret/route.ts`, `src/app/api/me/route.ts`, `src/app/api/rev/route.ts`, `src/middleware.ts`
- Test: `tests/server/auth.test.ts`

**Interfaces:**
- Produces: `hashSecret(s): Promise<string>`, `verifySecret(s, hash): Promise<boolean>`(scrypt N=16384, 16바이트 salt, `timingSafeEqual`), `type Session = {accountId; companyId; kind: 'admin'|'worker'; personId: string|null; exp: number}`, `signSession(s): string`, `readSession(token): Session|null`(HMAC-SHA256, `SESSION_SECRET` 32자 미만이면 throw), 쿠키 이름 `otl_session`, 30일, httpOnly·Secure(production)·SameSite=Lax. `login(db, {companyCode, kind, loginId, secret, now}): Promise<{ok: true; session: Session; mustChange: boolean} | {ok: false; code: 'INVALID'|'LOCKED'; lockedUntil?: Date}>`(5회 실패 → 10분 잠김; 근무자는 person.active 필수). `changeSecret(db, session, {current, next})` — 관리자 ≥ 8자, 근무자 `/^\d{6}$/`이고 `000000`·`123456`·같은 숫자 반복 금지. `requireAdmin(req): Promise<Session>`, `requireWorker(req): Promise<Session>`(실패 시 401/403 Response throw), `withApi(handler)`(EngineError → 400 `{error: code}`, zod 오류 → 400 `{error:'BAD_INPUT'}`). middleware: `/admin/**` 세션 없으면 `/login`, `/w/**`(login 제외) 없으면 `/w/login`; mustChange면 `/w/pin`.

- [ ] **Step 1: 실패 테스트 작성**

```ts
test('scrypt 해시 검증 성공/실패')
test('서명 변조된 쿠키는 null, 만료된 세션은 null')
test('5회 실패 → LOCKED, 올바른 PIN도 10분간 거부, 10분 뒤 성공하면 failed_count 0')
test('퇴사자 근무자 계정은 INVALID')
test('다른 회사 코드로는 같은 사번 로그인 불가')
test('PIN 123456 / 111111 / 12345 거부, 482917 허용, 변경 후 mustChange false')
test('근무자 세션으로 /api/admin/* 호출 → 403')
```

- [ ] **Step 2–4: 실패 확인 → 구현 → `npx vitest run tests/server/auth.test.ts` PASS**
- [ ] **Step 5: Commit** — `feat(auth): 관리자 비밀번호·근무자 PIN 로그인, 서명 세션, 잠금`

---

### Task 9: 관리자 배치 API

**Files:**
- Create: `src/server/views/boardView.ts`, `src/app/api/admin/board/route.ts`
- Test: `tests/server/board-api.test.ts`

**Interfaces:**
- Consumes: Task 3–7.
- Produces: `boardView(snap, {factoryId, date, shift}): BoardView` where `BoardView = { factory; date; shift; status: 'none'|'draft'|'confirmed'; summary: {need: number; present: number; diff: number}; lines: {post; plan: {productId; status}; stopped: boolean; need: number; people: {assignmentId; personId; name; empNo; source; locked; flags}[]; vacancies: number}[]; idle: {personId; name; empNo}[]; absences: {id; person; post; kind; status; createdAt; resolvedAt; resolvedPerson; requests: {id; personId; name; status; expiresAt}[]; candidates: Candidate & {name; empNo; factoryName}[]}[]; products; }`. present = 그 교대 rosterFor 수 + 다른 교대에서 들어온 sub 배치 수. 근거·주의는 코드값으로 내려 화면이 사전으로 표시.
- POST body(zod discriminated union on `type`): `setPlan | toggleStop | autoAssign | confirm | assign | swap | unassign | reportAbsence | cancelAbsence | placeSub | requestSubs` → 해당 엔진 함수를 `runAction`으로 실행, 응답 `{ok: true, rev}`.
- GET `?date&shift&factory` → `BoardView`. 생략 시 `currentShift(now)`와 첫 공장.

- [ ] **Step 1: 실패 테스트 작성**(라우트 핸들러를 `Request`로 직접 호출하는 헬퍼 `callRoute(handler, {method, url, body, session})`를 `tests/helpers/http.ts`에)

```ts
test('계획 → autoAssign → GET: 필요=배치+빈자리, 같은 사람 중복 없음')
test('confirm 후 status confirmed')
test('reportAbsence(관리자) → absences[0].status decided, candidates 존재')
test('requestSubs 후 GET에 requests 3건 sent')
test('assign으로 전날 야간자 주간 배치 → 400 {error:"NIGHT_BEFORE_DAY"}')
```

- [ ] **Step 2–4: 실패 확인 → 구현 → PASS**
- [ ] **Step 5: Commit** — `feat(api): 관리자 배치·결근 처리 API`

---

### Task 10: 근무자 API·휴무 승인 API

**Files:**
- Create: `src/server/views/workerView.ts`, `src/server/views/monthlyRecord.ts`, `src/app/api/worker/route.ts`, `src/app/api/admin/leaves/route.ts`
- Test: `tests/server/worker-api.test.ts`

**Interfaces:**
- Produces: `workerView(snap, personId, now): WorkerView` = `{ me: {name; empNo; lang; factoryName}; today: ShiftCard; tomorrow: ShiftCard; canReportAbsence: boolean; myAbsence: {id; status}|null; request: {id; date; shift; factoryName; postName; expiresAt}|null; requestOutcome: 'takenByOther'|null; leaves: {id; date; status}[]; month: MonthlyRecord }`, `ShiftCard = {date; shift: ShiftOrOff; start?: string; end?: string; factoryName?; postName?}`(today = `currentShift(now)` 기준: 그 교대에 정규 근무거나 배치가 있으면 그 교대, 없으면 `seoulDate(now)`의 본인 교대), `monthlyRecord(snap, personId, month: 'YYYY-MM'): {workDays; dayCount; nightCount; hours; subCount; missedDays}`. `snap`은 `month` 범위 포함하도록 `loadSnapshot` around 조정.
- POST body: `reportAbsence | cancelAbsence | respond{requestId, accept} | requestLeave{date} | cancelLeave{leaveId} | setLang{lang}`; personId는 항상 세션에서.
- 관리자 leaves: GET `?status=pending` 목록(이름·사번·날짜·그날 본인 교대), POST `{leaveId, approve}`.

- [ ] **Step 1: 실패 테스트 작성**

```ts
test('GET /api/worker 응답 JSON 어디에도 다른 사람 phone/name이 없다')   // 문자열 검색
test('02:00 KST 야간 근무자: today.date는 전날, shift night, canReportAbsence false')  // Review Focus 1
test('동시 수락: Promise.all로 두 명 respond accept → 배치 1건, 하나는 outcome takenByOther')
test('남의 requestId로 respond → 403 FORBIDDEN')
test('휴무 신청 → 관리자 승인 → 그날 근무일이면 결근 카드 생성')
test('신고 후 cancelAbsence → 원래 배치 복원')
```

- [ ] **Step 2–4: 실패 확인 → 구현 → PASS**
- [ ] **Step 5: Commit** — `feat(api): 근무자 API, 휴무 승인`

---

### Task 11: 근로자·숙련도·기준 정보·설정·계정 API

**Files:**
- Create: `src/app/api/admin/persons/route.ts`, `src/app/api/admin/persons/[id]/route.ts`, `src/app/api/admin/skills/route.ts`, `src/app/api/admin/accounts/route.ts`, `src/app/api/admin/master/[kind]/route.ts`, `src/app/api/admin/settings/route.ts`, `src/server/admin/persons.ts`
- Test: `tests/server/admin-crud.test.ts`

**Interfaces:**
- Produces: persons — GET(`?q&active`), POST(생성: `empNo` 생략 시 `suggestEmpNo` = 숫자 사번 최대값+1을 0채움 유지, 근무자 계정 함께 생성: 초기 PIN 입력값, mustChange true), PATCH(수정), POST `/[id]` `{action:'retire'|'rehire', date?}`, DELETE(배치·결근 이력 있으면 `HAS_HISTORY`). `retirePerson(tx, companyId, personId, leftAt, now)`: active false, leftAt, 오늘 이후 배치 삭제, sent 요청 cancelled, pending 휴무 cancelled. skills POST `{personId, postId, level: 0..3}`(level null이면 직접 값 삭제). accounts GET 잠김 목록, POST `{personId, action:'unlock'|'resetPin', pin?}`. master `[kind] ∈ factories|posts|products|standards` CRUD(제품 코드 중복 `DUPLICATE_CODE`, 사용 중인 제품/자리 삭제 대신 active false). settings GET/PUT(zod로 범위 검사: 시각 `HH:MM`, 1 ≤ 인정시간 ≤ 12, 40 ≤ 주 최대 ≤ 68, 5 ≤ 기한 ≤ 120).

- [ ] **Step 1: 실패 테스트 작성**

```ts
test('사번 생략 시 최대 사번+1 제안(A0119 → A0120 형태도 유지)')
test('퇴사: 오늘 이후 배치·sent 요청·pending 휴무 정리, 자동 배치 후보에서 제외')  // Review Focus 3
test('이력 있는 사람 DELETE → 400 HAS_HISTORY')
test('숙련도 칸 3 저장 후 skillLevel 3, null이면 이력 기반으로 복귀')
test('resetPin → mustChange true, unlock → failedCount 0')
test('제품 코드 중복 → DUPLICATE_CODE')
test('settings maxWeekHours 100 → BAD_INPUT')
```

- [ ] **Step 2–4: 실패 확인 → 구현 → PASS**
- [ ] **Step 5: Commit** — `feat(api): 근로자·숙련도·기준 정보·설정 관리`

---

### Task 12: 엑셀 가져오기·양식·근태표

**Files:**
- Create: `src/server/excel/detect.ts`, `src/server/excel/roster.ts`, `src/server/excel/plan.ts`, `src/server/excel/templates.ts`, `src/server/excel/attendance.ts`, `src/app/api/admin/import/route.ts`, `src/app/api/admin/template/route.ts`, `src/app/api/admin/export/attendance/route.ts`
- Test: `tests/server/excel.test.ts`

**Interfaces:**
- Produces: `detectKind(headers: string[]): 'roster'|'plan'|'unknown'`(명단 필수 열: 사번·이름·조·공장 / 계획 필수 열: 날짜·교대·공장·라인·제품·상태), `type ImportPreview = {kind; rows: {row: number; action: 'add'|'update'|'error'; key: string; errors: string[]}[]; counts: {add; update; error}; sample?: string[][]}`, `previewRoster(snap, sheetRows): ImportPreview`, `commitRoster(tx, companyId, sheetRows)`(오류 행 건너뜀, 라인 코드 열 값 0~3 → skills 직접 값, 퇴사일 있으면 retirePerson), `previewPlan`, `commitPlan`(상태 값 `가동|run`, `쉼|off`, `무인|unmanned`; 교대 `주간|day`, `야간|night`), `buildTemplate(kind): Buffer`, `buildAttendance(snap, month): Buffer`(사람 × 날짜, 칸 값 `주`/`야`/`휴`/`결`/`대`, 끝 열 주간·야간·대체·결근 합계). import POST `multipart/form-data` file + `mode=preview|commit`; unknown이면 commit 거부(`UNKNOWN_FORMAT`)하고 preview에 첫 10행 sample.

- [ ] **Step 1: 실패 테스트 작성**(SheetJS로 메모리 워크북 생성해 입력)

```ts
test('양식 받기 → 다시 올리면 detectKind가 같은 종류')
test('명단: 새 사번 add, 기존 사번 update')
test('사번 중복 행과 없는 공장 이름 행은 error, 나머지 commit 반영')    // Review Focus 5
test('계획: 없는 제품 코드 error, 정상 행만 plan_cells upsert')
test('모르는 양식은 sample 반환, commit 시 UNKNOWN_FORMAT')
test('근태표: 정규 주간 근무 칸 "주", 대체 투입 "대", 결근 "결"')
```

- [ ] **Step 2–4: 실패 확인 → 구현 → PASS**
- [ ] **Step 5: Commit** — `feat(excel): 명단·계획 가져오기, 양식, 월 근태표`

---

### Task 13: 회사 등록·데모 시드·연속 흐름 테스트

**Files:**
- Create: `scripts/create-company.ts`, `scripts/seed-demo.ts`, `src/server/seed/demoData.ts`, `src/server/seed/createCompany.ts`
- Test: `tests/server/flow.test.ts`

**Interfaces:**
- Produces: `createCompany(db, {code, name, adminId, adminPassword}): Promise<{companyId}>`(설정 기본값 행 포함, 비밀번호 8자 미만 거부), `seedDemo(db, {code: 'demo', pin: string, seed: number}): Promise<{companyId}>` — 스펙 §6 데이터(1공장 L-1~L-8 성형 1~8호기 기본 2명, 2공장 S-1~S-6 사출 기본 1명·S-1과 S-6은 2명, P-1~P-2 프리폼 unmanned, 고정 자리 OP·BOX·운반·반장·설비관리, 2공장은 생산관리 추가·BOX 없음, 제품 7종, 근무자 120명(공장별 A/B/C 각 18명 + 주간조 각 6명), 언어 ko 70%·vi 15%·mn 10%·en 5%, 결정적 의사난수 `seed`로 이름·숙련도·experience_base 생성. 이름은 가상). CLI: `npm run company:create -- <code> <name> --admin=<id> --password=<pw>`, `npm run seed:demo -- --pin=<6자리>`.

- [ ] **Step 1: 실패 테스트 작성**

```ts
test('6일 연속: 매일 주간·야간 × 2공장 계획→자동 배치→확정→결근 1건→3명 동시 요청→1명 수락→해결', async () => {
  // 매 교대 끝에서: 중복 배치 0, 해결된 결근의 resolvedPerson이 그 자리에 배치, 대체자가 canWorkExtra 규칙 위반 없음(전날 야간→주간 없음, 52h 이하)
});
test('createCompany 후 관리자 로그인 성공')
```

- [ ] **Step 2–4: 실패 확인 → 구현 → PASS**
- [ ] **Step 5: Commit** — `feat: 회사 등록·데모 시드 스크립트, 6일 연속 흐름 테스트`

---

### Task 14: 다국어 사전·근무자 화면

**Files:**
- Create: `src/i18n/{ko,en,mn,vi}.ts`, `src/i18n/index.ts`, `src/app/w/layout.tsx`, `src/app/w/login/page.tsx`, `src/app/w/pin/page.tsx`, `src/app/w/page.tsx`, `src/app/w/leave/page.tsx`, `src/app/w/record/page.tsx`, `src/components/worker/{PinPad,ShiftCard,RequestScreen,LangMenu,BigButton}.tsx`, `src/hooks/useRevPoll.ts`
- Test: `tests/i18n.test.ts`

**Interfaces:**
- Produces: `type Dict = typeof ko`, `t(lang, key, params?)`, 키 누락은 타입 오류. `useRevPoll(onChange)`: 4초마다 `/api/rev`, 탭 숨김 시 중지. 서버 오류 코드(`NIGHT_BEFORE_DAY` 등)와 `bodyKey`도 사전 키.
- 화면 문구(ko, 스펙 고정): 「오늘 못 나와요」, 「잘못 눌렀어요」, "오늘 일하러 와 주실 수 있나요?", 「갈 수 있어요」, 「못 가요」, "다른 분이 가기로 했습니다". 색: 주간 카드 `#FACC15`계열, 야간 `#1E3A8A`계열, 휴무 회색; 요청 박스 주간 주황 `#F97316`계열, 야간 남색.

- [ ] **Step 1: 실패 테스트 작성**

```ts
test('en/mn/vi 사전이 ko의 모든 키를 갖고 빈 문자열이 없다')
test('서버 오류 코드 전부(EngineError·login 코드 목록 상수)에 사전 키가 있다')
```

- [ ] **Step 2: 실패 확인 → 사전·화면 구현 → 테스트 PASS**
- [ ] **Step 3: 화면 확인** — `npm run seed:demo -- --pin=482917` 후 `npm run dev`, 브라우저 375×812에서 `/w/login?company=demo` → 사번·PIN 키패드 로그인 → PIN 변경 → 홈 카드 → 「오늘 못 나와요」 → 「잘못 눌렀어요」, 다른 근무자로 요청 화면·수락, 언어 4종 전환. 모든 버튼 높이 ≥ 56px(개발자 도구로 확인).
- [ ] **Step 4: Commit** — `feat(ui): 근무자 모바일 화면과 4개 언어 사전`

---

### Task 15: 관리자 로그인·배치 화면·결근 카드

**Files:**
- Create: `src/app/login/page.tsx`, `src/app/(admin)/admin/layout.tsx`(왼쪽 메뉴), `src/app/(admin)/admin/page.tsx`(배치), `src/components/admin/board/{BoardHeader,Summary,LineRow,PersonChip,VacancySlot,PersonPicker,ExceptionMenu}.tsx`, `src/components/admin/absence/{AbsencePanel,AbsenceCard,CandidateList}.tsx`
- Test: 수동 확인(아래) — 로직은 Task 9 API 테스트로 이미 검증

**Interfaces:**
- Consumes: `GET/POST /api/admin/board`, `useRevPoll`, `t('ko', …)`.
- 배치 화면 요소와 동작은 스펙 §5.2 그대로. `PersonPicker`: 사번·이름 검색만(자유 입력 저장 불가), 결과 항목에 소속 교대·현재 자리 표시. 후보 목록: 기본 3명 + 「후보 N명 더 보기」, 요청 보낸 사람은 항상 표시, 창 너비 720px, 이름 18px, 버튼 높이 42px. 요청 진행 중이면 남은 분 표시, 해결 시 "○○ 투입 완료 · N분 만에 해결". 오류 응답은 토스트로 사전 문구.

- [ ] **Step 1: 구현**
- [ ] **Step 2: 화면 확인** — 데모 회사 관리자 로그인 → 라인 제품 변경 → 「자동 배치」 → 빈자리 표시 → 이름 칸 결근 등록 → 결근 카드 후보 3명 → 「3명에게 동시에 요청」 → 근무자 탭에서 수락 → 4초 안에 관리자 화면에 해결 표시. 「확정」 → 「확정됨」.
- [ ] **Step 3: `npm run typecheck && npm test`** → 0 errors, 전부 PASS
- [ ] **Step 4: Commit** — `feat(ui): 관리자 배치 화면과 결근 카드`

---

### Task 16: 관리자 나머지 메뉴

**Files:**
- Create: `src/app/(admin)/admin/leaves/page.tsx`, `src/app/(admin)/admin/people/page.tsx`, `src/app/(admin)/admin/skills/page.tsx`, `src/app/(admin)/admin/master/page.tsx`, `src/app/(admin)/admin/excel/page.tsx`, `src/app/(admin)/admin/settings/page.tsx`, `src/components/admin/*` 필요한 것

**Interfaces:**
- Consumes: Task 10–12 API. 숙련도 표: 사람(행) × 자리(열), 칸 클릭 0→1→2→3→0, 직접 값 칸은 굵게. 엑셀: 업로드 → 미리보기 표(추가/수정/오류 색 구분, 오류 사유) → 「저장」, 모르는 양식은 sample 표만.

- [ ] **Step 1: 구현**
- [ ] **Step 2: 화면 확인** — 휴무 승인 → 배치 화면에 결근 카드, 신규 입사 등록(사번 자동 제안) → 근무자 로그인 가능, 퇴사 처리, 숙련도 칸 변경 → 자동 배치 결과 변화, 양식 받기 → 수정 → 올리기 미리보기 → 저장, 근태표 내려받기 열기, 설정 기한 30분 저장 후 요청 expiresAt 반영.
- [ ] **Step 3: `npm run typecheck && npm test`** → PASS
- [ ] **Step 4: Commit** — `feat(ui): 휴무 승인·근로자·숙련도·기준 정보·엑셀·설정 화면`

---

### Task 17: 만료 예약 작업·PWA·배포 준비·최종 검증

**Files:**
- Create: `src/app/api/cron/expire/route.ts`, `vercel.json`, `public/manifest.webmanifest`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `README.md`
- Test: `tests/server/cron.test.ts`

**Interfaces:**
- Produces: `GET /api/cron/expire` — `Authorization: Bearer ${CRON_SECRET}` 아니면 401, 맞으면 모든 회사 `expireCompany` 후 `{expired: n}`. `vercel.json`: `{"regions":["icn1"], "crons":[{"path":"/api/cron/expire","schedule":"* * * * *"}]}`. README: 로컬 실행, Supabase 새 프로젝트 연결(`DATABASE_URL` = pooler 연결 문자열, `npm run db:migrate`), 회사 등록, Vercel 배포, Hobby 요금제일 때 pg_cron+pg_net 대안 SQL, 원어민 검수 필요 항목, 회사 확인 필요 가정값(스펙 §9).

- [ ] **Step 1: 실패 테스트 작성**

```ts
test('비밀 없이 호출 → 401')
test('만료된 sent 요청이 있는 회사 2곳 → 둘 다 expired 처리, 응답 expired 수 일치')
```

- [ ] **Step 2–3: 구현 → PASS**
- [ ] **Step 4: 최종 검증** — `npm run typecheck && npm test && npm run build` 모두 성공. `npm run start` 후 Task 15·14 화면 흐름 한 번 더(관리자 PC 1280px + 근무자 375px).
- [ ] **Step 5: Commit** — `feat: 만료 예약 작업, PWA, 배포 설정과 README`
