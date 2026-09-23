/**
 * lib/piece-photos.ts — **고객이 올린 사진**을 글에 붙이고, 어디서 왔는지 적고, **되짚을 수 있게** 한다
 *   (R8 §5D.4 «사진 업로드가 ①의 전제» · §5C.5 조달 순서 · B-1 2026-09-15).
 *
 *   ══ 이 파일이 맡는 것 ══
 *     ① 올리기 — 바이트 검사 → R2 → `piece_assets` 한 행(+ `meta.source` 출처).
 *     ② 목록·지우기 — 지울 때 **같은 파일을 다른 글도 쓰고 있으면 R2 객체는 남긴다**(한 곳에서 지워 여러 글이 깨지면 안 된다).
 *     ③ 🔴 **되짚기** — «이 사진이 어느 글에 쓰였나». 침해 통지는 사진 한 장을 가리키며 오고,
 *        그때 그 사진이 들어간 글을 **전부** 찾아야 한다(메인 지시 2026-09-15). 열쇠는 `lib/photo-source.ts` 의 `source.key`.
 *
 *   ══ 알고 쓰는 성질 둘 ══
 *     ① 공개 주소는 `r2PublicUrl` = `/api/r2-image?key=…` 이고 **그 경로엔 인증이 없다**(키를 알면 열린다).
 *        AI 가 구운 사진도 같은 경로를 쓰고 어차피 발행되면 공개된다. 다만 **발행 전 초안의 사진도 같은 성질**이라는 것은
 *        알고 쓰는 것이지 모르고 쓰는 것이 아니다.
 *     ② 🔴 키가 **내용 해시**라, 같은 파일을 가진 사람은 그 집의 키를 **계산할 수 있다**(테넌트 번호까지 알아야 한다).
 *        중복 저장을 없애고 «지울 때 남의 글을 안 깨뜨리는» 판정을 가능하게 한 대가다. 사진은 결국 글에 실려 공개되는 물건이라
 *        이 맞바꿈을 택했다 — **모르고 택한 것이 아니다.** 더 센 보호가 필요해지면 서명 주소(`r2PresignGet`)로 바꾸면 된다.
 *   🔎 출처: AC 신규(DESIGN §5D.4 · B-1 · 2026-09-15) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { q } from "./accounts";
import { jsonb } from "./db-util";
import { r2Put, r2Delete, r2PublicUrl, r2Head, r2Configured } from "./r2";
import {
  ALLOWED_IMAGE_MIME, MAX_PHOTO_BYTES, sniffImageMime, photoRejectReason,
  customerSourceKey, sourceFromMeta, isSourceKey, type PhotoSource, type StockMeta,
} from "./photo-source";

const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

export interface PhotoRow {
  id: number;
  pieceId: number;
  r2Key: string;
  url: string;
  caption: string | null;
  sort: number;
  source: PhotoSource | null;
  stock: StockMeta | null;
  createdAt: string | null;
}

function rowToPhoto(r: Record<string, unknown>): PhotoRow {
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  return {
    id: n(r.id), pieceId: n(r.piece_id), r2Key: String(r.r2_key ?? ""),
    url: String((meta.url as string) || r2PublicUrl(String(r.r2_key ?? ""))),
    caption: r.caption === null || r.caption === undefined ? null : String(r.caption),
    sort: n(r.sort), source: sourceFromMeta(meta.source),
    stock: (meta.stock && typeof meta.stock === "object" ? meta.stock as StockMeta : null),
    createdAt: r.created_at ? String(r.created_at) : null,
  };
}

export type AddPhotoResult =
  | { ok: true; photo: PhotoRow; alreadyOnPiece: boolean }
  | { ok: false; step: "empty" | "too_big" | "bad_type" | "r2" | "piece"; error: string };

/**
 * 고객이 올린 사진 한 장을 글에 붙인다.
 *   🔴 형식은 **첫 바이트로** 판정한다(확장자·Content-Type 은 보내는 쪽 값이라 못 믿는다).
 *   🔴 같은 글에 **같은 파일을 두 번** 올리면 새 행을 만들지 않는다(해시가 같다) — 고객이 두 번 눌렀을 뿐이다.
 */
export async function addCustomerPhoto(a: {
  tenantId: number; pieceId: number; userId: number | null;
  bytes: Uint8Array; filename?: string; caption?: string | null; sort?: number;
}): Promise<AddPhotoResult> {
  if (!a.bytes || !a.bytes.length) return { ok: false, step: "empty", error: photoRejectReason("empty") };
  if (a.bytes.length > MAX_PHOTO_BYTES) return { ok: false, step: "too_big", error: photoRejectReason("too_big") };
  const mime = sniffImageMime(a.bytes);
  if (!mime || !ALLOWED_IMAGE_MIME[mime]) return { ok: false, step: "bad_type", error: photoRejectReason("bad_type") };

  const [piece] = await q(sql`SELECT id FROM pieces WHERE tenant_id = ${a.tenantId} AND id = ${a.pieceId}`);
  if (!piece) return { ok: false, step: "piece", error: "그 글을 찾지 못했어요." };

  const hash = createHash("sha256").update(a.bytes).digest("hex");
  const key = customerSourceKey(hash);

  /* 같은 글에 같은 사진이 이미 있으면 그 행을 돌려준다(두 번 눌렀을 뿐 · 멱등). */
  const [dup] = await q(sql`SELECT id, piece_id, r2_key, caption, sort, meta, created_at FROM piece_assets
    WHERE tenant_id = ${a.tenantId} AND piece_id = ${a.pieceId} AND kind = 'image' AND meta->'source'->>'key' = ${key} LIMIT 1`);
  if (dup) return { ok: true, photo: rowToPhoto(dup), alreadyOnPiece: true };

  if (!r2Configured()) return { ok: false, step: "r2", error: "사진 저장소가 아직 준비되지 않았어요." };
  /* 🔴 **내용으로 이름을 짓는다**(content-addressed) — 같은 사진을 여러 글에 쓰면 R2 객체는 **하나**다.
     처음엔 `safeKey()`(매번 다른 이름)를 썼다가 스모크에서 잡혔다: 같은 사진인데 객체가 글마다 따로 생겨
     ①저장소가 중복으로 불고 ②한 글에서 떼면 «아무도 안 쓴다»로 보여 **다른 글이 아직 쓰는 파일을 지울 뻔**했다.
     🔴 이름 앞에 테넌트를 둔다 — 집이 다르면 바이트가 같아도 **객체를 섞지 않는다**(§4.6). */
  const ext = ALLOWED_IMAGE_MIME[mime];
  const r2key = `autocreate/${a.tenantId}/photos/${hash}.${ext}`;
  let url: string;
  try {
    const head = await r2Head(r2key);
    url = head ? r2PublicUrl(r2key) : (await r2Put(r2key, Buffer.from(a.bytes), mime)).url;
  }
  catch (e) { console.error("[piece-photos] R2 업로드 실패", String((e as Error)?.message ?? e).slice(0, 160)); return { ok: false, step: "r2", error: "사진을 저장하지 못했어요. 잠시 뒤에 다시 시도해 주세요." }; }

  const source: PhotoSource = {
    kind: "customer", key, addedAt: new Date().toISOString(), by: a.userId ?? null,
    ...(a.filename ? { filename: String(a.filename).slice(0, 120) } : {}),
    bytes: a.bytes.length, mime,
  };
  const [sortRow] = await q(sql`SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM piece_assets WHERE tenant_id = ${a.tenantId} AND piece_id = ${a.pieceId}`);
  const sort = typeof a.sort === "number" ? a.sort : n(sortRow?.next);
  const [ins] = await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, caption, meta, sort)
    VALUES (${a.tenantId}, ${a.pieceId}, 'image', ${r2key}, ${a.caption ?? null}, ${jsonb({ url, source })}, ${sort})
    RETURNING id, piece_id, r2_key, caption, sort, meta, created_at`);
  /* 쓴 직후 확인까지가 쓰기다(PITFALLS #1) — 출처가 안 들어갔으면 되짚기가 영영 안 된다. */
  const [chk] = await q(sql`SELECT jsonb_typeof(meta) AS t, meta->'source'->>'key' AS k FROM piece_assets WHERE id = ${n(ins?.id)}`);
  if (chk?.t !== "object" || chk?.k !== key) console.error("[piece-photos] meta.source 확인 실패", chk);
  return { ok: true, photo: rowToPhoto(ins), alreadyOnPiece: false };
}

/** 그 글에 붙은 사진들(올린 순서). */
export async function listPhotos(tid: number, pieceId: number): Promise<PhotoRow[]> {
  const rows = await q(sql`SELECT id, piece_id, r2_key, caption, sort, meta, created_at FROM piece_assets
    WHERE tenant_id = ${tid} AND piece_id = ${pieceId} AND kind = 'image' ORDER BY sort, id`);
  return rows.map(rowToPhoto);
}

/**
 * 사진 한 장을 글에서 뗀다.
 *   🔴 R2 객체는 **아무도 안 쓸 때만** 지운다 — 같은 파일을 다른 글도 가리키고 있으면 그 글의 사진이 깨진다.
 */
export async function removePhoto(tid: number, assetId: number): Promise<{ ok: boolean; removedObject: boolean; step?: string; error?: string }> {
  const [row] = await q(sql`SELECT id, piece_id, r2_key, meta FROM piece_assets WHERE tenant_id = ${tid} AND id = ${assetId} AND kind = 'image'`);
  if (!row) return { ok: false, removedObject: false, step: "not_found", error: "그 사진을 찾지 못했어요." };
  const r2key = String(row.r2_key ?? "");
  await q(sql`DELETE FROM piece_assets WHERE tenant_id = ${tid} AND id = ${assetId}`);
  /* 🔴 **아무도 안 쓸 때만** 지운다. 세는 범위는 테넌트가 아니라 **전체**다 — 키가 테넌트별이라 어차피 그 집 것만 세지만,
     여기서 테넌트로 좁히면 나중에 키 규칙이 바뀌었을 때 남의 글 사진을 지우게 된다. */
  const [still] = await q(sql`SELECT COUNT(*)::int AS c FROM piece_assets WHERE r2_key = ${r2key}`);
  if (n(still?.c) > 0) return { ok: true, removedObject: false };
  let removed = false;
  try { removed = await r2Delete(r2key); }
  catch (e) { console.warn("[piece-photos] R2 삭제 실패(행은 지웠다)", String((e as Error)?.message ?? e).slice(0, 120)); }
  return { ok: true, removedObject: removed };
}

export interface SourceUsage { pieceId: number; tenantId: number; title: string; status: string; channel: string; externalUrl: string | null; assetId: number }

/**
 * 🔴 **되짚기** — 이 사진(출처 열쇠)이 **어느 글에 쓰였나**.
 *   침해 통지·내리기 절차의 첫 걸음이다(DESIGN §5E). 발행된 글이면 `externalUrl` 까지 준다 — 거기가 실제로 내려야 할 자리다.
 *   `tenantId` 를 주면 그 집 안에서만 찾는다(고객 화면). 안 주면 전체 — **운영자 경로에서만** 그렇게 부른다(§4.6).
 */
export interface SourceUsageResult {
  uses: SourceUsage[];
  /** 🔴 **실제로 몇 곳인가** — 목록 길이가 아니다(목록은 `limit` 에서 잘린다). */
  total: number;
  /** 잘렸나. 화면은 이걸 보고 «다 보여 준 척»을 그만둔다. */
  hasMore: boolean;
  limit: number;
}

/**
 * [AC-257 · A 가 짚었다 · 2026-09-23] 🔴 **«기본값이 자르는» 게이트** — `if` 도 `WHERE` 도 아닌 세 번째 얼굴이다(AC-254 형제).
 *   여기 `LIMIT 200` 은 배치 경계로 놓은 것인데, 화면(`public/js/ui.js`)이 **목록 길이를 그대로 «글 N곳»으로 적었다.**
 *   ⇒ 201곳에 쓰인 사진이면 화면은 «200곳»이라 말하고 🔴 **고객은 다 내렸다고 믿는다.** 하필 침해 통지·내리기(§5E)다.
 *   🔴 **빨강이 안 뜨는 게 아니라 초록이 뜬다** — A 의 실측 하니스도 «글 2곳»을 보고 초록이었다(표본이 상한에 안 닿았다).
 *   ⇒ 세는 것과 보여 주는 것을 가른다: `total` 은 **LIMIT 없이 COUNT** 로 재고, `uses` 는 잘린 채로 준다.
 *     막지 않는다(§9) — 자르는 것은 그대로 두고 **잘렸다고 말한다.**
 */
export async function piecesUsingSource(sourceKey: string, opts: { tenantId?: number | null; limit?: number } = {}): Promise<SourceUsageResult> {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
  if (!isSourceKey(sourceKey)) return { uses: [], total: 0, hasMore: false, limit };
  const scope = opts.tenantId ? sql`AND a.tenant_id = ${opts.tenantId}` : sql``;
  /* 🔴 모수를 **따로** 센다 — LIMIT 안 건 COUNT 라야 «201곳»이 나온다. */
  const [cnt] = await q(sql`SELECT COUNT(*)::int AS c FROM piece_assets a JOIN pieces p ON p.id = a.piece_id
     WHERE a.meta->'source'->>'key' = ${sourceKey} ${scope}`);
  const total = n(cnt?.c);
  const rows = await q(sql`
    SELECT a.id AS asset_id, a.tenant_id, p.id AS piece_id, COALESCE(p.title, '') AS title, p.status, p.channel,
           (SELECT po.external_url FROM posts po WHERE po.piece_id = p.id AND po.external_url IS NOT NULL ORDER BY po.id DESC LIMIT 1) AS external_url
      FROM piece_assets a JOIN pieces p ON p.id = a.piece_id
     WHERE a.meta->'source'->>'key' = ${sourceKey} ${scope}
     ORDER BY p.id DESC LIMIT ${limit}`);
  const uses = rows.map((r) => ({
    assetId: n(r.asset_id), tenantId: n(r.tenant_id), pieceId: n(r.piece_id),
    title: String(r.title ?? ""), status: String(r.status ?? ""), channel: String(r.channel ?? ""),
    externalUrl: r.external_url ? String(r.external_url) : null,
  }));
  return { uses, total, hasMore: total > uses.length, limit };
}
