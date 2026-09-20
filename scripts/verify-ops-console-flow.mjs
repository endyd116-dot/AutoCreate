/**
 * scripts/verify-ops-console-flow.mjs — 🔴 **«눌렀더니 일이 일어났나»가 아니라 «끝까지 갔나»**
 *   (A · AC-180/181/182 · 2026-09-21 · 내리기 콘솔 · 전용 IP 콘솔 · 수익 연결)
 *
 *   ══ 왜 이 자가 있나 ══
 *   `verify-hand-on-button` 은 **손이 붙었나**를 잰다 — 눌러서 DOM 이 바뀌면 «일어났다»로 센다.
 *   그런데 이번 판의 세 화면에는 그 자가 **못 보는 자리**가 셋 있다:
 *     ① 두 단계 고르개 — 고객을 고르면 **그 집 계정 칩이 와야** 다음을 누를 수 있다(비동기 · 안 오면 시트가 막다른 골목이다)
 *     ② 되돌리기 어려운 단계 — 확인 한 번 뒤에 **정말 서버로 가나**(확인만 뜨고 끝나도 DOM 은 바뀐다)
 *     ③ 🔴 열쇠가 없을 때의 말 — «곧 열려요»가 아니라 **무엇이 남았고 고객이 할 일이 있는지**를 말하나(메인 지시 · §3)
 *
 *   ══ 🔴 끝맺음 말은 사라진다 ══
 *   `UI.done` 은 1.1초 뒤 스스로 지우고 `UI.toast` 는 2.2초다. 나중에 innerText 를 읽으면 «안 떴다»로 보인다 —
 *   **첫 판에서 실제로 그렇게 세 줄이 헛 울었다**(자의 흠이지 화면 흠이 아니다). ⇒ 뜨는 족족 모아 둔다(MutationObserver).
 *
 *   ══ ⓪ 자기 찌르기 ══
 *   자를 냈으면 **변이를 넣어 우는지**부터 본다(메인 지시 §4). 정적 서버가 내주는 HTML 에서 한 글자를 지우고
 *   그 축이 빨개지는지 본다 — 안 울면 그 축은 처음부터 아무것도 안 재고 있던 것이다.
 *
 *   사용: node scripts/verify-ops-console-flow.mjs
 *   종료코드: 0 = 전부 통과 · 1 = 빨강 있음 · 2 = 못 쟀다(playwright 없음 등).
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { requirePlaywright } from "./lib/find-playwright.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUB = path.join(ROOT, "public");
if (!existsSync(PUB)) { console.error("⊘ 못 쟀어요 — public/ 이 없습니다."); process.exit(2); }

/** ⓪ 자기 찌르기용 — 서버가 그 파일을 내줄 때만 글자를 바꿔 준다(제품 파일 무접촉). */
let KILL = null;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  let p = path.join(PUB, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(PUB)) { res.writeHead(403).end(); return; }
  if (existsSync(p) && statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!existsSync(p)) { res.writeHead(404, { "content-type": "application/json" }).end('{"ok":false,"error":"mock 밖"}'); return; }
  let body = readFileSync(p);
  if (KILL && p.endsWith(KILL.file)) {
    const s = body.toString("utf8");
    if (!s.includes(KILL.from)) KILL.missed = true;            // 🔴 «변이를 못 넣었다»를 여기서 잡는다(AC-112 ①)
    body = Buffer.from(s.split(KILL.from).join(KILL.to), "utf8");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(body);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

const { chromium } = await requirePlaywright();
const browser = await chromium.launch({ headless: true });
const out = [];
const rec = (step, ok, note = "") => { out.push({ step, ok, note }); return ok; };

const open = async (url, onErr) => {
  const pg = await browser.newPage({ viewport: { width: 390, height: 844 } });
  pg.on("pageerror", (e) => (onErr || ((m) => rec("pageerror", false, m)))(String(e.message).slice(0, 140)));
  /* 페이지 스크립트보다 **먼저** 심는다 — init 스크립트는 documentElement 보다도 먼저 도니 있을 때까지 기다린다. */
  await pg.addInitScript(() => {
    window.__acSeen = [];
    const grab = (n) => { if (n && n.nodeType === 1 && (n.classList.contains("done-full") || n.classList.contains("toast"))) window.__acSeen.push((n.innerText || n.textContent || "").trim()); };
    const mo = new MutationObserver((ms) => { for (const m of ms) { m.addedNodes.forEach(grab); if (m.target) grab(m.target.nodeType === 1 ? m.target : m.target.parentElement); } });
    const start = () => { if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true }); else setTimeout(start, 5); };
    start();
  });
  await pg.goto(BASE + url, { waitUntil: "networkidle" });
  await pg.waitForTimeout(800);
  return pg;
};
/** 지금 화면의 글자 + **스쳐 간 끝맺음 말**. */
const txt = (pg) => pg.evaluate(() => document.body.innerText + "\n" + (window.__acSeen || []).join("\n"));

/* ═══ 흐름 — 축마다 «무엇을 보고 통과라 하나»를 한 줄로 돌려준다 ═══ */

/** ① 전용 IP 배정 — 고객 → 그 집 계정 → 배정. 두 단계 고르개가 이 화면의 유일한 비동기 자리다. */
async function flowAssign(quiet) {
  const pg = await open("/ops/proxies.html?mock=1&reset=1", quiet ? () => {} : null);
  try {
    await pg.locator("#list [data-asg]").first().click(); await pg.waitForTimeout(500);
    const before = await pg.locator('[data-chips="pxA2"] .chip').count();
    await pg.locator('[data-chips="pxT"] .chip').first().click(); await pg.waitForTimeout(700);
    const after = await pg.locator('[data-chips="pxA2"] .chip').count();
    const step1 = { ok: before === 0 && after > 0, note: `고르기 전 ${before}개 → 고른 뒤 ${after}개` };
    if (!after) return { step1, step2: { ok: false, note: "계정 칩이 안 와서 다음을 못 누른다" } };
    /* 🔴 모의의 계정 넷 중 셋은 **이미 IP 가 붙어 있다** — 첫 칩만 눌러 보면 «이미 붙어 있어요»가 나오고 그건 화면이 옳게 말한 것이다. */
    let said = "";
    for (let i = 0; i < after; i++) {
      await pg.locator('[data-chips="pxA2"] .chip').nth(i).click(); await pg.waitForTimeout(150);
      await pg.locator("#pxGo").click(); await pg.waitForTimeout(1100);
      said = await txt(pg);
      if (/붙였어요|준비되면 바로 붙여/.test(said)) break;
    }
    return { step1, step2: { ok: /붙였어요|준비되면 바로 붙여/.test(said), note: said.split("\n").filter((l) => /붙였어요|이미 전용 IP|준비되면/.test(l)).slice(0, 2).join(" / ") } };
  } finally { await pg.close(); }
}

/** ② 해제 — 확인 한 번 뒤에 정말 뗀다. */
async function flowRelease(quiet) {
  const pg = await open("/ops/proxies.html?mock=1&reset=1", quiet ? () => {} : null);
  try {
    await pg.locator("#list [data-rel]").first().click(); await pg.waitForTimeout(500);
    await pg.locator("[data-yes]").first().click(); await pg.waitForTimeout(1100);
    const t = await txt(pg);
    return { ok: /뗐어요/.test(t), note: (await pg.locator("#stock .st .v").allInnerTexts()).join(" · ") };
  } finally { await pg.close(); }
}

/** ③ 접수 — 빈 칸은 **그 칸에** 서버 말이 붙고, 채우면 «예약 N건 멈춤»까지 말한다. */
async function flowReceive(quiet) {
  const pg = await open("/ops/takedowns.html?mock=1&reset=1", quiet ? () => {} : null);
  try {
    await pg.locator("#new").click(); await pg.waitForTimeout(600);
    await pg.locator('[data-chips="tdT"] .chip').first().click(); await pg.waitForTimeout(150);
    await pg.locator("#tdGo").click(); await pg.waitForTimeout(800);
    const help = (await pg.locator("#tdReason").evaluate((el) => el.closest(".field").querySelector(".help").textContent)) || "";
    const step1 = { ok: help.length > 0, note: `«${help.slice(0, 44)}»` };
    await pg.locator("#tdReason").fill("사진 두 장이 허락 없이 실렸다는 신고예요.");
    await pg.locator("#tdUrl").fill("https://example.com/p/1");
    await pg.locator("#tdGo").click(); await pg.waitForTimeout(1400);
    const t = await txt(pg);
    return { step1, step2: { ok: /접수했어요/.test(t), note: t.split("\n").filter((l) => /접수했어요/.test(l)).slice(0, 1).join(" / ") } };
  } finally { await pg.close(); }
}

/** ④ 단계 실행 — 대기열에서 열어 «계정 연결 해제»까지(확인 한 번 뒤). */
async function flowEscalate(quiet) {
  const pg = await open("/ops/takedowns.html?mock=1&reset=1", quiet ? () => {} : null);
  try {
    await pg.locator("#due [data-open]").first().click(); await pg.waitForTimeout(600);
    const at = await pg.locator(".steps .st.on").innerText().catch(() => "");
    const btn = pg.locator('[data-act="disconnect"]');
    if (!(await btn.count())) return { ok: false, note: "«계정 연결 해제» 단추가 없다" };
    await btn.click(); await pg.waitForTimeout(300);
    await pg.locator("[data-yes]").first().click(); await pg.waitForTimeout(1400);
    const t = await txt(pg);
    return { ok: /계정 연결을 해제했어요/.test(t), note: `누르기 전 단계 «${at.replace(/\s+/g, " ").slice(0, 24)}»` };
  } finally { await pg.close(); }
}

/** ⑤a 수익 연결 — 🔴 **계정 하나 없이도 밖으로 나간다**(이번 판의 요점). */
async function flowConnect(quiet) {
  const pg = await open("/app/ad-media.html?mock=1", quiet ? () => {} : null);
  try {
    const was = pg.url();
    await pg.locator('#body [data-oauth="adsense"]').click(); await pg.waitForTimeout(600);
    await pg.locator("#oaGo").click(); await pg.waitForTimeout(1500);
    return { ok: pg.url() !== was, note: pg.url().replace(BASE, "") };
  } finally { await pg.close(); }
}

/** ⑤b 열쇠가 없을 때 — 🔴 «곧 열려요»가 아니라 **무엇이 남았고 고객이 할 일이 있는지**. 모의는 유튜브 앱 키가 없다고 둔다. */
async function flowNotConfigured(quiet) {
  const pg = await open("/app/ad-media.html?mock=1", quiet ? () => {} : null);
  try {
    await pg.locator('#body [data-oauth="youtube"]').click(); await pg.waitForTimeout(600);
    await pg.locator("#oaGo").click(); await pg.waitForTimeout(1500);
    const t = await txt(pg);
    const ok = /저희 쪽 준비가 하나 남았어요/.test(t) && /고객님이 하실 일은 없어요/.test(t) && !/곧 열려요/.test(t);
    return { ok, note: t.split("\n").filter((l) => /준비가 하나|하실 일은 없어요/.test(l)).slice(0, 2).join(" / ") };
  } finally { await pg.close(); }
}

/* ═══ ⓪ 자기 찌르기 — 변이를 넣으면 그 축이 우는가 ═══ */
console.log(`끝까지 가나 — 내리기 콘솔 · 전용 IP 콘솔 · 수익 연결 · ${new Date().toISOString()}`);
console.log("─".repeat(116));
console.log("⓪ 자기 찌르기 — 🔴 «자를 냈다»가 아니라 «변이를 넣으면 우는가»");
const pokes = [
  ["⓪a 단계 단추의 손을 떼면 ④가 운다", { file: "takedowns.html", from: 'data-act="', to: 'data-zz="' }, flowEscalate],
  ["⓪b 열쇠 없을 때의 문구를 옛말로 되돌리면 ⑤b 가 운다", { file: "ad-media.html", from: "저희 쪽 준비가 하나 남았어요", to: "곧 열려요" }, flowNotConfigured],
  ["⓪c 계정 칩을 안 그리면 ①이 운다(두 단계 고르개가 끊긴다)", { file: "proxies.html", from: 'UI.chips("pxA2"', to: 'String("pxA2"' }, flowAssign],
];
let pokeBad = 0;
for (const [name, kill, fn] of pokes) {
  KILL = { ...kill };
  let r;
  try { r = await fn(true); } catch (e) { r = { ok: false, note: `던졌다: ${String(e.message).slice(0, 60)}` }; }
  const first = r.step1 ? r.step1 : r;               // ⓪c 는 ①의 첫 축을 본다
  const missed = KILL.missed;
  KILL = null;
  const cried = first.ok === false;
  if (missed || !cried) pokeBad++;
  console.log(`  ${missed ? "✗" : cried ? "✓" : "✗"} ${name}`);
  console.log(`       ${missed ? "🔴 **변이를 못 넣었다**(그 글자가 파일에 없다) — 자를 잰 게 아니다" : cried ? "울었다" : "🔴 **안 울었다** — 이 축은 아무것도 안 재고 있다"} · ${first.note}`);
}
console.log("");

/* ═══ 진짜로 잰다 ═══ */
const a = await flowAssign(); rec("① 고객을 고르면 그 집 계정 칩이 온다", a.step1.ok, a.step1.note); rec("① 끝까지 — «배정»을 누르면 붙었다고 말한다", a.step2.ok, a.step2.note);
const b = await flowRelease(); rec("② 해제 — 확인 뒤에 정말 뗀다", b.ok, b.note);
const c = await flowReceive(); rec("③ 사유를 비우면 **그 칸**에 서버 말이 붙는다", c.step1.ok, c.step1.note); rec("③ 끝까지 — 접수하면 «예약 N건 멈춤»까지 말한다", c.step2.ok, c.step2.note);
const d = await flowEscalate(); rec("④ 단계 실행 — 확인 뒤 «계정 연결을 해제했어요»", d.ok, d.note);
const e = await flowConnect(); rec("⑤a 애드센스 — 계정 없이도 밖으로 나간다", e.ok, e.note);
const f = await flowNotConfigured(); rec("⑤b 열쇠가 없을 때 — 무엇이 남았는지·할 일이 없는지 말한다", f.ok, f.note);

await browser.close(); server.close();
const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
console.log("■ 흐름");
for (const r of out) console.log(`  ${r.ok ? "✓" : "✗"} ${w(r.step, 46)} ${r.note}`);
const bad = out.filter((r) => !r.ok).length;
console.log("─".repeat(116));
console.log(`PASS ${out.length - bad} · FAIL ${bad} · 자기 찌르기 ${pokes.length - pokeBad}/${pokes.length}`);
console.log("🔴 모의 층 위에서 잰다 — «서버가 그렇게 답하나»는 다른 축이다(그건 B 의 몫).");
process.exit(bad || pokeBad ? 1 : 0);
