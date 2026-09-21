-- 0085-ai-usage-fail-comment.sql — [B · 2026-09-21] 사장님 결재로 **칸의 뜻이 바뀌었다** — DB 주석을 같이 고친다
--   번호: B 칸 `0084~0089`(마지막 0084). 🔴 `ls drizzle/` 로 눈으로 봤다.
--
--   ══ 왜 ══
--     0084 를 넣을 때는 «새 자리는 **세기만** 한다»(메인 지시)라서 `cost_usd_maybe` 가 **아는 금액까지** 담고 있었다.
--     ✅ 2026-09-21 사장님 결재 «아까 실패했을 때도 글처럼 맞춰줘» ⇒ **아는 금액은 `cost_usd` 로 옮겼다**(상한을 먹는다).
--     ⇒ 이제 이 칸은 «**아직 `cost_usd` 로 못 옮긴 돈**»이고, **지금은 비어 있는 것이 정상**이다.
--     🔴 칸을 지우지 않는다(메인 지시) — 「아는 것/모르는 것」을 가른 **이 수리의 기록**이고,
--        제공사 응답에 원가가 붙거나 청구서를 대조하게 되면 **그때 채울 자리**다.
--
--   🔴 DB 주석이 코드보다 뒤처지면 다음 사람이 옛 뜻으로 읽는다(AC-59) — 그래서 결재 난 날 같이 고친다.

COMMENT ON COLUMN ai_usage.cost_usd_maybe IS
  '아직 cost_usd 로 못 옮긴 돈. 비어 있는 것이 정상(아는 금액은 2026-09-21 결재로 cost_usd 가 먹는다). NULL = 못 쟀음이지 0원이 아니다.';

COMMENT ON COLUMN ai_usage.fail_kind IS
  '실패 사유. 금액을 아는 것(download_failed·store_failed)은 cost_usd 에 들어가 상한을 먹고, 모르는 것(provider_failed·http·timeout·empty)은 cost_usd=0 이라 안 먹는다. NULL = 성공한 호출.';
