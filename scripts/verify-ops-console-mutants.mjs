/**
 * scripts/verify-ops-console-mutants.mjs — 🔴 **내가 박은 다섯 줄이 정말 무는지 변이로 잰다**(A · AC-180/181 · 2026-09-21)
 *
 *   ══ 왜 이 자가 있나 ══
 *   운영 콘솔 두 장(`/ops/takedowns.html`·`/ops/proxies.html`)을 만들면서
 *   `scripts/verify-r8-deadends.mjs` 의 «화면이 부르나» 목록에 **다섯 줄**을 박았다.
 *   그런데 그 줄들은 **박자마자 초록**이었다 — 초록인 줄은 **문 적이 없다.**
 *   🔴 «자를 내면 스스로 변이를 넣어 본다 · 안 울면 변이를 먼저 의심한다»(메인 지시 2026-09-21 §4).
 *
 *   ══ 무엇을 재나 ══
 *   제품이 아니라 **자를 잰다.** 화면에서 그 API 를 부르는 자리를 하나씩 들어내고,
 *   **그 줄만** 빨개지는지 본다(다른 줄이 울면 그건 내 변이가 엉뚱한 데를 건드린 것이다).
 *
 *   ══ 🔴 변이는 사본에서만 ══
 *   자가 훑는 네 그루(`lib`·`netlify/functions`·`runner`·`public`)를 임시 폴더에 복사하고
 *   **그 폴더를 작업 폴더로** 삼아 자를 돌린다. 제품 파일 무접촉.
 *
 *   ══ 🔴 판정 모양(AC-161) ══
 *   «빨개졌나»로 재지 않는다. **대조군을 먼저 돌려** 그 줄이 초록인 것을 확인하고,
 *   변이 판에서 **그 줄이 · 그 줄만** 뒤집혔는지 본다. 대조군이 이미 빨가면 «변이 탓이라 말할 수 없다»고 적고 ✗ 한다.
 *   ⚠️ 정본(`_tpl.txt`)↔생성물 대조 줄은 **변이를 넣으면 당연히 운다**(생성물만 고치니까) — 그 줄은 셈에서 뺀다.
 *
 *   사용: node scripts/verify-ops-console-mutants.mjs
 *   종료코드: 0 = 변이마다 제 줄이 운다 · 1 = 안 우는 변이가 있다 · 2 = 못 쟀다.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, cpSync, copyFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dirname, "..");
const RULER = "scripts/verify-r8-deadends.mjs";
if (!existsSync(path.join(ROOT, RULER))) { console.error(`⊘ 못 쟀어요 — ${RULER} 가 없다.`); process.exit(2); }

/** 🔴 자가 훑는 그루를 **자 소스에서 뽑는다** — 손 목록은 낡는다(AC-113). */
const TREES = (() => {
  const src = readFileSync(path.join(ROOT, RULER), "utf8");
  const set = new Set();
  for (const m of src.matchAll(/walk\(\s*"([^"]+)"/g)) set.add(m[1]);
  return [...set];
})();
if (!TREES.length) { console.error("⊘ 못 쟀어요 — 자가 훑는 그루를 못 찾았다(자 구조가 바뀌었나)."); process.exit(2); }
for (const t of TREES) if (!existsSync(path.join(ROOT, t))) { console.error(`⊘ 못 쟀어요 — ${t} 가 없다.`); process.exit(2); }

/** 정본↔생성물 대조 줄 — 생성물만 고치는 변이에서는 당연히 운다. 셈에서 뺀다. */
const TPL_ROW = "정본(_tpl.txt)과 생성물이 안 어긋났다";

function run(transform) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ac-opsconsole-"));
  try {
    for (const t of TREES) cpSync(path.join(ROOT, t), path.join(dir, t), { recursive: true });
    mkdirSync(path.join(dir, "scripts"), { recursive: true });
    copyFileSync(path.join(ROOT, RULER), path.join(dir, RULER));
    const at = (f) => path.join(dir, f);
    const ctx = {
      changed: false,
      /** 파일 안 글자를 통째로 바꾼다 — 한 번도 안 바뀌면 «변이를 못 넣었다»로 적는다(AC-112 ①). */
      sub(file, from, to) {
        const p = at(file); if (!existsSync(p)) return;
        const s = readFileSync(p, "utf8");
        if (!s.includes(from)) return;
        writeFileSync(p, s.split(from).join(to), "utf8"); ctx.changed = true;
      },
      drop(file) { const p = at(file); if (!existsSync(p)) return; unlinkSync(p); ctx.changed = true; },
    };
    if (transform) transform(ctx);
    let out = "";
    try { out = execFileSync(process.execPath, [at(RULER), "--json"], { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); }
    catch (e) { out = String(e.stdout ?? ""); }
    let results = [];
    try { results = JSON.parse(out).results || []; } catch { /* 아래에서 «못 읽었다»로 잡힌다 */ }
    return { results, changed: ctx.changed };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** step 글자에 이 조각이 든 줄을 찾는다(줄 이름 전체를 베껴 두면 이름만 고쳐도 자가 조용히 죽는다). */
const rowOf = (results, needle) => results.find((r) => String(r.step).includes(needle));

const cases = [];
const add = (name, mustRed, transform) => cases.push({ name, mustRed, transform });
const TD = "public/ops/takedowns.html", PX = "public/ops/proxies.html";
const TPL = "public/ops/_tpl.txt";

/* ① 신고함·대기열을 부르는 자리를 들어낸다 */
add("① 내리기 목록 호출을 들어내면 «신고함·운영 대기열» 줄이 운다", "신고함·운영 대기열", (c) => {
  c.sub(TD, "/api/ops-takedowns", "/api/zz-gone-takedowns");
  c.sub(TPL, "/api/ops-takedowns", "/api/zz-gone-takedowns");
});
/* ② 단계(해제·정지·종결·기각) */
add("② 단계 실행 호출을 들어내면 «단계 실행» 줄이 운다", "단계 실행", (c) => {
  c.sub(TD, "/api/ops-takedown-action", "/api/zz-gone-action");
  c.sub(TPL, "/api/ops-takedown-action", "/api/zz-gone-action");
});
/* ③ 🔴 접수는 **접두사 문제** 때문에 응답 키로 잰다 — 그 키를 화면이 안 읽으면 울어야 한다 */
add("③ 접수 뒤 «예약 N건 멈춤»을 안 읽으면 «손으로 신고 접수» 줄이 운다", "손으로 신고 접수", (c) => {
  c.sub(TD, "stoppedSlots", "zzGoneSlots");
  c.sub(TPL, "stoppedSlots", "zzGoneSlots");
});
/* ④ IP 재고·목록 */
add("④ IP 목록 호출을 들어내면 «재고·목록» 줄이 운다", "재고·목록", (c) => {
  c.sub(PX, "/api/ops-proxies", "/api/zz-gone-proxies");
  c.sub(TPL, "/api/ops-proxies", "/api/zz-gone-proxies");
});
/* ⑤ IP 배정·해제 */
add("⑤ 배정·해제 호출을 들어내면 «배정·해제» 줄이 운다", "배정·해제", (c) => {
  c.sub(PX, "/api/ops-proxy-assign", "/api/zz-gone-assign");
  c.sub(TPL, "/api/ops-proxy-assign", "/api/zz-gone-assign");
});
/* ⑥ 🔴 화면 파일을 통째로 지운다 — «모의 층(public/js/mock-ops.js)이 대신 통과시키지 않나»를 본다.
      모의는 `/api/` 없이 라우트 이름만 갖고 있고, 이 줄들은 `public/(app|ops)/` 에서만 센다(needApp). 그걸 여기서 **재서** 확인한다. */
add("⑥ 화면 파일을 지우면 IP 줄 둘이 다 운다(모의 층이 대신 통과시키지 않는다)", "재고·목록", (c) => c.drop(PX), );

/* ═══ 돌린다 ═══ */
console.log(`🔴 내가 박은 «화면이 부르나» 다섯 줄에 변이를 넣어 본다 · ${new Date().toISOString()}`);
console.log("─".repeat(120));
console.log(`   사본 그루(자 소스에서 뽑았다): ${TREES.join(" · ")}`);

const base = run(null);
if (!base.results.length) { console.log("  ✗ 대조군 — 자가 --json 을 안 냈다(자 구조가 바뀌었나). 여기서 멈춘다."); process.exit(2); }
const baseRed = base.results.filter((r) => r.ok === false);
if (baseRed.length) {
  console.log(`  ✗ 대조군 — 멀쩡한 사본인데 이미 빨간 줄이 ${baseRed.length}개 있다. 여기서 멈춘다.`);
  for (const r of baseRed.slice(0, 6)) console.log(`     ✗ ${r.step}`);
  process.exit(1);
}
console.log(`  ✓ 대조군 — 멀쩡한 사본이면 ${base.results.length}줄 전부 통과한다(빨강 0)`);
console.log("");

let bad = 0;
for (const c of cases) {
  const r = run(c.transform);
  if (!r.changed) { console.log(`  ✗ ${c.name}\n       🔴 **변이를 못 넣었다**(파일이 안 바뀜) — 자를 잰 게 아니다(AC-112 ①)`); bad++; continue; }
  const before = rowOf(base.results, c.mustRed), after = rowOf(r.results, c.mustRed);
  if (!before || !after) { console.log(`  ✗ ${c.name}\n       🔴 «${c.mustRed}» 라는 줄을 못 찾았다 — 줄 이름이 바뀌었나`); bad++; continue; }
  if (before.ok !== true) { console.log(`  ✗ ${c.name}\n       🔴 **대조군에서도 그 줄이 초록이 아니다** — 변이 탓이라 말할 수 없다`); bad++; continue; }
  /* 🔴 «울었나»만 보지 않는다 — **딴 줄까지 우는지**도 본다(내 변이가 엉뚱한 데를 건드렸으면 그것도 고장이다). */
  const others = r.results.filter((x) => x.ok === false && !String(x.step).includes(c.mustRed) && !String(x.step).includes(TPL_ROW));
  const ok = after.ok === false;
  if (!ok) bad++;
  console.log(`  ${ok ? "✓" : "✗"} ${c.name}`);
  console.log(`       ${ok ? "울었다" : "🔴 **안 울었다**"} — 대조군 ✓ → 변이 판 ${after.ok === false ? "✗" : "✓"} · 곁다리로 운 줄 ${others.length}개${others.length ? `(${others.map((x) => String(x.step).slice(0, 34)).join(" · ")})` : ""}`);
  if (ok && others.length) console.log(`       🔸 곁다리가 있다 — 변이가 한 줄만 건드리는지 다시 봐라(여기선 같은 화면의 다른 줄이면 정상이다)`);
}

console.log("─".repeat(120));
console.log(`■ 변이 ${cases.length}개 중 **제 줄로 운 것 ${cases.length - bad}개** · 어긋난 것 ${bad}개`);
console.log("🔴 이 자는 제품을 재지 않는다 — **verify-r8-deadends 의 새 다섯 줄을 잰다.**");
process.exit(bad ? 1 : 0);
