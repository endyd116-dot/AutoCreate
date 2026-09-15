-- 0034 · 디렉터 팀 승인 흐름 — 계약 P1R8-B §4.5 «디렉터 팀 승인» · DESIGN §12.2 «팀 승인 흐름(Agency)»
--
-- 지금 상태: 플랜 기능 키 `teamApproval` 이 **선언만** 돼 있고(`lib/plans.ts` · Agency 열), **흐름이 없다.**
--   팀원(member)이 만든 글이 owner 를 거치지 않고 그대로 나간다 — «팀 승인»이라 팔면서 승인이 없는 상태였다.
--
-- 🔴 이 흐름은 **우리 판단이 아니다**(CLAUDE §9 밖) — **그 집 사장이 자기 직원에게 건 규칙**이다.
--    §9 가 내리라는 건 «우리 판단으로 고객 계정을 막는 것»이고, 이건 «돈·계약»과 같은 칸이다.
--
-- ① pieces.created_by — **누가 만들었나**. 이게 없으면 «팀원이 만든 글»을 가릴 수 없다.
--    🔴 자동(크론)으로 만든 글은 **NULL** 이다 — 사람이 만든 것과 기계가 만든 것은 다르고, 기계 글에 «누가 만들었나»를 지어내지 않는다(AC-9).
--    🔴 사람이 나가도(`team-remove`) 이 값은 **그대로 둔다** — 누가 만들었는지는 사실이고, 사람이 나갔다고 사실이 바뀌지 않는다.
ALTER TABLE pieces ADD COLUMN IF NOT EXISTS created_by bigint;
CREATE INDEX IF NOT EXISTS pieces_created_by_idx ON pieces(tenant_id, created_by) WHERE created_by IS NOT NULL;

COMMENT ON COLUMN pieces.created_by IS '이 글을 만든 사람(users.id). 자동 생성은 NULL — 기계 글에 «누가»를 지어내지 않는다.';

-- ② 켜고 끄는 값은 `tenants.settings.teamApproval`(jsonb)이라 DDL 이 없다.
--    🔴 **기본 꺼짐** — 오늘 세 번째 같은 규율이다(러너 자동 시작 · BYO · 이것). 몰래 안 켠다.
--    그리고 플랜 기능(`teamApproval` · Agency)이 없으면 켜지지 않는다.
