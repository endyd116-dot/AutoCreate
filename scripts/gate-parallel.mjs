/**
 * scripts/gate-parallel.mjs — 🔴 **배포 체인을 나눠 돌린다**(C · 2026-09-27 · R19 C0 · PARALLEL_GUIDE §2.9 ③)
 *
 *   ══ 왜 ══
 *   배포 전 관문(자)을 한 폴더에서 차례로 돌리면 ≈60분이다(AM 실측 · AC 는 R18 에 C 최종만 ≈25분×2).
 *   관문을 **깨끗한 분리 워크트리 셋**(`C:/tmp/ac-gate-1..3`)에 나눠 **병렬**로 돌리고 결과를 합친다 → ≈20분 목표.
 *   🔴 **C 초록 없이는 push 0**(§2.9 ④) — 이 스크립트의 끝줄이 그 초록이다.
 *
 *   ══ 🔴 지키는 넷 ══
 *   ① **한 워크트리 안 병렬 금지** — 한 칸(워크트리) 안에서는 자를 **하나씩** 돌린다(변이 잔재 사고 · `verify-mutant-residue`).
 *      자가 끝날 때마다 `git status` 로 **나무가 깨끗한가**를 본다. 더럽히면 그 자를 ✗ 로 적고(무엇을 남겼나 찍는다) 되돌린 뒤 다음 자를 돌린다
 *      — 안 되돌리면 **다음 자가 변이된 코드를 잰다.**
 *   ② 🔴 **라이브 DB 를 만지는 자는 한 칸(1번)에서만 차례로**(조정 ②) — 동시에 돌면 시드 집이 엉킨다(AC-249: 시드 856 을 남겼다).
 *      체인 **끝에** «이번 체인이 만든 집(테넌트) 중 남은 것 0» · «이번 체인 사이 `ai_usage` 새 행 0» 을 **따로** 센다.
 *   ③ 종료코드: 자마다 `0` ✓ 초록 · `1` ✗ 틀림(멈춤) · `2` ⊘ 못 쟀음(**경고 · 체인 계속**) · 그 밖(시간 초과·죽음) = ⊘ «끝까지 못 갔다»(AC-249).
 *      🔴 **조정 ① — 돈 축의 ⊘ 는 ✗ 로 올린다**: `verify-background-base`(라이브 영상 생성 차단) · `verify-money-idem`(코인 한 번) ·
 *      `ai_usage` 새 행 · 시드 집 — 이 넷은 «못 쟀다»로 넘어가지 않는다.
 *      «기다리는 빨강»(`docs/rules/pending-red.json`)의 ✗ 는 ⏳ 로 따로 센다(`verify-safe-list` 와 같은 규칙 · 멈추지 않는다).
 *   ④ 🔴 **워크트리 정리는 제 것만** — `git worktree list` 에 **이 리포의 워크트리로 등록된** `C:/tmp/ac-gate-N` 만 `git worktree remove` 한다.
 *      그 자리에 등록 안 된 폴더가 있으면 **손대지 않고 멈춘다**(남의 폴더 `rm -rf` 금지). `node_modules` 정션은 **먼저 끊고**(링크만) 지운다
 *      — 정션을 단 채 지우면 도구가 정션을 따라 들어가 **원본 `node_modules` 를 지울 수 있다.**
 *
 *   ══ 무엇을 체인에 넣나 — 🔴 손 목록이 아니라 파일에서(§2.9 ② · AC-82) ══
 *     · 칸 `tsc`·`build-pages --check` — 타입(`scripts/**.mts` 포함 · AC-290)과 정본↔생성물.
 *     · `safe` 전부 — `scripts/_lib/gate-classify.mjs`(= `verify-safe-list` 와 **같은 갈래**)가 «파일만 읽는다»로 가른 자. 새 자는 저절로 들어온다.
 *     · `live` 중 **뜻을 갖고 넣은 것만** — 아래 `LIVE_IN_CHAIN`(자마다 까닭 · DB 를 만지나 · 돈 축인가). 나머지 live 는 사람이 하나씩 돌린다.
 *
 *   ══ 칸 나누기 ══
 *   1번 칸 = DB 를 만지는 자 전부(차례로) + 남는 시간에 파일 자. 2·3번 칸 = 파일 자. 지난 체인의 자별 시간(`C:/tmp/ac-gate-times.json`)으로
 *   **긴 것부터 가장 한가한 칸에**(LPT). 시간이 없으면 짐작(브라우저 60초 · 변이 90초 · .mts 20초 · .mjs 5초). 칸마다 포트를 가른다(`PORT` · AC-90).
 *
 *   쓰는 법:
 *     node scripts/gate-parallel.mjs --list                  ← 어느 자가 어느 칸에서 도나(돌리지 않는다)
 *     node scripts/gate-parallel.mjs                         ← 이 폴더의 HEAD 를 잰다
 *     node scripts/gate-parallel.mjs --hash main             ← 그 커밋을 잰다(합친 main 을 잴 때 · C2)
 *     node scripts/gate-parallel.mjs --only tsc,verify-foo.mjs   ← 고른 자만(체인 수리할 때)
 *     node scripts/gate-parallel.mjs --keep                  ← 끝나도 워크트리를 안 지운다(빨강을 들여다볼 때)
 *     node scripts/gate-parallel.mjs --no-db                 ← DB 를 만지는 자·돈 탐침을 뺀다 — 🔴 이러면 끝줄이 «💰 ⊘ → 멈춤» 이다(돈을 안 쟀다)
 *   🔴 **백그라운드로 돌려라**(§2.9 «폴링은 백그라운드로») — 자마다 한 줄씩 찍고, 로그는 `C:/tmp/ac-gate-logs/<판>/` 에 남는다.
 *
 *   종료코드: 0 = ✗ 0 · ⊘ 0 · 💰 초록 / 1 = ✗(돈 포함) 하나라도 — **push 멈춤** / 2 = ✗ 0 인데 ⊘(경고) 있음 — push 는 되고 ⊘ 는 그날 «자 수리» 항목.
 *   끝줄: `체인 N분 · ✓ a · ✗ b · ⊘(경고) c · 💰 초록|✗`
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { classifyGates, pendingRed } from "./_lib/gate-classify.mjs";

const SRC = path.resolve(import.meta.dirname, "..");            /* 이 폴더 — `node_modules` 를 빌려 줄 곳 */
const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

const LIST = has("--list");
const KEEP = has("--keep");
const NO_DB = has("--no-db");
const LANES = Math.max(1, Math.min(3, Number(opt("--lanes", 3)) || 3));
const ROOT = opt("--root", "C:/tmp").replace(/\\/g, "/");
const ONLY = opt("--only", "") ? new Set(opt("--only", "").split(",").map((s) => s.trim()).filter(Boolean)) : null;
const TIMEOUT_MIN = Number(opt("--timeout-min", 25)) || 25;
const laneDir = (n) => `${ROOT}/ac-gate-${n}`;
const TIMES_FILE = `${ROOT}/ac-gate-times.json`;
const git = (args, cwd = SRC) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/* ───────────────────────── 체인에 넣는 live 자 — 뜻을 갖고 하나씩 ───────────────────────── */
/**
 * `db: true` = 라이브 DB 에 붙는다 → **1번 칸에서만 차례로**. `money: true` = 돈 축 → ⊘ 를 ✗ 로 올린다(조정 ①).
 * 🔴 여기 넣을 때는 «돈을 안 쓰나(스텁·퓨즈) · 스스로 치우나»를 그 자 머리말에서 읽고 까닭에 적는다.
 */
const LIVE_IN_CHAIN = [
  /* ── DB 에 안 붙는다(갈래가 live 인 것은 낱말 때문) — 아무 칸 ── */
  { file: "verify-background-base.mts", money: true, why: "💰 배포 밖에서 라이브 배경 함수(영상 생성)를 못 부른다 · fetch 0 — 라이브 주소 글자 때문에 live 로 갈렸다" },
  { file: "verify-load-env-first.mjs", why: "파일만 읽는다 — 정규식의 `db/index` 글자 때문에 live 로 갈렸다" },
  { file: "verify-r18-youtube-quota.mts", why: "DB 0 · 네트워크 0(B2 머리말) — 가족당 유튜브 ≤ 1 · 한도 문 하나" },
  { file: "verify-r18-one-video-many-mutants.mjs", why: "순수 변이(사본 나무 · DB 0) — R18 자가 제품이 틀릴 때 우나" },
  { file: "verify-requeue-guarded-mutants.mjs", why: "사본 나무에서만 변이(제품 무접촉 · AC-213)" },
  { file: "verify-r9-screens.mjs", why: "로컬 정적 서버 + 브라우저(라이브 0) — `fetch` 는 제 서버만" },
  { file: "verify-r9-screen-browser.mjs", why: "로컬 정적 서버 + 브라우저(라이브 0)" },
  { file: "verify-r11-screens.mjs", why: "로컬 정적 서버 + 브라우저(라이브 0)" },
  { file: "verify-stuck-surface.mjs", why: "로컬 정적 서버 + 브라우저(라이브 0)" },
  /* ── 라이브 DB 에 붙는다 — 1번 칸에서 차례로 ── */
  { file: "verify-publish-alive.mjs", db: true, why: "읽기만(SELECT · guard) — «한 번 나갔다»는 사실과 그 길" },
  { file: "verify-goal-reach.mts", db: true, why: "읽기만 — AC-72 재발(라이브 goal 값 × 채널)" },
  { file: "verify-r18-reuse-live.mts", db: true, why: "시드 집 둘 → 스스로 치운다 · 생성 호출은 127.0.0.1 스텁(202) · 발행 0 — 파생 원장 0행 · 동시 두 번" },
  { file: "verify-r18-schedule-live.mts", db: true, why: "시드 집 하나 → 스스로 치운다 · 발행 0 — 파생 시차 ≥30분 · 멱등 · 쉬다 깨기" },
  { file: "verify-r18-one-video-many.mts", args: ["--db", "--rehearse"], db: true, timeoutMin: 40,
    why: "라이브 읽기(read only) + 시드 집 리허설(퓨즈 = 로컬 스텁 · 돈 0 · 발행 0) — 코인 한 번 · 같은 분 · 동시 두 번. 🔴 라이브 파생 0 이면 DB 팔이 ⊘(표본 0)" },
];
/** 돈 축 — ⊘ 를 ✗ 로(조정 ①). 파일 자는 이름으로, 탐침은 아래 `moneyProbe`. */
const MONEY_FILES = new Set(["verify-money-idem.mjs", ...LIVE_IN_CHAIN.filter((g) => g.money).map((g) => g.file)]);
/** safe 인데 체인에서 빼는 것 — 까닭 필수. */
const SAFE_SKIP = new Map([
  ["verify-safe-list.mjs", "목록 자체다 — 인자 없이 돌면 목록만 찍는다(체인이 그 목록으로 돈다)"],
]);

/* ───────────────────────── 체인 짓기 ───────────────────────── */
/**
 * 🔴 체인은 **잴 나무의 `scripts/`** 에서 짓는다 — 이 폴더의 것으로 지으면 `--hash main` 을 잴 때 목록과 돌 파일이 갈린다
 *    (main 에 새로 들어온 자가 빠지거나, 없는 자를 부른다). 그래서 돌릴 때는 1번 칸을 세운 **뒤에** 그 칸의 `scripts/` 로 짓는다.
 *    `--list` 만 이 폴더에서 짓는다(칸을 안 세우니까) — 잴 커밋이 이 폴더 HEAD 와 다르거나 `scripts/` 가 더러우면 그렇다고 말한다.
 */
let TIMES = {};
try { TIMES = JSON.parse(fs.readFileSync(TIMES_FILE, "utf8")); } catch { /* 첫 판 */ }
const GUESS = { 브라우저: 60, 변이: 90, mts: 20, mjs: 5, tsc: 60 };
const est = (g) => Number(TIMES[g.id]) || GUESS[g.kind] || 10;
const lanes = Array.from({ length: LANES }, (_, i) => ({ n: i + 1, dir: laneDir(i + 1), port: 47300 + (i + 1) * 10, gates: [], load: 0 }));

function plan(scriptsDir) {
  const groups = classifyGates(scriptsDir);
  const liveNames = new Set(groups.live.map(([f]) => f));
  const safeNames = new Set(groups.safe.map(([f]) => f));
  const kindOf = (file) => {
    let src = "";
    try { src = fs.readFileSync(path.join(scriptsDir, file), "utf8"); } catch { /* */ }
    if (/requirePlaywright|playwright/.test(src)) return "브라우저";
    if (/mutant|mutate/i.test(file)) return "변이";
    return file.endsWith(".mts") ? "mts" : "mjs";
  };
  const mkFile = (file, extra = {}) => ({
    id: extra.args?.length ? `${file} ${extra.args.join(" ")}` : file,
    argv: file.endsWith(".mts") ? ["node_modules/tsx/dist/cli.mjs", `scripts/${file}`, ...(extra.args ?? [])] : [`scripts/${file}`, ...(extra.args ?? [])],
    file, db: !!extra.db, money: MONEY_FILES.has(file), why: extra.why ?? "파일만 읽는다(safe)", timeoutMin: extra.timeoutMin ?? TIMEOUT_MIN,
    kind: kindOf(file), safe: safeNames.has(file),
  });
  const chain = [
    { id: "tsc", argv: ["node_modules/typescript/bin/tsc", "--noEmit"], db: false, money: false, kind: "tsc", timeoutMin: TIMEOUT_MIN,
      why: "타입 — `scripts/**.mts` 도 같이 본다(AC-290 · R18 은 이 칸 없이 배포돼 빨강을 달고 나갔다)" },
    { id: "build-pages --check", argv: ["scripts/build-pages.mjs", "--check"], db: false, money: false, kind: "mjs", timeoutMin: TIMEOUT_MIN,
      why: "정본 `_tpl.txt` ↔ 화면 파일이 갈렸나(쓰지 않는다 · 407b652)" },
    ...groups.safe.filter(([f]) => !SAFE_SKIP.has(f)).map(([f]) => mkFile(f)),
  ];
  const notFound = [];
  for (const g of LIVE_IN_CHAIN) {
    if (!liveNames.has(g.file) && !safeNames.has(g.file)) { notFound.push(g.file); continue; }
    if (safeNames.has(g.file) && !g.args) continue;   /* 갈래가 바뀌어 safe 가 됐으면 이미 들어 있다 */
    chain.push(mkFile(g.file, g));
  }
  let gates = ONLY ? chain.filter((g) => ONLY.has(g.id) || ONLY.has(g.file)) : chain;
  if (NO_DB) gates = gates.filter((g) => !g.db);
  /* 칸 나누기(LPT) — 🔴 DB 자는 1번 칸 · 차례로 · 먼저 */
  for (const L of lanes) { L.gates = []; L.load = 0; }
  for (const g of gates.filter((g) => g.db)) { lanes[0].gates.push(g); lanes[0].load += est(g); }
  for (const g of gates.filter((g) => !g.db).sort((a, b) => est(b) - est(a))) {
    const L = lanes.reduce((m, l) => (l.load < m.load ? l : m), lanes[0]);
    L.gates.push(g); L.load += est(g);
  }
  return { groups, gates, notFound };
}

/* ───────────────────────── --list ───────────────────────── */
const tagOf = (g) => [g.money ? "💰" : "", g.db ? "DB" : "", g.kind].filter(Boolean).join("·");
function printList({ groups, gates, notFound }) {
  console.log(`배포 체인 — 자 ${gates.length}개 · 칸 ${LANES} · 짐작 시간은 ${Object.keys(TIMES).length ? "지난 체인 실측" : "첫 판이라 짐작"}(${TIMES_FILE})`);
  console.log(`  갈래(파일에서): safe ${groups.safe.length} · live ${groups.live.length} · needs ${groups.needs.length} — 체인 = 칸 둘(tsc·build-pages) + safe ${groups.safe.length - SAFE_SKIP.size} + live 중 고른 ${LIVE_IN_CHAIN.length - notFound.length}`);
  for (const [f, why] of SAFE_SKIP) console.log(`  · 뺀 safe: ${f} — ${why}`);
  if (notFound.length) console.log(`  ⚠️ LIVE_IN_CHAIN 에 적었는데 파일이 없다: ${notFound.join(" · ")} — 체인 목록을 고쳐라`);
  for (const L of lanes) {
    console.log(`\n■ ${L.n}번 칸 ${L.dir} · PORT ${L.port} · 자 ${L.gates.length} · 짐작 ${Math.round(L.load / 60)}분${L.n === 1 ? " · 🔴 DB 자는 여기서만 차례로" : ""}`);
    for (const g of L.gates) console.log(`   ${String(Math.round(est(g))).padStart(4)}초  ${g.id.padEnd(48)} ${tagOf(g)}${g.db || g.money || !g.safe ? `  — ${g.why}` : ""}`);
  }
  const notIn = groups.live.map(([f]) => f).filter((f) => !LIVE_IN_CHAIN.some((g) => g.file === f));
  console.log(`\n■ 체인 밖 live ${notIn.length}개(사람이 뜻을 갖고 하나씩) · needs ${groups.needs.length}개: ${[...notIn, ...groups.needs.map(([f]) => f)].join(" · ")}`);
  console.log(`■ 💰 돈 축(⊘ → ✗): ${[...MONEY_FILES].join(" · ")} + 탐침 둘(«이번 체인 사이 ai_usage 새 행 0» · «이번 체인이 만든 집 남은 것 0»)${NO_DB ? " — 🔴 --no-db 라 탐침을 못 잰다 → 💰 ✗" : ""}`);
}
if (LIST) {
  const HASH_L = git(["rev-parse", opt("--hash", "HEAD")]);
  const dirty = git(["status", "--porcelain", "--", "scripts"]);
  if (HASH_L !== git(["rev-parse", "HEAD"]) || dirty) console.log(`⚠️ 목록은 이 폴더의 scripts/ 로 지었다 — 잴 커밋 ${HASH_L.slice(0, 7)} 와 ${dirty ? "scripts/ 가 더러워 " : ""}다를 수 있다(돌릴 때는 그 커밋의 scripts/ 로 다시 짓는다)\n`);
  printList(plan(path.join(SRC, "scripts")));
  process.exit(0);
}

/* ───────────────────────── 돈 탐침(1번 칸과 별개 · 체인 앞뒤) ───────────────────────── */
/** `.env` 를 이 폴더에서 읽어 자식에게 넘긴다 — 워크트리에 비밀 파일을 복사하지 않는다(`load-env` 는 이미 있는 값을 안 덮는다). */
function envFromDotenv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(SRC, ".env"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* .env 없음 — DB 자가 스스로 ⊘ 를 낸다 */ }
  return out;
}
const DOTENV = envFromDotenv();
async function withSql(fn) {
  const url = process.env.NETLIFY_DATABASE_URL || DOTENV.NETLIFY_DATABASE_URL;
  if (!url) throw new Error("NETLIFY_DATABASE_URL 이 없다");
  const postgres = (await import(pathToFileURL(path.join(SRC, "node_modules/postgres/src/index.js")).href)).default;
  const sql = postgres(url, { ssl: "require", max: 1, connect_timeout: 20 });
  try { return await fn(sql); } finally { await sql.end({ timeout: 5 }).catch(() => {}); }
}
/** 체인 앞: 🔴 **id 로 금을 긋는다**(시계로 긋지 않는다 — `created_at` 이 시간대 없는 칸이라 시계 비교는 헷갈린다). */
async function moneyBefore() {
  return withSql(async (sql) => {
    const [a] = await sql`SELECT COALESCE(max(id), 0)::bigint AS m FROM ai_usage`;
    const [t] = await sql`SELECT COALESCE(max(id), 0)::bigint AS m FROM tenants`;
    const [h] = await sql`SELECT count(*)::int AS c, COALESCE(sum(cost_usd), 0)::float AS usd FROM ai_usage WHERE created_at >= (now() AT TIME ZONE 'UTC') - interval '12 hours'`;
    /* 🔴 앞 판이 남긴 것일 수 있는 집 — 먼저 말한다(지우지는 않는다 · 도는 다른 창 것일 수 있다 · AC-249 ⓑ) */
    const recent = await sql`SELECT id, key, name, is_internal FROM tenants WHERE created_at >= (now() AT TIME ZONE 'UTC') - interval '48 hours' ORDER BY id`;
    return { aiMax: Number(a.m), tenantMax: Number(t.m), h12: h, recent };
  });
}
async function moneyAfter(before) {
  return withSql(async (sql) => {
    const newAi = await sql`SELECT u.id, u.tenant_id, u.purpose, u.model, u.cost_usd::float AS usd, u.synthetic, (t.id IS NULL) AS gone
      FROM ai_usage u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.id > ${before.aiMax} ORDER BY u.id`;
    const left = await sql`SELECT id, key, name, is_internal FROM tenants WHERE id > ${before.tenantMax} ORDER BY id`;
    const h12 = await sql`SELECT (t.id IS NULL) AS gone, COALESCE(t.is_internal, false) AS internal, count(*)::int AS c, COALESCE(sum(u.cost_usd), 0)::float AS usd
      FROM ai_usage u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.created_at >= (now() AT TIME ZONE 'UTC') - interval '12 hours' GROUP BY 1, 2`;
    return { newAi, left, h12 };
  });
}

/* ───────────────────────── 워크트리 ───────────────────────── */
const norm = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();
function registeredWorktrees() {
  const out = new Map();
  let cur = null;
  for (const line of git(["worktree", "list", "--porcelain"]).split(/\r?\n/)) {
    if (line.startsWith("worktree ")) { cur = line.slice(9); out.set(norm(cur), cur); }
  }
  return out;
}
const JUNCTIONS = ["node_modules", "runner/node_modules"];
/** 정션만 끊는다 — 🔴 진짜 폴더면 **손대지 않는다**(lstat 로 확인). */
function unlinkJunctions(dir) {
  for (const j of JUNCTIONS) {
    const p = path.join(dir, j);
    let st; try { st = fs.lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) fs.unlinkSync(p);
    else throw new Error(`${p} 가 정션이 아니라 진짜 폴더다 — 손대지 않고 멈춘다(지우면 안 된다)`);
  }
}
function removeMine(dir, reg) {
  if (!fs.existsSync(dir)) return "없음";
  if (!reg.has(norm(dir))) throw new Error(`${dir} 가 있는데 이 리포의 워크트리가 아니다 — 🔴 남의 폴더일 수 있어 손대지 않는다(치워 주시거나 --root 로 다른 곳을 주세요)`);
  unlinkJunctions(dir);
  const dirty = git(["status", "--porcelain"], dir);
  git(["worktree", "remove", "--force", dir]);   /* 제 것(등록 확인됨)만 · 정션은 이미 끊었다 */
  return dirty ? `지움(더러웠다: ${dirty.split(/\r?\n/).length}줄 — 앞 판의 잔재)` : "지움";
}
function addLane(L, hash) {
  git(["worktree", "add", "--detach", L.dir, hash]);
  for (const j of JUNCTIONS) {
    const from = path.join(SRC, j);
    if (!fs.existsSync(from)) continue;   /* runner/node_modules 가 없으면 브라우저 자가 스스로 ⊘ 를 낸다 */
    fs.symlinkSync(from, path.join(L.dir, j), "junction");
  }
}

/* ───────────────────────── 자 하나 돌리기 ───────────────────────── */
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const LOGDIR = `${ROOT}/ac-gate-logs/${RUN_ID}`;
const PENDING = pendingRed(SRC);
const results = [];
const T0 = Date.now();
const mm = (ms) => `${Math.floor(ms / 60000)}분 ${Math.round((ms % 60000) / 1000)}초`;
const logName = (L, g) => `${LOGDIR}/${L.n}-${g.id.replace(/[^\w.-]+/g, "_")}.log`;

/** 시간 초과면 **자식까지** 죽인다 — `tsx` 는 node 를 한 겹 더 띄우고, 브라우저 자는 chromium 을 띄운다. */
function killTree(child) {
  if (process.platform === "win32") { try { execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }); return; } catch { /* 이미 끝남 */ } }
  try { child.kill("SIGKILL"); } catch { /* */ }
}
function runOne(L, g, env) {
  return new Promise((resolve) => {
    const t = Date.now();
    const out = fs.openSync(logName(L, g), "w");
    fs.writeSync(out, `# ${g.id} · 칸 ${L.n} · ${L.dir} · ${new Date().toISOString()}\n# node ${g.argv.join(" ")}\n\n`);
    const child = spawn(process.execPath, g.argv, { cwd: L.dir, env, stdio: ["ignore", out, out], windowsHide: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, g.timeoutMin * 60_000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      fs.closeSync(out);
      resolve({ code: timedOut ? "timeout" : code ?? (signal ? `signal ${signal}` : "null"), ms: Date.now() - t });
    });
    child.on("error", (e) => { clearTimeout(timer); try { fs.closeSync(out); } catch { /* */ } resolve({ code: `spawn ${e.code || e.message}`, ms: Date.now() - t }); });
  });
}
/** 자가 나무를 더럽혔나 — 더럽혔으면 무엇을 남겼나 찍고 되돌린다(제 워크트리 안에서만). */
const JUNCTION_EXCLUDES = JUNCTIONS.flatMap((j) => ["-e", `/${j}`]);
function treeResidue(L) {
  const st = git(["status", "--porcelain"], L.dir);
  if (!st) return null;
  const diffStat = (() => { try { return git(["diff", "--stat"], L.dir); } catch { return ""; } })();
  git(["checkout", "--", "."], L.dir);
  /* 추적 밖만 지운다 · 무시 파일(_shots 등)은 안 건드린다 · 🔴 정션은 **이름으로 한 번 더 뺀다**
     (git 은 지금 `node_modules/` 규칙으로 정션을 무시한다 — 실측 — 그 규칙이 바뀌는 날 `clean` 이 정션을 따라 원본을 지우면 안 된다) */
  git(["clean", "-fdq", ...JUNCTION_EXCLUDES], L.dir);
  return `${st.split(/\r?\n/).slice(0, 6).join(" | ")}${diffStat ? ` · ${diffStat.split(/\r?\n/).pop()}` : ""}`;
}
function judge(g, code) {
  if (code === 0) return "✓";
  if (code === 1) return PENDING.has(g.file) ? "⏳" : "✗";
  return g.money ? "✗" : "⊘";   /* 🔴 조정 ① — 돈 축의 «못 쟀다»는 멈춘다 · 그 밖은 경고 */
}
async function runLane(L, env) {
  for (const g of L.gates) {
    const { code, ms } = await runOne(L, g, env);
    const residue = treeResidue(L);
    let mark = judge(g, code);
    if (residue) mark = "✗";
    const note = [
      code === 0 ? "" : typeof code === "number" ? `종료 ${code}` : `끝까지 못 갔다(${code})`,
      g.money && code !== 0 && code !== 1 ? "💰 돈 축의 ⊘ → ✗(조정 ①)" : "",
      mark === "⏳" ? "기다리는 빨강(pending-red.json)" : "",
      residue ? `🔴 나무를 더럽혔다 → 되돌림: ${residue}` : "",
    ].filter(Boolean).join(" · ");
    results.push({ lane: L.n, id: g.id, mark, code, ms, note, log: logName(L, g), money: g.money, db: g.db });
    console.log(`  ${mark} [${L.n}] ${g.id.padEnd(50)} ${String(Math.round(ms / 1000)).padStart(4)}초${note ? `  ${note}` : ""}`);
  }
}

/* ───────────────────────── 돌린다 ───────────────────────── */
const HASH = git(["rev-parse", opt("--hash", "HEAD")]);
console.log(`🔗 배포 체인 — ${HASH.slice(0, 7)} (${git(["log", "-1", "--format=%s", HASH]).slice(0, 70)}) · 칸 ${LANES} · 로그 ${LOGDIR}`);
fs.mkdirSync(LOGDIR, { recursive: true });

let before = null, moneyErr = "";
if (!NO_DB) {
  try {
    before = await moneyBefore();
    console.log(`💰 앞: ai_usage 금 id>${before.aiMax} · 테넌트 금 id>${before.tenantMax} · 최근 12시간 ai_usage ${before.h12.c}행 $${before.h12.usd.toFixed(2)}`);
    if (before.recent.length) console.log(`   ⚠️ 최근 48시간에 생긴 집 ${before.recent.length}곳(앞 판이 남긴 시드일 수 있다 · 지우지 않는다): ${before.recent.map((t) => `${t.id}:${t.key}${t.is_internal ? "(내부)" : ""}`).join(" · ")}`);
  } catch (e) { moneyErr = String(e?.message ?? e).slice(0, 160); console.log(`💰 앞 탐침 ⊘ — ${moneyErr} → 🔴 돈을 못 재니 끝줄은 ✗`); }
}

const reg = registeredWorktrees();
const setup = [];
try {
  for (const L of lanes) setup.push(`${L.n}번 앞 판 ${removeMine(L.dir, reg)}`);
  for (const L of lanes) addLane(L, HASH);
} catch (e) {
  console.error(`⊘ 칸을 못 세웠다 — ${String(e?.message ?? e)}`);
  console.error(`   (${setup.join(" · ")}) — 🔴 아무것도 안 쟀다. 체인을 초록으로 세지 않는다.`);
  process.exit(2);
}
/* 🔴 잴 커밋의 scripts/ 로 체인을 짓는다(위 «체인 짓기» 머리말) */
const { gates, notFound } = plan(path.join(lanes[0].dir, "scripts"));
if (notFound.length) console.log(`⚠️ LIVE_IN_CHAIN 에 적었는데 ${HASH.slice(0, 7)} 에 없는 자: ${notFound.join(" · ")} — 빼고 돈다(체인 목록을 고쳐라)`);
if (!gates.length) { console.error("⊘ 돌릴 자가 0개다 — 초록으로 세지 않는다"); process.exit(2); }
console.log(`🧱 자 ${gates.length} · 칸: ${lanes.map((L) => `${L.n}=${L.gates.length}자/짐작 ${Math.round(L.load / 60)}분`).join(" · ")} (${setup.join(" · ")})`);

/* 셸이 준 값이 이긴다(load-env 와 같은 규칙).
   🔴 칸은 `C:/tmp/ac-gate-N` 이라 «형제 리포»(`../AutoMarketing`)가 없다 — 이 폴더에서 돌 때와 **같은 것**을 보게 절대 경로로 넘긴다
   (브라우저 자 다섯이 `PW_DIR || ../AutoMarketing` 에서 playwright 를 찾고, `verify-am-video-sync` 는 `AM_DIR` 로 AM 원본을 본다). */
const SIBLING_AM = path.resolve(SRC, "..", "AutoMarketing");
const baseEnv = {
  ...(fs.existsSync(path.join(SIBLING_AM, "node_modules/playwright")) ? { PW_DIR: SIBLING_AM } : {}),
  ...(fs.existsSync(SIBLING_AM) ? { AM_DIR: SIBLING_AM } : {}),
  ...DOTENV, ...process.env,
};
await Promise.all(lanes.map((L) => runLane(L, { ...baseEnv, PORT: String(L.port), FORCE_COLOR: "0" })));

/* ── 돈 뒤 탐침 ── */
const money = [];
if (NO_DB) money.push({ mark: "✗", line: "💰 --no-db 라 돈 탐침을 안 돌렸다 — 못 잰 돈은 초록이 아니다(조정 ①)" });
else if (!before) money.push({ mark: "✗", line: `💰 앞 탐침 ⊘(${moneyErr}) — 못 잰 돈은 초록이 아니다(조정 ①)` });
else {
  try {
    const after = await moneyAfter(before);
    const ai = after.newAi;
    money.push(ai.length
      ? { mark: "✗", line: `💰 🔴 이번 체인 사이 ai_usage 새 행 ${ai.length}개 $${ai.reduce((a, r) => a + Number(r.usd || 0), 0).toFixed(4)} — ${ai.slice(0, 6).map((r) => `#${r.id} 집${r.tenant_id}${r.gone ? "(지워진 집)" : ""} ${r.purpose}/${r.model}${r.synthetic ? "(synthetic)" : ""}`).join(" · ")}  (🔴 고객이 이 사이에 쓴 것도 여기 든다 — 집 번호로 가려라)` }
      : { mark: "✓", line: "💰 이번 체인 사이 ai_usage 새 행 0" });
    money.push(after.left.length
      ? { mark: "✗", line: `💰 🔴 이번 체인이 만든 집 중 남은 것 ${after.left.length}곳 — ${after.left.map((t) => `${t.id}:${t.key}(${t.name})${t.is_internal ? " 내부" : ""}`).join(" · ")}  (시드면 teardownRun 으로 치운다 · 고객 가입이면 사람이 가린다)` }
      : { mark: "✓", line: "💰 이번 체인이 만든 집 남은 것 0(시드 집 0)" });
    const h = after.h12;
    const ours = h.filter((r) => r.gone || r.internal).reduce((a, r) => a + r.c, 0);
    const cust = h.filter((r) => !r.gone && !r.internal).reduce((a, r) => a + r.c, 0);
    money.push({ mark: ours ? "✗" : "✓", line: `💰 최근 12시간 ai_usage — 지워진 집·내부 집 ${ours}행${ours ? " 🔴(우리 자·시드가 쓴 돈)" : ""} · 고객 집 ${cust}행(참고 · 고객이 쓴 것은 결함이 아니다)` });
  } catch (e) { money.push({ mark: "✗", line: `💰 뒤 탐침 ⊘ — ${String(e?.message ?? e).slice(0, 160)} → 못 잰 돈은 초록이 아니다(조정 ①)` }); }
}

/* ── 칸 정리(제 것만) ── */
const cleanup = [];
for (const L of lanes) {
  if (KEEP) { cleanup.push(`${L.n}번 남김(--keep)`); continue; }
  try { cleanup.push(`${L.n}번 ${removeMine(L.dir, registeredWorktrees())}`); }
  catch (e) { cleanup.push(`${L.n}번 🔴 못 지움 — ${String(e?.message ?? e).slice(0, 100)}`); }
}
try { git(["worktree", "prune"]); } catch { /* */ }
/* 🔴 빌려 준 node_modules 가 멀쩡한가 — 정션을 따라 지워졌으면 여기서 안다 */
const nmOk = fs.existsSync(path.join(SRC, "node_modules/tsx/dist/cli.mjs"));

/* ── 시간 기록(다음 판의 칸 나누기) ── */
for (const r of results) if (typeof r.code === "number") TIMES[r.id] = Math.round(r.ms / 1000);
try { fs.writeFileSync(TIMES_FILE, JSON.stringify(TIMES, null, 1)); } catch { /* */ }

/* ── 끝 ── */
const cnt = (m) => results.filter((r) => r.mark === m).length;
const bad = results.filter((r) => r.mark === "✗");
const warn = results.filter((r) => r.mark === "⊘");
const wait = results.filter((r) => r.mark === "⏳");
const moneyBad = money.some((m) => m.mark === "✗") || results.some((r) => r.money && r.mark === "✗");
console.log("═".repeat(110));
for (const m of money) console.log(`  ${m.mark} ${m.line}`);
if (bad.length) { console.log(`■ 🔴 ✗ ${bad.length} — push 멈춤:`); for (const r of bad) console.log(`   ✗ [${r.lane}] ${r.id} ${r.note ? `— ${r.note}` : ""}\n      로그 ${r.log}`); }
if (warn.length) { console.log(`■ ⊘ ${warn.length} — 경고(체인 계속 · 오늘 «자 수리» 항목):`); for (const r of warn) console.log(`   ⊘ [${r.lane}] ${r.id} ${r.note ? `— ${r.note}` : ""}\n      로그 ${r.log}`); }
if (wait.length) console.log(`■ ⏳ 기다리는 빨강 ${wait.length}(pending-red.json · 멈추지 않는다): ${wait.map((r) => r.id).join(" · ")}`);
console.log(`■ 칸 정리: ${cleanup.join(" · ")} · 빌려 준 node_modules ${nmOk ? "멀쩡" : "🔴 사라졌다 — npm ci 로 되살려라"}`);
const per = lanes.map((L) => { const ms = results.filter((r) => r.lane === L.n).reduce((a, r) => a + r.ms, 0); return `${L.n}번 ${mm(ms)}`; }).join(" · ");
console.log(`■ 칸별 실제 시간: ${per}`);
const total = Date.now() - T0;
console.log(`체인 ${Math.round(total / 60000)}분(${mm(total)}) · ✓ ${cnt("✓")} · ✗ ${cnt("✗")} · ⊘(경고) ${cnt("⊘")}${wait.length ? ` · ⏳ ${wait.length}` : ""} · 💰 ${moneyBad ? "✗" : "초록"} — ${HASH.slice(0, 7)}`);
process.exit(bad.length || moneyBad || !nmOk ? 1 : warn.length ? 2 : 0);
