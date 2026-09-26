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
import { execFileSync } from "node:child_process";
/* 🔴 [2026-09-27 C · R19] 가르는 낱말·판정은 `_lib/gate-classify.mjs` 로 옮겼다(한 글자도 안 바꿨다).
   배포 체인(`gate-parallel.mjs`)이 **같은 갈래**로 체인 목록을 정한다 — 두 벌이면 한쪽만 고쳐지고 갈린다(AC-82).
   🔴 그 낱말이 이 파일에서 빠졌으니 이 파일 자신은 이제 `safe` 로 갈린다 — `--run` 은 아래에서 저를 건너뛴다(전과 같다). */
import { classifyGates, pendingRed } from "./_lib/gate-classify.mjs";

const groups = classifyGates("scripts");

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
const PENDING = pendingRed(".");   /* 목록이 없으면 전부 «진짜 빨강»으로 본다 — 안전한 쪽 */
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
