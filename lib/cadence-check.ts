/**
 * lib/cadence-check.ts — **그 계정이 그 시각에 글을 하나 더 낼 수 있나**(DESIGN §5D.5 · §7.3b · B-1 2026-09-15).
 *
 *   ══ 왜 새로 만드나 ══
 *     캐던스 판정이 여태 **«지금 올린다»**(`publish-now`)와 **«자동이 시각을 고른다»**(`best-time.pickPublishAt`) 두 곳에만 있었다.
 *     직접 쓰기(①)는 **고객이 미래 시각을 못 박는** 길이라 둘 다 아니다 — «지금»이 아니고, 우리가 «고르는» 것도 아니다.
 *     🔴 그렇다고 ①만 캐던스를 안 걸면 **계정이 죽는 이유는 자동이든 수동이든 같다**(§7.3b)는 규율이 깨진다.
 *
 *   ══ 규칙은 `publish-now` 와 **같다** ══
 *     ①계정 상태 ②코인이 모자라 쉬는 계정 ③하루 몫(워밍업 반영) ④같은 계정 글 사이 간격 ⑤같은 채널 **다른 계정**과 30분.
 *     🔴 응답 모양도 `publish-now` 와 **글자 그대로 같게** 돌려준다(`step:"cadence"` + `retryAt`·`gapMin`·`dailyCap`·`postsToday`·`capped`) —
 *     화면이 두 곳에서 다른 말을 하지 않게(A 요청 2026-09-15).
 *
 *   ══ «지금»이 아니라 «그 시각»을 본다 ══
 *     세는 대상은 **이미 나간 글(posts)** 과 **이미 잡아 둔 글(pieces.scheduled_for)** 둘 다다.
 *     앞엣것만 세면 «아직 안 나갔지만 이미 예약된 글»이 안 보여서 하루에 다섯 편이 예약된다.
 *   🔎 출처: AC 신규(DESIGN §5D.5 · B-1 · 2026-09-15) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { utcDate } from "./db-util";
import { effectiveDailyCap, effectiveMinGapMin } from "./warmup";
import { ACCOUNT_GAP_MIN, kstDateStr } from "./best-time";
import { pausedAccountIds } from "./account-slots";

const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** 화면에 그대로 나가는 KST 시각 한 마디(«9/16 08:00»). */
function kstAt(d: Date): string {
  const s = new Date(d.getTime() + 9 * 3600_000).toISOString();
  return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))} ${s.slice(11, 16)}`;
}

export type CadenceVerdict =
  | { ok: true; dailyCap: number; gapMin: number; plannedToday: number }
  /** 🔴 `canOverride` = «그래도 올릴래요» 단추를 **띄워도 되나**(워밍업이 깎고 있고, 넘기면 자리가 생긴다).
   *   `publish-now` 가 이미 같은 이름으로 화면에 주고 있다 — **두 곳이 같은 낱말**이어야 화면이 두 말을 안 한다(AC-52). */
  | { ok: false; step: "cadence"; error: string; retryAt?: string; gapMin?: number; dailyCap?: number; postsToday?: number; capped?: boolean; canOverride?: boolean };

/**
 * `at` 시각에 `accountId` 로 한 편을 더 낼 수 있나.
 *   `excludePieceId` — 이미 있는 글의 시각을 옮길 때 **자기 자신**은 세지 않는다(안 그러면 늘 자기 때문에 걸린다).
 */
export async function checkCadenceAt(a: {
  tenantId: number; accountId: number; channel: string; at: Date; excludePieceId?: number | null;
  /**
   * 🔴 [2026-09-20 B2] **워밍업이 깎은 몫만** «이번 회차만» 넘긴다 — 고객이 «그래도 올릴래요»를 **직접 눌렀을 때**.
   *
   *   ══ 왜 생겼나 ══
   *     `publish-now`(발행)에는 이 문이 **처음부터 있었는데**(`{ override: warmupOverride }`) **쓰기(`pieces-self`)에는 없었다.**
   *     같은 소프트 규칙인데 **문이 한쪽에만** 있었던 것이다. 그래서 워밍업 주간 몫을 쓴 고객은
     *     🔴 **글을 아예 못 썼다 — 나중에 올릴 예약조차 못 만들었다.**
   *     (실측 2026-09-20: 어제 연결한 계정이 1주차 몫 1건을 쓰자 `cap=0` 이 되어 **모든 날짜**가 막혔다.)
   *   🔴 **넘기는 것은 «우리 추정»(워밍업)뿐이다** — `daily_cap`(고객이 정한 값)은 그대로 지킨다.
   *      `publish-now` 가 이미 그 선을 그어 뒀고(:95) 여기도 **같은 선**이다(두 곳이 다른 선을 그으면 그게 또 갈림이다).
   */
  warmupOverride?: boolean;
}): Promise<CadenceVerdict> {
  const tid = a.tenantId, accountId = a.accountId, at = a.at;
  const skip = a.excludePieceId ? n(a.excludePieceId) : 0;

  const [acc] = await q(sql`SELECT a.id, a.handle, a.status, a.channel, a.daily_cap, a.min_gap_min, a.opened_at, a.warmup_off, a.created_at,
      (SELECT COUNT(*)::int FROM posts p WHERE p.account_id = a.id AND p.published_at > NOW() - interval '7 days') AS posts_this_week
    FROM accounts a WHERE a.tenant_id = ${tid} AND a.id = ${accountId}`);
  if (!acc) return { ok: false, step: "cadence", error: "그 계정을 찾지 못했어요." };
  if (String(acc.channel) !== a.channel) return { ok: false, step: "cadence", error: "고른 계정과 채널이 서로 달라요." };
  const status = String(acc.status ?? "");
  if (status === "suspended" || status === "disconnected") {
    return { ok: false, step: "cadence", error: `@${String(acc.handle ?? "")} 계정이 지금 쓸 수 없는 상태예요. 계정 화면에서 다시 연결해 주세요.` };
  }
  if ((await pausedAccountIds(tid)).includes(accountId)) {
    return { ok: false, step: "cadence", error: "이 계정은 코인이 모자라 쉬고 있어요. 코인을 채우면 바로 올릴 수 있어요." };
  }

  const warm = { openedAt: (acc.opened_at as string | null) ?? null, createdAt: (acc.created_at as string | null) ?? null, off: acc.warmup_off === true, postsThisWeek: n(acc.posts_this_week) };
  /* 🔴 `publish-now:94-95` 와 **같은 두 줄**이다 — 고객이 정한 값은 하드, 워밍업이 깎은 값은 소프트.
     넘기더라도 `customerCap` 은 못 넘는다(그건 고객의 뜻이다). */
  const customerCap = n(acc.daily_cap) || 2;
  const warmCap = effectiveDailyCap(customerCap, warm, at, { override: a.warmupOverride === true });
  const cap = a.warmupOverride === true ? customerCap : warmCap;
  /** 넘길 문이 **실제로 도움이 되나** — 워밍업이 깎고 있고, 넘기면 자리가 생기는 경우에만 «그래도 올릴래요»를 권한다. */
  const canOverride = !a.warmupOverride && warmCap < customerCap;
  /* 🔴 캡과 **같은 문**이다 — 넘기면 고객이 정한 간격으로 돌아간다(고객 값 아래로는 안 내려간다). */
  const gapMin = effectiveMinGapMin(n(acc.min_gap_min) || 180, warm, at, { override: a.warmupOverride === true });
  const day = kstDateStr(at);

  /* ③ 하루 몫 — **나간 글 + 잡아 둔 글**을 같은 날(KST)로 함께 센다.
     🔴 시간대 변환이 **두 걸음**이다(§4.5b): 칸은 «시간대 없는 UTC» 라 `AT TIME ZONE 'UTC'` 로 먼저 시간대를 붙이고,
        그 다음 `AT TIME ZONE 'Asia/Seoul'` 로 KST 로 옮긴다. 한 걸음만 쓰면 **«이 값은 원래 서울 시각»으로 읽어** 9시간이 어긋나고,
        그러면 하루 몫이 조용히 안 걸린다(2026-09-15 스모크 실측 — 두 편을 예약해 두고도 셋째가 통과했다). */
  const [cnt] = await q(sql`
    SELECT (
      (SELECT COUNT(*)::int FROM posts p WHERE p.tenant_id = ${tid} AND p.account_id = ${accountId}
         AND p.published_at IS NOT NULL AND to_char((p.published_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = ${day})
      +
      (SELECT COUNT(*)::int FROM pieces x WHERE x.tenant_id = ${tid} AND x.account_id = ${accountId}
         AND x.id <> ${skip} AND x.status NOT IN ('failed','rejected','published')
         AND x.scheduled_for IS NOT NULL AND to_char((x.scheduled_for AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = ${day})
    ) AS c`);
  const planned = n(cnt?.c);
  if (planned >= cap) {
    /* 🔴 [2026-09-20 B2] **할 수 없는 일을 하라고 안내하지 않는다.**
       종전 문구는 `cap === 0` 일 때 «**다른 날로 잡아 주세요**» 였다. 그런데 `cap 0` 은 **모든 날짜를 막는다** —
       고객이 그 말대로 백 번 날짜를 바꿔도 **영영 안 된다.** 막는 것보다 **틀린 길을 가리키는 것**이 나쁘다.
       ⇒ §3 대로 ①사실 ②어떻게 하면 되는지(= 넘길 문) ③우리가 대신 해 주는 것. 겁주지 않고 발뺌하지 않는다. */
    return { ok: false, step: "cadence", capped: true, dailyCap: cap, postsToday: planned, ...(canOverride ? { canOverride: true } : {}),
      error: cap === 0
        ? (canOverride
          ? "새로 연결한 계정이라 이번 주는 1건까지만 자동으로 올리고 있어요. 지금 꼭 올리셔야 하면 «그래도 올릴래요»를 눌러 주세요 — 이번 한 번만 올려 드려요."
          : "이 계정은 이번 주 몫을 다 썼어요(새로 연결한 계정은 천천히 늘려요). 다음 주가 되면 다시 올릴 수 있어요.")
        : canOverride
          ? `그날 이 계정으로 ${cap}건까지 올리고 있어요(이미 ${planned}건). 다른 날·다른 계정을 고르시거나, «그래도 올릴래요»로 이번 한 번만 더 올리실 수 있어요.`
          : `그날 이 계정으로 ${cap}건까지 올릴 수 있어요(이미 ${planned}건). 다른 날이나 다른 계정을 골라 주세요.` };
  }

  /* ④ 같은 계정 — 앞뒤로 `gapMin` 안에 다른 글이 있으면 안 된다(뒤에 있는 글도 본다: 앞에 끼워 넣으면 그 글이 밀린다).
     🔴 «가장 가까운 한 건»을 가져온다 — 처음엔 `MIN(거리)` 와 `MIN(시각)` 을 따로 뽑았다가 **서로 다른 행의 값**이 섞였다(스모크에서 잡혔다). */
  const iso = at.toISOString();
  const [near] = await q(sql`
    SELECT t.at FROM (
      SELECT p.published_at AT TIME ZONE 'UTC' AS at FROM posts p WHERE p.tenant_id = ${tid} AND p.account_id = ${accountId} AND p.published_at IS NOT NULL
      UNION ALL
      SELECT x.scheduled_for AT TIME ZONE 'UTC' AS at FROM pieces x WHERE x.tenant_id = ${tid} AND x.account_id = ${accountId}
        AND x.id <> ${skip} AND x.status NOT IN ('failed','rejected') AND x.scheduled_for IS NOT NULL
    ) t
    WHERE ABS(EXTRACT(EPOCH FROM (t.at - ${iso}::timestamptz))) < ${gapMin * 60}
    ORDER BY ABS(EXTRACT(EPOCH FROM (t.at - ${iso}::timestamptz))) LIMIT 1`);
  const other = utcDate(near?.at);
  if (other) {
    const nextOk = new Date(other.getTime() + gapMin * 60_000);
    return { ok: false, step: "cadence", retryAt: nextOk.toISOString(), gapMin,
      error: `이 계정은 글 사이를 ${gapMin}분 띄워요. ${kstAt(nextOk)}부터 올릴 수 있어요.` };
  }

  /* ⑤ 같은 채널 **다른 계정** 과 30분(§7.3 — 같은 채널에 몰아 올리면 묶여 보인다). */
  const [nearCh] = await q(sql`
    SELECT t.at FROM (
      SELECT p.published_at AT TIME ZONE 'UTC' AS at FROM posts p JOIN accounts b ON b.id = p.account_id
       WHERE p.tenant_id = ${tid} AND b.channel = ${a.channel} AND p.account_id <> ${accountId} AND p.published_at IS NOT NULL
      UNION ALL
      SELECT x.scheduled_for AT TIME ZONE 'UTC' AS at FROM pieces x JOIN accounts b ON b.id = x.account_id
       WHERE x.tenant_id = ${tid} AND b.channel = ${a.channel} AND x.account_id <> ${accountId}
         AND x.id <> ${skip} AND x.status NOT IN ('failed','rejected') AND x.scheduled_for IS NOT NULL
    ) t
    WHERE ABS(EXTRACT(EPOCH FROM (t.at - ${iso}::timestamptz))) < ${ACCOUNT_GAP_MIN * 60}
    ORDER BY ABS(EXTRACT(EPOCH FROM (t.at - ${iso}::timestamptz))) LIMIT 1`);
  const chAt = utcDate(nearCh?.at);
  if (chAt) {
    const nextOk = new Date(chAt.getTime() + ACCOUNT_GAP_MIN * 60_000);
    return { ok: false, step: "cadence", retryAt: nextOk.toISOString(), gapMin: ACCOUNT_GAP_MIN,
      error: `같은 채널의 다른 계정 글과 너무 가까워요. ${kstAt(nextOk)}부터 올릴 수 있어요(계정끼리 ${ACCOUNT_GAP_MIN}분 띄워요).` };
  }

  return { ok: true, dailyCap: cap, gapMin, plannedToday: planned };
}
