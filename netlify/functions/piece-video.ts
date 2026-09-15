/**
 * 계정 없이 만든 영상을 **내 손으로 올리는** 두 걸음(계약 R7 §1.3). 한 이야기라 한 파일에 둔다
 *   (§1.2 로 계정 없이도 영상이 만들어지게 됐다 → 그 영상이 **밖으로 나가는 문**이 여기다. 문이 없으면 §1.2 는 창고에 쌓기만 한다).
 *
 *   GET  /api/piece-video?id=                      → { ok, pieceId, url(10분), filename, bytes, durationSec, channel, expiresInSec,
 *                                                       handoff? }  ← 우리가 못 올리는 채널(클립)일 때만: { openUrl, openLabel, appOpenVerified, steps[], why }
 *                                                     · 영상 파일이 아직 없으면 404 `step:"no_render"`(+ stage 로 «어디까지 왔나»)
 *   POST /api/post-mark-published { pieceId, url } → { ok, postId, pieceId, already, url, channelRef?, slotId?, channel }
 *                                                     · 400 `step:"url"`(https·채널 도메인 대조) · 400 `step:"status"` · 403 `step:"tenant"` · 404 `step:"not_found"`
 *
 *   ══ 지키는 것 ══
 *     · 🔴 **상태를 쓰는 자리는 하나다**(계약 §10) — posts 행·piece.published·slot 동기화·계정 카운터는 `finalizePublish` 만 건드린다.
 *       여기서 `INSERT INTO posts` 를 직접 하면 멱등(동시 호출)·알림·감사가 두 벌이 된다.
 *     · 🔴 `requireWritable` 을 **부르지 않는다**. 이건 «이미 밖에 나간 일을 기록»하는 경로다 —
 *       체험이 끝난 테넌트를 막으면 이미 올라간 글의 주소를 영영 못 적고, 그 글의 수익도 못 붙는다(돈이 드는 경로가 아니다).
 *     · 테넌트 스코프는 `auth.tid` 로만(body 의 tenantId 를 믿지 않는다 · `lib/guards.ts` 머리말).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { q } from "../../lib/accounts";
import { r2PresignGet, r2Head, r2Configured } from "../../lib/r2";
import { videoFilename } from "../../lib/video/types";
import { manualHandoffFor } from "../../lib/manual-upload";
import { checkPublishedUrl, channelLabelKo } from "../../lib/channel-url";
import { finalizePublish } from "../../lib/publish/finalize";
import type { FinalizeInput } from "../../lib/publish/contract";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/piece-video", "/api/post-mark-published"] };
/** netlify dev 의 정적 폴백(`.html` 재시도)이 경로 매칭에서 빠지면 엉뚱한 405 가 보인다 — 꼬리를 떼고 맞춘다(AC-7). */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
type Row = Record<string, unknown>;

/** 내려받기 서명 수명(계약 §1.3 «presign 10분»). 눌러서 받는 동안만 살아 있으면 된다. */
const DOWNLOAD_TTL_SEC = 600;

/** 손으로 «올렸다»고 적을 수 없는 상태 — 아직 파일이 없거나(만드는 중·실패) 검수에서 내린 글이다. */
const MARK_BLOCKED: Readonly<Record<string, string>> = {
  generating: "아직 만들고 있어요. 다 만들어진 뒤에 올린 주소를 적어 주세요.",
  failed: "만들다가 멈춘 글이에요. 다시 만든 뒤에 주소를 적어 주세요.",
  rejected: "검수에서 내린 글이에요. 되살린 뒤에 주소를 적어 주세요.",
};

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const route = routeOf(req);
  try {
    if (route.endsWith("/piece-video")) {
      if (req.method !== "GET") return json({ ok: false, error: "method", step: "method" }, 405);
      return await getVideo(auth.tid, req);
    }
    if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);
    return await markPublished(auth.tid, auth.user.uid, req);
  } catch (err) { return jsonError("piece_video", err); }
};

/* ─────────────────────────── GET /api/piece-video ─────────────────────────── */

async function getVideo(tid: number, req: Request): Promise<Response> {
  const id = n(new URL(req.url).searchParams.get("id"));
  if (!id) return badRequest("어떤 영상인지 알 수 없어요.", "id");

  /* 🔴 piece 는 **테넌트로 좁혀서** 읽는다(남의 영상 id 를 넣어도 «없다»가 된다 — 있고 없고를 알려 주지 않는다).
     mp4 는 `piece_assets(kind='video')` 한 행이다(`lib/video/render-queue.ts` 가 재렌더마다 지우고 다시 넣는다 — 항상 최신 1행). */
  const [row] = await q(sql`
    SELECT p.id, p.title, p.channel, p.kind, p.status, p.meta->>'chainStage' AS stage,
           a.r2_key, a.meta AS asset_meta
      FROM pieces p
      LEFT JOIN piece_assets a ON a.piece_id = p.id AND a.tenant_id = p.tenant_id AND a.kind = 'video'
     WHERE p.tenant_id = ${tid} AND p.id = ${id}
     ORDER BY a.sort LIMIT 1`) as Row[];
  if (!row) return json({ ok: false, error: "영상을 찾을 수 없어요.", step: "not_found" }, 404);

  const stage = String(row.stage ?? "") || (String(row.status) === "failed" ? "failed" : "");
  const key = String(row.r2_key ?? "");
  if (!key) {
    return json({ ok: false, step: "no_render", error: "아직 영상 파일이 없어요. 다 만들어지면 내려받을 수 있어요.", pieceId: id, stage, status: String(row.status) }, 404);
  }
  if (!r2Configured()) return json({ ok: false, step: "r2", error: "저장소가 연결되지 않았어요. 잠시 뒤 다시 해 주세요." }, 503);

  /* 🔴 «있다고 적혀 있다»와 «있다»는 다르다 — 서명을 내주기 전에 R2 를 직접 본다(B2 러너 관례 `r2Head`).
     여기서 안 보면 사용자는 눌렀을 때 R2 의 XML 오류를 보게 된다(우리 화면이 아니라). */
  const head = await r2Head(key);
  if (!head) {
    console.error("[piece-video] asset row 는 있는데 R2 에 파일이 없다", { pieceId: id, key });
    return json({ ok: false, step: "no_render", error: "영상 파일을 찾지 못했어요. 다시 만들어 주세요.", pieceId: id, stage, status: String(row.status) }, 404);
  }

  const am = (row.asset_meta && typeof row.asset_meta === "object") ? row.asset_meta as Row : {};
  const durationMs = n(am.containerMs) || n(am.durationMs);
  const filename = videoFilename(id, row.title);
  const url = await r2PresignGet(key, DOWNLOAD_TTL_SEC, { filename });

  /* 🔴 «우리가 못 올리는 채널»이면 **넘겨주는 길을 같이 내려보낸다**(R8 §3.2 · DESIGN §1031 «앱에서 올리기» 폴백).
     종전엔 파일 받는 주소만 줬다 — 고객은 «클립은 앱에서 올려 주세요»를 듣고도 **어떻게 폰으로 가져가는지**를 몰랐다.
     ⚠️ `handoff.appOpenVerified` 가 false 면 화면이 «앱으로 바로 열려요»라고 쓰면 안 된다(우리가 폰에서 재 보지 않았다). */
  const handoff = manualHandoffFor(String(row.channel ?? ""));

  return json({
    ok: true, pieceId: id, channel: String(row.channel ?? ""), status: String(row.status),
    url, filename, expiresInSec: DOWNLOAD_TTL_SEC,
    bytes: head.bytes || n(am.bytes),                 // 실측(HEAD)이 먼저 — 러너가 적어 둔 값은 예비다
    durationSec: durationMs ? Math.round(durationMs / 100) / 10 : 0,
    ...(stage ? { stage } : {}),
    ...(handoff ? { handoff } : {}),
  });
}

/* ─────────────────────── POST /api/post-mark-published ─────────────────────── */

async function markPublished(tid: number, uid: number, req: Request): Promise<Response> {
  const b = await readJson<{ pieceId?: unknown; url?: unknown }>(req);
  const pieceId = n(b.pieceId);
  if (!pieceId) return badRequest("어떤 글인지 알 수 없어요.", "id");

  const [piece] = await q(sql`SELECT id, channel, kind, status, slot_id, external_url FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId}`) as Row[];
  if (!piece) return json({ ok: false, error: "글을 찾을 수 없어요.", step: "not_found" }, 404);

  const channel = String(piece.channel ?? "");
  const status = String(piece.status ?? "");
  // 이미 적어 둔 글이면 상태 검사보다 «이미 됐어요»가 먼저다(멱등 · 두 번 눌러도 같은 답).
  const blocked = MARK_BLOCKED[status];
  if (blocked && !piece.external_url) return badRequest(blocked, "status");

  const chk = checkPublishedUrl(channel, b.url);
  if (!chk.ok) return json({ ok: false, step: "url", reason: chk.reason, error: chk.error }, 400);

  /* 🔴 `published_via` 는 DDL 첫날부터 `api|runner|manual` 3값이다(`drizzle/0001-init.sql:390`).
     그런데 B2 의 `PublishVia`(lib/publish/contract.ts)는 **커넥터 반환**(`PublishOk.via`)과 타입을 같이 쓰고 있어 "manual" 이 없다 —
     여기서 union 을 넓히면 «커넥터가 manual 을 돌려줄 수 있는 모양»이 되어 `lib/cron/publisher.ts:138` 의 분기 뜻이 흐려진다.
     그래서 **DB 에는 정본대로 manual 을 적고 타입만 이 한 줄에서 맞춘다**. `FinalizeInput.via` 를 커넥터 타입에서 떼는 건 B2 몫(메인에 보고). */
  const via = "manual" as FinalizeInput["via"];
  const fin = await finalizePublish(pieceId, {
    externalUrl: chk.url, via, tenantId: tid,
    ...(chk.channelRef ? { channelRef: chk.channelRef } : {}),
    // stats 는 비운다 — `PostStats` 는 조회수·좋아요 같은 **실측**을 담는 칸이다(`lib/publish/stats.ts` 가 나중에 채운다).
    // «손으로 올렸다»는 사실은 `published_via='manual'` 과 아래 감사 1행에 있다(같은 사실을 두 벌로 두지 않는다).
  });
  if (!fin.ok) {
    if (fin.reason === "tenant_mismatch") return json({ ok: false, error: "글을 찾을 수 없어요.", step: "tenant" }, 403);
    if (fin.reason === "not_found") return json({ ok: false, error: fin.error, step: "not_found" }, 404);
    if (fin.reason === "no_url") return json({ ok: false, error: fin.error, step: "url" }, 400);
    return json({ ok: false, error: fin.error, step: "finalize", ...(fin.detail ? { detail: fin.detail } : {}) }, 500);
  }

  /* 감사 1행 — 🔴 **await**(응답을 돌려주면 인보케이션이 끝나 `void writeAudit` 는 간헐 유실된다 · 2026-09-15 C 실측).
     `finalizePublish` 가 남기는 `post_published` 와 **다른 행**이다: 저건 «발행됐다», 이건 «사람이 손으로 올리고 주소를 적었다». */
  await writeAudit({
    tenantId: tid, action: "post_marked_manual", actorType: "user", actorId: uid, ip: clientIp(req),
    target: `piece:${pieceId}`,
    detail: { postId: fin.postId, channel, host: chk.host, url: chk.url, channelRef: chk.channelRef ?? null, already: fin.already, kind: String(piece.kind ?? "post") },
    riskLevel: "low",
  });

  return json({
    ok: true, postId: fin.postId, pieceId, channel, already: fin.already,
    url: chk.url, ...(chk.channelRef ? { channelRef: chk.channelRef } : {}),
    ...(fin.slotId ? { slotId: fin.slotId } : {}),
    message: fin.already ? "이미 적어 둔 주소예요." : `${channelLabelKo(channel)}에 올린 걸로 적었어요.`,
  });
}
