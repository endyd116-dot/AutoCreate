/**
 * scripts/verify-r20.mts — 🔴 **R20 «작은 화면 수리 묶음»을 다른 모양의 자로 잰다**(C · 2026-09-28 · 트리거 R20 §0-E)
 *
 *   ══ 축 ══
 *     · slot.seconds     — 🔴 메인 넓힘(09-28): «편성 화면(slotRow · 규칙 만들기 · 규칙 줄 · perPiece)이 영상 길이·영상 코인을 **서버 값에서** 읽나».
 *                           글자 «· 60초» 로 세지 않는다(«60초 쇼츠» 같은 정당한 말에 헛빨강 — A 지적).
 *                           ㉮ `--db`: 라이브 DB 시드 집(설정 videoSeconds=30)에서 진짜 `listSlots` — 영상 자리마다 `videoSeconds` = 견적과 **같은 함수**
 *                              (`estimateVideoSeconds`) · 지난 자리도 싣는다 · 글 자리엔 없다 · 그 자리의 코인 견적이 **같은 초**로 셈된다
 *                           ㉯ `--screen`: 🔴 **서버가 30초라 말하면 화면이 30초라 하나**(차분 시험) — `UI.api` 응답을 30초로 바꿔 끼우고
 *                              편성표를 그린다 → «30초»·30초 코인이 보이고 «60초»·60초 코인은 안 보여야 한다. 대조군(안 바꾼 판)도 같이 그린다.
 *     · threads.word     — 고객 표면(서버 코드의 글자 · ui.js · mock*.js · _tpl 두 벌)에 «스레드» 0(주석 제외) + `channelLabelKo("threads")` = «쓰레드»
 *                           + `--screen`: 쓰레드가 그려지는 화면 둘의 **보이는 글자**에 «스레드» 0 · «쓰레드» ≥1
 *     · health.fit       — `--screen`: 계정 상세 «건강 점수» 줄을 **기하로** — 이름 한 줄 · «N점 · 말» 한 줄 · 단추 한 줄 · 시트 안 · 넘침 0 (1280 · 400)
 *     · mock.covered     — 서버 `director.ts` 의 `step:"covered"` 문장과 모의 `pieces-remake` 의 같은 갈래 문장이 **글자 그대로**(`${…}` 만 빼고)
 *     · mock.internal    — 모의 `ops-tenants` 가 서버 모양(`internal:{excluded,hidden}` · internal=1 이면 excluded:false·hidden:0)을 싣고,
 *                           `--screen`: 운영 «고객 붙이기»·고객 목록이 «내부로 표시된 N곳은 빠져 있어요»를 **실제로 그린다**(R19 C 의 ⊘ 를 닫는다)
 *   💰 돈 축은 체인(`gate-parallel`)이 앞뒤로 센다.
 *
 *   ══ 지키는 셋(R19 자와 같다) ══ ① 과녁부터 센다(없으면 ⊘ · AC-236) ② 대조군을 같이 그린다(눈먼 초록 금지) ③ 네트워크 0(브라우저는 로컬 정적 서버 · 모의)
 *   ══ stdout 의 주인 ══ `verify-r20-mutants.mjs` 가 종료코드 + 줄머리 `[축]` 을 읽는다.
 *
 *   쓰는 법:  npx tsx scripts/verify-r20.mts [--db] [--screen]
 *   🔴 제품 경로는 작업 폴더(`cwd`) 기준(변이 하니스가 사본에서 돌린다).
 *   종료코드: 0 = 전부 ✅ · 1 = ❌ 있음 · 2 = ⊘ 있고 ❌ 없음.
 */
import "./_lib/load-env.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.cwd();
const ARGS = new Set(process.argv.slice(2));
type V = "pass" | "fail" | "unmeasured";
type Row = Record<string, any>;
const lines: { v: V; axis: string }[] = [];
const icon = (v: V) => (v === "pass" ? "✅" : v === "fail" ? "❌" : "⊘");
const rec = (axis: string, step: string, v: V, note = "") => { lines.push({ v, axis }); console.log(`${icon(v)} [${axis}] ${step}${note ? `  — ${note}` : ""}`); return v; };
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
const read = (rel: string) => { try { return readFileSync(path.join(ROOT, rel), "utf8"); } catch { return null; } };
const noHtmlComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "");
/** `_tpl.txt` 에서 한 화면 덩이(`=== 파일 | …` 부터 다음 `=== ` 앞까지). */
const pageBlock = (tpl: string, file: string) => { const i = tpl.indexOf(`=== ${file} `); if (i < 0) return null; const j = tpl.indexOf("\n=== ", i + 4); return tpl.slice(i, j < 0 ? undefined : j); };

/* ═══ threads.word — 고객 표면의 «스레드» 0 ═══ */
{
  const OLD = "스레드", NEW = "쓰레드";
  const hits: string[] = [];
  let files = 0;
  const walk = (dir: string, re: RegExp) => {
    const abs = path.join(ROOT, dir); if (!existsSync(abs)) return;
    for (const e of readdirSync(abs)) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      const rel = `${dir}/${e}`; const st = statSync(path.join(ROOT, rel));
      if (st.isDirectory()) walk(rel, re);
      else if (re.test(e)) {
        files++;
        const code = codeOnly(noHtmlComments(readFileSync(path.join(ROOT, rel), "utf8"))).split("\n");
        code.forEach((ln: string, i: number) => { if (ln.includes(OLD)) hits.push(`${rel}:${i + 1}`); });
      }
    }
  };
  walk("lib", /\.ts$/); walk("netlify/functions", /\.ts$/); walk("public/js", /\.js$/);
  for (const t of ["public/app/_tpl.txt", "public/ops/_tpl.txt"]) {
    const s = read(t); if (s === null) continue; files++;
    codeOnly(noHtmlComments(s)).split("\n").forEach((ln: string, i: number) => { if (ln.includes(OLD)) hits.push(`${t}:${i + 1}`); });
  }
  rec("threads.word", `🔴 고객 표면에 «${OLD}» 0(주석 제외 · 파일 ${files}개 — lib · netlify/functions · public/js · _tpl 두 벌)`, hits.length ? "fail" : "pass", hits.slice(0, 6).join(" · ") || "0곳");
  try {
    const cu = await imp("lib/channel-url.ts");
    const lab = typeof cu.channelLabelKo === "function" ? String(cu.channelLabelKo("threads")) : null;
    rec("threads.word", "`channelLabelKo(\"threads\")` = «쓰레드»(서버가 고객 문장에 넣는 이름)", lab === null ? "unmeasured" : lab === NEW ? "pass" : "fail", lab === null ? "과녁 없음" : `«${lab}»`);
  } catch (e) { rec("threads.word", "channel-url 을 못 불렀다", "unmeasured", String((e as Error)?.message ?? e).slice(0, 120)); }
  const mock = read("public/js/mock.js") ?? "";
  const mockThreads = [...codeOnly(mock).matchAll(/threads:\s*"([^"]+)"/g)].map((m) => m[1]);
  rec("threads.word", "모의 표(`CH_LABEL` · `LABEL_KO` …)의 threads 이름이 전부 «쓰레드»", !mockThreads.length ? "unmeasured" : mockThreads.every((x) => x === NEW) ? "pass" : "fail", mockThreads.map((x) => `«${x}»`).join(" · ") || "과녁 없음");
}

/* ═══ slot.seconds (정적 겹) — 편성 화면 코드가 영상 길이·코인을 박지 않는다 ═══ */
{
  const tpl = read("public/app/_tpl.txt") ?? "";
  const blk = pageBlock(tpl, "schedule.html");
  if (!blk) rec("slot.seconds", "편성 화면 덩이", "unmeasured", "_tpl.txt 에 `=== schedule.html` 이 없다");
  else {
    const code = codeOnly(noHtmlComments(blk));
    /* 박힌 값: 영상 코인 60 칸을 직접 집는 것 · 영상 길이 «60초»를 글자로 적는 것(«60초 쇼츠» 포함 — 서버 값이면 `${…}초` 가 된다) */
    const pinned = [...code.matchAll(/VIDEO_COIN\[\s*60\s*\]|video_60|["'`][^"'`\n]*\b60초/g)].map((m) => m[0].slice(0, 30));
    rec("slot.seconds", "🔴 편성 화면 코드가 영상 60초·60초 코인을 **박지 않는다**(slotRow · 규칙 만들기 · 규칙 줄 · perPiece)", pinned.length ? "fail" : "pass", pinned.length ? `${pinned.length}곳: ${pinned.slice(0, 4).join(" | ")}` : "0곳");
    const reads = ["videoSeconds", "videoSecondsByChannel"].map((k) => [k, new RegExp(`\\b${k}\\b`).test(code)] as const);
    rec("slot.seconds", "편성 화면이 서버 키를 읽는다(`videoSeconds` · `videoSecondsByChannel`)", reads.every(([, ok]) => ok) ? "pass" : "unmeasured", reads.map(([k, ok]) => `${k} ${ok ? "○" : "×"}`).join(" · "));
  }
  const slotsSrc = codeOnly(read("lib/slots.ts") ?? "");
  const sets = /\bo\.videoSeconds\s*=\s*estimateVideoSeconds\(/.test(slotsSrc);
  rec("slot.seconds", "서버 `listSlots` 가 `videoSeconds` 를 견적과 같은 함수(`estimateVideoSeconds`)로 싣는다(글자 겹 — 동작은 --db 가 잰다)", sets ? "pass" : "unmeasured", sets ? "" : "과녁 없음(B 머지 전)");
}

/* ═══ mock.covered — 서버 문장 = 모의 문장(글자 그대로) ═══ */
{
  const norm = (s: string) => s.replace(/\$\{[^}]*\}/g, "{}");
  const srv = (read("lib/director.ts") ?? "").match(/step:\s*"covered",\s*error:\s*`([^`]+)`/);
  const mock = (read("public/js/mock.js") ?? "").match(/["']covered["']\s*,\s*`([^`]+)`|step:\s*["']covered["'][^`]*`([^`]+)`/);
  const mText = mock ? (mock[1] ?? mock[2]) : null;
  if (!srv) rec("mock.covered", "서버 covered 문장", "unmeasured", "과녁 없음 — lib/director.ts 에 step:\"covered\"");
  else if (!mText) rec("mock.covered", "모의 `pieces-remake` 의 covered 갈래 = 서버 글자", "unmeasured", "모의에 covered 갈래가 없다(A 머지 전)");
  else rec("mock.covered", "🔴 모의 `pieces-remake` 의 covered 갈래 = 서버 글자 그대로(`${…}` 만 뺀다)", norm(mText) === norm(srv[1]) ? "pass" : "fail", norm(mText) === norm(srv[1]) ? `«${norm(srv[1]).slice(0, 50)}…»` : `서버 «${norm(srv[1])}» · 모의 «${norm(mText)}»`);
}

/* ═══ mock.internal (글자 겹) — 모의 ops-tenants 가 `internal` 칸을 싣나 ═══ */
{
  const mo = read("public/js/mock-ops.js") ?? "";
  const i = mo.indexOf('"ops-tenants"'); const blk = i < 0 ? "" : mo.slice(i, mo.indexOf("\n    \"", i + 10) > 0 ? mo.indexOf("\n    \"", i + 10) : i + 1500);
  rec("mock.internal", "모의 `ops-tenants` 가 `internal:{excluded,hidden}` 을 싣는다(서버 ops-tenants.ts:83 모양)", !blk ? "unmeasured" : /internal\s*:\s*\{/.test(blk) && /excluded/.test(blk) && /hidden/.test(blk) ? "pass" : "unmeasured", blk ? "" : "과녁 없음");
}

/* ═══ --screen — 브라우저(로컬 정적 서버 · 모의 · 라이브 0) ═══ */
if (ARGS.has("--screen")) {
  try {
    const { requirePlaywright } = await import("./_lib/find-playwright.mjs");
    const { chromium } = await requirePlaywright();
    const { createServer } = await import("node:http");
    const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
    const srv = createServer((req, res) => {
      let f = path.join(ROOT, "public", decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
      if (existsSync(f) && statSync(f).isDirectory()) f = path.join(f, "index.html");
      if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream" }); res.end(readFileSync(f));
    });
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", () => ok()));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const browser = await chromium.launch();
    /** 🔴 tsx(esbuild)가 이름 붙은 함수에 `__name(…)` 을 끼워 넣는다 — 브라우저엔 그 도우미가 없어 `page.evaluate` 가 던진다. 쪽마다 빈 도우미를 먼저 심는다. */
    const newPage = async (o?: Record<string, unknown>) => { const pg = await browser.newPage(o); await pg.addInitScript("globalThis.__name = (f) => f;"); return pg; };
    /** 글이 멈출 때까지(0.6초 동안 길이 그대로 · 최대 12초) 기다린다. */
    const settle = async (pg: any) => { let last = -1, t = ""; for (let i = 0; i < 20; i++) { t = await pg.evaluate(() => document.body.innerText); if (t.length === last) break; last = t.length; await pg.waitForTimeout(600); } return t; };
    /** 🔴 `UI.api` 를 **덮어쓰는 순간** 감싼다 — ui.js 도 모의도 `UI.api = …` 로 넣으니 둘 다 걸린다. 바꿀 것: 편성표 응답의 영상 길이. */
    const TRAP = (sec: number) => `(() => { const SEC = ${sec}; const ui = window.UI = window.UI || {}; let inner;
      const bend = (p, r) => { try {
        if (!r || typeof r !== "object") return r;
        if (/\\/api\\/slots-list/.test(p) && Array.isArray(r.slots)) for (const s of r.slots) if (s && s.kind === "shorts") { s.videoSeconds = SEC; window.__r20bent = (window.__r20bent || 0) + 1; }
        if (/\\/api\\/rules-list/.test(p) && r.videoSecondsByChannel && typeof r.videoSecondsByChannel === "object") { for (const k of Object.keys(r.videoSecondsByChannel)) r.videoSecondsByChannel[k] = SEC; window.__r20bent = (window.__r20bent || 0) + 1; }
      } catch (e) {} return r; };
      Object.defineProperty(ui, "api", { configurable: true, get() { return inner; }, set(fn) { inner = async (p, o) => bend(String(p), await fn(p, o)); } }); })();`;

    /* ── slot.seconds ㉯ — 서버가 30초라 말하면 화면도 30초 ── */
    {
      const coin = async (pg: any, s: number) => pg.evaluate((x: number) => (window as any).UI?.VIDEO_COIN?.[x], s);
      const draw = async (sec: number | null) => {
        const pg = await newPage({ viewport: { width: 1280, height: 900 } });
        if (sec !== null) await pg.addInitScript(TRAP(sec));
        await pg.goto(`${base}/app/schedule.html?mock=1`); let t = await settle(pg);
        /* 규칙 줄(설정 시트) · 규칙 목록/만들기까지 연다 — 편당 코인·«N초 쇼츠»는 거기 있다 */
        for (const sel of ["#sideRules", "#rules"]) { const el = await pg.$(sel); if (el) { await el.click().catch(() => {}); await pg.waitForTimeout(700); t += " | " + (await settle(pg)); } }
        const bent = await pg.evaluate(() => (window as any).__r20bent || 0);
        const c30 = await coin(pg, 30), c60 = await coin(pg, 60);
        await pg.close(); return { t, bent, c30, c60 };
      };
      const ctl = await draw(null), b30 = await draw(30);
      const n60 = (t: string) => (t.match(/60초/g) || []).length, n30 = (t: string) => (t.match(/30초/g) || []).length;
      rec("slot.seconds", "화면 대조군(안 바꾼 모의) — 편성표가 영상 길이를 **말하기는** 한다", n60(ctl.t) + n30(ctl.t) > 0 ? "pass" : "unmeasured", `«60초» ${n60(ctl.t)} · «30초» ${n30(ctl.t)}`);
      if (!b30.bent) rec("slot.seconds", "🔴 서버가 30초라 말하면 화면도 30초(차분)", "unmeasured", "바꿔 낄 서버 키가 응답에 없다(`slots[].videoSeconds` · `videoSecondsByChannel` — B·A 머지 전)");
      else {
        const leak60 = n60(b30.t), say30 = n30(b30.t);
        rec("slot.seconds", "🔴 서버가 30초라 말하면 화면도 30초 — «60초» 0 · «30초» ≥1(차분 · slotRow · 규칙 만들기 · 규칙 줄)", leak60 === 0 && say30 > 0 ? "pass" : "fail", `바꾼 응답 ${b30.bent} · «60초» ${leak60} · «30초» ${say30}`);
        const coinLeak = b30.c60 != null && b30.c30 !== b30.c60 ? (b30.t.match(new RegExp(`편당 ${b30.c60}코인`, "g")) || []).length : 0;
        const coinSay = b30.c30 != null ? (b30.t.match(new RegExp(`편당 ${b30.c30}코인`, "g")) || []).length : 0;
        rec("slot.seconds", "🔴 영상 편당 코인도 서버 길이를 따른다 — 30초면 30초 코인(perPiece)", coinLeak === 0 && coinSay > 0 ? "pass" : coinSay === 0 && coinLeak === 0 ? "unmeasured" : "fail", `«편당 ${b30.c30}코인» ${coinSay} · «편당 ${b30.c60}코인» ${coinLeak}`);
      }
    }

    /* ── threads.word — 보이는 글자 ── */
    {
      let seenNew = 0; const leak: string[] = [];
      for (const u of ["/app/settings.html?mock=1&vr=on", "/app/piece.html?mock=1&id=509&vr=on"]) {
        const pg = await newPage(); await pg.goto(base + u); const t = await settle(pg); await pg.close();
        seenNew += (t.match(/쓰레드/g) || []).length; if (t.includes("스레드")) leak.push(u);
      }
      rec("threads.word", "🔴 화면 — 쓰레드가 그려지는 화면 둘의 보이는 글자에 «스레드» 0 · «쓰레드» ≥1", leak.length ? "fail" : seenNew ? "pass" : "unmeasured", leak.length ? `«스레드»: ${leak.join(" · ")}` : `«쓰레드» ${seenNew}곳`);
    }

    /* ── health.fit — 기하 ── */
    for (const [w, h] of [[1280, 900], [400, 860]] as const) {
      const pg = await newPage({ viewport: { width: w, height: h } });
      await pg.goto(`${base}/app/accounts.html?mock=1`); await settle(pg);
      await pg.click('[data-id="1"]').catch(() => {}); await pg.waitForTimeout(900); await settle(pg);
      const m = await pg.evaluate(() => {
        const kv = Array.from(document.querySelectorAll(".kv")).find((e) => (e.querySelector(".k")?.textContent || "").trim() === "건강 점수") as HTMLElement | undefined;
        if (!kv) return null;
        const linesOf = (nodes: Node[]) => { const ys = new Set<number>(); for (const n of nodes) { const rg = document.createRange(); rg.selectNodeContents(n); for (const r of Array.from(rg.getClientRects())) if (r.width > 0) ys.add(Math.round(r.top)); } return ys.size; };
        const k = kv.querySelector(".k")!, v = kv.querySelector(".v") as HTMLElement | null, b = kv.querySelector("#hre") as HTMLElement | null;
        /* «N점 · 말» = 값 칸에서 단추를 뺀 글자 */
        const valNodes: Node[] = []; const walk = (n: Node) => { if (n === b) return; if (n.nodeType === 3 && (n.textContent || "").trim()) valNodes.push(n); n.childNodes.forEach(walk); }; if (v) walk(v);
        let box: HTMLElement | null = kv.parentElement; while (box && box !== document.body && getComputedStyle(box).overflowY === "visible") box = box.parentElement;
        const br = box?.getBoundingClientRect(), bb = b?.getBoundingClientRect();
        return { kLines: linesOf([k]), vLines: linesOf(valNodes), vText: valNodes.map((x) => x.textContent).join("").trim(), bLines: b ? linesOf([b]) : 0,
          bInside: !!(br && bb && bb.left >= br.left - 1 && bb.right <= br.right + 1), overflow: kv.scrollWidth - kv.clientWidth, width: Math.round(kv.getBoundingClientRect().width) };
      });
      await pg.close();
      if (!m) { rec("health.fit", `${w}px — «건강 점수» 줄`, "unmeasured", "줄을 못 찾았다(모의 계정 1 · 상세)"); continue; }
      const ok = m.kLines === 1 && m.vLines === 1 && m.bLines === 1 && m.bInside && m.overflow <= 0;
      rec("health.fit", `🔴 ${w}px — «건강 점수» 한 줄 · «${m.vText}» 한 줄 · «다시 재기» 한 줄 · 시트 안 · 넘침 0`, ok ? "pass" : "fail",
        `이름 ${m.kLines}줄 · 값 ${m.vLines}줄 · 단추 ${m.bLines}줄 · 단추 시트 안 ${m.bInside ? "○" : "×"} · 넘침 ${m.overflow}px · 줄 폭 ${m.width}px`);
    }

    /* ── mock.internal — 운영 화면이 «N곳 빠져 있어요»를 실제로 그린다 ── */
    {
      const pg = await newPage({ viewport: { width: 1280, height: 900 } });
      await pg.goto(`${base}/ops/cs.html?mock=1`); await settle(pg);
      const shape = await pg.evaluate(async () => {
        const U = (window as any).UI; if (!U?.api) return null;
        const a = await U.api("/api/ops-tenants?q=&size=20", { noRedirect: true }), b = await U.api("/api/ops-tenants?q=&size=20&internal=1", { noRedirect: true });
        return { a: a?.internal ?? null, b: b?.internal ?? null, na: (a?.tenants || []).length, nb: (b?.tenants || []).length };
      });
      const shapeOk = !!shape && shape.a && shape.a.excluded === true && Number(shape.a.hidden) > 0 && shape.b && shape.b.excluded === false && Number(shape.b.hidden) === 0 && shape.nb >= shape.na + Number(shape.a.hidden);
      rec("mock.internal", "🔴 모의 ops-tenants — 기본은 {excluded:true, hidden>0} · internal=1 이면 {excluded:false, hidden:0} · 숨긴 수만큼 목록이 는다", !shape || (!shape.a && !shape.b) ? "unmeasured" : shapeOk ? "pass" : "fail", JSON.stringify(shape));
      let drawn = "";
      const claim = await pg.$("[data-claim]");
      if (claim) { await claim.click(); await pg.waitForSelector("#cq").catch(() => {}); await pg.waitForTimeout(900); drawn = await pg.evaluate(() => (document.querySelector("#chid") as HTMLElement | null)?.hidden ? "" : (document.querySelector("#chid")?.textContent || "").trim()); }
      rec("mock.internal", "🔴 화면 — 운영 «고객 붙이기» 찾기가 «내부로 표시된 N곳은 빠져 있어요»를 그린다(R19 C 의 ⊘ 를 닫는다)", !claim ? "unmeasured" : /내부로 표시된 \d+곳/.test(drawn) ? "pass" : shapeOk ? "fail" : "unmeasured", claim ? `«${drawn.slice(0, 40)}»` : "모의에 주인 없는 문의가 없다");
      await pg.close();
    }
    await browser.close(); srv.close();
  } catch (e) {
    rec("slot.seconds", "화면 겹을 못 쟀다", "unmeasured", String((e as Error)?.message ?? e).slice(0, 200));
  }
}

/* ═══ --db — slot.seconds ㉮ 진짜 listSlots ═══ */
if (ARGS.has("--db")) {
  const slotsSrc = codeOnly(read("lib/slots.ts") ?? "");
  if (!/videoSeconds/.test(slotsSrc.slice(slotsSrc.indexOf("export async function listSlots")))) rec("slot.seconds", "라이브 DB — listSlots 의 videoSeconds", "unmeasured", "과녁 없음(B 머지 전)");
  else {
    const { pgClient: sql } = await imp("db/index.ts") as { pgClient: any };
    const slots = await imp("lib/slots.ts"), wc = await imp("lib/writing-contracts.ts"), ct = await imp("lib/coin-table.ts");
    const { teardownRun } = await import("./_teardown.mjs");
    const made: number[] = [];
    try {
      const WANT = 30;
      const [t] = await sql`INSERT INTO tenants (key, name, plan_key, status, is_internal, settings) VALUES (${`r20c-${Date.now().toString(36)}`}, ${"R20 C 편성 영상 길이 자"}, 'pro', 'active', true, ${sql.json({ videoSeconds: WANT })}) RETURNING id` as Row[];
      const tid = Number(t.id); made.push(tid);
      const [chk] = await sql`SELECT jsonb_typeof(settings) AS ty, settings->>'videoSeconds' AS vs FROM tenants WHERE id = ${tid}` as Row[];
      const [d] = await sql`SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date + 2, 'YYYY-MM-DD') AS fut, to_char((now() AT TIME ZONE 'Asia/Seoul')::date - 1, 'YYYY-MM-DD') AS past, to_char((now() AT TIME ZONE 'Asia/Seoul')::date - 3, 'YYYY-MM-DD') AS lo, to_char((now() AT TIME ZONE 'Asia/Seoul')::date + 5, 'YYYY-MM-DD') AS hi` as Row[];
      const ins = async (date: string, channel: string, kind: string, status: string) => Number((await sql`INSERT INTO slots (tenant_id, slot_date, channel, kind, status, origin) VALUES (${tid}, ${date}::date, ${channel}, ${kind}, ${status}, 'manual') RETURNING id` as Row[])[0].id);
      const sFut = await ins(d.fut, "youtube_shorts", "shorts", "planned"), sPast = await ins(d.past, "reels", "shorts", "published"), sPost = await ins(d.fut, "naver_blog", "post", "planned");
      const list = await slots.listSlots(tid, d.lo, d.hi) as Row[];
      const by = (id: number) => list.find((x) => Number(x.id) === id);
      const f = by(sFut), p = by(sPast), g = by(sPost);
      rec("slot.seconds", "시드 설정이 jsonb 로 앉았다(PITFALLS #1)", chk.ty === "object" && Number(chk.vs) === WANT ? "pass" : "unmeasured", `${chk.ty} · videoSeconds ${chk.vs}`);
      const eF = Number(wc.estimateVideoSeconds("youtube_shorts", WANT)), eP = Number(wc.estimateVideoSeconds("reels", WANT));
      rec("slot.seconds", `🔴 라이브 DB — 다가올 영상 자리의 videoSeconds = estimateVideoSeconds(쇼츠, ${WANT}) = ${eF}`, f && Number(f.videoSeconds) === eF ? "pass" : "fail", `받은 ${f?.videoSeconds}`);
      rec("slot.seconds", "🔴 지난(나간) 영상 자리도 길이를 싣는다(pw 가지 밖)", p && Number(p.videoSeconds) === eP ? "pass" : "fail", `받은 ${p?.videoSeconds} · 기대 ${eP}`);
      rec("slot.seconds", "글 자리엔 videoSeconds 키가 없다(지어내지 않는다)", g && !("videoSeconds" in g) ? "pass" : "fail", g ? JSON.stringify(Object.keys(g).filter((k) => /second/i.test(k))) : "글 자리를 못 받았다");
      if (f && f.coinCost != null && typeof ct.pieceCoinCost === "function") {
        const want = ct.pieceCoinCost("shorts", wc.estimateAiImagesFor("youtube_shorts", f.tier), { format: wc.coinFormatOf("youtube_shorts"), seconds: Number(f.videoSeconds), tier: f.tier });
        rec("slot.seconds", "🔴 그 자리의 «지금 만들기» 코인 = 같은 초로 셈한 값(길이와 견적이 한 함수)", Number(f.coinCost) === Number(want) ? "pass" : "fail", `coinCost ${f.coinCost} · ${f.videoSeconds}초로 셈 ${want}`);
      } else rec("slot.seconds", "그 자리의 코인 견적 = 같은 초", "unmeasured", "coinCost 가 안 실렸다(만들기 창 밖)");
    } catch (e) {
      rec("slot.seconds", "라이브 DB 팔이 던졌다", "unmeasured", String((e as Error)?.message ?? e).slice(0, 200));
    } finally {
      const note = await teardownRun(sql, { tenants: made, label: "R20 C" });
      rec("slot.seconds", "시드 집 치우기(teardown)", note.failed ? "fail" : "pass", note.text);
      await sql.end({ timeout: 5 }).catch(() => {});
    }
  }
}

/* ═══ 끝 ═══ */
const cnt = (v: V) => lines.filter((l) => l.v === v).length;
console.log(`\n■ ✅ ${cnt("pass")} · ❌ ${cnt("fail")} · ⊘ ${cnt("unmeasured")}  (줄 ${lines.length})`);
if (cnt("unmeasured")) console.log("   🔴 ⊘ 는 «못 쟀다»다 — 통과가 아니다(AC-9).");
process.exit(cnt("fail") ? 1 : cnt("unmeasured") ? 2 : 0);
