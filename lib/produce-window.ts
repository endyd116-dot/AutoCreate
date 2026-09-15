/**
 * lib/produce-window.ts — «이 자리는 언제 글이 만들어지나»를 재는 **잣대 한 개**(계약 P1R8-B · 메인 지시 2026-09-15).
 *
 *   ══ 왜 파일을 따로 뒀나 ══
 *     크론 `slots.produce` 가 **집어 가는 조건**과, 편성표가 고객에게 **보여 주는 말**이 서로 다른 곳에서 계산되면
 *     언젠가 하나가 썩는다(AC-47 «두 곳에서 다시 재지 않는다» · AC-70). 그래서 잣대를 여기 한 번만 적고,
 *     `lib/cron/produce.ts`(SELECT 의 상태 목록)와 `lib/slots.ts`(화면의 `produceWindow`)가 **둘 다 이 파일을 읽는다.**
 *
 *   ══ 세 값의 뜻 ══
 *     · `pending` — **자동이 만들 차례가 아직 남아 있다.** 고객은 아무것도 안 해도 된다.
 *     · `missed`  — **자동으로는 더 이상 안 만들어진다.** 🔴 «못 만든다»가 아니라 **«지금 만들기가 유일한 길»** 이다.
 *                   그래서 사유 문장은 반드시 **고객이 지금 할 수 있는 일**로 끝난다.
 *     · `done`    — 이미 글이 있다(검수·예약·발행 중 어디든).
 *     자리 자체를 버린 것(건너뜀·반려)은 **값을 안 싣는다**(만들 자리가 아니다 · 키 없음 = «해당 없음»).
 */

/** 🔴 크론 `slots.produce` 가 **실제로 집어 가는** 상태. produce.ts 의 SELECT 가 이 목록을 그대로 쓴다. */
export const PRODUCIBLE_STATUSES = ["topic_assigned", "coin_short"] as const;
/** 아직 소재가 없어서 produce 가 못 집는 자리 — `assign_topics` 가 먼저 돈다(그래도 «차례는 온다» = pending). */
export const PRE_PRODUCE_STATUSES = ["planned", "no_topic"] as const;
/** 글이 이미 있는(또는 만드는 중인) 자리 — 더 만들 것이 없다. */
export const PRODUCED_STATUSES = ["producing", "in_review", "approved", "scheduled", "publishing", "published"] as const;
/** 자리를 버린 것 — `produceWindow` 를 안 싣는다. */
export const DROPPED_STATUSES = ["skipped", "rejected"] as const;

export type ProduceWindow = "pending" | "missed" | "done";

export interface ProduceWindowInput {
  status: string;
  /** 이 자리에 글이 붙어 있나(`slots.piece_id`). */
  hasPiece: boolean;
  /** 자리 날짜(KST · `YYYY-MM-DD`). */
  slotDate: string;
  /** 오늘(KST · `YYYY-MM-DD`). */
  todayKst: string;
  /** 발행 예정 시각(ms · `publish_at` 없으면 그 날짜의 KST 23:59 을 호출부가 넣는다). */
  publishAtMs: number;
  /** **다음 제작 틱**(ms · `lib/slots.ts nextProduceTickUtc` — 크론과 같은 눈금). */
  nextTickMs: number;
  /** 그 틱을 사람말로(«오늘 오전 6시» · «내일 오전 6시»). */
  nextTickText: string;
  /** 발행 며칠 전부터 만들기 시작하나(`settings.produceLeadDays`). */
  leadDays: number;
  /** 자동 편성이 켜져 있나(produce 스텝은 `needsAutoSchedule: true` — 꺼져 있으면 **아예 안 돈다**). */
  autoSchedule: boolean;
  /** 쓰기가 막힌 이유(`requireWritable`) — 막혀 있으면 produce 도 멈춘다. 없으면 null. */
  blockedReason: "readonly" | "suspended" | "closed" | "unknown" | null;
  /** 자리에 서버가 남긴 한 줄(`slots.note`) — 있으면 사유로 그대로 쓴다(이미 사람말이다). */
  note?: string | null;
}

/** 막힌 집에 뜨는 말 — 🔴 «못 만든다»로 끝내지 않고 **풀 수 있는 길**로 끝낸다. */
const BLOCKED_TEXT: Record<string, string> = {
  readonly: "체험이 끝나서 새 글은 자동으로 안 만들어져요. 요금제를 고르시면 기다리던 자리부터 이어서 만들어요.",
  suspended: "결제가 밀려서 자동 만들기가 멈춰 있어요. 결제를 마치면 기다리던 자리부터 이어서 만들어요.",
  closed: "탈퇴를 신청하셔서 새 글은 안 만들어요. «탈퇴 취소»를 누르시면 그대로 이어서 만들어요.",
  unknown: "지금은 새 글을 만들 수 없는 상태예요. 잠시 뒤 다시 확인해 주세요.",
};

/** 날짜 문자열 더하기(KST 달력 · `YYYY-MM-DD`). */
function addDaysStr(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * produceWindowOf — 그 자리의 «만들기» 상태 한 개 + 사람말 한 줄.
 *   반환 `null` = 이 자리엔 해당 없음(건너뜀·반려). 🔴 키를 안 싣는 것이지 «pending 이 아니다»가 아니다(AC-9).
 */
export function produceWindowOf(i: ProduceWindowInput): { window: ProduceWindow; reason: string } | null {
  const st = String(i.status || "");
  if ((DROPPED_STATUSES as readonly string[]).includes(st)) return null;

  /* ① 이미 있다 — 여기서 끝. 🔴 `piece_id` 를 먼저 본다(상태가 뒤늦게 따라오는 경로가 있다 · lib/content-gen.ts). */
  if (i.hasPiece || (PRODUCED_STATUSES as readonly string[]).includes(st)) {
    return { window: "done", reason: st === "published" ? "올라갔어요." : "글이 준비됐어요." };
  }

  /* ② 집이 막혀 있으면 자동은 안 돈다(produce 첫 줄의 `requireWritable` 과 같은 판정). */
  if (i.blockedReason) return { window: "missed", reason: BLOCKED_TEXT[i.blockedReason] ?? BLOCKED_TEXT.unknown };

  /* ③ 자동 편성이 꺼져 있으면 produce 스텝 자체가 안 돈다(`needsAutoSchedule`). 미래 자리여도 **저절로는 안 만들어진다** — 숨기지 않는다. */
  if (!i.autoSchedule) return { window: "missed", reason: "자동 만들기를 꺼 두셨어요. 이 자리는 «지금 만들기»를 누르시면 바로 만들어요." };

  /* ④ 사람이 손대야 하는 자리 — 자동이 이미 손을 뗐다. 서버가 남긴 한 줄이 있으면 그게 가장 정확하다. */
  if (st === "awaiting_manual" || st === "failed") {
    const why = i.note ? `${i.note} ` : "";
    return { window: "missed", reason: `${why}이 자리는 «지금 만들기»로 직접 만들어 주세요.` };
  }

  /* ⑤ 아직 창이 안 열렸다 — 차례가 **온다**(고객이 할 일 없음). */
  const windowOpensOn = addDaysStr(i.slotDate, -i.leadDays);
  if (windowOpensOn > i.todayKst) {
    return { window: "pending", reason: `발행 ${i.leadDays}일 전인 ${windowOpensOn.slice(5).replace("-", "/")}부터 만들기 시작해요.` };
  }

  /* ⑥ 날짜가 지난 자리 — 자동은 오늘~오늘+lead 만 본다(produce 의 SELECT). 다시는 안 집어 간다. */
  if (i.slotDate < i.todayKst) {
    return { window: "missed", reason: `${i.slotDate.slice(5).replace("-", "/")} 자리인데 그날이 지났어요. 지금 만들면 바로 올라가요.` };
  }

  /* ⑦ 🔴 **다음 만들기 시각이 발행 시각보다 늦다** — 기다리면 늦는다. 이것이 «missed» 의 본래 뜻이다. */
  if (i.publishAtMs <= i.nextTickMs) {
    return { window: "missed", reason: `다음 자동 만들기 시각(${i.nextTickText})이 이 자리보다 늦어요. 지금 만들면 제시간에 올라가요.` };
  }

  /* ⑧ 차례가 남아 있다 — 상태별로 한 줄만 다르게. */
  if (st === "coin_short") return { window: "pending", reason: `코인이 모자라 미뤘어요. 충전하시면 ${i.nextTickText}에 이어서 만들어요.` };
  if (st === "no_topic") return { window: "pending", reason: `쓸 만한 소재를 아직 못 찾았어요. 소재가 정해지면 ${i.nextTickText}에 만들어요.` };
  if (st === "planned") return { window: "pending", reason: `소재를 먼저 정하고 ${i.nextTickText}에 만들어요.` };
  return { window: "pending", reason: `${i.nextTickText}에 자동으로 만들어요.` };
}
