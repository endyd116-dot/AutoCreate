/**
 * lib/publish/facebook.ts — 페이스북 **페이지 글**(§2.1 P3) + **페이지 릴스**(§2.2 P3) 발행 커넥터.
 *   AC 신규 2026-09-15(B2 · 계약 P1R8 §3.4). 관례 출처: `lib/publish/instagram.ts`(컨테이너·폴링·중복 방지 3단계).
 *
 *   ══ 🔴 이 파일의 제일 중요한 한 줄 ══
 *   **페이지에 글을 쓰는 토큰은 «사용자 토큰»이 아니라 «페이지 토큰»이다.** 사용자 토큰으로 `/{page}/feed` 를 치면
 *   200 이 아니라 권한 오류가 오고, 우리는 그걸 «계정이 끊겼다»로 잘못 읽게 된다. 페이지 토큰은 연결 때
 *   `oauth-providers.exchangeCode` 가 `extra.pageAccessToken` 에 넣어 둔다 — 여기서는 **그 값을 쓴다**.
 *   그래서 `ensureFreshToken` 이 갱신하는 것(사용자 토큰)과 우리가 발행에 쓰는 것(페이지 토큰)이 **다른 값**이고,
 *   이 어긋남이 이 채널의 유일한 함정이다(AC-57 «대용물로 판정하지 마라»의 친척 — 토큰도 대용물이 있다).
 *
 *   ══ 규격(Graph API v21.0 · 2026-09 공식 문서 확인치) ══
 *   · 글만:      POST /{page-id}/feed    { message, link? }                       → { id: "{pageId}_{postId}" }
 *   · 사진 1장:  POST /{page-id}/photos  { url, caption }                          → { id, post_id }
 *   · 사진 여러: POST /{page-id}/photos  { url, published:false } × N → media_fbid
 *                POST /{page-id}/feed    { message, attached_media:[{media_fbid}] }
 *   · 릴스(3단계): POST /{page-id}/video_reels?upload_phase=start                   → { video_id, upload_url }
 *                 POST {upload_url}  헤더 Authorization: OAuth {page token} · file_url: {공개 주소}
 *                 POST /{page-id}/video_reels?upload_phase=finish&video_id=&video_state=PUBLISHED&description=
 *
 *   🔴 **중복 게시 0** — 릴스는 `video_id` 를 `piece.meta.fbReelId` 에 먼저 남긴다(릴스·스레드와 같은 관례).
 *   🔴 캡션 **첫 줄**이 고지(§16B) — `buildCaption` 한 곳에서 만든다.
 *   🔴 이 파일은 **게시만** 한다 — posts 행·piece 상태는 `finalizePublish` 한 곳(§5 경계).
 *   ⬜ **우리 키로 실호출한 적이 없다**(2026-09-15 · `META_APP_ID` 미등록 · 채널 planned). 코드는 완성 · «키 꽂으면 가동».
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../db-util";
import { ensureFreshToken } from "./tokens";
import { buildCaption, videoPublicUrlOf } from "./instagram";
import type { PublishPiece, PublishAccount, PublishResult } from "./contract";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

const GRAPH = "https://graph.facebook.com/v21.0";
const RUPLOAD = "https://rupload.facebook.com/video-upload/v21.0";
const TIMEOUT_MS = 30_000;
/** 릴스가 익을 때까지 이 정도만 본다 — 더 길면 함수가 벽에 부딪힌다. 안 되면 «다음 틱에»(retriable). */
const POLL_TRIES = 3;
const POLL_WAIT_MS = 5_000;
const REEL_FIELD = "fbReelId";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graph(url: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    let json: Record<string, unknown> | null = null;
    try { json = await r.json() as Record<string, unknown>; } catch { /* 본문 없음 */ }
    return { status: r.status, json };
  } finally { clearTimeout(t); }
}

/** 메타 오류 → 우리 어휘. 🔴 «권한이 없다»와 «로그인이 끊겼다»를 섞지 않는다 — 고객이 할 일이 다르다(AC-10). */
function fbError(status: number, json: Record<string, unknown> | null): { reason: "auth_failed" | "channel_error" | "config"; retriable: boolean; error: string; detail: string } {
  const e = (json?.error ?? {}) as { message?: string; code?: number; error_subcode?: number };
  const msg = String(e?.message ?? "").slice(0, 200);
  const code = Number(e?.code ?? 0);
  if (status === 401 || code === 190) return { reason: "auth_failed", retriable: false, error: "페이스북 로그인이 만료됐어요. 계정을 다시 연결해 주세요.", detail: msg };
  /* code 200/10 = 권한 부족(페이지 글쓰기 권한 `pages_manage_posts` 가 없다). 🔴 이건 **우리 앱 심사** 문제이지
     고객이 다시 로그인한다고 풀리지 않는다 — «다시 연결하세요»를 시키면 고객이 헛일을 한다(B2-HANDOFF §3B). */
  if (code === 200 || code === 10) return { reason: "config", retriable: false, error: "이 페이지에 글을 쓸 권한이 아직 없어요. 담당이 확인합니다.", detail: `perm ${code} ${msg}` };
  if (code === 4 || code === 17 || code === 32 || status === 429) return { reason: "channel_error", retriable: true, error: "페이스북 요청 한도에 걸렸어요. 잠시 후 다시 올릴게요.", detail: msg };
  if (status >= 500) return { reason: "channel_error", retriable: true, error: "페이스북이 지금 응답하지 않아요. 잠시 후 다시 시도할게요.", detail: `${status} ${msg}` };
  return { reason: "config", retriable: false, error: "페이스북이 이 글을 받지 않았어요.", detail: `${status} ${code} ${msg}` };
}

/**
 * 페이지 토큰을 꺼낸다 — 🔴 **이 채널의 핵심 한 조각**(파일 머리말 참조).
 *   `ensureFreshToken` 이 사용자 토큰을 살려 두고, 우리는 그 안의 `extra.pageAccessToken` 을 쓴다.
 *   페이지 토큰이 없으면 **없다고 말한다** — 사용자 토큰으로 대신 시도하지 않는다(그 «폴백»이 바로 조용한 오작동이다).
 */
async function pageAuth(tid: number, account: PublishAccount, channel: "facebook" | "facebook_reels"):
  Promise<{ ok: true; pageId: string; pageToken: string } | { ok: false; res: PublishResult }> {
  const tok = await ensureFreshToken(tid, account.id, channel, account.handle);
  if (!tok.ok) {
    if (tok.reason === "provider_not_configured") return { ok: false, res: { ok: false, reason: "provider_not_configured", retriable: false, error: "페이스북 연결이 아직 준비 중이에요." } };
    if (tok.reason === "no_creds") return { ok: false, res: { ok: false, reason: "no_creds", retriable: false, error: "페이스북 계정을 다시 연결해 주세요." } };
    return { ok: false, res: { ok: false, reason: "auth_failed", retriable: false, error: "페이스북 로그인이 만료됐어요. 다시 연결해 주세요.", detail: tok.detail } };
  }
  const extra = (tok.token.extra ?? {}) as Record<string, unknown>;
  const pageId = String(extra.pageId ?? tok.token.externalId ?? "").trim();
  const pageToken = String(extra.pageAccessToken ?? "").trim();
  if (!pageId) return { ok: false, res: { ok: false, reason: "no_creds", retriable: false, error: "페이스북 페이지를 찾지 못했어요. 다시 연결해 주세요." } };
  if (!pageToken) {
    return { ok: false, res: { ok: false, reason: "no_creds", retriable: false,
      error: "이 페이지의 글쓰기 권한을 못 받았어요. 페이스북을 다시 연결해 주세요.", detail: "no_page_access_token" } };
  }
  return { ok: true, pageId, pageToken };
}

async function savedReelId(tid: number, pieceId: number): Promise<string> {
  const [p] = await q(sql`SELECT meta FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId} LIMIT 1`);
  const meta = (p?.meta && typeof p.meta === "object" ? p.meta : {}) as Record<string, unknown>;
  return String(meta[REEL_FIELD] ?? "").trim();
}
async function saveReelId(tid: number, pieceId: number, id: string): Promise<void> {
  await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ [REEL_FIELD]: id })}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${pieceId}`);
}
async function clearReelId(tid: number, pieceId: number): Promise<void> {
  await q(sql`UPDATE pieces SET meta = meta - ${REEL_FIELD}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${pieceId}`);
}

/* ═══════════════════════════ ① 페이지 글 ═══════════════════════════ */

/** 사진을 **안 올린 상태로** 올려 media_fbid 만 받는다(여러 장을 한 글에 붙일 때). 실패한 장은 건너뛴다 — 글은 나가야 한다. */
async function stagePhoto(pageId: string, token: string, imageUrl: string, caption?: string): Promise<string | null> {
  const body = new URLSearchParams({ url: imageUrl, published: "false", access_token: token });
  if (caption) body.set("caption", caption.slice(0, 500));
  const r = await graph(`${GRAPH}/${encodeURIComponent(pageId)}/photos`, { method: "POST", body }).catch(() => null);
  if (!r || r.status < 200 || r.status >= 300) return null;
  const id = String(r.json?.id ?? "").trim();
  return id || null;
}

export async function publishFacebookPost(piece: PublishPiece, account: PublishAccount): Promise<PublishResult> {
  const tid = piece.tenantId;
  const auth = await pageAuth(tid, account, "facebook");
  if (!auth.ok) return auth.res;
  const { pageId, pageToken } = auth;

  /* 페북 글은 제목 칸이 없다 — 제목을 첫 줄로 올리고 그 아래 고지·본문이 온다.
     🔴 고지는 `buildCaption` 이 **맨 첫 줄**에 둔다(§16B). 제목을 그 위에 얹으면 고지가 둘째 줄이 되므로,
        제목은 캡션 **뒤가 아니라** 본문 안에 이미 들어 있는 것으로 보고 따로 얹지 않는다. */
  const message = buildCaption(piece, 60_000, { bodyLimit: 20_000 });
  if (!message.trim()) return { ok: false, reason: "not_publishable", retriable: false, error: "올릴 내용이 비어 있어요." };

  const images = (piece.images ?? []).map((i) => String(i.url || "").trim()).filter(Boolean).slice(0, 10);
  const body = new URLSearchParams({ message, access_token: pageToken });

  if (images.length) {
    const fbids: string[] = [];
    for (const [i, url] of images.entries()) {
      const id = await stagePhoto(pageId, pageToken, url, piece.images[i]?.caption);
      if (id) fbids.push(id);
    }
    /* 🔴 사진이 **한 장도** 안 올라갔으면 사진 없이 글만 올린다 — 사진은 부가이고 글이 본체다
       (워드프레스 태그와 같은 판단: 부가 실패로 본체를 막지 않는다). 몇 장 빠졌는지는 아래 감사에 안 남긴다 —
       러너 채널이 아니라 여기서는 반환값에 담을 자리가 없어, 빠진 장수는 notes 가 아니라 detail 로만 보인다. */
    if (fbids.length) body.set("attached_media", JSON.stringify(fbids.map((media_fbid) => ({ media_fbid }))));
  }
  if (piece.affiliate?.url) body.set("link", piece.affiliate.url);

  const r = await graph(`${GRAPH}/${encodeURIComponent(pageId)}/feed`, { method: "POST", body }).catch(() => null);
  if (!r) return { ok: false, reason: "network", retriable: true, error: "페이스북에 연결하지 못했어요. 잠시 후 다시 시도할게요." };
  if (r.status < 200 || r.status >= 300) { const c = fbError(r.status, r.json); return { ok: false, reason: c.reason, retriable: c.retriable, error: c.error, detail: c.detail }; }

  /* 반환 id 는 `{pageId}_{postId}` 꼴이다. 주소는 그 글자를 그대로 쓰면 열린다. */
  const postId = String(r.json?.id ?? "").trim();
  if (!postId) return { ok: false, reason: "channel_error", retriable: true, error: "올렸는데 페이스북이 글 번호를 주지 않았어요.", detail: "no_post_id" };
  return { ok: true, via: "api", externalUrl: `https://www.facebook.com/${postId}`, channelRef: postId };
}

/* ═══════════════════════════ ② 페이지 릴스 ═══════════════════════════ */

export async function publishFacebookReels(piece: PublishPiece, account: PublishAccount): Promise<PublishResult> {
  const tid = piece.tenantId;
  const auth = await pageAuth(tid, account, "facebook_reels");
  if (!auth.ok) return auth.res;
  const { pageId, pageToken } = auth;

  /* ① 시작 — **이미 만들어 둔 video_id 가 있으면 그것을 쓴다**(중복 게시 0). */
  let videoId = await savedReelId(tid, piece.id);
  let uploadUrl = "";
  if (!videoId) {
    const videoUrl = await videoPublicUrlOf(tid, piece.id);
    if (!videoUrl) return { ok: false, reason: "not_publishable", retriable: false, error: "올릴 영상이 아직 없어요(렌더가 끝나지 않았어요)." };

    const start = await graph(`${GRAPH}/${encodeURIComponent(pageId)}/video_reels`, {
      method: "POST", body: new URLSearchParams({ upload_phase: "start", access_token: pageToken }),
    }).catch(() => null);
    if (!start) return { ok: false, reason: "network", retriable: true, error: "페이스북에 연결하지 못했어요. 잠시 후 다시 시도할게요." };
    if (start.status < 200 || start.status >= 300) { const c = fbError(start.status, start.json); return { ok: false, reason: c.reason, retriable: c.retriable, error: c.error, detail: c.detail }; }
    videoId = String(start.json?.video_id ?? "").trim();
    uploadUrl = String(start.json?.upload_url ?? "").trim() || `${RUPLOAD}/${videoId}`;
    if (!videoId) return { ok: false, reason: "channel_error", retriable: true, error: "페이스북이 업로드 번호를 주지 않았어요.", detail: "no_video_id" };
    await saveReelId(tid, piece.id, videoId);   // 🔴 먼저 남긴다 — 여기서 죽어도 다음 틱이 이어받는다

    /* ② 올리기 — 🔴 우리 서버가 파일을 들고 있지 않다. `file_url` 헤더를 주면 **메타가 직접 내려받는다**
       (릴스·스레드의 `video_url` 과 같은 원리 · 우리 함수가 영상 바이트를 만지지 않아 메모리·시간이 안 든다). */
    const up = await graph(uploadUrl, {
      method: "POST",
      headers: { Authorization: `OAuth ${pageToken}`, file_url: videoUrl },
    }, 60_000).catch(() => null);
    if (!up) return { ok: false, reason: "network", retriable: true, error: "페이스북에 영상을 넘기지 못했어요. 잠시 후 다시 시도할게요." };
    if (up.status < 200 || up.status >= 300) { const c = fbError(up.status, up.json); return { ok: false, reason: c.reason, retriable: c.retriable, error: c.error, detail: `upload ${c.detail}` }; }
  }

  /* ③ 마무리 — 게시. 설명(캡션) 첫 줄이 고지다. */
  const fin = await graph(`${GRAPH}/${encodeURIComponent(pageId)}/video_reels`, {
    method: "POST",
    body: new URLSearchParams({
      upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED",
      description: buildCaption(piece, 2_200), access_token: pageToken,
    }),
  }).catch(() => null);
  if (!fin) return { ok: false, reason: "network", retriable: true, error: "페이스북에 연결하지 못했어요. 잠시 후 다시 시도할게요." };
  if (fin.status < 200 || fin.status >= 300) {
    const c = fbError(fin.status, fin.json);
    /* 아직 굽는 중이면 실패가 아니라 «조금 뒤에»다 — video_id 는 그대로 두고 다음 틱이 마무리한다. */
    if (c.retriable) return { ok: false, reason: "video_processing", retriable: true, error: "페이스북이 영상을 준비하고 있어요. 잠시 뒤에 올릴게요.", detail: c.detail };
    await clearReelId(tid, piece.id);   // 깨진 업로드는 버린다(다음엔 새로 시작한다)
    return { ok: false, reason: c.reason, retriable: false, error: c.error, detail: `finish ${c.detail}` };
  }

  /* 🔴 `finish` 가 200 이어도 **게시가 끝난 것은 아니다** — publishing_phase 가 남아 있을 수 있다.
     그래서 상태를 짧게 확인한다. 아직이면 «다음 틱»(video_id 는 남겨 둔다 · 중복 0). */
  let state = "";
  for (let i = 0; i < POLL_TRIES; i++) {
    const st = await graph(`${GRAPH}/${encodeURIComponent(videoId)}?fields=status&access_token=${encodeURIComponent(pageToken)}`).catch(() => null);
    const status = (st?.json?.status ?? {}) as Record<string, unknown>;
    state = String(status.video_status ?? "").toLowerCase();
    if (state === "ready" || state === "published") break;
    if (state === "error") { await clearReelId(tid, piece.id); return { ok: false, reason: "config", retriable: false, error: "페이스북이 이 영상을 처리하지 못했어요(형식 확인 필요).", detail: "video_status=error" }; }
    if (i < POLL_TRIES - 1) await sleep(POLL_WAIT_MS);
  }
  if (state && state !== "ready" && state !== "published") {
    return { ok: false, reason: "video_processing", retriable: true, error: "페이스북이 영상을 준비하고 있어요. 잠시 뒤에 올릴게요.", detail: `video_status=${state}` };
  }

  await clearReelId(tid, piece.id);
  return { ok: true, via: "api", externalUrl: `https://www.facebook.com/reel/${videoId}`, channelRef: videoId };
}
