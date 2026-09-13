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

  /* ── 상태 어휘(계약 §1·§4·§5 → 사람말 알약) ── */
  UI.ACC_STATUS = { active: ["ok", "정상"], pending_login: ["warn", "확인 중"], suspended: ["danger", "정지"], disconnected: ["danger", "끊김"], cooldown: ["off", "쉬는 중"], limited: ["warn", "제한"] };
  UI.PIECE_STATUS = { generating: ["off", "만드는 중"], draft: ["off", "만드는 중"], in_review: ["warn", "봐주세요"], approved: ["off", "예약됨"], scheduled: ["off", "예약됨"], publishing: ["off", "발행 중"], published: ["ok", "발행됨"], awaiting_manual: ["danger", "확인 필요"], failed: ["danger", "실패"], rejected: ["off", "버림"] };
  /* [P1R2] 슬롯 상태기계 전 상태(DESIGN §5B.6 · 계약 §-1) — 어휘 한 벌 */
  UI.SLOT_STATUS = { planned: ["off", "예정"], assigned: ["off", "소재 정함"], topic_assigned: ["off", "소재 정함"], no_topic: ["off", "소재 없음"], producing: ["off", "만드는 중"], in_review: ["warn", "봐주세요"], approved: ["off", "예약됨"], scheduled: ["off", "예약됨"], coin_short: ["warn", "코인 부족"], awaiting_runner: ["warn", "PC 대기"], publishing: ["off", "올리는 중"], published: ["ok", "올라감"], awaiting_manual: ["danger", "확인 필요"], reassigned: ["off", "계정 옮김"], skipped: ["off", "건너뜀"], failed: ["danger", "실패"] };
  /* [P1R2] 발행함 행 상태(계약 v2.1 PostRow.status) */
  UI.POST_STATUS = { published: ["ok", "올라감"], awaiting_manual: ["warn", "직접 올려야 해요"], failed: ["danger", "올리지 못했어요"] };
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
  };
  UI.kindMark = (kind, tone) => { const k = UI.KIND[kind] || UI.KIND.system; const cls = tone === "warn" || tone === "danger" ? "warn" : k[0];
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
  UI.bindChips = (root, onChange) => $$("[data-chips]", root).forEach((g) => $$("[data-v]", g).forEach((c) => c.onclick = () => { if (g.dataset.multi) c.classList.toggle("on"); else $$("[data-v]", g).forEach((x) => x.classList.toggle("on", x === c)); if (onChange) onChange(g.dataset.chips, UI.chipVal(root, g.dataset.chips)); }));
  UI.chipVal = (root, name) => { const g = $(`[data-chips="${name}"]`, root); if (!g) return null; const on = $$("[data-v].on", g).map((c) => c.dataset.v); return g.dataset.multi ? on : (on[0] ?? null); };
  /* 세그먼트(SegmentedTabs 컴포넌트 · 값 읽기는 chipVal 과 같다) */
  UI.seg = (name, opts, sel) => `<div class="seg" data-chips="${name}" style="margin:0">${opts.map(([v, l]) => `<button type="button" class="${String(sel) === String(v) ? "on" : ""}" data-v="${UI.esc(v)}">${UI.esc(l)}</button>`).join("")}</div>`;
  /* ── 화면 이동(개발용 mock.js 가 감싸 mock=1 을 이어 붙인다) ── */
  UI.go = (href) => location.assign(href);
  /* ── 바텀시트 폼 안 «확인 한 번 더»(팝업 모달 금지 · 시트 안 인라인 확인) ── */
  UI.confirmRow = (host, msg, onYes) => { host.innerHTML = `<p class="muted" style="margin:8px 0 12px">${UI.esc(msg)}</p><div class="cta nobar" style="position:static;padding:0"><button class="btn secondary" type="button" data-no>아니요</button><button class="btn danger" type="button" data-yes>네, 할게요</button></div>`; host.querySelector("[data-no]").onclick = () => { host.innerHTML = ""; }; host.querySelector("[data-yes]").onclick = onYes; };
})();
