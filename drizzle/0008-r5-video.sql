-- ⚠️ 0008 이 둘이다: 이 파일(B-1 · shorts_templates·feature_flags·posts.status)과 `0008-r5-b2-runner.sql`(B2 · runner_devices.caps 등). 둘 다 Neon 에 적용 완료라 리넘버하지 않는다(적용 이력과 어긋난다). **다음 번호는 0009.**
-- P1R5-B · 영상 축(쇼츠 공장) — 추가형·멱등(2026-09-15). 정본 짝 = db/schema.ts «Phase 3 R5» 블록.
-- 🔴 creative_assets·video_assets·shorts_topics 표를 만들지 않는다(두 척추 금지 · 계약 §0). 영상 piece = pieces(kind 'video') + piece_assets + runner_jobs + posts.

-- 레퍼런스 구조 템플릿(계약 §1.11 · AM shorts_templates 이식 · tenant_id NULL = 내장)
CREATE TABLE IF NOT EXISTS shorts_templates (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint REFERENCES tenants(id),
  name        varchar(80) NOT NULL,
  source_url  text,
  structure   jsonb NOT NULL DEFAULT '[]',   -- [string] 서사 단계(«당연한 대상→뜻밖의 문제→…»)
  hook_type   varchar(24),                   -- curiosity_gap|contrast|question|number|confession
  style       jsonb NOT NULL DEFAULT '{}',   -- { visual, palette, caption, pace }
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shorts_templates_tenant_idx ON shorts_templates(tenant_id);

-- 기능 플래그(DESIGN §14 «운영» 표 · Phase 0 에 선언만 있고 표가 없었다) — 영상 kill switch(계약 §1.6). tenant_id NULL = 전역.
CREATE TABLE IF NOT EXISTS feature_flags (
  id          bigserial PRIMARY KEY,
  key         varchar(40) NOT NULL,
  tenant_id   bigint REFERENCES tenants(id),
  enabled     boolean NOT NULL DEFAULT true,
  note        text,
  updated_by  bigint,
  updated_at  timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_key_tenant_idx ON feature_flags(key, COALESCE(tenant_id, 0));

-- posts.status — 발행 결과 상태(계약 §0.1-6 uploaded_private · Phase 0 posts 엔 status 칸이 없었다 · 기본 'published' 라 기존 행 무영향)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'published';   -- published|uploaded_private|processing

-- piece_assets.kind 어휘 추가 사용: clip|audio|srt|video|thumb (varchar(12) 안 · 컬럼 변경 0)
-- pieces.meta 어휘(jsonb · 컬럼 0): stage script|tts|clips|render|judging|done|failed · chainStage · chainLock · chainResume · video
