/* mock.js — P1R1 계약(docs/active/2026-09-14-P1R1-contract.md)의 모양대로 가짜 응답을 돌려주는 개발용 층.
   🔴 `location.search` 에 `mock=1` 이 없으면 즉시 return — 운영 코드 무접촉. 키 이름은 계약서 글자 그대로.
   상태는 sessionStorage(acMockState)에 남겨 화면 왕복 중 유지 · `?mock=1&fresh=1` 이면 빈 상태(계정 0·규칙 0)로 초기화.
   내부 링크 클릭·UI.go 는 mock=1 을 이어 붙인다(전 화면 왕복용). */
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
    ["naver_blog", "네이버 블로그", "text", "runner", "session", true], ["tistory", "티스토리", "text", "runner", "session", true], ["blogger", "블로거", "text", "api", "oauth", false],
    ["wordpress", "워드프레스", "text", "api", "app_password", true], ["threads", "쓰레드", "text", "api", "oauth", true], ["instagram", "인스타그램", "video", "api", "oauth", false],
    ["youtube_shorts", "유튜브 쇼츠", "video", "api", "oauth", false], ["naver_clip", "네이버 클립", "video", "runner", "session", true], ["reels", "릴스", "video", "api", "oauth", false], ["tiktok", "틱톡", "video", "api", "oauth", false],
  ].map(([key, label, category, publishVia, connectMethod, configured]) => ({ key, label, category, publishVia, status: "active", connectMethod, configured }));

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
  const seed = () => ({
    coins: 30, refreshCount: 0, autoSchedule: false, nextId: 100,
    accounts: fresh ? [] : [
      { id: 1, channel: "naver_blog", handle: "cook_a", displayName: "요리하는 A", avatar: null, status: "active", healthScore: 100, postsToday: 0, dailyCap: 2, minGapMin: 180, goldenHours: [7, 21], lastPostAt: iso(now - 26 * 3600e3), personaId: 1, browserProfileKey: "acc-1", hasCreds: true, monetize: { coupang: true, adpost: true, adsense: false } },
      { id: 2, channel: "tistory", handle: "tips_b", displayName: "", avatar: null, status: "pending_login", healthScore: 100, postsToday: 0, dailyCap: 1, minGapMin: 360, goldenHours: [12], lastErrorKind: "login_fail", browserProfileKey: "acc-2", hasCreds: true, monetize: { coupang: false, adpost: false, adsense: true } },
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
    ],
    rules: fresh ? [] : [
      { id: 1, channel: "naver_blog", kind: "post", accountMode: "auto", every: "week", count: 3, weekdays: [1, 3, 5], preferredHour: 7, active: true },
      { id: 2, channel: "tistory", kind: "post", accountMode: "fixed", accountId: 2, every: "week", count: 2, weekdays: [2, 4], preferredHour: 13, active: true },
    ],
    settings: { autoSchedule: !fresh, horizonDays: 14, topicLeadDays: 7, produceLeadDays: 3, produceHour: "06:00", reviewPolicy: "silence_approves", bestTimeMode: "auto", weeklyCoinCap: null, quietDays: [] },
    slots: [],
  });
  let S; try { S = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { S = null; }
  if (!S || fresh || qs.get("reset") === "1") { S = seed(); if (!fresh) rollSlots(); save(); }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch { /* empty */ } }

  /* 슬롯 생성(규칙대로 · 멱등) — 계약 §5 slots.roll 모양 */
  function rollSlots() {
    const H = S.settings.horizonDays || 14;
    for (let d = 0; d < H; d++) {
      const date = ymd(d); const wd = new Date(date + "T00:00:00Z").getUTCDay();
      if ((S.settings.quietDays || []).includes(date)) continue;
      for (const r of S.rules) {
        if (!r.active || !(r.weekdays || []).includes(wd)) continue;
        if (S.slots.some((s) => s.date === date && s.channel === r.channel && s.origin === "auto")) continue;
        const acc = r.accountMode === "fixed" ? S.accounts.find((a) => a.id === r.accountId) : S.accounts.find((a) => a.channel === r.channel && a.status === "active");
        const piece = d <= 2 ? S.pieces.find((p) => p.channel === r.channel && p.status !== "published" && !S.slots.some((s) => s.pieceId === p.id)) : null;
        const status = d === 0 && r.channel === "tistory" ? "published" : piece ? (piece.status === "in_review" ? "in_review" : "scheduled") : "planned";
        S.slots.push({ id: S.nextId++, date, channel: r.channel, kind: "post", accountId: acc?.id, accountHandle: acc?.handle, status, publishAt: kst(d, r.preferredHour || 9, 30), reviewDeadline: kst(d - 1, 21), topicTitle: piece?.title || (d < 7 ? S.topics[d % S.topics.length]?.title : undefined), pieceId: piece?.id, origin: "auto" });
      }
    }
  }
  const coinsPerWeek = () => S.rules.filter((r) => r.active).reduce((a, r) => a + (r.every === "day" ? r.count * 7 : r.count) * (1 + ({ naver_blog: 6, tistory: 3, blogger: 2, wordpress: 2, threads: 1 }[r.channel] || 2)), 0);
  const pieceRow = (p) => { const { bodyHtml, blocks, images, meta, gate, topicTitle, regenCount, ...row } = p; return row; };
  const bodyToBlocks = (p) => [{ type: "disclosure", text: p.meta.disclosure || "" }, { type: "hook", text: "주말에 에어프라이어를 열었더니…" }, { type: "toc", items: ["바스켓 담그기", "베이킹소다 반죽", "건조"] }, { type: "summary", text: "담그기 10분 · 베이킹소다 5분 · 건조 30분이면 끝나요." }, { type: "h2", text: "1. 바스켓은 물에 10분만 담가요" }, { type: "image", imageIndex: 0, caption: "10분 담가 둔 바스켓" }, { type: "checklist", items: ["바스켓 10분 담그기", "베이킹소다 반죽 5분"] }, p.channel === "tistory" ? { type: "adsense" } : { type: "affiliate", affiliate: { productName: "에어프라이어 세척솔 3종", url: "https://link.coupang.com/a/mock", price: 8900 } }, { type: "hashtags", items: p.meta.tags || [] }].filter((b) => b.type !== "disclosure" || b.text);
  const tick = () => { // 만드는 중 → 8초 후 draft → 16초 후 in_review
    for (const p of S.pieces) { if (!p._t0) continue; const age = Date.now() - p._t0; // [v1.1] stage: writing → images → checking → done
      if (age > 18000) { p.status = "in_review"; p.stage = "done"; p.gateOk = true; delete p._t0; } else if (age > 12000) { p.stage = "checking"; p.status = "draft"; } else if (age > 6000) p.stage = "images"; else p.stage = "writing"; }
    for (const s of S.slots) { const p = S.pieces.find((x) => x.id === s.pieceId); if (p && (p.status === "in_review" || p.status === "scheduled" || p.status === "published")) s.status = p.status; }
  };
  const err = (step, error, extra = {}) => ({ ok: false, step, error, status: 400, ...extra });
  const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

  /* ── 라우트 ── */
  const R = {
    "auth-me": () => ({ ok: true, user: { id: 1, email: "mock@autocreate.dev", name: "모의 고객", role: "owner", emailVerified: true, mustChangePassword: false }, tenant: { id: 1, key: "mock", name: "모의", planKey: "trial", status: "trial", trialEndsAt: iso(now + 9 * 86400e3), trialDaysLeft: 9, settings: { autoSchedule: S.settings.autoSchedule } }, coins: S.coins, impersonation: null }),
    "auth-refresh": () => ({ ok: true }),
    "home-summary": () => { tick(); const review = S.pieces.filter((p) => p.status === "in_review").length; const todo = [];
      for (const a of S.accounts.filter((a) => ["pending_login", "suspended", "disconnected"].includes(a.status))) todo.push({ kind: "account", title: `@${a.handle} 다시 연결이 필요해요`, desc: UI.chLabel(a.channel), link: "/app/accounts.html", tone: "warn" });
      if (review) todo.push({ kind: "review", title: `봐주실 글 ${review}건이 있어요`, desc: "내일 나가기 전에 확인해 주세요", link: "/app/schedule.html", tone: "info" });
      if (!S.accounts.length) todo.push({ kind: "setup", title: "첫 계정을 연결해 보세요", desc: "네이버 블로그·티스토리·유튜브 중 하나면 돼요", link: "/app/accounts.html", tone: "info" });
      else if (!S.rules.length) todo.push({ kind: "setup", title: "자동 편성을 켜 보세요", desc: "규칙 하나면 한 달치가 알아서 나가요", link: "/app/schedule.html", tone: "info" });
      const todaySlots = S.slots.filter((s) => s.date === todayYmd).map((s) => ({ id: s.id, channel: s.channel, status: s.status, publishAt: s.publishAt, handle: s.accountHandle, title: s.topicTitle }));
      return { ok: true, revenue: { today: 12400, month: 284100, lastMonthSameDay: 216800 }, todaySlots, todo, notices: [], unread: 0, auto: { enabled: S.settings.autoSchedule, rules: S.rules.filter((r) => r.active).length }, runner: { online: 0, total: 0 }, trial: { status: "trial", daysLeft: 9, planKey: "trial" }, coins: S.coins, impersonation: null }; },
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
    /* §2 소재 */
    "topics-list": () => ({ ok: true, topics: S.topics.filter((t) => t.status === "candidate"), refreshedAt: iso(now - 7200e3) }),
    "topics-refresh": () => { if (S.refreshCount >= 3) return err("rate_limit", "오늘은 세 번 다 뽑았어요. 내일 다시 뽑을 수 있어요."); S.refreshCount++;
      const add = [{ id: S.nextId++, title: "환절기 아이 기침, 가습기보다 먼저 볼 것", angle: "소아과 다녀온 후기", channelHint: "naver_blog", score: 73, status: "candidate", factors: { volume: 12100, growthPct: 55, competition: "mid", intent: "info", seasonal: "환절기" }, expiresAt: iso(now + 6 * 86400e3) }, { id: S.nextId++, title: "다이소 수납 3천원 조합", angle: "서랍 한 칸 비포·애프터", channelHint: "naver_blog", score: 68, status: "candidate", factors: { volume: 26000, competition: "high", intent: "commercial" }, expiresAt: iso(now + 6 * 86400e3) }];
      S.topics.unshift(...add); return { ok: true, added: add.length, topics: S.topics.filter((t) => t.status === "candidate") }; },
    "topics-pick": (b) => { const t = S.topics.find((x) => x.id === Number(b.id)); if (!t) return err("not_found", "소재를 찾을 수 없어요.", { status: 404 }); t.status = "picked"; return { ok: true, topic: t }; },
    "topics-skip": (b) => { const t = S.topics.find((x) => x.id === Number(b.id)); if (t) t.status = "expired"; return { ok: true }; },
    /* §3 디렉터 */
    "director-propose": (b) => { const t = S.topics.find((x) => x.id === Number(b.topicId)); if (!t) return err("not_found", "소재를 찾을 수 없어요.", { status: 404 });
      const pieces = []; const nv = S.accounts.find((a) => a.channel === "naver_blog"); const ts = S.accounts.find((a) => a.channel === "tistory");
      if (nv) pieces.push({ key: "p1", channel: "naver_blog", accountId: nv.id, accountHandle: nv.handle, format: "story", emotionKey: "warm", composition: "experience", lengthHint: { words: 1400 }, images: { count: 8, style: "photo", heroNeeded: true }, monetize: { affiliate: t.factors.intent !== "info" ? { provider: "coupang", productQuery: "에어프라이어 세척솔", slot: "end" } : null, adDisclosure: true }, schedule: { at: kst(1, 7, 30), slotReason: "네이버 블로그 아침 골든타임 · @" + nv.handle + " 오늘 0/" + nv.dailyCap }, coinCost: 9 });
      if (ts) pieces.push({ key: "p2", channel: "tistory", accountId: ts.id, accountHandle: ts.handle, format: "compare", emotionKey: "neutral", composition: "compare", lengthHint: { words: 1200 }, images: { count: 3, style: "infographic", heroNeeded: true }, monetize: { affiliate: null, adDisclosure: false }, schedule: { at: kst(1, 13, 0), slotReason: "티스토리 점심 검색 피크 · 애드센스 자리 2곳" }, coinCost: 4 });
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
    "pieces-get": (_b, q) => { tick(); const p = S.pieces.find((x) => x.id === Number(q.get("id"))); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 }); return { ok: true, piece: { ...pieceRow(p), bodyHtml: p.bodyHtml, blocks: bodyToBlocks(p), images: [{ url: "", caption: "10분 담가 둔 바스켓", sort: 0 }], meta: p.meta, gate: p.gate, topicTitle: p.topicTitle, regenCount: p.regenCount } }; },
    "pieces-approve": (b) => { const p = S.pieces.find((x) => x.id === Number(b.id)); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 }); if (!p.gateOk) return err("gate", "발행 전 확인이 필요해요.", { gate: p.gate }); p.status = "scheduled"; tick(); return { ok: true, status: "scheduled", scheduledFor: p.scheduledFor }; },
    "pieces-reject": (b) => { const p = S.pieces.find((x) => x.id === Number(b.id)); if (p) p.status = "rejected"; return { ok: true, status: "rejected" }; },
    "pieces-regenerate": (b) => { const p = S.pieces.find((x) => x.id === Number(b.id)); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 }); if (p.regenCount >= 1) return err("regen_limit", "다시 만들기는 한 번만 할 수 있어요."); p.regenCount++; p.status = "generating"; p.stage = "writing"; p._t0 = Date.now(); return { ok: true, status: "generating" }; },
    "pieces-update": (b) => { const p = S.pieces.find((x) => x.id === Number(b.id)); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 }); if (b.title) p.title = b.title; if (b.bodyHtml) p.bodyHtml = b.bodyHtml; p.gate = gate(true); p.gateOk = true; return { ok: true, gate: p.gate, bodyHtml: p.bodyHtml }; },
    /* §5 규칙·슬롯 */
    "rules-list": () => ({ ok: true, rules: S.rules, settings: S.settings, coinsPerWeek: coinsPerWeek(), maxRules: 3 }),
    "rules-save": (b) => { if ((b.rules || []).filter((r) => r.active !== false).length > 3) return err("limit", "이 요금제에서는 규칙을 3개까지 만들 수 있어요."); const before = S.slots.length; S.rules = (b.rules || []).map((r, i) => ({ id: r.id || S.nextId++, kind: "post", active: true, ...r })); S.slots = S.slots.filter((s) => s.origin === "manual" || S.rules.some((r) => r.channel === s.channel)); rollSlots(); return { ok: true, rules: S.rules, coinsPerWeek: coinsPerWeek(), slotsCreated: S.slots.length - before }; },
    "rules-settings": (b) => { for (const k of ["autoSchedule", "horizonDays", "topicLeadDays", "produceLeadDays", "produceHour", "reviewPolicy", "bestTimeMode", "weeklyCoinCap", "quietDays"]) if (b[k] !== undefined) S.settings[k] = b[k]; S.slots = S.slots.filter((s) => s.origin === "manual" || !(S.settings.quietDays || []).includes(s.date)); rollSlots(); return { ok: true, settings: S.settings }; },
    "slots-list": (_b, q) => { tick(); const from = q.get("from") || "0000", to = q.get("to") || "9999"; return { ok: true, slots: S.slots.filter((s) => s.date >= from && s.date <= to).sort((a, b) => (a.publishAt || "").localeCompare(b.publishAt || "")) }; },
    "slots-skip": (b) => { const s = S.slots.find((x) => x.id === Number(b.id)); if (s) s.status = "skipped"; return { ok: true }; },
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
  const withMock = (href) => { try { const u = new URL(href, location.origin); if (u.origin !== location.origin || !u.pathname.startsWith("/app/")) return href; u.searchParams.set("mock", "1"); return u.pathname + u.search + u.hash; } catch { return href; } };
  UI.go = (href) => location.assign(withMock(href));
  document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("a[href]"); if (!a) return; const h = a.getAttribute("href"); if (!h || h.startsWith("javascript:") || h.startsWith("#")) return; const m = withMock(h); if (m !== h) a.setAttribute("href", m); }, true);
  const badge = document.createElement("div"); badge.textContent = "모의 데이터"; badge.style.cssText = "position:fixed;top:6px;right:8px;z-index:99;font-size:10px;font-weight:700;color:var(--muted);background:var(--press);border-radius:6px;padding:2px 6px;pointer-events:none"; document.body.appendChild(badge);
})();
