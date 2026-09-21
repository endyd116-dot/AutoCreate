/**
 * scripts/verify-quality-grade-mutants.mjs — 🔴 **내 `verify-quality-grade` 에 변이를 넣어 무는지 잰다**
 *   (C · 2026-09-21 · AC-108 «자를 내면 스스로 변이를 넣어 본다»)
 *
 *   ══ 🔴 변이는 사본에만 · **망가뜨리는 쪽**으로 ══
 *   `public/` `lib/` `scripts/` 를 임시 나무에 복사하고 **그 나무의 자**를 돌린다. 제품 파일 무접촉.
 *   고치는 쪽으로 짜면 수리가 들어올 때 닻을 잃는다(AC-112 ⑥) — 그래서 **지우고 부수는** 쪽이다.
 *
 *   ══ 🔴 판정 모양(AC-161 · AC-121) ══
 *   «기댓말이 사라졌나»로 재지 않는다. **대조군을 먼저 돌리고** «맨 판엔 없고 변이 판에만 있나»를 본다.
 *   그리고 축마다 **그 축이 낼 말**(«✗ ① …» 처럼 번호까지)을 적고 **그 말이 나왔을 때만** 센다.
 *
 *   ══ 🔴 덤 — «굳은 빨강»도 잰다 ══
 *   지금 ② 는 두 화면에서 **이미 빨갛다.** 변이로는 못 잰다(더 빨개질 수 없다). 대신 **수리를 넣어**
 *   «초록으로 돌아오나»를 본다. **굳어서 늘 빨간 축은 늘 초록인 축만큼 나쁘다** — 둘 다 판정이 코드에 안 달렸다.
 *
 *   종료코드: 0 = 변이마다 제 축이 운다 · 1 = 어긋난 것이 있다 · 2 = 못 쟀다.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ARENA = path.join(ROOT, "_verify", "quality-mutants");   /* `_verify/` 는 .gitignore — 잔재가 커밋에 안 딸려간다 */
const RULER = "scripts/verify-quality-grade.mjs";
const TREES = ["public", "lib", "scripts"];
const POSTS = "public/app/posts.html", ACC = "public/app/accounts.html";
/* 🔴 `_tpl.txt` 는 **서빙 안 되는 정본**인데 같은 글자를 품고 있다 — 변이를 여기 안 넣으면
   ⁶ 처럼 «안 울었다»가 나오고 나는 자를 의심하게 된다. 실제로 한 판 밟았다(AC-112 ① · AC-114 《모수》). */
const TPL = "public/app/_tpl.txt", SET = "public/app/settings.html";

if (!existsSync(path.join(ROOT, RULER))) { console.error(`⊘ 못 쟀어요 — ${RULER} 가 없다.`); process.exit(2); }

let seq = 0;
function run(transform) {
  const dir = path.join(ARENA, `m${seq++}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const t of TREES) cpSync(path.join(ROOT, t), path.join(dir, t), { recursive: true });
  let changed = true;
  if (transform) {
    const box = {};
    const touch = [POSTS, ACC, TPL, SET];
    for (const f of touch) box[f] = readFileSync(path.join(dir, f), "utf8");
    const before = JSON.stringify(box);
    transform(box);
    changed = JSON.stringify(box) !== before;
    for (const f of touch) writeFileSync(path.join(dir, f), box[f]);
  }
  let out = "", code = 0;
  try { out = execFileSync(process.execPath, [path.join(dir, RULER)], { cwd: dir, encoding: "utf8", timeout: 120_000 }); }
  catch (e) { code = e.status ?? -1; out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
  rmSync(dir, { recursive: true, force: true });
  return { code, out, changed };
}

/** 🔴 **출력을 화면별로 가른다** — 안 가르면 «프록시가 이미 빨간 축»을 «내리기 변이가 안 울었다»로 읽는다.
 *  실제로 밟았다(2026-09-21 C · 첫 판): ⑤·⑥ 변이 둘이 «대조군에도 빨갛다»로 죽었는데,
 *  빨간 것은 **프록시**였고 내가 찌른 것은 **내리기**였다. 같은 글자, 다른 주어(AC-114 그 얼굴). */
function section(out, screen) {
  const L = String(out).split(/\r?\n/);
  const i = L.findIndex((l) => l.includes(`── ${screen} ──`));
  if (i < 0) return "";
  const j = L.slice(i + 1).findIndex((l) => /^── /.test(l));
  return L.slice(i + 1, j < 0 ? L.length : i + 1 + j).join("\n");
}

/* ── 변이 ─────────────────────────────────────────────────────────────── */
const cases = [];
/** mustAppear = **그 화면의 칸에서** 변이 판에만 나와야 하는 «그 축이 낼 말» */
const add = (name, transform, mustAppear, screen = "내리기") => cases.push({ name, transform, mustAppear, screen });

add("① 기다림(뼈대)을 지우면 ① 이 운다", (b) => { b[POSTS] = b[POSTS].split('class="sk"').join('class="zz"'); }, "✗ ① 기다림이 있나");
add("③ 빈 상태를 지우면 ③ 이 운다", (b) => { b[POSTS] = b[POSTS].split('class="empty"').join('class="zz-empty"'); }, "✗ ③ 빈 상태");
add("③-b 빈 상태에서 **갈 데만** 떼면 ③ 이 운다(문도 «누르면»도 없앤다)", (b) => {
  b[ACC] = b[ACC].replace(/위에서 채널 마크를 누르면 바로 연결할 수 있어요\./, "계정이 없습니다.");
}, "✗ ③ 빈 상태", "프록시");
/* 🔴 [AC-188 · A 2026-09-22] **② 가 초록이 되면서 재는 법이 달라진다.**
   C 가 이 자를 만들 때 ② 는 두 화면에서 빨갰다 — 변이로는 못 재니(더 빨개질 수 없다) 아래 «되짚기»가
   **수리를 넣어** 초록이 되나를 봤다. 이제 제품이 고쳐졌으니(`UI.retryPanel` — 뼈대를 치우고 다시 부를 단추를 준다)
   그 되짚기는 닻을 잃는다. ⇒ **옛 갈래(토스트만 띄우고 돌아가기)로 되돌리는 것**이 이제 올바른 변이다. */
add("② 수리를 옛 갈래(토스트만)로 되돌리면 ② 가 운다", (b) => {
  for (const f of [POSTS, ACC]) b[f] = b[f].replace(/if \(!r\.ok\) \{[^\n]*retryPanel[^\n]*\}/, 'if (!r.ok) { UI.toast(r.error || "불러오지 못했어요"); return; }');
}, "✗ ② 못 불러왔을 때");
add("④ 겁주는 문장을 심으면 ④ 가 운다", (b) => { b[ACC] = b[ACC].replace("아직 연결한 계정이 없어요", "계정이 없으면 서비스가 정지됩니다"); }, "✗ ④ 겁주는 문장", "프록시");
add("⑤ 가려서 준 값을 되보내게 만들면 ⑤ 가 운다(내리기 쪽 · 지금은 초록)", (b) => {
  b[POSTS] = b[POSTS].replace("<div class=\"cta\" style=\"flex-direction:column\">",
    "<input class=\"input\" id=\"pxz\" value=\"${p.proxyUrl || ''}\"><div class=\"cta\" style=\"flex-direction:column\">")
    .replace("body: { postId: p.id }", "body: { postId: p.id, proxyUrl: 'x' }");
}, "✗ ⑤ 마스킹된 값");
add("⑥ 그 API 를 부르는 자리를 **화면 셋에서 전부** 지우면 ⑥ 이 운다(두 번 덜 지우고 «안 울었다»고 했다 · AC-112 ①)", (b) => {
  for (const f of [POSTS, TPL, SET]) b[f] = b[f].split("/api/post-retract").join("/api/zz-retract").split("/api/takedowns").join("/api/zz-takedowns");
}, "✗ ⑥ 그 기능에 닿을 화면");

/* ── 🔴 굳은 빨강 되짚기 — 수리를 넣으면 초록으로 돌아오나 ───────────────── */
const REPAIR = {
  name: "🔴 ② 는 지금 빨갛다 — **수리**를 넣으면 초록으로 돌아오나(굳어 있지 않나)",
  transform: (b) => {
    for (const f of [POSTS, ACC]) b[f] = b[f].replace(
      /if \(!r\.ok\) \{ UI\.toast\(r\.error \|\| "불러오지 못했어요"\); return; \}/,
      'if (!r.ok) { UI.$("#list").innerHTML = `<div class="group"><div class="empty"><h3>못 불러왔어요</h3><p>${UI.esc(r.error||"")}</p><button class="btn primary sm" type="button" onclick="location.reload()">다시 해 보기</button></div></div>`; return; }');
  },
  mustVanish: "✗ ② 못 불러왔을 때",
};

/* ── 돌린다 ───────────────────────────────────────────────────────────── */
console.log(`🔴 내 \`verify-quality-grade\` 에 변이를 넣어 본다 · ${new Date().toISOString()}`);
console.log("─".repeat(118));
console.log(`   사본에 옮기는 나무: ${TREES.join(" · ")} — **제품 파일은 안 건드린다**`);

const base = run(null);
if (base.code === 2) { console.log(`  ⊘ 대조군이 «못 쟀음»(2) 이다 — 여기서 멈춘다.`); process.exit(2); }
const baseReds = base.out.split("\n").filter((l) => /✗/.test(l)).length;
console.log(`  ✓ 대조군 — 멀쩡한 사본에서 종료코드 ${base.code} · 빨강 ${baseReds}줄(지금 제품에 있는 것)`);
console.log("");

let bad = 0;
for (const c of cases) {
  const r = run(c.transform);
  if (!r.changed) { console.log(`  ✗ ${c.name}\n       🔴 **변이를 못 넣었다**(파일이 안 바뀜) — 자를 잰 게 아니다(AC-112 ①)`); bad++; continue; }
  const inBase = section(base.out, c.screen).includes(c.mustAppear), inMut = section(r.out, c.screen).includes(c.mustAppear);
  if (inBase) { console.log(`  ✗ ${c.name}\n       🔴 **《${c.screen}》 칸의 대조군에도 그 축이 빨갛다** — 변이 탓이라 말할 수 없다(AC-161 ②)`); bad++; continue; }
  if (!inMut) bad++;
  console.log(`  ${inMut ? "✓" : "✗"} ${c.name}`);
  console.log(`       ${inMut ? `울었다 — 《${c.screen}》 칸의 맨 판엔 없고 변이 판에만 «${c.mustAppear}…»` : `🔴 **안 울었다** — «${c.mustAppear}…» 가 안 나온다(딴 축이 울었거나 무디다)`}`);
}

/* 굳은 빨강 */
{
  const r = run(REPAIR.transform);
  const inBase = base.out.includes(REPAIR.mustVanish), inFix = r.out.includes(REPAIR.mustVanish);
  /* 🔴 [AC-188 · A 2026-09-22] **순서를 바꿨다.** 고쳐진 뒤에는 «수리를 못 넣었다»가 아니라 «되짚을 것이 없다»가 맞는 말이다 —
     옛 갈래가 파일에 없으니 `changed:false` 가 되고, 그러면 이 자가 **제품이 고쳐졌다는 이유로 자기를 빨갛게 찍는다**.
     (C 가 그 ⊘ 문장을 이미 써 뒀는데 `!r.changed` 를 먼저 보는 바람에 거기까지 못 갔다.)
     ②를 계속 재는 일은 위 «② 수리를 옛 갈래로 되돌리면» 변이가 맡는다 — 초록이 된 축은 **되짚기가 아니라 변이로** 잰다. */
  if (!inBase) { console.log(`  ⊘ ${REPAIR.name}\n       대조군에 그 빨강이 없다 — 되짚을 것이 없다(누가 이미 고쳤나?)`); }
  else if (!r.changed) { console.log(`  ✗ ${REPAIR.name}\n       🔴 **수리를 못 넣었다**(파일이 안 바뀜)`); bad++; }
  else if (inFix) { console.log(`  ✗ ${REPAIR.name}\n       🔴 **고쳤는데도 빨갛다 — 이 축은 굳어 있다**(판정이 코드에 안 달렸다)`); bad++; }
  else console.log(`  ✓ ${REPAIR.name}\n       고치니 «${REPAIR.mustVanish}…» 가 사라졌다 — 굳어 있지 않다`);
}

console.log("─".repeat(118));
console.log(`■ 변이 ${cases.length}개 + 되짚기 1개 — **어긋난 것 ${bad}개**`);
console.log("🔴 이 자는 제품을 재지 않는다 — **내 자를 잰다.**");
rmSync(ARENA, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
