/* mock.js — P1R1·P1R2 계약(docs/active/2026-09-14-P1R1-contract.md · -P1R2-contract.md)의 모양대로 가짜 응답을 돌려주는 개발용 층.
   🔴 `location.search` 에 `mock=1` 이 없으면 즉시 return — 운영 코드 무접촉. 키 이름은 계약서 글자 그대로.
   상태는 sessionStorage(acMockState)에 남겨 화면 왕복 중 유지 · `?mock=1&fresh=1` 이면 빈 상태(계정 0·규칙 0)로 초기화.
   내부 링크 클릭·UI.go 는 mock=1 을 이어 붙인다(전 화면 왕복용).
   [P1R2] `?runner=on|off` 로 내 PC 프로그램 온·오프 두 상태를 왕복한다(기본 off — 오프라인 경고 경로가 보이도록). */
(function () {
  const qs = new URLSearchParams(location.search);
  if (qs.get("mock") !== "1" || !window.UI) return;
  const UI = window.UI;
  const KEY = "acMockState";
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const kst = (dayOffset, h, m = 0) => { const d = new Date(now + 9 * 3600e3); d.setUTCDate(d.getUTCDate() + dayOffset); d.setUTCHours(h, m, 0, 0); return new Date(d.getTime() - 9 * 3600e3).toISOString(); };
  const ymd = (dayOffset) => { const d = new Date(now + 9 * 3600e3); d.setUTCDate(d.getUTCDate() + dayOffset); return d.toISOString().slice(0, 10); };
  const todayYmd = ymd(0);

  /* ── 초기 상태(계약 §1~§7 모양) ── */
  const CHANNELS = [
    ["naver_blog", "네이버 블로그", "text", "runner", "session", true, "active"], ["tistory", "티스토리", "text", "runner", "session", true, "active"], ["blogger", "블로거", "text", "api", "oauth", false, "active"],
    ["wordpress", "워드프레스", "text", "api", "app_password", true, "active"], ["threads", "쓰레드", "text", "api", "oauth", true, "planned"], ["instagram", "인스타그램", "video", "api", "oauth", false, "planned"],
    ["youtube_shorts", "유튜브 쇼츠", "video", "api", "oauth", false, "planned"], ["naver_clip", "네이버 클립", "video", "runner", "session", true, "planned"], ["reels", "릴스", "video", "api", "oauth", false, "planned"], ["tiktok", "틱톡", "video", "api", "oauth", false, "planned"],
  ].map(([key, label, category, publishVia, connectMethod, configured, status]) => ({ key, label, category, publishVia, status, connectMethod, configured })); // 라이브 channel_registry 와 같게: 발행 경로 있는 4채널만 active · 나머지 planned(어휘 active|planned|down)

  const BODY_NAVER = `<p>주말에 에어프라이어를 열었더니 바닥에 기름이 눌어붙어 있더라고요. 세 번 실패하고 네 번째에 깨끗해진 방법을 그대로 적어요.</p>
<blockquote>준비물은 베이킹소다·주방세제·따뜻한 물, 이게 전부예요</blockquote>
<p class="summary">담그기 10분 · 베이킹소다 5분 · 건조 30분이면 끝나요. 철수세미만 안 쓰면 돼요.</p>
<h2>1. 바스켓은 물에 10분만 담가요</h2>
<p>뜨거운 물에 세제 한 방울 넣고 10분 담가 두면 눌어붙은 기름이 절반은 떠요. 저는 이걸 안 하고 바로 문질러서 코팅을 긁었어요.</p>
<figure><img src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='400'%3E%3Crect width='640' height='400' fill='%23E8EBEE'/%3E%3C/svg%3E" alt=""><figcaption>10분 담가 둔 바스켓 — 기름이 떠오른 모습</figcaption></figure>
<h2>2. 베이킹소다 반죽으로 코너를 닦아요</h2>
<p>베이킹소다 2 : 물 1로 반죽해 코너에 발라 두면 5분 뒤 부드러운 수세미로 밀리듯 닦여요.</p>
<ul class="check"><li>바스켓 10분 담그기</li><li>베이킹소다 반죽 5분</li><li>헹군 뒤 완전히 말리기</li></ul>
<hr>
<p class="tip">코팅 제품은 철수세미 절대 금지 — 한 번 긁히면 냄새가 계속 배어요.</p>
<a class="affiliate" href="https://link.coupang.com/a/mock" rel="nofollow sponsored"><img src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72'%3E%3Crect width='72' height='72' fill='%23E8EBEE'/%3E%3C/svg%3E" alt=""><span><span class="name">에어프라이어 세척솔 3종 세트</span><span class="price">8,900원</span></span><span class="go">쿠팡에서 보기</span></a>
<p>이렇게 하니 한 달에 한 번이면 충분하더라고요. 여러분도 주말에 10분만 써 보세요.</p>
<p class="tags">#에어프라이어청소 #베이킹소다 #주방청소</p>`;
  const BODY_TISTORY = `<nav class="toc"><ol><li>3분 요약</li><li>단계별 흔한 실수</li><li>자주 묻는 질문</li></ol></nav>
<h2>에어프라이어 청소, 3분 요약</h2>
<p>에어프라이어 바닥에 눌어붙은 기름은 «담그기 → 베이킹소다 → 건조» 세 단계면 끝난다. 각 단계에서 흔한 실수를 표로 정리했다.</p>
<table><tr><th>단계</th><th>시간</th><th>흔한 실수</th></tr><tr><td>담그기</td><td>10분</td><td>찬물 사용</td></tr><tr><td>베이킹소다</td><td>5분</td><td>철수세미</td></tr><tr><td>건조</td><td>30분</td><td>젖은 채 조립</td></tr></table>
<div class="adsense">애드센스 자리 · 발행 후 광고가 들어가요</div>
<h3>자주 묻는 질문</h3>
<dl class="faq"><dt>식기세척기에 넣어도 되나요?</dt><dd>바스켓만 가능. 본체는 물 세척 금지.</dd><dt>냄새가 남아요</dt><dd>레몬 껍질을 넣고 5분 돌리면 빠진다.</dd></dl>
<ul class="check"><li>코팅 제품은 부드러운 수세미</li><li>세제는 한 방울</li></ul>
<p>정리하면, 주 1회 10분이면 냄새와 연기 없이 쓸 수 있다.</p>`;

  const DISCLOSURE = "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.";
  // [v1.1] GateKey 12 · 순서 고정(5C.2 8검사 + 16B 4검사)
  const gate = (ok = true) => ({ ok, rewritten: !ok, checks: [
    { key: "cliche", label: "상투적 표현", pass: true, detail: "0건" }, { key: "para_repeat", label: "문단 시작 반복", pass: true }, { key: "bullet_ratio", label: "글머리표 비율", pass: true, detail: "18%" },
    { key: "sentence_variance", label: "문장 길이 변화", pass: true }, { key: "translationese", label: "번역투", pass: true, detail: "0건" }, { key: "superlative", label: "과장 표현", pass: ok, detail: ok ? "0건" : "«최고» 2건" },
    { key: "persona", label: "페르소나 재료", pass: true, detail: "3곳" }, { key: "visual_min", label: "사진 수", pass: true, detail: "8장" },
    { key: "disclosure", label: "제휴 고지 첫 블록", pass: ok }, { key: "banned_words", label: "금칙어", pass: true, detail: "0건" }, { key: "similarity", label: "다른 계정 글과 유사도", pass: true, detail: "12%" }, { key: "affiliate_count", label: "제휴 링크 수", pass: true, detail: "1개" } ] });

  const fresh = qs.get("fresh") === "1";
  const runnerOn = qs.get("runner") === "on";
  const revEmpty = qs.get("revEmpty") === "1";                 // 수익 빈 상태(연결 0·행 0)
  const revError = qs.get("revError") || "";                   // ?revError=adsense — 그 소스를 연결 끊김으로
  /* revenue_daily 씨앗 — 75일치. d === -6 은 수집 실패라 «행이 없고», d === -11 은 진짜 0원이라 «행이 있다»(AC-9) */
  function revSeed() {
    const rows = []; const rhythm = [3900, 5200, 4400, 6100, 3300, 7400, 5800];
    for (let d = -74; d <= 0; d++) {
      if (d === -6) continue;
      const day = ymd(d); const k = rhythm[new Date(day + "T00:00:00Z").getUTCDay()] * (d > -15 ? 1 : 0.72);
      const zero = d === -11;
      const put = (source, accountId, amountKrw, freshness, pieceId) => { const r = { day, source, accountId, amountKrw: Math.max(0, Math.round(amountKrw)), freshness }; if (pieceId) r.pieceId = pieceId; rows.push(r); };
      put("adsense", 2, zero ? 0 : k * 0.40, "api", 504);
      put("adpost", 1, zero ? 0 : k * 0.31, "runner", 505);
      put("coupang", 1, zero ? 0 : k * 0.22, "api", 501);
      if (d % 3 === 0) put("youtube", 4, zero ? 0 : k * 0.14, "api");
      if (d === -4) put("sponsor", 1, 45000, "manual");        // 직접 입력 한 건
    }
    return rows;
  }
  const IMG = { naver_blog: 6, tistory: 3, blogger: 2, wordpress: 2, threads: 1 }; // 채널 기본 사진 수(코인 = 글 1 + 사진 수)
  const seed = () => ({
    coins: 30, refreshCount: 0, autoSchedule: false, nextId: 100,
    accounts: fresh ? [] : [
      { id: 1, channel: "naver_blog", handle: "cook_a", displayName: "요리하는 A", avatar: null, status: "active", healthScore: 100, postsToday: 0, dailyCap: 2, minGapMin: 180, goldenHours: [7, 21], lastPostAt: iso(now - 26 * 3600e3), personaId: 1, browserProfileKey: "acc-1", hasCreds: true, monetize: { coupang: true, adpost: true, adsense: false } },
      { id: 2, channel: "tistory", handle: "tips_b", displayName: "", avatar: null, status: "pending_login", healthScore: 84, postsToday: 0, dailyCap: 1, minGapMin: 360, goldenHours: [12], lastErrorKind: "login_fail", browserProfileKey: "acc-2", hasCreds: true, monetize: { coupang: false, adpost: false, adsense: true } },
      { id: 3, channel: "naver_blog", handle: "life_c", displayName: "살림하는 C", avatar: null, status: "suspended", healthScore: 31, postsToday: 0, dailyCap: 2, minGapMin: 180, goldenHours: [21], lastErrorKind: "suspended", lastPostAt: iso(now - 5 * 86400e3), browserProfileKey: "acc-3", hasCreds: true, monetize: { coupang: false, adpost: true, adsense: false } },
      { id: 4, channel: "youtube_shorts", handle: "shorts_d", displayName: "1분 살림", avatar: null, status: "active", healthScore: 96, postsToday: 0, dailyCap: 1, minGapMin: 360, goldenHours: [18], lastPostAt: iso(now - 2 * 86400e3), browserProfileKey: "acc-4", hasCreds: true, monetize: { coupang: false, adpost: false, adsense: false } },
    ],
    personas: fresh ? [] : [{ id: 1, name: "30대 맞벌이 주부", profile: { region: "경기 남부", family: "아이 둘", job: "회사원", home: "아파트", brands: ["코스트코", "다이소"], tone: "친근한 구어", interests: ["살림", "가전"], banned: ["최고", "무조건"], signature: "— 오늘도 10분만" } }],
    topics: fresh ? [] : [
      { id: 11, title: "에어프라이어 청소법, 눌어붙은 기름 3분 컷", angle: "실패담 → 성공 순서", channelHint: "naver_blog", score: 91, status: "candidate", factors: { volume: 32000, growthPct: 18, competition: "low", intent: "mixed", pain: 0.8, seasonal: "가을 대청소" }, expiresAt: iso(now + 6 * 86400e3) },
      { id: 12, title: "가을 이불 세탁, 건조기 없이 뽀송하게", angle: "베란다 건조 요령", channelHint: "naver_blog", score: 84, status: "candidate", factors: { volume: 18400, growthPct: 42, competition: "mid", intent: "info", seasonal: "환절기" }, expiresAt: iso(now + 6 * 86400e3) },
      { id: 13, title: "전기요금 아끼는 멀티탭, 대기전력 진짜 차이", angle: "한 달 실측", channelHint: "tistory", score: 79, status: "candidate", factors: { volume: 9800, competition: "low", intent: "commercial" }, expiresAt: iso(now + 5 * 86400e3) },
      { id: 14, title: "김장 전 준비물 체크리스트", angle: "20인분 기준", channelHint: "tistory", score: 76, status: "candidate", factors: { volume: 54000, growthPct: 120, competition: "high", intent: "info", seasonal: "김장철" }, expiresAt: iso(now + 6 * 86400e3) },
      { id: 15, title: "연말정산 미리 보기, 9월에 해 둘 것", angle: "맞벌이 기준", channelHint: "tistory", score: 70, status: "candidate", factors: { volume: 7200, growthPct: 8, competition: "mid", intent: "info" }, expiresAt: iso(now + 4 * 86400e3) },
      { id: 16, title: "아이 방 가습기 세척 주기", angle: "곰팡이 전 신호", channelHint: "naver_blog", score: 66, status: "candidate", factors: { intent: "info", competition: "low" }, expiresAt: iso(now + 6 * 86400e3) },
    ],
    briefs: {},
    pieces: fresh ? [] : [
      { id: 501, channel: "naver_blog", accountHandle: "cook_a", kind: "post", format: "story", title: "에어프라이어 청소법, 눌어붙은 기름 3분 컷", status: "in_review", stage: "done", scheduledFor: kst(1, 7, 30), coverUrl: "", gateOk: true, createdAt: iso(now - 3600e3), topicTitle: "에어프라이어 청소법", regenCount: 0, bodyHtml: BODY_NAVER, meta: { tags: ["에어프라이어청소", "베이킹소다"], disclosure: DISCLOSURE, affiliate: { provider: "coupang", url: "https://link.coupang.com/a/mock", subId: "piece501" } }, gate: gate(true) },
      { id: 502, channel: "tistory", accountHandle: "tips_b", kind: "post", format: "compare", title: "에어프라이어 청소, 3분 요약(비교표)", status: "in_review", stage: "done", scheduledFor: kst(1, 13, 0), gateOk: false, createdAt: iso(now - 3000e3), topicTitle: "에어프라이어 청소법", regenCount: 1, bodyHtml: BODY_TISTORY, meta: { tags: ["에어프라이어"], disclosure: null }, gate: gate(false) },
      { id: 503, channel: "naver_blog", accountHandle: "cook_a", kind: "post", format: "guide", title: "가을 이불 세탁, 이것만", status: "scheduled", stage: "done", scheduledFor: kst(2, 7, 30), gateOk: true, createdAt: iso(now - 86400e3), topicTitle: "가을 이불 세탁", regenCount: 0, bodyHtml: BODY_NAVER, meta: { tags: [], disclosure: null }, gate: gate(true) },
      { id: 504, channel: "tistory", accountHandle: "tips_b", kind: "post", format: "info", title: "전기요금 아끼는 콘센트", status: "published", stage: "done", publishedAt: iso(now - 2 * 86400e3), externalUrl: "https://tips-b.tistory.com/12", gateOk: true, createdAt: iso(now - 3 * 86400e3), topicTitle: "전기요금", regenCount: 0, bodyHtml: BODY_TISTORY, meta: { tags: [], disclosure: null }, gate: gate(true) },
      { id: 505, channel: "naver_blog", accountHandle: "cook_a", kind: "post", format: "story", title: "에어프라이어 청소, 눌어붙은 기름 3분 컷", status: "published", stage: "done", publishedAt: iso(now - 26 * 3600e3), externalUrl: "https://blog.naver.com/cook_a/223456789", gateOk: true, createdAt: iso(now - 3 * 86400e3), topicTitle: "에어프라이어 청소법", regenCount: 0, bodyHtml: BODY_NAVER, meta: { tags: ["에어프라이어청소"], disclosure: DISCLOSURE, affiliate: { provider: "coupang", url: "https://link.coupang.com/a/mock", subId: "piece505" } }, gate: gate(true) },
      { id: 506, channel: "naver_blog", accountHandle: "cook_a", kind: "post", format: "guide", title: "가을 이불 세탁, 건조기 없이 뽀송하게", status: "awaiting_manual", stage: "done", scheduledFor: iso(now - 4 * 3600e3), gateOk: true, createdAt: iso(now - 2 * 86400e3), topicTitle: "가을 이불 세탁", regenCount: 0, bodyHtml: BODY_NAVER, meta: { tags: ["이불세탁"], disclosure: null }, gate: gate(true) },
    ],
    rules: fresh ? [] : [
      { id: 1, channel: "naver_blog", kind: "post", accountMode: "auto", every: "week", count: 3, weekdays: [1, 3, 5], preferredHour: 7, active: true },
      { id: 2, channel: "tistory", kind: "post", accountMode: "fixed", accountId: 2, every: "week", count: 2, weekdays: [2, 4], preferredHour: 13, active: true },
    ],
    settings: { autoSchedule: !fresh, horizonDays: 14, topicLeadDays: 7, produceLeadDays: 3, produceHour: "06:00", reviewPolicy: "silence_approves", bestTimeMode: "auto", weeklyCoinCap: null, quietDays: [] },
    slots: [],
    /* ── [P1R2] 러너 기기(계약 §2) · 발행함(§6) · 재로그인 잡(§7.2) · 알림함 ── */
    devices: fresh ? [] : [{ id: 901, name: "집 PC", kind: "own", online: runnerOn, lastSeenAt: iso(now - 2 * 3600e3), version: "1.0.3", jobsWaiting: 2 }],
    posts: fresh ? [] : [
      { id: 701, pieceId: 504, channel: "tistory", accountHandle: "tips_b", title: "전기요금 아끼는 콘센트", externalUrl: "https://tips-b.tistory.com/12", publishedVia: "api", publishedAt: iso(now - 2 * 86400e3), status: "published", stats: { views: 1240, likes: 8, comments: 2, lastSyncAt: iso(now - 6 * 3600e3) }, alive: true },
      { id: 702, pieceId: 505, channel: "naver_blog", accountHandle: "cook_a", title: "에어프라이어 청소, 눌어붙은 기름 3분 컷", externalUrl: "https://blog.naver.com/cook_a/223456789", publishedVia: "runner", publishedAt: iso(now - 26 * 3600e3), status: "published", stats: { views: 318, likes: 21, lastSyncAt: iso(now - 3 * 3600e3) }, alive: true },
      { id: 703, pieceId: 506, channel: "naver_blog", accountHandle: "cook_a", title: "가을 이불 세탁, 건조기 없이 뽀송하게", status: "awaiting_manual", stats: {}, alive: false, errorKind: "selector_changed", failReason: "임시저장까지는 됐는데 발행 버튼을 찾지 못했어요" }, // [v2.1] publishedVia·publishedAt 없음(post 행이 없는 실패 행)
    ],
    reloginJobs: {},
    notifications: fresh ? [] : [
      { id: 801, kind: "reassign", title: "@life_c 계정이 정지됐어요", desc: "예약된 글 3건을 @cook_a 로 옮겼어요", link: "/app/accounts.html", tone: "warn", createdAt: iso(now - 5 * 3600e3) },
      { id: 802, kind: "publish", title: "글 1건이 올라가지 못했어요", desc: "«가을 이불 세탁» · 채널 화면이 바뀌었어요", link: "/app/posts.html", tone: "warn", createdAt: iso(now - 4 * 3600e3) },
      { id: 803, kind: "publish", title: "@cook_a 에 글이 올라갔어요", desc: "에어프라이어 청소, 눌어붙은 기름 3분 컷", link: "/app/posts.html", tone: "info", createdAt: iso(now - 26 * 3600e3), readAt: iso(now - 20 * 3600e3) },
    ],
    reassigned: fresh ? null : { fromHandle: "life_c", toHandle: "cook_a", moved: 3, at: iso(now - 5 * 3600e3) },
    topicsRefresh: null, // [v2.9] { startedAt, finishedAt?, added?, error? } — tenants.settings.topicsRefresh 자리
    /* ── [P1R3] 수익(계약 §1.4 · DESIGN §9) ── */
    revRows: revEmpty ? [] : revSeed(),          // revenue_daily 행 — 수집 못 한 날은 «행 자체가 없다»(AC-9)
    revSources: revEmpty ? [] : [
      { id: 1, source: "adsense", accountId: 2, method: "api", status: "connected", lastSyncAt: iso(now - 6 * 3600e3) },
      { id: 2, source: "adpost", accountId: 1, method: "runner", status: "connected", lastSyncAt: iso(now - 11 * 3600e3) },
      { id: 3, source: "coupang", accountId: 1, method: "api", status: "connected", lastSyncAt: iso(now - 3 * 3600e3) },
      { id: 4, source: "youtube", accountId: 4, method: "api", status: "not_configured" },
      { id: 5, source: "adfit", accountId: 2, method: "runner", status: "error", lastSyncAt: iso(now - 3 * 86400e3), lastError: "auth" },
    ],
    adState: revEmpty ? { adpost: {}, adsense: {}, ypp: {}, clip: {} } : { adpost: { 1: "none", 3: "approved" }, adsense: { 2: "none" }, ypp: {}, clip: {} },  // [v3.5] 소스별 × 계정별 신청 상태(«가입 완료했어요»로 바뀐다)
  });
  let S; try { S = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { S = null; }
  if (!S || fresh || qs.get("reset") === "1" || !S.posts || !S.revSources || !S.adState || !S.adState.adpost) { S = seed(); if (!fresh) { rollSlots(); scenarios(); } save(); } // posts 없음 = P1R1 시절 상태 → 새로 뿌린다
  if (qs.has("runner")) { for (const d of S.devices) d.online = runnerOn; save(); }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch { /* empty */ } }

  /* 슬롯 생성(규칙대로 · 멱등) — 계약 §5 slots.roll 모양 */
  function rollSlots() {
    const H = S.settings.horizonDays || 14;
    for (let d = 0; d < H; d++) {
      const date = ymd(d); const wd = new Date(date + "T00:00:00Z").getUTCDay();
      if ((S.settings.quietDays || []).includes(date)) continue;
      for (const r of S.rules) {
        const wds = r.weekdays && r.weekdays.length ? r.weekdays : [[], [3], [1, 4], [1, 3, 5], [1, 2, 4, 5], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6]][Math.min(7, r.every === "week" ? r.count : 7)]; // 요일 없으면 주 N회를 균등 분산(서버 slots.roll 흉내)
        if (!r.active || !wds.includes(wd)) continue;
        if (S.slots.some((s) => s.date === date && s.channel === r.channel && s.origin === "auto")) continue;
        const acc = r.accountMode === "fixed" ? S.accounts.find((a) => a.id === r.accountId) : S.accounts.find((a) => a.channel === r.channel && a.status === "active");
        const piece = d <= 2 ? S.pieces.find((p) => p.channel === r.channel && p.status !== "published" && !S.slots.some((s) => s.pieceId === p.id)) : null;
        const status = d === 0 && r.channel === "tistory" ? "published" : piece ? (piece.status === "in_review" ? "in_review" : "scheduled") : "planned";
        S.slots.push({ id: S.nextId++, date, channel: r.channel, kind: "post", accountId: acc?.id, accountHandle: acc?.handle, status, publishAt: kst(d, r.preferredHour || 9, 30), reviewDeadline: kst(d - 1, 21), topicTitle: piece?.title || (d < 7 ? S.topics[d % S.topics.length]?.title : undefined), pieceId: piece?.id, origin: "auto" });
      }
    }
  }
  /* [P1R2] 슬롯 상태기계(§5B.6) 전 상태를 화면에서 볼 수 있게 심는다 — 소재 없음·코인 부족·PC 대기·확인 필요 */
  function scenarios() {
    const free = S.slots.filter((s) => !s.pieceId && s.status === "planned").sort((a, b) => a.date.localeCompare(b.date));
    const nt = free.find((s) => s.date >= ymd(4)); if (nt) { nt.status = "no_topic"; delete nt.topicTitle; }
    const cs = free.find((s) => s.date >= ymd(5) && s !== nt); if (cs) { cs.status = "coin_short"; cs.topicTitle = cs.topicTitle || S.topics[2]?.title; }
    const ar = S.slots.find((s) => s.date === todayYmd && s.channel === "naver_blog");
    if (ar) { ar.status = "awaiting_runner"; ar.topicTitle = ar.topicTitle || S.topics[0]?.title; }
    // 오늘 «확인 필요» 한 건(발행함 703·piece 506 과 같은 글) — 없으면 만들어 둔다
    S.slots.push({ id: S.nextId++, date: todayYmd, channel: "naver_blog", kind: "post", accountId: 1, accountHandle: "cook_a", status: "awaiting_manual", publishAt: kst(0, 11, 0), topicTitle: "가을 이불 세탁, 건조기 없이 뽀송하게", pieceId: 506, origin: "auto" });
  }
  const coinsPerWeek = () => S.rules.filter((r) => r.active).reduce((a, r) => a + (r.every === "day" ? r.count * 7 : r.count) * (1 + (IMG[r.channel] || 2)), 0);
  const pieceRow = (p) => { const { bodyHtml, blocks, images, meta, gate, topicTitle, regenCount, ...row } = p; return row; };
  /* RunnerDevice 투영 — 없는 값은 키를 싣지 않는다(계약 §0) */
  const devRow = (d) => { const o = { id: d.id, name: d.name, kind: d.kind, status: d.online ? "online" : "offline", jobsWaiting: d.jobsWaiting || 0 };
    const seen = d.online ? iso(Date.now() - 21e3) : d.lastSeenAt; if (seen) o.lastSeenAt = seen; if (d.version) o.version = d.version; return o; };
  /* 재로그인 잡 — 4초 대기 → 10초 창 열림 → 완료(계정 active 승격) */
  const reloginJob = (accountId) => { const j = S.reloginJobs[accountId]; if (!j) return null; const age = Date.now() - j._t0;
    const status = age > 10000 ? "done" : age > 4000 ? "running" : "queued";
    if (status === "done") { const a = S.accounts.find((x) => x.id === accountId); if (a) { a.status = "active"; delete a.lastErrorKind; } }
    return { id: j.id, status, updatedAt: iso(Date.now()) }; };
  const bodyToBlocks = (p) => [{ type: "disclosure", text: p.meta.disclosure || "" }, { type: "hook", text: "주말에 에어프라이어를 열었더니…" }, { type: "toc", items: ["바스켓 담그기", "베이킹소다 반죽", "건조"] }, { type: "summary", text: "담그기 10분 · 베이킹소다 5분 · 건조 30분이면 끝나요." }, { type: "h2", text: "1. 바스켓은 물에 10분만 담가요" }, { type: "image", imageIndex: 0, caption: "10분 담가 둔 바스켓" }, { type: "checklist", items: ["바스켓 10분 담그기", "베이킹소다 반죽 5분"] }, p.channel === "tistory" ? { type: "adsense" } : { type: "affiliate", affiliate: { productName: "에어프라이어 세척솔 3종", url: "https://link.coupang.com/a/mock", price: 8900 } }, { type: "hashtags", items: p.meta.tags || [] }].filter((b) => b.type !== "disclosure" || b.text);
  const tick = () => { // 만드는 중 → 8초 후 draft → 16초 후 in_review
    for (const p of S.pieces) { if (!p._t0) continue; const age = Date.now() - p._t0; // [v1.1] stage: writing → images → checking → done
      if (age > 18000) { p.status = "in_review"; p.stage = "done"; p.gateOk = true; delete p._t0; } else if (age > 12000) { p.stage = "checking"; p.status = "draft"; } else if (age > 6000) p.stage = "images"; else p.stage = "writing"; }
    const KEEP = ["no_topic", "coin_short", "awaiting_runner", "awaiting_manual", "skipped"]; // 사람이 봐야 하는 상태는 piece 가 덮지 않는다
    for (const s of S.slots) { if (KEEP.includes(s.status)) continue; const p = S.pieces.find((x) => x.id === s.pieceId); if (p && (p.status === "in_review" || p.status === "scheduled" || p.status === "published")) s.status = p.status; }
    for (const d of S.devices) if (d._t0 && Date.now() - d._t0 > 8000) { d.online = true; d.version = d.version || "1.0.3"; delete d._t0; } // 등록 후 첫 하트비트
  };
  /* [v2.9] 소재 뽑기 배경 작업 흉내 — 2초 뒤 완료 · startedAt 10분 초과면 고아로 보고 running 해제(계약 §6D) */
  const isRefreshing = () => { const t = S.topicsRefresh; return !!(t && t.startedAt && !t.finishedAt && Date.now() - new Date(t.startedAt).getTime() < 600000); };
  const refreshTick = () => { const t = S.topicsRefresh; if (!t || !t.startedAt || t.finishedAt) return;
    if (Date.now() - new Date(t.startedAt).getTime() < (Number(qs.get("refreshMs")) || 2000)) return; // ?refreshMs= 로 오래 도는 경우도 본다
    if (qs.get("refreshFail") === "1") { t.finishedAt = iso(Date.now()); t.error = "지금은 소재를 뽑지 못했어요. 잠시 후 다시 해 주세요."; return; }
    const add = [{ id: S.nextId++, title: "환절기 아이 기침, 가습기보다 먼저 볼 것", angle: "소아과 다녀온 후기", channelHint: "naver_blog", score: 73, status: "candidate", factors: { volume: 12100, growthPct: 55, competition: "mid", intent: "info", seasonal: "환절기" }, expiresAt: iso(now + 6 * 86400e3) }, { id: S.nextId++, title: "다이소 수납 3천원 조합", angle: "서랍 한 칸 비포·애프터", channelHint: "naver_blog", score: 68, status: "candidate", factors: { volume: 26000, competition: "high", intent: "commercial" }, expiresAt: iso(now + 6 * 86400e3) }];
    S.topics.unshift(...add); t.finishedAt = iso(Date.now()); t.added = add.length; };
  /* ── [P1R3] 수익 집계 도우미 ── */
  const groupKrw = (rows, key) => { const m = new Map(); for (const r of rows) m.set(String(r[key]), (m.get(String(r[key])) || 0) + r.amountKrw); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const topBy = (rows) => { const m = new Map(); for (const r of rows) m.set(r.freshness, (m.get(r.freshness) || 0) + r.amountKrw); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "api"; };
  const srcFreshness = (source) => topBy(S.revRows.filter((r) => r.source === source));
  const dayFreshness = (day) => topBy(S.revRows.filter((r) => r.day === day));
  const prevMonth = (m) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1, 1)); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
  /* 하루치가 «확정»으로 내려오는 소스와, 오늘은 «부분 수집»뿐인 소스를 가른다(§9.3 확정/예상) */
  const CONFIRMED_SRC = ["adsense", "coupang", "aliexpress", "linkprice", "manual", "meta", "tiktok", "x", "sponsor"];
  const revSum = (f) => S.revRows.filter(f).reduce((a, r) => a + r.amountKrw, 0);
  const todayConfirmed = () => revSum((r) => r.day === todayYmd && CONFIRMED_SRC.includes(r.source));
  const todayEstimated = () => revSum((r) => r.day === todayYmd && !CONFIRMED_SRC.includes(r.source));
  /* [v3.1] home-summary.revenue — 새 키 4개 + 옛 키 3개 동거(화면은 새 키를 먼저 본다) */
  const revSummaryForHome = () => { const m = todayYmd.slice(0, 7); const monthKrw = revSum((r) => r.day.slice(0, 7) === m);
    return { todayConfirmedKrw: todayConfirmed(), todayEstimatedKrw: todayEstimated(), yesterdayKrw: revSum((r) => r.day === ymd(-1)), monthKrw,
      today: todayConfirmed(), month: monthKrw, lastMonthSameDay: revSum((r) => r.day.slice(0, 7) === prevMonth(m) && r.day.slice(8) <= todayYmd.slice(8)) }; };
  /* 조건 수치·신청 주소는 서버가 내려보낸다(계약 v3.1 §1.4b — 화면은 분모를 갖지 않는다) */
  const AD_THRESHOLDS = { adpost: { posts: 50, visitors: 300 }, ypp: { subs: 1000, views: 10000000 } };
  const AD_LINKS = { adpost: "https://adpost.naver.com/", adsense: "https://www.google.com/adsense/start/", ypp: "https://www.youtube.com/creators/how-things-work/monetization/", coupang: "https://partners.coupang.com/", clip: "https://creators.naver.com/" };
  const eligibility = () => S.accounts.filter((a) => a.status !== "disconnected").map((a) => {
    const o = { accountId: a.id, handle: a.handle, channel: a.channel };
    if (a.channel === "naver_blog") { const posts = a.id === 1 ? 38 : 61, visitors = a.id === 1 ? 214 : 520;
      o.adpost = { state: S.adState.adpost[a.id] || "none", posts, visitors, ready: posts >= AD_THRESHOLDS.adpost.posts && visitors >= AD_THRESHOLDS.adpost.visitors }; }
    if (["tistory", "blogger", "wordpress"].includes(a.channel)) o.adsense = { state: S.adState.adsense[a.id] || "none" }; // [v3.5]
    if (a.channel === "youtube_shorts") { const subs = 640, views = 2140000; o.ypp = { subs, views, ready: subs >= AD_THRESHOLDS.ypp.subs && views >= AD_THRESHOLDS.ypp.views }; }
    if (a.channel === "naver_clip") o.clip = { open: true, deadline: iso(now + 12 * 86400e3) };
    return o; });
  /* ?trial=N — 체험 D-N(0 이면 끝남 readonly) · 기본 9일 */
  const trialOf = () => { const d = qs.has("trial") ? Number(qs.get("trial")) : 9; return d <= 0 ? { status: "readonly", daysLeft: 0, planKey: "trial" } : { status: "trial", daysLeft: d, planKey: "trial" }; };
  const err = (step, error, extra = {}) => ({ ok: false, step, error, status: 400, ...extra });
  const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

  /* ── 라우트 ── */
  const R = {
    "auth-me": () => ({ ok: true, user: { id: 1, email: "mock@autocreate.dev", name: "모의 고객", role: "owner", emailVerified: true, mustChangePassword: false }, tenant: { id: 1, key: "mock", name: "모의", planKey: "trial", status: "trial", trialEndsAt: iso(now + 9 * 86400e3), trialDaysLeft: 9, settings: { autoSchedule: S.settings.autoSchedule } }, coins: S.coins, impersonation: null }),
    "auth-refresh": () => ({ ok: true }),
    "onboarding": (b) => { S.onboarding = { kinds: b.kinds || [], channels: b.channels || [] }; return { ok: true }; },
    "home-summary": () => { tick(); const review = S.pieces.filter((p) => p.status === "in_review").length; const todo = [];
      const online = S.devices.filter((d) => d.online).length;
      const RUNNER_CH = CHANNELS.filter((c) => c.publishVia === "runner").map((c) => c.key);
      const runnerDue = S.slots.filter((s) => RUNNER_CH.includes(s.channel) && s.date >= todayYmd && !["skipped", "published"].includes(s.status)).length;
      // 정지 계정은 아래 «승계» 한 줄로만 알린다(같은 사건을 두 줄로 쓰지 않는다)
      for (const a of S.accounts.filter((a) => ["pending_login", "disconnected"].includes(a.status)))
        todo.push({ kind: "account", title: a.status === "pending_login" ? `@${a.handle} 다시 로그인이 필요해요` : `@${a.handle} 연결이 끊겼어요`, desc: UI.chLabel(a.channel), link: "/app/accounts.html", tone: "warn" });
      if (!online && runnerDue) todo.push({ kind: "runner", title: "내 PC 프로그램이 꺼져 있어요", desc: `네이버·티스토리 예약 ${runnerDue}건은 이 프로그램이 올려요`, link: "/app/runner.html", tone: "warn" });
      const stuck = S.posts.filter((p) => p.status === "awaiting_manual" || p.status === "failed").length;
      if (stuck) todo.push({ kind: "publish", title: `글 ${stuck}건이 올라가지 못했어요`, desc: "직접 올리거나 다시 올려 주세요", link: "/app/posts.html", tone: "warn" });
      if (S.reassigned) todo.push({ kind: "reassign", title: `@${S.reassigned.fromHandle} 계정이 정지됐어요`, desc: `글 ${S.reassigned.moved}건을 @${S.reassigned.toHandle} 로 옮겼어요`, link: "/app/accounts.html", tone: "warn" });
      if (review) todo.push({ kind: "review", title: `봐주실 글 ${review}건이 있어요`, desc: "내일 나가기 전에 확인해 주세요", link: "/app/pieces.html", tone: "info" });
      if (!S.accounts.length) todo.push({ kind: "setup", title: "첫 계정을 연결해 보세요", desc: "네이버 블로그·티스토리·유튜브 중 하나면 돼요", link: "/app/accounts.html", tone: "info" });
      else if (!S.rules.length) todo.push({ kind: "setup", title: "자동 편성을 켜 보세요", desc: "규칙 하나면 한 달치가 알아서 나가요", link: "/app/schedule.html", tone: "info" });
      const todaySlots = S.slots.filter((s) => s.date === todayYmd).map((s) => { const o = { id: s.id, channel: s.channel, status: s.status, publishAt: s.publishAt, handle: s.accountHandle, title: s.topicTitle }; if (s.pieceId) o.pieceId = s.pieceId; return o; });
      return { ok: true, revenue: revSummaryForHome(), todaySlots, todo, notices: [], unread: S.notifications.filter((n) => !n.readAt).length, auto: { enabled: S.settings.autoSchedule, rules: S.rules.filter((r) => r.active).length }, runner: { online, total: S.devices.length }, trial: trialOf(), coins: S.coins, impersonation: null }; },
    "tenant-settings": (b) => { if (typeof b.autoSchedule === "boolean") S.settings.autoSchedule = b.autoSchedule; return { ok: true, settings: S.settings }; },
    "plans": () => ({ ok: true, plans: [], coins: { packs: [{ coins: 100, krw: 50000, bonusPct: 0 }, { coins: 220, krw: 100000, bonusPct: 10 }], table: { blog: 1, image: 1, cardnews: 3, video_15: 5, video_30: 8, video_60: 12, persona: 0 }, labels: { blog: "글 1편", image: "사진 1장", cardnews: "카드뉴스", video_15: "15초 영상", video_30: "30초 영상", video_60: "60초 영상", persona: "페르소나" } } }),
    /* §1 계정 */
    "accounts-list": () => ({ ok: true, accounts: S.accounts.map((a) => ({ ...a })), channels: CHANNELS }),
    "accounts-add": (b) => {
      if (/쿠팡|coupang/i.test(b.handle || "")) return err("handle_policy", "채널 이름에 «쿠팡»을 쓸 수 없어요(파트너스 정책).");
      if (S.accounts.length >= 5) return err("limit", "이 요금제에서는 계정을 5개까지 연결할 수 있어요.");
      if (S.accounts.some((a) => a.channel === b.channel && a.handle === b.handle)) return err("duplicate", "이미 연결한 계정이에요.");
      if (b.channel === "wordpress" && b.appPassword === "wrong") return err("wp_auth", "워드프레스 로그인 정보를 확인해 주세요.");
      if (["naver_blog", "tistory", "naver_clip"].includes(b.channel) && (!b.loginId || !b.password)) return err("creds", "아이디와 비밀번호를 입력해 주세요.");
      if (b.channel === "wordpress" && (!b.siteUrl || !b.loginId || !b.appPassword)) return err("creds", "사이트 주소·아이디·앱 비밀번호를 입력해 주세요.");
      const a = { id: S.nextId++, channel: b.channel, handle: b.handle, displayName: b.displayName || "", avatar: null, status: b.channel === "wordpress" ? "active" : "pending_login", healthScore: 100, postsToday: 0, dailyCap: 2, minGapMin: 180, goldenHours: [], browserProfileKey: "acc-" + S.nextId, hasCreds: true, monetize: { coupang: false, adpost: false, adsense: false } };
      S.accounts.push(a); return { ok: true, account: { ...a } }; },
    "accounts-remove": (b) => { S.accounts = S.accounts.filter((a) => a.id !== Number(b.id)); return { ok: true }; },
    "accounts-update": (b) => { const a = S.accounts.find((x) => x.id === Number(b.id)); if (!a) return err("not_found", "계정을 찾을 수 없어요.", { status: 404 });
      for (const k of ["displayName", "dailyCap", "minGapMin", "personaId", "goldenHours"]) if (b[k] !== undefined) a[k] = b[k];
      if (b.proxyUrl !== undefined) a.proxyUrl = b.proxyUrl ? b.proxyUrl.replace(/\/\/([^@]+)@/, "//****@") : undefined;
      if (b.monetize) { const m = b.monetize; if (m.coupangAccessKey && m.coupangSecretKey) a.monetize.coupang = true; if (m.adpostMediaId) a.monetize.adpost = true; if (m.adsensePub) a.monetize.adsense = true; }
      return { ok: true, account: { ...a } }; },
    "accounts-oauth-start": (b) => { const c = CHANNELS.find((x) => x.key === b.channel); if (!c || !c.configured) return err("provider_not_configured", "준비 중이에요"); return { ok: true, url: `/app/accounts.html?connected=${b.channel}&mock=1` }; },
    "personas-list": () => ({ ok: true, personas: S.personas }),
    "personas-save": (b) => { let p = S.personas.find((x) => x.id === Number(b.id)); if (p) Object.assign(p, { name: b.name, profile: b.profile }); else { p = { id: S.nextId++, name: b.name, profile: b.profile || {} }; S.personas.push(p); } return { ok: true, persona: p }; },
    /* §2 소재 — [v2.9] 뽑기는 배경 작업(POST 는 즉시 202 · 진행 상태는 topics-list.refresh 로 본다) */
    "topics-list": () => { refreshTick(); const t = S.topicsRefresh;
      const refresh = { running: isRefreshing() };
      if (t) { if (t.startedAt) refresh.startedAt = t.startedAt; if (t.finishedAt) refresh.finishedAt = t.finishedAt; if (t.added != null) refresh.added = t.added; if (t.error) refresh.error = t.error; }
      return { ok: true, topics: S.topics.filter((x) => x.status === "candidate"), refreshedAt: t?.finishedAt || iso(now - 7200e3), refresh }; },
    "topics-refresh": () => { refreshTick();
      if (isRefreshing()) return { ok: true, started: false, running: true };
      if (S.refreshCount >= 3) return err("rate_limit", "오늘은 세 번 다 뽑았어요. 내일 다시 뽑을 수 있어요.");
      S.refreshCount++; S.topicsRefresh = { startedAt: iso(Date.now()) };
      return { ok: true, started: true, status: 202 }; },
    "topics-pick": (b) => { const t = S.topics.find((x) => x.id === Number(b.id)); if (!t) return err("not_found", "소재를 찾을 수 없어요.", { status: 404 }); t.status = "picked"; return { ok: true, topic: t }; },
    "topics-skip": (b) => { const t = S.topics.find((x) => x.id === Number(b.id)); if (t) t.status = "expired"; return { ok: true }; },
    /* §3 디렉터 */
    "director-propose": (b) => { const t = S.topics.find((x) => x.id === Number(b.topicId)); if (!t) return err("not_found", "소재를 찾을 수 없어요.", { status: 404 });
      const pieces = []; const nv = S.accounts.find((a) => a.channel === "naver_blog"); const ts = S.accounts.find((a) => a.channel === "tistory");
      if (nv) pieces.push({ key: "p1", channel: "naver_blog", accountId: nv.id, accountHandle: nv.handle, format: "story", emotionKey: "warm", composition: "experience", lengthHint: { words: 1400 }, images: { count: 8, style: "photo", heroNeeded: true }, monetize: { affiliate: t.factors.intent !== "info" ? { provider: "coupang", productQuery: "에어프라이어 세척솔", slot: "end" } : null, adDisclosure: true }, schedule: { at: kst(1, 7, 30), slotReason: "네이버 블로그 아침 골든타임 · @" + nv.handle + " 오늘 0/" + nv.dailyCap }, coinCost: 9 });
      if (ts) pieces.push({ key: "p2", channel: "tistory", accountId: ts.id, accountHandle: ts.handle, format: "compare", emotionKey: "neutral", composition: "compare", angle: "비교표로 정리", lengthHint: { words: 1200 }, images: { count: 3, style: "infographic", heroNeeded: true }, monetize: { affiliate: null, adDisclosure: false }, schedule: { at: kst(1, 13, 0), slotReason: "티스토리 점심 검색 피크 · 애드센스 자리 2곳" }, coinCost: 4 });
      if (!pieces.length) pieces.push({ key: "p1", channel: "naver_blog", accountId: null, accountHandle: null, format: "story", emotionKey: "warm", composition: "experience", lengthHint: { words: 1400 }, images: { count: 6, style: "photo", heroNeeded: true }, monetize: { affiliate: null, adDisclosure: false }, schedule: { at: kst(1, 7, 30), slotReason: "네이버 블로그 아침 골든타임 · 계정은 연결 후 배정" }, coinCost: 7 });
      const brief = { id: S.nextId++, topicId: t.id, goal: "mixed", mode: "reviewed", coinCost: pieces.reduce((a, p) => a + p.coinCost, 0), coinsLeft: S.coins, reasons: ["검색량 " + UI.num(t.factors.volume || 0) + "에 경쟁이 낮아 경험담이 먼저 노출돼요", "같은 소재를 계정마다 다른 구성(경험담·비교표)으로 갈라 유사도 게이트를 지켜요", "쓰는 코인은 글 1 + 사진 수예요 · 다시 만들기는 무료"], pieces };
      S.briefs[brief.id] = brief; return { ok: true, brief }; },
    "director-confirm": (b) => { const br = S.briefs[b.briefId]; if (!br) return err("not_found", "제안을 찾을 수 없어요.", { status: 404 });
      let pieces = br.pieces.map((p) => ({ ...p })); for (const patch of b.pieces || []) { const i = pieces.findIndex((p) => p.key === patch.key); if (i < 0) continue; if (patch.drop) { pieces.splice(i, 1); continue; }
        const p = pieces[i]; if (patch.accountId !== undefined) { p.accountId = patch.accountId; p.accountHandle = S.accounts.find((a) => a.id === patch.accountId)?.handle || null; } if (patch.format) p.format = patch.format; if (patch.emotionKey) p.emotionKey = patch.emotionKey;
        if (patch.images) Object.assign(p.images, patch.images); if (patch.monetize && "affiliate" in patch.monetize) p.monetize.affiliate = patch.monetize.affiliate ? { provider: "coupang", ...patch.monetize.affiliate } : null; if (patch.schedule?.at) p.schedule.at = patch.schedule.at; p.coinCost = 1 + p.images.count; }
      const need = pieces.reduce((a, p) => a + p.coinCost, 0); if (need > S.coins) return err("coin_short", `코인이 ${need - S.coins}개 부족해요.`, { need, have: S.coins });
      if (br._charged) return { ok: true, briefId: br.id, pieceIds: br._pieceIds, coinsCharged: 0, coinsLeft: S.coins, status: 202 };
      S.coins -= need; const ids = []; const t = S.topics.find((x) => x.id === br.topicId);
      for (const p of pieces) { const id = S.nextId++; ids.push(id); S.pieces.push({ id, channel: p.channel, accountHandle: p.accountHandle, kind: "post", format: p.format, title: t?.title || "새 글", status: "generating", stage: "writing", scheduledFor: p.schedule.at, gateOk: false, createdAt: iso(Date.now()), topicTitle: t?.title, regenCount: 0, bodyHtml: p.channel === "tistory" ? BODY_TISTORY : BODY_NAVER, meta: { tags: ["에어프라이어청소"], disclosure: p.monetize.affiliate ? DISCLOSURE : null, affiliate: p.monetize.affiliate ? { provider: "coupang", url: "https://link.coupang.com/a/mock", subId: "piece" + id } : undefined }, gate: gate(true), _t0: Date.now() });
        S.slots.push({ id: S.nextId++, date: p.schedule.at ? new Date(new Date(p.schedule.at).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : todayYmd, channel: p.channel, kind: "post", accountId: p.accountId, accountHandle: p.accountHandle, status: "producing", publishAt: p.schedule.at, topicTitle: t?.title, pieceId: id, origin: "manual" }); }
      if (t) t.status = "picked"; br._charged = true; br._pieceIds = ids; return { ok: true, briefId: br.id, pieceIds: ids, coinsCharged: need, coinsLeft: S.coins, status: 202 }; },
    /* §4 글 */
    "pieces-list": (_b, q) => { tick(); const st = q.get("status") || "all"; const list = S.pieces.filter((p) => st === "all" || p.status === st || (st === "generating" && p.status === "draft")); return { ok: true, pieces: list.map(pieceRow).sort((a, b) => b.id - a.id) }; },
    "pieces-get": (_b, q) => { tick(); const p = S.pieces.find((x) => x.id === Number(q.get("id"))); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 }); const withDisc = (h) => { const clean = h.replace(/^\s*<div class="disclosure">[\s\S]*?<\/div>\s*/, ""); return p.meta.disclosure ? `<div class="disclosure">${p.meta.disclosure}</div>
${clean}` : clean; }; // 고지 = bodyHtml 첫 요소(발행물 정본) · meta.disclosure 는 미러
      return { ok: true, piece: { ...pieceRow(p), bodyHtml: withDisc(p.bodyHtml), blocks: bodyToBlocks(p), images: [{ url: "", caption: "10분 담가 둔 바스켓", sort: 0 }], meta: p.meta, gate: p.gate, topicTitle: p.topicTitle, regenCount: p.regenCount } }; },
    "pieces-approve": (b) => { const p = S.pieces.find((x) => x.id === Number(b.id)); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 }); if (!p.gateOk) return err("gate", "발행 전 확인이 필요해요.", { gate: p.gate }); p.status = "scheduled"; tick(); return { ok: true, status: "scheduled", scheduledFor: p.scheduledFor }; },
    "pieces-reject": (b) => { const p = S.pieces.find((x) => x.id === Number(b.id)); if (p) p.status = "rejected"; return { ok: true, status: "rejected" }; },
    "pieces-regenerate": (b) => { const p = S.pieces.find((x) => x.id === Number(b.id)); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 }); if (p.regenCount >= 1) return err("regen_limit", "다시 만들기는 한 번만 할 수 있어요."); p.regenCount++; p.status = "generating"; p.stage = "writing"; p._t0 = Date.now(); return { ok: true, status: "generating" }; },
    "pieces-update": (b) => { const p = S.pieces.find((x) => x.id === Number(b.id)); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 }); if (b.title) p.title = b.title; if (b.bodyHtml) p.bodyHtml = b.bodyHtml.replace(/^\s*<div class="disclosure">[\s\S]*?<\/div>\s*/, ""); p.gate = gate(true); p.gateOk = true;
      const body = p.meta.disclosure ? `<div class="disclosure">${p.meta.disclosure}</div>
${p.bodyHtml}` : p.bodyHtml; return { ok: true, gate: p.gate, bodyHtml: body }; },
    /* §5 규칙·슬롯 */
    "rules-list": () => ({ ok: true, rules: S.rules, settings: S.settings, coinsPerWeek: coinsPerWeek(), maxRules: 3 }),
    "rules-save": (b) => { if ((b.rules || []).filter((r) => r.active !== false).length > 3) return err("limit", "이 요금제에서는 규칙을 3개까지 만들 수 있어요."); const before = S.slots.length; S.rules = (b.rules || []).map((r, i) => ({ id: r.id || S.nextId++, kind: "post", active: true, ...r })); S.slots = S.slots.filter((s) => s.origin === "manual" || S.rules.some((r) => r.channel === s.channel)); rollSlots(); return { ok: true, rules: S.rules, coinsPerWeek: coinsPerWeek(), slotsCreated: S.slots.length - before }; },
    "rules-settings": (b) => { for (const k of ["autoSchedule", "horizonDays", "topicLeadDays", "produceLeadDays", "produceHour", "reviewPolicy", "bestTimeMode", "weeklyCoinCap", "quietDays"]) if (b[k] !== undefined) S.settings[k] = b[k]; S.slots = S.slots.filter((s) => s.origin === "manual" || !(S.settings.quietDays || []).includes(s.date)); rollSlots(); return { ok: true, settings: S.settings }; },
    "slots-list": (_b, q) => { tick(); const from = q.get("from") || "0000", to = q.get("to") || "9999"; return { ok: true, slots: S.slots.filter((s) => s.date >= from && s.date <= to).sort((a, b) => (a.publishAt || "").localeCompare(b.publishAt || "")) }; },
    "slots-skip": (b) => { const s = S.slots.find((x) => x.id === Number(b.id)); if (s) s.status = "skipped"; return { ok: true }; },
    /* ── [P1R2] §6 슬롯 3동작 ── */
    "slots-assign-topic": (b) => { tick(); const s = S.slots.find((x) => x.id === Number(b.slotId)); if (!s) return err("not_found", "편성을 찾을 수 없어요.", { status: 404 });
      const t = S.topics.find((x) => x.id === Number(b.topicId)); if (!t) return err("not_found", "소재를 찾을 수 없어요.", { status: 404 });
      if (s.pieceId) return err("stage", "이미 글을 만들기 시작해서 소재를 바꿀 수 없어요.");
      if (S.slots.some((x) => x !== s && x.topicTitle === t.title && x.date >= ymd(-30))) return err("duplicate", "최근 30일 안에 같은 소재로 나간 편성이 있어요.");
      s.topicTitle = t.title; s.status = "topic_assigned"; t.status = "picked"; return { ok: true, slot: { ...s } }; },
    "slots-reschedule": (b) => { tick(); const s = S.slots.find((x) => x.id === Number(b.slotId)); if (!s) return err("not_found", "편성을 찾을 수 없어요.", { status: 404 });
      if (!b.at) return err("at", "시각을 골라 주세요.");
      if (["published", "publishing", "skipped"].includes(s.status)) return err("stage", "이미 나간 편성은 시각을 바꿀 수 없어요.");
      const at = new Date(b.at).getTime();
      const clash = S.slots.find((x) => x !== s && x.channel === s.channel && x.status !== "skipped" && x.publishAt && Math.abs(new Date(x.publishAt).getTime() - at) < 30 * 60e3);
      if (clash) return err("cadence", `같은 채널 글이 ${UI.timeKST(clash.publishAt)} 에 나가요. 30분 이상 떨어뜨려 주세요.`);
      s.publishAt = b.at; s.date = new Date(at + 9 * 3600e3).toISOString().slice(0, 10); return { ok: true, slot: { ...s } }; },
    "slots-produce-now": (b) => { tick(); const s = S.slots.find((x) => x.id === Number(b.slotId)); if (!s) return err("not_found", "편성을 찾을 수 없어요.", { status: 404 });
      if (!s.topicTitle) return err("no_topic", "먼저 소재를 정해 주세요.");
      if (s.pieceId) return err("exists", "이 편성은 이미 글이 있어요.");
      const need = 1 + (IMG[s.channel] ?? 2); if (need > S.coins) return err("coin_short", `코인이 ${need - S.coins}개 부족해요.`, { need, have: S.coins });
      S.coins -= need; const id = S.nextId++;
      S.pieces.push({ id, channel: s.channel, accountHandle: s.accountHandle, kind: "post", format: "story", title: s.topicTitle, status: "generating", stage: "writing", scheduledFor: s.publishAt, gateOk: false, createdAt: iso(Date.now()), topicTitle: s.topicTitle, regenCount: 0, bodyHtml: s.channel === "tistory" ? BODY_TISTORY : BODY_NAVER, meta: { tags: [], disclosure: null }, gate: gate(true), _t0: Date.now() });
      s.pieceId = id; s.status = "producing"; return { ok: true, pieceId: id }; },
    /* ── [P1R2] §6 발행함 ── */
    "posts-list": (_b, q) => { const from = q.get("from") || "0000", to = q.get("to") || "9999", st = q.get("status") || "all";
      const day = (p) => p.publishedAt ? new Date(new Date(p.publishedAt).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : null;
      return { ok: true, posts: S.posts.filter((p) => { const d = day(p); return (d === null || (d >= from && d <= to)) && (st === "all" || p.status === st); }).sort((a, b) => (b.publishedAt || "9999").localeCompare(a.publishedAt || "9999")).map((p) => ({ ...p })) }; },
    /* ── [P1R2] §2 러너 기기(내 PC 프로그램) ── */
    "runner-list": () => { tick(); return { ok: true, devices: S.devices.map(devRow) }; },
    "runner-register": (b) => { const name = String(b.name || "").trim(); if (!name) return err("name", "기기 이름을 적어 주세요.");
      if (S.devices.length >= 3) return err("limit", "이 요금제에서는 기기를 3대까지 연결할 수 있어요.");
      const token = "acr_" + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
      const d = { id: S.nextId++, name, kind: b.kind || "own", online: false, jobsWaiting: 0, _t0: Date.now() }; S.devices.push(d);
      return { ok: true, device: { id: d.id, name: d.name, token }, install: { url: "https://autocreate-endyd.netlify.app/runner/ac-runner.zip", cmd: `npx ac-runner --token ${token}` } }; },
    "runner-remove": (b) => { S.devices = S.devices.filter((d) => d.id !== Number(b.id)); return { ok: true }; },
    /* ── [P1R2] §7.2 계정 다시 로그인(POST=요청 · GET=폴링) ── */
    "accounts-relogin": (b, q) => { tick(); const id = Number(b.id || q.get("id")); const a = S.accounts.find((x) => x.id === id);
      if (!a) return err("not_found", "계정을 찾을 수 없어요.", { status: 404 });
      if (b.id) { if (!S.devices.some((d) => d.online)) return err("runner_offline", "먼저 내 PC 프로그램을 켜 주세요.");
        S.reloginJobs[id] = { id: S.nextId++, _t0: Date.now() }; return { ok: true, job: reloginJob(id) }; }
      const job = reloginJob(id); return job ? { ok: true, job, account: { ...a } } : { ok: true, job: null, account: { ...a } }; },
    /* ── [P1R2] 알림함 ── */
    "notifications-list": () => ({ ok: true, notifications: S.notifications.map((n) => ({ ...n })).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")), unread: S.notifications.filter((n) => !n.readAt).length }),
    "notifications-read": (b) => { for (const n of S.notifications) if (!b.id || n.id === Number(b.id)) n.readAt = n.readAt || iso(Date.now()); return { ok: true, unread: S.notifications.filter((n) => !n.readAt).length }; },
    /* ── [P1R3] §1.4 수익 ── */
    "revenue-summary": (_b, q) => {
      const month = q.get("month") || todayYmd.slice(0, 7);
      const inM = (r, m) => r.day.slice(0, 7) === m;
      const sum = (rs) => rs.reduce((a, r) => a + r.amountKrw, 0);
      const mine = S.revRows.filter((r) => inM(r, month));
      const bySource = groupKrw(mine, "source").map(([source, krw]) => { const s = S.revSources.find((x) => x.source === source);
        const o = { source, krw, freshness: srcFreshness(source) }; if (s?.lastSyncAt) o.lastSyncAt = s.lastSyncAt; return o; });
      const byAccount = groupKrw(mine.filter((r) => r.accountId), "accountId").map(([id, krw]) => { const a = S.accounts.find((x) => x.id === Number(id)) || {};
        return { accountId: Number(id), handle: a.handle || "", channel: a.channel || "", krw }; });
      const topPieces = groupKrw(mine.filter((r) => r.pieceId), "pieceId").slice(0, 5).map(([id, krw]) => { const p = S.pieces.find((x) => x.id === Number(id)) || {};
        return { pieceId: Number(id), title: p.title || "제목 없음", channel: p.channel || "naver_blog", krw }; });
      return { ok: true, monthKrw: sum(mine), todayConfirmedKrw: todayConfirmed(), todayEstimatedKrw: todayEstimated(),
        prevMonthKrw: sum(S.revRows.filter((r) => inM(r, prevMonth(month)))), bySource, byAccount, topPieces }; },
    "revenue-daily": (_b, q) => { const from = q.get("from") || "0000", to = q.get("to") || "9999";
      const days = groupKrw(S.revRows.filter((r) => r.day >= from && r.day <= to), "day").sort((a, b) => a[0].localeCompare(b[0]));
      return { ok: true, days: days.map(([day, krw]) => ({ day, krw, freshness: dayFreshness(day) })) }; },
    "revenue-sources": (b) => {
      if (b && b.action) {
        const s = S.revSources.find((x) => x.source === b.source && (b.accountId == null || x.accountId === Number(b.accountId)));
        if (b.action === "disconnect") { if (s) { s.status = "disconnected"; delete s.lastError; } return { ok: true }; }
        if (b.action === "connect") { // [v3.5] 구글 동의 진입점 — 유튜브 앱 키는 아직 없다고 두어 «준비가 아직이에요» 경로도 보이게
          if (b.source === "youtube") return { ok: false, step: "provider_not_configured", error: "준비가 아직이에요", status: 503 };
          if (s) { s.status = "connected"; s.lastSyncAt = iso(Date.now()); delete s.lastError; } else S.revSources.push({ id: S.nextId++, source: b.source, accountId: b.accountId ? Number(b.accountId) : undefined, method: "api", status: "connected", lastSyncAt: iso(Date.now()) });
          return { ok: true, url: `/app/ad-media.html?connected=${b.source}&mock=1` }; }
        if (b.action === "key") { const need = { coupang: ["accessKey", "secretKey"], aliexpress: ["appKey", "appSecret"], linkprice: ["affiliateId", "authKey"] }[b.source] || ["key"];
          const creds = b.creds || (b.key ? { key: b.key } : {}); const miss = need.find((k) => !String(creds[k] || "").trim()); if (miss) return err("key", `키를 모두 넣어 주세요(${miss})`); }
        if (s) { s.status = "connected"; s.lastSyncAt = iso(Date.now()); delete s.lastError; }
        else S.revSources.push({ id: S.nextId++, source: b.source, accountId: b.accountId ? Number(b.accountId) : undefined, method: b.action === "key" ? "api" : "api", status: "connected", lastSyncAt: iso(Date.now()) });
        return { ok: true };
      }
      return { ok: true, sources: S.revSources.map((s) => { const o = { id: s.id, source: s.source, method: s.method, status: revError === s.source ? "error" : s.status };
        if (s.accountId) o.accountId = s.accountId; if (s.lastSyncAt) o.lastSyncAt = s.lastSyncAt;
        const le = revError === s.source ? "auth" : s.lastError; if (le) o.lastError = le; return o; }) }; },
    "revenue-manual": (b) => {
      if (!b.source) return err("source", "어디서 번 돈인지 골라 주세요.");
      if (!/^\d{4}-\d\d-\d\d$/.test(b.day || "")) return err("day", "날짜를 골라 주세요.");
      if (b.day > todayYmd) return err("day", "오늘보다 뒤 날짜는 넣을 수 없어요.");
      const krw = Number(b.amountKrw); if (!Number.isFinite(krw) || krw <= 0) return err("amountKrw", "금액을 숫자로 넣어 주세요.");
      const row = { day: b.day, source: b.source, amountKrw: Math.round(krw), freshness: "manual" };
      if (b.accountId) row.accountId = Number(b.accountId); if (b.pieceId) row.pieceId = Number(b.pieceId);
      const same = S.revRows.find((r) => r.day === row.day && r.source === row.source && r.accountId === row.accountId && r.pieceId === row.pieceId);
      if (same) same.amountKrw = row.amountKrw; else S.revRows.push(row);   // 멱등 — 같은 (소스·계정·글·날) 은 1행
      return { ok: true }; },
    /* ── [P1R3] §1.5 신청 조건 ── */
    "ad-eligibility": (b) => {
      if (b && b.action) { const id = Number(b.accountId); if (!id) return err("accountId", "계정을 골라 주세요.");
        const src = ["adpost", "ypp", "adsense", "clip"].includes(b.source) ? b.source : null; if (!src) return err("source", "어느 매체인지 골라 주세요.");
        S.adState[src][id] = b.action === "approved" ? "approved" : "pending"; return { ok: true, accounts: eligibility() }; }
      return { ok: true, thresholds: AD_THRESHOLDS, links: AD_LINKS, accounts: eligibility() }; },
    /* §6 코인 */
    "coins-balance": () => ({ ok: true, balance: S.coins, included: S.coins, purchased: 0, recent: [{ kind: "grant", delta: 30, reason: "운영 지급", createdAt: iso(now - 86400e3) }] }),
  };

  const real = UI.api;
  UI.api = async function (path, opts = {}) {
    const u = new URL(path, location.origin); const name = u.pathname.replace(/^\/api\//, "");
    const h = R[name]; if (!h) return real(path, opts);
    await delay(); const r = h(opts.body || {}, u.searchParams); save();
    const status = r.status || 200; return { ...r, status, ok: !!r.ok };
  };
  /* 링크·이동에 mock=1 이어 붙이기 */
  const KEEP = ["runner", "refreshMs", "refreshFail", "revEmpty", "revError", "trial"]; // 모의 전용 손잡이는 화면 왕복 중에도 유지(fresh·reset 은 일부러 제외)
  const withMock = (href) => { try { const u = new URL(href, location.origin); if (u.origin !== location.origin || !u.pathname.startsWith("/app/")) return href; u.searchParams.set("mock", "1"); for (const k of KEEP) if (qs.has(k)) u.searchParams.set(k, qs.get(k)); return u.pathname + u.search + u.hash; } catch { return href; } };
  UI.go = (href) => location.assign(withMock(href));
  document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("a[href]"); if (!a) return; const h = a.getAttribute("href"); if (!h || h.startsWith("javascript:") || h.startsWith("#")) return; const m = withMock(h); if (m !== h) a.setAttribute("href", m); }, true);
  const badge = document.createElement("div"); badge.textContent = "모의 데이터"; badge.style.cssText = "position:fixed;bottom:calc(var(--tab-h) + 6px);left:8px;z-index:99;font-size:10px;font-weight:700;color:var(--muted);background:var(--press);border-radius:6px;padding:2px 6px;pointer-events:none"; document.body.appendChild(badge);
})();
