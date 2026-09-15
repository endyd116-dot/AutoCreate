/**
 * lib/publish/tiktok.ts — **틱톡** 발행 커넥터(DESIGN §2.2 «API(Content Posting) · 심사 전 «본인만 보기» 고정»).
 *   AC 신규 2026-09-15(B2 · 계약 P1R8 §3.4). 관례 출처: `lib/publish/instagram.ts`(컨테이너 id 를 먼저 남겨 중복 0).
 *
 *   ══ 규격(Content Posting API v2 · 2026-09 확인치) ══
 *     ① POST /v2/post/publish/creator_info/query/    → { privacy_level_options, max_video_post_duration_sec, … }
 *     ② POST /v2/post/publish/video/init/            { post_info:{ title, privacy_level, … }, source_info:{ source:"PULL_FROM_URL", video_url } }
 *                                                    → { data:{ publish_id } }
 *     ③ POST /v2/post/publish/status/fetch/          { publish_id } → { data:{ status, publicaly_available_post_id } }
 *
 *   ══ 🔴 이 채널에서 «없는 길»이 세 개다(게이트가 아니라 사실이다 · CLAUDE §9) ══
 *     1. **심사 전에는 «본인만 보기»만 된다.** 미승인 앱이 공개로 올리면 틱톡이 거절한다
 *        (`unaudited_client_can_only_post_to_private_accounts`). 우리 판단이 아니라 **플랫폼의 사실**이다.
 *     2. **`PULL_FROM_URL` 은 도메인 소유 확인을 먼저 해야 한다** — 개발자 포털에 우리 R2 공개 도메인을 등록해야
 *        틱톡이 영상을 내려받는다. 안 돼 있으면 `url_ownership_unverified` 가 오고, 우리는 **그 말을 그대로 전한다**
 *        («틱톡이 이 주소에서 영상을 못 가져가요» — «업로드 실패»로 뭉개면 아무도 원인을 못 찾는다).
 *     3. **틱톡에는 삭제 API 가 없다** — 그래서 `channel-registry.retractVia` 가 `null` 이고 «내려 주기» 단추가 안 뜬다.
 *        없는 길을 단추로 만들지 않는다.
 *
 *   🔴 `publish_id` 를 `piece.meta.ttPublishId` 에 **먼저** 남긴다 — 여기서 죽어도 다음 틱이 이어받고 두 번 안 올린다.
 *   🔴 «본인만 보기»로 올라간 글은 **공개 주소가 없다.** 그럴 땐 `externalUrl` 을 **안 만든다**(없는 주소를 지어내지 않는다 · AC-9).
 *      `channelRef`(publish_id) 만으로 `finalizePublish` 가 확정한다.
 *   ⬜ **우리 키로 실호출한 적이 없다**(2026-09-15 · `TIKTOK_CLIENT_KEY` 미등록 · 채널 planned). 코드는 완성 · «키 꽂으면 가동».
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../db-util";
import { ensureFreshToken } from "./tokens";
import { buildCaption, videoPublicUrlOf } from "./instagram";
import { writeAudit } from "../audit";
import type { PublishPiece, PublishAccount, PublishResult } from "./contract";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

const API = "https://open.tiktokapis.com/v2";
const TIMEOUT_MS = 30_000;
const POLL_TRIES = 3;
const POLL_WAIT_MS = 5_000;
const META_FIELD = "ttPublishId";
/** 틱톡 제목(캡션) 상한 — 공식 2,200자. */
const TITLE_MAX = 2_200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tt(path: string, token: string, body?: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${API}${path}`, {
      method: "POST", signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body ?? {}),
    });
    let json: any = null; try { json = await r.json(); } catch { /* 본문 없음 */ }
    return { status: r.status, json };
  } finally { clearTimeout(t); }
}

/**
 * 🔴 틱톡은 **HTTP 200 이어도 실패일 수 있다** — 실패가 본문의 `error.code` 로 온다.
 *   `error.code === "ok"` 일 때만 성공이다. 상태코드만 보면 «성공한 실패»를 초록으로 찍는다(AC-55 계열).
 */
function ttFail(status: number, json: any): { reason: "auth_failed" | "channel_error" | "config" | "not_publishable"; retriable: boolean; error: string; detail: string } | null {
  const code = String(json?.error?.code ?? (status >= 200 && status < 300 ? "ok" : "http_error"));
  if (code === "ok") return null;
  const msg = String(json?.error?.message ?? "").slice(0, 200);
  if (status === 401 || code === "access_token_invalid" || code === "scope_not_authorized") {
    return { reason: "auth_failed", retriable: false, error: "틱톡 로그인이 만료됐어요. 계정을 다시 연결해 주세요.", detail: `${code} ${msg}` };
  }
  if (code === "rate_limit_exceeded" || status === 429) {
    return { reason: "channel_error", retriable: true, error: "틱톡 요청 한도에 걸렸어요. 잠시 후 다시 올릴게요.", detail: `${code} ${msg}` };
  }
  if (code === "url_ownership_unverified") {
    /* 🔴 원인을 그대로 말한다 — 이건 고객이 아니라 **우리가** 개발자 포털에서 도메인을 등록해야 풀린다. */
    return { reason: "config", retriable: false, error: "틱톡이 우리 영상 주소를 아직 신뢰하지 않아요. 담당이 확인합니다.", detail: `${code} (R2 공개 도메인을 틱톡 개발자 포털에 등록해야 한다) ${msg}` };
  }
  if (code === "unaudited_client_can_only_post_to_private_accounts") {
    return { reason: "config", retriable: false, error: "틱톡 앱 심사 전이라 «본인만 보기»로만 올릴 수 있어요.", detail: `${code} ${msg}` };
  }
  if (code === "spam_risk_too_many_posts" || code === "spam_risk_user_banned_from_posting") {
    return { reason: "channel_error", retriable: true, error: "틱톡이 오늘은 더 올리지 말라고 해요. 내일 다시 올릴게요.", detail: `${code} ${msg}` };
  }
  if (status >= 500) return { reason: "channel_error", retriable: true, error: "틱톡이 지금 응답하지 않아요. 잠시 후 다시 시도할게요.", detail: `${status} ${code} ${msg}` };
  return { reason: "config", retriable: false, error: "틱톡이 이 영상을 받지 않았어요.", detail: `${status} ${code} ${msg}` };
}

async function savedPublishId(tid: number, pieceId: number): Promise<string> {
  const [p] = await q(sql`SELECT meta FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId} LIMIT 1`);
  const meta = (p?.meta && typeof p.meta === "object" ? p.meta : {}) as Record<string, unknown>;
  return String(meta[META_FIELD] ?? "").trim();
}

export async function publishToTiktok(piece: PublishPiece, account: PublishAccount): Promise<PublishResult> {
  const tid = piece.tenantId;
  const tok = await ensureFreshToken(tid, account.id, "tiktok", account.handle);
  if (!tok.ok) {
    if (tok.reason === "provider_not_configured") return { ok: false, reason: "provider_not_configured", retriable: false, error: "틱톡 연결이 아직 준비 중이에요." };
    if (tok.reason === "no_creds") return { ok: false, reason: "no_creds", retriable: false, error: "틱톡 계정을 다시 연결해 주세요." };
    return { ok: false, reason: "auth_failed", retriable: false, error: "틱톡 로그인이 만료됐어요. 다시 연결해 주세요.", detail: tok.detail };
  }
  const token = tok.token.accessToken;

  let publishId = await savedPublishId(tid, piece.id);

  if (!publishId) {
    const videoUrl = await videoPublicUrlOf(tid, piece.id);
    if (!videoUrl) return { ok: false, reason: "not_publishable", retriable: false, error: "올릴 영상이 아직 없어요(렌더가 끝나지 않았어요)." };

    /* ① 작성자 정보 — 틱톡 연동 지침이 **올리기 전에 부르라**고 요구한다(고객의 공개 범위 선택지를 받아야 한다). */
    const ci = await tt("/post/publish/creator_info/query/", token).catch(() => null);
    if (!ci) return { ok: false, reason: "network", retriable: true, error: "틱톡에 연결하지 못했어요. 잠시 후 다시 시도할게요." };
    const ciFail = ttFail(ci.status, ci.json);
    if (ciFail) return { ok: false, reason: ciFail.reason, retriable: ciFail.retriable, error: ciFail.error, detail: `creator_info ${ciFail.detail}` };
    const options = (ci.json?.data?.privacy_level_options as unknown[] | undefined)?.map(String) ?? [];

    /* ② 공개 범위 — 🔴 «없는 길»이지 우리 게이트가 아니다(파일 머리말 1번).
       앱이 심사를 통과했고(`TIKTOK_DIRECT_POST_AUDITED=1`) 그 계정이 공개를 허용할 때만 공개로 올린다. */
    const audited = String(process.env.TIKTOK_DIRECT_POST_AUDITED ?? "") === "1";
    const wantPublic = audited && options.includes("PUBLIC_TO_EVERYONE");
    const privacy = wantPublic ? "PUBLIC_TO_EVERYONE" : (options.includes("SELF_ONLY") ? "SELF_ONLY" : options[0] ?? "SELF_ONLY");

    const init = await tt("/post/publish/video/init/", token, {
      post_info: {
        title: buildCaption(piece, TITLE_MAX),
        privacy_level: privacy,
        disable_duet: false, disable_comment: false, disable_stitch: false,
        /* 🔴 AI 로 만든 영상임을 밝힌다 — 유튜브의 `containsSyntheticMedia` 와 같은 자리다(§16B 대가·표시). */
        is_aigc: true,
        /* 제휴 글이면 «상업적 콘텐츠»로 표시한다 — 틱톡의 브랜디드 콘텐츠 토글에 해당한다. */
        ...(piece.affiliate ? { brand_content_toggle: true, brand_organic_toggle: false } : {}),
      },
      source_info: { source: "PULL_FROM_URL", video_url: videoUrl },
    }).catch(() => null);
    if (!init) return { ok: false, reason: "network", retriable: true, error: "틱톡에 연결하지 못했어요. 잠시 후 다시 시도할게요." };
    const initFail = ttFail(init.status, init.json);
    if (initFail) return { ok: false, reason: initFail.reason, retriable: initFail.retriable, error: initFail.error, detail: `init ${initFail.detail}` };

    publishId = String(init.json?.data?.publish_id ?? "").trim();
    if (!publishId) return { ok: false, reason: "channel_error", retriable: true, error: "틱톡이 업로드 번호를 주지 않았어요.", detail: "no_publish_id" };
    await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ [META_FIELD]: publishId })}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${piece.id}`);

    if (!wantPublic) {
      /* «본인만 보기»로 나갔다는 사실을 남긴다 — 나중에 «왜 안 보이냐»는 질문의 답이 여기 있어야 한다. */
      await writeAudit({ tenantId: tid, action: "tiktok_private_only", actorType: "system", target: `piece:${piece.id}`,
        detail: { privacy, audited, options }, riskLevel: "low" })
        .catch((e: unknown) => console.warn("[tiktok] 감사 기록 실패", String((e as Error)?.message ?? e).slice(0, 80)));
    }
  }

  /* ③ 상태 — 짧게만 본다. 아직이면 «실패»가 아니라 «다음 틱에»(publish_id 는 남겨 둔다 · 중복 0). */
  let status = ""; let postId = "";
  for (let i = 0; i < POLL_TRIES; i++) {
    const st = await tt("/post/publish/status/fetch/", token, { publish_id: publishId }).catch(() => null);
    const stFail = st ? ttFail(st.status, st.json) : null;
    if (stFail?.retriable === false && stFail.reason !== "config") break;
    status = String(st?.json?.data?.status ?? "").toUpperCase();
    /* ⚠️ 필드 이름의 오타(`publicaly`)는 **틱톡 쪽 규격 그대로**다 — 고쳐 적으면 영영 빈 값이 온다. */
    const ids = (st?.json?.data?.publicaly_available_post_id as unknown[] | undefined) ?? [];
    if (ids.length) postId = String(ids[0]);
    if (status === "PUBLISH_COMPLETE") break;
    if (status === "FAILED") {
      await q(sql`UPDATE pieces SET meta = meta - ${META_FIELD}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${piece.id}`);
      const reason = String(st?.json?.data?.fail_reason ?? "").slice(0, 120);
      return { ok: false, reason: "config", retriable: false, error: "틱톡이 이 영상을 처리하지 못했어요(형식 확인 필요).", detail: `fail_reason=${reason || "unknown"}` };
    }
    if (i < POLL_TRIES - 1) await sleep(POLL_WAIT_MS);
  }
  if (status !== "PUBLISH_COMPLETE") {
    return { ok: false, reason: "video_processing", retriable: true, error: "틱톡이 영상을 올리는 중이에요. 잠시 뒤에 확인할게요.", detail: `status=${status || "unknown"}` };
  }

  await q(sql`UPDATE pieces SET meta = meta - ${META_FIELD}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${piece.id}`);

  /* 🔴 공개 주소는 **있을 때만** 만든다. «본인만 보기»는 공개 주소가 없고, 그 사실이 곧 정답이다.
     (프로필 주소를 «이 글의 주소»라고 적으면 화면의 «글 보기»가 엉뚱한 데로 간다.) */
  const handle = String(account.handle || "").replace(/^@/, "");
  if (postId && handle) {
    return { ok: true, via: "api", externalUrl: `https://www.tiktok.com/@${encodeURIComponent(handle)}/video/${postId}`, channelRef: postId };
  }
  return { ok: true, via: "api", channelRef: publishId };
}
