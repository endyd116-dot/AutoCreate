/* ops.js — 운영센터 셸(레일 12메뉴 · 세션 부트 · 강제 비밀번호 변경 리다이렉트). 고객 UI와 같은 토큰·컴포넌트, 밀도만 높다(DESIGN §13.0b «운영 콘솔 = 예외»). */
(function () {
  const O = (window.OPS = window.OPS || {});
  const MENU = [
    ["dash", "매출", "/ops/", '<path d="M4 18l5-6 4 3 7-9"/>'],
    ["tenants", "고객", "/ops/tenants.html", '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'],
    ["plans", "요금제", "/ops/soon.html?m=요금제", '<path d="M4 6h16M4 12h16M4 18h10"/>'],
    ["promo", "이벤트", "/ops/soon.html?m=이벤트", '<path d="M12 3l2.5 6 6.5.5-5 4.3 1.6 6.4L12 17l-5.6 3.2L8 13.8 3 9.5 9.5 9z"/>'],
    ["billing", "결제", "/ops/soon.html?m=결제", '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>'],
    ["cs", "CS", "/ops/soon.html?m=CS", '<path d="M4 5h16v11H8l-4 4z"/>'],
    ["runners", "러너", "/ops/soon.html?m=러너", '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/>'],
    ["ai", "AI", "/ops/soon.html?m=AI", '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>'],
    ["channels", "채널", "/ops/soon.html?m=채널", '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'],
    ["notices", "공지", "/ops/soon.html?m=공지", '<path d="M4 10v4h3l6 4V6L7 10zM16 9a4 4 0 0 1 0 6"/>'],
    ["operators", "운영진", "/ops/soon.html?m=운영진", '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 19c1-3.5 3.5-5 6-5s5 1.5 6 5M15 18c.5-2 2-3 4-3"/>'],
    ["audit", "감사", "/ops/audit.html", '<path d="M5 4h14v16H5zM9 9h6M9 13h6"/>'],
  ];
  const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  O.shell = function (active, op) {
    const rail = UI.$(".rail");
    if (rail) rail.innerHTML = `<a class="brand" href="/ops/">AutoCreate <span class="pill ink" style="font-size:10px;vertical-align:middle">운영</span></a>`
      + MENU.map(([k, l, h, p]) => `<a class="nav ${k === active ? "on" : ""}" href="${h}">${svg(p)}${l}</a>`).join("")
      + `<div class="grow"></div><div class="me"><i></i><span>${UI.esc(op?.name || op?.email || "")}</span><span class="coin" style="font-size:11px">${UI.esc(op?.role || "")}</span></div><button class="nav" id="opsOut" type="button">${svg('<path d="M10 17l5-5-5-5M15 12H3M20 4v16"/>')}로그아웃</button>`;
    const tabs = UI.$(".tabs");
    if (tabs) tabs.innerHTML = MENU.slice(0, 2).concat([MENU[5], MENU[11]]).map(([k, l, h, p]) => `<a class="tab ${k === active ? "on" : ""}" href="${h}">${svg(p)}${l}</a>`).join("");
    const out = UI.$("#opsOut"); if (out) out.onclick = async () => { await UI.api("/api/ops-logout", { method: "POST", noRedirect: true }); location.href = "/ops/login.html"; };
  };
  O.boot = async function (active) {
    const r = await UI.api("/api/ops-me", { noRedirect: true });
    if (!r.ok) { location.href = "/ops/login.html?next=" + encodeURIComponent(location.pathname); return null; }
    if (r.operator.mustChangePassword && !location.pathname.endsWith("/password.html")) { location.href = "/ops/password.html?first=1"; return null; }
    O.op = r.operator; O.shell(active, r.operator); return r.operator;
  };
  O.status = (s) => ({ trial: ["ink", "체험"], active: ["ok", "이용 중"], past_due: ["warn", "미납"], readonly: ["warn", "읽기 전용"], closed: ["off", "종료"] }[s] || ["off", s]);
  O.dt = (iso) => iso ? UI.utc(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
})();
