-- 0023 · 계정 사진(avatar) — DESIGN §7.1 «AccountRow.avatar» 가 코드에서 `null` 로 굳어 있던 것을 실제 칸으로. B3 2026-09-15(P1R8 §5.3)
-- 왜: `lib/accounts.ts` 가 `avatar: null` 을 **고정으로** 내보내고 있었다(전수조사 ④7 «진짜 미개발»).
--     설계엔 있는데 값이 들어갈 자리가 없어서, 화면은 계정을 마크만으로 구분해야 했다.
-- 값은 어디서 오나:
--   ① OAuth 연결 때 **이미 받아 오는 응답**에서(유튜브 `channels.snippet.thumbnails` · 추가 호출 0) — 없으면 안 넣는다
--   ② 고객이 직접(`POST /api/accounts-update { avatarUrl }` · https 만)
--   🔴 없으면 NULL 로 둔다. «없음»을 기본 그림으로 채우지 않는다(화면이 «아직 없음»을 그릴 수 있어야 한다 · AC-9).
-- 추가형 전용 · 멱등.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar_url varchar(400);

COMMENT ON COLUMN accounts.avatar_url IS '계정 프로필 사진 주소(https). OAuth 응답에서 받거나 고객이 직접 넣는다. 없으면 NULL — 기본 그림으로 채우지 않는다.';
