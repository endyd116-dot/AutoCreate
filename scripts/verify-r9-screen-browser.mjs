/**
 * scripts/verify-r9-screen-browser.mjs — 🔴 **검수 화면이 «못 낸 서식»을 정말 그리나 — 브라우저로 읽는다**(C · R9-7/R10-9 · 2026-09-16 · 라이브 0).
 *   사용: node scripts/verify-r9-screen-browser.mjs          (정적 서버 4179 · 이 워크트리의 public/ 만 준다)
 *
 *   ══ 왜 «다른 모양의 자»인가 ══
 *   A 의 자(`verify-r9-screens.mjs`)는 장면마다 «켜지고 글자가 보인다»를 스크린샷과 함께 넓게 본다.
 *   이 자는 좁고 진짜로 본다(AC-87): ①`#fmtunused` 가 **hidden=false 이고 높이가 있나** ②칩 글자가 **서버(모의) label 과 글자까지 같나**
 *   ③영어 칸 이름(`underline`·`table`…)·러너 어휘(`url_para`·`budget`…)가 화면에 **한 글자도 안 새나**(AC-91) ④겁주는 말 0(§3)
 *   ⑤fmt 손잡이가 없으면·영상이면 **안 그리나**(거짓 양성) ⑥요금제 «글로 치면 n편»이 **서버 숫자 그대로**인가(AC-74 · 화면 셈 0)
 *   ⑦등급 라벨이 서버 tiers[].label 과 같은가(화면 상수 `UI.TIER_LABEL` 이 서버와 갈리면 두 벌이다 · AC-52).
 *
 *   ══ 자를 먼저 찌른다 ══
 *   AC-90 — 응답에 «이번 글자»(renderFmtUnused)가 있어야 시작한다(옛 서버가 답하면 전부 가짜 초록).
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 4179);
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
await new Promise((ok, bad) => { server.once("error", bad); server.listen(PORT, ok); }).catch((e) => { console.error(`🔴 포트 ${PORT} 를 못 열었다(${e.code}) — 다른 창의 서버가 살아 있다(AC-90)`); process.exit(2); });
{
  const t = await (await fetch(`http://localhost:${PORT}/app/piece.html`)).text();
  if (!t.includes("renderFmtUnused")) { console.error("🔴 응답에 이번 글자(renderFmtUnused)가 없다 — 다른 폴더의 서버이거나 A 의 화면이 아직 없다"); server.close(); process.exit(2); }
}

const pw = await import(pathToFileURL(join(ROOT, "runner", "node_modules", "playwright", "index.mjs")).href);
const browser = await pw.chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, locale: "ko-KR" });
const openPage = async (path) => {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
  await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(500);
  return { page, errors };
};
const readFmt = (page) => page.evaluate(() => {
  const h = document.querySelector("#fmtunused");
  if (!h) return null;
  const r = h.getBoundingClientRect();
  return { hidden: h.hidden, height: r.height, text: (h.innerText || "").replace(/\s+/g, " ").trim(), chips: [...h.querySelectorAll(".chip, [class*=chip]")].map((c) => (c.textContent || "").trim()).filter(Boolean), title: (h.querySelector(".gt")?.textContent || "").trim() };
});
const RAW_KEYS = /\b(underline|table|value|row|italic|bold|line|emoji|quote|checklist|faq|toc|divider|place|affiliate|adsense)\b/;
const WHY_TOKENS = /url_para|budget|caret_drift|block_unsupported|channel_unsupported|range_invalid|too_long|no_editor_op/;
const SCARY = /정지됩니다|불이익|고객님 책임|알려만/;

/* ── S1 fmt 손잡이 · 글 501 ── */
{
  const { page, errors } = await openPage("/app/piece.html?id=501&mock=1&fmt=1");
  const fmt = await readFmt(page);
  /* 모의는 window.fetch 가 아니라 UI.api 에서 가로챈다(mock.js:1526) — 화면이 부르는 그 함수로 읽는다. */
  const mock = await page.evaluate(async () => { try { return await UI.api("/api/pieces-get?id=501"); } catch { return null; } }).catch(() => null);
  const list = ((mock?.piece?.meta || {}).formatUnused || []);
  const expectLabels = [...new Set(list.filter((x) => x.field !== "italic").map((x) => x.label))];
  rec("S1 #fmtunused 가 보인다(hidden=false · 높이>0 · 페이지 오류 0)", !!fmt && fmt.hidden === false && fmt.height > 0 && errors.length === 0, fmt ? `hidden=${fmt.hidden} h=${Math.round(fmt.height)} 제목=«${fmt.title}» 오류=${errors.length ? errors.join(" | ") : 0}` : "🔴 #fmtunused 없음");
  const missing = expectLabels.filter((l) => !(fmt?.text || "").includes(l));
  rec(`S1 칩 글자 = 서버(모의) label 그대로(${expectLabels.length}개 · 기울임 제외)`, expectLabels.length > 0 && missing.length === 0, missing.length ? `🔴 화면에 없음: ${missing.join(",")} · 화면=«${(fmt?.text || "").slice(0, 100)}»` : `${expectLabels.join(" · ")}`);
  rec("S1 영어 칸 이름·러너 어휘가 화면에 안 샌다(AC-91)", !!fmt && !RAW_KEYS.test(fmt.text) && !WHY_TOKENS.test(fmt.text), `«${(fmt?.text || "").slice(0, 140)}»`);
  rec("S1 겁주는 말 0(§3) · «글 내용은 그대로»를 말한다", !!fmt && !SCARY.test(fmt.text) && /내용은 그대로|내용은 그대로예요|글 내용/.test(fmt.text), `«${(fmt?.text || "").slice(60, 200)}»`);
  /* 기울임 — 서버가 사람말 `why` 를 실어 주면 화면은 그 문장을 그대로 쓴다(AC-52 · A 8e6bf29) · why 가 비었을 때만 «일부러 안 넣어요» 폴백. 둘 중 하나가 «기울임» 과 함께 보이면 된다. */
  {
    const it = list.find((x) => x.field === "italic");
    const txt = fmt?.text || "";
    const ok = !it || /일부러 안 넣/.test(txt) || (/기울임/.test(txt) && !!it.why && /[가-힣]/.test(String(it.why)) && txt.includes(String(it.why).slice(0, 12)));
    rec("S1 기울임은 서버 why 문장(사람말) 또는 «일부러 안 넣어요» 폴백으로 말한다", ok, !it ? "모의에 기울임 없음" : ok ? `«${(txt.match(/기울임[^.]*\./) || [""])[0].slice(0, 60)}»` : "🔴 기울임 문장 없음");
  }
  await page.close();
}
/* ── S2 손잡이 없음 → «못 낸 꾸밈» 을 안 그린다(거짓 양성) ── */
{
  const { page } = await openPage("/app/piece.html?id=501&mock=1");
  const fmt = await readFmt(page);
  rec("S2 fmt 손잡이가 없으면 «못 낸 꾸밈»을 그리지 않는다(«올려 봐야 아는 꾸밈»만 허용)", !!fmt && (fmt.hidden || !/못 낸 꾸밈/.test(fmt.title)), fmt ? `hidden=${fmt.hidden} 제목=«${fmt.title}»` : "🔴 #fmtunused 없음");
  await page.close();
}
/* ── S3 영상은 안 그린다 ── */
{
  const { page } = await openPage("/app/piece.html?id=509&mock=1&fmt=1");
  const fmt = await readFmt(page);
  rec("S3 영상 글(509)에는 #fmtunused 를 그리지 않는다", !!fmt && fmt.hidden === true, fmt ? `hidden=${fmt.hidden}` : "🔴 #fmtunused 없음");
  await page.close();
}
/* ── S4 요금제 «글로 치면 n편» = 서버 숫자 · 등급 라벨 = 서버 label ── */
{
  const { page, errors } = await openPage("/app/plan.html?mock=1");
  const data = await page.evaluate(async () => { try { const p = await UI.api("/api/plans"); const a = await UI.api("/api/accounts-list"); return { plans: p.plans || [], tiers: a.tiers || [] }; } catch (e) { return { err: String(e) }; } }).catch((e) => ({ err: String(e) }));
  const text = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ")).catch(() => "");
  if (data.err || !data.plans.length) rec("S4 모의 API(plans · accounts-list)를 페이지 안에서 읽었다", false, data.err || "plans 0");
  else {
    const tierLabel = Object.fromEntries(data.tiers.map((t) => [t.key, t.label]));
    const want = [];
    for (const p of data.plans) for (const [k, v] of Object.entries(p.piecesByTier || {})) want.push(`${tierLabel[k] ?? k} ${Number(v).toLocaleString("ko-KR")}편`);
    const missing = want.filter((s) => !text.includes(s));
    rec(`S4 요금제 «글로 치면» ${want.length}칸이 서버 숫자·서버 등급 라벨 그대로 보인다(AC-74·AC-52)`, want.length > 0 && missing.length === 0 && errors.length === 0, missing.length ? `🔴 화면에 없음: ${missing.slice(0, 4).join(" · ")}` : `${want.slice(0, 3).join(" · ")} …`);
    rec("S4 «최소»라는 말이 요금제 화면에 없다(사장님 — 간단히·보통·프리미엄)", !/최소\s*(등급|퀄리티|품질)/.test(text), "");
  }
  await page.close();
}
/* ── S5 계정 상세 시트의 등급 고르기 = 서버 tiers(라벨·say) ── */
{
  const { page, errors } = await openPage("/app/accounts.html?mock=1");
  const tiers = await page.evaluate(async () => { try { return (await UI.api("/api/accounts-list")).tiers || []; } catch { return []; } }).catch(() => []);
  /* 첫 글 계정 행을 눌러 시트를 연다 — 셀렉터는 «계정 행»이 아니라 **글자**로 찾는다(A 가 구조를 바꿔도 라벨은 남는다) */
  /* 계정 행 = `#list [data-id]` 버튼(→ detailSheet · accounts:1085). 첫 행이 영상 계정이면 등급 줄이 없으니 **글 계정이 나올 때까지** 차례로 눌러 본다. 시트는 뜨기를 기다린다. */
  let opened = false;
  const rows = await page.locator("#list [data-id]").count().catch(() => 0);
  for (let i = 0; i < Math.min(rows, 6) && !opened; i++) {
    await page.locator("#list [data-id]").nth(i).click({ timeout: 2000 }).catch(() => {});
    const ok = await page.locator(".tierpick").first().waitFor({ state: "attached", timeout: 2500 }).then(() => true).catch(() => false);
    if (ok) { opened = true; break; }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
  }
  const chips = await page.evaluate(() => [...document.querySelectorAll('[data-chips="tier"] *')].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean)).catch(() => []);
  const text = chips.join(" | ");
  const labelsOk = tiers.length > 0 && tiers.every((t) => text.includes(t.label));
  const sayOk = tiers.length > 0 && tiers.every((t) => text.includes(String(t.say).slice(0, 12)));
  rec("S5 계정 시트 등급 고르기 — 서버 tiers[].label·say 가 그대로 보인다(화면 상수 0)", opened && labelsOk && sayOk && errors.length === 0,
    !opened ? `🟠 글 계정 시트에 등급 줄(.tierpick)이 안 떴다(행 ${rows}개 시도) — 측정 불가` : `라벨=${labelsOk} 설명=${sayOk} · «${text.slice(0, 120)}»${errors.length ? " 오류 " + errors.join("|") : ""}`);
  await page.close();
}

await browser.close();
server.close();
const w = (x, n) => String(x).padEnd(n);
const fail = out.filter((r) => !r.ok).length;
console.log(`\n검수·요금제·계정 화면 — 브라우저로 읽기(4179) · ${new Date().toISOString()}\n${"─".repeat(126)}`);
for (const r of out) console.log(`  ${r.ok ? "✓" : "✗"} ${w(r.step, 80)} ${r.note}`);
console.log(`${"─".repeat(126)}`);
console.log(fail ? `🔴 실패 ${fail}개` : `✅ ${out.length}축 통과`);
console.log("⚠️ 모의(mock=1) 화면이다 — 라이브 서버가 같은 키를 내는지는 pieces-get 계약(verify-label-surface·deadends)이 지킨다.");
process.exit(fail ? 1 : 0);
