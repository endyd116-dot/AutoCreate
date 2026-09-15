/**
 * scripts/verify-dup-keys.mjs — 🔴 **같은 칸을 두 곳에 적으면 충돌 없이 한쪽이 말없이 진다**(C · 2026-09-16).
 *   사용: node scripts/verify-dup-keys.mjs
 *
 *   ══ 왜 ══
 *   2026-09-16 C 가 `team_review` 아이콘이 없는 걸 잡아 `UI.KIND_ALIAS` 에 넣었는데, A 가 같은 라운드에
 *   **같은 칸을 이미** 넣어 뒀다(`review_wait`). 객체 리터럴은 **뒤엣것이 이긴다** — C 의 `"review"` 가
 *   A 의 `"review_wait"` 를 덮었고, A 가 바로 위 주석에 «🔴 `review`(soft) 로 잇지 마라»라고 적어 둔 그 결정이
 *   **무효가 됐다.** 🔴 git 머지는 두 줄이 **다른 자리**라 충돌을 안 낸다. 검사도 «그 칸이 있나»만 보면 통과다.
 *   ⇒ 한 객체 안에 **같은 열쇠가 두 번** 나오는지 본다. 하나라도 있으면 그건 «둘 중 하나가 지고 있다»는 뜻이다.
 *
 *   ⚠️ 정직한 한계: 소스를 **텍스트로** 읽어 `{ … }` 를 짝 맞춰 가른다(파서가 아니다). 그래서 문자열·주석 안의
 *      중괄호는 지우고 본다. 못 가르는 모양이 있으면 **조용히 넘어가는 대신** 「못 봤다」를 세어 찍는다.
 */
import { readFileSync, existsSync } from "node:fs";

/**
 * 검사할 파일 — 표 **이름은 손으로 들지 않는다**.
 *   🔴 첫 판에서 나는 표 이름 여섯 개를 **지어내서** 목록에 넣었고, 그중 다섯이 «표를 못 찾았다»로 떴다
 *      (`ops.js` 에는 그런 표가 아예 없었다). **AC-82 를 고치려고 만든 파일에서 AC-82 를 냈다.**
 *   ⇒ 파일에서 **대문자 표를 스스로 찾는다**(`UI.NAME = {`). 배열(`= [`)은 열쇠가 없으니 대상이 아니다.
 */
const FILES = ["public/js/ui.js", "public/js/ops.js", "public/js/mock.js"];

/** 주석과 문자열을 공백으로 지운다(줄 수 보존) — 그 안의 중괄호·콜론이 짝 맞추기를 망친다. */
function blank(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); const seg = src.slice(i, e < 0 ? n : e + 2); out += seg.replace(/[^\n]/g, " "); i += seg.length; continue; }
    if (c === "/" && d === "/") { let e = src.indexOf("\n", i); if (e < 0) e = n; out += " ".repeat(e - i); i = e; continue; }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === "\\") j++; j++; }
      const seg = src.slice(i, Math.min(j + 1, n));
      out += seg.replace(/[^\n]/g, " ");
      i += seg.length; continue;
    }
    out += c; i++;
  }
  return out;
}

const problems = [];
const unseen = [];
let checked = 0;

for (const file of FILES) {
  if (!existsSync(file)) { unseen.push(`${file} (파일 없음)`); continue; }
  const raw = readFileSync(file, "utf8");
  const src = blank(raw);
  /* 대문자 표를 **스스로** 찾는다 — `{` 로 여는 것만(배열은 열쇠가 없다). */
  const found = [...src.matchAll(/(?:UI|OPS|O|S)\.([A-Z][A-Z0-9_]{2,})\s*=\s*\{/g)];
  if (!found.length) { unseen.push(`${file} (대문자 표 0개 — 이 파일엔 칸 표가 없다)`); continue; }
  for (const f of found) {
    const name = f[1];
    const at = f.index;
    const open = src.indexOf("{", at);
    let depth = 0, end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (!depth) { end = i; break; } }
    }
    if (end < 0) { unseen.push(`${file} ${name} (괄호가 안 닫힌다)`); continue; }
    checked++;
    /* 맨 바깥 깊이의 `열쇠:` 만 센다 — 중첩된 객체의 열쇠는 다른 표다. */
    const body = src.slice(open + 1, end);
    const seen = new Map();
    let d = 0;
    for (const m of body.matchAll(/[{}]|([A-Za-z_$][\w$]*)\s*:/g)) {
      if (m[0] === "{") { d++; continue; }
      if (m[0] === "}") { d--; continue; }
      if (d !== 0 || !m[1]) continue;
      const k = m[1];
      const line = raw.slice(0, open + 1 + m.index).split("\n").length;
      if (seen.has(k)) problems.push([file, name, k, seen.get(k), line]);
      else seen.set(k, line);
    }
  }
}

console.log(`\n한 표에 같은 칸이 두 번 — «충돌 없이 한쪽이 진다» · ${new Date().toISOString()}\n${"─".repeat(104)}`);
console.log(`표 ${checked}개를 봤다.`);
for (const [f, name, k, a, b] of problems) {
  console.log(`  ✗ ${f} ${name}: **${k}** 가 두 번 — :${a} 와 :${b} 🔴 **뒤엣것(:${b})이 이긴다**`);
}
if (!problems.length) console.log("  ✅ 두 번 적힌 칸 0.");
for (const u of unseen) console.log(`  🟠 못 봤다 — ${u}`);
console.log(`${"─".repeat(104)}`);
console.log(problems.length ? `🔴 **${problems.length}건** — 둘 중 하나가 말없이 지고 있다. 칸은 한 곳에만 적는다.` : "✅ 통과.");
/* 🔴 **«표 0개»도 실패로 센다** — 안 그러면 파일 모양이 바뀐 날 이 검사가 조용히 아무것도 안 하고 초록이 된다
   (오늘 내가 `verify-audit-selftest.mjs` 에서 그 병을 냈다: 훑은 파일 0개인데 «통과»였다).
   «그 파일엔 표가 없다»는 정상이므로 실패가 아니다 — **한 표도 못 본 경우**만 고장이다. */
const broken = checked === 0;
if (broken) console.log("🔴 **표를 하나도 못 봤다 — 이 검사 자체가 고장난 것이다**(«통과» 는 이 경우 근거가 아니다).");
process.exit(problems.length || broken ? 1 : 0);
