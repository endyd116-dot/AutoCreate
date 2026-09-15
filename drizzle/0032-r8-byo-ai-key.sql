-- 0032 · 고객이 자기 AI 키를 꽂는다(BYO) — 계약 P1R8-B §4.4 · DESIGN §3.3 · 메인 승인 2026-09-15
--
-- 우리 키 여러 개를 돌려 쓰는 것(`lib/ai-key.ts` · B-1)과 **다른 절반**이다:
--   · B-1 것 = **우리 키** 여러 개 · env 만 본다 · 테넌트 개념 0
--   · 이것   = **고객 키** · 테넌트별 · DB
-- 🔴 고르는 자리는 그대로 `leaseAiKey()` 하나다. 이 표는 **값을 가져오는 곳**일 뿐이다.
--
-- ① tenant_ai_keys — 고객이 꽂은 키(로테이션이라 표로 둔다 · 여러 개 꽂을 수 있다)
--    🔴 `key_enc` 는 계정 자격과 **같은 취급**: AES-256-GCM(`CREDS_ENC_KEY` · 폴백 없음) 암호문만. 평문 칸은 없다.
--    🔴 `last_error_kind` 는 사람이 할 일이 갈리는 세 가지만 적는다: invalid(키가 틀림) · quota(한도) · forbidden(권한).
--       «오류»로 뭉치면 고객이 무엇을 해야 하는지 모른다.
CREATE TABLE IF NOT EXISTS tenant_ai_keys (
  id              bigserial PRIMARY KEY,
  tenant_id       bigint NOT NULL REFERENCES tenants(id),
  provider        varchar(20) NOT NULL DEFAULT 'gemini',
  label           varchar(40) NOT NULL DEFAULT '내 키',
  key_enc         text NOT NULL,                        -- 🔴 암호문만(평문 칸 없음)
  masked          varchar(24) NOT NULL DEFAULT '',      -- 화면이 «어느 키인지» 알아볼 정도만(앞 4자 + …). 🔴 평문이 아니다.
  status          varchar(12) NOT NULL DEFAULT 'active',-- active|disabled|invalid
  last_ok_at      timestamp,                            -- 마지막으로 **실제로 통한** 시각(꽂을 때 한 번 걸어 본다)
  last_error_at   timestamp,
  last_error_kind varchar(12),                          -- invalid|quota|forbidden
  rested_until    timestamp,                            -- 429 를 맞아 쉬는 중(짧다 · 서버 재시작과 무관하게 남기려고 표에 둔다)
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_ai_keys_tenant_idx ON tenant_ai_keys(tenant_id, status);

-- ② 🔴 «내 키가 안 되면 코인으로 대신 돌려 주세요» — **기본 꺼짐**. 몰래 안 켠다(메인 조건 1).
--    안 켜 두면 그 회차는 실패하고 사람말로 알린다. 그건 우리 판단으로 막는 게 아니라 «키가 없다»는 사실이다.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_key_fallback boolean NOT NULL DEFAULT false;

-- ③ 🔴 `ai_usage.byo` = «켰나»가 아니라 **실제로 어느 키로 나갔나**(메인 조건 4).
--    고객 키가 죽어 우리 키로 돌았으면 그건 **우리 원가**다. 의도로 적으면 AC-71(고아 103행 $9.98)이 이 칸에서 되살아난다.
--    🔴 고객이 키를 빼도 이 행은 남는다 — 돈 쓴 기록은 어떤 정리에서도 안 지운다(행 자신이 분류를 들고 있다).
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS byo boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS ai_usage_byo_idx ON ai_usage(byo, created_at) WHERE byo;

COMMENT ON TABLE  tenant_ai_keys IS '고객이 꽂은 AI 키(BYO). key_enc 는 계정 자격과 같은 취급 — AES-256-GCM 암호문만.';
COMMENT ON COLUMN tenant_ai_keys.last_error_kind IS 'invalid|quota|forbidden — 셋은 고객이 할 일이 다르다. «오류»로 뭉치지 않는다.';
COMMENT ON COLUMN tenants.ai_key_fallback IS '내 키가 안 될 때 우리 키로 대신 돌릴까. 🔴 기본 꺼짐 — 고객이 직접 켤 때만.';
COMMENT ON COLUMN ai_usage.byo IS '🔴 실제로 **고객 키로** 나갔나(의도가 아니라 사실). false = 우리 원가.';

-- 옛 행(있을 리 없지만)에도 칸이 생기게 — 추가형 재적용 안전.
ALTER TABLE tenant_ai_keys ADD COLUMN IF NOT EXISTS masked varchar(24) NOT NULL DEFAULT '';
