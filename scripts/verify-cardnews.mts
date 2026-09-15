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
import { WRITING_CONTRACTS, structureFor, imagesFor, contractSelfConflicts, isCardnewsChannel, coinFormatOf, type FormatKey, type TopicGroup } from "../lib/writing-contracts";
import { structurePrint, structureOverlap, STRUCTURE_OVERLAP_MAX } from "../lib/structure-print";
import type { Block } from "../lib/blocks";
import { coinsPerWeek, toRuleKind, type Rule } from "../lib/slots";
import { COIN_TABLE, pieceCoinCost, AI_IMAGES_INCLUDED } from "../lib/coin-table";
import { CHANNELS } from "../lib/channel-registry";

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

/* ═══ ⑥ 편성 kind — DESIGN §5B.3 «글 · 쇼츠 · 카드뉴스» 세 번째가 통째로 없었다 ═══ */
{
  rec("⑥ RuleKind 가 cardnews 를 받는다", toRuleKind("cardnews") === "cardnews", `"cardnews"→${toRuleKind("cardnews")}`);
  /* 🔴 음성 대조 — 모르는 값이 조용히 cardnews 가 되면 엉뚱한 채널이 카드뉴스로 편성된다. */
  rec("⑥ 🔴 음성 대조 — 모르는 값은 post 로 접힌다(cardnews 로 새지 않는다)",
    toRuleKind("card") === "post" && toRuleKind("") === "post" && toRuleKind(null) === "post" && toRuleKind("CARDNEWS") === "post",
    `"card"→${toRuleKind("card")} · ""→${toRuleKind("")} · null→${toRuleKind(null)} · "CARDNEWS"→${toRuleKind("CARDNEWS")}`);

  /* «카드뉴스 채널인가»는 **정본 한 곳**(`isCardnewsChannel`)만 본다 — 목록을 또 만들면 갈라진다(AC-57). */
  const cardCh = CHANNELS.filter((c) => isCardnewsChannel(c.key)).map((c) => c.key);
  rec("⑥ 카드뉴스 채널 = 인스타 하나(계약의 cardText 가 정의다 · 목록을 따로 안 둔다)",
    cardCh.length === 1 && cardCh[0] === "instagram", cardCh.join(" · ") || "없음");
}

/* ═══ ⑦ 🔴 코인 — 편성표가 말하는 값과 실제로 빠지는 값이 같은가(AC-74) ═══════ */
{
  /* 🔴 **숫자를 여기 베껴 적지 않는다.** 2026-09-15 에 사장님이 «글 한 편에 AI 사진 1장 포함»을 승인하면서
     글 한 편이 7코인 → 1코인이 됐고, 숫자를 박아 뒀던 이 검사가 그때 빨개졌다(그건 검사가 제 일을 한 것이다).
     그래서 이제는 **값이 아니라 «두 자리가 같은가»** 를 잰다 — 사장님이 값을 또 바꿔도 이 줄은 안 낡는다.
       · `coinsPerWeek` = 편성표가 **미리 보여 주는** 값
       · `pieceCoinCost` = 실제로 **차감하는** 식(정본 한 곳 · `director.ts pieceCoin` 도 이걸 부른다)
     둘이 갈리면 화면이 거짓말을 한다. */
  const cardRule: Rule = { id: 1, channel: "instagram", kind: "cardnews", accountMode: "auto", every: "week", count: 1, active: true };
  const cardWeekly = coinsPerWeek([cardRule]);
  const cardTruth = pieceCoinCost("post", AI_IMAGES_INCLUDED, { format: coinFormatOf("instagram") });
  rec("⑦ 🔴 카드뉴스: 편성표 견적 = 실제 차감식", cardWeekly === cardTruth,
    `견적 ${cardWeekly}코인 ↔ 차감식 ${cardTruth}코인`);
  rec("⑦ 카드뉴스는 `cardnews` 한 값이다(화면 «카드뉴스 N코인»과 같은 출처)", cardTruth === COIN_TABLE.cardnews,
    `COIN_TABLE.cardnews = ${COIN_TABLE.cardnews}`);

  /* 🔴 음성 대조 — 카드 장당으로 또 받으면 이중 청구다. 그 값과 **다르다**는 것을 보인다. */
  const perCard = COIN_TABLE.blog + COIN_TABLE.image * imagesFor(IG, "review").default;
  rec("⑦ 🔴 음성 대조 — 장당으로 셌다면 나왔을 값과 다르다(이중 청구 아님)", cardWeekly !== perCard,
    `카드뉴스 ${cardWeekly}코인 ↔ 장당으로 셌다면 ${perCard}코인(카드 ${imagesFor(IG, "review").default}장)`);

  /* 글 채널도 같은 잣대로 — 내가 카드뉴스를 넣으며 글 채널을 깨뜨리지 않았나. */
  const blogRule: Rule = { id: 2, channel: "naver_blog", kind: "post", accountMode: "auto", every: "week", count: 1, active: true };
  const blogWeekly = coinsPerWeek([blogRule]);
  const blogTruth = pieceCoinCost("post", AI_IMAGES_INCLUDED, { format: coinFormatOf("naver_blog") });
  rec("⑦ 🔴 글 채널: 편성표 견적 = 실제 차감식", blogWeekly === blogTruth, `견적 ${blogWeekly}코인 ↔ 차감식 ${blogTruth}코인`);
  rec("⑦ 글 채널과 카드뉴스가 서로 다른 값으로 간다(둘이 같아지면 하나가 잘못 접힌 것)", blogWeekly !== cardWeekly,
    `글 ${blogWeekly}코인 · 카드뉴스 ${cardWeekly}코인`);
}

const w = (x: unknown, n: number) => String(x ?? "").slice(0, n).padEnd(n);
console.log(`\n인스타 카드뉴스 하니스(DB·네트워크·AI 0 · 돈 0원) · ${new Date().toISOString()}\n${"─".repeat(150)}`);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${w(r.step, 58)} ${w(r.note, 88)}`);
const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
console.log(`${"─".repeat(150)}\nPASS ${pass} · FAIL ${fail}`);
console.log("🔴 한계: 여기까지는 **골격**이다. «모델이 정말 30자로 쓰나 · 표지가 표지답나»는 실호출 1편으로만 알 수 있고 아직 안 했다.");
process.exit(fail ? 1 : 0);
