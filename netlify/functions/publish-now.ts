/**
 * POST /api/publish-now { pieceId }  — «지금 올리기»(계약 P1R8 §4.2 · DESIGN §5B.6).
 *   지금까지는 승인 뒤 **5분 크론**만 있었다 — 고객이 «지금 올려»를 누를 길이 없었다.
 *
 *   → { ok:true, state:"published"|"queued"|"publishing"|"already", pieceId, postUrl?, runner?:{ online, offlineMin? }, message }
 *   400 `step`: "state"(승인 전·이미 나간 글) · "cadence"(오늘 한도·간격) · "gate"(발행 전 검사) · "publish"(그 밖의 실패 · 사람말 why)
 *   403 쓰기 게이트(체험 종료·정지·탈퇴) · 503 `step:"connector"`(발행 커넥터 미연결 — 상태를 건드리지 않았다)
 *
 *   🔴 **발행 규칙은 크론과 한 벌**(`lib/publish-one.ts`) — 여기서 상태 전이를 다시 쓰지 않는다(두 벌이면 갈라진다).
 *   🔴 **멱등**(§4.7): 이미 나간 글은 `already` 로 200 을 준다. 같은 글을 두 번 눌러도 남의 블로그에 두 번 올라가지 않는다
 *      (마지막 방어선은 B2 의 `external_url`/`channel_ref` 유일 검사 · 우리는 그 앞에서 상태로 한 번 더 막는다).
 *   🔴 **캐던스를 존중한다**(§4.7 계정 캐던스): 오늘 상한(워밍업 유효값) · 계정 min_gap · **같은 채널 계정 간 30분**.
 *      막히면 **언제부터 가능한지**(`retryAt`)를 같이 준다 — «안 돼요»만 주면 고객은 계속 누른다.
 */
import { sql } from "drizzle-orm";
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, requireWritable } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { q } from "../../lib/accounts";
import { utcDate } from "../../lib/db-util";
import { effectiveDailyCap, effectiveMinGapMin, warmupRisk } from "../../lib/warmup";
import { gapMinFor } from "../../lib/publish-gap";
import { publishOne } from "../../lib/publish-one";
import { publishPortStatus } from "../../lib/cron/publish-port";
import { pausedAccountIds } from "../../lib/account-slots";

export const config = { path: "/api/publish-now" };
const n = (v: unknown) => Number(v || 0);
/** 사람말 시각(KST · «오후 3시 20분»). 문구 속 시각은 전부 KST(§13.5). */
const kstAt = (d: Date) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit" }).format(d);

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid; const uid = Number(auth.user.uid);
  try {
    const b = await readJson<{ pieceId?: unknown; warmupOverride?: unknown }>(req);
    /* 🔴 [CLAUDE §9] 고객이 «이번 주 권장량을 넘겨서라도 올릴래»를 **직접 눌렀나**.
       저장하지 않는다 — **그 회차만**이다(끄는 것은 계정 설정의 `warmup_off` 가 따로 있다). */
    const warmupOverride = b.warmupOverride === true;
    const pieceId = n(b.pieceId); if (!pieceId) return badRequest("어떤 글을 올릴지 골라 주세요.", "pieceId");
    const w = await requireWritable(tid); if (!w.ok) return w.res;

    const [p] = await q(sql`SELECT p.id, p.title, p.channel, p.kind, p.status, p.account_id, p.slot_id, p.meta, p.scheduled_for,
        a.handle, a.status AS account_status, a.daily_cap, a.min_gap_min, a.posts_today, a.last_post_at, a.created_at AS account_created_at, a.opened_at, a.warmup_off,
        (SELECT COUNT(*) FROM posts x WHERE x.account_id = a.id
           AND (x.published_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date >= (date_trunc('week', (NOW() AT TIME ZONE 'Asia/Seoul'))::date)) AS posts_this_week
      FROM pieces p LEFT JOIN accounts a ON a.id = p.account_id
      WHERE p.tenant_id = ${tid} AND p.id = ${pieceId}`);
    if (!p) return json({ ok: false, error: "글을 찾을 수 없어요.", step: "not_found" }, 404);
    const status = String(p.status);
    const title = String(p.title || "글");

    /* ── 상태: 이미 나갔거나(멱등) 아직 승인 전이면 여기서 끝낸다 ── */
    if (status === "published") {
      const [post] = await q(sql`SELECT external_url FROM posts WHERE tenant_id = ${tid} AND piece_id = ${pieceId} ORDER BY id DESC LIMIT 1`);
      return json({ ok: true, state: "already", pieceId, ...(post?.external_url ? { postUrl: String(post.external_url) } : {}), message: "이미 올라간 글이에요." });
    }
    if (status === "publishing") return json({ ok: true, state: "publishing", pieceId, message: "지금 올리는 중이에요. 잠시만요." });
    if (status !== "approved" && status !== "scheduled") {
      return json({ ok: false, step: "state", status, error: status === "in_review" || status === "draft"
        ? "먼저 검수에서 승인해 주세요. 승인하면 바로 올릴 수 있어요."
        : "지금 상태로는 올릴 수 없어요. 발행함에서 상태를 확인해 주세요." }, 400);
    }

    /* ── 캐던스(§4.7) — 계정이 있는 글만. 영상처럼 계정 없이 만든 글은 이 검사를 건너뛴다(올릴 계정이 없으면 아래 publishOne 이 사람말로 답한다). ── */
    const accountId = p.account_id ? n(p.account_id) : 0;
    if (accountId) {
      if (String(p.account_status) === "suspended" || String(p.account_status) === "disconnected") {
        return json({ ok: false, step: "cadence", error: `@${String(p.handle ?? "")} 계정이 지금 쓸 수 없는 상태예요. 계정 화면에서 다시 연결해 주세요.` }, 400);
      }
      if ((await pausedAccountIds(tid)).includes(accountId)) {   // [R7 §3.6] 코인이 모자라 «쉬는» 계정
        return json({ ok: false, step: "cadence", error: "이 계정은 코인이 모자라 쉬고 있어요. 코인을 채우면 바로 올릴 수 있어요." }, 400);
      }
      const warm = { openedAt: (p.opened_at as string | null) ?? null, createdAt: (p.account_created_at as string | null) ?? null, off: p.warmup_off === true, postsThisWeek: n(p.posts_this_week) };
      /* 🔴 [R8 · CLAUDE §9] 워밍업은 **우리 추정**이지 규칙이 아니다 — 고객이 «이번만 올릴래»를 **직접 눌렀으면** 넘겨 준다.
         끄는 게 아니라 **그 회차만**이고 저장하지 않는다. `daily_cap`(고객이 정한 값)은 그대로 지킨다. */
      const cap = effectiveDailyCap(n(p.daily_cap) || 2, warm, new Date(), { override: warmupOverride });
      if (n(p.posts_today) >= cap) {
        const risk = warmupRisk(warm);
        /* 🔴 **막을 거면 넘길 길과 이유를 같이 준다**(§9-1 «무엇이·왜·어떻게»).
           `canOverride` 를 보고 화면이 «그래도 올릴래요» 단추를 띄운다 — 지금은 «내일 다시»만 있어 길이 없었다. */
        const byWarmup = cap === 0 && n(p.daily_cap) > 0 && !warmupOverride;
        return json({ ok: false, step: "cadence", capped: true, dailyCap: cap, postsToday: n(p.posts_today),
          ...(byWarmup ? { canOverride: true, overrideKey: "warmupOverride" } : {}),
          ...(risk ? { risk } : {}),
          error: cap === 0
            ? "이 계정은 이번 주 권장량을 다 썼어요(새 계정은 천천히 늘려요)."
            : `오늘 이 계정으로 ${cap}건까지 올릴 수 있어요. 내일 다시 올리거나 다른 계정을 써 주세요.` }, 400);
      }
      const gapMin = effectiveMinGapMin(n(p.min_gap_min) || 180, warm);
      const last = utcDate(p.last_post_at);
      if (last) {
        const nextOk = new Date(last.getTime() + gapMin * 60_000);
        if (nextOk.getTime() > Date.now()) {
          return json({ ok: false, step: "cadence", retryAt: nextOk.toISOString(), gapMin,
            error: `이 계정은 글 사이를 ${gapMin}분 띄워요. ${kstAt(nextOk)}부터 올릴 수 있어요.` }, 400);
        }
      }
      /* 🔴 같은 채널의 **다른 계정** 과도 간격을 띄운다(§7.3 · 같은 채널에 몰아 올리면 묶여 보인다).
         [R8] 간격은 **`lib/publish-gap.ts` 한 곳**에서 온다 — 여기가 **고객이 «지금 올리기»를 직접 누르는 자리**라
         그가 내릴 수 있는 **바닥**(floorMin)을 쓴다(자동 편성이 쓰는 안전 기본으로 거절하면 §9 에 어긋난다).
         ⚠️ 종전엔 상수 30 이었다 — 편성만 고치고 여기를 두면 «10:00 / 10:05» 가 **이 문에서 거절**된다. */
      const gapDec = await gapMinFor(tid, accountId);
      const gapCh = gapDec.floorMin;
      const [near] = await q(sql`SELECT MAX(x.published_at) AS at FROM posts x JOIN accounts b ON b.id = x.account_id
        WHERE x.tenant_id = ${tid} AND b.channel = ${String(p.channel)} AND x.account_id <> ${accountId}
          AND x.published_at > NOW() - make_interval(mins => ${gapCh})`);
      const nearAt = utcDate(near?.at);
      if (nearAt) {
        const nextOk = new Date(nearAt.getTime() + gapCh * 60_000);
        return json({ ok: false, step: "cadence", retryAt: nextOk.toISOString(), gapMin: gapCh, risk: gapDec.risk,
          error: `같은 채널에 방금 다른 계정으로 글이 나갔어요. ${kstAt(nextOk)}부터 올릴 수 있어요(계정끼리 ${gapCh}분 띄워요).` }, 400);
      }
    }

    /* ── 커넥터가 없으면 아무것도 건드리지 않는다(정직) ── */
    if (await publishPortStatus() === "missing") {
      await writeAudit({ tenantId: tid, action: "publish_now_unavailable", actorType: "user", actorId: uid, ip: clientIp(req), riskLevel: "medium", target: `piece:${pieceId}`, detail: { status } });
      return json({ ok: false, step: "connector", error: "발행 준비가 아직 끝나지 않았어요. 준비되면 예약한 시간에 자동으로 나가요." }, 503);
    }

    /* ── 여기서부터는 크론과 **같은 함수**가 상태를 쓴다 ── */
    await writeAudit({ tenantId: tid, action: "publish_now", actorType: "user", actorId: uid, ip: clientIp(req), target: `piece:${pieceId}`,
      detail: { status, channel: String(p.channel), kind: String(p.kind), accountId: accountId || null, slotId: p.slot_id ? n(p.slot_id) : null } });
    const out = await publishOne(tid, p, { actor: "user" });

    switch (out.kind) {
      case "published": {
        const [post] = await q(sql`SELECT external_url FROM posts WHERE tenant_id = ${tid} AND piece_id = ${pieceId} ORDER BY id DESC LIMIT 1`);
        return json({ ok: true, state: "published", pieceId, ...(post?.external_url ? { postUrl: String(post.external_url) } : {}), message: `«${title}» 을(를) 올렸어요.` });
      }
      case "queued":
        return json({ ok: true, state: "queued", pieceId, message: "올리는 중이에요. 다 되면 발행함에 주소가 보여요." });
      case "publishing":
        return json({ ok: true, state: "publishing", pieceId, runner: { online: !out.offline }, message: out.offline
          ? "내 PC 프로그램이 꺼져 있어요. 켜면 기다리던 글이 바로 나가요."
          : "내 PC 프로그램이 지금 올리고 있어요. 곧 발행함에 주소가 보여요." });
      case "already":
        return json({ ok: true, state: "already", pieceId, message: "이미 올라간 글이에요." });
      case "unavailable":
        return json({ ok: false, step: "connector", error: "발행 준비가 아직 끝나지 않았어요. 준비되면 예약한 시간에 자동으로 나가요." }, 503);
      case "retry":
        return json({ ok: false, step: "publish", reason: out.reason, retry: true,
          error: `${out.error ? "" : ""}잠깐 문제가 있었어요(${out.reason === "network" ? "인터넷 연결" : "채널 응답"}). 예약한 시간에 자동으로 다시 시도해요.` }, 400);
      case "manual":
        return json({ ok: false, step: out.reason === "gate" ? "gate" : "publish", reason: out.reason,
          error: out.reason === "gate" ? "발행 전 검사에 걸렸어요. 검수 화면에서 고치고 다시 승인해 주세요." : `${out.why}. 발행함에서 확인해 주세요.` }, 400);
      case "failed":
        return json({ ok: false, step: "publish", reason: out.reason, error: `${out.why}. 발행함에서 확인해 주세요.` }, 400);
    }
  } catch (err) { return jsonError("publish_now", err); }
};
