/**
 * scripts/verify-video-path-flow.mjs — 🔴 **«영상을 켰는데 아무 데도 안 나타난다»가 끝났는지 잰다**
 *   (A · AC-183/184/185 · 2026-09-21 · 사장님 «만들기·편성표에 영상이 없다»)
 *
 *   ══ 이 판의 고장은 하나였다 ══
 *   서버는 **이미 다 됐다** — `lib/director.ts` §1.2 가 «계정 없이 영상 만들기»를 열어 뒀고,
 *   `/api/piece-video`·`/api/post-mark-published` 가 그 영상의 **나가는 문**까지 갖고 있다.
 *   그런데 화면이 `kinds`(설정의 영상 토글)를 **안 봤다**: 만들기는 «영상 채널 계정이 있나»로만 갈랐고,
 *   계정이 0개인 집은 **토글을 켜도 아무 일도 안 났다.** §4.8 로는 없는 기능이다.
 *
 *   ══ 무엇을 재나(세 축) ══
 *     ⑴ 한 번도 안 물어본 집(`kindsSet:false`)에게 **묻는 자리가 있나** — 홈 «해야 할 일» 한 줄 → 시트 → 저장 → 그 줄이 사라지나
 *     ⑵ 만들기가 **계정이 아니라 `kinds`** 를 보나 — 영상 계정 0개(`?oneCh=1`)인데도 영상 줄이 뜨나 · 끄면 사라지나
 *     ⑶ 계정 없이 만든 영상에 **나가는 문이 있나** — «영상 내려받기»·«올린 주소 적기»가 있고, 없는 길(«이대로 예약»)은 없나
 *
 *   ══ ⓪ 자기 찌르기 ══
 *   자를 냈으면 **변이를 넣어 우는지**부터 본다(메인 지시 §4). 정적 서버가 내주는 HTML 에서 한 글자를 바꾸고
 *   그 축이 빨개지는지 본다 — 안 울면 그 축은 처음부터 아무것도 안 재고 있던 것이다.
 *
 *   사용: node scripts/verify-video-path-flow.mjs
 *   종료코드: 0 = 전부 통과 · 1 = 빨강 있음 · 2 = 못 쟀다(playwright 없음 등).
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { requirePlaywright } from "./_lib/find-playwright.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUB = path.join(ROOT, "public");
if (!existsSync(PUB)) { console.error("⊘ 못 쟀어요 — public/ 이 없습니다."); process.exit(2); }

/** ⓪ 자기 찌르기용 — 서버가 그 파일을 내줄 때만 글자를 바꾼다(제품 파일 무접촉). */
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
    if (!s.includes(KILL.from)) KILL.missed = true;   // 🔴 «변이를 못 넣었다»를 여기서 잡는다(AC-112 ①)
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

/* 🔴 끝맺음 말은 사라진다(`UI.done` 1.1초 · `UI.toast` 2.2초) — 뜨는 족족 모아 둔다. */
const open = async (url, quiet) => {
  const pg = await browser.newPage({ viewport: { width: 390, height: 844 } });
  pg.on("pageerror", (e) => { if (!quiet) rec("pageerror", false, String(e.message).slice(0, 140)); });
  await pg.addInitScript(() => {
    window.__acSeen = [];
    const grab = (n) => { if (n && n.nodeType === 1 && (n.classList.contains("done-full") || n.classList.contains("toast"))) window.__acSeen.push((n.innerText || n.textContent || "").trim()); };
    const mo = new MutationObserver((ms) => { for (const m of ms) { m.addedNodes.forEach(grab); if (m.target) grab(m.target.nodeType === 1 ? m.target : m.target.parentElement); } });
    const start = () => { if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true }); else setTimeout(start, 5); };
    start();
  });
  await pg.goto(BASE + url, { waitUntil: "networkidle" });
  await pg.waitForTimeout(900);
  return pg;
};
const txt = (pg) => pg.evaluate(() => document.body.innerText + "\n" + (window.__acSeen || []).join("\n"));

/* ═══ ⑴ 한 번도 안 물어본 집에게 묻나 ═══ */
async function flowAsk(quiet) {
  /* 🔴 `reset=1` 을 붙이면 안 된다 — 저장 뒤 `location.reload()` 가 그 손잡이를 그대로 달고 돌아와 **모의를 다시 씨 뿌린다**
     (첫 판에서 그렇게 헛 울었다 · 자의 흠이지 화면 흠이 아니다). 페이지마다 context 가 새로 뜨므로 reset 없이도 상태는 깨끗하다. */
  const pg = await open("/app/home.html?mock=1&kinds=none", quiet);
  try {
    const row = pg.locator('#todo a[href="#ask-kinds"]');
    const shown = await row.count();
    const step1 = { ok: shown > 0, note: shown ? await row.first().innerText().then((t) => t.replace(/\s+/g, " ").slice(0, 40)) : "그 줄이 없다" };
    if (!shown) return { step1, step2: { ok: false, note: "줄이 없어서 못 물어본다" }, step3: { ok: false, note: "—" } };
    await row.first().click(); await pg.waitForTimeout(700);
    const chips = await pg.locator('[data-chips="kindPick"] .chip').count();
    const step2 = { ok: chips === 2, note: `고를 칸 ${chips}개` };
    if (chips !== 2) return { step1, step2, step3: { ok: false, note: "고를 칸이 없다" } };
    await pg.locator('[data-chips="kindPick"] .chip').nth(1).click(); await pg.waitForTimeout(150);
    await pg.locator("#kpGo").click(); await pg.waitForTimeout(2200);
    const t = await txt(pg);
    /* 🔴 저장 뒤에 **그 줄이 사라져야** 끝낼 수 있는 질문이다(안 사라지면 영영 다시 뜬다). */
    const left = await pg.locator('#todo a[href="#ask-kinds"]').count();
    /* 끝맺음 말(`UI.done`)은 **다시 읽기에 쓸려 간다** — 홈은 부분 갱신 함수가 없어 통째로 다시 읽는 화면이다(home.html 이 그렇게 적어 뒀다).
       그래서 손님 눈에 남는 것으로 잰다: **그 줄이 사라졌나.** */
    return { step1, step2, step3: { ok: left === 0, note: `저장 뒤 그 줄 ${left}개${/만들어 드릴게요/.test(t) ? " · 끝맺음 말도 봤다" : ""}` } };
  } finally { await pg.close(); }
}

/* ═══ ⑵ 만들기가 계정이 아니라 kinds 를 보나 ═══ */
async function flowCreate(quiet) {
  /* `?oneCh=1` = 네이버 계정만 있는 집(사장님 집과 같은 모양) — 영상 채널 계정 0개. */
  const on = await open("/app/create.html?mock=1&oneCh=1&reset=1", quiet);
  let a, b;
  try {
    const vis = await on.locator("#ref").isVisible();
    const say = await on.locator("#wayAiD").innerText();
    a = { ok: vis && /영상/.test(say), note: `영상 줄 ${vis ? "보인다" : "없다"} · «${say.replace(/\s+/g, " ").slice(0, 46)}»` };
  } finally { await on.close(); }
  const off = await open("/app/create.html?mock=1&oneCh=1&kinds=text&reset=1", quiet);
  try {
    const vis = await off.locator("#ref").isVisible();
    const say = await off.locator("#wayAiD").innerText();
    b = { ok: !vis && !/영상/.test(say), note: `끄면 영상 줄 ${vis ? "아직 보인다" : "사라진다"}` };
  } finally { await off.close(); }
  return { a, b };
}

/* ═══ ⑵-b 편성 규칙 — 영상 축이 **왜 없는지**를 말하나 ═══
   🔴 자동 편성은 계정이 있어야 한다(서버 규율) — 그래서 축을 지어내지 않는다. 대신 조용히 빠지지 않게 한 줄을 남긴다.
   🔴 마법사(첫 규칙)와 «한 줄 고치기»(이미 규칙이 있는 집)는 **다른 시트**다 — 손님이 어느 쪽으로 가든 같은 말을 들어야 한다. */
async function flowRuleNote(quiet) {
  const pg = await open("/app/schedule.html?mock=1&oneCh=1&reset=1", quiet);
  try {
    await pg.locator('[aria-label="편성 설정"]').first().click(); await pg.waitForTimeout(700);
    if (!(await pg.locator("#rules").count())) return { ok: false, note: "편성 설정에서 «규칙» 을 못 찾았다" };
    await pg.locator("#rules").click(); await pg.waitForTimeout(800);
    /* 규칙이 이미 있으면 목록 시트가 뜬다 — 거기서 «규칙 추가»로 한 걸음 더 간다. */
    if (await pg.locator('[data-rule="new"]').count()) { await pg.locator('[data-rule="new"]').click(); await pg.waitForTimeout(800); }
    const t = await pg.locator(".sheet-body").first().innerText().catch(() => "");
    return { ok: /영상은 올릴 채널을 연결해야 편성에 들어가요/.test(t), note: t.replace(/\s+/g, " ").split("영상은 올릴")[1] ? "그 한 줄이 있다" : `«${t.replace(/\s+/g, " ").slice(0, 46)}»` };
  } finally { await pg.close(); }
}

/* ═══ ⑶ 계정 없이 만든 영상의 나가는 문 ═══ */
async function flowSelfUpload(quiet) {
  const pg = await open("/app/piece.html?id=510&mock=1&reset=1", quiet);
  try {
    const dl = await pg.locator("#vdlCta").count(), mk = await pg.locator("#vmark").count(), ap = await pg.locator("#approve").count();
    const say = await pg.locator(".self-say").innerText().catch(() => "");
    const step1 = { ok: dl > 0 && mk > 0, note: `내려받기 ${dl} · 주소 적기 ${mk}` };
    /* 🔴 올릴 계정이 없으니 «이대로 예약»은 **없는 길**이다(§9) — 있으면 눌러도 나중에 멈춘다. */
    const step2 = { ok: ap === 0 && /직접/.test(say), note: ap ? "«이대로 예약»이 아직 있다" : `«${say.replace(/\s+/g, " ").slice(0, 52)}»` };
    if (!mk) return { step1, step2, step3: { ok: false, note: "주소 적기가 없다" } };
    await pg.locator("#vmark").click(); await pg.waitForTimeout(700);
    await pg.locator("#mpu").fill("https://youtube.com/shorts/abc123"); await pg.waitForTimeout(100);
    await pg.locator('#mpf button[type="submit"]').click(); await pg.waitForTimeout(1600);
    const t = await txt(pg);
    return { step1, step2, step3: { ok: /올린 글로 적었어요|이미 적어 둔 글/.test(t), note: t.split("\n").filter((l) => /적었어요|적어 둔/.test(l)).slice(0, 1).join("") || "적히지 않았다" } };
  } finally { await pg.close(); }
}

/* ═══ ⓪ 자기 찌르기 ═══ */
console.log(`영상 길 — 물어보나 · 만들기가 kinds 를 보나 · 나가는 문이 있나 · ${new Date().toISOString()}`);
console.log("─".repeat(116));
console.log("⓪ 자기 찌르기 — 🔴 «자를 냈다»가 아니라 «변이를 넣으면 우는가»");
const pokes = [
  ["⓪a 홈에서 그 줄을 안 얹으면 ⑴이 운다", { file: "home.html", from: '#ask-kinds', to: '#zz-gone' }, async (q) => (await flowAsk(q)).step1],
  ["⓪b 만들기가 다시 계정만 보면 ⑵가 운다(고친 그 줄을 되돌린다)", { file: "create.html", from: 'UI.$("#ref").hidden = !wantVideo;', to: 'UI.$("#ref").hidden = !videoAccounts.length;' }, async (q) => (await flowCreate(q)).a],
  ["⓪c 계정 없는 영상에 «이대로 예약»을 되살리면 ⑶이 운다", { file: "piece.html", from: "if (selfUpload()) {", to: "if (false) {" }, async (q) => (await flowSelfUpload(q)).step2],
  ["⓪d 편성 규칙의 한 줄을 지우면 ⑵-b 가 운다", { file: "schedule.html", from: "영상은 올릴 채널을 연결해야", to: "zz 지워진 말" }, flowRuleNote],
];
let pokeBad = 0;
for (const [name, kill, fn] of pokes) {
  KILL = { ...kill };
  let r; try { r = await fn(true); } catch (e) { r = { ok: false, note: `던졌다: ${String(e.message).slice(0, 60)}` }; }
  const missed = KILL.missed; KILL = null;
  const cried = r.ok === false;
  if (missed || !cried) pokeBad++;
  console.log(`  ${missed || !cried ? "✗" : "✓"} ${name}`);
  console.log(`       ${missed ? "🔴 **변이를 못 넣었다**(그 글자가 파일에 없다) — 자를 잰 게 아니다" : cried ? "울었다" : "🔴 **안 울었다** — 이 축은 아무것도 안 재고 있다"} · ${r.note}`);
}
console.log("");

/* ═══ 진짜로 잰다 ═══ */
const A = await flowAsk();
rec("⑴ 한 번도 안 물어본 집 홈에 «영상도 만들어 드릴까요?» 한 줄", A.step1.ok, A.step1.note);
rec("⑴ 그 줄을 누르면 한 화면 한 질문(고를 칸 둘)", A.step2.ok, A.step2.note);
rec("⑴ 답하면 저장되고 **그 줄이 사라진다**(끝낼 수 있는 질문)", A.step3.ok, A.step3.note);
const C = await flowCreate();
rec("⑵ 영상 계정 0개여도 만들기에 영상 줄이 뜬다", C.a.ok, C.a.note);
rec("⑵ 영상을 끄면 그 줄이 사라진다", C.b.ok, C.b.note);
const R = await flowRuleNote(); rec("⑵ 편성 규칙이 «영상 축이 왜 없는지»를 말한다", R.ok, R.note);
const S = await flowSelfUpload();
rec("⑶ 계정 없는 영상에 «내려받기»·«올린 주소 적기»가 있다", S.step1.ok, S.step1.note);
rec("⑶ 없는 길(«이대로 예약»)은 안 낸다 · 왜인지 말한다", S.step2.ok, S.step2.note);
rec("⑶ 주소를 적으면 올린 글로 기록된다", S.step3.ok, S.step3.note);

await browser.close(); server.close();
const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
console.log("■ 흐름");
for (const r of out) console.log(`  ${r.ok ? "✓" : "✗"} ${w(r.step, 48)} ${r.note}`);
const bad = out.filter((r) => !r.ok).length;
console.log("─".repeat(116));
console.log(`PASS ${out.length - bad} · FAIL ${bad} · 자기 찌르기 ${pokes.length - pokeBad}/${pokes.length}`);
console.log("🔴 모의 층 위에서 잰다 — «서버가 그렇게 답하나»는 다른 축이다(그건 B 의 몫).");
process.exit(bad || pokeBad ? 1 : 0);
