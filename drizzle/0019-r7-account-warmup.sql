-- 0019 · 계정 워밍업(계약 P1R7 §2.6 · 원가표 §6.3 «IP 보다 싸고 효과 큰 방어 1번») — B2 2026-09-15
--
-- 새 계정을 첫날부터 하루 1건씩 돌리는 것이 **대량 정지의 1번 원인**이다(프록시보다 앞선 방어고, 0원이다).
-- 2~4주에 걸쳐 «주 1건 → 주 2건 → 주 3건 → 정상»으로 올린다.
--
-- 🔴 `daily_cap` 을 **덮어쓰지 않는다**(사장님 결정 아님 · 메인 승인). 덮어쓰면
--    ①고객이 정한 값이 사라지고 ②워밍업이 끝날 때 무엇으로 되돌릴지 알 수 없고 ③«내가 정한 값이 왜 바뀌었지»가 된다.
--    저장값은 «고객의 뜻» 그대로 두고, **판정 시점에 유효 상한을 계산**한다(`lib/warmup.ts`).
--
-- 기준일은 두 개다:
--   · `created_at`     = 우리와 연결한 날(이미 있다 · 이 값이 기본 기준)
--   · `opened_at`      = **계정을 만든 날**(고객이 안다면 입력 · 선택). 3년 된 계정을 새 계정처럼 묶으면 손해다.
-- 추가형 전용 · 멱등.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS opened_at date;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS warmup_off boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN accounts.opened_at IS '계정을 만든 날(고객 입력 · 선택). 있으면 워밍업 기준일이 이 값 — 오래된 계정은 워밍업 없이 바로 정상.';
COMMENT ON COLUMN accounts.warmup_off IS '고객이 «빨리 갈래요»로 껐나. 🔴 끌 수 있게 두되 화면에 경고 한 줄을 함께 보인다(정직 표기).';
