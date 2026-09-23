// scripts/build-pages.mjs — public/app/_tpl.txt · public/ops/_tpl.txt(간이 템플릿) → *.html 생성. 셸(레일·탭·appbar)을 한 곳에서 관리.
//   사용: node scripts/build-pages.mjs   (템플릿을 고치면 다시 실행 · 생성물도 커밋 — Netlify 빌드 커맨드 없음)
//   블록 형식: === 파일명 | 탭키 | 제목 [| white two] ===  본문HTML  --- script ---  JS(async 함수 안에서 실행)
//   4번째 칸: white = 흰 페이지(.page.white) · two = 데스크톱 우측 300 패널(.page.two · ≥1100px · DESIGN §13.3b) · 둘 다면 "white two"
//   [v4] 고객 화면 앱바에는 제목 텍스트를 넣지 않는다(시안 v3·v4 — 제목은 문장형 헤드라인이 맡는다 · <title> 은 유지) · 4번째 칸 white = 흰 페이지(.page.white)
import { readFileSync, writeFileSync, existsSync } from "node:fs";

/* 🔴 [R17 · C · AC-244] `--check` — **덮어쓰지 않고 «정본과 생성물이 갈렸나»만 말한다.**
   이 자를 만든 까닭: 2026-09-23 에 내가 이 스크립트를 그냥 돌렸다가 **A 의 R17 작업 201줄을 다섯 화면에서 지웠다.**
   `*.html` 을 직접 고치고 `_tpl.txt` 에 안 옮긴 사람이 있으면, 다음 사람이 빌드를 돌리는 순간 **말없이 사라진다**
   — 그리고 빌드는 초록으로 끝난다. 그게 제일 나쁘다(§4.8 의 반대 방향: «있던 화면이 없어진다»).
   ⇒ 고치기 **전에** `node scripts/build-pages.mjs --check` 를 돌린다. 갈린 게 있으면 종료코드 1 + 파일 목록.
   🔴 **이 자는 «자기 나무의» build-pages.mjs 로만 재라.** 이 스크립트 자체가 내용이다(`ui.js?v=` 같은 판 번호가 여기 박힌다).
      남의 가지를 재겠다고 **내 자를 남의 나무에 얹으면** 37장이 전부 «`ui.js?v=30` ↔ `v=31` 한 줄»로 빨개진다 —
      제품이 아니라 **내 자의 상태를 찍은 것**이다(AC-236 · AC-240). 내가 2026-09-23 에 바로 그렇게 한 번 틀렸다.
      남의 가지를 재려면 **그 가지의 스크립트를 쓰고**, 그냥 돌린 뒤 `git diff -- public/` 가 비는지 보면 된다.
   🔴 **그리고 `--check` 를 «따로 돌리는 것»으로 두면 아무도 안 돌린다 — 내가 같은 판에서 두 번 밟았다.**
      함정을 쓴 바로 뒤에 또 밟았다. **아는 것으로는 안 막힌다. 막는 것으로만 막힌다.**
      ⇒ 그래서 **그냥 돌려도 먼저 재고, 지울 줄이 있으면 거절한다.** 정말 덮을 때만 `--force`.
      이건 고객을 막는 게 아니라 **되돌릴 수 없는 삭제 앞의 확인**이다(CLAUDE §9 «이 규칙 밖인 것» 셋째). */
const CHECK = process.argv.includes("--check");
const FORCE = process.argv.includes("--force");
const drift = [];
const pending = [];   // 쓸 것들 — 다 재고 나서 한꺼번에 쓴다

const FONT = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">`;
const BACK = (fallback) => `<a class="ic" href="javascript:history.length>1?history.back():location.assign('${fallback}')" aria-label="뒤로"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></a>`;

const TARGETS = [
  { dir: "public/app", suffix: "AutoCreate", scripts: ["/js/ui.js?v=30", "/js/mock.js?v=32"], back: ["team.html", "accounts.html", "settings.html", "write.html", "plan.html", "coins.html", "notifications.html", "support.html", "director.html", "pieces.html", "piece.html", "runner.html", "posts.html", "ad-media.html"], fallback: "/app/account.html", fallbacks: { "director.html": "/app/create.html", "write.html": "/app/create.html", "pieces.html": "/app/home.html", "piece.html": "/app/pieces.html", "posts.html": "/app/schedule.html", "ad-media.html": "/app/revenue.html" }, manifest: true, robots: false },
  { dir: "public/ops", suffix: "AutoCreate 운영센터", scripts: ["/js/ui.js?v=30", "/js/ops.js?v=3", "/js/mock-ops.js?v=2"], back: ["tenant.html", "ticket.html", "cs-faq.html", "password.html", "company.html", "takedowns.html", "proxies.html"], fallback: "/ops/", fallbacks: { "company.html": "/ops/plans.html", "tenant.html": "/ops/tenants.html", "ticket.html": "/ops/cs.html", "cs-faq.html": "/ops/cs.html", "takedowns.html": "/ops/cs.html", "proxies.html": "/ops/runners.html" }, manifest: false, robots: true, titleInBar: true, bodyClass: "ops" }, // 운영센터는 제목 유지(§13.0b «운영 콘솔 예외» · 밀도)
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
<link rel="stylesheet" href="/css/ac.css?v=23">
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
    const out = `${t.dir}/${file}`;
    {
      const cur = existsSync(out) ? readFileSync(out, "utf8") : null;
      /* 줄끝(CRLF)만 다른 건 갈린 게 아니다 — 그걸 세면 서른일곱이 매번 빨개져서 아무도 안 본다. */
      const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
      const norm = (x) => x.split(CR).join("");
      if (cur === null) drift.push({ file: out, missing: true, gone: [], add: [] });
      else if (norm(cur) !== norm(page)) {
        const a = norm(cur).split(LF), b = norm(page).split(LF);
        /* 🔴 **집합이 아니라 개수로 센다**(2026-09-23 · B 가 밟은 모양을 재서 고쳤다).
           B 가 정본에 `load()` 닫는 `}` 를 **하나 더** 넣었는데, 집합 비교는 그 `}` 가 **딴 데도 있다**는 이유로
           «새 줄 0개»로 읽었다 — 파일 이름은 뜨는데 **밑에 한 줄도 안 찍혔다.** «갈렸다»고만 하고 **무엇이**를 못 말하면
           사람은 그냥 넘긴다. 개수로 세면 «5번 나오던 줄이 6번» 이 **+1** 로 보인다. */
        const count = (arr) => { const m = new Map(); for (const l of arr) if (l.trim()) m.set(l, (m.get(l) || 0) + 1); return m; };
        const ca = count(a), cb = count(b), gone = [], add = [];
        for (const [l, k] of ca) for (let x = (cb.get(l) || 0); x < k; x++) gone.push(l);
        for (const [l, k] of cb) for (let x = (ca.get(l) || 0); x < k; x++) add.push(l);
        drift.push({ file: out, missing: false, gone, add });
      }
    }
    pending.push([out, page]);   // 🔴 먼저 다 재고 나서 쓴다 — 한 장이라도 위험하면 **아무 장도 안 쓴다**
    n++;
  }
  console.log(`${t.dir}: ${n} pages${CHECK ? " (check)" : ""}`);
}
/* ── 재고 나서: 보고(--check)하거나, 거절하거나, 쓴다 ── */
const risky = drift.filter((d) => d.gone.length);   // **지울 줄이 있는 것만** 위험이다(넣기만 하는 건 그냥 빌드다)
if (CHECK) {
  if (!drift.length) { console.log("✓ 정본(_tpl.txt)과 생성물이 같다 — 지금 빌드를 돌려도 지워지는 것이 없다."); process.exit(0); }
} else {
  /* 🔴 **위험한 장만 건너뛰고 나머지는 쓴다.**
     처음엔 «한 장이라도 위험하면 아무 장도 안 쓴다»로 만들었는데, 그러면 **내 안전한 장도 못 써서**
     사람이 곧바로 `--force` 를 집는다 — 막는 자가 **우회를 부르면** 안 막은 것만 못하다.
     위험한 장은 **손도 안 대고 그대로 둔다**(지울 줄이 살아 있다). 나머지는 평소대로 간다. */
  const skip = new Set(FORCE ? [] : risky.map((d) => d.file));
  let wrote = 0;
  for (const [out, page] of pending) if (!skip.has(out)) { writeFileSync(out, page, "utf8"); wrote++; }
  console.log("");
  if (!skip.size) {
    console.log(`✓ ${wrote} pages 썼다${FORCE && risky.length ? ` · 🔴 --force 로 ${risky.reduce((a, d) => a + d.gone.length, 0)}줄을 덮었다` : ""}`);
    process.exit(0);
  }
  console.log(`✓ ${wrote}장 썼다 · 🔴 **${skip.size}장은 안 썼다** — 이대로 쓰면 ${risky.reduce((a, d) => a + d.gone.length, 0)}줄이 사라진다.`);
  console.log("   안 쓴 장은 **손도 안 댔다**(지울 줄이 그대로 살아 있다). 아래를 보고 정하라.");
}

{
  const cut = (l) => (l.trim().length > 150 ? l.trim().slice(0, 150) + " …" : l.trim());
  console.log("");
  console.log(`🔴 정본과 갈린 생성물 ${drift.length}개 — **빌드는 «생성물에만» 있는 줄을 지운다.**`);
  for (const d of drift) {
    console.log("");
    if (d.missing) { console.log(`   ✗ ${d.file}  —  생성물이 없다`); continue; }
    console.log(`   ✗ ${d.file}`);
    /* 순서만 바뀐 경우엔 개수로도 안 보인다 — 그때는 «못 보여준다»고 **말한다**(조용히 이름만 띄우지 않는다). */
    if (!d.gone.length && !d.add.length) console.log("      ⊘ 갈렸는데 줄로는 안 보인다 — **줄 순서만 바뀌었다.** `git diff` 로 봐라.");
    if (d.gone.length) {
      console.log(`      ✖ 생성물에만 ${d.gone.length}줄 — **빌드가 지울 줄**`);
      for (const l of d.gone.slice(0, 8)) console.log(`         - ${cut(l)}`);
      if (d.gone.length > 8) console.log(`         … ${d.gone.length - 8}줄 더 (git diff 로 본다)`);
    }
    if (d.add.length) {
      /* 🔴 넣을 줄은 **전부 찍는다**(A 의 제안 · 2026-09-23). 세는 것보다 **보는 것**이 이 건을 가른다. */
      console.log(`      ＋ 정본에만 ${d.add.length}줄 — **빌드가 넣을 줄**(전부 찍는다)`);
      for (const l of d.add) console.log(`         + ${cut(l)}`);
    }
  }
  console.log("");
  console.log("   할 일: 「생성물에만」 있는 줄을 **`_tpl.txt` 로 옮긴 뒤** 빌드한다(AC-213 · 정본이 먼저다).");
  console.log("   🔴 그 줄을 쓴 사람이 누군지 모르면 **지우지 말고 물어본다** — 말없이 사라지면 아무도 못 찾는다.");
  console.log("   정말 덮어야 한다면: node scripts/build-pages.mjs --force");
  console.log("");
  console.log("   🔴 **「정본에만」 있는 줄은 반드시 눈으로 읽어라.** 자는 그게 «새 내용»인지");
  console.log("      «생성물 쪽에서 고치기 전의 옛 판»인지 **못 가른다** — 글자로는 똑같이 «갈림»이다.");
  console.log("      A 실측(2026-09-23): 22종 전부 **옛 판**이었다. 안 가르고 줄 단위로 합치면");
  console.log("      옛 판과 새 판이 **둘 다 남는다**(프랑켄슈타인). 그때는 **블록 통째 교체**가 맞다.");
  console.log("      🔴 «갈렸다»는 잰 것이고 «둘 다 필요하다»는 **뜻한 것**이다 — 자는 앞엣것만 한다(AC-178).");
  process.exit(1);
}
