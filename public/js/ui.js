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
    if (res.status === 401 && !opts.noRedirect) {
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
  let gateOpen = false, gateSheet = null;
  UI.gate = function (r) {
    if (!r || r.ok || gateOpen) return false;
    const done = (html, title, cta, href) => { gateOpen = true; gateSheet = UI.sheet(`<p class="muted" style="margin:0 0 16px">${html}</p><div class="cta"><a class="btn primary" href="${href}">${cta}</a></div>`, { title, onOpen: (sh) => { const bg = sh.previousSibling; if (bg) bg.addEventListener("click", () => { gateOpen = false; }); } }); return true; };
    if (r.status === 403 && r.step === "writable") {
      if (r.reason === "suspended") return done("결제가 밀려 있어요. 카드를 확인하면 바로 이어서 돼요. 만든 글과 편성표는 그대로예요.", "잠시 멈춰 있어요", "카드 확인하기", "/app/plan.html");
      const opened = done("체험이 끝났어요. 요금제를 고르면 바로 이어서 돼요. 보는 건 지금도 다 돼요.", "이어서 하려면", "요금제 고르기", "/app/plan.html");
      /* 🔴 [R7 §3.1] **탈퇴를 신청한 집도 서버 상태는 같은 readonly** 라 여기로 온다 — 그 집에 «체험이 끝났어요 · 요금제 고르기»는
         거짓말이고, 정작 필요한 «되돌리기»를 못 찾게 만든다. 막힌 그 순간에 한 번만 물어보고(GET) 탈퇴한 집이면 시트를 바꿔 준다.
         ⏳ **임시다**(2026-09-15 메인 결정 · B 에 발주): 서버가 403 에 `reason:"closed"` + `purgeAt`·`daysLeft` 를 실어 주면
            이 왕복을 통째로 지우고 위 `suspended` 처럼 `reason` 한 줄로 가른다. 그때까지만 산다. */
      const gs = gateSheet;
      UI.api("/api/account-close", { noGate: true, noRedirect: true }).then((c) => {   // noRedirect — 이 확인 때문에 누구도 로그인 화면으로 튕기지 않게
        if (!c.ok || !c.closed || !gs || !gs.el.isConnected) return;
        const h3 = gs.el.querySelector("h3"); if (h3) h3.textContent = "탈퇴를 신청하셨어요";
        gs.el.querySelector(".sheet-body").innerHTML = `<p class="muted" style="margin:0 0 16px">${UI.esc(UI.dateKST(c.purgeAt))}에 자료가 지워져요. 그때까지는 보기만 할 수 있어요. 되돌리면 하던 대로 다시 쓸 수 있어요.</p><div class="cta"><a class="btn primary" href="/app/settings.html">되돌리러 가기</a></div>`;
      });
      return opened;
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
  UI.videoDownload = async function (pieceId, note) {
    const r = await UI.api("/api/piece-video?id=" + encodeURIComponent(pieceId));
    if (!r.ok) {
      if (r.gated) return false;
      if (r.step === "no_render") { UI.toast(r.error || "아직 영상 파일이 없어요"); return false; }
      UI.toast(r.error || "영상을 가져오지 못했어요"); return false;
    }
    if (note) note.textContent = [r.filename ? `${r.filename} 를 받아요` : "", r.bytes ? UI.mb(r.bytes) : "", "받는 주소는 10분 동안만 살아 있어요"].filter(Boolean).join(" · ");
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
  UI.APP_VERSION = "2026.09.15";   // 🔴 이 값은 빌드(scripts/build-pages.mjs)가 오늘(KST)로 덮어쓴다 — 손으로 고치지 않는다(여기 적힌 건 빌드 전 폴백)


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

  /* ── 채널 ── */
  UI.CH = {
    naver_blog: { label: "네이버 블로그", mark: "N" }, tistory: { label: "티스토리", mark: "T" }, blogger: { label: "블로거", mark: "B" }, wordpress: { label: "워드프레스", mark: "W" },
    threads: { label: "쓰레드", mark: "@" }, instagram: { label: "인스타그램", mark: "◎" }, youtube_shorts: { label: "유튜브 쇼츠", mark: "▶" }, naver_clip: { label: "네이버 클립", mark: "C" },
    reels: { label: "릴스", mark: "◎" }, tiktok: { label: "틱톡", mark: "♪" },
  };
  UI.mark = (ch, cls = "") => { const c = UI.CH[ch] || { mark: "?" }; return `<span class="mk ${ch} ${cls}" aria-hidden="true">${c.mark}</span>`; };
  UI.chLabel = (ch) => (UI.CH[ch] || {}).label || ch;

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
  UI.PIECE_STATUS = { generating: ["off", "만드는 중"], draft: ["off", "만드는 중"], in_review: ["warn", "봐주세요"], approved: ["off", "예약"], scheduled: ["off", "예약"], publishing: ["off", "발행 중"], published: ["ok", "발행됨"], awaiting_manual: ["danger", "확인 필요"], awaiting_runner: ["warn", "PC 대기"], failed: ["danger", "실패"], rejected: ["off", "버림"] };   // [AC-52] awaiting_runner = 영상 렌더가 내 PC 프로그램을 기다린다(편성표 낱말과 같게)
  /* [P1R2] 슬롯 상태기계 전 상태(DESIGN §5B.6 · 계약 §-1) — 어휘 한 벌 */
  UI.SLOT_STATUS = { planned: ["off", "예정"], assigned: ["off", "소재 정함"], topic_assigned: ["off", "소재 정함"], no_topic: ["off", "소재 없음"], producing: ["off", "만드는 중"], in_review: ["warn", "봐주세요"], approved: ["off", "예약"], scheduled: ["off", "예약"], coin_short: ["warn", "코인 부족"], awaiting_runner: ["warn", "PC 대기"], publishing: ["off", "발행 중"], published: ["ok", "발행됨"], awaiting_manual: ["danger", "확인 필요"], reassigned: ["off", "계정 옮김"], skipped: ["off", "건너뜀"], rejected: ["off", "버림"], failed: ["danger", "실패"] };
  /* [P1R2] 발행함 행 상태(계약 v2.1 PostRow.status) */
  UI.POST_STATUS = { published: ["ok", "발행됨"], awaiting_manual: ["warn", "직접 올려야 해요"], failed: ["danger", "올리지 못했어요"], uploaded_private: ["warn", "비공개 업로드됨"], publishing: ["off", "올리는 중"] }; // [P1R5] uploaded_private(§7-1) · 릴스 처리 중은 publishing + errorKind video_processing
  /* [P1R5] 영상 어휘 — 계약 v5.1 §0.2 글자 그대로(VideoFormat · VideoSeconds · VideoStage · JudgeGrade · VideoChannel) · 사람말은 여기 한 곳 */
  UI.VIDEO_CH = ["youtube_shorts", "naver_clip", "reels", "threads"];
  UI.VFORMAT = { graphic: "그래픽 스토리", talking: "말하는 사람", clip: "클립" };
  UI.VSECONDS = [15, 30, 60];
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
  UI.VIDEO_COIN = { 15: 6, 30: 12, 60: 28 }; // 손보기 코인 재계산 미리보기(정본은 director-confirm 응답 coinCost · videoCoinItem 구간제)
  UI.vlabel = (v) => v ? `${UI.VFORMAT[v.format] || v.format} ${v.seconds}초` : "";
  UI.studioUrl = (ref) => ref ? `https://studio.youtube.com/video/${encodeURIComponent(ref)}/edit` : "https://studio.youtube.com/";
  /* [P1R2] RunnerErrorKind → 사람말(계약 §2) · 계정·발행함이 같이 쓰는 한 벌 */
  UI.ERRK = { login_fail: "로그인이 풀렸어요", captcha: "보안 문자 확인이 필요해요", rate_limited: "채널이 잠시 막았어요", suspended: "채널에서 정지됐어요", selector_changed: "채널 화면이 바뀌었어요", network: "네트워크가 끊겼어요", unknown: "알 수 없는 문제예요" };
  UI.errk = (k) => UI.ERRK[k] || k || "";
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
  UI.FORMAT = { story: "경험담", info: "정보", listicle: "목록", compare: "비교", qna: "문답", guide: "가이드", cardnews: "카드뉴스" };
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
  UI.KIND_ALIAS = { account_slot: "coin", account_slot_managed: "coin", account_closing: "account", account_purge_soon: "account", account_restored: "account", export_failed: "coin", managed_runner: "runner",
    ops_assist: "system", ops_assist_end: "system", piece_failed: "publish", plan_changed: "card", price_change: "card", price_change_cancelled: "card",
    proxy_down: "runner", publish_manual: "publish", referral_reward: "coin", render_runner_off: "runner", runner_other_device: "runner",
    subscription_refunded: "money", tax_invoice_issued: "card", trial_extended: "clock", plan: "card", verify: "account",
    awaiting_manual: "publish", pending_login: "account", slot_gate: "setup", forcedByPlan: "review", slot_no_topic: "setup", topics_assigned: "setup", coin_cap: "coin", coin_short: "coin", produce_no_account: "account", publish_blocked: "publish", revenue_error: "money", review_blocked: "review", review_confirm: "review", review_missed: "review", runner_offline: "runner",
    trial_d3: "clock", trial_d1: "clock", trial_d0: "clock", trial_ended: "clock", trial_reused: "clock", billing_failed: "card", billing_suspended: "card", subscription_suspended_no_key: "card", subscription_cancelled: "card", card_required: "card", ai_cost_cap: "gauge", coin_refunded: "money", export_ready: "coin", referral: "coin" };
  UI.KIND_LINK = { trial_d3: "/app/plan.html", trial_d1: "/app/plan.html", trial_d0: "/app/plan.html", trial_ended: "/app/plan.html", trial_reused: "/app/plan.html", billing_failed: "/app/plan.html", billing_suspended: "/app/plan.html", subscription_suspended_no_key: "/app/plan.html", subscription_cancelled: "/app/plan.html", card_required: "/app/plan.html",
    coin_refunded: "/app/coins.html", export_ready: "/app/settings.html", referral: "/app/account.html", coin_cap: "/app/coins.html", coin_short: "/app/coins.html", ai_cost_cap: "/app/home.html", slot_no_topic: "/app/create.html", runner_offline: "/app/runner.html", revenue_error: "/app/ad-media.html" };
  UI.kindMark = (kind, tone) => { const k = UI.KIND[kind] || UI.KIND[UI.KIND_ALIAS[kind]] || UI.KIND.system; const cls = tone === "warn" || tone === "danger" ? "warn" : k[0];
    return `<span class="mk ${cls}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${k[1]}</svg></span>`; };
  UI.chev = '<svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3l5 5-5 5"/></svg>';
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
  UI.confirmRow = (host, msg, onYes) => { host.innerHTML = `<p class="muted" style="margin:8px 0 12px">${UI.esc(msg)}</p><div class="cta nobar" style="position:static;padding:0"><button class="btn secondary" type="button" data-no>아니요</button><button class="btn danger" type="button" data-yes>네, 할게요</button></div>`; host.querySelector("[data-no]").onclick = () => { host.innerHTML = ""; }; host.querySelector("[data-yes]").onclick = onYes; };
})();
