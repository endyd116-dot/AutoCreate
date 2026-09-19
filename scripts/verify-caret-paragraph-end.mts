/**
 * scripts/verify-caret-paragraph-end.mts — 🔴 **«문서 끝»과 «문단 끝»은 다른 자리다**(2026-09-20 · B2).
 *
 *   ══ 무엇을 재나 ══
 *     `moveCaretToEnd` 가 캐럿을 **마지막 문단의 진짜 끝**에 두는가. 두 축이 한 몸이다:
 *       ① **짚는 자리** — 문단의 **오른쪽 아래 모서리**를 클릭한다(AM `moveCaretToEnd` 2026-08-21).
 *          Playwright 기본 클릭은 **한가운데**고, 문단이 두 줄 이상 접히면 한가운데는 **가운뎃줄**이다.
 *          이어지는 `End` 는 «문단 끝»이 아니라 **그 줄 끝**으로 가고, 다음 글자가 **문단 한복판**에 끼어든다.
 *          AM 실물: 「월 44,80 | 서울 강서구…」 — DB 엔 완결된 문장이 실물에서 **두 동강**.
 *       ② **재는 자리** — 표식 검사가 **컴포넌트 번호만** 보면 ①의 실패를 **영영 못 본다**.
 *          한복판이어도 «마지막 컴포넌트»는 맞기 때문이다. ⇒ «마지막 문단의 **끝**에 붙었나»까지 본다.
 *     🔴 **①만 고치고 ②를 안 고치면 다음 사람이 ①을 지워도 아무도 모른다**(AC-113 «안 보는 축» · AC-119).
 *
 *   ══ 한계(적어 둔다) ══
 *     이 자는 **글자 훑기**다. 진짜 브라우저에서 캐럿이 어디 있는지는 **못 잰다** — 그건 실물 발행이 답한다.
 *     여기서 거는 것은 «그 방어가 코드에 **있나**»뿐이다. ⊘ 로 적는다.
 *
 *   쓰는 법: npx --yes tsx scripts/verify-caret-paragraph-end.mts [--mutate]
 *   종료코드: 0 통과 · 1 실패 · 2 못 쟀음(파일이 없다)
 */
import { readFileSync } from "node:fs";
import { codeOnly } from "./_lib/code-only.mjs";

const FILE = "runner/channels/naver-blog.mjs";

type Axis = { id: string; what: string; hit: (code: string, raw: string) => boolean };

/** `moveCaretToEnd` 본문만 — 파일 전체에서 찾으면 **다른 함수의 같은 낱말**에 속는다(AC-119). */
function bodyOf(code: string, name: string): string {
  const at = code.indexOf(`async function ${name}(`);
  if (at < 0) return "";
  let depth = 0, started = false;
  for (let i = at; i < code.length; i++) {
    const c = code[i];
    if (c === "{") { depth++; started = true; }
    else if (c === "}") { depth--; if (started && depth === 0) return code.slice(at, i + 1); }
  }
  return code.slice(at);
}

const AXES: Axis[] = [
  /* ═══ 잡는 축 ① 짚는 자리 ═══ */
  { id: "a1", what: "moveCaretToEnd 가 문단의 boundingBox 를 잰다", hit: (c) => /boundingBox\(/.test(bodyOf(c, "moveCaretToEnd")) },
  { id: "a2", what: "클릭이 position 으로 **오른쪽 아래 모서리**를 짚는다(width-2 · height-2)", hit: (c) => {
      const b = bodyOf(c, "moveCaretToEnd");
      return /position:\s*\{/.test(b) && /box\.width\s*-\s*2/.test(b) && /box\.height\s*-\s*2/.test(b);
    } },
  { id: "a3", what: "모서리가 0 이 되지 않게 Math.max 로 받친다", hit: (c) => /Math\.max\(1,\s*box\.(width|height)\s*-\s*2\)/.test(bodyOf(c, "moveCaretToEnd")) },
  { id: "a4", what: "boundingBox 를 못 재면 **기본 클릭으로 떨어진다**(폴백이 있다)", hit: (c) => {
      const b = bodyOf(c, "moveCaretToEnd");
      return /else\s+await para\.click\(\{\s*timeout/.test(b);
    } },

  /* ═══ 잡는 축 ② 재는 자리 ═══ */
  { id: "b1", what: "표식 검사가 atParaEnd 를 함께 돌려준다", hit: (c) => /atParaEnd/.test(bodyOf(c, "moveCaretToEnd")) },
  { id: "b2", what: "atParaEnd 는 **endsWith** 로 잰다(includes 면 한복판도 참이 된다)", hit: (c) => /atParaEnd:\s*t\.endsWith\(mark\)/.test(bodyOf(c, "moveCaretToEnd")) },
  { id: "b3", what: "«문서 끝» 판정에 **atParaEnd 가 들어 있다**", hit: (c) => {
      const b = bodyOf(c, "moveCaretToEnd");
      const m = b.match(/if\s*\(at\.idx === at\.total - 1[^)]*\)\s*return true/);
      return !!m && /at\.atParaEnd/.test(m[0]);
    } },
  { id: "b4", what: "마지막 문단은 `.se-component.se-text .se-text-paragraph` 에서 고른다(인용 안 문단이면 늘 거짓이 된다)", hit: (c) => {
      const b = bodyOf(c, "moveCaretToEnd");
      return /querySelectorAll\("\.se-component\.se-text \.se-text-paragraph"\)/.test(b);
    } },

  /* ═══ 반증 축 — «고치면서 딴 것을 망가뜨리지 않았나» ═══ */
  { id: "c1", what: "🔴 표식을 못 넣었으면(idx<0) 여전히 **«판정 불가»로 통과**시킨다(AC-9 의 반대편 얼굴)", hit: (c) => {
      const b = bodyOf(c, "moveCaretToEnd");
      return /if\s*\(at\.idx < 0\)\s*return true/.test(b);
    } },
  { id: "c2", what: "🔴 Control\\+b/i/u 로 캐럿 서식을 토글하지 않는다(읽을 수 없는 상태를 토글하면 반대로 켠다)", hit: (c) => !/Control\+[iu]\b/.test(bodyOf(c, "moveCaretToEnd")) },
  { id: "c3", what: "표식은 쓴 만큼 Backspace 로 지운다(자국 0)", hit: (c) => /for \(let i = 0; i < MARK\.length; i\+\+\) await page\.keyboard\.press\("Backspace"\)/.test(bodyOf(c, "moveCaretToEnd")) },
  { id: "c4", what: "«본문 추가»가 실패하면 **아무것도 안 하고 돌아간다**(문서 중간을 짚느니 안 하는 게 낫다)", hit: (c) => {
      const b = bodyOf(c, "moveCaretToEnd");
      return /missed\.caretEnd\+\+;\s*\n?\s*return false;/.test(b);
    } },
  { id: "c5", what: "🔴 파일에 백스페이스 바이트(0x08)가 없다 — 내가 한 번 박았다", hit: (_c, raw) => !raw.includes(String.fromCharCode(8)) },
  { id: "c6", what: "🔴 이 축들이 **주석이 아니라 코드**에 걸린다(주석을 걷고 잰다)", hit: (c) => c.length > 0 && !/AM 실물이 그 모양이었다/.test(c) },
];

/** 변이 — 각 변이는 **이름이 맞는 축**이 잡아야 한다(엉뚱한 축이 잡으면 그 축은 우연한 덮개다 · AC-119). */
const MUTANTS: { id: string; why: string; by: string; apply: (s: string) => string }[] = [
  { id: "m1", why: "모서리 대신 한가운데를 짚는다(고치기 전 우리 코드)", by: "a2",
    apply: (s) => s.replace("Math.max(1, box.width - 2)", "box.width / 2") },
  { id: "m2", why: "문단 끝 확인을 판정에서 뺀다(번호만 본다)", by: "b3",
    apply: (s) => s.replace("at.idx >= 0 && at.atParaEnd", "at.idx >= 0") },
  { id: "m3", why: "endsWith 를 includes 로 — 한복판도 «끝»이 된다", by: "b2",
    apply: (s) => s.replace("atParaEnd: t.endsWith(mark)", "atParaEnd: t.includes(mark)") },
  { id: "m4", why: "«표식을 못 넣었다»를 실패로 적는다(모르는 것을 틀렸다고 적기)", by: "c1",
    apply: (s) => s.replace("if (at.idx < 0) return true;", "if (at.idx < 0) return false;") },
  { id: "m5", why: "boundingBox 폴백을 지운다(못 재면 클릭 자체가 사라진다)", by: "a4",
    apply: (s) => s.replace(/\n\s*else await para\.click\(\{ timeout: 4000 \}\)\.catch\(\(\) => \{\}\);/, "") },
];

function run(raw: string): { pass: string[]; fail: string[] } {
  const code = codeOnly(raw);
  const pass: string[] = [], fail: string[] = [];
  for (const a of AXES) (a.hit(code, raw) ? pass : fail).push(a.id);
  return { pass, fail };
}

/* 🔴 **줄끝을 고른다**(2026-09-21 · AC-151). 이 작업트리는 체크아웃마다 **CRLF 가 되기도 한다** —
   그러면 여러 줄짜리 변이 대상이 **글자 그대로 안 맞아** «변이가 안 먹었다»로 떨어진다(실제로 5건이 그랬다).
   🔴 자가 **파일이 아니라 줄끝에 걸려 빨개지면** 다음 사람이 «고장났다»로 읽고 축을 지운다. */
let raw: string;
try { raw = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n"); }   // 🔴 줄끝 고르기 — 아래 주석 참조
catch { console.log(`⊘ 못 쟀음 — ${FILE} 이 없다.`); process.exit(2); }

const base = run(raw);
console.log(`■ ${FILE} — 축 ${AXES.length}개`);
for (const a of AXES) console.log(`  ${base.fail.includes(a.id) ? "❌" : "✅"} ${a.id} ${a.what}`);
console.log(`  ⊘ 진짜 브라우저의 캐럿 위치는 **못 쟀다** — 실물 발행이 답한다.`);

let bad = base.fail.length;

if (process.argv.includes("--mutate")) {
  console.log(`\n■ 변이 ${MUTANTS.length}개 — **이름이 맞는 축**이 잡아야 한다`);
  for (const m of MUTANTS) {
    const mutated = m.apply(raw);
    if (mutated === raw) { console.log(`  ❌ ${m.id} 변이가 **안 먹었다**(대상 글자가 없다) — ${m.why}`); bad++; continue; }
    const r = run(mutated);
    const caught = r.fail.filter((x) => !base.fail.includes(x));
    if (!caught.length) { console.log(`  ❌ ${m.id} **아무도 안 잡았다** — ${m.why}`); bad++; }
    else if (!caught.includes(m.by)) { console.log(`  ❌ ${m.id} ${m.by} 가 아니라 ${caught.join(",")} 가 잡았다(우연한 덮개) — ${m.why}`); bad++; }
    else console.log(`  ✅ ${m.id} ${m.by} 가 잡았다(${caught.join(",")}) — ${m.why}`);
  }
}

console.log(bad === 0 ? "\n✅ 통과" : `\n❌ ${bad}건`);
process.exit(bad === 0 ? 0 : 1);
