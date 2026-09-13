/**
 * lib/account-health.ts — 계정 상태 전이(정지 감지 → 승계) · 건강도(계약 §4 · DESIGN §7.2).
 *   AM 관례: runner-block 의 실패 분류를 계정 상태로 «접는» 층. AC 신규 구현(2026-09-14).
 *
 *   ══ 담당 경계(계약 §2 ↔ §4) ══
 *     B2 `lib/runner-block.ts` = **날것의 실패 → `RunnerErrorKind`**(셀렉터·HTTP·본문으로 분류).
 *     B  이 파일            = **`RunnerErrorKind` → 계정 상태·후속 동작**. 표는 여기 `ACCOUNT_ACTION_OF` 한 벌뿐이다.
 *     🔴 그러니 **B2 가 이 파일에서 import 한다**(방향 하나 · 순환 0). 전이표를 러너 쪽에 또 적지 않는다(PITFALLS #11-b).
 *
 *   ══ 전이표(계약 §4 · DESIGN §7.2) ══
 *     | errorKind | 계정 status | action | 부수 효과 |
 *     | suspended | suspended | suspend | 예약 슬롯을 같은 채널·그룹의 건강한 계정으로 승계(코인 0) + 알림 |
 *     | captcha · login_fail | pending_login | relogin | `session.login` 잡 적재 + 홈 «해야 할 일» |
 *     | rate_limited | cooldown | cooldown | 24시간 쉬고 `daily_cap` −1(다음 사고 예방) |
 *     | selector_changed · network · unknown | 그대로 | none | 건강도만 깎인다(계정 잘못이 아니다) |
 *
 *   ⚠️ **쿨다운 해제에 새 칸을 만들지 않았다**: `status='cooldown'` + `updated_at` 이 곧 «언제부터»다.
 *      `sweepAccountStates()`(크론 5분 스텝)가 24시간이 지난 cooldown 을 active 로 되돌린다. 스키마 추가 0.
 *
 *   graceful: 이 파일은 throw 하지 않는다 — 계정 장부 갱신 실패가 발행 파이프라인을 죽이면 안 된다.
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { writeAudit } from "./audit";
import { enqueueRunnerJob } from "./cron/publish-port";

const n = (v: unknown) => Number(v || 0);

/** 러너·커넥터 실패 분류(계약 §2). B2 `lib/runner-block.ts` 가 날것의 실패를 이 어휘로 접는다. */
export type RunnerErrorKind = "login_fail" | "captcha" | "rate_limited" | "suspended" | "selector_changed" | "network" | "unknown";
export type AccountAction = "cooldown" | "relogin" | "suspend" | "none";
export type AccountStatus = "active" | "cooldown" | "limited" | "suspended" | "disconnected" | "pending_login";

/** 🔴 전이표 정본 — 이 상수를 import 해서 쓴다(복사 금지). */
export const ACCOUNT_ACTION_OF: Readonly<Record<RunnerErrorKind, AccountAction>> = {
  suspended: "suspend",
  captcha: "relogin",
  login_fail: "relogin",
  rate_limited: "cooldown",
  selector_changed: "none",
  network: "none",
  unknown: "none",
};
/** action 이 계정을 어떤 status 로 미는가(none 이면 건드리지 않는다). */
export const STATUS_OF_ACTION: Readonly<Record<AccountAction, AccountStatus | null>> = {
  suspend: "suspended", relogin: "pending_login", cooldown: "cooldown", none: null,
};
/** 알림·감사에 쓰는 사람말(화면 문구는 A 가 `UI.ERRK` 한 벌로 만든다 — 여기 값은 서버 알림 본문용). */
export const RUNNER_ERROR_LABEL: Readonly<Record<RunnerErrorKind, string>> = {
  login_fail: "로그인이 풀렸어요", captcha: "자동입력 방지(캡차)가 떴어요", rate_limited: "너무 자주 올려서 잠시 막혔어요",
  suspended: "계정이 정지됐어요", selector_changed: "채널 화면이 바뀌었어요", network: "인터넷 연결 문제였어요", unknown: "알 수 없는 문제예요",
};
export function isRunnerErrorKind(v: unknown): v is RunnerErrorKind { return typeof v === "string" && v in ACCOUNT_ACTION_OF; }

export interface ClassifyResult {
  ok: boolean;
  status: AccountStatus | null;
  action: AccountAction;
  /** suspend 일 때 승계 결과. */
  reassigned?: { moved: number; targets: { slotId: number; toAccountId: number }[]; unmoved: number };
  /** relogin 일 때 세션 로그인 잡을 실제로 적재했나(러너 잡 적재기 미연결이면 false + reason). */
  jobQueued?: boolean;
  note?: string;
}

/**
 * classifyAndApply — 실패 1건을 계정 상태로 접는다(계약 §4 시그니처 그대로 · tenantId 는 계정 행에서 읽는다).
 *   멱등: 이미 그 status 면 다시 쓰지 않는다(알림·승계도 다시 돌지 않는다).
 */
export async function classifyAndApply(accountId: number, errorKind: RunnerErrorKind | string, opts: { tenantId?: number; detail?: string; pieceId?: number | null } = {}): Promise<ClassifyResult> {
  const aid = Math.floor(Number(accountId) || 0);
  const kind: RunnerErrorKind = isRunnerErrorKind(errorKind) ? errorKind : "unknown";
  const action = ACCOUNT_ACTION_OF[kind];
  if (aid <= 0) return { ok: false, status: null, action, note: "계정을 알 수 없어요." };

  try {
    const [a] = await q(sql`SELECT id, tenant_id, channel, handle, status, daily_cap, group_id FROM accounts WHERE id = ${aid}
      ${opts.tenantId ? sql`AND tenant_id = ${Math.floor(opts.tenantId)}` : sql``} LIMIT 1`);
    if (!a) return { ok: false, status: null, action, note: "계정을 찾을 수 없어요." };
    const tid = n(a.tenant_id), handle = String(a.handle), channel = String(a.channel), cur = String(a.status);
    const next = STATUS_OF_ACTION[action];

    // 건강도는 어떤 kind 든 다시 잰다(none 도 «경고»로 깎인다).
    const health = await recomputeHealth(tid, aid);

    if (!next || cur === next) {
      await q(sql`UPDATE accounts SET last_error_kind = ${kind}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${aid} AND COALESCE(last_error_kind,'') <> 'removed'`);
      await writeAudit({ tenantId: tid, action: "account_error", actorType: "system", target: `account:${aid}`, riskLevel: action === "none" ? "low" : "medium",
        detail: { errorKind: kind, action, status: cur, unchanged: true, health, pieceId: opts.pieceId ?? null, detail: String(opts.detail ?? "").slice(0, 300) || null } });
      return { ok: true, status: next ?? (cur as AccountStatus), action, note: next ? "이미 같은 상태예요." : undefined };
    }

    // status 전이 — 'removed'(소프트 삭제) 계정은 건드리지 않는다.
    await q(sql`UPDATE accounts SET status = ${next}, last_error_kind = ${kind},
      ${action === "cooldown" ? sql`daily_cap = GREATEST(1, daily_cap - 1),` : sql``} updated_at = NOW()
      WHERE tenant_id = ${tid} AND id = ${aid} AND COALESCE(last_error_kind,'') <> 'removed'`);

    const out: ClassifyResult = { ok: true, status: next, action };

    if (action === "suspend") {
      const r = await reassignSlots(aid, { tenantId: tid });
      out.reassigned = r;
      const names = [...new Set(r.targets.map((t) => t.toAccountId))];
      const toHandles = names.length ? await q(sql`SELECT handle FROM accounts WHERE tenant_id = ${tid} AND id IN (${sql.join(names.map((i) => sql`${i}`), sql`, `)})`) : [];
      const to = toHandles.map((h) => `@${h.handle}`).join(" · ");
      await notify(tid, "account_suspended", `@${handle} 계정이 정지됐어요`,
        r.moved > 0 ? `예정돼 있던 글 ${r.moved}건을 ${to} (으)로 옮겼어요. 코인은 더 들지 않아요.`
          : `옮길 수 있는 ${channel} 계정이 없어서 ${r.unmoved}건이 대기 중이에요. 계정을 하나 더 연결하거나 직접 올려 주세요.`,
        "/app/accounts.html");
    } else if (action === "relogin") {
      const job = await enqueueRunnerJob(tid, { kind: "session.login", accountId: aid, payload: { reason: kind }, priority: 20 });
      out.jobQueued = job.ok;
      if (!job.ok && job.unavailable) console.warn(`[account-health] session.login 잡 적재기 미연결 — account=${aid} 은 pending_login 으로만 표시된다(사용자가 «다시 로그인» 을 누르면 적재된다)`);
      await notify(tid, "account_relogin", `@${handle} 다시 로그인이 필요해요`,
        `${RUNNER_ERROR_LABEL[kind]}. «내 계정»에서 «다시 로그인»을 누르면 내 PC 프로그램이 창을 열어 줘요.`, "/app/accounts.html");
    } else if (action === "cooldown") {
      await notify(tid, "account_cooldown", `@${handle} 을(를) 하루 쉬게 했어요`,
        "너무 자주 올려서 채널이 잠시 막았어요. 24시간 뒤에 자동으로 다시 시작하고, 하루 발행 수를 하나 줄였어요.", "/app/accounts.html");
    }

    await writeAudit({ tenantId: tid, action: "account_transition", actorType: "system", target: `account:${aid}`,
      riskLevel: action === "suspend" ? "high" : "medium",
      detail: { errorKind: kind, action, from: cur, to: next, health, reassigned: out.reassigned ?? null, jobQueued: out.jobQueued ?? null, pieceId: opts.pieceId ?? null } });
    return out;
  } catch (e) {
    console.error("[account-health] classifyAndApply 실패", aid, String((e as Error)?.message ?? e).slice(0, 200));
    return { ok: false, status: null, action, note: "계정 상태를 바꾸지 못했어요." };
  }
}

export interface ReassignResult { moved: number; unmoved: number; targets: { slotId: number; toAccountId: number }[] }

/**
 * reassignSlots — 정지된 계정의 **앞으로 나갈 자리**를 같은 채널의 건강한 계정으로 넘긴다(코인 0 · 앵글 재변주는 produce 가 한다).
 *   대상 = 아직 안 나간 슬롯(published·publishing·skipped·failed·reassigned 제외) 중 발행 시각이 남은 것.
 *   받는 계정 = **같은 그룹 우선** → 같은 채널 → active · 오늘 캡 여유 · health 높은 순. 한 계정에 몰리지 않게 캡을 세며 돌린다.
 *
 *   🔴 `publishing` 중이던 자리는 «넘김»이 아니라 «중단 후 넘김»이다 — 그 자리는 `reassigned`(종결)로 닫고,
 *      이어질 몫은 **새 슬롯 행**으로 만든다(달력에 «@a 자리 → 넘김» 과 «@b 자리 → 예약» 이 둘 다 정직하게 남는다).
 *      나머지 상태는 자리를 그대로 두고 계정만 바꾼다(줄이 끊기지 않게).
 */
export async function reassignSlots(accountId: number, opts: { tenantId?: number } = {}): Promise<ReassignResult> {
  const aid = Math.floor(Number(accountId) || 0);
  const out: ReassignResult = { moved: 0, unmoved: 0, targets: [] };
  if (aid <= 0) return out;
  try {
    const [a] = await q(sql`SELECT id, tenant_id, channel, group_id FROM accounts WHERE id = ${aid}
      ${opts.tenantId ? sql`AND tenant_id = ${Math.floor(opts.tenantId)}` : sql``} LIMIT 1`);
    if (!a) return out;
    const tid = n(a.tenant_id), channel = String(a.channel), groupId = a.group_id ? n(a.group_id) : null;

    const slots = await q(sql`SELECT id, status, piece_id FROM slots
      WHERE tenant_id = ${tid} AND account_id = ${aid}
        AND status NOT IN ('published','skipped','failed','reassigned')
        AND (publish_at IS NULL OR publish_at > NOW() - interval '1 hour')
      ORDER BY publish_at NULLS LAST, id`);
    if (!slots.length) return out;

    // 받을 수 있는 계정 — 같은 그룹 우선(정렬 키), 오늘 남은 여유를 세며 나눠 준다.
    const cands = await q(sql`SELECT id, handle, daily_cap, posts_today, health_score, group_id FROM accounts
      WHERE tenant_id = ${tid} AND channel = ${channel} AND id <> ${aid} AND status = 'active'
        AND COALESCE(last_error_kind,'') <> 'removed' AND posts_today < daily_cap
      ORDER BY (group_id IS NOT DISTINCT FROM ${groupId}) DESC, health_score DESC, id`);
    const room = cands.map((c) => ({ id: n(c.id), left: Math.max(0, n(c.daily_cap) - n(c.posts_today)) })).filter((c) => c.left > 0);
    if (!room.length) { out.unmoved = slots.length; return out; }

    let k = 0;
    for (const s of slots) {
      const slotId = n(s.id), status = String(s.status), pieceId = s.piece_id ? n(s.piece_id) : null;
      // 여유가 남은 계정을 돌아가며(한 계정에 하루치가 몰리면 그 계정도 정지된다 · §7.3)
      let target = -1;
      for (let i = 0; i < room.length; i++) { const c = room[(k + i) % room.length]; if (c.left > 0) { target = (k + i) % room.length; break; } }
      if (target < 0) { out.unmoved++; continue; }
      const to = room[target]; to.left--; k = (target + 1) % room.length;

      if (status === "publishing") {
        // 날아가던 발행을 끊고, 이어질 몫을 새 자리로 만든다.
        const [old] = await q(sql`SELECT rule_id, slot_date, channel, kind, topic_id, brief_id, publish_at, review_deadline, origin FROM slots WHERE tenant_id = ${tid} AND id = ${slotId}`);
        await q(sql`UPDATE slots SET status = 'reassigned', piece_id = NULL, note = ${"계정 정지로 다른 계정에 넘겼어요"}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${slotId}`);
        const [ns] = await q(sql`INSERT INTO slots (tenant_id, rule_id, slot_date, channel, kind, account_id, topic_id, brief_id, piece_id, publish_at, review_deadline, status, origin, note)
          VALUES (${tid}, ${old?.rule_id ?? null}, ${old?.slot_date}, ${old?.channel ?? channel}, ${old?.kind ?? "post"}, ${to.id}, ${old?.topic_id ?? null}, ${old?.brief_id ?? null}, ${pieceId},
                  ${old?.publish_at ?? null}, ${old?.review_deadline ?? null}, ${"scheduled"}, ${old?.origin ?? "auto"}, ${"정지된 계정에서 넘겨받았어요"}) RETURNING id`);
        const newSlot = n(ns?.id);
        if (pieceId) await q(sql`UPDATE pieces SET account_id = ${to.id}, slot_id = ${newSlot}, status = 'scheduled', updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${pieceId}`);
        out.targets.push({ slotId: newSlot, toAccountId: to.id });
      } else {
        await q(sql`UPDATE slots SET account_id = ${to.id}, note = ${"정지된 계정에서 넘겨받았어요"}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${slotId}`);
        if (pieceId) await q(sql`UPDATE pieces SET account_id = ${to.id}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${pieceId}`);
        out.targets.push({ slotId, toAccountId: to.id });
      }
      out.moved++;
    }
    return out;
  } catch (e) {
    console.error("[account-health] reassignSlots 실패", aid, String((e as Error)?.message ?? e).slice(0, 200));
    return out;
  }
}

/**
 * recomputeHealth — 0~100(계약 §4 · DESIGN §7.2 «최근 30일 성공률 − 경고 − 발행 후 삭제»).
 *   성공 = 30일 posts 행 · 실패 = 30일 pieces(failed·awaiting_manual) · 경고 = 30일 러너 잡의 rate_limited·captcha·selector_changed
 *   삭제 = posts.stats->>'alive' = 'false'(러너 `verify.post_alive` 가 적는다)
 *     base  = (성공+실패)=0 → 100(아직 모른다 = 깎지 않는다) · 아니면 round(100 × 성공/(성공+실패))
 *     score = clamp(base − 5×경고 − 10×삭제, 0, 100)
 *   반환값을 `accounts.health_score` 에 쓴다(디렉터의 계정 배정 순서가 이 값을 읽는다).
 */
export async function recomputeHealth(tenantId: number, accountId: number): Promise<number> {
  const tid = Math.floor(Number(tenantId) || 0), aid = Math.floor(Number(accountId) || 0);
  if (tid <= 0 || aid <= 0) return 100;
  try {
    const [r] = await q(sql`SELECT
        (SELECT COUNT(*) FROM posts WHERE tenant_id = ${tid} AND account_id = ${aid} AND published_at > NOW() - interval '30 days') AS ok,
        (SELECT COUNT(*) FROM pieces WHERE tenant_id = ${tid} AND account_id = ${aid} AND status IN ('failed','awaiting_manual') AND updated_at > NOW() - interval '30 days') AS bad,
        (SELECT COUNT(*) FROM runner_jobs WHERE tenant_id = ${tid} AND account_id = ${aid} AND error_kind IN ('rate_limited','captcha','selector_changed') AND created_at > NOW() - interval '30 days') AS warn,
        (SELECT COUNT(*) FROM posts WHERE tenant_id = ${tid} AND account_id = ${aid} AND stats->>'alive' = 'false' AND published_at > NOW() - interval '30 days') AS dead`);
    const ok = n(r?.ok), bad = n(r?.bad), warn = n(r?.warn), dead = n(r?.dead);
    const base = ok + bad === 0 ? 100 : Math.round((100 * ok) / (ok + bad));
    const score = Math.max(0, Math.min(100, base - 5 * warn - 10 * dead));
    await q(sql`UPDATE accounts SET health_score = ${score}, updated_at = NOW() WHERE id = ${aid} AND tenant_id = ${tid}`);
    return score;
  } catch { return 100; }
}

/**
 * sweepAccountStates — 시간이 풀어 주는 것들(크론 5분 스텝이 부른다).
 *   ① `cooldown` 24시간 경과 → `active`(쿨다운 시작 시각 = 그 전이를 쓴 `updated_at`. 새 칸을 만들지 않은 이유는 파일 머리말에).
 *   ② `posts_today` 는 KST 자정에 리셋 — 마지막 발행이 오늘(KST)이 아니면 0 으로.
 *   반환 = 바뀐 계정 수.
 */
export async function sweepAccountStates(tenantId: number): Promise<{ woke: number; reset: number }> {
  const tid = Math.floor(Number(tenantId) || 0);
  const out = { woke: 0, reset: 0 };
  if (tid <= 0) return out;
  try {
    const woke = await q(sql`UPDATE accounts SET status = 'active', last_error_kind = NULL, updated_at = NOW()
      WHERE tenant_id = ${tid} AND status = 'cooldown' AND updated_at < NOW() - interval '24 hours'
        AND COALESCE(last_error_kind,'') <> 'removed' RETURNING id`);
    out.woke = woke.length;
    const reset = await q(sql`UPDATE accounts SET posts_today = 0, updated_at = NOW()
      WHERE tenant_id = ${tid} AND posts_today > 0
        AND (last_post_at IS NULL OR (last_post_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date < (NOW() AT TIME ZONE 'Asia/Seoul')::date) RETURNING id`);
    out.reset = reset.length;
    for (const a of woke) await writeAudit({ tenantId: tid, action: "account_transition", actorType: "system", target: `account:${n(a.id)}`, detail: { action: "cooldown_end", to: "active" } });
    return out;
  } catch (e) { console.error("[account-health] sweepAccountStates 실패", tid, String((e as Error)?.message ?? e).slice(0, 200)); return out; }
}

/** 알림 1건(중복 억제는 크론 쪽 notifyOnce 를 쓰지 않는다 — 계정 전이는 드물고, 같은 전이는 멱등 가드가 이미 막는다). */
async function notify(tid: number, kind: string, title: string, body: string, link: string): Promise<void> {
  try {
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${kind.slice(0, 32)}, ${title.slice(0, 160)}, ${body.slice(0, 2000)}, ${link.slice(0, 200)})`);
  } catch { /* 비치명 */ }
}
