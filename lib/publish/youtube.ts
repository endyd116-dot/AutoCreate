/**
 * lib/publish/youtube.ts — 유튜브 쇼츠 발행(계약 P1R5 §2.3 · v5.3 §2.3b).
 *   AC 신규 2026-09-14(B2). 관례 출처: `lib/publish/blogger.ts`(같은 구글 OAuth · graceful 반환 · 401 1회 갱신).
 *
 *   규격: Data API v3 **resumable** 업로드(2단계)
 *     ① POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
 *        헤더 X-Upload-Content-Length/Type · 본문 = 메타 → 응답 `Location` 이 업로드 주소
 *     ② PUT <Location> 에 mp4 바이트 → 응답 { id } = videoId
 *
 *   🔴 **심사 전에는 무조건 비공개**(`privacyStatus:"private"`). 구글 OAuth 앱 심사를 통과하기 전에 공개로 올리면
 *      정책 위반이 된다. `YOUTUBE_PUBLIC_ALLOWED=1` 을 사람이 켰을 때만 public — 기본값이 «공개»인 일은 없다.
 *   🔴 `containsSyntheticMedia:true` — AI 로 만든 영상이라는 **사실**을 우리가 먼저 밝힌다(숨기지 않는다).
 *      `selfDeclaredMadeForKids:false` — 아동용이 아니라고 선언(COPPA).
 *   🔴 설명란 **첫 줄**이 제휴 고지(§16B) — 본문 아래에 묻지 않는다.
 *   🔴 쿼터 회로: videos.insert 는 1,600u 로 비싸다(일 10,000u = 6건). 하루 상한을 넘으면 **내일 다시**(retriable).
 *      넘겨서 403 을 맞으면 그날 나머지 발행이 전부 막히므로 우리가 먼저 센다.
 *
 *   이 파일은 **업로드만** 한다 — posts 행·piece 상태는 `finalizePublish` 한 곳(§5 경계).
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { ensureFreshToken } from "./tokens";
import { r2PresignGet, r2Head } from "../r2";
import { disclosureTextFor } from "../disclosure";
import { writeAudit } from "../audit";   // [P1R8 §5.1] 유료 프로모션 플래그가 거부되면 조용히 넘기지 않는다
import type { PublishPiece, PublishAccount, PublishResult } from "./contract";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
/**
 * [P1R8 §5.1] 🔴 **유료 프로모션 공개**(공정위 + 유튜브 정책 둘 다의 요구).
 *   · 유튜브: 스튜디오 체크박스 «동영상에 간접 광고, 스폰서십, 직접 광고와 같은 유료 프로모션이 포함되어 있음» →
 *     시청자에게 «동영상이 시작될 때 10초간» 공개 메시지. https://support.google.com/youtube/answer/154235
 *   · 공정위: 그래도 **영상 내 표시**가 따로 필요하다(«더보기»만으로는 부족) — 우리는 3초 자막 + 상시 배지로 이미 한다.
 *   🔴 **이 필드가 쓰기 가능한지는 확정하지 못했다**(2026-09-15 조사): `videos.insert` 의 `part` 목록에는
 *      `paidProductPlacementDetails` 가 있는데, 문서의 «writable properties» 목록에는 없다.
 *      그래서 **넣어 보고, 거부당하면 빼고 한 번 더 올린다** — 그리고 그 사실을 감사에 남긴다(조용히 빠지지 않게 · AC-9).
 *      영상 안의 자막·배지가 이미 법을 지키고 있어, 이 플래그가 빠져도 «고지 없는 영상»이 나가지는 않는다.
 */
const PAID_PART = "paidProductPlacementDetails";
const uploadUrlWith = (paid: boolean): string => (paid ? `${UPLOAD_URL},${PAID_PART}` : UPLOAD_URL);
/** 구글이 «그 필드는 못 쓴다»고 답했나 — 그러면 플래그만 빼고 한 번 더 올린다(영상 자체는 나가야 한다). */
function rejectedPaidField(json: Record<string, unknown> | null): boolean {
  const err = (json?.error ?? {}) as { message?: string; errors?: { reason?: string; message?: string }[] };
  const blob = `${err.message ?? ""} ${(err.errors ?? []).map((e) => `${e.reason ?? ""} ${e.message ?? ""}`).join(" ")}`;
  return blob.includes(PAID_PART) || /unexpected|invalid.*part|not writable|badRequest/i.test(blob);
}
/** videos.insert 1,600u — 일 10,000u 면 6건이 한계. 기본 5건으로 여유를 둔다. */
/**
 * 하루에 올릴 수 있는 수 — 🔴 **우리 게이트가 아니라 구글 쿼터가 정하는 사실**이다(설계 §2.2).
 *   일 10,000 유닛 중 `videos.insert` 가 1,600 유닛이라 하루 **여섯 건쯤**이 천장이고,
 *   쿼터는 **채널이 아니라 구글 프로젝트** 단위라 우리 고객 전부가 같은 통을 나눠 쓴다(그래서 기본값을 6이 아니라 5로 둔다).
 *
 * 🔴 [R17-B2 · B 가 물어서 잰 자리] 종전엔 이 수가 **이 파일 밖 0곳**이었다 —
 *   즉 **여섯 건째가 될 때까지 아무도 말해 주지 않았다.** «있는데 좁은 길»을 안 알리면
 *   고객은 하루 10건을 편성해 놓고 다섯 건째부터 «내일 이어서»만 본다(§9: 막지 않는 대신 **말해 준다**).
 *   ⇒ `youtubeDailyCap()` 으로 열어 `accounts-list` 가 화면에 실어 준다. **화면은 숫자를 베껴 적지 않는다**(§13 · AC-52).
 */
const DAILY_CAP = Math.max(1, Number(process.env.YOUTUBE_DAILY_INSERT_CAP) || 5);
/** [R17-B2] 화면·다른 서버 코드가 이 수를 물어보는 **하나뿐인 문**. 여기 말고 다른 데 5 를 적지 마라. */
export function youtubeDailyCap(): number { return DAILY_CAP; }
const META_TIMEOUT_MS = 20_000;
/* ═══ [R8-A §4] 해시태그·검색 태그는 **다른 것**이다(공식 문서 실조사 2026-09-15) ═══
   · 설명란 `#해시태그` — 제목 옆엔 **최대 3개**만 노출 · 60개 초과면 전부 무시 · 과도하면 삭제될 수 있다.
     https://support.google.com/youtube/answer/6390658
   · `snippet.tags[]` — «The property value has a **maximum length of 500 characters**» ·
     공백이 든 태그는 따옴표로 감싼 것처럼 계산된다(«Foo Baz» = 9자). https://developers.google.com/youtube/v3/docs/videos
   예전엔 같은 15개를 두 곳에 그대로 넣어 ① 설명란이 해시태그 밭이 되고 ② 500자를 넘길 수 있었다(15 × 30자 = 450자 + 따옴표). */
const DESCRIPTION_HASHTAGS = 4;
const TAGS_MAX_CHARS = 500;
/** 검색 태그 — 500자 누적에서 자른다(공백 포함 태그는 +2자로 세어 안전하게). */
export function youtubeTags(raw: unknown[]): string[] {
  const out: string[] = [];
  let used = 0;
  for (const t of raw) {
    const tag = String(t).replace(/^#/, "").trim().slice(0, 30);
    if (!tag) continue;
    const cost = tag.length + (/\s/.test(tag) ? 2 : 0) + (out.length ? 1 : 0);   // 구분자 1자 + 공백 태그의 따옴표 2자
    if (used + cost > TAGS_MAX_CHARS) break;
    out.push(tag); used += cost;
  }
  return out;
}
const UPLOAD_TIMEOUT_MS = 10 * 60_000;

/** 오늘(KST) 이 테넌트가 유튜브로 올린 건수 — posts 로 센다(성공만 남는 표라 과소·과대 0). */
/**
 * 오늘 유튜브에 몇 개 올렸나(KST 기준).
 *   🔴 [P1R8 §3.4] **쇼츠와 롱폼을 같이 센다** — 쿼터는 채널 키가 아니라 **구글 프로젝트** 단위이기 때문이다.
 *      롱폼을 따로 세면 «쇼츠 5 + 롱폼 5 = 10건»이 되어 우리가 먼저 막으려던 403 을 그대로 맞는다
 *      (그리고 403 을 맞으면 그날 **나머지 발행이 전부** 막힌다 — 그래서 우리가 먼저 센다).
 */
async function todayUploads(tid: number): Promise<number> {
  const [r] = await q(sql`SELECT COUNT(*) c FROM posts
    WHERE tenant_id = ${tid} AND channel IN ('youtube_shorts', 'youtube_long')
      AND created_at >= ((date_trunc('day', (NOW() AT TIME ZONE 'Asia/Seoul')) AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC')`);
  return n(r?.c);
}

/** 이 글의 렌더 결과(mp4) — finalizeRender 가 넣은 piece_assets(kind='video'). */
async function videoAssetOf(tid: number, pieceId: number): Promise<{ key: string } | null> {
  const [a] = await q(sql`SELECT r2_key FROM piece_assets
    WHERE tenant_id = ${tid} AND piece_id = ${pieceId} AND kind = 'video' ORDER BY id DESC LIMIT 1`);
  const key = String(a?.r2_key ?? "").trim();
  return key ? { key } : null;
}

/** 설명란 — 첫 줄 고지(제휴일 때) + 본문 요약 + 태그. */
function buildDescription(piece: PublishPiece): string {
  const lines: string[] = [];
  /* 🔴 첫 줄은 고지. `piece.disclosure` 가 정본(본문 첫 블록과 **같은 문장**) — 없는데 제휴면 문구를 만들어서라도 넣는다.
     설명란에 고지가 빠지면 영상 안 자막만으로는 부족하다(§16B). */
  const disc = piece.disclosure ?? (piece.affiliate ? disclosureTextFor(piece.affiliate.provider) : null);   // [R8-A §4] 협찬·무상 제공은 meta.disclosure 로 이미 완성돼 온다(lib/video/gen)
  if (disc) lines.push(disc);
  const body = String(piece.bodyHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (body) lines.push(body.slice(0, 3_000));
  /* [R8-A §4] 설명란 해시태그는 **3~5개**만 — 유튜브 공식: «가장 참여도가 높은 해시태그가 **최대 3개까지** 동영상 제목 옆에 표시» ·
     «60개가 넘으면 각 해시태그를 무시» · «태그를 과도하게 추가하면 업로드 항목 또는 검색결과에서 동영상이 삭제될 수 있습니다»
     (https://support.google.com/youtube/answer/6390658). 나머지 키워드는 아래 snippet.tags(검색 태그)로 간다 — **둘은 다른 것**이다. */
  /* 🔴 해시태그에는 공백이 들어갈 수 없다 — 공백만 지운다(`\s`). 2026-09-15 한때 `/s+/` 로 적혀 **낱말 속 s 가 지워졌다**
     («#shorts» → «#hort») — 패치 스크립트가 역슬래시를 먹은 자국이다. 정규식은 눈으로 한 번 더 본다. */
  if (piece.tags?.length) lines.push(piece.tags.slice(0, DESCRIPTION_HASHTAGS).map((t) => `#${String(t).replace(/^#/, "").replace(/\s+/g, "")}`).join(" "));
  return lines.join("\n\n").slice(0, 4_900);
}

/** 구글 오류 → 우리 어휘. 계약 §2.3 의 4분류. */
function classify(status: number, json: Record<string, unknown> | null): { reason: "auth_failed" | "channel_error" | "config"; retriable: boolean; error: string; detail: string } {
  const err = (json?.error ?? {}) as { message?: string; errors?: { reason?: string }[] };
  const why = String(err?.errors?.[0]?.reason ?? "").trim();
  const msg = String(err?.message ?? "").slice(0, 200);
  if (why === "quotaExceeded" || why === "rateLimitExceeded" || status === 429) {
    return { reason: "channel_error", retriable: true, error: "오늘 유튜브 업로드 한도를 다 썼어요. 내일 이어서 올릴게요.", detail: `${why || status} ${msg}` };
  }
  if (why === "uploadLimitExceeded") {
    return { reason: "channel_error", retriable: true, error: "유튜브가 오늘은 더 올리지 말라고 해요(채널 한도). 내일 다시 시도할게요.", detail: msg };
  }
  if (status === 401) return { reason: "auth_failed", retriable: false, error: "유튜브 로그인이 만료됐어요. 계정을 다시 연결해 주세요.", detail: msg };
  if (status === 403 || why === "forbidden" || why === "insufficientPermissions") {
    return { reason: "auth_failed", retriable: false, error: "유튜브 업로드 권한이 없어요. 계정을 다시 연결해 «업로드» 권한을 허용해 주세요.", detail: `${why} ${msg}` };
  }
  if (status >= 500) return { reason: "channel_error", retriable: true, error: "유튜브가 지금 응답하지 않아요. 잠시 후 다시 시도할게요.", detail: `${status} ${msg}` };
  return { reason: "config", retriable: false, error: "유튜브가 이 영상을 받지 않았어요.", detail: `${status} ${why} ${msg}` };
}

/** [P1R8 §3.4] 유튜브 축은 두 채널이다 — 올리는 코드는 **한 벌**이고 주소와 계정 채널만 갈린다. */
export type YoutubeChannel = "youtube_shorts" | "youtube_long";

/**
 * 유튜브 업로드(쇼츠·롱폼 공용). 성공하면 `{ ok:true, via:"api", externalUrl, channelRef:videoId }`.
 *   🔴 posts 행·piece 상태는 만들지 않는다 — 호출부(배경 함수)가 `finalizePublish` 로 한 곳에서 쓴다.
 *   🔴 **쇼츠와 롱폼의 차이는 «길이»뿐**이고 API 는 같다(`videos.insert`). 그래서 분기를 만들지 않고 **주소만** 가른다 —
 *      «짧으면 쇼츠 자리에 뜬다»는 유튜브가 알아서 정하는 것이지 우리가 플래그로 켜는 것이 아니다.
 */
export async function publishYoutube(piece: PublishPiece, account: PublishAccount, channel: YoutubeChannel = "youtube_shorts"): Promise<PublishResult> {
  const tid = piece.tenantId;

  // ① 쿼터 회로 — 맞고 나서 배우지 않는다(403 을 맞으면 그날 나머지가 전부 막힌다).
  const used = await todayUploads(tid);
  if (used >= DAILY_CAP) {
    return { ok: false, reason: "channel_error", retriable: true,
      error: `오늘 유튜브에 올릴 수 있는 만큼 다 올렸어요(${used}/${DAILY_CAP}). 내일 이어서 올릴게요.`,
      detail: `daily_cap ${used}/${DAILY_CAP}` };
  }

  // ② 영상 파일 — 렌더가 끝나 있어야 한다.
  const asset = await videoAssetOf(tid, piece.id);
  if (!asset) return { ok: false, reason: "not_publishable", retriable: false, error: "올릴 영상이 아직 없어요(렌더가 끝나지 않았어요)." };
  const head = await r2Head(asset.key);
  if (!head || head.bytes <= 0) return { ok: false, reason: "not_publishable", retriable: false, error: "영상 파일을 찾지 못했어요.", detail: asset.key.slice(0, 80) };

  // ③ 토큰
  let tok = await ensureFreshToken(tid, account.id, channel, account.handle);
  if (!tok.ok) {
    if (tok.reason === "provider_not_configured") return { ok: false, reason: "provider_not_configured", retriable: false, error: "유튜브 연결이 아직 준비 중이에요." };
    if (tok.reason === "no_creds") return { ok: false, reason: "no_creds", retriable: false, error: "유튜브 계정을 다시 연결해 주세요." };
    return { ok: false, reason: "auth_failed", retriable: false, error: "유튜브 로그인이 만료됐어요. 다시 연결해 주세요.", detail: tok.detail };
  }

  // 🔴 심사 전 기본은 비공개. 사람이 명시로 켰을 때만 공개.
  const privacyStatus = process.env.YOUTUBE_PUBLIC_ALLOWED === "1" ? "public" : "private";
  /* [P1R8 §5.1] 대가를 받은 영상인가 — `disclosure` 는 제휴·협찬·무상 제공 **셋 중 하나라도** 있으면 채워져 온다(lib/disclosure). */
  const paid = !!piece.disclosure;
  const metaBase = {
    snippet: {
      title: String(piece.title || "").slice(0, 100),
      description: buildDescription(piece),
      tags: youtubeTags(piece.tags ?? []),
      categoryId: "22",
    },
    /* 🔴 [AC-253 · 2026-09-23] **유료 프로모션 신고** — 유튜브 `status.paidPromotion` 은
       «원고료·PPL 을 받았다»(sponsored)일 때 켜는 칸이다.
       🔴 **`disclosure` 유무로 켜지 않는다** — 제휴 수수료(affiliate)만 있는 글까지 «유료 광고»로 신고하게 된다(거짓 신고).
          공정위 고지는 대가 3종에 다 켜지지만 **플랫폼 신고 칸은 그중 일부**다(`lib/publish/contract.ts compensationKinds`).
       ⚠️ 칸이 안 실려 왔으면(`?? []`) **켜지 않는다** — «대가 없음»이 아니라 «안 실렸다»일 수 있어 안전한 쪽으로 기운다(AC-9).
       ⚠️ 이 칸은 **끄는 값을 보내지 않는다**: false 를 굳이 실어 보내면 «아니라고 우리가 말한 것»이 된다 —
          모르면 **아무 말도 안 하는 것**이 정직하다. */
    status: {
      privacyStatus, selfDeclaredMadeForKids: false, containsSyntheticMedia: true,
      ...((piece.compensationKinds ?? []).includes("sponsored") ? { paidPromotion: true } : {}),
    },
  };
  let meta = paid ? { ...metaBase, [PAID_PART]: { hasPaidProductPlacement: true } } : metaBase;
  let paidFlagDropped = false;

  const start = async (accessToken: string) => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), META_TIMEOUT_MS);
    try {
      const r = await fetch(uploadUrlWith(paid && !paidFlagDropped), {
        method: "POST", signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=utf-8",
          "X-Upload-Content-Type": "video/mp4",
          "X-Upload-Content-Length": String(head.bytes),
        },
        body: JSON.stringify(meta),
      });
      let json: Record<string, unknown> | null = null;
      if (!r.ok) { try { json = await r.json() as Record<string, unknown>; } catch { /* 본문 없음 */ } }
      return { status: r.status, location: r.headers.get("location") || "", json };
    } finally { clearTimeout(t); }
  };

  let s: Awaited<ReturnType<typeof start>>;
  try { s = await start(tok.token.accessToken); }
  catch (e) { return { ok: false, reason: "network", retriable: true, error: "유튜브에 연결하지 못했어요. 잠시 후 다시 시도할게요.", detail: String((e as Error)?.message ?? e).slice(0, 160) }; }

  // 401 = 토큰 — 강제 갱신 후 딱 한 번 재시도(무한 금지 · blogger 관례).
  if (s.status === 401) {
    tok = await ensureFreshToken(tid, account.id, channel, account.handle, true);
    if (!tok.ok) return { ok: false, reason: "auth_failed", retriable: false, error: "유튜브 로그인이 만료됐어요. 다시 연결해 주세요.", detail: tok.detail };
    try { s = await start(tok.token.accessToken); }
    catch (e) { return { ok: false, reason: "network", retriable: true, error: "유튜브에 연결하지 못했어요.", detail: String((e as Error)?.message ?? e).slice(0, 160) }; }
  }
  /* [P1R8 §5.1] 🔴 유료 프로모션 플래그를 구글이 거부하면 **플래그만 빼고 한 번 더** 올린다.
     영상 안 자막·배지가 이미 고지를 지고 있으므로 «고지 없는 영상»이 나가지는 않는다.
     🔴 대신 **조용히 넘어가지 않는다** — 감사에 남겨 다음 사람이 «API 로는 못 켠다»를 사실로 알게 한다(AC-9). */
  if (paid && !paidFlagDropped && (s.status < 200 || s.status >= 300) && rejectedPaidField(s.json)) {
    paidFlagDropped = true;
    meta = metaBase;
    await writeAudit({ tenantId: tid, action: "youtube_paid_flag_rejected", actorType: "system", target: `piece:${piece.id}`,
      detail: { status: s.status, note: "videos.insert 가 paidProductPlacementDetails 를 받지 않았다 — 영상 내 자막·배지로만 고지", error: String((s.json?.error as { message?: string } | undefined)?.message ?? "").slice(0, 200) } })
      .catch((err: unknown) => console.warn("[youtube] 감사 기록 실패", String((err as Error)?.message ?? err).slice(0, 80)));
    try { s = await start(tok.token.accessToken); }
    catch (e) { return { ok: false, reason: "network", retriable: true, error: "유튜브에 연결하지 못했어요.", detail: String((e as Error)?.message ?? e).slice(0, 200) }; }
  }
  if (s.status < 200 || s.status >= 300 || !s.location) {
    const c = classify(s.status, s.json);
    return { ok: false, reason: c.reason, retriable: c.retriable, error: c.error, detail: c.detail };
  }

  /* ④ 바이트 전송 — R2 에서 받아 **그대로 흘려보낸다**(메모리에 통째로 담지 않는다).
     스트림 본문을 못 쓰는 런타임이면 버퍼로 내려앉는다(기능이 죽지 않게). */
  const getUrl = await r2PresignGet(asset.key, 3_600);
  const src = await fetch(getUrl, { signal: AbortSignal.timeout(120_000) }).catch(() => null);
  if (!src || !src.ok || !src.body) return { ok: false, reason: "network", retriable: true, error: "영상 파일을 읽지 못했어요. 잠시 후 다시 시도할게요." };

  const putOnce = async (body: BodyInit, duplex: boolean) => {
    const init: RequestInit & { duplex?: string } = {
      method: "PUT", body,
      headers: { Authorization: `Bearer ${tok.ok ? tok.token.accessToken : ""}`, "Content-Type": "video/mp4", "Content-Length": String(head.bytes) },
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    };
    if (duplex) init.duplex = "half";
    return fetch(s.location, init);
  };

  let up: Response;
  try {
    up = await putOnce(src.body as unknown as BodyInit, true);
  } catch {
    const buf = await (await fetch(getUrl, { signal: AbortSignal.timeout(120_000) })).arrayBuffer().catch(() => null);
    if (!buf) return { ok: false, reason: "network", retriable: true, error: "영상 전송에 실패했어요. 잠시 후 다시 시도할게요." };
    try { up = await putOnce(buf, false); }
    catch (e) { return { ok: false, reason: "network", retriable: true, error: "영상 전송에 실패했어요. 잠시 후 다시 시도할게요.", detail: String((e as Error)?.message ?? e).slice(0, 160) }; }
  }

  let upJson: Record<string, unknown> | null = null;
  try { upJson = await up.json() as Record<string, unknown>; } catch { /* 본문 없음 */ }
  if (!up.ok) {
    const c = classify(up.status, upJson);
    return { ok: false, reason: c.reason, retriable: c.retriable, error: c.error, detail: c.detail };
  }
  const videoId = String(upJson?.id ?? "").trim();
  if (!videoId) return { ok: false, reason: "channel_error", retriable: true, error: "올렸는데 유튜브가 영상 번호를 주지 않았어요.", detail: "no_video_id" };

  /* 주소만 갈린다 — `/shorts/…` 는 짧은 영상 전용 뷰어라 롱폼을 그 주소로 적으면 유튜브가 `/watch` 로 되돌린다.
     되돌려지긴 하지만 **우리가 적은 주소가 그 글의 주소가 아닌 것**은 그대로라, 처음부터 맞게 적는다. */
  const externalUrl = channel === "youtube_long"
    ? `https://www.youtube.com/watch?v=${videoId}`
    : `https://www.youtube.com/shorts/${videoId}`;
  return { ok: true, via: "api", externalUrl, channelRef: videoId };
}

/** 쇼츠 — 종전 이름 그대로(호출부 무회귀). */
export const publishYoutubeShorts = (piece: PublishPiece, account: PublishAccount): Promise<PublishResult> => publishYoutube(piece, account, "youtube_shorts");
/** [P1R8 §3.4] 롱폼 — 같은 코드·다른 주소. */
export const publishYoutubeLong = (piece: PublishPiece, account: PublishAccount): Promise<PublishResult> => publishYoutube(piece, account, "youtube_long");
