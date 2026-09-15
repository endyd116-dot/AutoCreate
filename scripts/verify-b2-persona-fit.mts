/**
 * scripts/verify-b2-persona-fit.mts — **페르소나 적합도가 배정을 진짜로 바꾸나**(DESIGN §5.3-2 · R8CLOSE-B1 §B2).
 *   실행: `npx --yes tsx scripts/verify-b2-persona-fit.mts`   · DB·네트워크·AI 호출 **0**(돈 0원).
 *
 *   🔴 이 하니스가 지켜야 할 것은 «점수가 맞나»가 아니라 **«막지 않나»** 다(CLAUDE §9).
 *      적합도가 0이어도 배정은 돼야 하고, 건강도를 이기면 안 되고, 못 쟀으면 순위를 건드리면 안 된다.
 */
import { personaFitOf, personaFitBonus, PERSONA_FIT_WEIGHT } from "../lib/persona-fit";
import { assignAccount } from "../lib/director";
import type { AccountRow } from "../lib/accounts";

const results: { step: string; ok: boolean; note: string }[] = [];
const rec = (step: string, ok: boolean, note = "") => { results.push({ step, ok: !!ok, note }); };
const A = (id: number, healthScore: number): AccountRow => ({
  id, channel: "naver_blog", handle: `h${id}`, displayName: null, avatar: null, status: "active",
  healthScore, postsToday: 0, dailyCap: 2, minGapMin: 180, monetize: { coupang: false, adpost: false, adsense: false },
} as unknown as AccountRow);

/* ── ① 겹치면 잰다 · 안 겹쳐도 «못 쟀다»가 아니다 ── */
{
  const hit = personaFitOf(["캠핑", "등산", "직장인"], { title: "가을 캠핑 준비물 총정리", angle: null });
  rec("① 관심사가 겹치면 점수가 오른다", hit.measured && hit.score > 0 && hit.matched.includes("캠핑"), `score=${hit.score.toFixed(2)} matched=${hit.matched.join("·")}`);
  const miss = personaFitOf(["재테크", "주식"], { title: "가을 캠핑 준비물 총정리", angle: null });
  rec("① 안 겹치면 0점 — 🔴 그래도 `measured`는 참이다(잰 결과가 0이다)", miss.measured && miss.score === 0, `score=${miss.score} measured=${miss.measured}`);
  rec("① 🔴 0점 문장이 겁주지 않는다(§3)", /그대로 올라가요/.test(miss.line) && !/정지|차단|불이익|책임|알려만/.test(miss.line), miss.line);
}

/* ── ② 🔴 못 쟀으면 «못 쟀다» — 0점과 다르다(AC-9) ── */
{
  const none = personaFitOf([], { title: "가을 캠핑 준비물" });
  rec("② 페르소나가 비면 measured=false", !none.measured && /못 쟀어요/.test(none.line), none.line);
  rec("② 🔴 못 쟀으면 가산점 0 = 순위를 건드리지 않는다", personaFitBonus(none) === 0);
  const noTopic = personaFitOf(["캠핑"], { title: "", angle: "" });
  rec("② 소재에 견줄 말이 없어도 못 쟀다로 간다", !noTopic.measured, noTopic.line);
}

/* ── ③ 양쪽 겹침 — 한쪽만 보면 절반을 놓친다 ── */
rec("③ 페르소나 낱말 ⊂ 소재(«캠핑» ⊂ «가을 캠핑»)", personaFitOf(["캠핑"], { title: "가을 캠핑" }).score > 0);
rec("③ 소재 낱말 ⊂ 페르소나 낱말(«등산» ⊂ «등산복»)", personaFitOf(["등산복"], { title: "등산 코스 추천" }).score > 0);
rec("③ 🔴 한 글자로는 안 걸린다(«차»가 «자동차»에 걸리면 아무 데나 맞는다)", personaFitOf(["차"], { title: "자동차 보험" }).score === 0);

/* ── ④ 🔴 배정 — 막지 않는다 ── */
{
  const accs = [A(1, 90), A(2, 88)];
  const plain = assignAccount(accs, "naver_blog");
  rec("④ 🔴 가산점을 안 주면 종전과 똑같다(건강도 순)", plain?.id === 1, `→ #${plain?.id}`);
  const withFit = assignAccount(accs, "naver_blog", new Map([[2, PERSONA_FIT_WEIGHT]]));
  rec("④ 비슷한 계정끼리는 적합도가 가른다", withFit?.id === 2, `→ #${withFit?.id}`);
  const far = assignAccount([A(1, 90), A(2, 60)], "naver_blog", new Map([[2, PERSONA_FIT_WEIGHT]]));
  rec("④ 🔴 건강도 차이가 크면 적합도로 못 뒤집는다(아픈 계정에 밀어 넣지 않는다)", far?.id === 1, `→ #${far?.id} (90 vs 60+${PERSONA_FIT_WEIGHT})`);
  const zero = assignAccount(accs, "naver_blog", new Map([[1, 0], [2, 0]]));
  rec("④ 🔴 적합도 0이어도 **배정은 된다**(§9 — 후보에서 빼지 않는다)", zero !== null, `→ #${zero?.id}`);
}

/* ── ⑤ 가산점 천장 — 이걸 넘기면 순위가 아니라 게이트가 된다 ── */
rec("⑤ 만점이어도 가산점은 천장까지", personaFitBonus({ score: 1, matched: ["x"], measured: true, line: "" }) === PERSONA_FIT_WEIGHT, `천장 ${PERSONA_FIT_WEIGHT}`);
rec("⑤ 🔴 천장이 건강도 폭(100)보다 훨씬 작다", PERSONA_FIT_WEIGHT < 50, `${PERSONA_FIT_WEIGHT} < 50`);

/* ── ⑥ 결정론 ── */
{
  const mk = () => assignAccount([A(1, 80), A(2, 80)], "naver_blog", new Map([[1, 5], [2, 5]]))?.id;
  rec("⑥ 같은 입력이면 같은 계정", mk() === mk(), `→ #${mk()}`);
}

const w = (x: unknown, n: number) => String(x ?? "").slice(0, n).padEnd(n);
console.log(`\nB2 페르소나 적합도 하니스(DB·네트워크·AI 0 · 돈 0원) · ${new Date().toISOString()}\n${"─".repeat(150)}`);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${w(r.step, 62)} ${w(r.note, 84)}`);
const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
console.log(`${"─".repeat(150)}\nPASS ${pass} · FAIL ${fail}`);
console.log("🔴 한계: 글자 겹침까지다. «말투가 맞나 · 이 사람이 쓸 법한 소재인가»는 여기서 **안 쟀다** — LLM 을 새로 붙이지 않았다(돈이 두 배 · 메인이 값을 보고 정한다).");
process.exit(fail ? 1 : 0);
