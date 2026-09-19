/**
 * scripts/verify-heading-landed.mts — 🔴 **소제목이 통째로 증발한다**(2026-09-20 · B2 · AM `writeHeading` 에서 배웠다).
 *
 *   ══ 왜 이 자가 있나 ══
 *     AM 실물 #739: FAQ 첫 질문이 사라지고 **빈 문단 3개**만 남았다. 나머지 소제목 7개는 멀쩡했다 —
 *     🔴 **«어쩌다 한 번»이라서 더 위험하다.** 아무도 안 보면 다음에도 모른다.
 *     우리는 이 자리에서 **한 번도 확인한 적이 없었다.** `tailMatches` 는 우리 파일에 **이미 있었는데**
 *     `applyMark`·`typeParts` 에서만 썼다 — «없어서 못 한 것»이 아니라 **있는 도구를 그 자리에서 안 쓴 것**이다.
 *
 *   ══ 🔴 이 자의 절반은 «다시 치지 않는 쪽»을 지킨다 ══
 *     AM #742: 같은 소제목이 **두 번** 찍혔다(「💬 18석 규모…기록💬 18석 규모…」).
 *     꼬리 검사는 **마지막 문단**만 보는데 인용·구분선·사진 직후엔 소제목이 마지막이 아닐 수 있다 ⇒ **거짓 «없다»**.
 *     **증발보다 중복이 나쁘다** — 사장님 눈에 바로 보인다.
 *     ⇒ 다시 치기 전에 `alreadyInDoc` 로 묻고, **못 읽으면 다시 치지 않는다**(AC-92: «모른다»를 «없다»로 바꾸지 않는다).
 *     🔴 그래서 변이 m3·m4 는 «못 잡는 것»이 아니라 **«너무 많이 치는 것»**을 잡는 축이다.
 *
 *   ══ 한계 ══
 *     ⊘ 글자 훑기 자다. 진짜 에디터에서 소제목이 증발하는지는 **못 잰다** — 실물 발행이 답한다.
 *
 *   쓰는 법: npx --yes tsx scripts/verify-heading-landed.mts [--mutate]
 *   종료코드: 0 통과 · 1 실패 · 2 못 쟀음
 */
import { readFileSync } from "node:fs";
import { codeOnly } from "./_lib/code-only.mjs";

const FILE = "runner/channels/naver-blog.mjs";

/** `case "heading":` 조각만 — 파일 전체에서 찾으면 **다른 op 의 같은 낱말**에 속는다(AC-119). */
function headingCase(code: string): string {
  const at = code.indexOf('case "heading": {');
  if (at < 0) return "";
  const end = code.indexOf('case "quote": {', at);
  return end < 0 ? code.slice(at) : code.slice(at, end);
}

type Axis = { id: string; what: string; hit: (code: string, raw: string) => boolean };

const AXES: Axis[] = [
  /* ═══ ① 본다 ═══ */
  /* 🔴 «어딘가에 tailMatches 가 있다»로 재면 **바깥 문을 뜯어도 안쪽 것이 축을 살려 준다**(변이 m1 이 그걸 보여 줬다).
     확인은 **두 겹**이다 — ①치고 나서 ②다시 치고 나서. 둘 다 세어야 «바깥 문»이 지켜진다(AC-119). */
  { id: "a1", what: "소제목을 친 뒤 **꼬리를 확인한다** — 확인 문이 **두 겹**(치고 나서 · 다시 치고 나서)", hit: (c) =>
      (headingCase(c).match(/if \(!\(await tailMatches\(ctx, text\.slice\(-60\)\)\)\)/g) || []).length === 2 },
  { id: "a2", what: "확인이 **굵게 해제 뒤**에 온다(해제 전이면 다시 칠 때 굵기 상태가 다르다)", hit: (c) => {
      const h = headingCase(c);
      const off = h.indexOf("Control+b");
      const off2 = h.indexOf("Control+b", off + 1);
      const chk = h.indexOf("tailMatches");
      return off2 > 0 && chk > off2;
    } },

  /* ═══ ② 다시 친다 — 그러나 **함부로는 아니다** ═══ */
  { id: "b1", what: "🔴 다시 치기 **전에** `alreadyInDoc` 로 «문서 어딘가에 있나»를 묻는다(AM #742 중복 사고)", hit: (c) => {
      const h = headingCase(c);
      const ask = h.indexOf("alreadyInDoc");
      const retype = h.indexOf("keyboard.type(text", h.indexOf("headingRetry"));
      return ask > 0 && retype > ask;
    } },
  { id: "b2", what: "이미 있으면 **다시 치지 않고** ⊘ 로 적는다(headingTailBlind)", hit: (c) => /headingTailBlind\+\+/.test(headingCase(c)) },
  { id: "b3", what: "🔴 `alreadyInDoc` 는 **못 읽으면 true** — 다시 치지 않는 쪽으로 기운다(AC-92)", hit: (c) => {
      const at = c.indexOf("async function alreadyInDoc(");
      return at >= 0 && /\.catch\(\(\) => true\)/.test(c.slice(at, at + 700));
    } },
  { id: "b4", what: "`alreadyInDoc` 는 **공백을 걷고** 비교한다(에디터가 공백을 바꿔 넣는다)", hit: (c) => {
      const at = c.indexOf("async function alreadyInDoc(");
      return at >= 0 && (c.slice(at, at + 700).match(/replace\(\/\\s\+\/g, ""\)/g) || []).length >= 2;
    } },
  { id: "b5", what: "다시 칠 때 **끝을 다시 잡는다**(moveCaretToEnd) — 안 잡으면 엉뚱한 자리에 찍힌다", hit: (c) => {
      const h = headingCase(c);
      const r = h.indexOf("headingRetry");
      return r > 0 && /moveCaretToEnd\(page, ctx, missed\)/.test(h.slice(r));
    } },
  { id: "b6", what: "다시 치는 것은 **한 번뿐**이다(무한 재시도 금지 — 중복이 쌓인다)", hit: (c) => {
      const h = headingCase(c);
      return (h.match(/keyboard\.type\(text/g) || []).length === 2;
    } },

  /* ═══ ③ 적는다 — **갈라서** ═══ */
  { id: "c1", what: "세 갈래를 **따로** 센다(headingRetry · headingMissing · headingTailBlind)", hit: (c) =>
      ["headingRetry", "headingMissing", "headingTailBlind"].every((k) => new RegExp(`${k}:\\s*0`).test(c)) },
  { id: "c2", what: "🔴 셋 다 **보고 줄(notes)까지 간다** — 세기만 하고 아무도 안 부르면 그게 AC-69", hit: (c) =>
      ["headingRetry", "headingMissing", "headingTailBlind"].every((k) => new RegExp(`if \\(missed\\.${k}\\) notes\\.push`).test(c)) },
  { id: "c3", what: "«끝내 안 들어갔다»는 🔴 표시로 적는다(다른 둘과 무게가 다르다)", hit: (c) =>
      /if \(missed\.headingMissing\) notes\.push\(`🔴/.test(c) },
  { id: "c4", what: "다시 치고도 안 들어갔으면 **headingMissing 으로 센다**(조용히 넘기지 않는다)", hit: (c) => {
      const h = headingCase(c);
      const r = h.lastIndexOf("tailMatches");
      return r > 0 && /headingMissing\+\+/.test(h.slice(r));
    } },

  /* ═══ 반증 축 ═══ */
  { id: "d1", what: "🔴 크기 되돌리기(sizeLastTyped)는 **확인 뒤에** 그대로 남아 있다", hit: (c) => {
      const h = headingCase(c);
      return h.indexOf("sizeLastTyped") > h.indexOf("tailMatches");
    } },
  { id: "d2", what: "🔴 굵게 **해제 실패**는 여전히 markFormatDirty 로 적힌다(재시도 경로에서도)", hit: (c) =>
      (headingCase(c).match(/markFormatDirty\(fmt, "소제목 굵게 해제 실패"\)/g) || []).length >= 2 },
  { id: "d3", what: "🔴 파일에 백스페이스 바이트(0x08)가 없다", hit: (_c, raw) => !raw.includes(String.fromCharCode(8)) },
  { id: "d4", what: "🔴 이 축들이 **주석이 아니라 코드**에 걸린다", hit: (c) => !/증발보다 중복이 나쁘다/.test(c) },
];

const MUTANTS: { id: string; why: string; by: string; apply: (s: string) => string }[] = [
  { id: "m1", why: "확인을 아예 안 한다(고치기 전 우리 코드)", by: "a1",
    apply: (s) => s.replace("if (!(await tailMatches(ctx, text.slice(-60)))) {\n          if (await alreadyInDoc", "if (false) {\n          if (await alreadyInDoc") },
  { id: "m2", why: "다시 치고도 안 들어간 것을 **안 센다**", by: "c4",
    apply: (s) => s.replace("              missed.headingMissing++;\n", "") },
  { id: "m3", why: "🔴 중복 가드를 뺀다 — 거짓 «없다»에 그대로 **또 친다**(AM #742)", by: "b1",
    apply: (s) => s.replace("if (await alreadyInDoc(ctx, text)) {", "if (false) {") },
  { id: "m4", why: "🔴 «못 읽었다»를 «없다»로 바꾼다 — 안 보이면 **무조건 또 친다**", by: "b3",
    apply: (s) => s.replace("  }, t).catch(() => true);", "  }, t).catch(() => false);") },
  { id: "m5", why: "센 것을 보고에 안 싣는다(AC-69 — 만들어 놓고 아무도 안 부른다)", by: "c2",
    apply: (s) => s.replace("    if (missed.headingMissing) notes.push(", "    if (false) notes.push(") },
  { id: "m6", why: "다시 칠 때 끝을 안 잡는다(엉뚱한 자리에 찍힌다)", by: "b5",
    apply: (s) => s.replace("            await moveCaretToEnd(page, ctx, missed);\n            await page.keyboard.press(\"Control+b\").catch(() => {});", "            await page.keyboard.press(\"Control+b\").catch(() => {});") },
];

function run(raw: string): string[] {
  const code = codeOnly(raw);
  return AXES.filter((a) => !a.hit(code, raw)).map((a) => a.id);
}

let raw: string;
try { raw = readFileSync(FILE, "utf8"); }
catch { console.log(`⊘ 못 쟀음 — ${FILE} 이 없다.`); process.exit(2); }

const baseFail = run(raw);
console.log(`■ ${FILE} — 축 ${AXES.length}개`);
for (const a of AXES) console.log(`  ${baseFail.includes(a.id) ? "❌" : "✅"} ${a.id} ${a.what}`);
console.log(`  ⊘ 진짜 에디터에서 소제목이 증발하는지는 **못 쟀다** — 실물 발행이 답한다.`);

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
