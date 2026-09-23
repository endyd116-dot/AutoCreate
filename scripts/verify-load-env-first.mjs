/**
 * scripts/verify-load-env-first.mjs — [R17-B2 · 2026-09-23] 🔴 **자가 스스로 가짜 빨강을 내지 않게.**
 *
 *   ══ 무슨 병인가 ══
 *   `scripts/_lib/load-env.mjs` 머리말이 이미 적어 뒀다: ESM 은 **`import` 를 본문보다 먼저** 평가한다.
 *   그래서 `import { db } from "../db/index"` 가 **본문 한 줄 돌기 전에** `NETLIFY_DATABASE_URL` 을 읽고
 *   빈 문자열로 풀을 만든다 ⇒ 첫 질의에서 `read ECONNRESET`.
 *   🔴 **«못 쟀다»도 «틀렸다»도 아닌, 자가 스스로 만든 빨강**이다. 셸에 env 를 넣고 돌리면 멀쩡히 통과한다.
 *
 *   ══ 왜 자가 필요한가 ══
 *   R16 재측정에서 `verify-api-channels.mts` 가 이 빨강을 냈고, 나는 그걸 «못 쟀음»으로 적을 뻔했다.
 *   오늘 세어 보니 **같은 병을 앓는 자가 14개**였다 — 아무도 안 세고 있었기 때문이다.
 *   🔴 **빨간 자는 곧 무시당한다**(AC-112 ⑤). 그러면 그 자가 원래 잡던 진짜 사고도 같이 묻힌다.
 *
 *   ══ 무엇을 보나 ══
 *   `db/index` 를 부르는 `scripts/*.mts|mjs` 마다 **`_lib/load-env` 가 첫 import 인가.**
 *   🔴 «어딘가에 있나»가 아니라 **«첫 줄인가»** 를 본다 — 둘째 줄부터는 이미 늦다(형제 import 가 먼저 평가된다).
 *
 *   쓰기: node scripts/verify-load-env-first.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DIR = "scripts";
const files = readdirSync(DIR).filter((f) => /\.(mts|mjs)$/.test(f) && f !== "verify-load-env-first.mjs");

const needy = [];   // db/index 를 부르는 자
const bad = [];     // 그런데 load-env 가 첫 import 가 아닌 자
for (const f of files) {
  const src = readFileSync(path.join(DIR, f), "utf8");
  /* `db/index` 를 직접 부르거나, 그것을 부르는 lib 를 최상단에서 묶는 자 — 둘 다 같은 병이다.
     🔴 `await import(...)`(함수 안에서 부르는 것)은 **본문이 돌 때** 평가되므로 이 병이 아니다(그래서 `^import` 만 본다). */
  const topImports = src.split("\n").filter((l) => /^import\s/.test(l));
  const touchesDb = topImports.some((l) => /["']\.\.\/db\/index["']/.test(l));
  if (!touchesDb) continue;
  needy.push(f);
  const first = topImports[0] ?? "";
  if (!/_lib\/load-env/.test(first)) bad.push({ f, first: first.slice(0, 90) });
}

console.log(`db/index 를 최상단에서 부르는 자 ${needy.length}개 / 전체 ${files.length}개`);
/* 🔴 0 이면 «다 맞다»가 아니라 **정규식이 빗나간 것**이다(이 프로젝트의 자 규율 · AC-100 ⑦). */
if (!needy.length) { console.log("🔴 하나도 못 찾았다 — scripts 의 import 모양이 바뀌었다(정규식이 빗나갔다)"); process.exit(1); }

if (bad.length) {
  console.log(`\n🔴 ${bad.length}개가 \`_lib/load-env\` 를 **첫 import 로** 안 둔다 — 이 자들은 .env 없이 돌리면`);
  console.log("   «read ECONNRESET» 이라는 **가짜 빨강**을 낸다(검사 대상과 아무 상관없는 빨강이다).");
  console.log("   고치는 법: 파일 맨 위 첫 줄에 `import \"./_lib/load-env.mjs\";`");
  for (const b of bad) console.log(`   · ${b.f}\n       지금 첫 import: ${b.first}`);
  process.exit(1);
}
console.log("\n✅ 전부 _lib/load-env 를 첫 import 로 둔다");
