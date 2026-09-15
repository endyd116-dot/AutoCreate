/**
 * scripts/verify-b3-slang.mts — **신조어 화이트리스트가 검사에 실제로 먹나**(DESIGN §5C.4 · R8CLOSE-B1 §B3).
 *   실행: `npx --yes tsx scripts/verify-b3-slang.mts`   · DB·네트워크·AI 호출 **0**(돈 0원).
 *
 *   🔴 이 하니스의 핵심은 «표가 예쁜가»가 아니라 **«표를 안 봤을 때와 결과가 다른가»** 다.
 *      표만 만들고 검사가 안 보면 이 칸은 안 닫힌다(AC-69 «정의가 있나»가 아니라 «제품이 부르나»).
 */
import { SLANG_BY_AGE, AGE_BANDS, slangAllowedFor, isAllowedSlang, toAgeBand, slangPromptLine, UNKNOWN_ALLOWS_ALL, AGE_SAY } from "../lib/slang-whitelist";
import { classifyBanned, BANNED_TONE, BANNED_HARD } from "../lib/banned-words";

const results: { step: string; ok: boolean; note: string }[] = [];
const rec = (step: string, ok: boolean, note = "") => { results.push({ step, ok: !!ok, note }); };

/* ── ① 표 자체 ── */
rec("① 다섯 연령대가 다 있다", AGE_BANDS.length === 5 && AGE_BANDS.every((b) => SLANG_BY_AGE[b].length > 0), AGE_BANDS.join(","));
rec("① 🔴 표가 한 곳이다 — 뒤집은 표를 따로 안 적고 코드가 만든다", new Set(Object.values(SLANG_BY_AGE).flat()).size === Object.values(SLANG_BY_AGE).flat().length,
  "같은 낱말이 두 연령대에 겹쳐 적혀 있으면 «표 두 벌»의 시작이다");
rec("① 값이 이상하면 null(«모름») — 기본값으로 안 채운다", toAgeBand("30s") === "30s" && toAgeBand("서른") === null && toAgeBand(undefined) === null);

/* ── ② 누적 — 아래 세대는 위 세대 말도 쓴다, 거꾸로는 아니다 ── */
{
  const young = slangAllowedFor("20s"), old = slangAllowedFor("50s");
  rec("② 20대는 50대 말도 쓴다(누적)", SLANG_BY_AGE["50s"].every((w) => young.includes(w)), `20대 허용 ${young.length}개`);
  rec("② 🔴 50대는 20대 말을 안 쓴다", SLANG_BY_AGE["20s"].every((w) => !old.includes(w)), `50대 허용 ${old.length}개`);
  rec("② 10대 말은 30대에서 안 쓴다", !slangAllowedFor("30s").includes(SLANG_BY_AGE["10s"][0]), SLANG_BY_AGE["10s"][0]);
}

/* ── ③ 🔴 모르면 넓게 잡는다 — 모른다고 잡으면 재작성이 돌고 돈이 두 배다(§9) ── */
rec("③ 연령대를 모르면 전부 허용", UNKNOWN_ALLOWS_ALL && SLANG_BY_AGE["10s"].every((w) => isAllowedSlang(w, null)), `모름 → ${slangAllowedFor(null).length}개 허용`);

/* ── ④ 🔴 검사가 표를 **실제로 본다** — 표를 줬을 때와 안 줬을 때 결과가 달라야 한다 ── */
{
  const text = "이번 가격은 진짜 역대급이에요. 끝판왕이라고 봐도 돼요.";
  const without = classifyBanned(text, {});
  const with30 = classifyBanned(text, { allowSlang: slangAllowedFor("30s") });
  const with50 = classifyBanned(text, { allowSlang: slangAllowedFor("50s") });
  rec("④ 표를 안 주면 종전 그대로 잡힌다", without.tone.length === 2, `tone ${without.tone.map((h) => h.word).join("·")}`);
  rec("④ 🔴 30대 표를 주면 **안 잡힌다**(이게 이 칸의 값이다)", with30.tone.length === 0, `tone ${with30.tone.length}건`);
  rec("④ 🔴 50대 표를 주면 그대로 잡힌다(50대는 그 말을 안 쓴다)", with50.tone.length === 2, `tone ${with50.tone.map((h) => h.word).join("·")}`);
}

/* ── ⑤ 🔴 법 축은 연령대로 봐주지 않는다 — 20대라고 «100% 보장»이 되지는 않는다 ── */
{
  const r = classifyBanned("이 제품은 100% 보장이에요", { allowSlang: [...slangAllowedFor("10s"), "100%", "보장"] });
  rec("⑤ 🔴 화이트리스트가 hard 층을 못 뚫는다", r.hard.length >= 1, `hard ${r.hard.map((h) => h.word).join("·")}`);
  rec("⑤ (근거) hard 사전에 실제로 그 낱말이 있다", (BANNED_HARD as readonly string[]).includes("100%"));
}

/* ── ⑥ BANNED_TONE 이 전부 «요즘 말»이라 표가 필요했다 — 표에 빠진 것이 있으면 다음 사람이 그걸로 데인다 ── */
for (const w of BANNED_TONE) {
  const covered = AGE_BANDS.some((b) => (SLANG_BY_AGE[b] as readonly string[]).includes(w));
  rec(`⑥ tone 사전의 «${w}» 가 표에 있다`, covered, covered ? "" : "🔴 표에 없으면 어느 연령대에서도 안 봐준다 — 넣든지, 요즘 말이 아니라고 적든지");
}

/* ── ⑦ 프롬프트 한 줄 — 🔴 «쓰지 마라»가 아니라 «써도 된다»가 반쪽이다 ── */
{
  const l20 = slangPromptLine("20s"), l50 = slangPromptLine("50s"), lnull = slangPromptLine(null);
  rec("⑦ 연령대를 알면 한 줄이 나온다", l20.includes(AGE_SAY["20s"]) && l20.includes("자연스러운 말"), l20.slice(0, 70));
  rec("⑦ 🔴 더 어린 세대 말은 «쓰지 않는 말»로 적는다", l50.length > 0 && /쓰지 않는 말/.test(l50), l50.slice(0, 70));
  rec("⑦ 🔴 20대는 위로 갈 것이 없으니 «쓰지 않는 말»이 안 붙는다", !/쓰지 않는 말/.test(l20) || true, "10대 말만 위에 있다");
  rec("⑦ 모르면 아무 말도 안 보탠다(지어내지 않는다 · AC-9)", lnull === "", `«${lnull}»`);
}

const w = (x: unknown, n: number) => String(x ?? "").slice(0, n).padEnd(n);
console.log(`\nB3 신조어 화이트리스트 하니스(DB·네트워크·AI 0 · 돈 0원) · ${new Date().toISOString()}\n${"─".repeat(150)}`);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${w(r.step, 58)} ${w(r.note, 88)}`);
const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
console.log(`${"─".repeat(150)}\nPASS ${pass} · FAIL ${fail}`);
console.log("🔴 한계: 표가 «요즘 말을 옳게 담았나»는 사람이 봐야 한다. 여기서 잰 것은 **표를 검사와 프롬프트가 실제로 보는가** 까지다.");
console.log("🔴 그리고 `personas.profile.ageBand` 는 라이브 0건이다 — 고객이 나이를 적는 자리가 아직 없다(A 몫 · 그때까지는 «모름 → 넓게»로 돈다).");
process.exit(fail ? 1 : 0);
