/**
 * lib/video/cost.ts — 영상 원가 관문(계약 §1.4c[v5.5] · §1.6 개정).
 *   🔴 **새 캡을 만들지 않는다.** 원가 상한 정본은 R4 의 `lib/billing/ai-cost-cap.ts checkAiCostCap`
 *   (플랜별 **일일 KRW** 상한 `PLAN_CAP_KRW` · `ai_usage.cost_usd` 오늘(KST) 합 × `fxToKrw`).
 *   영상 원가도 전부 `ai_usage`(video_clip·tts·video_judge·video_script·video_factcheck·video_factfix)로 들어가므로
 *   **같은 함수가 이미 센다** — 여기서는 그 결과를 **영상용 두 단계**로 나누어 판정만 한다:
 *     소프트 = 일일 상한 초과        → 🔴 막지 않는다(고객은 이미 코인을 냈다) · 운영 알림 1건/일 · 감사 usedKrw/capKrw
 *     하드   = **이미 쓴 것**이 일일 상한 × 3 초과 → 차단(v5.6 · 예상치를 더하지 않는다 — 한 편은 언제나 통과 · 폭주는 다음 편부터) · 운영 알림 risk high
 *     전역   = 월 ₩1,400,000 초과    → 차단(전 테넌트) · 운영 알림 risk high. **이것만 새로 잰다.**
 *   🔴 환율이 없으면 **못 재는 것이므로 막지 않는다**(`fxMissing:true` 를 응답·감사에 · `ai-cost-cap.ts` 규칙 그대로).
 *   🔴 `FX_USD_KRW` 기본값을 코드에 박지 않는다(`lib/revenue/common.ts fxToKrw` 헤더 — 환율 출처는 그 함수 하나).
 *   kill switch = `feature_flags(key='video')`(운영센터 AI 메뉴) · 조회 실패(DB) = 차단(fail-closed · 돈 자원).
 *   AM 원본: ../AutoMarketing/lib/video-cost.ts (복사 2026-09-15 · 원본 a4fdc53e3 2026-07-12 · AM 의 자체 월 캡 표는 **버리고** AC 의 일일 KRW 상한에 얹었다 — 문을 둘로 만들지 않는다)
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index";
import { writeAudit } from "../audit";
import { checkAiCostCap, type CapCheck } from "../billing/ai-cost-cap";
import { fxToKrw } from "../revenue/common";
import { PROVIDERS, estimateClipCostUsd } from "./providers/registry";
import { TYPECAST_USD_PER_CHAR } from "./tts-typecast";
import type { ProviderKey, VideoFormat, VideoSeconds } from "./types";
import { cutCountFor, shortsFormOf } from "../writing-contracts";   // 🔴 컷 수·컷 길이의 정본(값 두 벌 금지)

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

/** 하드 = 플랜 일일 상한 × 이 배수(계약 §1.4c) — 폭주·남용 방어 한 곳. */
export const HARD_MULTIPLIER = Number(process.env.VIDEO_HARD_MULTIPLIER || "3");
/** 전역 월 상한(원) — 전 테넌트 합. 초과 = 전 테넌트 생성 정지 + 운영 알림 risk high. */
export const GLOBAL_MONTHLY_CAP_KRW = Number(process.env.VIDEO_GLOBAL_MONTHLY_CAP_KRW || "1400000");
/** 심사 비전 콜 1건 추정(포스터 1장 + 컷 프레임 몇 장). */
export const JUDGE_COST_USD = 0.05;
/** 정지 이미지 컷 1장(계약 §1.4c(2) · 조사 §F CHAIN_IMAGE). */
export const STILL_IMAGE_USD = 0.04;

/** estimateVideoCostUsd — 편 1개 추정 원가(컷 수 × provider 5초가 + 정지 이미지 + TTS + 심사 상수). 계약 §1.2 선검사 재료. */
export function estimateVideoCostUsd(format: VideoFormat, seconds: VideoSeconds, providerKey: ProviderKey, cuts?: number): number {
  const p = PROVIDERS[providerKey] ?? PROVIDERS.veo_lite;
  /* 🔴 **컷 수·컷 길이를 여기서 다시 적지 않는다** — 계약(`cutCountFor`·`shortsFormOf`)에 묻는다(2026-09-21 B).
     여태 이 줄은 `seconds === 60 ? 9 : seconds === 30 ? 5 : 3` 이었고 **90 이 없어서 3컷**으로 떨어졌다.
     그래서 90초 추정 원가가 60초보다 **싸게** 나왔고(₩1,863 < ₩4,579), 그 값을 `checkAiCostCap`·하드캡이
     그대로 믿었다 — **표시가 아니라 돈 관문이 틀린 것**이라 고객이 알려 줄 수 없다.
     🔴 60·30초는 **한 숫자도 안 바뀐다**(계약 값이 옛 상수와 같다 · `scripts/verify-video-cost-cuts.mjs` 가 잰다).
        바뀌는 것은 90(3→13) · 15(3→5) · 토킹(초÷5)이고, 전부 **실제로 만들 컷 수 쪽**이다. */
  const form = shortsFormOf(format, seconds);
  const n = cutCountFor(format, seconds, cuts);
  const clipSec = Math.min(form.cutSec.max, Math.max(form.cutSec.min, Math.round(seconds / n)));
  // 토킹은 **B-roll 3~4 + 나머지 정지 이미지**(계약 §1.3 표 · `scenes.ts buildCutPlans` 의 brollAt 과 같은 규칙).
  const clipCount = format === "talking" ? Math.max(1, Math.min(4, Math.min(n, n <= 4 ? Math.ceil(n / 2) : n >= 10 ? 4 : 3))) : n;
  const stillCount = n - clipCount;                                        // 나머지는 CHAIN_IMAGE 한 장씩(§1.4c(2))
  const clips = clipCount * (p.gateway === "omni" ? clipSec * 0.10 : estimateClipCostUsd(p, clipSec));
  const stills = stillCount * STILL_IMAGE_USD;
  const tts = Math.round(seconds * 4.6) * TYPECAST_USD_PER_CHAR;
  return Math.round((clips + stills + tts + JUDGE_COST_USD + 0.05) * 1000) / 1000;
}

export interface VideoBudgetResult {
  allowed: boolean;
  reason?: "killed" | "hard_cap" | "global_cap" | "lookup_failed";
  /** 소프트(일일 상한) 초과 — 🔴 `allowed` 와 무관하다(막지 않는다 · 운영 알림만). */
  soft: boolean;
  /** 오늘(KST) 이 테넌트 AI 원가(원) · null = 환율이 없어 못 잼. */
  usedKrw: number | null;
  /** 이번 편 추정 원가(원) · 환율 없으면 0. */
  addKrw: number;
  capKrw: number;
  hardKrw: number;
  /** 이번 달(KST) 전 테넌트 AI 원가(원) · null = 못 잼. */
  globalKrw: number | null;
  globalCapKrw: number;
  fxMissing: boolean;
  usedUsd: number;
}

export async function videoKillSwitchActive(tenantId: number): Promise<boolean> {
  try {
    const rows = await q(sql`SELECT enabled FROM feature_flags WHERE key = 'video' AND (tenant_id = ${tenantId} OR tenant_id IS NULL)`);
    return rows.some((r) => r.enabled === false);
  } catch { return false; }
}

/** 이번 달(KST) 전역 AI 원가(원). 환율 없으면 null(= 못 잼 → 막지 않는다). */
async function globalMonthKrw(): Promise<{ krw: number | null; usd: number }> {
  const [r] = await q(sql`SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM ai_usage
    WHERE created_at >= (date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`);
  const usd = Number(r?.usd || 0);
  const fx = fxToKrw(usd, "USD", {});
  return { krw: fx ? fx.krw : null, usd };
}

/**
 * checkVideoBudget — kill switch → 일일 상한(소프트/하드) → 전역 월 상한. `addUsd` = 이번 편 추정 원가.
 *   🔴 소프트 초과는 `allowed:true` 로 돌아온다 — 판정과 알림을 섞지 않는다(알림은 `recordVideoBudget`).
 */
export async function checkVideoBudget(tenantId: number, addUsd = 0): Promise<VideoBudgetResult> {
  const base: VideoBudgetResult = {
    allowed: true, soft: false, usedKrw: null, addKrw: 0, capKrw: 0, hardKrw: 0,
    globalKrw: null, globalCapKrw: GLOBAL_MONTHLY_CAP_KRW, fxMissing: false, usedUsd: 0,
  };
  if (await videoKillSwitchActive(tenantId)) return { ...base, allowed: false, reason: "killed" };
  try {
    const cap: CapCheck = await checkAiCostCap(tenantId);
    base.capKrw = cap.capKrw;
    base.hardKrw = Math.round(cap.capKrw * HARD_MULTIPLIER);
    base.usedUsd = cap.usedUsd;
    base.fxMissing = cap.fxMissing;
    if (cap.fxMissing) return base;                                        // 못 잰다 → 막지 않는다(0 으로 접지도 않는다)
    const add = fxToKrw(Math.max(0, addUsd), "USD", {});
    base.addKrw = add ? add.krw : 0;
    base.usedKrw = cap.usedKrw ?? 0;
    const projected = base.usedKrw + base.addKrw;
    // 소프트는 **예상치까지** 본다 — 막지 않으니 일찍 알릴수록 좋다.
    base.soft = base.capKrw > 0 && projected > base.capKrw;
    const g = await globalMonthKrw();
    base.globalKrw = g.krw;
    /* 🔴 [v5.6] 하드는 **이미 쓴 것**만 본다(`addKrw` 를 더하지 않는다).
       이유: 하드는 «버그 루프·남용» 방어지 편당 원가 심사가 아니다. 예상치를 더하면 trial 이 60초 1편도 못 만든다 —
       C 라이브 실측: graphic/60s/omni/9컷 = ₩8,989 인데 trial 하드는 3,000×3 = ₩9,000(여유 ₩11).
       그날 LLM 으로 ₩697만 써도 «돈 받고 안 만들어 주는» 사고가 다시 난다.
       `used` 기준이면 **한 편은 언제나 통과**하고 폭주는 다음 편부터 즉시 막힌다. 초과분은 1편치(≤₩9,000)로 유한하고,
       그 1편도 고객이 28코인(₩14,000)을 낸 것이라 편당 흑자다. */
    if (base.capKrw > 0 && base.usedKrw > base.hardKrw) return { ...base, allowed: false, reason: "hard_cap" };
    if (g.krw !== null && GLOBAL_MONTHLY_CAP_KRW > 0 && g.krw > GLOBAL_MONTHLY_CAP_KRW) return { ...base, allowed: false, reason: "global_cap" };
    return base;
  } catch (e) {
    console.error("[video/cost] checkVideoBudget 실패(fail-closed):", e);
    return { ...base, allowed: false, reason: "lookup_failed" };
  }
}

/**
 * 🔴 체인 끝 **원가 확정**(2026-09-15 · AC-36). 영상 한 편이 끝날 때 딱 한 번, 빠진 원가를 `ai_usage` 에 **await 로** 채운다.
 *   왜: 컷·정지컷 원가는 `void recordAiUsage(...)` 로 기록된다(생성 한복판이라 그게 맞다) — 그런데 서버리스가 그 사이에 끊기면 행이 샌다.
 *   그 값을 **하드 상한이 읽는다**(`checkVideoBudget` → `checkAiCostCap` → ai_usage 합) — 새면 «버그 루프·남용» 방어가 헐거워진다.
 *   그래서 지워지지 않는 정본(`piece_assets.meta.costUsd` · 이건 await 로 쓴다)과 대조해 **모자란 만큼만** 한 행으로 확정한다.
 *   멱등: 두 번 불러도 두 번째는 차액이 0 이라 아무것도 안 쓴다(자기 교정). TTS·판정 원가는 자산 행이 없어 대상이 아니다(§보고 B-4).
 *   ⚠️ 자정(KST)을 걸쳐 끝나면 확정분은 «끝난 날»에 잡힌다 — 상한은 하루 단위라 한 편 분량은 유한하다.
 */
export async function reconcilePieceCost(tenantId: number, pieceId: number): Promise<{ addedUsd: number }> {
  try {
    // ⚠️ jsonb `?` 연산자는 쓰지 않는다(드라이버·풀러에서 물음표가 파라미터로 오해돼 연결이 끊긴 실측 2026-09-15) — `->>` 로만.
    //    값이 숫자가 아닌 행은 0 으로 접는다(자산 meta 는 사람이 손댈 수 있는 자리가 아니지만, 합계가 예외로 죽으면 안 된다).
    const [a] = await q(sql`SELECT COALESCE(SUM(CASE WHEN meta->>'costUsd' ~ '^[0-9]+(\.[0-9]+)?$' THEN (meta->>'costUsd')::numeric ELSE 0 END), 0) AS usd
      FROM piece_assets WHERE tenant_id = ${tenantId} AND piece_id = ${pieceId} AND kind IN ('clip', 'image')`);
    const [u] = await q(sql`SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM ai_usage
      WHERE tenant_id = ${tenantId} AND ref LIKE ${`piece:${pieceId}:%`} AND purpose IN ('video_clip', 'image')`);
    const [r] = await q(sql`SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM ai_usage
      WHERE tenant_id = ${tenantId} AND ref = ${`video_reconcile:${pieceId}`}`);
    const assets = Number(a?.usd ?? 0), used = Number(u?.usd ?? 0) + Number(r?.usd ?? 0);
    const delta = Math.round((assets - used) * 1e6) / 1e6;
    if (!(delta > 0.0005)) return { addedUsd: 0 };   // 다 들어와 있다(정상 경로) — 아무것도 안 쓴다
    const { recordAiUsage } = await import("../ai");
    await recordAiUsage({ tenantId, purpose: "video_reconcile", model: "reconcile", inTokens: 0, outTokens: 0, costUsd: delta, ref: `video_reconcile:${pieceId}` });
    console.warn(`[video/cost] piece ${pieceId} 원가 확정 +$${delta.toFixed(4)}(유실분 보정 · 자산 $${assets.toFixed(4)} vs 기록 $${used.toFixed(4)})`);
    await writeAudit({ tenantId, action: "ai_usage_reconciled", actorType: "system", riskLevel: "low", target: `piece:${pieceId}`, detail: { addedUsd: delta, assetsUsd: assets, recordedUsd: used } });
    return { addedUsd: delta };
  } catch (e) { console.warn("[video/cost] 원가 확정 실패(비치명)", String((e as Error)?.message ?? e).slice(0, 120)); return { addedUsd: 0 }; }
}

/** 고객에게 보일 한 문장(하드·전역·킬스위치·조회실패만 — 소프트는 고객에게 보이지 않는다). */
export function videoBudgetMessage(r: VideoBudgetResult): string {
  switch (r.reason) {
    case "killed": return "영상 만들기가 잠시 중지돼 있어요. 잠시 후 다시 해 주세요.";
    case "hard_cap": return "오늘은 여기까지예요. 내일 이어서 만들어 드려요.";
    case "global_cap": return "지금은 영상 제작이 몰려 있어요. 잠시 후 다시 해 주세요.";
    case "lookup_failed": return "영상 제작 한도를 확인하지 못해 잠시 보류했어요. 잠시 후 다시 해 주세요.";
    default: return "영상 만들기가 보류됐어요.";
  }
}

/** 오늘(KST) 같은 action 감사가 이미 있나 — 운영 알림 1건/일. */
async function auditedTodayKst(tenantId: number | null, action: string): Promise<boolean> {
  try {
    const [d] = await q(sql`SELECT 1 AS x FROM audit_logs WHERE action = ${action}
      AND ${tenantId === null ? sql`tenant_id IS NULL` : sql`tenant_id = ${tenantId}`}
      AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date = (NOW() AT TIME ZONE 'Asia/Seoul')::date LIMIT 1`);
    return !!d;
  } catch { return false; }
}

/**
 * recordVideoBudget — 판정 결과를 운영에 남긴다(고객 알림은 호출부 `failPiece` 몫 · 조용한 0건 금지).
 *   소프트 = `ai_cost_soft`(1건/일 · 고객 무영향) · 하드/전역 = risk high(매번).
 *   ⚠️ `RiskLevel` 에 «normal» 이 없어 소프트는 **medium**(기본 low 보다 위 · high 미만)으로 남긴다.
 */
export async function recordVideoBudget(tenantId: number, r: VideoBudgetResult, ctx: Record<string, unknown> = {}): Promise<void> {
  const detail = { usedKrw: r.usedKrw, capKrw: r.capKrw, hardKrw: r.hardKrw, addKrw: r.addKrw, usedUsd: r.usedUsd, globalKrw: r.globalKrw, globalCapKrw: r.globalCapKrw, fxMissing: r.fxMissing, ...ctx };
  if (r.reason === "hard_cap") { await writeAudit({ tenantId, action: "video_cost_hard_cap", actorType: "system", riskLevel: "high", detail }); return; }
  if (r.reason === "global_cap") { await writeAudit({ tenantId, action: "video_cost_global_cap", actorType: "system", riskLevel: "high", detail }); return; }
  if (r.reason === "killed" || r.reason === "lookup_failed") { await writeAudit({ tenantId, action: `video_cost_${r.reason}`, actorType: "system", riskLevel: "medium", detail }); return; }
  if (r.soft && !(await auditedTodayKst(tenantId, "ai_cost_soft"))) {
    await writeAudit({ tenantId, action: "ai_cost_soft", actorType: "system", riskLevel: "medium", detail: { ...detail, note: "일일 상한 초과 — 막지 않음(코인 지불분)" } });
  }
  if (r.fxMissing && !(await auditedTodayKst(tenantId, "video_cost_fx_missing"))) {
    await writeAudit({ tenantId, action: "video_cost_fx_missing", actorType: "system", riskLevel: "medium", detail });
  }
}
