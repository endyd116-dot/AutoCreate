-- 0035 · R9+R10 (B) — 계정의 옷장(글 스타일) + 계정 기본 코인 등급
--   계약 docs/active/2026-09-16-R9R10-contract.md §3.1 R10-4(계정의 옷장) · R10-9(등급 기본값 = 계정마다) · 설계 §3.6
--   DDL 칸 B = 0031~0035(2026-09-16 메인 배정 · 0031~0034 는 R8 에서 썼다). 추가형·멱등 — scripts/neon-migrate.mjs 로만.
--
-- ① text_styles — 레퍼런스에서 배운 «어떻게 생겼나»(숫자·목록만 · 설계 §3.4).
--    🔴 style jsonb 에는 **문장이 한 줄도 들어가지 않는다** — 저장 직전 lib/text-style.ts sanitizeTextStyleForStorage 가 허용 목록 복사 + 길이 캡으로 소독한다(프롬프트는 부탁이고 이 함수가 강제 · AC-63).
--    🔴 캡처(남의 글 그림)는 여기에도 R2 에도 안 남는다 — 읽고 즉시 버린다(설계 §3.3 ③). source_url 은 «어디서 배웠나»(멱등 재사용용)이지 글 내용이 아니다.
--    account_id = 어느 계정에서 배웠나(기록). 옷장은 집(tenant) 단위로 공유한다 — 같은 사람이 계정 여럿을 굴린다.
--    deleted_at = 고객이 지운 것(원장 features.styleId 가 가리키므로 행은 지우지 않는다).
CREATE TABLE IF NOT EXISTS text_styles (
  id           bigserial PRIMARY KEY,
  tenant_id    bigint NOT NULL,
  account_id   bigint,
  name         varchar(80) NOT NULL,
  source       varchar(12) NOT NULL DEFAULT 'url',      -- url(러너 캡처) | capture(고객이 찍어 올림) | paste(복붙 · 꾸밈은 못 배운다)
  source_url   varchar(400),
  style        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamp NOT NULL DEFAULT now(),
  deleted_at   timestamp
);
CREATE INDEX IF NOT EXISTS text_styles_tenant_idx ON text_styles(tenant_id, deleted_at, id);
COMMENT ON TABLE text_styles IS '계정의 옷장 — 레퍼런스에서 배운 글 모양(숫자·목록만 · 문장 0). 캡처는 남기지 않는다.';

-- ② accounts.text_style_id — 계정에 걸어 둔 기본 스타일(NULL = 없음). 글마다 덮어쓰기는 pieces.meta.styleId(DDL 없음).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS text_style_id bigint;

-- ③ accounts.quality_tier — 계정 기본 코인 등급(simple|standard|premium). 🔴 NULL = «안 고름» — 서버는 simple 로 만든다(오늘까지의 글값과 같다 · 기본값이지 날조가 아니다 · AC-93).
--    값 어휘는 lib/coin-table.ts COIN_TIER_KEYS 한 곳(CHECK 로 못 박지 않는다 — 어휘가 늘 때 DDL 을 또 밀지 않게 · 서버 toCoinTier 가 거른다).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS quality_tier varchar(12);
COMMENT ON COLUMN accounts.quality_tier IS '계정 기본 코인 등급(simple|standard|premium). NULL = 안 고름(=simple 로 만든다).';
COMMENT ON COLUMN accounts.text_style_id IS '계정에 걸어 둔 글 스타일(text_styles.id). NULL = 없음.';
