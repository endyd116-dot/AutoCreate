/**
 * lib/video/cost.ts — 영상 달러 캡(계약 §1.6 · §0.1-8): 테넌트 월 $30 · 전역 월 $300 · kill switch(feature_flags key 'video') · fail-closed.
 *   AM 원본: ../AutoMarketing/lib/video-cost.ts (복사 2026-09-15 · 원본 a4fdc53e3 2026-07-12 · 합계 원천을 video_assets.cost_usd → AC ai_usage(purpose video_clip|tts|video_judge) 로 · kill switch 를 ai_feature_settings → feature_flags 로)
 *   🔴 코인 선차감(piece 당 1회)과 **별개의 두 번째 관문** — 코인은 고객 몫, 달러 캡은 우리 원가 보호. 조회 실패 = 차단(돈 자원).
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index";
import { PROVIDERS, estimateClipCostUsd } from "./providers/registry";
import { TYPECAST_USD_PER_CHAR } from "./tts-typecast";
import type { ProviderKey, VideoFormat, VideoSeconds } from "./types";

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

export const TENANT_CAP_USD = Number(process.env.VIDEO_TENANT_MONTHLY_CAP_USD || "30");
export const GLOBAL_CAP_USD = Number(process.env.VIDEO_GLOBAL_MONTHLY_CAP_USD || "300");
/** 심사 비전 콜 1건 추정(포스터 1장 + 컷 프레임 몇 장). */
export const JUDGE_COST_USD = 0.05;

/** estimateVideoCostUsd — 편 1개 추정 원가(컷 수 × provider 5초가 + TTS + 심사 상수). 계약 §1.2 선검사 재료. */
export function estimateVideoCostUsd(format: VideoFormat, seconds: VideoSeconds, providerKey: ProviderKey, cuts?: number): number {
  const p = PROVIDERS[providerKey] ?? PROVIDERS.veo_lite;
  const n = cuts ?? (seconds === 60 ? 9 : seconds === 30 ? 5 : 3);
  const clipSec = Math.min(8, Math.max(4, Math.round(seconds / n)));
  const clipCount = format === "talking" ? Math.ceil(n / 2) : n;   // 토킹은 절반이 정지 이미지
  const clips = clipCount * (p.gateway === "omni" ? clipSec * 0.10 : estimateClipCostUsd(p, clipSec));
  const tts = Math.round(seconds * 4.6) * TYPECAST_USD_PER_CHAR;
  return Math.round((clips + tts + JUDGE_COST_USD + 0.05) * 1000) / 1000;
}

export interface VideoBudgetResult { allowed: boolean; reason?: "killed" | "tenant_cap" | "global_cap" | "lookup_failed"; tenantUsed: number; globalUsed: number; tenantCap: number; globalCap: number }

export async function videoKillSwitchActive(tenantId: number): Promise<boolean> {
  try {
    const rows = await q(sql`SELECT enabled FROM feature_flags WHERE key = 'video' AND (tenant_id = ${tenantId} OR tenant_id IS NULL)`);
    return rows.some((r) => r.enabled === false);
  } catch { return false; }
}

/** checkVideoBudget — kill switch + 2층 월 상한(KST 월 · addUsd 반영). 조회 실패 = 차단. */
export async function checkVideoBudget(tenantId: number, addUsd = 0): Promise<VideoBudgetResult> {
  const base: VideoBudgetResult = { allowed: true, tenantUsed: 0, globalUsed: 0, tenantCap: TENANT_CAP_USD, globalCap: GLOBAL_CAP_USD };
  if (await videoKillSwitchActive(tenantId)) return { ...base, allowed: false, reason: "killed" };
  try {
    const [r] = await q(sql`SELECT
        COALESCE(SUM(CASE WHEN tenant_id = ${tenantId} THEN cost_usd ELSE 0 END), 0) AS tenant_used,
        COALESCE(SUM(cost_usd), 0) AS global_used
      FROM ai_usage WHERE purpose IN ('video_clip','tts','video_judge')
        AND created_at >= (date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`);
    base.tenantUsed = Number(r?.tenant_used ?? 0); base.globalUsed = Number(r?.global_used ?? 0);
    if (TENANT_CAP_USD > 0 && base.tenantUsed + addUsd > TENANT_CAP_USD) return { ...base, allowed: false, reason: "tenant_cap" };
    if (GLOBAL_CAP_USD > 0 && base.globalUsed + addUsd > GLOBAL_CAP_USD) return { ...base, allowed: false, reason: "global_cap" };
    return base;
  } catch (e) { console.error("[video/cost] checkVideoBudget 실패(fail-closed):", e); return { ...base, allowed: false, reason: "lookup_failed" }; }
}
export function videoBudgetMessage(r: VideoBudgetResult): string {
  switch (r.reason) {
    case "killed": return "영상 만들기가 잠시 중지돼 있어요. 잠시 후 다시 해 주세요.";
    case "tenant_cap": return "이번 달 영상 제작 한도에 닿았어요. 다음 달에 다시 만들 수 있어요.";
    case "global_cap": return "지금은 영상 제작이 몰려 있어요. 잠시 후 다시 해 주세요.";
    case "lookup_failed": return "영상 제작 한도를 확인하지 못해 잠시 보류했어요. 잠시 후 다시 해 주세요.";
    default: return "영상 만들기가 보류됐어요.";
  }
}
