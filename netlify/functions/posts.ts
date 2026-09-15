/**
 * 발행함 API(계약 P1R2 §6 v2.1 · DESIGN §2.3):
 *   GET  /api/posts-list?from=&to=&status=published|awaiting_manual|failed|all(기본 all) → { ok:true, posts:[PostRow] }
 *   POST /api/post-retract { postId, reason? } → { ok, state, message, openUrl? }   // [R8 §3 · DESIGN §5E] 고객이 «내려 줘»를 누른다
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
import { readJson } from "../../lib/validate";
import { retractPost } from "../../lib/publish/retract";
import { canRetract } from "../../lib/channel-registry";
import { utcDate } from "../../lib/db-util";
import { q } from "../../lib/accounts";
import { kstDateStr, addDays } from "../../lib/best-time";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/posts-list", "/api/post-retract"] };
/** netlify dev 의 정적 폴백이 경로 매칭에서 빠지면 엉뚱한 405 가 보인다 — 꼬리를 떼고 맞춘다(AC-7). */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
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
  /** [R8 §3 · DESIGN §5E] 🔴 **우리가 대신 내려 줄 수 있는 채널인가** — 화면이 단추를 켤지 정하는 값.
      false 면 «직접 내려 주세요» + `externalUrl` 로 보낸다. **없는 길을 단추로 만들지 않는다.** */
  canRetract: boolean;
  /** 이미 내렸나(내린 시각). 있으면 단추 대신 «내렸어요»를 보여 준다. */
  retractedAt?: string;
  /**
   * [P1R8 §9 · A 요청] 🔴 **나간 뒤에도 보이는 위험** — 하드 게이트가 0이라 «막지 않고 말해 주는» 것이 유일한 안전장치다.
   *   자동 승인으로 나간 글은 **아무도 검수 화면을 안 본다** — 그래서 발행함 목록에서 바로 짚어 준다.
   *   riskCount = 실패한 검사 칸 수 · riskHigh = 그중 무거운 것(법·제3자·계정)이 있나 · 자세한 내용은 pieces-get 의 gate.
   */
  riskCount?: number;
  riskHigh?: boolean;
}

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const url = new URL(req.url);
  try {
    /* ── [R8 §3 · DESIGN §5E] 올린 글 내리기 ──
       🔴 **고객이 누른 것만** 여기로 온다(§5E.1 ② — «우리가 동의 없이 내린다»(③)는 만들지 않았다).
       🔴 `requireWritable` 을 **부르지 않는다** — 체험이 끝났다고 «내 글을 내려 달라»를 막으면,
          고객이 내리고 싶은데 못 내리는 상태가 된다. 돈이 드는 경로가 아니고(코인 0), 되레 **안 막는 게 안전한 쪽**이다
          (`/api/post-mark-published` 가 같은 이유로 안 부른다). */
    if (routeOf(req).endsWith("/post-retract")) {
      if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);
      const b = await readJson<{ postId?: unknown; reason?: unknown }>(req);
      const postId = n(b.postId);
      if (!postId) return json({ ok: false, step: "id", error: "어떤 글인지 알 수 없어요." }, 400);
      const reason = String(b.reason ?? "").trim().slice(0, 200) || "고객 요청";
      const r = await retractPost(tid, postId, { reason, by: `user:${auth.user.uid}` });
      return json(r, r.ok ? 200 : r.state === "not_found" ? 404 : 409);
    }

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
                AND rj.error_kind IS NOT NULL ORDER BY rj.id DESC LIMIT 1) AS job_error_kind,
             /* [P1R8 §9] 검사 결과는 발행 뒤에도 pieces.gate_report 에 그대로 남는다 — 여기서는 **세기만** 한다(덮지 않는다). */
             p.gate_report AS gate_report
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
        canRetract: false,           // 아래에서 주소를 확인하고 정한다(이 자리엔 아직 urlStr 이 없다)
        stats: {}, alive: String(st.alive ?? "") !== "false",   // 기본은 «살아 있다» — 확인한 적 없으면 죽었다고 하지 않는다
      };
      const urlStr = String(r.po_url || r.p_url || "");
      if (urlStr) o.externalUrl = urlStr;
      /* [P1R8 §9] 나간 뒤에도 «이 글엔 이런 점이 있었어요»를 목록에서 짚어 준다.
         🔴 무게는 **서버 값**(`GateCheck.weight`)을 그대로 읽는다 — 화면도 우리도 키 목록을 외우지 않는다(AC-57).
         옛 글은 `weight` 가 없을 수 있다(이 기능 전에 저장된 보고서) → 그때는 개수만 센다(«무거움»을 지어내지 않는다). */
      const gr = (r.gate_report && typeof r.gate_report === "object" ? r.gate_report : null) as { checks?: { pass?: boolean; weight?: string }[] } | null;
      const failed = (gr?.checks ?? []).filter((c) => c && c.pass === false);
      if (failed.length) {
        o.riskCount = failed.length;
        if (failed.some((c) => c.weight === "high")) o.riskHigh = true;
      }
      /* [R8 §3 · DESIGN §5E] 🔴 «내려 줄 수 있나»는 **채널 성질 표**가 정한다(추측 0).
         주소가 있어야(=실제로 올라간 글이어야) 켠다 — 아직 안 올라간 글에 «내려 줘»가 뜨면 «뭘 내린다는 거지»가 된다. */
      o.canRetract = !!urlStr && canRetract(String(r.channel));
      const rt = (st.retract && typeof st.retract === "object" ? st.retract : null) as { retractedAt?: string } | null;
      if (rt?.retractedAt) { o.retractedAt = String(rt.retractedAt); o.canRetract = false; }   // 이미 내렸으면 단추를 끈다
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
