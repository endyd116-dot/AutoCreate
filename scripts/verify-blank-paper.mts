/**
 * scripts/verify-blank-paper.mts — 🔴 **빈 종이에서 시작한다**(2026-09-20 · B2 · AM `writeAndPublish`).
 *
 *   ══ 왜 ══
 *     AM 사장님 실물 지적: 「**#태그 아래 또 본문 내용이 써짐, 심지어 이 글과 관련 없는 회의실 내용**」.
 *     정체는 **앞서 쓰던 글의 임시저장 잔재**다. 네이버가 되살린다.
 *     🔴 **복구 팝업을 «취소»해도 남는 경우가 있고, 팝업이 아예 안 뜨고 조용히 복원되기도 한다** —
 *        AM 은 `.se-popup-button-cancel` 을 **누르고도 당했다.** «팝업을 눌렀으니 됐겠지»가 사고의 모양이다.
 *
 *   ══ 🔴 이 자가 지키는 것은 **둘**이다 ══
 *     ① **지운다** — 뭔가 있으면 잔재니 지운다.
 *     ② 🔴 **함부로 지우지 않는다** — `before > 40` 가드가 없으면 **정상 글마다 Ctrl+A·Delete 가 돈다.**
 *        그리고 «못 쟀다»를 «0자 깨끗»으로 바꾸면 그게 AC-9 다.
 *     그래서 변이 절반은 «안 잡는 것»이 아니라 **«너무 많이 지우는 것»**을 잡는다.
 *
 *   ══ 🔴 AM 과 한 곳 다르게 잰다 ══
 *     AM 은 `.se-main-container` 를 센다 — **거기엔 제목도 들어 있다**(제목은 직전에 우리가 넣었다).
 *     그대로 쓰면 제목 긴 글마다 «잔재 N자»가 뜨고 지운 뒤에도 남아 **거짓 경고**가 난다.
 *     ⇒ `.se-documentTitle` 밖의 컴포넌트만 센다. **베낀 게 아니라 고쳐 가져왔다는 뜻이고, 그래서 축으로 세운다.**
 *
 *   ══ 한계 ══
 *     ⊘ 글자 훑기 자다. 진짜 에디터에 잔재가 되살아나는지는 **못 잰다** — 실물 발행이 답한다.
 *     ⊘ **제목 칸은 안 비운다**(AM 에 실측 근거가 없다) — 재서 적기만 한다.
 *
 *   쓰는 법: npx --yes tsx scripts/verify-blank-paper.mts [--mutate]
 *   종료코드: 0 통과 · 1 실패 · 2 못 쟀음
 */
import { readFileSync } from "node:fs";
import { codeOnly } from "./_lib/code-only.mjs";

const FILE = "runner/channels/naver-blog.mjs";

function bodyOf(code: string, name: string): string {
  const at = code.indexOf(`async function ${name}(`);
  if (at < 0) return "";
  let depth = 0, started = false;
  for (let i = at; i < code.length; i++) {
    if (code[i] === "{") { depth++; started = true; }
    else if (code[i] === "}") { depth--; if (started && depth === 0) return code.slice(at, i + 1); }
  }
  return code.slice(at);
}

type Axis = { id: string; what: string; hit: (code: string, raw: string) => boolean };

const AXES: Axis[] = [
  /* ═══ ① 지운다 ═══ */
  { id: "a1", what: "`clearResidue` 가 있다", hit: (c) => /async function clearResidue\(/.test(c) },
  { id: "a2", what: "Ctrl+A 와 Delete 로 비운다", hit: (c) => {
      const b = bodyOf(c, "clearResidue");
      return /press\("Control\+a"\)/.test(b) && /press\("Delete"\)/.test(b);
    } },
  { id: "a3", what: "🔴 **본문 칸을 잡은 직후**에 부른다(포커스가 본문에 있어야 Ctrl+A 가 본문 범위다)", hit: (c) => {
      const click = c.indexOf('clickEditable(ed, S.body)');
      const call = c.indexOf("await clearResidue(page, ed)");
      const play = c.indexOf("await playOps(");
      return click > 0 && call > click && play > call;
    } },
  { id: "a4", what: "🔴 **쓰기 전에** 부른다 — 쓴 뒤에 지우면 우리 글을 지운다", hit: (c) =>
      c.indexOf("await clearResidue(page, ed)") < c.indexOf("await playOps(") },

  /* ═══ ② 함부로 지우지 않는다 ═══ */
  { id: "b1", what: "🔴 **40자 가드** — 그보다 적으면 아무것도 안 한다(정상 글은 왕복 0)", hit: (c) => {
      const b = bodyOf(c, "clearResidue");
      return /if \(m0\.body <= 40\) return/.test(b);
    } },
  { id: "b2", what: "🔴 **못 쟀으면 «0자 깨끗»으로 바꾸지 않는다**(AC-9) — measured:false 로 돌아간다", hit: (c) => {
      const b = bodyOf(c, "clearResidue");
      return /if \(!m0\) return \{ measured: false \}/.test(b);
    } },
  { id: "b3", what: "🔴 제목은 **세기만 하고 안 비운다**(확인 안 된 지우기는 멀쩡한 제목을 지운다)", hit: (c) => {
      const b = bodyOf(c, "clearResidue");
      return /titleLen/.test(b) && !/documentTitle[\s\S]{0,200}Control\+a/.test(b);
    } },
  { id: "b4", what: "🔴 셈에서 **제목을 뺀다**(AM 은 제목을 포함해 거짓 경고가 난다)", hit: (c) => {
      const b = bodyOf(c, "clearResidue");
      return /closest\("\.se-documentTitle"\)/.test(b);
    } },
  /* 🔴 실물 #1986 이 가르쳐 준 축 둘 — «16자» 거짓 경고의 정체(`probe-editor` 실측). */
  { id: "b5", what: "🔴 **자리글씨(placeholder)를 걷고** 센다 — 빈 칸의 «제목» 2자가 글자로 읽힌다", hit: (c) => {
      const b = bodyOf(c, "clearResidue");
      return /querySelectorAll\("\.se-placeholder, \.__se_placeholder"\)[\s\S]{0,40}remove\(\)/.test(b);
    } },
  { id: "b6", what: "🔴 **글자 칸(.se-text-paragraph) 안만** 센다 — 제목 칸엔 **배경사진 버튼 UI 글자**가 섞인다(그게 «16자»였다)", hit: (c) => {
      const b = bodyOf(c, "clearResidue");
      return /querySelectorAll\("\.se-text-paragraph"\)/.test(b) && !/titleEl\.textContent/.test(b);
    } },

  /* ═══ ③ 적는다 ═══ */
  { id: "c1", what: "지운 양을 **지운 뒤 다시 재서** 적는다(«지웠으니 깨끗하겠지» 금지)", hit: (c) => {
      const b = bodyOf(c, "clearResidue");
      return (b.match(/const measure = async/g) || []).length === 1 && (b.match(/await measure\(\)/g) || []).length === 2;
    } },
  { id: "c2", what: "지웠는데도 남았으면 **크게 알린다**", hit: (c) => /잔재 \$\{after\}자가 남았어요/.test(bodyOf(c, "clearResidue")) },
  { id: "c3", what: "🔴 셋 다 **보고 줄(notes)까지 간다** — 세기만 하고 아무도 안 부르면 AC-69", hit: (c) =>
      /if \(!residue\.measured\) notes\.push/.test(c) && /else if \(residue\.cleared\) \{[\s\S]{0,400}notes\.push/.test(c) },
  { id: "c4", what: "🔴 제목 경고는 **넣은 제목보다 길 때만** 뜬다(«글자가 있다»면 매번 뜬다)", hit: (c) =>
      /residue\.titleLen > wantTitleLen/.test(c) },

  /* ═══ 반증 축 ═══ */
  { id: "d1", what: "🔴 복구 팝업 취소(`.se-popup-button-cancel`)는 **그대로 남아 있다** — 비우기는 덧방이지 대체가 아니다", hit: (c) =>
      /se-popup-button-cancel/.test(c) },
  { id: "d2", what: "제목을 넣는 자리는 **건드리지 않았다**(clearResidue 보다 앞이다)", hit: (c) =>
      c.indexOf("clickEditable(ed, S.title)") < c.indexOf("await clearResidue(page, ed)") },
  { id: "d3", what: "🔴 파일에 백스페이스 바이트(0x08)가 없다", hit: (_c, raw) => !raw.includes(String.fromCharCode(8)) },
  { id: "d4", what: "🔴 이 축들이 **주석이 아니라 코드**에 걸린다", hit: (c) => !/회의실 내용/.test(c) },
];

const MUTANTS: { id: string; why: string; by: string; apply: (s: string) => string }[] = [
  { id: "m1", why: "비우기를 아예 안 부른다(고치기 전 우리 코드)", by: "a3",
    apply: (s) => s.replace("    const residue = await clearResidue(page, ed);", "    const residue = { measured: false };") },
  { id: "m2", why: "🔴 40자 가드를 뺀다 — **정상 글마다** Ctrl+A·Delete 가 돈다", by: "b1",
    apply: (s) => s.replace("if (m0.body <= 40) return { measured: true,", "if (false) return { measured: true,") },
  { id: "m3", why: "🔴 «못 쟀다»를 «0자 깨끗»으로 바꾼다(AC-9)", by: "b2",
    apply: (s) => s.replace("if (!m0) return { measured: false };", "if (!m0) return { measured: true, before: 0, after: 0, cleared: false, titleLen: 0 };") },
  { id: "m4", why: "지운 뒤 다시 재지 않는다(«지웠으니 깨끗하겠지»)", by: "c1",
    apply: (s) => s.replace("  const m1 = await measure();\n  const after = m1 ? m1.body : null;", "  const after = 0;") },
  { id: "m5", why: "🔴 셈에 제목을 도로 넣는다(AM 그대로 — 제목 긴 글마다 거짓 경고)", by: "b4",
    apply: (s) => s.replace('.filter((c) => !c.closest(".se-documentTitle") && !/se-documentTitle/.test((c.className || "").toString()))', "") },
  { id: "m6", why: "제목 경고를 «글자가 있으면»으로 되돌린다(매번 뜬다)", by: "c4",
    apply: (s) => s.replace("residue.titleLen > wantTitleLen", "residue.titleLen > 0") },
  { id: "m7", why: "센 것을 보고에 안 싣는다(AC-69)", by: "c3",
    apply: (s) => s.replace('    if (!residue.measured) notes.push("앞 글 잔재를 못 쟀어요(에디터를 읽지 못했어요)");', "") },
  { id: "m8", why: "🔴 자리글씨를 안 걷는다 — 빈 칸의 «제목» 2자가 글자로 읽힌다", by: "b5",
    apply: (s) => s.replace('      c.querySelectorAll(".se-placeholder, .__se_placeholder").forEach((x) => x.remove());\n', "") },
  { id: "m9", why: "🔴 제목을 통째 textContent 로 되돌린다 — **배경사진 버튼 UI 글자 16자**가 매번 섞인다(실물 #1986 의 거짓 경고)", by: "b6",
    apply: (s) => s.replace("const title = titleEl ? paraText(titleEl) : \"\";", "const title = titleEl ? (titleEl.textContent || \"\") : \"\";") },
];

function run(raw: string): string[] {
  const code = codeOnly(raw);
  return AXES.filter((a) => !a.hit(code, raw)).map((a) => a.id);
}

/* 🔴 **줄끝을 고른다**(2026-09-21 · AC-151). 이 작업트리는 체크아웃마다 **CRLF 가 되기도 한다** —
   그러면 여러 줄짜리 변이 대상이 **글자 그대로 안 맞아** «변이가 안 먹었다»로 떨어진다(실제로 5건이 그랬다).
   🔴 자가 **파일이 아니라 줄끝에 걸려 빨개지면** 다음 사람이 «고장났다»로 읽고 축을 지운다. */
let raw: string;
try { raw = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n"); }   // 🔴 줄끝 고르기 — 아래 주석 참조
catch { console.log(`⊘ 못 쟀음 — ${FILE} 이 없다.`); process.exit(2); }

const baseFail = run(raw);
console.log(`■ ${FILE} — 축 ${AXES.length}개`);
for (const a of AXES) console.log(`  ${baseFail.includes(a.id) ? "❌" : "✅"} ${a.id} ${a.what}`);
console.log(`  ⊘ 진짜 에디터에 잔재가 되살아나는지는 **못 쟀다** — 실물 발행이 답한다.`);
console.log(`  ⊘ **제목 칸은 안 비운다** — 재서 적기만 한다(AM 에 실측 근거가 없다).`);

let bad = baseFail.length;

if (process.argv.includes("--mutate")) {
  console.log(`\n■ 변이 ${MUTANTS.length}개 — **이름이 맞는 축**이 잡아야 한다`);
  for (const m of MUTANTS) {
    const mutated = m.apply(raw);
    if (mutated === raw) { console.log(`  ❌ ${m.id} 변이가 **안 먹었다**(대상 글자가 없다) — ${m.why}`); bad++; continue; }
    const caught = run(mutated).filter((x) => !baseFail.includes(x));
    if (!caught.length) { console.log(`  ❌ ${m.id} **아무도 안 잡았다** — ${m.why}`); bad++; }
    else if (!caught.includes(m.by)) { console.log(`  ❌ ${m.id} ${m.by} 가 아니라 ${caught.join(",")} 가 잡았다(우연한 덮개) — ${m.why}`); bad++; }
    else console.log(`  ✅ ${m.id} ${m.by} 가 잡았다(${caught.join(",")}) — ${m.why}`);
  }
}

console.log(bad === 0 ? "\n✅ 통과" : `\n❌ ${bad}건`);
process.exit(bad === 0 ? 0 : 1);
