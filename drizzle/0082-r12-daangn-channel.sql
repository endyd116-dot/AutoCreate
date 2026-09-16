-- 0082-r12-daangn-channel.sql — [R12-6 · 설계 R12 §7 · B] 당근 «새소식» 채널 한 행
--   번호: B 칸 `0081~0089`(계약 §6). 🔴 쓰기 전에 `ls drizzle/` 로 눈으로 봤다(앞 번호 0081 은 이 라운드의 account reader).
--
--   🔴 **추가형만**: INSERT … ON CONFLICT DO NOTHING. DROP·DELETE·RENAME 0.
--   🔴 `scripts/seed-plans.mjs` 의 행과 **글자 하나까지 같다** — 여기만 고치면 새 설치가 안 따라오고,
--      거기만 고치면 라이브에 채널이 없다(정본이 둘이면 언젠가 갈라진다 · 0029 가 같은 주석을 달고 있다).
--
--   ══ 왜 status 가 'planned' 인가 ══
--     코드·화면은 이번 라운드에 다 섰지만(레지스트리 · 글 계약 · 러너 `publish.daangn`), 셀렉터가 **AM 2026-07 실측**이고
--     AM 헤더가 «변경 가능성 高»라고 적어 뒀다. 🔴 **탐침 먼저**(티스토리에서 배운 것 — 실발행 전 탐침 1회로 세 가지를 미리 잡았다).
--     탐침이 끝나면 운영센터에서 켠다. 켜기 전엔 고객 «계정 연결» 그리드에 안 뜬다.
--
--   ══ 🔴 monetize 가 빈 배열인 것이 이 행의 핵심이다 ══
--     «아직 안 붙였다»가 아니라 **«붙지 않는다»** — 당근 새소식에는 광고 수익이 없다.
--     코드 쪽 `lib/channel-registry.ts` 의 `monetizable: false` 와 **짝**이고, 그래야 수익 화면의 0원이
--     «고장»이 아니라 «정상»으로 보인다(AC-10 «설정 안 됨은 오류가 아니다»).
--
--   ══ best_hours 가 빈 배열인 이유 ══
--     **잰 적이 없다.** 동네 장사 시간대를 짐작해 넣으면 편성이 근거 없는 시각을 «최적»이라 말한다(AC-9).
--     학습(`bestHoursFor`)이 계정별로 따로 배운다 — R12-10 에서 그 값을 편성이 **실제로 읽게** 했다.

INSERT INTO channel_registry (key, label, category, publish_via, status, best_hours, monetize, sort) VALUES
  ('daangn', '당근', 'text', 'runner', 'planned', '[]', '[]', 26)
ON CONFLICT (key) DO NOTHING;
