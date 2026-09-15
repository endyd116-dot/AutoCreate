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
  const MOCK_V = 8;   // 🔴 모의 상태 판 — 올리면 옛 상태를 버리고 다시 뿌린다. **한 곳에만 적는다**(seed 와 판정이 갈리면 왕복마다 상태가 초기화된다 · 2026-09-15 에 한 번 겪었다)
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const kst = (dayOffset, h, m = 0) => { const d = new Date(now + 9 * 3600e3); d.setUTCDate(d.getUTCDate() + dayOffset); d.setUTCHours(h, m, 0, 0); return new Date(d.getTime() - 9 * 3600e3).toISOString(); };
  const ymd = (dayOffset) => { const d = new Date(now + 9 * 3600e3); d.setUTCDate(d.getUTCDate() + dayOffset); return d.toISOString().slice(0, 10); };
  const todayYmd = ymd(0);
  const CH_LABEL = { naver_blog: "네이버 블로그", naver_clip: "네이버 클립", tistory: "티스토리", blogger: "블로거", wordpress: "워드프레스", threads: "스레드", instagram: "인스타그램", reels: "릴스", youtube_shorts: "유튜브 쇼츠", tiktok: "틱톡" };
  const vdlKnob = qs.get("vdl") || "";            // [R7 §1.3] none = 아직 렌더 전(no_render) · 기본 = 10분 링크
  const estKnob = qs.get("est") === "1";          // [B2] «예상수입» 도장이 찍힌 매체가 섞인 달
  const slotsKnob = qs.get("slots") || "";        // [R7 §3.6] none·waiting·active·paused — 계정 슬롯 상태
  const slotCoinsShort = qs.get("slotCoins") === "0";
  const usedSlotOn = qs.get("usedSlot") !== "0";   // [R7 §1.6] 사람이 만들면 오늘 자리를 쓴다(기본) · 0 이면 예전처럼 새 자리
  const slotRace = qs.get("slotRace") === "1";      // 제안엔 «오늘 자리»가 있었는데 확정 사이에 그 자리가 찼다(확정 응답에 usedTodaySlot 없음 = 확정이 정본)
  const judgePending = qs.get("judgePending") === "1";   // [R7 §1.5] 못 잰 축(보류)이 있는 심사표
  const planKnob = qs.get("plan") || "";
  const keptAuto = qs.get("kept") === "1";       // [R7 §4.3] 이미 «조용하면 발행»로 저장해 둔 Starter 집(소급 0)          // [R7 §4.3] starter = 자동 승인 불가(autoApprove false · 포함분 40)
  const oneChannel = qs.get("oneCh") === "1";   // [사장님 실측] 네이버 계정만 있는 집 — 소재가 전부 한 채널
  const avatarOn = qs.get("avatar") === "1";   /* [R8 §5.3] 계정 사진이 들어온 집(유튜브 연결 때 자동으로 온다) — 🔴 없는 계정과 나란히 둬서 «있음/없음»이 다르게 보이는지 본다 */
  const closedKnob = qs.get("closed") === "1";  // [R7 §3.1] 이미 탈퇴를 신청해 둔 집(파기 예약 중)
  const gateKnob = qs.get("gate") || "";        // [R8-A] soft = 골격 반복이 걸린 글(막지 않는다) · adpoint = 광고 가리킴(막는다)
  /* [R8-A §2 · B-1 d6c2359] `topicGroup`·`goal`·`contract` 를 서버가 준다(pieces-get).
     값은 서버 어휘 그대로(TopicGroup·RevenueGoal). */
  const clipPiece = qs.get("clip") === "1";    // [R8 §3.2] 509 를 네이버 클립 영상으로(우리가 못 올리는 채널 — 넘겨주는 길이 보이게)
  const clipVerified = qs.get("clipApp") === "1";  // 앱으로 열리는지 재 봤다고 치는 손잡이(기본은 안 쟀다)
  const pubNow = qs.get("pubnow") || "";      // [R8 §4.2] 지금 올리기 — cadence·offline·gate·connector
  const adsApproved = qs.get("ads") === "1";   // [R8 §3.2] 애드센스 승인된 티스토리·워드프레스 계정(광고 붙이기 줄이 보이게)
  const whyNone = qs.get("why") === "none";   /* [R8-A] 형식이 없어 주제군을 못 정한 글(서버가 topicGroup:null 로 준다) */
  const closeSub = qs.get("closeSub") === "1";  // [R7 §3.1] 구독이 살아 있어 탈퇴가 거부되는 길
  const chOpen = qs.get("chOpen") === "1";   // [R7 §4.1] 채널 레지스트리가 다 열린 상태(계정 그리드에서 흐린 칸이 사라진다) · 🔴 레지스트리보다 먼저 선언(TDZ)

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
  ].map(([key, label, category, publishVia, connectMethod, configured, status]) => { const st = chOpen ? "active" : status;
    /* [B3 020fb15] 서버가 주는 한 칸 — 라이브 실측: 블로거는 status=active 인데 우리 앱 키가 없어 못 붙는다 */
    const reason = st !== "active" ? "not_open" : (!configured && !chOpen) ? "no_provider_key" : null;
    const o = { key, label, category, publishVia, status: st, connectMethod, configured, connectable: !reason, ...(reason ? { connectableReason: reason } : {}) }; if (CH_VIDEO[key]) o.video = CH_VIDEO[key]; return o; }); // [P1R6] channels[].video{maxSeconds,formats} // 라이브 channel_registry 와 같게: 발행 경로 있는 4채널만 active · 나머지 planned(어휘 active|planned|down)

  const BODY_NAVER = `<p>주말에 에어프라이어를 열었더니 바닥에 기름이 눌어붙어 있더라고요. 세 번 실패하고 네 번째에 깨끗해진 방법을 그대로 적어요.</p>
<blockquote>준비물은 베이킹소다·주방세제·따뜻한 물, 이게 전부예요</blockquote>
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

  /* [AC-52 · 2026-09-15 · lib/disclosure.ts DISCLOSURE_TEXT 에서 그대로 복사] 🔴 손으로 고치지 마라 — 고객이 볼 고지 문장이다 */
  const DISCLOSURE = "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.";
  const DISC_SPONSORED = "이 글은 광고주에게서 원고료 등 대가를 받고 작성한 유료 광고입니다.";
  const DISC_GIFT = "이 글은 광고주에게서 제품(또는 서비스)을 무상으로 제공받아 작성했습니다.";
  /* 여러 종류면 **문장을 전부 싣는다**(순서 고정: 제휴 → 원고료 → 무상 제공 · normalizeCompensation 과 같다) */
  const discTextOf = (meta) => [meta.affiliate ? DISCLOSURE : "", meta.sponsored ? DISC_SPONSORED : "", meta.gift ? DISC_GIFT : ""].filter(Boolean).join(" ");
  // [v1.1] GateKey 12 · 순서 고정(5C.2 8검사 + 16B 4검사)
  /* [AC-52 · 2026-09-15 · lib/ai-tell-gate.ts GATE_LABEL 에서 그대로 복사] 🔴 라벨은 **통과형 문장**이다 — «문단 시작 반복 ✓» 처럼 명사형이면 뜻이 반대로 읽힌다 */
  /* [R8 §9 · AC-52 · lib/ai-tell-gate.ts GATE_WEIGHT·GATE_HOW 에서 그대로 복사] 🔴 손으로 고치지 마라.
     high = 법·제3자·고객 계정이 다치는 것 · normal = 글의 질. `how` 는 **실패한 칸에만** 실린다(서버 decorateCheck 와 같다). */
  const GATE_WEIGHT = { disclosure: "high", banned_words: "high", stock_safe: "high", ad_pointing: "high", similarity: "high",
    affiliate_count: "normal", superlative: "normal", cliche: "normal", para_repeat: "normal", bullet_ratio: "normal",
    sentence_variance: "normal", translationese: "normal", persona: "normal", visual_min: "normal", link_check: "normal", structure_repeat: "normal" };
  const GATE_HOW = {
    disclosure: "검수에서 «대가를 받았나»를 켜면 첫머리 문장이 자동으로 들어가요.",
    banned_words: "단정·효능 표현은 지우고, 최상급은 같은 문장에 근거(기관·기간·수치)를 붙여 주세요.",
    stock_safe: "사람·상표가 없는 사진으로 바꾸거나, 이 글에서 광고를 빼 주세요.",
    ad_pointing: "광고·배너를 가리키는 문장을 지우고 «다음 글 보기»처럼 읽기 행동을 권해 주세요.",
    similarity: "도입 장면·소제목·예시를 다른 관점으로 바꿔 주세요.",
    affiliate_count: "제휴 링크를 2개까지만 남겨 주세요.",
    superlative: "«1위»·«최고» 옆에 출처·기간·수치를 적거나 표현을 낮춰 주세요.",
    structure_repeat: "소제목 수·순서·끝맺음을 바꿔 보세요.",
  };
  const decorate = (c) => ({ ...c, weight: GATE_WEIGHT[c.key] || "normal", ...(c.pass || !GATE_HOW[c.key] ? {} : { how: GATE_HOW[c.key] }) });
  const gate = (ok = true) => ({ ok, rewritten: !ok, checks: [
    { key: "cliche", label: "상투 표현 없음", pass: true, detail: "0건" }, { key: "para_repeat", label: "문단 시작이 다양함", pass: true }, { key: "bullet_ratio", label: "불릿이 본문을 대신하지 않음", pass: true, detail: "18%" },
    { key: "sentence_variance", label: "문장 길이가 살아 있음", pass: true }, { key: "translationese", label: "번역투 없음", pass: true, detail: "0건" }, { key: "superlative", label: "최상급에 근거가 있음", pass: ok, detail: ok ? "0건" : "«최고» 2건" },
    { key: "persona", label: "내 사정이 들어감", pass: true, detail: "3곳" }, { key: "visual_min", label: "채널 시각 요소 충족", pass: true, detail: "사진 8장" },
    { key: "disclosure", label: "대가 고지 첫머리", pass: ok }, { key: "banned_words", label: "근거 없이 쓰면 위험한 표현 없음", pass: true, detail: "0건" }, { key: "similarity", label: "다른 글과 겹치지 않음", pass: true, detail: "12%" }, { key: "affiliate_count", label: "제휴 링크 2개 이하", pass: true, detail: "1개" }, { key: "link_check", label: "링크 열림", pass: true },
    /* [R8-A §2 · B-1] 골격 반복 — 🔴 **소프트**(HARD_GATE_KEYS 밖)라 실패해도 예약은 된다. 사유 문장 모양은 서버 checkStructure 그대로 */
    { key: "structure_repeat", label: "최근 글과 구조가 다름", pass: gateKnob !== "soft", detail: gateKnob === "soft" ? "최근 글 #499 과 구조가 78% 겹쳐요 — 다음 글은 다른 구성으로 써 주세요" : "가장 닮은 글과 41%(기준 75% 미만 · 6편과 견줌)" },
    /* [R8-A §4] 광고 가리킴 — 🔴 **하드**(승인이 막힌다) · 좁은 축이다(광고·배너를 가리키며 누르라고 할 때만) */
    { key: "ad_pointing", label: "광고를 가리키지 않음", pass: gateKnob !== "adpoint", ...(gateKnob === "adpoint" ? { detail: "광고를 가리키며 누르라고 함: «아래 배너 클릭하고 가세요»" } : {}) } ].map(decorate) });
  /* [R8-A · lib/content-approve.ts HARD_GATE_KEYS] 이 축만 «이대로 예약»을 막는다 — 소프트 실패는 막지 않는다(서버 hardFailures 와 같게) */
  const HARD = [];   /* [R8 §9] 🔴 서버 HARD_GATE_KEYS 가 빈 배열이 됐다 — 막는 축은 하나도 없다(사장님 «말해 주기로 내려») */
  const gateOkOf = (g) => !((g && g.checks) || []).some((c) => !c.pass && HARD.includes(c.key));

  const fresh = qs.get("fresh") === "1";
  const runnerOn = qs.get("runner") === "on";
  const revEmpty = qs.get("revEmpty") === "1";
  const blocked = qs.get("readonly") === "1" ? "readonly" : qs.get("suspended") === "1" ? "suspended" : null; // [P1R4] 쓰기 막힘(계약 §1.3 requireWritable)
  const planLimit = qs.get("planLimit") || "";
  const kiccOff = qs.get("kicc") === "0";
  /* [§1.6] 결제 라인 — ?keyin=1 정책 켜짐(기본 0) · ?keyinMid=0 비인증 MID 미등록 → available:false(체크박스 자체가 없다) */
  const keyinOn = qs.get("keyin") === "1", keyinMid = qs.get("keyinMid") !== "0";
  /* [P1R6] 손잡이 — ?supplier=0(회사 정보 없음 → 영수증 «준비 중») · ?share=0(이달 수익 0 → 공유 카드 없음) · ?managed=deny(플랜에 관리형 러너 없음 → 402 plan_feature) · ?export=running(내보내기 도는 중) · ?amOff=1(AM 다리 미설정) */
  const mailOff = qs.get("mail") === "0";
  const runnerDl = qs.get("runnerDl") || "";       // [러너 배포] 내려받기 손잡이 — plan(403 step:"plan") · none(503 step:"no_release") · 기본 = 10분 링크
  const otherPc = qs.get("otherPc") === "1";       // [러너 배포] 다른 PC 가 이 열쇠로 켜려 한 기기 1대(otherDeviceAt · 있을 때만 키가 온다)
  const kindsKnob = qs.get("kinds") || "";   // [R7 §1.1] text = 영상 꺼짐 · none = 저장된 적 없음(kindsSet false) · 기본 = 글+영상
  const companyOff = qs.get("company") === "0";   // [P1R6 §1.3] 회사 정보 없음 → 약관 하단·영수증 «준비 중»
  const uploadKnob = qs.get("upload") || "";   // [P1R6 §1.1] 사진 첨부 — off = R2 미설정(not_configured) · fail = PUT 실패
  const autoOff = qs.get("autoOff") === "1";  // [실측] 자동 편성 꺼짐(규칙은 있음) — 홈·편성표 맨 위 한 줄      // [P1R6] 가입 인증 메일 실패 흉내(배너 · 다시 보내기)
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
  /* [AC-52 · 2026-09-15 · lib/video/judge.ts AXIS_LABEL 에서 그대로 복사] 🔴 손으로 고치지 마라 — 서버가 정본이고, 다르면 verify-label-surface 가 빨강이다 */
  const JUDGE_AXES = [["hook_first", "첫 컷이 훅"], ["safe_area", "자막·배지가 안전영역 안"], ["caption_lines", "자막 2줄 이내"], ["reading_time", "자막 읽을 시간 충분"], ["text_broken", "깨진 글자 없음"], ["black_margin", "검은 여백 없음"], ["frames_not_blank", "빈 프레임 없음"], ["cut_rhythm", "컷 리듬 살아 있음"], ["forbidden", "금칙·내부 문자열 없음"], ["disclosure", "제휴 고지(배지·자막·설명란)"], ["duration_fit", "길이 규격 안"], ["similarity", "다른 계정 영상과 겹치지 않음"]];
  const judgeReport = (grade) => ({ grade, pass: grade !== "P0", repaired: grade === "P1", axes: JUDGE_AXES.map(([key, label]) => { const bad = (grade === "P1" && key === "black_margin") || (grade === "P0" && key === "forbidden");   /* [AC-52] 서버 GRADE_OF 의 P1·P0 축으로 */ const o = { key, label, pass: !bad, grade: bad ? grade : "P2" };
      if (judgePending && !bad && (key === "similarity" || key === "duration_fit")) { o.pending = true; o.detail = key === "similarity" ? "영상 지문이 오지 않아 못 쟀어요 — 내 PC 프로그램이 대표 프레임을 보내면 다음부터 견줘요" : "길이를 잴 도구(ffprobe)가 없어 못 쟀어요"; }   /* [R7 §1.5] pass 지만 «쟀다»가 아니다 */ if (grade === "P1" && key === "black_margin") o.detail = "4번 컷 아래 검은 여백 · 한 번 다시 만들어 통과"; if (grade === "P0" && key === "forbidden") o.detail = "내부 문자열이 남았어요 · 세 번 고쳐도 안 돼 사람이 봐 주세요"; return o; }) });
  const POSTER = "data:image/svg+xml;utf8," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='540' height='960'><rect width='540' height='960' fill='#191F28'/><rect x='60' y='380' width='420' height='120' rx='16' fill='#2A2A32'/><text x='270' y='452' font-family='sans-serif' font-size='40' font-weight='800' fill='#fff' text-anchor='middle'>에어프라이어 기름때</text></svg>");
  const SRT = "data:text/plain;charset=utf-8," + encodeURIComponent("1\n00:00:00,000 --> 00:00:03,000\n제휴 링크가 있어요\n\n2\n00:00:03,000 --> 00:00:07,500\n눌어붙은 기름, 3분이면 끝나요\n\n3\n00:00:07,500 --> 00:00:13,000\n베이킹소다 한 스푼이 전부예요\n");
  /* 🔴 설명란 첫 줄은 **서버가 만든다**(videoDescriptionFirstLine = disclosureTextFor) — «이 영상은…»으로 고쳐 적어 두면
     화면이 «고지가 없다»고 읽는다(2026-09-15 발견 · 모의만의 문장이었다). 글·영상이 같은 문장을 쓴다. */
  const VDESC = DISCLOSURE + "\n베이킹소다 한 스푼이면 눌어붙은 기름이 녹아요. 준비물과 순서를 58초에 담았어요.\n\n#에어프라이어 #청소 #살림팁";
  const videoAssets = () => [{ id: 9001, kind: "video", url: "", meta: { durationMs: 58000, bytes: 8412300, frameCount: 1740 } }, { id: 9002, kind: "srt", url: SRT }, { id: 9003, kind: "thumb", url: POSTER }];
  /* [AC-52] 영상 piece 에도 붙는 글 게이트 칸 — 라벨은 서버 GATE_LABEL 그대로 */
  const VIDEO_GATE_CHECKS = [{ key: "disclosure", label: "대가 고지 첫머리", pass: true }, { key: "banned_words", label: "근거 없이 쓰면 위험한 표현 없음", pass: true, detail: "0건" }, { key: "superlative", label: "최상급에 근거가 있음", pass: true, detail: "0건" }];
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
  /* [P1R7 §3.1 · B ba99538] 쓰기 막힘 — 🔴 **탈퇴 신청이 먼저다**(그 집엔 «체험»도 «결제»도 할 말이 아니다).
     문장·칸 이름은 lib/guards.ts requireWritable 에서 그대로(느슨하게 베끼면 화면이 또 딴말을 한다 · AC-52). */
  const notWritable = () => {
    if (S.close) { const daysLeft = Math.max(0, Math.ceil((new Date(S.close.purgeAt).getTime() - Date.now()) / 86400e3));
      return { ok: false, step: "writable", reason: "closed", error: `탈퇴를 신청하셨어요. ${daysLeft}일 뒤에 자료가 지워져요 — 그때까지는 보기만 할 수 있고, 되돌리면 하던 대로 다시 쓸 수 있어요.`, purgeAt: S.close.purgeAt, daysLeft, status: 403 }; }
    return blocked ? { ok: false, step: "writable", reason: blocked, error: blocked === "readonly" ? "체험이 끝났어요. 요금제를 고르면 바로 이어서 돼요." : "결제가 밀려 있어요. 카드를 확인해 주세요.", status: 403 } : null;
  };
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
  /* 모의 계정 사진 — 바깥 주소를 쓰면 «열어야 보이는 그림»이 되니 데이터 URI 로(서버는 https 만 받는다는 규칙은 화면 쪽 검사로 따로 지킨다) */
  /* 모의 계정 사진 — 우리 서버가 주는 그림 자리(같은 출처 파일). 🔴 실서버는 https 만 받는다(accounts.ts) · 화면도 https 와 같은 출처만 그린다 */
  const AVATAR = "/icon.svg";
  /* [R8 · 사장님 승인 2026-09-15 · lib/coin-table.ts 그대로] 🔴 글 1편 = 1코인(AI 사진 1장 포함) · 카드뉴스 3 · 내 사진·스톡 0 */
  const COIN = { blog: 1, image: 1, cardnews: 3 };
  const IMG = { naver_blog: 6, tistory: 3, blogger: 2, wordpress: 2, threads: 1 }; // 채널 기본 사진 수(코인 = 글 1 + 사진 수)
  const seed = () => ({
    v: MOCK_V, coins: 60, refreshCount: 0, autoSchedule: false, nextId: 100,
    /* [R7 §3.1] 탈퇴 예약 — 서버는 tenants.closed_at·purge_at 에 둔다. null = 신청 안 한 집 */
    close: closedKnob ? { closedAt: iso(now - 2 * 86400e3), purgeAt: iso(now + 28 * 86400e3), reason: null } : null, // v = 모의 상태 판(올리면 옛 상태를 버리고 다시 뿌린다 · fresh 로 비운 상태를 되살리지 않는다) // [P1R5] C 시나리오 «코인 60»(글 2 + 쇼츠 1 = 41 이 한 번에 나가게)
    /* [사장님 실측] ?oneCh=1 = 네이버 계정만 있는 집(테넌트 198) — 소재가 전부 한 채널로 나온다 */
    accounts: fresh ? [] : oneChannel ? [
      { id: 1, channel: "naver_blog", handle: "cook_a", displayName: "요리하는 A", avatar: null, status: "active", healthScore: 100, postsToday: 0, dailyCap: 2, minGapMin: 180, goldenHours: [7, 21], credsAt: iso(now - 9 * 86400e3) },
      { id: 2, channel: "naver_blog", handle: "cook_b", displayName: "요리하는 B", avatar: null, status: "active", healthScore: 92, postsToday: 0, dailyCap: 2, minGapMin: 180, goldenHours: [9], credsAt: iso(now - 4 * 86400e3) },
    ] : [
      { id: 1, channel: "naver_blog", handle: "cook_a", displayName: "요리하는 A", avatar: null, status: "active", healthScore: 100, postsToday: 0, dailyCap: 2, minGapMin: 180, goldenHours: [7, 21], lastPostAt: iso(now - 26 * 3600e3), personaId: 1, browserProfileKey: "acc-1", hasCreds: true, monetize: { coupang: true, adpost: true, adsense: false } },
      { id: 2, channel: "tistory", handle: "tips_b", displayName: "", avatar: null, status: "pending_login", healthScore: 84, postsToday: 0, dailyCap: 1, minGapMin: 360, goldenHours: [12], lastErrorKind: "login_fail", browserProfileKey: "acc-2", hasCreds: true, monetize: { coupang: false, adpost: false, adsense: true } },
      { id: 3, channel: "naver_blog", handle: "life_c", displayName: "살림하는 C", avatar: null, status: "suspended", healthScore: 31, postsToday: 0, dailyCap: 2, minGapMin: 180, goldenHours: [21], lastErrorKind: "suspended", lastPostAt: iso(now - 5 * 86400e3), browserProfileKey: "acc-3", hasCreds: true, monetize: { coupang: false, adpost: true, adsense: false } },
      { id: 4, channel: "youtube_shorts", handle: "shorts_d", displayName: "1분 살림", avatar: avatarOn ? AVATAR : null, status: "active", healthScore: 96, postsToday: 0, dailyCap: 1, minGapMin: 360, goldenHours: [18], lastPostAt: iso(now - 2 * 86400e3), browserProfileKey: "acc-4", hasCreds: true, monetize: { coupang: false, adpost: false, adsense: false } },
      /* [R8 §3.2] ?ads=1 일 때만 — 워드프레스는 «우리가 직접 위젯을 넣는» 유일한 길이라 그 갈래를 화면에서 보려면 계정이 하나 있어야 한다 */
      ...(adsApproved ? [{ id: 5, channel: "wordpress", handle: "myhome", displayName: "우리집 살림", avatar: null, status: "active", healthScore: 90, postsToday: 0, dailyCap: 2, minGapMin: 180, goldenHours: [10], browserProfileKey: "acc-5", hasCreds: true, monetize: { coupang: false, adpost: false, adsense: true } }] : []),
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
      { id: 509, channel: clipPiece ? "naver_clip" : "youtube_shorts", accountHandle: clipPiece ? "clip_e" : "shorts_d", kind: "video", title: "전자레인지 냄새, 레몬 한 조각으로 끝", status: "in_review", scheduledFor: kst(2, 18, 0), gateOk: true, createdAt: iso(now - 5 * 3600e3), topicTitle: "전자레인지 냄새", regenCount: 0, coinCost: 28, bodyHtml: "", body: VDESC, blocks: [{ type: "video", assetId: 9001 }, { type: "srt", assetId: 9002 }, { type: "hashtags", tags: ["전자레인지", "레몬", "살림팁"] }], assets: videoAssets(), meta: { stage: "done", chainStage: { stage: "done", at: iso(now - 4 * 3600e3) }, video: videoSpec(1, 4, 60, "graphic"), angle: "3초 훅 · 비포/애프터", emotionKey: "shorts", tags: ["전자레인지", "레몬", "살림팁"], disclosure: DISCLOSURE, affiliate: { provider: "coupang", url: "https://link.coupang.com/a/mock", subId: "piece509" }, chainResume: { count: 0 }, tts: { provider: "typecast" }, endcard: { text: "설명란 링크에서 확인해요", url: "https://link.coupang.com/a/mock" }, clampedFrom: null }, gate: { ok: true, rewritten: false, checks: VIDEO_GATE_CHECKS, judge: judgeReport("P2") } },
    ],
    rules: fresh ? [] : [
      { id: 1, channel: "naver_blog", kind: "post", accountMode: "auto", every: "week", count: 3, weekdays: [1, 3, 5], preferredHour: 7, preferredMinute: null, active: true },
      { id: 2, channel: "tistory", kind: "post", accountMode: "fixed", accountId: 2, every: "week", count: 2, weekdays: [2, 4], preferredHour: 13, active: true },
      { id: 3, channel: "youtube_shorts", kind: "shorts", accountMode: "auto", every: "week", count: 2, weekdays: [2, 5], preferredHour: 18, active: true }, // [P1R5] kind shorts 규칙(주 2회 · 편당 video_60)
    ],
    /* [R7 §3.6] 산 계정 슬롯 — ?slots=waiting|active|paused (기본 없음) */
    slots2: slotsKnob === "waiting" ? [{ id: 4101, kind: "account_slot", status: "waiting_ip", coins: 24, krw: 12000, accountId: null, proxyId: null, autoRenew: true, periodsCharged: 0, label: "계정 1개 더 + 전용 IP", managed: false }]
      : slotsKnob === "active" ? [{ id: 4102, kind: "account_slot", status: "active", coins: 24, krw: 12000, accountId: 1, proxyId: 9, autoRenew: true, periodsCharged: 2, startedAt: iso(now - 12 * 86400e3), expiresAt: iso(now + 18 * 86400e3), daysLeft: 18, label: "계정 1개 더 + 전용 IP", managed: false }]
      : slotsKnob === "paused" ? [{ id: 4103, kind: "account_slot_managed", status: "paused", coins: 50, krw: 25000, accountId: 4, proxyId: null, autoRenew: true, periodsCharged: 1, pausedAt: iso(now - 2 * 86400e3), label: "관리형 계정 1개", managed: true }] : [],
    kindsSet: kindsKnob !== "none",   // [R7 §1.1] 온보딩을 안 거친 테넌트(?kinds=none) — 토글은 보이고 꺼짐
    settings: { kinds: kindsKnob === "text" || kindsKnob === "none" ? ["text"] : ["text", "video"], autoSchedule: !fresh, horizonDays: 14, topicLeadDays: 7, produceLeadDays: 3, produceHour: "06:00", reviewPolicy: planKnob === "starter" && !keptAuto ? "require_confirm" : "silence_approves", bestTimeMode: "auto", weeklyCoinCap: null, quietDays: [] },
    slots: [],
    /* ── [P1R2] 러너 기기(계약 §2) · 발행함(§6) · 재로그인 잡(§7.2) · 알림함 ── */
    devices: fresh ? [] : [{ id: 901, name: "집 PC", kind: "own", online: runnerOn, bound: true, lastSeenAt: iso(now - 2 * 3600e3), version: "1.1.3", jobsWaiting: 2, caps: { ffmpeg: !noFfmpeg, ffmpegVersion: noFfmpeg ? undefined : "7.1" } },
      ...(otherPc ? [{ id: 902, name: "사무실 PC", kind: "own", online: false, bound: true, lastSeenAt: iso(now - 3 * 86400e3), version: "1.1.2", jobsWaiting: 0, otherDeviceAt: iso(now - 40 * 60e3), otherDeviceCount: 3 }] : [])], // [러너 배포] bound = 처음 켠 PC 에 묶임 · otherDeviceAt 은 «있을 때만» // [P1R5] heartbeat caps(§2.4)
    posts: fresh ? [] : [
      { id: 701, pieceId: 504, channel: "tistory", accountHandle: "tips_b", title: "전기요금 아끼는 콘센트", externalUrl: "https://tips-b.tistory.com/12", publishedVia: "api", publishedAt: iso(now - 2 * 86400e3), status: "published", stats: { views: 1240, likes: 8, comments: 2, lastSyncAt: iso(now - 6 * 3600e3) }, alive: true },
      { id: 702, pieceId: 505, channel: "naver_blog", accountHandle: "cook_a", title: "에어프라이어 청소, 눌어붙은 기름 3분 컷", externalUrl: "https://blog.naver.com/cook_a/223456789", publishedVia: "runner", publishedAt: iso(now - 26 * 3600e3), status: "published", stats: { views: 318, likes: 21, lastSyncAt: iso(now - 3 * 3600e3) }, alive: true },
      { id: 703, pieceId: 506, channel: "naver_blog", accountHandle: "cook_a", title: "가을 이불 세탁, 건조기 없이 뽀송하게", status: "awaiting_manual", stats: {}, alive: false, errorKind: "selector_changed", failReason: "임시저장까지는 됐는데 발행 버튼을 찾지 못했어요" }, // [v2.1] publishedVia·publishedAt 없음(post 행이 없는 실패 행)
      /* [P1R5] ?uploaded=private — 유튜브 심사 전 비공개 업로드(posts.status uploaded_private · §7-1) + 릴스 처리 중(retriable video_processing) */
      ...(uploadedKnob === "private" ? [
        { id: 704, pieceId: 509, channel: "youtube_shorts", accountHandle: "shorts_d", title: "전자레인지 냄새, 레몬 한 조각으로 끝", externalUrl: "https://www.youtube.com/shorts/dQw4w9WgXcQ", channelRef: "dQw4w9WgXcQ", publishedVia: "api", publishedAt: iso(now - 3 * 3600e3), status: "uploaded_private", stats: {}, alive: true },
        { id: 705, pieceId: 509, channel: "reels", accountHandle: "reels_f", title: "3분 청소 루틴", publishedVia: "api", status: "publishing", errorKind: "video_processing", retriable: true, stats: {}, alive: true },
      ] : []),
      /* [R8 §5E] ?uploaded=done — 공개로 올라간 쇼츠. 🔴 유튜브는 **우리가 못 내린다**(삭제 스코프 없음) — 화면이 그 길을 정직하게 말하는지 보는 자리 */
      ...(uploadedKnob === "done" ? [
        { id: 706, pieceId: 509, channel: "youtube_shorts", accountHandle: "shorts_d", title: "전자레인지 냄새, 레몬 한 조각으로 끝", externalUrl: "https://www.youtube.com/shorts/dQw4w9WgXcQ", channelRef: "dQw4w9WgXcQ", publishedVia: "api", publishedAt: iso(now - 5 * 3600e3), status: "published", stats: { views: 2140, likes: 64, lastSyncAt: iso(now - 2 * 3600e3) }, alive: true },
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
    revRows: revEmpty || fresh ? [] : revSeed(),   // [여정 점검 12] ?fresh=1 = 새로 가입한 집 — 수익 행이 남아 있으면 «첫 화면»을 영영 못 본다          // revenue_daily 행 — 수집 못 한 날은 «행 자체가 없다»(AC-9)
    revSources: revEmpty || fresh ? [] : [
      { id: 1, source: "adsense", accountId: 2, method: "api", status: "connected", lastSyncAt: iso(now - 6 * 3600e3) },
      { id: 2, source: "adpost", accountId: 1, method: "runner", status: "connected", lastSyncAt: iso(now - 11 * 3600e3) },
      { id: 3, source: "coupang", accountId: 1, method: "api", status: "connected", lastSyncAt: iso(now - 3 * 3600e3) },
      { id: 4, source: "youtube", accountId: 4, method: "api", status: "not_configured" },
      { id: 5, source: "adfit", accountId: 2, method: "runner", status: "error", lastSyncAt: iso(now - 3 * 86400e3), lastError: "auth" },
    ],
    adState: revEmpty || fresh ? { adpost: {}, adsense: {}, ypp: {}, clip: {} } : { adpost: { 1: "none", 3: "approved" }, adsense: adsApproved ? { 2: "approved", 5: "approved" } : { 2: "none" }, ypp: {}, clip: {} },  // [v3.5] 소스별 × 계정별 신청 상태(«가입 완료했어요»로 바뀐다)
    /* [R8 §3.2] 워드프레스만 «지금 붙었나»를 우리가 안다(위젯 id 를 우리가 넣는다) — 나머지는 러너가 하고 우리는 모른다(AC-9) */
    adsAttached: {},
    retracted: {},   /* [R8 §5E] 내린 글(postId → 내린 시각) */
  });
  let S; try { S = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { S = null; }
  if (!S || fresh || qs.get("reset") === "1" || !S.posts || !S.revSources || !S.adState || !S.adState.adpost || S.v !== MOCK_V) { S = seed(); if (!fresh) { rollSlots(); scenarios(); } save(); } // posts 없음 = P1R1 시절 상태 → 새로 뿌린다
  /* [R7 §4.3] 라이브 표본처럼 «몇 자리에만» 사람말이 실려 있다(18건 중 5건) — 서버 slots.note 가 이제 화면으로 나온다 */
  if (!S.slotNotes) { const cand = S.slots.filter((s) => s.date >= todayYmd).slice(0, 3); S.slotNotes = {};
    if (cand[0]) S.slotNotes[cand[0].id] = "정지된 계정에서 넘겨받았어요"; if (cand[2]) S.slotNotes[cand[2].id] = "소재가 겹쳐 다른 소재로 바꿨어요"; }
  /* [R8-A] 검사 손잡이가 켜졌으면 그 글의 gate 를 다시 만든다 + 예약을 막는 것은 **하드 축뿐**(서버 hardFailures 와 같게) */
  for (const p of S.pieces) { if (!p.gate || p.kind === "video") continue; if (gateKnob) p.gate = gate(true); p.gateOk = gateOkOf(p.gate); }
  if (qs.has("runner")) { for (const d of S.devices) d.online = runnerOn; save(); }
  if (autoOff) { S.settings.autoSchedule = false; save(); }
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
        S.slots.push({ id: S.nextId++, date, channel: r.channel, kind: r.kind === "shorts" ? "shorts" : "post", accountId: acc?.id, accountHandle: acc?.handle, status, publishAt: kst(d, r.preferredHour || 9, r.preferredHour != null && r.preferredMinute != null ? r.preferredMinute : 30), reviewDeadline: kst(d - 1, 21), topicTitle: piece?.title || (d < 7 ? S.topics[d % S.topics.length]?.title : undefined), pieceId: piece?.id, origin: "auto" }); // [P1R5] kind shorts
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
    // [실측 정정] 오늘 만드는 시각(06:00)이 지난 자리 하나 — 글이 없으니 서버가 «이번엔 건너뛰어요»(slots-list skipReason:"too_soon")라 말한다(지금 만들기는 된다)
    S.slots.push({ id: S.nextId++, date: todayYmd, channel: "naver_blog", kind: "post", accountId: 1, accountHandle: "cook_a", status: "planned", publishAt: kst(0, 8, 0), topicTitle: S.topics[4]?.title, origin: "auto" });
    // 오늘 «확인 필요» 한 건(발행함 703·piece 506 과 같은 글) — 없으면 만들어 둔다
    S.slots.push({ id: S.nextId++, date: todayYmd, channel: "naver_blog", kind: "post", accountId: 1, accountHandle: "cook_a", status: "awaiting_manual", publishAt: kst(0, 11, 0), topicTitle: "가을 이불 세탁, 건조기 없이 뽀송하게", pieceId: 506, origin: "auto" });
  }
  const coinsPerWeek = () => S.rules.filter((r) => r.active).reduce((a, r) => a + (r.every === "day" ? r.count * 7 : r.count) * (r.kind === "shorts" ? VIDEO_COIN.video_60 : r.kind === "cardnews" ? COIN.cardnews : COIN.blog), 0); // [P1R5] shorts = video_60 단가(§1.10)
  const pieceRow = (p) => { const { bodyHtml, blocks, images, meta, gate, topicTitle, regenCount, body, assets, _v0, _t0, ...row } = p; if (p.kind === "video" && meta) row.meta = { stage: meta.stage, chainStage: meta.chainStage, video: { format: meta.video.format, seconds: meta.video.seconds } }; return row; }; // [P1R5] 영상 목록 행 = kind + meta.stage(§3 pieces.html)
  /* RunnerDevice 투영 — 없는 값은 키를 싣지 않는다(계약 §0) */
  const devRow = (d) => { const o = { id: d.id, name: d.name, kind: d.kind, status: d.online ? "online" : "offline", jobsWaiting: d.jobsWaiting || 0 }; if (d.caps) o.caps = d.caps; // [P1R5] caps.ffmpeg(§2.4)
    if (d.bound) o.bound = true; if (d.otherDeviceAt) { o.otherDeviceAt = d.otherDeviceAt; o.otherDeviceCount = d.otherDeviceCount || 1; } // [러너 배포] 지문 값은 싣지 않는다 — «묶였나 · 다른 PC 가 있었나 · 몇 번» 만
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
    for (const d of S.devices) if (d._t0 && Date.now() - d._t0 > 8000) { d.online = true; d.bound = true; d.version = d.version || "1.1.3"; delete d._t0; } // 등록 후 첫 하트비트(= 처음 켠 PC 에 묶인다)
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

  /* [AC-52 · 2026-09-15 · lib/revenue/types.ts 에서 그대로 복사] 🔴 손으로 고치지 마라 — 다르면 scripts/verify-label-surface.mjs 가 빨강 */
  const DAY_BASIS_NOTE = {
    pt: "이 매체는 미국 시간 기준으로 하루를 세요 — 한국 날짜와 하루가 어긋날 수 있어요.",
    provider: "이 매체가 세는 하루 기준을 아직 확인하지 못했어요 — 한국 날짜와 다를 수 있어요.",
  };
  const BASIS_OF = { adsense: "pt", youtube: "pt", coupang: "kst", adpost: "kst", adfit: "kst", clip: "kst", aliexpress: "provider", linkprice: "provider", meta: "kst", tiktok: "kst", x: "kst", sponsor: "kst", manual: "kst" };

  /* ── 라우트 ── */
  const R = {
    "auth-me": () => ({ ok: true, user: { id: 1, email: "mock@autocreate.dev", name: "모의 고객", role: "owner", emailVerified: qs.get("mail") !== "0", mustChangePassword: false }, tenant: { id: 1, key: "mock", name: "모의", planKey: blocked === "suspended" ? "starter" : "trial", status: blocked || (S.close ? "readonly" : "trial"), trialEndsAt: iso(now + 9 * 86400e3), trialDaysLeft: blocked || S.close ? 0 : 9, settings: { autoSchedule: S.settings.autoSchedule } }, coins: S.coins, impersonation: qs.get("imp") === "1" ? { byName: "운영 관리자", startedAt: iso(now - 5 * 60e3), until: iso(now + 55 * 60e3) } : null }),
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
      /* [R8 §4.1 · B] 발행 전 검사에 걸린 글 — 🔴 B 가 새 kind 를 만들지 않고 화면에 이미 있는 `review_blocked` 를 썼다.
         사유는 서버 GATE_LABEL 그대로 앞 3개(첫 낱말이 보통 «대가 고지 첫머리»다). */
      const gateStuck = S.pieces.filter((p) => p.status === "in_review" && p.gate && (p.gate.checks || []).some((c) => !c.pass && ["disclosure", "banned_words", "affiliate_count", "similarity", "ad_pointing"].includes(c.key)));
      if (gateStuck.length) todo.push({ kind: "review_blocked", title: `발행 전 확인이 필요한 글이 ${gateStuck.length}건 있어요`, count: gateStuck.length,
        desc: `${[...new Set(gateStuck.flatMap((p) => (p.gate.checks || []).filter((c) => !c.pass).map((c) => c.label)))].slice(0, 3).join(" · ")} — 고치고 승인하면 그 자리에서 다시 나가요`,
        link: gateStuck.length === 1 ? `/app/piece.html?id=${gateStuck[0].id}` : "/app/pieces.html?status=in_review", tone: "warn", ...(gateStuck.length === 1 ? { pieceId: gateStuck[0].id } : {}) });
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
      /* [여정 점검 13] 체험 끝·결제 멈춤은 **서버 todo(kind:"plan")가 정본** — 모의도 같은 줄을 보낸다(화면은 이제 안 얹는다) */
      if (blocked === "readonly") todo.push({ kind: "plan", title: "체험이 끝났어요 — 요금제를 골라 주세요", desc: "만든 글과 편성표는 그대로예요. 요금제를 고르면 바로 이어서 돼요.", link: "/app/plan.html", tone: "warn" });
      else if (blocked === "suspended") todo.push({ kind: "plan", title: "결제가 안 돼서 잠시 멈췄어요", desc: "카드를 확인하면 바로 이어서 돼요.", link: "/app/plan.html", tone: "warn" });
      if (!S.accounts.length) todo.push({ kind: "setup", title: "첫 계정을 연결해 보세요", desc: `${CHANNELS.filter((c) => c.status === "active").slice(0, 3).map((c) => c.label).join(" · ") || "지금 열린 채널"} 중 하나면 돼요`, link: "/app/accounts.html", tone: "info" });
      else if (!S.rules.length) todo.push({ kind: "setup", title: "자동 편성을 켜 보세요", desc: "규칙 하나면 한 달치가 알아서 나가요", link: "/app/schedule.html", tone: "info" });
      const todaySlots = S.slots.filter((s) => s.date === todayYmd).map((s) => { const o = { id: s.id, channel: s.channel, status: s.status, publishAt: s.publishAt, handle: s.accountHandle, title: s.topicTitle }; if (s.pieceId) o.pieceId = s.pieceId; return o; });
      return { ok: true, revenue: revSummaryForHome(), todaySlots, todo, notices: [], unread: S.notifications.filter((n) => !n.readAt).length, auto: { enabled: S.settings.autoSchedule, rules: S.rules.filter((r) => r.active).length, produceLeadDays: S.settings.produceLeadDays }, runner: { online, total: S.devices.length }, trial: trialOf(), coins: S.coins, impersonation: null }; },
    /* [R7 §1.1] GET = 지금 값 · POST = 병합. kinds 는 서버가 정규화한다(«글»은 항상 남는다 · 영상만 토글) */
    "tenant-settings": (b) => { if (typeof b.autoSchedule === "boolean") S.settings.autoSchedule = b.autoSchedule;
      if (Array.isArray(b.kinds)) { S.settings.kinds = b.kinds.includes("video") ? ["text", "video"] : ["text"]; S.kindsSet = true; }
      const kinds = Array.isArray(S.settings.kinds) && S.settings.kinds.length ? (S.settings.kinds.includes("video") ? ["text", "video"] : ["text"]) : ["text"];
      return { ok: true, settings: S.settings, kinds, kindsSet: !!S.kindsSet }; },
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
    /* [B2 §2.4] 계정당 월요금(전용 IP 포함) — GET { price(계정당), max(플랜 최대 계정 수), accounts? } · POST { accounts } */
    /* [R7 §3.6 · B] 계정 슬롯 — «계정 1개 + 전용 IP» 30일권. 구매 시점엔 차감 0(IP 배정될 때 첫 30일치) */
    "account-slots": () => { const offers = [
        { kind: "account_slot", coins: 24, krw: 12000, days: 30, label: "계정 1개 더 + 전용 IP", desc: "계정 하나를 더 쓰고, 그 계정만의 IP 를 드려요. 내 PC 프로그램으로 돌아가요.", managed: false },
        { kind: "account_slot_managed", coins: 50, krw: 25000, days: 30, label: "관리형 계정 1개", desc: "계정 하나를 더 쓰고, 전용 IP 와 우리 서버 실행까지 포함이에요. PC 를 켜 두지 않아도 돼요.", managed: true }];
      return { ok: true, slots: S.slots2, offers, balance: S.coins, includedAccounts: 15, extraSlots: S.slots2.filter((s) => s.status !== "cancelled").length,
        usedAccounts: S.accounts.length, canAddNow: S.accounts.length < 15 + S.slots2.length, note: "남은 기간 환불은 없어요. 다음 갱신만 끌 수 있어요." }; },
    "account-slot-buy": (b) => { const nw = notWritable(); if (nw) return nw;
      const P = { account_slot: { coins: 24, krw: 12000, label: "계정 1개 더 + 전용 IP", managed: false }, account_slot_managed: { coins: 50, krw: 25000, label: "관리형 계정 1개", managed: true } }[String(b.kind || "")];
      if (!P) return err("kind", "어떤 상품인지 골라 주세요.");
      const cnt = Math.trunc(Number(b.count) || 1); if (cnt < 1 || cnt > 5) return err("count", "한 번에 5개까지 살 수 있어요.");
      const need = P.coins * cnt; if (slotCoinsShort || S.coins < need) return err("coins", "코인이 모자라요.", { need, balance: S.coins });
      const made = []; for (let i = 0; i < cnt; i++) { const s = { id: S.nextId++, kind: b.kind, status: "waiting_ip", coins: P.coins, krw: P.krw, accountId: null, proxyId: null, autoRenew: true, periodsCharged: 0, label: P.label, managed: P.managed }; S.slots2.unshift(s); made.push(s); }
      return { ok: true, slots: made, balance: S.coins, waitingIp: cnt };   /* 🔴 산 시점엔 차감 0 — IP 가 붙을 때 빠진다 */ },
    "account-slot-renew": (b) => { const s = S.slots2.find((x) => x.id === Number(b.id)); if (!s) return err("not_found", "그 자리를 찾을 수 없어요.", { status: 404 });
      s.autoRenew = !!b.autoRenew; return { ok: true, slot: s }; },
    "managed-runner": (b) => { if (b && (b.devices !== undefined || b.accounts !== undefined)) {
        if (managedDeny) return { ok: false, reason: "plan_limit", step: "plan_feature", feature: "managedRunner", planKey: "starter", error: "대신 돌려주는 PC는 지금 요금제에 없어요. Pro 로 바꾸면 쓸 수 있어요.", status: 402 };
        const n = Number(b.accounts ?? b.devices) || 0; if (n < 1 || n > 15) return err("accounts", "계정 수는 1~15개 사이로 골라 주세요(지금 요금제 기준).");
        S.managed = { status: "requested", assigned: 0, devices: n, accounts: n, requestedAt: iso(Date.now()) };
        S.notifications.unshift({ id: S.nextId++, kind: "setup", title: "대신 돌려주는 PC를 신청했어요", desc: "운영자가 확인하고 배정해 드려요 · 보통 하루 안에", link: "/app/runner.html", tone: "info", createdAt: iso(Date.now()) });
        return { ok: true, status: S.managed.status, accounts: n, devices: n, price: { amountKrw: 25000, vatKrw: 2500, totalKrw: 27500 }, totalKrw: 27500 * n }; }
      /* [R7 §4.5] ?managed=account = 사장님 결정 4 모양(계정당 월요금 · 프록시 포함) — 서버가 per:"account" 를 실으면 화면이 그 단위로 그린다 */
      const price = { amountKrw: 25000, vatKrw: 2500, totalKrw: 27500 };   // 권장값 흉내(확정은 합동 세션) — 화면은 이 값만 그린다
      const acc = S.managed.accounts || S.managed.devices;
      if (managedDeny) return { ok: true, eligible: false, reason: "plan_feature", price, status: "none", assigned: 0, max: 15, planKey: "starter" };
      return { ok: true, eligible: true, price, status: S.managed.status, assigned: S.managed.assigned, max: 15, planKey: "pro", ...(acc ? { accounts: acc, devices: acc } : {}) }; },
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
    /* [P1R6 §1.1] 첨부 = presign PUT — 화면은 이 주소로 파일 바이트를 그대로 올린다(아래 fetch 가로채기가 R2 를 흉내) */
    /* [P1R6 §1.3] 공개 회사 정보 — 약관·개인정보·유료약관 하단이 읽는다(운영센터 «회사 정보» 한 출처) */
    /* [R7 §4.4] 웹푸시 — 서버 몫(공개키·구독 저장)이 아직 없다. 모의도 «준비 중»으로 정직하게 답한다(있는 척하면 화면이 «켰어요»라고 거짓말한다) */
    "push-key": () => ({ ok: false, status: 503, step: "not_configured", error: "기기 알림은 아직 준비 중이에요." }),
    "company": () => ({ ok: true, company: companyOff ? null : { name: "주식회사 오토크리에이트", ceo: "홍두현", bizNo: "123-45-67890", mailOrderNo: "2026-서울강남-01234", address: "서울특별시 강남구 테헤란로 1길 10, 5층", email: "help@autocreate.kr", phone: "02-1234-5678" } }),
    "support-upload-url": (b) => { if (uploadKnob === "off") return { ok: false, step: "not_configured", error: "사진 첨부는 아직 준비 중이에요. 글로 적어 주시면 돼요." };
      const ext = String(b.ext || "").toLowerCase().replace(/[^a-z]/g, "");
      if (!["png", "jpg", "jpeg", "webp"].includes(ext)) return err("ext", "png·jpg·webp 이미지만 첨부할 수 있어요.");
      const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      const key = `autocreate/support/1/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`;
      return { ok: true, key, uploadUrl: location.origin + "/mock-r2/" + encodeURIComponent(key), url: location.origin + "/mock-r2/" + encodeURIComponent(key), contentType, expiresIn: 60 }; },
    "upload": (b) => { if (!b.dataBase64 || !b.contentType) return err("file", "사진을 골라 주세요."); if (String(b.dataBase64).length > 4e6) return err("size", "3MB 이하 사진만 붙일 수 있어요."); return { ok: true, key: "autocreate/1/support/" + Date.now() + "-" + String(b.filename || "img").replace(/[^\w.-]/g, "_"), url: "" }; },
    "notices": () => ({ ok: true, notices: qs.get("incident") === "0" ? [] : [{ id: 801, kind: "incident", title: "네이버 발행이 늦어요 · 네이버 쪽 점검", body: "14:00 부터 네이버 블로그 발행이 30분쯤 밀리고 있어요. 예약은 그대로 나가요.", startsAt: iso(now - 2 * 3600e3), endsAt: iso(now + 4 * 3600e3), channels: ["naver_blog"] }, { id: 802, kind: "notice", title: "9월 25일 새벽 2시 점검(10분)", startsAt: iso(now - 3600e3), endsAt: iso(now + 11 * 86400e3) }] }),
    /* §1 계정 */
    "accounts-list": () => ({ ok: true, accounts: S.accounts.map((a) => ({ ...a })), channels: CHANNELS }),
    "accounts-add": (b) => {
      if (/쿠팡|coupang/i.test(b.handle || "")) return err("handle_policy", "채널 이름에 «쿠팡»을 쓸 수 없어요(파트너스 정책).");
      if (planLimit === "accounts") return { ok: false, reason: "plan_limit", step: "plan_limit", resource: "accounts", used: S.accounts.length, limit: 3, planKey: "starter", error: "계정은(는) 3개까지예요. Pro 로 바꾸면 더 늘어나요.", status: 402 };
      if (S.accounts.length >= 5) return { ok: false, status: 402, reason: "plan_limit", step: "plan_limit", resource: "accounts", used: S.accounts.length, limit: 5, planKey: "pro",
        error: "계정은 지금 5개까지예요. 계정 1개를 더 쓰려면 코인으로 살 수 있어요(전용 IP 포함).", balance: S.coins,
        slotOffer: { offers: [{ kind: "account_slot", coins: 24, krw: 12000, days: 30, label: "계정 1개 더 + 전용 IP", desc: "계정 하나를 더 쓰고, 그 계정만의 IP 를 드려요. 내 PC 프로그램으로 돌아가요.", managed: false },
            { kind: "account_slot_managed", coins: 50, krw: 25000, days: 30, label: "관리형 계정 1개", desc: "계정 하나를 더 쓰고, 전용 IP 와 우리 서버 실행까지 포함이에요. PC 를 켜 두지 않아도 돼요.", managed: true }], extraSlots: S.slots2.length, buyPath: "/api/account-slot-buy" } };
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
    "topics-add": (b) => { const nw = notWritable(); if (nw) return nw; const title = String(b.title || "").trim(); if (!title || title.length > 80) return err("title", title ? "80자 안으로 적어 주세요." : "무엇에 대해 쓸지 한 줄 적어 주세요.");
      if (/도박|토토|카지노/.test(title)) return err("banned_category", "도박·사행성 주제는 만들 수 없어요.");
      const dup = S.topics.find((x) => x.status === "candidate" && x.title.replace(/\s/g, "") === title.replace(/\s/g, "")); if (dup) return { ok: false, step: "duplicate", error: "30일 안에 같은 소재가 있어요.", topic: { id: dup.id, title: dup.title }, status: 400 };
      if (S.topics.filter((x) => x.source === "manual" && (x.createdAt || "").slice(0, 10) === todayYmd).length >= 10) return { ok: false, step: "rate", error: "오늘은 10개까지 넣을 수 있어요. 내일 다시 넣어 주세요.", status: 429 };
      const topic = { id: S.nextId++, title, angle: b.keyword ? String(b.keyword).trim() : "", channelHint: b.channelHint || S.accounts[0]?.channel || "naver_blog", score: null, status: "candidate", source: "manual", factors: { keyword: b.keyword ? String(b.keyword).trim() : undefined, intent: "info" }, createdAt: iso(Date.now()), expiresAt: iso(Date.now() + 30 * 86400e3) };
      S.topics.unshift(topic); return { ok: true, topic, status: 201 }; }, // [실측] 직접 소재 — Topic 모양 topics-list 그대로 · source:"manual" · 검색량은 없음(0 아님)
    "topics-reference": (b) => { const url = String(b.url || "").trim(); if (!/^https?:\/\/\S+$/.test(url)) return err("url", "쇼츠·릴스 링크를 붙여 주세요."); if (S.templates.filter((x) => x.createdAt.slice(0, 10) === todayYmd).length >= 3) return err("limit", "오늘은 3개까지 배울 수 있어요. 내일 다시 해 주세요.");
      const tpl = { id: S.nextId++, name: /youtube|youtu\.be/.test(url) ? "비포·애프터 반전 (60초)" : "생활밀착 3단계 (30초)", sourceUrl: url, structure: ["3초 훅: 결과 먼저 보여 주기", "문제 한 줄", "해결 3단계", "엔드카드 · 설명란 링크"], hook: "twist", style: { palette: "ink", captions: "keyword_center", pace: "fast" }, createdAt: iso(Date.now()) };
      S.templates.push(tpl); const tp = S.topics.find((x) => x.status === "candidate" && VIDEO_CH.includes(x.channelHint)) || S.topics.find((x) => x.status === "candidate"); if (tp) tp.factors.structureTemplateId = tpl.id; return { ok: true, template: tpl }; }, // [P1R5] §1.11 · 코인 0 · 하루 3회
    "topics-list": () => { refreshTick(); const t = S.topicsRefresh;
      const refresh = { running: isRefreshing() };
      if (t) { if (t.startedAt) refresh.startedAt = t.startedAt; if (t.finishedAt) refresh.finishedAt = t.finishedAt; if (t.added != null) refresh.added = t.added; if (t.error) refresh.error = t.error; }
      /* [사장님 실측] 서버는 **연결된 계정의 채널**에서만 소재 채널을 고른다(lib/topics.ts) — 모의도 그래야 «네이버만 보이는» 그 화면이 재현된다 */
      const only = oneChannel ? "naver_blog" : null;
      return { ok: true, topics: S.topics.filter((x) => x.status === "candidate").map((x) => (only ? { ...x, channelHint: only } : x)), templates: S.templates.map((x) => ({ ...x })), refreshedAt: t?.finishedAt || iso(now - 7200e3), refresh }; }, // [P1R5] templates(레퍼런스 구조) 동봉
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
      if (nv) pieces.push({ key: "p1", channel: "naver_blog", accountId: nv.id, accountHandle: nv.handle, format: "story", emotionKey: "warm", composition: "experience", lengthHint: { words: 1400 }, images: { count: 8, style: "photo", heroNeeded: true, aiCount: 1 }, monetize: { affiliate: t.factors.intent !== "info" ? { provider: "coupang", productQuery: "에어프라이어 세척솔", slot: "end" } : null, adDisclosure: true }, schedule: { at: kst(1, 7, 30), slotReason: "네이버 블로그 아침 골든타임 · @" + nv.handle + " 오늘 0/" + nv.dailyCap }, coinCost: COIN.blog });
      if (ts) pieces.push({ key: "p2", channel: "tistory", accountId: ts.id, accountHandle: ts.handle, format: "compare", emotionKey: "neutral", composition: "compare", angle: "비교표로 정리", lengthHint: { words: 1200 }, images: { count: 3, style: "infographic", heroNeeded: true, aiCount: 1 }, monetize: { affiliate: null, adDisclosure: false }, schedule: { at: kst(1, 13, 0), slotReason: "티스토리 점심 검색 피크 · 애드센스 자리 2곳" }, coinCost: COIN.blog });
      const yt = S.accounts.find((a) => VIDEO_CH.includes(a.channel) && a.status === "active"); // [P1R5] 영상 계정이 있으면 같은 brief 에 영상 piece(§1.1 채널 선택)
      if (yt) pieces.push({ key: "p3", kind: "video", channel: yt.channel, accountId: yt.id, accountHandle: yt.handle, emotionKey: "shorts", angle: "3초 훅 · 비포/애프터", video: videoSpec(0, yt.id, 60, "graphic"), monetize: { affiliate: t.factors.intent !== "info" ? { provider: "coupang", productQuery: "에어프라이어 세척솔", slot: "end" } : null, adDisclosure: true }, schedule: { at: kst(1, 18, 0), slotReason: "쇼츠 저녁 골든타임 18시 · @" + yt.handle + " 오늘 0/" + yt.dailyCap }, coinCost: VIDEO_COIN.video_60 });
      if (!pieces.length) pieces.push({ key: "p1", channel: "naver_blog", accountId: null, accountHandle: null, format: "story", emotionKey: "warm", composition: "experience", lengthHint: { words: 1400 }, images: { count: 6, style: "photo", heroNeeded: true, aiCount: 1 }, monetize: { affiliate: null, adDisclosure: false }, schedule: { at: kst(1, 7, 30), slotReason: "네이버 블로그 아침 골든타임 · 계정은 연결 후 배정" }, coinCost: COIN.blog });
      /* [B-1 a39b458] 제안 단계 예고 — 첫 spec 이 오늘 자리를 쓸 것이면 usesTodaySlot 을 싣는다(확정이 정본 · 그 사이 자리가 찰 수 있다) */
      { const first = pieces[0]; const s0 = usedSlotOn && first && S.slots.find((s) => s.date === todayYmd && s.channel === first.channel && !s.pieceId && ["planned", "topic_assigned", "assigned", "no_topic"].includes(s.status));
        if (s0) first.usesTodaySlot = { slotId: s0.id, publishAt: s0.publishAt || kst(0, 18, 30) }; }
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
      /* [R7 §1.6] 오늘 이미 잡혀 있던 자리(글 없는 planned 계열)를 먼저 쓴다 — 안 그러면 같은 채널에 하루 두 편이 나간다 */
      let usedSlot = null;
      if (usedSlotOn && !slotRace) { const first = pieces[0];
        const s0 = first && S.slots.find((s) => s.date === todayYmd && s.channel === first.channel && !s.pieceId && ["planned", "topic_assigned", "assigned", "no_topic"].includes(s.status));
        if (s0) { usedSlot = { slotId: s0.id, channel: s0.channel, publishAt: s0.publishAt || kst(0, 18, 30), prevStatus: s0.status }; first._useSlot = s0; if (s0.publishAt) first.schedule.at = s0.publishAt; } }
      for (const p of pieces) { const id = S.nextId++; ids.push(id);
        if (p.kind === "video") { S.pieces.push({ id, channel: p.channel, accountHandle: p.accountHandle, kind: "video", title: t?.title || "새 영상", status: "generating", scheduledFor: p.schedule.at, gateOk: false, createdAt: iso(Date.now()), topicTitle: t?.title, regenCount: 0, coinCost: p.coinCost, bodyHtml: "", meta: { stage: "script", chainStage: { stage: "script", at: iso(Date.now()) }, video: p.video, angle: p.angle, emotionKey: p.emotionKey, scheduleAt: p.schedule.at, tags: [], disclosure: p.monetize.affiliate ? DISCLOSURE : null, affiliate: p.monetize.affiliate ? { provider: "coupang", url: "https://link.coupang.com/a/mock", subId: "piece" + id } : undefined, chainLock: null, chainResume: { count: 0 } }, gate: null, _v0: Date.now() });
          S.slots.push({ id: S.nextId++, date: p.schedule.at ? new Date(new Date(p.schedule.at).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : todayYmd, channel: p.channel, kind: "shorts", accountId: p.accountId, accountHandle: p.accountHandle, status: "producing", publishAt: p.schedule.at, topicTitle: t?.title, pieceId: id, origin: "manual" }); continue; } // [P1R5] §1.2 kind video 행 + slot(shorts)
        S.pieces.push({ id, channel: p.channel, accountHandle: p.accountHandle, kind: "post", format: p.format, title: t?.title || "새 글", status: "generating", stage: "writing", scheduledFor: p.schedule.at, gateOk: false, createdAt: iso(Date.now()), topicTitle: t?.title, regenCount: 0, bodyHtml: p.channel === "tistory" ? BODY_TISTORY : BODY_NAVER, meta: { tags: ["에어프라이어청소"], disclosure: p.monetize.affiliate ? DISCLOSURE : null, affiliate: p.monetize.affiliate ? { provider: "coupang", url: "https://link.coupang.com/a/mock", subId: "piece" + id } : undefined }, gate: gate(true), _t0: Date.now() });
        if (p._useSlot) { Object.assign(p._useSlot, { status: "producing", pieceId: id, topicTitle: t?.title, accountId: p.accountId ?? p._useSlot.accountId, accountHandle: p.accountHandle || p._useSlot.accountHandle }); continue; }   // [R7 §1.6] 그 자리를 쓴다(새로 만들지 않는다)
        S.slots.push({ id: S.nextId++, date: p.schedule.at ? new Date(new Date(p.schedule.at).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : todayYmd, channel: p.channel, kind: "post", accountId: p.accountId, accountHandle: p.accountHandle, status: "producing", publishAt: p.schedule.at, topicTitle: t?.title, pieceId: id, origin: "manual" }); }
      if (t) t.status = "picked"; br._charged = true; br._pieceIds = ids;
      return { ok: true, briefId: br.id, pieceIds: ids, coinsCharged: need, coinsLeft: S.coins, ...(usedSlot ? { usedTodaySlot: usedSlot } : {}), status: 202 }; },
    /* §4 글 */
    "pieces-list": (_b, q) => { tick(); const st = q.get("status") || "all"; const list = S.pieces.filter((p) => st === "all" || p.status === st || (st === "generating" && p.status === "draft")); return { ok: true, pieces: list.map(pieceRow).sort((a, b) => b.id - a.id) }; },
    "pieces-get": (_b, q) => { tick(); const p = S.pieces.find((x) => x.id === Number(q.get("id"))); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 }); const withDisc = (h) => { const clean = h.replace(/^\s*<div class="disclosure">[\s\S]*?<\/div>\s*/, ""); return p.meta.disclosure ? `<div class="disclosure">${p.meta.disclosure}</div>
${clean}` : clean; }; // 고지 = bodyHtml 첫 요소(발행물 정본) · meta.disclosure 는 미러
      if (p.kind === "video") return { ok: true, piece: { ...pieceRow(p), body: p.body || "", blocks: p.blocks || [], assets: p.assets || [], meta: p.meta, gate: p.gate, topicTitle: p.topicTitle, regenCount: p.regenCount, failReason: p.failReason } }; // [P1R5] 영상 = body(설명란 · 첫 줄 고지) + blocks(video·srt·hashtags) + assets(url) + gate.judge
      /* [R8-A §2 · B-1 d6c2359] «왜 이렇게 생겼나» 3축 — 이름·모양은 서버 pieces-get 그대로.
         값은 lib/writing-contracts.ts 의 그 채널 칸에서 복사(label·register·분량·사진).
         🔴 ?why=none = **형식이 없어 주제군을 못 정한 글** — topicGroup 이 null 로 오고 분량이 채널 기본값에서 온다(fromGroup:false). */
      const NV = p.channel === "naver_blog";
      const grp = whyNone ? null : "review";
      const why = {
        topicGroup: grp, goal: NV ? "adpost" : "adsense",
        contract: { channel: p.channel, label: NV ? "네이버 블로그 · 경험담·친근" : "티스토리 · 정보·정리",
          format: whyNone ? null : (p.format || null), formatLabel: whyNone ? null : (NV ? "경험담(계기→해봄→결과→팁)" : "비교 후기"),
          register: NV ? "구어 존댓말 «~했어요 / ~더라고요 / ~거든요» · 1인칭 경험" : "격식 존댓말 «~합니다 / ~입니다» 를 바탕으로, 권유 «~해 보세요»·질문 «~일까요?» 를 섞는 정리 톤",
          length: grp ? (NV ? { min: 1200, max: 2500, fromGroup: true } : { min: 1500, max: 3000, fromGroup: true }) : (NV ? { min: 1500, max: 3000, fromGroup: false } : { min: 3000, max: 12000, fromGroup: false }),
          images: NV ? { min: 6, max: 10, default: 6, fromGroup: false } : (grp ? { min: 5, max: 10, default: 7, fromGroup: true } : { min: 2, max: 4, default: 3, fromGroup: false }),
          goalRules: NV ? ["r1", "r2", "r3"] : ["r1", "r2"],   /* 🔴 화면은 **가짓수만** 쓴다(모델 지시문이라 글자 그대로 안 보여 준다) */
          actualChars: String(p.bodyHtml || "").replace(/<[^>]+>/g, "").length } };
      return { ok: true, piece: { ...pieceRow(p), ...why, bodyHtml: withDisc(p.bodyHtml), blocks: bodyToBlocks(p), images: [{ url: "", caption: "10분 담가 둔 바스켓", sort: 0 }], meta: p.meta, gate: p.gate, topicTitle: p.topicTitle, regenCount: p.regenCount } }; },
    "pieces-approve": (b) => { const nw = notWritable(); if (nw) return nw; const p = S.pieces.find((x) => x.id === Number(b.id)); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 }); if (p.kind === "video" && p.gate?.judge?.grade === "P0") return err("gate", "심사에서 막혔어요 · 다시 만들거나 버려 주세요.", { gate: p.gate }); if (!p.gateOk) return err("gate", "발행 전 확인이 필요해요.", { gate: p.gate }); p.status = "scheduled"; tick(); return { ok: true, status: "scheduled", scheduledFor: p.scheduledFor }; },
    "pieces-reject": (b) => { const p = S.pieces.find((x) => x.id === Number(b.id)); if (p) p.status = "rejected"; return { ok: true, status: "rejected" }; },
    "pieces-regenerate": (b) => { const nw = notWritable(); if (nw) return nw; const p = S.pieces.find((x) => x.id === Number(b.id)); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 }); if (p.regenCount >= 1) return err("regen_limit", "다시 만들기는 한 번만 할 수 있어요."); p.regenCount++; p.status = "generating"; if (p.kind === "video") { p.meta.stage = "script"; p.meta.chainStage = { stage: "script", at: iso(Date.now()) }; p.gate = null; p.gateOk = false; delete p.assets; delete p.blocks; p.body = ""; /* 산출물 삭제 — 안 지우면 이어받기가 «이미 있음»으로 건너뛴다 */ delete p._t0; p._v0 = Date.now(); const sl = S.slots.find((s) => s.pieceId === p.id); if (sl) sl.status = "producing"; return { ok: true, status: "generating" }; } p.stage = "writing"; p._t0 = Date.now(); return { ok: true, status: "generating" }; }, // [P1R5] 영상 재생성 = 코인 0 · 처음부터
    "pieces-update": (b) => { const p = S.pieces.find((x) => x.id === Number(b.id)); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 }); if (b.title) p.title = b.title;
      if (p.kind === "video") {
        /* [R8-A fix ① · B-1] 영상에도 «대가 켜기» 입구 — 켜기만 받는다. 고지는 3중(배지·시작 3초 자막·설명란 첫 줄)인데
           🔴 배지·자막은 **구울 때** 굳는다 — 이미 만들어진 영상엔 없다. 그래서 `needsRerender` 를 실어 준다(문구도 서버 것 그대로). */
        const vmz = b.monetize || {}; let needsRerender = false;
        if (vmz.sponsored === true || vmz.gift === true) {
          if (vmz.sponsored === true) p.meta.sponsored = true;
          if (vmz.gift === true) p.meta.gift = true;
          p.meta.adDisclosure = true; p.meta.disclosure = discTextOf(p.meta);
          const lines = String(p.body || "").split("\n");
          p.body = [p.meta.disclosure, ...lines.filter((l, i) => !(i === 0 && (l.includes(DISCLOSURE) || l.includes(DISC_SPONSORED) || l.includes(DISC_GIFT))))].join("\n");
          p.meta.description = p.body;
          if (p.meta.video) p.meta.video.disclosure = { ...(p.meta.video.disclosure || {}), badge: true, descriptionFirstLine: true };
          needsRerender = (p.assets || []).some((a) => a.kind === "video");   // 이미 구워진 mp4 가 있으면 다시 구워야 배지가 뜬다
        }
        if (typeof b.body === "string") { const first = String(p.body || "").split("\n")[0]; const rest = b.body.split("\n").filter((l, i) => !(i === 0 && l === first)); p.body = p.meta.video.disclosure.descriptionFirstLine ? [first, ...rest].join("\n") : b.body; }
        if (Array.isArray(b.tags)) { p.meta.tags = b.tags.map((x) => String(x).replace(/^#/, "")).filter(Boolean).slice(0, 15); const hb = (p.blocks || []).find((x) => x.type === "hashtags"); if (hb) hb.tags = p.meta.tags; }
        return { ok: true, gate: p.gate, body: p.body, tags: p.meta.tags, ...(p.meta.disclosure ? { disclosureFirstLine: String(p.body || "").split("\n")[0] } : {}),
          ...(needsRerender ? { needsRerender: true, needsRerenderWhy: "이미 만들어진 영상에는 광고 배지가 없어요. 다시 만들어야 화면에 배지와 시작 자막이 들어가요." } : {}) };
      }   /* [P1R5] 설명란 편집 · 첫 줄 고지는 서버가 잠근다 */
      /* 🔴 여기부터 있던 코드가 윗줄 «//» 주석에 통째로 먹혀 있었다(2026-09-15 발견) — 본문 저장도 게이트 갱신도 안 됐다.
         한 줄 안에서는 «//» 뒤가 전부 주석이다. 줄 가운데 설명은 여러 줄 주석으로만 적는다(같은 사고 세 번째). */
      if (b.bodyHtml) p.bodyHtml = b.bodyHtml.replace(/^\s*<div class="disclosure">[\s\S]*?<\/div>\s*/, "");
      /* [R8-A §4] 대가 켜기 — 🔴 **켜기만 받는다**(false 는 무시 · 서버 pieces-update 와 같다). 종류가 늘면 고지 문장도 늘어난다. */
      const mz = b.monetize || {};
      if (mz.sponsored === true) p.meta.sponsored = true;
      if (mz.gift === true) p.meta.gift = true;
      if (mz.sponsored === true || mz.gift === true) { p.meta.adDisclosure = true; p.meta.disclosure = discTextOf(p.meta); }
      p.gate = gate(true); p.gateOk = gateOkOf(p.gate);
      const body = p.meta.disclosure ? `<div class="disclosure">${p.meta.disclosure}</div>
${p.bodyHtml}` : p.bodyHtml; return { ok: true, gate: p.gate, bodyHtml: body }; },
    /* §5 규칙·슬롯 */
    /* [R7 §4.3 · B3] 코인 미리보기·자동 승인 판정 재료 — 포함분 0(체험)도 0 그대로 싣는다 */
    "rules-list": () => ({ ok: true, rules: S.rules, settings: S.settings, coinsPerWeek: coinsPerWeek(), maxRules: planKnob === "pro" || planKnob === "agency" ? null : 3, includedCoins: planKnob === "starter" ? 40 : 150, planKey: planKnob || "pro", autoApprove: planKnob !== "starter" }),
    /* 🔴 한도 거절 모양은 **서버 rules.ts 그대로** — 402 `plan_limit`(resource·used·limit·planKey). 종전엔 `step:"limit"` 이라
       화면의 공통 막힘 시트(UI.gate)가 안 걸리고 토스트만 떴다(2026-09-15 발견 · 모의만 옛 모양이었다). */
    "rules-save": (b) => { const want = (b.rules || []).filter((r) => r.active !== false).length; const cap = planKnob === "pro" || planKnob === "agency" ? null : 3;
      if (cap !== null && want > cap) return { ok: false, status: 402, reason: "plan_limit", step: "plan_limit", resource: "rules", used: want, limit: cap, planKey: planKnob || "trial", error: `편성 규칙은 ${cap}개까지예요. Pro 로 바꾸면 제한이 없어요.` };
      const before = S.slots.length; S.rules = (b.rules || []).map((r, i) => ({ id: r.id || S.nextId++, kind: "post", active: true, ...r })); S.slots = S.slots.filter((s) => s.origin === "manual" || S.rules.some((r) => r.channel === s.channel)); rollSlots(); return { ok: true, rules: S.rules, coinsPerWeek: coinsPerWeek(), slotsCreated: S.slots.length - before }; },
    "rules-settings": (b) => { if (planKnob === "starter" && !keptAuto && b.reviewPolicy === "silence_approves") return { ok: false, status: 402, reason: "plan_limit", step: "plan_feature", feature: "autoApprove", planKey: "starter", error: "«조용하면 발행»은 Pro 요금제부터 쓸 수 있어요. 지금 요금제에서는 발행 전에 한 번 확인해 주세요." }; for (const k of ["autoSchedule", "horizonDays", "topicLeadDays", "produceLeadDays", "produceHour", "reviewPolicy", "bestTimeMode", "weeklyCoinCap", "quietDays"]) if (b[k] !== undefined) S.settings[k] = b[k]; S.slots = S.slots.filter((s) => s.origin === "manual" || !(S.settings.quietDays || []).includes(s.date)); rollSlots(); return { ok: true, settings: S.settings }; },
    "slots-list": (_b, q) => { tick(); const from = q.get("from") || "0000", to = q.get("to") || "9999";
      const list = S.slots.filter((s) => s.date >= from && s.date <= to).sort((a, b) => (a.publishAt || "").localeCompare(b.publishAt || "")).map((s) => ({ ...s }));
      const skip = list.find((s) => s.date === todayYmd && !s.pieceId && ["planned", "topic_assigned", "assigned"].includes(s.status)); if (skip) skip.skipReason = "too_soon"; // [실측 정정] 오늘 만드는 시각(produceHour)이 지난 글 없는 자리 1개에만 서버가 too_soon 을 싣는다 · 나머지는 키 없음(화면 계산 금지)
      /* [R7 §4.3 · B3] note = 서버가 그 자리에 적어 둔 사람말(있을 때만) · revenueKrw = 30일 수익(수집 행이 없으면 키 자체가 없다) */
      for (const s of list) { const seed = S.slotNotes && S.slotNotes[s.id]; if (seed) s.note = seed;
        if (s.status === "published" && s.pieceId) s.revenueKrw = (s.pieceId * 137) % 9000 + 800; }
      return { ok: true, slots: list }; },
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
      const need = s.kind === "shorts" ? VIDEO_COIN.video_60 : s.kind === "cardnews" ? COIN.cardnews : COIN.blog; if (need > S.coins) return err("coin_short", `코인이 ${need - S.coins}개 부족해요.`, { need, have: S.coins });
      S.coins -= need; const id = S.nextId++;
      S.pieces.push({ id, channel: s.channel, accountHandle: s.accountHandle, kind: "post", format: "story", title: s.topicTitle, status: "generating", stage: "writing", scheduledFor: s.publishAt, gateOk: false, createdAt: iso(Date.now()), topicTitle: s.topicTitle, regenCount: 0, bodyHtml: s.channel === "tistory" ? BODY_TISTORY : BODY_NAVER, meta: { tags: [], disclosure: null }, gate: gate(true), _t0: Date.now() });
      s.pieceId = id; s.status = "producing"; return { ok: true, pieceId: id }; },
    /* ── [P1R2] §6 발행함 ── */
    /* [R7 §1.3 · B-1] 영상 파일 내려받기 — 10분짜리 서명(파일 이름은 서명 안에 있다) · 아직 없으면 no_render + stage */
    "piece-video": (_b, q) => { tick(); const p = S.pieces.find((x) => x.id === Number(q.get("id")));
      if (!p) return { ok: false, status: 404, step: "not_found", error: "글을 찾을 수 없어요." };
      const st = p.meta?.stage;
      if (vdlKnob === "none" || p.kind !== "video" || st !== "done") return { ok: false, status: 404, step: "no_render", pieceId: p.id, stage: st || "script", error: "아직 영상 파일이 없어요. 다 만들어지면 여기서 받을 수 있어요." };
      const url = URL.createObjectURL(new Blob([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], { type: "application/octet-stream" }));   // 실서버는 서명에 Content-Disposition 이 있어 «받아진다» — 모의는 octet-stream 으로 같은 효과
      const day = todayYmd.replace(/-/g, "");
      /* [R8 §3.2 · B2 lib/manual-upload.ts] 우리가 못 올리는 채널(클립)이면 **넘겨주는 길**도 같이 — 문장·걸음은 서버 것 그대로.
         🔴 `appOpenVerified:false` = «앱으로 열린다»를 우리가 재 보지 않았다. 화면이 그렇게 쓰면 안 된다. */
      const handoff = p.channel === "naver_clip" ? {
        channel: "naver_clip", label: "네이버 클립", openUrl: "https://clip.naver.com/", openLabel: "네이버 클립 열기", appOpenVerified: clipVerified,
        steps: ["휴대폰에서 이 화면을 열어 주세요(알림을 누르면 바로 옵니다).", "«영상 받기»를 눌러 휴대폰에 저장해 주세요.", "네이버 앱에서 클립으로 올린 다음, 올린 주소를 여기에 붙여 넣어 주세요."],
        why: "네이버 클립은 휴대폰 앱에서만 올릴 수 있어요(공개된 업로드 방법이 없어요).",
      } : null;
      return { ok: true, pieceId: p.id, channel: p.channel, status: p.status, url, filename: `AC-${p.id}-${day}.mp4`, expiresInSec: 600, bytes: 8_400_000, durationSec: p.meta?.video?.seconds || 60, stage: st, ...(handoff ? { handoff } : {}) };
    },
    /* [R7 §1.3 · B-1] 앱에서 직접 올린 주소 적기 — 채널이 쓰는 호스트인지 보고(다른 채널이면 그 채널 이름으로 말한다) 발행함·편성표에 반영 */
    "post-mark-published": (b) => { const nw = notWritable(); if (nw) return nw;
      const p = S.pieces.find((x) => x.id === Number(b.pieceId));
      if (!p) return { ok: false, status: 404, step: "not_found", error: "글을 찾을 수 없어요." };
      if (["generating", "failed"].includes(p.status)) return { ok: false, status: 400, step: "status", error: "아직 만드는 중이에요. 다 만들어진 뒤에 적어 주세요." };
      const raw = String(b.url || "").trim();
      if (raw.length > 300) return { ok: false, status: 400, step: "url", reason: "too_long", error: "주소가 너무 길어요." };
      let u; try { u = new URL(raw); } catch { return { ok: false, status: 400, step: "url", reason: "parse", error: "주소 모양이 아니에요." }; }
      if (u.protocol !== "https:") return { ok: false, status: 400, step: "url", reason: "scheme", error: "https:// 로 시작하는 주소여야 해요." };
      const HOSTS = { naver_blog: ["blog.naver.com"], naver_clip: ["blog.naver.com", "clip.naver.com", "tv.naver.com"], tistory: ["tistory.com"], blogger: ["blogspot.com"], wordpress: ["wordpress.com"], threads: ["threads.net"], instagram: ["instagram.com"], reels: ["instagram.com"], youtube_shorts: ["youtube.com", "youtu.be"], tiktok: ["tiktok.com"] };
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      const okHost = (HOSTS[p.channel] || []).some((h) => host === h || host.endsWith("." + h));
      if (!okHost) { const other = Object.keys(HOSTS).find((k) => (HOSTS[k] || []).some((h) => host === h || host.endsWith("." + h)));
        return { ok: false, status: 400, step: "url", reason: other ? "other_channel" : "domain",
          error: other ? `${CH_LABEL[other] || other} 주소예요. 이 글은 ${CH_LABEL[p.channel] || p.channel}에 올린 주소가 필요해요.` : `${CH_LABEL[p.channel] || p.channel} 주소가 아니에요.` }; }
      const clean = u.origin + u.pathname;   // 추적 꼬리표(utm_·si)는 서버가 떼어 준다
      const exist = S.posts.find((x) => x.pieceId === p.id && x.externalUrl);
      if (exist) return { ok: true, postId: exist.id, pieceId: p.id, channel: p.channel, already: true, url: exist.externalUrl, message: "이미 적어 둔 글이에요. 발행함에서 볼 수 있어요." };
      const post = { id: S.nextId++, pieceId: p.id, channel: p.channel, accountHandle: p.accountHandle, title: p.title, externalUrl: clean, publishedVia: "manual", publishedAt: iso(Date.now()), status: "published", stats: {}, alive: true };
      S.posts.unshift(post); p.status = "published"; p.externalUrl = clean;
      const sl = S.slots.find((s) => s.pieceId === p.id); if (sl) sl.status = "published";
      return { ok: true, postId: post.id, pieceId: p.id, channel: p.channel, already: false, url: clean, slotId: sl?.id, message: "발행함에 넣었어요. 편성표에서도 «발행됨»으로 보여요." };
    },
    "posts-list": (_b, q) => { const from = q.get("from") || "0000", to = q.get("to") || "9999", st = q.get("status") || "all";
      const day = (p) => p.publishedAt ? new Date(new Date(p.publishedAt).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : null;
      /* [R8 §3 · B2 lib/channel-registry.ts retractVia] 🔴 **우리가 대신 내릴 수 있는 채널만** true — 유튜브·쓰레드는 삭제 권한이 없다.
         화면은 이 값으로 단추를 켜고 끈다(없는 되돌리기를 단추로 만들지 않게). */
      const CAN_RETRACT = { naver_blog: true, tistory: true, blogger: true, wordpress: true, naver_clip: false, youtube_shorts: false, reels: false, threads: false, instagram: false, tiktok: false };
      /* [R8 §9 · B3] 🔴 나간 뒤에도 «그때 이런 지적이 있었다»를 본다 — 저장된 보고서에서 **실패 칸 수**와 **무거운 것이 있었나**를 읽는다.
         무게가 없는 옛 보고서는 개수만 온다(없는 것을 «무거움»으로 지어내지 않는다). */
      const riskOf = (p) => { const pc = S.pieces.find((x) => x.id === p.pieceId); const bad = ((pc && pc.gate && pc.gate.checks) || []).filter((c) => !c.pass);
        return bad.length ? { riskCount: bad.length, ...(bad.some((c) => c.weight === "high") ? { riskHigh: true } : {}) } : {}; };
      return { ok: true, posts: S.posts.filter((p) => { const d = day(p); return (d === null || (d >= from && d <= to)) && (st === "all" || p.status === st); }).sort((a, b) => (b.publishedAt || "9999").localeCompare(a.publishedAt || "9999")).map((p) => ({ ...p, canRetract: CAN_RETRACT[p.channel] !== false, ...riskOf(p), ...(S.retracted[p.id] ? { retractedAt: S.retracted[p.id] } : {}) })) }; },
    /* [R8 §3 · DESIGN §5E] «내려 줘» — 문장·상태는 lib/publish/retract.ts 그대로. 🔴 코인 0(consume 호출이 아예 없다) */
    "post-retract": (b) => {
      const p = S.posts.find((x) => x.id === Number(b.postId)); if (!p) return { ok: false, state: "not_found", message: "그 글을 찾을 수 없어요.", status: 404 };
      if (S.retracted[p.id]) return { ok: true, state: "already", message: "이미 내렸어요.", ...(p.externalUrl ? { openUrl: p.externalUrl } : {}) };
      const CAN = { naver_clip: false, youtube_shorts: false, reels: false, threads: false, instagram: false, tiktok: false };
      if (CAN[p.channel] === false) return { ok: false, state: "unsupported", status: 409,
        message: `«${UI.chLabel(p.channel)}» 은 우리가 대신 내려 드릴 수 없어요. 아래 주소로 가서 직접 내려 주세요.`, ...(p.externalUrl ? { openUrl: p.externalUrl } : {}) };
      const runner = ["naver_blog", "tistory"].includes(p.channel);
      S.retracted[p.id] = iso(Date.now());
      if (runner) return { ok: true, state: "queued", message: "내 PC 프로그램이 켜지면 그 글을 내릴게요. 끝나면 정말 내려갔는지 한 번 더 확인해요.", ...(p.externalUrl ? { openUrl: p.externalUrl } : {}) };
      return { ok: true, state: "done", message: "글을 내렸어요. 정말 내려갔는지 한 번 더 확인할게요." };
    },
    /* ── [P1R2] §2 러너 기기(내 PC 프로그램) ── */
    "runner-list": () => { tick(); return { ok: true, devices: S.devices.map(devRow) }; },
    "runner-register": (b) => { const name = String(b.name || "").trim(); if (!name) return err("name", "기기 이름을 적어 주세요.");
      if (S.devices.length >= 3) return err("limit", "이 요금제에서는 기기를 3대까지 연결할 수 있어요.");
      const token = "acr_" + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
      const d = { id: S.nextId++, name, kind: b.kind || "own", online: false, jobsWaiting: 0, _t0: Date.now() }; S.devices.push(d);
      return { ok: true, device: { id: d.id, name: d.name, token }, install: { cmd: "run.bat (Windows) · ./run.sh (Mac·Linux)", url: location.origin + "/api/runner-download", token, steps: ["내려받은 zip 을 압축 풀기", "run.bat 두 번 클릭(Mac·Linux 는 ./run.sh)", "토큰 붙여넣기"] } }; }, // [러너 배포] 서버 install 모양 그대로(lib/runner-jobs registerDevice)
    /* [러너 배포] 내려받기 — 로그인·쓰기 가능·플랜에 러너가 있어야 10분짜리 링크. 모의 링크는 빈 zip blob(화면을 떠나지 않고 «받아진다») */
    "runner-download": () => { const nw = notWritable(); if (nw) return nw;
      if (runnerDl === "plan") return { ok: false, status: 403, step: "plan", planKey: "starter", error: "지금 요금제에는 «내 PC에서 켜기»가 없어요. 요금제를 바꾸면 바로 받을 수 있어요." };
      if (runnerDl === "none") return { ok: false, status: 503, step: "no_release", error: "프로그램을 준비 중이에요. 잠시 뒤 다시 눌러 주세요." };
      const url = URL.createObjectURL(new Blob([new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])], { type: "application/zip" }));
      return { ok: true, version: "1.1.3", bytes: 13107200, sha256: "3f1c0a9e5b7d2c4e6a8f0b1d3e5c7a9b2d4f6e8a0c1b3d5f7a9c2e4b6d8f0a1c", filename: "autocreate-runner-v1.1.3.zip", url, expiresInSec: 600 }; },
    /* [러너 배포] 열쇠 재발급 — 옛 열쇠 즉사 · 지문(묶기) 초기화 · 평문은 이 응답 1회뿐 */
    "runner-rotate": (b) => { const nw = notWritable(); if (nw) return nw; const d = S.devices.find((x) => x.id === Number(b.id)); if (!d) return { ok: false, status: 404, step: "not_found", error: "기기를 찾을 수 없어요." };
      const token = "acr_" + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
      d.online = false; delete d.bound; delete d.otherDeviceAt; delete d.otherDeviceCount; delete d._t0;
      return { ok: true, device: { id: d.id, name: d.name, token }, install: { steps: ["받은 폴더에서 run.bat 을 다시 실행", "새 토큰 붙여넣기"] } }; },
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
      /* [여정 점검 9 · B3 확인] 라이브에선 연결 안 된 소스에 수익이 없다 — 모의도 그렇게(«키 필요»인데 금액이 붙는 조합을 만들지 않는다) */
      const bySource = groupKrw(mine, "source").filter(([source]) => { const s = S.revSources.find((x) => x.source === source); return !s || s.status === "connected"; })
        .map(([source, krw]) => { const s = S.revSources.find((x) => x.source === source);
          const o = { source, krw, freshness: srcFreshness(source) }; if (s?.lastSyncAt) o.lastSyncAt = s.lastSyncAt;
          /* [B2 8a71d69] 애드포스트처럼 «예상 수입» 열만 주는 매체 — 서버가 도장을 찍고 노트를 준다(?est=1) */
          if (estKnob && source === "adpost") { o.amountEstimated = true; o.note = "«예상수입» 열로 읽었어요 — 확정 금액이 아니라 예상치예요"; }   /* [B2 a8de1d5] 이름·문구 모두 서버 것 */
          return o; });
      const byAccount = groupKrw(mine.filter((r) => r.accountId), "accountId").map(([id, krw]) => { const a = S.accounts.find((x) => x.id === Number(id)) || {};
        return a.handle ? { accountId: Number(id), handle: a.handle, channel: a.channel || "", krw } : { accountId: Number(id), handle: "지운 계정", channel: "", krw, deleted: true }; });   // [B3 24d16d6] 서버가 이름을 붙인다
      const topPieces = groupKrw(mine.filter((r) => r.pieceId), "pieceId").slice(0, 5).map(([id, krw]) => { const p = S.pieces.find((x) => x.id === Number(id)) || {};
        return p.id ? { pieceId: Number(id), title: p.title || "제목 없는 글", channel: p.channel, krw, ...(p.title ? {} : { untitled: true }) } : { pieceId: Number(id), title: "지운 글", channel: "", krw, deleted: true }; });
      return { ok: true, monthKrw: sum(mine), todayConfirmedKrw: todayConfirmed(), todayEstimatedKrw: todayEstimated(),
        prevMonthKrw: sum(S.revRows.filter((r) => inM(r, prevMonth(month)))), bySource, byAccount, topPieces }; },
    "revenue-daily": (_b, q) => { const from = q.get("from") || "0000", to = q.get("to") || "9999";
      const days = groupKrw(S.revRows.filter((r) => r.day >= from && r.day <= to), "day").sort((a, b) => a[0].localeCompare(b[0]));
      /* [B2 a8de1d5] 그 날에 «예상 열» 행이 섞였나 — 없으면 키 자체가 없다(옛 데이터엔 안 붙는다) */
      const estDay = (day) => estKnob && S.revRows.some((r) => r.day === day && r.source === "adpost");
      return { ok: true, days: days.map(([day, krw]) => ({ day, krw, freshness: dayFreshness(day), ...(estDay(day) ? { amountEstimated: true } : {}) })) }; },
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
        const le = revError === s.source ? "auth" : s.lastError; if (le) o.lastError = le;
        const basis = BASIS_OF[s.source]; if (basis && basis !== "kst") { o.dayBasis = basis; if (DAY_BASIS_NOTE[basis]) o.dayBasisNote = DAY_BASIS_NOTE[basis]; }   // [B3 6a5ab40] KST 가 아닌 매체만 말한다
        return o; }) }; },
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
      /* [R8 §3.2 · B2 lib/ads-connect.ts] 광고를 실제로 붙이기·떼기 — 문장은 서버 것 그대로.
         🔴 티스토리는 러너가 **상태를 읽기만** 해서 뗄 수 없다(«붙이기»도 실은 확인이다) · 길이 없는 채널은 정직하게 막는다. */
      if (b && (b.action === "connect_ads" || b.action === "disconnect_ads")) {
        const nw = notWritable(); if (nw) return nw;
        const id = Number(b.accountId); const a = S.accounts.find((x) => x.id === id);
        if (!a) return { ok: false, way: null, state: "no_account", message: "계정을 찾을 수 없어요.", status: 409 };
        const way = { wordpress: "wp_widget", tistory: "runner_tistory", blogger: "runner_blogger" }[a.channel] || null;
        const back = (o) => ({ ...o, connect: o, accounts: eligibility(), thresholds: AD_THRESHOLDS, links: AD_LINKS, status: o.ok ? 200 : 409 });
        if (!way) return back({ ok: false, way: null, state: "unsupported", message: `«${a.channel}» 은 아직 광고를 자동으로 붙일 수 없어요. 준비되면 이 화면에서 바로 눌러 붙일 수 있어요.` });
        if (b.action === "disconnect_ads" && way === "runner_tistory") return back({ ok: false, way, state: "unsupported", message: "티스토리 광고는 티스토리 «수익» 설정에서 직접 꺼 주세요. 우리가 대신 끄지는 않아요." });
        if (way === "wp_widget") { const on = b.action === "connect_ads"; S.adsAttached[id] = on;
          return back({ ok: true, way, state: on ? "done" : "removed", message: on ? "사이드바에 광고를 넣었어요." : "광고를 뺐어요. 원래 위젯은 그대로 있어요." }); }
        return back({ ok: true, way, state: "queued", message: way === "runner_tistory" ? "내 PC 프로그램이 켜지면 티스토리 광고 연결 상태를 확인할게요."
          : b.action === "connect_ads" ? "내 PC 프로그램이 켜지면 블로그에 광고를 넣을게요." : "내 PC 프로그램이 켜지면 광고를 빼고 원래대로 돌려놓을게요." });
      }
      if (b && b.action) { const id = Number(b.accountId); if (!id) return err("accountId", "계정을 골라 주세요.");
        const src = ["adpost", "ypp", "adsense", "clip"].includes(b.source) ? b.source : null; if (!src) return err("source", "어느 매체인지 골라 주세요.");
        S.adState[src][id] = b.action === "approved" ? "approved" : "pending"; return { ok: true, accounts: eligibility() }; }
      return { ok: true, thresholds: AD_THRESHOLDS, links: AD_LINKS, accounts: eligibility() }; },
    /* [R8 §4.2 · B] «지금 올리기» — 예약된 글을 5분 크론까지 기다리지 않고 내보낸다. 문장·모양은 netlify/functions/publish-now.ts 그대로.
       ?pubnow= cadence(간격에 걸림) · offline(내 PC 가 꺼져 있다) · gate(검사에 걸림) · connector(발행 준비 전) */
    "publish-now": (b) => {
      const nw = notWritable(); if (nw) return nw;
      const p = S.pieces.find((x) => x.id === Number(b.pieceId)); if (!p) return err("not_found", "글을 찾을 수 없어요.", { status: 404 });
      if (p.status === "published") return { ok: true, state: "already", pieceId: p.id, ...(p.externalUrl ? { postUrl: p.externalUrl } : {}), message: "이미 올라간 글이에요." };
      if (!["scheduled", "approved"].includes(p.status)) return { ok: false, step: "state", status: 400,
        error: p.status === "in_review" || p.status === "draft" ? "먼저 검수에서 승인해 주세요. 승인하면 바로 올릴 수 있어요." : "지금 상태로는 올릴 수 없어요. 발행함에서 상태를 확인해 주세요." };
      if (pubNow === "connector") return { ok: false, step: "connector", status: 503, error: "발행 준비가 아직 끝나지 않았어요. 준비되면 예약한 시간에 자동으로 나가요." };
      if (pubNow === "gate") return { ok: false, step: "gate", status: 400, error: "발행 전 검사에 걸렸어요. 검수 화면에서 고치고 다시 승인해 주세요." };
      if (pubNow === "cadence") { const at = new Date(Date.now() + 90 * 60e3);
        const hhmm = at.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
        return { ok: false, step: "cadence", status: 400, retryAt: iso(at.getTime()), gapMin: 180, error: `이 계정은 글 사이를 180분 띄워요. ${hhmm}부터 올릴 수 있어요.` }; }
      if (pubNow === "offline") { p.status = "publishing"; return { ok: true, state: "publishing", pieceId: p.id, runner: { online: false }, message: "내 PC 프로그램이 꺼져 있어요. 켜면 기다리던 글이 바로 나가요." }; }
      p.status = "published"; p.publishedAt = iso(Date.now()); p.externalUrl = `https://blog.naver.com/${p.accountHandle || "mock"}/22${S.nextId++}`;
      const sl = S.slots.find((s) => s.pieceId === p.id); if (sl) sl.status = "published";
      return { ok: true, state: "published", pieceId: p.id, postUrl: p.externalUrl, message: `«${p.title}» 을(를) 올렸어요.` };
    },
    /* [R7 §3.1] 탈퇴 · 되돌리기 — 서버 account-close.ts 그대로: 신청하면 즉시 «보기만» + 30일 뒤 파기 예약 · 그 전엔 되돌린다.
       🔴 문구·날짜는 서버가 준다 — 화면은 받아 쓴다. graceDays 도 서버 값(화면에 30을 박지 않는다). */
    "account-close": (b, _q, opts) => {
      const GRACE = 30;
      if (!opts || !opts.body) {   // GET — 설정·홈이 «예약 중인가»를 묻는 자리
        if (!S.close) return { ok: true, closed: false, graceDays: GRACE };
        return { ok: true, closed: true, closedAt: S.close.closedAt, purgeAt: S.close.purgeAt, daysLeft: Math.max(0, Math.ceil((new Date(S.close.purgeAt).getTime() - Date.now()) / 86400e3)), graceDays: GRACE };
      }
      if (closeSub) return { ok: false, step: "subscription", error: "구독이 아직 살아 있어요. 요금제 화면에서 해지한 뒤에 탈퇴해 주세요.", status: 400 };
      if (S.close) return { ok: true, closedAt: S.close.closedAt, purgeAt: S.close.purgeAt, graceDays: GRACE, already: true };   // 멱등
      const at = Date.now();
      S.close = { closedAt: iso(at), purgeAt: iso(at + GRACE * 86400e3), reason: String(b.reason || "").slice(0, 200) || null };
      S.notifications.unshift({ id: S.nextId++, kind: "account_closing", title: "탈퇴가 접수됐어요", desc: "30일 뒤에 데이터가 지워져요. 그 전에는 «되돌리기»로 그대로 돌아올 수 있어요. 지금은 보기만 할 수 있어요.", link: "/app/settings.html", tone: "warn", createdAt: iso(at) });
      return { ok: true, closedAt: S.close.closedAt, purgeAt: S.close.purgeAt, graceDays: GRACE };
    },
    "account-restore": () => { S.close = null; return { ok: true, status: "trial", closed: false, graceDays: 30 }; },
    /* §6 코인 */
    "coins-balance": () => { const purchased = Math.max(0, S.billing.ledger.filter((l) => l.bucket === "purchased").reduce((a, l) => a + l.amount, 0)); return { ok: true, balance: S.coins, included: Math.max(0, S.coins - purchased), purchased, recent: S.billing.ledger.slice(0, 20).map((l) => ({ kind: l.kind, delta: l.amount, item: l.item, reason: l.reason, createdAt: l.at })) }; },
  };

  const real = UI.api;
  UI.api = async function (path, opts = {}) {
    const u = new URL(path, location.origin); const name = u.pathname.replace(/^\/api\//, "");
    const h = R[name]; if (!h) return real(path, opts);
    await delay(); const r = h(opts.body || {}, u.searchParams, opts); save();
    const status = r.status || 200; const out = { ...r, status, ok: !!r.ok }; if (!opts.noGate && UI.gate(out)) out.gated = true; return out; // 실서버 UI.api 와 같은 게이트 처리
  };
  /* [P1R6 §1.1] 모의 R2 — presign 주소로 가는 PUT 만 가로챈다(나머지 fetch 는 그대로) */
  const rawFetch = window.fetch.bind(window);
  window.fetch = (input, init) => { const u = String((input && input.url) || input || "");
    if (u.includes("/mock-r2/")) return Promise.resolve(new Response(null, { status: uploadKnob === "fail" ? 500 : 200 }));
    return rawFetch(input, init); };

  /* 링크·이동에 mock=1 이어 붙이기 */
  const KEEP = ["runner", "refreshMs", "refreshFail", "revEmpty", "revError", "trial", "readonly", "suspended", "planLimit", "kicc", "incident", "imp", "payFail", "fp", "aiCap", "banned", "stage", "judge", "noFfmpeg", "uploaded", "videoBudget", "keyin", "keyinMid", "supplier", "share", "managed", "export", "amOff", "mail", "verified", "mailFail", "payReason", "autoOff", "runnerDl", "otherPc", "upload", "company", "kinds", "chOpen", "plan", "kept", "vdl", "judgePending", "usedSlot", "slotRace", "slots", "slotCoins", "est", "oneCh", "closed", "closeSub", "gate", "why", "pubnow", "ads", "clip", "clipApp"]; // 모의 전용 손잡이는 화면 왕복 중에도 유지(fresh·reset 은 일부러 제외)
  const withMock = (href) => { try { const u = new URL(href, location.origin); if (u.origin !== location.origin || !(u.pathname.startsWith("/app/") || ["/onboarding.html", "/receipt.html", "/register.html"].includes(u.pathname))) return href; u.searchParams.set("mock", "1"); for (const k of KEEP) if (qs.has(k)) u.searchParams.set(k, qs.get(k)); return u.pathname + u.search + u.hash; } catch { return href; } };
  UI.go = (href) => location.assign(withMock(href));
  UI.postForm = (url) => { const u = new URL(url, location.origin); if (u.pathname !== "/mock-kicc") return location.assign(url); const orderNo = u.searchParams.get("orderNo") || ""; const fail = qs.get("payFail") === "1";
    const reason = qs.get("payReason") || "approve"; // 실측 어휘: params · approve · pg · cancelled · 거절 코드(8373)
    if (orderNo.startsWith("AC-BK-") || orderNo.startsWith("AC-BKK-")) { if (!fail) S.billing.billingKey = { brand: "신한", last4: "4421" }; save(); return location.assign(withMock(`/app/plan.html?key=${fail ? "fail&reason=" + encodeURIComponent(reason) : "ok"}${!fail && qs.get("fp") === "reused" ? "&trial=reused" : ""}`)); }
    if (fail) { const o = S.billing.orders.find((x) => x.orderNo === orderNo); if (o) o.status = "failed"; save(); return location.assign(withMock("/app/coins.html?failed=" + encodeURIComponent(reason === "cancelled" ? "결제가 취소됐어요" : "카드사 응답: 거절") + "&reason=" + encodeURIComponent(reason))); }
    settleCoin(orderNo); save(); location.assign(withMock("/app/coins.html?charged=" + encodeURIComponent(orderNo))); };
  document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("a[href]"); if (!a) return; const h = a.getAttribute("href"); if (!h || h.startsWith("javascript:") || h.startsWith("#")) return; const m = withMock(h); if (m !== h) a.setAttribute("href", m); }, true);
  const badge = document.createElement("div"); badge.textContent = "모의 데이터"; badge.style.cssText = "position:fixed;bottom:calc(var(--tab-h) + 6px);left:8px;z-index:99;font-size:10px;font-weight:700;color:var(--surface);background:var(--ink);border-radius:6px;padding:2px 6px;pointer-events:none"; document.body.appendChild(badge);
})();
