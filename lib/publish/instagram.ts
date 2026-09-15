/**
 * lib/publish/instagram.ts — 인스타그램 **릴스** 발행(계약 P1R5 §2.3).
 *   AC 신규 2026-09-14(B2). 이식 관례: ../AutoMarketing/lib/publish-instagram.ts(컨테이너 → 폴링 → 게시 3단계).
 *
 *   규격(그래프 API): 3단계다. 한 번에 안 올라간다.
 *     ① POST /{ig-user-id}/media  { media_type:"REELS", video_url, caption }      → creation_id
 *     ② GET  /{creation_id}?fields=status_code                                    → FINISHED | IN_PROGRESS | ERROR
 *     ③ POST /{ig-user-id}/media_publish { creation_id }                          → 게시된 미디어 id
 *
 *   🔴 **중복 게시가 가장 무서운 사고**다(같은 영상이 두 번 올라가면 되돌릴 수 없다).
 *      그래서 ①에서 받은 `creation_id` 를 **piece.meta 에 남긴다**. 처리 중이라 다음 틱에 다시 와도
 *      컨테이너를 **새로 만들지 않고** 남은 것을 이어서 ②③만 한다.
 *   🔴 `video_url` 은 메타 서버가 **직접 내려받는다** — 우리 서버를 거치지 않는다. 그래서 공개적으로 접근 가능한
 *      주소가 필요하다(R2 공개 도메인 또는 우리 서빙 함수). presigned 는 만료가 짧아 쓰지 않는다.
 *   🔴 캡션 **첫 줄**이 고지(§16B).
 *
 *   이 파일은 **게시만** 한다 — posts 행·piece 상태는 `finalizePublish` 한 곳(§5 경계).
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../db-util";
import { ensureFreshToken } from "./tokens";
import { r2PublicUrl } from "../r2";
import { disclosureTextFor } from "../disclosure";
import type { PublishPiece, PublishAccount, PublishResult } from "./contract";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

const GRAPH = "https://graph.facebook.com/v21.0";
const TIMEOUT_MS = 30_000;
/** 컨테이너가 익을 때까지 이 정도만 기다린다 — 더 길면 함수가 벽에 부딪힌다. 안 되면 «다음 틱에». */
const POLL_TRIES = 3;
const POLL_WAIT_MS = 4_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graph(url: string, init?: RequestInit): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    let json: Record<string, unknown> | null = null;
    try { json = await r.json() as Record<string, unknown>; } catch { /* 본문 없음 */ }
    return { status: r.status, json };
  } finally { clearTimeout(t); }
}

/** 영상 자산(렌더 결과) → 메타가 내려받을 수 있는 **공개 주소**. */
export async function videoPublicUrlOf(tid: number, pieceId: number): Promise<string | null> {
  const [a] = await q(sql`SELECT r2_key FROM piece_assets
    WHERE tenant_id = ${tid} AND piece_id = ${pieceId} AND kind = 'video' ORDER BY id DESC LIMIT 1`);
  const key = String(a?.r2_key ?? "").trim();
  return key ? r2PublicUrl(key) : null;
}

/**
 * 채널별 태그 상한 — 🔴 **플랫폼이 실제로 받는 수**다(R8-A 정책 조사 §122).
 *   쓰레드는 «해시태그»가 아니라 **토픽 태그**이고 공식 상한이 **게시물당 1개**다
 *   («You can include up to 1 topic per post» · https://help.instagram.com/1356090605000312).
 *   🔴 [2026-09-15 C · R8-A §2.6 실측] 계약 문장(`writing-contracts.ts:244`)은 «토픽 태그 0~1개» 로 고쳐졌는데
 *      **발행 경로는 안 따라왔다** — 쓰레드가 인스타와 같은 캡션 빌더를 쓰는 바람에 태그 10개가 그대로 실렸다
 *      (실측: threads 캡션에 `#가을이불 #세탁 … #정보` 10개). 계약만 고치면 생성도 발행도 안 따라온다(AC-63).
 */
const TAG_MAX: Readonly<Record<string, number>> = { threads: 1 };
const TAG_MAX_DEFAULT = 20;

/** 캡션 — 첫 줄 고지 + 본문 + 태그(#광고 포함). 태그 수는 **채널 상한**을 따른다. */
export function buildCaption(piece: PublishPiece, limit = 2_200): string {
  const lines: string[] = [];
  const disc = piece.disclosure ?? (piece.affiliate ? disclosureTextFor(piece.affiliate.provider) : null);
  if (disc) lines.push(disc);
  const body = String(piece.bodyHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (body) lines.push(body.slice(0, 1_500));
  const max = TAG_MAX[String(piece.channel ?? "")] ?? TAG_MAX_DEFAULT;
  const tags = (piece.tags ?? []).slice(0, TAG_MAX_DEFAULT).map((t) => `#${String(t).replace(/^#/, "")}`);
  /* 🔴 `#광고` 는 맨 앞이다 — 상한이 1인 채널에서는 **이것 하나만** 남는다(태그 자리를 법이 먼저 쓴다).
     쓰레드는 대가 고지 문장이 이미 본문 첫 줄에 있으므로 이 태그는 보조 표시다. */
  if (piece.affiliate && !tags.some((t) => t === "#광고")) tags.unshift("#광고");
  const shown = tags.slice(0, max);
  if (shown.length) lines.push(shown.join(" "));
  return lines.join("\n\n").slice(0, limit);
}

/** 기억해 둔 컨테이너 id(중복 게시 방지). */
async function savedCreationId(tid: number, pieceId: number, field: string): Promise<string> {
  const [p] = await q(sql`SELECT meta FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId} LIMIT 1`);
  const meta = (p?.meta && typeof p.meta === "object" ? p.meta : {}) as Record<string, unknown>;
  return String(meta[field] ?? "").trim();
}
async function saveCreationId(tid: number, pieceId: number, field: string, id: string): Promise<void> {
  await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ [field]: id })}, updated_at = NOW()
    WHERE tenant_id = ${tid} AND id = ${pieceId}`);
}
async function clearCreationId(tid: number, pieceId: number, field: string): Promise<void> {
  await q(sql`UPDATE pieces SET meta = meta - ${field}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${pieceId}`);
}

function metaError(status: number, json: Record<string, unknown> | null): { reason: "auth_failed" | "channel_error" | "config"; retriable: boolean; error: string; detail: string } {
  const e = (json?.error ?? {}) as { message?: string; code?: number; error_subcode?: number };
  const msg = String(e?.message ?? "").slice(0, 200);
  const code = Number(e?.code ?? 0);
  if (status === 401 || code === 190) return { reason: "auth_failed", retriable: false, error: "인스타그램 로그인이 만료됐어요. 계정을 다시 연결해 주세요.", detail: msg };
  if (code === 4 || code === 17 || code === 32 || status === 429) return { reason: "channel_error", retriable: true, error: "인스타그램 요청 한도에 걸렸어요. 잠시 후 다시 올릴게요.", detail: msg };
  if (status >= 500) return { reason: "channel_error", retriable: true, error: "인스타그램이 지금 응답하지 않아요. 잠시 후 다시 시도할게요.", detail: `${status} ${msg}` };
  return { reason: "config", retriable: false, error: "인스타그램이 이 영상을 받지 않았어요.", detail: `${status} ${code} ${msg}` };
}

export async function publishReels(piece: PublishPiece, account: PublishAccount): Promise<PublishResult> {
  const tid = piece.tenantId;
  const META_FIELD = "igCreationId";

  const tok = await ensureFreshToken(tid, account.id, "reels", account.handle);
  if (!tok.ok) {
    if (tok.reason === "provider_not_configured") return { ok: false, reason: "provider_not_configured", retriable: false, error: "인스타그램 연결이 아직 준비 중이에요." };
    if (tok.reason === "no_creds") return { ok: false, reason: "no_creds", retriable: false, error: "인스타그램 계정을 다시 연결해 주세요." };
    return { ok: false, reason: "auth_failed", retriable: false, error: "인스타그램 로그인이 만료됐어요. 다시 연결해 주세요.", detail: tok.detail };
  }
  const token = tok.token.accessToken;
  const igUserId = String((tok.token.extra as Record<string, unknown> | undefined)?.igUserId ?? tok.token.externalId ?? "").trim();
  if (!igUserId) return { ok: false, reason: "no_creds", retriable: false, error: "인스타그램 계정을 찾지 못했어요. 다시 연결해 주세요." };

  /* ① 컨테이너 — **이미 만들어 둔 게 있으면 그것을 쓴다**(중복 게시 0). */
  let creationId = await savedCreationId(tid, piece.id, META_FIELD);
  if (!creationId) {
    const videoUrl = await videoPublicUrlOf(tid, piece.id);
    if (!videoUrl) return { ok: false, reason: "not_publishable", retriable: false, error: "올릴 영상이 아직 없어요(렌더가 끝나지 않았어요)." };
    const body = new URLSearchParams({ media_type: "REELS", video_url: videoUrl, caption: buildCaption(piece), access_token: token });
    const r = await graph(`${GRAPH}/${encodeURIComponent(igUserId)}/media`, { method: "POST", body }).catch(() => null);
    if (!r) return { ok: false, reason: "network", retriable: true, error: "인스타그램에 연결하지 못했어요. 잠시 후 다시 시도할게요." };
    if (r.status < 200 || r.status >= 300) { const c = metaError(r.status, r.json); return { ok: false, reason: c.reason, retriable: c.retriable, error: c.error, detail: c.detail }; }
    creationId = String(r.json?.id ?? "").trim();
    if (!creationId) return { ok: false, reason: "channel_error", retriable: true, error: "인스타그램이 업로드 번호를 주지 않았어요.", detail: "no_creation_id" };
    await saveCreationId(tid, piece.id, META_FIELD, creationId);   // 🔴 먼저 남긴다 — 여기서 죽어도 다음 틱이 이어받는다
  }

  /* ② 처리 대기 — 짧게만. 아직이면 «실패»가 아니라 «다음 틱에»(retriable) 로 돌려준다. */
  let statusCode = "";
  for (let i = 0; i < POLL_TRIES; i++) {
    const r = await graph(`${GRAPH}/${encodeURIComponent(creationId)}?fields=status_code&access_token=${encodeURIComponent(token)}`).catch(() => null);
    statusCode = String(r?.json?.status_code ?? "").toUpperCase();
    if (statusCode === "FINISHED") break;
    if (statusCode === "ERROR") {
      await clearCreationId(tid, piece.id, META_FIELD);   // 깨진 컨테이너는 버린다(다음엔 새로 만든다)
      return { ok: false, reason: "config", retriable: false, error: "인스타그램이 이 영상을 처리하지 못했어요(형식 확인 필요).", detail: "container_error" };
    }
    if (i < POLL_TRIES - 1) await sleep(POLL_WAIT_MS);
  }
  if (statusCode !== "FINISHED") {
    return { ok: false, reason: "video_processing", retriable: true,
      error: "인스타그램이 영상을 준비하고 있어요. 잠시 뒤에 올릴게요.", detail: `status_code=${statusCode || "unknown"}` };
  }

  /* ③ 게시 */
  const pub = await graph(`${GRAPH}/${encodeURIComponent(igUserId)}/media_publish`, {
    method: "POST", body: new URLSearchParams({ creation_id: creationId, access_token: token }),
  }).catch(() => null);
  if (!pub) return { ok: false, reason: "network", retriable: true, error: "인스타그램에 연결하지 못했어요. 잠시 후 다시 시도할게요." };
  if (pub.status < 200 || pub.status >= 300) { const c = metaError(pub.status, pub.json); return { ok: false, reason: c.reason, retriable: c.retriable, error: c.error, detail: c.detail }; }
  const mediaId = String(pub.json?.id ?? "").trim();
  if (!mediaId) return { ok: false, reason: "channel_error", retriable: true, error: "올렸는데 인스타그램이 게시 번호를 주지 않았어요.", detail: "no_media_id" };

  await clearCreationId(tid, piece.id, META_FIELD);   // 다 썼다 — 남겨 두면 다음 글이 재사용할 위험
  return { ok: true, via: "api", externalUrl: `https://www.instagram.com/reel/${mediaId}/`, channelRef: mediaId };
}
