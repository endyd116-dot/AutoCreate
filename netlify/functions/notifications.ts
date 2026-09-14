/**
 * 알림함 API(계약 P1R2 §6 v2.3 — R1 부터 크론·러너·승계가 `notifications` 에 쓰는데 **읽는 문이 없었다**):
 *   GET  /api/notifications-list?limit=50 → { ok:true, notifications:[NotificationRow], unread }
 *   POST /api/notifications-read { id? }  → { ok:true, unread }        // id 없으면 전부 읽음
 *
 *   `unread` 는 `home-summary` 와 **같은 식**이다(`read_at IS NULL` 카운트). 어긋나면 사용자가 «안 읽음 3» 을 눌렀는데
 *   목록은 0 인 상황이 된다 — 숫자가 두 곳에서 갈라지는 것이 이 화면의 유일한 사고 경로다.
 *   `desc` = `body` 컬럼 · `tone` 은 `kind` 로 정한다(서버가 문장을 만들지 않는다 — 사람말은 이미 쓰는 쪽이 넣었다).
 */
import { json, jsonError } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { utcDate } from "../../lib/db-util";
import { q } from "../../lib/accounts";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/notifications-list", "/api/notifications-read"] };
/** netlify dev 정적 폴백 대비 — 꼬리를 떼고 맞춘다(AC-7). */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Number(v || 0);

/** 빨간 줄로 보여야 하는 알림 = «사용자가 뭔가 해야 끝나는» 것. 나머지는 알려 주기만 하면 된다. */
const WARN_KINDS: ReadonlySet<string> = new Set([
  "account_suspended", "account_relogin", "publish_failed", "publish_manual", "publish_blocked",
  "runner_offline", "piece_failed", "review_blocked", "review_missed", "coin_short",
]);

export interface NotificationRow { id: number; kind: string; title: string; desc?: string; link?: string; tone: "warn" | "info"; createdAt: string; readAt?: string }

/** 안 읽은 수 — home-summary 와 같은 질의(숫자가 갈라지지 않게 여기가 유일한 식이다). */
async function unreadCount(tid: number): Promise<number> {
  const [r] = await q(sql`SELECT COUNT(*) AS c FROM notifications WHERE tenant_id = ${tid} AND read_at IS NULL`);
  return n(r?.c);
}

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const url = new URL(req.url); const path = routeOf(req);
  try {
    if (path.endsWith("/notifications-list")) {
      const limit = Math.max(1, Math.min(100, n(url.searchParams.get("limit")) || 50));
      const rows = await q(sql`SELECT id, kind, title, body, link, read_at, created_at FROM notifications
        WHERE tenant_id = ${tid} ORDER BY id DESC LIMIT ${limit}`);
      const notifications: NotificationRow[] = rows.map((r) => {
        const kind = String(r.kind);
        const o: NotificationRow = { id: n(r.id), kind, title: String(r.title), tone: WARN_KINDS.has(kind) ? "warn" : "info", createdAt: utcDate(r.created_at)?.toISOString() ?? "" };
        if (r.body) o.desc = String(r.body);
        if (r.link) o.link = String(r.link);
        const read = utcDate(r.read_at); if (read) o.readAt = read.toISOString();
        return o;
      });
      return json({ ok: true, notifications, unread: await unreadCount(tid) });
    }

    if (path.endsWith("/notifications-read")) {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
      const b = await readJson<{ id?: number }>(req);
      const id = n(b.id);
      // id 가 오면 그 한 건만(남의 테넌트 행은 WHERE 로 구조적으로 막힌다) · 없으면 전부.
      await q(id
        ? sql`UPDATE notifications SET read_at = NOW() WHERE tenant_id = ${tid} AND id = ${id} AND read_at IS NULL`
        : sql`UPDATE notifications SET read_at = NOW() WHERE tenant_id = ${tid} AND read_at IS NULL`);
      return json({ ok: true, unread: await unreadCount(tid) });
    }

    return json({ ok: false, error: "not_found" }, 404);
  } catch (err) { return jsonError("notifications", err); }
};
