-- 0087-tenant-pause.sql — [B · 2026-09-23 · AC-220] **잠깐 멈춤**(DESIGN §5B.11 · 사장님 승인 2026-09-22)
--   번호: B 칸 `0087~0089`(메인 지시 2026-09-23 · 마지막 0086). 🔴 `ls drizzle/` 로 눈으로 봤다.
--
--   ══ 왜 ══
--     사장님: «고객 입장에서 잠시 멈추고 싶을 수 있는데 그 기능이 없어?»
--     지금 있는 멈춤은 **전부 «나쁜 일이 생겨서»** 멈추는 것이다 — `readonly`(계약) · `suspended`(우리) · 슬롯 `paused`(코인 부족).
--     🔴 **손님이 스스로 · 기간을 정해 · 되돌릴 수 있게** 멈추는 자리가 **0개**였다.
--     지금은 계정을 하나씩 끊거나 편성 규칙을 0 으로 만드는 수밖에 없고 **둘 다 되돌려도 원래대로 안 온다.**
--     ⇒ «잠깐 멈추고 싶은데 방법이 없어서 **해지**»가 제일 나쁜 결말이다.
--
--   ══ 🔴 왜 `tenants.status` 를 안 건드리나 — 이 파일에서 제일 중요한 줄 ══
--     `status` 의 `NON_WRITABLE`(`readonly`·`suspended`·`cancelled`)에 «쉼»을 끼워 넣으면 **«쉼»이 «잠김»이 된다.**
--     `requireWritable`(lib/guards.ts · **한 곳**)의 뜻은 «**계약상 못 쓴다**»이고, 쉼은 계약이 아니라 **고객의 선택**이다.
--     쉬는 중에도 **보기·고치기·손으로 «지금 올리기»·수익·결제·알림**은 **그대로 된다**(설계 §5B.11(1) 오른쪽 칸).
--     ⇒ 🔴 **별도 칸**으로 둔다. `scripts/verify-pause-scope.mjs` 가 «`paused` 가 `NON_WRITABLE` 에 들어가면 운다»를 지킨다.
--
--   ══ 🔴 «멈춤»에는 «깨워 주기»가 같이 있어야 한다 ══
--     사장님: «근데 크론 멈췄다는 걸 내가 까먹으면 어떡해?» — 그 물음이 이 설계의 핵심이 됐다.
--     · `pause_until` 이 있으면 그 때 **저절로 깬다**(hourly `pauseWatchStep`).
--     · `pause_until` 이 NULL(«내가 켤 때까지»)이면 **7일마다 «아직 쉬는 중이에요»** 를 알린다.
--       `pause_notified_at` 이 그 멱등 키다 — 이 칸이 없으면 크론이 돌 때마다 알림이 나간다.
--
--   ══ 칸 ══
--     paused_at         언제부터 쉬나. **NULL = 안 쉰다**(이 칸 하나가 «쉬는 중인가»의 정본이다).
--     pause_until       언제 저절로 깨나. **NULL = 내가 켤 때까지**(= 7일 알림 대상).
--     pause_reason      고객이 고른 까닭 key(vacation·editing·channel_penalty·cost·other). 말(label)은 서버 코드가 준다(AC-52).
--     pause_notified_at 마지막으로 «아직 쉬는 중»을 알린 때. NULL = 아직 한 번도 안 알렸다.
--
--   🔴 추가형만이다 — 기존 칸·행을 하나도 안 건드린다.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paused_at timestamptz;
COMMENT ON COLUMN tenants.paused_at IS
  '잠깐 멈춤(DESIGN §5B.11) 시작 시각. NULL = 안 쉰다(이 칸이 «쉬는 중인가»의 정본). 🔴 status 와 무관하다 — 쉼은 계약이 아니라 고객의 선택이라 requireWritable 을 안 건드린다.';

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pause_until timestamptz;
COMMENT ON COLUMN tenants.pause_until IS
  '저절로 깨는 시각. NULL = «내가 켤 때까지»(이 경우 7일마다 «아직 쉬는 중» 알림 대상). hourly pauseWatchStep 이 이 칸을 본다.';

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pause_reason varchar(40);
COMMENT ON COLUMN tenants.pause_reason IS
  '고객이 고른 까닭 key: vacation|editing|channel_penalty|cost|other. 사람말 label 은 서버가 준다(화면이 베껴 쓰지 않는다 · AC-52). 선택이라 NULL 가능.';

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pause_notified_at timestamptz;
COMMENT ON COLUMN tenants.pause_notified_at IS
  '마지막으로 «아직 쉬는 중이에요»를 알린 때. 🔴 7일 알림의 멱등 키 — 없으면 크론이 돌 때마다 알림이 나간다. NULL = 아직 안 알렸다.';

-- 쉬는 집만 빨리 집기 위한 부분 인덱스(쉬는 집은 소수라 부분 인덱스가 싸다).
CREATE INDEX IF NOT EXISTS tenants_paused_idx ON tenants (paused_at, pause_until) WHERE paused_at IS NOT NULL;
