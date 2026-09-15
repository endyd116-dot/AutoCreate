/**
 * 스톡 사진을 찾아 글에 붙이는 두 걸음(계약 P1R8 §10.3 · DESIGN §5C.5 조달 순서).
 *
 *   GET  /api/stock-search?pieceId=&q=&count=&provider=
 *        → { ok, picks[{ provider,id,previewUrl,width,height,author,sourceUrl,licenseUrl,tags,alt,verdict }], tried[], trouble, configured[] }
 *        🔴 `downloadUrl` 은 **내보내지 않는다** — 화면은 고를 때 `previewUrl` 만 있으면 되고,
 *           내려받을 주소를 밖으로 돌리면 그 값이 다시 우리에게 돌아와 «고객이 정한 주소»가 된다(아래 붙이기 설명).
 *
 *   POST /api/stock-attach { pieceId, q, provider, id, caption?, sort? }
 *        → { ok, assetId, url, sourceKey, verdict, already }
 *
 *   ══ 🔴 붙일 때 «어느 사진인가»를 제공사에게 다시 묻는 이유 ══
 *     고객이 보내 준 주소를 그대로 가져오면 ①우리 서버가 아무 주소나 대신 열어 주는 통로가 되고
 *     ②작가·출처를 **고객이 적어 보낼 수 있어** 크레딧이 엉뚱한 곳을 가리킨다(그건 크레딧이 아니라 거짓말이다).
 *     그래서 받는 것은 **«어느 검색어의 · 어느 제공사 · 몇 번 사진»**뿐이고, 나머지 값은 전부 **우리가 제공사 응답에서 다시 꺼낸다.**
 *     🔴 이때 제공사를 또 부르지 않는다 — 24시간 캐시(`stock_cache`)에 그 응답이 그대로 있다(약관이 요구한 그 캐시다).
 *
 *   ══ 지키는 것 ══
 *     · 테넌트 스코프는 `auth.tid` 로만(본문의 tenantId 를 믿지 않는다).
 *     · 붙이기는 `requireWritable` 을 지난다(새 내용을 만드는 길이다). **찾기는 막지 않는다**(고르기까지는 돈이 들지 않는다).
 *     · 🔴 **사람·상표로 막지도 미루지도 않는다**(사장님 2026-09-15 «픽셀은 해외 채널인데 … 무시해도 돼»).
 *       판정(`verdict`)은 **계속 재서 사진에 적어 둘 뿐**이고(§9 «검사를 지우지 마라») 순위·화면 경고로 쓰지 않는다.
 *       감사에는 남긴다 — 나중에 «그때 무엇이 걸렸었나»를 되짚을 수 있어야 정렬을 다시 켤지 판단할 수 있다.
 */
import { sql } from "drizzle-orm";
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, requireWritable } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { q } from "../../lib/accounts";
import { compensationOfMeta } from "../../lib/disclosure";
import { searchStock, stockStatus, stockTroubleLine, STOCK_PAGE_SIZE, type StockProviderName } from "../../lib/stock";
import { attachStockPhoto } from "../../lib/stock/attach";

export const config = { path: ["/api/stock-search", "/api/stock-attach"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const providerOf = (v: unknown): StockProviderName | null => (v === "pixabay" || v === "pexels" ? v : null);

/**
 * 🔴 **이 글이 «대가를 받은 글»인가** — B3 판정(`assessStockImage`)이 이 값으로 갈린다
 *   (정보성 글에서는 사람·상표 조항이 «상업적 사용»을 전제하므로 걸리지 않는다).
 *   판정 기준을 **값으로 들고 다닌다**(AC-57) — `lib/disclosure.ts compensationOfMeta().need` 와 **같은 함수**를 쓴다.
 *   고지를 켜는 자리와 사진을 재는 자리가 갈리면 «고지는 붙었는데 사진은 정보성으로 통과»가 조용히 생긴다.
 *   글을 못 찾으면 정보성으로 본다 — 없는 글에 광고가 붙어 있을 수는 없다.
 */
async function paidOf(tid: number, pieceId: number): Promise<boolean> {
  const [row] = await q(sql`SELECT meta FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId}`);
  if (!row) return false;
  return compensationOfMeta((row.meta ?? {}) as Record<string, unknown>).need;
}

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const route = routeOf(req);
  try {
    if (route.endsWith("/stock-search")) {
      if (req.method !== "GET") return json({ ok: false, error: "method", step: "method" }, 405);
      return await doSearch(auth.tid, req);
    }
    if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);
    return await doAttach(auth.tid, auth.user.uid, req);
  } catch (err) { return jsonError("piece_stock", err); }
};

async function doSearch(tid: number, req: Request): Promise<Response> {
  const p = new URL(req.url).searchParams;
  const query = String(p.get("q") ?? "").trim();
  if (!query) return badRequest("어떤 사진을 찾을지 알려 주세요.", "q");
  const pieceId = n(p.get("pieceId"));
  /* 글을 알려 주면 그 글의 성격(광고가 들어갔나)을 판정에 실어 준다. 🔴 순위에는 안 쓴다 — 적어 둘 뿐이다(사장님 지시 2026-09-15). */
  const paid = pieceId ? await paidOf(tid, pieceId) : false;

  const r = await searchStock({
    query, paid,
    count: Math.min(STOCK_PAGE_SIZE, Math.max(1, n(p.get("count")) || STOCK_PAGE_SIZE)),
    provider: providerOf(p.get("provider")),
  });
  /* 🔴 `downloadUrl` 을 빼고 내보낸다(위 헤더 설명). */
  const picks = r.picks.map(({ downloadUrl: _drop, ...rest }) => rest);
  return json({
    ok: r.ok, paid, picks,
    tried: r.tried.map((t) => ({ provider: t.provider, ok: t.ok, count: t.candidates.length, reason: t.reason ?? null, cached: !!t.cached })),
    trouble: stockTroubleLine(r.tried),
    configured: stockStatus(),
  });
}

async function doAttach(tid: number, uid: number, req: Request): Promise<Response> {
  const w = await requireWritable(tid); if (!w.ok) return w.res;
  const body = await readJson<{ pieceId?: unknown; q?: unknown; provider?: unknown; id?: unknown; caption?: unknown; sort?: unknown }>(req);
  const pieceId = n(body.pieceId);
  if (!pieceId) return badRequest("어느 글에 붙일 사진인지 알려 주세요.", "pieceId");
  const query = String(body.q ?? "").trim();
  if (!query) return badRequest("어떤 낱말로 찾은 사진인지 알려 주세요.", "q");
  const provider = providerOf(body.provider);
  if (!provider) return badRequest("사진 제공사를 알려 주세요.", "provider");
  const id = String(body.id ?? "").trim();
  if (!id) return badRequest("어느 사진인지 알려 주세요.", "id");

  const paid = await paidOf(tid, pieceId);
  /* 🔴 값을 **우리가 다시 꺼낸다**(위 헤더). 24시간 캐시에 그대로 있어 제공사를 또 부르지 않는다. */
  const r = await searchStock({ query, paid, provider, count: STOCK_PAGE_SIZE });
  const candidate = r.picks.find((c) => c.provider === provider && c.id === id);
  if (!candidate) return json({ ok: false, error: "그 사진을 다시 찾지 못했어요. 한 번 더 찾아 주세요.", step: "not_in_results" }, 404);

  const out = await attachStockPhoto({
    tenantId: tid, pieceId, userId: uid, candidate, paid,
    caption: body.caption === undefined || body.caption === null ? null : String(body.caption).slice(0, 120),
    ...(body.sort === undefined ? {} : { sort: n(body.sort) }),
  });
  if (!out.ok) {
    const status = out.step === "piece" ? 404 : (out.step === "r2" || out.step === "db" || out.step === "download") ? 500 : 400;
    return json({ ok: false, error: out.error, step: out.step }, status);
  }
  if (!out.already) {
    await writeAudit({
      tenantId: tid, actorId: uid, actorType: "user", action: "piece_stock_added", target: `piece:${pieceId}`,
      /* 🔴 판정이 «아니오»여도 붙였다는 사실을 남긴다 — 막지 않는 대신 **되짚을 수 있어야** 정직하다(§9.3). */
      detail: { assetId: out.assetId, provider, stockId: id, sourceKey: out.sourceKey, paid, verdictOk: out.verdict.ok, verdictCode: out.verdict.code ?? null },
    });
  }
  return json({ ok: true, assetId: out.assetId, url: out.url, sourceKey: out.sourceKey, verdict: out.verdict, already: out.already });
}
