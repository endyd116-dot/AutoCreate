/**
 * lib/tenant-pause.ts — 🔴 **잠깐 멈춤의 한 곳**(DESIGN §5B.11 · 사장님 승인 2026-09-22 · AC-220).
 *   🔎 출처: AC 신규(AM 원본 없음).
 *
 *   ══ 왜 이 파일인가 ══
 *     사장님: «고객 입장에서 잠시 멈추고 싶을 수 있는데 그 기능이 없어?»
 *     지금 있던 멈춤은 **전부 «나쁜 일이 생겨서»** 멈추는 것이었다 — `readonly`(계약) · `suspended`(우리) · 슬롯 `paused`(코인 부족).
 *     🔴 **손님이 스스로 · 기간을 정해 · 되돌릴 수 있게** 멈추는 자리가 **0개**였고, 그래서
 *        «잠깐 멈추고 싶은데 방법이 없어서 **해지**»가 가장 나쁜 결말이었다.
 *
 *   ══ 🔴 «멈춤»이 «잠김»이 되면 안 된다(이 파일의 첫 규율) ══
 *     `tenants.status` 를 **건드리지 않는다.** `NON_WRITABLE`(`readonly`·`suspended`·`cancelled`)에 끼우면
 *     `requireWritable`(lib/guards.ts · 한 곳)이 «계약상 못 쓴다»로 읽어 **보기·고치기·손으로 올리기까지** 막힌다.
 *     쉼은 계약이 아니라 **고객의 선택**이다. ⇒ 별도 칸(`tenants.paused_at` 외 3개 · drizzle/0087).
 *
 *   ══ 무엇이 멈추고 무엇이 안 멈추나(설계 (1) 표) ══
 *     멈춘다   — 자동 편성(`slots.roll`·`topics.assign`) · 자동 제작(`produce`) · 자동 발행(`publisher`)
 *     안 멈춘다 — 보기·고치기 · 🔴 **손으로 «지금 올리기»** · 수익·정산·결제·알림 · 러너 하트비트 · 검수창 마감(`review_deadline`)
 *     🔴 검수창을 **안 멈추는** 까닭: 멈추면 손님이 이미 만들어 둔 글이 **검수창에 갇힌 채 창이 닫힌다.**
 *        자동 승인돼도 `publisher` 가 멈춰 안 나가고, 깰 때 **«밀린 글»로 손님 눈에 보인다**(설계 (1-b) · B 판단).
 *
 *   ══ 🔴 «멈춤»에는 «깨워 주기»가 같이 있어야 한다 ══
 *     사장님: «근데 크론 멈췄다는 걸 내가 까먹으면 어떡해?» — 그 물음이 설계의 핵심이 됐다.
 *     `pause_until` 이 있으면 그때 저절로 깨고, NULL(«내가 켤 때까지»)이면 **7일마다** 알린다(`pause_notified_at` 이 멱등 키).
 *
 *   ══ 🔴 밀린 글은 우리가 정하지 않는다(§9 · 설계 (1-b)) ══
 *     ❌ 몰아 올린다(계정이 다친다) · ❌ 조용히 `skipped`(손님 글이 말없이 사라진다) · ❌ 버린다(손님이 버린 적이 없다)
 *     ✅ **`pending_resume` 으로 모아 두고 깰 때 고객이 고른다.** «차례로»는 **캐던스를 지켜** 다시 예약한다(§7.4).
 *
 *   🔴 시각은 **저장 UTC · 표시 KST**(CLAUDE §4.5b). `days`·`daysLeft` 는 **KST 날짜**로 센다 —
 *      UTC 로 세면 새벽 0~9시에 «N일째»가 하루 어긋난다. 손님이 보는 숫자다.
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { utcDate } from "./db-util";

const KST_MS = 9 * 3600 * 1000;
/** KST 기준 «며칠째»의 날짜 번호(자정 경계). 🔴 순수 산술 — DB·프로세스 시간대와 무관하다. */
const kstDayNo = (d: Date): number => Math.floor((d.getTime() + KST_MS) / 86400_000);

/* ───────── 까닭 — 🔴 사람말은 **서버가** 준다(화면이 베껴 쓰지 않는다 · AC-52) ───────── */
/**
 * 고를 수 있는 까닭. 🔴 **겁주지 않는다**(§3) — «수익이 줄어요» 같은 말은 여기 없다.
 * 설계 (2) 의 괄호(휴가·글 손보는 중·채널 제재·비용 아끼기·그 밖) 그대로다.
 */
export const PAUSE_REASONS: readonly { key: string; label: string }[] = [
  { key: "vacation",        label: "쉬어 가려고요" },
  { key: "editing",         label: "글을 손보는 중이에요" },
  { key: "channel_penalty", label: "채널에서 제재를 받았어요" },
  { key: "cost",            label: "비용을 아끼려고요" },
  { key: "other",           label: "그 밖의 까닭이에요" },
];
const REASON_KEYS = new Set(PAUSE_REASONS.map((r) => r.key));
export const isPauseReason = (v: unknown): boolean => typeof v === "string" && REASON_KEYS.has(v);

/* ───────── 언제까지 — 🔴 실제 시각은 **서버가** 만든다(화면이 날짜를 만들지 않는다) ───────── */
export type PauseUntilKind = "2w" | "1m" | "manual";
export const isUntilKind = (v: unknown): v is PauseUntilKind => v === "2w" || v === "1m" || v === "manual";
/** `2w` → +14일 · `1m` → +1달 · `manual` → **null(«내가 켤 때까지»)**. */
export function untilFrom(kind: PauseUntilKind, now: Date = new Date()): Date | null {
  if (kind === "manual") return null;
  const d = new Date(now.getTime());
  if (kind === "2w") { d.setUTCDate(d.getUTCDate() + 14); return d; }
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/* ───────── 화면이 받는 모양(설계 (1-c) 계약) ───────── */
export interface PauseView {
  paused: boolean;
  pausedAt: string | null;
  pauseUntil: string | null;
  reason: string | null;
  /** 🔴 «N일째» — **첫날이 1일째**다(0일째가 아니다). KST 날짜로 센다. 안 쉬면 null. */
  days: number | null;
  /** 🔴 저절로 깰 때까지 남은 날. `manual`(= `pause_until` 없음)이면 **null**. 안 쉬면 null. */
  daysLeft: number | null;
  reasons: readonly { key: string; label: string }[];
  /**
   * 🔴 [AC-221] **쉬는 동안 밀린 글 수** — 설계 §5B.11(1-d)②.
   *   🔴 **`paused` 와 무관하게 늘 싣는다.** 여기가 이 기능의 마지막 구멍이었다:
   *      `pause_until` 이 지나 크론이 **저절로 깨운 집**은 `POST /api/tenant-resume` 을 **아예 안 부른다** —
   *      그 응답에만 실어 두면 그 손님은 «밀린 글 N건»을 **영영 못 보고 영영 못 고른다.**
   *   🔴 «안 온다»와 «0이다»는 화면에서 다른 말이라, **없을 때도 `{ count: 0 }`** 으로 준다(칸이 사라지지 않는다 · AC-9).
   *   모양은 `POST /api/tenant-resume` 응답의 `backlog` 와 **같다** — 화면이 한 벌로 그린다.
   */
  backlog: { count: number };
}

export interface PauseRow { paused_at?: unknown; pause_until?: unknown; pause_reason?: unknown; pause_notified_at?: unknown }

/**
 * 행 → 화면 모양. 🔴 **순수 함수**(DB·환경 0) — 그래서 자가 경계 시각을 직접 먹여 KST 셈을 잴 수 있다.
 *   `days` 는 «첫날 = 1일째»: 같은 KST 날짜면 1, 하루 지나면 2 …
 */
export function pauseViewOf(row: PauseRow | null | undefined, now: Date = new Date(), backlog = 0): PauseView {
  const pausedAt = utcDate(row?.paused_at);
  const until = utcDate(row?.pause_until);
  /* 🔴 [AC-221] **`backlog` 는 이 이른 반환에도 실린다.** 안 쉬는 집이야말로 «저절로 깬 손님»이고,
     그 손님이 밀린 글을 고를 마지막(그리고 유일한) 통로가 이 칸이다. 여기서 빠뜨리면 기능이 통째로 안 닿는다. */
  if (!pausedAt) {
    return { paused: false, pausedAt: null, pauseUntil: null, reason: null, days: null, daysLeft: null, reasons: PAUSE_REASONS, backlog: { count: backlog } };
  }
  const days = kstDayNo(now) - kstDayNo(pausedAt) + 1;            // 🔴 +1 = «첫날이 1일째»
  const daysLeft = until ? Math.max(0, kstDayNo(until) - kstDayNo(now)) : null;
  return {
    paused: true,
    pausedAt: pausedAt.toISOString(),
    pauseUntil: until ? until.toISOString() : null,
    reason: isPauseReason(row?.pause_reason) ? String(row?.pause_reason) : null,
    days: Math.max(1, days),
    daysLeft,
    reasons: PAUSE_REASONS,
    backlog: { count: backlog },
  };
}

/** 쉬는 중인가 — 🔴 **`paused_at` 하나가 정본**이다(`status` 를 안 본다). */
export const isPausedRow = (row: PauseRow | null | undefined): boolean => !!utcDate(row?.paused_at);

/**
 * 이 집의 쉼 상태를 읽는다(두 문이 같은 이것을 쓴다 — 두 벌로 만들지 않는다).
 *   🔴 [AC-221] **밀린 글 수를 «쉬든 안 쉬든» 같이 센다.** 쉬는 집에서만 세면 **저절로 깬 손님**이 못 고른다(§5B.11(1-d)②).
 *   셈은 `pieces_tenant_status_idx`(tenant_id, status) 를 그대로 타는 COUNT 한 번이다 — 자주 불리는 문 둘에 들어가도 싸다.
 */
export async function loadPause(tid: number): Promise<PauseView> {
  const [rows, backlog] = await Promise.all([
    q(sql`SELECT paused_at, pause_until, pause_reason, pause_notified_at FROM tenants WHERE id = ${tid}`),
    countBacklog(tid),
  ]);
  return pauseViewOf(rows[0] as PauseRow | undefined, new Date(), backlog);
}

/* ───────── 밀린 글 ─────────
   «쉬는 동안 발행 시각이 지나 버린 글» — 예약돼 있었거나, 검수창이 닫혀 자동 승인된 것.
   🔴 `publisher` 가 보는 것이 `pieces.status='scheduled' AND scheduled_for <= NOW()` 라, **거기서 빼야** 안 나간다.
   🔴 슬롯에도 같은 값을 거울처럼 적는다 — 안 적으면 편성표와 글 목록이 **다른 말**을 한다. */
export const BACKLOG_STATUS = "pending_resume";

/** 지금 밀려 있는 글 수(깰 때 «N건 있어요»의 그 숫자). */
export async function countBacklog(tid: number): Promise<number> {
  const [r] = await q(sql`SELECT COUNT(*)::int AS c FROM pieces WHERE tenant_id = ${tid} AND status = ${BACKLOG_STATUS}`);
  return Number(r?.c ?? 0);
}

/**
 * 깰 때 — 발행 시각이 지나 버린 예약글을 **`pending_resume` 으로 모은다**(버리지 않는다 · 몰아 올리지 않는다).
 *   🔴 `skipped`·`rejected` 를 쓰지 않는다 — 앞엣것은 «우리가 조용히 넘겼다», 뒤엣것은 «손님이 버렸다»는 뜻이라 **둘 다 거짓말**이다.
 *   반환 = 이번에 모은 수.
 */
export async function holdBacklog(tid: number, now: Date = new Date()): Promise<number> {
  const rows = await q(sql`UPDATE pieces SET status = ${BACKLOG_STATUS}, updated_at = NOW()
     WHERE tenant_id = ${tid} AND status = 'scheduled' AND scheduled_for IS NOT NULL AND scheduled_for <= ${now.toISOString()}::timestamptz
   RETURNING id, slot_id`);
  const slotIds = rows.map((r) => Number(r.slot_id)).filter((v) => Number.isFinite(v) && v > 0);
  if (slotIds.length) {
    /* 거울 — 편성표가 글 목록과 같은 말을 하게. 보조 쓰기라 실패해도 본류를 막지 않는다(CLAUDE §4.1). */
    await q(sql`UPDATE slots SET status = ${BACKLOG_STATUS}, updated_at = NOW()
       WHERE tenant_id = ${tid} AND id IN (${sql.join(slotIds.map((i) => sql`${i}`), sql`, `)})`).catch(() => []);
  }
  return rows.length;
}

/**
 * «지금부터 차례로 올릴게요» — 밀린 글을 **캐던스를 지켜** 앞으로의 시각에 다시 예약한다(설계 (1-b) · §7.4).
 *   🔴 **한 번에 쏟지 않는다.** 2주 쉬고 켰다가 열 개가 한꺼번에 나가면 계정이 다친다.
 *   🔴 시각을 여기서 새로 정하지 않는다 — `best-time.pickPublishAt` 이 정본이다(채널 30분 간격 · 계정 `min_gap`).
 *      그 함수가 **이미 잡힌 시각들**(`taken`)을 보고 피하므로, **한 건 잡을 때마다 그 시각을 목록에 넣어** 다음 건이 피하게 한다.
 *   반환 = 다시 예약한 수.
 */
export async function releaseBacklog(tid: number, now: Date = new Date()): Promise<number> {
  const held = await q(sql`SELECT id, channel, account_id, slot_id FROM pieces
     WHERE tenant_id = ${tid} AND status = ${BACKLOG_STATUS} ORDER BY scheduled_for, id`);
  if (!held.length) return 0;
  const { pickPublishAt } = await import("./best-time");
  const { gapMinFor } = await import("./publish-gap");
  /* 앞으로 이미 잡혀 있는 것들 — 밀린 글이 **그 사이를 비집고 들어가지 않게** 먼저 읽는다. */
  const future = await q(sql`SELECT channel, account_id, scheduled_for FROM pieces
     WHERE tenant_id = ${tid} AND status = 'scheduled' AND scheduled_for IS NOT NULL AND scheduled_for > ${now.toISOString()}::timestamptz`);
  const takenByChannel = new Map<string, Date[]>();
  const takenByAccount = new Map<number, Date[]>();
  const push = (m: Map<string | number, Date[]>, k: string | number, d: Date) => { const a = m.get(k) ?? []; a.push(d); m.set(k, a); };
  for (const r of future) {
    const at = utcDate(r.scheduled_for);
    if (!at) continue;
    push(takenByChannel as Map<string | number, Date[]>, String(r.channel ?? ""), at);
    if (r.account_id) push(takenByAccount as Map<string | number, Date[]>, Number(r.account_id), at);
  }
  let moved = 0;
  for (const p of held) {
    const channel = String(p.channel ?? "");
    const aid = p.account_id ? Number(p.account_id) : 0;
    /* 🔴 간격은 **`publish-gap.gapMinFor` 가 정본**이다(계정의 전용 IP 여부로 갈린다) — 여기서 새로 정하지 않는다.
       못 읽으면 넘기지 않는다 = `pickPublishAt` 의 기본(30분)으로 떨어진다(**안전한 쪽**). */
    const gap = aid ? await gapMinFor(tid, aid).catch(() => null) : null;
    const picked = pickPublishAt({
      channel,
      taken: takenByChannel.get(channel) ?? [],
      takenSameAccount: aid ? (takenByAccount.get(aid) ?? []) : [],
      ...(gap ? { gapMin: gap.gapMin, gapFloorMin: gap.floorMin } : {}),
      now,
    });
    await q(sql`UPDATE pieces SET status = 'scheduled', scheduled_for = ${picked.at.toISOString()}::timestamptz, updated_at = NOW()
       WHERE id = ${Number(p.id)} AND tenant_id = ${tid}`);
    if (p.slot_id) {
      await q(sql`UPDATE slots SET status = 'scheduled', publish_at = ${picked.at.toISOString()}::timestamptz, updated_at = NOW()
         WHERE id = ${Number(p.slot_id)} AND tenant_id = ${tid}`).catch(() => []);
    }
    push(takenByChannel as Map<string | number, Date[]>, channel, picked.at);
    if (aid) push(takenByAccount as Map<string | number, Date[]>, aid, picked.at);
    moved++;
  }
  return moved;
}

/* ───────── 멈추기 · 깨우기 ───────── */

/**
 * 쉬기 시작. 🔴 이미 쉬는 중이면 **기간·까닭만 고쳐 준다**(«쉬는 중에 2주를 한 달로») — 새로 시작하지 않는다
 *   (그러면 `paused_at` 이 밀려 «N일째»가 1로 되돌아간다 — 손님이 보는 숫자가 거짓이 된다).
 */
export async function pauseTenant(tid: number, kind: PauseUntilKind, reason: string | null, now: Date = new Date()): Promise<PauseView> {
  const until = untilFrom(kind, now);
  const r = isPauseReason(reason) ? String(reason) : null;
  await q(sql`UPDATE tenants SET
      paused_at = COALESCE(paused_at, ${now.toISOString()}::timestamptz),
      pause_until = ${until ? sql`${until.toISOString()}::timestamptz` : sql`NULL`},
      pause_reason = ${r},
      pause_notified_at = NULL,
      updated_at = NOW()
    WHERE id = ${tid}`);
  return loadPause(tid);
}

/**
 * 깨우기. 칸 넷을 비우고 **밀린 글을 모은다**(`holdBacklog`).
 *   🔴 여기서 **올리지 않는다** — 올릴지 두고 볼지는 손님이 고른다(설계 (1-b) · §9).
 *   반환에 `backlog` 를 실어 화면이 «밀린 글이 N건 있어요»를 그대로 그리게 한다(화면이 세지 않는다).
 */
export async function resumeTenant(tid: number, now: Date = new Date()): Promise<{ pause: PauseView; backlog: number }> {
  await holdBacklog(tid, now);
  await q(sql`UPDATE tenants SET paused_at = NULL, pause_until = NULL, pause_reason = NULL, pause_notified_at = NULL, updated_at = NOW()
    WHERE id = ${tid}`);
  /* 🔴 **이번에 모은 것만이 아니라 «지금 밀려 있는 전부»**를 센다 — 저절로 깬 집은 크론이 이미 모아 뒀고,
     손님은 그 뒤에 화면에 들어온다. «이번에 모은 수»만 주면 그 집에 **0건**이라고 거짓말을 하게 된다. */
  return { pause: await loadPause(tid), backlog: await countBacklog(tid) };
}
