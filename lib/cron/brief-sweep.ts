/**
 * lib/cron/brief-sweep.ts — 스텝 `brief.sweep`(계약 P1R8 §5.2 · DESIGN §4.1 «brief 상태 proposed→confirmed→producing→done»).
 *   🔎 출처: AC 신규(계약 P1R8 §5.2 · 생성 2026-09-15) — AM 원본 없음.
 *
 *   ══ 무엇이 문제였나(2026-09-15 라이브 실측) ══
 *     설계는 brief 상태를 **네 단계**로 말하는데 코드가 쓰는 것은 셋뿐이었다:
 *       `proposed`(제안) → `confirmed`(확정) → 🔴 **`producing`·`done` 은 한 번도 쓰인 적이 없다** ( + 설계에 없는 `skipped` 가 따로 있다).
 *     라이브 분포: confirmed 30 · proposed 18 · skipped 13 · **producing 0 · done 0**.
 *     그래서 «확정한 뒤로 이 brief 가 어디까지 갔나»를 아무도 모른다 — 글이 다 나가도 brief 는 영원히 `confirmed` 다.
 *
 *   ══ 왜 «파생»으로 만드나 ══
 *     상태를 **쓰는 손을 늘리지 않는다**(§10 «상태는 한 곳에서만»). confirm·생성·발행 경로에 각각 UPDATE 를 흩뿌리면
 *     그중 하나가 빠졌을 때 **조용히 멈춘 brief** 가 생긴다. 대신 이 스텝이 **자기 글들의 상태에서 brief 상태를 읽어 낸다** —
 *     빠질 자리가 없고, 과거 행도 다음 틱에 저절로 맞는다.
 *
 *   ══ 규칙(한 줄씩) ══
 *     · `confirmed` 인데 글이 **아직 만들어지는 중**(generating·in_review·scheduled·publishing…)이면 → `producing`
 *     · 글이 **전부 끝났으면**(published·rejected) → `done`
 *     · 🔴 **`failed`·`awaiting_manual` 은 «끝»이 아니다** — 다시 시도하거나 사람이 올려 주면 살아난다. 그 brief 는 `producing` 에 남는다
 *       (끝났다고 적어 버리면 «해야 할 일»에서 사라져 영영 안 본다 · AC-9).
 *     · `skipped`·`proposed` 는 건드리지 않는다(각자 주인이 있다 — produce 스텝·사람).
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { type CronStep, type TenantCtx, type StepOutcome, NOOP } from "./base";

/** 아직 가는 중인 글. */
const MOVING = ["generating", "draft", "in_review", "approved", "scheduled", "publishing"] as const;
/** 더 갈 곳이 없는 글(사람이 버렸거나 나갔다). */
const FINISHED = ["published", "rejected"] as const;

export const briefSweepStep: CronStep = {
  key: "brief.sweep",
  every: "hourly",
  needsAutoSchedule: false,
  async run(ctx: TenantCtx): Promise<StepOutcome> {
    /* ① confirmed → producing : 글이 하나라도 가고 있는 brief. */
    const toProducing = await q(sql`
      UPDATE briefs b SET status = 'producing'
      WHERE b.tenant_id = ${ctx.tid} AND b.status = 'confirmed'
        AND EXISTS (SELECT 1 FROM pieces p WHERE p.brief_id = b.id AND p.status IN (${sql.join(MOVING.map((s) => sql`${s}`), sql`, `)}))
      RETURNING b.id`);

    /* ② producing|confirmed → done : 글이 **하나 이상** 있고 **전부** 끝났을 때.
       🔴 글이 0건인 brief 는 건드리지 않는다 — «만들다 만 것»과 «다 끝난 것»은 다르다. */
    const toDone = await q(sql`
      UPDATE briefs b SET status = 'done'
      WHERE b.tenant_id = ${ctx.tid} AND b.status IN ('confirmed', 'producing')
        AND EXISTS (SELECT 1 FROM pieces p WHERE p.brief_id = b.id)
        AND NOT EXISTS (SELECT 1 FROM pieces p WHERE p.brief_id = b.id AND p.status NOT IN (${sql.join(FINISHED.map((s) => sql`${s}`), sql`, `)}))
      RETURNING b.id`);

    const changed = toProducing.length + toDone.length;
    if (!changed) return NOOP;
    return { changed, skipped: 0, detail: { producing: toProducing.length, done: toDone.length } };
  },
};
