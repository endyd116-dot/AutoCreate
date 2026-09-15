/**
 * lib/cron/recipe-rollout.ts — 셀렉터 표(recipe)의 **승격·자동 복귀**(계약 P1R8 §3.3 · 설계 §6·§8). **global 스텝**.
 *   AC 신규 2026-09-15(B2).
 *
 *   ══ 🔴 이 스텝의 비대칭이 설계의 답이다 ══
 *     **넓히는 것은 사람이 볼 때만, 좁히는 것은 언제나.**
 *       · 승격(더 많은 러너에게 퍼뜨리기) = KST **평일 10~18시**에만 · 체류 시간 · 카나리 통과가 전부 맞아야
 *       · 자동 복귀(어제 되던 판으로) = **시간 제한 없음 · 즉시**
 *     기준 한 줄: «**되돌아갈 곳이 이미 돌던 판이면 자동, 새로 멈추거나 새로 퍼뜨리면 사람.**»
 *     (채널을 `down` 으로 내리는 것은 여전히 **사람이** 한다 — 그건 «고객 발행을 멈추는 것»이라 새 피해다.)
 *
 *   🔴 **global 스텝**이다(테넌트 루프 밖). recipe 는 테넌트에 속하지 않는다 —
 *      테넌트 스텝으로 만들면 집 수만큼 중복 실행되고, 집이 0이면 영영 안 돈다.
 *
 *   🔴 **영원히 대기를 막는다**(설계 §6.3): 판정 불가(`null`)만 72시간 이어지면 후보를 **포기**한다.
 *      그건 «실패»가 아니라 «시험을 못 했다»다(AC-9) — 다시 올리면 된다. 안 그러면 화면엔 «카나리 도는 중»으로
 *      영원히 남고, 그게 이 프로젝트가 제일 싫어하는 모양(**조용히 멈춰 있는데 초록**)이다.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { writeAudit } from "../audit";
import { RECIPE_CHANNELS } from "../recipe";
import { candidateHarmSignal, getRollout, promoteCandidate, rollbackCandidate } from "../recipe-store";
import type { GlobalStep, StepOutcome } from "./base";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** 판정 불가만 이 시간 넘게 이어지면 후보를 포기한다(설계 §6.3). */
const GIVE_UP_HOURS = 72;

export const recipeRolloutStep: GlobalStep = {
  key: "recipe.rollout",
  every: "hourly",
  scope: "global",
  async run(): Promise<StepOutcome> {
    let promoted = 0; let rolledBack = 0; let held = 0;
    const detail: Record<string, unknown> = {};

    for (const channel of RECIPE_CHANNELS) {
      const ro = await getRollout(channel);
      if (!ro?.candidateVersion) continue;

      /* ① 🔴 **좁히는 것이 먼저다.** 실제 발행에서 깨지고 있으면 시간·요일을 보지 않고 즉시 되돌린다. */
      const harm = await candidateHarmSignal(channel);
      if (harm.rollback) {
        await rollbackCandidate(channel, harm.why);
        rolledBack++;
        detail[channel] = { action: "rollback", why: harm.why, fails: harm.fails, tenants: harm.tenants };
        continue;
      }

      /* ② 카나리가 한 건이라도 false 면 되돌린다 — 아직 안 퍼졌더라도 **후보를 버리는 것**이 맞다.
         (설계 §6 «단언 1건이라도 false → 승격하지 않는다» 보다 한 발 더 간다: 퍼지지 않을 뿐 아니라 **치운다** —
          안 치우면 그 후보가 계속 카나리를 물고 있어 다음 판을 못 올린다.) */
      const [c] = await q(sql`SELECT COUNT(*) FILTER (WHERE ok = false) AS bad, MAX(ran_at) AS last_run
        FROM canary_runs WHERE channel = ${channel} AND recipe_version = ${ro.candidateVersion}`);
      if (n(c?.bad) > 0) {
        await rollbackCandidate(channel, `카나리가 ${n(c?.bad)}건 실패했어요`);
        rolledBack++;
        detail[channel] = { action: "rollback", why: "canary_failed", bad: n(c?.bad) };
        continue;
      }

      /* ③ 🔴 **영원히 대기를 막는다** — 판정 불가만 이어진 채 72시간이면 포기한다(설계 §6.3). */
      const since = ro.stageSince ? Date.parse(ro.stageSince) : Date.now();
      const heldH = (Date.now() - since) / 3_600_000;
      const [g] = await q(sql`SELECT COUNT(*) FILTER (WHERE ok = true) AS good
        FROM canary_runs WHERE channel = ${channel} AND recipe_version = ${ro.candidateVersion}`);
      if (n(g?.good) === 0 && heldH >= GIVE_UP_HOURS) {
        await rollbackCandidate(channel, `${GIVE_UP_HOURS}시간 동안 판정을 못 했어요 — 시험을 못 한 것이지 실패한 게 아니에요`);
        rolledBack++;
        await writeAudit({ tenantId: null, action: "recipe_give_up", actorType: "system", target: `recipe:${ro.candidateVersion}`,
          detail: { channel, heldHours: Math.round(heldH), note: "카나리가 한 번도 판정되지 않았다(시험할 잡이 없었을 수 있다)" }, riskLevel: "medium" });
        detail[channel] = { action: "give_up", heldHours: Math.round(heldH) };
        continue;
      }

      /* ④ 넓히기 — 막히면 **이유를 남긴다**(«왜 아직 대기 중인가»가 화면에 보여야 한다 · 설계 §9). */
      const p = await promoteCandidate(channel);
      if (p.ok) { promoted++; detail[channel] = { action: "promote", to: p.stage ?? "all" }; }
      else { held++; detail[channel] = { action: "hold", why: p.why, stage: ro.stage, heldHours: Math.round(heldH * 10) / 10 }; }
    }

    if (promoted || rolledBack) {
      await writeAudit({ tenantId: null, action: "recipe_rollout_tick", actorType: "system", target: "recipe",
        detail, riskLevel: rolledBack ? "high" : "low" });
    }
    return { changed: promoted + rolledBack, skipped: held, detail };
  },
};
