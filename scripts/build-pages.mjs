// scripts/build-pages.mjs — public/app/_tpl.txt · public/ops/_tpl.txt(간이 템플릿) → *.html 생성. 셸(레일·탭·appbar)을 한 곳에서 관리.
//   사용: node scripts/build-pages.mjs   (템플릿을 고치면 다시 실행 · 생성물도 커밋 — Netlify 빌드 커맨드 없음)
//   블록 형식: === 파일명 | 탭키 | 제목 [| white two] ===  본문HTML  --- script ---  JS(async 함수 안에서 실행)
//   4번째 칸: white = 흰 페이지(.page.white) · two = 데스크톱 우측 300 패널(.page.two · ≥1100px · DESIGN §13.3b) · 둘 다면 "white two"
//   [v4] 고객 화면 앱바에는 제목 텍스트를 넣지 않는다(시안 v3·v4 — 제목은 문장형 헤드라인이 맡는다 · <title> 은 유지) · 4번째 칸 white = 흰 페이지(.page.white)
import { readFileSync, writeFileSync } from "node:fs";

const FONT = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">`;
const BACK = (fallback) => `<a class="ic" href="javascript:history.length>1?history.back():location.assign('${fallback}')" aria-label="뒤로"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></a>`;

const TARGETS = [
  { dir: "public/app", suffix: "AutoCreate", scripts: ["/js/ui.js?v=28", "/js/mock.js?v=30"], back: ["team.html", "accounts.html", "settings.html", "write.html", "plan.html", "coins.html", "notifications.html", "support.html", "director.html", "pieces.html", "piece.html", "runner.html", "posts.html", "ad-media.html"], fallback: "/app/account.html", fallbacks: { "director.html": "/app/create.html", "write.html": "/app/create.html", "pieces.html": "/app/home.html", "piece.html": "/app/pieces.html", "posts.html": "/app/schedule.html", "ad-media.html": "/app/revenue.html" }, manifest: true, robots: false },
  { dir: "public/ops", suffix: "AutoCreate 운영센터", scripts: ["/js/ui.js?v=28", "/js/ops.js?v=3", "/js/mock-ops.js?v=1"], back: ["tenant.html", "ticket.html", "cs-faq.html", "password.html", "company.html"], fallback: "/ops/", fallbacks: { "company.html": "/ops/plans.html", "tenant.html": "/ops/tenants.html", "ticket.html": "/ops/cs.html", "cs-faq.html": "/ops/cs.html" }, manifest: false, robots: true, titleInBar: true, bodyClass: "ops" }, // 운영센터는 제목 유지(§13.0b «운영 콘솔 예외» · 밀도)
];

/* [R7 §4.4] 앱 판 번호 — 사람이 올리는 걸 잊는다. **빌드가 오늘(KST)을 박는다**(설정 «앱 정보»에 보이는 그 값).
   ui.js 의 상수는 폴백이다(빌드를 안 돌린 사본에서도 칸이 비지 않게) · 날짜가 같으면 파일을 건드리지 않는다(쓸데없는 diff 금지). */
{
  const ver = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).split("-").join(".");
  const p = "public/js/ui.js"; const src = readFileSync(p, "utf8");
  const i = src.indexOf("UI.APP_VERSION = \"");
  if (i < 0) console.warn("[build] ui.js 에 UI.APP_VERSION 이 없다 — 판 번호를 못 박는다");
  else {
    const s = i + "UI.APP_VERSION = \"".length; const e = src.indexOf("\"", s);
    const cur = src.slice(s, e);
    if (cur !== ver) { writeFileSync(p, src.slice(0, s) + ver + src.slice(e), "utf8"); console.log(`public/js/ui.js: 판 번호 ${cur} → ${ver}`); }
  }
}

for (const t of TARGETS) {
  const src = readFileSync(`${t.dir}/_tpl.txt`, "utf8");
  const blocks = src.split(/^=== /m).slice(1); let n = 0;
  for (const b of blocks) {
    const [head, ...rest] = b.split("\n");
    const [file, , title, flag] = head.replace(/ ===\s*$/, "").split("|").map((s) => s.trim());
    const back = t.back.includes(file);
    const [html, js] = rest.join("\n").split(/^--- script ---\s*$/m);
    const page = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} · ${t.suffix}</title>
${t.robots ? `<meta name="robots" content="noindex">\n` : ""}${t.manifest ? `<link rel="manifest" href="/manifest.webmanifest">\n` : ""}${FONT}
<link rel="stylesheet" href="/css/ac.css?v=22">
</head>
<body${t.bodyClass ? ` class="${t.bodyClass}"` : ""}>
<div class="shell">
  <nav class="rail" aria-label="메뉴"></nav>
  <main class="page${/white/.test(flag || "") ? " white" : ""}${/two/.test(flag || "") ? " two" : ""}" id="page">
    <div class="appbar">${back ? BACK((t.fallbacks || {})[file] || t.fallback) : `<span class="ph"></span>`}${t.titleInBar ? `<span class="ttl">${title}</span>` : ""}<span class="sp"></span></div>
${html.trim()}
  </main>
</div>
<nav class="tabs" aria-label="탭"></nav>
${t.scripts.map((s) => `<script src="${s}"></script>`).join("\n")}
<script>
(async () => {
${(js || "").trim()}
})();
</script>
</body>
</html>
`;
    writeFileSync(`${t.dir}/${file}`, page, "utf8"); n++;
  }
  console.log(`${t.dir}: ${n} pages`);
}
