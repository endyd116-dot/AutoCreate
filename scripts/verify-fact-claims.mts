/**
 * scripts/verify-fact-claims.mts — **수치 주장 표시**가 제대로 가르나(계약 P1R8 §2.4 · B-1 2026-09-15).
 *   실행: `npx --yes tsx scripts/verify-fact-claims.mts`   · DB·네트워크·AI 호출 **0**(돈 0원).
 *
 *   ══ 왜 ══
 *     프롬프트 ⑤칸에 «근거 없는 수치·통계 금지»가 **처음부터 있었다.** 그런데 **지키는지 아무도 안 쟀다** —
 *     선언만 있고 재는 곳이 0 이면 그건 없는 규칙이다(AC-29). C 가 §2.4 를 «표시가 0»이라고 잡은 자리다.
 *
 *   ══ 🔴 이 하니스가 지키는 이름 ══
 *     «팩트체크»가 아니다. 우리는 숫자가 **맞는지 모른다.** 재는 것은 **«우리가 준 숫자인가»** 하나다.
 *     그래서 아래 검사도 그 말로만 쓴다 — 검사 이름이 흐려지면 다음 사람이 «틀린 숫자를 잡는다»고 믿는다(AC-57).
 */
import { findNumericClaims, summarizeClaims, claimsLine } from "../lib/fact-claims";
import type { Block } from "../lib/blocks";

const results: { step: string; ok: boolean; note: string }[] = [];
const rec = (step: string, ok: boolean, note = "") => { results.push({ step, ok: !!ok, note }); };

/** 실제 프롬프트 ③재료 칸을 본뜬 문자열 — 제휴 상품 가격과 검색량이 «우리가 준 숫자»다. */
const PROMPT = [
  "[③ 재료]",
  "소재: 에어프라이어 청소 방법 총정리",
  "목표 검색어(이 낱말이 본문에 자연스럽게 들어가야 한다): 에어프라이어 청소 (월 검색 12,800)",
  "내 사정(1~2개를 실제 장면으로): 1인 가구 5년차 / 주 3회 요리",
  "제휴 상품 후보: 0) 에어프라이어 전용 세정제 · 39,900원 / 1) 실리콘 솔 · 8,900원",
].join("\n");

const B = (o: Partial<Block> & { type: string }) => o as Block;

/* ═══ ① 우리가 준 숫자는 given ═══════════════════════════════════════════ */
{
  const blocks = [
    B({ type: "para", text: "세정제는 39,900원이었고 월 검색량이 12,800회나 되는 주제입니다." }),
  ];
  const cs = findNumericClaims(blocks, PROMPT);
  rec("① 우리가 준 숫자(제휴 가격·검색량)는 given 으로 갈린다",
    cs.length === 2 && cs.every((c) => c.basis === "given"),
    cs.map((c) => `${c.num}:${c.basis}/${c.kind}`).join(" · "));
  rec("① 돈은 money 로 읽는다(원 단위를 뒤에서 본다)", cs.find((c) => c.num === "39,900")?.kind === "money",
    `39,900 → ${cs.find((c) => c.num === "39,900")?.kind}`);
}

/* ═══ ② 🔴 모델이 지어낸 숫자는 self — 그리고 돈·비율이면 risky ═══════════ */
{
  const blocks = [
    B({ type: "para", text: "연구에 따르면 87%의 가정에서 기름때가 남고, 평균 수리비가 120,000원이라고 합니다." }),
  ];
  const cs = findNumericClaims(blocks, PROMPT);
  const s = summarizeClaims(cs);
  rec("② 🔴 우리가 안 준 숫자는 self 로 갈린다", cs.length === 2 && cs.every((c) => c.basis === "self"),
    cs.map((c) => `${c.num}:${c.basis}/${c.kind}`).join(" · "));
  rec("② 🔴 그중 **금액·비율**은 risky 로 따로 센다(틀리면 표시광고법으로 가는 둘)", s.risky === 2,
    JSON.stringify(s));
  /* 🔴 A 요청 — 화면이 다시 계산하지 않게 항목에도 `risky` 를 싣는다. 항목과 요약이 **같은 함수**를 봐야 안 갈린다. */
  rec("② 🔴 항목의 risky 와 요약의 risky 가 같다(화면이 다시 세지 않는다)",
    cs.filter((c) => c.risky).length === s.risky && cs.every((c) => c.risky === (c.basis === "self" && (c.kind === "money" || c.kind === "percent"))),
    `항목 ${cs.filter((c) => c.risky).length}개 ↔ 요약 ${s.risky}개`);
  rec("② 화면 문구가 «틀렸다»고 말하지 않는다", (claimsLine(s) ?? "").includes("확인이 필요한") && !(claimsLine(s) ?? "").includes("틀"),
    String(claimsLine(s)));
}

/* ═══ ③ 🔴 글의 구조를 세는 숫자는 주장이 아니다 ═══════════════════════════ */
{
  const blocks = [
    B({ type: "h2", text: "청소 3단계" }),
    B({ type: "list", items: ["1단계: 분리", "2단계: 세척", "3가지 주의할 점"] }),
  ];
  const cs = findNumericClaims(blocks, PROMPT);
  const s = summarizeClaims(cs);
  /* 🔴 음성 대조 — 구조를 세는 말은 risky 가 **아니어야** 한다. 여기가 true 로 새면 화면이 시끄러워진다. */
  rec("③ 🔴 음성 대조 — structural 은 risky 가 아니다", cs.every((c) => !c.risky), `risky ${cs.filter((c) => c.risky).length}개`);
  rec("③ «3단계»·«3가지» 는 structural 로 갈린다(같은 무게로 보여 주면 진짜 위험한 숫자가 묻힌다)",
    cs.every((c) => c.kind === "structural") && s.self === 0 && s.risky === 0,
    `${cs.map((c) => `${c.num}:${c.kind}`).join(" · ")} → ${JSON.stringify(s)}`);
  rec("③ 확인할 것이 없으면 문구를 만들지 않는다(없는 걱정을 만들지 않는다)", claimsLine(s) === null, String(claimsLine(s)));
}

/* ═══ ④ 🔴 우리가 넣는 블록은 세지 않는다 ═══════════════════════════════ */
{
  const blocks = [
    B({ type: "disclosure", text: "이 글은 쿠팡 파트너스 활동의 일환으로 99,999원의 수수료를 받습니다." }),
    B({ type: "hashtags", items: ["청소2026", "에어프라이어"] }),
    B({ type: "para", text: "본문에는 숫자가 없습니다." }),
  ];
  const cs = findNumericClaims(blocks, PROMPT);
  rec("④ 고지·해시태그의 숫자는 모델의 주장이 아니다(우리가 넣는 정본이다)", cs.length === 0,
    cs.length ? `🔴 샜다: ${cs.map((c) => c.num).join(" · ")}` : "0개 — 기대대로");
}

/* ═══ ⑤ 🔴 음성 대조 — 숫자 읽기의 경계 ═══════════════════════════════════ */
{
  /* 「1.234」(소수·금액)를 두 조각으로 쪼개면 «1» 과 «234» 라는 없는 숫자 두 개가 생긴다(AC-57 사촌: 경계 없는 정규식). */
  const cs = findNumericClaims([B({ type: "para", text: "무게는 1.234kg 입니다." })], PROMPT);
  rec("⑤ 🔴 음성 대조 — «1.234» 를 한 덩이로 읽는다(쪼개면 없는 숫자가 생긴다)",
    cs.length === 1 && cs[0].num === "1.234", cs.map((c) => c.num).join(" · ") || "0개");

  /* 천 단위 쉼표가 있는 숫자를 «12» + «800» 으로 쪼개면 안 된다. */
  const cs2 = findNumericClaims([B({ type: "para", text: "월 12,800회입니다." })], PROMPT);
  rec("⑤ 🔴 음성 대조 — «12,800» 을 한 덩이로 읽고 우리가 준 «12,800» 과 맞춘다",
    cs2.length === 1 && cs2[0].num === "12,800" && cs2[0].basis === "given", cs2.map((c) => `${c.num}:${c.basis}`).join(" · "));

  /* 🔴 **못 재는 것을 적어 둔 그대로 동작하나** — 헤더가 «한글 수 단위는 안 편다»고 적었다.
     문서와 코드가 갈리면 다음 사람이 문서를 믿는다(AC-59). 그래서 **한계도 검사한다**. */
  const cs3 = findNumericClaims([B({ type: "para", text: "세정제는 4만원쯤 합니다." })], PROMPT);
  rec("⑤ 🔴 적어 둔 한계 그대로 — «4만원» 은 «40,000» 과 **안 맞춘다**(안전한 쪽으로 self)",
    cs3.length === 1 && cs3[0].basis === "self", `«4만원» → ${cs3.map((c) => `${c.num}:${c.basis}`).join(" · ")}`);
}

/* ═══ ⑥ 같은 숫자가 반복돼도 화면이 시끄럽지 않게 ═══════════════════════════ */
{
  const cs = findNumericClaims([B({ type: "para", text: "87%입니다. 다시 말해 87% 입니다." })], PROMPT);
  rec("⑥ 같은 블록의 같은 숫자는 한 번만 적는다", cs.length === 1, `${cs.length}개`);
  const cs2 = findNumericClaims([B({ type: "para", text: "87%입니다." }), B({ type: "para", text: "87%라고 했습니다." })], PROMPT);
  rec("⑥ 블록이 다르면 따로 적는다(화면이 각 자리로 데려가야 한다)", cs2.length === 2,
    cs2.map((c) => `블록${c.blockIndex}`).join(" · "));
}

const w = (x: unknown, n: number) => String(x ?? "").slice(0, n).padEnd(n);
console.log(`\n수치 주장 표시 하니스(DB·네트워크·AI 0 · 돈 0원) · ${new Date().toISOString()}\n${"─".repeat(150)}`);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${w(r.step, 62)} ${w(r.note, 84)}`);
const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
console.log(`${"─".repeat(150)}\nPASS ${pass} · FAIL ${fail}`);
console.log("🔴 이건 «팩트체크»가 아니다 — «우리가 준 숫자인가»까지다. 맞는지는 사람이 본다.");
process.exit(fail ? 1 : 0);
