/**
 * scripts/verify-regen-note-mutants.mjs — 🔴 **B 의 `verify-regen-note-reaches` 에 변이를 넣어 우는지 내가 잰다**
 *   (C · 2026-09-21)
 *
 *   ══ 왜 이 자인가 ══
 *   `regenNote` 는 **세 창이 같이 가야 하는** 건이었다(화면 보내기 · 서버 저장 · 생성기 읽기).
 *   그런 건은 **한 겹만 고쳐도 «초록인데 고장»**이 된다 — 그래서 그 셋을 한꺼번에 지키는 자가 정말 무는지를 따로 재야 한다.
 *   🔴 그리고 나는 이 건에서 **이미 한 번 틀렸다**: 내 `verify-key-contract` 가 «서버가 `note` 를 안 읽는다»고 했는데
 *      서버는 처음부터 읽고 있었다(내 자가 같은 라우트의 **둘째 블록**을 못 봤다). **그때 내 말을 믿고 B 에게 없는 일감을 얹을 뻔했다.**
 *      ⇒ 이번엔 말이 아니라 **변이로** 확인한다.
 *
 *   ══ 🔴 변이는 사본에서만 ══
 *   B 의 자가 읽는 파일 다섯을 임시 폴더에 복사하고 **그 폴더를 작업 폴더로** 삼아 자를 돌린다. 제품 파일 무접촉.
 *
 *   ══ 🔴 판정 모양(AC-161) ══
 *   «기댓말이 사라졌나»로 재지 않는다. **같은 조건으로 대조군을 먼저 돌리고** «맨 판엔 없고 변이 판에만 있나»를 본다.
 *   대조군에 이미 그 말이 있으면 «변이 탓이라 말할 수 없다»고 적고 ✗ 한다(AC-121 — 그 축이 울었나까지).
 *
 *   종료코드: 0 = 변이마다 제 축이 운다 · 1 = 안 우는 변이가 있다 · 2 = 못 쟀다.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dirname, "..");
const RULER = path.join(ROOT, "scripts", "verify-regen-note-reaches.mjs");
if (!existsSync(RULER)) { console.error("⊘ 못 쟀어요 — `scripts/verify-regen-note-reaches.mjs` 가 없다(B 의 자)."); process.exit(2); }

/** 🔴 그 자가 읽는 파일을 **소스에서 뽑는다** — 손 목록은 낡는다(AC-113 · 어제 A 의 자에서 겪었다). */
const FILES = (() => {
  const src = readFileSync(RULER, "utf8");
  const set = new Set();
  for (const m of src.matchAll(/read\(\s*["']([^"']+)["']\s*\)/g)) set.add(m[1]);
  for (const m of src.matchAll(/readFileSync\(\s*["']([^"']+)["']/g)) set.add(m[1]);
  return [...set];
})();
for (const f of FILES) if (!existsSync(path.join(ROOT, f))) { console.error(`⊘ 못 쟀어요 — ${f} 가 없다.`); process.exit(2); }

function run(transform) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ac-regen-"));
  try {
    const box = {};
    for (const f of FILES) { mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); box[f] = readFileSync(path.join(ROOT, f), "utf8"); }
    const before = JSON.stringify(box);
    if (transform) transform(box);
    const changed = JSON.stringify(box) !== before;
    for (const f of FILES) writeFileSync(path.join(dir, f), box[f]);
    let out = "", code = 0;
    try { out = execFileSync(process.execPath, [RULER], { cwd: dir, encoding: "utf8" }); }
    catch (e) { code = e.status ?? -1; out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
    return { code, out, changed };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const cases = [];
/** mustAppear = **변이 판에만** 나와야 하는 «그 축이 낼 말». */
const add = (name, transform, mustAppear) => cases.push({ name, transform, mustAppear });
const API = "netlify/functions/pieces.ts";
const TEXT = "lib/content-gen.ts";
const VGEN = "lib/video/gen.ts";
const VSCRIPT = "lib/video/script.ts";

/* ① 서버가 저장하는 자리를 없앤다 — 세 겹 중 가운데를 끊는다 */
add("① 서버가 `meta.regenNote` 로 저장하는 자리를 없애면 운다", (b) => {
  b[API] = b[API].split("regenNote: note || null,").join("");
}, "① ");

/* ② 🔴 **생성기가 제 이름으로 읽는 자리**를 없앤다 — B 가 M2 에서 «부분일치가 속였다»고 적은 그 축 */
add("② 글 생성기가 프롬프트에 싣는 줄을 들어내면 운다(B 가 부분일치로 한 번 속은 축)", (b) => {
  b[TEXT] = b[TEXT].replace(/a\.regenNote\s*\?/, "false ?");
}, "② ");
add("②-b 영상 대본이 싣는 줄을 들어내도 운다", (b) => {
  b[VSCRIPT] = b[VSCRIPT].replace(/inp\.regenNote \?/, "false ?");
}, "② ");
add("②-c 영상 생성기가 그 칸을 읽는 자리를 없애도 운다", (b) => {
  b[VGEN] = b[VGEN].split("meta.regenNote").join("meta.zzGone");
}, "② ");

/* ③ 🔴 **앵글에 몰래 붙이기**를 되살린다 — B 가 이번에 걷어낸 그 방식 */
add("③ 앵글 뒤에 몰래 붙이기를 되살리면 운다(재생성마다 쌓이던 그 방식)", (b) => {
  b[API] = b[API].replace(/regenNote: note \|\| null,/, 'regenNote: note || null, angle: note ? `${String(m.angle || "")} — 사용자 요청: ${note}` : m.angle,');
}, "③ ");

/* ═══ 돌린다 ═══ */
console.log(`🔴 B 의 \`verify-regen-note-reaches\` 에 변이를 넣어 본다 · ${new Date().toISOString()}`);
console.log("─".repeat(116));
console.log(`   잰 파일 ${FILES.length}개(자 소스에서 뽑았다): ${FILES.join(" · ")}`);
console.log("");

const base = run(null);
if (base.code !== 0) {
  console.log(`  ✗ 대조군 — 멀쩡한 사본인데 B 의 자가 빨갛다(종료코드 ${base.code}). 여기서 멈춘다.`);
  console.log(base.out.split("\n").filter((l) => /✗/.test(l)).slice(0, 6).map((l) => "     " + l).join("\n"));
  process.exit(1);
}
console.log("  ✓ 대조군 — **멀쩡한 사본**에 B 의 자를 돌리면 통과한다(종료코드 0)");

let bad = 0;
for (const c of cases) {
  const r = run(c.transform);
  if (!r.changed) { console.log(`  ✗ ${c.name}\n       🔴 **변이를 못 넣었다**(파일이 안 바뀜) — 자를 잰 게 아니다(AC-112 ①)`); bad++; continue; }
  /* 그 축의 «✗ ①…» 줄이 **변이 판에만** 떠야 한다. */
  const re = new RegExp(`✗ ${c.mustAppear}`);
  const inBase = re.test(base.out), inMut = re.test(r.out);
  if (inBase) { console.log(`  ✗ ${c.name}\n       🔴 **대조군에도 그 축이 빨갛다** — 변이 탓이라 말할 수 없다`); bad++; continue; }
  const ok = inMut;
  if (!ok) bad++;
  console.log(`  ${ok ? "✓" : "✗"} ${c.name}`);
  console.log(`       ${ok ? `울었다 — 맨 판엔 없고 변이 판에만 «✗ ${c.mustAppear}…»` : `🔴 **안 울었다** — «✗ ${c.mustAppear}…» 가 안 나온다(딴 축이 울었거나 무디다)`} · 종료코드 ${r.code}`);
}

console.log("─".repeat(116));
console.log(`■ 변이 ${cases.length}개 중 **제 축으로 운 것 ${cases.length - bad}개** · 어긋난 것 ${bad}개`);
console.log("🔴 이 자는 제품을 재지 않는다 — **B 의 자를 잰다.**");
process.exit(bad ? 1 : 0);
