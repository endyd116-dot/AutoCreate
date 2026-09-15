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
  ok("🔴 자막 문법은 못 낸다고 적는다", whyOf(r.unused, "caption").includes("상수"), JSON.stringify(r.unused));
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
}

console.log(`\n${fail ? "🔴" : "✅"} ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
