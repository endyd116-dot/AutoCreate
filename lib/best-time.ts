/**
 * lib/best-time.ts — 채널별 최적 발행 시각(DESIGN §5B.5 기본표) + 계정 간 30분 간격(§7.3) + 캐던스(min_gap). AC 신규(2026-09-14 · 순수).
 *   auto = 후보 중 계정의 최근 30일 성과가 가장 좋은 시각 — 데이터 없으면 첫 후보(성과 학습은 R2 slots.learn).
 *   계정 golden_hours(사용자 고정)가 있으면 그것이 후보를 대체. preferredHour(규칙 고정 · bestTimeMode fixed)면 그 시각만.
 *   시각은 KST 로 계산하고 UTC Date 로 돌려준다(저장은 UTC · PITFALLS #4).
 */
export const BEST_HOURS: Record<string, { h: number; m: number }[]> = {
  naver_blog: [{ h: 7, m: 30 }, { h: 12, m: 0 }, { h: 21, m: 0 }],
  tistory: [{ h: 8, m: 0 }, { h: 13, m: 0 }],
  blogger: [{ h: 9, m: 0 }],
  wordpress: [{ h: 9, m: 0 }],
  youtube_shorts: [{ h: 18, m: 0 }, { h: 21, m: 0 }],
  naver_clip: [{ h: 19, m: 0 }, { h: 22, m: 0 }],
  reels: [{ h: 12, m: 0 }, { h: 19, m: 0 }],
  tiktok: [{ h: 19, m: 0 }, { h: 22, m: 0 }],
  threads: [{ h: 8, m: 0 }, { h: 22, m: 0 }],
  instagram: [{ h: 12, m: 0 }, { h: 19, m: 0 }],
};
export const ACCOUNT_GAP_MIN = 30;
const KST_MS = 9 * 3600 * 1000;

export function kstDateStr(d: Date): string { return new Date(d.getTime() + KST_MS).toISOString().slice(0, 10); }
/** 'YYYY-MM-DD'(KST) + h:m(KST) → UTC Date. */
export function kstToUtc(dateStr: string, h: number, m = 0): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m, 0, 0) - KST_MS);
}
export function addDays(dateStr: string, n: number): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

export interface PickArgs {
  channel: string;
  /** 계정의 골든타임(시 · KST) — 있으면 후보 대체. */
  goldenHours?: number[] | null;
  /** 규칙 고정 시각 — 있으면 이 시각만(bestTimeMode fixed). */
  preferredHour?: number | null;
  /** 같은 테넌트·같은 채널에서 이미 잡힌 시각들(UTC) — 30분 간격. */
  taken: Date[];
  /** 같은 계정의 이미 잡힌 시각들(UTC) — min_gap 준수. */
  takenSameAccount?: Date[];
  minGapMin?: number;
  /** 시작 날짜(KST 'YYYY-MM-DD') — 기본 오늘. */
  fromDate?: string;
  now?: Date;
  /** 오늘 이미 지난 시각도 허용하지 않는다(기본). */
  maxDaysAhead?: number;
}

/** 후보 시각 목록(KST h:m). */
export function candidatesFor(channel: string, goldenHours?: number[] | null, preferredHour?: number | null): { h: number; m: number }[] {
  if (typeof preferredHour === "number" && preferredHour >= 0 && preferredHour <= 23) return [{ h: preferredHour, m: 0 }];
  if (Array.isArray(goldenHours) && goldenHours.length) return goldenHours.filter((h) => h >= 0 && h <= 23).map((h) => ({ h, m: 0 }));
  return BEST_HOURS[channel] ?? [{ h: 9, m: 0 }];
}

function conflicts(at: Date, taken: Date[], gapMin: number): boolean {
  return taken.some((t) => Math.abs(t.getTime() - at.getTime()) < gapMin * 60_000);
}

/**
 * pickPublishAt — 오늘(또는 fromDate)부터 후보 시각을 순서대로 보며 ①지나지 않았고 ②채널 내 30분 간격 ③계정 min_gap 을 만족하는 첫 시각.
 *   충돌하면 같은 후보에 30분씩 밀어 본다(최대 3회) → 다음 후보 → 다음 날.
 */
export function pickPublishAt(a: PickArgs): { at: Date; reason: string } {
  const now = a.now ?? new Date();
  const lead = 20 * 60_000;   // 지금부터 최소 20분 뒤
  const start = a.fromDate ?? kstDateStr(now);
  const cands = candidatesFor(a.channel, a.goldenHours, a.preferredHour);
  const gapAcc = Math.max(ACCOUNT_GAP_MIN, a.minGapMin ?? 0);
  const maxDays = a.maxDaysAhead ?? 14;
  for (let d = 0; d <= maxDays; d++) {
    const date = addDays(start, d);
    for (const c of cands) {
      for (let shift = 0; shift <= 3; shift++) {
        const at = new Date(kstToUtc(date, c.h, c.m).getTime() + shift * ACCOUNT_GAP_MIN * 60_000);
        if (at.getTime() < now.getTime() + lead) continue;
        if (conflicts(at, a.taken, ACCOUNT_GAP_MIN)) continue;
        if (a.takenSameAccount && conflicts(at, a.takenSameAccount, gapAcc)) continue;
        const hh = String(c.h).padStart(2, "0"), mm = String(c.m + shift * ACCOUNT_GAP_MIN).padStart(2, "0");
        const why = a.preferredHour != null ? "규칙에 고정한 시각" : a.goldenHours?.length ? "이 계정의 골든타임" : "이 채널에서 반응이 좋은 시각";
        const dayWord = d === 0 ? "오늘" : d === 1 ? "내일" : `${date.slice(5).replace("-", "/")}`;
        return { at, reason: `${dayWord} ${hh}:${mm} — ${why}${shift ? " · 다른 계정과 30분 간격" : ""}` };
      }
    }
  }
  const at = new Date(now.getTime() + 24 * 3600_000);
  return { at, reason: "내일 이 시간" };
}
