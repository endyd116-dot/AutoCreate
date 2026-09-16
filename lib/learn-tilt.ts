/**
 * lib/learn-tilt.ts — [R12-10 · 설계 R12 §8 · DESIGN §5F·§9.3] 🔴 **모은 성과를 디렉터에게 돌려준다.**
 *   AC 신규 2026-09-17(B). 🔎 출처: AC 신규 — AM 원본 없음.
 *
 *   ══ 무엇이 문제였나(실측 2026-09-17) ══
 *     `lib/cron/learn.ts` 가 6·24·72시간마다 성과를 **모으기만** 했고, 그 값이 닿는 곳은 **소재 점수 하나**뿐이었다.
 *     · `bestHoursFor()` — 「계정별 최근 30일 최고 시각」. 🔴 **부르는 곳이 0곳**이었다(주석엔 «편성이 읽는다»고 적혀 있었는데 아무도 안 읽었다 · AC-59).
 *     · 스타일·골격의 성과 — `lib/outcomes.ts outcomeStats` 가 낼 수 있는데 **디렉터가 안 물었다.**
 *     ⇒ «이 스타일·이 시각·이 골격이 잘 됐다»가 **다음 글에 한 글자도 안 갔다.**
 *
 *   ══ 🔴 이 파일이 **하지 않는** 것 — 여기가 이 기능의 위험한 절반이다 ══
 *     ① **계약을 덮어쓰지 않는다.** 되먹임은 «세게»가 아니라 **«기울이기»**다 — 후보의 **순서만** 바꾼다(DESIGN §659 · `bestHoursFor` 가 `golden_hours` 를 안 덮는 것과 같은 규율).
 *     ② 🔴 **`structure_repeat` 을 되돌리지 않는다.** 이게 제일 크다.
 *        R8-A 의 결론은 «**이상적인 글 한 벌을 베끼지 마라**»였다. 학습이 «리스티클이 제일 잘 된다»고 말한다고 해서
 *        골격을 리스티클로 몰면 **그 결론을 통째로 무르는 것**이다(그리고 곧바로 골격 겹침 축이 빨개진다 · 재작성이 돌아 돈이 두 배).
 *        ⇒ 골격 기울이기는 **`pickFormatByPrint` 가 이미 «겹친다»고 판정해 갈아탈 때, 그 후보들 사이에서만** 쓴다.
 *           겹침 판정 자체는 **한 글자도 안 건드린다.** 학습은 «어느 쪽으로 갈아탈까»만 거든다.
 *     ③ **없는 시각을 만들지 않는다.** 채널 기본표(`BEST_HOURS`) 밖으로 나가지 않는다 — 순서만 바꾼다.
 *     ④ **사용자가 고른 것을 이기지 않는다.** 계정 골든타임·규칙 고정 시각·계정에 걸어 둔 스타일이 있으면 학습은 **아무것도 안 한다.**
 *     ⑤ 🔴 **표본이 적으면 «아직 몰라요»**(AC-9). 지어내면 되먹임이 아니라 **미신**이다 — 우연히 잘 된 글 세 편이 전 고객의 글 모양을 정한다.
 */

import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { outcomeStats, type StatBucket } from "./outcomes";
import { bestHoursFor } from "./cron/learn";

const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** 🔴 되먹임이 **입을 여는** 표본 바닥. `lib/outcomes.ts MIN_SAMPLES`(30)보다 낮다 — 저쪽은 «평균 수를 말해도 되나»이고 이쪽은 «순서를 기울여도 되나»다.
 *  순서 기울이기는 틀려도 되돌릴 수 있고(다음 글은 또 잰다) 계약을 안 덮으므로 더 낮은 바닥이 맞다. 그래도 **5편 미만은 입을 안 연다.** */
export const TILT_MIN_SAMPLES = 5;

export interface LearnedTilt {
  /** 🔴 **쟀나.** false 면 아래 셋이 전부 비어 있고 디렉터는 오늘까지와 **한 글자도 다르지 않게** 돈다(무회귀). */
  measured: boolean;
  /** 계정별 «반응이 좋았던 시각(KST 시)» 순서. 없으면 빈 Map. */
  hoursByAccount: ReadonlyMap<number, number[]>;
  /** 골격(`format`) 선호 순서 — 🔴 **갈아탈 때만** 쓴다(위 ②). */
  formats: string[];
  /** 반응이 좋았던 스타일 id — 🔴 **계정에 걸어 둔 스타일이 없을 때만** 쓴다. 없으면 null. */
  styleId: number | null;
  /** 🔴 사람이 읽는 한 줄(서버 정본 · AC-52). 못 쟀으면 «아직 몰라요» 쪽 문장이다. */
  line: string;
}

/** 아무것도 안 배운 상태 — 🔴 **이 값으로 돌면 오늘까지와 똑같다**(무회귀의 기준점). */
export const NO_TILT: LearnedTilt = Object.freeze({
  measured: false, hoursByAccount: new Map<number, number[]>(), formats: [], styleId: null,
  line: "아직 몰라요 — 반응을 좀 더 모으면 잘 되던 쪽으로 기울여 드릴게요",
});

/**
 * rankBuckets — 성과 묶음 → **«안 쓴 것보다 나은 것»만** 좋은 순서로(순수).
 *   🔴 «그냥 제일 큰 것»이 아니다. 기준선(`(없음)` 묶음 · 없으면 전체 평균)보다 나은 것만 남긴다 —
 *      그래야 «제일 낫다고 골랐는데 안 쓰느니만 못한» 일이 안 난다(`recommendTextStyle` 과 같은 규율).
 *   🔴 표본이 `TILT_MIN_SAMPLES` 미만인 묶음은 **후보가 아니다**(AC-9).
 *   🔴 조회를 못 잰 묶음은 수익으로 본다. 둘 다 없으면 뺀다 — **못 잰 것을 0으로 세지 않는다.**
 */
export function rankBuckets(buckets: readonly StatBucket[], minSamples = TILT_MIN_SAMPLES): string[] {
  const valOf = (b: StatBucket) => (b.avgViews !== null ? b.avgViews : b.avgRevenue !== null ? b.avgRevenue : null);
  const usable = buckets.filter((b) => b.samples >= minSamples && valOf(b) !== null);
  if (!usable.length) return [];
  const none = usable.find((b) => b.key === "(없음)");
  const cands = usable.filter((b) => b.key !== "(없음)");
  if (!cands.length) return [];
  const baseline = none ? (valOf(none) as number)
    : cands.reduce((a, b) => a + (valOf(b) as number), 0) / cands.length;
  return cands.filter((b) => (valOf(b) as number) > baseline)
    .sort((a, b) => (valOf(b) as number) - (valOf(a) as number))
    .map((b) => b.key);
}

/**
 * tiltOrder — 후보 목록을 선호 순서로 **기울인다**(순수 · 안정 정렬).
 *   🔴 **후보 밖의 값을 넣지 않는다** — 선호에 있는데 후보에 없으면 그냥 버린다(없는 골격·없는 시각을 만들지 않는다).
 *   🔴 **후보를 빼지 않는다** — 선호에 없는 것은 원래 순서 그대로 **뒤에** 붙는다(고를 수 있는 것이 줄면 그건 기울이기가 아니라 게이트다).
 */
export function tiltOrder<T>(candidates: readonly T[], prefer: readonly T[]): T[] {
  const head: T[] = [];
  for (const p of prefer) if (candidates.includes(p) && !head.includes(p)) head.push(p);
  return [...head, ...candidates.filter((c) => !head.includes(c))];
}

/**
 * learnedTiltFor — 한 집의 되먹임 한 벌(DB 3회). 🔴 **실패하면 `NO_TILT`** — 학습이 안 돌아도 글은 오늘처럼 나간다(막지 않는다 · §9).
 */
export async function learnedTiltFor(tid: number): Promise<LearnedTilt> {
  try {
    const [hoursByAccount, fmtBuckets, styleBuckets] = await Promise.all([
      bestHoursFor(tid),
      outcomeStats("format", { tenantId: tid }).catch(() => [] as StatBucket[]),
      outcomeStats("styleId", { tenantId: tid }).catch(() => [] as StatBucket[]),
    ]);
    const formats = rankBuckets(fmtBuckets);
    const styleKey = rankBuckets(styleBuckets)[0] ?? null;
    const styleId = styleKey && /^\d+$/.test(styleKey) ? n(styleKey) : null;
    /* 🔴 걸어 둔 스타일이 **지워졌으면** 추천하지 않는다 — 없는 옷을 입히려다 스타일 없이 쓰고 «왜 안 입었지»가 된다. */
    const styleAlive = styleId ? (await q(sql`SELECT id FROM text_styles WHERE tenant_id = ${tid} AND id = ${styleId} AND deleted_at IS NULL`)).length > 0 : false;
    const measured = hoursByAccount.size > 0 || formats.length > 0 || styleAlive;
    if (!measured) return NO_TILT;
    const bits: string[] = [];
    if (hoursByAccount.size) bits.push("반응이 좋던 시각");
    if (formats.length) bits.push("잘 되던 구성");
    if (styleAlive) bits.push("잘 되던 글 모양");
    return {
      measured: true, hoursByAccount, formats, styleId: styleAlive ? styleId : null,
      /* 🔴 «기울였다»까지만 말한다 — «이렇게 하면 잘 됩니다»는 우리가 약속할 수 없는 말이다(수익 약속 금지 · §3). */
      line: `${bits.join(" · ")}을 이번 편성에 조금 반영했어요`,
    };
  } catch (e) {
    console.warn("[learn-tilt] 되먹임 읽기 실패 — 오늘까지와 같게 돈다", String((e as Error)?.message ?? e).slice(0, 120));
    return NO_TILT;
  }
}
