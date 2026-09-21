/**
 * scripts/verify-requeue-guarded.mjs — 🔴 **잡을 다시 큐에 넣는 문이 몇이고, 그 문마다 채널에 물어보나**
 *   (C · 2026-09-22 · B2 의 AC-200 을 재다가 나왔다)
 *
 *   ══ 왜 이 자인가 ══
 *   B2 가 AC-200 에서 **중복 게시가 태어나는 자리**를 정확히 짚었다:
 *     러너가 claim → **글을 올린다** → 보고 전에 죽는다 → 잡이 `queued` 로 돌아간다 → 다른 러너가 집어 **또 올린다.**
 *   🔴 그 사고는 **우리 장부 안에서는 원리적으로 안 보인다** — 멱등 열쇠 `pieces.external_url` 은 «우리 기록»이고,
 *      보고가 없으면 비어 있는 것이 **정상**이기 때문이다. 그래서 되돌리기 **전에 채널에** 물어야 한다.
 *
 *   🔴 **그런데 B2 는 그 문을 하나만 막았다**(`reapStaleJobs`). 세어 보니 문이 **넷**이었다:
 *     · `lib/runner-jobs.ts reapStaleJobs`     — ✅ 막혔다(`reconcileLostPublish`)
 *     · `lib/runner-jobs.ts releaseJob`        — ❌ 러너가 «못 하겠다»고 놓을 때
 *     · `netlify/functions/ops-runners.ts` `release` — ❌ 운영자가 «놓아라»를 누를 때
 *     · `netlify/functions/ops-runners.ts` `remove`  — ❌ 운영자가 기기를 지울 때
 *   🔴 **운영자 쪽이 더 위험하다** — 사람은 «잡이 멈춰 보일 때» 그 단추를 누르는데,
 *      «올렸는데 보고를 못 했다»가 바로 그 «멈춰 보이는» 모양이다. 즉 **가장 위험한 순간에 누른다.**
 *
 *   ══ 🔴 왜 `publish()` 가 안 잡아 주나(이 자가 필요한 까닭) ══
 *   `lib/publish/index.ts` 는 ②-b 에서 채널에 묻는다. 그러나 **러너 채널의 두 번째 시도는 `publish()` 를 다시 안 탄다** —
 *   잡이 이미 `runner_jobs` 에 payload 째로 들어 있어서, 러너가 **그냥 집어서 올린다**. 그래서 문마다 따로 막아야 한다.
 *
 *   ══ 모수(AC-114 — 다음 사람이 수를 맞댈 수 있게) ══
 *   `runner_jobs` 의 status 를 **`queued` 로 되돌리는 SQL** 전부. 각 자리의 **감싼 함수**를 찾아 가른다:
 *     ㉮ `claimJobs` 안 = **내주기 전**이다. 러너가 그 잡을 **가진 적이 없으니** 올렸을 수도 없다 → 물을 것이 없다(✓).
 *     ㉯ 그 밖 = 러너가 **이미 가졌던** 잡이다 → 같은 함수 안에 `reconcileLostPublish` 가 있어야 한다.
 *   🔴 ㉮ 를 안 가르면 **맞는 코드 셋이 빨개지고**, 그런 자는 사람이 곧 무시한다(AC-112 ⑤).
 *
 *   ⚠️ **이 자가 못 재는 것**(AC-9): 물어본 뒤 **실제로 안 올라가는지**는 라이브 발행이 답한다.
 *      이 자는 «묻기는 하나»까지다. 그리고 `publish.*` 가 아닌 잡(렌더 등)은 중복 게시와 무관하다 — 그건 이 축 밖이다.
 *
 *   쓰는 법: node scripts/verify-requeue-guarded.mjs
 *   종료코드: 0 = 모든 문이 막혔다 · 1 = 안 막힌 문이 있다 · 2 = 못 쟀다.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const FILES = ["lib/runner-jobs.ts", "netlify/functions/ops-runners.ts"];
const GUARD = "reconcileLostPublish";
/** 🔴 «내주기 전»인 함수 — 러너가 그 잡을 가진 적이 없다. */
const PRE_HANDOUT = new Set(["claimJobs"]);

const read = (rel) => { const p = path.join(ROOT, rel); return existsSync(p) ? readFileSync(p, "utf8") : null; };
const missing = FILES.filter((f) => read(f) === null);
if (missing.length) { console.error(`⊘ 못 쟀어요 — 파일이 없다: ${missing.join(" · ")}`); process.exit(2); }

/** 그 줄을 감싼 «이름 있는 자리»를 위로 올라가며 찾는다(함수 · 또는 `action === "x"` 갈래). */
function enclosing(lines, idx) {
  for (let i = idx; i >= 0; i--) {
    const m = /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/.exec(lines[i]);
    if (m) return { kind: "function", name: m[1] };
  }
  return { kind: "?", name: "(못 찾음)" };
}
/** 운영 핸들러는 한 함수 안에 갈래가 여럿이라 **가장 가까운 `action === "x"`** 를 이름으로 쓴다. */
function nearestAction(lines, idx) {
  for (let i = idx; i >= 0 && i > idx - 40; i--) {
    const m = /action\s*===\s*"(\w[\w-]*)"/.exec(lines[i]);
    if (m) return m[1];
  }
  return null;
}
/** 감싼 함수의 몸통(대충 — 다음 최상위 `function` 까지)에 가드가 있나. */
function guardNear(lines, idx) {
  let start = 0;
  for (let i = idx; i >= 0; i--) if (/^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/.test(lines[i])) { start = i; break; }
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) if (/^(?:export\s+)?(?:async\s+)?function\s+\w+/.test(lines[i])) { end = i; break; }
  return lines.slice(start, end).join("\n").includes(GUARD);
}

/* ── 문을 센다 ────────────────────────────────────────────────────────── */
const REQUEUE = /status\s*=\s*'queued'/;
const doors = [];
for (const f of FILES) {
  const lines = read(f).split(/\r?\n/);
  lines.forEach((ln, i) => {
    if (!REQUEUE.test(ln)) return;
    if (!/UPDATE runner_jobs/.test(lines.slice(Math.max(0, i - 2), i + 1).join(" "))) return;   /* SELECT·COUNT 는 문이 아니다 */
    const fn = enclosing(lines, i);
    const act = nearestAction(lines, i);
    doors.push({ file: f, line: i + 1, fn: fn.name, action: act, pre: PRE_HANDOUT.has(fn.name), guarded: guardNear(lines, i) });
  });
}

console.log(`🔴 «잡을 다시 큐에 넣는 문»마다 채널에 물어보나 · ${new Date().toISOString()}`);
console.log("═".repeat(116));
console.log(`■ 내가 세는 모수 — \`UPDATE runner_jobs … status='queued'\` 를 쓰는 자리`);
console.log(`   본 파일 ${FILES.length}개(${FILES.join(" · ")}) · 찾은 문 **${doors.length}개**`);
console.log(`   가드로 치는 것: 같은 함수 안의 \`${GUARD}\` · «내주기 전»으로 봐 주는 함수: ${[...PRE_HANDOUT].join("·")}`);
console.log("");

if (!doors.length) { console.error("⊘ 못 쟀어요 — 문을 하나도 못 찾았다(정규식이 낡았을 수 있다 · 모수 0 을 통과로 쓰지 않는다)."); process.exit(2); }

let bad = 0;
for (const d of doors) {
  const who = `${d.file}:${d.line} ${d.fn}${d.action ? ` / action="${d.action}"` : ""}`;
  if (d.pre) { console.log(`  ✓ ${who}`); console.log(`       **내주기 전**이다 — 러너가 이 잡을 가진 적이 없으니 올렸을 수도 없다(물을 것이 없다)`); continue; }
  if (d.guarded) { console.log(`  ✓ ${who}`); console.log(`       되돌리기 전에 채널에 묻는다(\`${GUARD}\`)`); continue; }
  bad++;
  console.log(`  ✗ ${who}`);
  console.log(`       🔴 **러너가 이미 가졌던 잡을 채널에 안 물어보고 큐로 되돌린다** — 올려 놓고 보고 못 한 잡이면 **또 올라간다**(AC-200 그 사고)`);
}

console.log("═".repeat(116));
console.log(`■ 문 ${doors.length}개 — 막힌 것 ${doors.length - bad} · 🔴 **안 막힌 것 ${bad}**`);
console.log(`⊘ 이 자가 **못 재는 것**(AC-9): 물어본 뒤 실제로 안 올라가는지는 **라이브 발행이 답한다** — 여기는 «묻기는 하나»까지다.`);
process.exit(bad ? 1 : 0);
