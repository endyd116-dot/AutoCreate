/**
 * lib/publish/threads.ts — 스레드(Threads) **영상** 발행(계약 P1R5 §2.3).
 *   AC 신규 2026-09-14(B2). 이식 관례: ../AutoMarketing/lib/publish-threads.ts.
 *
 *   규격(Threads API · graph.threads.net): 릴스와 **같은 3단계**지만 호스트·필드가 다르다.
 *     ① POST /{threads-user-id}/threads        { media_type:"VIDEO", video_url, text }  → creation_id
 *     ② GET  /{creation_id}?fields=status      → FINISHED | IN_PROGRESS | ERROR
 *     ③ POST /{threads-user-id}/threads_publish { creation_id }                         → 게시 id
 *
 *   🔴 공식 안내: 컨테이너를 만들고 **약 30초** 뒤에 게시하라. 그래서 여기서 오래 기다리지 않고,
 *      아직이면 `video_processing`(retriable) 으로 돌려 **다음 틱**이 이어받게 한다 — 릴스와 같은 관례.
 *   🔴 `creation_id` 를 piece.meta 에 남긴다 — 중복 게시 0(같은 영상이 두 번 올라가면 되돌릴 수 없다).
 *   🔴 본문 **첫 줄**이 고지(§16B).
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../db-util";
import { ensureFreshToken } from "./tokens";
import { buildCaption, videoPublicUrlOf } from "./instagram";
import type { PublishPiece, PublishAccount, PublishResult } from "./contract";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

const GRAPH = "https://graph.threads.net/v1.0";
const TIMEOUT_MS = 30_000;
const POLL_TRIES = 3;
const POLL_WAIT_MS = 5_000;
const META_FIELD = "thCreationId";

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

async function savedId(tid: number, pieceId: number): Promise<string> {
  const [p] = await q(sql`SELECT meta FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId} LIMIT 1`);
  const meta = (p?.meta && typeof p.meta === "object" ? p.meta : {}) as Record<string, unknown>;
  return String(meta[META_FIELD] ?? "").trim();
}

function thError(status: number, json: Record<string, unknown> | null): { reason: "auth_failed" | "channel_error" | "config"; retriable: boolean; error: string; detail: string } {
  const e = (json?.error ?? {}) as { message?: string; code?: number };
  const msg = String(e?.message ?? "").slice(0, 200);
  const code = Number(e?.code ?? 0);
  if (status === 401 || code === 190) return { reason: "auth_failed", retriable: false, error: "스레드 로그인이 만료됐어요. 계정을 다시 연결해 주세요.", detail: msg };
  if (code === 4 || code === 17 || status === 429) return { reason: "channel_error", retriable: true, error: "스레드 요청 한도에 걸렸어요. 잠시 후 다시 올릴게요.", detail: msg };
  if (status >= 500) return { reason: "channel_error", retriable: true, error: "스레드가 지금 응답하지 않아요. 잠시 후 다시 시도할게요.", detail: `${status} ${msg}` };
  return { reason: "config", retriable: false, error: "스레드가 이 영상을 받지 않았어요.", detail: `${status} ${code} ${msg}` };
}

/** 토큰·사용자 id — 글·영상 두 경로가 **똑같이** 쓰는 앞머리(둘이 갈리면 한쪽만 고치는 사고가 난다). */
async function threadsAuth(tid: number, account: PublishAccount): Promise<{ ok: true; token: string; userId: string } | { ok: false; res: PublishResult }> {
  const tok = await ensureFreshToken(tid, account.id, "threads", account.handle);
  if (!tok.ok) {
    if (tok.reason === "provider_not_configured") return { ok: false, res: { ok: false, reason: "provider_not_configured", retriable: false, error: "스레드 연결이 아직 준비 중이에요." } };
    if (tok.reason === "no_creds") return { ok: false, res: { ok: false, reason: "no_creds", retriable: false, error: "스레드 계정을 다시 연결해 주세요." } };
    return { ok: false, res: { ok: false, reason: "auth_failed", retriable: false, error: "스레드 로그인이 만료됐어요. 다시 연결해 주세요.", detail: tok.detail } };
  }
  const userId = String((tok.token.extra as Record<string, unknown> | undefined)?.threadsUserId ?? tok.token.externalId ?? "").trim();
  if (!userId) return { ok: false, res: { ok: false, reason: "no_creds", retriable: false, error: "스레드 계정을 찾지 못했어요. 다시 연결해 주세요." } };
  return { ok: true, token: tok.token.accessToken, userId };
}

/** 게시 결과 id → 사람이 여는 주소. */
const threadsUrl = (handle: string, id: string) => {
  const h = String(handle || "").replace(/^@/, "");
  return h ? `https://www.threads.net/@${h}/post/${id}` : `https://www.threads.net/post/${id}`;
};

/**
 * 스레드 **글**(텍스트) 발행 — 계약 P1R7 §2.3.
 *
 *   🔴 왜 따로 만드나: `publish/index.ts` 가 스레드를 **무조건 영상으로** 보내고 있었다. 그래서 글 한 편을
 *      스레드로 예약하면 «올릴 영상이 아직 없어요»로 영원히 막혔다 — 설계 §2.1 이 스레드를 **글 채널(P2 보조 배포)**
 *      로 둔 것과 어긋난다(B2 전수조사 §2.1 «쓰레드» 행).
 *   🔴 영상과 **단계 수가 다르다**: 텍스트는 컨테이너를 만들자마자 바로 게시할 수 있다(처리 대기가 없다).
 *      영상 경로의 폴링을 그대로 베끼면 30초를 헛기다리고 `video_processing` 으로 되돌아가 **영원히 안 올라간다**.
 *   🔴 본문 **첫 줄이 고지**(§16B) — `buildCaption` 이 그 규칙을 지키는 단일 출처라 글도 그걸 쓴다.
 *      스레드 글자 상한 500 도 거기서 지킨다.
 *   중복 게시 0: 컨테이너 id 를 `piece.meta` 에 남겨 재시도 때 재사용한다(영상과 같은 규율).
 */
export async function publishThreadsText(piece: PublishPiece, account: PublishAccount): Promise<PublishResult> {
  const tid = piece.tenantId;
  const auth = await threadsAuth(tid, account);
  if (!auth.ok) return auth.res;
  const { token, userId } = auth;

  const text = buildCaption(piece, 500);
  if (!text.trim()) return { ok: false, reason: "not_publishable", retriable: false, error: "올릴 내용이 비어 있어요." };

  /* ① 컨테이너(있으면 재사용) */
  let creationId = await savedId(tid, piece.id);
  if (!creationId) {
    const body = new URLSearchParams({ media_type: "TEXT", text, access_token: token });
    const r = await graph(`${GRAPH}/${encodeURIComponent(userId)}/threads`, { method: "POST", body }).catch(() => null);
    if (!r) return { ok: false, reason: "network", retriable: true, error: "스레드에 연결하지 못했어요. 잠시 후 다시 시도할게요." };
    if (r.status < 200 || r.status >= 300) { const c = thError(r.status, r.json); return { ok: false, reason: c.reason, retriable: c.retriable, error: c.error, detail: c.detail }; }
    creationId = String(r.json?.id ?? "").trim();
    if (!creationId) return { ok: false, reason: "channel_error", retriable: true, error: "스레드가 업로드 번호를 주지 않았어요.", detail: "no_creation_id" };
    await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ [META_FIELD]: creationId })}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${piece.id}`);
  }

  /* ② 게시 — 텍스트는 처리 대기가 없다(그래서 여기엔 폴링이 없다). */
  const pub = await graph(`${GRAPH}/${encodeURIComponent(userId)}/threads_publish`, {
    method: "POST", body: new URLSearchParams({ creation_id: creationId, access_token: token }),
  }).catch(() => null);
  if (!pub) return { ok: false, reason: "network", retriable: true, error: "스레드에 연결하지 못했어요. 잠시 후 다시 시도할게요." };
  if (pub.status < 200 || pub.status >= 300) { const c = thError(pub.status, pub.json); return { ok: false, reason: c.reason, retriable: c.retriable, error: c.error, detail: c.detail }; }
  const id = String(pub.json?.id ?? "").trim();
  if (!id) return { ok: false, reason: "channel_error", retriable: true, error: "올렸는데 스레드가 게시 번호를 주지 않았어요.", detail: "no_media_id" };

  await q(sql`UPDATE pieces SET meta = meta - ${META_FIELD}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${piece.id}`);
  return { ok: true, via: "api", externalUrl: threadsUrl(account.handle, id), channelRef: id };
}

export async function publishThreadsVideo(piece: PublishPiece, account: PublishAccount): Promise<PublishResult> {
  const tid = piece.tenantId;

  const auth = await threadsAuth(tid, account);
  if (!auth.ok) return auth.res;
  const { token, userId } = auth;

  /* ① 컨테이너(있으면 재사용 — 중복 게시 0) */
  let creationId = await savedId(tid, piece.id);
  if (!creationId) {
    const videoUrl = await videoPublicUrlOf(tid, piece.id);
    if (!videoUrl) return { ok: false, reason: "not_publishable", retriable: false, error: "올릴 영상이 아직 없어요(렌더가 끝나지 않았어요)." };
    const body = new URLSearchParams({ media_type: "VIDEO", video_url: videoUrl, text: buildCaption(piece, 500), access_token: token });
    const r = await graph(`${GRAPH}/${encodeURIComponent(userId)}/threads`, { method: "POST", body }).catch(() => null);
    if (!r) return { ok: false, reason: "network", retriable: true, error: "스레드에 연결하지 못했어요. 잠시 후 다시 시도할게요." };
    if (r.status < 200 || r.status >= 300) { const c = thError(r.status, r.json); return { ok: false, reason: c.reason, retriable: c.retriable, error: c.error, detail: c.detail }; }
    creationId = String(r.json?.id ?? "").trim();
    if (!creationId) return { ok: false, reason: "channel_error", retriable: true, error: "스레드가 업로드 번호를 주지 않았어요.", detail: "no_creation_id" };
    await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ [META_FIELD]: creationId })}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${piece.id}`);
  }

  /* ② 처리 대기 — 공식 권고는 «30초 뒤». 여기선 짧게만 보고 아직이면 다음 틱으로 넘긴다. */
  let st = "";
  for (let i = 0; i < POLL_TRIES; i++) {
    const r = await graph(`${GRAPH}/${encodeURIComponent(creationId)}?fields=status&access_token=${encodeURIComponent(token)}`).catch(() => null);
    st = String(r?.json?.status ?? "").toUpperCase();
    if (st === "FINISHED") break;
    if (st === "ERROR") {
      await q(sql`UPDATE pieces SET meta = meta - ${META_FIELD}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${piece.id}`);
      return { ok: false, reason: "config", retriable: false, error: "스레드가 이 영상을 처리하지 못했어요(형식 확인 필요).", detail: "container_error" };
    }
    if (i < POLL_TRIES - 1) await sleep(POLL_WAIT_MS);
  }
  if (st !== "FINISHED") {
    return { ok: false, reason: "video_processing", retriable: true,
      error: "스레드가 영상을 준비하고 있어요. 잠시 뒤에 올릴게요.", detail: `status=${st || "unknown"}` };
  }

  /* ③ 게시 */
  const pub = await graph(`${GRAPH}/${encodeURIComponent(userId)}/threads_publish`, {
    method: "POST", body: new URLSearchParams({ creation_id: creationId, access_token: token }),
  }).catch(() => null);
  if (!pub) return { ok: false, reason: "network", retriable: true, error: "스레드에 연결하지 못했어요. 잠시 후 다시 시도할게요." };
  if (pub.status < 200 || pub.status >= 300) { const c = thError(pub.status, pub.json); return { ok: false, reason: c.reason, retriable: c.retriable, error: c.error, detail: c.detail }; }
  const id = String(pub.json?.id ?? "").trim();
  if (!id) return { ok: false, reason: "channel_error", retriable: true, error: "올렸는데 스레드가 게시 번호를 주지 않았어요.", detail: "no_media_id" };

  await q(sql`UPDATE pieces SET meta = meta - ${META_FIELD}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${piece.id}`);
  return { ok: true, via: "api", externalUrl: threadsUrl(account.handle, id), channelRef: id };
}
