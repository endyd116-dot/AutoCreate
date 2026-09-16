/**
 * scripts/verify-reference-apply.mts — 레퍼런스가 배워 온 것이 **정말 프롬프트까지 가나**(R8CLOSE · B2 · 네트워크 0 · DB 0).
 *   사용: npx --yes tsx scripts/verify-reference-apply.mts
 *
 *   🔴 이 사슬이 조용히 끊기면 **아무 일도 안 일어난다** — 그게 지금 고치고 있는 병이다.
 *      «레퍼런스를 붙였다»는 화면 문구는 그대로 뜨는데 그림은 배우기 전과 똑같이 나온다.
 *      오류도 안 나고 로그도 안 남는다. 그래서 **여기서 프롬프트 글자를 직접 본다.**
 *
 *   ══ 재는 것 ══
 *     ① 자유 문장 → 우리 손잡이(fast|normal|hold) · 🔴 **못 읽으면 null**(«normal» 로 메우지 않는다 · AC-9)
 *     ② 닿는 것 / 못 내는 것 가르기 · 🔴 **못 낸 것은 이름과 이유로 남는다**
 *     ③ 🔴 우리 안전 규칙(무인물·무텍스트)과 싸우는 레퍼런스 규칙은 **버리고 버렸다고 적는다**
 *     ④ 🔴 **프롬프트에 실제로 박힌다** — STYLE 절·RULES 절·컷 비트 수
 *     ⑤ 🔴 **무회귀**(AC-68) — 레퍼런스가 없으면 프롬프트가 **종전과 한 글자도 안 달라진다**
 *     ⑥ 색은 `variant.palette` 로 — 화면 칩과 그림이 **같은 값**을 말한다
 */
import { applyReferenceStyle, applyRefPalette, paceHintOf } from "../lib/video/reference-apply";
import { buildShotPrompt, buildCutPlans, applyStyleMode, DEFAULT_GRAPHIC_STYLE, type CutDraft } from "../lib/video/scenes";
import { paletteLabelKo, type VideoSpec, type ScriptLine } from "../lib/video/types";
import type { TemplateStyle } from "../lib/video/reference";
import { readFileSync } from "node:fs";

let pass = 0; let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ""}`); }
};
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `받은 값: ${JSON.stringify(got)}\n      기대값: ${JSON.stringify(want)}`);
const whyOf = (u: { field: string; why: string }[], f: string) => u.filter((x) => x.field === f).map((x) => x.why).join(" | ");

/** `reference.ts stubRaw()` 가 내는 것과 **같은 모양**(스텁이 실경로와 같은 저장 모양을 통과한다). */
const STUB: TemplateStyle = {
  visual: "semi-stylized 3D, clean studio light",
  palette: "deep navy base with one warm accent",
  caption: "big keyword centered, one line",
  pace: "cut every 5s",
  camera: "two beats per cut: hold then push-in",
  rules: ["빨강은 계측선에만", "인물은 실루엣·뒷모습"],
  hookPrinciple: "아는 줄 알았던 것에 빈칸을 내서 끝까지 보게 한다",
  /* [R10-6] 숫자로 배워 오는 축 — 🔴 표본이 **제품과 같은 모양**이어야 한다(표본이 틀리면 초록도 틀린다). */
  typography: { weight: 900, strokeWidth: 3, shadow: "hard" },
  captionPlace: { position: "middle", maxCharsPerLine: 14, accentColor: "#ff6a00" },
  speed: { secPerCut: 5, totalSec: 45 },
  design: { colorCount: 3, sideMargin: 72 },
  audioTempo: 1.25,
};

console.log("① 자유 문장 → 우리 손잡이(fast|normal|hold)");
{
  eq("«cut every 5s» = 느리게 끊는다", paceHintOf("cut every 5s"), "hold");
  eq("«cut every 2s» = 빠르다", paceHintOf("cut every 2s"), "fast");
  eq("«4초마다» = 보통", paceHintOf("컷은 4초마다 바뀐다"), "normal");
  eq("«two beats per cut» = 보통", paceHintOf("two beats per cut: hold then push-in"), "normal");
  eq("«three beats» = 빠르다", paceHintOf("three beats per cut"), "fast");
  eq("«one beat» = 느리다", paceHintOf("one beat per cut, let it breathe"), "hold");
  eq("말로만 «rapid» 도 읽는다", paceHintOf("rapid, punchy editing"), "fast");
  eq("말로만 «lingering» 도 읽는다", paceHintOf("slow lingering shots"), "hold");
  eq("🔴 못 읽으면 null — «normal» 로 메우지 않는다", paceHintOf("moody and cinematic"), null);
  eq("빈 글도 null", paceHintOf(""), null);
  eq("🔴 초 숫자가 말보다 먼저다", paceHintOf("slow mood, but cut every 2s"), "fast");
}

console.log("\n② 닿는 것 / 못 내는 것 가르기");
{
  const r = applyReferenceStyle(STUB);
  eq("그림 스타일이 닿는다", r.applied.style, STUB.visual);
  eq("색이 닿는다", r.applied.palette, STUB.palette);
  eq("훅 원리가 닿는다", r.applied.hookPrinciple, STUB.hookPrinciple);
  eq("연출 규칙이 닿는다", r.applied.rules, STUB.rules);
  eq("호흡은 컷 비트 수로 닿는다", r.applied.pace, "hold");
  /* 🔴 **2026-09-16 저녁(R10-6)에 사실이 바뀌어 이 축을 고쳤다.**
     종전 축은 «자막 문법은 «상수»라 못 낸다고 적는다»였다 — 그때는 맞았다(굵기·색·그림자가 렌더에 박혀 있었다).
     그날 `buildOverlayHtml` 의 상수를 payload 값으로 열었고, 그래서 **이 축이 빨개졌다.**
     ⚠️ 여기서 «검사를 맞추려고» 코드를 되돌리면 그게 AC-78(검사가 값을 베끼는 것)의 거울상이다.
        사실이 움직였으면 **자를 고치는 게 맞다.** 다만 고칠 때 **무엇이 왜 바뀌었는지**를 이렇게 적어 둔다.
     새 축: 숫자로 읽은 자막 축은 `applied.captionType` 으로 **닿고**, 글로만 배워 온 것은 여전히 «못 낸다»로 남는다. */
  ok("🔴 숫자로 읽은 자막 축은 **닿는다**(굵기·자리·줄 수 — 2026-09-16 에 상수를 값으로 열었다)",
    !!r.applied.captionType && Object.keys(r.applied.captionType).length > 0, JSON.stringify(r.applied.captionType));
  {
    /* 대조군 짝 — **글로만** 배워 온 자막 문법(숫자 0)은 여전히 «못 낸다»로 남아야 한다(AC-68). */
    const wordy = applyReferenceStyle({ ...STUB, typography: undefined, captionPlace: undefined, design: undefined, caption: "big keyword centered, one line" });
    ok("🔴 글로만 배워 온 자막 문법은 **여전히 «못 낸다»**(숫자가 없으면 렌더에 넣을 수 없다)",
      whyOf(wordy.unused, "caption").includes("숫자로 못 읽었다"), JSON.stringify(wordy.unused));
  }
  ok("🔴 카메라는 «비트 수만 받았다»고 적는다", whyOf(r.unused, "camera").includes("비트 수만"), JSON.stringify(r.unused));
  ok("못 낸 것에는 **이유가 같이** 있다", r.unused.every((u) => u.field && u.why.length > 10));
}
{
  /* 🔴 **없는 것과 못 내는 것은 다르다**(AC-9) — 레퍼런스가 애초에 못 뽑은 축은 «못 냈다»에도 안 적는다. */
  const r = applyReferenceStyle({ visual: "", palette: "", caption: "", pace: "", camera: "" });
  eq("빈 템플릿 — 닿는 것 없음", r.applied, {});
  eq("🔴 빈 템플릿 — «못 냈다»도 없음(없는 것 ≠ 못 내는 것)", r.unused, []);
  eq("null 이 와도 안 터진다", applyReferenceStyle(null).applied, {});
}
{
  const r = applyReferenceStyle({ ...STUB, pace: "moody and cinematic", camera: "" });
  eq("빠르기를 못 읽으면 pace 는 없다", r.applied.pace, undefined);
  ok("🔴 그리고 «못 읽었다»고 적는다", whyOf(r.unused, "pace").includes("못 읽었다"), JSON.stringify(r.unused));
}

console.log("\n③ 🔴 우리 안전 규칙과 싸우는 레퍼런스 규칙은 버린다 — 그리고 버렸다고 적는다");
{
  const r = applyReferenceStyle({ ...STUB, rules: ["화면마다 큰 자막을 깔아라", "celebrity cameo in every cut", "빨강은 계측선에만"] });
  eq("살아남은 규칙은 하나", r.applied.rules, ["빨강은 계측선에만"]);
  ok("자막 요구를 버렸다고 적는다", whyOf(r.unused, "rules").includes("무텍스트"), JSON.stringify(r.unused));
  ok("실존 인물 요구를 버렸다고 적는다", whyOf(r.unused, "rules").includes("무인물"), JSON.stringify(r.unused));
}
{
  const many = Array.from({ length: 10 }, (_, i) => `규칙 ${i}`);
  eq("규칙은 6개까지", applyReferenceStyle({ ...STUB, rules: many }).applied.rules?.length, 6);
}

console.log("\n④ 🔴 프롬프트에 **실제로 박히나** — 여기가 이 검사의 심장이다");
const CUT: CutDraft = { key: "cut:0", subject: "a quiet kitchen counter at dawn" };
{
  const ap = applyReferenceStyle(STUB).applied;
  const got = buildShotPrompt(CUT, { durationSec: 6, styleBase: ap.style, extraRules: ap.rules, pace: ap.pace });
  const styleLine = got.split("\n").find((l) => l.startsWith("STYLE:")) ?? "";
  ok("🔴 STYLE 절이 **배워 온 그림**으로 바뀐다", styleLine.includes("clean studio light"), styleLine);
  ok("STYLE 절에 기본 문구는 안 남는다", !styleLine.includes("architectural visualization"), styleLine);
  const rulesLine = got.split("\n").find((l) => l.startsWith("RULES:")) ?? "";
  ok("🔴 RULES 절에 배워 온 규칙이 들어간다", rulesLine.includes("빨강은 계측선에만"), rulesLine);
  ok("🔴 우리 안전 규칙이 **뒤에** 온다(마지막 말이 우리 것)",
    rulesLine.indexOf("빨강은 계측선에만") < rulesLine.indexOf("No real people"), rulesLine);
}
{
  /* 🔴 pace 가 **정말 컷 수를 바꾸나** — 「넘겼는데 아무 일도 안 남」을 여기서 잡는다. */
  const beats = (p: string) => Number(p.match(/EXACTLY (\d+) hard cuts/)?.[1] ?? 0);
  const fast = buildShotPrompt(CUT, { durationSec: 8, pace: "fast" });
  const hold = buildShotPrompt(CUT, { durationSec: 8, pace: "hold" });
  ok("🔴 fast 가 hold 보다 더 많이 끊는다", beats(fast) > beats(hold), `fast=${beats(fast)} hold=${beats(hold)}`);
  eq("CAMERA GRAMMAR 도 같은 수를 말한다", Number(fast.match(/cut (\d+) times inside/)?.[1]), beats(fast));
}
{
  /* 🔴 컷 자신의 pace(대본 모델이 그 컷을 보고 정한 값)가 레퍼런스보다 **먼저**다. */
  const beats = (p: string) => Number(p.match(/EXACTLY (\d+) hard cuts/)?.[1] ?? 0);
  const withCut = buildShotPrompt({ ...CUT, pace: "hold" }, { durationSec: 8, pace: "fast" });
  eq("컷의 pace 가 이긴다", beats(withCut), beats(buildShotPrompt(CUT, { durationSec: 8, pace: "hold" })));
}
{
  /* 🔴 커넥터까지 — `buildCutPlans` 가 정말 넘기나(여기서 끊기면 gen.ts 는 부르는데 프롬프트는 안 바뀐다). */
  const lines: ScriptLine[] = [{ idx: 0, text: "새벽 부엌.", role: "hook", seconds: 5, cutIdx: 0 }];
  const windows = [{ idx: 0, lineIdx: [0], startMs: 0, endMs: 5000 }];
  const ap = applyReferenceStyle(STUB).applied;
  const on = buildCutPlans({ windows, lines, drafts: [CUT], format: "graphic", seconds: 15, hookType: "event_pushin", palette: "deep navy and amber", refStyle: ap });
  ok("🔴 buildCutPlans 가 레퍼런스를 프롬프트까지 옮긴다", on.plans[0].prompt.includes("clean studio light"), on.plans[0].prompt.split("\n")[1]);
  ok("배워 온 규칙도 같이 간다", on.plans[0].prompt.includes("빨강은 계측선에만"));
}

console.log("\n⑤ 🔴 무회귀 — 레퍼런스가 없으면 **종전과 한 글자도 안 달라진다**(AC-68)");
{
  const plain = buildShotPrompt(CUT, { durationSec: 6 });
  const nulls = buildShotPrompt(CUT, { durationSec: 6, styleBase: null, extraRules: null, pace: null });
  eq("null 을 넣어도 같다", plain, nulls);
  const styleLine = plain.split("\n").find((l) => l.startsWith("STYLE:")) ?? "";
  ok("🔴 STYLE 절이 기본 문구 그대로다", styleLine === `STYLE: ${applyStyleMode(DEFAULT_GRAPHIC_STYLE, "graphic")}`, styleLine);
  ok("RULES 절에 남의 규칙이 안 섞인다", !plain.includes("빨강은 계측선에만"));
}

console.log("\n⑥ 색 — 화면 칩과 그림이 **같은 값**을 말한다");
{
  const spec = { format: "graphic", seconds: 15, cuts: 4, variant: { hookType: "event_pushin", palette: "deep navy and amber", voiceId: "v1" } } as unknown as VideoSpec;
  const ap = applyReferenceStyle(STUB).applied;
  const out = applyRefPalette(spec, ap)!;
  eq("레퍼런스 색이 variant 로 들어간다", out.variant.palette, STUB.palette);
  eq("훅·보이스는 안 건드린다", [out.variant.hookType, out.variant.voiceId], ["event_pushin", "v1"]);
  ok("원본을 바꾸지 않는다(불변)", spec.variant.palette === "deep navy and amber");
  eq("🔴 레퍼런스에 색이 없으면 그대로 둔다", applyRefPalette(spec, {})!.variant.palette, "deep navy and amber");
  eq("영상 spec 이 없으면 undefined", applyRefPalette(undefined, ap), undefined);
}
{
  eq("표에 있는 색은 사람말로", paletteLabelKo("deep navy and amber"), "네이비");
  eq("🔴 표에 없는 색은 «기본» 이 아니라 «따로 정한 색»", paletteLabelKo(STUB.palette), "따로 정한 색");
  eq("빈 값만 «기본»", paletteLabelKo(""), "기본");
}

console.log("\n⑦ 🔴 사슬 — **제품이 정말 부르나**(순수 함수 하니스는 이걸 절대 못 잡는다 · AC-69)");
{
  /* 🔴 위 ①~⑥ 이 전부 초록인데도 **아무 일도 안 일어날 수 있다** — `director.ts` 가 안 부르거나
     `gen.ts` 가 `buildCutPlans` 에 안 넘기면 거기서 끝이다. 그게 이 라운드 내내 우리를 관통한 모양이라 여기서 글자로 본다.
     🔴 주석은 걷어 내고 본다 — «적어 둔 것»은 «하는 것»이 아니다(AC-59). */
  const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  const dir = code("lib/director.ts"); const gen = code("lib/video/gen.ts"); const scr = code("lib/video/script.ts");
  ok("director 가 배워 온 style 을 가른다", /applyReferenceStyle\(\s*tpl\.style/.test(dir));
  ok("🔴 director 가 piece 에 refStyle 을 싣는다", /refStyle\s*\?\s*\{\s*refStyle\s*\}/.test(dir));
  ok("🔴 못 낸 것도 piece 에 남는다(refUnused)", /refUnused\.length\s*\?\s*\{\s*refUnused\s*\}/.test(dir));
  ok("director 가 색을 variant 로 넣는다", /applyRefPalette\(\s*s\.video/.test(dir));
  ok("🔴 gen 이 컷 계획에 넘긴다", /buildCutPlans\(\{[^)]*refStyle/.test(gen), "buildCutPlans 호출에 refStyle 이 없다 — 배선이 여기서 끊기면 프롬프트는 안 바뀐다");
  eq("🔴 대본 두 번(첫 판·다시 쓰기) 다 훅 원리를 넘긴다", (gen.match(/hookPrinciple:\s*refStyle\?\.hookPrinciple/g) ?? []).length, 2);
  ok("대본 프롬프트가 훅 원리를 쓴다", /inp\.hookPrinciple/.test(scr));

  /* [R10-6] 🔴 **자막 모양 사슬** — 배워서 → 걸러서 → payload 로 → 러너가 CSS 로 그린다. 네 칸 중 하나라도 비면 장식이다. */
  /* [R12-1] 🔴 자막 **모양**과 **등장 방식**이 한 칸(`captions.type`)으로 합쳐졌다 — `capType` 가 그 자리다. */
  ok("🔴 gen 이 자막 모양·모션을 한 칸으로 묶는다",
    /const capType = refStyle\?\.captionType \|\| refStyle\?\.captionMotion/.test(gen),
    "capType 를 안 만든다 — 모양과 모션이 두 칸으로 갈리면 렌더가 둘을 따로 읽다 어긋난다");
  ok("🔴 그리고 그 칸을 render payload 에 싣는다",
    /captions:\s*\{[^}]*capType \? \{ type: capType \}/.test(gen),
    "captions 에 type 이 안 실린다 — reference-apply 가 만든 값을 아무도 안 부른다(AC-69)");
  ok("🔴 컷 전환도 payload 에 싣는다",
    /refStyle\?\.transition \? \{ transition: refStyle\.transition \}/.test(gen),
    "transition 이 payload 에 안 실린다 — 러너가 읽을 값이 없다(AC-69)");
  ok("🔴 말 속도를 TTS 에 실제로 넘긴다",
    /tempo: plan\.tempo/.test(gen) && /resolveNarrationTempo\(refStyle\?\.audioTempo\)/.test(gen),
    "TTS 호출에 tempo 가 없다 — R10 의 «저장까지»에서 한 발도 안 나간 것이다");
  ok("🔴 컷 하한을 실제로 먹인다",
    /applyCutFloor\(windows0,/.test(gen) && /refStyle\?\.minCutMs/.test(gen),
    "applyCutFloor 를 안 부른다");
  const rv = code("runner/channels/render-video.mjs");
  ok("🔴 러너가 그 값을 실제로 CSS 에 쓴다",
    /const t = captions\?\.type \?\? \{\}/.test(rv) && /font-weight:\$\{weight\}/.test(rv),
    "러너가 captions.type 을 안 읽는다 — payload 에 실어도 그림이 안 바뀐다");
  ok("🔴 한 줄 글자 수를 **실제로 끊는다**", /phraseHtml\(ph, maxLineChars\)/.test(rv) && /export function wrapPhrase/.test(rv));
  /* 🔴 무회귀 짝 — **안 주면 종전 값 그대로**여야 한다(값 열기가 그림을 바꾸면 그건 조용한 개편이다). */
  {
    const html = (await import("../runner/channels/render-video.mjs")).buildOverlayHtml({
      out: { w: 1080, h: 1920 }, overlay: { safeZone: { top: 220, bottom: 450, side: 60 } }, captions: { preset: "keyword_center" },
    } as never) as string;
    ok("🔴 자막 값을 **안 주면 종전 상수 그대로** 그린다(무회귀)",
      html.includes("font-weight:800") && html.includes("font-size:78px") && html.includes("#ffe14d") && !html.includes("text-stroke"),
      html.slice(html.indexOf("#cap{"), html.indexOf("#cap{") + 200));
  }
  /* 그리고 값을 주면 **그 값으로** 바뀐다(둘 다 재야 «열렸다»가 증명된다 · AC-68). */
  {
    const html = (await import("../runner/channels/render-video.mjs")).buildOverlayHtml({
      out: { w: 1080, h: 1920 }, overlay: { safeZone: { top: 220, bottom: 450, side: 60 } },
      captions: { preset: "keyword_center", type: { weight: 900, accentColor: "#ff6a00", strokeWidth: 3, position: "middle" } },
    } as never) as string;
    ok("그리고 값을 주면 **그 값으로** 그린다",
      html.includes("font-weight:900") && html.includes("#ff6a00") && html.includes("-webkit-text-stroke:3px") && html.includes("translateY(-50%)"),
      html.slice(html.indexOf("#cap{"), html.indexOf("#cap{") + 240));
  }

  /* 🔴 **낼 수 있는 축만 묻는다** — 물어서 못 내면 토큰만 쓰고 «못 냈어요» 칸만 늘어난다.
     [R12 · 2026-09-17] 🔴 **이 축을 뒤집었다.** R10 까지는 모션·전환을 «묻지 않는다»가 맞았다(렌더가 못 냈다).
     R12 가 렌더 구조를 바꿨다 ⇒ 이제 **물어야 맞다.** 대신 «목록 밖 값은 빼라»를 같이 말해야 한다
     (닫힌 어휘 없이 물으면 «타자기»·«와이프»가 들어와 `unused` 만 불린다). */
  const refSrc = readFileSync("lib/video/reference.ts", "utf8");
  const prompt = refSrc.slice(refSrc.indexOf("const ANALYZE_PROMPT"), refSrc.indexOf("function stubRaw"));
  ok("🔴 자막 모션·컷 전환을 **묻는다**(R12 가 렌더 구조를 바꿔 이제 낼 수 있다)",
    /captionMotion/.test(prompt) && /transition/.test(prompt),
    "프롬프트가 아직 모션·전환을 안 묻는다 — 낼 수 있는데 안 배우면 그것도 장식이다");
  ok("🔴 그리고 **닫힌 어휘**를 같이 말한다(넷·셋 밖은 자리가 없다)",
    /none\|fade\|slide_up\|pop/.test(prompt) && /none\|fade\|slide/.test(prompt) && /목록 밖 값을 쓰지 마라/.test(prompt));
  ok("🔴 **나가는 모션·길이는 여전히 안 묻는다**(겹치면 자막 2줄과 싸우고, 길이는 우리가 정한다)",
    /사라지는» 방식은 묻지 않는다/.test(prompt) && /길이»는 묻지 않는다/.test(prompt));
  ok("🔴 그리고 «모르면 키를 빼라»고 말한다(지어낸 «보통» 이 틀린 값보다 나쁘다)", /지어내지 마라/.test(prompt));
}

console.log(`\n${fail ? "🔴" : "✅"} ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
