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
    return { ...data, status: res.status, ok: !!data.ok && res.ok };
  };

  /* ── 포맷 ── */
  UI.won = (n) => (Number(n) || 0).toLocaleString("ko-KR") + "원";
  UI.num = (n) => (Number(n) || 0).toLocaleString("ko-KR");
  UI.utc = (v) => { if (!v) return null; const s = String(v); return /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d/.test(s) && !/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? new Date(s.replace(" ", "T") + "Z") : new Date(s); };
  UI.timeKST = (iso) => { if (!iso) return ""; const d = UI.utc(iso); return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }); };
  UI.dateKST = (iso, o = {}) => { if (!iso) return ""; return UI.utc(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric", timeZone: "Asia/Seoul", ...o }); };
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
    if (me.impersonation) UI.impBanner(me.impersonation);
    // 활동 시 슬라이딩 연장(탭 복귀·5분 주기)
    document.addEventListener("visibilitychange", () => { if (!document.hidden) fetch("/api/auth-refresh", { method: "POST", credentials: "same-origin" }); });
    setInterval(() => fetch("/api/auth-refresh", { method: "POST", credentials: "same-origin" }), 5 * 60 * 1000);
    return me;
  };
  UI.impBanner = function (imp) {
    const b = document.createElement("div"); b.className = "banner"; b.style.margin = "8px 0 0";
    b.innerHTML = `<span>운영자 ${UI.esc(imp.byName || "")}가 이 고객 화면을 보고 있어요</span><button type="button">끝내기</button>`;
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
})();
