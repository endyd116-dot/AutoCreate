/**
 * scripts/verify-pause-pair.mjs — 🔴 **«둘이 짝이다»가 진짜인가 — 그 말 자체를 잰다**
 *   (C · 2026-09-23 · AC-233)
 *
 *   ══ 왜 이 자인가 ══
 *   A 가 `verify-pause-surface`(화면 6축) 끝에 이렇게 적었다:
 *     «둘이 짝이다(한쪽만 초록이면 손님에겐 아무것도 안 닿는다)»
 *   🔴 **그건 주장이다.** 그리고 근거가 있다 — 둘이 **각자 초록인 채로** «저절로 깬 손님이 아무것도 못 보는» 구멍이
 *   실제로 열려 있었고, B 가 ⑧축을 A 가 두 줄을 **각각** 닫았다. **그 사이가 다시 비지 않는다는 보장이 없다.**
 *
 *   ══ 🔴 «짝»이란 무엇인가 — 재려면 먼저 정해야 한다 ══
 *   두 자가 **짝**이라면, 손님에게 닿는 길 위의 **어느 한 겹을 끊어도 둘 중 하나는 운다**.
 *   끊었는데 **둘 다 초록**이면 그 겹은 **아무도 안 보는 사이**다 — 짝이 아니라 **따로 도는 자 둘**이다.
 *   ⇒ 그래서 이 자는 **제품을 끊고 두 자를 같이 돌린다.**
 *
 *   ══ 재는 법 ══
 *   겹마다 ㉮제품 파일 한 자리를 **망가뜨리고**(사본에서) ㉯`verify-pause-scope` 와 `verify-pause-surface` 를
 *   **둘 다** 돌려 ㉰**누가 우는가**를 적는다.
 *     ✓ 둘 중 하나라도 운다       → 그 겹은 **덮여 있다**
 *     🔴 ✗ 둘 다 초록            → **사이가 비었다**(이 자가 찾는 것)
 *     ⊘ 대조군부터 빨갛다/변이를 못 넣었다 → 못 쟀음(AC-9·AC-112 ①)
 *
 *   ══ 🔴 이 자가 재지 **않는** 것 ══
 *   «두 자가 겹치나»(같은 것을 두 번 세나)는 **낭비**일 뿐 사고가 아니다 — 이 자는 **빈 곳**만 찾는다.
 *   그리고 **라이브에서 실제로 손님이 보나**는 화면·사람이 답한다(여기는 «코드가 이어져 있나»까지다).
 *
 *   쓰는 법: node scripts/verify-pause-pair.mjs
 *   종료코드: 0 = 빈 겹 0 · 1 = 빈 겹이 있다 · 2 = 못 쟀다.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ARENA = path.join(ROOT, "_verify", `pause-pair-${process.pid}`);   /* 🔴 프로세스마다 나눈다(AC-210 ③) */
const SCOPE = "scripts/verify-pause-scope.mjs";      /* B · 서버 */
const SURF = "scripts/verify-pause-surface.mjs";     /* A · 화면 */
/** 두 자가 읽는 나무 — 통째로 옮긴다(AC-190: 사본이 **돌아가야** 잰다) */
const TREES = ["scripts", "lib", "netlify", "public", "db"];

for (const f of [SCOPE, SURF]) if (!existsSync(path.join(ROOT, f))) { console.error(`⊘ 못 쟀어요 — ${f} 가 없다.`); process.exit(2); }

let seq = 0;
/** 사본을 짓고 `transform` 으로 망가뜨린 뒤 **두 자를 다 돌린다**. */
function run(transform) {
  const dir = path.join(ARENA, `m${seq++}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const t of TREES) cpSync(path.join(ROOT, t), path.join(dir, t), { recursive: true });
  let changed = true;
  if (transform) {
    const box = new Map();
    const get = (rel) => { if (!box.has(rel)) box.set(rel, readFileSync(path.join(dir, rel), "utf8")); return box.get(rel); };
    const set = (rel, v) => box.set(rel, v);
    const before = JSON.stringify([...box]);
    transform(get, set);
    changed = JSON.stringify([...box]) !== before;
    for (const [rel, v] of box) writeFileSync(path.join(dir, rel), v);
  }
  /* 🔴 **사본이 돌아가게 세운다**(AC-190 «사격장이 없으면 못 잰다»).
     ㉮ A 의 화면 자는 playwright 를 **형제 리포**(`../AutoMarketing`)에서 상대 경로로 찾는다 — 사본은 한 칸 더 깊어
        그대로 두면 **대조군부터 종료코드 2** 가 된다(실제로 밟았다). ⇒ `PW_DIR` 을 **절대 경로로 못 박는다.**
     ㉯ 그 자는 포트 8931 을 연다 — 변이마다 새로 여니 **겹치면 옛 판이 답한다**(그 자 주석이 경고한 그 병).
        ⇒ 변이마다 **다른 포트**를 준다. */
  const PW_DIR = path.resolve(ROOT, "../AutoMarketing");
  const out = {};
  for (const [name, rel] of [["scope", SCOPE], ["surf", SURF]]) {
    const env = { ...process.env, PW_DIR, PORT: String(9200 + seq * 2 + (name === "surf" ? 1 : 0)) };
    try { execFileSync(process.execPath, [path.resolve(dir, rel)], { cwd: dir, encoding: "utf8", timeout: 180_000, stdio: ["ignore", "pipe", "pipe"], env }); out[name] = 0; }
    catch (e) { out[name] = e.status ?? -1; }
  }
  rmSync(dir, { recursive: true, force: true });
  return { ...out, changed };
}

/* ── 🔴 손님에게 닿는 길의 «겹» — 하나씩 끊어 본다 ─────────────────────────
   길: 크론이 안 돈다 → 서버가 «쉬는 중 · 밀린 글 N» 을 **실어 준다** → 화면이 그 줄을 **그린다**.
   겹 하나를 끊으면 **둘 중 하나는 울어야** 짝이다. */
const layers = [];
const add = (name, transform, why, target = null) => layers.push({ name, transform, why, target });

/** 🔴 **과녁이 살아 있나** — 변이를 넣기 전에 «그 글자가 제품에 몇 곳인가»를 찍는다(AC-236).
 *  첫 판이 «빈 겹 4」를 냈는데 **전부 내 변이가 허공을 친 것**이었다: `paused` 를 바꿨는데 그 파일에 그 글자가 **0곳**이었다.
 *  🔴 «0」이면 아무도 안 믿지만 **«4」는 발견처럼 보인다** — 그대로 보고했으면 없는 구멍을 메우러 세 창이 갔을 것이다.
 *  ⇒ **0 이면 그건 변이가 아니라 오타다.** 여기서 멈춘다. */
function targetAlive(t) {
  if (!t) return null;
  const [rel, word] = t;
  let n = 0;
  /* 🔴 과념은 다 평문이라 `split` 으로 센다 — 정규식을 짓지 않는다(이스케이프가 깨지는 자리다 · AC-100). */
  try { n = readFileSync(path.join(ROOT, rel), "utf8").split(word).length - 1; } catch { n = -1; }
  return { rel, word, n };
}

/* 🔴 **첫 판은 변이가 허공을 쳤다 — 먼저 밟은 것을 적어 둔다.**
   `paused` 라는 글자를 바꿨는데 `netlify/functions/tenant-settings.ts` 에 그 글자는 **0곳**이었다.
   그래서 «빈 겹 4」가 나왔는데 **그건 제품이 아니라 내 변이의 상태**였다(AC-112 ①: «안 울면 변이부터 의심하라»).
   실제 이름은 `pause: await loadPause(` · `backlog: { count: … }` · `stopsWhenPaused` 다.
   ⇒ 아래 변이는 전부 **자가 실제로 찾는 글자**를 과녁으로 삼는다. */

add("① 설정 응답에서 `loadPause` 를 들어낸다",
  (get, set) => { set("netlify/functions/tenant-settings.ts", get("netlify/functions/tenant-settings.ts").split("loadPause").join("zzLoadPause")); },
  "손님 화면이 «쉬는 중»인지 알 길이 통째로 사라진다", ["netlify/functions/tenant-settings.ts", "loadPause"]);

add("② 홈 응답에서 `loadPause` 를 들어낸다",
  (get, set) => { set("netlify/functions/home-summary.ts", get("netlify/functions/home-summary.ts").split("loadPause").join("zzLoadPause")); },
  "홈 첫 화면의 «쉬는 중 · N일째»가 못 뜬다(§5B.11(3) «까먹을 수가 없어야 한다»)", ["netlify/functions/home-summary.ts", "loadPause"]);

add("③ 🔴 **계약(`PauseView`)에서 `backlog` 를 지운다**",
  (get, set) => { set("lib/tenant-pause.ts", get("lib/tenant-pause.ts").split("backlog").join("zzBacklog")); },
  "저절로 깬 손님이 «그동안 밀린 글»을 못 본다 — **실제로 열려 있던 그 구멍이다**", ["lib/tenant-pause.ts", "backlog"]);

add("④ 설정 화면이 «쉬는 중» 줄을 안 그린다",
  (get, set) => { set("public/app/settings.html", get("public/app/settings.html").split("pause").join("zzPause")); },
  "서버가 실어 줘도 손님 눈에는 아무것도 없다", ["public/app/settings.html", "pause"]);

add("⑤ 홈 화면이 그 배너를 안 그린다",
  (get, set) => { set("public/app/home.html", get("public/app/home.html").split("pause").join("zzPause")); },
  "홈에서 «쉬는 중»이 사라진다", ["public/app/home.html", "pause"]);

add("⑥ 크론이 `stopsWhenPaused` 를 안 본다",
  (get, set) => { set("lib/cron/base.ts", get("lib/cron/base.ts").split("stopsWhenPaused").join("zzStops")); },
  "쉬는 집에서도 크론이 그대로 돈다 — «멈춤»이 아무것도 안 멈춘다", ["lib/cron/base.ts", "stopsWhenPaused"]);

/* ── 돌린다 ───────────────────────────────────────────────────────────── */
console.log(`🔴 «둘이 짝이다»가 진짜인가 — 겹을 하나씩 끊고 **두 자를 같이** 돌린다 · ${new Date().toISOString()}`);
console.log("═".repeat(112));
console.log(`■ 내가 세는 모수 — 손님에게 닿는 길의 겹 **${layers.length}개**`);
console.log(`   자 둘: \`${path.basename(SCOPE)}\`(B · 서버) ↔ \`${path.basename(SURF)}\`(A · 화면)`);
console.log(`   🔴 판정: 겹을 끊었을 때 **둘 다 초록이면 그 겹은 아무도 안 본다**(= 짝이 아니라 따로 도는 자 둘)`);
console.log("");

/* 🔴 **변이를 넣기 전에 과녁부터 찍는다**(AC-236) — 0 이면 그건 변이가 아니라 오타다. */
{
  const dead = [];
  console.log("■ 🔴 과녁이 살아 있나(변이를 넣기 전에 먼저 센다 · AC-236)");
  for (const L of layers) {
    const t = targetAlive(L.target);
    if (!t) { console.log(`   ⊘ ${L.name} — 과녁을 안 적었다`); continue; }
    console.log(`   ${t.n > 0 ? "✓" : "✗"} ${t.rel} 에 «${t.word}» ${t.n}곳`);
    if (t.n <= 0) dead.push(`${t.rel} «${t.word}»`);
  }
  if (dead.length) {
    console.error(`⊘ 못 쟀어요 — 🔴 **과녁이 죽은 변이 ${dead.length}개**(${dead.join(" · ")}). 이건 변이가 아니라 **오타**다.`);
    console.error(`   첫 판이 그렇게 «빈 겹 4»를 냈고, 그건 제품이 아니라 **내 변이의 상태**였다(AC-236).`);
    rmSync(ARENA, { recursive: true, force: true });
    process.exit(2);
  }
  console.log("");
}

const base = run(null);
if (base.scope !== 0 || base.surf !== 0) {
  console.error(`⊘ 못 쟀어요 — 대조군부터 초록이 아니다(scope=${base.scope} · surf=${base.surf}). 여기서 멈춘다(AC-161).`);
  rmSync(ARENA, { recursive: true, force: true });
  process.exit(2);
}
console.log(`  ✓ 대조군 — 멀쩡한 사본에서 **둘 다 종료코드 0**`);
console.log("");

let gap = 0, unmeasured = 0;
for (const L of layers) {
  const r = run(L.transform);
  if (!r.changed) { unmeasured++; console.log(`  ⊘ ${L.name}\n       **변이를 못 넣었다**(파일이 안 바뀜) — 잰 게 아니다(AC-112 ①)`); continue; }
  const who = [r.scope !== 0 ? "서버 자" : null, r.surf !== 0 ? "화면 자" : null].filter(Boolean);
  if (!who.length) {
    gap++;
    console.log(`  ✗ ${L.name}`);
    console.log(`       🔴 **둘 다 초록이다 — 이 겹은 아무도 안 본다.** ${L.why}`);
    continue;
  }
  console.log(`  ✓ ${L.name}`);
  console.log(`       ${who.join(" · ")}가 운다(scope=${r.scope} · surf=${r.surf}) — 이 겹은 덮여 있다`);
}

console.log("═".repeat(112));
console.log(`■ 겹 ${layers.length}개 — 덮인 것 ${layers.length - gap - unmeasured} · 🔴 **빈 겹 ${gap}** · ⊘ 못 쟀음 ${unmeasured}`);
console.log(`🔴 이 자는 제품을 재지 않는다 — **«둘이 짝이다»라는 말을 잰다.**`);
console.log(`⊘ 못 재는 것(AC-9): 라이브에서 **손님이 실제로 보나**는 화면·사람이 답한다 — 여기는 «코드가 이어져 있나»까지다.`);
rmSync(ARENA, { recursive: true, force: true });
process.exit(gap ? 1 : unmeasured ? 2 : 0);
