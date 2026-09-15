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
/**
 * 계정 간 기본 간격(분). 🔴 **이 상수에는 근거가 없다** — 공식 문서에 «N분 안에 올리면 제재»라는 문장이 없다
 *   (2026-09-15 조사 · `docs/active/2026-09-15-proxy-cost.md` §6.3b). 통설이라 **안전한 쪽**으로 둔다.
 *   🔴 실제로 쓸 값은 `lib/publish-gap.ts gapMinFor()` 가 정한다 — 계정마다 «우리가 무엇을 아는가»가 달라서다.
 *      여기 값은 그걸 못 받았을 때의 **기본**이다(호출부가 `gapMin` 을 넘기면 그게 이긴다).
 */
export const ACCOUNT_GAP_MIN = 30;

/* ═══ 안 막고 있던 신호 둘(사장님 지시 2026-09-15 · 메인 발주 ②) ═══
   §6.3b 표를 만들다 두 칸이 비어 있는 걸 찾았다 — **간격을 좁히는 것보다 이 둘이 더 싼 방어**다. */

/** 사람이 거의 없는 시간(KST). «후보 표에 없다»와 «규칙으로 막는다»는 다르다 — 이제 규칙이다. */
export const NIGHT_START_H = 0;
export const NIGHT_END_H = 6;
export function isNightHour(h: number): boolean {
  const x = Math.floor(Number(h));
  return x >= NIGHT_START_H && x < NIGHT_END_H;
}
/**
 * 🔴 **막지 않고 말한다** — 고객이 새벽을 고르면 그대로 두되 위험을 알린다(간격과 같은 방식).
 *   우리가 «안 된다»고 정하면 새벽에 올려야 하는 사정(해외 독자 등)을 가진 사람을 막는다.
 *   @returns 위험 한 줄(없으면 null)
 */
export function nightRisk(h: number): string | null {
  if (!isNightHour(h)) return null;
  return "새벽(0~6시)에 올리면 사람이 거의 없는 시간이라 «자동으로 올린다»는 신호가 됩니다. 되도록 낮 시간을 권해요.";
}

/**
 * 🔴 **계정마다 다른 흔들림**(±분). 매일 정각에 올리면 그 자체가 «기계»라는 신호다.
 *   ⚠️ **전 계정이 같은 폭으로 흔들리면 «같이 흔들리는 것»이 다시 신호가 된다**(메인 지시) — 그래서 씨앗에 계정을 넣는다.
 *   ⚠️ **결정론이어야 한다** — 편성(`rollSlots`)은 여러 번 돌고, 돌 때마다 시각이 움직이면
 *      같은 규칙에 슬롯이 두 번 잡히거나 «어제 본 시각»과 달라진다. 그래서 난수가 아니라 **씨앗 해시**다.
 *   @param seed 계정·날짜·시각을 섞은 문자열(같은 조합이면 늘 같은 값)
 */
export function jitterMinutes(seed: string, spreadMin = 7): number {
  const spread = Math.max(0, Math.floor(spreadMin));
  if (!spread) return 0;
  let h = 2166136261;
  const str = String(seed ?? "");
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  const span = spread * 2 + 1;                       // −spread … +spread
  return (Math.abs(h) % span) - spread;
}
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
  /** [R8] 규칙 고정 **분**(0~59 · 사장님 안 «10:05»). preferredHour 가 있을 때만 쓴다. */
  preferredMinute?: number | null;
  /** 같은 테넌트·같은 채널에서 이미 잡힌 시각들(UTC) — 30분 간격. */
  taken: Date[];
  /** 같은 계정의 이미 잡힌 시각들(UTC) — min_gap 준수. */
  takenSameAccount?: Date[];
  minGapMin?: number;
  /** 🔴 채널 내 간격(분) — `lib/publish-gap.ts gapMinFor()` 가 준 값. 없으면 `ACCOUNT_GAP_MIN`(기본 30). */
  gapMin?: number;
  /** [R8] 고객이 **시각을 못 박았을 때** 허용하는 최소 간격(분) — 전용 IP 가 확인된 계정끼리는 5분까지(B2 `floorMin`). 없으면 gapMin. */
  gapFloorMin?: number;
  /** 🔴 계정마다 다른 흔들림의 씨앗(보통 `acc:{accountId}`). **없으면 흔들지 않는다** — 옛 호출부의 동작을 안 바꾼다. */
  jitterSeed?: string;
  /** 흔들림 폭(±분 · 기본 7). 간격보다 크면 충돌만 만들므로 간격의 1/4 로 자른다. */
  jitterSpreadMin?: number;
  /** 🔴 새벽(0~6시) 후보를 건너뛴다 — 자동 편성의 기본. 고객이 **직접 고른 시각**에는 적용하지 않는다(막지 않고 말한다). */
  avoidNight?: boolean;
  /** 시작 날짜(KST 'YYYY-MM-DD') — 기본 오늘. */
  fromDate?: string;
  now?: Date;
  /** 오늘 이미 지난 시각도 허용하지 않는다(기본). */
  maxDaysAhead?: number;
}

/** 후보 시각 목록(KST h:m). */
export function candidatesFor(channel: string, goldenHours?: number[] | null, preferredHour?: number | null, preferredMinute?: number | null): { h: number; m: number }[] {
  if (typeof preferredHour === "number" && preferredHour >= 0 && preferredHour <= 23) {
    const m = typeof preferredMinute === "number" && preferredMinute >= 0 && preferredMinute <= 59 ? Math.floor(preferredMinute) : 0;
    return [{ h: preferredHour, m }];   // [R8] 못 박은 시각은 **분까지** 그대로(«10:05»)
  }
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
  const cands = candidatesFor(a.channel, a.goldenHours, a.preferredHour, a.preferredMinute);
  /* 🔴 [R8] 같은 채널 다른 계정과의 간격은 **정책이 정한다**(B2 `gapMinFor` → 호출부가 넘긴다 · 여기서 새로 정하지 않는다).
     고객이 시각을 못 박았으면 «바닥»(floor)까지 좁힐 수 있다 — 러너가 **실제로 재서** 출구 IP 가 다른 계정끼리는 5분.
     그래야 사장님 안(«A 10:00 · B 10:05»)이 **정책이 허락하는 만큼** 그대로 선다. */
  const pinned = typeof a.preferredHour === "number";
  const crossGap = Math.max(1, Math.floor(pinned ? (a.gapFloorMin ?? a.gapMin ?? ACCOUNT_GAP_MIN) : (a.gapMin ?? ACCOUNT_GAP_MIN)));
  const gapAcc = Math.max(crossGap, a.minGapMin ?? 0);
  /* 흔들림 폭은 간격의 1/4 을 넘지 않는다 — 간격보다 크게 흔들면 충돌만 만들고 제자리로 밀려난다.
     🔴 **고객이 못 박은 시각은 흔들지 않는다**(10:05 라고 적었는데 우리가 10:08 로 밀면 약속을 어긴 것이다). */
  const spread = a.jitterSeed && !pinned ? Math.max(0, Math.min(Math.floor(a.jitterSpreadMin ?? 7), Math.floor(crossGap / 4))) : 0;
  const maxDays = a.maxDaysAhead ?? 14;
  for (let d = 0; d <= maxDays; d++) {
    const date = addDays(start, d);
    for (const c of cands) {
      /* 🔴 새벽 건너뛰기 — 자동 편성만. 고객이 **직접 고른 시각**(`preferredHour`)은 막지 않는다(말로만 알린다 · `nightRisk`). */
      if (a.avoidNight && a.preferredHour == null && isNightHour(c.h)) continue;
      /* 🔴 계정마다 **다른** 폭으로, 그러나 **늘 같은** 값으로 흔든다(결정론 — 편성이 여러 번 돌아도 시각이 안 움직인다). */
      const jit = spread ? jitterMinutes(`${a.jitterSeed}|${date}|${c.h}:${c.m}`, spread) : 0;
      for (let shift = 0; shift <= 3; shift++) {
        const at = new Date(kstToUtc(date, c.h, c.m).getTime() + (shift * crossGap + jit) * 60_000);
        if (at.getTime() < now.getTime() + lead) continue;
        if (conflicts(at, a.taken, crossGap)) continue;
        if (a.takenSameAccount && conflicts(at, a.takenSameAccount, gapAcc)) continue;
        /* 표시 시각은 **실제 잡힌 시각**에서 읽는다 — 흔들림이 들어가면 c.h:c.m 과 달라진다
           (계산한 값을 그대로 쓰면 화면이 «10:00»이라는데 실제로는 10:04 에 나가는 어긋남이 생긴다). */
        const kst = new Date(at.getTime() + KST_MS);
        const hh = String(kst.getUTCHours()).padStart(2, "0"), mm = String(kst.getUTCMinutes()).padStart(2, "0");
        const why = a.preferredHour != null ? "규칙에 고정한 시각" : a.goldenHours?.length ? "이 계정의 골든타임" : "이 채널에서 반응이 좋은 시각";
        const dayWord = d === 0 ? "오늘" : d === 1 ? "내일" : `${date.slice(5).replace("-", "/")}`;
        return { at, reason: `${dayWord} ${hh}:${mm} — ${why}${shift ? ` · 다른 계정과 ${crossGap}분 간격` : ""}` };
      }
    }
  }
  const at = new Date(now.getTime() + 24 * 3600_000);
  return { at, reason: "내일 이 시간" };
}
