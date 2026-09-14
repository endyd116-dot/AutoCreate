/**
 * GET /api/home-summary — 홈 한 화면 재료(DESIGN §13 · 토스 패턴 «문장형 헤드라인 + 그룹 섹션»).
 *   today/month 수익 · 해야 할 일 · 오늘 편성 · 자동 편성 상태 · 체험 · 알림. Phase 0 = 빈 상태가 정직하게 나오는 것이 목표.
 */
import { json, jsonError } from "../../lib/response";
import { requireUser } from "../../lib/guards";
import { userContext } from "../../lib/auth-service";
import { db } from "../../db/index";
import { homeRevenue } from "../../lib/revenue/aggregate";
import { sql } from "drizzle-orm";
export const config = { path: "/api/home-summary" };
type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Number(v || 0);

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  try {
    const ctx = await userContext(auth.user.uid, tid);
    if (!ctx) return json({ ok: false, error: "계정을 찾을 수 없어요.", step: "user" }, 401);
    // KST 기준 오늘/이달 — 저장은 UTC·계산은 SQL 안에서(PITFALLS #4)
    const [rev] = await q(sql`SELECT
        COALESCE(SUM(amount_krw) FILTER (WHERE day = (NOW() AT TIME ZONE 'Asia/Seoul')::date),0) AS today,
        COALESCE(SUM(amount_krw) FILTER (WHERE day >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul')::date),0) AS month,
        COALESCE(SUM(amount_krw) FILTER (WHERE day >= (date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') - interval '1 month')::date
                                          AND day <= ((NOW() AT TIME ZONE 'Asia/Seoul') - interval '1 month')::date),0) AS last_same
      FROM revenue_daily WHERE tenant_id = ${tid}`);
    const todaySlots = await q(sql`SELECT s.id, s.channel, s.status, s.publish_at, s.account_id, s.piece_id, a.handle, p.title
      FROM slots s LEFT JOIN accounts a ON a.id = s.account_id LEFT JOIN pieces p ON p.id = s.piece_id
      WHERE s.tenant_id = ${tid} AND s.slot_date = (NOW() AT TIME ZONE 'Asia/Seoul')::date ORDER BY s.publish_at NULLS LAST, s.id`);
    const todo: { kind: string; title: string; desc: string; link: string; tone: "warn" | "info" }[] = [];
    const relogin = await q(sql`SELECT id, channel, handle FROM accounts WHERE tenant_id = ${tid} AND status IN ('suspended','disconnected') AND COALESCE(last_error_kind,'') <> 'removed' ORDER BY id`);
    for (const a of relogin) todo.push({ kind: "account", title: `@${a.handle} 다시 연결이 필요해요`, desc: String(a.channel), link: "/app/accounts.html", tone: "warn" });
    const [review] = await q(sql`SELECT COUNT(*) AS c FROM pieces WHERE tenant_id = ${tid} AND status = 'in_review'`);
    if (n(review?.c)) todo.push({ kind: "review", title: `봐주실 글 ${n(review.c)}건이 있어요`, desc: "내일 나가기 전에 확인해 주세요", link: "/app/pieces.html", tone: "info" });
    const [runner] = await q(sql`SELECT COUNT(*) FILTER (WHERE status='online') AS online, COUNT(*) AS total FROM runner_devices WHERE tenant_id = ${tid}`);
    const [accounts] = await q(sql`SELECT COUNT(*) AS c FROM accounts WHERE tenant_id = ${tid} AND COALESCE(last_error_kind,'') <> 'removed'`);
    const [rules] = await q(sql`SELECT COUNT(*) AS c FROM cadence_rules WHERE tenant_id = ${tid} AND active = true`);
    if (!n(accounts?.c)) todo.push({ kind: "setup", title: "첫 계정을 연결해 보세요", desc: "네이버 블로그·티스토리·유튜브 중 하나면 돼요", link: "/app/accounts.html", tone: "info" });
    else if (!n(rules?.c)) todo.push({ kind: "setup", title: "자동 편성을 켜 보세요", desc: "규칙 하나면 한 달치가 알아서 나가요", link: "/app/schedule.html", tone: "info" });
    if (!ctx.user.emailVerified) todo.push({ kind: "verify", title: "이메일 인증을 마쳐 주세요", desc: "가입 때 보낸 메일의 버튼을 눌러 주세요", link: "/app/settings.html", tone: "info" });
    const notices = await q(sql`SELECT id, kind, title, body FROM notices WHERE active = true AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW()) ORDER BY id DESC LIMIT 3`);
    const [unread] = await q(sql`SELECT COUNT(*) AS c FROM notifications WHERE tenant_id = ${tid} AND read_at IS NULL`);
    const settings = (ctx.tenant.settings || {}) as Record<string, unknown>;
    return json({ ok: true,
      // 계약 P1R3 §1.4b(5): 새 키 4개(확정/예상은 합치지 않는다 · DESIGN §9.3) + 옛 키 보존(호환).
      revenue: { ...(await homeRevenue(tid)), today: n(rev?.today), month: n(rev?.month), lastMonthSameDay: n(rev?.last_same) },
      // pieceId 는 있을 때만(계약 v2.7) — 홈 «봐주세요» 행이 piece.html?id= 로 바로 간다.
      todaySlots: todaySlots.map((s) => ({ id: n(s.id), channel: s.channel, status: s.status, publishAt: s.publish_at, handle: s.handle, title: s.title, ...(s.piece_id ? { pieceId: n(s.piece_id) } : {}) })),
      todo, notices, unread: n(unread?.c),
      auto: { enabled: !!settings.autoSchedule, rules: n(rules?.c) },
      runner: { online: n(runner?.online), total: n(runner?.total) },
      trial: { status: ctx.tenant.status, daysLeft: ctx.tenant.trialDaysLeft, planKey: ctx.tenant.planKey },
      coins: ctx.coins,
      impersonation: auth.user.imp || null,
    });
  } catch (err) { return jsonError("home", err); }
};
