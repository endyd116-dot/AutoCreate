/**
 * scripts/verify-subtitle-font.mts — 🔴 «자막을 어느 폰트로 그렸나»를 재는 축과 **그 값이 사람에게 닿는 길**을 잰다
 *   (AC-202 · B2 · 2026-09-22). 사용: `npx --yes tsx scripts/verify-subtitle-font.mts` · 네트워크 0 · 브라우저 0 · DB 0
 *
 *   ══ 이 자가 지키는 것 ══
 *     ① `fontFaceCss` — `url()` 이 **맨 앞** · 굵기 범위 · `font-display:block` · 파일이 없으면 `url()` 을 **안 적는다**
 *     ② `judgeFont`   — 판정표 9줄. 🔴 세 자(face status · check · 폭)를 어떻게 합치나
 *     ③ 🔴 변이 6종(AC-87) — 판정을 일부러 어긋낸 것들이 **전부 빨강**을 내는지
 *     ④ **흰 목록** — `mergeRunnerFormatMarks` 가 `subtitleFont` 를 받아 적나(이 목록에서 값을 잃은 게 세 번째다)
 *     ⑤ 🔴 **보고 경로** — 러너가 재도 중간에서 버려지지 않나. 소스에 못을 박는다(코드를 읽어 확인한다)
 *     ⑥ 🔴 **동봉 경로** — `.woff2` 가 zip 에 들어가나. 안 들어가면 **개발 PC 에서만** 고쳐진 것이다
 *     ⑦ 사람말 — 겁주는 말 0(CLAUDE §3)
 *     ⑧ 🔴 **덩이 잡기 자체** — 닻·끝 표식을 지워 보고 `⊘` 가 나오는가(자가 «멈추는» 쪽 · 칸을 나눠 뒀다)
 *
 *   🔴 ══ [AC-216] 이 자가 **자기 병으로 조용한 초록이었다**(2026-09-22) ══
 *     ⑤의 소스 검사가 `indexOf(닻) + 700` 같은 **고정 창**이었다. 변이로 재 보니 러너·서버 두 가드를
 *     **빼도 초록**이었다 — 넓어진 창이 옆 덩이의 `formatMarks` 를 주워 왔다.
 *     ⇒ `scripts/lib/block.mjs blockOf` 로 바꿨다(끝 표식까지만 · 못 잡으면 `null`).
 *     🔴 그리고 **판정을 셋으로** 갈랐다: `✓` · `✗`(제품이 틀렸다) · **`⊘`(자가 못 쟀다 · 종료 2)**.
 *        B(`autocreate-b-f8`)의 잣대다 — 「창을 넓히는 자리는 전부 이 병을 품는다」.
 *
 *   ══ 실측값(이 자가 지키는 «그때 그 숫자») ══
 *     2026-09-22 · 같은 문장 "전기요금 3만원 아끼는 법 ABC 123" · 같은 PC
 *       동봉 **전**: `@font-face` status=`error` · `fonts.check`=false · Pretendard 폭 **1605.57** = 없는이름 폭 1605.57
 *       동봉 **후**: status=`loaded`          · `fonts.check`=true  · Pretendard 폭 **1427.44** ≠ 맑은고딕 1605.57
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mergeRunnerFormatMarks } from "../lib/format-marks";
/* 🔴 [AC-216] 고정 창(`+700`·`+900`·`+400`)을 버리고 **끝 표식까지**만 잡는다 — 못 잡으면 `⊘`(못 쟀음).
   변이로 재 보니 그 고정 창 둘이 **조용한 초록**이었다(가드를 빼도 통과 · 2026-09-22). 까닭은 파일 머리말에. */
import { blockOf, stripComments } from "./lib/block.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const load = async (rel: string) => await import(pathToFileURL(path.join(ROOT, rel)).href);
const { fontFaceCss } = await load("runner/channels/render-video.mjs") as {
  fontFaceCss: (f: string | null) => string;
};
const { judgeFont, fontSay } = await load("runner/lib/font.mjs") as {
  judgeFont: (m: unknown) => { kind: string; family: string | null; why?: string | null; ambiguous?: boolean };
  fontSay: (v: unknown) => string;
};
const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
/* 🔴 [AC-216] **주석을 걷고 본다.** 「찾긴 찾았는데 **주석에서** 찾았다」도 같은 병이다 —
   실측: 러너·서버 렌더 분기의 가드를 빼도 **바로 위 내 주석**에 `formatMarks`·`applyFormatMarksToPiece` 가
   적혀 있어서 **조용한 초록**이었다. 🔴 주석이 코드의 알리바이가 됐다(AC-59 의 사촌).
   ⚠️ 주석을 **공백으로 치환**하므로 길이·인덱스가 그대로다 — 순서 판정이 살아 있다. */
const code = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), "utf8"));

let pass = 0; let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ""}`); } };
/* 🔴 [AC-216] **«못 쟀다»는 «틀렸다»가 아니다.** `✗` 에 섞으면 자가 깨진 것이 제품이 틀린 것으로 보이고,
   `✓` 에 섞으면 **조용한 초록**이 된다. 오늘 둘 다 값을 치렀다(B 의 잣대 · `scripts/lib/block.mjs`). */
let unmeasured = 0;
const gone = (name: string, why = "닻이나 끝 표식이 바뀌었나") => { unmeasured++; console.log(`  ⊘ ${name} — 못 쟀음(${why})`); };
/** 덩이가 없으면 `⊘`, 있으면 판정. */
const okIn = (name: string, body: string | null, judge: (b: string) => boolean, extra = "") =>
  (body == null ? gone(name) : ok(name, judge(body), extra));

console.log("① fontFaceCss — 동봉본이 이기고, 없으면 안 적는다");
{
  const withFile = fontFaceCss("C:/x/PretendardVariable.woff2");
  const without = fontFaceCss(null);
  ok("파일이 있으면 url() 을 적는다", withFile.includes("url(") && withFile.includes(".woff2"));
  ok("🔴 url() 이 local() 보다 **앞**이다(src 는 우선순위 목록이다)",
    withFile.indexOf("url(") < withFile.indexOf('local("Pretendard")'), withFile);
  ok("format(\"woff2\") 를 밝힌다(브라우저가 헛수고를 안 한다)", withFile.includes('format("woff2")'));
  ok("🔴 굵기 범위 100 900 — 없으면 reference.ts 가 보내는 굵기가 **또** 안 먹는다", withFile.includes("font-weight:100 900"));
  ok("🔴 font-display:block — PNG 를 찍는 자리라 «폴백으로 찍히는 것»이 «잠깐 안 보이는 것»보다 나쁘다",
    withFile.includes("font-display:block"));
  ok("🔴 파일이 없으면 url() 을 **안 적는다**(없는 파일을 가리키면 또 «이름만 있는 폰트»다)",
    !without.includes("url("), without);
  ok("파일이 없어도 local() 폴백은 남는다(글자가 사라지지 않게)", without.includes('local("Pretendard")'));
  ok("패밀리 이름은 그대로 Pretendard", withFile.includes("font-family:Pretendard"));
}

/* ═══ ② 판정표 — 돌리기 전에 먼저 적었다 ═══ */
const W = (used: number, target: number, bogus: number, fallbackNamed?: number) => ({ used, target, bogus, ...(fallbackNamed !== undefined ? { fallbackNamed } : {}) });
interface C { name: string; m: Record<string, unknown>; kind: string; family?: string | null; why?: string; ambiguous?: boolean }
const MALGUN = 1605.57, PRET = 1427.44;
const TABLE: C[] = [
  { name: "🔴 동봉 전 실측 — face status=error → fallback", kind: "fallback", family: "Malgun Gothic", ambiguous: true,
    m: { faceStatus: "error", checks: { target: false }, widths: W(MALGUN, MALGUN, MALGUN, MALGUN), targetFamily: "Pretendard", fallbackName: "Malgun Gothic" } },
  { name: "🔴 동봉 후 실측 — status=loaded · check=true · 폭이 다르다 → bundled", kind: "bundled", family: "Pretendard",
    m: { faceStatus: "loaded", checks: { target: true }, widths: W(PRET, PRET, MALGUN, MALGUN), targetFamily: "Pretendard", fallbackName: "Malgun Gothic" } },
  { name: "🔴 폭을 못 쟀다 → unknown(«맞다»로 접지 않는다)", kind: "unknown", why: "widths_missing",
    m: { faceStatus: "loaded", checks: { target: true }, widths: { used: null, target: null, bogus: null }, targetFamily: "Pretendard" } },
  { name: "🔴 자들이 어긋난다(check 는 참인데 폭은 기본) → unknown", kind: "unknown", why: "signals_disagree",
    m: { faceStatus: "loaded", checks: { target: true }, widths: W(MALGUN, MALGUN, MALGUN), targetFamily: "Pretendard" } },
  { name: "🔴 아직 받는 중(unloaded) + 폭도 기본 → unknown(단정하지 않는다)", kind: "unknown", why: "face_unloaded",
    m: { faceStatus: "unloaded", checks: { target: false }, widths: W(MALGUN, MALGUN, MALGUN), targetFamily: "Pretendard" } },
  /* 🔴 **이 줄에서 내가 틀렸다**(2026-09-22 · 이 판 두 번째): 처음엔 `target:1700, bogus:1500` 으로 적어 놓고
     「Pretendard 만 지정해도 기본과 폭이 다른데 check 는 false」라는 **일어날 수 없는 조합**을 만들었다.
     Pretendard 를 못 쓰면 canvas 도 기본으로 떨어지므로 `target === bogus` 여야 한다.
     자는 그걸 `signals_disagree`(못 쟀다)로 냈고 — **코드가 맞고 표가 틀렸다.**
     ⇒ 앞뒤가 맞는 숫자로 고쳤다: 본문은 맑은 고딕(1700)으로 그려졌고, Pretendard 지정은 기본(1500)으로 떨어졌다. */
  { name: "폴백 이름 폭 ≠ 기본 폭 → 이름을 짚는다(ambiguous 아님)", kind: "fallback", family: "Malgun Gothic", why: "matched_named_fallback",
    m: { faceStatus: null, checks: { target: false }, widths: W(1700, 1500, 1500, 1700), targetFamily: "Pretendard", fallbackName: "Malgun Gothic" } },
  { name: "🔴 폴백 이름 폭 == 기본 폭 → 이름은 주되 **ambiguous**(못 가른 것을 가른 척 안 한다)", kind: "fallback", family: "Malgun Gothic", ambiguous: true,
    m: { faceStatus: null, checks: { target: false }, widths: W(MALGUN, MALGUN, MALGUN, MALGUN), targetFamily: "Pretendard", fallbackName: "Malgun Gothic" } },
  { name: "브라우저 기본으로 떨어졌고 이름을 못 짚는다 → family null", kind: "fallback", family: null, why: "browser_default",
    m: { faceStatus: "error", checks: { target: false }, widths: W(1500, 1500, 1500, 1700), targetFamily: "Pretendard", fallbackName: "Malgun Gothic" } },
  { name: "무엇으로 그렸는지 아예 모른다 → family null · target_absent", kind: "fallback", family: null, why: "target_absent",
    m: { faceStatus: "error", checks: { target: false }, widths: W(1234, 1234, 1500, 1700), targetFamily: "Pretendard", fallbackName: "Malgun Gothic" } },
];

console.log("\n② judgeFont — 판정표 9줄");
for (const c of TABLE) {
  const r = judgeFont(c.m);
  const okk = r.kind === c.kind
    && (c.family === undefined || (r.family ?? null) === c.family)
    && (!c.why || r.why === c.why)
    && (c.ambiguous === undefined || !!r.ambiguous === c.ambiguous);
  ok(c.name, okk, `kind=${r.kind} family=${r.family} why=${r.why} ambiguous=${!!r.ambiguous}`);
}

/* ═══ ③ 🔴 변이 — 이 판정에서 틀릴 수 있는 여섯 가지 ═══ */
console.log("\n③ 🔴 변이 6종 — 자가 «틀린 판정»을 잡는지(AC-87 음성 대조)");
type J = (m: Record<string, unknown>) => string;
const real: J = (m) => judgeFont(m).kind;
const MUT: { name: string; f: J }[] = [
  { name: "🔴 V1 face status=error 를 그냥 넘긴다 → **이번 판이 고친 그 병 자체**",
    f: (m) => (m.faceStatus === "error" ? "bundled" : real(m)) },
  { name: "V2 face status 를 아예 안 본다 → 받는 중(unloaded)을 폴백으로 단정한다",
    f: (m) => real({ ...m, faceStatus: null }) },
  { name: "V3 check() 만 믿는다 → 이름만 아는 상태를 «그렸다»로 읽는다",
    f: (m) => ((m.checks as { target?: boolean })?.target === true ? "bundled" : "fallback") },
  { name: "V4 폭만 믿는다 → face 를 못 받았는데도 «그렸다»가 된다",
    f: (m) => { const w = m.widths as Record<string, number | null>;
      if (!w?.target || !w?.bogus) return "unknown"; return w.target !== w.bogus ? "bundled" : "fallback"; } },
  { name: "🔴 V5 못 쟀을 때 «맞다»로 접는다 — 축이 있으나 마나가 된다",
    f: (m) => { const r = judgeFont(m); return r.kind === "unknown" ? "bundled" : r.kind; } },
  { name: "🔴 V6 아예 안 잰다(늘 bundled) — 이 기능을 통째로 뺀 것", f: () => "bundled" },
];
for (const mt of MUT) {
  const caught = TABLE.filter((c) => mt.f(c.m) !== c.kind);
  ok(`${mt.name} — 잡힘(${caught.length}줄)`, caught.length > 0, "🔴 아무 줄도 못 잡는다 = 그 규칙은 지금 아무도 안 지키고 있다");
}
{
  /* 🔴 V5·V7 은 «kind» 만으로는 안 죽는 변이라 따로 못을 박는다 — **ambiguous 를 떼는** 변이. */
  const c = TABLE.find((x) => x.ambiguous)!;
  const r = judgeFont(c.m);
  ok("🔴 V7 ambiguous 를 떼면(=못 가른 것을 단정하면) 잡힌다", r.ambiguous === true,
    "이 값이 없으면 화면이 «맑은 고딕이다»를 확정으로 읽는다");
}

console.log("\n④ 흰 목록 — mergeRunnerFormatMarks 가 subtitleFont 를 **버리지 않나**");
{
  const merged = mergeRunnerFormatMarks({ planned: {}, demoted: [] }, { subtitleFont: { kind: "fallback", family: "Malgun Gothic", why: "named_fallback_equals_default", ambiguous: true } });
  ok("🔴 받아 적는다(이 목록에서 값을 잃은 게 세 번째다: notes → paragraphs → subtitleFont)",
    merged.subtitleFont?.kind === "fallback" && merged.subtitleFont?.family === "Malgun Gothic", JSON.stringify(merged.subtitleFont));
  ok("ambiguous 도 살아남는다", merged.subtitleFont?.ambiguous === true);
  const bundled = mergeRunnerFormatMarks(null, { subtitleFont: { kind: "bundled", family: "Pretendard" } });
  ok("bundled 도 받아 적는다(«맞았다»도 사실이다)", bundled.subtitleFont?.kind === "bundled");
  ok("🔴 모르는 kind 는 **통째로 버린다**(«unknown» 으로 바꿔 적지 않는다)",
    mergeRunnerFormatMarks(null, { subtitleFont: { kind: "wat", family: "X" } }).subtitleFont === undefined);
  ok("🔴 안 보내면 키가 없다(«못 쟀다»는 «맞았다»가 아니다)",
    mergeRunnerFormatMarks(null, {}).subtitleFont === undefined);
  const prev = mergeRunnerFormatMarks(null, { subtitleFont: { kind: "bundled" } });
  ok("앞 값을 이어받는다(재보고에 사라지지 않는다)",
    mergeRunnerFormatMarks(prev, {}).subtitleFont?.kind === "bundled");
  ok("family 는 40자로 자른다(러너 주장 불신)",
    (mergeRunnerFormatMarks(null, { subtitleFont: { kind: "fallback", family: "가".repeat(80) } }).subtitleFont?.family ?? "").length === 40);
}

console.log("\n⑤ 🔴 보고 경로 — 재 놓고 중간에서 버려지지 않나(코드를 읽어 못 박는다)");
{
  /* 🔴 [AC-216] 종전엔 `indexOf(닻) + 700` 같은 **고정 창**이었다. 변이로 재 보니 **조용한 초록**이었다 —
     창이 옆 덩이를 먹어서 가드를 빼도 통과했다. 이제 **다음 분기가 시작되는 자리**까지만 본다.
     🔴 닻이나 끝 표식을 못 찾으면 `⊘`(못 쟀음) 다 — 그걸 `✓` 로도 `✗` 로도 접지 않는다. */
  const core = code("runner/core.mjs");
  const renderBranch = blockOf(core, "RENDER_KINDS.has(job.kind)", ["if (ADS_WRITE_KINDS", "if (job.kind ===", "return { ok: true, notes:"]);
  okIn("🔴 러너 core 의 렌더 분기가 formatMarks 를 싣는다(종전엔 발행 분기에만 있었다)",
    renderBranch?.body ?? null, (b) => b.includes("formatMarks"), "🔴 여기서 빠지면 러너가 재도 서버에 닿지 않는다");
  const jobs = code("lib/runner-jobs.ts");
  const serverBranch = blockOf(jobs, 'if (kind === "render.video")', ['if ((kind === "verify.post_alive"', "// 통계·생존 확인 잡"]);
  okIn("🔴 서버의 렌더 분기가 applyFormatMarksToPiece 를 부른다(종전엔 publish.* 안에만 있었다)",
    serverBranch?.body ?? null, (b) => b.includes("applyFormatMarksToPiece"), "🔴 여기서 빠지면 서버에 닿고도 글에 안 적힌다");
  const rv = code("runner/channels/render-video.mjs");
  ok("렌더러가 찍기 **전에** 폰트를 받아 놓는다(document.fonts.load)", rv.includes("document.fonts.load"));
  ok("렌더러가 성공 반환에 subtitleFont 를 싣는다", /formatMarks:\s*\{\s*subtitleFont\s*\}/.test(rv));
  /* 🔴 처음엔 끝 표식을 **다른 파일 것**(naver-blog.mjs 의 `publishNow`)으로 붙여 놨다 —
     그래서 이 자가 `⊘ 못 쟀음`을 냈다. **그게 이 판에서 고친 바로 그 값이다**: 종전 같으면
     `indexOf(-1) + 400` 이 되어 엉뚱한 조각을 보고 **조용히 초록**이었을 자리다. */
  const dry = blockOf(rv, "if (dryRun) {", ["const maxSec =", "const outPath ="]);
  okIn("드라이런에도 싣는다(카나리가 폰트를 볼 수 있어야 한다)",
    dry?.body ?? null, (b) => b.includes("subtitleFont"));
  /* 🔴 **순서**로도 못을 박는다 — 「재고 나서 찍는다」가 이 기능의 전부다(창이 조금 넓어도 순서는 안 속는다). */
  const iMeasure = rv.indexOf("measureOverlayFont(page)");
  const iShot = rv.indexOf("await page.screenshot(");
  ok("🔴 폰트를 **찍기 전에** 잰다(뒤에 재면 이미 폴백으로 박힌 뒤다)",
    iMeasure >= 0 && iShot >= 0 && iMeasure < iShot, `measure=${iMeasure} shot=${iShot}`);
}

console.log("\n⑥ 🔴 동봉 경로 — zip 에 실제로 들어가나(안 들어가면 개발 PC 에서만 고쳐진 것이다)");
{
  const b = src("scripts/build-runner.mts");
  ok("🔴 ALLOW_EXT 에 .woff2 가 있다", /ALLOW_EXT[^;]*\.woff2/s.test(b), "🔴 없으면 «확장자 밖»으로 건너뛴다 — 폰트가 고객에게 안 간다");
  ok("🔴 필수 목록에 폰트가 있다(다음 사람이 지우면 빌드가 소리친다)", b.includes("assets/fonts/PretendardVariable.woff2"));
  ok("⚖️ 필수 목록에 라이선스도 있다(OFL 은 라이선스 동봉이 조건이다)", b.includes("assets/fonts/LICENSE-Pretendard.txt"));
  const lic = src("runner/assets/fonts/LICENSE-Pretendard.txt");
  ok("⚖️ 동봉한 라이선스가 실제로 OFL 1.1 이다(«그렇다더라»가 아니라 원문으로)",
    /SIL OPEN FONT LICENSE Version 1\.1/i.test(lic) && /Reserved Font Name Pretendard/i.test(lic));
  const rv = src("runner/channels/render-video.mjs");
  ok("🔴 머리말이 이제 사실을 적는다(종전 주석은 «동봉»이라 해 놓고 아니었다 · AC-59)",
    rv.includes("거짓말이었다") && rv.includes("SIL Open Font License"));
}

console.log("\n⑦ 사람말 — CLAUDE §3(겁주지 않는다 · 시스템 용어 0)");
{
  const said = [
    fontSay({ kind: "bundled", family: "Pretendard" }),
    fontSay({ kind: "fallback", family: "Malgun Gothic", ambiguous: true }),
    fontSay({ kind: "fallback", family: "Malgun Gothic" }),
    fontSay({ kind: "fallback", family: null }),
    fontSay({ kind: "unknown", why: "widths_missing" }),
  ];
  const all = said.join(" ");
  ok("«못 쟀어요»를 «맞았어요»로 적지 않는다", said[4].includes("못 쟀"), said[4]);
  ok("🔴 못 가른 경우는 말에서도 단정하지 않는다", said[1].includes("구별은 못"), said[1]);
  ok("단정할 수 있을 때는 이름을 말한다", said[2].includes("Malgun Gothic"), said[2]);
  const BAD = ["정지", "불이익", "책임", "알려만", "경고", "위반", "제재", "오류입니다"];
  ok("겁주는 말 0", BAD.every((b) => !all.includes(b)), BAD.filter((b) => all.includes(b)).join(","));
  ok("시스템 용어 0(테넌트·piece·러너 잡)", !/테넌트|piece|러너 잡|font-face/i.test(all), all);
}

/* ═══ ⑧ 🔴 **덩이 잡기 자체를 잰다** — 「못 잡게 만들어 보고 ⊘ 가 나오는지」 ═══
 *   B(`autocreate-b-f8`) 조언: 「그걸 잰 변이가 없으면 고쳤다고 할 수 없다」.
 *   🔴 이건 축이 **우는** 게 아니라 자가 **멈추는** 쪽이라 위 변이 목록과 **칸을 나눠** 둔다.
 *   ⚠️ 파일을 건드리지 않는다 — **메모리 안의 글자**로 «닻을 지운다 / 끝 표식을 지운다»를 흉내 낸다.
 */
console.log("\n⑧ 🔴 덩이를 **못 잡게 만들면** ⊘ 가 나오는가(자가 멈추는 쪽)");
{
  const SAMPLE = [
    "if (A_KIND.has(k)) {",
    "  return { ok: true, formatMarks: x };",
    "}",
    "if (B_KIND.has(k)) {",
    "  return { ok: true, formatMarks: y };",
    "}",
  ].join("\n");
  const got = blockOf(SAMPLE, "A_KIND.has(k)", ["if (B_KIND"]);
  ok("정상 — 닻과 끝 표식이 있으면 **그 덩이만** 잡는다", !!got && got.body.includes("formatMarks: x") && !got.body.includes("formatMarks: y"), String(got?.body));
  ok("🔴 닻을 지우면 null(«가드 없음»이 아니라 **못 쟀음**)", blockOf(SAMPLE, "Z_KIND.has(k)", ["if (B_KIND"]) === null);
  ok("🔴 끝 표식을 지우면 null — **파일 끝까지 넓히지 않는다**(이게 이 판의 병이었다)",
    blockOf(SAMPLE, "A_KIND.has(k)", ["if (NOTHING_LIKE_THIS"]) === null);
  ok("🔴 상한 밖의 끝 표식은 못 찾은 것으로 본다(고정 창의 반대 — 넓히지 않고 멈춘다)",
    blockOf(SAMPLE, "A_KIND.has(k)", ["if (B_KIND"], { maxChars: 5 }) === null);
  /* 🔴 **주석이 코드의 알리바이가 되는 것**도 여기서 막는다(실측으로 겪은 그 자리). */
  const WITH_COMMENT = [
    "if (A_KIND.has(k)) {",
    "  /* formatMarks 를 여기서도 싣는다 */",
    "  return { ok: true };",
    "}",
    "if (B_KIND.has(k)) { return 1; }",
  ].join("\n");
  const raw = blockOf(WITH_COMMENT, "A_KIND.has(k)", ["if (B_KIND"]);
  const clean = blockOf(stripComments(WITH_COMMENT), "A_KIND.has(k)", ["if (B_KIND"]);
  ok("🔴 주석을 안 걷으면 **코드를 지워도 낱말이 남는다**(이게 조용한 초록이었다)", !!raw?.body.includes("formatMarks"));
  ok("🔴 주석을 걷으면 사라진다 — 코드만 본다", !clean?.body.includes("formatMarks"), String(clean?.body));
  ok("주석을 걷어도 **길이가 보존된다**(순서 판정이 살아 있어야 한다)",
    stripComments(WITH_COMMENT).length === WITH_COMMENT.length);
  ok("문자열 리터럴 속 `//` 는 주석이 아니다", stripComments('const s = "http://x"; // real').includes("http://x"));
}

/* 🔴 [AC-216] **못 쟀는데 통과로 넘기지 않는다.** 종료 0 = 전부 ✓ · 1 = 제품이 틀렸다 · 2 = **자가 못 쟀다**. */
console.log(`\n${fail > 0 ? "🔴" : unmeasured > 0 ? "⊘" : "🟢"} pass ${pass} · fail ${fail} · 못 쟀음 ${unmeasured}`);
if (unmeasured > 0 && fail === 0) console.log("🔴 자가 덩이를 못 잡았다 — 그건 «맞다»가 아니다(종료 2). 닻·끝 표식을 코드에 맞춰라.");
process.exit(fail > 0 ? 1 : unmeasured > 0 ? 2 : 0);
