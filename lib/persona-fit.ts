/**
 * lib/persona-fit.ts — **페르소나 적합도**(DESIGN §5.3-2 「계정 배정 = 건강도·캐던스·**페르소나 적합도**」).
 *   🔎 출처: AC 신규(B-1 · R8CLOSE §B2 · 2026-09-16) — AM 원본 없음.
 *   🔴 **판정은 순수**(위쪽 · DB·네트워크·AI 호출 0). 맨 아래 `personaFitsFor` 만 재료를 읽는다(SELECT 한 번).
 *      재료 읽기를 여기 둔 이유: 부르는 곳이 **둘**(사람 경로 `director.propose` · 자동 경로 `cron/director-auto`)이라
 *      각자 적으면 두 경로가 **다른 기준으로 배정**하게 된다 — 오늘 우리가 여러 번 데인 «두 곳이 갈린다»가 바로 그것이다.
 *
 *   ══ 실측 ══
 *     `director.assignAccount` 는 **건강도·캐던스만** 봤다(`healthScore` 내림차순 · `postsToday < dailyCap`).
 *     적합도는 **0건** — 캠핑 얘기만 하던 계정과 재테크 얘기만 하던 계정에 같은 소재가 똑같이 떨어졌다.
 *
 *   ══ 🔴 LLM 을 새로 부르지 않는다(메인 지시 · 돈이 두 배) ══
 *     설계에 「(LLM 1콜)」이라고 적혀 있지만 **글자로 잴 수 있는 것부터** 한다:
 *     그 계정 페르소나의 **관심사·브랜드·사는 모양**(`content-gen.personaTerms` 가 뽑는 그 낱말들)이
 *     소재의 제목·앵글·검색어와 **겹치는가**. 겹침은 LLM 없이 정확히 잴 수 있고, 값이 0원이다.
 *     🔴 **글자로 못 재는 것**(말투가 맞나 · 이 사람이 쓸 법한 소재인가)은 여기서 **안 재고 «못 쟀다»고 적는다**(AC-9).
 *        그게 정말 필요하면 메인이 값을 보고 정한다 — 내가 조용히 LLM 을 붙이지 않는다.
 *
 *   ══ 🔴 막지 않는다(CLAUDE §9) ══
 *     적합도가 0이어도 **배정은 된다.** 순위만 바뀌고, 낮으면 «이 계정엔 좀 안 맞아요»라고 **말해 준다.**
 *     그래서 가중치에 **천장**이 있다(`PERSONA_FIT_WEIGHT`) — 적합도가 건강도를 이기면 그건 순위가 아니라 게이트다.
 */

/** 적합도 한 판. */
export interface PersonaFit {
  /** 0~1. 🔴 `measured:false` 면 **0 이 아니라 «모름»** 이다 — 0 으로 읽으면 «안 맞는다»로 오독된다. */
  score: number;
  /** 실제로 겹친 낱말(고객에게 그대로 보여 준다 — 근거 없는 점수는 점수가 아니다). */
  matched: string[];
  /** 잴 재료가 있었나. 페르소나에 관심사·사는 모양이 하나도 없으면 `false`. */
  measured: boolean;
  /** 사람말 한 줄. 🔴 겁주지 않는다(§3) — «안 맞으면 안 된다»가 아니라 «그래도 올라가요». */
  line: string;
}

/**
 * 🔴 **적합도가 건강도 옆에서 움직일 수 있는 폭**(0~100 척도에서 20).
 *   건강도 차이가 20을 넘으면 적합도로는 못 뒤집는다 — 아픈 계정에 «잘 맞는 글»을 밀어 넣지 않는다.
 *   비슷한 계정끼리는 적합도가 가른다. **이게 «순위만 바꾼다»의 실제 뜻이다.**
 */
export const PERSONA_FIT_WEIGHT = 20;

/** 겹침을 셀 때 낱말 몇 개까지 보나 — 관심사가 20개인 페르소나가 한 개 겹쳤다고 «잘 맞는다»가 되면 안 된다. */
const FIT_BASE = 4;
/** 너무 짧은 낱말은 아무 데나 걸린다(«차» 가 «자동차»·«차이»·«기차» 에 걸린다). */
const MIN_TERM = 2;
/** 소재 쪽에서 걷어 낼 기호. */
const STRIP = /[^\p{L}\p{N}\s]/gu;

/**
 * 이 소재가 이 계정 이야기에 맞나 — **글자 겹침**으로만 잰다.
 *   `terms` = `content-gen.personaTerms(profile)` 의 결과(지역·가족·직업·사는 모양 + 브랜드·관심사).
 */
export function personaFitOf(terms: readonly string[], topic: { title?: string | null; angle?: string | null; keyword?: string | null }): PersonaFit {
  const clean = [...new Set(terms.map((t) => String(t ?? "").trim()).filter((t) => t.length >= MIN_TERM))];
  const hay = `${topic.title ?? ""} ${topic.angle ?? ""} ${topic.keyword ?? ""}`.replace(STRIP, " ").toLowerCase();
  if (!clean.length) {
    return { score: 0, matched: [], measured: false, line: "이 계정이 어떤 이야기를 하는지 아직 안 정해서, 잘 맞는지는 못 쟀어요." };
  }
  if (!hay.trim()) {
    return { score: 0, matched: [], measured: false, line: "소재에 견줄 말이 없어서 잘 맞는지는 못 쟀어요." };
  }
  /* 양쪽으로 본다 — 페르소나 낱말이 소재에 들어 있거나(«캠핑» ⊂ «가을 캠핑 준비물»),
     소재 낱말이 페르소나 낱말에 들어 있거나(«등산» ⊂ «등산복»). 한쪽만 보면 절반을 놓친다. */
  const hayWords = hay.split(/\s+/).filter((w) => w.length >= MIN_TERM);
  const matched = clean.filter((t) => { const lt = t.toLowerCase(); return hay.includes(lt) || hayWords.some((w) => lt.includes(w)); });
  const score = Math.min(1, matched.length / Math.min(FIT_BASE, clean.length));
  const line = matched.length
    ? `평소 쓰는 이야기(${matched.slice(0, 3).join(" · ")})와 겹쳐요.`
    : "이 계정이 평소 쓰던 이야기와는 좀 달라요 — 그래도 그대로 올라가요.";
  return { score, matched, measured: true, line };
}

/**
 * 배정 점수에 더할 몫. 🔴 **못 쟀으면 0** 이다 — 모르는 것을 «안 맞는다»로도 «잘 맞는다»로도 치지 않는다(AC-9).
 *   못 쟀을 때 0을 주는 것은 «맨 밑으로 보낸다»가 아니라 «순위를 건드리지 않는다»는 뜻이다(모두에게 똑같이 0이다).
 */
export function personaFitBonus(fit: PersonaFit): number {
  return fit.measured ? Math.round(fit.score * PERSONA_FIT_WEIGHT) : 0;
}


/* ═══════════ 재료 읽기 — 🔴 여기부터는 순수가 아니다(SELECT 한 번) ═══════════ */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { personaTerms, type PersonaProfile } from "./content-gen";

/**
 * 계정별 **배정 가산점**을 만든다(계정 id → 점수).
 *   🔴 페르소나가 없는 계정은 **지도에 안 넣는다** = 가산점 0 = 순위를 건드리지 않는다(«모름»을 «나쁨»으로 치지 않는다 · AC-9).
 *   🔴 페르소나를 **계정 수만큼 읽지 않는다** — 테넌트의 페르소나를 한 번에 읽어 메모리에서 짝짓는다(계정 30개면 쿼리 30번이 된다).
 */
export async function personaFitsFor(
  tid: number,
  accounts: readonly { id: number; personaId?: number }[],
  topic: { title?: string | null; angle?: string | null; keyword?: string | null },
): Promise<{ bonus: Map<number, number>; fits: Map<number, PersonaFit> }> {
  const bonus = new Map<number, number>(), fits = new Map<number, PersonaFit>();
  const ids = [...new Set(accounts.map((a) => a.personaId).filter((x): x is number => !!x))];
  if (!ids.length) return { bonus, fits };
  const rows = await q(sql`SELECT id, profile FROM personas WHERE tenant_id = ${tid} AND id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  const byPersona = new Map<number, PersonaFit>();
  for (const r of rows) {
    const fit = personaFitOf(personaTerms((r.profile || {}) as PersonaProfile), topic);
    byPersona.set(Number(r.id), fit);
  }
  for (const a of accounts) {
    const fit = a.personaId ? byPersona.get(a.personaId) : undefined;
    if (!fit) continue;
    fits.set(a.id, fit);
    bonus.set(a.id, personaFitBonus(fit));
  }
  return { bonus, fits };
}
