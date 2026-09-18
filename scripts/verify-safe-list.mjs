/**
 * scripts/verify-safe-list.mjs — 🔴 **어느 검사를 «다 돌려도» 되나**(C · 2026-09-16).
 *   사용: node scripts/verify-safe-list.mjs          (목록만 찍는다 · 아무것도 안 돌린다)
 *         node scripts/verify-safe-list.mjs --run    (🔴 **안전한 것만** 차례로 돌리고 종료코드를 찍는다)
 *
 *   ══ 왜 ══
 *   2026-09-16 C 가 «전수 검사»를 한다며 `for f in scripts/verify-*.mjs` 로 **통째로** 돌렸다.
 *   그 안에 **라이브에 가입을 만드는 하니스**가 섞여 있었다(`verify-live-c6.mjs` — 실제로 테넌트가 생겼다).
 *   🔴 «라이브는 읽기만»이라는 지시를 지키고 있다고 **믿으면서** 어긴 것이다. 다행히 그 하니스들은 스스로 치우지만,
 *   teardown 이 실패하는 날엔 라이브에 쌓인다(2026-09-15 대청소 88집의 일부가 그것이었다).
 *
 *   ⇒ **글로브로 검사를 돌리지 않는다.** 이 파일이 세 갈래로 갈라 준다:
 *     · `safe`  — 파일만 읽는다. 언제나 돌려도 된다.
 *     · `live`  — 🔴 **라이브에 쓴다**(가입·발행·결제). 사람이 뜻을 갖고 하나씩 돌린다.
 *     · `needs` — 돌리려면 뭔가 더 있어야 한다(개발 서버·인자·실호출 = 돈).
 *
 *   🔴 갈래는 **파일을 읽어서** 정한다 — 손으로 든 목록이면 새 하니스가 생길 때마다 낡는다(AC-82).
 */
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const files = readdirSync("scripts").filter((f) => /^verify-.*\.(mjs|mts)$/.test(f)).sort();

/**
 * 🔴 이 낱말들이 있으면 **밖으로 나가거나 라이브를 만진다**고 본다(의심되면 안전한 쪽으로 — `live` 로 민다).
 *   🔴 [2026-09-16 고침] 첫 판은 «쓰기»만 봤다 — 그래서 **라이브 DB 에 붙어 읽기만 하는** 하니스 둘
 *      (`verify-coin-reconcile`·`verify-r8a-text-probe`)이 `safe` 로 떨어졌고, 연결이 끊기자 «실패 2건»으로 찍혔다.
 *      읽기여도 **라이브에 붙는 것은 safe 가 아니다**: 네트워크가 나쁜 날 빨강이 되고, 접속 수를 먹고, 무엇보다
 *      «언제나 돌려도 되는 것»이라는 이 갈래의 뜻과 다르다. ⇒ **DB·네트워크에 닿으면 전부 `live`**.
 */
const WRITES = /\bfetch\s*\(|BASE_URL|autocreate-endyd|\/api\/auth-register|teardownRun|sql`\s*(INSERT|UPDATE|DELETE)|NETLIFY_DATABASE_URL|from "postgres"|db\/index|\.\.\/db\b/i;
/** 개발 서버·인자·실호출이 필요한 것. */
const NEEDS = /localhost:\d+|process\.argv\[2\]|사용법:|GEMINI_API_KEY/;
/** 🔴 [2026-09-19 B2] **키 이름이 있다고 «키가 필요한 자»는 아니다.**
 *   `verify-ac111-stub-voice.mts` 는 실호출을 막으려고 키를 **일부러 빈 문자열로 덮는다** — 그런데 그 낱말 때문에
 *   `needs` 로 분류돼 **safe-list 가 영영 안 돌리는 자**가 됐다(자가 있으나 마나가 된다).
 *   ⇒ 키를 **비우는 코드가 같은 파일에 있으면** 그 낱말은 «필요»의 증거가 아니다. 다른 needs 신호(개발 서버·인자)는 그대로 본다.
 *   ⚠️ 좁게 본다: `GEMINI_API_KEY: ""` 또는 `GEMINI_API_KEY = ""` 처럼 **빈 값으로 덮는 모양**만 인정한다. */
const CLEARS_KEY = /GEMINI_API_KEYS?\s*[:=]\s*""/;
/** 🔴 «읽기만»이라고 **스스로 못 박은** 파일은 그 말을 믿되, 쓰기 낱말이 있으면 그 말보다 코드가 이긴다. */
const SAYS_READONLY = /읽기만|읽기 전용|SELECT 만/;

const groups = { safe: [], live: [], needs: [] };
for (const f of files) {
  const src = readFileSync(`scripts/${f}`, "utf8");
  const writes = WRITES.test(src);
  /* 키 이름만 있고 **비우는 코드**가 같이 있으면, 그 낱말은 빼고 다시 본다(위 CLEARS_KEY 주석). */
  const needs = CLEARS_KEY.test(src) ? /localhost:\d+|process\.argv\[2\]|사용법:/.test(src) : NEEDS.test(src);
  if (writes) groups.live.push([f, SAYS_READONLY.test(src) ? "🟠 «읽기만»이라 적혀 있는데 쓰기 낱말이 있다 — 사람이 확인" : "라이브에 쓰거나 밖으로 나간다"]);
  else if (needs) groups.needs.push([f, "개발 서버·인자·실호출이 필요"]);
  else groups.safe.push([f, "파일만 읽는다"]);
}

const RUN = process.argv.includes("--run");
console.log(`\n검사 갈래 — «전부 돌린다»가 안전하지 않다 · ${new Date().toISOString()}\n${"─".repeat(112)}`);
console.log(`■ safe ${groups.safe.length}개 — 언제나 돌려도 된다`);
for (const [f] of groups.safe) console.log(`   · ${f}`);
console.log(`\n■ 🔴 live ${groups.live.length}개 — **라이브에 쓴다. 글로브로 돌리지 마라.**`);
for (const [f, why] of groups.live) console.log(`   · ${f}  (${why})`);
console.log(`\n■ needs ${groups.needs.length}개 — 뭔가 더 있어야 돈다`);
for (const [f, why] of groups.needs) console.log(`   · ${f}  (${why})`);
console.log(`${"─".repeat(112)}`);

if (!RUN) { console.log("목록만 찍었다. 안전한 것만 돌리려면 --run."); process.exit(0); }

let bad = 0;
/* [2026-09-16 메인] **«못 쟀다»와 «틀렸다»를 가른다.**
   `exit 2` 는 이 리포 18곳이 이미 «잴 재료가 없다»(playwright 없음 · 인자 없음 · DB URL 없음)로 쓰고 있다.
   그걸 «실패»로 세면 **폴더마다 빨강 개수가 달라지고**, 그러면 곧 아무도 빨강을 안 본다(AC-95).
   => `2` 는 **못 쟀음**으로 따로 세고 전체 종료코드를 더럽히지 않는다. 대신 **끝줄에 반드시 적는다** —
   조용히 넘기면 그게 «안 재고 통과했다»가 된다(AC-9). */
let unmeasured = 0;
/* 🔴 «아직 수리가 안 들어와서 빨간 자»를 «진짜 회귀»와 가른다(2026-09-19 · C 지적).
   수리 라운드 중엔 새로 세운 자가 전부 빨갛다 — 그건 고장이 아니라 **할 일이 남았다**는 뜻이다.
   그 빨강 더미에 **그 사이 난 진짜 회귀가 묻힌다**(오늘 `verify-label-surface` 가 하마터면 묻혔다).
   🔴 그래서 «기다리는 빨강»은 따로 세고 **종료코드도 더럽히지 않는다.** 대신 끝줄에 **몇 개가 누구 몫인지** 반드시 적는다.
   🔴 목록에 넣어 두고 잊으면 그건 «검사를 끈 것»이다 — 초록이 되면 그 줄을 지운다. */
const waiting = [];
const PENDING = new Map();
try {
  for (const row of JSON.parse(readFileSync("docs/rules/pending-red.json", "utf8")).대기 || []) PENDING.set(row.자, row);
} catch { /* 목록이 없으면 전부 «진짜 빨강»으로 본다 — 안전한 쪽 */ }
console.log("\n안전한 것만 돌린다(종료코드):");
for (const [f] of groups.safe) {
  if (f === "verify-safe-list.mjs") continue;
  /* 🔴 [2026-09-16] 첫 판은 `execFileSync("npx", ["tsx", …])` 였다 — **Windows 에서 `npx` 는 `npx.cmd`** 라
     `execFileSync` 가 못 찾고 통째로 던졌다. 그래서 `.mts` **33개가 전부 «실패»로** 찍혔다 —
     바로 앞에서 손으로 돌렸을 땐 46 통과였는데도. **내 실행기가 거짓 빨강을 낸 것**이다(AC-67 의 사촌:
     이번엔 셸이 아니라 «셸이 아니어서» 났다). ⇒ `shell: true` 로 부르고, **한 개도 못 돌면 고장으로 센다**. */
  const isTs = f.endsWith(".mts");
  const cmd = isTs ? `npx tsx scripts/${f}` : `"${process.execPath}" scripts/${f}`;
  let code = 0;
  /* 🔴 **파이프로 넘기지 않는다** — `| tail` 을 쓰면 실패해도 0 이 온다(AC-67). 종료코드를 그대로 받는다. */
  try { execFileSync(cmd, { stdio: "ignore", shell: true }); } catch (e) { code = e.status ?? 1; }
  const wait = PENDING.get(f);
  if (code === 2) unmeasured++;
  else if (code && wait) waiting.push({ f, wait });
  else if (code) bad++;
  const mark = code === 2 ? "⊘" : code ? (wait ? "⏳" : "✗") : "✓";
  const tail = code === 2 ? "  (못 쟀음 — 잴 재료가 없다)" : (code && wait ? `  (기다리는 빨강 — ${wait.왜} · ${wait.누가} 몫)` : "");
  console.log(`  ${mark} ${f}=${code}${tail}`);
}
console.log(`${"─".repeat(112)}`);
const ran = groups.safe.length - 1 - unmeasured;
console.log(bad ? `🔴 실패 ${bad}개` : `✅ 실제로 잰 ${ran - waiting.length}개 전부 통과`);
if (unmeasured) console.log(`⊘ 못 쟀음 ${unmeasured}개 — **통과가 아니다.** 재료를 걸고 다시 돌려라(위 안내 참고).`);
if (waiting.length) {
  console.log(`⏳ 기다리는 빨강 ${waiting.length}개 — **고장이 아니라 할 일이다**(docs/rules/pending-red.json):`);
  for (const w of waiting) console.log(`   · ${w.f} — ${w.wait.왜}  ⟵ ${w.wait.누가} 몫`);
  console.log(`   🔴 초록이 되면 그 줄을 목록에서 지워라. 넣어 두고 잊으면 «검사를 끈 것»이다.`);
}
process.exit(bad ? 1 : 0);
