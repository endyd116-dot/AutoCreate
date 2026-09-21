/**
 * scripts/verify-requeue-guarded-mutants.mjs — 🔴 **내 `verify-requeue-guarded` 에 변이를 넣어 무는지 잰다**
 *   (C · 2026-09-22 · AC-108)
 *
 *   ══ 🔴 변이는 사본에만 · 망가뜨리는 쪽 ══
 *   자가 읽는 파일 둘 + 자 자신을 임시 나무에 복사하고 **그 나무의 자**를 돌린다. 제품 파일 무접촉(AC-213).
 *
 *   ══ 🔴 무엇을 확인하나 ══
 *   ① **빨강이 진짜 빨강인가** — 지금 ✗ 인 셋에 가드를 **넣어 주면** 초록으로 돌아오나(굳은 빨강이 아닌가).
 *   ② **초록이 진짜 초록인가** — 지금 ✓ 인 `reapStaleJobs` 의 가드를 **빼면** 우나.
 *   ③ **«내주기 전» 봐주기가 무르지 않은가** — `claimJobs` 를 다른 이름으로 바꾸면 그 셋이 우나.
 *      (이게 제일 중요하다 — 봐주기가 너무 넓으면 **진짜 구멍을 봐준다**)
 *   ④ **문을 새로 내면 잡나** — 가드 없는 되돌리기를 한 줄 심으면 우나.
 *   🔴 판정은 «대조군엔 없고 변이 판에만 있나»로 한다(AC-161) · 축마다 «그 축이 낼 말»을 적는다(AC-121).
 *
 *   종료코드: 0 = 전부 기대대로 · 1 = 어긋난 것이 있다 · 2 = 못 쟀다.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ARENA = path.join(ROOT, "_verify", `requeue-mutants-${process.pid}`);   /* 🔴 프로세스마다 나눈다(AC-210 ③ — 두 판이 서로를 지웠다) */
const RULER = "scripts/verify-requeue-guarded.mjs";
const RJ = "lib/runner-jobs.ts", OPS = "netlify/functions/ops-runners.ts";
const TOUCH = [RJ, OPS];

for (const f of [RULER, ...TOUCH]) if (!existsSync(path.join(ROOT, f))) { console.error(`⊘ 못 쟀어요 — ${f} 가 없다.`); process.exit(2); }

let seq = 0;
function run(transform) {
  const dir = path.join(ARENA, `m${seq++}`);
  rmSync(dir, { recursive: true, force: true });
  for (const f of [RULER, ...TOUCH]) { mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); cpSync(path.join(ROOT, f), path.join(dir, f)); }
  let changed = true;
  if (transform) {
    const box = {};
    for (const f of TOUCH) box[f] = readFileSync(path.join(dir, f), "utf8");
    const before = JSON.stringify(box);
    transform(box);
    changed = JSON.stringify(box) !== before;
    for (const f of TOUCH) writeFileSync(path.join(dir, f), box[f]);
  }
  let out = "", code = 0;
  try { out = execFileSync(process.execPath, [path.join(dir, RULER)], { cwd: dir, encoding: "utf8", timeout: 60_000 }); }
  catch (e) { code = e.status ?? -1; out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
  rmSync(dir, { recursive: true, force: true });
  return { code, out, changed };
}

const cases = [];
/** want = "appear"(변이 판에만 나와야) · "vanish"(대조군엔 있고 변이 판엔 없어야) */
const add = (name, transform, mark, want = "appear") => cases.push({ name, transform, mark, want });

/* ═══ 🔴 B2 가 찾아 준 사각 — 이 넷이 이 하니스의 값이다(AC-216) ═══
   옛 판은 몸통을 「위로 `function` · 아래로 다음 `function`」으로 잡아, 화살표 핸들러에서 **몸통 = 파일 전체**가 됐다.
   그래서 **맨 위 `import` 한 줄**이 그 파일의 모든 문을 영원히 초록으로 만들었다. 아래 ①이 그걸 잡는다. */
add("① 🔴 **ops 의 «호출»만 지운다**(import 는 남긴다) — 두 문이 운다 · B2 가 찾은 그 변이",
  (b) => { b[OPS] = b[OPS].replace("const rec = await reconcileLostPublish(", "const rec = await zzGone("); },
  "✗ netlify/functions/ops-runners.ts");
add("② 🔴 가드를 **주석으로만** 남긴다 — 그래도 운다(좋은 주석이 자를 눈멀게 하지 않는다 · AC-191)",
  (b) => { b[OPS] = b[OPS].replace("const rec = await reconcileLostPublish(", "/* reconcileLostPublish */ const rec = await zzGone("); },
  "✗ netlify/functions/ops-runners.ts");
add("③ `reapStaleJobs` 의 가드를 지우면 그 문이 운다",
  (b) => { b[RJ] = b[RJ].replace(/const rec = await reconcileLostPublish\(\{\s*tenantId: tid/, "const rec = await zzGone({ tenantId: tid"); },
  "✗ lib/runner-jobs.ts:1861");
add("④ 🔴 `claimJobs` 이름을 바꾸면 봐주던 셋이 **전부** 운다(봐주기가 너무 넓지 않다)",
  (b) => { b[RJ] = b[RJ].split("function claimJobs(").join("function zzClaim("); },
  "✗ lib/runner-jobs.ts:858");
add("⑤ 가드 없는 되돌리기를 **한 줄 새로 심으면** 잡는다(다음에 문이 생겨도 운다)",
  (b) => { b[OPS] = b[OPS].replace('if (action === "remove") {',
    "if (action === \"zznew\") { await q(sql`UPDATE runner_jobs SET status = 'queued' WHERE id = 1`); }\n      if (action === \"remove\") {"); },
  "✗ netlify/functions/ops-runners.ts");
/* 🔴 ⑥ **이 자가 이제 «못 쟀음»으로 멈추나** — 넓게 잡지 말고 멈추라는 것이 AC-216 의 결론이다 */
add("⑥ 🔴 중괄호를 깨면 **⊘(못 쟀음)** 으로 멈춘다 — 넓게 잡아 초록을 내지 않는다",
  (b) => { b[RJ] = b[RJ].replace("export async function reapStaleJobs", "export async function reapStaleJobs{"); },
  "       **못 쟀음**");   /* 🔴 이 줄에만 있는 글자를 골라야 한다 — «⊘ » 만 써다가 **꼬리말 줄**에 걸려 거짓 실패를 냈다(AC-121) */

/* ═══ 돌린다 ═══ */
console.log(`🔴 내 \`verify-requeue-guarded\` 에 변이를 넣어 본다 · ${new Date().toISOString()}`);
console.log("─".repeat(116));
const base = run(null);
if (base.code === 2) { console.log("  ⊘ 대조군이 «못 쟀음»(2) 이다 — 여기서 멈춘다."); process.exit(2); }
const baseDoors = (base.out.match(/^\s*[✓✗] /gm) || []).length;
console.log(`  ✓ 대조군 — 멀쩡한 사본에서 종료코드 ${base.code} · 문 ${baseDoors}개를 셌다`);
console.log("");

let bad = 0;
for (const c of cases) {
  const r = run(c.transform);
  if (!r.changed) { console.log(`  ✗ ${c.name}\n       🔴 **변이를 못 넣었다**(파일이 안 바뀜) — 자를 잰 게 아니다(AC-112 ①)`); bad++; continue; }
  const inBase = base.out.includes(c.mark), inMut = r.out.includes(c.mark);
  let okd, why;
  if (c.want === "appear") {
    if (inBase) { okd = false; why = `🔴 **대조군에도 «${c.mark}» 가 있다** — 변이 탓이라 말할 수 없다(AC-161 ②)`; }
    else { okd = inMut; why = okd ? `울었다 — 맨 판엔 없고 변이 판에만 «${c.mark}»` : `🔴 **안 울었다** — «${c.mark}» 가 안 나온다`; }
  } else {
    if (!inBase) { okd = false; why = `🔴 **대조군에 «${c.mark}» 가 애초에 없다** — 사라지는 것을 볼 수가 없다(AC-121 부정형 단언)`; }
    else { okd = !inMut; why = okd ? `사라졌다 — 대조군엔 «${c.mark}» 가 있고 수리 판엔 없다` : `🔴 **안 사라졌다** — 고쳐도 빨갛다(굳은 빨강)`; }
  }
  if (!okd) bad++;
  console.log(`  ${okd ? "✓" : "✗"} ${c.name}`);
  console.log(`       ${why} · 종료코드 ${r.code}`);
}

console.log("─".repeat(116));
console.log(`■ 변이 ${cases.length}개 — **어긋난 것 ${bad}개**`);
console.log("🔴 이 자는 제품을 재지 않는다 — **내 자를 잰다.**");
rmSync(ARENA, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
