// scripts/verify-first-screen.mjs — 🔴 **«첫 화면(스크롤 0)에 내 것이 보이나»**.
//   사용: node scripts/verify-first-screen.mjs        (빨강 1건이라도 있으면 종료코드 1)
//         node scripts/verify-first-screen.mjs --json
//
//   왜 — 🔴 **사장님이 하루에 «못 찾겠다»를 세 번 하셨다**(2026-09-23). 셋 다 **없는 게 아니라 안 보이는 것**이었다:
//     ① 계정 지우는 길(줄을 눌러야만 나온다) ② 티스토리 로그인 방법(러너는 하는데 화면이 말 안 한다)
//     ③ «내 계정이 어디 있나»(같은 화면 **아래**에 있었다 — 실측 y=675/844 · 첫 화면 끝자락)
//   §4.8 은 «고르는 UI까지가 그 기능»이라 못 박았는데 **«보이는 데까지»가 빠져 있었다.**
//
//   🔴 **셋 중 이 자가 잡는 것은 ③ 하나다.** ①②는 이 자로 못 잡는다 — 까닭을 아래 «못 만든 축»에 적었다.
//      **못 만든 것을 «만들었다»고 하지 않는다**(AC-9). 한 축이라도 진짜로 재는 게 셋을 재는 척하는 것보다 낫다.
//
//   재는 것: «내 것 목록»을 가진 화면에서 **첫 줄이 첫 화면 안에 들어오나**.
//     🔴 브라우저로 실제 좌표를 잰다 — 이건 데이터가 그려진 **뒤에야** 정해진다(정적으로는 안 보인다).
//     🔴 목록이 비면 «못 쟀음»이다(통과로 세지 않는다) — 빈 목록은 늘 첫 화면에 들어오니 거짓 초록이 된다.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join, extname, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const JSON_OUT = process.argv.includes("--json");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PW = join(resolve(process.env.PW_DIR || join(ROOT, "../AutoMarketing")), "node_modules/playwright/index.mjs");
const PORT = Number(process.env.PORT || 8947);   // 🔴 워크트리마다 포트를 가른다

/* 🔴 **표를 손으로 적는다.** «주된 목록»이 무엇인지는 사람이 정하는 것이지 자가 알아맞힐 일이 아니다 —
   알아맞히게 두면 엉뚱한 상자를 집어 거짓 빨강·거짓 초록을 낸다(내가 `verify-left-edge` 에서 두 번 밟았다).
   표에 없는 화면은 **안 잰다**(«못 쟀음»도 아니다 — 재기로 한 적이 없다). */
const PAGES = [
  { page: "accounts.html", list: "#list", what: "내 계정" },
  { page: "pieces.html", list: "#list", what: "만든 글" },
  { page: "posts.html", list: "#list", what: "올라간 글" },
  { page: "runner.html", list: "#list", what: "내 PC" },
  { page: "notifications.html", list: "#list", what: "알림" },
  { page: "team.html", list: "#list", what: "팀" },
];

const results = [];
const rec = (step, ok, note = "") => { results.push({ step, ok: ok === "SKIP" ? "SKIP" : ok ? "PASS" : "FAIL", note }); };

if (!existsSync(PW)) { console.log("⊘ 못 쟀어요 — playwright 가 없다(PW_DIR). **못 쟀음은 통과가 아니다**(AC-9)."); process.exit(2); }

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png" };
const PUB = join(ROOT, "public");
const srv = createServer((req, res) => {
  const p = decodeURIComponent((req.url || "/").split("?")[0]);
  let f = join(PUB, p);
  try { if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html"); } catch { /* noop */ }
  if (!f.startsWith(PUB) || !existsSync(f)) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((ok) => srv.listen(PORT, ok));
const { chromium } = await import(pathToFileURL(PW).href);
const browser = await chromium.launch();

for (const t of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e.message).slice(0, 110)));
  await pg.goto(`http://localhost:${PORT}/app/${t.page}?mock=1`, { waitUntil: "networkidle" });
  await pg.waitForTimeout(700);
  const m = await pg.evaluate((sel) => {
    const vh = window.innerHeight;
    const box = document.querySelector(sel);
    if (!box) return { none: true };
    /* 뼈대(`.sk`)가 남아 있으면 아직 안 그려진 것이다 — 그걸 «줄»로 세면 거짓 초록이 된다. */
    const rows = [...box.querySelectorAll(".row, .rowlink, a.row")].filter((e) => e.offsetParent !== null && !e.querySelector(".sk"));
    const first = rows[0];
    return {
      rows: rows.length,
      firstTop: first ? Math.round(first.getBoundingClientRect().top) : null,
      firstBottom: first ? Math.round(first.getBoundingClientRect().bottom) : null,
      vh,
      /* 첫 화면 안에 **완전히** 들어온 줄 수 — «한 줄이 끝에 걸쳐 보인다»를 «보인다»로 세지 않는다. */
      whole: rows.filter((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= vh; }).length,
      empty: !!box.querySelector(".empty"),
      /* 🔴 **«몇 줄이 들어오나»만으로는 무르다.** 옛 순서(채널 먼저)로 되돌려 봤더니 모의는 채널이 적어
         **여전히 4줄이 들어왔다** — 라이브(17칸)에서만 안 들어온다. 모의로 못 재는 자는 자가 아니다.
         ⇒ **«내 것보다 먼저 오는 덩어리가 있나»**를 같이 잰다. 숫자 기준(«N줄 이상»)을 안 쓰는 까닭:
            그런 자는 화면이 조금만 바뀌어도 거짓 빨강을 내고, 사람이 곧 무시한다(AC-112 ⑤).
         🔴 그중에서도 **지금 쓸 수 없는 것**(`.soon`)이 내 것보다 먼저 오면 그건 확실한 빨강이다 —
            사장님 말씀이 그대로 그것이었다(«못 쓰는 14개를 먼저 지나간다»). */
      before: (() => {
        if (!first) return { blocks: 0, soon: 0 };
        const top = first.getBoundingClientRect().top;
        const blocks = [...document.querySelectorAll(".cg, .group, .hl")]
          .filter((e) => e.offsetParent !== null && !e.contains(first) && e.getBoundingClientRect().bottom <= top);
        const soon = blocks.reduce((a, e) => a + e.querySelectorAll(".soon").length, 0)
          + [...document.querySelectorAll(".soon")].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().bottom <= top).length;
        return { blocks: blocks.length, soon };
      })(),
    };
  }, t.list);
  await ctx.close();

  if (errs.length) { rec(`🔴 ${t.page} — 첫 화면에 «${t.what}»이 보인다`, false, `화면 오류 — ${errs[0]}`); continue; }
  if (m.none) { rec(`🔴 ${t.page} — 첫 화면에 «${t.what}»이 보인다`, false, `목록 상자(${t.list})를 못 찾았다 — 표가 낡았거나 화면이 바뀌었다`); continue; }
  if (!m.rows) { rec(`${t.page} — 첫 화면에 «${t.what}»이 보인다`, "SKIP", `모의에 줄이 0개다${m.empty ? "(빈 상태)" : ""} — **못 쟀음**(빈 목록은 늘 들어오니 통과로 세지 않는다)`); continue; }
  rec(`🔴 ${t.page} — 첫 화면에 «${t.what}»이 보인다`, m.whole >= 1,
    m.whole >= 1 ? `${m.rows}줄 중 ${m.whole}줄이 첫 화면에(첫 줄 y=${m.firstTop}/${m.vh})`
      : `🔴 **첫 화면에 한 줄도 온전히 안 들어온다**(첫 줄 y=${m.firstTop}/${m.vh}) — 손님은 «그 기능이 없다»고 느낀다`);
  /* 🔴 «내 것»보다 **먼저 오는 것** — 특히 **지금 쓸 수 없는 것**이 앞에 있으면 빨강이다. */
  rec(`🔴 ${t.page} — «${t.what}» 앞에 **못 쓰는 것**이 없다`, m.before.soon === 0,
    m.before.soon === 0 ? `앞에 온 덩어리 ${m.before.blocks}개 · 그중 지금 못 쓰는 칸 0`
      : `🔴 «${t.what}»에 닿기 전에 **지금 쓸 수 없는 칸 ${m.before.soon}개**를 지나간다 — 손님은 «내 것이 없다»고 느낀다`);
}

await browser.close();
srv.close();

/* ── 🔴 못 만든 축 — 까닭을 적는다(AC-9 · «만들었다»고 하지 않는다) ─────────────────────── */
const CANT = [
  ["① «줄을 눌러야만 나오는 길»이 목록에서 안내되나", `못 만들겠다. «연결 해제»가 시트 안에 있는 것 자체는 옳다(되돌릴 수 없는 동작을 목록에 늘어놓지 않는다).
     자로 만들려면 «어떤 기능이 어느 시트에 숨어 있나»를 자가 알아야 하는데, 그건 **사람이 정하는 표**를 또 하나 만드는 일이고
     그 표는 화면이 바뀔 때마다 낡는다(그게 AC-59 다). ⇒ 지금은 **화면 문장**으로 푼다(제목 밑 한 줄).`],
  ["② 채널마다 다른 로그인 방법을 화면이 말하나", `못 만들겠다 — **여기서는**. 정본이 서버에 없어서다(\`connectMethod\` 는 «어떤 방식»이지 «누구 계정»이 아니다).
     서버가 \`channels[].loginWith\` 를 실어 주면 그때 \`verify-label-surface\` 가 **글자까지** 대조할 수 있다(그 자리에 주문을 날짜와 함께 적어 뒀다).
     🔴 없는 정본을 화면 사본으로 재면 **화면끼리 맞는지만** 보게 되고, 그건 재는 게 아니다.`],
];

if (JSON_OUT) console.log(JSON.stringify({ results, cant: CANT.map(([k]) => k) }, null, 2));
else {
  console.log(`🔴 «첫 화면에 내 것이 보이나» — 폰 390×844 · ${new Date().toISOString()}`);
  console.log("─".repeat(118));
  for (const r of results) console.log(`  ${r.ok === "PASS" ? "✓" : r.ok === "SKIP" ? "⊘" : "✗"} ${r.step.padEnd(46)} ${r.note}`);
  console.log("\n── 🔴 못 만든 축(까닭을 적는다) ──");
  for (const [k, why] of CANT) console.log(`  ⊘ **${k}**\n     ${why}`);
  console.log("─".repeat(118));
  const bad = results.filter((r) => r.ok === "FAIL").length, skip = results.filter((r) => r.ok === "SKIP").length;
  console.log(`■ 잰 축 ${results.length - skip}개 — 빨강 ${bad}개 · 못 쟀음 ${skip}개(분모 밖 · AC-9)`);
  console.log("🔴 이 자는 «보이나»만 잰다 — «잘 만들었나»는 스샷을 눈으로 본다(PITFALLS #9).");
}
process.exit(results.some((r) => r.ok === "FAIL") ? 1 : 0);
