/**
 * lib/channel-registry.ts — **채널의 «성질» 정본 한 곳**(DESIGN §2 · 계약 P1R8 §5.2). AC 신규(2026-09-15 · B3).
 *   🔎 출처: AC 신규(계약 P1R8 §5.2 · 생성 2026-09-15) — AM 원본 없음.
 *
 *   ══ 왜 만들었나 ══
 *     설계는 «레지스트리 한 곳이 결정한다»고 말하는데, 실제 정본은 **네 곳**이었다(전수조사 §0 원칙3 · 2026-09-15 실측):
 *       ① `lib/accounts.ts` — `ALL_CHANNELS` · `connectMethodOf` · `TEXT_CHANNELS`
 *       ② `lib/publish/contract.ts` — `API_PUBLISH_CHANNELS` · `RUNNER_PUBLISH_CHANNELS`(발행 경로 표)
 *       ③ `lib/publish/index.ts` · `lib/cron/publish-port.ts` — 표에 없으면 **연결 방식으로 추측하던 폴백**
 *       ④ `lib/runner-jobs.ts` — `publishJobKindOf`(러너 잡 이름)
 *     채널 하나를 켜려면 네 곳을 맞춰야 했고, 하나라도 빠뜨리면 **조용히 틀린 값**이 나왔다.
 *
 *   🔴 **실제로 그렇게 새고 있었다**(2026-09-15 프로브): `instagram`·`tiktok` 은 ②의 표에 **없는데**
 *      ③의 폴백이 «oauth → api» 로 추측해서 **«API 로 발행할 수 있다»고 대답했다.** 커넥터는 없는데.
 *      지금은 레지스트리가 `planned` 라 안 터질 뿐이고, **채널을 켜는 순간** «경로가 있다는데 올릴 코드가 없는» 상태가 된다.
 *      = 없는 것을 기본값으로 위장(AC-9) + 대용물로 판정(AC-57 · 연결 방식으로 발행 경로를 추측).
 *      ⇒ 이 파일은 **모르면 `null`** 이다. 추측하지 않는다.
 *
 *   ══ 축을 나눈 선(이게 핵심이다) ══
 *     · **코드(이 파일) = 안 변하는 «성질»** — 연결 방식 · 발행 경로 · 러너 잡 이름 · 글/영상.
 *     · **DB `channel_registry` = 변하는 «상태»** — `active`/`planned`/`down` · 라벨 · 정렬 · 표시용 `publish_via`.
 *     둘을 한 곳에 합치지 않는다. 상태는 운영이 화면에서 켜고 끄는 값이고, 성질은 코드가 바뀌어야 바뀌는 값이다.
 *
 *   ══ 채널을 늘리는 법(B2 · P1R8 §3.4) ══
 *     1. 아래 `CHANNELS` 에 **행 하나**를 넣는다.
 *     2. 🔴 `publishVia` 를 **실제로 올릴 코드가 생긴 뒤에** 채운다. 커넥터가 없는 채널은 `publishVia: null` 로 두면
 *        발행이 «아직 이 채널은 올릴 수 없어요»로 **정직하게 막힌다**(조용히 성공하는 길이 없다).
 *     3. 러너 채널이면 `jobKind` 에 `runner/core.mjs` 가 실제로 처리하는 잡 이름을 적는다(없으면 null).
 *     4. DB `channel_registry` 행(상태·라벨)은 따로다 — 운영센터에서 켠다.
 *   🔴 **순수 리프**: 이 파일은 아무것도 import 하지 않는다(AC-17 순환 0). 타입도 여기서 시작한다.
 */

export type ConnectMethod = "session" | "app_password" | "oauth";
export type PublishVia = "api" | "runner";
export type ChannelKindAxis = "text" | "video";

export interface ChannelSpec {
  /** DB `channel_registry.key` 와 같은 글자. */
  key: string;
  /** 계정을 어떻게 붙이나(§7.1). */
  connect: ConnectMethod;
  /**
   * 어떻게 발행하나. 🔴 **`null` = 아직 올릴 코드가 없다**(추측 금지).
   *   `"api"` = 서버가 직접 · `"runner"` = 고객 PC 러너가 브라우저로.
   */
  publishVia: PublishVia | null;
  /** 러너 잡 이름(`runner/core.mjs` 가 실제로 처리하는 kind). 러너 채널이 아니면 null. */
  jobKind: string | null;
  /** 글 축이냐 영상 축이냐 — 편성·생성이 갈린다(§5B.3). */
  axis: ChannelKindAxis;
  /**
   * 🔴 **지금 글을 만들어 주는 채널인가**(예전 `lib/accounts.ts TEXT_CHANNELS`).
   *   `axis` 와 **다른 칸이다**: 인스타 피드·카드뉴스는 «글 축»이지만 우리 글 생성기의 대상이 아직 아니다.
   *   둘을 한 칸으로 합쳤더니 통합 프로브에서 인스타가 **요금제 글 채널 목록에 딸려 들어갔다**(2026-09-15 · 무회귀 검사가 잡았다).
   *   커넥터가 붙는 라운드에 이 칸을 true 로 바꾼다.
   */
  textGen: boolean;
  /** 사람이 읽는 메모(왜 null 인지 등) — 화면에 쓰지 않는다. */
  note?: string;
}

/**
 * 채널 성질 표 — **행 하나 = 채널 하나**.
 *   순서는 «글 먼저 · 영상 나중»(화면 정렬은 DB `sort` 가 따로 정한다).
 */
export const CHANNELS: readonly ChannelSpec[] = [
  { key: "naver_blog", connect: "session", publishVia: "runner", jobKind: "publish.naver_blog", axis: "text", textGen: true },
  { key: "tistory", connect: "session", publishVia: "runner", jobKind: "publish.tistory", axis: "text", textGen: true },
  { key: "blogger", connect: "oauth", publishVia: "api", jobKind: null, axis: "text", textGen: true },
  { key: "wordpress", connect: "app_password", publishVia: "api", jobKind: null, axis: "text", textGen: true },
  { key: "threads", connect: "oauth", publishVia: "api", jobKind: null, axis: "text", textGen: true, note: "글·영상 둘 다 올린다(축은 글로 센다 · lib/video/types 의 영상 채널 목록과 다른 축)" },
  { key: "instagram", connect: "oauth", publishVia: null, jobKind: null, axis: "text", textGen: false, note: "🔴 피드·카드뉴스 커넥터 없음(P1R8 §3.4 B2) — 붙기 전까지 null" },
  { key: "youtube_shorts", connect: "oauth", publishVia: "api", jobKind: null, axis: "video", textGen: false },
  { key: "naver_clip", connect: "session", publishVia: "runner", jobKind: "publish.naver_clip", axis: "video", textGen: false, note: "러너 스텁 — 잡은 쌓이되 사람이 올린다(§2.3)" },
  { key: "reels", connect: "oauth", publishVia: "api", jobKind: null, axis: "video", textGen: false },
  { key: "tiktok", connect: "oauth", publishVia: null, jobKind: null, axis: "video", textGen: false, note: "🔴 커넥터 없음(P1R8 §3.4 B2) — 심사 전엔 «본인만 보기»" },
];

const BY_KEY: ReadonlyMap<string, ChannelSpec> = new Map(CHANNELS.map((c) => [c.key, c]));

/** 이 채널의 성질. 표에 없으면 null(모르는 채널이다). */
export function channelSpec(key: string): ChannelSpec | null {
  return BY_KEY.get(String(key)) ?? null;
}
export function isKnownChannel(key: unknown): boolean {
  return BY_KEY.has(String(key));
}

/** 전 채널 키(표 순서 그대로). */
export const CHANNEL_KEYS: readonly string[] = CHANNELS.map((c) => c.key);
/** 🔴 **글을 만들어 주는 채널**(예전 `TEXT_CHANNELS`) — `axis` 가 아니라 `textGen` 을 본다. 요금제 채널 게이트가 이 목록을 쓴다. */
export const TEXT_CHANNEL_KEYS: readonly string[] = CHANNELS.filter((c) => c.textGen).map((c) => c.key);
/** 글 «축» 채널(생성 여부와 무관 · 화면 분류용). */
export const TEXT_AXIS_KEYS: readonly string[] = CHANNELS.filter((c) => c.axis === "text").map((c) => c.key);
/** 영상 축 채널. */
export const VIDEO_CHANNEL_KEYS: readonly string[] = CHANNELS.filter((c) => c.axis === "video").map((c) => c.key);

/**
 * 연결 방식. 🔴 여기만 **모르는 채널에 기본값**(`oauth`)을 준다 — 연결 방식은 «어떤 화면을 띄울까»라서
 * 틀려도 고객이 곧바로 알아채고(로그인 창이 안 맞는다) **잘못 발행되지 않는다**. 발행 경로(`publishViaOf`)는 그 반대라 null 이다.
 */
export function connectMethodOf(channel: string): ConnectMethod {
  return channelSpec(channel)?.connect ?? "oauth";
}

/** 발행 경로. 🔴 모르면 **null** — 호출부가 «아직 이 채널은 올릴 수 없어요»로 막는다(추측 0). */
export function publishViaOf(channel: string): PublishVia | null {
  return channelSpec(channel)?.publishVia ?? null;
}

/** 러너 잡 이름. 러너 채널이 아니거나 모르는 채널이면 null. */
export function jobKindOf(channel: string): string | null {
  return channelSpec(channel)?.jobKind ?? null;
}

/** 서버(API)로 발행하는 채널 집합 — 표에서 파생(예전 `API_PUBLISH_CHANNELS` 자리). */
export const API_CHANNEL_KEYS: ReadonlySet<string> = new Set(CHANNELS.filter((c) => c.publishVia === "api").map((c) => c.key));
/** 러너로 발행하는 채널 집합 — 표에서 파생(예전 `RUNNER_PUBLISH_CHANNELS` 자리). */
export const RUNNER_CHANNEL_KEYS: ReadonlySet<string> = new Set(CHANNELS.filter((c) => c.publishVia === "runner").map((c) => c.key));
