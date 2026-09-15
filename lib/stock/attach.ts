/**
 * lib/stock/attach.ts — 고른 스톡 사진을 **우리 서버로 가져와** 글에 붙인다(계약 P1R8 §10.3 · DESIGN §5C.5 조달 순서).
 *   🔎 출처: AC 신규(B-1 · 2026-09-15) — AM 원본 없음.
 *   🔴 이 파일은 `lib/piece-photos.ts`(옛 B-1 · 내 사진)와 **나란히** 선다. 그 파일을 고치지 않는다 —
 *      대신 **같은 규칙**(내용 해시 R2 키 · `meta.source` · jsonb 확인)을 그대로 따라 `removePhoto`·`piecesUsingSource` 가 둘 다에 그대로 듣는다.
 *
 *   ══ 네 걸음 ══
 *     ① 주소가 **그 제공사 호스트인지** 본다 — 아니면 안 가져온다(아래 «왜»).
 *     ② 내려받는다(우리 서버로 · hotlink 하지 않는다 — Pixabay 약관 요구).
 *     ③ **첫 바이트로** 형식을 판정한다(제공사가 준 Content-Type 을 믿지 않는다).
 *     ④ 내용 해시로 R2 에 두고 `piece_assets` 한 행 — `meta.source`(되짚기 열쇠) + `meta.stock`(라이선스 재료) **둘 다**.
 *
 *   ══ 🔴 왜 호스트를 확인하나 ══
 *     붙일 사진은 **고객이 고른 값**으로 온다. 그 주소를 그대로 열면 ①우리 서버가 아무 주소나 대신 열어 주는 통로가 되고
 *     ②아무 그림이나 «정식 라이선스 스톡»이라는 **딱지를 달고** 저장된다 — 그러면 §10.2 에서 금지한 «긁어 오기»를
 *     우리 손으로 열어 주는 셈이다. 호스트를 제공사에 묶으면 둘 다 막히고, 크레딧이 엉뚱한 곳을 가리키지도 않는다.
 *
 *   ══ 🔴 사람·상표로 막지 않는다 — 적어만 둔다(사장님 지시 2026-09-15) ══
 *     사장님: «픽셀은 해외 채널인데 한국에서 저작권 문제가 걸릴 이유도 일도 없어. 그러니 무시해도 돼.»
 *     B3 판정(`assessStockImage`)은 **계속 돌려서** `meta.stock.verdict` 에 적는다(§9 «검사를 지우지 마라»).
 *     다만 그 값으로 **막지도, 순위를 미루지도, 화면에 경고를 그리지도 않는다.** 나중에 필요해지면 그때 켜면 된다 —
 *     지금 지워 버리면 그때 다시 만들어야 하고, 무엇보다 **그동안의 사진에는 판정이 없어** 되짚을 수가 없다.
 *   🔴 대신 **크레딧(`meta.stock.author`·`sourceUrl`)은 절대 빠뜨리지 않는다** — 키가 죽는 진짜 경로는 그쪽이다.
 */
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { q } from "../accounts";
import { jsonb } from "../db-util";
import { r2Configured, r2Head, r2Put, r2PublicUrl } from "../r2";
import {
  ALLOWED_IMAGE_MIME, MAX_PHOTO_BYTES, sniffImageMime, photoRejectReason,
  stockSourceKey, type PhotoSource, type StockMeta,
} from "../photo-source";
import { assessStockImage, type StockVerdict } from "../stock-safety";
import { hostAllowed, STOCK_TIMEOUT_MS, type StockCandidate } from "./types";
import { PROVIDERS, toStockMeta } from "./index";

const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

export type AttachStockResult =
  | { ok: true; assetId: number; url: string; r2Key: string; sourceKey: string; verdict: StockVerdict; already: boolean }
  | { ok: false; step: "provider" | "host" | "piece" | "download" | "too_big" | "bad_type" | "r2" | "db"; error: string };

/**
 * 스톡 사진 한 장을 글에 붙인다.
 *   @param a.candidate 고른 후보(제공사 응답에서 온 모양 그대로). `downloadUrl` 은 **그 제공사 호스트여야** 한다.
 *   @param a.paid      대가를 받은 글인가 — B3 판정에 쓴다(막지 않고 **적어 둔다**).
 */
export async function attachStockPhoto(a: {
  tenantId: number; pieceId: number; userId: number | null;
  candidate: StockCandidate;
  caption?: string | null;
  alt?: string | null;
  sort?: number;
  paid: boolean;
  timeoutMs?: number;
}): Promise<AttachStockResult> {
  const c = a.candidate;
  const provider = PROVIDERS.find((p) => p.name === c?.provider);
  if (!provider) return { ok: false, step: "provider", error: "우리가 쓰지 않는 사진 제공사예요." };
  /* ① 🔴 주소는 그 제공사의 것이어야 한다(위 «왜 호스트를 확인하나»). */
  if (!hostAllowed(String(c.downloadUrl ?? ""), provider.imageHosts)) {
    console.warn(`[stock:attach] 호스트 거절 provider=${c.provider} url=${String(c.downloadUrl ?? "").slice(0, 80)}`);
    return { ok: false, step: "host", error: "그 사진 주소는 사진 제공사의 것이 아니라 가져올 수 없어요." };
  }

  const [piece] = await q(sql`SELECT id FROM pieces WHERE tenant_id = ${a.tenantId} AND id = ${a.pieceId}`);
  if (!piece) return { ok: false, step: "piece", error: "그 글을 찾지 못했어요." };

  const stock: StockMeta = toStockMeta(c);
  const verdict = assessStockImage(stock, { paid: a.paid });
  const key = stockSourceKey(c.provider, c.id);

  /* 같은 글에 같은 스톡 사진이 이미 있으면 그 행을 돌려준다(두 번 눌렀을 뿐 · 멱등 — `addCustomerPhoto` 와 같은 규칙). */
  const [dup] = await q(sql`SELECT id, r2_key, meta FROM piece_assets
    WHERE tenant_id = ${a.tenantId} AND piece_id = ${a.pieceId} AND kind = 'image' AND meta->'source'->>'key' = ${key} LIMIT 1`);
  if (dup) {
    const m = (dup.meta ?? {}) as Record<string, unknown>;
    return { ok: true, assetId: n(dup.id), url: String(m.url ?? r2PublicUrl(String(dup.r2_key ?? ""))), r2Key: String(dup.r2_key ?? ""), sourceKey: key, verdict, already: true };
  }

  /* ② 내려받기 — 🔴 우리 서버로 가져온다(hotlink 하지 않는다). */
  let bytes: Uint8Array;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), a.timeoutMs ?? STOCK_TIMEOUT_MS);
  try {
    const resp = await fetch(c.downloadUrl, { signal: ctrl.signal, redirect: "follow" });
    if (!resp.ok) { console.warn(`[stock:attach] 내려받기 HTTP ${resp.status}`); return { ok: false, step: "download", error: "사진을 가져오지 못했어요. 다른 사진을 골라 주세요." }; }
    /* 🔴 Content-Length 를 먼저 본다 — 큰 파일을 다 받아 놓고 거절하면 함수가 먼저 죽는다. 다만 **없을 수도 있어** 아래에서 실제 크기도 다시 본다. */
    const declared = Number(resp.headers.get("content-length") ?? 0);
    if (declared && declared > MAX_PHOTO_BYTES) return { ok: false, step: "too_big", error: photoRejectReason("too_big") };
    bytes = new Uint8Array(await resp.arrayBuffer());
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    console.warn(`[stock:attach] ${aborted ? "시간 초과" : "내려받기 실패"}`, String((e as Error)?.message ?? e).slice(0, 120));
    return { ok: false, step: "download", error: "사진을 가져오지 못했어요. 잠시 뒤에 다시 시도해 주세요." };
  } finally { clearTimeout(timer); }

  if (!bytes.length) return { ok: false, step: "download", error: photoRejectReason("empty") };
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, step: "too_big", error: photoRejectReason("too_big") };
  /* ③ 🔴 형식은 **첫 바이트로** — 제공사가 준 Content-Type 도 보내는 쪽 값이다(`addCustomerPhoto` 와 같은 규칙). */
  const mime = sniffImageMime(bytes);
  if (!mime || !ALLOWED_IMAGE_MIME[mime]) return { ok: false, step: "bad_type", error: photoRejectReason("bad_type") };

  if (!r2Configured()) return { ok: false, step: "r2", error: "사진 저장소가 아직 준비되지 않았어요." };
  /* ④ 🔴 **내용으로 이름을 짓는다** — `lib/piece-photos.ts` 와 **같은 규칙이어야** 한다.
     `removePhoto` 가 «같은 r2_key 를 아직 누가 쓰나»로 지울지를 정하기 때문이다(규칙이 갈리면 남의 글 사진을 지운다). */
  const hash = createHash("sha256").update(bytes).digest("hex");
  const ext = ALLOWED_IMAGE_MIME[mime];
  const r2key = `autocreate/${a.tenantId}/photos/${hash}.${ext}`;
  let url: string;
  try {
    const head = await r2Head(r2key);
    url = head ? r2PublicUrl(r2key) : (await r2Put(r2key, Buffer.from(bytes), mime)).url;
  } catch (e) {
    console.error("[stock:attach] R2 업로드 실패", String((e as Error)?.message ?? e).slice(0, 160));
    return { ok: false, step: "r2", error: "사진을 저장하지 못했어요. 잠시 뒤에 다시 시도해 주세요." };
  }

  const source: PhotoSource = {
    kind: "stock", key, addedAt: new Date().toISOString(), by: a.userId ?? null,
    bytes: bytes.length, mime,
  };
  /* 🔴 판정을 **함께 적는다** — 지금은 아무것도 막지 않지만, 적어 두지 않으면 나중에 되짚을 재료가 0 이 된다(위 헤더). */
  const stockMeta = { ...stock, verdict: { ok: verdict.ok, ...(verdict.code ? { code: verdict.code } : {}), ...(verdict.reason ? { reason: verdict.reason } : {}), ...(verdict.law ? { law: verdict.law } : {}) } };
  const alt = String(a.alt ?? c.alt ?? c.tags.slice(0, 4).join(", ") ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || null;

  const [sortRow] = await q(sql`SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM piece_assets WHERE tenant_id = ${a.tenantId} AND piece_id = ${a.pieceId}`);
  const sort = typeof a.sort === "number" ? a.sort : n(sortRow?.next);
  let assetId = 0;
  try {
    const [ins] = await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, caption, meta, sort)
      VALUES (${a.tenantId}, ${a.pieceId}, 'image', ${r2key}, ${a.caption ?? null}, ${jsonb({ url, source, stock: stockMeta, ...(alt ? { alt } : {}) })}, ${sort})
      RETURNING id`);
    assetId = n(ins?.id);
  } catch (e) {
    console.error("[stock:attach] piece_assets 넣기 실패", String((e as Error)?.message ?? e).slice(0, 160));
    return { ok: false, step: "db", error: "사진을 글에 붙이지 못했어요." };
  }
  /* 🔴 쓴 직후 확인까지가 쓰기다(PITFALLS #1) — 출처가 안 들어갔으면 되짚기도 크레딧도 영영 안 된다. */
  const [chk] = await q(sql`SELECT jsonb_typeof(meta) AS t, meta->'source'->>'key' AS k, meta->'stock'->>'provider' AS p FROM piece_assets WHERE id = ${assetId}`);
  if (chk?.t !== "object" || chk?.k !== key || chk?.p !== c.provider) console.error("[stock:attach] meta 확인 실패", chk);

  return { ok: true, assetId, url, r2Key: r2key, sourceKey: key, verdict, already: false };
}
