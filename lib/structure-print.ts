/**
 * lib/structure-print.ts — **골격 지문**(R8-A §2 · B-1 2026-09-15). 순수(DB·AI 0 · 임포트는 타입뿐).
 *
 *   ══ 왜 만들었나 ══
 *     `lib/similarity.ts` 는 **글자**만 본다(2-gram 자카드). 그래서 소제목 수·목차 유무·**블록 순서**·끝맺음이
 *     매번 똑같아도 **단어만 다르면 통과**한다. 그런데 우리 `writing-contracts.ts` 의 `structure` 는 채널당 format
 *     3~5개 **고정 배열**이라 — 같은 채널에 10편을 쓰면 **골격이 3~5가지로 돈다.**
 *     사람은 본문을 읽기 전에 **첫눈에** 안다. 즉 이건 «형식 정확도»가 아니라 **AI 티**다(R8-A 조사 결론).
 *
 *   ══ 영상 축의 짝 ══
 *     영상은 **그림을 지문으로** 잰다(`lib/video/fingerprint.ts` pHash → 다른 계정 영상과 해밍 거리).
 *     글은 **골격을 지문으로** 잰다. 같은 발상이고, 쓰는 자리도 같다 — 최근 글과 견줘 너무 닮으면 말한다.
 *
 *   ══ 무엇을 지문으로 삼나 ══
 *     🔴 **블록 타입 순서가 핵심**이다(메인 지시). 나머지(H2 수·이미지 수)는 숫자라 우연히 겹치지만 **순서는 잘 안 겹친다**.
 *     보조로 목차 유무·끝맺음 형태를 본다 — 둘 다 R8-A 조사에서 «채널마다·글마다 다르다»가 확인된 항목이다.
 *
 *   ══ 소프트다 ══
 *     `GATE_KEYS` 에 넣지 않는다(= `runGate` 가 안 돈다 · `link_check` 와 같은 자리).
 *     초기엔 표본이 적어 오탐이 나고, **하드로 걸면 첫 고객이 글을 못 낸다**(메인 판단).
 *     이번 라운드 몫은 ①검수 화면에 «최근 글과 구조가 많이 겹쳐요» 한 줄 ②디렉터가 **다음 글의 format 을 다른 것으로 고르는 입력**.
 *   🔎 출처: AC 신규(계약 R8-A §2 · B-1 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import type { Block } from "./blocks";

/** 블록 타입 → 한 글자(순서를 짧게 적기 위해). 사전에 없는 타입은 «?». */
const CODE: Record<string, string> = {
  hook: "H", para: "p", h2: "2", h3: "3", quote: "q", list: "l", checklist: "c", table: "t",
  image: "i", divider: "-", tip: "T", faq: "f", hashtags: "#", disclosure: "d", adsense: "a",
  toc: "o", summary: "s", affiliate: "A",
};

export interface StructurePrint {
  /** 블록 타입 순서(한 글자씩). 지문의 **본체**. */
  seq: string;
  h2: number;
  h3: number;
  images: number;
  toc: boolean;
  /** 마지막 블록 타입(끝맺음 형태). */
  ending: string;
  /** 블록 총수. */
  blocks: number;
}

/** 블록 배열 → 골격 지문. */
export function structurePrint(blocks: Block[]): StructurePrint {
  const types = (Array.isArray(blocks) ? blocks : []).map((b) => String(b?.type ?? ""));
  return {
    seq: types.map((t) => CODE[t] ?? "?").join(""),
    h2: types.filter((t) => t === "h2").length,
    h3: types.filter((t) => t === "h3").length,
    images: types.filter((t) => t === "image").length,
    toc: types.includes("toc"),
    ending: types.length ? types[types.length - 1] : "",
    blocks: types.length,
  };
}

/** 지문 → 짧은 문자열 키(같은 골격이면 같은 값). 저장·빠른 대조용. */
export function structureHash(p: StructurePrint): string {
  return `${p.seq}|${p.h2}.${p.h3}.${p.images}${p.toc ? "+o" : ""}>${p.ending}`;
}

/** 문자 2-gram 집합(순서 비교용). */
function grams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length <= 1) { if (s) out.add(s); return out; }
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/**
 * 두 골격이 얼마나 겹치나(0~1). **순서 0.7 + 생김새 0.3**.
 *   순서 = 블록 타입 열의 2-gram 자카드(같은 배열이면 1).
 *   생김새 = H2·이미지 수가 비슷한가 · 목차 유무가 같은가 · 끝맺음이 같은가.
 *   🔴 길이가 많이 다르면(블록 수 2배 차이) 순서가 우연히 겹쳐도 «다른 글»로 본다.
 */
export function structureOverlap(a: StructurePrint, b: StructurePrint): number {
  if (!a.seq || !b.seq) return 0;
  const ga = grams(a.seq), gb = grams(b.seq);
  let inter = 0; for (const g of ga) if (gb.has(g)) inter++;
  const union = ga.size + gb.size - inter;
  const seqSim = union ? inter / union : 0;

  const near = (x: number, y: number) => (Math.max(x, y) === 0 ? 1 : 1 - Math.abs(x - y) / Math.max(x, y, 1));
  const look = (near(a.h2, b.h2) + near(a.images, b.images) + (a.toc === b.toc ? 1 : 0) + (a.ending === b.ending ? 1 : 0)) / 4;

  const lenRatio = Math.min(a.blocks, b.blocks) / Math.max(a.blocks, b.blocks, 1);
  const raw = seqSim * 0.7 + look * 0.3;
  return Math.round(raw * lenRatio * 1000) / 1000;
}

/**
 * 임계 — 이 위로 겹치면 «너무 닮았다».
 *   🔴 근거: 같은 format 을 두 번 쓰면 `seq` 가 **거의 같아** 0.9+ 가 나온다(스모크 실측).
 *      다른 format 끼리는 0.3~0.6 근처다 — 그 사이를 넉넉히 비운 값으로 잡았다.
 *      운영 실측 전이라 **소프트**로만 쓴다(막지 않는다).
 */
export const STRUCTURE_OVERLAP_MAX = 0.75;

export interface StructureCompare {
  /** 가장 닮은 글과의 겹침(0~1). 견줄 글이 없으면 0. */
  overlap: number;
  /** 그 글의 id(있으면). */
  againstId?: number;
  /** 견준 글 수 — 0 이면 «잴 수 없었다»(통과지만 잰 게 아니다 · AC-9). */
  compared: number;
}

/** 최근 글들의 지문과 견준다. `recent` 는 최신순이어도 상관없다(최댓값만 본다). */
export function compareToRecent(mine: StructurePrint, recent: { id: number; print: StructurePrint }[]): StructureCompare {
  let best: { id: number; v: number } | null = null;
  for (const r of recent) {
    const v = structureOverlap(mine, r.print);
    if (!best || v > best.v) best = { id: r.id, v };
  }
  if (!best) return { overlap: 0, compared: 0 };
  return { overlap: best.v, againstId: best.id, compared: recent.length };
}

/** 저장된 값(jsonb) → 지문. 모양이 아니면 null(옛 글은 지문이 없다). */
export function printFromMeta(v: unknown): StructurePrint | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.seq !== "string" || !o.seq) return null;
  return {
    seq: o.seq, h2: Number(o.h2) || 0, h3: Number(o.h3) || 0, images: Number(o.images) || 0,
    toc: o.toc === true, ending: String(o.ending ?? ""), blocks: Number(o.blocks) || o.seq.length,
  };
}
