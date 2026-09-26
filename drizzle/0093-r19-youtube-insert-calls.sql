-- 0093-r19-youtube-insert-calls.sql — [R19 · B2 · 2026-09-27] 유튜브 업로드 호출을 **프로젝트 전체 · 최근 24시간**으로 세는 자리.
--
-- ══ 왜 ══
--   유튜브 업로드 한도는 **구글 프로젝트(= 우리 OAuth 앱) 하나에 100건/일**이다(설계 §2.2 · 사장님 결정 2026-09-27).
--   고객 전부가 한 통을 나눠 쓰므로 `lib/publish/youtube.ts insertCallsLast24h()` 가 **집(tenant) 조건 없이** 센다:
--     SELECT COUNT(*) FROM audit_logs WHERE action = 'youtube.insert_call' AND created_at > NOW() - interval '24 hours'
--   부른 기록은 `noteInsertCall()` 이 `videos.insert` 를 부르기 직전마다 `audit_logs` 에 한 줄 남긴다.
--   🔴 옛 판(`todayUploads`)은 `posts.created_at` 을 읽었는데 그 칸이 **없다**(AC-266) — 이제 posts 를 안 읽는다.
--
-- ══ 왜 부분 인덱스인가 ══
--   `audit_logs` 는 모든 감사가 쌓이는 큰 표이고 기존 인덱스는 `(tenant_id, created_at)` 뿐이라
--   **집 조건 없는** 이 질의는 표 전체를 훑는다 — 발행 직전마다 부른다(5분 틱 × 대기 중인 유튜브 글).
--   ⇒ 이 동작의 줄만 담는 작은 인덱스. 질의 쪽은 `'youtube.insert_call'` 을 **글자로** 적는다(바인딩이면 일반 플랜이 못 쓴다).
--
-- 추가형 · 멱등(IF NOT EXISTS) · 새 표 없음 · 기존 행 무접촉.

CREATE INDEX IF NOT EXISTS audit_logs_yt_insert_idx ON audit_logs (created_at) WHERE action = 'youtube.insert_call';
