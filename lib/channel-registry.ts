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
  /**
   * 🔴 **올린 글을 내릴 수 있나**(DESIGN §5E · 사장님 질문 2026-09-15). `publishVia` 와 **같은 규율**로 — 모르면 `null`.
   *   `"api"` = 서버가 직접 지운다 · `"runner"` = 고객 PC 러너가 브라우저로 지운다 · `null` = **내릴 길이 없다**.
   *
   *   ⚠️ **올릴 수 있다고 내릴 수 있는 게 아니다.** 실측으로 확인한 것(2026-09-15 B2):
   *     · `blogger` — OAuth 스코프가 `auth/blogger`(전체)라 `posts.delete` 가 **된다**.
   *     · 🔴 `youtube_shorts` — 스코프가 `youtube.upload`·`youtube.readonly`·`yt-analytics-monetary.readonly` 뿐이라
   *       **`videos.delete` 권한이 없다**(삭제엔 `auth/youtube` 또는 `youtube.force-ssl` 가 필요하다).
   *       스코프를 늘리면 **이미 연결된 계정이 전부 재동의**해야 하므로 여기서 조용히 켜지 않는다 — 사장님 판단 사안.
   *     · `wordpress` — 앱 비밀번호로 `DELETE wp/v2/posts/{id}` 가 되므로 추가 권한이 필요 없다.
   *     · `threads` — 삭제 엔드포인트를 **확인하지 못했다**. 확인 못 한 길을 열지 않는다.
   */
  retractVia: PublishVia | null;
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
  { key: "naver_blog", connect: "session", publishVia: "runner", jobKind: "publish.naver_blog", retractVia: "runner", axis: "text", textGen: true },
  { key: "tistory", connect: "session", publishVia: "runner", jobKind: "publish.tistory", retractVia: "runner", axis: "text", textGen: true },
  { key: "blogger", connect: "oauth", publishVia: "api", jobKind: null, retractVia: "api", axis: "text", textGen: true },
  { key: "wordpress", connect: "app_password", publishVia: "api", jobKind: null, retractVia: "api", axis: "text", textGen: true },
  { key: "threads", connect: "oauth", publishVia: "api", retractVia: null, jobKind: null, axis: "text", textGen: true, note: "글·영상 둘 다 올린다(축은 글로 센다 · lib/video/types 의 영상 채널 목록과 다른 축)" },
  /* [P1R8 §3.4] 피드·카드뉴스 커넥터가 생겼다(`lib/publish/instagram.ts publishInstagramFeed` — 사진 1장 / 캐러셀 2~10장).
     🔴 `textGen` 은 **아직 false** 다 — 글 계약에 format 이 1종뿐이라 10편 중 9편이 «골격 75% 이상 겹침»에 걸린다(B-1 실측).
        카드뉴스 계약이 보강된 뒤에 켠다. «올릴 수 있다»와 «써 줄 수 있다»는 다른 칸이다. */
  { key: "instagram", connect: "oauth", publishVia: "api", retractVia: null, jobKind: null, axis: "text", textGen: false, note: "피드·카드뉴스 발행 O · 🔴 인스타 API 에는 **삭제가 없다** → retract 는 null(직접 내려 주세요). textGen 은 카드뉴스 계약 보강 후." },
  /* [P1R8 §3.4] 페이스북 페이지 — 글·사진(설계 §2.1 P3). 삭제는 `DELETE /{post-id}` 로 **된다**(페이지 토큰). */
  { key: "facebook", connect: "oauth", publishVia: "api", retractVia: "api", jobKind: null, axis: "text", textGen: false, note: "페이지 글·사진. 🔴 발행은 **페이지 토큰**으로 한다(사용자 토큰 아님 · lib/publish/facebook.ts 머리말). textGen 은 페북용 글 계약이 생긴 뒤." },
  /* [P1R8 §3.4] X(트위터) — 설계 §2.1 «API(유료) · P4 선택». 🔴 한글은 한 자가 2로 세어진다(lib/publish/x.ts weightedLen). */
  { key: "x", connect: "oauth", publishVia: "api", retractVia: "api", jobKind: null, axis: "text", textGen: false, note: "쓰기가 유료 플랜이다. 삭제는 DELETE /2/tweets/{id} 로 된다. 영상은 아직 못 올린다(글·사진만)." },
  /* [P1R8 §3.4] 브런치 — 🔴 **일부러 null** 이다. 아래 «못 채운 칸» 주석 참조. */
  { key: "brunch", connect: "session", publishVia: null, retractVia: null, jobKind: null, axis: "text", textGen: false, note: "🔴 러너 채널인데 **셀렉터를 한 번도 못 쟀다**(작가 승인 계정이 없어 화면을 연 적이 없다). 추측으로 채우지 않는다 — 아래 주석." },
  { key: "youtube_shorts", connect: "oauth", publishVia: "api", retractVia: null, jobKind: null, axis: "video", textGen: false, note: "🔴 retract 는 스코프가 없어 못 한다 — 지금 스코프는 youtube.upload·readonly 뿐이고 videos.delete 는 auth/youtube 가 필요하다. 늘리면 연결된 계정이 전부 재동의해야 해서 사장님 판단 사안." },
  /* [P1R8 §3.4] 유튜브 롱폼 — 쇼츠와 **같은 `videos.insert`**(lib/publish/youtube.ts publishYoutube · 주소만 다르다).
     🔴 쿼터는 채널이 아니라 **구글 프로젝트** 단위라 쇼츠와 합산해 센다(todayUploads). */
  { key: "youtube_long", connect: "oauth", publishVia: "api", retractVia: null, jobKind: null, axis: "video", textGen: false, note: "쇼츠와 같은 API·같은 동의·같은 쿼터. retract 는 쇼츠와 같은 이유로 null." },
  { key: "naver_clip", connect: "session", publishVia: "runner", retractVia: null, jobKind: "publish.naver_clip", axis: "video", textGen: false, note: "러너 스텁 — 잡은 쌓이되 사람이 올린다(§2.3)" },
  /* [P1R8 §3.4] 클립 «게시물형»(텍스트+이미지 · 설계 §2.1 P3) — 🔴 **일부러 null**. 아래 «못 채운 칸» 주석 참조. */
  { key: "naver_clip_post", connect: "session", publishVia: null, retractVia: null, jobKind: null, axis: "text", textGen: false, note: "🔴 영상 클립과 **다른 채널**이다(텍스트+이미지 게시물형 · 2026 확대). 업로드 경로를 실측한 적이 없다 — 아래 주석." },
  { key: "reels", connect: "oauth", publishVia: "api", retractVia: null, jobKind: null, axis: "video", textGen: false },
  /* [P1R8 §3.4] 페북 릴스 — 페이지 릴스 3단계 업로드(`publishFacebookReels`). 삭제는 페이지 글과 같은 `DELETE /{id}`. */
  { key: "facebook_reels", connect: "oauth", publishVia: "api", retractVia: "api", jobKind: null, axis: "video", textGen: false, note: "페이지 릴스(start→rupload→finish). 페이지 토큰으로 올린다." },
  /* [P1R8 §3.4] 틱톡 — 커넥터가 생겼다(`lib/publish/tiktok.ts`). 🔴 **삭제 API 가 없어** retract 는 null. */
  { key: "tiktok", connect: "oauth", publishVia: "api", retractVia: null, jobKind: null, axis: "video", textGen: false, note: "🔴 심사 전엔 «본인만 보기» 고정(플랫폼 사실 · 우리 게이트 아님) · PULL_FROM_URL 은 도메인 소유 확인 필요 · **삭제 API 없음** → retract null" },
];

/* ═══ [P1R8 §3.4] 🔴 **«못 채운 칸»을 왜 안 채웠나** — `brunch` · `naver_clip_post` ═══
   둘 다 **러너 채널**이라 «올리는 코드»가 브라우저 조작 순서(셀렉터)다. 그런데 —
     · **브런치**: 글을 쓰려면 **작가 승인**이 먼저다(신청→심사). 승인된 계정이 없어 `brunch.co.kr/write` 를 **한 번도 연 적이 없다**.
     · **클립 게시물형**: 네이버가 2026 에 확대한 텍스트+이미지 글인데, PC 업로드 경로 자체가 확인되지 않았다(영상 클립과 같은 문제 · §2.2).
   ⇒ 여기 `publishVia: "runner"` 와 잡 이름을 **적을 수는 있다.** 적으면 편성·예약·큐가 전부 돌고 화면도 «되는 채널»로 보인다.
      그런데 러너가 집으면 **아무 데도 못 누르고 실패**한다. 그건 «키 꽂으면 가동»이 아니라 **되는 척**이다.
   🔴 그리고 추측한 셀렉터를 박아 두는 것이 이 프로젝트에서 제일 비싼 실수였다 —
      티스토리는 «죽은 복제본»(AC-43)과 «조용한 confirm 취소»(AC-42)로 **이틀**을 태웠고, 그건 **실측 화면을 보고서야** 풀렸다.
      화면을 본 적도 없는 채널에 셀렉터를 적는 것은 그 이틀을 **미리 사 두는 것**이다.
   ⇒ 그래서 `null` 로 둔다. 화면은 «곧 연결할 수 있어요»라고 **정직하게** 말하고, 발행은 «아직 이 채널로는 올릴 수 없어요»로 막힌다.
   **열려면 필요한 것은 코드가 아니라 «한 번 재 보는 것»이다**(승인 계정 1개 + 화면 1회 실측 → 셀렉터 표 → 카나리). */

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

/**
 * 🔴 **내리는 경로**(DESIGN §5E). 모르면 **null** — 호출부가 «우리가 대신 내려 드릴 수 없어요»로 막고
 *   «직접 내려 주세요» + 그 글로 가는 링크를 준다. **없는 길을 단추로 만들지 않는다.**
 */
export function retractViaOf(channel: string): PublishVia | null {
  return channelSpec(channel)?.retractVia ?? null;
}
/** 우리가 대신 내려 줄 수 있는 채널인가 — 화면이 단추를 켤지 정하는 값. */
export function canRetract(channel: string): boolean {
  return retractViaOf(channel) !== null;
}

/** 러너 잡 이름. 러너 채널이 아니거나 모르는 채널이면 null. */
export function jobKindOf(channel: string): string | null {
  return channelSpec(channel)?.jobKind ?? null;
}

/** 서버(API)로 발행하는 채널 집합 — 표에서 파생(예전 `API_PUBLISH_CHANNELS` 자리). */
export const API_CHANNEL_KEYS: ReadonlySet<string> = new Set(CHANNELS.filter((c) => c.publishVia === "api").map((c) => c.key));
/** 러너로 발행하는 채널 집합 — 표에서 파생(예전 `RUNNER_PUBLISH_CHANNELS` 자리). */
export const RUNNER_CHANNEL_KEYS: ReadonlySet<string> = new Set(CHANNELS.filter((c) => c.publishVia === "runner").map((c) => c.key));

/* ═══ [P1R8 §5.2] 🔴 아직 안 합친 다섯 번째 표 — `lib/writing-contracts.ts WRITING_CONTRACTS` ═══
   그 파일에도 채널 목록이 있다(채널 × format·structure·length·images). 이번에 **일부러 안 합쳤다**:
     · R8 §2 에서 B-1·C 가 그 파일을 계속 고치는 중이라, 지금 합치면 세 세션이 한 파일을 만진다(병렬 규칙 위반).
     · 성격도 다르다 — 여기는 «채널의 성질», 그쪽은 «그 채널에 어떻게 쓰나»(글 계약)다.
   🔴 그래도 **어긋나면 거짓말이 난다**: `textGen: true` 인데 글 계약이 없으면 «글을 만들어 준다»고 해 놓고 못 만든다
      (인스타가 요금제 글 채널 목록에 딸려 들어갔던 것과 같은 모양). 그래서 합치는 대신 **검사**를 건다 —
      `scripts/verify-channel-tables.mjs` 가 두 표를 대조하고, 어긋나면 사람이 고친다. 합치기는 R8 §2 가 끝난 뒤 후보. */
