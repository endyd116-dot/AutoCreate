/**
 * lib/publish/finalize.ts — «발행이 끝났다»를 기록하는 단 하나의 자리(계약 §10).
 *   posts 행 · piece(published·published_at·external_url·channel_ref) · slot(published) · accounts(posts_today++·last_post_at) · 알림 1행.
 *   ⚠️ B2-1 단계: 시그니처 확정본. 본체는 B2-3.
 */
import type { FinalizeInput, FinalizeResult } from "./contract";

/** 🔴 정본. 멱등 — 이미 external_url/channel_ref 가 있으면 아무것도 바꾸지 않고 already:true. */
export async function finalizePublish(pieceId: number, input: FinalizeInput): Promise<FinalizeResult> {
  void pieceId; void input;
  return { ok: false, reason: "db", error: "발행 기록을 저장하지 못했어요.", detail: "finalizePublish() not implemented yet (B2-3)" };
}
