# 원터치 라인 1차 구현 — 결정 기록

구현 중 계획·명세가 정하지 않았거나 서로 어긋난 부분에서 내린 결정(Ruling), 남겨 둔 문제, 미뤄 둔 작은 항목입니다. 각 줄의 "cost if wrong"은 결정이 틀렸을 때의 영향입니다.

## 배포 전에 처리 권장 (최종 리뷰에서 남은 항목)

- N1 (Important): /api/rev EXISTS sees overdue sent requests outside the snapshot window (absence >15 days ahead) → every poll takes the company lock + loads a snapshot without expiring — Ruling: real; no second fix wave per process; surfaced to user as a pre-production follow-up (fix: scope EXISTS to the snapshot window or expire overdue rows by direct SQL) — cost if wrong: lock contention only when an admin requests subs >15 days ahead.
- N2 (Important): withApi logs DrizzleQueryError.message which includes SQL bind params (could include secret_hash, names, phones) — Ruling: real; surfaced to user as a pre-production follow-up (fix: log SQL text + cause.code/message, never params) — cost if wrong: sensitive values in server logs on DB failures.

## 결정 (Ruling)

- Ruling: work on branch feat/onetouch-line-v1 in the same checkout instead of a separate worktree — repo is brand new, contains only docs, no parallel work — cost if wrong: none (branch is isolated from main).
- Ruling R1: shiftsWorked = regular shifts (crewShift≠off, not isOff) ∪ assignment rows, no board/past filter; weekHours counts Mon–Sun of weekStart(date) (weekStart..weekStart+6) including future scheduled shifts — spec §3.3 "이번 주(월~일) 근로시간" means the whole week's load — cost if wrong: people with heavy future schedules excluded from substitution slightly more often.
- Ruling R2: T14 adds `src/i18n/errorCodes.ts` exporting `ERROR_CODES` (every EngineError code thrown in src/engine + login/auth codes + API codes BAD_INPUT, FORBIDDEN, UNKNOWN_FORMAT, HAS_HISTORY, DUPLICATE_CODE) and the i18n test iterates it — cost if wrong: a missing code shows raw key in UI.
- Ruling R3: T1 scaffolds Next.js manually (package.json etc.), not via create-next-app — directory is non-empty — cost if wrong: none.
- Ruling R4: subagent commits carry their own model's Co-Authored-By trailer (e.g. Sonnet 5.5) per their environment's attribution reminder — accurate authorship beats the plan's fixed Opus line — cost if wrong: cosmetic trailer text.
- Ruling R5: Vite config warnings (CJS-loaded ESM config, vite-tsconfig-paths redundant) from Task 1 get fixed in Task 3's dispatch (rename to vitest.config.mts, use resolve.tsconfigPaths, drop plugin) — keeps test output pristine — cost if wrong: trivial.
- Ruling R6: person with unknown factoryId → EngineError('DATA_INTEGRITY') from shiftsWorked; unknown personId → [] / 0 (canWorkExtra says INACTIVE) — fail loudly on corrupt refs, tolerate absent people — cost if wrong: an action touching such a person errors instead of proceeding.
- Ruling R7: effectivePlan defaults a post with no plan cell to {productId:null, status: post.unmanned?'unmanned':'run'}; plan cells belong to the factory via post.factoryId; "가동 라인" = kind line ∧ status run ∧ ¬post.unmanned ∧ not stopped; 운반 +1 goes to lowest-sort active fixed post with role '운반'; standard gender applies to all slots of that post — spec §3.4 silent on missing cells; defaulting to run makes a new company usable before plans are entered — cost if wrong: lines with no plan show defaultNeed instead of 0.
- Ruling R8: Person has no lastPostId; "지난번 이 자리 +15" = postId of the person's most recent assignment strictly before (date, shift) in snap.assignments (night after day on same date) — spec §2 dropped last_post_id; derivable from history — cost if wrong: bonus misses people whose last post was >35 days ago.
- Ruling R9: autoAssign recomputes single-capable counts (gender-aware) before each post pick instead of once — spec §3.6 step 5 intent "scarce post first"; reviewer's 3-post case shows static order leaves a level-0 placement — cost if wrong: slight extra compute, different (better) placements than a static order.
- Ruling R10: toggleStop validates post∈factory (BAD_INPUT) and swap(a,a) → BAD_INPUT — cheap guards consistent with setPlan/assignPerson — cost if wrong: none.
- Ruling R11 (T5): spec §3.10 both excludes gender mismatches and lists a 'gender' warning → exclude only when slot gender and person gender are both set and differ; person gender null (2공장 data mostly blank) → include with 'gender' warning — cost if wrong: unknown-gender people appear for gendered posts with a warning.
- Ruling R12 (T5): lowSkill warning for skill ≤1 (matches flags 'low-skill'); rest candidates = all active persons (any factory) not in idle list and not assigned that date+shift that pass canWorkExtra; idle = own factory only — cost if wrong: level-0 people also warned.
- Ruling R15: applyChanges upserts in fixed FK-safe order (boards, plans, absences, assignments, subRequests, leaves) — removes key-order dependency — cost if wrong: none.
- Ruling R16: pin postgres to ^3.4 (drizzle 0.45 built against v3; v4 path unexercised here) — cost if wrong: miss v4 improvements.
- Ruling R18: lockout via atomic attempt reservation (conditional UPDATE … RETURNING), >5 reserved → lock without verify, conditional success reset; changeSecret shares it — spec §4.1 "5회 실패 → 10분 잠김" must hold under concurrency — cost if wrong: none (stricter).
- Ruling R19: requireWorker rejects must_change accounts with 403 MUST_CHANGE_PIN unless allowMustChange (me/secret/logout) — spec §4.1 "must_change면 PIN 변경 화면으로만" — cost if wrong: worker must change PIN before any action (intended).
- Ruling R20: all API id fields validated as uuid by zod (BAD_INPUT), and every factoryId/productId checked for snapshot membership before engine call — spec §2 tenant isolation — cost if wrong: none.
- Ruling R21: GET board default date = seoulDate(now) when only shift given — least surprise — cost if wrong: trivial.
- Ruling R23: raise vitest hookTimeout/testTimeout to 30000 (carry into T11 dispatch) — PGlite init + migrate per file can exceed 10s when 14 files run in parallel — cost if wrong: none.
- Ruling R24: worker self-cancel limited to absences with reportedBy==='self' (else FORBIDDEN); myAbsence exposes reportedBy — spec "잘못 눌렀어요" is undoing one's own report; admin-created/leave absences are cancelled by the admin — cost if wrong: worker must ask admin to undo admin-entered absences. (carried as T11 housekeeping)
- Ruling R25: withApi maps EngineError FORBIDDEN → 403 centrally (remove worker-route local mapping); board POST passes {now: nowFn()} to runAction (T11 housekeeping) — consistency — cost if wrong: none.
- Ruling R27: retirePerson must also move absences left 'in-progress' with no 'sent' request (after cancelling the retiree's requests) to 'failed', round+1, admin subFailed — otherwise they stick in-progress forever (expireRequests only touches sent rows) — carried as T12 housekeeping — cost if wrong: none.
- Ruling R29 (supersedes the date part of T12 rulings): read workbooks without cellDates and convert serials; JS Date fallback uses local parts — my earlier "SheetJS dates are UTC midnight" ruling was wrong for Excel-authored files — cost if wrong: none (serial path is TZ-independent).
- Ruling R32: T15 Part A carries worker-UI polish: leave grid base = view.today.date; useRevPoll in-flight guard; remember ?company in localStorage for re-login; fix '이번 달 기록' wrap — small, user-visible — cost if wrong: none.
- Ruling R33: admin UI copy may be Korean literals (spec i18n requirement is for worker screens); error codes still rendered via the ko dictionary — cost if wrong: admin UI not translatable without refactor.
- Ruling R34: leave grid must use the CALENDAR date (seoulDate(now)), not view.today.date (which is yesterday during 00–07 night shift) — my R32 item 1 was wrong; add `calendarDate` to WorkerView and use it (carry into T16 Part A) — cost if wrong: none.
- Ruling R35: 「다른 사람으로 바꾸기」 with an off-board person = assign + unassign (2 POSTs, non-atomic) accepted for 1차 — failure leaves an extra person on the post, visible and fixable — cost if wrong: rare transient over-assignment.
- Ruling R36: add GET /api/admin/skills?factoryId= (persons, posts, cells{level,manual}) — spec §4.2 lists skills POST only but the 숙련도 표 screen (§5.2) cannot render without it — cost if wrong: one extra read route.
- Ruling R37: persons POST / resetPin return WEAK_SECRET (not BAD_INPUT) for weak PINs — consistent error code — cost if wrong: none.
- Ruling R38: vercel.json has NO per-minute cron (Vercel Hobby rejects sub-daily crons at deploy); expiry already runs on every request; README documents Vercel Pro cron or Supabase pg_cron+pg_net calling /api/cron/expire — cost if wrong: on Pro, user must add the cron line manually.
- Ruling R39: T17 Part A carries user-facing robustness minors: AbortSignal.timeout fallback (old Android WebViews), single shared rev poller per admin page, 401→/login in PersonForm/SettingsForm/ImportPanel — cost if wrong: none.
- Ruling R40: exercise postgres-js path locally via @electric-sql/pglite-socket (`npm run test:pg`), fallback to documented TEST_DATABASE_URL run if infeasible — no Postgres/Docker on this machine — cost if wrong: driver differences vs real Supabase remain until first real run.
- Ruling R41: random prefilled initial PIN + per-company failure window (≥20 failed worker logins / 10 min → LOCKED for must_change or unknown accounts) — cost if wrong: during an attack, brand-new workers wait ≤10 min to activate.
- Ruling R42: fix now M1, M2, M3, M4, M5, M7 + countdown clamp; M6, M8, M9 stay deferred — cheap, user-visible — cost if wrong: none.
- Ruling R13: full T6 state-machine rulings in that file — board-exists-but-unassigned absence → not-needed; restore only if slot still open; accept failing canWorkExtra throws; decline with no sent left → failed — cost if wrong: edge-state behavior differs from original app
- Ruling R14: applyChanges removes-before-upserts, company_id forced, boards/plans by natural key, experience aggregated over all history incl. confirmed boards + sub rows; runAction expires first and reloads — cost if wrong: schema rework in later tasks
- Ruling R17: middleware checks cookie presence only, mustChange redirect moves to /w layout in T14; callRoute helper + setDbForTests moved into T8 — edge runtime lacks node crypto; later tasks need the helper — cost if wrong: unauthenticated users see a redirect one hop later
- Ruling R22: worker 'today' = current shift if working it, else today's own shift; requestOutcome takenByOther only within 24h; clock injection via src/server/clock.ts nowFn — cost if wrong: worker home shows a different card around shift boundaries
- Ruling R30: demo crews sized to need — F1 22/crew, F2 14/crew + D×6 each = 120; reset only for code 'demo'; createCompany creates no factories — cost if wrong: demo shows fewer vacancies than real data
- Ruling R31: worker login keypad is numeric-only for 사번 — demo empNos are numeric; alphanumeric empNos need a later change — cost if wrong: companies with letter empNos can't log in from the keypad

## 미뤄 둔 작은 항목 (minor, deferred)

- Task 1: minor (deferred): emptyChanges/mergeChanges/EngineError untested (types.ts:224-251)
- Task 1: minor (deferred): kst()/toDays() no input validation → NaN on malformed strings
- Task 1: minor (deferred): currentShift assumes dayStart<nightStart; no 18:59/19:00 boundary test
- Task 2: minor (deferred): shiftsWorked repeatedly scans arrays per day — O(days×records); revisit if recommend gets slow
- Task 2: minor (deferred): no test for fixed post role null + person role null; no test that approved leave on date−1 clears NIGHT_BEFORE_DAY
- Task 3: minor (deferred): 운반 +1 may land on an unmanned 운반 post (demand.ts:313-317) — filter !unmanned
- Task 3: minor (deferred): fallback date chosen from inactive-post cells too (demand.ts:262-263)
- Task 3: minor (deferred): no test for 6 lines with one stopped → no +1; no test that other factory's cells are ignored in fallback
- Task 4: minor (deferred): RED/GREEN evidence summarized only in first report
- Task 4: minor (deferred): swap/recount use first slot's gender per post (mixed-gender posts not modeled)
- Task 5: minor (deferred): tuple precedence weakly tested (no cross-key test for keys 2–6); empNo lookup O(n) in comparator (recommend.ts:100); unknown postId silent (recommend.ts:55); idle-path hours/gender warnings untested
- Task 6: minor (deferred): respondSub expired/decline paths call failIfNoneSent without status==='in-progress' guard (absence.ts:251-260)
- Task 6: minor (deferred): requestSubs doesn't dedupe personIds in one call (absence.ts:189)
- Task 6: minor (deferred): leaveAbsence silently skips when person/factory missing (leave.ts:60-62)
- Task 6: minor (deferred): test naming/coverage gaps (absence.test.ts:377 name, :361 outcome assert, restore-skip by other assignment, leave approve with board+assignment)
- Task 7: minor (deferred): loadSnapshot outside a tx is not a consistent read — read routes should load snapshot+rev in one tx
- Task 7: minor (deferred): loadSnapshot ~17 sequential queries, runs twice when expiry fires — perf follow-up
- Task 7: minor (deferred): DB constraint errors surface raw (not EngineError); in-batch dedupe hides duplicate upserts
- Task 7: minor (deferred): no direct test that a same-company update returns a row (covered indirectly)
- Task 8: minor (deferred): stateless sessions survive PIN change/logout (no server revocation) — inherent to design
- Task 8: minor (deferred): no per-IP/spray limit (common initial PIN across many empNos) — consider later
- Task 8: minor (deferred): withApi logs only e.name server-side; /api/me re-queries account
- Task 8: minor (deferred): lockNow unconditional re-lock; changeSecret success updates last_login_at; abandoned reservations persist on crash; no route-level 423 test for /api/auth/secret; /api/rev reachable while must_change
- Task 9: minor (deferred): GET shift-only default test doesn't assert date===today; "neither given" default untested
- Task 10: minor (deferred): dayCard picks first assignment of the date ignoring shift (workerView.ts:349); boundary cases 06:59/07:00/19:00 untested; privacy scan doesn't check empNo
- Task 11: minor (deferred): retire test covers leftAt=today only; empty master PATCH still bumps rev; post factoryId PATCH allowed with existing rows on old factory
- Task 12: minor (deferred): previewPlan loads every plan cell of the company per preview/commit (scaling); upload size checked after multipart parse; attendance 조 column prints raw crew letter
- Task 12: minor (deferred): excel-tz test never restores process.env.TZ (safe under per-file isolation)
- Task 13: minor (deferred): reset test doesn't prove other companies survive; DEFAULT_SETTINGS literals duplicated in tests/fixtures; CLIs print e.message for unknown errors; --seed=abc silently → 0
- Task 14: minor (deferred): '이번 달 기록' button label wraps mid-word on 375px; monthly record counts today's not-yet-started shift as worked
- Task 14: minor (deferred): takenByOther banner remembered per date; logout ignores POST failure; i18n grep test misses double-quoted codes
- Task 15: minor (deferred): fixed posts show a product select (meaningless for fixed); useRevPoll /api/rev has no timeout → hung request stops polling; ◀▶ double-click moves one day; run() relies on disabled only; admin mustChange unhandled; no component tests of POST payload wiring
- Task 16: minor (deferred): UTF-8 CSV without BOM read as Latin-1 (garbled preview); admin mustChange unhandled; suggestEmpNo/strongEnough moved to src/lib/personRules.ts (re-exported)
- Task 16: minor (deferred): skills page shows stale grid during factory switch; settings ratio rounded to 0.1%; PATCH persons always sends empNo (unverified same-person no-op)
- Task 17: minor (deferred): absence panel shows "21분 남음" for fresh 20-min request (stale 15s clock + ceil rounding) — from T15; 운반 +1 threshold is a code constant not a setting (README notes it)
- Task 17: minor (deferred): nft regression test lacks a negative fixture proving it catches `1n`; Bearer match case-sensitive; make-icons has no npm script
- Final: minor (deferred): N3 poll pile-up at expiry instant; N4 spray window reveals activated 사번 by timing/status; N5 db-config test env restore; N6 duplicate PinInput id
