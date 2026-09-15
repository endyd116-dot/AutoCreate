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
import { videoPublicUrlOf } from "./instagram";   // [R9-9] 구운 mp4 의 공개 주소 — 인스타·페북·X 가 **같은 한 벌**을 쓴다
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

/* ───────── [R9-9] 영상 — 사진과 **같은 청크 업로드**에 «처리 대기» 한 단계가 더 붙는다 ───────── */

const MAX_VIDEO_BYTES = 512 * 1024 * 1024;   // X 의 영상 상한(공식 512MB) — 우리 쇼츠는 한참 아래다
const PROC_TRIES = 12;
const PROC_WAIT_MS = 5_000;

/**
 * 🔴 **왜 종전에 «못 올린다»였나**(2026-09-16 재측정 · B2):
 *   옛 주석은 「영상 업로드는 사진과 다른 처리 대기 단계가 붙는데 우리 키로 왕복해 본 적이 없다」였다.
 *   다시 재 보니 **«다른 길»이 아니라 «같은 길 + 한 단계»**다 — `initialize/append/finalize` 는 사진과 **똑같고**,
 *   영상만 `finalize` 응답에 `processing_info` 가 붙어 «아직 처리 중»을 말한다. 그 한 단계가 이 함수다.
 *   ⇒ 🔴 **«없는 길»이 아니라 «안 만든 길»이었다.** 없는 길은 그대로 두는 게 맞지만(CLAUDE §9) 안 만든 길은 만든다(§8).
 *
 * 🔴 **우리 키로 실호출해 본 적은 아직 없다**(X 계정 0 · 2026-09-16). 그래서:
 *   ① 실패하면 **글만 올리지 않는다** — 영상이 빠진 글은 실패보다 나쁘다(옛 주석의 판단을 그대로 지킨다).
 *   ② 처리 중이면 «실패»가 아니라 **«다음 틱에»**(retriable) 로 돌려준다.
 * @returns media_id | null(못 올렸다) | "pending"(아직 처리 중 — 다음 틱에)
 */
async function uploadVideo(token: string, videoUrl: string): Promise<string | null | "pending"> {
  try {
    const src = await fetch(videoUrl).catch(() => null);
    if (!src?.ok) return null;
    const buf = Buffer.from(await src.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > MAX_VIDEO_BYTES) return null;

    const init = await xfetch(`${API}/media/upload/initialize`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ media_type: "video/mp4", total_bytes: buf.byteLength, media_category: "tweet_video" }),
    });
    const mediaId = String(init.json?.data?.id ?? init.json?.id ?? "").trim();
    if (!mediaId) return null;

    for (let i = 0, seg = 0; i < buf.byteLength; i += CHUNK, seg++) {
      const fd = new FormData();
      fd.set("segment_index", String(seg));
      fd.set("media", new Blob([buf.subarray(i, Math.min(i + CHUNK, buf.byteLength))]));
      const ap = await xfetch(`${API}/media/upload/${encodeURIComponent(mediaId)}/append`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd }, 120_000);
      if (ap.status < 200 || ap.status >= 300) return null;
    }
    const fin = await xfetch(`${API}/media/upload/${encodeURIComponent(mediaId)}/finalize`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (fin.status < 200 || fin.status >= 300) return null;

    /* 🔴 **여기가 사진과 다른 유일한 한 단계.** `processing_info` 가 없으면 이미 끝난 것이다(짧은 영상은 그렇다). */
    let info = (fin.json?.data?.processing_info ?? fin.json?.processing_info ?? null) as { state?: string; check_after_secs?: number } | null;
    for (let i = 0; i < PROC_TRIES && info && info.state && info.state !== "succeeded"; i++) {
      if (info.state === "failed") return null;
      await new Promise((r) => setTimeout(r, Math.min(30_000, Math.max(PROC_WAIT_MS, Number(info?.check_after_secs ?? 0) * 1000))));
      const st = await xfetch(`${API}/media/upload?media_id=${encodeURIComponent(mediaId)}&command=STATUS`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
      if (!st) return "pending";
      info = (st.json?.data?.processing_info ?? st.json?.processing_info ?? null) as typeof info;
      if (!info) break;                       // 처리 정보가 사라졌다 = 끝났다
    }
    /* 🔴 아직 처리 중이면 **«성공»으로 만들지 않는다** — 그 상태로 트윗을 올리면 X 가 거절하거나 빈 영상이 붙는다. */
    if (info && info.state && info.state !== "succeeded") return "pending";
    return mediaId;
  } catch { return null; }
}

/* ───────── 정본 ───────── */

export async function publishToX(piece: PublishPiece, account: PublishAccount): Promise<PublishResult> {
  const tid = piece.tenantId;
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
  /* [R9-9] 🔴 **영상 글** — 사진과 달리 «있으면 좋은 것»이 아니다. 영상이 본체라 **못 올리면 글도 안 올린다**
     (옛 주석의 판단을 그대로 지킨다: 「글만 올려 놓고 «올렸다»고 하면 고객은 **영상이 빠진 글**을 보게 된다」). */
  if (piece.kind === "video") {
    const videoUrl = await videoPublicUrlOf(tid, piece.id);
    if (!videoUrl) return { ok: false, reason: "not_publishable", retriable: false, error: "올릴 영상이 아직 없어요(만드는 중이에요)." };
    const vid = await uploadVideo(token, videoUrl);
    if (vid === "pending") {
      return { ok: false, reason: "channel_error", retriable: true, error: "X 가 영상을 처리하는 중이에요. 잠시 뒤 다시 올릴게요.", detail: "x_video_processing" };
    }
    if (!vid) {
      /* 🔴 실패를 **조용히 글만 올리기로** 바꾸지 않는다(AC-93 ③ — 실패를 0 으로 바꾸지 마라의 발행판). */
      await writeAudit({ tenantId: tid, action: "x_video_upload_failed", actorType: "system", target: `piece:${piece.id}`,
        detail: { note: "영상 업로드 실패 — 글만 올리지 않고 멈췄다(우리 키로 아직 실호출 검증 전인 경로다)" }, riskLevel: "high" })
        .catch((e: unknown) => console.warn("[x] 감사 기록 실패", String((e as Error)?.message ?? e).slice(0, 80)));
      return { ok: false, reason: "channel_error", retriable: true, error: "X 에 영상을 올리지 못했어요. 잠시 후 다시 시도할게요.", detail: "x_video_upload_failed" };
    }
    return await postTweet(tid, piece, token, text, vid);
  }

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

  return await postTweet(tid, piece, token, text, mediaId, account.handle);
}

/** 트윗 한 건 올리기 — 🔴 **글 경로와 영상 경로가 같은 함수를 쓴다**(두 벌이면 한쪽만 고치는 사고가 난다). */
async function postTweet(
  tid: number, piece: PublishPiece, token: string, text: string, mediaId: string | null, handleIn?: string,
): Promise<PublishResult> {
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
  const handle = String(handleIn || "i").replace(/^@/, "");
  void tid;
  return { ok: true, via: "api", externalUrl: `https://x.com/${encodeURIComponent(handle)}/status/${id}`, channelRef: id };
}
