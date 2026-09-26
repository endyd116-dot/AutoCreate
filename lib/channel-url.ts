/**
 * lib/channel-url.ts — «내가 직접 올린 주소»를 채널과 대조하고 **수익 매칭 키**를 뽑는 자리(계약 R7 §1.3). 순수(임포트 0 · AC-17).
 *   AC 신규 2026-09-15(B-1). 이 파일이 생긴 이유: 종전엔 채널↔도메인 표가 어디에도 없었다
 *   (있던 건 `lib/video/reference.ts isYoutubeUrl` 하나뿐 — 참고영상 입력용이라 재활용할 수 없다).
 *
 *   ══ 왜 «대조»가 필요한가 ══
 *     `POST /api/post-mark-published` 는 사람이 손으로 붙여 넣는 주소를 받는다. 검사가 없으면
 *     ① 오타·엉뚱한 탭의 주소가 그대로 `posts.external_url` 이 되고 ② 그 행이 애드센스 귀속표(`lib/revenue/adsense.ts` PAGE_URL↔external_url)에
 *     끼어 **남의 글 수익이 내 글로 붙는다**. 그래서 «https 인가 · 이 채널의 도메인인가 · 혹시 **다른 채널**의 도메인인가»를 본다.
 *
 *   ══ 두 종류의 채널 ══
 *     · 고정 도메인(유튜브·인스타·스레드·틱톡·네이버) — 아는 도메인이 아니면 **거부**한다.
 *     · 제 도메인 가능(워드프레스 자체호스팅 · 티스토리/블로거 커스텀 도메인) — 모르는 도메인은 통과시킨다.
 *       🔴 계정에 저장된 사이트 주소와 대조하지 **않는다**: 그 값(`WpCreds.siteUrl`)은 암호화된 자격 안에 있고,
 *          자격 평문 표면은 «러너 claim · 운영 열람» 2곳뿐이다(DESIGN §7.1). 주소 검사 하나 하자고 표면을 늘리지 않는다.
 *       대신 «**다른 채널의 도메인이면 거부**»가 여기서도 산다 — 워드프레스 글이라며 youtube.com 을 넣는 건 막힌다.
 *
 *   ══ channelRef 를 왜 여기서 뽑나 ══
 *     유튜브 수익 귀속은 `posts.external_url` 이 아니라 **`posts.channel_ref`(영상 id)** 로 붙는다(`lib/revenue/youtube.ts:35`).
 *     주소만 적어 두면 손으로 올린 쇼츠는 **영원히 수익이 안 붙는다** — 계약 §1.3 «수익 매칭 대상이 된다»가 말뿐이 된다.
 *     그래서 커넥터가 저장하는 것과 **같은 모양**으로 주소에서 되뽑는다(youtube.ts:196 videoId · instagram.ts:148 mediaId · threads.ts:114 id).
 *     모양이 코드로 확정되지 않은 채널(네이버·티스토리·블로거·워드프레스 — 러너·API 가 무엇을 넣는지 파일로 굳어 있지 않다)은
 *     **비워 둔다**. 틀린 ref 는 없는 ref 보다 나쁘다(엉뚱한 글에 통계·수익이 붙는다).
 */

export type UrlCheckFailReason = "scheme" | "parse" | "domain" | "other_channel" | "too_long";

export interface UrlCheckOk { ok: true; url: string; host: string; channelRef?: string }
export interface UrlCheckFail { ok: false; reason: UrlCheckFailReason; error: string }
export type UrlCheck = UrlCheckOk | UrlCheckFail;

/** 채널이 실제로 쓰는 호스트(**접미사** 일치 · 소문자). `xxx.tistory.com` 처럼 앞에 뭐가 붙는 게 정상이라 접미사로 잰다. */
export const CHANNEL_HOSTS: Readonly<Record<string, readonly string[]>> = {
  naver_blog: ["blog.naver.com", "in.naver.com"],
  naver_clip: ["blog.naver.com", "clip.naver.com", "tv.naver.com"],
  tistory: ["tistory.com"],
  blogger: ["blogspot.com", "blogspot.kr"],
  wordpress: ["wordpress.com"],
  threads: ["threads.net", "threads.com"],
  instagram: ["instagram.com", "instagr.am"],
  reels: ["instagram.com", "instagr.am"],
  youtube_shorts: ["youtube.com", "youtu.be"],
  tiktok: ["tiktok.com"],
};

/** 제 도메인을 쓸 수 있는 채널 — 이 채널들만 «모르는 도메인»을 통과시킨다(자체호스팅·커스텀 도메인). */
export const CUSTOM_DOMAIN_CHANNELS: ReadonlySet<string> = new Set(["wordpress", "tistory", "blogger"]);

/** 화면 문구용 채널 이름(사람말 · CLAUDE §3 «시스템 용어 금지»). */
export const CHANNEL_LABEL_KO: Readonly<Record<string, string>> = {
  naver_blog: "네이버 블로그", naver_clip: "네이버 클립", tistory: "티스토리", blogger: "블로거",
  wordpress: "워드프레스", threads: "스레드", instagram: "인스타그램", reels: "인스타 릴스",
  youtube_shorts: "유튜브 쇼츠", tiktok: "틱톡",
  /* [R18 · B] 🔴 `facebook_reels` 가 한 영상 여러 곳의 대상이 되면서 «릴스»가 **둘**이 됐다 — 그래서 `reels` 를 «인스타 릴스»로 갈랐다.
     «릴스» 한 낱말로 두면 «릴스 ✅ · 페이스북 릴스 —» 가 같은 곳처럼 읽힌다(트리거 §1 의 모양도 «인스타 릴스»다). */
  facebook_reels: "페이스북 릴스",
};
export function channelLabelKo(channel: unknown): string { return CHANNEL_LABEL_KO[String(channel ?? "")] ?? String(channel ?? "채널"); }

/** 호스트가 이 접미사 목록에 드나. `blog.naver.com` 은 `naver.com` 을 포함하는 게 아니라 **점 경계**로 잰다(`evilnaver.com` 을 막는다). */
function hostMatches(host: string, suffixes: readonly string[]): boolean {
  return suffixes.some((s) => host === s || host.endsWith(`.${s}`));
}

/** 이 호스트를 쓰는 채널들(«다른 채널 주소» 판정용). 인스타/릴스처럼 도메인을 나눠 쓰는 짝이 있어 배열로 돌려준다. */
export function channelsOfHost(host: string): string[] {
  const h = host.toLowerCase();
  return Object.keys(CHANNEL_HOSTS).filter((c) => hostMatches(h, CHANNEL_HOSTS[c]));
}

/** 추적용 꼬리표 — 같은 글이 주소 두 벌로 보이면 애드센스 귀속표가 갈라진다(`adsense.ts normUrl` 도 쿼리를 통째로 떼고 비교한다). */
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|igshid$|igsh$|si$|feature$|share_|_r$|is_from_webapp$|sender_device$|ref_src$|ref_url$)/i;

/** 유튜브 영상 id(11자 고정 · 유튜브 규격). 이 모양이 아니면 ref 를 안 만든다. */
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
/** 인스타/스레드 코드 · 틱톡 숫자 id. */
const CODE = /^[A-Za-z0-9_-]{4,64}$/;
const DIGITS = /^[0-9]{5,32}$/;

/**
 * 주소에서 `posts.channel_ref` 를 뽑는다(없으면 undefined). 🔴 커넥터가 저장하는 모양과 **같아야** 수익·통계가 붙는다.
 *   youtube_shorts: `/shorts/{id}` · `youtu.be/{id}` · `watch?v={id}` · `/embed/{id}` → 11자 영상 id (`lib/revenue/youtube.ts` 가 이 값으로 귀속)
 *   instagram·reels: `/reel|reels|p|tv/{code}` (`lib/publish/instagram.ts:148` 과 같은 자리)
 *   threads: `/post/{code}` (`@handle` 이 앞에 붙어도 뒤에서 센다 · `lib/publish/threads.ts:114`)
 *   tiktok: `/video/{digits}` — 단축주소(vm.tiktok.com/xxxx)는 풀어 보지 않으면 id 를 모른다 → 비워 둔다.
 */
export function channelRefFromUrl(channel: string, u: URL): string | undefined {
  const seg = u.pathname.split("/").filter(Boolean);
  const at = (i: number) => (i >= 0 && i < seg.length ? seg[i] : "");
  if (channel === "youtube_shorts") {
    const host = u.hostname.toLowerCase();
    const cand = host === "youtu.be" || host.endsWith(".youtu.be")
      ? at(0)
      : (seg[0] === "shorts" || seg[0] === "embed" || seg[0] === "live" ? at(1) : String(u.searchParams.get("v") ?? ""));
    return YT_ID.test(cand) ? cand : undefined;
  }
  if (channel === "instagram" || channel === "reels") {
    const i = seg.findIndex((s) => s === "reel" || s === "reels" || s === "p" || s === "tv");
    const cand = at(i + 1);
    return i >= 0 && CODE.test(cand) ? cand : undefined;
  }
  if (channel === "threads") {
    const i = seg.findIndex((s) => s === "post" || s === "t");
    const cand = at(i + 1);
    return i >= 0 && CODE.test(cand) ? cand : undefined;
  }
  if (channel === "tiktok") {
    const i = seg.findIndex((s) => s === "video");
    const cand = at(i + 1);
    return i >= 0 && DIGITS.test(cand) ? cand : undefined;
  }
  return undefined;
}

/**
 * 사람이 붙여 넣은 주소를 검사한다. 통과하면 **정리된 주소**(꼬리표·해시 제거)와 `channelRef` 를 돌려준다.
 *   거부 사유는 화면이 그대로 띄울 수 있는 한 문장이다(계약 §1.3 `step:"url"`).
 */
export function checkPublishedUrl(channel: string, raw: unknown): UrlCheck {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: false, reason: "parse", error: "올린 글의 주소를 넣어 주세요." };
  if (s.length > 500) return { ok: false, reason: "too_long", error: "주소가 너무 길어요. 글 주소만 넣어 주세요." };
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, reason: "parse", error: "주소 모양이 아니에요. 브라우저 주소창의 주소를 그대로 붙여 넣어 주세요." }; }
  // http 는 받지 않는다 — 발행 주소는 공개 링크라 그대로 알림·내보내기·수익표에 실린다.
  if (u.protocol !== "https:") return { ok: false, reason: "scheme", error: "https 로 시작하는 주소만 넣을 수 있어요." };

  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const mine = CHANNEL_HOSTS[channel];
  const fits = mine ? hostMatches(host, mine) : false;
  if (!fits) {
    const others = channelsOfHost(host).filter((c) => c !== channel);
    if (others.length) {
      return { ok: false, reason: "other_channel", error: `${channelLabelKo(others[0])} 주소예요. 이 글은 ${channelLabelKo(channel)}에 올린 주소가 필요해요.` };
    }
    if (!CUSTOM_DOMAIN_CHANNELS.has(channel)) {
      const sample = (mine && mine[0]) || "";
      return { ok: false, reason: "domain", error: `${channelLabelKo(channel)} 주소가 아니에요${sample ? `(${sample})` : ""}. 올린 글의 주소를 다시 확인해 주세요.` };
    }
    // 제 도메인 채널 — 모르는 도메인은 통과(자체호스팅). 다른 채널 도메인이었다면 위에서 이미 막혔다.
  }

  // 정리: 해시 제거 · 추적 꼬리표 제거. 나머지 쿼리는 남긴다(`watch?v=` 처럼 글을 가리키는 값이 쿼리에 있는 채널이 있다).
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
  const out = u.toString();
  /* 🔴 자르지 않고 **거부**한다. `finalizePublish` 는 external_url 을 300자로 자르는데(finalize.ts:30),
     잘린 주소는 알림함·내보내기·수익표에 그대로 실려 **눌러도 안 열리는 링크**가 된다. 조용히 망가뜨리느니 한 번 물어본다. */
  if (out.length > 300) return { ok: false, reason: "too_long", error: "주소가 너무 길어요(300자까지). 공유 버튼으로 나오는 짧은 주소를 넣어 주세요." };

  const ref = channelRefFromUrl(channel, u);
  return { ok: true, url: out, host, ...(ref ? { channelRef: ref } : {}) };
}
