/* ops.js — 운영센터 셸(레일 12메뉴 · 세션 부트 · 강제 비밀번호 변경 리다이렉트). 고객 UI와 같은 토큰·컴포넌트, 밀도만 높다(DESIGN §13.0b «운영 콘솔 = 예외»). */
(function () {
  const O = (window.OPS = window.OPS || {});
  /* [P1R4] 12메뉴 · 마지막 칸 = 볼 수 있는 최소 역할(계약 §0.2: super_admin 전부 · admin 고객/이벤트/결제/CS/공지 · operator 고객 열람+CS) */
  const MENU = [
    ["dash", "매출", "/ops/", '<path d="M4 18l5-6 4 3 7-9"/>', "super_admin"],
    ["tenants", "고객", "/ops/tenants.html", '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>', "operator"],
    ["plans", "요금제", "/ops/plans.html", '<path d="M4 6h16M4 12h16M4 18h10"/>', "super_admin"],
    ["promo", "이벤트", "/ops/promo.html", '<path d="M12 3l2.5 6 6.5.5-5 4.3 1.6 6.4L12 17l-5.6 3.2L8 13.8 3 9.5 9.5 9z"/>', "admin"],
    ["billing", "결제", "/ops/billing.html", '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>', "admin"],
    ["cs", "CS", "/ops/cs.html", '<path d="M4 5h16v11H8l-4 4z"/>', "operator"],
    ["runners", "러너", "/ops/runners.html", '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/>', "super_admin"],
    ["ai", "AI", "/ops/ai.html", '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>', "super_admin"],
    ["channels", "채널", "/ops/channels.html", '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>', "super_admin"],
    ["notices", "공지", "/ops/notices.html", '<path d="M4 10v4h3l6 4V6L7 10zM16 9a4 4 0 0 1 0 6"/>', "admin"],
    ["operators", "운영진", "/ops/operators.html", '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 19c1-3.5 3.5-5 6-5s5 1.5 6 5M15 18c.5-2 2-3 4-3"/>', "super_admin"],
    ["audit", "감사", "/ops/audit.html", '<path d="M5 4h14v16H5zM9 9h6M9 13h6"/>', "super_admin"],
  ];
  const RANK = { super_admin: 3, admin: 2, operator: 1 };
  O.can = (op, minRole) => (RANK[op?.role] || 0) >= (RANK[minRole] || 0);
  O.menus = (op) => MENU.filter((m) => O.can(op, m[4]));
  const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  O.shell = function (active, op) {
    const rail = UI.$(".rail");
    if (rail) rail.innerHTML = `<a class="brand" href="/ops/">AutoCreate <span class="pill ink" style="font-size:10px;vertical-align:middle">운영</span></a>`
      + O.menus(op).map(([k, l, h, p]) => `<a class="nav ${k === active ? "on" : ""}" href="${h}">${svg(p)}${l}</a>`).join("")
      + `<div class="grow"></div><div class="me"><i></i><span>${UI.esc(op?.name || op?.email || "")}</span><span class="coin" style="font-size:11px">${UI.esc(op?.role || "")}</span></div><button class="nav" id="opsOut" type="button">${svg('<path d="M10 17l5-5-5-5M15 12H3M20 4v16"/>')}로그아웃</button>`;
    const tabs = UI.$(".tabs");
    if (tabs) tabs.innerHTML = O.menus(op).slice(0, 4).map(([k, l, h, p]) => `<a class="tab ${k === active ? "on" : ""}" href="${h}">${svg(p)}${l}</a>`).join("");
    const out = UI.$("#opsOut"); if (out) out.onclick = async () => { await UI.api("/api/ops-logout", { method: "POST", noRedirect: true }); location.href = "/ops/login.html"; };
  };
  O.boot = async function (active) {
    const r = await UI.api("/api/ops-me", { noRedirect: true });
    if (!r.ok) { location.href = "/ops/login.html?next=" + encodeURIComponent(location.pathname); return null; }
    if (r.operator.mustChangePassword && !location.pathname.endsWith("/password.html")) { location.href = "/ops/password.html?first=1"; return null; }
    O.op = r.operator;
    const cur = MENU.find((m) => m[0] === active); // 이 역할이 못 보는 화면이면 첫 허용 메뉴로(403 대신 조용히)
    if (cur && !O.can(r.operator, cur[4])) { const first = O.menus(r.operator)[0]; if (first) { location.replace(first[2] + (location.search.includes("mock=1") ? (first[2].includes("?") ? "&" : "?") + location.search.slice(1) : "")); return null; } }
    O.shell(active, r.operator); return r.operator;
  };
  O.status = (s) => ({ trial: ["ink", "체험"], active: ["ok", "이용 중"], past_due: ["warn", "미납"], readonly: ["warn", "읽기 전용"], suspended: ["danger", "정지"], closed: ["off", "종료"] }[s] || ["off", s]);
  O.pill = (arr) => `<span class="pill ${arr[0]}">${UI.esc(arr[1])}</span>`;
  O.won = (n) => (n == null ? "—" : UI.won(n));
  O.dleft = (iso) => { if (!iso) return ""; const d = Math.ceil((UI.utc(iso).getTime() - Date.now()) / 86400e3); return d >= 0 ? `D-${d}` : `끝 ${-d}일`; };
  /* 표(운영센터만 허용 · §13.0b 예외) */
  O.table = (cols, rows, rowAttr) => `<div class="twrap"><table class="tbl"><thead><tr>${cols.map((c) => `<th${c.r ? ' class="r"' : ""}>${UI.esc(c.h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr${rowAttr ? " " + rowAttr(r) : ""}>${cols.map((c) => `<td${c.r ? ' class="r"' : ""}>${c.f(r)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:28px">아직 없어요</td></tr>`}</tbody></table></div>`;
  O.dateKST = (iso) => iso ? UI.utc(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }) : "—";
  O.dt = (iso) => iso ? UI.utc(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
})();
