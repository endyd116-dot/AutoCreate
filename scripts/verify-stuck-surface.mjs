/**
 * scripts/verify-stuck-surface.mjs — 🔴 **«만드는 중»에 갇힌 글이 화면에서 빠져나갈 길을 갖나 — 브라우저로 읽는다**(A · 2026-09-16 · 라이브 0).
 *   사용: node scripts/verify-stuck-surface.mjs          (정적 서버 4187 · 이 워크트리의 public/ 만 준다)
 *
 *   ══ 무엇을 재나 ══
 *   사장님 신고 «제자리에 머무는 증상». 라이브 실물: piece 25·40·42 가 `stage:writing` 인 채 3,299분(≈55시간),
 *   `created_at == updated_at`(배경 함수가 한 번도 못 건드렸다). 영상은 `video-sweep`(20분)이 줍는데 **글을 줍는 크론은 0개**라,
 *   사용자에게 남은 길은 화면의 «다시 시작» 하나뿐이다. 그 길이 **정말 보이고 정말 눌리는가**를 잰다.
 *     ①갇힌 글에 안내가 **보이나**(hidden 아님 · 높이>0) ②몇 분째·어느 단계인지 **또렷하게** 말하나(§9-1)
 *     ③겁주는 말 0(§3 — «실패»·«오류»·«정지»·«알려만») ④버튼을 누르면 **202 로 정말 다시 걸리나**(200 을 같은 말로 덮지 않는다 · AC-9)
 *     ⑤거짓 양성 0 — 손잡이가 없으면 **안 뜬다** ⑥영상엔 안 단다(서버가 스스로 줍는 자리 · 버튼 두 벌 금지)
 *     ⑦상세 화면의 **빈 종이**도 말을 하나(제목도 본문도 없는 그 화면)
 *
 *   ══ 자를 먼저 찌른다(AC-90) ══
 *   서버가 **이 폴더의 코드**를 주는지 먼저 본다 — 옛 폴더가 답하면 전부 가짜 초록이다(메모리 [[ac-stale-verify-server]]).
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 4187);   // 🔴 워크트리마다 다른 포트(다른 창의 서버가 옛 public/ 을 준다)
const out = [];
const rec = (step, ok, note = "") => { out.push({ step, ok, note }); return ok; };

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  let f = join(ROOT, "public", decodeURIComponent(u.pathname));
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
  if (!existsSync(f)) { res.writeHead(404); res.end(""); return; }
  res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(f));
});
await new Promise((ok, bad) => { server.once("error", bad); server.listen(PORT, ok); })
  .catch((e) => { console.error(`🔴 포트 ${PORT} 를 못 열었다(${e.code}) — 다른 창의 서버가 살아 있다. PORT=... 로 갈라라`); process.exit(2); });
{
  const a = await (await fetch(`http://localhost:${PORT}/app/pieces.html`)).text();
  const b = await (await fetch(`http://localhost:${PORT}/js/mock.js`)).text();
  if (!a.includes("STUCK_MIN") || !b.includes("stuckKnob")) {
    console.error("🔴 응답에 이번 코드(STUCK_MIN·stuckKnob)가 없다 — 다른 폴더의 서버다. 재면 전부 가짜 초록이다");
    server.close(); process.exit(2);
  }
}

/* 🔴 **도구만** 옆 워크트리에서 빌린다(A 워크트리엔 runner 의존성이 안 깔려 있다) — 재는 코드는 위 서버가 주는 **이 폴더의 public/** 뿐이다.
   빌리는 것과 재는 것을 섞으면 [[ac-stale-verify-server]] 가 된다: 도구 경로는 달라도 되고, **코드 경로는 달라선 안 된다**. */
const PW_CANDIDATES = [join(ROOT, "runner", "node_modules", "playwright", "index.mjs"),
  ...["AutoCreate-B2", "AutoCreate-C", "AutoCreate", "AutoCreate-B"].map((w) => join(ROOT, "..", w, "runner", "node_modules", "playwright", "index.mjs"))];
const pwPath = PW_CANDIDATES.find((p) => existsSync(p));
if (!pwPath) { console.error(`🔴 playwright 를 못 찾았다 — 찾아본 곳:\n${PW_CANDIDATES.join("\n")}`); server.close(); process.exit(2); }
if (pwPath !== PW_CANDIDATES[0]) console.log(`ℹ 도구를 빌렸다: ${pwPath}  (재는 코드는 ${join(ROOT, "public")} 뿐)`);
/* ── S0 «20분»은 **서버가 정한 수**다 — 세 곳이 어긋나면 빨강 ──
   🔴 음성 대조에서 드러났다: `pieces.html` 의 수만 깨뜨렸더니 S4(상세)는 **초록으로 남았다** — 두 화면이 20 을 따로 박아 두고 있었다.
   화면이 서버보다 **짧게** 말하면 버튼을 눌러도 아무 일이 안 일어나고(서버가 200 으로 돌려보낸다),
   **길게** 말하면 되돌릴 길이 열려 있는데도 안 알려 준다. 한 출처로 모으려면 `ui.js` 판올림(47쪽)이 필요해 라운드 중엔 미뤘고,
   대신 **어긋나면 여기서 선다**(§9 «화면 ↔ 서버 하니스 대조»와 같은 방식). */
{
  const srv = readFileSync(join(ROOT, "netlify", "functions", "pieces.ts"), "utf8");
  const list = readFileSync(join(ROOT, "public", "app", "pieces.html"), "utf8");
  const detail = readFileSync(join(ROOT, "public", "app", "piece.html"), "utf8");
  const nSrv = (srv.match(/Date\.now\(\) - at\.getTime\(\) > (\d+) \* 60_000/) || [])[1];
  const nList = (list.match(/const STUCK_MIN = (\d+);/) || [])[1];
  const nDetail = (detail.match(/const stuck = mins >= (\d+)/) || [])[1];
  const ok = !!nSrv && nSrv === nList && nSrv === nDetail;
  rec("S0 «멈춤» 기준이 서버·목록·상세에서 같은 수다(두 벌 금지)", ok, `서버=${nSrv ?? "못 찾음"} 목록=${nList ?? "못 찾음"} 상세=${nDetail ?? "못 찾음"}`);
  if (!nSrv) rec("S0 서버의 그 줄을 찾았다(못 찾으면 이 대조는 가짜다)", false, "🔴 pieces.ts 에서 재점화 기준 줄을 못 읽었다 — 자를 고쳐라");
}

const pw = await import(pathToFileURL(pwPath).href);
const browser = await pw.chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, locale: "ko-KR" });
/* 🔴 `localStorage` 는 **같은 컨텍스트의 모든 탭이 나눠 쓴다** — 앞 장면에서 누른 «다시 시작» 기억이 뒤 장면으로 새면
   뒤 장면은 **이유도 모른 채 초록**이 된다(장면 순서만 바꿔도 색이 바뀌는 자는 자가 아니다). 그래서 장면마다 씻고 다시 연다. */
const openPage = async (path, { fresh = true } = {}) => {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
  await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: "networkidle" }).catch(() => {});
  if (fresh) {
    await page.evaluate(() => { try { localStorage.removeItem("acPieceRestart"); } catch { /* empty */ } }).catch(() => {});
    await page.reload({ waitUntil: "networkidle" }).catch(() => {});
    errors.length = 0;   // 씻기 전 첫 로드의 잡음은 세지 않는다
  }
  await page.waitForTimeout(600);
  return { page, errors };
};
/** 갇힘 안내를 **보이는 대로** 읽는다(있다가 아니라 «보이나»). */
const readStuck = (page) => page.evaluate(() => {
  const els = [...document.querySelectorAll("[data-stuck]")];
  return els.map((el) => { const r = el.getBoundingClientRect();
    return { id: el.getAttribute("data-stuck"), height: r.height, text: (el.innerText || "").replace(/\s+/g, " ").trim(), btn: (el.querySelector("[data-restart]")?.textContent || "").trim() }; });
});
const SCARY = /정지됩니다|불이익|고객님 책임|알려만|실패했|오류가|에러/;

/* ── S1 갇힌 글(507 · 3,299분) — 안내가 보이고 또렷한가 ── */
{
  const { page, errors } = await openPage("/app/pieces.html?mock=1&stuck=1");
  const notes = await readStuck(page);
  const one = notes[0];
  rec("S1 갇힌 글에 안내가 보인다(높이>0 · 페이지 오류 0)", notes.length === 1 && one.height > 0 && errors.length === 0,
    notes.length ? `${notes.length}개 h=${Math.round(one.height)} 오류=${errors.length ? errors.join(" | ") : 0}` : `🔴 0개 · 오류=${errors.join(" | ") || 0}`);
  rec("S1 «몇 분째 · 어느 단계»를 또렷하게 말한다(§9-1)", !!one && /\d+분째/.test(one.text) && one.text.includes("글 쓰는 중"),
    one ? `«${one.text.slice(0, 60)}»` : "🔴 안내 없음");
  rec("S1 «어떻게 하면 되는지»와 «코인 0»을 말한다(§9-4)", !!one && /다시 시작/.test(one.text) && /코인은 더 안 들어요/.test(one.text), one ? `«${one.text.slice(-50)}»` : "");
  rec("S1 겁주는 말 0(§3) — 아직 «실패»가 아니다", !!one && !SCARY.test(one.text), one ? `«${one.text.slice(0, 80)}»` : "");
  rec("S1 «다시 시작» 버튼이 그 자리에 있다(§9-3 되돌릴 길)", one?.btn === "다시 시작", `버튼=«${one?.btn ?? ""}»`);
  /* ⑥ 영상(508)도 만드는 중이지만 서버가 스스로 다시 건다 — 버튼을 두 벌로 만들지 않는다 */
  const vids = await page.evaluate(() => [...document.querySelectorAll("[data-stuck]")].map((e) => e.getAttribute("data-stuck")));
  rec("S1 영상엔 안 단다(508 은 video-sweep 자리)", !vids.includes("508"), `단 곳=${vids.join(",") || "없음"}`);
  await page.close();
}

/* ── S2 눌러 본다 — 202 만 «다시 시작했어요»라고 말한다(AC-9) ── */
{
  const { page, errors } = await openPage("/app/pieces.html?mock=1&stuck=1");
  /* 모의는 UI.api 에서 가로챈다 — 화면이 부르는 그 함수로 먼저 계약을 확인한다(202 인가) */
  const api = await page.evaluate(async () => { try { return await UI.api("/api/pieces-regenerate", { body: { id: 507 } }); } catch (e) { return { err: String(e) }; } });
  rec("S2 모의가 서버 계약대로 202 를 준다(20분↑ 재점화 · 코인 0)", api?.ok === true && api.status === 202, `ok=${api?.ok} status=${api?.status}`);
  await page.close();

  const { page: p2 } = await openPage("/app/pieces.html?mock=1&stuck=1");
  await p2.click("[data-restart]").catch(() => {});
  await p2.waitForTimeout(400);
  const toast = await p2.evaluate(() => (document.querySelector(".toast")?.textContent || "").trim());
  /* 🔴 **시간이 아니라 조건을 기다린다** — 처음엔 400ms 만 재고 «안 사라진다»고 빨갛게 섰는데, 코드는 멀쩡하고 자가 성급했다
     (누르면 API 왕복 + `load()` + 다시 그리기까지 간다). 못 기다리면 아래 단언이 그대로 빨개지므로 **덮는 게 아니다**. */
  await p2.waitForFunction(() => !document.querySelector("[data-stuck]"), null, { timeout: 5000 }).catch(() => {});
  rec("S2 누르면 «다시 시작했어요»라고 말한다", /다시 시작했어요/.test(toast), `토스트=«${toast}»`);
  /* 다시 걸렸으면 모의 시계가 돌기 시작해 안내가 사라진다(«눌렀는데 그대로»가 아니다) */
  const after = await readStuck(p2);
  rec("S2 누른 뒤 갇힘 안내가 사라진다(화면이 따라 움직인다)", after.length === 0, `남은 안내=${after.length}`);
  rec("S2 페이지 오류 0", errors.length === 0, errors.join(" | ") || "0");
  /* 🔴 **숨기는 게 아니라 기다려 주는 것**임을 잰다 — 우리가 건 지 20분이 지나도 여전히 «만드는 중»이면 안내는 돌아와야 한다.
     안 돌아오면 «한 번 누르면 영영 조용한» 화면이 되고, 그건 처음 증상보다 나쁘다(막지도 않으면서 말도 안 한다 · §9). */
  await p2.evaluate(() => { const m = JSON.parse(localStorage.getItem("acPieceRestart") || "{}"); m["507"] = Date.now() - 21 * 60000; localStorage.setItem("acPieceRestart", JSON.stringify(m)); });
  const { page: p3 } = await openPage("/app/pieces.html?mock=1&stuck=1", { fresh: false });
  const back = await readStuck(p3);
  rec("S2 20분이 지나도 그대로면 안내가 정직하게 돌아온다(영구 숨김 0)", back.length === 1, `돌아온 안내=${back.length}`);
  await p3.close(); await p2.close();
}

/* ── S3 거짓 양성 0 — 손잡이가 없으면 안 뜬다 ── */
{
  const { page } = await openPage("/app/pieces.html?mock=1");
  const notes = await readStuck(page);
  rec("S3 갇힌 글이 없으면 안내도 0(거짓 양성 0)", notes.length === 0, `뜬 안내=${notes.length}`);
  await page.close();
}

/* ── S4 상세 화면의 «빈 종이»도 말을 한다 ── */
{
  const { page, errors } = await openPage("/app/piece.html?id=507&mock=1&stuck=1");
  const v = await page.evaluate(() => {
    const vp = document.querySelector("#vpane"); const pv = document.querySelector("#pv");
    return { hidden: vp?.hidden, h: vp ? vp.getBoundingClientRect().height : 0, text: (vp?.innerText || "").replace(/\s+/g, " ").trim(), paper: pv ? !pv.hidden : false };
  });
  rec("S4 상세가 빈 종이 대신 안내를 보여 준다", v.hidden === false && v.h > 0 && v.paper === false && errors.length === 0,
    `hidden=${v.hidden} h=${Math.round(v.h)} 빈종이=${v.paper} 오류=${errors.join(" | ") || 0}`);
  rec("S4 «몇 분째»를 말하고 돌아갈 길을 준다", /\d+분째 만드는 중이에요/.test(v.text) && /만드는 중 보기/.test(v.text), `«${v.text.slice(0, 80)}»`);
  rec("S4 겁주는 말 0(§3)", !SCARY.test(v.text), `«${v.text.slice(0, 80)}»`);
  await page.close();
}

await browser.close(); server.close();
const bad = out.filter((o) => !o.ok);
for (const o of out) console.log(`${o.ok ? "✅" : "🔴"} ${o.step}${o.note ? ` — ${o.note}` : ""}`);
console.log(`\n${out.length - bad.length}/${out.length} 통과`);
process.exit(bad.length ? 1 : 0);
