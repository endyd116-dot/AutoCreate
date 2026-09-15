/**
 * lib/topics-refresh-state.ts — 소재 뽑기 **배경 실행 상태** 정본(계약 v2.9 §6D · CLAUDE §4.5b).
 *   «동기 한도(≈26초) 넘을 것 같으면 재지 말고 처음부터 배경으로» — 소재 뽑기는 LLM 1콜 + 검색량 조회라 무겁다.
 *
 *   상태는 `tenants.settings.topicsRefresh` 한 칸(jsonb)에 산다. 새 표를 만들지 않은 이유:
 *     테넌트당 항상 1건이고, 화면은 `topics-list` 를 어차피 부른다 — 조인 0으로 같이 실어 보내는 게 싸다.
 *   쓰기는 `mergeSettings` 한 경로(jsonb 를 쓰는 손이 둘이 되지 않게 · PITFALLS #1).
 *
 *   🔴 **고아 방지**: 배경 함수가 죽어도 «만드는 중»이 영원히 남으면 버튼이 다시 안 눌린다.
 *      `startedAt` 이 `STALE_MIN` 분을 넘으면 **running=false 로 본다**(저장값을 고치지 않고 «읽을 때» 판정 —
 *      되살아난 배경 함수가 나중에 결과를 써도 그대로 반영된다).
 *   🔴 `error` 는 **사람말 한 문장**만 담는다. 화면이 그 문장을 그대로 띄운다 — 「fetch failed」 같은 건 넣지 않는다.
 *   🔎 출처: AC 신규(계약 P1R2-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";

/** 이만큼 지나면 «죽은 것»으로 본다(화면도 같은 값으로 스스로 멈춘다). */
export const STALE_MIN = 10;

export interface TopicsRefreshState {
  running: boolean;
  startedAt?: string;
  finishedAt?: string;
  added?: number;
  error?: string;
}

/** 저장된 원시값 → 화면이 쓰는 모양. 고아(10분 초과)는 여기서 running=false 로 접는다. */
export function toRefreshState(raw: unknown): TopicsRefreshState {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const startedAt = typeof r.startedAt === "string" ? r.startedAt : undefined;
  let running = r.running === true;
  if (running && startedAt) {
    const t = Date.parse(startedAt);
    if (!Number.isFinite(t) || Date.now() - t > STALE_MIN * 60_000) running = false;   // 고아
  } else if (running && !startedAt) running = false;
  const out: TopicsRefreshState = { running };
  if (startedAt) out.startedAt = startedAt;
  if (typeof r.finishedAt === "string") out.finishedAt = r.finishedAt;
  if (Number.isFinite(Number(r.added)) && r.added !== null && r.added !== undefined) out.added = Number(r.added);
  if (typeof r.error === "string" && r.error.trim()) out.error = r.error.slice(0, 300);
  return out;
}

/** 지금 이 테넌트의 상태(고아 판정 적용). */
export async function readRefreshState(tid: number): Promise<TopicsRefreshState> {
  try {
    const [t] = await q(sql`SELECT settings->'topicsRefresh' AS s FROM tenants WHERE id = ${tid}`);
    return toRefreshState(t?.s);
  } catch { return { running: false }; }
}

/** AI 실패 사유 → 사람말 한 문장(화면이 그대로 띄운다). */
export function humanRefreshError(e: unknown): string {
  const step = (e as { step?: string })?.step;
  const msg = String((e as Error)?.message ?? e);
  if (step === "ai") return "소재를 뽑지 못했어요. 잠시 뒤 다시 해 주세요.";
  if (/fetch|ENOTFOUND|ECONNRESET|network|timeout/i.test(msg)) return "네트워크가 불안정해서 소재를 못 가져왔어요. 잠시 뒤 다시 해 주세요.";
  return "소재를 뽑는 중에 문제가 생겼어요. 잠시 뒤 다시 해 주세요.";
}
