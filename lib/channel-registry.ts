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

/* ═══ [R9-4 · B · 2026-09-16] 🔴 채널이 **낼 수 있는 꾸밈** 표 (설계 §2.1d · §2.1e) ═══
 *   근거: 네이버·티스토리는 형광펜이 되고 **쓰레드는 글자뿐**이며 **AM 당근 러너에는 서식이 0건**이다 — 「서식은 채널마다 다르다」가 AM 에서 사실로 서 있다.
 *   앞 여섯(bold·underline·italic·value·line·row)은 `lib/blocks.ts MarkKind` 와 **같은 글자**다(B2·A 합의 어휘). 뒤는 블록 요소(러너가 에디터 실요소로 내릴 수 있나).
 *   🔴 **모르면 `null`** — 이 파일의 사상 그대로(«추측 폴백 제거 · 모르면 null»). `false` 는 «확인했고 못 낸다», `null` 은 «아직 안 재 봤다».
 *      «모른다»를 «false»로 바꾸면 화면이 «못 내요»라고 거짓말을 한다(AC-92). 러너가 올려 보고 발행 뒤 `formatMarks` 에 적는다.
 *   읽는 곳: `blocks.ts markRendererFor`(false 는 태그를 벗긴다) · `content-gen.ts`(true 인 종류만 모델에게 시킨다) · `pieces-get.formatCaps`(화면) · 러너 payload. */
export type FormatCapKey = "bold" | "underline" | "italic" | "value" | "line" | "row" | "emoji" | "quote" | "table" | "checklist" | "faq" | "toc" | "divider" | "image" | "place";
export const FORMAT_CAP_KEYS: readonly FormatCapKey[] = ["bold", "underline", "italic", "value", "line", "row", "emoji", "quote", "table", "checklist", "faq", "toc", "divider", "image", "place"];
/** 인라인 마크 여섯(= `blocks.ts MarkKind`) — 표 안의 앞 여섯 칸. 모델에게 시킬 수 있는 종류를 고를 때 이 목록만 본다. */
export const INLINE_MARK_CAP_KEYS: readonly FormatCapKey[] = ["bold", "underline", "italic", "value", "line", "row"];
export type FormatCaps = Record<FormatCapKey, boolean | null>;
/** 표 한 행 만들기 — `base` 로 전부 채우고 `over` 만 덮는다. */
function caps(over: Partial<FormatCaps>, base: boolean | null): FormatCaps {
  const o = {} as FormatCaps;
  for (const k of FORMAT_CAP_KEYS) o[k] = k in over ? (over[k] as boolean | null) : base;
  return o;
}

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
  /**
   * [R9-4] 🔴 이 채널이 **낼 수 있는 꾸밈**(위 `FormatCaps`). `null` = 표 자체가 없다(영상 채널 · 화면을 한 번도 안 연 러너 채널).
   *   칸 하나가 `null` = 그 종류는 아직 안 재 봤다. 러너 채널의 값은 **B2 실측**(2026-09-16 · naver_blog)이고, HTML 채널은 우리가 태그를 직접 보내므로 «낼 수 있다».
   */
  formatCaps: FormatCaps | null;
  /** 사람이 읽는 메모(왜 null 인지 등) — 화면에 쓰지 않는다. */
  note?: string;
}

/* ─── [R9-4] 채널 부류별 표 — 행에 그대로 붙인다(부류가 같으면 같은 표 · 채널 이름으로 분기하지 않는다) ─── */
/** 네이버 블로그(러너 · B2 실측 2026-09-16): value·line·row·bold·underline ✅(선택 적용 경로 · 캐럿 토글 안 씀) · 글자색/배경색은 네이버 팔레트 중 가장 가까운 색을 러너가 고른다(헥사 지정 불가 · AM 실측).
 *  🔴 italic 은 **false** — «못 낸다»가 아니라 **«안 낸다»**다(B2 2026-09-16): 낼 수는 있지만 기울임은 발행 직전 자가검사(`measureFormatBleed`)가 **번짐 증상으로 세는 축**이라
 *     우리가 일부러 켜면 우리 글을 우리가 잡아 발행이 멈춘다(계약의 두 부분이 싸우는 자리 · 9/15 `visualMin.faq` 사고와 같은 모양). 아는 것을 null 로 두면 그게 AC-92 의 반대 방향이다.
 *  블록 요소: AM op 어휘가 title·heading·para·quote·image·divider·tagline 이라 quote·divider·image 는 되고, table·checklist·faq·toc·place 는 B2-3(18종→7종 내리기) 결과로 채운다 — 그때까지 null. */
const CAPS_NAVER: FormatCaps = caps({ bold: true, underline: true, value: true, line: true, row: true, italic: false, emoji: true, quote: true, divider: true, image: true }, null);
/** 티스토리(러너): 이번 라운드에 B2 가 잰다 — 이모지(타자)만 true, 나머지 **모른다**(null). «모른다»를 false 로 바꾸지 않는다(AC-92). */
const CAPS_TISTORY: FormatCaps = caps({ emoji: true }, null);
/** HTML 을 우리가 직접 보내는 채널(블로거·워드프레스): 태그(`<mark>`·`<u>`·`<em>`·`<strong>`·표·목록·인용)를 그대로 싣는다 — 워드프레스 KSES 허용 목록에 mark·u·em·strong·table 이 있고 블로거는 HTML 을 그대로 받는다. 테마가 어떻게 그리느냐는 우리 밖. */
const CAPS_HTML: FormatCaps = caps({}, true);
/** 글자만 받는 API 채널(쓰레드·X·페이스북·인스타 캡션): 꾸밈 태그가 **없다**(플랫폼 사실 · 우리 판단 아님). 이모지·사진만 된다. */
const CAPS_PLAIN: FormatCaps = caps({ emoji: true, image: true }, false);

/**
 * 채널 성질 표 — **행 하나 = 채널 하나**.
 *   순서는 «글 먼저 · 영상 나중»(화면 정렬은 DB `sort` 가 따로 정한다).
 */
export const CHANNELS: readonly ChannelSpec[] = [
  { key: "naver_blog", connect: "session", publishVia: "runner", jobKind: "publish.naver_blog", retractVia: "runner", axis: "text", textGen: true, formatCaps: CAPS_NAVER },
  { key: "tistory", connect: "session", publishVia: "runner", jobKind: "publish.tistory", retractVia: "runner", axis: "text", textGen: true, formatCaps: CAPS_TISTORY },
  { key: "blogger", connect: "oauth", publishVia: "api", jobKind: null, retractVia: "api", axis: "text", textGen: true, formatCaps: CAPS_HTML },
  { key: "wordpress", connect: "app_password", publishVia: "api", jobKind: null, retractVia: "api", axis: "text", textGen: true, formatCaps: CAPS_HTML },
  { key: "threads", connect: "oauth", publishVia: "api", retractVia: null, jobKind: null, axis: "text", textGen: true, formatCaps: CAPS_PLAIN, note: "글·영상 둘 다 올린다(축은 글로 센다 · lib/video/types 의 영상 채널 목록과 다른 축)" },
  /* [P1R8 §3.4] 피드·카드뉴스 커넥터가 생겼다(`lib/publish/instagram.ts publishInstagramFeed` — 사진 1장 / 캐러셀 2~10장).
     🔴 `textGen` 은 **아직 false** 다 — 글 계약에 format 이 1종뿐이라 10편 중 9편이 «골격 75% 이상 겹침»에 걸린다(B-1 실측).
        카드뉴스 계약이 보강된 뒤에 켠다. «올릴 수 있다»와 «써 줄 수 있다»는 다른 칸이다. */
  { key: "instagram", connect: "oauth", publishVia: "api", retractVia: null, jobKind: null, axis: "text", textGen: false, formatCaps: CAPS_PLAIN, note: "피드·카드뉴스 발행 O · 🔴 인스타 API 에는 **삭제가 없다** → retract 는 null(직접 내려 주세요). textGen 은 카드뉴스 계약 보강 후." },
  /* [P1R8 §3.4] 페이스북 페이지 — 글·사진(설계 §2.1 P3). 삭제는 `DELETE /{post-id}` 로 **된다**(페이지 토큰). */
  { key: "facebook", connect: "oauth", publishVia: "api", retractVia: "api", jobKind: null, axis: "text", textGen: false, formatCaps: CAPS_PLAIN, note: "페이지 글·사진. 🔴 발행은 **페이지 토큰**으로 한다(사용자 토큰 아님 · lib/publish/facebook.ts 머리말). textGen 은 페북용 글 계약이 생긴 뒤." },
  /* [P1R8 §3.4] X(트위터) — 설계 §2.1 «API(유료) · P4 선택». 🔴 한글은 한 자가 2로 세어진다(lib/publish/x.ts weightedLen). */
  /* [R9-9 · B2 2026-09-16] X 영상 — 옛 주석 «영상은 사진과 다른 처리 대기 단계가 붙는다» 는 틀렸다: initialize/append/finalize 는 사진과 **똑같고** 영상만 finalize 응답에 processing_info 가 붙는다 ⇒ «없는 길»이 아니라 «안 만든 길»이라 만들었다(`lib/publish/x.ts`). 우리 키 실호출은 아직(X 계정 0 · AC-50). */
  { key: "x", connect: "oauth", publishVia: "api", retractVia: "api", jobKind: null, axis: "text", textGen: false, formatCaps: CAPS_PLAIN, note: "쓰기가 유료 플랜이다. 삭제는 DELETE /2/tweets/{id} 로 된다. 영상은 2026-09-16 에 열었다 — 사진과 같은 청크 업로드에 «처리 대기» 한 단계를 더한 것이라 «없는 길»이 아니라 «안 만든 길»이었다(우리 키로 실호출 검증은 아직)." },
  /* [P1R8 §3.4] 브런치 — 🔴 **일부러 null** 이다. 아래 «못 채운 칸» 주석 참조. */
  { key: "brunch", connect: "session", publishVia: null, retractVia: null, jobKind: null, axis: "text", textGen: false, formatCaps: null, note: "🔴 러너 채널인데 **셀렉터를 한 번도 못 쟀다**(작가 승인 계정이 없어 화면을 연 적이 없다). 추측으로 채우지 않는다 — 아래 주석." },
  { key: "youtube_shorts", connect: "oauth", publishVia: "api", retractVia: null, jobKind: null, axis: "video", textGen: false, formatCaps: null, note: "🔴 retract 는 스코프가 없어 못 한다 — 지금 스코프는 youtube.upload·readonly 뿐이고 videos.delete 는 auth/youtube 가 필요하다. 늘리면 연결된 계정이 전부 재동의해야 해서 사장님 판단 사안." },
  /* [P1R8 §3.4] 유튜브 롱폼 — 쇼츠와 **같은 `videos.insert`**(lib/publish/youtube.ts publishYoutube · 주소만 다르다).
     🔴 쿼터는 채널이 아니라 **구글 프로젝트** 단위라 쇼츠와 합산해 센다(todayUploads). */
  { key: "youtube_long", connect: "oauth", publishVia: "api", retractVia: null, jobKind: null, axis: "video", textGen: false, formatCaps: null, note: "쇼츠와 같은 API·같은 동의·같은 쿼터. retract 는 쇼츠와 같은 이유로 null." },
  { key: "naver_clip", connect: "session", publishVia: "runner", retractVia: null, jobKind: "publish.naver_clip", axis: "video", textGen: false, formatCaps: null, note: "러너 스텁 — 잡은 쌓이되 사람이 올린다(§2.3)" },
  /* [P1R8 §3.4] 클립 «게시물형»(텍스트+이미지 · 설계 §2.1 P3) — 🔴 **일부러 null**. 아래 «못 채운 칸» 주석 참조. */
  { key: "naver_clip_post", connect: "session", publishVia: null, retractVia: null, jobKind: null, axis: "text", textGen: false, formatCaps: null, note: "🔴 영상 클립과 **다른 채널**이다(텍스트+이미지 게시물형 · 2026 확대). 업로드 경로를 실측한 적이 없다 — 아래 주석." },
  { key: "reels", connect: "oauth", publishVia: "api", retractVia: null, jobKind: null, axis: "video", textGen: false, formatCaps: null },
  /* [P1R8 §3.4] 페북 릴스 — 페이지 릴스 3단계 업로드(`publishFacebookReels`). 삭제는 페이지 글과 같은 `DELETE /{id}`. */
  { key: "facebook_reels", connect: "oauth", publishVia: "api", retractVia: "api", jobKind: null, axis: "video", textGen: false, formatCaps: null, note: "페이지 릴스(start→rupload→finish). 페이지 토큰으로 올린다." },
  /* [P1R8 §3.4] 틱톡 — 커넥터가 생겼다(`lib/publish/tiktok.ts`). 🔴 **삭제 API 가 없어** retract 는 null. */
  { key: "tiktok", connect: "oauth", publishVia: "api", retractVia: null, jobKind: null, axis: "video", textGen: false, formatCaps: null, note: "🔴 심사 전엔 «본인만 보기» 고정(플랫폼 사실 · 우리 게이트 아님) · PULL_FROM_URL 은 도메인 소유 확인 필요 · **삭제 API 없음** → retract null" },
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

/**
 * [R9-4] 이 채널이 낼 수 있는 꾸밈 표. 🔴 모르는 채널·표 없는 채널은 **null**(추측 0) — 화면은 «올려 봐야 알아요», 렌더는 벗기지 않는다.
 *   같은 표를 화면(`pieces-get.formatCaps`)·러너 payload·생성 프롬프트가 본다 — 세 곳이 다른 표를 들지 않는다.
 */
export function formatCapsOf(channel: string): FormatCaps | null {
  return channelSpec(channel)?.formatCaps ?? null;
}
/** 칸 하나 — `true`(된다) · `false`(확인했고 안 된다) · `null`(모른다). */
export function formatCapOf(channel: string, key: FormatCapKey): boolean | null {
  const t = formatCapsOf(channel);
  return t ? t[key] : null;
}
/** 🔴 모델에게 **시켜도 되는** 인라인 마크 종류 — 표가 `true` 인 것만. null(모름)은 시키지 않는다(배워도 못 내면 장식이고, 모르면서 시키면 «못 냈어요»가 매 글에 뜬다). */
export function inlineMarksAllowed(channel: string): FormatCapKey[] {
  const t = formatCapsOf(channel);
  if (!t) return [];
  return INLINE_MARK_CAP_KEYS.filter((k) => t[k] === true);
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
