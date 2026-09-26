/**
 * lib/publish/video-fit.ts — 🔴 **이 영상이 이 채널에 들어가나**(R18 «한 번 만들어 여러 곳에» · B2 · 2026-09-26).
 *   🔎 출처: AC 신규. AM 에는 «한 영상을 여러 채널에» 가 없다.
 *
 *   ══ 왜 ══
 *     R18 부터 영상 하나가 여러 채널로 간다. 60초 영상을 네이버 클립(최대 30초)에 보내면 —
 *       · 클립은 러너 **스텁**이라 잡을 집자마자 «앱에서 올려 주세요»로 돌려보낸다(`runner/channels/naver-clip.mjs`).
 *       · 고객은 그 말대로 폰에서 영상을 받아 올린다 → **네이버가 거절한다.**
 *       · 우리 화면엔 «클립은 앱에서 올려 주세요»만 남는다 — **길이가 까닭이라는 말이 어디에도 없다.**
 *     = 🔴 **조용한 실패**. 러너까지 가서야 드러나는(아니, 끝내 안 드러나는) 사고다.
 *     ⇒ 러너·커넥터에 넘기기 **전에** 잰다. 두 자리가 이 함수 하나를 부른다:
 *        ① 편성(`lib/derived-schedule.ts`) — 파생을 편성표에 얹을 때(가장 이른 자리 · «나중에 알면 늦다» 트리거 §1②)
 *        ② 발행 직전(`lib/publish/index.ts publish()`) — 마지막 줄(어느 길로 왔든 여기는 지난다)
 *
 *   ══ 게이트가 아니다(CLAUDE §9 «이 규칙 밖») ══
 *     채널이 **받지 않는** 길이다 — 우리 판단으로 막는 게 아니라 **없는 길**이다(트리거 §3 과 같은 결).
 *     그래서 말은 «실패»가 아니라 **①사실 한 줄 ②어떻게 하면 되는지**(트리거 §1② · CLAUDE §3).
 *
 *   ══ 🔴 숫자는 여기 없다 ══
 *     채널 상한은 `lib/writing-contracts.ts VIDEO_CHANNEL_MAX_SEC` **한 곳**이다(B 가 R18 에서 tiktok·facebook_reels 를 채운다).
 *     여유 1초는 심사 축(`lib/video/judge.ts duration_fit` «≤ maxSeconds+1s»)과 **같은 선**이다 —
 *     심사가 통과시킨 30.6초 클립을 여기서 «넘는다»고 하면 두 자가 서로 다른 말을 한다.
 *
 *   ══ 🔴 «모른다»로 막지 않는다(§9 · AC-9) ══
 *     · 표에 없는 채널(`youtube_long` 등) → 들어간다고 보고 `maxSec:null`(잴 잣대가 없다).
 *     · 길이를 모름(0·null·NaN) → 들어간다고 보고 `measured:false`(못 쟀다 — «맞다»가 아니다).
 */
import { VIDEO_CHANNEL_MAX_SEC } from "../writing-contracts";
import { VIDEO_SECONDS } from "../video/types";
import { channelLabelKo } from "../channel-url";

/** 심사 축 `duration_fit` 과 같은 여유(«≤ maxSeconds + 1s»). */
export const FIT_TOLERANCE_MS = 1000;

export type VideoFit =
  | { fits: true; measured: boolean; maxSec: number | null }
  | { fits: false; measured: true; maxSec: number; sec: number; say: string };

/** 채널 상한(초) — 표에 없으면 null. 🔴 값은 `VIDEO_CHANNEL_MAX_SEC` 에서만 읽는다. */
export function channelMaxSec(channel: string): number | null {
  const v = Number((VIDEO_CHANNEL_MAX_SEC as Readonly<Record<string, number>>)[String(channel ?? "")]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** 이 채널에 들어가는 **우리가 만들 수 있는 가장 긴 길이**(15·30·60·90 중) — «만들 때 N초를 골라 주세요»의 N. */
export function longestFitting(maxSec: number): number | null {
  const fit = [...VIDEO_SECONDS].filter((s) => s <= maxSec);
  return fit.length ? Math.max(...fit) : null;
}

/**
 * 영상 길이(ms)가 채널 상한 안인가.
 *   @param durationMs 렌더 실측(`piece_assets(kind='video').meta.durationMs`) — 모르면 0/null
 */
export function videoFitsChannel(channel: string, durationMs: unknown): VideoFit {
  const maxSec = channelMaxSec(channel);
  const ms = Number(durationMs);
  const measured = Number.isFinite(ms) && ms > 0;
  if (maxSec === null) return { fits: true, measured, maxSec: null };
  if (!measured) return { fits: true, measured: false, maxSec };
  if (ms <= maxSec * 1000 + FIT_TOLERANCE_MS) return { fits: true, measured: true, maxSec };
  const sec = Math.round(ms / 1000);
  const label = channelLabelKo(channel);
  const pick = longestFitting(maxSec);
  /* 🔴 §3 말투 — ①사실 ②어떻게 하면 되는지. «실패»·«오류»·«불가» 0(트리거 §1② · `scripts/verify-r18-clip-length.mts` 가 잰다). */
  const say = `이 영상은 ${sec}초라 ${label}(최대 ${maxSec}초)엔 안 올라가요.`
    + (pick ? ` ${label}에도 올리시려면 만들 때 ${pick}초를 골라 주세요.` : "");
  return { fits: false, measured: true, maxSec, sec, say };
}
