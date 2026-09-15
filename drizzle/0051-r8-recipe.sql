-- 0051-r8-recipe.sql — [P1R8 §3.3 · B2] 셀렉터 표(recipe) 서버 배포 1단계
--   설계: docs/active/2026-09-15-recipe-canary-design.md · 코드: lib/recipe.ts · lib/recipe-store.ts
--   칸: B2 = 0051~0059(CLAUDE §4.5 세션별 칸 · 2026-09-15 메인 결정)
--
--   🔴 **전부 추가형**이다 — CREATE TABLE IF NOT EXISTS · ADD COLUMN IF NOT EXISTS 뿐.
--      설계 §3 의 «canary_runs 유니크 교체 = 파괴적 DDL» 은 **2026-09-15 에 정정됐다**:
--      «한 채널에 하루 한 recipe» 는 설계 §7 이 **스스로 요구하는 규칙**이라, 기존 유니크 `(day, channel)` 은
--      그걸 막는 게 아니라 **강제**한다. 칸 두 개만 더하면 된다. 사장님 승인 불필요.

-- ── 표 본문 — 🔴 **한 번 올린 version 의 내용은 안 바꾼다** ──
--    «같은 버전인데 다른 표»가 돌면 사고 났을 때 무엇이 돌았는지 영영 모른다(러너 zip 과 같은 규율).
--    그래서 version 이 PK 이고, 고칠 일이 있으면 **새 버전**을 만든다.
CREATE TABLE IF NOT EXISTS recipes (
  version     varchar(40) PRIMARY KEY,          -- tistory@2026-09-16.1 (사람이 입으로 말할 수 있는 이름)
  channel     varchar(24) NOT NULL,
  min_runner  varchar(20) NOT NULL DEFAULT '0.0.0',
  body        jsonb NOT NULL,                   -- SignedRecipe 전체(서명 포함) — 러너에 **이 값 그대로** 내려간다
  rollback_to varchar(40),                      -- 🔴 만들 때 채운다(사고 한가운데서 찾는 건 제일 안 되는 일)
  note        varchar(300),
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recipes_channel_idx ON recipes(channel, created_at DESC);

-- ── 배포 상태 — 채널마다 «지금 퍼진 판»과 «시험 중인 판» ──
CREATE TABLE IF NOT EXISTS recipe_rollouts (
  channel           varchar(24) PRIMARY KEY,
  current_version   varchar(40),                 -- 전체에 퍼진 판(NULL = 아직 없음 = 러너는 묶여 온 표를 쓴다)
  candidate_version varchar(40),                 -- 시험 중인 판
  stage             varchar(12) NOT NULL DEFAULT 'canary',   -- canary|own|volunteer|all
  stage_since       timestamp NOT NULL DEFAULT now(),
  promoted_at       timestamp,
  rolled_back_at    timestamp,
  rollback_reason   varchar(300),
  updated_at        timestamp NOT NULL DEFAULT now()
);

-- ── 카나리 한 줄이 «어느 표를 시험했나» ──
--    이 칸이 없으면 «오늘 카나리가 통과했다»는 말은 **어느 판에 대한 통과인지 모르는 말**이다.
ALTER TABLE canary_runs ADD COLUMN IF NOT EXISTS recipe_version varchar(40);
ALTER TABLE canary_runs ADD COLUMN IF NOT EXISTS stage varchar(12);

-- ── 잡이 «어느 표로 돌았나» ──
--    🔴 자동 복귀 판정의 **유일한 정직한 근거**다. 이 칸이 없으면 «셀렉터가 깨졌다»는 실패를 보고도
--    그게 새 표 때문인지 옛 표 때문인지 **구분할 수 없고**, 그러면 멀쩡한 판을 되돌리거나 깨진 판을 안 되돌린다.
ALTER TABLE runner_jobs ADD COLUMN IF NOT EXISTS recipe_version varchar(40);
CREATE INDEX IF NOT EXISTS runner_jobs_recipe_idx ON runner_jobs(recipe_version, status);

-- ── 자원자 옵트인(설계 §4 2단계) ──
--    🔴 **기본은 꺼짐**이다. 옵트인 없이 고객을 카나리로 쓰지 않는다 — recipe 가 틀리면
--    우리 서버 안이 아니라 **고객 블로그에** 잘못된 글이 남는다.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS recipe_volunteer boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN recipe_rollouts.stage IS
  '배포 단계 canary→own→volunteer→all. 🔴 넓히는 것(승격)은 KST 평일 10~18시에만, 좁히는 것(롤백)은 언제나 — lib/recipe.ts canPromoteAt.';
COMMENT ON COLUMN runner_jobs.recipe_version IS
  '이 잡이 실제로 쓴 셀렉터 표. NULL = 러너 zip 에 묶여 온 표로 돌았다(서버 표를 못 받았거나 안 믿었다). 자동 복귀 판정의 근거.';
