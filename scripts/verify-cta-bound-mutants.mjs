/**
 * scripts/verify-cta-bound-mutants.mjs — 🔴 **A 의 자(`verify-cta-bound.mjs`)에 변이를 넣어 우는지 내가 잰다**
 *   (C · 첫 발행 라운드 2026-09-20)
 *
 *   ══ 왜 ══
 *   메인이 준 몫: «🔴 «자를 냈다»가 아니라 «그 자에 변이를 넣으면 우는가»를 **네가** 재라(만든 사람 말고).»
 *   A 는 변이 6번을 돌렸다고 적었고 그중 2번은 처음에 안 울어서 자를 고쳤다고 했다. **그 말을 믿고 넘기면 안 된다** —
 *   믿을 수 있게 만드는 길은 하나뿐이다: **내가 다시 넣어 본다.**
 *
 *   ══ 🔴 변이는 **사본**에서만 ══
 *   `verify-cta-bound.mjs` 는 상대경로(`public/app/_tpl.txt` …)를 읽는다 ⇒ 파일 셋을 임시 폴더에 복사하고
 *   **그 폴더를 작업 폴더로 삼아** 자를 돌린다. 제품 파일은 한 글자도 안 건드린다.
 *
 *   ══ 🔴 «망가뜨리는 변이»만 넣는다(AC-112 ⑥) ══
 *   «고치는 변이»는 제품이 고쳐지는 순간 죽는다. 여기 변이는 전부 **멀쩡한 것을 부수는** 쪽이라 영원히 산다.
 *
 *   종료코드: 0 = 변이마다 운다 · 1 = 안 우는 변이가 있다(그 자리는 **초록으로 지나간다**) · 2 = 못 쟀다.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dirname, "..");
const RULER = path.join(ROOT, "scripts", "verify-cta-bound.mjs");
if (!existsSync(RULER)) { console.error("⊘ 못 쟀어요 — `scripts/verify-cta-bound.mjs` 가 없다(A 의 자)."); process.exit(2); }
/* 🔴 **A 의 자가 읽는 파일 목록을 손으로 적지 않는다** — 2026-09-20 실제로 갈렸다.
   A 가 축을 더하면서 `netlify/functions/pieces.ts`·`public/css/ac.css` 를 읽기 시작했는데 내 사본엔 그 둘이 없어
   **대조군이 빨개졌다.** (거짓 판정은 안 났다 — «대조군이 빨가면 여기서 멈춘다»가 값을 했다.)
   ⇒ 이제 **그 자의 소스에서 읽는 파일을 뽑아 온다.** A 가 축을 더해도 따라온다(AC-113 «손 목록은 낡는다»). */
const FILES = (() => {
  const src = readFileSync(RULER, "utf8");
  const set = new Set();
  for (const m of src.matchAll(/readFileSync\(\s*["']([^"']+)["']/g)) set.add(m[1]);
  for (const m of src.matchAll(/(?:const|let)\s+\w+\s*=\s*["']((?:public|lib|netlify|db|runner|drizzle)\/[^"']+)["']/g)) set.add(m[1]);
  return [...set];
})();

for (const f of FILES) if (!existsSync(path.join(ROOT, f))) { console.error(`⊘ 못 쟀어요 — ${f} 가 없다.`); process.exit(2); }

/** 사본을 하나 만들고 transform 을 먹인 뒤 A 의 자를 그 폴더에서 돌린다. */
function run(transform) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ac-cta-"));
  try {
    const box = {};
    for (const f of FILES) { mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); box[f] = readFileSync(path.join(ROOT, f), "utf8"); }
    const changed = transform(box);
    for (const f of FILES) writeFileSync(path.join(dir, f), box[f]);
    let code = 0, out = "";
    try { out = execFileSync(process.execPath, [RULER], { cwd: dir, encoding: "utf8" }); }
    catch (e) { code = e.status ?? -1; out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
    return { code, out, changed };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** `_tpl.txt` 의 piece.html 절만 바꾼다 — 다른 화면 35개를 건드리면 변이가 아니라 파괴다. */
function inSeg(box, fn) {
  const t = box["public/app/_tpl.txt"];
  const i = t.indexOf("=== piece.html");
  if (i < 0) return 0;
  const j = t.indexOf("\n=== ", i + 10);
  const end = j < 0 ? t.length : j;
  const seg = t.slice(i, end);
  const next = fn(seg);
  if (next === seg) return 0;
  box["public/app/_tpl.txt"] = t.slice(0, i) + next + t.slice(end);
  return seg.split("\n").filter((l, k) => l !== next.split("\n")[k]).length || 1;
}

const cases = [];
const add = (name, transform, want) => cases.push({ name, transform, want });

/* ① 정적 마크업에 손 없는 단추를 되살린다 — A 가 뺀 바로 그것 */
add("① 정적 `#cta` 에 단추를 되살리면 운다", (b) => {
  const before = b["public/app/piece.html"];
  b["public/app/piece.html"] = before.replace(/<div class="cta" id="cta"([^>]*)>/,
    '<div class="cta" id="cta"$1><button class="btn primary" type="button" id="approve">이대로 발행 예약</button>');
  return b["public/app/piece.html"] === before ? 0 : 1;
}, true);

/* ② 그리는 자리에서 `bindCta()` 호출만 뗀다 — «그려는 놓고 손은 안 붙인다» */
add("② `bindCta()` 호출을 떼면 운다", (b) => inSeg(b, (s) => s.replace(/;\s*bindCta\(\);/, ";")), true);

/* ③ `bindNow()` — 🔴 도우미(`nowBtn()`) 안 단추라 **펼쳐서 세지 않으면 안 운다**(A 가 한 번 속은 자리) */
add("③ `bindNow()` 호출을 떼면 운다 — 도우미 안 단추를 펼쳐서 세나", (b) => inSeg(b, (s) => s.replace(/;\s*bindNow\(\);/, ";")), true);

/* ④ 막힌 글 갈래 자체를 없앤다 */
add("④ `STUCK_ST` 에서 `awaiting_manual` 을 빼면 운다", (b) => {
  let n = inSeg(b, (s) => s.replace(/(STUCK_ST\s*=\s*\[)([^\]]*)\]/, (m, a, list) => a + list.replace(/"awaiting_manual"\s*,?\s*/, "") + "]"));
  n += b["public/app/piece.html"].includes("STUCK_ST") ? (() => {
    const before = b["public/app/piece.html"];
    b["public/app/piece.html"] = before.replace(/(STUCK_ST\s*=\s*\[)([^\]]*)\]/, (m, a, list) => a + list.replace(/"awaiting_manual"\s*,?\s*/, "") + "]");
    return b["public/app/piece.html"] === before ? 0 : 1;
  })() : 0;
  return n;
}, true);

/* ⑤ 까닭을 지운다 — 🔴 `seg` 통째로 보면 **다른 갈래의 failReason** 을 세어 안 운다(A 가 둘째로 속은 자리) */
add("⑤ `stuckSay()` 안의 `P.failReason` 을 지우면 운다 — 남의 갈래 것을 세고 있지 않나", (b) =>
  inSeg(b, (s) => s.replace(/function stuckSay\(\)[\s\S]*?\n\}/, (fn) => fn.replace(/P\.failReason/g, '""'))), true);

/* ⑥ 다음 수(직접 올리는 길)를 끊는다 */
add("⑥ «직접 올리는 길» 링크를 끊으면 운다", (b) => {
  let n = inSeg(b, (s) => s.split("posts.html?status=awaiting_manual").join("posts.html?status=zz"));
  const before = b["public/app/piece.html"];
  b["public/app/piece.html"] = before.split("posts.html?status=awaiting_manual").join("posts.html?status=zz");
  if (b["public/app/piece.html"] !== before) n++;
  return n;
}, true);

/* ⑦ 화면이 «고칠 수 있다»고 보는 상태를 서버보다 좁힌다 — 손님이 고치면 발행 단추가 사라지는 그 고장 */
add("⑦ `EDITABLE_ST` 에서 `edited` 를 빼면 운다(서버는 승인해 주는데 화면이 안 보여 준다)", (b) =>
  inSeg(b, (s) => s.replace(/(EDITABLE_ST\s*=\s*\[)([^\]]*)\]/, (m, a, list) => a + list.replace(/"edited"\s*,?\s*/, "") + "]")), true);

/* ⑧ 정본↔생성물을 어긋내면 운다(AC-105) — «글자가 있나»가 아니라 **값을 견주나** */
add("⑧ 생성물의 `STUCK_ST` 를 정본과 다르게 하면 운다", (b) => {
  const before = b["public/app/piece.html"];
  b["public/app/piece.html"] = before.replace(/(STUCK_ST\s*=\s*\[)([^\]]*)\]/, '$1"zz_never"]');
  return b["public/app/piece.html"] === before ? 0 : 1;
}, true);

/* ⑨ 🔴 서버 쪽을 넓힌다 — 화면은 그대로인데 서버가 상태를 하나 더 받게 되면 **화면이 뒤처진 것**이다.
   이 축이 없으면 «서버는 되는데 화면이 안 되는» 자리가 다시 조용히 생긴다(§9). */
add("⑨ 서버 `REVIEW_PIECE_STATUSES` 에 상태를 하나 더하면 운다(화면이 뒤처졌다)", (b) => {
  const before = b["lib/content-approve.ts"];
  b["lib/content-approve.ts"] = before.replace(/(REVIEW_PIECE_STATUSES[^=]*=\s*\[)/, '$1"zz_new", ');
  return b["lib/content-approve.ts"] === before ? 0 : 1;
}, true);

/* ═══ 돌린다 ═══ */
console.log("🔴 A 의 자에 변이를 넣어 본다 — «자를 냈다»가 아니라 «우는가» · " + new Date().toISOString());
console.log("─".repeat(112));

const base = run(() => 1);
const baseOk = base.code === 0;
console.log(`  ${baseOk ? "✓" : "✗"} 대조군 — **멀쩡한 사본**에 A 의 자를 돌리면 통과한다 (종료코드 ${base.code})`);
if (!baseOk) {
  console.log("     🔴 대조군이 빨강이면 아래 변이가 울어도 그건 **변이 때문이 아니다**. 여기서 멈춘다.");
  console.log(base.out.split("\n").filter((l) => l.includes("🔴")).slice(0, 6).map((l) => "     " + l).join("\n"));
  process.exit(1);
}

let bad = 0;
for (const c of cases) {
  const r = run(c.transform);
  const cried = r.code !== 0;
  /* 🔴 **바뀐 줄 수를 찍는다**(AC-112) — 0줄이면 «자가 안 울었다»가 아니라 «내가 변이를 못 넣었다»다. */
  const planted = r.changed > 0;
  const ok = planted && cried === c.want;
  if (!ok) bad++;
  const why = !planted ? "🔴 **변이를 못 넣었다**(바뀐 줄 0) — 자를 잰 게 아니다"
    : cried === c.want ? `바뀐 줄 ${r.changed} · ${cried ? "울었다" : "안 울었다"}`
      : `바뀐 줄 ${r.changed} · 🔴 **안 울었다** — 이 자리는 초록으로 지나간다`;
  console.log(`  ${ok ? "✓" : "✗"} ${c.name}  — ${why}`);
  if (ok && cried) {
    const first = r.out.split("\n").find((l) => l.trim().startsWith("🔴"));
    if (first) console.log(`       ↳ 자가 한 말: ${first.trim().slice(0, 120)}`);
  }
}

console.log("─".repeat(112));
console.log(`■ 변이 ${cases.length}개 중 **제대로 운 것 ${cases.length - bad}개** · 안 운 것 ${bad}개`);
console.log("🔴 이 자는 제품을 재지 않는다 — **A 의 자를 잰다.** 제품이 다 고쳐져도 이 변이들은 살아 있다(AC-112 ⑥).");
process.exit(bad ? 1 : 0);
