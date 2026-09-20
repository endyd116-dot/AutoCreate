/**
 * scripts/verify-enter-split.mts — 🔴 **«줄바꿈이 먹혔나»를 누르고 나서 확인한다**(2026-09-21 · B2 · AC-152).
 *
 *   ══ 왜 ══
 *     실측(잡 #325 · 공개 발행 0): 주소 문단 뒤 문단이 **한 줄에 붙었다**(에디터 문단 **3** · 계획 **4**).
 *     발행하면 네이버가 그 줄을 **통째로 버려** «사라진 것처럼» 보였다(#1986).
 *
 *   ══ 🔴 왜 «먼저 기다리기»가 아닌가 ══
 *     평문 URL 을 앵커로 바꾸는 **방아쇠가 그 `Enter` 자체**다. 누르기 전에 기다려 봐야 **아직 아무 일도 안 일어났다.**
 *     ⇒ **누르고 나서 «갈렸나»를 본다.** 문단 수는 DOM 으로 **정확히 읽힌다**(선택과 달리).
 *
 *   ══ 🔴 이 자의 절반은 «너무 많이 누르는 것»을 막는다 ══
 *     갈렸는데 또 누르면 **빈 줄이 쌓인다.** DOM 이 늦게 붙을 수도 있어 **잠깐 지켜보고** 나서야 «안 갈렸다»로 본다.
 *     성급하면 우리가 **멀쩡한 글에 빈 줄을 넣는다** — 고치려다 새 고장(오늘 여섯 번 본 모양).
 *     그리고 **못 재면 아무것도 더 하지 않는다**(AC-9).
 *
 *   ══ ⚠️ 한계 — 원인 귀속은 아직 «못 쟀다» ══
 *     🔴 A·B 대조는 **두 가지**가 달랐다: ①주소가 앵커가 되나 ②`waitLinkCards`+`moveCaretToEnd` 갈래를 타나
 *        (그 갈래는 `/https?:\/\//` 로 열리는데 B 의 `blog.naver.com/…` 은 **그 조건에 안 걸린다**).
 *     ⇒ «자동 링크 변환이 범인»은 **둘 중 하나**일 뿐 **가려진 게 아니다.**
 *        이 수리는 **둘 중 무엇이든** 듣는다(누르고 확인하니까). 그러나 **원인을 단정하지 않는다.**
 *
 *   쓰는 법: npx --yes tsx scripts/verify-enter-split.mts [--mutate]
 *   종료코드: 0 통과 · 1 실패 · 2 못 쟀음
 */
import { readFileSync } from "node:fs";
import { codeOnly } from "./_lib/code-only.mjs";

const NB = "runner/channels/naver-blog.mjs";

let raw: string;
try { raw = readFileSync(NB, "utf8").replace(/\r\n/g, "\n"); }   // 🔴 줄끝 고르기(AC-151)
catch { console.log("⊘ 못 쟀음 — 러너 파일을 못 읽었다."); process.exit(2); }

type Axis = { id: string; what: string; hit: (c: string, r: string) => boolean };

/** `pressEnterSplit` 본문만 — 파일 전체에서 찾으면 다른 자리의 같은 낱말에 속는다(AC-119). */
function splitBody(code: string): string {
  const at = code.indexOf("const pressEnterSplit = async () => {");
  if (at < 0) return "";
  let depth = 0, started = false;
  for (let i = at; i < code.length; i++) {
    if (code[i] === "{") { depth++; started = true; }
    else if (code[i] === "}") { depth--; if (started && depth === 0) return code.slice(at, i + 1); }
  }
  return code.slice(at);
}

const AXES: Axis[] = [
  /* ═══ ① 누르고 «갈렸나»를 본다 ═══ */
  { id: "a1", what: "`pressEnterSplit` 이 있다", hit: (c) => splitBody(c).length > 0 },
  { id: "a2", what: "🔴 누르기 **전에** 문단 수를 잰다(기준이 없으면 «늘었나»를 못 본다)", hit: (c) => {
      const b = splitBody(c);
      return b.indexOf("const before = await paraCount()") >= 0 && b.indexOf("const before") < b.indexOf('press("Enter")');
    } },
  { id: "a3", what: "누른 **뒤에** 다시 재서 «늘었나»를 본다", hit: (c) => /const grew = async \(\)/.test(splitBody(c)) },
  { id: "a4", what: "🔴 **안 갈렸을 때만** 한 번 더 누른다(갈렸는데 또 누르면 빈 줄이 쌓인다)", hit: (c) => {
      const b = splitBody(c);
      return /if \(ok1 !== false\) return ok1;/.test(b) && (b.match(/press\("Enter"\)/g) || []).length === 2;
    } },
  { id: "a5", what: "🔴 **잠깐 지켜본다**(한 번 재고 «안 갈렸다»로 단정하지 않는다 — DOM 이 늦게 붙는다)", hit: (c) => {
      const b = splitBody(c);
      return /const deadline = Date\.now\(\) \+ \d+;/.test(b) && /while \(Date\.now\(\) < deadline\)/.test(b);
    } },
  { id: "a6", what: "🔴 **못 재면 아무것도 더 안 한다** — «모른다»를 «안 갈렸다»로 바꾸지 않는다(AC-9)", hit: (c) => {
      const b = splitBody(c);
      return /if \(before < 0\) return null;/.test(b) && /if \(n < 0\) return null;/.test(b);
    } },
  { id: "a7", what: "두 번 눌러도 안 갈리면 **세고 말한다**(조용히 넘기지 않는다)", hit: (c) => {
      const b = splitBody(c);
      return /missed\.enterEatenTwice/.test(b) && /두 번 눌러도 줄이 안 갈렸어요/.test(b);
    } },
  { id: "a8", what: "먹힌 횟수를 **센다**(`missed.enterEaten`)", hit: (c) => /missed\.enterEaten = /.test(splitBody(c)) },

  /* ═══ ② 모든 문단 경계가 이 길을 탄다 ═══ */
  { id: "b1", what: "🔴 문단 경계 Enter 가 **하나도 안 남고** 이 길을 탄다(`if (wrote…) press(\"Enter\")` 가 0개)", hit: (c) =>
      !/if \(wrote[^)]*\) await page\.keyboard\.press\("Enter"\)/.test(c) },
  /* 🔴 **일곱**이다 — `type`(평문 문단) · `typeParts`(**강조 든 문단**) · 소제목 · 인용 · 구분선 · 사진 · 태그.
     `typeParts` 는 내가 처음에 **빼먹었고 이 축이 잡았다**(b1). 숫자를 박아 두면 다음에 또 빼먹을 때 운다. */
  { id: "b2", what: "부르는 자리가 **일곱**이다(평문·강조문단·소제목·인용·구분선·사진·태그)", hit: (c) =>
      (c.match(/await pressEnterSplit\(\)/g) || []).length === 7 },
  /* 🔴 **둘 다** 세야 한다 — `type` 과 `typeParts` 에 같은 줄이 있다. 하나만 보면
     **한쪽만 망가뜨리는 변이**를 옆에 남은 것이 살려 준다(AC-119 · 변이 m7 이 실제로 그렇게 빠져나갔다). */
  { id: "b3", what: "🔴 끊기가 **새 칸**을 만들었으면 Enter 를 안 누른다 — **두 자리 다**(평문·강조문단)", hit: (c) =>
      (c.match(/if \(wrote && !broke\) await pressEnterSplit\(\);/g) || []).length === 2 },
  { id: "b4", what: "문단 수는 **글자 칸 안**에서 센다(`.se-component.se-text .se-text-paragraph`)", hit: (c) =>
      /querySelectorAll\("\.se-component\.se-text \.se-text-paragraph"\)\.length/.test(c) },

  /* ═══ 반증 축 ═══ */
  { id: "c1", what: "🔴 **막지 않는다**(§9) — 이 함수는 `throw`·`BLOCK` 을 안 쓴다", hit: (c) => {
      const b = splitBody(c);
      return !/throw /.test(b) && !/BLOCK\(/.test(b);
    } },
  /* ⚠️ 🔴 **이 축만 `raw` 를 본다.** 그 줄엔 정규식 `/https?:\/\//` 가 있고, `codeOnly` 는 **정규식 안을 모른다** —
     `\/\/` 를 «주석 시작»으로 읽어 **줄 뒤를 통째로 지운다**(그 파일 머리말이 스스로 적어 둔 한계다).
     ⇒ 주석에 속을 위험보다 **줄이 통째로 사라지는 것**이 크다. 대신 이 낱말들은 주석에 안 쓴다. */
  { id: "c2", what: "🔴 주소 문단 뒤 **링크카드 대기와 끝잡기는 그대로**다 — 덧방이지 대체가 아니다", hit: (_c, r) =>
      /waitLinkCards\(\); await moveCaretToEnd\(page, ctx, missed\);/.test(r) },
  { id: "c3", what: "🔴 파일에 백스페이스 바이트(0x08)가 없다", hit: (_c, r) => !r.includes(String.fromCharCode(8)) },
  { id: "c4", what: "🔴 이 축들이 **주석이 아니라 코드**에 걸린다", hit: (c) => !/방아쇠가 그 `Enter` 자체다/.test(c) },
];

const MUTANTS: { id: string; why: string; by: string; apply: (s: string) => string }[] = [
  { id: "m1", why: "확인 없이 **한 번만** 누른다(고치기 전 우리 코드)", by: "b1",
    apply: (s) => s.replace("if (wrote && !broke) await pressEnterSplit();", 'if (wrote && !broke) await page.keyboard.press("Enter").catch(() => {});') },
  { id: "m2", why: "🔴 **무조건 두 번** 누른다 — 멀쩡한 글에 **빈 줄이 쌓인다**", by: "a4",
    apply: (s) => s.replace("    if (ok1 !== false) return ok1;                     // 갈렸거나 못 쟀다", "") },
  { id: "m3", why: "🔴 못 쟀는데 계속 간다(AC-9) — «모른다»가 «안 갈렸다»가 된다", by: "a6",
    apply: (s) => s.replace("    if (before < 0) return null;                       // 못 쟀다 — 종전대로 한 번만 누르고 간다", "") },
  { id: "m4", why: "지켜보지 않고 **한 번 재고 단정**한다 — DOM 이 늦으면 멀쩡한 줄에 빈 줄을 넣는다", by: "a5",
    apply: (s) => s.replace("      const deadline = Date.now() + 1500;", "      const deadline = Date.now() - 1;") },
  { id: "m5", why: "두 번째 실패를 **안 센다**(조용히 넘긴다)", by: "a7",
    apply: (s) => s.replace("      missed.enterEatenTwice = (missed.enterEatenTwice ?? 0) + 1;", "") },
  { id: "m6", why: "한 자리(태그 줄)만 **옛 길로** 되돌린다 — 그 줄만 조용히 붙는다", by: "b2",
    apply: (s) => s.replace("if (wrote && !brokeTags) await pressEnterSplit();", 'if (wrote && !brokeTags) await page.keyboard.press("Enter").catch(() => {});') },
  { id: "m7", why: "🔴 끊기가 새 칸을 만들어도 Enter 를 또 누른다 — **빈 줄이 쌓인다**", by: "b3",
    apply: (s) => s.replace("if (wrote && !broke) await pressEnterSplit();", "if (wrote) await pressEnterSplit();") },
  { id: "m8", why: "🔴 막는다(§9 위반) — «우리가 못 갈랐다»로 발행을 세운다", by: "c1",
    apply: (s) => s.replace('      console.log("  · ⚠️ 두 번 눌러도 줄이 안 갈렸어요 — 앞뒤 줄이 붙어서 나갈 수 있어요.");',
                            '      throw BLOCK("format_bleed", "줄이 안 갈렸어요");') },
  { id: "m9", why: "주소 뒤 링크카드 대기·끝잡기를 지운다(덧방이 대체가 된다)", by: "c2",
    apply: (s) => s.replace("{ await waitLinkCards(); await moveCaretToEnd(page, ctx, missed); }", "{ /* 지웠다 */ }") },
];

function run(r: string): string[] {
  const c = codeOnly(r);
  return AXES.filter((a) => { try { return !a.hit(c, r); } catch { return true; } }).map((a) => a.id);
}

const baseFail = run(raw);
console.log(`■ 줄바꿈 확인 — 축 ${AXES.length}개`);
for (const a of AXES) console.log(`  ${baseFail.includes(a.id) ? "❌" : "✅"} ${a.id} ${a.what}`);
console.log(`  ⊘ 진짜 에디터에서 줄이 갈리는지는 **못 쟀다** — 카나리 + 사진이 답한다.`);
console.log(`  ⊘ 🔴 **원인 귀속도 못 쟀다** — A·B 가 두 가지가 달랐다(앵커 여부 · 코드 갈래 여부).`);

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
