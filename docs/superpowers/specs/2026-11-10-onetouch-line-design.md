# 원터치 라인 재구축 설계 (1차)

- 작성일: 2026-11-10
- 근거 문서: 「원터치 라인 시스템 정리 — 다시 만들기 위한 기능·규칙·구조 명세」(기준일 2026-11-10, 이하 "원 명세")
- 상태: 설계 승인됨 → 명세 검토 대기

## 0. 목표와 범위

교대제 공장에서 생산계획에 맞춰 생산 인력을 자동 배치하고, 결근이 생기면 대체 인력을 추천해 휴대폰으로 요청하는 웹 서비스를 **실제 공장 운영용**으로 다시 만든다.

### 합의된 결정

| 항목 | 결정 |
|---|---|
| 용도 | 실제 공장 운영. 비밀번호 없는 입장·체험 계정·데모 초기화·데모 시계는 넣지 않는다 |
| 인프라 | Next.js 15 + TypeScript + Drizzle ORM + **새 Supabase Postgres**(서울). 기존 키는 쓰지 않는다 |
| 로컬 실행 | `DATABASE_URL`이 없으면 내장 Postgres(PGlite)로 동작(개발·테스트용) |
| 1차 범위 | 핵심 운영 흐름 전부(아래 0.1) |

### 0.1 1차에 넣는 것
1. 로그인·권한(관리자 아이디+비밀번호, 근무자 사번+숫자 PIN 6자리)
2. 12일 주기 교대 달력, 공장별 기준일
3. 생산계획 → 필요 인원 → 자동 배치 → 직접 수정(잠금·맞바꿈) → 확정
4. 결근 신고 → 대체 추천 → 요청(단독·동시) → 선착 1명 수락 → 해결 / 실패 시 재추천 / 신고 취소
5. 휴무 신청·승인·반려·취소, 승인 시 결근 흐름 연결
6. 근로자 관리, 숙련도 표, 기준 정보(공장·자리·제품 마스터·표준 인원), 설정
7. 근무자 모바일 화면(한국어·영어·몽골어·베트남어)
8. 서버 측 요청 만료(요청마다 처리 + 예약 작업 주소)
9. 표준 양식 엑셀 가져오기(명단·생산계획)·양식 받기·월 근태표 내보내기
10. 회사 등록 스크립트, 데모 회사 시드 스크립트(가상 데이터, 연습용)

### 0.2 1차에서 빼는 것 (2차 이후)
- 알림톡·문자·웹 푸시 실제 발송(1차는 `messages` 표에 기록만)
- 2025년 배치표 양식 전용 변환기, 이력 기반 숙련도 채우기(원본 엑셀이 이 PC에 없음)
- 자동 모드(1순위 해결안 자동 진행·라운드 요청)
- 2공장 "반장 입안 → 팀장 결정" 결재 화면(공장에 `approval` 값만 둔다)
- 실시간 구독(1차는 변경 번호 폴링)

## 1. 구조

```
src/
  engine/        업무 규칙 순수 함수 (DB·화면 의존 없음)
    calendar.ts      교대 달력
    time.ts          서울 시각·교대 시각 계산
    eligibility.ts   대체 근무 가능 판단, 주 근로시간
    demand.ts        필요 인원 계산
    skill.ts         숙련도·가동률
    autoAssign.ts    자동 배치
    recommend.ts     대체 추천 정렬·주의 표시
    absence.ts       결근·요청 상태 전이
    types.ts         엔진 입력·출력 타입
  server/
    db/            Drizzle 스키마, 연결(Postgres 또는 PGlite), 마이그레이션
    auth/          세션 쿠키(HMAC), 비밀번호/PIN 해시(scrypt), 잠금
    repo/          회사 단위 데이터 읽기 → 엔진 입력(Snapshot) 조립
    actions/       동작 처리: 엔진 호출 → 트랜잭션 저장 → rev 증가
    expire.ts      만료 요청 정리
  i18n/          ko, en, mn, vi 사전
  app/
    login/         관리자 로그인
    admin/         관리자 화면
    w/             근무자 화면
    api/           라우트 핸들러
scripts/
  create-company.ts   회사 + 관리자 계정 만들기
  seed-demo.ts        가상 데모 회사 만들기
tests/              Vitest
```

원칙
- 엔진은 `Snapshot`(필요한 표의 행)과 `now`를 받아 결과나 변경 목록을 돌려준다. 시각은 항상 인자로 받는다(테스트 가능).
- 서버 동작은 "읽기 → 엔진 → 한 트랜잭션에 저장 → 회사 `rev` + 1"이다. 회사 전체 JSON을 주고받지 않는다.
- 모든 날짜는 서울 시각(Asia/Seoul) 기준 `YYYY-MM-DD` 문자열이다. 야간 교대는 시작한 날짜로 기록한다.

## 2. 데이터 모델 (Postgres)

모든 표에 `company_id`가 있고, 서버는 세션의 회사 id로만 조회한다. Supabase RLS는 켜고 공개 정책은 두지 않는다(서버만 접속 문자열로 접근).

| 표 | 주요 열 | 제약·설명 |
|---|---|---|
| companies | id, code(유일), name, rev bigint, created_at | rev = 데이터 변경 번호 |
| settings | company_id(PK), shift_day_start '07:00', shift_night_start '19:00', shift_credit_hours 8, max_week_hours 52, warn_week_hours 44, request_expiry_min 20, weights jsonb, skill_rates jsonb | 회사 확인 전 가정값은 모두 여기 |
| factories | id, company_id, code, name, approval(confirm/draft-decide), leader_phone, cycle_base_date, sort | cycle_base_date = A조 주간 첫날. 기본 1공장 2025-04-27, 2공장 2025-04-28 |
| posts | id, company_id, factory_id, code, name, kind(line/fixed), role, unmanned, priority, default_need, active, sort | (company, factory, code) 유일 |
| products | id, company_id, code, name, urgent, active | (company, code) 유일. 제품 마스터 |
| standards | id, company_id, post_id, product_id(null=라인 기본), need, gender(null/M/F) | (post, product) 유일 |
| plan_cells | company_id, date, shift(day/night), post_id, product_id, status(run/off/unmanned) | (company, date, shift, post) 유일 |
| persons | id, company_id, emp_no, name, affiliation(direct/partner/temp), crew(A/B/C/D=주간조), role, gender, phone, factory_id, lang(ko/en/mn/vi), fixed_post_id, active, hired_at, left_at | (company, emp_no) 유일. 퇴사 = active false |
| skills | person_id, post_id, level 0~3 | 관리자가 직접 고친 값만 저장. 없으면 이력으로 계산 |
| experience_base | person_id, post_id(null), product_id(null), count | 엑셀 등에서 가져온 과거 경험(1차는 비어 있어도 됨) |
| boards | company_id, date, shift, factory_id, status(draft/confirmed), stopped_post_ids uuid[], confirmed_at, confirmed_by | (company, date, shift, factory) 유일 |
| assignments | id, company_id, date, shift, factory_id, post_id, person_id, source(auto/manual/sub/move), locked, reason, flags text[], created_at | **(company, date, shift, person) 유일** — 한 사람이 같은 교대에 두 자리 불가 |
| absences | id, company_id, date, shift, factory_id, person_id, post_id(null), kind(absent/sick/early/late/leave), reported_by(self/leader/support), reason, status(pending-board/not-needed/decided/in-progress/resolved/failed/cancelled), resolved_person_id, round, restore jsonb, created_at, resolved_at | (company, date, shift, person) 중 취소되지 않은 것 유일 |
| sub_requests | id, company_id, absence_id, person_id, round, rank, status(sent/accepted/declined/expired/cancelled), sent_at, expires_at, responded_at | |
| leave_requests | id, company_id, person_id, date, kind, status(pending/approved/rejected/cancelled), created_at, decided_at | (person, date) 중 pending/approved 유일 |
| messages | id, company_id, person_id(null=관리자), body_key, params jsonb, channel(push/alimtalk/sms/admin), created_at | 1차는 기록만 |
| accounts | id, company_id, kind(admin/worker), login_id, person_id(null), secret_hash, must_change, failed_count, locked_until, last_login_at | 관리자 login_id = 아이디, 근무자 login_id = 사번 |

경험 횟수 = `experience_base` + 확정된 배치표의 배치 + 해결된 대체 배치 수(계산값, 저장하지 않음).

## 3. 엔진 규칙

### 3.1 교대 달력 (`calendar.ts`)
- 12일 주기: 0–3일 주간, 4–5일 휴무, 6–9일 야간, 10–11일 휴무.
- 조별 위치: `pos = (경과일 − 조오프셋 × 4) mod 12`, 경과일 = date − factory.cycle_base_date, 오프셋 A=0, B=1, C=2.
  - 검증: 어느 날이든 주간 1개 조, 야간 1개 조, 휴무 1개 조가 된다(테스트로 확인).
- 주간조(D): 월~금 주간, 토·일 휴무.
- `crewShift(factory, crew, date) → 'day' | 'night' | 'off'`, `regularShift(person, date)`.

### 3.2 시각 (`time.ts`)
- 주간 = date 07:00 ~ date 19:00, 야간 = date 19:00 ~ date+1 07:00(설정값).
- `shiftStart(date, shift)`, `hasShiftStarted(now, date, shift)`, 주(월~일) 경계.

### 3.3 대체 근무 가능 판단 (`eligibility.ts`)
`canWorkExtra(person, date, shift, ctx)` — 하나라도 걸리면 후보에서 제외하고 사유를 돌려준다.
1. 재직 중(active)
2. 그날 승인된 휴무·결근(취소되지 않은)이 없음
3. 같은 날 이미 근무하지 않음(정규 교대 또는 배치, 주간→야간 연속 포함)
4. 전날 야간이었으면 오늘 주간 금지
5. 오늘 야간 후보인데 내일 주간이 잡혀 있으면 금지
6. 이번 주(월~일) 근무 교대 수 × shift_credit_hours + shift_credit_hours ≤ max_week_hours

"근무" = 정규 교대 중 결근·휴무가 없는 날 + 다른 교대에 들어간 배치.

### 3.4 필요 인원 (`demand.ts`)
- 그날 그 교대 계획이 없으면 같은 공장·같은 교대의 가장 최근 계획을 이어 쓴다.
- 라인(line): run이고 세우지 않은 경우 → standards(post, product) → standards(post, null) → post.default_need. off·unmanned·세운 라인 → 0.
- 고정 자리(fixed): 가동 라인이 0개면 0, 아니면 default_need. 가동 라인이 6개 이상이면 role = '운반' 자리에 +1.
- 성별 조건이 있는 표준은 칸(slot)에 성별 조건을 붙인다.

### 3.5 숙련도 (`skill.ts`)
| 단계 | 이름 | 가동률(설정) | 이력 기준 |
|---|---|---|---|
| 0 | 없음 | 30% | 0회 |
| 1 | 보조 필요 | 60% | 1회 이상 |
| 2 | 단독 가능 | 90% | 10회 이상 |
| 3 | 숙련·지도 가능 | 100% | 30회 이상 |

우선순위: skills 표의 값 → 고정 자리(지정 사람 3, 같은 역할 2, 그 외 0) → 이력 횟수. 예상 가동률은 계산하되 화면에는 표시하지 않는다.

### 3.6 자동 배치 (`autoAssign.ts`)
한 공장·한 교대 단위.
1. 필요 인원만큼 칸을 만든다.
2. 잠긴 배치는 유지하고 그만큼 칸을 지운다. 잠기지 않은 기존 배치는 지우고 다시 계산한다.
3. 후보 = 그 교대 정규 근무자(달력 기준, 휴무·결근 제외) 중 아직 안 들어간 사람.
4. 고정 자리는 지정된 사람(fixed_post_id)을 먼저 넣는다.
5. 나머지 칸은 단독 가능(숙련도 2 이상) 후보가 적은 자리부터, 같으면 priority 높은 자리부터 채운다.
6. 칸마다 점수가 가장 높은 사람을 넣는다(동점이면 사번 순).
7. 남은 사람 = 대기 인원, 못 채운 칸 = 빈자리.

배치 점수 = 가동률 × 100 + (지난번 이 자리 +w.samePost 15) + min(이 자리 근무 횟수, 50) × 0.2 + (오늘 제품 경험 +w.sameProduct 3) + (같은 공장 +w.sameFactory 1) + (역할 일치 +w.roleMatch 5, 다르면 −20) − (최근 30일 대체 수락 × w.recentSub 25, 대체 후보일 때만) − max(0, 이번 주 시간 − 40) × 0.5

플래그: no-exp(경험 0), low-skill(숙련도 ≤1), role, gender, hours(44시간 이상).

### 3.7 직접 수정
- 사람 지정 → 그 배치는 locked, source=manual.
- 같은 교대 다른 자리 사람을 고르면 두 사람을 맞바꾸고 둘 다 locked.
- 같은 교대 대기 인원이 아닌 사람(쉬는 사람)을 넣을 때는 3.3을 검사하고, 걸리면 사유를 보여 주고 막는다.
- 확정 후에도 수정 가능, 상태는 확정 유지.

### 3.8 확정
board.status = confirmed, 배치된 각 근무자에게 "오늘 근무" 메시지 기록.

### 3.9 결근 흐름 (`absence.ts`)
1. 신고: 본인(「오늘 못 나와요」) 또는 관리자(결근·병가·조퇴·지각). 같은 사람·날짜·교대에 취소되지 않은 신고가 있으면 무시.
2. 그 사람의 배치를 지우고 restore에 보관. 관리자 메시지 기록.
3. 상태 결정:
   - 배치표가 없거나 그 사람이 배치 전 → `pending-board`(자동 배치 때 후보에서 빠짐)
   - 그 자리 남은 인원 ≥ 필요 인원 → `not-needed`
   - 그 외 → `decided`(관리자 화면에 결근 카드 + 추천)
4. 관리자 선택:
   - 대기 인원 「바로 배치」 → sub 배치(locked), resolved
   - 쉬는 사람 「배치」(전화 확인 후, 확인 창) → 3.3 검사 후 sub 배치, resolved
   - 「요청」 1명 또는 「N명에게 동시에 요청」(기본 3명) → sub_requests sent, expires_at = now + 20분, absence = in-progress
5. 응답(근무자):
   - 수락: 행 잠금(`SELECT … FOR UPDATE` on absence) 후 absence가 in-progress이고 요청이 sent이며 3.3을 통과하면 → 그 자리에 sub 배치(locked), absence resolved, 다른 sent 요청 cancelled + "다른 분이 가기로 했습니다" 메시지. 이미 해결됐으면 늦은 수락자에게 같은 문구.
   - 거절: declined.
6. 만료(`expire.ts`): sent이고 expires_at ≤ now인 요청 → expired. absence에 sent 요청이 하나도 남지 않으면 → `failed`(결근 카드가 추천 목록으로 돌아감, round + 1). 모든 API 요청 처리 전에 그 회사에 대해 실행하고, `/api/cron/expire`(CRON_SECRET 필요)에서 전 회사 대상으로도 실행한다.
7. 신고 취소: resolved 전이면 sent 요청 cancelled, restore로 원래 배치 복원, absence cancelled. 근무자 본인은 교대 시작 전까지만.

### 3.10 대체 추천 (`recommend.ts`)
- 후보 = 그 교대 대기 인원 + 쉬는 사람(같은 공장 + 다른 공장). 성별 조건 불일치·3.3에 걸리면 제외.
- 정렬(앞 기준이 항상 우선, 사전식 비교):
  1. 오늘 쉬는 사람 우선
  2. 이 업무 경험(숙련도 ≥1 또는 이 자리 근무 이력)
  3. 오늘 이 라인 제품 경험
  4. 최근 30일 대체·직접 배치 횟수 적은 순
  5. 숙련도 높은 순 → 같은 공장 → 이번 주 근무시간 적은 순 → 사번
- 대기 인원은 정렬과 별개로 「바로 배치」 버튼이 붙는다.
- 주의 표시: 숙련도 낮음(1단계), 역할 다름, 성별 조건 다름, 이번 주 44시간 이상.
- 근거 표시: 업무 경험, 같은 제품, 다른 공장 이름.

### 3.11 휴무
- 근무자가 앞으로 14일 중 하루 신청(같은 날 pending/approved 있으면 무시) → pending.
- 대기 중이면 근무자가 취소 가능.
- 관리자 승인 → approved. 그날이 정규 근무일이면 kind=leave인 결근 신고(3.9)를 자동 생성. 반려 → rejected.

## 4. 서버·보안

### 4.1 인증
- 관리자: 아이디 + 비밀번호(최소 8자). 근무자: 사번 + PIN 6자리(숫자).
- 해시: scrypt(salt 포함). 5회 연속 실패 → 10분 잠김. 성공하면 실패 횟수 초기화.
- 근무자 초기 PIN은 관리자가 정하거나 재설정한다. must_change = true면 로그인 직후 PIN 변경 화면으로만 간다.
- 세션: `{accountId, companyId, kind, personId, exp}`를 HMAC-SHA256으로 서명한 httpOnly·Secure·SameSite=Lax 쿠키, 30일.
- 근무자 API는 본인 데이터만 돌려준다. 다른 사람의 전화번호는 어디에서도 주지 않는다. 근무자는 배치를 수정할 수 없다.

### 4.2 API

| 경로 | 권한 | 내용 |
|---|---|---|
| POST /api/auth/login | 공개 | {company, kind, loginId, secret} |
| POST /api/auth/logout | 로그인 | |
| POST /api/auth/secret | 로그인 | 비밀번호·PIN 변경 |
| GET /api/me | 로그인 | 현재 계정 |
| GET /api/rev | 로그인 | 회사 변경 번호(화면이 4초마다 확인) |
| GET /api/admin/board?date&shift&factory | 관리자 | 배치 화면 데이터(요약·라인·배치·대기·결근 카드·추천) |
| POST /api/admin/board | 관리자 | 동작: setPlan, stopLine, autoAssign, confirm, assign, swap, unassign, reportAbsence, cancelAbsence, placeSub, requestSub |
| GET·POST /api/admin/leaves | 관리자 | 목록, approve/reject |
| GET·POST·PATCH·DELETE /api/admin/persons | 관리자 | 근로자 CRUD, 퇴사·복직 |
| POST /api/admin/skills | 관리자 | 숙련도 칸 변경 |
| GET·POST /api/admin/accounts | 관리자 | 잠금 확인·풀기, PIN 재설정 |
| GET·POST·PATCH·DELETE /api/admin/master/{factories,posts,products,standards} | 관리자 | 기준 정보 |
| GET·PUT /api/admin/settings | 관리자 | 설정 |
| POST /api/admin/import?mode=preview\|commit | 관리자 | 엑셀 가져오기 |
| GET /api/admin/template?type=roster\|plan | 관리자 | 양식 받기 |
| GET /api/admin/export/attendance?month | 관리자 | 월 근태표 |
| GET /api/worker | 근무자 | 오늘·내일 근무, 진행 중 요청, 휴무 신청, 월 기록 |
| POST /api/worker | 근무자 | 동작: reportAbsence, cancelAbsence, respond, requestLeave, cancelLeave, setLang |
| GET /api/cron/expire | CRON_SECRET | 만료 처리 |

- 입력은 zod로 검사한다. 오류는 `{error: code}`로 돌려주고 화면이 사전에서 문구를 찾는다.
- 모든 쓰기 동작은 한 트랜잭션 안에서 끝나고 companies.rev를 1 올린다.

### 4.3 환경 변수
`DATABASE_URL`(Supabase Postgres 접속 문자열, 없으면 PGlite `./.data/pglite`), `SESSION_SECRET`(32바이트 이상), `CRON_SECRET`. `.env*`는 git에 넣지 않는다.

## 5. 화면

### 5.1 공통
- Tailwind CSS. PWA manifest·아이콘.
- `/login`(관리자)과 `/w/login`(근무자)을 분리. 회사 코드는 주소 `?company=`(기본값은 환경 변수 `DEFAULT_COMPANY`)에서 받는다.

### 5.2 관리자 (`/admin`, PC 기준 너비 1280px)
- **배치**: 위쪽에 공장·교대·날짜(이전/다음) 선택. 요약 줄(필요/출근/남음·부족). 라인별 줄: 코드·이름, 제품 드롭다운(쉼·무인 포함, 제품 마스터에서만 선택), 세우기 토글, 필요 인원, 이름 칸, 빈자리(빨간 점선 「빈자리 +」). 「자동 배치」·「확정」(확정 후 「확정됨」). 이름 칸 → 예외 등록(결근·병가·조퇴·지각) 또는 사람 바꾸기(사번·이름 검색, 맞바꿈). 빈자리 → 추천 목록 + 대기 인원 직접 고르기.
- **결근 카드**(배치 화면 오른쪽 패널): 누가·어느 자리·언제, 추천 목록(3명 + 「후보 N명 더 보기」, 요청 보낸 사람은 항상 보임), 줄 = 순위·이름·휴무/대기·근거·주의·버튼, 「3명에게 동시에 요청」, 요청 진행 상태(남은 시간), 해결 시 「○○ 투입 완료 · N분 만에 해결」. 추천 창 너비 720px, 이름 18px, 버튼 높이 42px.
- **휴무 승인**: 대기 목록, 승인/반려.
- **근로자**: 목록(재직/퇴사 필터·검색), 등록(사번 자동 제안 = 최대 사번 + 1), 수정, 퇴사(기록 유지)·복직·삭제(배치 이력이 없을 때만), PIN 재설정, 잠금 풀기. 숙련도 표(사람 × 자리, 칸 클릭 0→1→2→3→0).
- **기준 정보**: 공장(이름·결재 방식·달력 기준일), 자리, 제품, 표준 인원표.
- **엑셀**: 파일 올리기 → 양식 자동 판별(명단/계획/모름) → 미리보기 "추가 N · 수정 M · 오류 K"(오류 행 사유 표시) → 저장. 모르는 양식은 미리보기만.
  - 명단 열: 사번·이름·소속·조·역할·성별·전화·공장·언어·입사일·퇴사일·지정자리 + 라인 코드 열(값 0~3 = 숙련도)
  - 계획 열: 날짜·교대·공장·라인·제품(코드)·상태
  - 월 근태표: 사람 × 날짜 칸(주/야/휴/결/대), 합계 열.
- **설정**: 3.x의 모든 설정값.

### 5.3 근무자 (`/w`, 휴대폰)
- 로그인: 사번·PIN 숫자 키패드(버튼 64px), 오른쪽 위 언어 메뉴. 첫 로그인 시 PIN 변경.
- 홈: 「오늘 내 근무」 카드(주간 노랑/야간 남색/휴무 회색, 날짜·교대·시간·공장·자리), 「내일」 작은 카드, 「오늘 못 나와요」(교대 시작 전까지, 신고 후 「잘못 눌렀어요」), 휴무 신청, 이번 달 기록.
- 대체 요청이 있으면 화면 전체가 요청으로 바뀜: "오늘 일하러 와 주실 수 있나요?" + 날짜·교대·시간·공장·자리 + 남은 시간 + 「갈 수 있어요 / 못 가요」(주간 주황, 야간 남색). 늦게 수락하면 "다른 분이 가기로 했습니다".
- 휴무 신청: 앞으로 14일 달력에서 날짜 선택 → 신청 → 상태 표시, 대기 중이면 취소.
- 이번 달 기록: 근무일, 주간·야간 횟수, 인정 시간, 대체 근무, 빠진 날.
- 규칙: 버튼 56px 이상, 본문 18px 이상, 글자 입력 없음(PIN 키패드만), 문구는 i18n 사전에만. 몽골어·베트남어는 초안이며 원어민 검수가 필요하다.

## 6. 스크립트
- `npm run company:create -- <code> <name> --admin=<id> --password=<pw>`: 회사, 기본 설정, 관리자 계정.
- `npm run seed:demo`: 회사 코드 `demo`에 가상 데이터(1공장 L-1~L-8 성형 기본 2명, 2공장 S-1~S-6 사출 1~2명·P-1~P-2 프리폼 무인, 고정 자리 OP·BOX·운반·반장·설비관리, 2공장은 생산관리 추가·BOX 없음, 제품 7종, 근무자 120명, 초기 PIN 공통). 운영 회사에는 쓰지 않는다.
- `npm run db:migrate`: Drizzle 마이그레이션.

## 7. 테스트 (Vitest)
- 엔진 단위:
  - 달력: 12일 주기, 매일 주간·야간·휴무 각 1개 조, 2공장 하루 늦음, 주간조 주말 휴무
  - 가능 판단: 야간 다음 날 주간 금지, 같은 날 중복, 52시간
  - 필요 인원: 계획 이어 쓰기, 표준 우선순위, 운반 +1
  - 자동 배치: 잠금 유지, 희소 자리 우선, 중복 배치 없음, 동점 사번 순
  - 추천: 정렬 순서, 제외 조건, 주의 표시
  - 결근 상태 전이: not-needed, pending-board, 요청 → 수락/거절/만료 → failed, 신고 취소 복원
- 서버(PGlite):
  - 두 명 동시 수락 → 1명만 배치
  - 근무자는 다른 사람 데이터·전화번호를 받지 못하고 관리자 API는 403
  - 로그인 5회 실패 → 잠김
  - 같은 교대 같은 사람 두 번 배치 → DB 제약으로 실패
  - 만료 처리
- 흐름: 시드 데이터로 "계획 → 자동 배치 → 확정 → 결근 → 동시 요청 → 수락 → 해결"을 6일 연속 실행.

## 8. 배포 메모
- Vercel 서울(icn1) 고정. GitHub 저장소 연결, 비밀 값은 Vercel 환경 변수에만 둔다.
- 1분 단위 Vercel Cron은 Pro 요금제가 필요하다. 요청마다 만료를 처리하므로 Cron은 보조이며, Hobby라면 Supabase pg_cron + pg_net으로 `/api/cron/expire`를 호출하는 방법을 쓴다.

## 9. 회사 확인이 필요한 가정값 (설정에서 변경 가능)
교대 시각(07/19시), 1회 인정 시간(8시간), 주 최대(52시간)·주의(44시간), 요청 기한(20분), 숙련도별 가동률, 배치 가중치, 공장별 달력 기준일(1공장 2025-04-27, 2공장 2025-04-28), 가동 라인 6개 이상 시 운반 +1.
