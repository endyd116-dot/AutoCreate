// scripts/build-pages.mjs — public/app/_tpl.txt · public/ops/_tpl.txt(간이 템플릿) → *.html 생성. 셸(레일·탭·appbar)을 한 곳에서 관리.
//   사용: node scripts/build-pages.mjs   (템플릿을 고치면 다시 실행 · 생성물도 커밋 — Netlify 빌드 커맨드 없음)
//   블록 형식: === 파일명 | 탭키 | 제목 ===  본문HTML  --- script ---  JS(async 함수 안에서 실행)
import { readFileSync, writeFileSync } from "node:fs";

const FONT = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">`;
const BACK = (fallback) => `<a class="ic" href="javascript:history.length>1?history.back():location.assign('${fallback}')" aria-label="뒤로"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></a>`;

const TARGETS = [
  { dir: "public/app", suffix: "AutoCreate", scripts: ["/js/ui.js?v=5", "/js/mock.js?v=5"], back: ["accounts.html", "settings.html", "plans.html", "coins.html", "notifications.html", "support.html", "director.html", "pieces.html", "piece.html", "runner.html", "posts.html", "ad-media.html"], fallback: "/app/account.html", fallbacks: { "director.html": "/app/create.html", "pieces.html": "/app/home.html", "piece.html": "/app/pieces.html", "posts.html": "/app/schedule.html", "ad-media.html": "/app/revenue.html" }, manifest: true, robots: false },
  { dir: "public/ops", suffix: "AutoCreate 운영센터", scripts: ["/js/ui.js?v=5", "/js/ops.js?v=1"], back: ["tenant.html", "password.html"], fallback: "/ops/", manifest: false, robots: true },
];

for (const t of TARGETS) {
  const src = readFileSync(`${t.dir}/_tpl.txt`, "utf8");
  const blocks = src.split(/^=== /m).slice(1); let n = 0;
  for (const b of blocks) {
    const [head, ...rest] = b.split("\n");
    const [file, , title] = head.replace(/ ===\s*$/, "").split("|").map((s) => s.trim());
    const [html, js] = rest.join("\n").split(/^--- script ---\s*$/m);
    const page = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} · ${t.suffix}</title>
${t.robots ? `<meta name="robots" content="noindex">\n` : ""}${t.manifest ? `<link rel="manifest" href="/manifest.webmanifest">\n` : ""}${FONT}
<link rel="stylesheet" href="/css/ac.css?v=6">
</head>
<body>
<div class="shell">
  <nav class="rail" aria-label="메뉴"></nav>
  <main class="page" id="page">
    <div class="appbar">${t.back.includes(file) ? BACK((t.fallbacks || {})[file] || t.fallback) : ""}<span class="ttl">${title}</span><span class="sp"></span></div>
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
