/**
 * lib/revenue/trend.ts — [R11-5 · R11-6 · 설계 R11 §4.1·§4.2] **추세와 저하를 재는 순수 함수 한 곳.**
 *   AC 신규 2026-09-17(B). 🔎 출처: AC 신규 — AM 원본 없음.
 *
 *   ══ 왜 순수 함수로 빼는가 ══
 *     계약 §4-4: 🔴 **«있나»가 아니라 «도나»를 재라**(AC-99 ⑩). «그 줄이 있나»를 세는 검사는 `if (false)` 로 바꿔도 초록이다.
 *     그래서 판정을 전부 여기 순수 함수로 두고, 하니스가 **양성·음성·대조군을 같은 수로 실제로 돌린다**(`scripts/verify-r11-axis.mts`).
 *
 *   ══ 🔴 이 파일이 지키는 것 셋 ══
 *     ① **모르면 판정하지 않는다**(AC-9) — 표본이 모자라면 `unknown` + «아직 몰라요». 지어낸 화살표는 미신이다.
 *     ② **무엇을 셌는지 적는다**(AC-92) — 「3편」이라고 말하려면 **편을 세야** 한다. 소스에 따라 글 단위로 못 세는 것이 있어
 *        (애드센스는 계정 단위로 들어온다) 센 단위를 `basis` 로 **같이 내보낸다.** 못 센 것을 «편»이라고 부르지 않는다.
 *     ③ **겁주지 않는다**(CLAUDE §3) — 내림도 «떨어지고 있습니다»가 아니라 사실 한 줄이다. 문장은 전부 여기서 만든다(화면이 또 짓지 않는다 · AC-52).
 */

/** 추세 방향. 🔴 `unknown` 은 «멈춤»이 아니다 — **아직 못 쟀다**는 뜻이다(둘을 같은 값으로 접으면 그게 AC-9). */
export type TrendDir = "up" | "flat" | "down" | "unknown";
/** 무엇을 셌나 — `pieces` = 수익이 붙은 글 수 · `days` = 수익이 들어온 날 수(글 단위로 못 세는 소스). */
export type TrendBasis = "pieces" | "days";

/** 🔴 판정에 필요한 최소 표본(설계 «3편 미만이면 판정하지 않는다»). 날 단위로 셀 때도 같은 수를 쓴다. */
export const TREND_MIN_SAMPLES = 3;
/** 이 폭 안이면 «멈춤» — ±10%. 근거: 아래 저하 알림 문턱(15%)보다 좁아야 «멈춤인데 알림이 오는» 어긋남이 안 난다. */
export const TREND_FLAT_PCT = 10;
/** 🔴 홈 «해야 할 일»에 한 줄이 서는 문턱 — 7일 평균보다 **15% 낮으면**(설계 §4.2). */
export const DROP_ALERT_PCT = 15;

export interface Trend {
  dir: TrendDir;
  /** 직전 7일 대비 변화율(%) — `unknown` 이면 키가 없다(0% 로 위장하지 않는다). */
  pct?: number;
  recentKrw: number; prevKrw: number;
  samples: number; basis: TrendBasis;
  /** 🔴 서버 정본 한 줄(AC-52). 화면은 이 글자를 그대로 그린다. */
  say: string;
  /** «언제부터» 같은 방향인가(KST 'YYYY-MM-DD'). 🔴 못 짚으면 키가 없다 — 지어내지 않는다. */
  since?: string;
}

const pctOf = (recent: number, prev: number): number | null => {
  if (!(prev > 0)) return null;                 // 🔴 0 에서 늘어난 것은 «몇 %»로 말할 수 없다(÷0). 모르면 안 말한다.
  return Math.round(((recent - prev) / prev) * 1000) / 10;
};

/**
 * trendOf — 최근 7일 ↔ 직전 7일 한 판정(순수).
 *   🔴 **표본이 모자라면 금액이 반토막이어도 `unknown`** 이다. 한 편 터진 글 하나로 «내림»이라고 말하면 그건 잰 게 아니라 점친 것이다.
 *   🔴 **`prev` 가 0이면 %를 안 말한다** — 대신 «지난주엔 없었어요»로 사실만 적는다.
 */
export function trendOf(a: { recentKrw: number; prevKrw: number; samples: number; basis: TrendBasis; since?: string | null }): Trend {
  const recentKrw = Math.max(0, Math.trunc(Number(a.recentKrw) || 0));
  const prevKrw = Math.max(0, Math.trunc(Number(a.prevKrw) || 0));
  const samples = Math.max(0, Math.trunc(Number(a.samples) || 0));
  const basis: TrendBasis = a.basis === "pieces" ? "pieces" : "days";
  const unit = basis === "pieces" ? "편" : "일";
  if (samples < TREND_MIN_SAMPLES) {
    return { dir: "unknown", recentKrw, prevKrw, samples, basis,
      say: `아직 몰라요 — ${TREND_MIN_SAMPLES}${unit}은 모여야 견줄 수 있어요(지금 ${samples}${unit})` };
  }
  const pct = pctOf(recentKrw, prevKrw);
  if (pct === null) {
    /* 지난주가 0원이다 — 늘었다고 말할 수는 있어도 «몇 %»는 말할 수 없다. 🔴 %를 지어내지 않는다. */
    return { dir: recentKrw > 0 ? "up" : "flat", recentKrw, prevKrw, samples, basis,
      say: recentKrw > 0 ? "지난주엔 없던 수입이 들어왔어요" : "지난주도 이번 주도 아직 없어요",
      ...(a.since ? { since: a.since } : {}) };
  }
  const dir: TrendDir = Math.abs(pct) <= TREND_FLAT_PCT ? "flat" : pct > 0 ? "up" : "down";
  /* 🔴 겁주지 않는다(§3) — 내림도 «줄었어요»까지다. «떨어지고 있습니다»·«주의하세요» 는 쓰지 않는다. */
  const say = dir === "flat" ? "지난주와 비슷해요"
    : dir === "up" ? `지난주보다 ${Math.abs(pct)}% 늘었어요`
      : `지난주보다 ${Math.abs(pct)}% 줄었어요`;
  return { dir, pct, recentKrw, prevKrw, samples, basis, say, ...(a.since ? { since: a.since } : {}) };
}

/**
 * trendSince — 같은 방향이 **언제부터**인가(순수).
 *   `windows` 는 **최근 것이 먼저**인 7일 창들의 합계다(`[이번 주, 지난 주, 그 전 주, …]`)이고 각 창의 `from` 은 그 창의 첫날(KST).
 *   🔴 창이 둘뿐이면 «언제부터»를 말할 수 없다 — `null` 을 돌려준다(«이번 주부터»라고 지어내지 않는다).
 */
export function trendSince(dir: TrendDir, windows: readonly { from: string; krw: number }[]): string | null {
  if (dir !== "up" && dir !== "down") return null;
  if (windows.length < 3) return null;
  let since: string | null = null;
  for (let i = 0; i + 1 < windows.length; i++) {
    const cur = windows[i].krw, prev = windows[i + 1].krw;
    const p = pctOf(cur, prev);
    if (p === null) break;
    const d: TrendDir = Math.abs(p) <= TREND_FLAT_PCT ? "flat" : p > 0 ? "up" : "down";
    if (d !== dir) break;
    since = windows[i].from;
  }
  return since;
}

export interface DropAlert {
  /** 7일 평균 대비 몇 % 낮은가(양수 · 예: 22 = 22% 낮다). */
  pct: number;
  recentKrw: number; avgKrw: number;
  /** 🔴 «잘 먹혔던 소재군» — 있으면 문장에 실린다. 없으면 **문장에서 빠진다**(빈 이름표를 붙이지 않는다). */
  worked: string[];
  title: string; desc: string;
}

/**
 * dropAlertOf — 홈 «해야 할 일» 한 줄(순수). 🔴 **7일 평균보다 `DROP_ALERT_PCT`% 낮을 때만** 선다. 아니면 `null`.
 *
 *   🔴 **겁주지 않는다**(CLAUDE §3 · 설계 §4.2). 금지: «수익이 떨어지고 있습니다» · «이대로면 ~» · «확인하지 않으면 ~».
 *      한다: ①**사실 한 줄** ②**어떻게 하면 되는지** ③**우리가 대신 해 주는 것**.
 *      그래서 문장이 «이 소재군이 잘 먹혔어요: …» 로 **끝난다** — 고객이 다음에 할 일이 거기 있다.
 *   🔴 잘 먹힌 소재를 **못 찾았으면 그 줄을 빼고** «다음 편성에 반영해 둘게요»로 우리가 할 일만 말한다.
 *      빈 목록을 «없어요»로 말하면 그건 겁주기의 다른 얼굴이다.
 */
export function dropAlertOf(a: { recentKrw: number; avgKrw: number; worked?: readonly string[] }): DropAlert | null {
  const recentKrw = Math.max(0, Math.trunc(Number(a.recentKrw) || 0));
  const avgKrw = Math.max(0, Math.trunc(Number(a.avgKrw) || 0));
  if (!(avgKrw > 0)) return null;                                  // 🔴 견줄 평균이 없으면 판정하지 않는다(AC-9)
  const pct = Math.round(((avgKrw - recentKrw) / avgKrw) * 1000) / 10;
  if (!(pct >= DROP_ALERT_PCT)) return null;
  const worked = (a.worked ?? []).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 3);
  return {
    pct, recentKrw, avgKrw, worked,
    title: "지난주보다 조회가 줄었어요",
    desc: worked.length
      ? `이 소재군이 잘 먹혔어요: ${worked.join(" · ")} — 비슷한 소재를 다음 편성에 더 넣어 둘게요`
      : "다음 편성에 반응이 좋았던 쪽을 더 넣어 둘게요",
  };
}
