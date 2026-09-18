/* ui.js — 컴포넌트 12개의 동작 + 공용 셸(탭·레일·로그인 판정·토스트·시트·카운트업). AM shell.js 관례 이식(2026-09-14).
   규칙: 로그인 여부는 쿠키가 아니라 첫 API 401로 판정(CLAUDE §4.3). 시스템 용어를 화면에 쓰지 않는다. */
(function () {
  const UI = (window.UI = window.UI || {});
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  UI.$ = $; UI.$$ = $$;

  /* ── API ── */
  UI.api = async function (path, opts = {}) {
    const init = { method: opts.method || (opts.body ? "POST" : "GET"), headers: { "Accept": "application/json" }, credentials: "same-origin" };
    if (opts.body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    let res;
    try { res = await fetch(path, init); } catch { return { ok: false, error: "네트워크가 불안정해요. 다시 시도해 주세요.", status: 0 }; }
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    /* 🔴 [2026-09-19 수리 ②] **401 이 언제나 «세션이 끊겼다»는 뜻은 아니다.**
       종전엔 모든 401 을 세션으로 읽어 refresh → 같은 요청 재시도 → `/login.html` 로 **내보냈다**.
       그래서 설정에서 **현재 비밀번호를 한 번 틀리면 손님이 로그인 화면으로 쫓겨났고**(세션은 멀쩡했다),
       서버가 보낸 «현재 비밀번호가 맞지 않아요»(`step:"current"`)는 화면에 닿지도 못했다
       (`settings.html` 의 `UI.fieldError` 가 그 문장을 띄우려던 참이었다 · 시나리오 A §12).
       ⇒ **세션이 끊겼다고 서버가 말한 401 에서만** 내보낸다. 나머지 401 은 그대로 화면에 돌려준다.
       🔴 새 401 을 만들면 **`step` 을 여기 목록에 넣을지 정해라** — 안 넣으면 화면이 그 문장을 «보여 주는» 쪽이 된다(덜 나쁜 쪽).
       자: `scripts/verify-401-meaning.mjs` (401 을 내는 자리의 `step` 이 전부 분류돼 있나) */
    const SESSION_401 = ["auth", "user", "operator", "expired"];
    const sessionGone = data.step === undefined || SESSION_401.indexOf(data.step) >= 0;
    if (res.status === 401 && !opts.noRedirect && sessionGone) {
      // 슬라이딩/리프레시 1회 시도 후 실패면 로그인으로
      if (!opts._retried && !path.includes("auth-refresh") && !path.startsWith("/api/ops")) {
        const r = await fetch("/api/auth-refresh", { method: "POST", credentials: "same-origin" }).catch(() => null);
        if (r && r.ok) return UI.api(path, { ...opts, _retried: true });
      }
      const login = path.startsWith("/api/ops") ? "/ops/login.html" : "/login.html";
      if (location.pathname !== login) location.href = login + "?next=" + encodeURIComponent(location.pathname + location.search);
    }
    const out = { ...data, status: res.status, ok: !!data.ok && res.ok };
    if (!opts.noGate && UI.gate(out)) out.gated = true; // [P1R4] 쓰기 막힘·플랜 한도·상한은 화면마다 말고 여기서 한 번(계약 §1.3·§1.4·§1.5) · 화면은 gated 면 제 토스트를 겹치지 않는다
    return out;
  };

  /* ── [P1R4] 막힘 시트 — 403 writable(readonly|suspended) · 402 plan_limit. 업셀 한 문장 + Primary 1 ──
     🔴 402 는 «요금제» 전용 신호가 아니다 — `step` 으로만 가른다(`channel_not_connectable` 처럼 **돈과 무관한 402** 가 있다 · B3 accounts-add). «402 = 업셀»로 일반화하지 마라. */
  let gateOpen = false;
  UI.gate = function (r) {
    if (!r || r.ok || gateOpen) return false;
    const done = (html, title, cta, href) => { gateOpen = true; UI.sheet(`<p class="muted" style="margin:0 0 16px">${html}</p><div class="cta"><a class="btn primary" href="${href}">${cta}</a></div>`, { title, onOpen: (sh) => { const bg = sh.previousSibling; if (bg) bg.addEventListener("click", () => { gateOpen = false; }); } }); return true; };
    if (r.status === 403 && r.step === "writable") {
      if (r.reason === "suspended") return done("결제가 밀려 있어요. 카드를 확인하면 바로 이어서 돼요. 만든 글과 편성표는 그대로예요.", "잠시 멈춰 있어요", "카드 확인하기", "/app/plan.html");
      /* 🔴 [R7 §3.1 · B ba99538] **탈퇴를 신청한 집도 서버 상태는 같은 readonly** 라 여기로 온다 — 그 집에 «체험이 끝났어요 · 요금제 고르기»는
         거짓말이고, 정작 필요한 «되돌리기»를 못 찾게 만든다. 서버가 사유·날짜를 403 에 실어 주면 **그 응답만으로** 그린다(왕복 0). */
      if (r.reason === "closed") {
        const T = "탈퇴를 신청하셨어요";
        let say = String(r.error || "");
        if (say.startsWith(T)) say = say.slice(T.length).replace(/^[.·\s]+/, "");   // 제목과 같은 말을 두 번 하지 않는다(문장은 서버 것 그대로)
        if (!say) say = r.daysLeft != null ? `${r.daysLeft}일 뒤에 자료가 지워져요. 그때까지는 보기만 할 수 있어요.` : "지금은 보기만 할 수 있어요.";
        return done(UI.esc(say), T, "되돌리러 가기", "/app/settings.html");
      }
      /* 받침대(막힌 자리에서 GET 으로 한 번 더 묻던 것)는 2026-09-15 b229c09 로 걷었다 — 서버가 사유를 실어 준다. */
      return done("체험이 끝났어요. 요금제를 고르면 바로 이어서 돼요. 보는 건 지금도 다 돼요.", "이어서 하려면", "요금제 고르기", "/app/plan.html");
    }
    if (r.step === "banned_category") { UI.toast(r.error || "이 주제는 만들 수 없어요"); return true; }           // 서버 문구 그대로(카테고리 이름이 들어 있다)
    if (r.step === "ai_cost_cap") return done(UI.esc(r.error || "오늘 AI 사용이 하루 상한에 닿았어요. 내일 다시 이어서 만들 수 있어요."), "오늘은 여기까지예요", "홈으로", "/app/home.html");
    if (r.status === 402 && r.step === "plan_feature") return done(UI.esc(r.error || "지금 요금제에 없는 기능이에요."), "요금제에 없는 기능이에요", "요금제 보기", "/app/plan.html");
    if (r.status === 402 && r.slotOffer) return false;   // [R7 §3.6] 계정 한도 + 상품 = 화면이 «계정 1개 더 사기»로 받는다(업셀 시트로 덮지 않는다)
    if (r.status === 402 && (r.step === "plan_limit" || r.reason === "plan_limit")) {
      const NAME = { accounts: "계정", runnerDevices: "내 PC 프로그램", teamSeats: "팀원", rules: "편성 규칙", horizonDays: "편성 기간" };
      const unit = { accounts: "개", runnerDevices: "대", teamSeats: "명", rules: "개", horizonDays: "일" }[r.resource] || "개";
      const what = NAME[r.resource] || "이 항목";
      gateOpen = true;
      UI.sheet(`<p class="muted" id="gmsg" style="margin:0 0 16px">${UI.esc(what)}은 ${r.limit}${unit}까지예요.</p><div class="cta"><a class="btn primary" href="/app/plan.html">요금제 보기</a></div>`, { title: "여기까지예요", onOpen: async (sh) => {
        const bg = sh.previousSibling; if (bg) bg.addEventListener("click", () => { gateOpen = false; });
        const p = await UI.api("/api/plans", { noGate: true }).catch(() => null); // 업셀 숫자는 플랜 표에서(화면에 박지 않는다)
        const key = { accounts: "maxAccounts", horizonDays: "horizonDays", rules: "maxRules", runnerDevices: "runnerDevices", teamSeats: "teamSeats" }[r.resource];
        const next = p && p.ok && key ? (p.plans || []).filter((x) => (x.limits || {})[key] > r.limit).sort((a, b) => a.limits[key] - b.limits[key])[0] : null;
        if (next) sh.querySelector("#gmsg").textContent = `${what}은 ${r.limit}${unit}까지예요 · ${next.name} 로 바꾸면 ${next.limits[key]}${unit}`;
      } });
      return true;
    }
    return false;
  };

  /* 결제사 인증창으로 — 서버가 준 url·form 그대로(form 이 비면 이동만). mock.js 가 감싸 콜백까지 흉내 낸다 */
  UI.postForm = function (url, form) {
    const keys = Object.keys(form || {}); if (!keys.length) { location.assign(url); return; }
    const f = document.createElement("form"); f.method = "POST"; f.action = url; f.style.display = "none";
    for (const k of keys) { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = String(form[k] ?? ""); f.appendChild(i); }
    document.body.appendChild(f); f.submit();
  };

  /* [KICC 실측] 결제사 복귀 실패 — ?reason= 을 사람말로. 고객이 «왜»를 알아야 같은 카드로 또 누르지 않는다.
     reason: params(값 비어 옴) · approve(카드사 거절) · pg(응답 늦음) · cancelled(창에서 취소) · 그 밖 = 카드사 거절 코드(8373 등 · 보여도 된다 — 카드사에 말할 근거) */
  UI.PAYFAIL = {
    params: ["결제사에서 돌아온 정보가 비어 있어요", "다시 시도해 주세요. 같은 일이 또 생기면 문의해 주세요."],
    approve: ["카드사가 등록을 거절했어요", "다른 카드로 하거나, 카드사(명세서 뒷면 번호)에 «온라인 자동결제 허용»이 되어 있는지 확인해 주세요."],
    pg: ["결제사 응답이 늦어요", "잠시 뒤 다시 해 주세요."],
    cancelled: ["결제창에서 취소했어요", "다시 하려면 아래를 눌러 주세요."],
  };
  UI.payFailSheet = function ({ reason, msg, what = "card", onRetry }) {
    const r = String(reason || "").trim(); const known = UI.PAYFAIL[r];
    const head = known ? known[0] : r ? `거절 코드 ${UI.esc(r)}` : what === "coin" ? "결제가 안 됐어요" : "카드 등록이 안 됐어요";
    const body = known ? known[1] : r ? "카드사에 이 코드로 확인해 주세요. 다른 카드로 하면 바로 돼요." : "다시 시도해 주세요.";
    const sub = msg && msg !== head ? `<p class="muted" style="margin:0 0 4px;font-size:12.5px">${UI.esc(msg)}${r && known && r !== "cancelled" ? "" : ""}</p>` : "";
    UI.sheet(`<p style="margin:0 0 6px;font-size:16px;font-weight:700">${head}</p><p class="muted" style="margin:0 0 12px">${body}</p>${sub}<div class="cta"><button class="btn primary" type="button" id="pfRetry">${what === "coin" ? "다른 카드로 다시 하기" : "다른 카드로 등록"}</button></div>`,
      { title: what === "coin" ? "결제가 안 됐어요" : "카드 등록이 안 됐어요", onOpen: (sh, close) => { sh.querySelector("#pfRetry").onclick = () => { close(); if (onRetry) onRetry(); }; } });
    try { const url = new URL(location.href); ["key", "reason", "failed", "charged", "trial"].forEach((k) => url.searchParams.delete(k)); history.replaceState(null, "", url.pathname + (url.search || "") + url.hash); } catch { /* empty */ } // 새로고침해도 다시 안 뜨게(모의 손잡이는 남긴다)
  };

  /* [R7 §1.3] 계정 없이 만든 영상의 출구 — ①내려받기 ②앱에서 직접 올림 ③올린 주소 적기.
     🔴 내려받기 주소는 10분짜리 서명이고 교차 출처라 `<a download>` 가 무시된다 — 파일 이름은 서버가 서명 안에 넣어 준다(화면은 이름을 고르지 않는다). */
  UI.videoDownload = async function (pieceId, note, opts = {}) {
    const r = await UI.api("/api/piece-video?id=" + encodeURIComponent(pieceId));
    if (!r.ok) {
      if (r.gated) return false;
      if (r.step === "no_render") { UI.toast(r.error || "아직 영상 파일이 없어요"); return false; }
      UI.toast(r.error || "영상을 가져오지 못했어요"); return false;
    }
    if (note) note.textContent = [r.filename ? `${r.filename} 를 받아요` : "", r.bytes ? UI.mb(r.bytes) : "", "받는 주소는 10분 동안만 살아 있어요"].filter(Boolean).join(" · ");
    /* [R8 §3.2] 🔴 **우리가 못 올리는 채널**(클립)이면 파일만 던지지 않는다 — 서버가 준 «넘겨주는 길»을 화면이 연다.
       종전엔 파일 주소만 줘서, 고객은 «앱에서 올려 주세요»를 듣고도 폰으로 어떻게 가져가는지를 몰랐다. */
    if (r.handoff && opts.onHandoff) { opts.onHandoff(r); return true; }
    location.href = r.url;   // 같은 창에서 받아진다(파일 이름·Content-Disposition 은 서명 안에 있다)
    return true;
  };
  /* 올린 주소 적기 — 400 step:"url" 이 흔하다(고객이 다른 채널 주소를 붙인다). 서버 문장이 이미 사람말이라 그대로 칸 밑에 붙이고,
     reason 이 있으면 그 채널의 «이렇게 생긴 주소»를 한 줄 더 보여 준다. */
  UI.URL_HINT = {
    youtube_shorts: "youtube.com/shorts/… 또는 youtu.be/… 로 붙여 주세요",
    reels: "instagram.com/reel/… 로 붙여 주세요",
    instagram: "instagram.com/p/… 또는 /reel/… 로 붙여 주세요",
    naver_clip: "blog.naver.com/… 또는 clip.naver.com/… 로 붙여 주세요",
    naver_blog: "blog.naver.com/아이디/글번호 로 붙여 주세요",
    tistory: "…tistory.com/글번호 또는 직접 쓰시는 주소로 붙여 주세요",
    tiktok: "tiktok.com/@아이디/video/… 로 붙여 주세요",
    threads: "threads.net/@아이디/post/… 로 붙여 주세요",
    blogger: "…blogspot.com/… 또는 직접 쓰시는 주소로 붙여 주세요",
    wordpress: "…wordpress.com/… 또는 직접 쓰시는 주소로 붙여 주세요",
  };
  UI.markPublishedSheet = function (piece, onDone) {
    const ch = piece.channel, label = UI.chLabel(ch);
    UI.sheet(`<p class="muted" style="margin:0 0 10px">${UI.esc(label)} 앱에서 올린 뒤, 그 글 주소를 붙여 주세요. 발행함에 쌓이고 편성표도 «발행됨»으로 바뀌어요.</p>
      <form id="mpf"><div class="field"><label for="mpu">올린 주소</label><input class="input" id="mpu" name="url" inputmode="url" placeholder="https://" autocomplete="off"><div class="help"></div></div>
      <p class="muted" style="margin:0 0 8px;font-size:12.5px">${UI.esc(UI.URL_HINT[ch] || "올린 글의 주소를 그대로 붙여 주세요")}</p>
      <div class="cta" style="position:static;padding:4px 0 8px"><button class="btn primary" type="submit">다 올렸어요</button></div></form>`,
      { title: "올린 주소 적기", onOpen: (sh, close) => UI.form(sh.querySelector("#mpf"), async (d, f) => {
        const url = String(d.url || "").trim();
        if (!url) return UI.fieldError(f, "url", "주소를 붙여 주세요.");
        const r = await UI.api("/api/post-mark-published", { body: { pieceId: piece.id, url } });
        if (!r.ok) {
          if (r.gated) return close();
          if (r.step === "url") return UI.fieldError(f, "url", `${r.error || "주소를 확인해 주세요."} ${UI.URL_HINT[ch] || ""}`.trim());
          return UI.fieldError(f, "url", r.error || "적지 못했어요");
        }
        close();
        UI.sheet(`<p style="margin:0 0 6px;font-size:16px;font-weight:700">${r.already ? "이미 적어 둔 글이에요" : "올린 글로 적었어요"}</p>
          <p class="muted" style="margin:0 0 6px">${UI.esc(r.message || "발행함에서 볼 수 있어요.")}</p>
          <p class="muted" style="margin:0 0 12px;font-size:12.5px">이제 이 글의 수익도 함께 세어요.</p>
          <div class="cta" style="position:static;padding:0"><a class="btn primary" href="${UI.esc(r.url)}" target="_blank" rel="noopener">올린 글 열기</a></div>`, { title: "" });
        if (onDone) onDone(r);
      }) });
  };

  /* [R7 §4.4] 알림 — 서비스워커는 «알림»만 맡는다(오프라인 캐시 안 한다 · public/sw.js).
     🔴 기기 알림은 «권한»과 «구독» 두 단계다: 권한만 받고 서버에 구독을 못 보내면 알림은 **안 온다** — 화면이 «켰어요»라고 말하면 거짓말이 된다.
     그래서 서버 키(/api/push-key)가 없으면 그 상태를 그대로 말한다(준비 중). */
  UI.swReady = function () {
    if (!("serviceWorker" in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.register("/sw.js").catch(() => null);
  };
  UI.pushState = function () {
    const iosStandalone = window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return { can: false, ios, iosStandalone, perm: "unsupported" };
    return { can: true, ios, iosStandalone, perm: Notification.permission };
  };
  const b64 = (s) => { const pad = "=".repeat((4 - (s.length % 4)) % 4); const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); };
  /** 켜기: 권한 → 서버 공개키 → 구독 → 서버 저장. 어느 칸에서 막혀도 «어디서 막혔는지»를 돌려준다(조용한 실패 금지). */
  UI.pushEnable = async function () {
    const st = UI.pushState();
    if (!st.can) return { ok: false, step: "unsupported" };
    let perm = st.perm;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, step: perm === "denied" ? "denied" : "dismissed" };
    const reg = await UI.swReady(); if (!reg) return { ok: false, step: "sw" };
    const ready = await navigator.serviceWorker.ready;
    const key = await UI.api("/api/push-key", { noRedirect: true, noGate: true });
    if (!key.ok || !key.publicKey) return { ok: false, step: "no_server", perm };
    try {
      const sub = await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key.publicKey) });
      const r = await UI.api("/api/push-subscribe", { body: sub.toJSON(), noGate: true });
      if (!r.ok) return { ok: false, step: "save", error: r.error };
      return { ok: true };
    } catch (e) { return { ok: false, step: "subscribe", error: String((e && e.message) || e) }; }
  };
  UI.pushDisable = async function () {
    try { const ready = await navigator.serviceWorker.ready; const sub = await ready.pushManager.getSubscription();
      if (sub) { await UI.api("/api/push-unsubscribe", { body: { endpoint: sub.endpoint }, noGate: true }).catch(() => null); await sub.unsubscribe(); } } catch { /* 이미 없으면 그만 */ }
    return { ok: true };
  };
  UI.pushSubscribed = async function () {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    try { const ready = await navigator.serviceWorker.ready; return !!(await ready.pushManager.getSubscription()); } catch { return false; }
  };
  UI.APP_VERSION = "2026.09.19";   // 🔴 이 값은 빌드(scripts/build-pages.mjs)가 오늘(KST)로 덮어쓴다 — 손으로 고치지 않는다(여기 적힌 건 빌드 전 폴백)


  /* [R7 §3.6] 계정 슬롯 — «계정 1개 + 전용 IP» 30일권. 🔴 화면은 값을 갖지 않는다(coins·krw·days·label·desc 전부 서버 offers).
     🔴 사기 전에 말해야 하는 것 3가지: ①30일마다 코인이 빠진다(자동 갱신 · 끄는 법) ②남은 기간 환불 없음(서버 note 그대로) ③지금은 안 빠진다(IP 준비되면 그때부터 30일). */
  UI.SLOT_STATE = {
    waiting_ip: ["off", "IP 준비 중", "준비되면 시작되고 그때부터 30일이에요 · 아직 코인은 안 빠졌어요"],
    active: ["ok", "쓰는 중", ""],
    paused: ["warn", "쉬는 중", "코인이 모자라 이 계정만 쉬고 있어요 · 다른 계정은 그대로 나가요"],
  };
  UI.slotBuySheet = function ({ offers, note, balance, onDone, title = "계정 1개 더 쓰기" }) {
    const list = (offers || []).filter((o) => o && o.kind);
    if (!list.length) return UI.toast("지금은 살 수 있는 상품이 없어요");
    let kind = list[0].kind, count = 1;
    const of = (k) => list.find((o) => o.kind === k) || list[0];
    const card = (o) => `<button type="button" class="row tap" data-kind="${o.kind}"><div class="l"><span class="t">${UI.esc(o.label)}</span><span class="d wrap">${UI.esc(o.desc || "")}</span></div><span class="r">${UI.num(o.coins)}코인<small class="muted" style="display:block;font-weight:500">${UI.won(o.krw)}</small></span></button>`;
    UI.sheet(`<div id="slotPick">${list.map(card).join("")}</div>
      <div class="kv" style="padding-left:0;padding-right:0"><span class="k">몇 개</span><span class="v">${UI.stepper("cnt", 1, 1, 5, "개")}</span></div>
      <div class="kv" style="padding-left:0;padding-right:0"><span class="k">지금 잔액</span><span class="v">${UI.num(balance || 0)}코인</span></div>
      <div class="group" style="background:var(--ground);margin:8px 0 0"><div class="gt">사기 전에 알아 두세요</div>
        <p class="muted" id="slotWhen" style="margin:0 16px 6px;font-size:13px"></p>
        <p class="muted" style="margin:0 16px 6px;font-size:13px">쓰는 동안 <b style="color:var(--ink)">${of(kind).days}일마다 코인이 빠져요</b> · 잔액이 모자라면 그 계정만 쉬어요(다른 계정은 그대로).</p>
        <p class="muted" style="margin:0 16px 10px;font-size:13px">${UI.esc(note || "남은 기간 환불은 없어요. 다음 갱신만 끌 수 있어요.")}</p>
      </div>
      <div class="cta"><button class="btn primary" type="button" id="slotGo"></button></div>`, { title, onOpen: (sh, close) => {
        const say = () => { const o = of(kind);
          sh.querySelectorAll("[data-kind]").forEach((b) => b.classList.toggle("on", b.dataset.kind === kind));
          sh.querySelector("#slotWhen").innerHTML = `지금은 <b style="color:var(--ink)">안 빠져요</b> — 계정을 붙이고 전용 IP 가 준비되면 그때 첫 ${o.days}일치(${UI.num(o.coins)}코인)가 빠지고, 거기서 ${o.days}일이 시작돼요.`;
          sh.querySelector("#slotGo").textContent = `${UI.num(o.coins * count)}코인으로 사기`; };
        sh.querySelectorAll("[data-kind]").forEach((b) => b.onclick = () => { kind = b.dataset.kind; say(); });
        UI.bindSteppers(sh, (_n, v) => { count = v; say(); });
        say();
        sh.querySelector("#slotGo").onclick = async (e) => { const btn = e.currentTarget; btn.disabled = true;   /* 🔴 currentTarget 은 await 뒤엔 null 이다 — 먼저 잡아 둔다 */
          const r = await UI.api("/api/account-slot-buy", { body: { kind, count } }); btn.disabled = false;
          if (!r.ok) {
            if (r.gated) return close();
            if (r.step === "coins") { close(); return UI.sheet(`<p class="muted" style="margin:0 0 16px">${UI.num(r.need || 0)}코인이 필요한데 지금 ${UI.num(r.balance || 0)}코인 있어요.</p><div class="cta"><a class="btn primary" href="/app/coins.html">충전하기</a></div>`, { title: "코인이 모자라요" }); }
            return UI.toast(r.error || "사지 못했어요");
          }
          close();
          UI.done(r.waitingIp ? "샀어요 · 계정을 붙이면 시작돼요" : "샀어요", () => { if (onDone) onDone(r); });
        };
      } });
  };

  /* ── 포맷 ── */
  UI.mb = (b) => (b > 0 ? `${(b / 1048576).toFixed(1)}MB` : "");
  UI.won = (n) => (Number(n) || 0).toLocaleString("ko-KR") + "원";
  UI.num = (n) => (Number(n) || 0).toLocaleString("ko-KR");
  UI.utc = (v) => { if (!v) return null; const s = String(v); return /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d/.test(s) && !/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? new Date(s.replace(" ", "T") + "Z") : new Date(s); };
  UI.timeKST = (iso) => { if (!iso) return ""; const d = UI.utc(iso); return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }); };
  UI.dateKST = (iso, o = {}) => { if (!iso) return ""; return UI.utc(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric", timeZone: "Asia/Seoul", ...o }); };
  /* 큰 수는 만·억으로 줄여 쓴다 — «2,140,000 / 10,000,000» 은 한 줄에 안 들어간다 */
  UI.numShort = (n) => { n = Number(n) || 0; if (n >= 1e8) return (n / 1e8).toFixed(n % 1e8 ? 1 : 0).replace(/\.0$/, "") + "억"; if (n >= 1e4) return UI.num(Math.round(n / 1e4)) + "만"; return UI.num(n); };
  UI.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /* [R8-A2] 조사 — «유튜브 쇼츠**은**» 처럼 틀린 조사가 나오면 그 문장은 사람말이 아니다(§3 «말은 사람말»).
     채널 이름은 서버가 주는 값이라 **문장에 박아 둘 수 없다** — 받침을 재서 고른다.
     🔴 한글이 아닌 끝(영문·숫자)은 **받침을 못 잰다** — 그때는 받침 없는 쪽으로 둔다(짐작을 «판정»으로 부르지 않는다 · AC-9). */
  UI.josa = (word, pair = "은는") => {
    const P = { "은는": ["은", "는"], "이가": ["이", "가"], "을를": ["을", "를"], "과와": ["과", "와"], "으로로": ["으로", "로"] }[pair] || ["", ""];
    const s = String(word ?? ""); const c = s.charCodeAt(s.length - 1);
    if (!(c >= 0xac00 && c <= 0xd7a3)) return P[1];
    const jong = (c - 0xac00) % 28;
    return jong === 0 ? P[1] : (pair === "으로로" && jong === 8 ? P[1] : P[0]);   // ㄹ 받침은 «로»
  };

  /* ── 채널 ── */
  UI.CH = {
    naver_blog: { label: "네이버 블로그", mark: "N" }, tistory: { label: "티스토리", mark: "T" }, blogger: { label: "블로거", mark: "B" }, wordpress: { label: "워드프레스", mark: "W" },
    threads: { label: "쓰레드", mark: "@" }, instagram: { label: "인스타그램", mark: "◎" }, youtube_shorts: { label: "유튜브 쇼츠", mark: "▶" }, naver_clip: { label: "네이버 클립", mark: "C" },
    reels: { label: "릴스", mark: "◎" }, tiktok: { label: "틱톡", mark: "♪" },
    /* [R12-6 · B r11-back] 당근 — 이름표는 서버 시드와 **같은 글자**(«당근» · DDL 0082 · seed-plans.mjs · verify-channel-tables 가 대조).
       🔴 마크는 새로 그리지 않는다(아이콘 금지) — 글자 마크 + `.mk.daangn` 배경 한 줄(ac.css). 배경이 없으면 흰 글자가 **안 보인다**. */
    daangn: { label: "당근", mark: "당" },
    /* [P1R8 §3.4 · B2] 다음 Phase 채널 — 이름이 없으면 화면에 «facebook_reels» 같은 **열쇠 글자**가 그대로 뜬다. */
    facebook: { label: "페이스북", mark: "f" }, facebook_reels: { label: "페북 릴스", mark: "f" },
    x: { label: "엑스", mark: "X" }, youtube_long: { label: "유튜브 영상", mark: "▶" },
    brunch: { label: "브런치", mark: "br" }, naver_clip_post: { label: "클립 게시물", mark: "C" },
  };
  UI.mark = (ch, cls = "") => { const c = UI.CH[ch] || { mark: "?" }; return `<span class="mk ${ch} ${cls}" aria-hidden="true">${c.mark}</span>`; };
  /* [R8 §5.3 · B3] 계정 사진 — 있으면 사진, **없으면 채널 마크 그대로**.
     🔴 기본 그림으로 채우지 않는다: 그러면 «사진이 있다»와 «아직 없다»가 같은 얼굴이 된다(서버도 그래서 null 로 둔다 · AC-9).
     🔴 사진이 있어도 **어느 채널인지는 계속 보인다**(작은 배지) — 계정이 여럿이면 그게 먼저 필요한 정보다.
     🔴 주소가 죽었으면 채널 마크로 되돌린다 — 깨진 그림이 뜨는 것보다 낫다. */
  UI.accMark = (a, cls = "") => {
    const ch = String(a?.channel || ""); const c = UI.CH[ch] || { mark: "?" };
    /* 🔴 https 또는 **우리 서버의 같은 출처 경로**만 그린다 — http 는 브라우저가 막아 «넣었는데 안 보인다»가 되고(서버도 https 만 받는다),
       바깥 스킴(data:·javascript: …)은 아예 그리지 않는다. */
    const url = String(a?.avatar || "");
    if (!/^https:\/\//i.test(url) && !/^\/[^/]/.test(url)) return UI.mark(ch, cls);
    return `<span class="mk ph ${cls}" aria-hidden="true"><img src="${UI.esc(url)}" alt="" loading="lazy" onerror="this.closest('.mk').className='mk ${ch} ${cls}';this.closest('.mk').textContent='${UI.esc(c.mark)}'"><i class="mk ${ch}">${c.mark}</i></span>`;
  };
  UI.chLabel = (ch) => (UI.CH[ch] || {}).label || ch;

  /* ── [R12-6] 🔴 광고가 안 붙는 채널(당근) — **막지 않는다 · 말해 준다**(§9) ──────────────
     서버가 이미 두 곳에서 실어 준다. 화면은 **읽어서 그리기만** 한다(새 API 0):
       · 수익 `/api/revenue-summary` — 계정 줄마다 `noRevenueChannel:true` · 응답 맨 위 `noRevenueChannels[]`
       · 계정 `/api/accounts-list`   — 채널 목록의 `monetizable:false`
     🔴 «당근»을 화면이 손으로 적지 않는다 — 채널이 늘면 두 곳이 갈린다(AC-52). 키를 받아 `UI.chLabel` 로 이름을 낸다.
     🔴 겁주지 않는다(§3): «수익이 발생하지 않습니다»(던지고 끝)도 «다른 채널을 쓰세요»(떠넘기기)도 아니다.
        ①사실(0원이 맞다 · 고장이 아니다) ②그래서 어떻게 쓰면 되는지 — **두 줄이 붙어야** 한 문장이 된다.
     🔴 회색 작은 글씨로 흘리지 않는다(§9-①) — `.banner info` 한 칸이다(«이날 겹쳐요»와 같은 급).
     🔴 `.banner info` 바탕은 `--brand-soft` = 라이트에선 `--ground` 와 같은 색이다 ⇒ **흰 바닥(.group·시트) 안에만 둔다.**
        페이지 바닥에 그대로 놓으면 글자만 뜨고 칸이 안 보인다.
     🔴 **막는 데 쓰지 않는다** — 이 값으로 채널을 가리거나 단추를 잠그면 §9 위반이다. 말해 주는 것까지다. */
  UI.NO_REVENUE_USE = "여기선 손님을 데려오는 용으로 써요 — 번 돈은 광고가 붙는 채널 쪽에 쌓여요.";
  UI.noRevenueSay = (chs) => {
    const names = [...new Set((chs || []).filter(Boolean).map((c) => UI.chLabel(c)))];
    if (!names.length) return "";
    /* 조사는 **마지막 이름**으로 고른다(«당근 · 브런치는») — 채널 이름은 서버 값이라 문장에 박아 둘 수 없다(UI.josa). */
    return `${names.join(" · ")}${UI.josa(names[names.length - 1], "은는")} 광고 수익이 안 붙는 채널이에요. 0원이 맞아요 — 고장이 아니에요.`;
  };
  UI.noRevenueBanner = (chs, style = "") => {
    const say = UI.noRevenueSay(chs);
    return say ? `<div class="banner info"${style ? ` style="${style}"` : ""}><span><b>${UI.esc(say)}</b><br>${UI.esc(UI.NO_REVENUE_USE)}</span></div>` : "";
  };

  /* ── 숫자 카운트업(600ms · reduced-motion 이면 즉시) ── */
  UI.countUp = function (el, to, fmt = UI.won) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !to) { el.textContent = fmt(to); return; }
    const t0 = performance.now(); const dur = 600;
    const step = (t) => { const p = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(Math.round(to * e)); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };

  /* ── 토스트 ── */
  let toastEl, toastTimer;
  UI.toast = function (msg, ms = 2200) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; toastEl.setAttribute("role", "status"); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; requestAnimationFrame(() => toastEl.classList.add("show"));
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
  };

  /* ── 바텀시트 ── */
  UI.sheet = function (html, { title = "", onOpen } = {}) {
    const bg = document.createElement("div"); bg.className = "sheet-bg";
    const sh = document.createElement("div"); sh.className = "sheet"; sh.setAttribute("role", "dialog"); sh.setAttribute("aria-modal", "true");
    sh.innerHTML = `<div class="handle"></div>${title ? `<h3>${UI.esc(title)}</h3>` : ""}<div class="sheet-body">${html}</div>`;
    document.body.append(bg, sh);
    const close = () => { sh.classList.remove("open"); bg.classList.remove("open"); setTimeout(() => { sh.remove(); bg.remove(); }, 280); };
    bg.addEventListener("click", close);
    let y0 = null; sh.addEventListener("touchstart", (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    sh.addEventListener("touchend", (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 80 && sh.scrollTop === 0) close(); y0 = null; });
    requestAnimationFrame(() => { sh.classList.add("open"); bg.classList.add("open"); });
    if (onOpen) onOpen(sh, close);
    return { el: sh, close };
  };

  /* [R8 §6.1] 당겨서 새로고침 — 🔴 헌장 «모션 한 방향»과 부딪치지 않는다: **손짓과 같은 세로 축**으로만 움직이고
     스스로 도는 스피너를 쓰지 않는다(메인 판정 2026-09-15 · DESIGN §13.0 에 «사용자의 손짓과 같은 축이면 된다» 한 줄).
     🔴 햅틱은 **말로 약속하지 않는다** — 아이폰 사파리엔 `navigator.vibrate` 가 없다(고객 절반에게 없는 감각이라 문구로 약속하면 거짓말).
        되는 기기에서만 문턱을 넘을 때 한 번 톡 치고, 화면 글자로는 한 마디도 안 한다.
     🔴 시트·글 편집기가 열려 있으면 끈다 — 그 안에서 당기면 뒤 화면이 새로고침돼 쓰던 것이 날아간다. */
  UI.pullToRefresh = function (onRefresh) {
    if (!("ontouchstart" in window) || !navigator.maxTouchPoints) return;   // 손가락이 없는 곳엔 만들지 않는다
    const bar = document.createElement("div"); bar.className = "ptr"; bar.hidden = true;
    const say = document.createElement("span"); say.textContent = "당겨서 새로고침"; bar.appendChild(say);
    document.body.appendChild(bar);
    const TH = 70; let y0 = null, armed = false, busy = false;
    const blocked = () => busy || !!$(".sheet.open") || (document.activeElement && (document.activeElement.isContentEditable || /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)));
    const reset = () => { bar.hidden = true; bar.style.transform = ""; say.textContent = "당겨서 새로고침"; armed = false; };
    addEventListener("touchstart", (e) => { y0 = blocked() || window.scrollY > 0 ? null : e.touches[0].clientY; }, { passive: true });
    addEventListener("touchmove", (e) => {
      if (y0 == null) return;
      const dy = e.touches[0].clientY - y0;
      if (dy <= 0) { reset(); return; }
      bar.hidden = false;
      bar.style.transform = `translateY(${Math.min(Math.min(dy, TH + 24) - 44, 0)}px)`;   // 세로 한 축만
      const now = dy >= TH;
      if (now !== armed) { armed = now; say.textContent = armed ? "놓으면 새로고침" : "당겨서 새로고침";
        if (armed && navigator.vibrate) { try { navigator.vibrate(10); } catch { /* 없는 기기 */ } } }
    }, { passive: true });
    addEventListener("touchend", async () => {
      if (y0 == null) return; const go = armed; y0 = null;
      if (!go) return reset();
      busy = true; bar.style.transform = "translateY(0)"; say.textContent = "새로고침 중";
      try { await onRefresh(); } catch { /* 화면이 제 말로 알린다 */ } finally { busy = false; reset(); }
    });
  };

  /* ── 완료 체크(400ms 후 자동 닫힘) ── */
  UI.done = function (msg, then) {
    const d = document.createElement("div"); d.className = "done-full";
    d.innerHTML = `<div class="center"><div class="ck"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg></div><p>${UI.esc(msg)}</p></div>`;
    document.body.appendChild(d); requestAnimationFrame(() => d.classList.add("show"));
    setTimeout(() => { d.classList.remove("show"); setTimeout(() => d.remove(), 200); if (then) then(); }, 900);
  };

  /* ── 토글 ── */
  UI.toggle = function (el, onChange) {
    el.setAttribute("role", "switch");
    el.addEventListener("click", async () => { const next = el.getAttribute("aria-checked") !== "true"; el.setAttribute("aria-checked", String(next)); if (onChange) { const ok = await onChange(next); if (ok === false) el.setAttribute("aria-checked", String(!next)); } });
  };

  /* ── 셸: 탭·레일 ── */
  const NAV = [
    ["home", "홈", "/app/home.html", '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>'],
    ["create", "만들기", "/app/create.html", '<path d="M12 5v14M5 12h14"/>'],
    ["schedule", "편성표", "/app/schedule.html", '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>'],
    ["revenue", "수익", "/app/revenue.html", '<path d="M4 18l5-6 4 3 7-9"/>'],
    ["account", "내 계정", "/app/account.html", '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'],
  ];
  UI.shell = function (active, me) {
    const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    const rail = $(".rail"); const tabs = $(".tabs");
    if (rail) rail.innerHTML = `<a class="brand" href="/app/home.html">AutoCreate</a>` + NAV.map(([k, l, h, p]) => `<a class="nav ${k === active ? "on" : ""}" href="${h}">${svg(p)}${l}</a>`).join("")
      + `<div class="grow"></div><a class="me" href="/app/account.html"><i></i><span>${UI.esc(me?.user?.name || me?.user?.email || "")}</span><span class="coin">${UI.num(me?.coins || 0)}코인</span></a>`;
    if (tabs) tabs.innerHTML = NAV.map(([k, l, h, p]) => `<a class="tab ${k === active ? "on" : ""}" href="${h}" aria-current="${k === active ? "page" : "false"}">${svg(p)}${l}</a>`).join("");
  };

  /* ── 세션 부트: /api/auth-me (401이면 api()가 로그인으로 보냄) ── */
  UI.boot = async function (active) {
    const me = await UI.api("/api/auth-me");
    if (!me.ok) return null;
    UI.me = me; UI.shell(active, me);
    UI.swReady();   // [R7 §4.4] 알림용 서비스워커는 앱에 들어오면 등록해 둔다(권한을 나중에 켜도 바로 받을 수 있게)
    if (me.impersonation) UI.impBanner(me.impersonation);
    // 활동 시 슬라이딩 연장(탭 복귀·5분 주기)
    document.addEventListener("visibilitychange", () => { if (!document.hidden) fetch("/api/auth-refresh", { method: "POST", credentials: "same-origin" }); });
    setInterval(() => fetch("/api/auth-refresh", { method: "POST", credentials: "same-origin" }), 5 * 60 * 1000);
    return me;
  };
  /* [P1R4] 원격접속 중이면 결제 경로를 화면에서 숨긴다(서버 403 은 그대로) */
  UI.hidePayIfImp = function (...els) { if (!UI.me || !UI.me.impersonation) return false; els.forEach((e) => { if (e) e.hidden = true; }); return true; };
  UI.impBanner = function (imp) {
    const b = document.createElement("div"); b.className = "banner"; b.style.margin = "8px 0 0";
    b.innerHTML = `<span>운영자가 보고 있어요 · ${UI.esc(imp.byName || "")}${imp.until ? " · " + UI.timeKST(imp.until) + "까지" : ""}</span><button type="button">끝내기</button>`; // [P1R4] 결제·충전·비밀번호 경로는 서버가 403(denyIfImpersonating) · 화면도 숨긴다(UI.hidePayIfImp)
    b.querySelector("button").onclick = async () => { await fetch("/api/ops-impersonate-end", { method: "POST", credentials: "same-origin" }); location.href = "/ops/tenants.html"; };
    const page = $(".page"); if (page) page.prepend(b);
  };

  /* ── 폼 도우미 ── */
  UI.form = function (formEl, onSubmit) {
    formEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = formEl.querySelector("button[type=submit]"); if (btn) btn.disabled = true;
      const data = Object.fromEntries(new FormData(formEl).entries());
      try { await onSubmit(data, formEl); } finally { if (btn) btn.disabled = false; }
    });
  };
  UI.fieldError = function (formEl, name, msg) {
    const f = formEl.querySelector(`[name="${name}"]`); const help = f && f.closest(".field")?.querySelector(".help");
    if (f) f.classList.toggle("err", !!msg); if (help) help.textContent = msg || "";
  };
  UI.qs = new URLSearchParams(location.search);

  /* ── 상태 어휘(계약 §1·§4·§5 → 사람말 알약) ── */
  UI.ACC_STATUS = { active: ["ok", "정상"], pending_login: ["warn", "확인 중"], suspended: ["danger", "정지"], disconnected: ["danger", "끊김"], cooldown: ["off", "쉬는 중"], limited: ["warn", "제한"] };
  UI.PIECE_STATUS = { generating: ["off", "만드는 중"], draft: ["off", "만드는 중"], in_review: ["warn", "봐주세요"], edited: ["warn", "고쳤어요"], /* [R9-9 · B] 사람이 검수에서 고친 글 — «봐주세요»의 한 갈래 */ approved: ["off", "예약"], scheduled: ["off", "예약"], publishing: ["off", "발행 중"], published: ["ok", "발행됨"], awaiting_manual: ["danger", "확인 필요"], awaiting_runner: ["warn", "PC 대기"], failed: ["danger", "실패"], rejected: ["off", "버림"] };   // [AC-52] awaiting_runner = 영상 렌더가 내 PC 프로그램을 기다린다(편성표 낱말과 같게)
  /* [P1R2] 슬롯 상태기계 전 상태(DESIGN §5B.6 · 계약 §-1) — 어휘 한 벌 */
  UI.SLOT_STATUS = { planned: ["off", "예정"], assigned: ["off", "소재 정함"], topic_assigned: ["off", "소재 정함"], no_topic: ["off", "소재 없음"], producing: ["off", "만드는 중"], in_review: ["warn", "봐주세요"], approved: ["off", "예약"], scheduled: ["off", "예약"], coin_short: ["warn", "코인 부족"], awaiting_runner: ["warn", "PC 대기"], publishing: ["off", "발행 중"], published: ["ok", "발행됨"], awaiting_manual: ["danger", "확인 필요"], reassigned: ["off", "계정 옮김"], skipped: ["off", "건너뜀"], rejected: ["off", "버림"], failed: ["danger", "실패"] };
  /* [P1R2] 발행함 행 상태(계약 v2.1 PostRow.status) */
  UI.POST_STATUS = { published: ["ok", "발행됨"], awaiting_manual: ["warn", "직접 올려야 해요"], failed: ["danger", "올리지 못했어요"], uploaded_private: ["warn", "비공개 업로드됨"], publishing: ["off", "올리는 중"] }; // [P1R5] uploaded_private(§7-1) · 릴스 처리 중은 publishing + errorKind video_processing
  /* [R8-A2 · DESIGN §5E.2] 내 글에 들어온 신고(`takedown_notices.status`) — 서버엔 값만 있고 **한국말은 여기가 정본**이다(주제군·수익 목적과 같은 자리).
     🔴 «곧 정지됩니다» 같은 말을 쓰지 않는다 — 자동 정지는 없고(운영자가 누른다 · lib/takedown.ts), 겁주는 말은 §3 위반이다. */
  UI.TAKEDOWN_STATUS = { open: ["warn", "확인 필요"], customer_removed: ["off", "내렸다고 알림"], retracted: ["ok", "내렸어요"], disconnected: ["danger", "계정 끊김"], suspended: ["danger", "서비스 멈춤"], dismissed: ["ok", "문제없음"], resolved: ["ok", "끝났어요"] };
  /** 아직 «살아 있는» 신고 — lib/takedown.ts `ACTIVE_STATUSES` 에서 그대로 복사(배너·개수를 이 잣대로 센다). */
  UI.TAKEDOWN_ACTIVE = ["open", "disconnected", "suspended"];
  /* [P1R5] 영상 어휘 — 계약 v5.1 §0.2 글자 그대로(VideoFormat · VideoSeconds · VideoStage · JudgeGrade · VideoChannel) · 사람말은 여기 한 곳 */
  UI.VIDEO_CH = ["youtube_shorts", "naver_clip", "reels", "threads"];
  UI.VFORMAT = { graphic: "그래픽 스토리", talking: "말하는 사람", clip: "클립" };
  /* 길이 사다리 — 화면은 **고를 수 있는 칸**만 갖고, «어디까지 되나»는 서버가 말한다(`formats[].maxSeconds` · director.html secChips 가 `s <= m` 으로 거른다).
     🔴 [R12 · B r11-back] **90 을 더했다** — 릴스가 90 을 내기 시작했는데 이 사다리에 칸이 없어서 **서버가 90 이라 해도 칩이 안 떴다**.
     상한을 화면이 정하지 않는 것과, 상한까지 **오를 칸을 갖고 있는 것**은 다른 이야기다(칸이 없으면 서버 말이 화면에 못 닿는다). */
  UI.VSECONDS = [15, 30, 60, 90];
  UI.VSTAGE = [["script", "대본"], ["tts", "목소리"], ["clips", "장면"], ["render", "합성"], ["judging", "검사"], ["done", "완료"]];
  UI.VSTAGE_SAY = { script: "대본 쓰는 중", tts: "목소리 입히는 중", clips: "장면 만드는 중", render: "내 PC 프로그램이 굽는 중", judging: "검사하는 중", done: "다 됐어요", failed: "만들지 못했어요" };
  UI.JUDGE = { P0: ["danger", "심사 막힘"], P1: ["warn", "한 번 고쳐 통과"], P2: ["ok", "심사 통과"] };
  /* 변주 사람말 — 🔴 정본은 서버가 주는 video.variantLabels{palette,hook,voiceId}. 아래는 서버가 못 줄 때의 폴백(B-1 types.ts 값과 같은 말). */
  UI.HOOK = { event_pushin: "사건으로 시작", number_typo: "숫자로 시작", extreme_closeup: "확대로 시작", question: "질문으로 시작", contrast: "반전으로 시작" };
  UI.PALETTE = { terracotta: "테라코타", teal: "청록", navy: "네이비", sage: "세이지", charcoal: "차콜" };
  /* v = PieceSpec.video · key = "palette"|"hook"|"voiceId" — 서버 말이 있으면 그걸 쓰고, 없으면 폴백 표, 그것도 없으면 키 그대로(숨기지 않는다) */
  UI.vword = (v, key) => { const L = v && v.variantLabels; if (L && L[key]) return L[key];
    const raw = key === "hook" ? v?.variant?.hookType : key === "palette" ? v?.variant?.palette : v?.variant?.voiceId;
    return (key === "hook" ? UI.HOOK[raw] : key === "palette" ? UI.PALETTE[raw] : null) || raw || ""; };
  /* [R8 · 사장님 승인 2026-09-15 · lib/coin-table.ts COIN_TABLE 에서 그대로 복사] 🔴 손으로 고치지 마라 — 하니스가 서버 표와 대조한다.
     🔴 **글 1편 = 1코인**(AI 사진 1장 포함) · AI 사진 추가 1장 = +1 · **내 사진·스톡 사진은 0** · 카드뉴스 3(장수로 안 셈).
     🔴 이 표는 **미리보기용**이다 — 실제로 빠지는 값은 언제나 서버가 준 것(`coinCost`·`director-estimate` 응답)이다.
        운영센터가 단가를 바꿀 수 있게 됐으니(B ea980a3), 서버 값이 오는 자리에서는 **이 표를 쓰지 않는다**. */
  UI.COIN = { blog: 1, image: 1, cardnews: 3, video_15: 6, video_30: 12, video_60: 28 };
  UI.VIDEO_COIN = { 15: UI.COIN.video_15, 30: UI.COIN.video_30, 60: UI.COIN.video_60 }; // 손보기 코인 재계산 미리보기(정본은 director-confirm 응답 coinCost · videoCoinItem 구간제)
  UI.vlabel = (v) => v ? `${UI.VFORMAT[v.format] || v.format} ${v.seconds}초` : "";
  UI.studioUrl = (ref) => ref ? `https://studio.youtube.com/video/${encodeURIComponent(ref)}/edit` : "https://studio.youtube.com/";
  /* [P1R2] RunnerErrorKind → 사람말(계약 §2) · 계정·발행함이 같이 쓰는 한 벌 */
  UI.ERRK = { login_fail: "로그인이 풀렸어요", captcha: "보안 문자 확인이 필요해요", rate_limited: "채널이 잠시 막았어요", suspended: "채널에서 정지됐어요", selector_changed: "채널 화면이 바뀌었어요", network: "네트워크가 끊겼어요", unknown: "알 수 없는 문제예요" };
  UI.errk = (k) => UI.ERRK[k] || k || "";
  /* [R8 리허설 · A · 2026-09-16] 🔴 «처음 붙였다»와 «로그인이 풀렸다»는 **다른 일**인데 상태값은 `pending_login` 하나뿐이다.
     가르는 재료는 서버에 **이미 있다** — `lastErrorKind` 는 실제로 실패했을 때만 실린다(NULL 이면 아예 안 온다 · `lib/accounts.ts` `if (r.last_error_kind)`).
     🔴 그런데 화면이 `lastErrorKind || "login_fail"` 로 **기본값을 지어냈다**(AC-74 의 축소판) — 그래서 한 번도 로그인한 적 없는 계정한테
        «로그인이 풀렸어요»라고 했다. **사장님이 첫 계정을 붙이고 그 자리에서 읽으실 바로 그 문장이다**(«내가 뭘 잘못했나»가 된다).
     ⇒ 가르는 자리는 **여기 한 곳**이다(계정 목록·자세히·시트·끝맺음이 다 이걸 쓴다 — 네 군데가 따로 말하면 또 갈린다). */
  UI.loginState = (a) => (a && a.lastErrorKind)
    ? { first: false, why: UI.errk(a.lastErrorKind), cta: "다시 로그인", lead: "의 로그인이 풀렸어요", done: "다시 로그인했어요" }
    : { first: true, why: "아직 로그인 전이에요 · 한 번만 하면 돼요", cta: "로그인하기", lead: "로 로그인할 차례예요", done: "로그인했어요" };
  UI.pill = (map, s) => { const p = map[s] || ["off", s]; return `<span class="pill ${p[0]}">${UI.esc(p[1])}</span>`; };
  /* 달력 점 색 = 알약 색과 같은 자(초록·주황·빨강·회색) */
  UI.slotDot = (s) => (UI.SLOT_STATUS[s] || ["off"])[0].replace("off", "");
  /* «방금 전 · 2시간 전» — 러너 마지막 응답 */
  UI.ago = (iso) => { if (!iso) return ""; const ms = Date.now() - UI.utc(iso).getTime(); if (ms < 90e3) return "방금 전"; const m = Math.round(ms / 60e3); if (m < 60) return `${m}분 전`; const h = Math.round(m / 60); if (h < 24) return `${h}시간 전`; return `${Math.round(h / 24)}일 전`; };
  /* 복사(토큰·본문) — clipboard 막힌 환경 폴백까지 */
  UI.copy = async function (text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* 폴백 */ }
    try { const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:-1000px"; document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok; } catch { return false; }
  };
  UI.FORMAT = { story: "경험담", info: "정보", listicle: "목록", compare: "비교", qna: "문답", guide: "가이드", cardnews: "카드뉴스", steps: "단계" };   /* [R8 · B-1] 인스타 format 이 5종이 됐다 — 서버 FormatKey 와 짝이라 빠지면 화면에 빈칸이 뜬다 */
  /* [R8 · B-1] 자리·글의 종류는 이제 **셋**이다(post·shorts·cardnews). 화면이 «영상이냐 아니냐»로만 갈라 보면 카드뉴스가 글로 보인다.
     🔴 «post» 는 배지를 안 단다 — 기본이라 이름표가 붙으면 오히려 시끄럽다. */
  UI.KIND_PILL = { shorts: "영상", cardnews: "카드뉴스" };
  UI.kindPill = (kind) => (UI.KIND_PILL[kind] ? `<span class="pill ink" style="font-size:11px;padding:1px 6px;margin-right:4px">${UI.KIND_PILL[kind]}</span>` : "");
  UI.EMOTION = { warm: "친근·따뜻", neutral: "담백·정리", witty: "재치", urgent: "급함·해결", calm: "차분" };
  /* [P1R3] 수익 소스 사람말(계약 v3.1 source enum 13종) · 신선도 배지 — 수익·매체·계정 화면 공용 한 벌 */
  UI.SRC = { adsense: "애드센스", youtube: "유튜브", coupang: "쿠팡 파트너스", aliexpress: "알리 어필리에이트", linkprice: "링크프라이스", adpost: "애드포스트", adfit: "카카오 애드핏", clip: "네이버 클립", meta: "메타", tiktok: "틱톡", x: "엑스", sponsor: "협찬·광고비", manual: "그 외" };
  UI.srcLabel = (s) => UI.SRC[s] || s;
  /* 소스 마크는 한 글자로 «겹치지 않게» 고른다 — 애드«센»스/애드«포»스트가 둘 다 «애»가 되면 줄이 구분되지 않는다 */
  UI.SRCMARK = { adsense: "A", youtube: "▶", coupang: "쿠", aliexpress: "알", linkprice: "L", adpost: "N", adfit: "k", clip: "C", meta: "M", tiktok: "♪", x: "X", sponsor: "협", manual: "기" };
  UI.srcMark = (s, cls = "") => `<span class="mk src-${UI.esc(s)} ${cls}" aria-hidden="true">${UI.esc(UI.SRCMARK[s] || (UI.srcLabel(s) || "?").slice(0, 1))}</span>`; // [v4] 서비스 색(ac.css .mk.src-*)
  UI.FRESH = { api: "자동", runner: "내 PC", manual: "직접 입력" }; // «러너»는 고객 화면 금지어(§13.0)
  UI.freshPill = (f) => `<span class="pill off">${UI.esc(UI.FRESH[f] || f || "")}</span>`;
  /* 수익 매체 상태 — not_configured 는 «오류»가 아니다(PITFALLS AC-10) */
  UI.SRC_STATUS = { connected: ["ok", "연결됨"], not_configured: ["off", "키 필요"], error: ["warn", "연결 끊김"], disconnected: ["off", "끊음"] };
  UI.SRC_ERR = { auth: "다시 연결해 주세요", not_configured: "키를 넣으면 바로 가져와요", parse: "저희가 확인하고 있어요", provider: "저희가 확인하고 있어요", network: "네트워크가 불안정했어요" };
  /* [P1R2] 해야 할 일·알림 마크 — kind 하나에 아이콘 하나(홈·알림함 공용 · 이모지 0) */
  UI.KIND = {
    runner: ["warn", '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>'],
    reassign: ["warn", '<path d="M4 8h13l-3-3M20 16H7l3 3"/>'],
    publish: ["warn", '<path d="M12 20V5M6 11l6-6 6 6"/>'],
    review: ["soft", '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'],
    /* [R8 §4.5] 🔴 **기다리는 검수** — `review` 와 **같은 눈 모양**인데 색만 주의(warn)다.
       왜 색을 올리나: 이건 «봐 주세요»가 아니라 «아무도 안 보면 그 글이 나가지 못한 채 남는다»이다(팀 승인 · 자동 승인에서 뺀 글).
       🔴 새 그림을 만들지 않는다(495줄 규칙) — 같은 얼굴의 다른 색. */
    review_wait: ["warn", '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'],
    account: ["warn", '<circle cx="9" cy="9" r="4"/><path d="M12.5 12.5L20 20M17 17l2-2"/>'],
    coin: ["money", '<circle cx="12" cy="12" r="8"/><path d="M9 9l3 4 3-4M12 13v4"/>'],
    setup: ["soft", '<path d="M12 5v14M5 12h14"/>'],
    system: ["soft", '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>'],
    card: ["warn", '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>'],
    clock: ["warn", '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
    gauge: ["warn", '<path d="M4 17a8 8 0 0 1 16 0"/><path d="M12 17l4-6"/>'],
    money: ["money", '<path d="M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6"/>'],
  };
  /* [P1R4] 서버 알림 kind(lib/cron notifyOnce · B 결제·체험) → 아이콘 하나 · 링크 없을 때의 기본 링크 */
  /* [R7 §1.4 · B-1 a1c9801] 홈 «해야 할 일» 7줄 — 새 kind 는 이미 있는 아이콘으로 잇는다(아이콘을 새로 만들지 않는다) */
  /* [AC-52 · 2026-09-15] 서버가 실제로 보내는 kind 를 전수 대조해 채웠다(scripts/verify-label-surface.mjs 가 상시로 잰다) */
  /* [R8 §9 · B3] `gate_risk` — 위험이 있는 채로 승인됐다(자동 승인처럼 아무도 화면을 안 보는 길을 위해 서버가 1회 보낸다) · «검수»와 같은 얼굴
     [R8 · B] `takedown_*` — 침해 신고. 🔴 «알림»이 아니라 **해야 끝나는 일**이라 주의 계열(reassign)로 · 🔴 «곧 정지됩니다»로 쓰지 않는다(자동 정지는 없다)
     [R8 §4.5 · B] `team_review` — 팀원이 만든 글이 주인을 기다린다(`lib/team.ts notifyOwnersWaiting`). 🔴 `review`(soft) 로 잇지 마라 —
        마감 자동 승인이 이 글을 **아예 안 집기 때문에**(lib/cron/review-deadline.ts) 주인이 안 보면 그대로 멈춰 있다. 그래서 주의(`review_wait`)다.
        링크는 서버가 실어 준다(`/app/pieces.html?status=in_review`) — KIND_LINK 에 또 적지 않는다(두 출처 금지). */
  UI.KIND_ALIAS = { gate_risk: "review", team_review: "review_wait", takedown_notice: "reassign", ai_key_fallback: "gauge", takedown_due_soon: "clock", takedown_escalated: "account", account_slot: "coin", account_slot_managed: "coin", account_closing: "account", account_purge_soon: "account", account_restored: "account", export_failed: "coin", managed_runner: "runner",
    ops_assist: "system", ops_assist_end: "system", piece_failed: "publish", style_learned: "setup", /* [R9R10-A · B c922b28 · 메인이 main 에서 setup 으로 이음] «글 스타일을 배웠어요»(링크 /app/accounts.html) */ format_demoted: "publish", /* [R9R10 · B2] «이 글에서 못 낸 꾸밈이 있어요»(발행 뒤 · 링크 /app/piece.html?id=) — 검수·발행 얼굴 */ plan_changed: "card", price_change: "card", price_change_cancelled: "card",
    proxy_down: "runner", publish_manual: "publish", referral_reward: "coin", render_runner_off: "runner", runner_other_device: "runner",
    subscription_refunded: "money", tax_invoice_issued: "card", trial_extended: "clock", plan: "card", verify: "account",
    awaiting_manual: "publish", pending_login: "account", slot_gate: "setup", forcedByPlan: "review", slot_no_topic: "setup", topics_assigned: "setup", coin_cap: "coin", coin_short: "coin", produce_no_account: "account", publish_blocked: "publish", revenue_error: "money", review_blocked: "review", review_confirm: "review", review_missed: "review", runner_offline: "runner",
    /* 🔴 [C 2026-09-16] 여기에 `team_review: "review"` 를 넣었다가 **뺐다.** A 가 위(:505)에서 이미 `review_wait` 로 넣어 뒀는데,
       객체 리터럴은 **뒤엣것이 이긴다** — 내 줄이 A 의 결정을 조용히 덮고 있었다(«soft 로 잇지 마라»가 무효가 됐다).
       같은 칸을 두 곳에 적으면 충돌은 안 나고 **한쪽이 말없이 진다** — 머지가 안 잡아 주는 자리다. 칸은 한 곳에만 적는다. */
    trial_d3: "clock", trial_d1: "clock", trial_d0: "clock", trial_ended: "clock", trial_reused: "clock", billing_failed: "card", billing_suspended: "card", subscription_suspended_no_key: "card", subscription_cancelled: "card", card_required: "card", ai_cost_cap: "gauge", coin_refunded: "money", export_ready: "coin", referral: "coin" };
  UI.KIND_LINK = { trial_d3: "/app/plan.html", trial_d1: "/app/plan.html", trial_d0: "/app/plan.html", trial_ended: "/app/plan.html", trial_reused: "/app/plan.html", billing_failed: "/app/plan.html", billing_suspended: "/app/plan.html", subscription_suspended_no_key: "/app/plan.html", subscription_cancelled: "/app/plan.html", card_required: "/app/plan.html",
    coin_refunded: "/app/coins.html", export_ready: "/app/settings.html", referral: "/app/account.html", coin_cap: "/app/coins.html", coin_short: "/app/coins.html", ai_cost_cap: "/app/home.html", slot_no_topic: "/app/create.html", runner_offline: "/app/runner.html", revenue_error: "/app/ad-media.html" };
  UI.kindMark = (kind, tone) => { const k = UI.KIND[kind] || UI.KIND[UI.KIND_ALIAS[kind]] || UI.KIND.system; const cls = tone === "warn" || tone === "danger" ? "warn" : k[0];
    return `<span class="mk ${cls}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${k[1]}</svg></span>`; };
  /* [R8-A §4 · 2026-09-15 · lib/disclosure.ts COMPENSATION_LABEL·DISCLOSURE_TEXT 에서 그대로 복사] 🔴 손으로 고치지 마라 —
     scripts/verify-label-surface.mjs 가 서버와 글자까지 대조한다. «체험단»처럼 지침이 부적절 예시로 든 낱말을 쓰지 않는 것도 서버 쪽 판단이다. */
  UI.COMP_LABEL = { affiliate: "제휴 수수료", sponsored: "원고료·유료 광고", gift: "제품·서비스 무상 제공" };
  UI.DISCLOSURE_TEXT = {
    coupang: "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.",
    generic: "이 글에는 제휴 링크가 포함되어 있으며, 구매 시 일정 수수료를 받을 수 있습니다.",
    sponsoredBody: "이 글은 광고주에게서 원고료 등 대가를 받고 작성한 유료 광고입니다.",
    giftBody: "이 글은 광고주에게서 제품(또는 서비스)을 무상으로 제공받아 작성했습니다.",
  };
  /* 고지에 **어느 종류가 이미 실렸나**. 🔴 화면이 판정하지 않는다 — 서버가 넣은 문장이 거기 있는지만 본다.
     `compIn` = 줄글(영상 설명란 첫 줄) · `compOf` = 본문 HTML 첫머리 고지 블록. 문장은 두 자리가 같다(videoDescriptionFirstLine = disclosureTextFor). */
  UI.compIn = function (text) {
    const t = String(text || ""); const T = UI.DISCLOSURE_TEXT;
    return { affiliate: t.includes(T.coupang) || t.includes(T.generic), sponsored: t.includes(T.sponsoredBody), gift: t.includes(T.giftBody), text: t.replace(/\s+/g, " ").trim() };
  };
  /* 🔴 [R8-A2 수리 · 스샷에서 잡았다] 옛 판은 `class="disclosure"` **자리부터** 잘라서, 여는 태그의 남은 꼬리(`class="disclosure">`)가
     사람이 읽는 문장 앞에 그대로 붙어 나왔다 — `<[^>]+>` 는 `<` 로 시작하는 것만 지우는데 자른 조각엔 `<` 가 없었기 때문이다.
     판정(`includes`)은 문장이 들어 있어 맞았고 **보이는 글자만 틀렸다** — 그래서 하니스가 못 잡고 스샷에서만 보였다(PITFALLS #9).
     ⇒ **여는 태그의 `>` 다음부터** 자른다. */
  UI.compOf = function (bodyHtml) {
    const s = String(bodyHtml || ""); const i = s.indexOf('class="disclosure"');
    const gt = i < 0 ? -1 : s.indexOf(">", i);
    const e = gt < 0 ? -1 : s.indexOf("</div>", gt);
    return UI.compIn(gt < 0 || e < 0 ? "" : s.slice(gt + 1, e).replace(/<[^>]+>/g, " "));
  };
  /* [R8 §3.2 · 2026-09-15 · lib/ads-connect.ts adsWayOf·adsRemovable 에서 그대로 복사] 🔴 손으로 고치지 마라 — 하니스가 서버와 대조한다.
     «광고를 붙이는 길»은 채널마다 다르다: 워드프레스는 우리가 바로 넣고, 티스토리·블로거는 내 PC 프로그램이 브라우저로 한다.
     🔴 **티스토리는 뗄 수 없다**(러너가 상태를 읽기만 한다) — 그래서 «떼기» 단추를 만들지 않고, 직접 끄는 길을 말한다.
        없는 되돌리기를 단추로 만들면 눌러도 아무 일이 안 난다. */
  UI.ADS_WAY = { wordpress: "wp_widget", tistory: "runner_tistory", blogger: "runner_blogger" };
  UI.ADS_REMOVABLE = ["wp_widget", "runner_blogger"];
  UI.ADS_SAY = {
    wp_widget: { on: "광고 붙이기", onSay: "사이드바에 광고 자리를 넣어요", off: "광고 떼기", offSay: "원래 위젯은 그대로 둬요" },
    runner_blogger: { on: "광고 붙이기", onSay: "내 PC 프로그램이 켜지면 블로그에 넣어요", off: "광고 떼기", offSay: "내 PC 프로그램이 켜지면 빼요" },
    /* 🔴 티스토리는 «붙이기»가 아니라 **확인**이다 — 서버가 하는 일이 그것뿐이라 단추 이름도 그렇게 적는다. */
    runner_tistory: { on: "광고 연결 상태 확인", onSay: "내 PC 프로그램이 켜지면 연결됐는지 확인해요", note: "티스토리 광고는 티스토리 «수익» 설정에서 직접 꺼 주세요. 우리가 대신 끄지는 않아요." },
  };
  /* [R8-A · lib/content-approve.ts HARD_GATE_KEYS 에서 그대로 복사] 🔴 **이 축만 «이대로 예약»을 막는다**(hardFailures).
     나머지 실패는 «알려드리는 것»이다 — 전부 같은 빨강으로 그리면 고객이 멀쩡한 글을 못 내는 줄 안다(골격 반복·최상급이 그렇다). */
  UI.GATE_HARD = [];
  /* [R8-A2 · lib/content-approve.ts judgeBlockers `BROKEN` 에서 그대로 복사 · 하니스가 서버와 대조한다] 🔴 손으로 고치지 마라.
     영상 심사 P0 중 **«물건이 깨진 것»** 둘만 서버가 승인을 거부한다 — 그건 게이트가 아니라 **불량품**이다(올려도 채널이 안 받는다).
     🔴 나머지 P0(정책·고지 축)는 **막지 않는다**(§9) — 화면도 단추를 잠그지 않고, 대신 무엇이·왜·어떻게 하면 되는지 세 줄로 말한다. */
  UI.JUDGE_BLOCK = ["frames_not_blank", "duration_fit"];
  /* 주제군·수익 목적은 **서버에 한국말이 없다**(값만 있다 · lib/writing-contracts.ts TopicGroup·RevenueGoal) — 고객 낱말은 여기가 정본. */
  UI.GROUP_LABEL = { review: "후기·리뷰", info: "정보·방법", life: "일상" };
  UI.GOAL_LABEL = { affiliate: "제휴 수수료", adsense: "애드센스", adpost: "애드포스트", ypp: "유튜브 수익", clip_incentive: "클립 인센티브", mixed: "여러 가지" };
  /* [R8CLOSE §B8] 고객이 **고를 수 있는** 목표 매체 — 🔴 `lib/director-goal.ts MediaGoal` 네 갈래 그대로다(`affiliate`·`mixed` 는 고르는 값이 아니라 **역산한 값**이라 뺐다).
     🔴 맨 앞이 «모르겠어요»(`""`)이고 그게 **기본**이다 — 지금은 붙어 있는 광고로 추정해서 잘 돌고 있으니 억지로 고르게 하지 않는다(§9).
        «모름»을 «아무거나»로 바꿔 적지 마라: 고르지 않은 것과 «여러 가지»를 고른 것은 다르다(AC-57). */
  UI.GOAL_PICK = [["", "모르겠어요"], ["adpost", UI.GOAL_LABEL.adpost], ["adsense", UI.GOAL_LABEL.adsense], ["ypp", UI.GOAL_LABEL.ypp], ["clip_incentive", UI.GOAL_LABEL.clip_incentive]];
  /* [R8CLOSE §B3] 페르소나 연령대 — 🔴 **서버가 정본**(`lib/slang-whitelist.ts AGE_SAY`). 글자까지 같아야 한다.
     🔴 값이 없으면 `null`(«모름») — `"30s"` 같은 기본값으로 채우지 않는다(대용물 금지 · AC-57).
     🔴 모르면 **넓게 잡는다**(서버 `UNKNOWN_ALLOWS_ALL`) — 안 적어도 지금과 똑같이 돌아간다. 화면도 그렇게 말한다. */
  UI.AGE_SAY = { "10s": "10대", "20s": "20대", "30s": "30대", "40s": "40대", "50s": "50대" };
  UI.AGE_PICK = [["", "모르겠어요"], ...Object.entries(UI.AGE_SAY)];

  /* ══ [R8-A2 §9] 발행 전 검사 줄 — 🔴 **한 곳에서 그린다**(검수 화면과 직접 쓰기 화면이 같은 말을 하도록).
     원래 `public/app/piece.html` 안에만 있었고, 직접 쓰기(§5D①)가 같은 결과를 받게 되면서 여기로 올렸다 —
     두 화면이 각자 그리면 축이 늘 때마다 한쪽만 낡는다(AC-52 의 화면 쪽 얼굴).
     🔴 **막는 축은 0개다**(`UI.GATE_HARD` = 서버 `HARD_GATE_KEYS` 복사 · 사장님 2026-09-15 «말해 주기로 내려»).
        막지 않는 대신 ①또렷하게 ②어떻게 하면 되는지 ③되돌릴 수 있다는 것을 말한다.
     🔴 무게(`weight`)·어떻게(`how`)·못 잰 축(`skipped`)은 **전부 서버 값**이다 — 화면이 키를 보고 정하면 그게 대용물이다(AC-57). */
  UI.gateHigh = (c) => !c.pass && c.weight === "high";
  /* 🔴 `skipped:true` = «안 쟀다». `pass` 가 true 라도 ✓(통과)로 그리지 않는다 — 못 잰 것을 통과로 그리면 거짓말이다(AC-33·AC-9). */
  UI.gateRow = (c) => {
    if (c.skipped) return `<div class="g skip"><i>–</i><span>${UI.esc(c.label)}</span><small>${UI.esc(c.detail || "이 글에는 재지 않았어요")}</small></div>`;
    const cls = c.pass ? "" : UI.gateHigh(c) ? "hi" : "soft";
    return `<div class="g ${cls}"><i>${c.pass ? "✓" : UI.gateHigh(c) ? "!" : "i"}</i><span>${UI.esc(c.label)}</span>${c.detail ? `<small>${UI.esc(c.detail)}</small>` : ""}${!c.pass && c.how ? `<small class="how">${UI.esc(c.how)}</small>` : ""}</div>`;
  };
  /**
   * 검사 한 벌. `opts.back` 에 «되돌릴 길» 문장을 주면 그 줄을 함께 적는다(§9-3 — 되돌릴 길이 있어야 «말해 주기»가 정직하다).
   * 🔴 문장은 «겁주지 않는다»(CLAUDE §3 · 사장님 2026-09-15): 위협·책임 전가·겁주는 조건절을 쓰지 않는다.
   */
  UI.gateList = (g, opts = {}) => {
    const checks = g.checks || [];
    const bad = checks.filter((c) => !c.pass && !c.skipped);
    const skipped = checks.filter((c) => c.skipped);
    const high = bad.filter(UI.gateHigh);
    const pill = high.length ? `<span class="pill warn">꼭 보세요 ${high.length}</span>` : bad.length ? `<span class="pill off">안내 ${bad.length}</span>` : '<span class="pill ok">통과</span>';
    /* 🔴 «고쳐야 예약할 수 있어요»는 거짓말이다 — 고칠 게 있어도 예약된다. 고르는 것은 고객이다. */
    /* 🔴 «예약을 막지 않아요»를 **글자로** 말한다 — 이게 §9 의 값이다(막지 않는 대신 또렷하게). 하니스가 이 문장을 지킨다. */
    const say = bad.length ? `<p class="muted" style="margin:0 16px 8px;font-size:13px">${high.length ? `${high.length}가지는 법·계정과 얽힌 것이라 먼저 보시는 게 좋아요. ` : ""}예약을 막지 않아요 — 그대로 내보낼 수도, 고치고 내보낼 수도 있어요.</p>` : "";
    /* 못 잰 축이 있으면 **몇 개인지 먼저 말한다** — 초록 옆에 회색 줄만 끼워 두면 못 보고 «다 통과»로 읽는다. */
    const skip = skipped.length ? `<p class="muted" style="margin:0 16px 8px;font-size:12.5px">${skipped.length}가지는 이 글에 맞지 않아 재지 않았어요.</p>` : "";
    const back = opts.back === false ? "" : `<p class="muted" style="margin:0 16px 10px;font-size:12.5px">${UI.esc(opts.back || "올린 뒤에 마음이 바뀌면 «올라간 글»에서 내릴 수 있어요 · 채널에 따라 직접 내려야 할 수도 있어요.")}</p>`;
    return `<div class="gt">${UI.esc(opts.title || "발행 전 검사")} ${pill}</div>${g.rewritten ? '<p class="muted" style="margin:0 16px 8px;font-size:13px">한 번 고쳐 썼어요</p>' : ""}${say}${skip}<div class="gate">${checks.map(UI.gateRow).join("")}</div>${bad.length ? back : ""}`;
  };
  /* 🔴 서버가 «지금은 안 돼요»라고 할 때 — **문장은 전부 서버 것**이다. `publish-now` 와 `pieces-self` 의 캐던스 400 이
     같은 모양(step:"cadence" + retryAt·gapMin·dailyCap·postsToday·capped)이라 **같은 함수가 그린다**:
     두 화면이 같은 사유에 다른 말을 하면 그게 버그다(트리거 P1R8-A2). */
  /* [R8 §9 · B b2662c9] 🔴 막을 때 **넘길 길을 같이** 준다 — 서버가 `canOverride` 를 주면(우리가 권하는 값에 닿았을 뿐,
     고객이 정한 값은 아직 남았다) «이번 한 번만» 단추를 낸다. 🔴 **`canOverride` 가 없으면 단추를 그리지 않는다** —
     그건 고객이 스스로 정한 값에 닿았다는 뜻이고, 넘기기를 보내도 서버가 안 열어 준다(없는 길을 단추로 만들지 않는다).
     🔴 «설정을 바꾸시겠어요»로 유도하지 않는다 — 이건 **그 회차만**이고 저장되지 않는다(설정은 «내 계정»의 일이다).
     문구는 전부 서버 것: `error`·`risk`·`confirmLabel`. */
  UI.cannotSheet = (r, title, onOverride) => {
    const can = !!(r.canOverride && r.overrideKey && onOverride);
    return UI.sheet(`<p class="muted" style="margin:0 0 ${r.risk ? "8" : "16"}px">${UI.esc(r.message || r.error || "")}</p>`
      + (r.risk ? `<p class="muted" style="margin:0 0 16px;font-size:12.5px">${UI.esc(r.risk)}</p>` : "")
      + `<div class="cta">${can ? `<button class="btn secondary" type="button" data-ok>내일 올릴게요</button><button class="btn primary" type="button" data-go>${UI.esc(r.confirmLabel || "이번 한 번만 올릴게요")}</button>`
        : '<button class="btn secondary" type="button" data-ok>알겠어요</button>'}</div>`,
      { title: title || "지금은 올릴 수 없어요", onOpen: (sh, close) => {
        sh.querySelector("[data-ok]").onclick = close;
        const go = sh.querySelector("[data-go]"); if (go) go.onclick = () => { close(); onOverride(r.overrideKey); };
      } });
  };

  /* ── 날짜(KST 고정 · DESIGN §13.5) — 편성표와 직접 쓰기가 **같은 셈**을 쓴다(둘이 갈리면 예약 시각이 갈린다) ── */
  UI.ymdKST = (d = new Date()) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });     // "YYYY-MM-DD"
  UI.plusYmd = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  /** "YYYY-MM-DD" + "HH:MM"(KST) → UTC ISO. 🔴 `datetime-local` 을 쓰지 않는 까닭 = 그 값엔 시간대가 없다(§4.5b). */
  UI.atKST = (ymd, hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); const d = new Date(ymd + "T00:00:00Z"); d.setUTCHours(h, m, 0, 0); return new Date(d.getTime() - 9 * 3600e3).toISOString(); };
  UI.dayLabelKST = (ymd) => { const t = UI.ymdKST(); if (ymd === t) return "오늘"; if (ymd === UI.plusYmd(t, 1)) return "내일"; const [, m, d] = ymd.split("-"); return `${Number(m)}월 ${Number(d)}일`; };
  /** 편성표가 쓰는 시각 프리셋 — 직접 쓰기도 같은 눈금을 준다(한 곳에서 고친다). */
  UI.TIMES = [["07:30", "07:30"], ["09:00", "09:00"], ["12:00", "12:00"], ["15:00", "15:00"], ["18:00", "18:00"], ["21:00", "21:00"]];

  /* ══ [R8 §5D.4] 내 사진 넣기 — 🔴 설계가 «사진 업로드가 ①의 전제»라고 못 박았다(DESIGN §5D.3-4):
     이게 없으면 «직접 쓰기»는 **글자만 쓰는 길**이 된다. 서버(`/api/piece-photo-add`)는 R8 에 다 만들어져 있었는데
     부르는 화면이 **한 곳도 없었다** — 그래서 직접 쓰기 결과 화면과 검수 화면이 **이 한 함수**를 같이 쓴다.
     🔴 거절 사유 문장은 전부 서버 것(`step`: empty·too_big·bad_type·r2·piece) — 상한 숫자를 화면에 박지 않는다(AC-74).
     🔴 내 사진은 코인 0 이다 — 이 길에 코인 호출이 아예 없다(§5D.1 «내 사진만 쓰면 사진도 코인 0»). */
  /* ── [R8 §10.3 · DESIGN §5C.5] 스톡 사진 — 🔴 **크레딧이 진짜 의무다**(사장님 2026-09-15: 사람·상표 판정은 «무시해도 돼»).
       Pexels 는 «작가 크레딧 + Pexels 로 가는 눈에 띄는 링크», Pixabay 는 «어디서 왔는지»를 요구한다(lib/stock/pexels.ts·pixabay.ts 헤더).
       모양은 서버 `lib/photo-source.ts creditLineOf()` 와 같게 짠다 — 주소는 글자 대신 **링크**로 건다(화면이니까). ── */
  UI.STOCK_WHERE = { pixabay: "Pixabay", pexels: "Pexels" };
  UI.creditLine = (stock) => { if (!stock || !stock.provider) return ""; const who = String(stock.author || "").trim();
    const where = UI.STOCK_WHERE[stock.provider] || String(stock.provider); return who ? `${who} · ${where}` : where; };

  /* ── [R8 §10.3] **스톡에서 찾아 붙이기** — 서버 `/api/stock-search`·`/api/stock-attach`.
     🔴 판정(`verdict` · 사람·상표)은 **그리지 않는다** — 사장님이 «무시해도 돼»라고 하신 축이고, §9 대로 서버는 재서 적어 두기만 한다.
        화면이 그걸 경고로 그리면 «막지는 않으면서 불안만 주는» 제일 나쁜 모양이 된다(§3 · §9).
     🔴 못 찾은 까닭은 **서버 문장(`trouble`) 그대로** — «열쇠가 없다»와 «불렀는데 0건»은 다른 말이라 서버가 갈라 준다.
     🔴 **크레딧은 우리가 넣어 준다**(B f7e593a · lib/publish/gate.ts ensurePhotoCreditHtml) — 발행 본문 끝에 «사진 출처» 한 벌이 멱등으로 붙는다.
        §9-4 «우리가 대신 해 줄 수 있는 것은 대신»의 자리다(고지 문장과 같은 결). 그래서 화면이 고객에게 시키지 않고 «실어 드려요»라고 말한다.
     🔴 붙일 때 보내는 것은 «어느 검색어의 · 어느 제공사 · 몇 번»뿐이다 — 주소·작가를 화면이 지어 보내면 크레딧이 엉뚱한 곳을 가리킨다
        (그래서 서버가 `downloadUrl` 을 아예 안 내려 준다 · piece-stock.ts 헤더). ── */
  UI.stockSheet = function (pieceId, q0, onDone) {
    let lastQ = "";
    const card = (c) => `<button type="button" class="stock" data-pick="${UI.esc(c.provider)}:${UI.esc(String(c.id))}" aria-label="${UI.esc(c.alt || "이 사진 넣기")}"><img src="${UI.esc(c.previewUrl)}" alt="${UI.esc(c.alt || "")}" loading="lazy"><small>${UI.esc(UI.creditLine(c))}</small></button>`;
    UI.sheet(`<div class="field" style="margin-bottom:10px"><input class="input" id="stq" type="search" enterkeyhint="search" placeholder="어떤 사진을 찾을까요" value="${UI.esc(q0 || "")}"><div class="help"></div></div>
      <div class="cta nobar" style="position:static;padding:0 0 12px"><button class="btn secondary" type="button" id="stGo">찾기</button></div>
      <p class="muted" id="stNote" style="margin:0 0 10px;font-size:13px;min-height:18px"></p>
      <div id="stList" class="stockg"></div>
      <p class="muted" style="margin:12px 0 0;font-size:12.5px">고르시면 저희가 그 사진을 받아 와 글에 넣어요. 작가와 출처는 글 아래 «사진 출처»에 저희가 함께 실어 드려요.</p>`,
      { title: "스톡에서 찾기", onOpen: (sh, close) => {
        const input = sh.querySelector("#stq"), go = sh.querySelector("#stGo"), note = sh.querySelector("#stNote"), list = sh.querySelector("#stList");
        const search = async () => {
          const qv = String(input.value || "").trim();
          if (!qv) { note.textContent = "어떤 사진을 찾을지 적어 주세요"; return; }
          go.disabled = true; note.textContent = "찾는 중이에요…"; list.innerHTML = "";
          const r = await UI.api(`/api/stock-search?pieceId=${pieceId}&q=${encodeURIComponent(qv)}`, { noGate: true });
          go.disabled = false;
          if (!r.ok && !r.picks) { note.textContent = r.error || "지금은 찾지 못했어요"; return; }   // 사유는 서버 문장 그대로
          lastQ = qv;
          const picks = r.picks || [];
          /* 🔴 못 찾았을 때의 까닭은 서버가 갈라 준다(`trouble`) — 화면이 «없어요» 하나로 뭉치지 않는다. */
          note.textContent = picks.length ? "" : (r.trouble || "그 낱말로는 사진을 못 찾았어요");
          list.innerHTML = picks.map(card).join("");
          UI.$$("[data-pick]", sh).forEach((b) => b.onclick = async () => {
            const [provider, id] = String(b.dataset.pick).split(":");
            b.setAttribute("aria-busy", "true"); note.textContent = "넣는 중이에요…";
            const at = await UI.api("/api/stock-attach", { body: { pieceId, q: lastQ, provider, id } });
            b.removeAttribute("aria-busy");
            if (!at.ok) { note.textContent = at.gated ? "" : (at.error || "넣지 못했어요"); return; }
            note.textContent = "";
            close(); UI.toast(at.already ? "이미 넣은 사진이에요" : "사진을 넣었어요");
            if (onDone) onDone(at);
          });
        };
        go.onclick = search;
        input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } };
        if (String(q0 || "").trim()) search();   // 소재 제목으로 한 번 미리 찾아 둔다(빈 격자로 맞지 않게)
      } });
  };
  UI.photoSheet = function (pieceId, onDone, q0) {
    let photos = [];
    /* 행(ListRow) 한 벌 — 🔴 격자 위 작은 ✕ 를 쓰지 않는다(터치 44px 하한 · §13.0 접근성). 마크 38px + 이름 + 44px 단추. */
    const SRC = { customer: "내 사진", stock: "스톡 사진", ai: "AI 사진" };
    const thumb = (p, i) => `<div class="row" style="padding-left:0;padding-right:0"><span class="mk ph"><img src="${UI.esc(p.url)}" alt="" loading="lazy"></span><div class="l"><span class="t">${UI.esc(p.caption || `사진 ${i + 1}`)}</span><span class="d wrap">${UI.esc(SRC[p.source && p.source.kind] || "내 사진")}${p.stock ? ` · ${UI.creditLine(p.stock)}` : ""}</span></div><button type="button" data-drop="${p.id}" aria-label="이 사진 빼기" style="min-height:44px;min-width:44px;display:grid;place-items:center;color:var(--muted);flex:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
    const draw = (sh) => {
      sh.querySelector("#phList").innerHTML = photos.length ? photos.map(thumb).join("") : '<p class="muted" style="margin:0;font-size:13px">아직 넣은 사진이 없어요.</p>';
      $$("[data-drop]", sh).forEach((b) => b.onclick = async () => {
        b.disabled = true;
        const r = await UI.api("/api/piece-photo-remove", { body: { assetId: Number(b.dataset.drop) } });
        b.disabled = false;
        if (!r.ok) return r.gated ? undefined : UI.toast(r.error || "빼지 못했어요");
        photos = photos.filter((x) => x.id !== Number(b.dataset.drop)); draw(sh); if (onDone) onDone(photos);
      });
    };
    UI.sheet(`<p class="muted" style="margin:0 0 10px;font-size:13px">내 사진(JPG·PNG·WEBP)을 올리거나 스톡에서 찾아 넣을 수 있어요. 둘 다 코인이 들지 않아요.</p>
      <div id="phList"><span class="sk" style="width:100%;height:60px"></span></div>
      <p class="muted" id="phNote" style="margin:8px 0 0;font-size:12.5px;min-height:16px"></p>
      <div class="cta"><button class="btn secondary" type="button" id="phStock">스톡에서 찾기</button><button class="btn primary" type="button" id="phPick">사진 고르기</button></div>
      <input type="file" id="phFile" accept="image/jpeg,image/png,image/webp" multiple hidden>`,
      { title: "사진 넣기", onOpen: async (sh) => {
        const note = sh.querySelector("#phNote"), file = sh.querySelector("#phFile"), pick = sh.querySelector("#phPick");
        const r = await UI.api(`/api/piece-photos?pieceId=${pieceId}`);
        photos = r.ok ? (r.photos || []) : []; draw(sh);
        if (!r.ok && !r.gated) note.textContent = r.error || "사진을 불러오지 못했어요";
        pick.onclick = () => file.click();
        /* 스톡은 «찾아서 고르는» 일이라 시트를 한 겹 더 연다 — 끝나면 목록을 다시 읽어 크레딧까지 그린다. */
        sh.querySelector("#phStock").onclick = () => UI.stockSheet(pieceId, q0, async () => {
          const rr = await UI.api(`/api/piece-photos?pieceId=${pieceId}`);
          photos = rr.ok ? (rr.photos || []) : photos; draw(sh); if (onDone) onDone(photos);
        });
        file.onchange = async () => {
          const list = Array.from(file.files || []); file.value = "";
          if (!list.length) return;
          pick.disabled = true;
          for (let i = 0; i < list.length; i++) {
            const f = list[i];
            note.textContent = list.length > 1 ? `${i + 1}/${list.length}장 올리는 중이에요` : "올리는 중이에요";
            const dataBase64 = await new Promise((ok) => { const rd = new FileReader(); rd.onload = () => ok(String(rd.result || "").split(",")[1] || ""); rd.onerror = () => ok(""); rd.readAsDataURL(f); });
            const up = await UI.api("/api/piece-photo-add", { body: { pieceId, dataBase64, filename: f.name } });
            if (!up.ok) { note.textContent = up.gated ? "" : (up.error || "사진을 올리지 못했어요"); break; }   /* 사유는 서버 문장 그대로 */
            if (!photos.some((x) => x.id === up.photo.id)) photos.push(up.photo);
            note.textContent = up.already ? "같은 사진이 이미 있어요" : "";
            draw(sh);
          }
          pick.disabled = false; if (onDone) onDone(photos);
        };
      } });
  };

  /* ══ [R8-A2 · DESIGN §5E.2 ③⑤] 내 글에 들어온 **신고**에 답하는 두 갈래 — 🔴 서버(`/api/takedowns`·`/api/takedown-action`)는
     R8 에 완성인데 **읽는 화면이 한 곳도 없었다**. 알림·메일이 보내는 주소(`/app/settings.html#takedown`)조차 아무 데도 아닌 곳이었다.
       ① «제가 직접 내렸어요»(`removed`) — 우리가 확인할 길이 있으면 **정말 없는지 확인까지** 한다
       ② «대신 내려 주세요»(`retract`) — 러너·API 가 대신 내린다
     🔴 **길이 없는 채널엔 단추를 만들지 않는다**(§5E.3 · 티스토리 «광고 떼기»에서 배운 것) — 눌러도 아무 일이 안 나는 단추를 만들지 않는다.
        대신 그 주소로 가는 길을 준다: **게이트가 아니라 사실이다**(§9 «없는 길»).
     🔴 문장은 전부 서버 것(`message`·`error`) · 코인 0 · 되돌릴 수 없는 동작이라 확인은 한 번 둔다(§9 밖 — 고객을 위한 확인이다). */
  /* [R8 리허설 · A · 2026-09-16] 🔴 배너가 «저희가 대신 내려 드릴 수도 있어요»를 **채널을 안 가리고** 말하고 있었다 —
     유튜브처럼 우리가 못 내리는 곳인데도 그랬다. 시트는 아래 `noWay` 로 바로 말하는데 **배너만 달랐다**(열어 봐야 진실을 안다).
     🔴 «없는 길»을 있는 것처럼 말하는 자리라 작아 보여도 §9 다(§9 는 «없는 길을 열라»가 아니라 «있는 길을 막지 말라»이고,
        없는 길을 **있다고 말하는 것**은 그보다 나쁘다 — 고객이 기다리다 기한을 넘긴다).
     판정 재료는 시트와 **같은 것**을 쓴다(`canRetract && retractAvailable` · 서버 값). */
  UI.takedownLead = (live) => {
    const mine = (live || []).filter((n) => n.canRetract && n.retractAvailable).length;
    return mine === (live || []).length ? "직접 내리셔도 되고, 저희가 대신 내려 드릴 수도 있어요"
      : mine === 0 ? "저희가 대신 내려 드릴 수 없는 곳이라 직접 내리시면 돼요"
      : `${mine}건은 저희가 대신 내려 드릴 수 있어요`;
  };
  UI.takedownSheet = function (nt, onDone) {
    const live = UI.TAKEDOWN_ACTIVE.includes(nt.status);
    const canRetract = live && nt.canRetract && nt.retractAvailable;
    const open = nt.externalUrl ? `<a class="btn secondary" href="${UI.esc(nt.externalUrl)}" target="_blank" rel="noopener">그 글 열기</a>` : "";
    /* 🔴 우리가 못 내리는 자리는 **그렇다고 말한다** — «안 돼요»가 아니라 «여기서는 저희가 못 내려요 · 이 주소에서 직접 내리시면 돼요». */
    const noWay = live && !canRetract
      ? `<p class="muted" style="margin:8px 0 0;font-size:12.5px">${UI.esc(nt.channel ? `${UI.chLabel(nt.channel)}${UI.josa(UI.chLabel(nt.channel))} 저희가 대신 내려 드릴 수 없어요.` : "이 신고는 저희가 올린 글로 이어지지 않아요.")} 그 글에서 직접 내리신 뒤 «제가 직접 내렸어요»를 눌러 주세요.</p>` : "";
    UI.sheet(`<div class="row" style="padding-left:0;padding-right:0">${nt.channel ? UI.mark(nt.channel) : ""}<div class="l"><span class="t wrap">${UI.esc(nt.kindLabel || "신고")}</span><span class="d">${UI.esc(nt.claimant || "신고 접수")}</span></div>${UI.pill(UI.TAKEDOWN_STATUS, nt.status)}</div>
      <p class="muted" style="margin:4px 0 10px;font-size:13.5px;line-height:1.55;white-space:normal">${UI.esc(nt.reason || "")}</p>
      <div class="kv" style="padding-left:0;padding-right:0"><span class="k">받은 날</span><span class="v">${UI.esc(UI.dateKST(nt.receivedAt))}</span></div>
      <div class="kv" style="padding-left:0;padding-right:0"><span class="k">봐 주셨으면 하는 날</span><span class="v">${UI.esc(UI.dateKST(nt.dueAt))}${nt.daysLeft != null ? ` · ${nt.daysLeft}일 남음` : ""}</span></div>
      ${live ? '<p class="muted" style="margin:8px 0 0;font-size:12.5px">그때까지 같은 글이 다시 올라가지 않도록 저희가 막아 뒀어요. 무엇을 하실지는 고르시면 돼요.</p>' : ""}
      <div class="cta" style="flex-direction:column">${open}
        ${canRetract ? '<button class="btn primary" type="button" id="tdRetract">대신 내려 주세요</button>' : ""}
        ${live ? `<button class="btn ${canRetract ? "secondary" : "primary"}" type="button" id="tdRemoved">제가 직접 내렸어요</button>` : ""}
      </div><div id="tdc"></div>${noWay}`,
      { title: "", onOpen: (sh, close) => {
        const say = (r, title) => { close(); setTimeout(() => UI.sheet(`<p class="muted" style="margin:0 0 16px">${UI.esc(r.message || r.error || "")}</p><div class="cta">${r.url ? `<a class="btn primary" href="${UI.esc(r.url)}" target="_blank" rel="noopener">그 글 열기</a>` : '<button class="btn secondary" type="button" data-ok>알겠어요</button>'}</div>`,
          { title, onOpen: (s2, c2) => { const ok = s2.querySelector("[data-ok]"); if (ok) ok.onclick = c2; } }), 300); if (onDone) onDone(); };
        const rm = sh.querySelector("#tdRemoved");
        if (rm) rm.onclick = async () => { rm.disabled = true;
          const r = await UI.api("/api/takedown-action", { body: { id: nt.id, action: "removed" } }); rm.disabled = false;
          if (!r.ok && r.gated) return; say(r, r.ok ? "알려 주셔서 고마워요" : "알리지 못했어요"); };
        const rt = sh.querySelector("#tdRetract");
        if (rt) rt.onclick = () => UI.confirmRow(sh.querySelector("#tdc"), "채널에서 이 글이 지워져요. 되돌릴 수 없고, 코인은 들지 않아요.", async () => {
          rt.disabled = true;
          const r = await UI.api("/api/takedown-action", { body: { id: nt.id, action: "retract" } }); rt.disabled = false;
          if (!r.ok && r.gated) return;
          /* 🔴 400 + url = «여기서는 저희가 못 내려요» — 사유 문장도 그 주소도 서버 것이다(화면이 지어내면 안 되는 길을 알려 준다). */
          say(r, r.ok ? "대신 내려 드릴게요" : "저희가 내려 드릴 수 없는 채널이에요");
        }, "내려 주세요");
      } });
  };

  UI.chev ='<svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3l5 5-5 5"/></svg>';
  UI.dots = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>';

  /* ── 폼 프리미티브: 스테퍼·칩(시트 안 옵션은 칩/세그먼트/토글만 — 입력창 최소) ── */
  UI.stepper = (name, val, min, max, suffix = "", step = 1) => `<span class="stepper" data-stepper="${name}" data-min="${min}" data-max="${max}" data-step="${step}" data-suffix="${UI.esc(suffix)}"><button type="button" data-dec aria-label="줄이기">−</button><span class="val" data-val="${val}">${val}${UI.esc(suffix)}</span><button type="button" data-inc aria-label="늘리기">+</button></span>`;
  UI.bindSteppers = (root, onChange) => $$("[data-stepper]", root).forEach((st) => {
    const v = $(".val", st); const set = (n) => { n = Math.min(+st.dataset.max, Math.max(+st.dataset.min, n)); v.dataset.val = n; v.textContent = n + (st.dataset.suffix || ""); $("[data-dec]", st).disabled = n <= +st.dataset.min; $("[data-inc]", st).disabled = n >= +st.dataset.max; if (onChange) onChange(st.dataset.stepper, n); };
    const sp = +st.dataset.step || 1; $("[data-dec]", st).onclick = () => set(+v.dataset.val - sp); $("[data-inc]", st).onclick = () => set(+v.dataset.val + sp);
  });
  UI.stepVal = (root, name) => Number($(`[data-stepper="${name}"] .val`, root)?.dataset.val || 0);
  /* opts = [[value,label]] · sel = value | [values](multi) */
  UI.chips = (name, opts, sel, multi = false) => `<div class="chips" data-chips="${name}" ${multi ? 'data-multi="1"' : ""}>${opts.map(([v, l]) => `<button type="button" class="chip ${(multi ? (sel || []).map(String).includes(String(v)) : String(sel) === String(v)) ? "on" : ""}" data-v="${UI.esc(v)}">${UI.esc(l)}</button>`).join("")}</div>`;
  UI.bindChips = (root, onChange) => $$("[data-chips]", root).forEach((g) => $$("[data-v]", g).forEach((c) => c.onclick = () => { if (g.dataset.multi) c.classList.toggle("on"); else $$("[data-v]", g).forEach((x) => x.classList.toggle("on", x === c)); if (onChange) { const on = $$("[data-v].on", g).map((x) => x.dataset.v); onChange(g.dataset.chips, g.dataset.multi ? on : (on[0] ?? null), g); } })); // 값은 «그 그룹»에서(같은 이름이 여러 섹션에 있어도) · 3번째 인자 = 그룹
  UI.chipVal = (root, name) => { const g = $(`[data-chips="${name}"]`, root); if (!g) return null; const on = $$("[data-v].on", g).map((c) => c.dataset.v); return g.dataset.multi ? on : (on[0] ?? null); };
  /* 세그먼트(SegmentedTabs 컴포넌트 · 값 읽기는 chipVal 과 같다) */
  UI.seg = (name, opts, sel) => `<div class="seg" data-chips="${name}" style="margin:0">${opts.map(([v, l]) => `<button type="button" class="${String(sel) === String(v) ? "on" : ""}" data-v="${UI.esc(v)}">${UI.esc(l)}</button>`).join("")}</div>`;
  /* ── 화면 이동(개발용 mock.js 가 감싸 mock=1 을 이어 붙인다) ── */
  UI.go = (href) => location.assign(href);
  /* ── 바텀시트 폼 안 «확인 한 번 더»(팝업 모달 금지 · 시트 안 인라인 확인) ── */
  /* `yes` 를 주면 «네, 할게요» 대신 **그 동작의 이름**을 쓴다 — 되돌릴 수 없는 일일수록 단추가 무슨 일을 하는지 말해야 한다(§5E). */
  /* ── [R8-B §4.4] 고객이 꽂은 AI 키 — 🔴 **사유 셋의 사람말은 서버가 정본**(`lib/ai-key-byo.ts BYO_ERROR_TEXT`).
       목록(`GET /api/ai-keys`)은 `lastErrorKind` 만 주고 문장은 안 준다. 그래서 여기 **글자 그대로** 옮겨 두고,
       하니스(`verify-label-surface` ㉗)가 서버 파일과 바이트로 대조한다 — 두 곳이 갈리면 빨강이다(코인표 ⑧-b 와 같은 방식).
     🔴 사유를 «오류»로 뭉치지 않는다: 고객이 **할 일이 서로 다르다**(키를 다시 복사 / 기다린다 / API 를 켠다). ── */
  UI.BYO_ERROR_TEXT = {
    invalid: "키가 맞지 않아요. 구글 AI 스튜디오에서 키를 다시 복사해 주세요.",
    quota: "키가 이번 한도에 걸렸어요. 한도가 풀리면 다시 만들어요.",
    forbidden: "이 키에 권한이 없어요. 키를 만든 프로젝트에서 Generative Language API 를 켜 주세요.",
  };
  /* 키를 만드는 자리 — 서버 문장이 «구글 AI 스튜디오»라고 말하므로 화면은 **그 자리로 데려다준다**(CLAUDE §9-4 «대신 해 줄 수 있는 것»). */
  UI.AI_KEY_URL = "https://aistudio.google.com/apikey";

  /* ══ [R9R10-A · R10-5·6] 코인 등급 — 🔴 이름의 정본은 서버 `lib/coin-table.ts COIN_TIERS`(B · 2026-09-16 · docs/active/2026-09-16-R9R10-AB-keys.md §11).
       하니스(`verify-label-surface` ⑧-c)가 서버 파일과 대조한다 — B 가 머지되기 전엔 △(경고)로 뜬다.
     🔴 «최소»라는 말을 쓰지 않는다(사장님) — 간단히 · 보통 · 프리미엄.
     🔴 코인 수·사진 수·글자 수·설명 문장(`say`)은 **여기 안 적는다** — 서버 `accounts-list.tiers[]` 가 준다(AC-74 · 화면이 셈을 다시 하지 않는다).
        여기엔 주제군 라벨(`UI.GROUP_LABEL`)과 같은 자리로 **이름만** 둔다(검수 화면처럼 `tiers` 를 안 부르는 자리가 `meta.tier` 를 사람말로 바꿀 때 쓴다). */
  UI.TIER_LABEL = { simple: "간단히", standard: "보통", premium: "프리미엄" };
  /* 🔴 등급 밑 주석(«내 사진을 올리면 … 코인은 안 늘어요»)은 **서버 tierNote 만** 쓴다(accounts-list·plans-list · lib/coin-table.ts COIN_TIER_NOTE). 화면 사본을 두지 않는다 —
     같은 문장이 두 벌이면 사장님 문장이 갈린다(AC-52 · 2026-09-16 메인 지적). 서버가 안 주면 그 줄을 안 그린다. */
  /**
   * 등급 고르는 줄 셋. `tiers` = 서버 값(`[{key,label,coins,say}]`).
   *   🔴 서버 값이 없으면 **아무 등급도 그리지 않는다** — «못 불러왔어요» 한 줄. 화면이 표를 지어 그리면 그날부터 서버와 갈린다.
   *   `data-chips` 라 `UI.chipVal`·`UI.bindChips` 를 그대로 쓴다(선택 = `.on`).
   */
  UI.tierRows = (name, tiers, sel, { note = true, noteText = "" } = {}) => {   /* noteText = 서버 tierNote(accounts-list·plans-list · B c922b28) — 있으면 그것을 쓴다(한 벌) */
    if (!Array.isArray(tiers) || !tiers.length) return '<p class="muted" style="margin:0;font-size:13px">등급 정보를 아직 못 불러왔어요 · 지금 값으로 그대로 만들어요.</p>';
    return `<div class="tierpick" data-chips="${UI.esc(name)}">${tiers.map((t) => `<button type="button" class="row tap ${String(sel) === String(t.key) ? "on" : ""}" data-v="${UI.esc(t.key)}"><div class="l"><span class="t">${UI.esc(t.label || UI.TIER_LABEL[t.key] || t.key)}</span><span class="d wrap">${UI.esc(t.say || "")}</span></div><span class="r">${UI.num(t.coins)}코인</span></button>`).join("")}</div>`
      + (note && noteText ? `<p class="muted" style="margin:6px 0 0;font-size:12.5px">${UI.esc(noteText)}</p>` : "");
  };
  /** 스타일 고르는 칩 — 맨 앞은 «이 계정 기본»(`""`). 배운 스타일이 없으면 칩 대신 빈 문자열(부르는 쪽이 «배우기» 줄을 낸다). */
  UI.styleChips = (name, styles, sel, first = "이 계정 기본") => (Array.isArray(styles) && styles.length ? UI.chips(name, [["", first], ...styles.map((s) => [s.id, s.name])], sel == null ? "" : sel) : "");

  /* ══ [R9R10-A · R10-3·4·5] 계정의 옷장 + 글 레퍼런스 배우기 — 🔴 **한 곳**(계정 상세 · 만들기 · 직접 쓰기 · 디렉터가 같은 시트를 연다).
     계약(A 제안 · docs/active/2026-09-16-R9R10-AB-keys.md §5~9 · 정본은 서버):
       GET  /api/account-styles?accountId=  → { styles[], defaultStyleId, quota:{used,limit,resetAt}, recommend:{measured,styleId,line} }
       POST /api/style-reference {url, accountId} → { ref:{id,status}, quota } · 400 step quota|url|no_runner
       GET  /api/style-reference?id= → { ref:{status:"queued|capturing|reading|done|failed", failKind, style} }
       POST /api/style-reference-upload {accountId, images[]} · POST /api/style-reference-text {accountId, text}
       POST /api/account-style-default {accountId, styleId|null} · POST /api/account-style-delete {id}
     🔴 코인 0 — 코인 문장을 화면이 지어내지 않는다. 남은 횟수는 서버 `quota` 로만 말한다(없으면 숫자를 안 쓴다).
     🔴 배운 것은 서버 `summary[]`(고객 문장 · 숫자와 목록)만 그린다 — `learned` 의 영어 키는 안 그린다(AC-91). 원문은 어느 칸에도 없다(서버가 저장을 안 한다).
     🔴 못 열었을 때의 갈래(B2 확정 2026-09-16): login_wall·blocked·timeout·not_found → «화면을 찍어서 올려 주세요» ·
        no_runner → «내 PC 프로그램을 켜 주세요»가 먼저(찍어 올리라고 하면 고객이 헛일을 한다).
        다섯 밖의 값이면 «못 열었어요»로만 — `|| "blocked"` 같은 폴백 금지(AC-92 · 모름을 특정 값으로 바꾸지 않는다).
     🔴 복붙은 **마지막 예비** — 꾸밈(밑줄·형광펜·이모지·사진 자리)이 다 날아간다고 말한다.
     🔴 겁주지 않는다(§3) — 사실 한 줄 → 어떻게 하면 되는지 → 우리가 대신 해 주는 것. */
  /* [R9R10-A · B 확정 2026-09-16] 서식·블록 이름표 — 🔴 `meta.formatUnused[].label` 은 **서버가 실어 준다**(정본 MARK_LABEL). 이 맵은 ①서버 label 이 비었을 때의 예비
     ②`formatCaps` 가 null(«올려 봐야 알아요»)인 종류를 부를 때만 쓴다. 어휘 = 마크 7(bold·underline·italic·value·line·row·emoji) + 블록 타입. */
  /* [2026-09-16 · lib/blocks.ts MARK_LABEL + lib/format-marks.ts FIELD_LABEL(feature/r9-back) 에서 **글자 그대로** 복사 — 하니스 ⑧-d 가 대조한다 · 손으로 고치지 마라] */
  UI.MARK_LABEL = { value: "핵심 강조", line: "형광펜", row: "나열 강조", bold: "굵게", underline: "밑줄", italic: "기울임",   /* 2026-09-16 · main 에 머지된 lib/blocks.ts MARK_LABEL 글자 그대로(B 판 «핵심 강조»·«형광펜» · 메인 확정) — ⑧-d 가 대조 */
    emoji: "이모지", quote: "인용", table: "표", checklist: "체크리스트", faq: "자주 묻는 질문", toc: "목차", divider: "구분선", image: "사진", list: "목록",
    place: "장소·링크 카드", h2: "소제목", h3: "작은 소제목", summary: "요약", tip: "한 줄 팁", hashtags: "해시태그", affiliate: "제휴 링크", adsense: "광고 자리",
    color: "글자색", align: "가운데 정렬", hook: "첫 줄" };
  UI.STYLE_SRC = { url: "링크로 배움", capture: "캡처로 배움", paste: "붙여넣기로 배움" };
  UI.REF_FAIL_SAY = {
    login_wall: "로그인해야 보이는 글이라 저희가 못 열었어요.",
    blocked: "그 사이트가 자동으로 여는 걸 막고 있어서 못 열었어요.",
    timeout: "페이지가 너무 오래 걸려서 못 열었어요.",
    not_found: "그 주소에서 글을 못 찾았어요.",
    no_runner: "글을 열어 줄 내 PC 프로그램이 지금 꺼져 있어요.",
  };
  UI.REF_STAGE_SAY = { queued: "차례를 기다리고 있어요", capturing: "내 PC 프로그램이 글을 열어 화면을 찍고 있어요", reading: "AI가 모양을 읽고 있어요 · 글은 저장하지 않아요" };
  UI.styleSheet = function ({ accounts = [], accountId = null, onChange } = {}) {
    let acc = accounts.find((a) => a.id === accountId) || accounts[0] || null;
    let styles = [], defaultStyleId = null, quota = null, recommend = null, pollTimer = null, opened = null;
    const stop = () => { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } };
    const quotaLine = () => (quota && quota.limit != null ? `이번 달 ${UI.num(quota.used || 0)}/${UI.num(quota.limit)}개 배웠어요 · 코인은 들지 않아요` : "코인은 들지 않아요");
    /* outline = [{type,label}] — label 은 서버 사람말(B 3차) · 없거나 label 이 빈 칸은 그 줄을 안 그린다(영어 type 을 내보내지 않는다 · AC-91) */
    const outlineLine = (s) => { const o = Array.isArray(s.outline) ? s.outline.map((x) => x && x.label).filter(Boolean) : []; return o.length ? `<div class="ln">뼈대 · ${UI.esc(o.join(" → "))}</div>` : ""; };
    const learnedHtml = (s) => (Array.isArray(s.summary) && s.summary.length ? `<div class="learned">${s.summary.map((x) => `<div class="ln">${UI.esc(x)}</div>`).join("")}${outlineLine(s)}</div>` : '<p class="muted" style="margin:0;font-size:13px">배운 내용을 아직 못 불러왔어요.</p>');
    const listHtml = () => {
      if (!styles.length) return '<p class="muted" style="margin:0 0 4px;font-size:13px">아직 배운 스타일이 없어요. 위에 주소를 넣으면 첫 스타일이 생겨요.</p>';
      return styles.map((s) => `<div class="stylerow" data-style="${s.id}"><button type="button" class="row tap" data-open="${s.id}" style="padding-left:0;padding-right:0"><div class="l"><span class="t">${UI.esc(s.name)}${s.id === defaultStyleId ? ' <span class="pill ink" style="font-size:11px;padding:1px 6px">기본</span>' : ""}</span><span class="d">${UI.esc(UI.STYLE_SRC[s.source] || "배움")}${s.createdAt ? " · " + UI.dateKST(s.createdAt) : ""}${Array.isArray(s.summary) ? ` · 배운 것 ${s.summary.length}가지` : ""}</span></div>${UI.chev}</button>
        <div data-body ${opened === s.id ? "" : "hidden"} style="padding:0 0 10px">${learnedHtml(s)}
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">${s.id === defaultStyleId ? `<button type="button" class="btn sm secondary" data-undefault="${s.id}">기본에서 풀기</button>` : `<button type="button" class="btn sm secondary" data-default="${s.id}">이 계정 기본으로 걸기</button>`}<button type="button" class="btn sm ghost" data-del="${s.id}" style="color:var(--danger-ink)">지우기</button></div><div data-delc></div></div></div>`).join("");
    };
    const recHtml = () => {
      if (!recommend || !recommend.line) return "";
      const s = recommend.measured && recommend.styleId ? styles.find((x) => x.id === recommend.styleId) : null;
      return `<div class="sec">잘 되는 스타일</div><p class="muted" style="margin:0;font-size:13px;line-height:1.55">${UI.esc(recommend.line)}</p>${s && s.id !== defaultStyleId ? `<button type="button" class="btn sm secondary" data-default="${s.id}" style="margin-top:8px">«${UI.esc(s.name)}» 기본으로 걸기</button>` : ""}`;
    };
    const failHtml = (kind) => {
      const say = UI.REF_FAIL_SAY[kind] || "그 주소를 열지 못했어요.";
      const runner = kind === "no_runner";
      return `<p style="margin:0 0 6px;font-size:14px;font-weight:700">${UI.esc(say)}</p>`
        + (runner
          ? `<p class="muted" style="margin:0 0 10px;font-size:13px">내 PC 프로그램을 켜면 저희가 열어서 배워요. 지금 바로 하고 싶으면 아래처럼 화면을 찍어 올려 주셔도 돼요.</p><a class="btn secondary sm" href="/app/runner.html" style="margin-bottom:10px">내 PC 프로그램 보기</a>`
          : '<p class="muted" style="margin:0 0 10px;font-size:13px">그 글을 폰 화면으로 열고, 처음부터 끝까지 2~6장 찍어서 올려 주세요. 겹치게 찍어도 돼요 — 저희가 읽고 사진은 바로 지워요. 한 장이 너무 크면 그렇다고 알려드려요.</p>')
        + '<button type="button" class="btn secondary sm" id="rfPick">찍은 화면 올리기</button>'
        + '<button type="button" class="btn ghost sm" id="rfPasteT" style="margin-left:6px">글을 붙여 넣기</button>'
        + '<div id="rfPaste" hidden style="margin-top:10px"><p class="muted" style="margin:0 0 6px;font-size:12.5px">마지막 방법이에요 — 붙여 넣으면 밑줄·형광펜·이모지·사진 자리 같은 꾸밈은 다 날아가고 문단·말투·구성만 배워요.</p><textarea class="input" id="rfText" rows="6" placeholder="글 본문을 여기에 붙여 넣어 주세요" style="resize:vertical;min-height:120px"></textarea><div style="margin-top:8px"><button type="button" class="btn secondary sm" id="rfPasteGo">이 글로 배우기</button></div></div>';
    };
    const html = () => `${accounts.length > 1 ? `<div class="sec">어느 계정에</div>${UI.chips("sacc", accounts.map((a) => [a.id, "@" + a.handle]), acc ? acc.id : "")}` : (acc ? `<p class="muted" style="margin:0 0 4px;font-size:13px">@${UI.esc(acc.handle)} · ${UI.esc(UI.chLabel(acc.channel))}</p>` : "")}
      <div class="sec">새로 배우기</div>
      <form id="rf"><div class="field"><label>잘 된 글 주소</label><input class="input" name="url" type="url" required placeholder="https://blog.naver.com/…" autocomplete="off" inputmode="url"><div class="note" id="rfQuota">${UI.esc(quotaLine())}</div><div class="help"></div></div>
      <p class="muted" style="margin:0 0 8px;font-size:13px">문단 길이 · 이모지 · 밑줄·형광펜 · 사진 버릇 · 말투를 <b style="color:var(--ink)">숫자와 목록</b>으로만 배워요. 남의 문장은 한 줄도 저장하지 않아요.</p>
      <div class="cta nobar" style="position:static;padding:0 0 4px"><button class="btn primary" type="submit" id="rfGo">주소로 배우기</button></div>
      <p class="muted" style="margin:6px 0 0;font-size:12.5px"><a href="#" id="rfAlt" style="text-decoration:underline">주소로 못 열면? 화면을 찍어 올릴 수 있어요</a></p></form>
      <div id="rfState" hidden style="margin-top:10px;background:var(--ground);border-radius:12px;padding:12px 14px"></div>
      <input type="file" id="rfFile" accept="image/jpeg,image/png,image/webp" multiple hidden>
      <div class="sec">배운 스타일 <span class="muted" style="font-weight:500">${styles.length ? styles.length + "개" : ""}</span></div><div id="rfList">${listHtml()}</div>
      <div id="rfRec">${recHtml()}</div>`;
    const load = async () => {
      if (!acc) { styles = []; defaultStyleId = null; quota = null; recommend = null; return; }
      const r = await UI.api(`/api/account-styles?accountId=${acc.id}`, { noGate: true });
      styles = r.ok ? (r.styles || []) : []; defaultStyleId = r.ok ? (r.defaultStyleId ?? null) : null; quota = r.ok ? (r.quota || null) : null; recommend = r.ok ? (r.recommend || null) : null;
      return r;
    };
    const emit = () => { if (onChange) onChange({ accountId: acc ? acc.id : null, styles: styles.map((s) => ({ ...s })), defaultStyleId }); };
    UI.sheet('<div id="rfRoot"><span class="sk" style="width:100%;height:80px"></span></div>', { title: "레퍼런스로 스타일 배우기", onOpen: async (sh, close) => {
      const root = sh.querySelector("#rfRoot");
      const draw = () => { root.innerHTML = html(); bind(); };
      const state = (inner, { show = true } = {}) => { const st = sh.querySelector("#rfState"); if (!st) return; st.hidden = !show; st.innerHTML = inner; };
      /* 진행 — 서버 status 로만 말한다(단계 문장은 UI.REF_STAGE_SAY). 60번(약 70초) 넘게 안 끝나면 «시간이 걸려요 · 나중에 목록에서 보세요». */
      const poll = (id, tries = 0) => { stop(); pollTimer = setTimeout(async () => {
        const r = await UI.api(`/api/style-reference?id=${id}`, { noGate: true });
        if (!r.ok) { state(`<p class="muted" style="margin:0;font-size:13px">${UI.esc(r.error || "진행 상태를 못 읽었어요 · 잠시 뒤 목록에서 확인해 주세요")}</p>`); return; }
        const ref = r.ref || {};
        if (ref.status === "done") { await load(); if (ref.style && ref.style.id) opened = ref.style.id; draw(); state(`<p style="margin:0 0 6px;font-size:14px;font-weight:700">배웠어요${ref.style && ref.style.name ? ` · ${UI.esc(ref.style.name)}` : ""}</p><p class="muted" style="margin:0;font-size:13px">아래 «배운 스타일»에서 무엇을 배웠는지 볼 수 있어요. 이 계정 기본으로 걸면 다음 글부터 자동으로 써요.</p>`); emit(); return; }
        if (ref.status === "failed") { state(failHtml(ref.failKind)); bindFail(); return; }
        if (tries >= 60) { state('<p class="muted" style="margin:0;font-size:13px">생각보다 오래 걸리고 있어요. 끝나면 «배운 스타일» 목록에 올라와요 — 나중에 다시 열어 봐 주세요.</p>'); return; }
        state(`<p class="muted" style="margin:0;font-size:13px">${UI.esc(UI.REF_STAGE_SAY[ref.status] || "배우고 있어요")}${tries > 3 ? ` · ${tries * 1.2 | 0}초째` : ""}</p>`);
        poll(id, tries + 1); }, 1200); };
      const start = async (r, f) => {
        if (!r.ok) {
          if (r.gated) return;
          if (r.step === "no_runner" || r.failKind === "no_runner") { state(failHtml("no_runner")); bindFail(); return; }
          if (r.step === "quota") { if (f) UI.fieldError(f, "url", r.error || "이번 달 한도를 다 썼어요"); else state(`<p class="muted" style="margin:0;font-size:13px">${UI.esc(r.error || "이번 달 한도를 다 썼어요")}</p>`); return; }
          if (f) return UI.fieldError(f, "url", r.error || "지금은 배우지 못했어요");
          return state(`<p class="muted" style="margin:0;font-size:13px">${UI.esc(r.error || "지금은 배우지 못했어요")}</p>`);
        }
        if (r.quota) { quota = r.quota; const q = sh.querySelector("#rfQuota"); if (q) q.textContent = quotaLine(); }
        state(`<p class="muted" style="margin:0;font-size:13px">${UI.esc(UI.REF_STAGE_SAY.queued)}</p>`);
        poll(r.ref && r.ref.id);
      };
      const bindFail = () => {
        const file = sh.querySelector("#rfFile"), pick = sh.querySelector("#rfPick");
        if (pick) pick.onclick = () => file.click();
        const pt = sh.querySelector("#rfPasteT"), pb = sh.querySelector("#rfPaste");
        if (pt && pb) pt.onclick = () => { pb.hidden = false; pt.hidden = true; pb.querySelector("textarea").focus(); };
        const pg = sh.querySelector("#rfPasteGo");
        if (pg) pg.onclick = async () => { const t = (sh.querySelector("#rfText").value || "").trim(); if (!t) return UI.toast("본문을 붙여 넣어 주세요"); pg.disabled = true; const r = await UI.api("/api/style-reference-text", { body: { accountId: acc ? acc.id : null, text: t } }); pg.disabled = false; if (!r.ok && r.step === "text") return UI.toast(r.error || "더 길게 붙여 주세요"); start(r); };
      };
      const bind = () => {
        UI.bindChips(root, async (n, v) => { if (n !== "sacc") return; acc = accounts.find((a) => String(a.id) === String(v)) || acc; stop(); await load(); draw(); });
        const form = sh.querySelector("#rf");
        UI.form(form, async (d, f) => { const r = await UI.api("/api/style-reference", { body: { url: d.url.trim(), accountId: acc ? acc.id : null } }); start(r, f); });
        const alt = sh.querySelector("#rfAlt"); if (alt) alt.onclick = (e) => { e.preventDefault(); state(failHtml("blocked").replace(UI.esc(UI.REF_FAIL_SAY.blocked), "주소로 못 여는 글은 화면을 찍어 올려 주세요.")); bindFail(); };
        const file = sh.querySelector("#rfFile");
        if (file) file.onchange = async () => {
          const list = Array.from(file.files || []).slice(0, 6); file.value = ""; if (!list.length) return;   /* 서버 상한 6장 · 장당 1MB(B · step too_big 이면 서버 문장을 그대로 보여 준다) */
          state(`<p class="muted" style="margin:0;font-size:13px">${list.length}장 올리는 중이에요</p>`);
          const images = []; for (const f of list) images.push(await new Promise((ok) => { const rd = new FileReader(); rd.onload = () => ok(String(rd.result || "")); rd.onerror = () => ok(""); rd.readAsDataURL(f); }));
          const r = await UI.api("/api/style-reference-upload", { body: { accountId: acc ? acc.id : null, images: images.filter(Boolean) } });
          start(r);
        };
        UI.$$("[data-open]", root).forEach((b) => b.onclick = () => { const id = Number(b.dataset.open); opened = opened === id ? null : id; sh.querySelector("#rfList").innerHTML = listHtml(); bindList(); });
        bindList();
      };
      const bindList = () => {
        UI.$$("[data-open]", root).forEach((b) => b.onclick = () => { const id = Number(b.dataset.open); opened = opened === id ? null : id; sh.querySelector("#rfList").innerHTML = listHtml(); bindList(); });
        UI.$$("[data-default],[data-undefault]", root).forEach((b) => b.onclick = async () => {
          const id = b.dataset.default ? Number(b.dataset.default) : null; b.disabled = true;
          const r = await UI.api("/api/account-style-default", { body: { accountId: acc ? acc.id : null, styleId: id } }); b.disabled = false;
          if (!r.ok) return r.gated ? undefined : UI.toast(r.error || "저장하지 못했어요");
          defaultStyleId = r.defaultStyleId ?? id; sh.querySelector("#rfList").innerHTML = listHtml(); sh.querySelector("#rfRec").innerHTML = recHtml(); bindList();
          UI.toast(id ? "이 계정 기본으로 걸었어요 · 다음 글부터 자동으로 써요" : "기본에서 풀었어요"); emit();
        });
        UI.$$("[data-del]", root).forEach((b) => b.onclick = () => { const row = b.closest(".stylerow"); UI.confirmRow(row.querySelector("[data-delc]"), "이 스타일을 지울까요? 이미 만든 글은 그대로예요.", async () => {
          const r = await UI.api("/api/account-style-delete", { body: { id: Number(b.dataset.del) } }); if (!r.ok) return UI.toast(r.error || "지우지 못했어요");
          await load(); sh.querySelector("#rfList").innerHTML = listHtml(); sh.querySelector("#rfRec").innerHTML = recHtml(); bindList(); UI.toast("지웠어요"); emit(); }); });
      };
      await load(); draw();
      const obs = new MutationObserver(() => { if (!document.body.contains(sh)) { stop(); obs.disconnect(); } }); obs.observe(document.body, { childList: true });
    } });
  };
  UI.confirmRow = (host, msg, onYes, yes) => { host.innerHTML = `<p class="muted" style="margin:8px 0 12px">${UI.esc(msg)}</p><div class="cta nobar" style="position:static;padding:0"><button class="btn secondary" type="button" data-no>아니요</button><button class="btn danger" type="button" data-yes>${UI.esc(yes || "네, 할게요")}</button></div>`; host.querySelector("[data-no]").onclick = () => { host.innerHTML = ""; }; host.querySelector("[data-yes]").onclick = onYes; };
})();
