-- 0083-ops-tenant-notes.sql — [수리 라운드 ③ · 시나리오 B ⑩ · B] 운영 메모를 **여러 줄로, 누가·언제와 함께** 남기는 칸
--   번호: B 칸 `0083~0089`(메인 지시 2026-09-19). 🔴 쓰기 전에 `ls drizzle/` 로 눈으로 봤다(마지막 0082).
--
--   ══ 왜 ══
--     2026-09-19 운영센터 시나리오 실측: **메모가 남지 않았다. 그리고 있던 메모까지 지웠다.**
--       · 화면(`ops/tenant.html`)은 `{ id, text }` 를 보내고 서버는 `b.note` 를 읽었다 → `ops_note = ''` 로 덮었다.
--       · 응답이 `ok:true` 라 **오류 한 글자 안 떴다**(시트가 닫히고 «저장됐다»는 모양이 된다).
--       · 읽는 쪽도 어긋나 있었다 — 화면은 `r.notes` 배열 `{text,by,at}` 을 그리는데 서버는 `note` 문자열 하나를 보냈다.
--     ⇒ 전화 받은 상담원이 «이 손님 어제 뭐라고 했더라»를 볼 방법이 **없었다.**
--
--   ══ 🔴 왜 칸 하나(`tenants.ops_note`)로는 안 되나 ══
--     그 칸은 **덮어쓰기**다. 메모는 쌓여야 하고 **누가 남겼는지**가 있어야 다음 담당자에게 넘어간다.
--     화면은 처음부터 `{text, by, at}` 을 그리게 쓰여 있었다 — **화면이 맞고 저장 자리가 없었던 것**이다.
--
--   ══ 무회귀 ══
--     · `tenants.ops_note` 는 **그대로 둔다**(목록 한 줄 미리보기가 그 칸을 읽는다 · `ops-tenants.ts tenantRow`).
--       새 메모를 넣을 때 그 칸도 **최근 한 줄**로 같이 갱신한다 ⇒ 옛 화면·옛 목록이 그대로 돈다.
--     · 이 표가 비어 있으면 화면은 «메모 없음» — 지금과 같다.
--
--   추가형만: CREATE TABLE IF NOT EXISTS · CREATE INDEX IF NOT EXISTS. DROP·DELETE·RENAME 0.
--   ⚠️ 이 파일은 **B 머지와 같은 호흡**에 걸어야 한다 — `ops-tenant` 상세가 이 표를 SELECT 한다(없으면 42P01).
--      다만 상세 핸들러는 실패해도 **빈 배열로 계속**하게 짜 두었다(CLAUDE §4.1 «보조 SELECT 실패는 빈 배열로 계속»).

CREATE TABLE IF NOT EXISTS ops_tenant_notes (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint      NOT NULL,
  operator_id bigint,                       -- 남긴 운영자(operators.id) · 지워진 운영자도 메모는 남는다(FK 안 건다)
  operator    varchar(120),                 -- 남긴 사람 이름을 **그때 그대로** 박아 둔다(나중에 이름이 바뀌어도 기록은 그날의 것)
  text        text        NOT NULL,
  created_at  timestamp   NOT NULL DEFAULT NOW()
);

-- 상세 화면은 «이 집의 메모를 최근 것부터»만 읽는다.
CREATE INDEX IF NOT EXISTS ops_tenant_notes_tenant_idx ON ops_tenant_notes (tenant_id, id DESC);
