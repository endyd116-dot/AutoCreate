/**
 * 발행함 API(계약 P1R2 §6 v2.1 · DESIGN §2.3):
 *   GET /api/posts-list?from=&to=&status=published|awaiting_manual|failed|all(기본 all) → { ok:true, posts:[PostRow] }
 *
 *   🔴 **posts 가 아니라 pieces 를 기준으로 만든다**(계약 v2.1): 발행에 실패한 글은 `posts` 행이 아예 없다.
 *      posts 에서 출발하면 «직접 올려 주셔야 해요» 가 목록에서 통째로 사라진다 — 사용자가 가장 알아야 할 행이 안 보이는 사고.
 *      그래서 pieces(published·awaiting_manual·failed) 에서 출발해 posts 정보를 **있으면** 붙인다.
 *
 *   🔴 `errorKind` 는 계약 §2 어휘(RunnerErrorKind)만 싣는다 — 사람말 변환은 A 가 한 벌로 한다(UI.ERRK).
 *      서버가 문구를 만들면 화면마다 말이 갈라진다.
 *   ⚠️ 행 키는 **`pieceId`** 로 잡아라 — pieces 기준이라 pieceId 가 목록 안에서 유일하다.
 *      `id` 는 posts 행이 있으면 그 id, 없으면 pieceId(두 수열이 달라 충돌할 수 있다).
 *   날짜 창은 «나간 시각 → 없으면 나갈 예정이던 시각 → 없으면 마지막 변경»(KST 날짜)로 잡는다 — 실패 행도 달력에서 사라지지 않게.
 */
import { json, jsonError } from "../../lib/response";
import { requireUser } from "../../lib/guards";
import { utcDate } from "../../lib/db-util";
import { q } from "../../lib/accounts";
import { kstDateStr, addDays } from "../../lib/best-time";
import { sql } from "drizzle-orm";

export const config = { path: "/api/posts-list" };
const n = (v: unknown) => Number(v || 0);
const STATUSES = new Set(["published", "awaiting_manual", "failed"]);
const ERROR_KINDS = new Set(["login_fail", "captcha", "rate_limited", "suspended", "selector_changed", "network", "unknown"]);

export interface PostRow {
  id: number; pieceId: number; channel: string; accountHandle: string | null; title: string;
  status: "published" | "awaiting_manual" | "failed";
  /** [R7 §1.3] `manual` = 사람이 손으로 올리고 `/api/post-mark-published` 로 주소를 적은 글(계정 없이 만든 영상의 정상 경로다 · DDL 0001 부터 있던 3번째 값). */
  externalUrl?: string; publishedVia?: "api" | "runner" | "manual"; publishedAt?: string;
  stats: { views?: number; likes?: number; comments?: number; lastSyncAt?: string };
  alive: boolean; errorKind?: string; failReason?: string;
}

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const url = new URL(req.url);
  try {
    const today = kstDateStr(new Date());
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const from = dateRe.test(url.searchParams.get("from") || "") ? url.searchParams.get("from")! : addDays(today, -30);
    const to = dateRe.test(url.searchParams.get("to") || "") ? url.searchParams.get("to")! : addDays(today, 1);
    const want = url.searchParams.get("status") || "all";
    const status = STATUSES.has(want) ? want : "all";

    /* «이 행이 달력의 어느 날인가» — 나간 시각 > 나갈 예정이던 시각 > 마지막 변경. KST 변환은 SQL 안에서(PITFALLS #4). */
    const whenKst = sql`((COALESCE(po.published_at, p.published_at, p.scheduled_for, p.updated_at) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date)`;
    const rows = await q(sql`
      SELECT p.id AS piece_id, p.channel, p.title, p.status, p.meta, p.external_url AS p_url, p.published_at AS p_at,
             a.handle,
             po.id AS post_id, po.external_url AS po_url, po.published_via, po.stats, po.published_at AS po_at,
             (SELECT rj.error_kind FROM runner_jobs rj WHERE rj.tenant_id = p.tenant_id AND rj.piece_id = p.id
                AND rj.error_kind IS NOT NULL ORDER BY rj.id DESC LIMIT 1) AS job_error_kind
        FROM pieces p
        LEFT JOIN accounts a ON a.id = p.account_id
        LEFT JOIN posts po ON po.piece_id = p.id AND po.tenant_id = p.tenant_id
       WHERE p.tenant_id = ${tid}
         AND p.status IN ('published','awaiting_manual','failed')
         ${status === "all" ? sql`` : sql`AND p.status = ${status}`}
         AND ${whenKst} >= ${from}::date AND ${whenKst} <= ${to}::date
       ORDER BY COALESCE(po.published_at, p.published_at, p.scheduled_for, p.updated_at) DESC, p.id DESC
       LIMIT 300`);

    const posts: PostRow[] = rows.map((r) => {
      const meta = (r.meta && typeof r.meta === "object" ? r.meta : {}) as Record<string, unknown>;
      const st = (r.stats && typeof r.stats === "object" && !Array.isArray(r.stats) ? r.stats : {}) as Record<string, unknown>;
      const pieceId = n(r.piece_id);
      const o: PostRow = {
        id: r.post_id ? n(r.post_id) : pieceId,
        pieceId, channel: String(r.channel), accountHandle: r.handle ? String(r.handle) : null,
        title: String(r.title || ""), status: String(r.status) as PostRow["status"],
        stats: {}, alive: String(st.alive ?? "") !== "false",   // 기본은 «살아 있다» — 확인한 적 없으면 죽었다고 하지 않는다
      };
      const urlStr = String(r.po_url || r.p_url || "");
      if (urlStr) o.externalUrl = urlStr;
      if (r.published_via === "api" || r.published_via === "runner" || r.published_via === "manual") o.publishedVia = r.published_via;
      const at = utcDate(r.po_at) ?? utcDate(r.p_at); if (at) o.publishedAt = at.toISOString();
      for (const k of ["views", "likes", "comments"] as const) if (Number.isFinite(Number(st[k])) && st[k] !== null && st[k] !== undefined) o.stats[k] = Number(st[k]);
      const sync = utcDate(st.lastSyncAt); if (sync) o.stats.lastSyncAt = sync.toISOString();
      // errorKind: piece.meta 가 있으면 그것 · 없으면 그 글의 마지막 러너 잡이 남긴 분류. 어휘 밖 값은 싣지 않는다.
      const ek = String(meta.errorKind ?? r.job_error_kind ?? "");
      if (ek && ERROR_KINDS.has(ek)) o.errorKind = ek;
      if (meta.failReason) o.failReason = String(meta.failReason).slice(0, 300);
      return o;
    });

    return json({ ok: true, posts, range: { from, to }, status });
  } catch (err) { return jsonError("posts_list", err); }
};
