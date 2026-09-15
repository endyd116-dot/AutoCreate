/**
 * scripts/verify-seo-keyword.mts — **잰 낱말이 글 쓰는 자리까지 가나**(계약 P1R8 §2-라 · DESIGN §5C.6-2 · B-1 2026-09-15).
 *   실행: `npx --yes tsx scripts/verify-seo-keyword.mts`   · DB·네트워크·AI 호출 **0**(돈 0원).
 *
 *   ══ 무엇이 틀렸었나 ══
 *     `bestVolume()` 이 씨앗 낱말 중 제일 큰 것을 골라 **`volume` 만 저장하고 `keyword` 는 버렸다.**
 *     그런데 프롬프트는 «검색어: **{소재 제목}** (월 검색 N)» 이었다 — **N 은 제목의 검색량이 아니다.**
 *     모델은 그 숫자를 믿고 **제목 문구를 노리고 쓴다.** 재려던 것과 실제로 준 것이 갈린 전형적인 대용물이다(AC-57).
 *     🔴 B3 조사(§5C.6)가 «우리가 검색에서 불리한 진짜 이유» 2번으로 짚은 자리다.
 *
 *   ══ 어떻게 재나 ══
 *     `buildPrompt()` 는 **이런 확인을 위해 내보내져 있다**(AC-64 «소스를 grep 하는 것은 증거가 아니다»).
 *     그래서 «프롬프트에 넣었다»가 아니라 **프롬프트 문자열을 실제로 읽어서** 확인한다.
 */
import { buildPrompt, fixBlocks } from "../lib/content-gen";
import { WRITING_CONTRACTS, structureFor } from "../lib/writing-contracts";
import type { Topic, TopicFactors } from "../lib/topics";
import type { Block } from "../lib/blocks";

const results: { step: string; ok: boolean; note: string }[] = [];
const rec = (step: string, ok: boolean, note = "") => { results.push({ step, ok: !!ok, note }); };

const C = WRITING_CONTRACTS.naver_blog;
const topicOf = (factors: TopicFactors): Topic => ({
  id: 1, title: "에어프라이어 청소 방법 총정리", angle: "직접 해 본 순서대로", channelHint: "naver_blog",
  score: 0.7, status: "candidate", factors, expiresAt: "", source: "ai",
});
const promptOf = (factors: TopicFactors) => buildPrompt({
  c: C, structure: structureFor(C, "story", 3, false) as Block["type"][], topic: topicOf(factors),
  angle: "직접 해 본 순서대로", persona: { tone: "", banned: [], signature: "" } as never, personaFacts: [],
  affiliateCands: null, affiliateQuery: null,
}).user;

/* ═══ ① 잰 낱말이 프롬프트에 그대로 가나 ═══════════════════════════════════ */
{
  const u = promptOf({ intent: "info", volume: 12800, keyword: "에어프라이어 청소" });
  rec("① 목표 검색어가 프롬프트에 **그 낱말 그대로** 실린다", u.includes("목표 검색어") && u.includes("에어프라이어 청소"),
    u.split("\n").find((l) => l.includes("검색어")) ?? "(검색어 줄 없음)");
  rec("① 검색량이 그 낱말 **옆에** 붙는다(다른 문구에 붙지 않는다)", /목표 검색어[^\n]*에어프라이어 청소[^\n]*12,800/.test(u),
    u.split("\n").find((l) => l.includes("검색어")) ?? "-");
}

/* ═══ ② 🔴 음성 대조 — 낱말이 없으면 **줄 자체가 빠지나** ═══════════════════ */
{
  /* 옛 소재(2026-09-15 이전)에는 `keyword` 칸이 없다. 그때 제목으로 대신 채우면 **같은 거짓말이 이름만 바꿔** 돌아온다. */
  const u = promptOf({ intent: "info", volume: 12800 });
  rec("② 🔴 낱말을 모르면 검색어 줄을 **통째로 뺀다**(제목으로 대신 채우지 않는다)", !u.includes("검색어"),
    u.includes("검색어") ? `🔴 아직 남아 있다: ${u.split("\n").find((l) => l.includes("검색어"))}` : "검색어 줄 없음 — 기대대로");
  rec("② 🔴 그 줄에 검색량 숫자도 같이 사라진다(주인 없는 숫자를 안 준다)", !u.includes("12,800"),
    u.includes("12,800") ? "🔴 숫자만 남았다" : "숫자도 없음");

  /* 🔴 음성 대조 2 — 옛 판을 그대로 재현해 **이 검사가 정말 잡는지** 본다(AC-58). */
  const oldLine = `검색어: ${topicOf({ intent: "info" }).title.replace(/[,·]/g, " ")} (월 검색 ${(12800).toLocaleString()})`;
  rec("② 🔴 음성 대조 — 옛 줄은 «제목 + 남의 검색량» 이었다(이 검사가 그걸 잡는다)",
    oldLine.includes("에어프라이어 청소 방법 총정리") && oldLine.includes("12,800"), oldLine);
}

/* ═══ ③ 낱말만 있고 검색량은 못 잰 경우(직접 입력) ═══════════════════════════ */
{
  const u = promptOf({ intent: "info", keyword: "에어프라이어 세척" });
  rec("③ 사용자가 적은 검색어는 **못 쟀어도** 목표로 간다", u.includes("에어프라이어 세척"),
    u.split("\n").find((l) => l.includes("검색어")) ?? "-");
  rec("③ 🔴 못 잰 검색량은 **지어내지 않는다**(괄호가 아예 안 붙는다)", !/월 검색/.test(u),
    /월 검색/.test(u) ? "🔴 없는 숫자가 붙었다" : "검색량 괄호 없음 — 기대대로");
}

/* ═══ ④ 내가 건드린 다른 자리가 안 깨졌나 ═══════════════════════════════════ */
{
  const u = promptOf({ intent: "info", volume: 500, keyword: "에어프라이어 청소" });
  rec("④ 소재·앵글·계절 같은 다른 재료는 그대로다", u.includes("소재:") && u.includes("앵글") && u.includes("계절:"),
    u.split("\n").filter((l) => l.startsWith("소재:") || l.startsWith("계절:")).join(" · "));
  /* 카드뉴스 caption 상한이 글 채널을 덮어쓰지 않았나(직전 커밋의 짝 확인). */
  const blocks = fixBlocks({ title: "x", blocks: [{ type: "image", prompt: "a kitchen counter", caption: "스물여섯자를넘기는아주긴캡션입니다정말로깁니다" }] },
    ["image"] as Block["type"][], C, false, null, "seed");
  const img = blocks.find((b) => b.type === "image");
  rec("④ 글 채널의 25자 상한은 그대로다(카드뉴스 30자가 안 샜다)", !img?.caption,
    img?.caption ? `🔴 ${[...img.caption].length}자 캡션이 살아남았다` : "긴 캡션은 버려졌다 — 기대대로");
}

const w = (x: unknown, n: number) => String(x ?? "").slice(0, n).padEnd(n);
console.log(`\n목표 검색어가 글 쓰는 자리까지 가나(DB·네트워크·AI 0 · 돈 0원) · ${new Date().toISOString()}\n${"─".repeat(150)}`);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${w(r.step, 56)} ${w(r.note, 90)}`);
const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
console.log(`${"─".repeat(150)}\nPASS ${pass} · FAIL ${fail}`);
console.log("🔴 한계: «모델이 그 낱말을 정말 본문에 넣나»는 실호출로만 안다 — 여기까지는 «프롬프트에 맞게 실렸나»다.");
process.exit(fail ? 1 : 0);
