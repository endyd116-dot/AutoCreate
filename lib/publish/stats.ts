/**
 * lib/publish/stats.ts — API 채널 발행물 통계 회수(계약 §1 `slots.learn` · B 포트 `fetchStats(tid, pieceId)`).
 *   AC 신규 2026-09-14(B2 · 메인 발주).
 *
 *   🔴 AC-9 — **없는 값을 0 으로 채우지 않는다.** 채널이 준 값만 싣고, 못 물어봤으면 `null`(«0회 조회»가 아니라 «모른다»).
 *      둘을 섞으면 소재 성과 학습이 0 으로 오염된다(B learn.ts 의 규율과 같다).
 *
 *   채널별로 **실제로 주는 것**만(공식 문서 2026-09 확인치):
 *     · 블로거 v3 `GET blogs/{blogId}/posts/{postId}` → `replies.totalItems`(댓글 수). **조회수는 글 단위로 주지 않는다**
 *       (`pageviews` 는 블로그 단위) → views 는 싣지 않는다. 404 → alive:false.
 *     · 워드프레스 REST `GET wp/v2/posts/{id}` → `status`(publish 면 alive) · 댓글 수는 `wp/v2/comments?post=&per_page=1` 의
 *       `X-WP-Total` 헤더. **조회수는 코어에 없다**(Jetpack 등 플러그인 영역) → 싣지 않는다.
 *   반환 모양은 포트의 `PostStats = { views?, likes?, comments?, alive? }` 그대로.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index";
import { ensureFreshToken, loadWpCreds } from "./tokens";

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const TIMEOUT_MS = 15_000;

export interface FetchedStats { views?: number; likes?: number; comments?: number; alive?: boolean }

async function jget(url: string, headers: Record<string, string>): Promise<{ status: number; json: any; headers: Headers } | null> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    let json: any = null; try { json = await r.json(); } catch { /* 본문 없음 */ }
    return { status: r.status, json, headers: r.headers };
  } catch { return null; }   // 네트워크 — «못 물어봤다»
  finally { clearTimeout(t); }
}

async function bloggerStats(tid: number, accountId: number, handle: string, channelRef: string): Promise<FetchedStats | null> {
  let tok = await ensureFreshToken(tid, accountId, "blogger", handle);
  if (!tok.ok) return null;
  const blogId = String((tok.token.extra as Record<string, unknown> | undefined)?.blogId ?? tok.token.externalId ?? "").trim();
  if (!blogId || !channelRef) return null;
  const url = `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(channelRef)}`;
  let r = await jget(url, { Authorization: `Bearer ${tok.token.accessToken}` });
  if (r && r.status === 401) {
    tok = await ensureFreshToken(tid, accountId, "blogger", handle, true);
    if (!tok.ok) return null;
    r = await jget(url, { Authorization: `Bearer ${tok.token.accessToken}` });
  }
  if (!r) return null;
  if (r.status === 404) return { alive: false };
  if (r.status < 200 || r.status >= 300) return null;
  const out: FetchedStats = { alive: String(r.json?.status ?? "LIVE").toUpperCase() !== "DRAFT" };
  const replies = Number(r.json?.replies?.totalItems);
  if (Number.isFinite(replies)) out.comments = Math.max(0, Math.trunc(replies));
  return out;   // views 없음 — 블로거는 글 단위 조회수를 주지 않는다
}

async function wordpressStats(accountId: number, channelRef: string): Promise<FetchedStats | null> {
  const creds = await loadWpCreds(accountId);
  if (!creds || !channelRef) return null;
  const auth = `Basic ${Buffer.from(`${creds.loginId}:${creds.appPassword.replace(/\s+/g, "")}`, "utf8").toString("base64")}`;
  const post = await jget(`${creds.siteUrl}/wp-json/wp/v2/posts/${encodeURIComponent(channelRef)}?_fields=id,status`, { Authorization: auth });
  if (!post) return null;
  if (post.status === 404) return { alive: false };
  if (post.status < 200 || post.status >= 300) return null;
  const out: FetchedStats = { alive: String(post.json?.status ?? "") === "publish" };
  const c = await jget(`${creds.siteUrl}/wp-json/wp/v2/comments?post=${encodeURIComponent(channelRef)}&per_page=1&_fields=id`, { Authorization: auth });
  if (c && c.status >= 200 && c.status < 300) {
    const total = Number(c.headers.get("x-wp-total"));
    if (Number.isFinite(total)) out.comments = Math.max(0, Math.trunc(total));
  }
  return out;   // views 없음 — 코어 REST 에 조회수가 없다
}

/**
 * fetchStats — B 포트 시그니처 `(tid, pieceId) → PostStats | null`.
 *   null = «못 물어봤다»(자격 없음·네트워크·미지원 채널). 러너 채널은 여기서 다루지 않는다(revenue.stats 잡).
 */
export async function fetchStats(tid: number, pieceId: number): Promise<FetchedStats | null> {
  const [row] = await q(sql`
    SELECT po.channel_ref, po.external_url, p.channel, p.account_id, a.handle
      FROM posts po JOIN pieces p ON p.id = po.piece_id LEFT JOIN accounts a ON a.id = po.account_id
     WHERE po.tenant_id = ${tid} AND po.piece_id = ${pieceId} ORDER BY po.id DESC LIMIT 1`);
  if (!row) return null;
  const channel = String(row.channel ?? "");
  const accountId = n(row.account_id);
  const channelRef = String(row.channel_ref ?? "").trim();
  if (!accountId) return null;
  try {
    if (channel === "blogger") return await bloggerStats(tid, accountId, String(row.handle ?? ""), channelRef);
    if (channel === "wordpress") return await wordpressStats(accountId, channelRef);
  } catch (e) { console.warn("[publish/stats] fetch failed", channel, pieceId, String((e as Error)?.message ?? e).slice(0, 120)); }
  return null;   // 러너 채널·미지원 채널 — 이 함수의 몫이 아니다
}
