/**
 * scripts/verify-paragraph-count.mts — 🔴 **«문단이 사라졌나»를 빼기 한 번으로 잡는다**(2026-09-21 · B2 · AC-150).
 *
 *   ══ 왜 ══
 *     2026-09-20 실측(잡 #325·#327 · 공개 발행 0): 네이버가 평문 URL 을 **앵커로 바꾸는 동안**
 *     우리가 친 `Enter` 가 먹혀 다음 문단이 **같은 줄에 붙었고**, 발행본에서는 그 줄이 **통째로 사라졌다**.
 *       A(`https://` 있음): 실물 **3** · 계획 **4**      B(뺌): 실물 **4** · 계획 **4**
 *     🔴 **그 «실물 문단 수»를 우리는 이미 세고 있었다**(`bleed.total`). **대조하는 사람이 없었을 뿐이다.**
 *     #1986 은 `total 25` 였다 — 그때 맞춰 봤으면 그날 알았다.
 *
 *   ══ 🔴 이 자가 지키는 것은 **셋**이다 ══
 *     ① **세는 규칙이 저쪽과 같은가** — `measureFormatBleedIn` 의 «4자 이상»과 이쪽 `PARA_MIN_CHARS` 가 갈라지면
 *        이 대조가 **통째로 거짓말**을 한다(저 함수는 `page.evaluate` 로 실려 가 바깥 변수를 못 써서 **손으로 맞춰 둔** 값이다).
 *     ② **막지 않는가** — §9. 이건 «사실»이지 «문»이 아니다. `stop` 을 내면 안 된다.
 *     ③ 🔴 **사람에게 닿는가** — `notes` 는 **서버가 버린다**(`runner-jobs.ts:854`), 콘솔은 **죽여야** 보인다.
 *        ⇒ `formatMarks`(meta) 로 가야 하고, **서버 `mergeRunnerFormatMarks` 가 흰 목록이라 거기에도 실려야 한다.**
 *        🔴 **어제 `notes` 로 겪은 그 자리다** — 세어 놓고 아무도 못 보면 그게 AC-69 다.
 *
 *   ══ 한계 ══
 *     ⊘ 이 자는 **셈과 배선**을 잰다. 진짜 에디터에서 문단이 붙는지는 **못 잰다** — 카나리 + 사진이 답한다.
 *
 *   쓰는 법: npx --yes tsx scripts/verify-paragraph-count.mts [--mutate]
 *   종료코드: 0 통과 · 1 실패 · 2 못 쟀음
 */
import { readFileSync } from "node:fs";
import { codeOnly } from "./_lib/code-only.mjs";
import { expectedParagraphCount, paragraphVerdict, PARA_MIN_CHARS } from "../runner/lib/format-bleed.mjs";

const FB = "runner/lib/format-bleed.mjs";
const NB = "runner/channels/naver-blog.mjs";
const FM = "lib/format-marks.ts";

type Axis = { id: string; what: string; hit: () => boolean };
const src: Record<string, string> = {};
/* 🔴 **줄끝을 고른다**(AC-151) — 이 작업트리는 체크아웃마다 CRLF 가 되기도 하고,
   그러면 여러 줄짜리 변이 대상이 안 맞아 «변이가 안 먹었다»로 떨어진다(2026-09-21 실측 5건). */
try { for (const f of [FB, NB, FM]) src[f] = readFileSync(f, "utf8").replace(/\r\n/g, "\n"); }
catch { console.log("⊘ 못 쟀음 — 파일을 못 읽었다."); process.exit(2); }
const code = (f: string) => codeOnly(src[f]);

/** 계획 하나 — 실물 #1986/#325 를 본뜬다(주소 줄 + 그 뒤 문단이 있는 모양). */
const PLAN = { ops: [
  { op: "para", text: "링크 시험입니다. 아래 줄에 주소가 있습니다." },
  { op: "heading", text: "소제목 하나" },
  { op: "para", text: "자세한 것은 이 블로그 에서 보실 수 있습니다." },
  { op: "para", role: "link_url", text: "https://blog.naver.com/endy1116" },
  { op: "para", text: "주소 바로 뒤 문단입니다." },
  { op: "list", text: "목록 한 줄" },
  { op: "check", text: "확인 한 줄" },
  { op: "divider", text: "" },
  { op: "note", text: "표는 줄글로 넣었습니다" },
  { op: "image", url: "u", caption: "첫째 사진" },
  { op: "image", url: "u2" },
  { op: "quote", text: "인용 한 줄입니다" },
  { op: "tags", text: "#가 #나" },
] };

const AXES: Axis[] = [
  /* ═══ ① 세는 규칙이 같은가 ═══ */
  { id: "a1", what: "🔴 `measureFormatBleedIn` 의 «N자 이상»과 `PARA_MIN_CHARS` 가 **같은 숫자**다", hit: () => {
      const m = /trim\(\)\.length >= (\d+)/.exec(code(FB));
      return !!m && Number(m[1]) === PARA_MIN_CHARS;
    } },
  { id: "a2", what: "짧은 글(4자 미만)은 **기대에서도 뺀다** — 저쪽이 안 세니까", hit: () => {
      const r = expectedParagraphCount([{ op: "para", text: "짧" }, { op: "para", text: "넉넉한 글자" }]);
      return r.expected === 1 && r.skipped === 1;
    } },
  { id: "a3", what: "목록·체크는 **머리표(`• `·`☑ `)까지** 세어 길이를 판정한다(러너가 붙인다)", hit: () => {
      const r = expectedParagraphCount([{ op: "list", text: "가나" }]);   // 2자 + «• » = 4자 ⇒ 세어진다
      return r.expected === 1;
    } },
  { id: "a4", what: "구분선·메모·사진(설명 없음)은 문단을 **안 만든다**", hit: () => {
      const r = expectedParagraphCount([{ op: "divider" }, { op: "note", text: "메모입니다" }, { op: "image", url: "u" }]);
      return r.expected === 0 && r.skipped === 3;
    } },
  { id: "a5", what: "사진 **설명**은 본문 문단으로 센다(러너가 본문에 친다)", hit: () =>
      expectedParagraphCount([{ op: "image", url: "u", caption: "첫째 사진" }]).expected === 1 },
  { id: "a6", what: "🔴 인용은 `expected` 가 아니라 **`uncertain`** 이다(컴포넌트면 안 세지고 폴백이면 세진다)", hit: () => {
      const r = expectedParagraphCount([{ op: "quote", text: "인용 한 줄입니다" }]);
      return r.expected === 0 && r.uncertain === 1;
    } },
  { id: "a7", what: "본뜬 계획의 기대값이 **손으로 센 것과 같다**(para4 + heading1 + list1 + check1 + 캡션1 + tags1 = 9 · 인용 폭 1)", hit: () => {
      const r = expectedParagraphCount(PLAN.ops);
      return r.expected === 9 && r.uncertain === 1;
    } },

  /* ═══ ② 판정 ═══ */
  { id: "b1", what: "🔴 실물이 **적으면** `lost` — 오늘 잡은 그 병", hit: () => paragraphVerdict(PLAN, { total: 8 }).kind === "lost" },
  { id: "b2", what: "맞으면 `ok`", hit: () => paragraphVerdict(PLAN, { total: 9 }).kind === "ok" },
  { id: "b3", what: "🔴 인용 폭 **안**이면 `ok`(폴백으로 하나 늘어난 것) — 거짓 경고를 안 낸다", hit: () => paragraphVerdict(PLAN, { total: 10 }).kind === "ok" },
  { id: "b4", what: "폭을 넘겨 많으면 `extra`(네이버가 쪼갰다)", hit: () => paragraphVerdict(PLAN, { total: 12 }).kind === "extra" },
  { id: "b5", what: "🔴 **못 쟀으면 `unknown`** — `measured:false` · `actual` 은 **null**(0 이 아니다 · AC-9)", hit: () => {
      const v = paragraphVerdict(PLAN, null);
      return v.kind === "unknown" && v.measured === false && v.actual === null;
    } },
  { id: "b6", what: "🔴 `lost` 문장이 **무엇을·어떻게**를 말한다(§3 — 겁주지 않고 사실+원인 짐작)", hit: () => {
      const l = paragraphVerdict(PLAN, { total: 8 }).line;
      return l.includes("문단이 비었어요") && l.includes("한 줄로 붙었을") && !/정지|불이익|책임/.test(l);
    } },
  { id: "b7", what: "🔴 **막지 않는다** — 판정에 `stop` 이 없다(§9)", hit: () => !("stop" in (paragraphVerdict(PLAN, { total: 3 }) as object)) },

  /* ═══ ③ 🔴 사람에게 닿는가 — 어제 notes 로 잃은 그 자리 ═══ */
  { id: "c1", what: "러너가 `paragraphVerdict` 를 **부른다**", hit: () => /paragraphVerdict\(plan, bleed\)/.test(code(NB)) },
  { id: "c2", what: "🔴 결과를 **`formatMarks` 에 싣는다**(notes 만으로는 서버가 버린다)", hit: () => /formatMarks\.paragraphs\s*=/.test(code(NB)) },
  { id: "c3", what: "🔴 서버 흰 목록(`mergeRunnerFormatMarks`)이 **`paragraphs` 를 받는다**", hit: () => /base\.paragraphs = paras/.test(code(FM)) },
  { id: "c4", what: "🔴 서버가 **앞서 저장된 값도 지킨다**(재보고 때 날아가지 않게)", hit: () => /paragraphsOf\(p\.paragraphs\)/.test(code(FM)) },
  { id: "c5", what: "🔴 서버가 **모양을 검사한다** — `expected` 가 숫자가 아니면 통째로 버린다", hit: () => /if \(expected === null \|\| expected < 0\) return null;/.test(code(FM)) },
  { id: "c6", what: "🔴 서버가 `actual`·`diff` 의 **null 을 0 으로 채우지 않는다**(AC-9)", hit: () => {
      const c = code(FM);
      return /o\.actual === null \|\| o\.actual === undefined \? null/.test(c) && /o\.diff === null \|\| o\.diff === undefined \? null/.test(c);
    } },
  { id: "c7", what: "`lost` 일 때 **그 화면을 찍어 둔다**(사진이 어제 답을 냈다)", hit: () => /06-문단어긋남/.test(code(NB)) },

  /* ═══ 반증 축 ═══ */
  { id: "d1", what: "🔴 번짐 검사(`bleedVerdict`)는 **그대로 남아 있다** — 덧방이지 대체가 아니다", hit: () => /bleedVerdict\(bleed\)/.test(code(NB)) },
  { id: "d2", what: "🔴 파일에 백스페이스 바이트(0x08)가 없다", hit: () => [FB, NB, FM].every((f) => !src[f].includes(String.fromCharCode(8))) },
  { id: "d3", what: "🔴 이 축들이 **주석이 아니라 코드**에 걸린다", hit: () => !/대조하는 사람이 없었을 뿐이다/.test(code(FB)) },
];

const MUTANTS: { id: string; why: string; by: string; file: string; apply: (s: string) => string }[] = [
  { id: "m1", why: "🔴 세는 규칙을 갈라 놓는다(저쪽 4자 → 2자) — 대조가 통째로 거짓말한다", by: "a1", file: FB,
    apply: (s) => s.replace("trim().length >= 4", "trim().length >= 2") },
  { id: "m2", why: "인용을 `expected` 에 섞는다 — 인용 있는 글마다 **거짓 `lost`**", by: "a6", file: FB,
    apply: (s) => s.replace('case "quote": if (long(`“${t}”`)) uncertain++; else skipped++; break;', 'case "quote": if (long(`“${t}”`)) expected++; else skipped++; break;') },
  { id: "m3", why: "🔴 못 쟀을 때 `actual` 을 0 으로 채운다(AC-9) — «못 쟀다»가 «전부 사라졌다»가 된다", by: "b5", file: FB,
    apply: (s) => s.replace('actual: null, diff: null, kind: "unknown",', 'actual: 0, diff: 0, kind: "lost",') },
  { id: "m4", why: "인용 폭을 없앤다 — 폴백 인용 하나에 **거짓 `extra`**", by: "b3", file: FB,
    apply: (s) => s.replace("actual > expected + uncertain", "actual > expected") },
  { id: "m5", why: "🔴 `formatMarks` 에 안 싣는다 — notes 만 남고 **서버가 버린다**(어제 그 자리)", by: "c2", file: NB,
    apply: (s) => s.replace("formatMarks.paragraphs = {", "const _dropped = {") },
  { id: "m6", why: "🔴 서버 흰 목록에서 뺀다 — 러너가 보내도 **조용히 사라진다**(AC-69)", by: "c3", file: FM,
    apply: (s) => s.replace("if (paras) base.paragraphs = paras;", "") },
  { id: "m7", why: "서버가 앞서 저장한 값을 안 지킨다 — 재보고마다 **날아간다**", by: "c4", file: FM,
    apply: (s) => s.replace("...(paragraphsOf(p.paragraphs) ? { paragraphs: paragraphsOf(p.paragraphs)! } : {}),", "") },
  { id: "m8", why: "🔴 막는다(`stop`) — §9 위반. «사실»을 «문»으로 바꾼다", by: "b7", file: FB,
    apply: (s) => s.replace('return { measured: true, expected, uncertain, skipped, actual, diff: actual - expected, kind, line };',
                            'return { measured: true, expected, uncertain, skipped, actual, diff: actual - expected, kind, line, stop: kind === "lost" };') },
  { id: "m9", why: "머리표를 안 세어 짧은 목록을 놓친다", by: "a3", file: FB,
    apply: (s) => s.replace('case "list":  if (long(`• ${t}`)) expected++;', 'case "list":  if (long(t)) expected++;') },
];

function run(): string[] { return AXES.filter((a) => { try { return !a.hit(); } catch { return true; } }).map((a) => a.id); }

const baseFail = run();
console.log(`■ 문단 수 대조 — 축 ${AXES.length}개`);
for (const a of AXES) console.log(`  ${baseFail.includes(a.id) ? "❌" : "✅"} ${a.id} ${a.what}`);
console.log(`  ⊘ 진짜 에디터에서 문단이 붙는지는 **못 쟀다** — 카나리 + 사진이 답한다.`);

let bad = baseFail.length;

if (process.argv.includes("--mutate")) {
  console.log(`\n■ 변이 ${MUTANTS.length}개 — **이름이 맞는 축**이 잡아야 한다`);
  console.log(`  ⚠️ 글자 변이는 **글자 훑기 축(a1·c2~c7·d*)** 만 움직인다 — 셈 축(a2~a7·b*)은 이 파일이 **임포트한 함수**를 쓴다.`);
  for (const m of MUTANTS) {
    const before = src[m.file];
    const mutated = m.apply(before);
    if (mutated === before) { console.log(`  ❌ ${m.id} 변이가 **안 먹었다**(대상 글자가 없다) — ${m.why}`); bad++; continue; }
    src[m.file] = mutated;
    /* 🔴 셈 축은 임포트된 함수라 글자를 바꿔도 안 움직인다 ⇒ **변이한 본문을 실제로 돌려** 판정한다. */
    let caught: string[] = [];
    try {
      const mod = await import(`data:text/javascript;base64,${Buffer.from(mutated).toString("base64")}`).catch(() => null);
      caught = run().filter((x) => !baseFail.includes(x));
      if (m.file === FB && mod) {
        const ec = mod.expectedParagraphCount, pv = mod.paragraphVerdict, pm = mod.PARA_MIN_CHARS;
        const probe: Record<string, boolean> = {
          a2: ec([{ op: "para", text: "짧" }, { op: "para", text: "넉넉한 글자" }]).expected === 1,
          a3: ec([{ op: "list", text: "가나" }]).expected === 1,
          a6: (() => { const r = ec([{ op: "quote", text: "인용 한 줄입니다" }]); return r.expected === 0 && r.uncertain === 1; })(),
          a7: (() => { const r = ec(PLAN.ops); return r.expected === 9 && r.uncertain === 1; })(),
          b3: pv(PLAN, { total: 10 }).kind === "ok",
          b5: (() => { const v = pv(PLAN, null); return v.kind === "unknown" && v.measured === false && v.actual === null; })(),
          b7: !("stop" in (pv(PLAN, { total: 3 }) as object)),
          a1: (() => { const mm = /trim\(\)\.length >= (\d+)/.exec(codeOnly(mutated)); return !!mm && Number(mm[1]) === pm; })(),
        };
        for (const [k, ok] of Object.entries(probe)) if (!ok && !caught.includes(k) && !baseFail.includes(k)) caught.push(k);
      }
    } catch { /* 아래에서 «아무도 안 잡았다»로 떨어진다 */ }
    src[m.file] = before;
    if (!caught.length) { console.log(`  ❌ ${m.id} **아무도 안 잡았다** — ${m.why}`); bad++; }
    else if (!caught.includes(m.by)) { console.log(`  ❌ ${m.id} ${m.by} 가 아니라 ${caught.join(",")} 가 잡았다(우연한 덮개) — ${m.why}`); bad++; }
    else console.log(`  ✅ ${m.id} ${m.by} 가 잡았다(${caught.join(",")}) — ${m.why}`);
  }
}

console.log(bad === 0 ? "\n✅ 통과" : `\n❌ ${bad}건`);
process.exit(bad === 0 ? 0 : 1);
