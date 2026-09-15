/**
 * scripts/verify-cardnews.mts — 인스타 **카드뉴스**가 실제로 카드뉴스인가(계약 P1R8 §2.5 · B-1 2026-09-15).
 *   실행: `npx --yes tsx scripts/verify-cardnews.mts`   · DB·네트워크·AI 호출 **0**(돈 0원).
 *
 *   ══ 왜 이 하니스가 필요한가 ══
 *     §2.5 가 «카드뉴스 kind 가 편성·생성·검수에 없다»고 했는데, 열어 보니 **더 나빴다**:
 *       ① 계약의 `structure` 에 **image 블록이 한 개도 없었다** — 카드뉴스인데 카드가 골격에 없다.
 *          그러면 `structureFor` 가 사진 6장을 붙일 `para` 를 못 찾아 **전부 맨 앞(index 1)에 몰아넣는다**
 *          = 표지도 CTA 도 없는 «카드 6장 뭉치». 규칙(문장)으로는 «표지→핵심→CTA»라고 적혀 있었다(AC-63).
 *       ② `captionRate: 0` 이라 **카드 글자가 전부 버려졌다** — 글자 없는 카드는 카드가 아니다.
 *       ③ format 이 **1종**이라 두 번째 글부터 골격이 100% 겹친다.
 *     셋 다 «선언은 맞는데 산출물이 다른» 종류다. 그래서 **선언이 아니라 `structureFor` 의 산출물을 잰다**(AC-70).
 *
 *   🔴 한계(정직): 이건 **골격**까지다. «모델이 정말 30자로 쓰나»는 실호출로만 알 수 있고 아직 안 했다(AC-9).
 */
import { WRITING_CONTRACTS, structureFor, imagesFor, contractSelfConflicts, type FormatKey, type TopicGroup } from "../lib/writing-contracts";
import { structurePrint, structureOverlap, STRUCTURE_OVERLAP_MAX } from "../lib/structure-print";
import type { Block } from "../lib/blocks";

const results: { step: string; ok: boolean; note: string }[] = [];
const rec = (step: string, ok: boolean, note = "") => { results.push({ step, ok: !!ok, note }); };

const IG = WRITING_CONTRACTS.instagram;
const GROUPS: TopicGroup[] = ["review", "info", "life"];
/** 생성이 쓰는 그 함수·그 입력으로 그린다(AC-70 — 잣대만 같고 대상이 다르면 비교는 조용히 무의미해진다). */
const drawn = (f: FormatKey, group: TopicGroup, seed: number) =>
  structureFor(IG, f, imagesFor(IG, group).default, false, seed, group);
const printOf = (types: string[]) => structurePrint(types.map((t) => ({ type: t })) as Block[]);

/* ═══ ① 카드가 골격에 있나 ═══════════════════════════════════════════════ */
{
  const bad: string[] = [];
  for (const f of IG.formats) {
    const raw = IG.structure[f] ?? [];
    const n = raw.filter((t) => t === "image").length;
    if (n < 6) bad.push(`${f}:${n}장`);
  }
  rec("① 🔴 계약 골격 자체에 카드(image)가 6장 이상 있다", bad.length === 0,
    bad.length ? `🔴 카드가 모자란 format: ${bad.join(" · ")} — structureFor 가 맨 앞에 몰아넣는다` : `${IG.formats.length}개 format 전부 6장 이상`);

  /* 표지 = 첫 카드 · CTA = 마지막 카드. 골격에서 **첫 image 앞에 hook** 이 있고, 마지막 image 뒤가 본문·태그여야 한다. */
  const coverOk = IG.formats.every((f) => {
    const raw = IG.structure[f] ?? [];
    return raw[0] === "hook" && raw.indexOf("image") > 0;
  });
  rec("① 표지 자리가 있다(첫 블록 hook → 그다음부터 카드)", coverOk, coverOk ? "5/5" : "hook 이 맨 앞이 아닌 format 이 있다");
}

/* ═══ ② 그려 봤을 때 카드 수가 계약과 맞나 ═══════════════════════════════ */
{
  const rows: string[] = [];
  let bad = 0;
  for (const g of GROUPS) {
    const want = imagesFor(IG, g).default;
    for (const f of IG.formats) {
      const got = drawn(f, g, 7).filter((t) => t === "image").length;
      if (got !== want) { bad++; rows.push(`${f}/${g}: ${got}≠${want}`); }
    }
    rows.push(`${g}=${want}장`);
  }
  rec("② 그려 본 골격의 카드 수 = 계약이 정한 수(주제군별 6·7·8)", bad === 0, rows.join(" · "));
  const counts = GROUPS.map((g) => imagesFor(IG, g).default);
  rec("② 🔴 카드 수가 주제군마다 다르다(§2.5 «카드 6~8장» — 늘 6장이면 그것도 AI 티)",
    new Set(counts).size > 1 && counts.every((n) => n >= 6 && n <= 8), `후기 ${counts[0]} · 정보 ${counts[1]} · 생활 ${counts[2]}`);
}

/* ═══ ③ 🔴 골격이 실제로 갈라지나 — 이 라운드의 핵심 ═══════════════════════ */
{
  /* 축(`checkStructure`)이 쓰는 **그 함수**로 잰다. 임의의 «달라 보인다»가 아니다. */
  const prints = IG.formats.map((f) => ({ f, p: printOf(drawn(f, "info", 11)) }));
  const pairs: { a: string; b: string; v: number }[] = [];
  for (let i = 0; i < prints.length; i++) for (let j = i + 1; j < prints.length; j++) {
    pairs.push({ a: prints[i].f, b: prints[j].f, v: structureOverlap(prints[i].p, prints[j].p) });
  }
  const over = pairs.filter((x) => x.v >= STRUCTURE_OVERLAP_MAX);
  const worst = pairs.reduce((m, x) => (x.v > m.v ? x : m), pairs[0]);
  rec(`③ 🔴 format 끼리 축 기준(${STRUCTURE_OVERLAP_MAX}) 넘게 안 겹친다`, over.length === 0,
    over.length ? `🔴 겹치는 짝: ${over.map((x) => `${x.a}↔${x.b} ${Math.round(x.v * 100)}%`).join(" · ")}`
      : `짝 ${pairs.length}개 · 제일 닮은 짝 ${worst.a}↔${worst.b} ${Math.round(worst.v * 100)}%`);

  const seqs = prints.map((x) => x.p.seq);
  rec("③ 다섯 골격의 블록 순서가 전부 다르다", new Set(seqs).size === seqs.length,
    prints.map((x) => `${x.f}=${x.p.seq}`).join(" · "));

  /* 🔴 음성 대조 — 옛 판(format 1종)을 그대로 넣어 **이 검사가 정말 잡는지** 본다.
     안 잡히면 이 하니스는 장식이다(AC-58). */
  const oldPrint = printOf(["hook", "list", "list", "list", "list", "list", "tip", "hashtags"]);
  const self = structureOverlap(oldPrint, oldPrint);
  rec("③ 🔴 음성 대조 — 옛 판(format 1종)은 자기 자신과 100% 겹친다(= 두 번째 글부터 무조건 걸린다)",
    self >= STRUCTURE_OVERLAP_MAX, `옛 골격 ${oldPrint.seq} 자기 겹침 ${Math.round(self * 100)}%`);
}

/* ═══ ④ 카드 글자(caption)가 살아남나 ═══════════════════════════════════ */
{
  rec("④ 🔴 카드 글자 상한이 계약에 있다(글 채널 25자가 아니라 30자)", IG.cardText?.max === 30, `cardText.max = ${String(IG.cardText?.max)}`);
  /* `cardText` 가 있으면 `fixBlocks` 가 `captionRate` 를 덮는다 — 그 규약을 계약 쪽에서도 확인한다. */
  rec("④ 🔴 `captionRate` 가 0 이어도 카드는 글자를 갖는다(cardText 가 덮는다)",
    IG.images.captionRate === 0 && !!IG.cardText,
    `captionRate=${IG.images.captionRate} · cardText=${JSON.stringify(IG.cardText)} → fixBlocks 가 전부 남긴다`);
  /* 글 채널에는 `cardText` 가 없어야 한다 — 있으면 블로그 사진에 캡션이 전부 붙어 AI 티가 된다. */
  const leaked = Object.entries(WRITING_CONTRACTS).filter(([k, v]) => k !== "instagram" && v.cardText);
  rec("④ 🔴 음성 대조 — 글 채널에는 cardText 가 없다(있으면 블로그 사진마다 캡션이 붙는다)",
    leaked.length === 0, leaked.length ? `🔴 샌 채널: ${leaked.map(([k]) => k).join(" · ")}` : `${Object.keys(WRITING_CONTRACTS).length - 1}개 채널 깨끗`);
}

/* ═══ ⑤ 계약이 스스로와 싸우지 않나 ═════════════════════════════════════ */
{
  const conflicts = contractSelfConflicts(IG);
  rec("⑤ 인스타 계약이 스스로와 안 싸운다(visualMin.image=6 ↔ 우리가 넣는 카드 수)",
    conflicts.length === 0, conflicts.length ? `🔴 ${conflicts.join(" / ")}` : "충돌 0");
  const all = Object.entries(WRITING_CONTRACTS).flatMap(([k, v]) => contractSelfConflicts(v).map((x) => `${k}: ${x}`));
  rec("⑤ 다른 채널도 그대로다(내가 건드려 깨뜨리지 않았다)", all.length === 0, all.length ? `🔴 ${all.join(" / ")}` : "전 채널 충돌 0");
}

const w = (x: unknown, n: number) => String(x ?? "").slice(0, n).padEnd(n);
console.log(`\n인스타 카드뉴스 하니스(DB·네트워크·AI 0 · 돈 0원) · ${new Date().toISOString()}\n${"─".repeat(150)}`);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${w(r.step, 58)} ${w(r.note, 88)}`);
const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
console.log(`${"─".repeat(150)}\nPASS ${pass} · FAIL ${fail}`);
console.log("🔴 한계: 여기까지는 **골격**이다. «모델이 정말 30자로 쓰나 · 표지가 표지답나»는 실호출 1편으로만 알 수 있고 아직 안 했다.");
process.exit(fail ? 1 : 0);
