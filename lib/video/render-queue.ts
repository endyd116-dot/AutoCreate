/**
 * lib/video/render-queue.ts — 🔴 **자리 표시(B-1 브랜치 전용)**. 본체는 B2(`feature/p1r5-back2` 6e4f645 · 멱등 enqueue · R2 HEAD · 재적재 상한 2).
 *   머지 시 **B2 것을 택한다**(이 파일은 통째로 덮어써진다). 시그니처는 계약 §5 · `lib/video/types.ts` 정본과 글자 그대로.
 *   B(gen.ts)는 `enqueueRender` 만 import 한다 · `finalizeRender` 는 B2 가 `judgeVideo`(lib/video/judge.ts · B 소유)를 부른다.
 */
import type { RenderPayload, RenderReport } from "./types";

export async function enqueueRender(pieceId: number, payload: RenderPayload): Promise<{ jobId: number; created: boolean }> {
  void pieceId; void payload;
  throw new Error("render-queue 본체(B2) 미머지 — feature/p1r5-back2 와 머지 후 동작");
}
export async function finalizeRender(pieceId: number, report: RenderReport): Promise<{ ok: boolean; next: "judging" | "requeued" | "in_review" | "failed"; retry: number; reason?: string }> {
  void pieceId; void report;
  throw new Error("render-queue 본체(B2) 미머지 — feature/p1r5-back2 와 머지 후 동작");
}
