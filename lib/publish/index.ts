/**
 * lib/publish/index.ts — 발행 진입점(계약 §3·§10). B 의 크론 publisher 는 이 파일의 publish() 하나만 부른다.
 *   ⚠️ B2-1 단계: 시그니처·라우팅 확정본. 커넥터 본체(blogger·wordpress·러너 적재·게이트)는 B2-3 에서 채운다.
 */
import type { PublishPiece, PublishAccount, PublishOpts, PublishResult } from "./contract";
import { publishViaOf } from "./contract";

export * from "./contract";
export { finalizePublish } from "./finalize";

/** 🔴 정본. piece 한 편을 채널에 맞게 발행한다(API 채널=직접 · 러너 채널=잡 적재). */
export async function publish(piece: PublishPiece, account: PublishAccount | null, opts: PublishOpts = {}): Promise<PublishResult> {
  const via = publishViaOf(piece.channel);
  if (!via) return { ok: false, reason: "unsupported_channel", retriable: false, error: "아직 이 채널로는 발행할 수 없어요.", detail: piece.channel };
  void account; void opts;
  return { ok: false, reason: "config", retriable: false, error: "발행 준비 중이에요.", detail: "publish() not implemented yet (B2-3)" };
}

/** 편의 진입점 — pieces·piece_assets·accounts 로드까지 B2 가 한다. B 는 id 만 주면 된다. */
export async function publishPieceById(tenantId: number, pieceId: number, opts: PublishOpts = {}): Promise<PublishResult> {
  void tenantId; void pieceId; void opts;
  return { ok: false, reason: "config", retriable: false, error: "발행 준비 중이에요.", detail: "publishPieceById() not implemented yet (B2-3)" };
}
