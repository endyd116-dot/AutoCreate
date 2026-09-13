/**
 * lib/publish/blogger.ts — 구글 블로거(Blogspot) 발행 커넥터(계약 §3 · DESIGN §2.1 «API · Blogger API v3»).
 *   AC 신규 2026-09-14(B2). 관례 출처: ../AutoMarketing/lib/publish-threads.ts(graceful 반환 모양 · throw 금지).
 *
 *   규격(공식 문서 2026-09 확인치): POST https://www.googleapis.com/blogger/v3/blogs/{blogId}/posts
 *     body { kind:"blogger#post", title, content, labels:[...] } · 헤더 Authorization: Bearer <access token>
 *     응답 { id, url, … } → channelRef = post id · externalUrl = url
 *   blogId 는 연결 때 저장한 토큰의 `extra.blogId`(oauth-providers.exchangeCode 가 users/self/blogs 로 채운다).
 *
 *   🔴 본문은 `bodyHtml` 을 **그대로** 올린다(§4B 렌더 계약이 정본 — 블로거는 HTML 을 그대로 받는다).
 *   🔴 401 이면 토큰을 한 번만 강제 갱신하고 재시도한다(무한 재시도 금지).
 */
import { ensureFreshToken } from "./tokens";
import type { PublishPiece, PublishAccount, PublishFailReason } from "./contract";

export type ConnectorResult =
  | { ok: true; externalUrl: string; channelRef?: string }
  | { ok: false; reason: PublishFailReason; retriable: boolean; error: string; detail?: string };

const TIMEOUT_MS = 20_000;

async function postToBlogger(blogId: string, accessToken: string, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(blogId)}/posts?fetchImages=false`, {
      method: "POST", signal: ctrl.signal,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    let json: Record<string, unknown> | null = null;
    try { json = await r.json() as Record<string, unknown>; } catch { /* 본문 없음 */ }
    return { status: r.status, json };
  } finally { clearTimeout(t); }
}

export async function publishToBlogger(piece: PublishPiece, account: PublishAccount): Promise<ConnectorResult> {
  let tok = await ensureFreshToken(piece.tenantId, account.id, "blogger", account.handle);
  if (!tok.ok) {
    if (tok.reason === "provider_not_configured") return { ok: false, reason: "provider_not_configured", retriable: false, error: "블로거 연결이 아직 준비 중이에요." };
    if (tok.reason === "no_creds") return { ok: false, reason: "no_creds", retriable: false, error: "블로거 계정을 다시 연결해 주세요." };
    return { ok: false, reason: "auth_failed", retriable: false, error: "블로거 로그인이 만료됐어요. 다시 연결해 주세요.", detail: tok.detail };
  }
  const blogId = String((tok.token.extra as Record<string, unknown> | undefined)?.blogId ?? tok.token.externalId ?? "").trim();
  if (!blogId) return { ok: false, reason: "no_creds", retriable: false, error: "블로그를 찾지 못했어요. 블로거를 다시 연결해 주세요." };

  const body: Record<string, unknown> = {
    kind: "blogger#post",
    title: String(piece.title || "").slice(0, 300),
    content: piece.bodyHtml,
  };
  if (piece.tags.length) body.labels = piece.tags.slice(0, 20).map((t) => String(t).slice(0, 40));

  let res: Awaited<ReturnType<typeof postToBlogger>>;
  try { res = await postToBlogger(blogId, tok.token.accessToken, body); }
  catch (e) { return { ok: false, reason: "network", retriable: true, error: "블로거에 연결하지 못했어요. 잠시 후 다시 시도할게요.", detail: String((e as Error)?.message ?? e).slice(0, 160) }; }

  // 401 = 토큰 문제 — 강제 갱신 후 딱 한 번 재시도.
  if (res.status === 401) {
    tok = await ensureFreshToken(piece.tenantId, account.id, "blogger", account.handle, true);
    if (!tok.ok) return { ok: false, reason: "auth_failed", retriable: false, error: "블로거 로그인이 만료됐어요. 다시 연결해 주세요.", detail: tok.detail };
    try { res = await postToBlogger(blogId, tok.token.accessToken, body); }
    catch (e) { return { ok: false, reason: "network", retriable: true, error: "블로거에 연결하지 못했어요.", detail: String((e as Error)?.message ?? e).slice(0, 160) }; }
  }

  if (res.status === 403) {
    const msg = String(((res.json?.error as Record<string, unknown> | undefined)?.message) ?? "").slice(0, 160);
    return { ok: false, reason: "auth_failed", retriable: false, error: "블로거가 글쓰기 권한을 거절했어요. 다시 연결해 주세요.", detail: `403 ${msg}` };
  }
  if (res.status === 429 || res.status >= 500) {
    return { ok: false, reason: "channel_error", retriable: true, error: "블로거가 지금 응답하지 않아요. 잠시 후 다시 시도할게요.", detail: `http_${res.status}` };
  }
  const url = String(res.json?.url ?? "").trim();
  const id = String(res.json?.id ?? "").trim();
  if (res.status < 200 || res.status >= 300 || !url) {
    const msg = String(((res.json?.error as Record<string, unknown> | undefined)?.message) ?? "").slice(0, 160);
    return { ok: false, reason: "channel_error", retriable: false, error: "블로거가 글을 받지 않았어요.", detail: `http_${res.status} ${msg}` };
  }
  return { ok: true, externalUrl: url, ...(id ? { channelRef: id } : {}) };
}
