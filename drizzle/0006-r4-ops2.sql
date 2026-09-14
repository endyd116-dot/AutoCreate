-- P1R4-B2 · 운영센터 뒷단(러너 팜·카나리·AI 엔진·공지) — 추가형·멱등(IF NOT EXISTS). scripts/neon-migrate.mjs 로 적용.
-- 🔴 파괴적 문장 0. 기존 행·칸을 바꾸지 않는다. schema.ts 선언(*R4 const)은 B 에게 넘긴다(계약 §4.4).

-- ── canary_runs: 매일 자사 테스트 계정으로 «임시저장까지» 드라이런한 결과(§19 · DESIGN §10 운영) ──
-- ok = true(정상) / false(셀렉터 깨짐 등 실패) / NULL(판정 불가 — 티스토리처럼 세션 없음 · AC-9 셋 가르기).
CREATE TABLE IF NOT EXISTS canary_runs (
  id         bigserial PRIMARY KEY,
  day        date NOT NULL,                          -- KST 날짜(수집 시각 기준)
  channel    varchar(24) NOT NULL,                   -- naver_blog · tistory …
  ok         boolean,                                -- NULL = 판정 불가
  step       varchar(40),                            -- 실패 지점(login_fail·selector_changed·draft_saved…)
  detail     text,
  shot_key   varchar(80),
  ran_at     timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS canary_runs_day_idx ON canary_runs (day, channel);
-- 하루·채널당 한 줄(멱등 UPSERT 근거 — 같은 날 다시 돌면 덮어쓴다).
CREATE UNIQUE INDEX IF NOT EXISTS canary_runs_uniq_idx ON canary_runs (day, channel);

-- ── notices: 인앱 공지 + 장애 배너(§11.4) ──
CREATE TABLE IF NOT EXISTS notices (
  id         bigserial PRIMARY KEY,
  kind       varchar(12) NOT NULL DEFAULT 'notice',  -- notice | incident
  title      varchar(160) NOT NULL,
  body       text,
  starts_at  timestamp NOT NULL DEFAULT now(),
  ends_at    timestamp,                              -- NULL = 무기한
  plans      jsonb NOT NULL DEFAULT '[]'::jsonb,     -- 대상 플랜([] = 전체)
  channels   jsonb NOT NULL DEFAULT '[]'::jsonb,     -- incident 대상 채널([] = 전체)
  active     boolean NOT NULL DEFAULT true,
  created_by bigint,                                 -- operators.id
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notices_active_idx ON notices (active, starts_at, ends_at);

-- ── ai_model_overrides 확장: 후보(카나리 대기)·자동 승격을 담는다(§10) ──
-- current(적용 중) = chain · candidate(카나리 중) = 새 체인 · canary_pct 가 candidate 트래픽 비율.
ALTER TABLE ai_model_overrides ADD COLUMN IF NOT EXISTS candidate    jsonb;
ALTER TABLE ai_model_overrides ADD COLUMN IF NOT EXISTS candidate_at timestamp;
ALTER TABLE ai_model_overrides ADD COLUMN IF NOT EXISTS prev_chain   jsonb;      -- 롤백용 직전 체인
ALTER TABLE ai_model_overrides ADD COLUMN IF NOT EXISTS updated_at   timestamp NOT NULL DEFAULT now();

-- ── ai_settings: 전역 AI 운영 설정(단일 행 · id='global') — 자동/수동·원가 상한·모델 감시 후보 ──
CREATE TABLE IF NOT EXISTS ai_settings (
  id            varchar(16) PRIMARY KEY DEFAULT 'global',
  update_mode   varchar(8) NOT NULL DEFAULT 'manual',    -- manual | auto
  cost_cap_krw  integer,                                 -- 테넌트·일 원가 상한(원 · NULL = 무제한)
  candidates    jsonb NOT NULL DEFAULT '[]'::jsonb,      -- model_watch 가 찾은 신모델 후보 + 실측 4종 결과
  watched_at    timestamp,
  updated_by    bigint,
  updated_at    timestamp NOT NULL DEFAULT now()
);
INSERT INTO ai_settings (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;

-- ── operators: SSO 매핑(§11.4 운영진) — DB 는 이미 sso_sub 칸이 있다. 별도 sso_subject 를 만들지 않고 그것을 쓴다(칸 중복 금지). ──
-- (여기 DDL 없음 — operators.sso_sub 재사용. 계약 §2.4 의 ssoSubject 는 응답 키 이름일 뿐 · 저장은 sso_sub.)

-- ── notices 보정: 기존 테이블(R1)에 대상 플랜·채널·작성자 칸 추가(CREATE 가 스킵될 때 대비 · 멱등) ──
ALTER TABLE notices ADD COLUMN IF NOT EXISTS plans      jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE notices ADD COLUMN IF NOT EXISTS channels   jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE notices ADD COLUMN IF NOT EXISTS created_by bigint;
ALTER TABLE notices ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
