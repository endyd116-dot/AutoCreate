/**
 * scripts/verify-publish-words-mutants.mjs — 🔴 **B 의 자(`verify-publish-words.mjs`)에 변이를 넣어 우는지 내가 잰다**
 *   (C · 첫 발행 라운드 2026-09-20)
 *
 *   ══ 왜 ══
 *   메인이 준 몫: «🔴 «자를 냈다»가 아니라 «그 자에 변이를 넣으면 우는가»를 **네가** 재라(만든 사람 말고).»
 *   B 는 «변이 9개 9/9 전부 운다»고 적었다. 그 말이 맞는지는 **내가 다시 넣어야** 안다.
 *   그리고 내 변이는 B 의 변이와 **같을 필요가 없다** — 다른 각도로 넣어야 «그 자가 정말 그 축을 보는지» 드러난다.
 *
 *   ══ 🔴 변이는 **사본**에서만 ══
 *   B 의 자는 상대경로로 `lib/**` 를 읽는다 ⇒ 파일들을 임시 폴더에 복사하고 **그 폴더를 작업 폴더로 삼아** 돌린다.
 *   제품 파일은 한 글자도 안 건드린다.
 *
 *   ══ 🔴 «망가뜨리는 변이»만 넣는다(AC-112 ⑥) — 제품이 더 고쳐져도 죽지 않는다 ══
 *
 *   종료코드: 0 = 변이마다 운다 · 1 = 안 우는 변이가 있다 · 2 = 못 쟀다.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dirname, "..");
const RULER = path.join(ROOT, "scripts", "verify-publish-words.mjs");
const FILES = ["lib/publish-one.ts", "lib/publish/index.ts", "lib/publish/contract.ts", "lib/cron/publish-port.ts", "netlify/functions/publish-now.ts", "lib/cron/publisher.ts", "lib/am-bridge.ts"];

if (!existsSync(RULER)) { console.error("⊘ 못 쟀어요 — `scripts/verify-publish-words.mjs` 가 없다(B 의 자)."); process.exit(2); }
for (const f of FILES) if (!existsSync(path.join(ROOT, f))) { console.error(`⊘ 못 쟀어요 — ${f} 가 없다.`); process.exit(2); }

function run(transform) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ac-words-"));
  try {
    const box = {};
    for (const f of FILES) { mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); box[f] = readFileSync(path.join(ROOT, f), "utf8"); }
    const before = JSON.stringify(box);
    transform(box);
    const changed = JSON.stringify(box) !== before;
    for (const f of FILES) writeFileSync(path.join(dir, f), box[f]);
    let code = 0, out = "";
    try { out = execFileSync(process.execPath, [RULER], { cwd: dir, encoding: "utf8" }); }
    catch (e) { code = e.status ?? -1; out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
    return { code, out, changed };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const cases = [];
const add = (name, transform) => cases.push({ name, transform });

/* ① 계약을 다시 버린다 — 고장 그 자체를 되돌린다 */
add("① `publishOne` 이 서버 문장을 다시 버리게 하면 운다", (b) => {
  b["lib/publish-one.ts"] = b["lib/publish-one.ts"].replace(/sayOk\s*\?\s*say\s*:/, "false ?  say :");
});
/* ①-b 바닥만 없앤다 — «살려 쓰기»는 그대로인데 기계 말이 그대로 나갈 수 있는 모양 */
add("①-b 바닥(`HUMAN[reason]` 내려앉기)만 없애도 운다", (b) => {
  b["lib/publish-one.ts"] = b["lib/publish-one.ts"].replace(/test\(say\)/g, "true /* zz */");
});
/* ② 사유를 다시 뭉친다 */
add("② `pending_login` 을 다시 `account_blocked` 로 뭉치면 운다", (b) => {
  b["lib/publish/index.ts"] = b["lib/publish/index.ts"].split("account_login_needed").join("account_blocked");
});
/* ②-b «다시 로그인» 이라는 거짓말을 되살린다 */
add("②-b «다시 로그인»을 되살리면 운다(한 번도 안 한 사람에게 거짓말)", (b) => {
  const s = b["lib/publish/index.ts"];
  const i = s.indexOf("pending_login");
  b["lib/publish/index.ts"] = i < 0 ? s : s.slice(0, i + 13) + " /* zz */ 다시 로그인 " + s.slice(i + 13);
});
/* ③ 사유는 늘리고 표는 안 고친다 — 새 사유가 «뭉개지는» 자리 */
add("③ 사유 union 에 하나 더하고 표를 안 고치면 운다", (b) => {
  b["lib/publish/contract.ts"] = b["lib/publish/contract.ts"].replace(/(export type PublishFailReason\s*=)/, '$1 "zz_new" |');
  b["lib/cron/publish-port.ts"] = b["lib/cron/publish-port.ts"].replace(/(export type PublishFailReason\s*=)/, '$1 "zz_new" |');
});
/* ③-b 표에서 사유 하나를 뺀다 — 늘리는 쪽 말고 **줄이는** 쪽으로도 우는지 */
add("③-b 표(`HUMAN`)에서 사유 한 줄을 지우면 운다", (b) => {
  b["lib/publish-one.ts"] = b["lib/publish-one.ts"].replace(/\n\s*account_blocked:\s*"[^"]*",/, "\n");
});
/* ④ 두 union 을 갈라놓는다 — 🔴 «사유를 빼는 방향»은 tsc 가 안 운다고 B 가 적었다. 그 방향으로 넣는다. */
add("④ 포트 쪽 union 에서 사유 하나를 **빼면** 운다(tsc 는 이 방향으로 안 운다)", (b) => {
  b["lib/cron/publish-port.ts"] = b["lib/cron/publish-port.ts"].replace(/\s*\|\s*"network"/, "");
});
/* ⑤ «넣으려다 만» 삼항을 되살린다.
   🔴 **내 첫 변이는 머리말 주석 안에 떨어져서 안 울었다** — B 의 자가 `codeOnly()` 로 주석을 걷기 때문이다.
      자가 옳고 **내 변이가 덜 됐다.** 빨간 줄을 손으로 열어 보지 않았으면 «B 의 ⑤ 축이 헛돈다»고 잘못 보고할 뻔했다(AC-112 ⑤).
   ⇒ 이제 **코드 자리에** 심는다. */
add("⑤ `${x ? \"\" : \"\"}` 를 **코드 자리에** 되살리면 운다", (b) => {
  b["netlify/functions/publish-now.ts"] += "\nconst zzDead = `남은 말${1 ? \"\" : \"\"}`;\n";
});
/* ⑥ 겁주는 말을 되돌린다 — §3 */
add("⑥ «아직 로그인 전»의 말을 «막혀 있어요»로 바꾸면 운다(§3 겁주기)", (b) => {
  b["lib/publish-one.ts"] = b["lib/publish-one.ts"].replace(/account_login_needed:\s*"[^"]*"/, 'account_login_needed: "계정이 막혀 있어요"');
});
/* ⑦ 🔴 대조군을 없앤다 — 자가 «정답 모양»을 잃으면 그것도 알려야 한다 */
add("⑦ 대조군(`am-bridge.ts` 의 정답 모양)을 없애면 운다", (b) => {
  b["lib/am-bridge.ts"] = b["lib/am-bridge.ts"].replace(/j\.error\s*\?\?\s*HUMAN\[step\]/, "HUMAN[step]");
});
/* ⑧ 🔴 **주석으로만 고친 척한다**(AC-109 ①) — B 가 자기 자에서 한 번 저질렀던 병이다.
   코드는 고장 난 채로 두고 주석에 정답 글자만 심는다. 자가 주석을 코드로 세면 **초록으로 지나간다.** */
add("⑧ 코드는 고장 낸 채 **주석에만** 정답 글자를 심으면 운다(AC-109 ①)", (b) => {
  b["lib/publish-one.ts"] = b["lib/publish-one.ts"]
    .replace(/sayOk\s*\?\s*say\s*:/, "false ?  say :")
    + '\n/* zz 주석: const say = String(r.error ?? ""); sayOk ? say : HUMAN[reason] — 주석일 뿐이다 */\n';
});

/* ═══ 돌린다 ═══ */
console.log("🔴 B 의 자에 변이를 넣어 본다 — «자를 냈다»가 아니라 «우는가» · " + new Date().toISOString());
console.log("─".repeat(112));

const base = run(() => {});
if (base.code !== 0) {
  console.log(`  ✗ 대조군 — 멀쩡한 사본인데 B 의 자가 빨갛다(종료코드 ${base.code}). 여기서 멈춘다.`);
  console.log(base.out.split("\n").filter((l) => l.includes("✗")).slice(0, 6).map((l) => "     " + l).join("\n"));
  process.exit(1);
}
console.log("  ✓ 대조군 — **멀쩡한 사본**에 B 의 자를 돌리면 통과한다 (종료코드 0)");

let bad = 0;
for (const c of cases) {
  const r = run(c.transform);
  const cried = r.code !== 0;
  const ok = r.changed && cried;
  if (!ok) bad++;
  console.log(`  ${ok ? "✓" : "✗"} ${c.name}  — ${!r.changed ? "🔴 **변이를 못 넣었다**(파일이 안 바뀜) — 자를 잰 게 아니다" : cried ? "울었다" : "🔴 **안 울었다** — 이 자리는 초록으로 지나간다"}`);
  if (ok) {
    const first = r.out.split("\n").find((l) => l.trim().startsWith("✗"));
    if (first) console.log(`       ↳ 자가 한 말: ${first.trim().slice(0, 130)}`);
  }
}

console.log("─".repeat(112));
console.log(`■ 변이 ${cases.length}개 중 **제대로 운 것 ${cases.length - bad}개** · 안 운 것 ${bad}개`);
console.log("🔴 이 자는 제품을 재지 않는다 — **B 의 자를 잰다.**");
process.exit(bad ? 1 : 0);
