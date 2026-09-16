/**
 * lib/format-pick.ts — **골격 지문을 보고 다음 글의 format 을 고른다**(R8 §2.2 · B-1 2026-09-15).
 *
 *   ══ 왜 ══
 *     `pickFormat()` 은 **이름**으로만 돈다(«직전에 쓴 것 빼고 · 최근에 안 쓴 것 우선»).
 *     그런데 사람이 첫눈에 아는 것은 이름이 아니라 **생김새**다 — 이름이 달라도 블록 배열이 닮으면 같은 글로 보인다.
 *     그래서 `structure_repeat` 축(`lib/structure-print.ts`)이 «최근 글과 구조가 겹친다» 고 말해도,
 *     **고르는 쪽이 그 말을 안 들으면** 다음 글도 또 겹친다 — 재기만 하고 피하지는 않는 상태였다.
 *
 *   ══ 🔴 고르는 잣대 = 재는 잣대 ══
 *     여기서 쓰는 것은 축이 쓰는 **바로 그 함수**다(`structurePrint`·`structureOverlap`).
 *     다른 잣대로 고르면 «고른 쪽»과 «재는 쪽»이 영원히 싸운다(메인 지시 2026-09-15).
 *
 *   ══ 무엇을 견주나 ══
 *     후보 format 을 **골랐다면 나왔을 골격**을 그려 보고(`structureFor` · 생성과 같은 함수·같은 입력) 최근 글 지문과 견준다.
 *     🔴 씨앗만 없다 — piece id 는 고른 뒤에 생긴다. 그래서 씨앗 하나를 지어내지 않고 **여러 씨앗의 중앙값**을 쓴다(AC-57 · `PREVIEW_SEEDS`).
 *     🔴 이게 중요한 이유(스모크 ⑥ 실측): 맨 **바탕**으로만 견주면 거부권이 **한 번도 안 걸렸다**(10편×10채널에 0회).
 *        최근 글 지문은 흔들기까지 끝난 완성본인데 후보만 맨 바탕이라, 같은 format 인데도 «안 닮았다»가 나왔기 때문이다.
 *        씨앗으로 그려 보게 하자 **11회** 걸렸고(글 채널 6종 기준) 기준 초과가 **61 → 58**, 악화 채널 0 이었다.
 *        **같은 함수로 재는 것만으로는 부족하고, 같은 «대상»을 재야 한다.**
 *     🔴 **골격을 만드는 쪽은 여기서 고치지 않는다** — `structureFor`·`applyTiers` 는 읽기만 한다(C 가 수리 중).
 *        C 가 흔들기를 키우면 이 미리보기도 **저절로 같이 좋아진다**(그게 같은 함수를 쓰는 값어치다).
 *
 *   ══ 🔴 이 절이 못 메우는 구멍(스모크 ⑥ 실측 · 숨기지 않는다) ══
 *     format 이 1~5개뿐이라 **한 채널에 10편**을 쓰면 같은 format 이 도는 것 자체는 못 막는다(인스타는 아예 1종이다).
 *     그건 «고르기»가 아니라 «만들기»(같은 format 을 매번 다르게 흔드는 것 = `applyTiers` · C 몫)의 일이다.
 *     여기가 메우는 구멍은 하나다 — **이름이 다른데 생김새가 닮은 칸**.
 *   🔎 출처: AC 신규(계약 R8 §2.2 · B-1 · 생성 커밋 `f589413` 2026-09-15) — AM 원본 없음(`../AutoMarketing/lib/` 에 같은 이름 없음 · 2026-09-16 확인).
 *     계보: 구성 로테이션 자체는 AM `content-tone.ts` 에서 왔고 그건 `lib/writing-contracts.ts` 가 이미 밝히고 있다.
 *     이 파일은 그 위에 **골격 지문**(`lib/structure-print.ts`)을 얹은 AC 고유분이다 — AM 에는 지문으로 고르는 코드가 없다.
 */
import { structurePrint, structureOverlap, STRUCTURE_OVERLAP_MAX, type StructurePrint } from "./structure-print";
import { pickFormat, structureFor, topicGroupOf, type WritingContract, type FormatKey, type BlockType } from "./writing-contracts";

/**
 * 고를 때 이미 알고 있는 «글의 생김새» — 있으면 후보 지문을 **그만큼 더 실물에 가깝게** 만든다.
 *   🔴 지어낸 값을 넣지 않는다(AC-57): 두 값 다 고르는 시점에 **이미 정해져 있다**
 *      (`defaultImageCount(channel)` 는 채널만 보는 순수 함수 · 제휴 여부는 소재 intent 에서 나온다).
 *   🔴 왜 필요한가: 최근 글 지문은 **제휴 고지·이미지까지 들어간 완성본**이다.
 *      후보를 맨 바탕으로만 견주면 첫 블록·블록 수가 어긋나 겹침이 **낮게** 나오고, 거부권이 덜 걸린다.
 */
export interface PickShape {
  imageCount: number;
  affiliate: boolean;
  /** 소재 intent·제목 — `topicGroupOf` 가 **후보 format 과 함께** 주제군을 정한다(생성 때와 같은 입력 · `content-gen.ts:229`). */
  intent?: string | null;
  title?: string | null;
}

/**
 * 후보를 그려 볼 때 쓰는 씨앗들 — 🔴 **하나를 지어내지 않는다.**
 *   고르는 시점엔 piece id 가 없다. 씨앗 하나를 골라 «이게 나올 것»이라고 하면 그건 대용물이다(AC-57).
 *   대신 여러 씨앗으로 그려 보고 **중앙값**을 쓴다 — «어떤 씨앗이 와도 대략 이만큼 닮는다»는 값이라 거짓이 아니다.
 *   값은 임의의 홀수 5개(중앙값이 한 개로 떨어지게) · 고정이라 같은 입력이면 늘 같은 답이다(결정론).
 */
const PREVIEW_SEEDS: readonly number[] = [11, 37, 91, 157, 233];

export interface FormatPick {
  format: FormatKey;
  /** 고른 format 의 바탕이 최근 글과 얼마나 겹치나(0~1). 견줄 글이 없으면 0. */
  overlap: number;
  /** 견준 최근 글 수 — 0 이면 **못 잰 것**이다(이름 로테이션으로 골랐다 · AC-9). */
  compared: number;
  /** 종전 이름 순서의 답을 **갈아탔나**. 감사에 이 값이 있어야 «이 절이 실제로 일했다»가 보인다(AC-29). */
  switched?: boolean;
  /** 사람이 읽을 사유 — 감사·검수 화면에 그대로 쓴다. */
  why: string;
}

/** 블록 타입 배열 → 지문(축이 쓰는 함수 그대로. `Block` 은 type 만 쓰므로 모양만 맞춰 준다). */
export function printOfTypes(types: BlockType[]): StructurePrint {
  return structurePrint(types.map((t) => ({ type: t })) as never);
}

/**
 * 후보 format 을 골랐다면 나왔을 골격들 — 씨앗마다 하나씩.
 *   생성(`content-gen.ts:230`)과 **같은 함수·같은 입력**으로 그린다(이미지 수·제휴·주제군). 다른 것은 씨앗뿐이다.
 *   🔴 `shape` 가 없으면(옛 호출) 흔들기 없는 **맨 바탕** 하나다 — `structureFor` 는 씨앗이 없으면 흔들기를 건너뛴다(`writing-contracts.ts:581`).
 */
function previewPrints(c: WritingContract, f: FormatKey, shape?: PickShape | null): StructurePrint[] | null {
  const base = c.structure[f];
  if (!base || !base.length) return null;                     // 🔴 `structureFor` 는 배열이 없으면 **다른 format** 으로 갈아타 준다 — 그건 여기서 거짓말이 된다
  if (!shape) return [printOfTypes(base)];
  const group = topicGroupOf({ format: f, intent: shape.intent ?? null, title: shape.title ?? null });
  try {
    return PREVIEW_SEEDS.map((sd) => printOfTypes(structureFor(c, f, shape.imageCount, shape.affiliate, sd, group)));
  } catch (e) {
    /* 🔴 삼키지 않는다(AC-58) — 큰 소리로 적고, **종전과 같은 바탕 비교**로 내려앉는다(디렉터 전체를 멈추지는 않는다). */
    console.warn(`[format-pick] 후보 골격 미리보기 실패 format=${f} — 바탕으로만 견준다`, String((e as Error)?.message ?? e).slice(0, 160));
    return [printOfTypes(base)];
  }
}

/**
 * 후보가 최근 글들과 얼마나 닮았나.
 *   · 최근 글 쪽은 축과 같은 «가장 닮은 한 편»(최댓값) 규칙.
 *   · 씨앗 쪽은 **중앙값** — 운 좋은 씨앗 하나로 «안 닮았다»고 우기지 않고, 운 나쁜 하나로 겁내지도 않는다.
 */
function overlapOf(c: WritingContract, f: FormatKey, recentPrints: StructurePrint[], shape?: PickShape | null): number {
  const ps = previewPrints(c, f, shape);
  if (!ps) return 1;                                          // 배열이 없는 format 은 고르지 않는다(가장 나쁜 점수)
  if (!recentPrints.length) return 0;
  const per = ps.map((p) => { let w = 0; for (const r of recentPrints) { const v = structureOverlap(p, r); if (v > w) w = v; } return w; }).sort((a, b) => a - b);
  return per[(per.length - 1) >> 1];
}

/**
 * 최근 글 지문을 보고 format 을 고른다. **거부권**이지 새 고르기가 아니다.
 *   · `hint` 가 있으면 그대로 따른다(사람·소재가 못 박은 것은 우리가 안 바꾼다 — 종전과 같다).
 *   · 최근 지문이 없으면 **종전 `pickFormat`** 그대로(무회귀 · «못 쟀다»를 그렇게 적는다).
 *   · 있으면 **종전이 고른 것을 먼저 재 본다**. 축 기준(`STRUCTURE_OVERLAP_MAX`) 아래면 **그대로 둔다.**
 *     넘을 때만 후보 중 가장 안 닮은 것으로 **갈아탄다**.
 *
 *   ══ 🔴 왜 «항상 가장 안 닮은 것»이 아니라 거부권인가(스모크로 뒤집은 설계) ══
 *     처음엔 매번 최솟값을 골랐다. 그랬더니 10편 이어쓰기에서 기준 초과가 **2편 → 4편으로 늘었다.**
 *     이름 로테이션(`pickFormat`)은 «가장 오래 안 쓴 것»이라 format 4개를 **골고루 돌린다.**
 *     최솟값 고르기는 «남들과 제일 다른 한둘»에 **눌러앉아** 오히려 같은 골격을 반복했다.
 *     즉 로테이션은 고장난 게 아니었고, 구멍은 «이름이 다른데 생김새가 닮은 칸»뿐이었다.
 *     그래서 로테이션을 살리고 **그 구멍에서만** 끼어든다 — 종전 답을 덮어쓰지 않고 **보탠다.**
 */
export function pickFormatByPrint(
  c: WritingContract,
  recentFormats: string[],
  seed: string,
  hint: string | null | undefined,
  recentPrints: StructurePrint[],
  shape?: PickShape | null,
  /**
   * [R12-10 · 설계 R12 §8] 🔴 **배운 골격 선호 순서**(`lib/learn-tilt.ts`). 🔴 **겹침 판정은 한 글자도 안 건드린다.**
   *   쓰이는 자리가 **딱 둘**이다: ⓐ 견줄 최근 글이 아예 없을 때(이름 순서 대신) ⓑ **이미 «겹친다»고 판정해 갈아탈 때** 그 후보들 사이 동점 가르기.
   *   🔴 왜 이렇게 좁히나 — 학습이 «리스티클이 제일 잘 된다»고 골격을 몰면 R8-A 의 결론(«이상적인 글 한 벌을 베끼지 마라»)을 **통째로 무르고**
   *      곧바로 `structure_repeat` 축이 빨개져 재작성이 돌아 **돈이 두 배**가 된다(계약 §4-5 · 2026-09-15 `visualMin.faq` 와 같은 모양).
   *   안 넘기면 종전과 똑같다(무회귀).
   */
  prefer?: readonly string[] | null,
): FormatPick {
  const fallback = pickFormat(c, recentFormats, seed, hint);
  if (hint && c.formats.includes(hint as FormatKey)) {
    /* 못 박은 것은 안 바꾼다. 다만 **얼마나 닮았는지는 재서 적는다** — 바꾸지 않는 것과 못 재는 것은 다르다(AC-9). */
    const v = overlapOf(c, hint as FormatKey, recentPrints, shape);
    return { format: hint as FormatKey, overlap: v, compared: recentPrints.length, why: `소재·사용자가 «${hint}» 를 못 박았어요${recentPrints.length ? `(최근 ${recentPrints.length}편과 ${Math.round(v * 100)}% 겹치지만 그대로 갑니다)` : ""}` };
  }
  if (!recentPrints.length) {
    /* [R12-10] ⓐ 견줄 글이 없다 — 여기선 학습이 겹침을 만들 수 없다(최근 글이 0편이다). 배운 것이 있으면 이름 순서보다 낫다. */
    const learned = (prefer ?? []).find((f) => c.formats.includes(f as FormatKey)) as FormatKey | undefined;
    if (learned) return { format: learned, overlap: 0, compared: 0, why: `견줄 최근 글이 없어 반응이 좋던 «${learned}» 로 골랐어요` };
    return { format: fallback, overlap: 0, compared: 0, why: "견줄 최근 글이 없어 이름 순서로 골랐어요" };
  }
  const scored = c.formats.map((f) => ({ f, v: overlapOf(c, f, recentPrints, shape) }));
  const n = recentPrints.length;
  const pctOf = (v: number) => Math.round(v * 100);
  const bar = pctOf(STRUCTURE_OVERLAP_MAX);

  /* ① 종전 답이 축 기준 아래면 손대지 않는다 — 판정식은 축(`checkStructure`)과 **글자 그대로 같다**(`< MAX`). */
  const fbScore = scored.find((s) => s.f === fallback);
  if (!fbScore || fbScore.v < STRUCTURE_OVERLAP_MAX) {
    const v = fbScore ? fbScore.v : 0;
    return { format: fallback, overlap: v, compared: n, why: `이름 순서대로 «${fallback}» — 최근 ${n}편과 ${pctOf(v)}%만 겹쳐요(기준 ${bar}% 미만)` };
  }

  /* ② 넘었다 — 가장 안 닮은 것으로 갈아탄다. 동점이면 «가장 오래 안 쓴 것»(종전 로테이션의 잣대)을 쓴다. */
  const min = Math.min(...scored.map((s) => s.v));
  const lru = (f: FormatKey) => { const i = recentFormats.indexOf(f); return i < 0 ? Number.POSITIVE_INFINITY : i; };
  /* [R12-10] ⓑ 🔴 **여기가 학습이 들어오는 유일한 자리**다 — «가장 안 닮은 것»(`min`)으로 이미 좁혀진 뒤의 **동점 가르기**.
     후보 집합 자체는 겹침 판정이 정한 것이라 학습이 그 판정을 이길 수 없다(`structure_repeat` 무회귀). */
  const pref = (f: FormatKey) => { const i = (prefer ?? []).indexOf(f); return i < 0 ? Number.POSITIVE_INFINITY : i; };
  const best = scored.filter((s) => s.v === min).map((s) => s.f)
    .sort((a, b) => (pref(a) - pref(b)) || (lru(b) - lru(a)) || (c.formats.indexOf(a) - c.formats.indexOf(b)));
  const format = best[0];
  /* 🔴 **갈아탈 데가 없을 수도 있다** — 계약에 format 이 1종뿐인 채널(인스타)이나, 후보가 죄다 기준을 넘는 경우다.
     그때 `switched: true` 라고 적으면 «바꿨다»는 거짓말이 된다(고른 것이 종전 답 그대로다). 있는 그대로 말한다(AC-9). */
  if (format === fallback) {
    return { format, overlap: min, compared: n,
      why: `최근 ${n}편과 ${pctOf(min)}% 겹치는데(기준 ${bar}%) 이 채널 구성 ${c.formats.length}종 중 덜 닮은 것이 없어요 — 구성 고르기로는 더 못 피해요` };
  }
  return {
    format, overlap: min, compared: n, switched: true,
    why: `이름 순서로는 «${fallback}» 이지만 최근 ${n}편과 ${pctOf(fbScore.v)}% 겹쳐요(기준 ${bar}%) — 덜 닮은 «${format}»(${pctOf(min)}%)으로 바꿨어요`,
  };
}
