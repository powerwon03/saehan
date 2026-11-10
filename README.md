# 원터치 라인

교대제 공장의 생산 인력 배치 웹 서비스입니다. 생산계획에 맞춰 사람을 자동 배치하고, 결근이 생기면 대체 인력을 추천해 근무자 휴대폰 화면으로 요청합니다.

- 관리자 화면 `/login` → `/admin` (PC, 너비 1280px 기준): 배치·결근 카드, 휴무 승인, 근로자, 숙련도, 기준 정보, 엑셀, 설정
- 근무자 화면 `/w/login` → `/w` (휴대폰, 한국어·영어·몽골어·베트남어): 오늘·내일 근무, 「오늘 못 나와요」, 대체 요청 수락, 휴무 신청, 이번 달 기록
- Next.js 15 · TypeScript · Drizzle ORM · Postgres(Supabase). `DATABASE_URL`이 없으면 내장 PGlite로 동작합니다(개발·테스트용).

## 로컬 실행

Node 24 기준입니다.

```bash
npm i
cp .env.example .env.local      # 아래 값을 채웁니다
npm run db:migrate
npm run seed:demo -- --pin=<숫자 6자리> --admin-password=<8자 이상>
npm run dev
```

- `.env.local`에는 최소한 `SESSION_SECRET`(32자 이상)과 `DEFAULT_COMPANY=demo`를 넣습니다. `DATABASE_URL`을 비워 두면 `./.data/pglite`(또는 `PGLITE_DIR`)에 로컬 DB가 만들어집니다.
- `SESSION_SECRET` 만들기: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
- `npm run db:migrate`, `npm run company:create`, `npm run seed:demo`는 `.env.local`을 읽습니다(셸에서 직접 준 환경 변수가 우선).
- 관리자: http://localhost:3000/login — 데모 회사 아이디 `admin`, 비밀번호는 `--admin-password`로 준 값
- 근무자: http://localhost:3000/w/login — 사번(데모는 `1001`부터) + `--pin`으로 준 PIN. 처음 로그인하면 PIN을 바꾸게 됩니다.
- PIN은 숫자 6자리이며 같은 숫자 반복, `123456`, `654321`은 쓸 수 없습니다.
- 데모 데이터는 가상 데이터(연습용)입니다. 운영 회사에는 쓰지 않습니다. 다시 만들려면 `--reset`을 붙입니다.

## 새 Supabase 프로젝트 연결

기존 프로젝트·키는 쓰지 않고 새 프로젝트(리전: 서울 `ap-northeast-2`)를 만듭니다.

1. Supabase → **Project Settings → Database → Connection string → Transaction pooler**의 문자열(포트 `6543`)을 복사하고 `[YOUR-PASSWORD]`를 DB 비밀번호로 바꿉니다.
2. 이 값을 `.env.local`의 `DATABASE_URL`과 Vercel 환경 변수 `DATABASE_URL`에 넣습니다. **저장소에는 절대 커밋하지 않습니다**(`.env*`는 `.gitignore`에 있음, `.env.example`만 커밋).
3. 스키마를 만듭니다: `npm run db:migrate` (출력: `migrated DATABASE_URL`). 이후 스키마가 바뀔 때마다 다시 실행합니다.
4. 마이그레이션이 모든 표에 RLS를 켜고 정책은 만들지 않습니다. 그래서 브라우저(anon/authenticated 키)는 표를 읽을 수 없고, 서버만 `DATABASE_URL`로 접근합니다. Supabase 대시보드의 "RLS enabled, no policies" 경고는 의도한 상태입니다.

> 마이그레이션이 Transaction pooler에서 실패하면, 마이그레이션할 때만 같은 화면의 Session pooler(포트 `5432`) 문자열을 셸에서 `DATABASE_URL`로 주고 실행하세요. 앱은 Transaction pooler를 씁니다.

## 회사 등록

```bash
npm run company:create -- <회사코드> <회사이름> --admin=<관리자 아이디> --password=<8자 이상>
# 예: npm run company:create -- saehan 새한 --admin=manager --password='...'
```

회사, 기본 설정(아래 가정값), 관리자 계정이 만들어집니다. 공장·자리·제품·표준 인원은 관리자 화면 「기준 정보」에서, 근로자는 「근로자」 또는 「엑셀」(명단 양식)에서 넣습니다. 회사 코드는 로그인 주소의 `?company=<회사코드>`로 정하고, 없으면 `DEFAULT_COMPANY`를 씁니다.

## Vercel 배포

1. GitHub 저장소를 Vercel에서 Import 합니다(프레임워크: Next.js, 빌드 명령은 기본값).
2. 함수 리전은 `vercel.json`의 `"regions": ["icn1"]`(서울)로 고정됩니다. Supabase도 서울 리전이어야 지연이 적습니다.
3. Project → Settings → Environment Variables에 넣습니다: `DATABASE_URL`, `SESSION_SECRET`, `CRON_SECRET`, `DEFAULT_COMPANY`. (`PGLITE_DIR`은 로컬 전용이라 넣지 않습니다.)
4. 배포 후 `/login`, `/w/login`이 열리는지, 로그인 없이 `/api/me`가 401인지 확인합니다.
5. 근무자는 휴대폰 브라우저에서 `/w`를 열고 「홈 화면에 추가」하면 앱처럼 쓸 수 있습니다(PWA manifest, 서비스 워커 없음).

## 요청 만료 (1분 단위)

대체 요청의 기한(기본 20분)이 지나면 만료 처리됩니다. **모든 요청(쓰기)마다 서버가 먼저 만료를 처리**하므로 예약 작업은 아무도 화면을 쓰지 않을 때 상태를 제때 바꿔 주는 보조 수단입니다. 예약 작업은 `GET /api/cron/expire`를 `Authorization: Bearer <CRON_SECRET>`으로 호출합니다(`CRON_SECRET`이 없으면 503, 틀리면 401). 둘 중 하나를 고릅니다.

**A. Vercel Pro 요금제의 Cron** — Hobby 요금제는 하루 1회보다 잦은 Cron을 배포 단계에서 거부하므로 기본 `vercel.json`에는 넣지 않았습니다. Pro라면 `vercel.json`을 다음처럼 바꿉니다. `CRON_SECRET` 환경 변수가 있으면 Vercel이 그 값을 Bearer 헤더로 보내 줍니다.

```json
{
  "regions": ["icn1"],
  "crons": [{ "path": "/api/cron/expire", "schedule": "* * * * *" }]
}
```

**B. Supabase `pg_cron` + `pg_net`** (Vercel Hobby일 때) — Supabase SQL Editor에서 실행합니다. 주소와 비밀 값은 실제 값으로 바꿉니다.

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'onetouch-expire',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://<배포-주소>.vercel.app/api/cron/expire',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET 값>')
  );
  $$
);

-- 확인: select * from cron.job_run_details order by start_time desc limit 5;
--       select status_code, content from net._http_response order by created desc limit 5;
-- 중지: select cron.unschedule('onetouch-expire');
```

이 SQL에 넣은 비밀 값은 DB의 `cron.job` 표에 남습니다. DB 관리자만 볼 수 있지만, 원하면 Supabase Vault에 넣고 `(select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')`로 읽어 쓸 수 있습니다. `CRON_SECRET`을 바꾸면 이 작업도 다시 등록합니다.

## 테스트

```bash
npm test             # Vitest (엔진 단위, PGlite 서버·API, 6일 연속 흐름)
npm run test:pg      # DB·배치·근무자 API 테스트를 운영 드라이버(postgres-js)로 (PGlite 소켓 서버, Postgres 설치 불필요)
npm run typecheck    # tsc --noEmit
npm run build        # 운영 빌드
```

`npm run start`로 빌드 결과를 띄울 때도 `SESSION_SECRET`이 필요하고, 운영 모드에서는 `DATABASE_URL`도 반드시 있어야 합니다(없으면 PGlite로 넘어가지 않고 오류로 멈춥니다).

`npm run test:pg`는 테스트 안에서 PGlite를 Postgres 통신 규약으로 띄우고(`@electric-sql/pglite-socket`), 운영과 같은 postgres-js 연결·마이그레이터로 `tests/server/db.test.ts`, `board-api.test.ts`, `worker-api.test.ts`를 돌립니다. 이 소켓 서버는 여러 연결을 한 PGlite 세션에 메시지 단위로 섞기 때문에 테스트 연결은 1개(`max: 1`)로 씁니다. 그래서 동시 요청 테스트는 드라이버 경로를 확인할 뿐, 실제 Postgres의 행 잠금 경쟁까지 재현하지는 않습니다.

## 회사 확인이 필요한 가정값

아래 값은 회사에 확인하기 전의 가정값입니다. 회사를 만들 때 기본값으로 들어가며 관리자 화면에서 바꿀 수 있습니다.

| 항목 | 기본값 | 바꾸는 곳 |
|---|---|---|
| 교대 시각 | 주간 07:00, 야간 19:00 | 설정 |
| 1회 인정 시간 | 8시간 | 설정 |
| 주 최대 / 주의 표시 | 52시간 / 44시간 | 설정 |
| 대체 요청 기한 | 20분 | 설정 |
| 숙련도별 가동률(0~3단계) | 30% · 60% · 90% · 100% | 설정 |
| 배치 가중치 | 같은 자리 15, 같은 제품 3, 같은 공장 1, 역할 같음 5, 역할 다름 −20, 최근 대체 −25 | 설정 |
| 공장별 달력 기준일 | 1공장 2025-04-27, 2공장 2025-04-28 | 기준 정보 → 공장 |
| 가동 라인 6개 이상이면 운반 +1 | 6개 | 아직 화면 없음(코드 상수 `src/engine/demand.ts`) |

## 원어민 검수 필요

근무자 화면의 몽골어(`src/i18n/mn.ts`)와 베트남어(`src/i18n/vi.ts`) 문구는 초안입니다. 운영 전에 원어민 검수를 받아야 합니다. 화면의 모든 문구는 이 사전 파일에만 있습니다.

## 알려진 제한

- 알림톡·문자·웹 푸시는 보내지 않습니다. 1차는 `messages` 표에 기록만 합니다. 근무자는 화면(4초마다 변경 확인)으로 요청을 봅니다.
- 2025년 원본 배치표 엑셀 전용 변환기는 아직 없습니다. 표준 양식(명단·생산계획)만 가져올 수 있습니다(「엑셀」 화면에서 양식 받기).
- 근무자 로그인 키패드는 숫자만 있어서 사번이 숫자여야 근무자가 로그인할 수 있습니다.
- BOM 없는 CSV는 한글이 깨져 읽힐 수 있습니다. 가능하면 `.xlsx`로 올립니다.
- 관리자 비밀번호 변경 화면은 아직 없습니다(API `POST /api/auth/secret`은 있음).
- `npm audit --omit=dev`는 Next.js 15가 포함한 `postcss`(8.5.22 이하) 취약점을 보고합니다. postcss는 빌드할 때 우리 저장소의 CSS만 처리하고 사용자 입력 CSS는 다루지 않으므로 영향이 없다고 보고, 해결책인 Next 16 강제 업그레이드(`npm audit fix --force`)는 하지 않았습니다.
