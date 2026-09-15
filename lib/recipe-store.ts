/**
 * lib/recipe-store.ts — 셀렉터 표(recipe)의 **저장·배포 단계**(계약 P1R8 §3.3 · DDL 0051).
 *   AC 신규 2026-09-15(B2). 형태·서명은 `lib/recipe.ts`(순수 리프) — 여기는 DB 만 본다.
 *
 *   ══ 🔴 이 파일의 한 줄 ══
 *   **못 주면 안 준다.** 표를 못 찾거나·서명이 없거나·러너 판이 낮으면 **null** 이고, 러너는 zip 에 묶여 온 표로 **계속 일한다**.
 *   배포는 편의고 **발행이 본업**이다(자동 업데이트에서 세운 규율과 같다).
 */
import { sql } from "drizzle-orm";
import { db } from "../db/index";
import { jsonb } from "./db-util";
import { writeAudit } from "./audit";
import {
  RECIPE_CHANNELS, STAGE_ORDER, canPromoteAt, isRecipeVersion, minDwellHours, nextStage,
  recipeSigningConfigured, runnerMeetsMin, signRecipe, verifyRecipe,
  type RecipeBody, type RecipeStage, type SignedRecipe,
} from "./recipe";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

export interface Rollout {
  channel: string;
  currentVersion: string | null;
  candidateVersion: string | null;
  stage: RecipeStage;
  stageSince: string | null;
  rolledBackAt?: string | null;
  rollbackReason?: string | null;
}

const asStage = (v: unknown): RecipeStage => {
  const s = String(v ?? "canary");
  return (s in STAGE_ORDER ? s : "canary") as RecipeStage;
};

export async function getRollout(channel: string): Promise<Rollout | null> {
  const [r] = await q(sql`SELECT channel, current_version, candidate_version, stage, stage_since, rolled_back_at, rollback_reason
    FROM recipe_rollouts WHERE channel = ${channel} LIMIT 1`);
  if (!r) return null;
  return {
    channel: String(r.channel), currentVersion: r.current_version ? String(r.current_version) : null,
    candidateVersion: r.candidate_version ? String(r.candidate_version) : null,
    stage: asStage(r.stage),
    stageSince: r.stage_since ? new Date(r.stage_since as string).toISOString() : null,
    rolledBackAt: r.rolled_back_at ? new Date(r.rolled_back_at as string).toISOString() : null,
    rollbackReason: r.rollback_reason ? String(r.rollback_reason) : null,
  };
}

async function loadRecipe(version: string): Promise<SignedRecipe | null> {
  if (!isRecipeVersion(version)) return null;
  const [r] = await q(sql`SELECT body FROM recipes WHERE version = ${version} LIMIT 1`);
  const body = r?.body;
  return body && typeof body === "object" ? (body as SignedRecipe) : null;
}

/**
 * 표 등록 — 🔴 **서명해서 넣는다**. 서명 열쇠가 없으면 **거절**한다(서명 없는 표는 러너가 어차피 안 쓴다 ·
 *   그런데 DB 엔 남아 «올렸는데 왜 안 먹지»를 만든다).
 *   🔴 같은 version 재등록 금지 — 내용이 바뀐 같은 이름은 사고 복기를 불가능하게 만든다.
 */
export async function putRecipe(body: RecipeBody, note = ""): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  if (!isRecipeVersion(body.version)) return { ok: false, error: `version 이 «채널@날짜.연번» 꼴이 아니에요: ${body.version}` };
  if (!RECIPE_CHANNELS.includes(body.channel)) return { ok: false, error: `표를 내려 주는 채널이 아니에요: ${body.channel}` };
  if (!body.selectors || !Object.keys(body.selectors).length) return { ok: false, error: "selectors 가 비었어요 — 빈 표를 내려 주면 러너가 아무 데도 못 누릅니다." };
  if (!recipeSigningConfigured()) return { ok: false, error: "서명 열쇠(RECIPE_SIGN_KEY·RECIPE_PUBLIC_KEY)가 없어요 — 서명 없는 표는 러너가 쓰지 않습니다." };

  const signed = signRecipe(body);
  if (!signed || !verifyRecipe(signed)) return { ok: false, error: "서명을 만들었는데 우리 공개키로 검증이 안 돼요(열쇠 쌍이 안 맞습니다)." };

  const ins = await q(sql`INSERT INTO recipes (version, channel, min_runner, body, rollback_to, note)
    VALUES (${signed.version}, ${signed.channel}, ${signed.minRunner || "0.0.0"}, ${jsonb(signed as unknown as Record<string, unknown>)},
            ${signed.rollbackTo ?? null}, ${String(note).slice(0, 300)})
    ON CONFLICT (version) DO NOTHING RETURNING version`);
  if (!ins.length) return { ok: false, error: `«${signed.version}» 은 이미 있어요 — 같은 이름의 다른 표를 만들지 않습니다(새 연번을 쓰세요).` };

  /* 후보로 올린다 — 🔴 **0단계(카나리)부터** 시작한다. 급해도 0·1단계를 건너뛰지 않는다(설계 §8 ⚠️
     «급할수록 틀린 성공이 난다»). `all` 로 바로 못 간다. */
  await q(sql`INSERT INTO recipe_rollouts (channel, candidate_version, stage, stage_since, updated_at)
    VALUES (${signed.channel}, ${signed.version}, 'canary', NOW(), NOW())
    ON CONFLICT (channel) DO UPDATE SET candidate_version = EXCLUDED.candidate_version,
      stage = 'canary', stage_since = NOW(), rolled_back_at = NULL, rollback_reason = NULL, updated_at = NOW()`);
  await writeAudit({ tenantId: null, action: "recipe_put", actorType: "system", target: `recipe:${signed.version}`,
    detail: { channel: signed.channel, minRunner: signed.minRunner, selectors: Object.keys(signed.selectors).length, rollbackTo: signed.rollbackTo ?? null }, riskLevel: "medium" });
  return { ok: true, version: signed.version };
}

/* ─────────────────────────── 누가 어느 표를 받나 ─────────────────────────── */

export interface RecipeAudience {
  /** 카나리 드라이런인가(러너가 `--canary` 로 부를 때). */
  canary?: boolean;
  /** 우리 기기인가(`runner_devices.kind = 'managed'`). */
  managed?: boolean;
  /** 이 테넌트가 «먼저 받아 볼래요»를 켰나. */
  volunteer?: boolean;
}

/** 이 청중이 `stage` 단계의 후보를 받을 자격이 있나 — 🔴 **좁은 쪽이 먼저**다(퍼센트가 아니라 순서 · 설계 §4). */
export function audienceGetsCandidate(stage: RecipeStage, a: RecipeAudience): boolean {
  if (stage === "all") return true;
  if (stage === "volunteer") return !!a.volunteer || !!a.managed || !!a.canary;
  if (stage === "own") return !!a.managed || !!a.canary;
  return !!a.canary;   // canary 단계 = 우리 드라이런만
}

/**
 * 🔴 **정본** — 이 러너가 이 채널에 쓸 표.
 *   반환 `null` = «서버 표 없음» → 러너는 **묶여 온 표**로 일한다(정상 동작이지 실패가 아니다).
 */
export async function recipeForRunner(
  channel: string,
  runnerVersion: string,
  a: RecipeAudience = {},
): Promise<{ recipe: SignedRecipe; stage: RecipeStage; isCandidate: boolean } | null> {
  if (!RECIPE_CHANNELS.includes(channel)) return null;
  const ro = await getRollout(channel);
  if (!ro) return null;

  /* 후보를 받을 자격이 있으면 후보를, 아니면 현재 판을. 둘 다 없으면 null. */
  const wantCandidate = !!ro.candidateVersion && audienceGetsCandidate(ro.stage, a);
  const version = wantCandidate ? ro.candidateVersion! : ro.currentVersion;
  if (!version) return null;

  const recipe = await loadRecipe(version);
  if (!recipe) return null;
  /* 🔴 **내보내기 전에 우리 서명을 우리가 확인한다.** DB 왕복(jsonb)이 값을 건드렸다면 여기서 걸린다 —
     러너에서 처음 발견하면 «전 러너가 갑자기 폴백»이 되고 원인이 안 보인다. */
  if (!verifyRecipe(recipe)) {
    await writeAudit({ tenantId: null, action: "recipe_self_verify_failed", actorType: "system", target: `recipe:${version}`,
      detail: { channel, note: "서버가 만든 서명을 서버가 검증하지 못했다 — 저장 왕복에서 값이 바뀌었을 수 있다" }, riskLevel: "high" });
    return null;
  }
  if (!runnerMeetsMin(runnerVersion, recipe.minRunner)) return null;   // 옛 러너에겐 안 준다(새 표가 옛 실행기를 깨지 않게)
  return { recipe, stage: ro.stage, isCandidate: wantCandidate };
}

/* ─────────────────────────── 승격·복귀 ─────────────────────────── */

/** 이 채널의 자원자 수(0이면 그 단계를 건너뛰지 않고 앞 단계를 두 배로 잡는다 · 설계 §4 ⚠️). */
async function volunteerCount(): Promise<number> {
  const [r] = await q(sql`SELECT COUNT(*) c FROM tenants WHERE recipe_volunteer = true AND COALESCE(status,'') <> 'closed'`);
  return n(r?.c);
}

/**
 * 후보를 다음 단계로 넓힌다 — 🔴 **사람이 볼 때만**(시간 게이트 · 설계 §8).
 *   막는 이유를 **반환값으로** 준다(«왜 아직 대기 중인가»가 화면에 보여야 한다 · 설계 §9).
 */
export async function promoteCandidate(channel: string, now = new Date()): Promise<{ ok: boolean; why: string; stage?: RecipeStage }> {
  const ro = await getRollout(channel);
  if (!ro?.candidateVersion) return { ok: false, why: "시험 중인 표가 없어요" };

  const gate = canPromoteAt(now);
  if (!gate.ok) return { ok: false, why: gate.why };

  const volunteers = await volunteerCount();
  const need = minDwellHours(ro.stage, volunteers);
  const since = ro.stageSince ? Date.parse(ro.stageSince) : now.getTime();
  const heldH = (now.getTime() - since) / 3_600_000;
  if (heldH < need) return { ok: false, why: `이 단계에 ${need}시간은 둬야 해요(지금 ${heldH.toFixed(1)}시간${volunteers ? "" : " · 자원자 0명이라 두 배"})` };

  /* 🔴 카나리가 «한 건이라도 false» 면 안 넓힌다. `null`(판정 불가)만 있으면 **보류**다 — 승격도 롤백도 아니다. */
  const [c] = await q(sql`SELECT
      COUNT(*) FILTER (WHERE ok = false) AS bad,
      COUNT(*) FILTER (WHERE ok = true)  AS good
    FROM canary_runs WHERE channel = ${channel} AND recipe_version = ${ro.candidateVersion}`);
  if (n(c?.bad) > 0) return { ok: false, why: `카나리가 ${n(c?.bad)}건 실패했어요 — 넓히지 않습니다` };
  if (n(c?.good) === 0) return { ok: false, why: "아직 통과한 카나리가 한 건도 없어요(표본 0 · 판정하지 않습니다)" };

  const next = nextStage(ro.stage);
  if (!next) {
    /* `all` 에서 더 넓힐 곳이 없다 = **후보가 현재 판이 된다**. */
    await q(sql`UPDATE recipe_rollouts SET current_version = candidate_version, candidate_version = NULL,
      promoted_at = NOW(), updated_at = NOW() WHERE channel = ${channel}`);
    await writeAudit({ tenantId: null, action: "recipe_promoted_full", actorType: "system", target: `recipe:${ro.candidateVersion}`, detail: { channel }, riskLevel: "medium" });
    return { ok: true, why: "전체 배포 완료", stage: "all" };
  }
  await q(sql`UPDATE recipe_rollouts SET stage = ${next}, stage_since = NOW(), updated_at = NOW() WHERE channel = ${channel}`);
  await writeAudit({ tenantId: null, action: "recipe_promoted", actorType: "system", target: `recipe:${ro.candidateVersion}`, detail: { channel, from: ro.stage, to: next }, riskLevel: "medium" });
  return { ok: true, why: "", stage: next };
}

/**
 * 🔴 **자동 복귀** — 시간 제한 없음(좁히는 것은 언제나 · 설계 §6.1).
 *   기준 한 줄: **«되돌아갈 곳이 이미 돌던 판이면 자동, 새로 멈추거나 새로 퍼뜨리면 사람.»**
 */
export async function rollbackCandidate(channel: string, reason: string): Promise<boolean> {
  const ro = await getRollout(channel);
  if (!ro?.candidateVersion) return false;
  await q(sql`UPDATE recipe_rollouts SET candidate_version = NULL, stage = 'canary', stage_since = NOW(),
    rolled_back_at = NOW(), rollback_reason = ${String(reason).slice(0, 300)}, updated_at = NOW() WHERE channel = ${channel}`);
  await writeAudit({ tenantId: null, action: "recipe_rollback", actorType: "system", target: `recipe:${ro.candidateVersion}`,
    detail: { channel, reason: String(reason).slice(0, 200), backTo: ro.currentVersion }, riskLevel: "high" });
  return true;
}

/**
 * 후보가 실제 발행에서 깨지고 있나 — 🔴 **잡의 실패를 recipe 버전으로 되짚는다**(DDL 0051 `runner_jobs.recipe_version`).
 *   설계 §6: «연속 3건 실패» 또는 «서로 다른 3개 테넌트에서 실패» → 자동 복귀.
 *   🔴 **한 고객의 계정 문제와 가른다** — 테넌트 수를 같이 보는 이유가 그것이다.
 */
export async function candidateHarmSignal(channel: string): Promise<{ rollback: boolean; why: string; fails: number; tenants: number }> {
  const ro = await getRollout(channel);
  if (!ro?.candidateVersion) return { rollback: false, why: "", fails: 0, tenants: 0 };
  const [r] = await q(sql`SELECT COUNT(*) AS fails, COUNT(DISTINCT tenant_id) AS tenants
    FROM runner_jobs
   WHERE recipe_version = ${ro.candidateVersion}
     AND status = 'failed' AND error_kind = 'selector_changed'
     AND updated_at > NOW() - INTERVAL '24 hours'`);
  const fails = n(r?.fails); const tenants = n(r?.tenants);
  if (tenants >= 3) return { rollback: true, why: `서로 다른 ${tenants}개 집에서 셀렉터 실패 — 한 계정 문제가 아니에요`, fails, tenants };
  if (fails >= 3) return { rollback: true, why: `이 표로 ${fails}건 연속 셀렉터 실패`, fails, tenants };
  return { rollback: false, why: "", fails, tenants };
}
