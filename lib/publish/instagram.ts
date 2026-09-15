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
import { writeAudit } from "../audit";   // [P1R8 §5.1] 파트너십 라벨이 거부되면 조용히 넘기지 않는다
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
const TAG_MAX: Readonly<Record<string, number>> = {
  threads: 1,
  /* [P1R8 §3.4] X 는 글 전체가 **280자**다 — 태그가 본문을 밀어낸다. 법(#광고)이 먼저 쓰고 한 개만 더 허용한다. */
  x: 2,
  /* 페북은 상한이 사실상 없지만, 해시태그 도배는 페이지 도달을 깎는다는 것이 업계 통설이다(공식 수치 없음 · AC-9 로 «모른다»를 «0»으로 바꾸지 않되 보수적으로). */
  facebook: 3, facebook_reels: 3,
};
const TAG_MAX_DEFAULT = 20;

/** 캡션 — 첫 줄 고지 + 본문 + 태그(#광고 포함). 태그 수는 **채널 상한**을 따른다.
 *  `opts.bodyLimit` = 본문을 몇 자까지 실을까(기본 1,500 · X 처럼 짧은 채널이 줄여 쓴다). */
export function buildCaption(piece: PublishPiece, limit = 2_200, opts: { bodyLimit?: number } = {}): string {
  const lines: string[] = [];
  const disc = piece.disclosure ?? (piece.affiliate ? disclosureTextFor(piece.affiliate.provider) : null);
  if (disc) lines.push(disc);
  const body = String(piece.bodyHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (body) lines.push(body.slice(0, Math.max(1, opts.bodyLimit ?? 1_500)));
  const max = TAG_MAX[String(piece.channel ?? "")] ?? TAG_MAX_DEFAULT;
  const tags = (piece.tags ?? []).slice(0, TAG_MAX_DEFAULT).map((t) => `#${String(t).replace(/^#/, "")}`);
  /* 🔴 `#광고` 는 맨 앞이다 — 상한이 1인 채널에서는 **이것 하나만** 남는다(태그 자리를 법이 먼저 쓴다).
     쓰레드는 대가 고지 문장이 이미 본문 첫 줄에 있으므로 이 태그는 보조 표시다. */
  if (piece.affiliate && !tags.some((t) => t === "#광고")) tags.unshift("#광고");
  const shown = tags.slice(0, max);
  if (shown.length) lines.push(shown.join(" "));
  return lines.join("\n\n").slice(0, limit);
}

/**
 * 🔴 **게시 id 로 주소를 «만들어» 내지 않는다 — 인스타는 그렇게 생기지 않았다.**
 *   `media_publish` 가 돌려주는 id 는 숫자(예 `17895695668004550`)인데, 사람이 여는 주소는 **짧은 코드**(`/reel/DAbc1x2y/`)다.
 *   둘은 다른 값이라 `instagram.com/reel/{id}` 는 **열리지 않는다** — 그런데도 발행은 «성공»으로 찍히고
 *   화면의 «글 보기»만 조용히 죽는다(2026-09-15 B2 발견 · AC-55 «돌았나만 보는 검사는 틀린 성공을 초록으로 찍는다»의 같은 얼굴).
 *   ⇒ 주소는 **인스타에 물어본다**(`fields=permalink`). 못 받으면 **주소를 안 만든다** —
 *      게시 자체는 성공했으므로 `channelRef` 만으로 확정하고, 없는 주소를 지어내지 않는다(AC-9).
 */
async function permalinkOf(mediaId: string, token: string): Promise<string> {
  const r = await graph(`${GRAPH}/${encodeURIComponent(mediaId)}?fields=permalink&access_token=${encodeURIComponent(token)}`).catch(() => null);
  const url = String(r?.json?.permalink ?? "").trim();
  return /^https?:\/\//.test(url) ? url : "";
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

/** 메타가 «그 파라미터는 못 쓴다»고 답했나 — 라벨만 빼고 한 번 더 만든다(게시물 자체는 나가야 한다). */
function rejectedPaidLabel(json: Record<string, unknown> | null): boolean {
  const err = (json?.error ?? {}) as { message?: string; error_user_title?: string; code?: number };
  const blob = String(err.message ?? "") + " " + String(err.error_user_title ?? "");
  return blob.includes("is_paid_partnership") || /unknown|invalid parameter|unsupported/i.test(blob);
}

/** 토큰 + ig 사용자 id — 릴스·피드 두 경로가 **똑같이** 쓰는 앞머리(갈리면 한쪽만 고치는 사고가 난다). */
async function igAuth(tid: number, account: PublishAccount, channel: "reels" | "instagram"):
  Promise<{ ok: true; token: string; igUserId: string } | { ok: false; res: PublishResult }> {
  const tok = await ensureFreshToken(tid, account.id, channel, account.handle);
  if (!tok.ok) {
    if (tok.reason === "provider_not_configured") return { ok: false, res: { ok: false, reason: "provider_not_configured", retriable: false, error: "인스타그램 연결이 아직 준비 중이에요." } };
    if (tok.reason === "no_creds") return { ok: false, res: { ok: false, reason: "no_creds", retriable: false, error: "인스타그램 계정을 다시 연결해 주세요." } };
    return { ok: false, res: { ok: false, reason: "auth_failed", retriable: false, error: "인스타그램 로그인이 만료됐어요. 다시 연결해 주세요.", detail: tok.detail } };
  }
  const igUserId = String((tok.token.extra as Record<string, unknown> | undefined)?.igUserId ?? tok.token.externalId ?? "").trim();
  if (!igUserId) return { ok: false, res: { ok: false, reason: "no_creds", retriable: false, error: "인스타그램 계정을 찾지 못했어요. 다시 연결해 주세요." } };
  return { ok: true, token: tok.token.accessToken, igUserId };
}

/* ═══════════════════════ 피드·카드뉴스(캐러셀) — [P1R8 §3.4] ═══════════════════════
 *   릴스와 **같은 3단계**인데 만드는 컨테이너가 다르다.
 *     · 사진 1장   : POST /{ig}/media { image_url, caption }                          → creation_id
 *     · 카드뉴스 N장: POST /{ig}/media { image_url, is_carousel_item:true } × N        → child id
 *                   POST /{ig}/media { media_type:"CAROUSEL", children, caption }      → creation_id
 *                   (캐러셀은 **2~10장** — 1장이면 그냥 사진 글이고 11장부터는 인스타가 거절한다)
 *   🔴 영상과 달리 **처리 대기가 거의 없다** — 그래도 폴링 자리는 같게 둔다(사진이 커서 IN_PROGRESS 가 오는 경우가 있다).
 *   🔴 중간에 죽으면 자식 컨테이너가 고아로 남는데, 인스타가 **24시간 뒤 스스로 버린다**(우리가 치울 것이 없다).
 *      다시 올려도 부모 컨테이너 id 는 `meta` 에 남아 있어 **두 번 게시되지 않는다** — 그게 지켜야 할 선이다.
 */
const FEED_FIELD = "igFeedCreationId";

async function makeChild(igUserId: string, token: string, imageUrl: string): Promise<string> {
  const b = new URLSearchParams({ image_url: imageUrl, is_carousel_item: "true", access_token: token });
  const r = await graph(`${GRAPH}/${encodeURIComponent(igUserId)}/media`, { method: "POST", body: b }).catch(() => null);
  if (!r || r.status < 200 || r.status >= 300) return "";
  return String(r.json?.id ?? "").trim();
}

export async function publishInstagramFeed(piece: PublishPiece, account: PublishAccount): Promise<PublishResult> {
  const tid = piece.tenantId;
  const auth = await igAuth(tid, account, "instagram");
  if (!auth.ok) return auth.res;
  const { token, igUserId } = auth;

  let creationId = await savedCreationId(tid, piece.id, FEED_FIELD);
  if (!creationId) {
    const images = (piece.images ?? []).map((i) => String(i.url || "").trim()).filter(Boolean).slice(0, 10);
    /* 🔴 인스타 피드는 **사진이 없으면 글을 올릴 수 없다** — 이건 우리 규칙이 아니라 플랫폼의 사실이다. */
    if (!images.length) return { ok: false, reason: "not_publishable", retriable: false, error: "인스타그램은 사진이 있어야 올릴 수 있어요.", detail: "no_image" };

    const caption = buildCaption(piece);
    const paid = !!piece.disclosure;
    const mk = (extra: Record<string, string>, withLabel: boolean) => {
      const b = new URLSearchParams({ ...extra, caption, access_token: token });
      if (withLabel) b.set("is_paid_partnership", "true");
      return graph(`${GRAPH}/${encodeURIComponent(igUserId)}/media`, { method: "POST", body: b }).catch(() => null);
    };

    let base: Record<string, string>;
    if (images.length === 1) {
      base = { image_url: images[0] };
    } else {
      const children: string[] = [];
      for (const url of images) { const id = await makeChild(igUserId, token, url); if (id) children.push(id); }
      /* 자식이 2장 미만이면 캐러셀이 안 된다. 🔴 한 장이라도 살아 있으면 **한 장짜리 글로** 내보낸다 —
         «다 되거나 아무것도 안 되거나»보다 «되는 만큼»이 낫다(사진은 부가가 아니라 본체지만, 0장보다 1장이 낫다). */
      if (children.length >= 2) base = { media_type: "CAROUSEL", children: children.join(",") };
      else if (children.length === 1) base = { image_url: images[0] };
      else return { ok: false, reason: "channel_error", retriable: true, error: "인스타그램이 사진을 받지 못했어요. 잠시 후 다시 시도할게요.", detail: "carousel_children_0" };
    }

    let r = await mk(base, paid);
    if (r && paid && (r.status < 200 || r.status >= 300) && rejectedPaidLabel(r.json)) {
      await writeAudit({ tenantId: tid, action: "instagram_paid_label_rejected", actorType: "system", target: `piece:${piece.id}`,
        detail: { status: r.status, surface: "feed", note: "is_paid_partnership 를 받지 않았다 — 캡션 첫 줄 고지로만 나간다" } })
        .catch((err: unknown) => console.warn("[instagram] 감사 기록 실패", String((err as Error)?.message ?? err).slice(0, 80)));
      r = await mk(base, false);
    }
    if (!r) return { ok: false, reason: "network", retriable: true, error: "인스타그램에 연결하지 못했어요. 잠시 후 다시 시도할게요." };
    if (r.status < 200 || r.status >= 300) { const c = metaError(r.status, r.json); return { ok: false, reason: c.reason, retriable: c.retriable, error: c.error, detail: c.detail }; }
    creationId = String(r.json?.id ?? "").trim();
    if (!creationId) return { ok: false, reason: "channel_error", retriable: true, error: "인스타그램이 업로드 번호를 주지 않았어요.", detail: "no_creation_id" };
    await saveCreationId(tid, piece.id, FEED_FIELD, creationId);   // 🔴 먼저 남긴다
  }

  /* 사진은 보통 바로 익는다 — 그래도 한 번은 본다(큰 사진이 IN_PROGRESS 로 오는 경우가 있다). */
  for (let i = 0; i < POLL_TRIES; i++) {
    const s = await graph(`${GRAPH}/${encodeURIComponent(creationId)}?fields=status_code&access_token=${encodeURIComponent(token)}`).catch(() => null);
    const code = String(s?.json?.status_code ?? "").toUpperCase();
    if (code === "FINISHED" || !code) break;
    if (code === "ERROR") { await clearCreationId(tid, piece.id, FEED_FIELD); return { ok: false, reason: "config", retriable: false, error: "인스타그램이 이 사진을 처리하지 못했어요(형식 확인 필요).", detail: "container_error" }; }
    if (i < POLL_TRIES - 1) await sleep(POLL_WAIT_MS);
  }

  const pub = await graph(`${GRAPH}/${encodeURIComponent(igUserId)}/media_publish`, {
    method: "POST", body: new URLSearchParams({ creation_id: creationId, access_token: token }),
  }).catch(() => null);
  if (!pub) return { ok: false, reason: "network", retriable: true, error: "인스타그램에 연결하지 못했어요. 잠시 후 다시 시도할게요." };
  if (pub.status < 200 || pub.status >= 300) { const c = metaError(pub.status, pub.json); return { ok: false, reason: c.reason, retriable: c.retriable, error: c.error, detail: c.detail }; }
  const mediaId = String(pub.json?.id ?? "").trim();
  if (!mediaId) return { ok: false, reason: "channel_error", retriable: true, error: "올렸는데 인스타그램이 게시 번호를 주지 않았어요.", detail: "no_media_id" };

  await clearCreationId(tid, piece.id, FEED_FIELD);
  const link = await permalinkOf(mediaId, token);
  return { ok: true, via: "api", ...(link ? { externalUrl: link } : {}), channelRef: mediaId };
}

export async function publishReels(piece: PublishPiece, account: PublishAccount): Promise<PublishResult> {
  const tid = piece.tenantId;
  const META_FIELD = "igCreationId";

  const auth = await igAuth(tid, account, "reels");
  if (!auth.ok) return auth.res;
  const { token, igUserId } = auth;

  /* ① 컨테이너 — **이미 만들어 둔 게 있으면 그것을 쓴다**(중복 게시 0). */
  let creationId = await savedCreationId(tid, piece.id, META_FIELD);
  if (!creationId) {
    const videoUrl = await videoPublicUrlOf(tid, piece.id);
    if (!videoUrl) return { ok: false, reason: "not_publishable", retriable: false, error: "올릴 영상이 아직 없어요(렌더가 끝나지 않았어요)." };
    /* [P1R8 §5.1] 🔴 **유료 파트너십 라벨** — 대가를 받은 게시물이면 인스타 자체 라벨을 켠다.
       공식 문서(콘텐츠 게시)에 `is_paid_partnership`(불린 · «Enables the ‘Paid partnership’ label»)이 있다.
       🔴 **우리 키로 실호출 확인 전이다**(2026-09-15 · 인스타 계정 0 · 채널 planned) — 그래서 **거부당하면 라벨만 빼고 한 번 더** 만든다.
       캡션 첫 줄의 공정위 고지는 그대로 나가므로, 라벨이 빠져도 «고지 없는 게시물»이 되지는 않는다(AC-9: 빠진 사실은 감사에 남긴다). */
    const paid = !!piece.disclosure;
    const mk = (withLabel: boolean) => {
      const b = new URLSearchParams({ media_type: "REELS", video_url: videoUrl, caption: buildCaption(piece), access_token: token });
      if (withLabel) b.set("is_paid_partnership", "true");
      return graph(`${GRAPH}/${encodeURIComponent(igUserId)}/media`, { method: "POST", body: b }).catch(() => null);
    };
    let r = await mk(paid);
    if (r && paid && (r.status < 200 || r.status >= 300) && rejectedPaidLabel(r.json)) {
      await writeAudit({ tenantId: tid, action: "instagram_paid_label_rejected", actorType: "system", target: `piece:${piece.id}`,
        detail: { status: r.status, note: "is_paid_partnership 를 받지 않았다 — 캡션 첫 줄 고지로만 나간다" } })
        .catch((err: unknown) => console.warn("[instagram] 감사 기록 실패", String((err as Error)?.message ?? err).slice(0, 80)));
      r = await mk(false);
    }
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
  /* 🔴 주소는 인스타에 물어본다(위 `permalinkOf` 주석 — 종전엔 게시 id 로 주소를 «만들어» 열리지 않는 링크를 적었다). */
  const link = await permalinkOf(mediaId, token);
  return { ok: true, via: "api", ...(link ? { externalUrl: link } : {}), channelRef: mediaId };
}
