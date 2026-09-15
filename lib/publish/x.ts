/**
 * lib/publish/x.ts — **X(트위터)** 발행 커넥터(DESIGN §2.1 «X(트위터) · API(유료) · P4 선택»).
 *   AC 신규 2026-09-15(B2 · 계약 P1R8 §3.4).
 *
 *   ══ 🔴 이 채널의 진짜 함정은 API 가 아니라 «글자 수»다 ══
 *   X 는 280자인데 **한글은 한 자가 2로 세어진다**(가중 길이 · 공식 문서의 weighted ranges).
 *   즉 우리 고객 기준 실제 한도는 **한글 140자**다. 이걸 모르고 `slice(0,280)` 을 쓰면
 *   **거의 모든 한국어 글이 «too long» 으로 거절**되고, 우리는 그걸 «X 가 이상하다»로 읽게 된다.
 *   그래서 자르는 자리를 `weightedLen` 으로 잰다 — 이 파일에서 제일 중요한 코드는 그 함수다.
 *   🔴 URL 은 길이와 무관하게 **23으로 고정**(t.co 단축) — 이것도 공식 규칙이고, 안 넣으면 링크 있는 글이 통째로 튕긴다.
 *
 *   ══ 규격(2026-09 확인치) ══
 *   · 글:     POST   https://api.twitter.com/2/tweets     { text, media?:{ media_ids:[…] } }  → { data:{ id } }
 *   · 삭제:   DELETE https://api.twitter.com/2/tweets/{id}                                    → { data:{ deleted } }
 *   · 사진:   POST   /2/media/upload/initialize → /2/media/upload/{id}/append → /finalize
 *            ⬜ **미검증** — 미디어 업로드는 2025 에 v1.1 에서 v2 로 옮겨 갔고 우리 키로 왕복해 본 적이 없다.
 *               그래서 **사진이 실패하면 글만 올린다**(빠진 사실은 감사에 남긴다 · AC-9). 사진 때문에 글을 막지 않는다.
 *
 *   🔴 **X 쓰기는 유료 플랜**이다(무료는 월 500건). 키가 오기 전엔 `provider_not_configured` 로 정직하게 막힌다.
 *   🔴 이 파일은 **게시만** 한다 — posts 행·piece 상태는 `finalizePublish` 한 곳(§5 경계).
 */
import { ensureFreshToken } from "./tokens";
import { disclosureTextFor } from "../disclosure";
import { writeAudit } from "../audit";
import type { PublishPiece, PublishAccount, PublishResult } from "./contract";

const API = "https://api.twitter.com/2";
const TIMEOUT_MS = 20_000;
/** X 의 글 상한 — **가중 길이** 기준이다(한글은 한 자가 2). */
export const X_WEIGHTED_MAX = 280;
/** 링크는 실제 길이와 무관하게 이 값으로 세어진다(t.co 단축 · 공식 규칙). */
const URL_WEIGHT = 23;
const URL_RE = /https?:\/\/\S+/g;

/**
 * 🔴 **X 가 세는 방식 그대로** 글자 수를 잰다.
 *   공식 규칙: 아래 네 구간에 드는 코드포인트만 **1**로 세고, 나머지는 전부 **2**로 센다.
 *     U+0000–U+10FF · U+2000–U+200A · U+2028–U+202F · U+2060 · U+20A0–U+20BF
 *   한글(U+AC00–U+D7A3)은 첫 구간 밖이라 **2**다 — 이게 이 파일의 이유다.
 *   URL 은 길이와 상관없이 23 — 문자열에서 URL 을 먼저 빼고 재고 개수 × 23 을 더한다.
 */
export function weightedLen(text: string): number {
  const s = String(text ?? "");
  const urls = s.match(URL_RE) ?? [];
  const rest = s.replace(URL_RE, "");
  let w = 0;
  for (const ch of rest) {
    const c = ch.codePointAt(0) ?? 0;
    const light = (c <= 0x10ff) || (c >= 0x2000 && c <= 0x200a) || (c >= 0x2028 && c <= 0x202f) || c === 0x2060 || (c >= 0x20a0 && c <= 0x20bf);
    w += light ? 1 : 2;
  }
  return w + urls.length * URL_WEIGHT;
}

/** 가중 길이가 `max` 를 넘지 않게 자른다(문자 단위 — 서로게이트 쌍을 쪼개지 않는다). */
export function weightedTrim(text: string, max: number): string {
  if (weightedLen(text) <= max) return String(text ?? "");
  let out = ""; let w = 0;
  for (const ch of String(text ?? "")) {
    const c = ch.codePointAt(0) ?? 0;
    const light = (c <= 0x10ff) || (c >= 0x2000 && c <= 0x200a) || (c >= 0x2028 && c <= 0x202f) || c === 0x2060 || (c >= 0x20a0 && c <= 0x20bf);
    const add = light ? 1 : 2;
    if (w + add > max) break;
    out += ch; w += add;
  }
  return out.replace(/\s+\S*$/, "").trimEnd();   // 단어 중간에서 끊기지 않게 마지막 토막은 버린다
}

/**
 * 트윗 본문 — 🔴 **자리를 «법 → 링크 → 본문» 순서로 잡는다.**
 *   고지(#광고 포함)와 제휴 링크는 **반드시 들어가야 하는 것**이라 먼저 자리를 떼고,
 *   본문은 **남은 만큼만** 싣는다. 반대로 하면(본문 먼저) 길이가 넘칠 때 잘려 나가는 것이 고지가 된다 —
 *   그건 «분량 문제»가 아니라 **법 문제**다(AC-73 «상한이 1인 자리에서는 법이 먼저 쓴다»의 같은 얼굴).
 */
export function buildTweet(piece: PublishPiece): string {
  const disc = piece.disclosure ?? (piece.affiliate ? disclosureTextFor(piece.affiliate.provider) : null);
  const link = piece.affiliate?.url ? String(piece.affiliate.url).trim() : "";
  const tail: string[] = [];
  if (link) tail.push(link);

  const head = disc ? weightedTrim(disc, 120) : "";
  const tailText = tail.join("\n");
  /* 남는 자리 = 280 − (고지 + 줄바꿈) − (꼬리 + 줄바꿈). 줄바꿈도 1자다. */
  const reserved = (head ? weightedLen(head) + 1 : 0) + (tailText ? weightedLen(tailText) + 1 : 0);
  const room = X_WEIGHTED_MAX - reserved;

  const title = String(piece.title ?? "").trim();
  const body = String(piece.bodyHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  /* 제목이 있으면 제목을 앞에 둔다 — 트윗은 «첫 줄이 전부»라 본문 첫 문장보다 제목이 낫다. */
  const core = weightedTrim([title, body].filter(Boolean).join(" — "), Math.max(0, room));

  return [head, core, tailText].filter(Boolean).join("\n").trim();
}

async function xfetch(url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<{ status: number; json: any; text: string }> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await r.text().catch(() => "");
    let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* 본문 없음 */ }
    return { status: r.status, json, text: text.slice(0, 300) };
  } finally { clearTimeout(t); }
}

function xError(status: number, json: any, text: string): { reason: "auth_failed" | "channel_error" | "config"; retriable: boolean; error: string; detail: string } {
  const msg = String(json?.detail ?? json?.title ?? json?.errors?.[0]?.message ?? text ?? "").slice(0, 200);
  if (status === 401) return { reason: "auth_failed", retriable: false, error: "X 로그인이 만료됐어요. 계정을 다시 연결해 주세요.", detail: msg };
  /* 🔴 403 을 «로그인 만료»로 읽지 않는다 — X 의 403 은 대개 **플랜 권한**(무료 플랜의 쓰기 한도·미승인 앱)이다.
     고객에게 «다시 로그인하세요»를 시키면 헛일을 시키는 것이고, 고칠 사람은 우리다(B2-HANDOFF §3B). */
  if (status === 403) return { reason: "config", retriable: false, error: "X 가 이 글의 게시를 거절했어요. 담당이 확인합니다.", detail: `403 ${msg}` };
  if (status === 429) return { reason: "channel_error", retriable: true, error: "X 요청 한도에 걸렸어요. 잠시 후 다시 올릴게요.", detail: msg };
  if (status >= 500) return { reason: "channel_error", retriable: true, error: "X 가 지금 응답하지 않아요. 잠시 후 다시 시도할게요.", detail: `${status} ${msg}` };
  return { reason: "config", retriable: false, error: "X 가 이 글을 받지 않았어요.", detail: `${status} ${msg}` };
}

/* ───────── 사진(⬜ 미검증 경로 — 실패해도 글은 나간다) ───────── */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // X 의 사진 상한(공식 5MB)
const CHUNK = 1024 * 1024;

/** 사진 1장 → media_id. 어느 단계에서든 실패하면 **null**(호출부가 사진 없이 글만 올린다). */
async function uploadPhoto(token: string, imageUrl: string): Promise<string | null> {
  try {
    const src = await fetch(imageUrl).catch(() => null);
    if (!src?.ok) return null;
    const ct = String(src.headers.get("content-type") ?? "image/jpeg");
    const buf = Buffer.from(await src.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > MAX_IMAGE_BYTES) return null;

    const init = await xfetch(`${API}/media/upload/initialize`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ media_type: ct.startsWith("image/") ? ct : "image/jpeg", total_bytes: buf.byteLength, media_category: "tweet_image" }),
    });
    const mediaId = String(init.json?.data?.id ?? init.json?.id ?? "").trim();
    if (!mediaId) return null;

    for (let i = 0, seg = 0; i < buf.byteLength; i += CHUNK, seg++) {
      const fd = new FormData();
      fd.set("segment_index", String(seg));
      fd.set("media", new Blob([buf.subarray(i, Math.min(i + CHUNK, buf.byteLength))]));
      const ap = await xfetch(`${API}/media/upload/${encodeURIComponent(mediaId)}/append`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd }, 60_000);
      if (ap.status < 200 || ap.status >= 300) return null;
    }
    const fin = await xfetch(`${API}/media/upload/${encodeURIComponent(mediaId)}/finalize`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (fin.status < 200 || fin.status >= 300) return null;
    return mediaId;
  } catch { return null; }
}

/* ───────── 정본 ───────── */

export async function publishToX(piece: PublishPiece, account: PublishAccount): Promise<PublishResult> {
  const tid = piece.tenantId;
  /* 🔴 **영상은 아직 못 올린다.** X 의 영상 업로드는 사진과 다른 처리 대기 단계가 붙는데 우리 키로 왕복해 본 적이 없다.
     글만 올려 놓고 «올렸다»고 하면 고객은 **영상이 빠진 글**을 보게 된다 — 그건 실패보다 나쁘다.
     («없는 길»을 정직하게 말하는 자리 · CLAUDE §9 의 «게이트가 아니라 사실».) */
  if (piece.kind === "video") {
    return { ok: false, reason: "unsupported_channel", retriable: false,
      error: "X 에는 아직 영상을 올려 드릴 수 없어요. 글만 올릴 수 있어요.", detail: "x_video_not_supported" };
  }
  const tok = await ensureFreshToken(tid, account.id, "x", account.handle);
  if (!tok.ok) {
    if (tok.reason === "provider_not_configured") return { ok: false, reason: "provider_not_configured", retriable: false, error: "X 연결이 아직 준비 중이에요." };
    if (tok.reason === "no_creds") return { ok: false, reason: "no_creds", retriable: false, error: "X 계정을 다시 연결해 주세요." };
    return { ok: false, reason: "auth_failed", retriable: false, error: "X 로그인이 만료됐어요. 다시 연결해 주세요.", detail: tok.detail };
  }
  const token = tok.token.accessToken;

  const text = buildTweet(piece);
  if (!text.trim()) return { ok: false, reason: "not_publishable", retriable: false, error: "올릴 내용이 비어 있어요." };

  /* 사진은 **있으면 좋은 것**이다 — 첫 장만 시도하고, 안 되면 글만 올린다. */
  const first = (piece.images ?? []).map((i) => String(i.url || "").trim()).find(Boolean) ?? "";
  let mediaId: string | null = null;
  if (first) {
    mediaId = await uploadPhoto(token, first);
    if (!mediaId) {
      await writeAudit({ tenantId: tid, action: "x_media_upload_skipped", actorType: "system", target: `piece:${piece.id}`,
        detail: { note: "사진 업로드가 안 돼 글만 올렸다(미디어 업로드는 우리 키로 검증한 적 없는 경로다)" }, riskLevel: "low" })
        .catch((e: unknown) => console.warn("[x] 감사 기록 실패", String((e as Error)?.message ?? e).slice(0, 80)));
    }
  }

  const body: Record<string, unknown> = { text };
  if (mediaId) body.media = { media_ids: [mediaId] };

  const r = await xfetch(`${API}/tweets`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!r) return { ok: false, reason: "network", retriable: true, error: "X 에 연결하지 못했어요. 잠시 후 다시 시도할게요." };
  if (r.status < 200 || r.status >= 300) { const c = xError(r.status, r.json, r.text); return { ok: false, reason: c.reason, retriable: c.retriable, error: c.error, detail: c.detail }; }

  const id = String(r.json?.data?.id ?? "").trim();
  if (!id) return { ok: false, reason: "channel_error", retriable: true, error: "올렸는데 X 가 글 번호를 주지 않았어요.", detail: "no_tweet_id" };
  const handle = String(account.handle || "i").replace(/^@/, "");
  return { ok: true, via: "api", externalUrl: `https://x.com/${encodeURIComponent(handle)}/status/${id}`, channelRef: id };
}
