/**
 * lib/director-goal.ts — **목표 매체 → 채널 선택**(DESIGN §5.3-1 「소재의 `channel_hint` × 사용자가 켠 채널 × **목표 매체**.
 *   `goal=adsense` → 티스토리/블로거 우선 · `adpost` → 네이버 블로그」).
 *   🔎 출처: AC 신규(B-1 · R8CLOSE §B8 · 2026-09-16) — AM 원본 없음. 🔴 **순수**(DB·네트워크 0).
 *
 *   ══ 왜 따로 파일인가 ══
 *     부르는 자리는 `lib/director.ts` 하나뿐이지만, 그 파일은 지금 **다른 창이 같이 고치고 있다**(팀 승인 흐름).
 *     판단을 통째로 여기 두면 `director.ts` 에서 닿는 줄이 **세 줄**로 끝난다(머지 충돌 표면 최소 · 오늘 머지로만 네 번 데였다).
 *
 *   ══ 🔴 라이브를 먼저 보고 정했다(AC-72 — «표는 있는데 그 열쇠를 가진 값이 0건»을 또 밟지 않으려고) ══
 *     2026-09-16 읽기 전용 조회:
 *       · `briefs.goal` = **mixed 34 · adpost 27 · adsense 0건** ⇒ 설계의 «`goal=adsense`» 는 **라이브에 한 번도 없었다.**
 *       · `tenants.settings` 에 **`goal` 열쇠가 없다** ⇒ 🔴 **고객이 목표 매체를 고르는 자리가 아직 없다**(A 몫 · 메인에 보고).
 *       · `accounts.monetize` 실물 열쇠 = `adpostState`(4) · `adpostMediaId`(2) · `adsenseState`(2) · `adpostCheckedAt`(1)
 *         ⇒ **승인까지 간 매체는 애드포스트 1건뿐**이고 애드센스는 전부 `pending` 이다.
 *       · 채널이 둘 이상인 집 = **8곳**(naver+tistory **6** · naver+shorts 2 · 셋 1) — 나머지 27집은 채널이 하나라 순서가 뜻이 없다.
 *     ⇒ 그래서 **`briefs.goal` 을 재료로 쓰지 않는다.** 그건 채널에서 **역산한 값**이라(`director.goalOf`) 채널을 고르는 데
 *       쓰면 자기 자신을 근거로 삼는 꼴이고, 절반이 `mixed` 라 어차피 아무 규칙도 못 받는다(AC-72 가 난 바로 그 자리).
 *       대신 **«이 집에서 실제로 돈이 들어오는 매체가 어디 붙어 있나»** 를 본다 — 라이브에 실제로 적히는 값이다.
 *
 *   ══ 🔴 막지 않는다(CLAUDE §9) ══
 *     여기서 하는 일은 **순서 바꾸기**뿐이다. 켠 채널은 **하나도 빼지 않는다** — 목표에 안 맞아도 뒤로 갈 뿐 그대로 후보다.
 *     그리고 **왜 이 순서인지 한 줄**을 남긴다(`reason`). 고객이 «왜 티스토리?»를 물으면 답할 수 있어야 한다.
 */

/** 채널 ↔ 그 채널이 버는 매체. 🔴 `director.goalOf()` 와 **같은 갈래**다(두 곳이 갈리면 화면과 배치가 다른 말을 한다). */
export const CHANNEL_MEDIA: Readonly<Record<string, MediaGoal>> = {
  naver_blog: "adpost",
  tistory: "adsense", blogger: "adsense", wordpress: "adsense",
  youtube_shorts: "ypp",
  naver_clip: "clip_incentive",
};
export type MediaGoal = "adsense" | "adpost" | "ypp" | "clip_incentive";

/**
 * 🔴 **어휘가 두 벌이다** — 값을 베끼지 않고 한 곳에 모은다(AC-78).
 *   · 애드포스트·YPP: `lib/ad-eligibility.ts MediaState` = `"none" | "pending" | "approved"` (서버가 적는다)
 *   · 애드센스: **러너**가 적는다(`runner/channels/ads-setup-tistory.mjs`) = `"linked" | "pending" | "not_linked" | "unknown"`
 *     — «승인»에 해당하는 말이 `approved` 가 아니라 **`linked`** 다. 한쪽만 보면 애드센스는 영영 «안 붙었다»가 된다.
 */
const LIVE_WORDS = { on: ["approved", "linked"], waiting: ["pending"] } as const;

/** 이 계정의 매체가 살아 있나. `accounts.monetize` 원본을 그대로 받는다. */
export type MediaLive = "on" | "waiting" | "off";
export function mediaLiveOf(monetize: Record<string, unknown> | null | undefined, channel: string): MediaLive {
  const m = (monetize && typeof monetize === "object" ? monetize : {}) as Record<string, unknown>;
  const media = CHANNEL_MEDIA[channel];
  if (!media) return "off";
  /* 아이디가 박혀 있으면 상태 글자가 없어도 붙은 것이다 — 라이브에 `adpostMediaId` 만 있고 상태가 없는 행이 있다. */
  if (media === "adpost" && String(m.adpostMediaId ?? "").trim()) return "on";
  if (media === "adsense" && String(m.adsensePub ?? "").trim()) return "on";
  const key = media === "adpost" ? "adpostState" : media === "adsense" ? "adsenseState" : media === "ypp" ? "yppState" : null;
  const v = key ? String(m[key] ?? "").trim().toLowerCase() : "";
  if (!v) return "off";
  if ((LIVE_WORDS.on as readonly string[]).includes(v)) return "on";
  if ((LIVE_WORDS.waiting as readonly string[]).includes(v)) return "waiting";
  return "off";                                     // "none" · "not_linked" · 🔴 "unknown"(러너가 못 가른 것) — 모르면 «붙었다»고 하지 않는다(AC-9)
}

export interface ChannelOrder {
  /** 고를 채널 — **켠 채널만** · 순서만 바뀐다(하나도 안 뺀다). */
  channels: string[];
  /** 이 집에서 실제로 돈이 들어오는 매체. 없으면 null. */
  goal: MediaGoal | null;
  /** 값이 어디서 왔나 — 🔴 안 남기면 다음 사람이 또 헤맨다(`resolveGoalDetail.source` 와 같은 관례). */
  goalSource: "붙은 광고" | "심사 중인 광고" | "소재" | "없음";
  /** 🔴 **왜 이 순서인가** — 사람말 한 줄. `pieces.meta.channelReason` 으로 나간다. */
  reason: string;
}

/**
 * 채널 순서를 정한다.
 *   ① 켠 채널만 후보다(🔴 «없는 길»은 만들지 않는다 · §9)
 *   ② 소재가 가리키는 채널(`channelHint`)이 먼저다 — **단**, 다른 채널에 **실제로 붙은 광고**가 있고 힌트 채널엔 없으면
 *      돈이 들어오는 쪽이 앞선다. 🔴 «심사 중»으로는 순서를 뒤집지 않는다(아직 한 푼도 안 들어온다).
 *   ③ 그다음은 **붙음 → 심사 중 → 없음** 순, 같으면 원래 순서(결정론 — 같은 입력이면 같은 순서).
 */
export function targetChannelOrder(a: {
  connected: readonly string[];
  channelHint: string | null;
  /** 켠 계정들의 `{ channel, monetize }` — `accounts.monetize` 원본. */
  accounts: readonly { channel: string; monetize?: Record<string, unknown> | null }[];
}): ChannelOrder {
  const connected = [...new Set(a.connected.filter(Boolean))];
  /* 채널별로 **가장 좋은 상태**를 취한다 — 같은 채널 계정이 여럿이면 하나라도 붙었으면 붙은 것이다. */
  const rank: Record<MediaLive, number> = { on: 2, waiting: 1, off: 0 };
  const live = new Map<string, MediaLive>(connected.map((c) => [c, "off" as MediaLive]));
  for (const acc of a.accounts) {
    if (!live.has(acc.channel)) continue;
    const s = mediaLiveOf(acc.monetize, acc.channel);
    if (rank[s] > rank[live.get(acc.channel)!]) live.set(acc.channel, s);
  }
  const hint = a.channelHint && connected.includes(a.channelHint) ? a.channelHint : null;
  const on = connected.filter((c) => live.get(c) === "on");
  /* 힌트가 있고, 힌트 채널엔 광고가 안 붙었는데 **다른 채널엔 붙었으면** 돈 쪽을 앞세운다. */
  const flip = !!hint && live.get(hint) !== "on" && on.length > 0;
  /* 🔴 **결정론** — 같은 입력이면 같은 순서여야 한다(편성이 매번 흔들리면 고객이 «왜 어제랑 달라요?»를 묻는다).
     `sort` 는 Node 에서 **안정 정렬**이라 상태가 같으면 원래 순서가 그대로 남는다. */
  const byLive = (arr: readonly string[]) => [...arr].sort((x, y) => rank[live.get(y) ?? "off"] - rank[live.get(x) ?? "off"]);
  const head = flip ? byLive(on) : hint ? [hint] : [];
  const channels = [...head, ...byLive(connected.filter((c) => !head.includes(c)))];
  const top = channels[0] ?? null;
  const goal = top && live.get(top) !== "off" ? CHANNEL_MEDIA[top] ?? null : null;
  const goalSource: ChannelOrder["goalSource"] = !top ? "없음"
    : live.get(top) === "on" ? "붙은 광고" : live.get(top) === "waiting" ? "심사 중인 광고" : hint === top ? "소재" : "없음";
  const name = (ch: string | null) => CH_SAY[ch ?? ""] ?? ch ?? "";
  /* 🔴 조사 — «네이버 블로그**이** 소재에도 맞고» 처럼 틀리면 그 한 글자가 «사람이 쓴 글»을 깬다(CLAUDE §3 사람말). */
  const ga = (w: string) => `${w}${hasFinal(w) ? "이" : "가"}`;
  const reason = !top ? "고를 채널이 없어요."
    : flip ? `${name(top)}에 광고가 붙어 있어서 먼저 골랐어요 — 지금 수익이 나는 쪽이에요.`
      : live.get(top) === "on" ? `${ga(name(top))} 소재에도 맞고 광고도 붙어 있어요.`
        : hint === top ? `이 소재는 ${name(top)}에서 잘 읽혀요.${on.length === 0 ? " 아직 광고가 붙은 채널이 없어서 소재에 맞춰 골랐어요." : ""}`
          : `${name(top)}부터 올려 볼게요.`;
  return { channels, goal, goalSource, reason };
}

/** 고객에게 보여 줄 채널 이름 — 🔴 시스템 낱말(`naver_blog`)을 화면에 내보내지 않는다(CLAUDE §3). */
/** 끝 글자에 받침이 있나 — 한글 음절은 `(코드−0xAC00) % 28` 이 종성이다(0 = 받침 없음). */
function hasFinal(word: string): boolean {
  const ch = word.trim().slice(-1).charCodeAt(0);
  if (!(ch >= 0xac00 && ch <= 0xd7a3)) return false;   // 한글 음절이 아니면 모른다 — «가» 쪽으로 둔다
  return (ch - 0xac00) % 28 !== 0;
}

const CH_SAY: Readonly<Record<string, string>> = {
  naver_blog: "네이버 블로그", tistory: "티스토리", blogger: "블로거", wordpress: "워드프레스",
  youtube_shorts: "유튜브 쇼츠", naver_clip: "네이버 클립",
};
