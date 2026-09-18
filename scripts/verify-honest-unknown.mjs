/**
 * scripts/verify-honest-unknown.mjs — 🔴 **«서버가 애써 가른 것을 뭉개지 않는다»**(C · 수리 라운드 2026-09-19 · A⑤·B②).
 *   사용: node scripts/verify-honest-unknown.mjs
 *         node scripts/verify-honest-unknown.mjs --list
 *
 *   ══ 왜 이 자가 있나 — 두 결함이 **한 병**이다 ══
 *   **B② «모름»을 «0»이라 말한다.** `ops-dashboard.ts:77` 은 표본이 없으면 **일부러 `null`** 을 낸다:
 *       `const trialToPaidPct = cohort > 0 ? Math.round(converted * 100 / cohort) : null;`
 *   그런데 화면이 `ops/index.html:83` 에서 `${r.trialToPaidPct ?? 0}%` 로 받아 **«0%»** 라고 적는다.
 *   🔴 «아직 못 쟀다»와 «재 봤더니 0이다»는 **완전히 다른 말**인데 화면이 둘을 같게 만든다(AC-9 의 화면판).
 *
 *   **A⑤ 탈퇴한 집에 «체험이 끝났어요».** 탈퇴를 신청하면 `tenants.status` 가 `readonly` 가 된다 —
 *   체험이 14일 남았어도 그렇다. `lib/guards.ts:42~44` 는 **이미 이 병을 한 번 잡아** `closed_at` 으로 사유를 가른다.
 *   그런데 `home-summary.ts:61` 은 `status === "readonly"` 만 보고 **«체험이 끝났어요 — 요금제를 골라 주세요»**를 띄운다.
 *   그 집엔 거짓말이고, 정작 필요한 **«되돌리기»를 못 찾게 만든다.** 🔴 **한 길만 고치고 다른 길은 아무도 안 봤다.**
 *
 *   ⇒ 둘 다 «**서버가 가른 것**(못 쟀다 / 탈퇴다)을 **받는 쪽이 뭉갠다**»이다. 그래서 한 자에 두 축으로 둔다.
 *
 *   ══ 🔴 손 목록이 없다(AC-108) ══
 *   ①축: **서버가 일부러 `null` 을 내는 키**를 핸들러에서 찾고 → 그 경로를 부르는 화면이 `?? 0`·`|| 0` 으로 받는지 본다.
 *   ②축: `"readonly"` 를 보는 자리를 폴더째 찾고 → 그 곁에서 **탈퇴 여부**(`closed_at`·`closed`)를 같이 보는지 본다.
 *
 *   ══ 🔴 이 자가 **아직 못 하는 것**(못으로 박아 둔다 · AC-109 ㉰) ══
 *   · ①축은 `?? 0`·`|| 0` 만 본다. `Number(x)`·`+x` 로 뭉개면 못 본다.
 *   · ②축은 **글자 거리**(같은 줄과 앞뒤 240자)로 «같이 본다»를 판정한다 — 멀리 떨어진 가드는 못 읽는다.
 *   · «0 이라고 적는 것이 **맞는** 자리»(진짜 0)는 이 자가 못 가른다 — 서버가 `null` 을 내는 키만 보는 이유다.
 *
 *   종료코드: 0 = 안 뭉갠다 · 1 = 뭉개는 자리가 있다 · 2 = 못 쟀다.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.env.HONEST_UNKNOWN_ROOT ? path.resolve(process.env.HONEST_UNKNOWN_ROOT) : path.resolve(import.meta.dirname, "..");
const PUB = path.join(ROOT, "public");
const FN = path.join(ROOT, "netlify", "functions");
const LIB = path.join(ROOT, "lib");
const LIST = process.argv.includes("--list");
if (![PUB, FN, LIB].every(existsSync)) { console.error("⊘ 못 쟀어요 — public/·netlify/functions/·lib/ 중 없는 것이 있습니다."); process.exit(2); }

const out = [];
const rec = (step, ok, note) => { out.push({ step, ok, note }); console.log(`  ${ok ? "✓" : "✗"} ${step}  — ${note}`); return ok; };
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
function walk(dir, re, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, re, acc);
    else if (re.test(e.name)) acc.push(p);
  }
  return acc;
}
const lineOf = (src, i) => src.slice(0, i).split("\n").length;

/* ═══ ① 서버가 «못 쟀다»로 낸 `null` 을 화면이 «0» 으로 뭉개나 ═══ */
/** 소스에서 «일부러 null 을 내는 키»를 뽑는다 — `const K = … ? … : null` · `K: … ? … : null`. */
function nullKeysOf(src) {
  const keys = new Set();
  for (const m of src.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*\?\s*[^;]*:\s*null\s*;/g)) keys.add(m[1]);
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*[^,;{}]*\?\s*[^,;{}]*:\s*null\b/g)) keys.add(m[1]);
  return keys;
}
const routeNullKeys = new Map();   // 경로 → Set(키)
for (const f of walk(FN, /\.ts$/)) {
  const src = codeOnly(readFileSync(f, "utf8"));
  const keys = nullKeysOf(src);
  if (!keys.size) continue;
  const cfg = src.match(/export\s+const\s+config\s*=\s*\{[^}]*?path\s*:\s*(\[[^\]]*\]|["'][^"']*["'])/s);
  for (const p of (cfg ? (cfg[1].match(/["'`](\/[^"'`]+)["'`]/g) ?? []) : [])) routeNullKeys.set(p.slice(1, -1), { keys, file: rel(f) });
}
const flattened = [];
for (const f of walk(PUB, /\.(html|js)$/)) {
  const screen = rel(f);
  const src = codeOnly(readFileSync(f, "utf8"));
  const routes = [...new Set([...src.matchAll(/UI\.api\s*\(\s*["'`](\/api\/[A-Za-z0-9_-]+)/g)].map((m) => m[1]))];
  for (const r of routes) {
    const info = routeNullKeys.get(r);
    if (!info) continue;
    for (const k of info.keys) {
      /* `r.trialToPaidPct ?? 0` · `r.x?.y ?? 0` · `|| 0` 을 본다. */
      const re = new RegExp(`\\.${k}\\s*(?:\\?\\.[\\w$]+\\s*)?(?:\\?\\?|\\|\\|)\\s*0\\b`);
      const m = src.match(re);
      if (m) flattened.push({ screen, route: r, key: k, server: info.file, snip: m[0] });
    }
  }
}

/* ═══ ② `readonly` 를 «탈퇴»와 안 가르는 자리 ═══ */
const CLOSED_NEAR = /closed_at|closedAt|\bclosed\b|purge_at|purgeAt/;
const roSites = [];
for (const d of [LIB, FN]) for (const f of walk(d, /\.ts$/)) {
  const src = codeOnly(readFileSync(f, "utf8"));
  for (const m of src.matchAll(/["'`]readonly["'`]/g)) {
    const from = Math.max(0, m.index - 240), to = Math.min(src.length, m.index + 240);
    const near = src.slice(from, to);
    /* 낱말 목록(`NON_WRITABLE` 같은 집합 정의)은 «판정»이 아니다 — 비교하는 자리만 본다. */
    const isCompare = /[=!]==?\s*["'`]readonly["'`]|["'`]readonly["'`]\s*[=!]==?/.test(src.slice(Math.max(0, m.index - 30), m.index + 30));
    if (!isCompare) continue;
    roSites.push({ file: rel(f), line: lineOf(src, m.index), guarded: CLOSED_NEAR.test(near), snip: src.slice(m.index - 60 < 0 ? 0 : m.index - 60, m.index + 60).replace(/\s+/g, " ").trim() });
  }
}
const roBad = roSites.filter((s) => !s.guarded);
const roGood = roSites.filter((s) => s.guarded);

console.log(`\n«서버가 애써 가른 것을 뭉개지 않는다» · ${new Date().toISOString()}`);
console.log("─".repeat(120));
if (LIST) {
  console.log(`  [①] 서버가 일부러 null 을 내는 경로 ${routeNullKeys.size}개`);
  for (const s of roSites) console.log(`  [②] ${s.guarded ? "✓가른다" : "🔴안가른다"} ${s.file}:${s.line}  ${s.snip.slice(0, 80)}`);
}

rec("① 🔴 서버가 «못 쟀다»로 낸 `null` 을 화면이 «0» 이라고 말하지 않는다", flattened.length === 0,
  flattened.length ? `뭉개는 자리 ${flattened.length}곳` : "뭉개는 자리 0곳");
for (const b of flattened) {
  console.log(`   🔴 ${b.screen}  \`${b.key}${b.snip.slice(b.key.length + 1)}\``);
  console.log(`      서버 ${b.server} 는 표본이 없으면 **일부러 \`null\`**(=«못 쟀다»)을 보낸다 — 화면이 «0» 으로 바꾼다`);
}

rec("② 🔴 `readonly` 를 볼 때 **탈퇴인지 체험 종료인지 같이 가른다**", roBad.length === 0,
  roBad.length ? `안 가르는 자리 ${roBad.length}곳 / 비교하는 자리 ${roSites.length}곳` : `비교하는 자리 ${roSites.length}곳 전부 가른다`);
for (const b of roBad) {
  console.log(`   🔴 ${b.file}:${b.line}`);
  console.log(`      ${b.snip.slice(0, 110)}`);
  console.log(`      ⇒ 탈퇴를 신청한 집도 상태는 \`readonly\` 다. 안 가르면 **체험이 남은 집에 «체험이 끝났어요»**가 뜬다(lib/guards.ts:42 가 이미 잡은 병).`);
}
rec("대조군 — **가르는 자리도 실제로 있다**(이 자가 둘을 가른다)", roGood.length > 0,
  roGood.length ? `가르는 자리 ${roGood.length}곳 (예: ${roGood.slice(0, 3).map((s) => `${s.file}:${s.line}`).join(", ")})` : "🔴 하나도 없다 — 가른 적이 없다");

/* ═══ ⓪ 자기 찌르기 — 🔴 «우는가»를 잰다(AC-108) ═══ */
{
  /* ⓪a ①축: 화면의 `?? 0` 을 떼면 그 빨강이 사라지나. */
  const idx = readFileSync(path.join(PUB, "ops", "index.html"), "utf8");
  const fixed = idx.replace("r.trialToPaidPct ?? 0", "r.trialToPaidPct == null ? \"못 쟀어요\" : r.trialToPaidPct");
  const still = [];
  {
    const src = codeOnly(fixed);
    for (const [route, info] of routeNullKeys) {
      if (!src.includes(route)) continue;
      for (const k of info.keys) if (new RegExp(`\\.${k}\\s*(?:\\?\\.[\\w$]+\\s*)?(?:\\?\\?|\\|\\|)\\s*0\\b`).test(src)) still.push(k);
    }
  }
  rec("⓪a 자기 찌르기 — 화면이 «못 쟀어요»라고 말하게 고치면 ①의 그 빨강이 사라진다",
    fixed !== idx && !still.includes("trialToPaidPct"),
    fixed === idx ? "🔴 닻을 못 찾았다 — 이 변이표가 낡았다" : `고친 뒤 남은 키: ${still.join(", ") || "없음"}`);

  /* ⓪b ②축: 가드를 지우면 «가르는 자리»가 «안 가르는 자리»로 넘어오나.
     🔴 처음엔 `lib/guards.ts` 를 골랐다가 0→0 으로 실패했다 — 그 파일은 `readonly` 를 **집합**(`NON_WRITABLE`)으로
     쓰지 **비교하지 않는다.** 이 축이 보는 것은 «비교하는 자리»라 옮길 것이 없었다. **자가 옳았고 내 변이 대상이 틀렸다.**
     ⇒ 실제로 비교하면서 `closed_at` 을 곁에 둔 대조군(`lib/account-close.ts`)으로 바꿨다. */
  const guardsRaw = readFileSync(path.join(LIB, "account-close.ts"), "utf8");
  const stripped = guardsRaw.replace(/closed_at/g, "xxx_at").replace(/closedAt/g, "xxxAt").replace(/purge_at/g, "xxxp_at").replace(/\bclosed\b/g, "xclosed");
  const scanRo = (relPath, raw) => {
    const src = codeOnly(raw); const found = [];
    for (const m of src.matchAll(/["'`]readonly["'`]/g)) {
      if (!/[=!]==?\s*["'`]readonly["'`]|["'`]readonly["'`]\s*[=!]==?/.test(src.slice(Math.max(0, m.index - 30), m.index + 30))) continue;
      found.push({ guarded: CLOSED_NEAR.test(src.slice(Math.max(0, m.index - 240), m.index + 240)) });
    }
    return found;
  };
  const before = scanRo("lib/account-close.ts", guardsRaw).filter((s) => !s.guarded).length;
  const after = scanRo("lib/account-close.ts", stripped).filter((s) => !s.guarded).length;
  rec("⓪b 자기 찌르기 — **가드(`closed_at`)를 지우면 운다**(안 가르는 자리로 넘어온다)",
    stripped !== guardsRaw && after > before, `지우기 전 ${before}곳 → 지운 뒤 ${after}곳`);

  /* ⓪c 🔴 주석 속 `closed_at` 을 «가드»로 세지 않는다(AC-109 ①). */
  /* 🔴 **다른 가드 낱말을 먼저 치운다** — 안 치우면 `purge_at`·`closed` 가 남아 여전히 «가른다»로 잡히고,
     그러면 이 변이는 «주석을 세나»가 아니라 **아무것도 안 재는 변이**가 된다(둘째 판이 그랬다). */
  const commented = stripped.replace(/xxx_at/g, "/* closed_at */ xxx_at");
  const afterC = scanRo("lib/account-close.ts", commented).filter((s) => !s.guarded).length;
  rec("⓪c 자기 찌르기 — **주석 속 `closed_at` 은 가드로 안 센다**(AC-109 ①)", afterC > before,
    `주석으로만 남기니 안 가르는 자리 ${afterC}곳(원래 ${before}곳)`);
}

console.log("─".repeat(120));
const fails = out.filter((o) => !o.ok);
console.log(`PASS ${out.length - fails.length} · FAIL ${fails.length} · ①뭉갬 ${flattened.length}곳 · ②readonly 비교 ${roSites.length}곳(안 가름 ${roBad.length})`);
console.log("🔴 이 자는 «뭉개나»만 잰다 — 화면에 그 말이 **어떻게 보이나**는 사람이 본다.\n");
process.exit(fails.length ? 1 : 0);
