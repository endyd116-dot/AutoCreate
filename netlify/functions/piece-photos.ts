/**
 * 내 사진을 글에 붙이는 네 걸음(R8 §5D.4 «사진 업로드가 ①의 전제» · DESIGN §5C.5 조달 순서).
 *
 *   POST /api/piece-photo-add    { pieceId, dataBase64, filename?, caption? }
 *                                → { ok, photo{ id, url, caption, sort, source }, already }
 *                                · 400 step:"bad_type"|"too_big"|"empty"(사람말 사유) · 404 step:"piece"
 *   GET  /api/piece-photos?pieceId=   → { ok, pieceId, photos[] }
 *   POST /api/piece-photo-remove { assetId } → { ok, removedObject }
 *   GET  /api/photo-usage?key=   → { ok, key, uses[], total, shown, hasMore }  🔴 «이 사진이 어느 글에 쓰였나»(침해 통지·내리기의 첫 걸음 · DESIGN §5E)
 *        🔴 [AC-257] **`total` 로 적어라 — `uses.length` 가 아니다.** 목록은 200곳에서 잘리는데 그걸 «글 N곳»으로 적으면
 *        201곳 쓰인 사진에서 고객이 **다 내렸다고 믿는다.** `hasMore` 면 «여기엔 M곳만 보여요»를 같이 말한다(§9 — 자르되 말해 준다).
 *
 *   ══ 지키는 것 ══
 *     · 테넌트 스코프는 `auth.tid` 로만(본문의 tenantId 를 믿지 않는다).
 *     · 🔴 형식은 **첫 바이트로** 판정한다 — 확장자·Content-Type 은 보내는 쪽이 정하는 값이다(`sniffImageMime`).
 *     · 🔴 올리기는 `requireWritable` 을 지난다(새 내용을 만드는 길이다). **읽기·되짚기는 막지 않는다** —
 *        체험이 끝난 집도 «내 사진이 어느 글에 있나»는 답할 수 있어야 한다(침해 통지는 요금제를 안 기다린다).
 *     · 되짚기는 **그 집 안에서만** 찾는다(운영자 전수 조회는 이 문이 아니다 · §4.6).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, requireWritable } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { addCustomerPhoto, listPhotos, removePhoto, piecesUsingSource } from "../../lib/piece-photos";
import { MAX_PHOTO_BYTES, photoRejectReason, isSourceKey } from "../../lib/photo-source";

export const config = { path: ["/api/piece-photo-add", "/api/piece-photos", "/api/piece-photo-remove", "/api/photo-usage"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** base64 본문 상한 — 원본 상한의 4/3 + 여유. 여기서 먼저 끊어야 큰 문자열을 디코드하느라 함수가 죽지 않는다. */
const MAX_B64_CHARS = Math.ceil(MAX_PHOTO_BYTES * 4 / 3) + 1024;

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const route = routeOf(req);
  try {
    if (route.endsWith("/piece-photos")) {
      if (req.method !== "GET") return json({ ok: false, error: "method", step: "method" }, 405);
      const pieceId = n(new URL(req.url).searchParams.get("pieceId"));
      if (!pieceId) return badRequest("어느 글의 사진인지 알려 주세요.", "pieceId");
      return json({ ok: true, pieceId, photos: await listPhotos(auth.tid, pieceId) });
    }
    if (route.endsWith("/photo-usage")) {
      if (req.method !== "GET") return json({ ok: false, error: "method", step: "method" }, 405);
      const key = String(new URL(req.url).searchParams.get("key") || "");
      if (!isSourceKey(key)) return badRequest("사진 출처 값이 올바르지 않아요.", "key");
      /* [AC-257] 🔴 `total` 은 **LIMIT 없이 센 진짜 수**다 — 화면이 `uses.length` 로 «글 N곳»을 적으면 잘린 수를 말하게 된다.
         `hasMore` 가 참이면 화면은 «N곳(여기엔 M곳만 보여요)» 쪽으로 적는다(막지 않는다 · 말해 준다 · §9). */
      const u = await piecesUsingSource(key, { tenantId: auth.tid });
      return json({ ok: true, key, uses: u.uses, total: u.total, hasMore: u.hasMore, shown: u.uses.length });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);
    if (route.endsWith("/piece-photo-add")) return await addPhoto(auth.tid, auth.user.uid, req);
    return await dropPhoto(auth.tid, auth.user.uid, req);
  } catch (err) { return jsonError("piece_photos", err); }
};

async function addPhoto(tid: number, uid: number, req: Request): Promise<Response> {
  const w = await requireWritable(tid); if (!w.ok) return w.res;
  const body = await readJson<{ pieceId?: unknown; dataBase64?: unknown; filename?: unknown; caption?: unknown }>(req);
  const pieceId = n(body.pieceId);
  if (!pieceId) return badRequest("어느 글에 붙일 사진인지 알려 주세요.", "pieceId");
  const b64 = String(body.dataBase64 ?? "").replace(/^data:[^;]+;base64,/, "");
  if (!b64) return badRequest(photoRejectReason("empty"), "empty");
  if (b64.length > MAX_B64_CHARS) return badRequest(photoRejectReason("too_big"), "too_big");
  let bytes: Buffer;
  try { bytes = Buffer.from(b64, "base64"); } catch { return badRequest(photoRejectReason("bad_type"), "bad_type"); }

  const r = await addCustomerPhoto({
    tenantId: tid, pieceId, userId: uid, bytes,
    filename: body.filename ? String(body.filename) : undefined,
    caption: body.caption === undefined || body.caption === null ? null : String(body.caption).slice(0, 120),
  });
  if (!r.ok) return json({ ok: false, error: r.error, step: r.step }, r.step === "piece" ? 404 : r.step === "r2" ? 500 : 400);
  /* 두 번 눌러 같은 사진이 다시 온 것은 새 일이 아니다 — 감사에 두 줄을 남기지 않는다. */
  if (!r.alreadyOnPiece) {
    await writeAudit({ tenantId: tid, actorId: uid, actorType: "user", action: "piece_photo_added", target: `piece:${pieceId}`,
      detail: { assetId: r.photo.id, sourceKey: r.photo.source?.key, bytes: r.photo.source?.bytes, mime: r.photo.source?.mime } });
  }
  return json({ ok: true, photo: r.photo, already: r.alreadyOnPiece });
}

async function dropPhoto(tid: number, uid: number, req: Request): Promise<Response> {
  const body = await readJson<{ assetId?: unknown }>(req);
  const assetId = n(body.assetId);
  if (!assetId) return badRequest("어느 사진인지 알려 주세요.", "assetId");
  const r = await removePhoto(tid, assetId);
  if (!r.ok) return json({ ok: false, error: r.error, step: r.step }, 404);
  await writeAudit({ tenantId: tid, actorId: uid, actorType: "user", action: "piece_photo_removed", target: `asset:${assetId}`,
    detail: { removedObject: r.removedObject } });
  return json({ ok: true, removedObject: r.removedObject });
}
