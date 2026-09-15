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
  /* [P1R6 · B-1 §2.3] 채널 영상 상한 — 🔴 포맷 상한은 «다른 축»이다(유튜브는 60인데 clip 포맷은 30) · 화면은 formats[i].maxSeconds 만 본다 */
  const VF = (key, label, maxSeconds) => ({ key, label, maxSeconds });
  const CH_VIDEO = {
    youtube_shorts: { maxSeconds: 60, formats: [VF("graphic", "그래픽 스토리", 60), VF("talking", "말하는 사람", 60), VF("clip", "클립", 30)] },
    naver_clip: { maxSeconds: 30, formats: [VF("clip", "클립", 30), VF("graphic", "그래픽 스토리", 30)] },
    reels: { maxSeconds: 60, formats: [VF("graphic", "그래픽 스토리", 60), VF("talking", "말하는 사람", 60), VF("clip", "클립", 30)] },
    threads: { maxSeconds: 60, formats: [VF("graphic", "그래픽 스토리", 60), VF("clip", "클립", 30)] },
  }; // 🔴 상한은 서버가 말한다(화면 상수 금지 · 릴스 90 은 Phase 5)
  const CHANNELS = [
    ["naver_blog", "네이버 블로그", "text", "runner", "session", true, "active"], ["tistory", "티스토리", "text", "runner", "session", true, "active"], ["blogger", "블로거", "text", "api", "oauth", false, "active"],
    ["wordpress", "워드프레스", "text", "api", "app_password", true, "active"], ["threads", "쓰레드", "text", "api", "oauth", true, "planned"], ["instagram", "인스타그램", "video", "api", "oauth", false, "planned"],
    ["youtube_shorts", "유튜브 쇼츠", "video", "api", "oauth", false, "planned"], ["naver_clip", "네이버 클립", "video", "runner", "session", true, "planned"], ["reels", "릴스", "video", "api", "oauth", false, "planned"], ["tiktok", "틱톡", "video", "api", "oauth", false, "planned"],
  ].map(([key, label, category, publishVia, connectMethod, configured, status]) => { const o = { key, label, category, publishVia, status, connectMethod, configured }; if (CH_VIDEO[key]) o.video = CH_VIDEO[key]; return o; }); // [P1R6] channels[].video{maxSeconds,formats} // 라이브 channel_registry 와 같게: 발행 경로 있는 4채널만 active · 나머지 planned(어휘 active|planned|down)

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
  const revEmpty = qs.get("revEmpty") === "1";
  const blocked = qs.get("readonly") === "1" ? "readonly" : qs.get("suspended") === "1" ? "suspended" : null; // [P1R4] 쓰기 막힘(계약 §1.3 requireWritable)
  const planLimit = qs.get("planLimit") || "";
  const kiccOff = qs.get("kicc") === "0";
  /* [§1.6] 결제 라인 — ?keyin=1 정책 켜짐(기본 0) · ?keyinMid=0 비인증 MID 미등록 → available:false(체크박스 자체가 없다) */
  const keyinOn = qs.get("keyin") === "1", keyinMid = qs.get("keyinMid") !== "0";
  /* [P1R6] 손잡이 — ?supplier=0(회사 정보 없음 → 영수증 «준비 중») · ?share=0(이달 수익 0 → 공유 카드 없음) · ?managed=deny(플랜에 관리형 러너 없음 → 402 plan_feature) · ?export=running(내보내기 도는 중) · ?amOff=1(AM 다리 미설정) */
  const mailOff = qs.get("mail") === "0";      // [P1R6] 가입 인증 메일 실패 흉내(배너 · 다시 보내기)
  let resendAt = 0;                             // 60초 쿨다운(서버 audit 로 재는 것을 흉내)
  const supplierOff = qs.get("supplier") === "0", shareOff = qs.get("share") === "0", managedDeny = qs.get("managed") === "deny", exportRunning = qs.get("export") === "running", exportFail = qs.get("export") === "fail", amOff = qs.get("amOff") === "1";
  const SUPPLIER = { name: "주식회사 함께워크", ceo: "김두현", bizNo: "123-45-67890", mailOrderNo: "2026-서울강남-01234", address: "서울특별시 강남구 테헤란로 123, 4층", email: "help@autocreate.dev", phone: "02-1234-5678" }; // ops_settings.company(운영센터 «회사 정보» 한 출처)
  /* 공유 카드 그림(모의) — 실서버는 PNG presigned(24h · B-1 서버 래스터라이저) · 화면은 <img> 로 띄우기만 한다 */
  const shareImg = (month, handles, channels) => { const mm = Number(String(month).slice(5, 7)) || 9; const krw = (S.revRows || []).filter((r) => String(r.day || "").slice(0, 7) === month).reduce((a2, r) => a2 + (r.amountKrw || 0), 0);
    const lines = [`<text x='540' y='560' font-family='sans-serif' font-size='44' fill='#8B95A1' text-anchor='middle'>${mm}월에</text>`,
      `<text x='540' y='690' font-family='sans-serif' font-size='88' font-weight='800' fill='#191F28' text-anchor='middle'>${krw.toLocaleString("ko-KR")}원 벌었어요</text>`];
    if (channels) lines.push(`<text x='540' y='780' font-family='sans-serif' font-size='40' fill='#4E5968' text-anchor='middle'>네이버 블로그 · 유튜브 쇼츠</text>`);
    if (handles) lines.push(`<text x='540' y='${channels ? 850 : 780}' font-family='sans-serif' font-size='40' fill='#8B95A1' text-anchor='middle'>@cook_a · @shorts_d</text>`);
    lines.push(`<text x='540' y='1180' font-family='sans-serif' font-size='36' fill='#B0B8C1' text-anchor='middle'>AutoCreate</text>`);
    return "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='1080' height='1350'><rect width='1080' height='1350' fill='#F2F4F6'/><rect x='60' y='60' width='960' height='1230' rx='48' fill='#fff'/>${lines.join("")}</svg>`); };
  const keyinOption = () => ({ available: keyinOn && keyinMid, label: "카드번호 직접 입력", notice: "법인카드가 앱카드 창에서 거절될 때 쓰세요. 카드번호를 결제사 창에 직접 넣어요." });
  const aiCap = qs.get("aiCap") === "1", bannedTopic = qs.get("banned") === "1";
  /* [P1R5] 영상 손잡이 — ?stage=script|tts|clips|render|judging|done|failed(만드는 중 영상의 단계 고정) · ?judge=P0|P1|P2(검수 영상 심사 등급) · ?noFfmpeg=1(내 PC 프로그램 caps.ffmpeg=false) · ?uploaded=private(발행함 비공개 업로드 행) · ?videoBudget=0(달러 캡 초과 step budget) */
  const vStage = qs.get("stage") || "", vJudge = qs.get("judge") || "", noFfmpeg = qs.get("noFfmpeg") === "1", uploadedKnob = qs.get("uploaded") || "", videoBudget = qs.get("videoBudget") || "";
  const VIDEO_CH = ["youtube_shorts", "naver_clip", "reels", "threads"];                       // §0.2 VideoChannel
  const VIDEO_COIN = { video_15: 6, video_30: 12, video_60: 28 };                               // §6.3 코인 · lib/coin-table.ts 값
  const videoCoinItem = (sec) => (sec <= 15 ? "video_15" : sec <= 35 ? "video_30" : "video_60"); // §0.1-4 구간제(초 산식 금지)
  const VOICES = [{ voiceId: "tc_minseo", name: "민서", desc: "차분한 여성", provider: "typecast" }, { voiceId: "tc_jun", name: "준", desc: "또렷한 남성", provider: "typecast" }, { voiceId: "tc_haru", name: "하루", desc: "밝은 여성", provider: "typecast" }];
  const HOOKS = ["contrast", "question", "number_typo", "event_pushin", "extreme_closeup"], PALETTES = ["terracotta", "teal", "navy", "sage", "charcoal"]; // B-1 types.ts 훅 5 · scenes.ts 팔레트 5
  const HOOK_KO = { event_pushin: "사건으로 시작", number_typo: "숫자로 시작", extreme_closeup: "확대로 시작", question: "질문으로 시작", contrast: "반전으로 시작" };
  const PALETTE_KO = { terracotta: "테라코타", teal: "청록", navy: "네이비", sage: "세이지", charcoal: "차콜" }; // = types.ts PALETTE_LABELS_KO(서버가 variantLabels 로 내려준다)
  /* §1.1 PieceSpec.video — variant 는 같은 brief 안 i 번째 영상(결정론) */
  const videoSpec = (i, accountId, seconds = 60, format = "graphic") => ({ format, seconds, provider: { tier: seconds <= 15 ? "filler" : "standard", key: seconds <= 15 ? "veo_lite" : "omni" }, voice: { provider: "typecast", voiceId: VOICES[i % VOICES.length].voiceId },
    variant: { hookType: HOOKS[i % HOOKS.length], palette: PALETTES[(Number(accountId || 0) + i) % PALETTES.length], voiceId: VOICES[i % VOICES.length].voiceId },
    variantLabels: { hook: HOOK_KO[HOOKS[i % HOOKS.length]], palette: PALETTE_KO[PALETTES[(Number(accountId || 0) + i) % PALETTES.length]], voiceId: VOICES[i % VOICES.length].name }, /* 사람말은 서버가 붙인다(화면 하드코딩 0) */
    cuts: format === "clip" ? 3 : seconds >= 60 ? 9 : 5, disclosure: { badge: true, descriptionFirstLine: true } });
  const JUDGE_AXES = [["hook3s", "훅 3초 안에"], ["caption_sync", "자막 싱크"], ["frame_gap", "프레임 공백"], ["loop_seam", "루프 이음새"], ["cut_quality", "컷 화질"], ["policy", "정책 · 고지"], ["similarity", "계정 간 변주"], ["audio", "소리 정규화"]];
  const judgeReport = (grade) => ({ grade, pass: grade !== "P0", repaired: grade === "P1", axes: JUDGE_AXES.map(([key, label]) => { const bad = (grade === "P1" && key === "cut_quality") || (grade === "P0" && key === "policy"); const o = { key, label, pass: !bad, grade: bad ? grade : "P2" }; if (grade === "P1" && key === "cut_quality") o.detail = "4번 컷 화질 낮음 · 한 번 다시 만들어 통과"; if (grade === "P0" && key === "policy") o.detail = "정책 위반 의심 · 세 번 고쳐도 안 돼 사람이 봐 주세요"; return o; }) });
  const POSTER = "data:image/svg+xml;utf8," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='540' height='960'><rect width='540' height='960' fill='#191F28'/><rect x='60' y='380' width='420' height='120' rx='16' fill='#2A2A32'/><text x='270' y='452' font-family='sans-serif' font-size='40' font-weight='800' fill='#fff' text-anchor='middle'>에어프라이어 기름때</text></svg>");
  const SRT = "data:text/plain;charset=utf-8," + encodeURIComponent("1\n00:00:00,000 --> 00:00:03,000\n제휴 링크가 있어요\n\n2\n00:00:03,000 --> 00:00:07,500\n눌어붙은 기름, 3분이면 끝나요\n\n3\n00:00:07,500 --> 00:00:13,000\n베이킹소다 한 스푼이 전부예요\n");
  const VDESC = "이 영상은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.\n베이킹소다 한 스푼이면 눌어붙은 기름이 녹아요. 준비물과 순서를 58초에 담았어요.\n\n#에어프라이어 #청소 #살림팁";
  const videoAssets = () => [{ id: 9001, kind: "video", url: "", meta: { durationMs: 58000, bytes: 8412300, frameCount: 1740 } }, { id: 9002, kind: "srt", url: SRT }, { id: 9003, kind: "thumb", url: POSTER }];
  const VIDEO_GATE_CHECKS = [{ key: "disclosure", label: "제휴 고지(배지 · 시작 자막 · 설명란 첫 줄)", pass: true }, { key: "banned_words", label: "금칙어", pass: true, detail: "0건" }, { key: "superlative", label: "과장 표현", pass: true, detail: "0건" }];
  /* 완성 = in_review + 설명란 body(첫 줄 고지) + blocks(video·srt·hashtags) + assets(video·thumb·srt) + gate.judge(§1.4 done) */
  const finishVideo = (p, grade = "P2") => { p.status = grade === "P0" ? "in_review" : "in_review"; p.meta.stage = "done"; p.meta.chainStage = { stage: "done", at: iso(Date.now()) }; p.gateOk = grade !== "P0"; p.body = VDESC; p.blocks = [{ type: "video", assetId: 9001 }, { type: "srt", assetId: 9002 }, { type: "hashtags", tags: ["에어프라이어", "청소", "살림팁"] }]; p.assets = videoAssets();
    p.gate = { ok: grade !== "P0", rewritten: grade === "P1", checks: VIDEO_GATE_CHECKS, judge: judgeReport(grade) }; delete p._v0; const sl = S.slots.find((s) => s.pieceId === p.id); if (sl) sl.status = "in_review"; };                                          // [P1R4] §1.5 게이트 견본(ai_cost_cap · banned_category)                                                                    // [P1R4] KICC 키 없음 → «결제 준비 중이에요»(no-op 정직)
  const PLANS = [ // = B lib/plans.ts PLAN_DEFAULTS(공개 3개 · trial 은 /api/plans 에 안 나온다)
    { key: "starter", name: "Starter", priceMonth: 19000, priceYear: 190000, public: true, recommended: false, sort: 1, limits: { maxAccounts: 3, coinsIncluded: 40, runnerDevices: 1, teamSeats: 1, horizonDays: 7, maxRules: 3 }, features: { directorEdit: false, autoSchedule: true, failover: false, managedRunner: "no", runnerRevenue: false, teamApproval: false } },
    { key: "pro", name: "Pro", priceMonth: 49000, priceYear: 490000, public: true, recommended: true, sort: 2, limits: { maxAccounts: 15, coinsIncluded: 150, runnerDevices: 2, teamSeats: 2, horizonDays: 30, maxRules: null }, features: { directorEdit: true, autoSchedule: true, failover: true, managedRunner: "option", runnerRevenue: true, teamApproval: false } },
    { key: "agency", name: "Agency", priceMonth: 149000, priceYear: 1490000, public: true, recommended: false, sort: 3, limits: { maxAccounts: 50, coinsIncluded: 500, runnerDevices: 5, teamSeats: 5, horizonDays: 30, maxRules: null }, features: { directorEdit: true, autoSchedule: true, failover: true, managedRunner: "included", runnerRevenue: true, teamApproval: true } },
  ];
  const PACKS = [{ id: "pack_100", coins: 100, krw: 50000, bonusPct: 0 }, { id: "pack_220", coins: 220, krw: 100000, bonusPct: 10 }, { id: "pack_720", coins: 720, krw: 300000, bonusPct: 20 }, { id: "pack_trial", coins: 10, krw: 5000, bonusPct: 0, oncePerTenant: true }];
  const VAT = (a) => Math.round(a * 0.1);                                                              // [P1R4] 402 plan_limit(§1.4)
  const notWritable = () => (blocked ? { ok: false, step: "writable", reason: blocked, error: blocked === "readonly" ? "체험이 끝났어요. 요금제를 고르면 바로 이어서 돼요." : "결제가 밀려 있어요. 카드를 확인해 주세요.", status: 403 } : null);                 // 수익 빈 상태(연결 0·행 0)
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
    v: 6, coins: 60, refreshCount: 0, autoSchedule: false, nextId: 100, // v = 모의 상태 판(올리면 옛 상태를 버리고 다시 뿌린다 · fresh 로 비운 상태를 되살리지 않는다) // [P1R5] C 시나리오 «코인 60»(글 2 + 쇼츠 1 = 41 이 한 번에 나가게)
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
      { id: 17, title: "전자레인지 냄새, 레몬 한 조각으로 끝", angle: "3초 훅 · 비포/애프터", channelHint: "youtube_shorts", score: 81, status: "candidate", factors: { volume: 15600, growthPct: 63, competition: "low", intent: "info" }, expiresAt: iso(now + 6 * 86400e3) }, // [P1R5] 영상 채널 힌트(§1.11)
    ],
    templates: [], // [P1R5] shorts_templates(레퍼런스 구조 · topics-reference)
    /* [P1R6] 추천인 · 세금계산서 프로필 · 관리형 러너 신청 · 내보내기 작업 */
    referral: { code: "AC7K2M9Q", invited: fresh ? [] : [{ tenantName: "요리하는 집", at: iso(now - 9 * 86400e3), rewarded: true }, { tenantName: "팁스고", at: iso(now - 2 * 86400e3), rewarded: false }], rewardCoins: 20 },
    taxProfile: fresh ? null : { bizNo: "220-88-12345", bizName: "다온커머스", email: "tax@daon.co.kr" },
    managed: { status: "none", assigned: 0 },
    exportJob: null,
    briefs: {},
    pieces: fresh ? [] : [
      { id: 501, channel: "naver_blog", accountHandle: "cook_a", kind: "post", format: "story", title: "에어프라이어 청소법, 눌어붙은 기름 3분 컷", status: "in_review", stage: "done", scheduledFor: kst(1, 7, 30), coverUrl: "", gateOk: true, createdAt: iso(now - 3600e3), topicTitle: "에어프라이어 청소법", regenCount: 0, bodyHtml: BODY_NAVER, meta: { tags: ["에어프라이어청소", "베이킹소다"], disclosure: DISCLOSURE, affiliate: { provider: "coupang", url: "https://link.coupang.com/a/mock", subId: "piece501" } }, gate: gate(true) },
      { id: 502, channel: "tistory", accountHandle: "tips_b", kind: "post", format: "compare", title: "에어프라이어 청소, 3분 요약(비교표)", status: "in_review", stage: "done", scheduledFor: kst(1, 13, 0), gateOk: false, createdAt: iso(now - 3000e3), topicTitle: "에어프라이어 청소법", regenCount: 1, bodyHtml: BODY_TISTORY, meta: { tags: ["에어프라이어"], disclosure: null }, gate: gate(false) },
      { id: 503, channel: "naver_blog", accountHandle: "cook_a", kind: "post", format: "guide", title: "가을 이불 세탁, 이것만", status: "scheduled", stage: "done", scheduledFor: kst(2, 7, 30), gateOk: true, createdAt: iso(now - 86400e3), topicTitle: "가을 이불 세탁", regenCount: 0, bodyHtml: BODY_NAVER, meta: { tags: [], disclosure: null }, gate: gate(true) },
      { id: 504, channel: "tistory", accountHandle: "tips_b", kind: "post", format: "info", title: "전기요금 아끼는 콘센트", status: "published", stage: "done", publishedAt: iso(now - 2 * 86400e3), externalUrl: "https://tips-b.tistory.com/12", gateOk: true, createdAt: iso(now - 3 * 86400e3), topicTitle: "전기요금", regenCount: 0, bodyHtml: BODY_TISTORY, meta: { tags: [], disclosure: null }, gate: gate(true) },
      { id: 505, channel: "naver_blog", accountHandle: "cook_a", kind: "post", format: "story", title: "에어프라이어 청소, 눌어붙은 기름 3분 컷", status: "published", stage: "done", publishedAt: iso(now - 26 * 3600e3), externalUrl: "https://blog.naver.com/cook_a/223456789", gateOk: true, createdAt: iso(now - 3 * 86400e3), topicTitle: "에어프라이어 청소법", regenCount: 0, bodyHtml: BODY_NAVER, meta: { tags: ["에어프라이어청소"], disclosure: DISCLOSURE, affiliate: { provider: "coupang", url: "https://link.coupang.com/a/mock", subId: "piece505" } }, gate: gate(true) },
      { id: 506, channel: "naver_blog", accountHandle: "cook_a", kind: "post", format: "guide", title: "가을 이불 세탁, 건조기 없이 뽀송하게", status: "awaiting_manual", stage: "done", scheduledFor: iso(now - 4 * 3600e3), gateOk: true, createdAt: iso(now - 2 * 86400e3), topicTitle: "가을 이불 세탁", regenCount: 0, bodyHtml: BODY_NAVER, meta: { tags: ["이불세탁"], disclosure: null }, gate: gate(true) },
      /* [P1R5] 영상 piece(kind video · §1.2 행 모양) — 508 만드는 중(?stage= 로 단계 고정 · 없으면 시간 따라 진행) · 509 봐주세요(?judge= 로 등급) */
      { id: 508, channel: "youtube_shorts", accountHandle: "shorts_d", kind: "video", title: "에어프라이어 기름때, 3분이면 끝", status: "generating", scheduledFor: kst(1, 18, 0), gateOk: false, createdAt: iso(now - 300e3), topicTitle: "에어프라이어 청소법", regenCount: 0, coinCost: 28, bodyHtml: "", meta: { stage: "script", chainStage: { stage: "script", at: iso(now - 300e3) }, video: videoSpec(0, 4, 60, "graphic"), angle: "3초 훅 · 비포/애프터", emotionKey: "shorts", endcard: { text: "설명란 링크에서 확인해요", url: "https://link.coupang.com/a/mock" }, tags: ["에어프라이어", "청소"], disclosure: DISCLOSURE, affiliate: { provider: "coupang", url: "https://link.coupang.com/a/mock", subId: "piece508" }, chainResume: { count: 0 } }, gate: null, _v0: now - 9500 },
      { id: 509, channel: "youtube_shorts", accountHandle: "shorts_d", kind: "video", title: "전자레인지 냄새, 레몬 한 조각으로 끝", status: "in_review", scheduledFor: kst(2, 18, 0), gateOk: true, createdAt: iso(now - 5 * 3600e3), topicTitle: "전자레인지 냄새", regenCount: 0, coinCost: 28, bodyHtml: "", body: VDESC, blocks: [{ type: "video", assetId: 9001 }, { type: "srt", assetId: 9002 }, { type: "hashtags", tags: ["전자레인지", "레몬", "살림팁"] }], assets: videoAssets(), meta: { stage: "done", chainStage: { stage: "done", at: iso(now - 4 * 3600e3) }, video: videoSpec(1, 4, 60, "graphic"), angle: "3초 훅 · 비포/애프터", emotionKey: "shorts", tags: ["전자레인지", "레몬", "살림팁"], disclosure: DISCLOSURE, affiliate: { provider: "coupang", url: "https://link.coupang.com/a/mock", subId: "piece509" }, chainResume: { count: 0 }, tts: { provider: "typecast" }, endcard: { text: "설명란 링크에서 확인해요", url: "https://link.coupang.com/a/mock" }, clampedFrom: null }, gate: { ok: true, rewritten: false, checks: VIDEO_GATE_CHECKS, judge: judgeReport("P2") } },
    ],
    rules: fresh ? [] : [
      { id: 1, channel: "naver_blog", kind: "post", accountMode: "auto", every: "week", count: 3, weekdays: [1, 3, 5], preferredHour: 7, active: true },
      { id: 2, channel: "tistory", kind: "post", accountMode: "fixed", accountId: 2, every: "week", count: 2, weekdays: [2, 4], preferredHour: 13, active: true },
      { id: 3, channel: "youtube_shorts", kind: "shorts", accountMode: "auto", every: "week", count: 2, weekdays: [2, 5], preferredHour: 18, active: true }, // [P1R5] kind shorts 규칙(주 2회 · 편당 video_60)
    ],
    settings: { autoSchedule: !fresh, horizonDays: 14, topicLeadDays: 7, produceLeadDays: 3, produceHour: "06:00", reviewPolicy: "silence_approves", bestTimeMode: "auto", weeklyCoinCap: null, quietDays: [] },
    slots: [],
    /* ── [P1R2] 러너 기기(계약 §2) · 발행함(§6) · 재로그인 잡(§7.2) · 알림함 ── */
    devices: fresh ? [] : [{ id: 901, name: "집 PC", kind: "own", online: runnerOn, lastSeenAt: iso(now - 2 * 3600e3), version: "1.0.3", jobsWaiting: 2, caps: { ffmpeg: !noFfmpeg, ffmpegVersion: noFfmpeg ? undefined : "7.1" } }], // [P1R5] heartbeat caps(§2.4)
    posts: fresh ? [] : [
      { id: 701, pieceId: 504, channel: "tistory", accountHandle: "tips_b", title: "전기요금 아끼는 콘센트", externalUrl: "https://tips-b.tistory.com/12", publishedVia: "api", publishedAt: iso(now - 2 * 86400e3), status: "published", stats: { views: 1240, likes: 8, comments: 2, lastSyncAt: iso(now - 6 * 3600e3) }, alive: true },
      { id: 702, pieceId: 505, channel: "naver_blog", accountHandle: "cook_a", title: "에어프라이어 청소, 눌어붙은 기름 3분 컷", externalUrl: "https://blog.naver.com/cook_a/223456789", publishedVia: "runner", publishedAt: iso(now - 26 * 3600e3), status: "published", stats: { views: 318, likes: 21, lastSyncAt: iso(now - 3 * 3600e3) }, alive: true },
      { id: 703, pieceId: 506, channel: "naver_blog", accountHandle: "cook_a", title: "가을 이불 세탁, 건조기 없이 뽀송하게", status: "awaiting_manual", stats: {}, alive: false, errorKind: "selector_changed", failReason: "임시저장까지는 됐는데 발행 버튼을 찾지 못했어요" }, // [v2.1] publishedVia·publishedAt 없음(post 행이 없는 실패 행)
      /* [P1R5] ?uploaded=private — 유튜브 심사 전 비공개 업로드(posts.status uploaded_private · §7-1) + 릴스 처리 중(retriable video_processing) */
      ...(uploadedKnob === "private" ? [
        { id: 704, pieceId: 509, channel: "youtube_shorts", accountHandle: "shorts_d", title: "전자레인지 냄새, 레몬 한 조각으로 끝", externalUrl: "https://www.youtube.com/shorts/dQw4w9WgXcQ", channelRef: "dQw4w9WgXcQ", publishedVia: "api", publishedAt: iso(now - 3 * 3600e3), status: "uploaded_private", stats: {}, alive: true },
        { id: 705, pieceId: 509, channel: "reels", accountHandle: "reels_f", title: "3분 청소 루틴", publishedVia: "api", status: "publishing", errorKind: "video_processing", retriable: true, stats: {}, alive: true },
      ] : []),
    ],
    reloginJobs: {},
    notifications: fresh ? [] : [
      { id: 801, kind: "reassign", title: "@life_c 계정이 정지됐어요", desc: "예약된 글 3건을 @cook_a 로 옮겼어요", link: "/app/accounts.html", tone: "warn", createdAt: iso(now - 5 * 3600e3) },
      { id: 802, kind: "publish", title: "글 1건이 올라가지 못했어요", desc: "«가을 이불 세탁» · 채널 화면이 바뀌었어요", link: "/app/posts.html", tone: "warn", createdAt: iso(now - 4 * 3600e3) },
      { id: 803, kind: "publish", title: "@cook_a 에 글이 올라갔어요", desc: "에어프라이어 청소, 눌어붙은 기름 3분 컷", link: "/app/posts.html", tone: "info", createdAt: iso(now - 26 * 3600e3), readAt: iso(now - 20 * 3600e3) },
      { id: 804, kind: "trial_d3", title: "체험이 3일 남았어요", desc: "끝나면 보기만 돼요. 요금제를 고르면 그대로 이어져요.", link: "/app/plan.html", tone: "info", createdAt: iso(now - 30 * 3600e3), readAt: iso(now - 20 * 3600e3) },   // [P1R4] B trial-expire 알림 kind
      { id: 805, kind: "coin_refunded", title: "환불이 처리됐어요", desc: "5,500원을 돌려드렸어요(미사용 10코인 회수). 카드사 사정에 따라 3~5일 걸릴 수 있어요.", link: "/app/coins.html", tone: "info", createdAt: iso(now - 3 * 86400e3), readAt: iso(now - 2 * 86400e3) },
    ],
    reassigned: fresh ? null : { fromHandle: "life_c", toHandle: "cook_a", moved: 3, at: iso(now - 5 * 3600e3) },
    /* ── [P1R4] 결제·구독·문의(계약 v4.1 §1·§2.1 support) ── */
    billing: { planKey: "trial", cycle: "month", billingKey: null, pendingPlanKey: null, pendingCycle: null, cancelAtPeriodEnd: false, periodStart: null, periodEnd: null, nextBillingAt: null, paidTerms: false, // = tenants.plan_key + subscriptions 장부 + consents(paid_terms)
      orders: [{ orderNo: "AC-COIN-1-trial-mfx1k2", packId: "pack_trial", coins: 10, krw: 5000, vatKrw: 500, totalKrw: 5500, status: "paid", paidAt: iso(now - 12 * 3600e3), refundedAt: null }],   // coin_orders
      ledger: [{ at: iso(now - 12 * 3600e3), kind: "purchase", bucket: "purchased", amount: 10, ref: "AC-COIN-1-trial-mfx1k2", reason: "코인 충전 10개(₩5,500 · 유효 1년)", expiresAt: iso(now + 365 * 86400e3) }, { at: iso(now - 11 * 3600e3), kind: "consume", bucket: "purchased", amount: -4, item: "cardnews", ref: "piece:507", reason: "카드뉴스" }, { at: iso(now - 86400e3), kind: "grant", bucket: "included", amount: 30, ref: "ops:grant:1", reason: "운영 지급" }],   // coin_ledger
      invoices: [{ id: 9100, kind: "coin", period: "AC-COIN-1-trial-mfx1k2", amountKrw: 5000, vatKrw: 500, totalKrw: 5500, status: "paid", paidAt: iso(now - 12 * 3600e3), createdAt: iso(now - 12 * 3600e3), orderNo: "AC-COIN-1-trial-mfx1k2" }] },
    tickets: fresh ? [] : [{ id: 702, subject: "네이버 글이 안 올라가요", status: "progress", createdAt: iso(now - 26 * 3600e3), updatedAt: iso(now - 2 * 3600e3), messages: [{ from: "customer", text: "어제부터 네이버에 글이 안 올라가요. 프로그램은 켜 두었어요.", at: iso(now - 26 * 3600e3) }, { from: "operator", text: "확인해 보니 네이버 로그인이 풀려 있어요. «내 계정 → 다시 로그인»을 눌러 주시면 PC 프로그램이 로그인 창을 열어요.", at: iso(now - 2 * 3600e3) }] }, { id: 690, subject: "코인 만료가 언제인가요", status: "resolved", createdAt: iso(now - 9 * 86400e3), updatedAt: iso(now - 8 * 86400e3), messages: [{ from: "customer", text: "충전한 코인은 언제까지 쓸 수 있나요?", at: iso(now - 9 * 86400e3) }, { from: "operator", text: "충전한 코인은 1년, 플랜 포함 코인은 그달 말까지예요.", at: iso(now - 8 * 86400e3) }] }],
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
  if (!S || fresh || qs.get("reset") === "1" || !S.posts || !S.revSources || !S.adState || !S.adState.adpost || S.v !== 6) { S = seed(); if (!fresh) { rollSlots(); scenarios(); } save(); } // posts 없음 = P1R1 시절 상태 → 새로 뿌린다
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
        S.slots.push({ id: S.nextId++, date, channel: r.channel, kind: r.kind === "shorts" ? "shorts" : "post", accountId: acc?.id, accountHandle: acc?.handle, status, publishAt: kst(d, r.preferredHour || 9, 30), reviewDeadline: kst(d - 1, 21), topicTitle: piece?.title || (d < 7 ? S.topics[d % S.topics.length]?.title : undefined), pieceId: piece?.id, origin: "auto" }); // [P1R5] kind shorts
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
  const coinsPerWeek = () => S.rules.filter((r) => r.active).reduce((a, r) => a + (r.every === "day" ? r.count * 7 : r.count) * (r.kind === "shorts" ? VIDEO_COIN.video_60 : 1 + (IMG[r.channel] || 2)), 0); // [P1R5] shorts = video_60 단가(§1.10)
  const pieceRow = (p) => { const { bodyHtml, blocks, images, meta, gate, topicTitle, regenCount, body, assets, _v0, _t0, ...row } = p; if (p.kind === "video" && meta) row.meta = { stage: meta.stage, chainStage: meta.chainStage, video: { format: meta.video.format, seconds: meta.video.seconds } }; return row; }; // [P1R5] 영상 목록 행 = kind + meta.stage(§3 pieces.html)
  /* RunnerDevice 투영 — 없는 값은 키를 싣지 않는다(계약 §0) */
  const devRow = (d) => { const o = { id: d.id, name: d.name, kind: d.kind, status: d.online ? "online" : "offline", jobsWaiting: d.jobsWaiting || 0 }; if (d.caps) o.caps = d.caps; // [P1R5] caps.ffmpeg(§2.4)
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
    for (const p of S.pieces) { if (p.kind !== "video" || p.status !== "generating") continue; const v = p.meta; const online = S.devices.some((d) => d.online && d.caps?.ffmpeg !== false); const sl = S.slots.find((s) => s.pieceId === p.id);
      const set = (stage, extra) => { v.stage = stage; v.chainStage = { stage, at: iso(Date.now()), ...(extra || {}) }; if (sl && !["awaiting_runner"].includes(sl.status)) sl.status = "producing"; };
      if (vStage && p.id === 508) { // 손잡이 = 단계 고정
        if (vStage === "failed") { p.status = "failed"; v.stage = "failed"; p.failReason = "제작이 너무 오래 걸려 멈췄어요(장면 단계까지 진행) · 코인은 돌려드렸어요"; delete p._v0; if (sl) sl.status = "planned"; continue; }
        if (vStage === "done") { finishVideo(p, vJudge || "P2"); continue; }
        set(vStage, vStage === "clips" ? { cutsDone: 4, cutsTotal: v.video.cuts } : {}); if (vStage === "render" && sl) sl.status = online ? "producing" : "awaiting_runner"; continue; }
      if (!p._v0) continue; const age = Date.now() - p._v0;
      if (age < 4000) set("script"); else if (age < 8000) set("tts"); else if (age < 14000) set("clips", { cutsDone: Math.min(v.video.cuts, 1 + Math.floor((age - 8000) / 700)), cutsTotal: v.video.cuts });
      else if (age < 20000 || !online) { set("render"); if (sl) sl.status = online ? "producing" : "awaiting_runner"; if (!online) p._v0 = Date.now() - 19000; } // 러너 꺼짐 → 합성에서 기다린다(침묵 금지 · 홈 할 일)
      else if (age < 24000) set("judging"); else finishVideo(p, vJudge || "P2"); }
    if (vJudge) { const q = S.pieces.find((x) => x.id === 509); if (q && q.gate && q.gate.judge.grade !== vJudge) { q.gate = { ok: vJudge !== "P0", rewritten: vJudge === "P1", checks: VIDEO_GATE_CHECKS, judge: judgeReport(vJudge) }; q.gateOk = vJudge !== "P0"; } }
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
  const trialOf = () => { if (blocked === "suspended") return { status: "suspended", daysLeft: 0, planKey: "starter" }; const d = blocked === "readonly" ? 0 : qs.has("trial") ? Number(qs.get("trial")) : 9; return d <= 0 ? { status: "readonly", daysLeft: 0, planKey: "trial" } : { status: "trial", daysLeft: d, planKey: "trial" }; };
  const err = (step, error, extra = {}) => ({ ok: false, step, error, status: 400, ...extra });
  /* [P1R4] 코인 결제 확정(㉠ 원클릭 · ㉡ 콜백 공용) — coin_orders paid + invoices kind=coin 1행 + 원장 purchase */
  const settleCoin = (orderNo) => { const B = S.billing; const o = B.orders.find((x) => x.orderNo === orderNo); if (!o || o.status === "paid") return; o.status = "paid"; o.paidAt = iso(Date.now()); S.coins += o.coins;
    B.ledger.unshift({ at: o.paidAt, kind: "purchase", bucket: "purchased", amount: o.coins, ref: orderNo, reason: `코인 충전 ${o.coins}개(₩${o.totalKrw.toLocaleString("ko-KR")} · 유효 1년)`, expiresAt: iso(Date.now() + 365 * 86400e3) });
    B.invoices.unshift({ id: 9000 + S.nextId++, kind: "coin", period: orderNo, amountKrw: o.krw, vatKrw: o.vatKrw, totalKrw: o.totalKrw, status: "paid", paidAt: o.paidAt, createdAt: o.paidAt, orderNo }); };
  const REFUND_KO = { not_coin_order: "충전 주문이 아니에요.", not_paid: "결제가 끝난 주문이 아니에요.", already_refunded: "이미 환불된 주문이에요.", window: "충전 후 7일이 지나 환불할 수 없어요.", used: "코인을 모두 써서 돌려드릴 게 없어요.", no_lot: "충전 기록을 찾지 못했어요." };
  /* 환불 견적(B coin-refund.ts 5규칙) — ①미사용분만 ③7일 룰 먼저 ④단가 = 결제액 ÷ 받은 코인 ⑤부분 환불 없음 */
  const refundQuote = (o, orderNo) => { const NO = (reason, base = {}) => ({ eligible: false, reason, orderNo, packKrw: 0, vatKrw: 0, totalKrw: 0, packCoins: 0, unitKrw: 0, usedCoins: 0, unusedCoins: 0, maxRefundKrw: 0, purchasedAt: null, refundDeadlineAt: null, invoiceId: null, ...base });
    if (!/^AC-COIN-/.test(orderNo || "")) return NO("not_coin_order"); if (!o || o.status === "pending" || o.status === "failed") return NO("not_paid"); if (o.status === "refunded") return NO("already_refunded");
    const used = -S.billing.ledger.filter((l) => l.kind === "consume" && l.bucket === "purchased").reduce((a, l) => a + l.amount, 0); const unused = Math.max(0, o.coins - Math.min(used, o.coins)); const usedCoins = o.coins - unused;
    const unitKrw = o.totalKrw / o.coins; const maxRefundKrw = usedCoins === 0 ? o.totalKrw : Math.floor(unused * unitKrw); const deadline = new Date(o.paidAt).getTime() + 7 * 86400e3;
    const base = { packKrw: o.krw, vatKrw: o.vatKrw, totalKrw: o.totalKrw, packCoins: o.coins, unitKrw, usedCoins, unusedCoins: unused, maxRefundKrw, purchasedAt: o.paidAt, refundDeadlineAt: iso(deadline), invoiceId: 9100 };
    if (Date.now() > deadline) return NO("window", base); if (unused <= 0) return NO("used", base); return { ...NO("no_lot", base), eligible: true, reason: null }; };
  const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

  /* ── 라우트 ── */
  const R = {
    "auth-me": () => ({ ok: true, user: { id: 1, email: "mock@autocreate.dev", name: "모의 고객", role: "owner", emailVerified: qs.get("mail") !== "0", mustChangePassword: false }, tenant: { id: 1, key: "mock", name: "모의", planKey: blocked === "suspended" ? "starter" : "trial", status: blocked || "trial", trialEndsAt: iso(now + 9 * 86400e3), trialDaysLeft: blocked ? 0 : 9, settings: { autoSchedule: S.settings.autoSchedule } }, coins: S.coins, impersonation: qs.get("imp") === "1" ? { byName: "운영 관리자", startedAt: iso(now - 5 * 60e3), until: iso(now + 55 * 60e3) } : null }),
    "auth-refresh": () => ({ ok: true }),
    "auth-register": (b) => { const code = String(b.referralCode || "").trim().toUpperCase();
      if (code && code !== S.referral.code.slice(0, 4) + "OK" && !/^[A-Z0-9]{8}$/.test(code)) return { ok: false, step: "referral", error: "그런 추천 코드는 없어요. 다시 확인해 주세요.", status: 400 };
      if (code === S.referral.code) return { ok: false, step: "referral", error: "자기 코드는 쓸 수 없어요.", status: 400 };
      return { ok: true, user: { id: 1, email: b.email }, referral: code ? { applied: true, rewardCoins: S.referral.rewardCoins } : undefined, mailSent: !mailOff, status: 201 }; }, // mailSent:false → 화면은 배너 + 다시 보내기(가입은 통과)
    "auth-verify-resend": () => { const now2 = Date.now(); if (now2 - resendAt < 60000) return { ok: false, step: "rate", error: "방금 보냈어요. 잠시 뒤 다시 해 주세요.", status: 429 };
      resendAt = now2; if (qs.get("verified") === "1") return { ok: true, sent: false, verified: true };
      if (qs.get("mailFail") === "1") return { ok: false, step: "mail", error: "지금은 메일을 보내지 못했어요. 잠시 뒤 다시 해 주세요.", status: 200 };
      return { ok: true, sent: true }; }, // [P1R6] 400 step:"referral"
    "onboarding": (b) => { S.onboarding = { kinds: b.kinds || [], channels: b.channels || [] }; return { ok: true }; },
    "home-summary": () => { tick(); const review = S.pieces.filter((p) => p.status === "in_review").length; const todo = [];
      const online = S.devices.filter((d) => d.online).length;
      const RUNNER_CH = CHANNELS.filter((c) => c.publishVia === "runner").map((c) => c.key);
      const runnerDue = S.slots.filter((s) => RUNNER_CH.includes(s.channel) && s.date >= todayYmd && !["skipped", "published"].includes(s.status)).length;
      // 정지 계정은 아래 «승계» 한 줄로만 알린다(같은 사건을 두 줄로 쓰지 않는다)
      for (const a of S.accounts.filter((a) => ["pending_login", "disconnected"].includes(a.status)))
        todo.push({ kind: "account", title: a.status === "pending_login" ? `@${a.handle} 다시 로그인이 필요해요` : `@${a.handle} 연결이 끊겼어요`, desc: UI.chLabel(a.channel), link: "/app/accounts.html", tone: "warn" });
      if (!online && runnerDue) todo.push({ kind: "runner", title: "내 PC 프로그램이 꺼져 있어요", desc: `네이버·티스토리 예약 ${runnerDue}건은 이 프로그램이 올려요`, link: "/app/runner.html", tone: "warn" });
      const vWait = S.pieces.filter((p) => p.kind === "video" && p.status === "generating" && p.meta.stage === "render").length; // [P1R5] 합성 대기(§7-2 awaiting_runner · 침묵 금지)
      if (vWait && !online) todo.push({ kind: "runner", title: `영상 ${vWait}편을 굽지 못하고 있어요`, desc: "내 PC 프로그램을 켜면 이어서 만들어요", link: "/app/runner.html", tone: "warn" });
      if (S.exportJob && S.exportJob.finishedAt && S.exportJob.url) todo.push({ kind: "setup", title: "내보내기가 준비됐어요", desc: `${UI.dateKST(S.exportJob.expiresAt)}까지 받을 수 있어요`, link: "/app/settings.html", tone: "info" }); // [P1R6]
      if (S.devices.some((d) => d.caps && d.caps.ffmpeg === false)) todo.push({ kind: "runner", title: "내 PC 프로그램에 ffmpeg 가 없어요", desc: "영상을 굽지 못해요 · 설치 안내 보기", link: "/app/runner.html", tone: "warn" });
      const stuck = S.posts.filter((p) => p.status === "awaiting_manual" || p.status === "failed").length;
      if (stuck) todo.push({ kind: "publish", title: `글 ${stuck}건이 올라가지 못했어요`, desc: "직접 올리거나 다시 올려 주세요", link: "/app/posts.html", tone: "warn" });
      if (S.reassigned) todo.push({ kind: "reassign", title: `@${S.reassigned.fromHandle} 계정이 정지됐어요`, desc: `글 ${S.reassigned.moved}건을 @${S.reassigned.toHandle} 로 옮겼어요`, link: "/app/accounts.html", tone: "warn" });
      if (review) { const one = review === 1 ? S.pieces.find((p) => p.status === "in_review") : null; todo.push({ kind: "review", title: `봐주실 글 ${review}건이 있어요`, desc: "내일 나가기 전에 확인해 주세요", link: one ? `/app/piece.html?id=${one.id}` : "/app/pieces.html", tone: "info" }); } // ★C fix: 1건이면 그 글로
      if (S.slots.some((s) => s.status === "no_topic" && s.date >= todayYmd)) todo.push({ kind: "slot_no_topic", title: "소재가 떨어졌어요", desc: "편성표에 자리는 있는데 쓸 소재가 없어요. «만들기»에서 소재를 새로 뽑아 주세요.", link: "/app/create.html", tone: "warn" }); // ★C fix: 소재는 create.html
      if (!S.accounts.length) todo.push({ kind: "setup", title: "첫 계정을 연결해 보세요", desc: "네이버 블로그·티스토리·유튜브 중 하나면 돼요", link: "/app/accounts.html", tone: "info" });
      else if (!S.rules.length) todo.push({ kind: "setup", title: "자동 편성을 켜 보세요", desc: "규칙 하나면 한 달치가 알아서 나가요", link: "/app/schedule.html", tone: "info" });
      const todaySlots = S.slots.filter((s) => s.date === todayYmd).map((s) => { const o = { id: s.id, channel: s.channel, status: s.status, publishAt: s.publishAt, handle: s.accountHandle, title: s.topicTitle }; if (s.pieceId) o.pieceId = s.pieceId; return o; });
      return { ok: true, revenue: revSummaryForHome(), todaySlots, todo, notices: [], unread: S.notifications.filter((n) => !n.readAt).length, auto: { enabled: S.settings.autoSchedule, rules: S.rules.filter((r) => r.active).length }, runner: { online, total: S.devices.length }, trial: trialOf(), coins: S.coins, impersonation: null }; },
    "tenant-settings": (b) => { if (typeof b.autoSchedule === "boolean") S.settings.autoSchedule = b.autoSchedule; return { ok: true, settings: S.settings }; },
    "plans": () => ({ ok: true, plans: PLANS.map((p) => ({ ...p })), trialDays: 14, coins: { krw: 500, packs: PACKS.map((k) => ({ ...k })), table: { blog: 1, image: 1, cardnews: 3, video_15: 6, video_30: 12, video_60: 28, persona: 15 }, labels: { blog: "글 1편", image: "사진 1장", cardnews: "카드뉴스", video_15: "15초 영상", video_30: "30초 영상", video_60: "60초 영상", persona: "페르소나" } } }),
    /* ── [P1R4] §1.2 구독 — B subscription.ts 모양(코드가 정본) ── */
    "subscription": () => { const B = S.billing; const paid = B.planKey !== "trial"; const p = PLANS.find((x) => x.key === B.planKey); const base = p ? (B.cycle === "year" ? p.priceYear : p.priceMonth) : 0;
      const o = { ok: true, plan: p ? { key: p.key, name: p.name, priceKrw: base, vatKrw: VAT(base), totalKrw: base + VAT(base), cycle: B.cycle } : { key: "trial", name: "체험", priceKrw: 0, vatKrw: 0, totalKrw: 0, cycle: B.cycle }, status: blocked || (paid ? "active" : "trial"), cancelAtPeriodEnd: B.cancelAtPeriodEnd, billingKey: B.billingKey ? { has: true, last4: B.billingKey.last4, brand: B.billingKey.brand } : { has: false }, vatNote: "부가세 별도" };
      o.keyin = keyinOption(); o.trialEndsAt = iso(now + (blocked ? -2 : 9) * 86400e3); if (B.periodEnd) o.periodEnd = B.periodEnd; if (B.nextBillingAt) o.nextBillingAt = B.nextBillingAt; if (B.pendingPlanKey) o.pendingPlanKey = B.pendingPlanKey; if (B.pendingCycle) o.pendingCycle = B.pendingCycle; return o; },
    "subscription-quote": (_b, q) => { const p = PLANS.find((x) => x.key === q.get("planKey")); if (!p) return err("planKey", "planKey"); const cycle = q.get("cycle") === "year" ? "year" : "month"; const base = cycle === "year" ? p.priceYear : p.priceMonth;
      return { ok: true, quote: { supplyKrw: base, vatKrw: VAT(base), totalKrw: base + VAT(base), discountPct: 0, source: "plan", baseKrw: base }, vatNote: "부가세 별도" }; },
    "subscription-change": (b) => { const B = S.billing; const p = PLANS.find((x) => x.key === b.planKey); if (!p) return err("plan", "고를 수 있는 요금제가 아니에요.");
      if (!B.paidTerms && b.agreePaidTerms !== true) return err("paid_terms", "유료 약관에 동의해 주세요."); if (b.agreePaidTerms === true) B.paidTerms = true;
      const cycle = b.cycle === "year" ? "year" : "month"; const rank = { trial: 0, starter: 1, pro: 2, agency: 3 }; const paying = B.planKey !== "trial" && !blocked;
      const charge = (supply) => { if (kiccOff) return { ok: false, step: "not_configured", error: "결제 준비 중이에요 · 곧 열려요", totalKrw: supply + VAT(supply) }; if (!B.billingKey) return { ok: false, step: "billing_key", error: "먼저 결제 수단을 등록해 주세요.", totalKrw: supply + VAT(supply) }; return null; };
      if (!paying) { const supply = cycle === "year" ? p.priceYear : p.priceMonth; const c = charge(supply); if (c) return c;
        B.planKey = p.key; B.cycle = cycle; B.pendingPlanKey = null; B.pendingCycle = null; B.periodStart = iso(Date.now()); B.periodEnd = iso(Date.now() + (cycle === "year" ? 365 : 30) * 86400e3); B.nextBillingAt = B.periodEnd; B.cancelAtPeriodEnd = false;
        const period = cycle === "year" ? `${todayYmd.slice(0, 7)}~${ymd(365).slice(0, 7)}` : todayYmd.slice(0, 7);
        B.invoices.unshift({ id: 9000 + S.nextId++, kind: "subscription", period, amountKrw: supply, vatKrw: VAT(supply), totalKrw: supply + VAT(supply), status: "paid", paidAt: iso(Date.now()), createdAt: iso(Date.now()), orderNo: "AC-SUB-" + period.replace(/[^0-9A-Za-z]/g, "") + "-1", planKey: p.key });
        S.coins += p.limits.coinsIncluded; S.billing.ledger.unshift({ at: iso(Date.now()), kind: "grant", bucket: "included", amount: p.limits.coinsIncluded, ref: "included:1:" + todayYmd.slice(0, 7), reason: "월 포함 코인", expiresAt: iso(Date.now() + 30 * 86400e3) });
        return { ok: true, effectiveAt: iso(Date.now()), pending: false, chargeNowKrw: supply, vatKrw: VAT(supply), totalKrw: supply + VAT(supply), invoiceId: B.invoices[0].id }; }
      if (p.key === B.planKey && cycle === B.cycle) return err("same", "지금 쓰는 요금제예요.");
      if (rank[p.key] < rank[B.planKey] || (p.key === B.planKey && cycle !== B.cycle)) { B.pendingPlanKey = p.key; B.pendingCycle = cycle; B.cancelAtPeriodEnd = false; return { ok: true, effectiveAt: B.periodEnd, pending: true }; }
      const cur = PLANS.find((x) => x.key === B.planKey); const days = B.cycle === "year" ? 365 : 30; const remain = Math.max(0, Math.ceil((new Date(B.periodEnd).getTime() - Date.now()) / 86400e3));
      const supply = Math.max(0, Math.floor(((B.cycle === "year" ? p.priceYear - cur.priceYear : p.priceMonth - cur.priceMonth) * remain) / days)); const c = charge(supply); if (c) return c;
      B.planKey = p.key; const period = `${B.periodStart.slice(0, 7)}:up-${p.key}`;
      if (supply > 0) B.invoices.unshift({ id: 9000 + S.nextId++, kind: "subscription", period, amountKrw: supply, vatKrw: VAT(supply), totalKrw: supply + VAT(supply), status: "paid", paidAt: iso(Date.now()), createdAt: iso(Date.now()), orderNo: "AC-SUB-" + period.replace(/[^0-9A-Za-z]/g, "") + "-1", planKey: p.key });
      return { ok: true, effectiveAt: iso(Date.now()), pending: false, chargeNowKrw: supply, vatKrw: VAT(supply), totalKrw: supply + VAT(supply), invoiceId: supply > 0 ? B.invoices[0].id : null }; },
    "subscription-cancel": (b) => { const B = S.billing; if (B.planKey === "trial") return err("state", "구독 중이 아니에요."); const on = b.atPeriodEnd !== false; B.cancelAtPeriodEnd = on; if (on) { B.pendingPlanKey = null; B.pendingCycle = null; } return { ok: true, periodEnd: B.periodEnd, cancelAtPeriodEnd: on }; },
    "billing-key-start": (b) => { if (kiccOff) return { ok: false, step: "not_configured", error: "결제 준비 중이에요 · 곧 열려요" };
      const route = (b && (b.payRoute === "keyin" || b.keyin === true) && keyinOn && keyinMid) ? "keyin" : "auth"; // 3조건 — 하나라도 아니면 조용히 인증 라인(§1.6(4))
      const orderNo = (route === "keyin" ? "AC-BKK-1-" : "AC-BK-1-") + Date.now().toString(36); S.billing.payRoute = route; return { ok: true, orderNo, url: "/mock-kicc?orderNo=" + orderNo, form: {} }; }, // 인증창 흉내 → UI.postForm(mock) 이 콜백까지 대신한다
    "billing-key-remove": () => { const had = !!S.billing.billingKey; S.billing.billingKey = null; return { ok: true, removed: had }; },
    "invoices": (_b, q) => { const y = q.get("year"); return { ok: true, rows: S.billing.invoices.filter((r) => !y || (r.paidAt || r.createdAt || "").startsWith(y)) }; },
    /* ── [P1R4] §1.1 코인 충전 — B coin-purchase.ts 모양(코드가 정본) ── */
    "coin-packs": () => { const used = S.billing.orders.some((o) => o.packId === "pack_trial" && o.status === "paid"); return { ok: true, packs: PACKS.map((k) => ({ id: k.id, krw: k.krw, coins: k.coins, bonusPct: k.bonusPct, oncePerTenant: !!k.oncePerTenant, active: true, vatKrw: VAT(k.krw), totalKrw: k.krw + VAT(k.krw), available: !(k.oncePerTenant && used) })), vatNote: "부가세 별도", keyin: keyinOption() }; },
    "coin-purchase-start": (b) => { const B = S.billing;
      if (!B.paidTerms && b.agreePaidTerms !== true) return err("paid_terms", "유료 약관에 동의해 주세요."); if (b.agreePaidTerms === true) B.paidTerms = true;
      const pk = PACKS.find((x) => x.id === b.packId); if (!pk) return err("pack", "충전 팩을 골라 주세요.");
      if (pk.oncePerTenant && B.orders.some((o) => o.packId === "pack_trial" && o.status === "paid")) return err("once", "첫 충전 팩은 한 번만 살 수 있어요. 다른 팩을 골라 주세요.");
      const vatKrw = VAT(pk.krw), totalKrw = pk.krw + vatKrw; if (kiccOff) return { ok: false, step: "not_configured", error: "결제 준비 중이에요 · 곧 열려요", amountKrw: pk.krw, vatKrw, totalKrw };
      const route = (b.payRoute === "keyin" || b.keyin === true) && keyinOn && keyinMid ? "keyin" : "auth"; // 조용한 폴백 — 화면엔 아무 말도 하지 않는다
      const orderNo = "AC-COIN-1-" + pk.id.replace(/^pack_/, "") + "-" + Date.now().toString(36); B.orders.unshift({ orderNo, packId: pk.id, coins: pk.coins, krw: pk.krw, vatKrw, totalKrw, status: "pending", paidAt: null, refundedAt: null, payRoute: route });
      if (B.billingKey) { settleCoin(orderNo); return { ok: true, orderNo, mode: "oneclick", amountKrw: pk.krw, vatKrw, totalKrw, coins: pk.coins, balance: S.coins, invoiceId: B.invoices[0].id }; } // ㉠ 원클릭 — 응답이 곧 결과
      return { ok: true, orderNo, mode: "auth", amountKrw: pk.krw, vatKrw, totalKrw, coins: pk.coins, pay: { url: "/mock-kicc?orderNo=" + orderNo, form: {} } }; },                                   // ㉡ 인증창 → 콜백
    "coin-history": (_b, q) => { const m = q.get("month"); const rows = S.billing.ledger.filter((l) => !m || l.at.slice(0, 7) === m).map((l) => ({ ...l })); const purchased = S.billing.ledger.filter((l) => l.bucket === "purchased").reduce((a, l) => a + l.amount, 0);
      return { ok: true, rows, balance: { included: Math.max(0, S.coins - Math.max(0, purchased)), purchased: Math.max(0, purchased), total: S.coins } }; },
    "coin-refund-request": (b) => { const o = S.billing.orders.find((x) => x.orderNo === b.orderNo); const quote = refundQuote(o, b.orderNo);
      if (b.quoteOnly === true) return { ok: true, quote };
      if (!quote.eligible) return { ok: false, step: "quote", reason: quote.reason, error: REFUND_KO[quote.reason], quote, status: 400 };
      if (kiccOff) return { ok: false, step: "not_configured", error: "결제 준비 중이라 환불도 아직이에요 · 곧 열려요", quote };
      o.status = "refunded"; o.refundedAt = iso(Date.now()); S.coins -= quote.unusedCoins; S.billing.ledger.unshift({ at: o.refundedAt, kind: "revoke", bucket: "purchased", amount: -quote.unusedCoins, ref: o.orderNo, reason: `환불 회수(₩${quote.maxRefundKrw.toLocaleString("ko-KR")} · 미사용 ${quote.unusedCoins}코인)` });
      const inv = S.billing.invoices.find((r) => r.kind === "coin" && r.period === o.orderNo); if (inv) { inv.refundedKrw = quote.maxRefundKrw; if (quote.maxRefundKrw >= inv.totalKrw) inv.status = "refunded"; }
      S.notifications.unshift({ id: S.nextId++, kind: "coin_refunded", title: "환불이 처리됐어요", desc: `${quote.maxRefundKrw.toLocaleString("ko-KR")}원을 돌려드렸어요(미사용 ${quote.unusedCoins}코인 회수). 카드사 사정에 따라 3~5일 걸릴 수 있어요.`, link: "/app/coins.html", tone: "info", createdAt: iso(Date.now()) });
      return { ok: true, refundKrw: quote.maxRefundKrw, revoked: quote.unusedCoins, invoiceId: inv ? inv.id : null }; },
    /* ── [P1R6] §2.1 내보내기(배경 작업 · 202 + 폴링 · 준비되면 알림·해야 할 일) ── */
    "export-start": (b) => { const nw = notWritable(); if (nw) return nw; const kinds = Array.isArray(b.kinds) && b.kinds.length ? b.kinds : ["post", "video", "revenue"];
      if (S.exportJob && !S.exportJob.finishedAt) return { ok: true, started: false, running: true };
      S.exportJob = { startedAt: iso(Date.now()), kinds, from: b.from || null, to: b.to || null, _t0: Date.now() }; return { ok: true, started: true, status: 202 }; },
    "export-status": () => { const j = S.exportJob; if (!j) return { ok: true, running: false };
      if (exportFail) return { ok: true, running: false, startedAt: j.startedAt, error: "자료가 너무 많아 다 담지 못했어요. 기간을 좁혀 주세요." }; // 쓰면서 세다 멈춘 사유(서버 문장)
      if (!j.finishedAt && !exportRunning && Date.now() - j._t0 > 6000) { j.finishedAt = iso(Date.now()); j.bytes = 18_400_000; j.url = "data:text/plain;charset=utf-8,AutoCreate%20export%20(mock)"; j.expiresAt = iso(Date.now() + 7 * 86400e3);
        S.notifications.unshift({ id: S.nextId++, kind: "export_ready", title: "내보내기가 준비됐어요", desc: "7일 안에 받아 주세요 · 글 · 영상 · 수익(KST)", link: "/app/settings.html", tone: "info", createdAt: iso(Date.now()) }); }
      const o = { ok: true, running: !j.finishedAt, startedAt: j.startedAt }; if (j.finishedAt) { o.finishedAt = j.finishedAt; o.url = j.url; o.expiresAt = j.expiresAt; o.bytes = j.bytes; } return o; },
    /* ── [P1R6] §2.2 공유 카드 — 서버 렌더 · 핸들·채널 이름은 꺼짐이 기본 · 수익 0원이면 카드 없음 ── */
    "share-card": (_b, q) => { const month = q.get("month") || todayYmd.slice(0, 7);
      if (shareOff || revEmpty) return err("empty", "이 달엔 아직 자랑할 게 없어요.");
      const handles = q.get("handles") === "1", channels = q.get("channels") === "1";
      return { ok: true, imageUrl: shareImg(month, handles, channels), expiresAt: iso(Date.now() + 24 * 3600e3), month, handles, channels }; },
    /* ── [P1R6] §1.1 추천인 ── */
    "referral": () => ({ ok: true, ...S.referral }),
    /* ── [P1R6] §1.2 영수증(공급자 정보는 운영센터 «회사 정보» 한 출처 · 없으면 null → 화면 «준비 중») ── */
    "invoice": (_b, q) => { const id = Number(q.get("id")); const inv = S.billing.invoices.find((x) => x.id === id); if (!inv) return err("not_found", "청구서를 찾을 수 없어요.", { status: 404 });
      return { ok: true, invoice: { ...inv, taxInvoice: inv.taxInvoice || { status: "none" } }, supplier: supplierOff ? null : SUPPLIER }; },
    "tax-profile": (b) => { if (b && (b.bizNo || b.bizName || b.email)) { S.taxProfile = { bizNo: String(b.bizNo || "").trim(), bizName: String(b.bizName || "").trim(), email: String(b.email || "").trim() }; return { ok: true, profile: S.taxProfile }; }
      return { ok: true, profile: S.taxProfile }; },
    "tax-invoice-request": (b) => { const inv = S.billing.invoices.find((x) => x.id === Number(b.invoiceId)); if (!inv) return err("not_found", "청구서를 찾을 수 없어요.", { status: 404 });
      if (!/^\d{3}-?\d{2}-?\d{5}$/.test(String(b.bizNo || "").trim())) return err("bizNo", "사업자등록번호 10자리를 확인해 주세요.");
      if (!String(b.bizName || "").trim()) return err("bizName", "상호를 적어 주세요."); if (!/@/.test(String(b.email || ""))) return err("email", "받으실 메일 주소를 확인해 주세요.");
      inv.taxInvoice = { status: "requested", requestedAt: iso(Date.now()) }; S.taxProfile = { bizNo: b.bizNo, bizName: b.bizName, email: b.email };
      return { ok: true, taxInvoice: inv.taxInvoice }; },
    /* ── [P1R6] §3.1 관리형 러너 신청(플랜 게이트 · 요금은 서버 값) ── */
    "managed-runner": (b) => { if (b && b.devices !== undefined) {
        if (managedDeny) return { ok: false, reason: "plan_limit", step: "plan_feature", feature: "managedRunner", planKey: "starter", error: "대신 돌려주는 PC는 지금 요금제에 없어요. Pro 로 바꾸면 쓸 수 있어요.", status: 402 };
        const n = Math.max(1, Math.min(5, Number(b.devices) || 1)); S.managed = { status: "requested", assigned: 0, devices: n, requestedAt: iso(Date.now()) };
        S.notifications.unshift({ id: S.nextId++, kind: "setup", title: "대신 돌려주는 PC를 신청했어요", desc: "운영자가 확인하고 배정해 드려요 · 보통 하루 안에", link: "/app/runner.html", tone: "info", createdAt: iso(Date.now()) });
        return { ok: true, status: S.managed.status, devices: n }; }
      if (managedDeny) return { ok: true, eligible: false, reason: "plan_feature", price: { amountKrw: 30000, vatKrw: 3000, totalKrw: 33000 }, status: "none", assigned: 0, max: 5 };
      return { ok: true, eligible: true, price: { amountKrw: 30000, vatKrw: 3000, totalKrw: 33000 }, status: S.managed.status, assigned: S.managed.assigned, devices: S.managed.devices, max: 5 }; },
    /* ── [P1R6] §1.4 AM↔AC 코인 이전(키 없으면 준비 중 · 부분 성공 금지) ── */
    "coin-transfer": (b) => { const nw = notWritable(); if (nw) return nw;
      if (amOff) return { ok: false, step: "not_configured", error: "아직 준비 중이에요 · 곧 열려요", status: 200 };
      const n = Math.max(1, Math.floor(Number(b.coins) || 0)); if (!n) return err("coins", "가져올 코인 수를 골라 주세요.");
      if (n > 200) return err("limit", "한 번에 200코인까지 가져올 수 있어요.");
      const ref = "transfer:AM:AM-" + Date.now().toString(36); S.coins += n;
      S.billing.ledger.unshift({ at: iso(Date.now()), kind: "grant", bucket: "purchased", amount: n, ref, reason: "AM 에서 가져온 코인", expiresAt: iso(Date.now() + 365 * 86400e3) });
      return { ok: true, coins: n, balance: S.coins, ref }; },
    /* ── [P1R4] §2.1 문의 · FAQ · 공지 · 첨부 ── */
    "support-ticket": (b) => { if (!String(b.subject || "").trim()) return err("subject", "한 줄로 무엇이 막히는지 적어 주세요."); if (!String(b.text || "").trim()) return err("text", "조금 더 자세히 적어 주세요."); const id = S.nextId++; S.tickets.unshift({ id, subject: b.subject, status: "open", createdAt: iso(Date.now()), updatedAt: iso(Date.now()), attachments: b.attachments || [], messages: [{ from: "customer", text: b.text, at: iso(Date.now()) }, { from: "system", text: "자동 첨부 · 플랜 trial · 내 PC 프로그램 0/1 · 최근 오류 1건", at: iso(Date.now()) }] }); return { ok: true, id, status: 201 }; },
    "support-tickets": () => ({ ok: true, tickets: S.tickets.map((t) => ({ id: t.id, subject: t.subject, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt, rating: t.rating, messages: t.messages })) }),
    "support-rate": (b) => { const t = S.tickets.find((x) => x.id === Number(b.id)); if (!t) return err("id", "문의가 없어요.", { status: 404 }); t.rating = !!b.helpful; return { ok: true }; },
    "faqs": () => ({ ok: true, faqs: [{ id: 1, q: "코인은 언제까지 쓸 수 있나요?", a: "충전한 코인은 1년, 플랜에 포함된 코인은 그달 말까지예요." }, { id: 2, q: "네이버·티스토리는 왜 내 PC 프로그램이 필요한가요?", a: "두 곳은 바깥에서 글을 넣는 길이 없어서 PC 프로그램이 대신 올려요." }, { id: 3, q: "환불은 어떻게 되나요?", a: "미사용 코인은 충전 후 7일 안에 환불돼요. 구독은 기간 말에 해지돼요." }] }),
    "upload": (b) => { if (!b.dataBase64 || !b.contentType) return err("file", "사진을 골라 주세요."); if (String(b.dataBase64).length > 4e6) return err("size", "3MB 이하 사진만 붙일 수 있어요."); return { ok: true, key: "autocreate/1/support/" + Date.now() + "-" + String(b.filename || "img").replace(/[^\w.-]/g, "_"), url: "" }; },
    "notices": () => ({ ok: true, notices: qs.get("incident") === "0" ? [] : [{ id: 801, kind: "incident", title: "네이버 발행이 늦어요 · 네이버 쪽 점검", body: "14:00 부터 네이버 블로그 발행이 30분쯤 밀리고 있어요. 예약은 그대로 나가요.", startsAt: iso(now - 2 * 3600e3), endsAt: iso(now + 4 * 3600e3), channels: ["naver_blog"] }, { id: 802, kind: "notice", title: "9월 25일 새벽 2시 점검(10분)", startsAt: iso(now - 3600e3), endsAt: iso(now + 11 * 86400e3) }] }),
    /* §1 계정 */
    "accounts-list": () => ({ ok: true, accounts: S.accounts.map((a) => ({ ...a })), channels: CHANNELS }),
    "accounts-add": (b) => {
      if (/쿠팡|coupang/i.test(b.handle || "")) return err("handle_policy", "채널 이름에 «쿠팡»을 쓸 수 없어요(파트너스 정책).");
      if (planLimit === "accounts") return { ok: false, reason: "plan_limit", step: "plan_limit", resource: "accounts", used: S.accounts.length, limit: 3, planKey: "starter", error: "계정은(는) 3개까지예요. Pro 로 바꾸면 더 늘어나요.", status: 402 };
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
    "topics-reference": (b) => { const url = String(b.url || "").trim(); if (!/^https?:\/\/\S+$/.test(url)) return err("url", "쇼츠·릴스 링크를 붙여 주세요."); if (S.templates.filter((x) => x.createdAt.slice(0, 10) === todayYmd).length >= 3) return err("limit", "오늘은 3개까지 배울 수 있어요. 내일 다시 해 주세요.");
      const tpl = { id: S.nextId++, name: /youtube|youtu\.be/.test(url) ? "비포·애프터 반전 (60초)" : "생활밀착 3단계 (30초)", sourceUrl: url, structure: ["3초 훅: 결과 먼저 보여 주기", "문제 한 줄", "해결 3단계", "엔드카드 · 설명란 링크"], hook: "twist", style: { palette: "ink", captions: "keyword_center", pace: "fast" }, createdAt: iso(Date.now()) };
      S.templates.push(tpl); const tp = S.topics.find((x) => x.status === "candidate" && VIDEO_CH.includes(x.channelHint)) || S.topics.find((x) => x.status === "candidate"); if (tp) tp.factors.structureTemplateId = tpl.id; return { ok: true, template: tpl }; }, // [P1R5] §1.11 · 코인 0 · 하루 3회
    "topics-list": () => { refreshTick(); const t = S.topicsRefresh;
      const refresh = { running: isRefreshing() };
      if (t) { if (t.startedAt) refresh.startedAt = t.startedAt; if (t.finishedAt) refresh.finishedAt = t.finishedAt; if (t.added != null) refresh.added = t.added; if (t.error) refresh.error = t.error; }
      return { ok: true, topics: S.topics.filter((x) => x.status === "candidate"), templates: S.templates.map((x) => ({ ...x })), refreshedAt: t?.finishedAt || iso(now - 7200e3), refresh }; }, // [P1R5] templates(레퍼런스 구조) 동봉
    "topics-refresh": () => { const nw = notWritable(); if (nw) return nw; if (aiCap) return { ok: false, step: "ai_cost_cap", error: "오늘 AI 사용 상한(3,000원)에 닿았어요. 내일 다시 이어서 만들 수 있어요." }; refreshTick();
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
      const yt = S.accounts.find((a) => VIDEO_CH.includes(a.channel) && a.status === "active"); // [P1R5] 영상 계정이 있으면 같은 brief 에 영상 piece(§1.1 채널 선택)
      if (yt) pieces.push({ key: "p3", kind: "video", channel: yt.channel, accountId: yt.id, accountHandle: yt.handle, emotionKey: "shorts", angle: "3초 훅 · 비포/애프터", video: videoSpec(0, yt.id, 60, "graphic"), monetize: { affiliate: t.factors.intent !== "info" ? { provider: "coupang", productQuery: "에어프라이어 세척솔", slot: "end" } : null, adDisclosure: true }, schedule: { at: kst(1, 18, 0), slotReason: "쇼츠 저녁 골든타임 18시 · @" + yt.handle + " 오늘 0/" + yt.dailyCap }, coinCost: VIDEO_COIN.video_60 });
      if (!pieces.length) pieces.push({ key: "p1", channel: "naver_blog", accountId: null, accountHandle: null, format: "story", emotionKey: "warm", composition: "experience", lengthHint: { words: 1400 }, images: { count: 6, style: "photo", heroNeeded: true }, monetize: { affiliate: null, adDisclosure: false }, schedule: { at: kst(1, 7, 30), slotReason: "네이버 블로그 아침 골든타임 · 계정은 연결 후 배정" }, coinCost: 7 });
      const brief = { id: S.nextId++, topicId: t.id, goal: "mixed", mode: "reviewed", coinCost: pieces.reduce((a, p) => a + p.coinCost, 0), coinsLeft: S.coins, reasons: ["검색량 " + UI.num(t.factors.volume || 0) + "에 경쟁이 낮아 경험담이 먼저 노출돼요", "같은 소재를 계정마다 다른 구성(경험담·비교표)으로 갈라 유사도 게이트를 지켜요", "쓰는 코인은 글 1 + 사진 수예요 · 다시 만들기는 무료"].concat(pieces.some((p) => p.kind === "video") ? [`쇼츠 60초 · 그래픽 스토리 · @${pieces.find((p) => p.kind === "video").accountHandle} 는 훅 «반전»으로 시작해요 · 영상 28코인(재렌더 무료)`] : []), pieces, voices: VOICES }; // [제안] 목소리 목록은 brief.voices
      S.briefs[brief.id] = brief; return { ok: true, brief }; },
    "director-confirm": (b) => { const nw = notWritable(); if (nw) return nw; if (aiCap) return { ok: false, step: "ai_cost_cap", error: "오늘 AI 사용 상한(3,000원)에 닿았어요. 내일 다시 이어서 만들 수 있어요." }; const br = S.briefs[b.briefId]; if (!br) return err("not_found", "제안을 찾을 수 없어요.", { status: 404 });
      let pieces = br.pieces.map((p) => ({ ...p })); for (const patch of b.pieces || []) { const i = pieces.findIndex((p) => p.key === patch.key); if (i < 0) continue; if (patch.drop) { pieces.splice(i, 1); continue; }
        const p = pieces[i]; if (patch.accountId !== undefined) { p.accountId = patch.accountId; p.accountHandle = S.accounts.find((a) => a.id === patch.accountId)?.handle || null; } if (patch.format) p.format = patch.format; if (patch.emotionKey) p.emotionKey = patch.emotionKey;
        if (patch.images && p.images) Object.assign(p.images, patch.images); if (patch.monetize && "affiliate" in patch.monetize) p.monetize.affiliate = patch.monetize.affiliate ? { provider: "coupang", ...patch.monetize.affiliate } : null; if (patch.schedule?.at) p.schedule.at = patch.schedule.at;
        if (p.kind === "video") { const v = patch.video || {}; if (v.format) p.video.format = v.format; if (v.seconds) p.video.seconds = Number(v.seconds); if (v.cuts) p.video.cuts = Number(v.cuts); if (v.voiceId) { p.video.voice.voiceId = v.voiceId; p.video.variant.voiceId = v.voiceId; } if (v.palette) p.video.variant.palette = v.palette; if (v.hookType) p.video.variant.hookType = v.hookType; p.coinCost = VIDEO_COIN[videoCoinItem(p.video.seconds)]; } else p.coinCost = 1 + p.images.count; } // [P1R5] PieceSpecPatch.video · 코인 = videoCoinItem(seconds)
      if (videoBudget === "0" && pieces.some((p) => p.kind === "video")) return { ok: false, step: "budget", error: "이번 달 영상 제작 한도에 닿았어요. 다음 달에 다시 만들 수 있어요." }; // §1.2 달러 캡 선검사(코인 차감 전)
      const need = pieces.reduce((a, p) => a + p.coinCost, 0); if (need > S.coins) return err("coin_short", `코인이 ${need - S.coins}개 부족해요.`, { need, have: S.coins });
      if (br._charged) return { ok: true, briefId: br.id, pieceIds: br._pieceIds, coinsCharged: 0, coinsLeft: S.coins, status: 202 };
      S.coins -= need; const ids = []; const t = S.topics.find((x) => x.id === br.topicId);
      for (const p of pieces) { const id = S.nextId++; ids.push(id);
        if (p.kind === "video") { S.pieces.push({ id, channel: p.channel, accountHandle: p.accountHandle, kind: "video", title: t?.title || "새 영상", status: "generating", scheduledFor: p.schedule.at, gateOk: false, createdAt: iso(Date.now()), topicTitle: t?.title, regenCount: 0, coinCost: p.coinCost, bodyHtml: "", meta: { stage: "script", chainStage: { stage: "script", at: iso(Date.now()) }, video: p.video, angle: p.angle, emotionKey: p.emotionKey, scheduleAt: p.schedule.at, tags: [], disclosure: p.monetize.affiliate ? DISCLOSURE : null, affiliate: p.monetize.affiliate ? { provider: "coupang", url: "https://link.coupang.com/a/mock", subId: "piece" + id } : undefined, chainLock: null, chainResume: { count: 0 } }, gate: null, _v0: Date.now() });
          S.slots.push({ id: S.nextId++, date: p.schedule.at ? new Date(new Date(p.schedule.at).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : todayYmd, channel: p.channel, kind: "shorts", accountId: p.accountId, accountHandle: p.accountHandle, status: "producing", publishAt: p.schedule.at, topicTitle: t?.title, pieceId: id, origin: "manual" }); continue; } // [P1R5] §1.2 kind video 행 + slot(shorts)
        S.pieces.push({ id, channel: p.channel, accountHandle: p.accountHandle, kind: "post", format: p.format, title: t?.title || "새 글", status: "generating", stage: "writing", scheduledFor: p.schedule.at, gateOk: false, createdAt: iso(Date.now()), topicTitle: t?.title, regenCount: 0, bodyHtml: p.channel === "tistory" ? BODY_TISTORY : BODY_NAVER, meta: { tags: ["에어프라이어청소"], disclosure: p.monetize.affiliate ? DISCLOSURE : null, affiliate: p.monetize.affiliate ? { provider: "coupang", url: "https://link.coupang.com/a/mock", subId: "piece" + id } : undefined }, gate: gate(true), _t0: Date.now() });
        S.slots.push({ id: S.nextId++, date: p.schedule.at ? new Date(new Date(p.schedule.at).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : todayYmd, channel: p.channel, kind: "post", accountId: p.accountId, accountHandle: p.accountHandle, status: "producing", publishAt: p.schedule.at, topicTitle: t?.title, pieceId: id, origin: "manual" }); }
      if (t) t.status = "picked"; br._charged = true; br._pieceIds = ids; return { ok: true, briefId: br.id, pieceIds: ids, coinsCharged: need, coinsLeft: S.coins, status: 202 }; },
    /* §4 글 */
    "pieces-list": (_b, q) => { tick(); const st = q.get("status") || "all"; const list = S.pieces.filter((p) => st === "all" || p.status === st || (st === "generating" && p.status === "draft")); return { ok: true, pieces: list.map(pieceRow).sort((a, b) => b.id - a.id) }; },
    "pieces-get": (_b, q) => { tick(); const p = S.pieces.find((x) => x.id === Number(q.get("id"))); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 }); const withDisc = (h) => { const clean = h.replace(/^\s*<div class="disclosure">[\s\S]*?<\/div>\s*/, ""); return p.meta.disclosure ? `<div class="disclosure">${p.meta.disclosure}</div>
${clean}` : clean; }; // 고지 = bodyHtml 첫 요소(발행물 정본) · meta.disclosure 는 미러
      if (p.kind === "video") return { ok: true, piece: { ...pieceRow(p), body: p.body || "", blocks: p.blocks || [], assets: p.assets || [], meta: p.meta, gate: p.gate, topicTitle: p.topicTitle, regenCount: p.regenCount, failReason: p.failReason } }; // [P1R5] 영상 = body(설명란 · 첫 줄 고지) + blocks(video·srt·hashtags) + assets(url) + gate.judge
      return { ok: true, piece: { ...pieceRow(p), bodyHtml: withDisc(p.bodyHtml), blocks: bodyToBlocks(p), images: [{ url: "", caption: "10분 담가 둔 바스켓", sort: 0 }], meta: p.meta, gate: p.gate, topicTitle: p.topicTitle, regenCount: p.regenCount } }; },
    "pieces-approve": (b) => { const nw = notWritable(); if (nw) return nw; const p = S.pieces.find((x) => x.id === Number(b.id)); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 }); if (p.kind === "video" && p.gate?.judge?.grade === "P0") return err("gate", "심사에서 막혔어요 · 다시 만들거나 버려 주세요.", { gate: p.gate }); if (!p.gateOk) return err("gate", "발행 전 확인이 필요해요.", { gate: p.gate }); p.status = "scheduled"; tick(); return { ok: true, status: "scheduled", scheduledFor: p.scheduledFor }; },
    "pieces-reject": (b) => { const p = S.pieces.find((x) => x.id === Number(b.id)); if (p) p.status = "rejected"; return { ok: true, status: "rejected" }; },
    "pieces-regenerate": (b) => { const nw = notWritable(); if (nw) return nw; const p = S.pieces.find((x) => x.id === Number(b.id)); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 }); if (p.regenCount >= 1) return err("regen_limit", "다시 만들기는 한 번만 할 수 있어요."); p.regenCount++; p.status = "generating"; if (p.kind === "video") { p.meta.stage = "script"; p.meta.chainStage = { stage: "script", at: iso(Date.now()) }; p.gate = null; p.gateOk = false; delete p.assets; delete p.blocks; p.body = ""; /* 산출물 삭제 — 안 지우면 이어받기가 «이미 있음»으로 건너뛴다 */ delete p._t0; p._v0 = Date.now(); const sl = S.slots.find((s) => s.pieceId === p.id); if (sl) sl.status = "producing"; return { ok: true, status: "generating" }; } p.stage = "writing"; p._t0 = Date.now(); return { ok: true, status: "generating" }; }, // [P1R5] 영상 재생성 = 코인 0 · 처음부터
    "pieces-update": (b) => { const p = S.pieces.find((x) => x.id === Number(b.id)); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 }); if (b.title) p.title = b.title;
      if (p.kind === "video") { if (typeof b.body === "string") { const first = String(p.body || "").split("\n")[0]; const rest = b.body.split("\n").filter((l, i) => !(i === 0 && l === first)); p.body = p.meta.video.disclosure.descriptionFirstLine ? [first, ...rest].join("\n") : b.body; } if (Array.isArray(b.tags)) { p.meta.tags = b.tags.map((x) => String(x).replace(/^#/, "")).filter(Boolean).slice(0, 15); const hb = (p.blocks || []).find((x) => x.type === "hashtags"); if (hb) hb.tags = p.meta.tags; } return { ok: true, gate: p.gate, body: p.body, tags: p.meta.tags }; } // [P1R5] 설명란 편집 · 첫 줄 고지는 서버가 잠근다 if (b.bodyHtml) p.bodyHtml = b.bodyHtml.replace(/^\s*<div class="disclosure">[\s\S]*?<\/div>\s*/, ""); p.gate = gate(true); p.gateOk = true;
      const body = p.meta.disclosure ? `<div class="disclosure">${p.meta.disclosure}</div>
${p.bodyHtml}` : p.bodyHtml; return { ok: true, gate: p.gate, bodyHtml: body }; },
    /* §5 규칙·슬롯 */
    "rules-list": () => ({ ok: true, rules: S.rules, settings: S.settings, coinsPerWeek: coinsPerWeek(), maxRules: 3 }),
    "rules-save": (b) => { if ((b.rules || []).filter((r) => r.active !== false).length > 3) return err("limit", "이 요금제에서는 규칙을 3개까지 만들 수 있어요."); const before = S.slots.length; S.rules = (b.rules || []).map((r, i) => ({ id: r.id || S.nextId++, kind: "post", active: true, ...r })); S.slots = S.slots.filter((s) => s.origin === "manual" || S.rules.some((r) => r.channel === s.channel)); rollSlots(); return { ok: true, rules: S.rules, coinsPerWeek: coinsPerWeek(), slotsCreated: S.slots.length - before }; },
    "rules-settings": (b) => { for (const k of ["autoSchedule", "horizonDays", "topicLeadDays", "produceLeadDays", "produceHour", "reviewPolicy", "bestTimeMode", "weeklyCoinCap", "quietDays"]) if (b[k] !== undefined) S.settings[k] = b[k]; S.slots = S.slots.filter((s) => s.origin === "manual" || !(S.settings.quietDays || []).includes(s.date)); rollSlots(); return { ok: true, settings: S.settings }; },
    "slots-list": (_b, q) => { tick(); const from = q.get("from") || "0000", to = q.get("to") || "9999"; return { ok: true, slots: S.slots.filter((s) => s.date >= from && s.date <= to).sort((a, b) => (a.publishAt || "").localeCompare(b.publishAt || "")) }; },
    "slots-skip": (b) => { const s = S.slots.find((x) => x.id === Number(b.id)); if (s) s.status = "skipped"; return { ok: true }; },
    /* ── [P1R2] §6 슬롯 3동작 ── */
    "slots-assign-topic": (b) => { if (bannedTopic) return err("banned_category", "도박·사행성 주제는 만들 수 없어요."); tick(); const s = S.slots.find((x) => x.id === Number(b.slotId)); if (!s) return err("not_found", "편성을 찾을 수 없어요.", { status: 404 });
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
    "slots-produce-now": (b) => { const nw = notWritable(); if (nw) return nw; tick(); const s = S.slots.find((x) => x.id === Number(b.slotId)); if (!s) return err("not_found", "편성을 찾을 수 없어요.", { status: 404 });
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
    "coins-balance": () => { const purchased = Math.max(0, S.billing.ledger.filter((l) => l.bucket === "purchased").reduce((a, l) => a + l.amount, 0)); return { ok: true, balance: S.coins, included: Math.max(0, S.coins - purchased), purchased, recent: S.billing.ledger.slice(0, 20).map((l) => ({ kind: l.kind, delta: l.amount, item: l.item, reason: l.reason, createdAt: l.at })) }; },
  };

  const real = UI.api;
  UI.api = async function (path, opts = {}) {
    const u = new URL(path, location.origin); const name = u.pathname.replace(/^\/api\//, "");
    const h = R[name]; if (!h) return real(path, opts);
    await delay(); const r = h(opts.body || {}, u.searchParams); save();
    const status = r.status || 200; const out = { ...r, status, ok: !!r.ok }; if (!opts.noGate && UI.gate(out)) out.gated = true; return out; // 실서버 UI.api 와 같은 게이트 처리
  };
  /* 링크·이동에 mock=1 이어 붙이기 */
  const KEEP = ["runner", "refreshMs", "refreshFail", "revEmpty", "revError", "trial", "readonly", "suspended", "planLimit", "kicc", "incident", "imp", "payFail", "fp", "aiCap", "banned", "stage", "judge", "noFfmpeg", "uploaded", "videoBudget", "keyin", "keyinMid", "supplier", "share", "managed", "export", "amOff", "mail", "verified", "mailFail", "payReason"]; // 모의 전용 손잡이는 화면 왕복 중에도 유지(fresh·reset 은 일부러 제외)
  const withMock = (href) => { try { const u = new URL(href, location.origin); if (u.origin !== location.origin || !(u.pathname.startsWith("/app/") || ["/onboarding.html", "/receipt.html", "/register.html"].includes(u.pathname))) return href; u.searchParams.set("mock", "1"); for (const k of KEEP) if (qs.has(k)) u.searchParams.set(k, qs.get(k)); return u.pathname + u.search + u.hash; } catch { return href; } };
  UI.go = (href) => location.assign(withMock(href));
  UI.postForm = (url) => { const u = new URL(url, location.origin); if (u.pathname !== "/mock-kicc") return location.assign(url); const orderNo = u.searchParams.get("orderNo") || ""; const fail = qs.get("payFail") === "1";
    const reason = qs.get("payReason") || "approve"; // 실측 어휘: params · approve · pg · cancelled · 거절 코드(8373)
    if (orderNo.startsWith("AC-BK-") || orderNo.startsWith("AC-BKK-")) { if (!fail) S.billing.billingKey = { brand: "신한", last4: "4421" }; save(); return location.assign(withMock(`/app/plan.html?key=${fail ? "fail&reason=" + encodeURIComponent(reason) : "ok"}${!fail && qs.get("fp") === "reused" ? "&trial=reused" : ""}`)); }
    if (fail) { const o = S.billing.orders.find((x) => x.orderNo === orderNo); if (o) o.status = "failed"; save(); return location.assign(withMock("/app/coins.html?failed=" + encodeURIComponent(reason === "cancelled" ? "결제가 취소됐어요" : "카드사 응답: 거절") + "&reason=" + encodeURIComponent(reason))); }
    settleCoin(orderNo); save(); location.assign(withMock("/app/coins.html?charged=" + encodeURIComponent(orderNo))); };
  document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("a[href]"); if (!a) return; const h = a.getAttribute("href"); if (!h || h.startsWith("javascript:") || h.startsWith("#")) return; const m = withMock(h); if (m !== h) a.setAttribute("href", m); }, true);
  const badge = document.createElement("div"); badge.textContent = "모의 데이터"; badge.style.cssText = "position:fixed;bottom:calc(var(--tab-h) + 6px);left:8px;z-index:99;font-size:10px;font-weight:700;color:var(--muted);background:var(--press);border-radius:6px;padding:2px 6px;pointer-events:none"; document.body.appendChild(badge);
})();
