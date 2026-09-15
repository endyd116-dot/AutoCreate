/* mock-ops.js — 운영센터(P1R4 계약 v4.0 §2)의 모양대로 가짜 응답을 돌려주는 개발용 층. mock.js 와 같은 규칙:
   🔴 `?mock=1` 이 없으면 즉시 return — 운영 코드 무접촉. 키 이름은 계약 글자 그대로(행 모양이 없는 메뉴는 A 제안 모양 · 메인 보고 2026-09-14).
   손잡이: `?role=super_admin|admin|operator`(역할별 메뉴·403) · `?fx=0`(환율 없음 → aiCost.fxMissing) · `?fresh=1`(빈 상태). 상태는 sessionStorage(acMockOps). */
(function () {
  const qs = new URLSearchParams(location.search);
  if (qs.get("mock") !== "1" || !window.UI) return;
  const UI = window.UI;
  const KEY = "acMockOps";
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const ymd = (off) => { const d = new Date(now + 9 * 3600e3); d.setUTCDate(d.getUTCDate() + off); return d.toISOString().slice(0, 10); };
  const thisMonth = ymd(0).slice(0, 7);
  const monthEnd = () => { const [y, m] = thisMonth.split("-").map(Number); return new Date(Date.UTC(y, m, 0, 14, 59, 59)).toISOString(); }; // KST 말일 23:59:59
  const role = ["super_admin", "admin", "operator"].includes(qs.get("role")) ? qs.get("role") : "super_admin";
  const fresh = qs.get("fresh") === "1";
  const fxMissing = qs.get("fx") === "0";
  const companyOff = qs.get("company") === "0";   // [P1R6 §1.3] 회사 정보 비어 있음(영수증·약관 «준비 중» 경로)
  const VAT = (a) => Math.round(a * 0.1);
  const inv = (id, tenantId, tenantName, kind, period, amountKrw, status, paidAgoH, extra = {}) => ({ id, tenantId, tenantName, kind, period, amountKrw, vatKrw: VAT(amountKrw), totalKrw: amountKrw + VAT(amountKrw), status, attempts: status === "failed" ? 2 : 1, ...(status === "paid" ? { paidAt: iso(now - paidAgoH * 3600e3), receiptUrl: `https://autocreate-endyd.netlify.app/r/${id}` } : {}), ...(status === "failed" ? { failedAt: iso(now - paidAgoH * 3600e3), nextRetryAt: iso(now + 20 * 3600e3) } : {}), ...extra });

  const CO_FIELDS = ["name", "ceo", "bizNo", "mailOrderNo", "address", "email", "phone"];
  const seed = () => ({
    nextId: 5000,
    company: companyOff ? { name: "", ceo: "", bizNo: "", mailOrderNo: "", address: "", email: "", phone: "", updatedBy: null, updatedAt: null }
      : { name: "주식회사 오토크리에이트", ceo: "홍두현", bizNo: "123-45-67890", mailOrderNo: "2026-서울강남-01234", address: "서울특별시 강남구 테헤란로 1길 10, 5층", email: "help@autocreate.kr", phone: "02-1234-5678", updatedBy: 1, updatedAt: iso(now - 3 * 86400e3) },
    operators: [
      { id: 1, email: "endyd1116@gmail.com", name: "두현", role: "super_admin", ssoSubject: "mis:1", active: true, lastLoginAt: iso(now - 600e3) },
      { id: 2, email: "ops-admin@autocreate.dev", name: "운영 관리자", role: "admin", active: true, lastLoginAt: iso(now - 5 * 3600e3) },
      { id: 3, email: "cs@autocreate.dev", name: "CS 담당", role: "operator", active: true, lastLoginAt: iso(now - 26 * 3600e3) },
      { id: 4, email: "old@autocreate.dev", name: "퇴사", role: "operator", active: false },
    ],
    tenants: fresh ? [] : [
      { id: 1, key: "mock", name: "모의", planKey: "trial", status: "trial", trialEndsAt: iso(now + 9 * 86400e3), createdAt: iso(now - 5 * 86400e3), ownerEmail: "mock@autocreate.dev", accounts: 4, coins: 30, lastPostAt: iso(now - 26 * 3600e3), health: 84 },
      { id: 2, key: "cookmom", name: "요리하는 집", planKey: "pro", status: "active", createdAt: iso(now - 61 * 86400e3), ownerEmail: "cook@example.com", accounts: 9, coins: 112, lastPostAt: iso(now - 3 * 3600e3), health: 96 },
      { id: 3, key: "tipsgo", name: "팁스고", planKey: "starter", status: "past_due", createdAt: iso(now - 40 * 86400e3), ownerEmail: "tips@example.com", accounts: 3, coins: 4, lastPostAt: iso(now - 4 * 86400e3), health: 61 },
      { id: 4, key: "agencyk", name: "에이전시 K", planKey: "agency", status: "active", createdAt: iso(now - 120 * 86400e3), ownerEmail: "k@agency.kr", accounts: 38, coins: 410, lastPostAt: iso(now - 40 * 60e3), health: 92 },
      { id: 5, key: "sleepy", name: "잠든 집", planKey: "trial", status: "readonly", trialEndsAt: iso(now - 2 * 86400e3), createdAt: iso(now - 16 * 86400e3), ownerEmail: "zzz@example.com", accounts: 1, coins: 0, health: 40 },
      { id: 6, key: "newbie", name: "오늘 가입", planKey: "trial", status: "trial", trialEndsAt: iso(now + 14 * 86400e3), createdAt: iso(now - 2 * 3600e3), ownerEmail: "new@example.com", accounts: 0, coins: 0, health: 100 },
    ],
    notes: { 3: [{ at: iso(now - 2 * 86400e3), by: "운영 관리자", text: "카드 만료 안내 메일 보냄 · 재시도 예정" }] },
    promotions: fresh ? [] : [
      { id: 101, kind: "trial_days", name: "가을 체험 30일", value: 30, unit: "days", startsAt: iso(now - 3 * 86400e3), endsAt: iso(now + 20 * 86400e3), target: { plans: ["trial"] }, status: "active", stats: { used: 14, converted: 3 } },
      { id: 102, kind: "bonus_coin", name: "첫 충전 +20%", value: 20, unit: "pct", startsAt: iso(now - 10 * 86400e3), endsAt: iso(now + 5 * 86400e3), target: { plans: ["trial", "starter"] }, status: "active", stats: { used: 9, converted: 9 } },
      { id: 103, kind: "referral", name: "친구 추천 20코인", value: 20, unit: "coins", startsAt: iso(now + 7 * 86400e3), endsAt: iso(now + 60 * 86400e3), target: {}, status: "scheduled", stats: { used: 0, converted: 0 } },
    ],
    coupons: fresh ? [] : [
      { id: 201, code: "FALL30", kind: "pct", value: 30, maxUses: 100, used: 27, startsAt: iso(now - 10 * 86400e3), endsAt: iso(now + 20 * 86400e3), plans: ["pro"], status: "active" },
      { id: 202, code: "WELCOME10K", kind: "krw", value: 10000, maxUses: 500, used: 500, startsAt: iso(now - 90 * 86400e3), endsAt: iso(now - 1 * 86400e3), plans: ["starter", "pro"], status: "ended" },
    ],
    redemptions: fresh ? [] : [{ id: 301, couponId: 201, tenantId: 2, tenantName: "요리하는 집", at: iso(now - 4 * 86400e3), planKey: "pro", discountKrw: 14700 }],
    plans: [
      { key: "starter", name: "Starter", priceMonthKrw: 19000, priceYearKrw: 190000, maxAccounts: 3, coinsIncluded: 40, runnerDevices: 1, teamSeats: 1, maxRules: 3, horizonDays: 7, features: { directorEdit: false, autoSchedule: true, failover: false, managedRunner: false, runnerRevenue: false, teamApproval: false }, public: true, recommended: false, requireCardBeforePublish: false, subscribers: 41, mrrKrw: 779000 },
      { key: "pro", name: "Pro", priceMonthKrw: 49000, priceYearKrw: 490000, maxAccounts: 15, coinsIncluded: 150, runnerDevices: 2, teamSeats: 2, maxRules: 99, horizonDays: 30, features: { directorEdit: true, autoSchedule: true, failover: true, managedRunner: true, runnerRevenue: true, teamApproval: false }, public: true, recommended: true, requireCardBeforePublish: false, subscribers: 27, mrrKrw: 1323000 },
      { key: "agency", name: "Agency", priceMonthKrw: 149000, priceYearKrw: 1490000, maxAccounts: 50, coinsIncluded: 500, runnerDevices: 5, teamSeats: 5, maxRules: 99, horizonDays: 30, features: { directorEdit: true, autoSchedule: true, failover: true, managedRunner: true, runnerRevenue: true, teamApproval: true }, public: true, recommended: false, requireCardBeforePublish: false, subscribers: 3, mrrKrw: 447000 },
    ],
    coinPrices: { packs: [{ id: "pack_100", krw: 50000, coins: 100, bonusPct: 0 }, { id: "pack_220", krw: 100000, coins: 220, bonusPct: 10 }, { id: "pack_720", krw: 300000, coins: 720, bonusPct: 20 }, { id: "pack_trial", krw: 5000, coins: 10, bonusPct: 0, oncePerTenant: true }], table: { blog: 1, image: 1, cardnews: 3, video_15: 6, video_30: 12, video_60: 28, persona: 15 } },
    priceEvents: fresh ? [] : [{ id: 401, planKey: "pro", oldPriceKrw: 45000, newPriceKrw: 49000, effectiveAt: iso(now - 30 * 86400e3), noticeText: "Pro 요금이 10월 1일 청구분부터 월 49,000원(부가세 별도)으로 바뀌어요.", noticedAt: iso(now - 61 * 86400e3), status: "applied", affected: 22 }],
    invoices: fresh ? [] : [
      { ...inv(9001, 2, "요리하는 집", "subscription", thisMonth, 49000, "paid", 30), taxRequestedAt: iso(now - 20 * 3600e3), taxInvoice: { status: "requested", requestedAt: iso(now - 20 * 3600e3) }, taxBiz: { bizNo: "220-88-12345", bizName: "요리하는 집", email: "cook@example.com" } }, // [P1R6 §1.2] 고객이 증빙을 요청한 행
      inv(9002, 4, "에이전시 K", "subscription", thisMonth, 149000, "paid", 28),
      inv(9003, 3, "팁스고", "subscription", thisMonth, 19000, "failed", 20),
      { ...inv(9004, 2, "요리하는 집", "coin", "AC-COIN-20260912-0007", 100000, "paid", 50), payRoute: "keyin" }, // [§1.6] 비인증(카드번호 직접 입력) 라인으로 결제된 행
      inv(9005, 1, "모의", "coin", "AC-COIN-20260913-0011", 5000, "paid", 12),
      inv(9006, 6, "오늘 가입", "coin", "AC-COIN-20260914-0002", 50000, "pending", 1),
    ],
    billingKeys: fresh ? [] : [{ tenantId: 2, tenantName: "요리하는 집", brand: "신한", last4: "4421", active: true, updatedAt: iso(now - 30 * 86400e3) }, { tenantId: 3, tenantName: "팁스고", brand: "국민", last4: "0192", active: false, updatedAt: iso(now - 3 * 86400e3) }, { payRoute: "keyin", tenantId: 4, tenantName: "에이전시 K", brand: "현대", last4: "7730", active: true, updatedAt: iso(now - 100 * 86400e3) }],
    receivables: fresh ? [] : [{ tenantId: 3, tenantName: "팁스고", overdueKrw: 20900, overdueDays: 6, attempts: 2, lastFailReason: "카드 한도 초과" }],
    tickets: fresh ? [] : [
      { id: 701, tenantId: 3, tenantName: "팁스고", subject: "결제가 안 돼요", status: "open", priority: "high", tags: ["결제"], source: "app", createdAt: iso(now - 3 * 3600e3), updatedAt: iso(now - 3 * 3600e3), slaDueAt: iso(now + 1 * 3600e3) },
      { id: 702, tenantId: 1, tenantName: "모의", subject: "네이버 글이 안 올라가요", status: "progress", priority: "normal", assignee: { id: 3, name: "CS 담당" }, tags: ["러너", "발행실패"], source: "app", createdAt: iso(now - 26 * 3600e3), updatedAt: iso(now - 2 * 3600e3), slaDueAt: iso(now + 6 * 3600e3) },
      { id: 703, tenantId: 5, tenantName: "잠든 집", subject: "[자동] 계정 정지 3회 반복 · @life_c", status: "open", priority: "urgent", tags: ["계정정지"], source: "system", createdAt: iso(now - 40 * 60e3), updatedAt: iso(now - 40 * 60e3), slaDueAt: iso(now + 20 * 60e3) },
      { id: 704, tenantId: 2, tenantName: "요리하는 집", subject: "환불 문의", status: "resolved", priority: "normal", assignee: { id: 2, name: "운영 관리자" }, tags: ["환불"], source: "email", createdAt: iso(now - 4 * 86400e3), updatedAt: iso(now - 3 * 86400e3), rating: true },
      { id: 705, tenantId: 4, tenantName: "에이전시 K", subject: "관리형 러너 추가 문의", status: "hold", priority: "low", assignee: { id: 2, name: "운영 관리자" }, tags: ["러너"], source: "kakao", createdAt: iso(now - 2 * 86400e3), updatedAt: iso(now - 86400e3) },
    ],
    messages: { 701: [{ id: 1, from: "customer", text: "카드로 결제하면 자꾸 실패해요. 한도는 충분한데요.", at: iso(now - 3 * 3600e3) }, { id: 2, from: "system", text: "자동 첨부 · 플랜 starter · 상태 past_due · 러너 0/1 · 최근 오류: 결제 실패(카드 한도 초과) ×2", at: iso(now - 3 * 3600e3) }],
      702: [{ id: 3, from: "customer", text: "어제부터 네이버에 글이 안 올라가요. 프로그램은 켜 두었어요.", at: iso(now - 26 * 3600e3), attachments: [{ key: "t/702/1.png", url: "" }] }, { id: 4, from: "operator", text: "안녕하세요, 확인해 보니 네이버 로그인이 풀려 있어요. 앱 «내 계정 → 다시 로그인»을 눌러 주시면 PC 프로그램이 로그인 창을 열어요.", at: iso(now - 2 * 3600e3) }],
      703: [{ id: 5, from: "system", text: "계정 @life_c 가 24시간 안에 3회 정지 판정을 받았어요. 승계는 @cook_a 로 됐어요.", at: iso(now - 40 * 60e3) }], 704: [{ id: 6, from: "customer", text: "지난주 충전한 코인을 환불하고 싶어요.", at: iso(now - 4 * 86400e3) }, { id: 7, from: "operator", text: "미사용 90코인 기준 45,000원(부가세 포함 49,500원)이 환불돼요. 진행할까요?", at: iso(now - 3.5 * 86400e3) }, { id: 8, from: "customer", text: "네 진행해 주세요.", at: iso(now - 3.2 * 86400e3) }, { id: 9, from: "operator", text: "환불 처리했어요. 카드사 사정에 따라 3~5일 걸려요.", at: iso(now - 3 * 86400e3) }], 705: [] },
    macros: [{ id: 1, title: "다시 로그인 안내", text: "앱 «내 계정 → 다시 로그인»을 눌러 주세요. PC 프로그램이 로그인 창을 열어요.", tags: ["러너"] }, { id: 2, title: "결제 실패 안내", text: "카드사에서 승인이 거절됐어요. 다른 카드로 «요금제 → 카드 등록»을 다시 해 주세요.", tags: ["결제"] }, { id: 3, title: "환불 안내", text: "미사용 코인만 충전 후 7일 안에 환불돼요. 단가는 그 주문의 결제액 ÷ 받은 코인이에요.", tags: ["환불"] }, { id: 4, title: "정지 승계 안내", text: "정지된 계정의 예약 글은 같은 채널의 다른 계정으로 옮겨 두었어요. 코인은 더 들지 않아요.", tags: ["계정정지"] }],
    faqs: [{ id: 1, q: "코인은 언제까지 쓸 수 있나요?", a: "충전한 코인은 1년, 플랜에 포함된 코인은 그달 말까지예요.", order: 1, public: true }, { id: 2, q: "네이버·티스토리는 왜 내 PC 프로그램이 필요한가요?", a: "두 곳은 바깥에서 글을 넣는 길이 없어서 PC 프로그램이 대신 올려요.", order: 2, public: true }, { id: 3, q: "환불은 어떻게 되나요?", a: "미사용 코인은 충전 후 7일 안에 환불돼요. 구독은 기간 말에 해지돼요.", order: 3, public: true }],
    /* ── [B2] 러너 팜(ops-runners.ts) — runner_devices + farm 집계 ── */
    runners: fresh ? [] : [
      { id: 1, name: "farm-01", kind: "managed", tenantId: null, tenantKey: null, online: true, lastSeenAt: iso(now - 20e3), version: "1.0.3", active: 2, queued: 3 },
      { id: 2, name: "farm-02", kind: "managed", tenantId: 4, tenantKey: "agencyk", online: true, lastSeenAt: iso(now - 40e3), version: "1.0.3", active: 1, queued: 0 },
      { id: 3, name: "farm-03", kind: "managed", tenantId: null, tenantKey: null, online: false, lastSeenAt: iso(now - 9 * 3600e3), version: "1.0.2", active: 0, queued: 3 },
      { id: 901, name: "집 PC", kind: "own", tenantId: 1, tenantKey: "mock", online: false, lastSeenAt: iso(now - 2 * 3600e3), version: "1.0.3", active: 0, queued: 2 },
      { id: 902, name: "사무실", kind: "own", tenantId: 2, tenantKey: "cookmom", online: true, lastSeenAt: iso(now - 30e3), version: "1.0.3", active: 1, queued: 0 },
    ],
    /* [B2] canary_runs — 채널별 history(ok true/false/null · step) · today 만 shotKey */
    canary: fresh ? [] : ["naver_blog", "tistory"].map((ch) => ({ channel: ch, today: { ok: true, step: "draft_saved", shotKey: `canary/${ymd(0)}/${ch}.png`, ranAt: iso(now - 4 * 3600e3) },
      history: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: ymd(-d), ok: ch === "naver_blog" ? d !== 2 : d === 5 ? null : true, step: ch === "naver_blog" && d === 2 ? "selector_changed" : ch === "tistory" && d === 5 ? "no_session" : "draft_saved" })) })),
    /* [B2] ai_model_overrides + ai_settings — 모델 이름은 모의 표식(실명은 lib/ai-models.ts·API 가 준다) */
    ai: { roles: [
        { role: "high", codeChain: ["model-h1", "model-h2"], chain: ["model-h1", "model-h2"], candidate: ["model-h3"], canaryPct: 10, prevChain: null, candidateAt: iso(now - 2 * 86400e3), appliedAt: iso(now - 2 * 86400e3) },
        { role: "low", codeChain: ["model-l1"], chain: ["model-l2", "model-l1"], candidate: null, canaryPct: 100, prevChain: ["model-l1"], candidateAt: null, appliedAt: iso(now - 20 * 86400e3) },
        { role: "director", codeChain: ["model-h1"], chain: ["model-h1"], candidate: null, canaryPct: 100, prevChain: null, candidateAt: null, appliedAt: null },
        { role: "landing", codeChain: ["model-h1"], chain: ["model-h1"], candidate: null, canaryPct: 100, prevChain: null, candidateAt: null, appliedAt: null },
        { role: "image", codeChain: ["model-i1"], chain: ["model-i1"], candidate: null, canaryPct: 100, prevChain: null, candidateAt: null, appliedAt: null },
      ], settings: { updateMode: "manual", costCapKrw: 30000, candidates: [{ model: "model-h3", tested: { text: true, json: true, googleSearch: true, image: false }, at: iso(now - 3 * 86400e3) }, { model: "model-i2", tested: { text: false, json: false, googleSearch: null, image: true }, at: iso(now - 3 * 86400e3) }, { model: "model-x", tested: null, at: iso(now - 3 * 86400e3) }] } },
    /* [B2] channel_registry(ops-channels.ts) */
    channels: [["naver_blog", "네이버 블로그", "active", [7, 12, 21], ["adpost", "coupang"]], ["tistory", "티스토리", "active", [12, 13, 19], ["adsense"]], ["blogger", "블로거", "active", [9, 21], ["adsense"]], ["wordpress", "워드프레스", "active", [9, 21], ["adsense"]], ["threads", "쓰레드", "planned", [8, 20], []], ["instagram", "인스타그램", "planned", [18], ["coupang"]], ["youtube_shorts", "유튜브 쇼츠", "planned", [18], ["youtube"]], ["naver_clip", "네이버 클립", "planned", [19], ["clip"]], ["reels", "릴스", "planned", [18], []], ["tiktok", "틱톡", "planned", [20], []]].map(([key, label, status, bestHours, monetize]) => ({ key, label, status, bestHours, monetize })),
    /* [B2] ops-disclosure — text{coupang,generic} · 오버라이드 없으면 코드 기본(updatedAt 없음) */
    payment: { keyinEnabled: false, keyinLabel: "카드번호 직접 입력", keyinNotice: "법인카드가 앱카드 창에서 거절될 때 쓰세요." }, // ops_settings.payment
    disclosure: { text: { coupang: "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.", generic: "이 글에는 제휴 링크가 포함되어 있으며, 구매 시 일정액의 수수료를 받을 수 있습니다." }, updatedAt: null, updatedBy: null },
    notices: fresh ? [] : [
      { id: 801, kind: "incident", title: "네이버 발행이 늦어요 · 네이버 쪽 점검", body: "14:00 부터 네이버 블로그 발행이 30분쯤 밀리고 있어요. 예약은 그대로 나가요.", startsAt: iso(now - 2 * 3600e3), endsAt: iso(now + 4 * 3600e3), channels: ["naver_blog"], active: true },
      { id: 802, kind: "notice", title: "9월 25일 새벽 2시 점검(10분)", body: "점검 중에는 화면이 잠깐 안 열려요. 예약 발행은 영향 없어요.", startsAt: iso(now + 5 * 86400e3), endsAt: iso(now + 11 * 86400e3), active: true },
    ],
    /* audit_logs — R1 ops-audit(snake) 와 B2 ops-audit-search(camel) 가 같은 표를 읽는다 */
    audit: fresh ? [] : [
      { id: 1, action: "ops_impersonate_start", actor_type: "operator", actor_id: 2, tenant_id: 3, target: "tenant:3", risk_level: "high", created_at: iso(now - 50 * 60e3), detail: { reason: "결제 문의 대응" } },
      { id: 2, action: "ops_coins_grant", actor_type: "operator", actor_id: 2, tenant_id: 1, target: "tenant:1", risk_level: "medium", created_at: iso(now - 5 * 3600e3), detail: { coins: 30, reason: "온보딩 지원" } },
      { id: 3, action: "billing_attempt", actor_type: "system", actor_id: null, tenant_id: 3, target: "invoice:9003", risk_level: "medium", created_at: iso(now - 20 * 3600e3), detail: { ok: false, planKey: "starter", error: "카드 한도 초과", attempt: 2 } },
      { id: 4, action: "ops_price_event_create", actor_type: "operator", actor_id: 1, tenant_id: null, target: "plan:pro", risk_level: "high", created_at: iso(now - 61 * 86400e3), detail: { from: 45000, to: 49000, effectiveAt: "2026-10-01" } },
      { id: 5, action: "ad_media_state_claimed", actor_type: "user", actor_id: 1, tenant_id: 1, target: "account:1", risk_level: "low", created_at: iso(now - 30 * 60e3), detail: { source: "adpost", state: "applied" } },
      { id: 6, action: "ops_ai_apply", actor_type: "operator", actor_id: 1, tenant_id: null, target: "ai:high", risk_level: "high", created_at: iso(now - 2 * 86400e3), detail: { chain: ["model-h3"], canaryPct: 10 } },
      { id: 7, action: "ops_disclosure_set", actor_type: "operator", actor_id: 1, tenant_id: null, target: "disclosure", risk_level: "high", created_at: iso(now - 40 * 86400e3), detail: { coupang: "…", generic: "…" } },
    ],
  });

  let S; try { S = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { S = null; }
  if (!S || fresh || !S.ai || !S.ai.settings || !S.disclosure || !S.disclosure.text || qs.get("reset") === "1" || !S.tickets || !S.payment) { S = seed(); save(); }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch { /* empty */ } }
  const err = (step, error, extra = {}) => ({ ok: false, step, error, status: 400, ...extra });
  const forbid = () => ({ ok: false, step: "forbidden", error: "이 역할로는 할 수 없어요.", status: 403 });
  /* [§1.6(5)] 결제 라인 정책 — ?keyinMid=0 이면 비인증 MID 미등록(켜도 고객에겐 안 보인다) · MID·시크릿 값은 응답에 없다 */
  const keyinMid = qs.get("keyinMid") !== "0";
  const ROLE = { super_admin: 3, admin: 2, operator: 1 };
  const need = (minRole) => ROLE[role] < ROLE[minRole];
  const me = () => S.operators.find((o) => o.role === role) || S.operators[0];
  const tn = (id) => S.tenants.find((t) => t.id === Number(id));
  const delay = (ms = 220) => new Promise((r) => setTimeout(r, ms));
  const sum = (rows, f) => rows.reduce((a, r) => a + f(r), 0);

  const R = {
    "ops-me": () => ({ ok: true, operator: { ...me(), role, mustChangePassword: false } }),
    "ops-logout": () => ({ ok: true }),
    "ops-change-password": () => ({ ok: true }),
    /* ── 대시보드(§2.1 · 전부 KST 월) ── */
    "ops-dashboard": () => { if (need("super_admin")) return forbid(); // §0.2 매출은 super_admin
      const paid = S.invoices.filter((i) => i.status === "paid" && i.period.startsWith(thisMonth) || (i.status === "paid" && i.kind === "coin" && (i.paidAt || "").slice(0, 7) === thisMonth));
      const subscriptionKrw = sum(paid.filter((i) => i.kind === "subscription"), (i) => i.amountKrw), coinKrw = sum(paid.filter((i) => i.kind === "coin"), (i) => i.amountKrw);
      const mrr = sum(S.plans, (p) => p.mrrKrw); const usd = 212.4;
      return { ok: true, revenue: { todayKrw: 5000, monthKrw: subscriptionKrw + coinKrw, subscriptionKrw, coinKrw }, mrr, arr: mrr * 12, signups: { today: 1, month: 9 }, trialToPaidPct: 21.4, activeTenants: S.tenants.filter((t) => t.status === "active").length, churn: { month: 2, pct: 2.8 },
        coins: { soldKrw: coinKrw, consumed: 1840 }, aiCost: fxMissing ? { usd, fxMissing: true } : { usd, krw: Math.round(usd * 1390), fxMissing: false }, ...(fxMissing ? {} : { marginKrw: subscriptionKrw + coinKrw - Math.round(usd * 1390) }),
        published: { byChannel: [{ channel: "naver_blog", n: 412 }, { channel: "tistory", n: 288 }, { channel: "blogger", n: 51 }, { channel: "wordpress", n: 23 }] }, revenueCollectedKrw: 8412300 }; },
    /* ── 고객 ── */
    "ops-tenants": (_b, q) => { const s = (q.get("q") || "").toLowerCase(), st = q.get("status") || "", pl = q.get("plan") || "";
      const rows = S.tenants.filter((t) => (!s || `${t.name} ${t.key} ${t.ownerEmail}`.toLowerCase().includes(s)) && (!st || t.status === st) && (!pl || t.planKey === pl)); return { ok: true, tenants: rows, page: Number(q.get("page")) || 1, total: rows.length }; },
    "ops-tenant": (_b, q) => { const t = tn(q.get("id")); if (!t) return err("tenant", "고객이 없어요.", { status: 404 });
      const acc = t.id === 1 ? [{ id: 1, channel: "naver_blog", handle: "cook_a", status: "active", health_score: 100, posts_today: 0, daily_cap: 2 }, { id: 2, channel: "tistory", handle: "tips_b", status: "pending_login", health_score: 84, posts_today: 0, daily_cap: 1 }, { id: 3, channel: "naver_blog", handle: "life_c", status: "suspended", health_score: 31, posts_today: 0, daily_cap: 2 }, { id: 4, channel: "youtube_shorts", handle: "shorts_d", status: "active", health_score: 96, posts_today: 0, daily_cap: 1 }] : t.accounts ? [{ id: 10, channel: "naver_blog", handle: t.key + "_a", status: "active", health_score: t.health, posts_today: 1, daily_cap: 2 }] : [];
      return { ok: true, tenant: { id: t.id, key: t.key, name: t.name, plan_key: t.planKey, status: t.status, trial_ends_at: t.trialEndsAt, created_at: t.createdAt },
        setup: { accounts: t.accounts > 0, adMedia: t.id === 1 || t.id === 2 || t.id === 4, rules: t.id !== 6 && t.id !== 5, firstPublish: !!t.lastPostAt },
        coins: t.coins, coinsSplit: { included: t.planKey === "trial" ? 0 : Math.min(t.coins, 40), purchased: t.planKey === "trial" ? t.coins : Math.max(0, t.coins - 40) },
        subscription: t.planKey === "trial" ? null : { cycle: t.id === 4 ? "year" : "month", nextBillingAt: iso(now + 12 * 86400e3), billingKey: S.billingKeys.find((k) => k.tenantId === t.id) || null },
        users: [{ email: t.ownerEmail, role: "owner", email_verified_at: iso(t.createdAt), last_login_at: iso(now - 3 * 3600e3) }],
        accounts: acc, runners: S.runners.filter((r) => r.tenantName === t.name).map((r) => ({ name: r.name, status: r.status, last_seen_at: r.lastSeenAt })),
        slots: { planned: 12, published: t.lastPostAt ? 38 : 0 }, sources: t.id === 1 ? ["adsense", "adpost", "coupang"] : [],
        notes: S.notes[t.id] || [], audit: S.audit.filter((a) => a.tenant_id === t.id) }; },
    "ops-tenant-update": (b) => { if (need("admin")) return forbid(); const t = tn(b.id); if (!t) return err("tenant", "고객이 없어요.", { status: 404 }); if (b.status) t.status = b.status; if (b.planKey) t.planKey = b.planKey; return { ok: true }; },
    "ops-coins-grant": (b) => { if (need("admin")) return forbid(); const t = tn(b.id); if (!t) return err("tenant", "고객이 없어요.", { status: 404 }); const n = Number(b.coins); if (!n) return err("coins", "코인 수를 넣어 주세요."); if (t.coins + n < 0) return err("coins", `회수할 수 있는 코인은 ${t.coins}개까지예요.`); t.coins += n;
      S.audit.unshift({ id: S.nextId++, action: n > 0 ? "ops.coins.grant" : "ops.coins.revoke", actor_type: "operator", actor_id: me().id, tenant_id: t.id, risk_level: "medium", created_at: iso(Date.now()), detail: `${n > 0 ? "+" : ""}${n} ${b.reason || ""}` }); return { ok: true, balance: t.coins }; },
    "ops-trial-extend": (b) => { if (need("admin")) return forbid(); const t = tn(b.id); if (!t) return err("tenant", "고객이 없어요.", { status: 404 }); const d = Number(b.days); if (!d) return err("days", "며칠 늘릴지 넣어 주세요."); const base = t.trialEndsAt && new Date(t.trialEndsAt) > new Date() ? new Date(t.trialEndsAt).getTime() : Date.now(); t.trialEndsAt = iso(base + d * 86400e3); if (t.status === "readonly") t.status = "trial"; return { ok: true, trialEndsAt: t.trialEndsAt }; },
    "ops-plan-change": (b) => { if (need("admin")) return forbid(); const t = tn(b.id); if (!t) return err("tenant", "고객이 없어요.", { status: 404 }); if (!b.planKey) return err("planKey", "플랜을 골라 주세요."); t.planKey = b.planKey; if (b.planKey !== "trial" && t.status === "trial") t.status = "active"; return { ok: true }; },
    "ops-tenant-note": (b) => { const t = tn(b.id); if (!t) return err("tenant", "고객이 없어요.", { status: 404 }); if (!String(b.text || "").trim()) return err("text", "메모를 적어 주세요."); (S.notes[t.id] = S.notes[t.id] || []).unshift({ at: iso(Date.now()), by: me().name, text: b.text.trim() }); return { ok: true }; },
    "ops-impersonate": (b) => { const t = tn(b.id); if (!t) return err("tenant", "고객이 없어요.", { status: 404 }); S.audit.unshift({ id: S.nextId++, action: "ops.impersonate.start", actor_type: "operator", actor_id: me().id, tenant_id: t.id, risk_level: "high", created_at: iso(Date.now()), detail: t.name }); return { ok: true, redirect: "/app/home.html?mock=1&imp=1" }; },
    "ops-impersonate-end": () => ({ ok: true }),
    /* ── 이벤트 ── */
    "ops-promotions": (b) => { if (need("admin")) return forbid(); if (b && b.action) { if (b.action === "save") { const p = S.promotions.find((x) => x.id === Number(b.id)); if (p) Object.assign(p, b.promotion); else S.promotions.unshift({ id: S.nextId++, stats: { used: 0, converted: 0 }, ...b.promotion, status: new Date(b.promotion.startsAt) > new Date() ? "scheduled" : "active" }); } if (b.action === "end") { const p = S.promotions.find((x) => x.id === Number(b.id)); if (p) { p.status = "ended"; p.endsAt = iso(Date.now()); } } return { ok: true }; }
      return { ok: true, promotions: S.promotions }; },
    "ops-coupons": (b) => { if (need("admin")) return forbid(); if (b && b.action) { if (b.action === "save") { if (!/^[A-Z0-9]{4,16}$/.test(b.coupon?.code || "")) return err("code", "코드는 영문 대문자·숫자 4~16자예요."); if (S.coupons.some((c) => c.code === b.coupon.code && c.id !== Number(b.id))) return err("code", "이미 있는 코드예요."); const c = S.coupons.find((x) => x.id === Number(b.id)); if (c) Object.assign(c, b.coupon); else S.coupons.unshift({ id: S.nextId++, used: 0, status: "active", ...b.coupon }); } if (b.action === "end") { const c = S.coupons.find((x) => x.id === Number(b.id)); if (c) c.status = "ended"; } return { ok: true }; }
      return { ok: true, coupons: S.coupons }; },
    "ops-coupon-redemptions": (_b, q) => ({ ok: true, redemptions: S.redemptions.filter((r) => !q.get("couponId") || r.couponId === Number(q.get("couponId"))) }),
    /* ── 요금제 ── */
    "ops-plans": () => { if (need("super_admin")) return forbid(); return { ok: true, plans: S.plans, priceEvents: S.priceEvents }; },
    "ops-plan-update": (b) => { if (need("super_admin")) return forbid(); const p = S.plans.find((x) => x.key === b.key); if (!p) return err("key", "플랜이 없어요.", { status: 404 }); if (b.priceMonthKrw != null && b.priceMonthKrw !== p.priceMonthKrw) return err("price", "가격은 «가격 개정»으로만 바꿀 수 있어요(기존 고객 고지 → 다음 주기)."); Object.assign(p, b.patch || {}); return { ok: true, plan: p }; },
    "ops-coin-prices": (b) => { if (need("super_admin")) return forbid(); if (b && b.packs) { S.coinPrices.packs = b.packs; } if (b && b.table) S.coinPrices.table = b.table; return { ok: true, ...S.coinPrices }; },
    "ops-price-event": (b) => { if (need("super_admin")) return forbid(); const p = S.plans.find((x) => x.key === b.planKey); if (!p) return err("planKey", "플랜을 골라 주세요."); const price = Number(b.newPriceKrw); if (!price) return err("newPriceKrw", "새 가격을 넣어 주세요."); if (!b.effectiveAt || new Date(b.effectiveAt) < new Date(Date.now() + 30 * 86400e3)) return err("effectiveAt", "적용일은 고지 뒤 30일 이후여야 해요."); if (!String(b.noticeText || "").trim()) return err("noticeText", "고지 문구를 적어 주세요.");
      const ev = { id: S.nextId++, planKey: b.planKey, oldPriceKrw: p.priceMonthKrw, newPriceKrw: price, effectiveAt: b.effectiveAt, noticeText: b.noticeText, status: "scheduled", affected: p.subscribers }; S.priceEvents.unshift(ev); return { ok: true, event: ev }; },
    /* ── 결제 ── */
    "ops-invoices": (_b, q) => { if (need("admin")) return forbid(); const st = q.get("status") || ""; const rows = S.invoices.filter((i) => !st || i.status === st); return { ok: true, rows, page: 1, total: rows.length }; },
    "ops-invoice-retry": (b) => { if (need("admin")) return forbid(); const i = S.invoices.find((x) => x.id === Number(b.id)); if (!i) return err("id", "인보이스가 없어요.", { status: 404 }); if (i.status !== "failed") return err("status", "실패한 인보이스만 다시 시도할 수 있어요."); i.attempts++; if (i.attempts >= 3) { i.status = "paid"; i.paidAt = iso(Date.now()); delete i.nextRetryAt; S.receivables = S.receivables.filter((r) => r.tenantId !== i.tenantId); const t = tn(i.tenantId); if (t) t.status = "active"; } else i.nextRetryAt = iso(Date.now() + 86400e3); return { ok: true, invoice: i }; },
    "ops-refund": (b) => { if (need("admin")) return forbid(); const i = S.invoices.find((x) => x.period === b.orderNo && x.kind === "coin"); if (!i) return err("orderNo", "그 주문번호의 충전이 없어요.", { status: 404 }); if (i.status === "refunded") return err("status", "이미 환불한 주문이에요."); const daysAgo = (Date.now() - new Date(i.paidAt).getTime()) / 86400e3; if (daysAgo > 7) return { ok: false, step: "window", reason: "window", error: "충전 후 7일이 지나 환불할 수 없어요.", status: 400 }; i.status = "refunded"; i.refundedKrw = i.totalKrw; return { ok: true, refundKrw: i.totalKrw, revoked: Math.round(i.amountKrw / 500), invoiceId: i.id }; },
    "ops-billing-keys": () => { if (need("admin")) return forbid(); return { ok: true, rows: S.billingKeys }; },
    "ops-payment-settings": (b) => { const P = S.payment;
      if (b && (b.keyinEnabled !== undefined || b.keyinLabel !== undefined || b.keyinNotice !== undefined)) { if (need("admin")) return forbid();
        if (typeof b.keyinEnabled === "boolean") P.keyinEnabled = b.keyinEnabled; if (typeof b.keyinLabel === "string") P.keyinLabel = b.keyinLabel.trim().slice(0, 40) || "카드번호 직접 입력"; if (typeof b.keyinNotice === "string") P.keyinNotice = b.keyinNotice.trim().slice(0, 300);
        S.audit.unshift({ id: S.nextId++, action: "ops_payment_settings", actor_type: "operator", actor_id: me().id, tenant_id: null, target: "payment", risk_level: "high", created_at: iso(Date.now()), detail: { keyinEnabled: P.keyinEnabled } });
        return { ok: true, payment: { ...P }, keyinMidConfigured: keyinMid, effective: P.keyinEnabled && keyinMid }; }
      return { ok: true, payment: { ...P }, keyinMidConfigured: keyinMid, kiccConfigured: true, mode: "test" }; },
    /* [P1R6 §1.3] 회사 정보 7칸 — 영수증 supplier · 약관 하단 · 세금계산서가 읽는 한 출처(ops_settings.company) */
    "ops-company": (b) => { if (need("super_admin")) return forbid(); const C = S.company;
      if (b && Object.keys(b).length) {
        const patch = {}; for (const k of CO_FIELDS) { if (b[k] === undefined) continue; const v = String(b[k] ?? "").replace(/\s+/g, " ").trim();
          if (k === "bizNo") { const d = v.replace(/\D/g, ""); const f = d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : v; if (f && !/^\d{3}-\d{2}-\d{5}$/.test(f)) return err("bizNo", "사업자등록번호는 숫자 10자리예요(000-00-00000)."); patch[k] = f; continue; }
          if (k === "email" && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return err("email", "메일 주소 모양이 아니에요.");
          patch[k] = k === "email" ? v.toLowerCase() : v; }
        const changed = CO_FIELDS.filter((k) => patch[k] !== undefined && patch[k] !== C[k]);
        Object.assign(C, patch); C.updatedBy = me().id; C.updatedAt = iso(Date.now());
        S.audit.unshift({ id: S.nextId++, action: "ops_company_update", actor_type: "operator", actor_id: me().id, tenant_id: null, target: "ops_settings:company", risk_level: "high", created_at: iso(Date.now()), detail: { changed } });
        return { ok: true, ...C, configured: !!(C.name && C.bizNo), changed }; }
      return { ok: true, ...C, configured: !!(C.name && C.bizNo) }; },
    "ops-receivables": () => { if (need("admin")) return forbid(); return { ok: true, rows: S.receivables }; },
    "ops-tax-invoice": (b) => { if (need("admin")) return forbid(); const i = S.invoices.find((x) => x.id === Number(b.invoiceId)); if (!i) return err("invoiceId", "인보이스가 없어요.", { status: 404 });
      if (b.status === "issued") { const url = String(b.url || "").trim();   // [P1R6 §1.2] 홈택스에서 발행한 뒤 «발행됨» 표시(문서 주소는 선택 · https 만)
        if (url && !new RegExp("^https://", "i").test(url)) return err("url", "문서 주소는 https:// 로 시작해야 해요.");
        i.taxRequestedAt = i.taxRequestedAt || iso(Date.now());
        i.taxInvoice = { status: "issued", requestedAt: i.taxRequestedAt, issuedAt: iso(Date.now()), ...(url ? { url } : {}) };
        S.audit.unshift({ id: S.nextId++, action: "ops_tax_doc_issued", actor_type: "operator", actor_id: me().id, tenant_id: i.tenantId, target: "invoice:" + i.id, risk_level: "normal", created_at: iso(Date.now()), detail: { url: url || null } });
        return { ok: true, invoiceId: i.id, taxInvoice: i.taxInvoice, issued: true }; }
      i.taxRequestedAt = iso(Date.now()); i.taxInvoice = { status: "requested", requestedAt: i.taxRequestedAt }; return { ok: true, status: "requested", note: "KICC 키가 꽂히면 실발급돼요 · 지금은 요청만 기록" }; },
    /* ── CS ── */
    "ops-tickets": (_b, q) => { const f = (k) => q.get(k) || ""; const rows = S.tickets.filter((t) => (!f("status") || t.status === f("status")) && (!f("priority") || t.priority === f("priority")) && (!f("assignee") || String(t.assignee?.id) === f("assignee")) && (!f("tag") || t.tags.includes(f("tag")))).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")); return { ok: true, tickets: rows, page: 1, total: rows.length }; },
    "ops-ticket": (_b, q) => { const t = S.tickets.find((x) => x.id === Number(q.get("id"))); if (!t) return err("id", "티켓이 없어요.", { status: 404 }); const ten = tn(t.tenantId) || {};
      return { ok: true, ticket: t, messages: S.messages[t.id] || [], context: { planKey: ten.planKey, status: ten.status, coins: ten.coins, runner: { online: S.runners.filter((r) => r.tenantName === ten.name && r.status === "online").length, total: S.runners.filter((r) => r.tenantName === ten.name).length }, recentErrors: t.id === 702 ? [{ at: iso(now - 25 * 3600e3), kind: "login_fail", text: "네이버 로그인 풀림 · @tips_b" }] : t.id === 701 ? [{ at: iso(now - 20 * 3600e3), kind: "billing", text: "카드 한도 초과 ×2" }] : [], appVersion: "1.4.0" }, macros: S.macros }; },
    "ops-ticket-reply": (b) => { const t = S.tickets.find((x) => x.id === Number(b.id)); if (!t) return err("id", "티켓이 없어요.", { status: 404 }); if (!String(b.text || "").trim()) return err("text", "답변을 적어 주세요."); (S.messages[t.id] = S.messages[t.id] || []).push({ id: S.nextId++, from: "operator", text: b.text.trim(), at: iso(Date.now()) }); t.updatedAt = iso(Date.now()); if (t.status === "open") t.status = "progress"; if (!t.assignee) t.assignee = { id: me().id, name: me().name }; return { ok: true, sent: { app: true, email: true } }; },
    "ops-ticket-assign": (b) => { const t = S.tickets.find((x) => x.id === Number(b.id)); if (!t) return err("id", "티켓이 없어요.", { status: 404 }); const o = S.operators.find((x) => x.id === Number(b.operatorId)); t.assignee = o ? { id: o.id, name: o.name } : undefined; t.updatedAt = iso(Date.now()); return { ok: true }; },
    "ops-ticket-resolve": (b) => { const t = S.tickets.find((x) => x.id === Number(b.id)); if (!t) return err("id", "티켓이 없어요.", { status: 404 }); t.status = b.status || "resolved"; t.updatedAt = iso(Date.now()); return { ok: true }; },
    "ops-ticket-priority": (b) => { const t = S.tickets.find((x) => x.id === Number(b.id)); if (!t) return err("id", "티켓이 없어요.", { status: 404 }); t.priority = b.priority; if (b.tags) t.tags = b.tags; t.updatedAt = iso(Date.now()); return { ok: true }; },
    "ops-macros": (b) => { if (b && b.action) { if (need("admin")) return forbid(); if (b.action === "save") { const m = S.macros.find((x) => x.id === Number(b.id)); if (m) Object.assign(m, b.macro); else S.macros.push({ id: S.nextId++, ...b.macro }); } if (b.action === "delete") S.macros = S.macros.filter((x) => x.id !== Number(b.id)); return { ok: true }; } return { ok: true, macros: S.macros }; },
    "ops-faqs": (b) => { if (b && b.action) { if (need("admin")) return forbid(); if (b.action === "save") { const f = S.faqs.find((x) => x.id === Number(b.id)); if (f) Object.assign(f, b.faq); else S.faqs.push({ id: S.nextId++, order: S.faqs.length + 1, public: true, ...b.faq }); } if (b.action === "delete") S.faqs = S.faqs.filter((x) => x.id !== Number(b.id)); return { ok: true }; } return { ok: true, faqs: S.faqs }; },
    "ops-cs-stats": () => ({ ok: true, open: S.tickets.filter((t) => t.status !== "resolved").length, avgFirstReplyMin: 42, slaMissPct: 8.3, satisfactionPct: 91 }),
    /* ── [B2] 러너 팜 — ops-runners.ts(조회 operator+ · 변경 admin+ · 화면은 super_admin 잠금) ── */
    "ops-runners": () => { const R = S.runners; const farm = { managed: R.filter((x) => x.tenantId == null).length, online: R.filter((x) => x.online).length, queued: R.reduce((a, x) => a + (x.queued || 0), 0), claimed: R.reduce((a, x) => a + (x.active || 0), 0), oldestQueuedMin: R.some((x) => x.queued) ? 42 : null }; return { ok: true, runners: R.map((x) => ({ ...x })), farm }; },
    "ops-runner-assign": (b) => { if (need("admin")) return forbid(); const x = S.runners.find((r) => r.id === Number(b.id)); if (!x) return err("not_found", "러너를 찾을 수 없어요.", { status: 404 });
      if (b.action === "rebind") { const tid = b.tenantId == null || b.tenantId === "" ? null : Number(b.tenantId); const tn = tid == null ? null : S.tenants.find((z) => z.id === tid); if (tid != null && !tn) return err("tenant", "그 테넌트가 없어요.", { status: 404 }); x.tenantId = tid; x.tenantKey = tn ? tn.key : null; return { ok: true, id: x.id, tenantId: tid }; }
      if (b.action === "release") { const n = x.active || 0; x.active = 0; x.queued = (x.queued || 0) + n; return { ok: true, id: x.id, released: n }; }
      if (b.action === "remove") { S.runners = S.runners.filter((r) => r.id !== x.id); return { ok: true, id: x.id, removed: true }; }
      return err("action", "action 은 rebind|release|remove"); },
    "ops-canary": (_b, q) => ({ ok: true, days: Number(q.get("days")) || 14, channels: S.canary.map((c) => ({ ...c })) }),
    /* ── [B2] AI — ops-ai.ts(조회 operator+ · 변경 admin+ · 화면은 super_admin 잠금) ── */
    "ops-ai-models": () => ({ ok: true, roles: S.ai.roles.map((r) => ({ ...r })), settings: { ...S.ai.settings } }),
    "ops-ai-apply": (b) => { if (need("admin")) return forbid(); const r = S.ai.roles.find((x) => x.role === b.role); if (!r) return err("role", "role"); const chain = (Array.isArray(b.chain) ? b.chain : []).map((s) => String(s).trim()).filter(Boolean); if (!chain.length) return err("chain", "chain 이 비었어요");
      if (chain.some((m) => /bad|없/.test(m))) return err("verify", `모델 «${chain.find((m) => /bad|없/.test(m))}» 을(를) 우리 키로 부를 수 없어요(no_response). 적용을 취소했어요.`);
      const pct = Math.max(1, Math.min(100, Math.trunc(Number(b.canaryPct ?? 100)) || 100)); r.prevChain = r.chain.slice(); if (pct >= 100) { r.chain = chain; r.candidate = null; r.candidateAt = null; r.canaryPct = 100; } else { r.candidate = chain; r.candidateAt = iso(Date.now()); r.canaryPct = pct; } r.appliedAt = iso(Date.now());
      S.audit.unshift({ id: S.nextId++, action: "ops_ai_apply", actor_type: "operator", actor_id: me().id, tenant_id: null, target: "ai:" + r.role, risk_level: "high", created_at: iso(Date.now()), detail: { chain, canaryPct: pct } });
      return { ok: true, role: r.role, chain: r.chain, candidate: r.candidate, canaryPct: r.canaryPct }; },
    "ops-ai-rollback": (b) => { if (need("admin")) return forbid(); const r = S.ai.roles.find((x) => x.role === b.role); if (!r) return err("role", "role"); if (!r.prevChain && !r.candidate) return err("not_found", "이 역할엔 되돌릴 오버레이가 없어요(코드 기본 사용 중).", { status: 404 }); if (r.prevChain) r.chain = r.prevChain; r.candidate = null; r.candidateAt = null; r.canaryPct = 100; r.prevChain = null; r.appliedAt = iso(Date.now()); return { ok: true, role: r.role, chain: r.chain }; },
    "ops-ai-mode": (b) => { if (need("admin")) return forbid(); if (b.mode !== "manual" && b.mode !== "auto") return err("mode", "mode 는 manual|auto"); S.ai.settings.updateMode = b.mode; return { ok: true, updateMode: b.mode }; },
    "ops-ai-cost-cap": (b) => { if (need("admin")) return forbid(); const v = b.costCapKrw == null || b.costCapKrw === "" ? null : Math.max(0, Math.trunc(Number(b.costCapKrw))); S.ai.settings.costCapKrw = v; return { ok: true, costCapKrw: v }; },
    /* ── [B2] 채널 — ops-channels.ts ── */
    "ops-channels": (b) => { if (!b || !b.key) return { ok: true, channels: S.channels.map((c) => ({ ...c })) }; if (need("admin")) return forbid(); const c = S.channels.find((x) => x.key === b.key); if (!c) return err("not_found", "그 채널이 레지스트리에 없어요.", { status: 404 });
      if (b.status !== undefined) { if (!["active", "planned", "down"].includes(b.status)) return err("status", "status 는 active/planned/down"); c.status = b.status; } if (Array.isArray(b.bestHours)) c.bestHours = [...new Set(b.bestHours.map(Number).filter((n) => n >= 0 && n <= 23))]; if (Array.isArray(b.monetize)) c.monetize = b.monetize.map(String).slice(0, 12); if (b.label !== undefined) c.label = String(b.label).slice(0, 40);
      return { ok: true, channel: { ...c } }; },
    "ops-disclosure": (b) => { if (!b || (b.coupang === undefined && b.generic === undefined)) return { ok: true, text: { ...S.disclosure.text }, updatedAt: S.disclosure.updatedAt || undefined, updatedBy: S.disclosure.updatedBy || undefined }; if (need("admin")) return forbid();
      const next = { coupang: b.coupang !== undefined ? String(b.coupang).slice(0, 300) : S.disclosure.text.coupang, generic: b.generic !== undefined ? String(b.generic).slice(0, 300) : S.disclosure.text.generic }; if (!next.coupang.trim() || !next.generic.trim()) return err("empty", "고지 문구는 비울 수 없어요");
      S.disclosure = { text: next, updatedAt: iso(Date.now()), updatedBy: { id: me().id, name: me().name } }; S.audit.unshift({ id: S.nextId++, action: "ops_disclosure_set", actor_type: "operator", actor_id: me().id, tenant_id: null, target: "disclosure", risk_level: "high", created_at: iso(Date.now()), detail: next }); return { ok: true, text: next, updatedAt: S.disclosure.updatedAt, updatedBy: { id: me().id, name: me().name } }; },
    /* ── [B2] 공지 — ops-notices.ts(조회 operator+ · 변경 admin+) ── */
    "ops-notices": (b, q) => { if (!b || !b.title && !b.id) { const kind = q.get("kind"); const rows = S.notices.filter((n) => !kind || n.kind === kind); const page = Math.max(1, Number(q.get("page")) || 1); return { ok: true, notices: rows.slice((page - 1) * 30, page * 30).map((n) => ({ ...n })), page, total: rows.length }; }
      if (need("admin")) return forbid(); const kind = String(b.kind || "notice"); if (kind !== "notice" && kind !== "incident") return err("kind", "kind 는 notice/incident"); const title = String(b.title || "").trim(); if (!title) return err("title", "제목을 입력해 주세요");
      const v = { kind, title: title.slice(0, 160), body: b.body ? String(b.body).slice(0, 4000) : undefined, startsAt: b.startsAt || iso(Date.now()), endsAt: b.endsAt || undefined, plans: Array.isArray(b.plans) && b.plans.length ? b.plans : undefined, channels: Array.isArray(b.channels) && b.channels.length ? b.channels : undefined, active: b.active !== false };
      let n = S.notices.find((x) => x.id === Number(b.id)); if (b.id && !n) return err("not_found", "공지를 찾을 수 없어요.", { status: 404 }); if (n) Object.assign(n, v); else { n = { id: S.nextId++, ...v }; S.notices.unshift(n); } return { ok: true, notice: { ...n } }; },
    "ops-notice-delete": (b) => { if (need("admin")) return forbid(); S.notices = S.notices.filter((n) => n.id !== Number(b.id)); return { ok: true }; },
    /* ── [B2] 운영진·감사 — ops-operators.ts(전부 super_admin) ── */
    "ops-operators": (b, q) => { if (need("super_admin")) return forbid(); if (!b || !b.email) { const page = Math.max(1, Number(q.get("page")) || 1); return { ok: true, operators: S.operators.slice((page - 1) * 30, page * 30).map((o) => ({ ...o })), page, total: S.operators.length }; }
      const email = String(b.email).trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err("email", "올바른 이메일을 입력해 주세요"); const role = ["operator", "admin", "super_admin"].includes(b.role) ? b.role : null; if (!role) return err("role", "role");
      let o = S.operators.find((x) => x.id === Number(b.id)); if (b.id && !o) return err("not_found", "운영자를 찾을 수 없어요.", { status: 404 }); if (!o && S.operators.some((x) => x.email === email)) return err("duplicate", "이미 있는 이메일이에요.", { status: 409 });
      if (o) Object.assign(o, { email, name: String(b.name || "").slice(0, 80), role, ssoSubject: b.ssoSubject ? String(b.ssoSubject) : undefined }); else { o = { id: S.nextId++, email, name: String(b.name || "").slice(0, 80), role, ssoSubject: b.ssoSubject ? String(b.ssoSubject) : undefined, active: true }; S.operators.push(o); } return { ok: true, operator: { ...o } }; },
    "ops-operator-role": (b) => { if (need("super_admin")) return forbid(); const o = S.operators.find((x) => x.id === Number(b.id)); if (!o) return err("not_found", "운영자를 찾을 수 없어요.", { status: 404 }); if (o.id === me().id && b.role !== "super_admin") return err("self", "본인의 super_admin 권한은 스스로 내릴 수 없어요."); o.role = b.role; return { ok: true, operator: { ...o } }; },
    "ops-operator-disable": (b) => { if (need("super_admin")) return forbid(); const o = S.operators.find((x) => x.id === Number(b.id)); if (!o) return err("not_found", "운영자를 찾을 수 없어요.", { status: 404 }); if (o.id === me().id && b.active !== true) return err("self", "본인 계정은 스스로 비활성화할 수 없어요."); o.active = b.active === true; return { ok: true, operator: { ...o } }; },
    "ops-audit-search": (_b, q) => { if (need("super_admin")) return forbid(); const s = (q.get("q") || "").toLowerCase(); const t = Number(q.get("tenant")) || 0, a = Number(q.get("actor")) || 0, act = q.get("action") || "", risk = q.get("risk") || "", from = q.get("from") || "", to = q.get("to") || ""; const AT = { operator: "operator", customer: "user", system: "system" }; const atq = (q.get("actorType") || "").toLowerCase(); if (atq && atq !== "all" && !AT[atq]) return err("actorType", "actorType 은 operator|customer|system"); const dbType = AT[atq] || ""; const page = Math.max(1, Number(q.get("page")) || 1);
      const kstDay = (x) => new Date(new Date(x).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
      const rows = S.audit.filter((r) => (!s || `${r.action} ${r.target || ""}`.toLowerCase().includes(s)) && (!t || r.tenant_id === t) && (!a || r.actor_id === a) && (!act || r.action === act) && (!risk || r.risk_level === risk) && (!dbType || r.actor_type === dbType) && (!from || kstDay(r.created_at) >= from) && (!to || kstDay(r.created_at) <= to));
      return { ok: true, rows: rows.slice((page - 1) * 30, page * 30).map((r) => ({ id: r.id, tenantId: r.tenant_id ?? null, actorType: r.actor_type === "user" ? "customer" : r.actor_type, actorId: r.actor_id ?? null, action: r.action, target: r.target || null, risk: r.risk_level, detail: r.detail ?? null, ip: null, at: r.created_at })), page, total: rows.length }; },
    "ops-audit": (_b, q) => { if (need("super_admin")) return forbid(); const t = q.get("tenantId") || q.get("tenant"); const rows = S.audit.filter((r) => !t || String(r.tenant_id) === t); return { ok: true, rows: rows.slice(0, Number(q.get("limit")) || 100).map((r) => ({ ...r, detail: typeof r.detail === "object" && r.detail ? Object.entries(r.detail).map(([k, v]) => `${k}: ${v}`).join(" · ") : r.detail })) }; }, // R1 모양(테넌트 상세가 쓴다)
  };

  const real = UI.api;
  UI.api = async function (path, opts = {}) {
    const u = new URL(path, location.origin); const name = u.pathname.replace(/^\/api\//, "");
    const h = R[name]; if (!h) return real(path, opts);
    await delay(); const r = h(opts.body || {}, u.searchParams); save();
    const status = r.status || 200; return { ...r, status, ok: !!r.ok };
  };
  const KEEP = ["role", "fx"];
  const withMock = (href) => { try { const u = new URL(href, location.origin); if (u.origin !== location.origin || !u.pathname.startsWith("/ops")) return href; u.searchParams.set("mock", "1"); for (const k of KEEP) if (qs.has(k)) u.searchParams.set(k, qs.get(k)); return u.pathname + u.search + u.hash; } catch { return href; } };
  UI.go = (href) => location.assign(withMock(href));
  document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("a[href]"); if (!a) return; const h = a.getAttribute("href"); if (!h || h.startsWith("javascript:") || h.startsWith("#")) return; const m = withMock(h); if (m !== h) a.setAttribute("href", m); }, true);
  const badge = document.createElement("div"); badge.textContent = `모의 데이터 · ${role}`; badge.style.cssText = "position:fixed;bottom:calc(var(--tab-h) + 6px);left:8px;z-index:99;font-size:10px;font-weight:700;color:var(--muted);background:var(--press);border-radius:6px;padding:2px 6px;pointer-events:none"; document.body.appendChild(badge);
})();
