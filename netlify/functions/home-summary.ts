/**
 * GET /api/home-summary — 홈 한 화면 재료(DESIGN §13 · 토스 패턴 «문장형 헤드라인 + 그룹 섹션»).
 *   today/month 수익 · 해야 할 일 · 오늘 편성 · 자동 편성 상태 · 체험 · 알림. Phase 0 = 빈 상태가 정직하게 나오는 것이 목표.
 */
import { json, jsonError } from "../../lib/response";
import { requireUser } from "../../lib/guards";
import { userContext } from "../../lib/auth-service";
import { db } from "../../db/index";
import { utcDate } from "../../lib/db-util";
import { homeRevenue } from "../../lib/revenue/aggregate";
/* [R7 §1.4] 홈 «해야 할 일»이 읽는 두 판정기 — 둘 다 **이미 있는 정본**을 부른다(홈이 제 나름의 기준을 새로 만들지 않게).
   · summarizeSlotBlocks: 슬롯 게이트 거부 집계(lib/slot-gate.ts:12 가 «홈 해야 할 일»에 쓰라고 만들어 둔 것 — 호출부가 0곳이었다 · AC-29)
   · planOf·autoApproveAllowed: «조용하면 발행»을 이 요금제가 쓸 수 있나(B3 가 크론 review-deadline 에 건 게이트와 같은 함수) */
import { summarizeSlotBlocks } from "../../lib/slot-gate";
import { planOf, autoApproveAllowed } from "../../lib/plans";
import { GATE_LABEL, type GateKey } from "../../lib/ai-tell-gate";   // 🔴 라벨 정본은 서버(AC-52) — 화면이 문구를 지어내지 않는다
/* [R7 §1.4] 열린 채널 이름은 `channel_registry` 가 정본이다 — 고객 «계정 연결» 그리드가 그리는 기준(`status='active'`)과 같은 곳을 본다.
   문자열로 박아 두면 채널이 열리고 닫힐 때마다 사람이 문구를 고치러 와야 하고, 그러다 못 붙이는 채널을 계속 권하게 된다(A 실측 지적 2026-09-15). */
import { listChannels } from "../../lib/accounts";
import { sql } from "drizzle-orm";
export const config = { path: "/api/home-summary" };
type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Number(v || 0);
/** «살아 있다» 판정 창 — 러너 하트비트 주기 기준. `lib/runner-jobs.ts ONLINE_WINDOW_MIN`·`lib/video/render-queue.ts ONLINE_MIN` 과 같은 값. */
const RUNNER_ONLINE_MIN = 5;
/** 한 번도 응답이 없는 기기를 «꺼졌다»고 말하기까지 기다리는 시간 — 방금 등록하고 켜는 중일 수 있다(render-queue.ts RUNNER_WAIT_MIN 과 같은 값). */
const RUNNER_NEVER_WAIT_MIN = 30;
/** `timestamp`(tz 없는 UTC) 칸이 몇 분 전인가. `utcDate` 와 같은 해석(PITFALLS #4) — 없으면 Infinity(= «모른다»가 아니라 «오래됐다»로 쓰지 않도록 호출부가 갈라 본다). */
const minsSince = (v: unknown): number => { const d = utcDate(v); return d ? (Date.now() - d.getTime()) / 60_000 : Infinity; };

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
    const settings = (ctx.tenant.settings || {}) as Record<string, unknown>;
    /* [R7 §1.4] «조용하면 그대로 발행»이 이 요금제에서 막히나 — 판정은 B3 가 크론(lib/cron/review-deadline.ts:48)에 건 것과 **같은 함수**로 한다.
       조건도 같다: 사용자가 `silence_approves` 를 **명시 저장한 적이 없고**(= 기본값으로 자동 승인 중이라 믿고 있고) 요금제가 자동 승인을 안 줄 때.
       🔴 이걸 홈에 안 올리면 Starter 사장님은 «가만 두면 나가겠지» 하고 기다리다 마감을 넘긴다(그때서야 알림이 온다 — 이미 못 나간 뒤다). */
    let forcedByPlan = false;
    try {
      if (settings.reviewPolicy !== "require_confirm" && settings.reviewPolicy !== "silence_approves") {
        const pk = String(ctx.tenant.planKey ?? "");
        forcedByPlan = !autoApproveAllowed(pk, await planOf(pk));
      }
    } catch (e) { console.warn("[home] 자동 승인 요금제 판정 실패 — 행을 만들지 않는다", String((e as Error)?.message ?? e).slice(0, 120)); }
    const todo: { kind: string; title: string; desc: string; link: string; tone: "warn" | "info"; count?: number; pieceId?: number }[] = [];
    // ★C(P1R4) fix: 체험 종료(readonly)·정지(suspended)는 홈 «해야 할 일» 첫 행이어야 한다(계약 §1.3 · 알림함에만 있으면 홈에서 왜 안 만들어지는지 모른다)
    if (ctx.tenant.status === "readonly") todo.push({ kind: "plan", title: "체험이 끝났어요 — 요금제를 골라 주세요", desc: "만든 글·편성표는 그대로예요. 고르면 바로 이어서 만들고 발행해요", link: "/app/plan.html", tone: "warn" });
    else if (ctx.tenant.status === "suspended") todo.push({ kind: "plan", title: "결제가 안 돼서 잠시 멈췄어요", desc: "결제 수단을 확인하면 바로 다시 돌아가요", link: "/app/plan.html", tone: "warn" });
    const relogin = await q(sql`SELECT id, channel, handle FROM accounts WHERE tenant_id = ${tid} AND status IN ('suspended','disconnected') AND COALESCE(last_error_kind,'') <> 'removed' ORDER BY id`);
    for (const a of relogin) todo.push({ kind: "account", title: `@${a.handle} 다시 연결이 필요해요`, desc: String(a.channel), link: "/app/accounts.html", tone: "warn" });

    /* ══════════ [R7 §1.4] 멈춘 것들을 홈에 올린다 ══════════
       왜: 지금까지 «만들다 멈춤·올리다 멈춤»은 알림함과 감사에만 남았다. 홈만 보는 사장님에겐 **아무 일도 없는 것처럼** 보인다.
       🔴 0건이면 행을 만들지 않는다 — 그리고 «못 셌다»를 «0건»으로 접지 않는다(AC-9). 조회가 깨지면 그 행만 빠지고
          홈의 나머지(수익·오늘 편성)는 그대로 나온다(CLAUDE §4.1 «보조 SELECT 실패는 빈 배열로 계속»). */
    try {
      // 🔴 러너가 못 넘은 로그인. 위 relogin(suspended·disconnected)과 **다른 상태**다 — 저건 «연결이 끊겼다», 이건 «로그인 창에서 멈췄다»(lib/account-health.ts:64).
      const pendingLogin = await q(sql`SELECT id, channel, handle FROM accounts
        WHERE tenant_id = ${tid} AND status = 'pending_login' AND COALESCE(last_error_kind,'') <> 'removed' ORDER BY id`);
      for (const a of pendingLogin) todo.push({ kind: "pending_login", title: `@${a.handle} 다시 로그인해 주세요`, desc: "로그인 확인(캡차·2단계)에서 멈췄어요. 한 번만 직접 로그인해 주시면 이어서 올려요", link: "/app/accounts.html", tone: "warn" });
    } catch (e) { console.warn("[home] pending_login 조회 실패", String((e as Error)?.message ?? e).slice(0, 120)); }

    try {
      const [stuck] = await q(sql`SELECT
          (SELECT COUNT(*) FROM pieces WHERE tenant_id = ${tid} AND status = 'awaiting_manual') AS manual_c,
          (SELECT COUNT(*) FROM pieces WHERE tenant_id = ${tid} AND status = 'awaiting_manual' AND kind = 'video') AS manual_video_c,
          (SELECT MIN(id) FROM pieces WHERE tenant_id = ${tid} AND status = 'awaiting_manual') AS manual_first,
          (SELECT COUNT(*) FROM slots WHERE tenant_id = ${tid} AND status = 'coin_short') AS coin_c,
          (SELECT to_char(MIN(slot_date), 'FMMM"월" FMDD"일"') FROM slots WHERE tenant_id = ${tid} AND status = 'coin_short') AS coin_first`);
      /* ══════════ [R8 §4.1 → §9 최종] 🔴 **«막혔어요»가 아니라 «이 위험을 안고 나가요»** ══════════
         처음 이 자리를 만들 때는 «고지·금칙어 게이트로 **막힌** 글»이었다. 그 뒤 사장님이 전역으로 정하셨다 —
         **«말해 주기로 내려. 고객 계정이야. 우리가 책임지는 게 아니야.»** (`lib/content-approve.ts HARD_GATE_KEYS = []`).
         🔴 그래서 **막는 판정은 하나도 없다.** 그런데 검사는 그대로 다 돌고 `gate_report.checks[]` 에 그대로 남는다.
            남은 일은 **그 표시를 사람이 볼 수 있게 올리는 것**이다 — 안 올리면 «검사했는데 아무도 안 봤다»가 되고,
            그건 «조용히 0건»(CLAUDE §4.7)의 가장 나쁜 형태다(우리는 알았는데 고객만 몰랐다).
         🔴 kind 는 `review_blocked` 그대로 둔다(화면 낱말이 이미 있다 · AC-52). **뜻만 바뀐다** — A 에 한 줄 보냈다.
         🔴 «직접 올려야 할 게 N건»(awaiting_manual)과 겹치지 않게 그 상태는 **여기서 빼고 센다** — 같은 글을 두 줄로 세면 숫자를 못 믿는다. */
      let warnRows: Record<string, unknown>[] = [];
      let warnPre = 0, warnPost = 0, warnFirst = 0;
      try {
        const [wc] = await q(sql`SELECT
            COUNT(DISTINCT p.id) FILTER (WHERE p.status <> 'published')::int AS pre_n,
            COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'published')::int AS post_n,
            MIN(p.id) FILTER (WHERE p.status <> 'published')::int AS pre_first,
            MIN(p.id) FILTER (WHERE p.status = 'published')::int AS post_first
          FROM pieces p, LATERAL jsonb_array_elements(p.gate_report -> 'checks') c
          WHERE p.tenant_id = ${tid} AND p.status IN ('draft', 'in_review', 'approved', 'scheduled', 'published')
            AND jsonb_typeof(p.gate_report -> 'checks') = 'array' AND c->>'pass' = 'false'`);
        warnPre = n(wc?.pre_n); warnPost = n(wc?.post_n);
        warnFirst = warnPre ? n(wc?.pre_first) : n(wc?.post_first);
        if (warnPre || warnPost) {
          warnRows = await q(sql`SELECT c->>'key' AS key,
              COUNT(DISTINCT p.id) FILTER (WHERE p.status <> 'published')::int AS pre_n,
              COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'published')::int AS post_n
            FROM pieces p, LATERAL jsonb_array_elements(p.gate_report -> 'checks') c
            WHERE p.tenant_id = ${tid} AND p.status IN ('draft', 'in_review', 'approved', 'scheduled', 'published')
              AND jsonb_typeof(p.gate_report -> 'checks') = 'array' AND c->>'pass' = 'false'
            GROUP BY 1 ORDER BY 2 DESC, 3 DESC, 1`);
        }
      } catch (e) { console.warn("[home] 위험 표시 조회 실패 — 그 행만 빠진다", String((e as Error)?.message ?? e).slice(0, 120)); }
      if (warnPre || warnPost) {
        /* 사유는 **많이 걸린 순서 3개까지** · 라벨은 서버 정본 그대로(AC-52 · 화면이 문구를 지어내지 않는다). */
        const key = warnPre ? "pre_n" : "post_n";
        const why = warnRows.filter((r) => n(r[key])).slice(0, 3).map((r) => GATE_LABEL[String(r.key) as GateKey] ?? String(r.key)).filter(Boolean).join(" · ");
        const one = (warnPre || warnPost) === 1 && warnFirst;
        todo.push(warnPre
          ? { kind: "review_blocked", title: `이 위험을 안고 나갈 글이 ${warnPre}건 있어요`, count: warnPre,
              desc: `${why || "확인이 필요한 표시가 있어요"} — 막지는 않았어요. 그대로 두시면 이 상태로 나가요${warnPost ? ` (이미 나간 글 ${warnPost}건에도 같은 표시가 있어요)` : ""}`,
              link: one ? `/app/piece.html?id=${warnFirst}` : "/app/pieces.html?status=in_review", tone: "warn", ...(one ? { pieceId: warnFirst } : {}) }
          : { kind: "review_blocked", title: `이 위험을 안고 나간 글이 ${warnPost}건 있어요`, count: warnPost,
              desc: `${why || "확인이 필요한 표시가 있어요"} — 막지 않았어요. 지금이라도 고치거나 내릴 수 있어요`,
              link: one ? `/app/piece.html?id=${warnFirst}` : "/app/posts.html", tone: "warn", ...(one ? { pieceId: warnFirst } : {}) });
      }
      const manualC = n(stuck?.manual_c), manualVideo = n(stuck?.manual_video_c), manualFirst = n(stuck?.manual_first);
      if (manualC) {
        /* 영상이 섞여 있으면 §1.3 흐름(내려받기 → 앱에서 올리기 → 주소 적기)을 가리킨다. 글뿐이면 종전대로 «직접 올려 주세요». */
        const videoC = Math.min(manualVideo, manualC);   // 게이트 몫을 뺀 뒤라 영상 수가 합계를 넘지 않게
        const desc = videoC
          ? (videoC === manualC ? "내려받아서 앱에 올린 뒤 주소를 적어 주시면 수익까지 이어져요" : `영상 ${videoC}건은 내려받아서 올린 뒤 주소를 적어 주세요`)
          : "자동으로 올리지 못했어요. 직접 올린 뒤 주소를 적어 주세요";
        todo.push({ kind: "awaiting_manual", title: `직접 올려야 할 게 ${manualC}건 있어요`, desc, count: manualC,
          // 1건이면 그 글로 바로, 여러 건이면 발행함의 같은 칸으로(publisher.ts:194 가 알림에 쓰는 링크와 같은 곳).
          link: manualC === 1 && manualFirst ? `/app/piece.html?id=${manualFirst}` : "/app/posts.html?status=awaiting_manual", tone: "warn",
          ...(manualC === 1 && manualFirst ? { pieceId: manualFirst } : {}) });
      }
      const coinC = n(stuck?.coin_c);
      if (coinC) todo.push({ kind: "coin_short", title: `코인이 모자라 미뤄 둔 자리가 ${coinC}개 있어요`, desc: `코인을 채우면 그 자리에서 이어서 만들어요${stuck?.coin_first ? ` (가장 이른 자리 ${String(stuck.coin_first)})` : ""}`, count: coinC, link: "/app/coins.html", tone: "warn" });
      /* [P1R7 §3.6 · B] 코인이 모자라 «쉬는» 계정 슬롯 — 그 계정만 멈춘 것이라 코인 부족(자리)과 따로 말한다.
         B-1 §1.4 표의 어휘를 따른다(kind = 한 낱말 · link 는 눌러야 할 곳). */
      const [slotP] = await q(sql`SELECT COUNT(*)::int AS c, MIN(coins_per_period)::int AS coins FROM account_slots WHERE tenant_id = ${tid} AND status = 'paused'`);
      if (n(slotP?.c)) todo.push({ kind: "account_slot", title: `계정 ${n(slotP.c)}개가 코인이 모자라 쉬고 있어요`, count: n(slotP.c),
        desc: `코인 ${n(slotP.coins) * n(slotP.c)}개를 채우면 그 계정만 바로 다시 돌아가요(다른 계정은 그대로 돌고 있어요)`, link: "/app/coins.html", tone: "warn" });
    } catch (e) { console.warn("[home] 멈춘 글·자리 조회 실패", String((e as Error)?.message ?? e).slice(0, 120)); }
    const [review] = await q(sql`SELECT COUNT(*) AS c FROM pieces WHERE tenant_id = ${tid} AND status = 'in_review'`);
    /* 🔴 `forcedByPlan` 이면 «내일 나가기 전에 확인해 주세요»는 **거짓말**이 된다 — 승인하지 않으면 그 글은 아예 안 나간다(B3 크론이 마감 뒤 awaiting_manual 로 내린다). */
    /* 🔴 [R8 §4.5] 팀 승인이 켜진 집 — «봐주실 글»에 **주인을 기다리는 몫**을 한 줄로 얹는다.
       🔴 **새 kind 를 만들지 않는다**: 같은 글들이라 행을 둘로 나누면 «몇 건인지»를 못 믿게 된다(오늘 게이트 행에서 겪은 그 모양).
       🔴 그리고 이건 «막혔다»가 아니라 **«기다리는 중»**이다 — 그래서 tone 도 그대로 두고 문구만 사실을 더한다. */
    let teamWait = { count: 0, firstId: 0 };
    try { const { waitingForOwner } = await import("../../lib/team"); teamWait = await waitingForOwner(tid); }
    catch (e) { console.warn("[home] 팀 대기 조회 실패 — 그 한 줄만 빠진다", String((e as Error)?.message ?? e).slice(0, 100)); }
    if (n(review?.c)) todo.push({ kind: "review", title: `봐주실 글 ${n(review.c)}건이 있어요`, count: n(review.c),
      desc: teamWait.count
        ? `그중 ${teamWait.count}건은 팀원이 만든 글이라 주인이 보셔야 나가요`
        : forcedByPlan ? "승인하지 않으면 오늘은 나가지 않아요" : "내일 나가기 전에 확인해 주세요",
      link: "/app/pieces.html?status=in_review", tone: forcedByPlan || teamWait.count ? "warn" : "info" });
    /* [R7 §1.4] 요금제 때문에 «조용하면 발행»이 막힌 상태 — 왜 기다리면 안 되는지와 푸는 길(요금제)을 따로 한 줄로.
       🔴 kind 는 B3 감사 detail 의 키와 **글자 그대로** 같게 뒀다(`review-deadline.ts:110` detail.forcedByPlan) —
          홈에서 본 줄과 감사에 남은 사실을 한 단어로 grep 해 잇기 위해서다. 볼 글이 0건이면 행을 만들지 않는다(규칙만 떠 있으면 잔소리다). */
    if (forcedByPlan && n(review?.c)) todo.push({ kind: "forcedByPlan", title: "지금 요금제에선 검수를 눌러야 글이 나가요",
      desc: "«조용하면 그대로 발행»은 Pro 부터예요. 올려 두면 확인 없이도 나가요", link: "/app/plan.html", tone: "warn" });
    /* 🔴 응답의 `runner.online` 은 종전 키라 그대로 둔다(화면 호환). 다만 «꺼졌나» **판정**은 `status` 칸이 아니라 하트비트로 한다 —
       프로세스가 죽으면 status 는 'online' 인 채로 굳는다(lib/video/render-queue.ts offlineReason 과 같은 기준 · 창 5분). */
    const [runner] = await q(sql`SELECT COUNT(*) FILTER (WHERE status='online') AS online, COUNT(*) AS total,
        COUNT(*) FILTER (WHERE last_seen_at > NOW() - (${RUNNER_ONLINE_MIN} * INTERVAL '1 minute')) AS fresh,
        MAX(last_seen_at) AS last_seen, MIN(created_at) AS first_registered
      FROM runner_devices WHERE tenant_id = ${tid}`);
    /* [R7 §1.4] 내 PC 프로그램이 꺼져 있다 — 네이버·티스토리·클립은 이게 꺼져 있으면 **아무것도 안 나간다**(조용히 밀린다).
       🔴 «한 번도 응답이 없다»와 «꺼졌다»는 다르다(2026-09-14 실측 사고 · render-queue.ts:174):
          방금 등록한 기기는 하트비트 전이라 last_seen 이 없다 — 켜는 중일 수 있어 30분은 아무 말 하지 않는다. */
    if (n(runner?.total) && !n(runner?.fresh)) {
      const quiet = minsSince(runner?.last_seen);
      const never = !runner?.last_seen;
      const sayIt = never ? minsSince(runner?.first_registered) >= RUNNER_NEVER_WAIT_MIN : quiet >= RUNNER_ONLINE_MIN;
      if (sayIt) todo.push({ kind: "runner", tone: "warn",
        title: never ? "내 PC 프로그램이 아직 한 번도 연결되지 않았어요" : "내 PC 프로그램이 꺼져 있어요",
        /* 🔴 내림(Math.floor)이 아니라 반올림 — 40분 전 하트비트를 «39분째»로, 3시간 전을 «2시간째»로 말하면 사장님이 보는 시계와 어긋난다(실측에서 잡힘). */
        desc: never ? "프로그램을 실행하고 로그인해 주세요. 켜면 밀린 것부터 이어서 올려요"
                    : `${quiet >= 120 ? `${Math.round(quiet / 60)}시간째` : `${Math.round(quiet)}분째`} 응답이 없어요. 켜 두시면 밀린 것부터 이어서 올려요`,
        link: "/app/runner.html" });
    }
    const [accounts] = await q(sql`SELECT COUNT(*) AS c FROM accounts WHERE tenant_id = ${tid} AND COALESCE(last_error_kind,'') <> 'removed'`);
    const [rules] = await q(sql`SELECT COUNT(*) AS c FROM cadence_rules WHERE tenant_id = ${tid} AND active = true`);
    /* [R7 §1.4] 편성표에 자리가 없어 자동 생성이 막힌 건수 — `lib/slot-gate.ts:12` 가 «홈 해야 할 일»에 쓰라고 만들어 둔 집계인데
       호출부가 **0곳**이었다(AC-29 · «만들어 두고 안 부르는 함수»). 막힌 사실이 감사에만 있으면 사장님은 «왜 요즘 글이 없지»만 느낀다.
       🔴 조회 실패는 blocked=0 으로 돌아온다 — 그래서 blocked>0 일 때만 줄을 만든다(«못 셌다»를 «0건»으로도, «있다»로도 그리지 않는다). */
    try {
      const gate = await summarizeSlotBlocks(tid, 7);
      if (gate.blocked > 0) {
        const top = gate.bySource[0];
        todo.push({ kind: "slot_gate", title: `편성표에 자리가 없어 못 만든 게 ${gate.blocked}건 있어요`, count: gate.blocked,
          desc: `자리를 늘리면 그만큼 더 만들어요${top?.lastReason ? ` (${String(top.lastReason).slice(0, 40)})` : ""}`,
          link: "/app/schedule.html", tone: "warn" });
      }
      // 안전핀(SLOT_GATE=off)으로 통과한 게 있으면 게이트가 사실상 꺼져 있다는 뜻 — 고객이 할 일은 아니지만 **조용히 넘기지 않는다**(운영 로그).
      if (gate.bypassed > 0) console.warn(`[home] 🔴 슬롯 게이트 안전핀 통과 ${gate.bypassed}건 — tenant=${tid} · SLOT_GATE 를 확인해라`);
    } catch (e) { console.warn("[home] 슬롯 게이트 집계 실패", String((e as Error)?.message ?? e).slice(0, 120)); }
    if (!n(accounts?.c)) {
      /* 🔴 채널 이름을 박지 않는다 — 지금 **열려 있는**(`status='active'`) 채널 이름을 레지스트리에서 뽑아 말한다.
         0개면 «연결해 보세요»가 거짓말이 되므로 제목까지 바꾼다(없는 걸 권하지 않는다 · 조회 실패도 같은 취급). */
      let open: string[] = [];
      try { open = (await listChannels()).filter((c) => c.status === "active").map((c) => c.label).filter(Boolean); }
      catch (e) { console.warn("[home] 채널 레지스트리 조회 실패 — 이름 없이 말한다", String((e as Error)?.message ?? e).slice(0, 120)); }
      todo.push(open.length
        ? { kind: "setup", title: "첫 계정을 연결해 보세요", desc: `${open.slice(0, 3).join("·")} 하나면 돼요`, link: "/app/accounts.html", tone: "info" }
        : { kind: "setup", title: "채널을 여는 중이에요", desc: "연결할 수 있는 채널이 생기면 여기서 알려 드릴게요", link: "/app/accounts.html", tone: "info" });
    }
    else if (!n(rules?.c)) todo.push({ kind: "setup", title: "자동 편성을 켜 보세요", desc: "규칙 하나면 한 달치가 알아서 나가요", link: "/app/schedule.html", tone: "info" });
    if (!ctx.user.emailVerified) todo.push({ kind: "verify", title: "이메일 인증을 마쳐 주세요", desc: "가입 때 보낸 메일의 버튼을 눌러 주세요", link: "/app/settings.html", tone: "info" });
    const notices = await q(sql`SELECT id, kind, title, body FROM notices WHERE active = true AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW()) ORDER BY id DESC LIMIT 3`);
    const [unread] = await q(sql`SELECT COUNT(*) AS c FROM notifications WHERE tenant_id = ${tid} AND read_at IS NULL`);
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
