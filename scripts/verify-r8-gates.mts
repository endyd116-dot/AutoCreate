/**
 * scripts/verify-r8-gates.mts — **R8 숨은 게이트 전수**(C · 순수 · AI 실호출 0 · DB 0).
 *   `npx tsx scripts/verify-r8-gates.mts`
 *
 *   사장님 전역 지시(2026-09-15 · CLAUDE §9): **«게이트는 최소화하라 · 막으면 공장이 선다.»**
 *   ⇒ 이 프로브는 «이 축이 하드인 게 맞나» 는 **판정하지 않는다**(그건 메인·B3 이 정한다). 대신 두 가지만 본다:
 *     ① 🔴 **우리가 우리 글을 막고 있나** — 계약이 요구하는 시각 요소(`visualMin`)를 **우리 골격 생성기가 못 채우는** 자리.
 *        걸리면 재작성이 한 번 더 돌아 **돈이 두 배**다. 아무도 규칙을 어기지 않았는데 비용만 는다.
 *     ② 🔴 **막힌 자리에 «그래서 어떻게 하면 되나»가 있나** — 길 없는 막힘은 고객에게 벽이다.
 *
 *   🔴 판정은 **제품의 `runGate` 로** 한다. 첫 판에서 내가 블록 수를 손으로 세다 `hashtags`(블록 안 개수)를 틀렸다 — 대용물 금지(AC-57).
 */
import { runGate, GATE_KEYS } from "../lib/ai-tell-gate";
import { WRITING_CONTRACTS, structureFor, topicGroupOf, type FormatKey, type WritingContract } from "../lib/writing-contracts";
import { contractFor } from "../lib/writing-contracts";
import type { Block, BlockType } from "../lib/blocks";

const out = (step: string, ok: boolean | "WARN", note: string) => console.log(`RESULT ${JSON.stringify({ step, ok, note })}`);
const SEEDS = 40;

/** 골격 → 블록. 🔴 **시각 요소만** 보므로 글감은 최소로 채운다(다른 축은 읽지 않는다). */
function blocksOf(seq: BlockType[], c: WritingContract): Block[] {
  return seq.map((t) => {
    if (t === "hashtags") return { type: t, items: Array.from({ length: Math.max(5, c.visualMin.hashtags ?? 5) }, (_, i) => `태그${i}`) } as Block;
    if (t === "list" || t === "checklist") return { type: t, items: ["가", "나", "다"] } as Block;
    if (t === "faq") return { type: t, items: ["Q 언제 하나요 | A 주말에요"] } as Block;
    if (t === "table") return { type: t, items: ["항목|값", "세탁|40분"] } as Block;
    if (t === "image") return { type: t } as Block;
    return { type: t, text: "가을 이불을 빨래방에서 돌려 봤어요. 건조까지 40분이 걸렸습니다." } as Block;
  });
}

/** 그 골격이 `visual_min` 을 통과하나 — **제품 게이트**가 판정한다. */
async function visualMissOf(ch: string, seed: number): Promise<string | null> {
  const c = await contractFor(ch, null);
  const format = c.formats[seed % c.formats.length] as FormatKey;
  const group = topicGroupOf({ format, intent: null, title: "가을 이불 세탁 후기" });
  const seq = structureFor(c, format, c.images.default, false, seed, group);
  const g = runGate({ blocks: blocksOf(seq, c), contract: c, personaTerms: [], meta: null, similarity: { score: 0 }, title: "가을 이불 세탁 후기" });
  const v = g.checks.find((x) => x.key === "visual_min");
  return v && !v.pass ? String(v.detail ?? "미달") : null;
}

async function main() {
  /* ── ① 우리가 우리 글을 막고 있나 ── */
  const rows: string[] = [];
  let worst = 0;
  for (const ch of ["naver_blog", "tistory", "blogger", "wordpress"]) {
    const misses: string[] = [];
    for (let i = 1; i <= SEEDS; i++) { const m = await visualMissOf(ch, i); if (m) misses.push(m); }
    const pct = Math.round((misses.length / SEEDS) * 100);
    worst = Math.max(worst, pct);
    const kinds = new Map<string, number>();
    for (const m of misses) for (const part of m.split(" · ")) { const k = part.split(" ")[0]; kinds.set(k, (kinds.get(k) ?? 0) + 1); }
    rows.push(`${ch} ${misses.length}/${SEEDS}편(${pct}%)${kinds.size ? ` [${[...kinds].map(([k, v]) => `${k}:${v}`).join(" ")}]` : ""}`);
  }
  out("🔴 ① 우리 골격 생성기가 **우리 계약의 시각 요소를 못 채우는** 비율(걸리면 재작성 1회 = 돈 두 배)",
    worst === 0, `${rows.join(" · ")} · 기준: 0% (아무도 규칙을 어기지 않았는데 비용만 느는 자리라 0 이어야 한다)`);

  /* 🔴 **가드가 일을 하고 있나**(음성 대조) — 초록이 운이 아니라 장치 덕분임을 보인다.
     `visualMin` 을 비운 계약(= 지킬 것이 없는 계약)으로 같은 seed 를 돌리면 미달이 **되돌아와야** 한다.
     안 되돌아오면 «아무 일도 안 하는 가드»를 초록으로 믿고 있는 것이다(AC-60). */
  {
    const c = await contractFor("naver_blog", null);
    const stripped = { ...c, visualMin: {} } as WritingContract;
    let back = 0;
    for (let i = 1; i <= SEEDS; i++) {
      const format = stripped.formats[i % stripped.formats.length] as FormatKey;
      const seq = structureFor(stripped, format, stripped.images.default, false, i, topicGroupOf({ format, intent: null, title: "가을 이불 세탁 후기" }));
      const g = runGate({ blocks: blocksOf(seq, c), contract: c, personaTerms: [], meta: null, similarity: { score: 0 }, title: "가을 이불 세탁 후기" });
      if (!g.checks.find((x) => x.key === "visual_min")?.pass) back++;
    }
    out("🔴 ① 음성 대조 — 가드를 무력화하면 미달이 **되돌아온다**(초록이 운이 아니라 장치 덕분이다)",
      back > 0, `visualMin 을 비운 계약 → 미달 ${back}/${SEEDS}편 (가드 있을 때 0편)`);
  }

  /* 원인을 이름으로 짚는다 — `visualMin` 이 요구하는 블록이 `tiers.optional` 에 있는 자리.
     🔴 표가 겹치는 것 자체는 이제 **결함이 아니다**(applyTiers 가 요구치만큼 남긴다) — 어디를 지키고 있는지 **이름으로 남긴다**. */
  const fight: string[] = [];
  for (const [ch, c] of Object.entries(WRITING_CONTRACTS)) {
    if (!c.text || !c.tiers) continue;
    const vm = c.visualMin as Record<string, number>;
    for (const [k, need] of Object.entries(vm)) {
      if (!need || k === "hashtags" || k === "tableOrList") continue;   // hashtags 는 블록 안 개수 · tableOrList 는 셋 중 하나라 따로 본다
      if (c.tiers.suppress.includes(k as BlockType)) fight.push(`${ch}: visualMin.${k}=${need} 인데 tiers.suppress 에 있다(**절대 못 채운다**)`);
      else if (c.tiers.optional.includes(k as BlockType)) fight.push(`${ch}: visualMin.${k}=${need} 인데 tiers.optional 이라 seed 에 따라 떨어진다`);
    }
  }
  out("① `applyTiers` 가 **지키고 있는** 자리(표가 겹치는 곳 — 결함이 아니라 가드가 붙은 자리다)",
    "WARN", fight.length ? `${fight.length}자리: ${fight.join(" · ")}` : "겹치는 자리 0");

  /* ── ② 막힌 자리에 «그래서 어떻게 하면 되나» 가 있나(CLAUDE §9) ── */
  const fs = await import("node:fs/promises");
  const gateTs = await fs.readFile("lib/ai-tell-gate.ts", "utf8");
  const missingHow: string[] = [];
  for (const k of GATE_KEYS) {
    /* 재작성 지시문이 그 축에 대해 «무엇을 하라» 를 말하나 — 없으면 사람에게도 기계에게도 길이 없다. */
    const re = new RegExp(`case "${k}":`);
    if (!re.test(gateTs)) missingHow.push(k);
  }
  out("🔴 ② 막는 축마다 **«그래서 어떻게 하면 되나»** 가 있다(재작성 지시문 · 없으면 고객에게 벽이다)",
    missingHow.length === 0, missingHow.length ? `길이 없는 축: ${missingHow.join(",")}` : `${GATE_KEYS.length}축 전부 있다`);

  /* 🔴 음성 대조 — 지시문이 «그 축 이야기» 를 하나(아무 문장이나 넣어 두고 초록을 받지 않는다). */
  const sample = (gateTs.match(/case "ad_pointing":\s*return\s*`([^`]{10,})`/) ?? [])[1] ?? "";
  out("② …그 지시문이 그 축 이야기를 한다(음성 대조 · 아무 문장이나 아니다)",
    /광고|배너/.test(sample) && /바꿔라|하지 마라|권하는/.test(sample), `ad_pointing 지시문 «${sample.slice(0, 46)}…»`);
}

await main();
