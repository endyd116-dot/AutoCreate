/**
 * scripts/verify-requeue-guarded.mjs — 🔴 **잡을 다시 큐에 넣는 문이 몇이고, 그 문마다 채널에 물어보나**
 *   (C · 2026-09-22 · B2 의 AC-200 을 재다가 나왔다 → AC-214 · 🔴 **2026-09-22 둘째 판에 눈이 멀었던 것을 고쳤다** → AC-216)
 *
 *   ══ 왜 이 자인가 ══
 *   러너가 claim → **글을 올린다** → 보고 전에 죽는다 → 잡이 `queued` 로 돌아간다 → 다른 러너가 집어 **또 올린다.**
 *   🔴 그 사고는 **우리 장부 안에서 원리적으로 안 보인다** — 멱등 열쇠 `pieces.external_url` 은 «우리 기록»이고,
 *      보고가 없으면 **비어 있는 것이 정상**이다. 그래서 되돌리기 **전에 채널에** 물어야 한다(`reconcileLostPublish`).
 *   🔴 그리고 **`publish()` 가 안 잡아 준다** — 러너 채널의 **두 번째 시도는 `publish()` 를 다시 안 탄다**
 *      (잡이 payload 째 큐에 있어 러너가 그냥 집어서 올린다). ⇒ **문마다 따로** 막아야 한다.
 *
 *   ══ 🔴 이 자가 한 번 **거짓 초록**이었다 — 그게 이 머리말의 값이다(AC-216) ══
 *   첫 판은 몸통을 「위로 `function 이름` · 아래로 다음 `function`」으로 잡았다. 그런데
 *   `netlify/functions/ops-runners.ts` 의 핸들러는 **화살표 함수**라 위로 올라가도 `function` 이 안 나와
 *   **몸통이 파일 전체**가 됐다 ⇒ 맨 위 `import { reconcileLostPublish }` **한 줄**이 그 파일의
 *   **모든 문을 영원히 초록**으로 만들었다. B2 가 변이로 찾아 줬고(2026-09-22), 내가 대조군으로 재현했다:
 *     · 대조군 종료코드 0 · 빨강 0
 *     · 🔴 **ops 의 «호출»만 지워도** 종료코드 0 · 빨강 0   ← 1 이어야 했다
 *     · ops 의 import 까지 지우면 종료코드 1 · 빨강 2       ← 그제야 운다
 *   🔴 **«경계를 못 찾았다»를 «파일 전체»로 떨어뜨린 것이 병의 뿌리다.** 못 찾으면 **«못 쟀음»**이 맞다.
 *
 *   ══ 그래서 지금은 이렇게 잰다 ══
 *     ① 주석·문자열을 **같은 길이의 공백**으로 지운 판에서 **중괄호를 맞춰** 감싼 블록을 찾는다
 *        (주석을 안 지우면 «좋은 주석이 자를 눈멀게 한다» · AC-191).
 *     ② 가드는 **그 안쪽 블록** 안에 있어야 한다 — 파일도, 핸들러 전체도 아니다.
 *     ③ 🔴 다만 **한 겹은 따라간다** — B2 의 가드는 `reconcileClaimed()` 라는 **도우미 화살표 함수**를 거친다.
 *        문법이 아니라 **값의 흐름**으로 세지 않으면 **맞는 코드가 빨개진다**(AC-141 ① · AC-112 ⑤).
 *     ④ 🔴 경계나 이름을 못 읽으면 **⊘(못 쟀음)** 이고 **종료코드 2** 다 — 초록이 아니다.
 *
 *   ══ 모수(AC-114) ══
 *   `UPDATE runner_jobs … status='queued'` 를 쓰는 자리 전부. 각 자리를 감싼 블록으로 가른다:
 *     ㉮ `claimJobs` 안(바깥으로 올라가며 본다) = **내주기 전**. 러너가 그 잡을 **가진 적이 없으니** 올렸을 수도 없다(✓).
 *     ㉯ 그 밖 = 러너가 **이미 가졌던** 잡 → 그 블록 안에 가드가 있어야 한다(한 겹 따라가기 포함).
 *
 *   ⚠️ **이 자가 못 재는 것**(AC-9): 물어본 뒤 **실제로 안 올라가는지**는 라이브 발행이 답한다 — 여기는 «묻기는 하나»까지다.
 *
 *   쓰는 법: node scripts/verify-requeue-guarded.mjs
 *   종료코드: 0 = 모든 문이 막혔다 · 1 = 안 막힌 문이 있다 · 2 = 못 쟀다(⊘ 가 하나라도 있으면 2).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const FILES = ["lib/runner-jobs.ts", "netlify/functions/ops-runners.ts"];
const GUARD = "reconcileLostPublish";
/** 🔴 «내주기 전»인 함수 — 러너가 그 잡을 가진 적이 없다. */
const PRE_HANDOUT = new Set(["claimJobs"]);
/** 도우미 한 겹 따라갈 때 건너뛰는 이름(문법 낱말·흔한 도구) */
const NOT_HELPERS = new Set(["if", "for", "while", "switch", "catch", "return", "await", "typeof", "q", "sql", "json", "jsonb", "n", "String", "Number", "Math", "Object", "Array", "console", "require"]);

const read = (rel) => { const p = path.join(ROOT, rel); return existsSync(p) ? readFileSync(p, "utf8") : null; };
const missing = FILES.filter((f) => read(f) === null);
if (missing.length) { console.error(`⊘ 못 쟀어요 — 파일이 없다: ${missing.join(" · ")}`); process.exit(2); }

/** 주석·문자열 **속**을 같은 길이의 공백으로 지운다(자리를 안 흔든다 · 따옴표와 줄바꿈은 남긴다). */
function blank(src) {
  const out = src.split("");
  let i = 0, st = null, q = "";
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (!st) {
      if (c === "/" && d === "*") { st = "block"; out[i] = out[i + 1] = " "; i += 2; continue; }
      if (c === "/" && d === "/") { st = "line"; out[i] = out[i + 1] = " "; i += 2; continue; }
      if (c === '"' || c === "'" || c === "`") { st = "str"; q = c; i++; continue; }
      i++; continue;
    }
    if (st === "block") { if (c === "*" && d === "/") { out[i] = out[i + 1] = " "; st = null; i += 2; continue; } if (c !== "\n") out[i] = " "; i++; continue; }
    if (st === "line") { if (c === "\n") { st = null; i++; continue; } out[i] = " "; i++; continue; }
    if (c === "\\") { out[i] = " "; if (src[i + 1] !== "\n") out[i + 1] = " "; i += 2; continue; }
    if (c === q) { st = null; i++; continue; }
    if (c !== "\n") out[i] = " ";
    i++;
  }
  return out.join("");
}

/** 그 자리를 감싼 **가장 안쪽 블록**의 [열린자리, 닫힌자리+1] — 못 찾으면 null. */
function innerBlock(bsrc, pos) {
  let depth = 0, open = -1;
  for (let i = pos; i >= 0; i--) {
    const c = bsrc[i];
    if (c === "}") depth++;
    else if (c === "{") { if (!depth) { open = i; break; } depth--; }
  }
  if (open < 0) return null;
  depth = 0;
  for (let i = open; i < bsrc.length; i++) {
    const c = bsrc[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (!depth) return [open, i + 1]; }
  }
  return null;
}

const CONTROL = new Set(["if", "for", "while", "switch", "catch", "try", "else", "do", "return"]);

/** 블록을 연 **앞부분**에서 이름을 읽는다. `fnOnly` 면 «함수 같은 것»만(갈래·제어문은 null).
 *  🔴 꼬리를 느슨하게 둔다 — 타입스크립트의 **반환 타입에 중괄호가 있다**:
 *     `export async function reapStaleJobs(…): Promise<{ released: number; … }> {`
 *     첫 판은 `\)[^{]*$` 라 저 `Promise<{` 에 걸려 **이름을 영영 못 읽었다**(AC-113 그 얼굴).
 *  ⇒ 앞부분에서 **후보를 다 찾아 가장 뒤엣것**을 쓴다(안쪽에서 바깥으로 올라오므로 그게 주인이다). */
function nameOf(bsrc, open, fnOnly = false) {
  const head = bsrc.slice(Math.max(0, open - 420), open).replace(/\s+$/, "");
  const best = (re, kind, fn) => {
    let last = null;
    for (const m of head.matchAll(re)) last = m;
    return last ? { name: last[1], kind, fn, at: last.index } : null;
  };
  const cands = [
    best(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g, "함수", true),
    best(/(?:const|let|var)\s+(\w+)[^=\n]*=\s*(?:async\s*)?\(/g, "화살표", true),
  ].filter(Boolean);
  /* 화살표 후보는 뒤에 `=>` 가 실제로 있어야 한다 */
  const arrowOk = /=>\s*$/.test(head);
  let pick = null;
  for (const c of cands) {
    if (c.kind === "화살표") {
      if (!arrowOk) continue;
      /* 🔴 화살표는 **후보와 이 중괄호 사이에 `;`·`}` 가 없어야** 제 것이다 — 그냥 «가장 뒤엣것»을 집으면
         `export default async (req) => {` 의 주인을 엉뚱한 `const n = (…) =>` 로 읽는다(실제로 밟았다).
         🔴 **함수 선언에는 이 거르기를 안 건다** — `): Promise<{ a: number; b: number }> {` 처럼
            **타입 주석 안에 `;`·`}` 가 정당하게** 들어간다(한 판 그걸로 다섯을 ⊘ 로 떨궜다). */
      if (/[;}]/.test(head.slice(c.at))) continue;
    }
    if (!pick || c.at > pick.at) pick = c;
  }
  if (pick) return pick;
  if (arrowOk) return { name: "(이름 없는 화살표)", kind: "화살표", fn: true };
  if (fnOnly) return null;
  let m;
  if ((m = /action\s*===\s*"([\w-]+)"\s*\)$/.exec(head))) return { name: `action="${m[1]}"`, kind: "갈래", fn: false };
  if ((m = /(?:^|[\s;{}])(\w+)\s*\([^)]*\)\s*(?::[^{]*)?$/.exec(head))) {
    /* 🔴 `if (…) {` 를 «메서드»로 읽으면 안 된다 — 한 판이 그래서 `claimJobs` 를 못 찾고 셋을 거짓 빨강으로 찍었다. */
    if (CONTROL.has(m[1])) return { name: m[1], kind: "제어", fn: false };
    return { name: m[1], kind: "메서드", fn: true };
  }
  return null;
}

/** 🔴 그 갈래가 **제 자리에서** `return` 으로 끝나나 — 중첩된 화살표 안의 `return` 은 세지 않는다.
 *  실제로 밟았다(2026-09-22 C): `reapStaleJobs` 의 가드가 `.catch((e) => { …; return null; })` 를 달고 있어서
 *  «이 갈래는 return 으로 끝난다»로 읽혔고, 그래서 **가드를 건너뛰어 거짓 빨강**이 났다.
 *  🔴 `return` 이라는 **글자**가 아니라 **그 글자가 어느 깊이에 있나**가 뜻을 정한다. */
function topLevelReturn(block) {
  let depth = 0;
  for (let i = 0; i < block.length; i++) {
    const c = block[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 1 && block.startsWith("return", i) && !/\w/.test(block[i - 1] ?? " ") && !/\w/.test(block[i + 6] ?? " ")) return true;
  }
  return false;
}

/** 이 글 토막 안에 가드가 있나 — 없으면 **한 겹만** 도우미를 따라간다(AC-141 ① «값의 흐름으로 세라»). */
function hasGuard(bsrc, text, base = 0) {
  /* 🔴 **선언은 «지나간 것»이 아니다.** 내 변이 ⑤가 이걸 잡아 줬다(2026-09-22):
     ops 핸들러 안에 `const reconcileClaimed = async () => { … reconcileLostPublish( … ) }` 가 **선언**돼 있어서,
     그 아래 아무 데나 새 문을 심어도 «앞에 가드가 있다»로 읽혀 **초록**이 됐다.
     ⇒ 글자가 **중첩된 함수 몸통 안**에 있으면 직접 히트로 안 센다. 그건 **부를 때만** 지나간다(한 겹 따라가기가 그 몫이다). */
  const nestedInFn = (abs) => {
    let r = innerBlock(bsrc, abs);
    for (let k = 0; k < 10 && r; k++) {
      if (r[0] < base) return false;                 /* 이 토막 밖까지 올라왔다 = 중첩이 아니다 */
      const nm = nameOf(bsrc, r[0]);
      if (nm && nm.fn) return true;
      if (r[0] <= 0) return false;
      r = innerBlock(bsrc, r[0] - 1);
    }
    return false;
  };
  const p = text.indexOf(GUARD);
  if (p >= 0 && !nestedInFn(base + p)) return { ok: true, via: "직접", at: p };
  for (const m of text.matchAll(/\b(\w+)\s*\(/g)) {
    const fn = m[1];
    if (NOT_HELPERS.has(fn) || CONTROL.has(fn)) continue;
    const re = new RegExp("(?:const|let|var)\\s+" + fn + "\\s*(?::[^=]*)?=|(?:async\\s+)?function\\s+" + fn + "\\s*\\(");
    const decl = re.exec(bsrc);
    if (!decl) continue;
    const brace = bsrc.indexOf("{", decl.index);
    /* 🔴 **그 중괄호가 정말 그 도우미의 몸통인가.** 한 줄짜리 화살표(`const routeOf = (r) => new URL(r.url).pathname;`)는
       몸통 중괄호가 **없어서**, 그냥 «다음 `{`» 를 집으면 **한참 뒤 남의 함수 몸통**을 그 도우미로 읽는다.
       실제로 밟았다(2026-09-22 C · 내 변이 ⑤가 잡았다): `routeOf()` 를 거쳐 초록이 났는데 `routeOf` 는 가드와 무관하다.
       ⇒ 선언과 그 중괄호 **사이에 `;` 가 있으면** 남의 것이다. */
    const semi = bsrc.indexOf(";", decl.index);
    if (brace < 0 || (semi >= 0 && semi < brace)) continue;
    const r = innerBlock(bsrc, brace + 1);
    if (r && bsrc.slice(r[0], r[1]).includes(GUARD)) return { ok: true, via: `\`${fn}()\` 를 거쳐`, at: m.index };
  }
  return { ok: false };
}

/**
 * 🔴 **그 문에 닿기 전에 가드를 지나나** — 이 자의 심장이다.
 *   첫 판은 «같은 함수 어디에나 있으면 초록»이라 **파일 전체**가 됐고(거짓 초록),
 *   고치다 «가장 안쪽 블록에만»으로 갔더니 이번엔 `reapStaleJobs` 가 **거짓 빨강**이 됐다
 *   (가드가 **앞 갈래**에 있고 requeue 는 **다음 갈래**에 있다 — 순서대로 지나가는 코드다).
 *   ⇒ 안쪽에서 바깥으로 올라가며 **«그 문보다 앞서는 부분»만** 본다. 함수 경계에서 멈춘다.
 *   🔴 **앞에 있어도 `return` 으로 끝나는 옆 갈래 안의 가드는 안 센다** — 거기로 갔으면 이 문에 못 온다.
 */
function guardBefore(bsrc, reqPos) {
  let cur = innerBlock(bsrc, reqPos), childStart = reqPos;
  for (let k = 0; k < 12 && cur; k++) {
    const prefix = bsrc.slice(cur[0] + 1, childStart);
    let scan = prefix, base = cur[0] + 1;
    for (let t = 0; t < 8; t++) {
      const g = hasGuard(bsrc, scan, base);
      if (!g.ok) break;
      const abs = base + g.at;
      const own = innerBlock(bsrc, abs);
      /* 그 가드가 **옆 갈래 안**인데 그 갈래가 `return` 으로 끝나면 — 거기로 갔으면 여기 못 온다 */
      const sideBranch = own && own[0] > cur[0] && own[1] <= childStart;
      if (sideBranch && topLevelReturn(bsrc.slice(own[0], own[1]))) {
        base = own[1]; scan = bsrc.slice(base, childStart); continue;   /* 그 갈래를 건너뛰고 더 본다 */
      }
      return { ok: true, via: g.via };
    }
    const nm = nameOf(bsrc, cur[0]);
    if (nm && nm.fn) break;                       /* 🔴 함수 경계에서 멈춘다 — 그 너머는 «앞서 지난 곳»이 아니다 */
    if (cur[0] <= 0) break;
    childStart = cur[0];
    cur = innerBlock(bsrc, cur[0] - 1);
  }
  return { ok: false };
}

/* ── 문을 센다 ────────────────────────────────────────────────────────── */
const REQUEUE = /status\s*=\s*'queued'/;
const doors = [];
for (const f of FILES) {
  const raw = read(f);
  /* 🔴 **문은 원문에서 찾고, 경계·가드는 지운 판에서 본다.**
     첫 판은 둘 다 지운 판에서 했다가 **문을 0개** 찾았다 — SQL 이 템플릿 문자열 안이라 내가 지워 버린 것이다.
     그때 자가 «모수 0»을 초록으로 안 쓰고 **종료코드 2 로 멈춘 덕에** 바로 보였다(AC-141 ② 가 제 값을 했다).
     `blank()` 가 **길이를 안 흔드므로** 두 판의 자리는 그대로 맞는다. */
  const bsrc = blank(raw);
  const rawLines = raw.split("\n");
  const lines = bsrc.split("\n");
  let off = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const ln = rawLines[i], at = off;
    off += ln.length + 1;
    if (!REQUEUE.test(ln)) continue;
    if (!/UPDATE runner_jobs/.test(rawLines.slice(Math.max(0, i - 2), i + 1).join(" "))) continue;   /* SELECT·COUNT 는 문이 아니다 */
    const range = innerBlock(bsrc, at);
    if (!range) { doors.push({ file: f, line: i + 1, why: "감싼 블록을 못 찾았다(중괄호가 안 맞는다)" }); continue; }
    /* 🔴 **감싼 «함수»를 바깥으로 올라가며** 찾는다 — `if` 갈래 안이어도 그 함수 이름으로 부른다.
       첫 판은 `if (…)` 를 «메서드»로 읽어 `claimJobs` 를 영영 못 찾고 셋을 거짓 빨강으로 찍었다. */
    let owner = null, pre = false, hop = range;
    for (let k = 0; k < 12 && hop; k++) {
      const g = nameOf(bsrc, hop[0], true);
      if (g) { owner = g; if (PRE_HANDOUT.has(g.name)) pre = true; break; }
      if (hop[0] <= 0) break;
      hop = innerBlock(bsrc, hop[0] - 1);
    }
    if (!owner) { doors.push({ file: f, line: i + 1, why: "감싼 **함수**의 이름을 못 읽었다" }); continue; }
    const g = pre ? { ok: true } : guardBefore(bsrc, at);
    doors.push({ file: f, line: i + 1, name: owner.name, kind: owner.kind, pre, preName: owner.name, guarded: g.ok, via: g.via });
  }
}

/* ── 찍는다 ───────────────────────────────────────────────────────────── */
console.log(`🔴 «잡을 다시 큐에 넣는 문»마다 채널에 물어보나 · ${new Date().toISOString()}`);
console.log("═".repeat(116));
console.log("■ 내가 세는 모수 — `UPDATE runner_jobs … status='queued'` 를 쓰는 자리");
console.log(`   본 파일 ${FILES.length}개(${FILES.join(" · ")}) · 찾은 문 **${doors.length}개**`);
console.log(`   경계 = **중괄호를 맞춰** 잡은 안쪽 블록(주석·문자열은 지운 판) · 가드 = 그 블록 안의 \`${GUARD}\`(**도우미 한 겹까지** 따라간다)`);
console.log(`   «내주기 전»으로 봐 주는 함수: ${[...PRE_HANDOUT].join("·")}`);
console.log("");

if (!doors.length) { console.error("⊘ 못 쟀어요 — 문을 하나도 못 찾았다(정규식이 낡았을 수 있다 · 모수 0 을 통과로 쓰지 않는다)."); process.exit(2); }

let bad = 0, unmeasured = 0;
for (const d of doors) {
  if (d.why) {
    unmeasured++;
    console.log(`  ⊘ ${d.file}:${d.line}`);
    console.log(`       **못 쟀음** — ${d.why}. 🔴 못 찾은 것을 «파일 전체»로 떨어뜨리지 않는다(그게 이 자가 한 번 눈이 먼 까닭이다 · AC-216).`);
    continue;
  }
  const who = `${d.file}:${d.line} ${d.name} (${d.kind})`;
  if (d.pre) { console.log(`  ✓ ${who}`); console.log(`       **내주기 전**이다(\`${d.preName}\` 안) — 러너가 이 잡을 가진 적이 없으니 올렸을 수도 없다`); continue; }
  if (d.guarded) { console.log(`  ✓ ${who}`); console.log(`       되돌리기 전에 채널에 묻는다(\`${GUARD}\` · ${d.via})`); continue; }
  bad++;
  console.log(`  ✗ ${who}`);
  console.log("       🔴 **러너가 이미 가졌던 잡을 채널에 안 물어보고 큐로 되돌린다** — 올려 놓고 보고 못 한 잡이면 **또 올라간다**(AC-200)");
}

console.log("═".repeat(116));
console.log(`■ 문 ${doors.length}개 — 막힌 것 ${doors.length - bad - unmeasured} · 🔴 **안 막힌 것 ${bad}** · ⊘ 못 쟀음 ${unmeasured}`);
console.log("⊘ 이 자가 **못 재는 것**(AC-9): 물어본 뒤 실제로 안 올라가는지는 **라이브 발행이 답한다** — 여기는 «묻기는 하나»까지다.");
process.exit(bad ? 1 : unmeasured ? 2 : 0);   /* 🔴 ⊘ 가 있으면 초록이 아니다 — «못 쟀음»은 2 다 */
