/**
 * lib/manual-upload.ts — «우리가 못 올리는 채널»을 **사람 손으로 넘기는 길**(R8 §3.2 · DESIGN §1031 «앱에서 올리기» 폴백).
 *   🔎 출처: AC 신규(계약 P1R8-B2 §3.2 · 생성 커밋 `b9f8927` 2026-09-15) — AM 원본 없음(`../AutoMarketing/lib/` 에 같은 이름 없음 · 2026-09-16 확인).
 *
 *   🔴 지금 무슨 일이 일어나나: 네이버 클립은 공개 업로드 API 가 없고 모바일 앱 전용이라, 러너가 `not_supported_yet` 으로
 *      정직하게 멈추고 글은 `awaiting_manual` 이 되고 «클립은 앱에서 올려 주세요» 알림이 뜬다. **거기까지는 정직하다.**
 *      그런데 그 다음이 없었다 — 고객은 «올려 주세요»만 듣고 **어떻게 폰으로 가져가는지**를 모른다.
 *      영상 파일은 PC 에서 받는 `/api/piece-video`(10분 presigned)에만 있었다.
 *
 *   🔴 **URL 스킴을 지어내지 않는다.** «딥링크»라고 하면 보통 `naverclip://…` 같은 앱 전용 주소를 떠올리는데,
 *      네이버가 그런 스킴을 공개했는지 **확인하지 못했다**. 확인 못 한 주소를 넣으면 고객 폰에서 «열 수 없는 링크»가 뜨고,
 *      그건 «되는 척»이다. 그래서 **우리가 실제로 확인한 주소만** 쓴다:
 *        · `https://clip.naver.com/` — 2026-09-14 실측으로 존재를 확인했다(미가입이면 `/signup` 으로 보낸다).
 *          폰에서 열면 네이버 앱이 설치돼 있을 때 앱으로 넘어갈 수 있다(유니버설 링크 동작 · ⚠️ **우리가 폰에서 재 보진 않았다**).
 *      ⇒ 문구도 «앱으로 바로 열려요»가 아니라 «클립 열기»다. 확인한 만큼만 말한다.
 *
 *   🔴 **핵심은 링크가 아니라 «폰으로 넘어가는 것»이다.** PC 에서 아무리 링크를 눌러도 영상은 PC 에 있다.
 *      그래서 이 길의 실제 모양은: **폰에서 우리 앱을 열고**(푸시 알림을 탭하면 그 글 화면으로 간다) →
 *      거기서 영상을 받고 → 네이버 앱으로 올린다. 그 세 걸음을 `steps` 로 적어 화면이 그대로 보여 준다.
 */

/** 🔴 영상 채널 **전부**다(`lib/video/types.ts VIDEO_CHANNELS` 와 같은 넷). 한 채널만 적어 두면
 *  «계정 없이 만든 영상»(§1.2)이 기본으로 가는 `youtube_shorts` 가 **안내 없이** 떨어진다 — 실제로 그랬다. */
export type ManualChannel = "naver_clip" | "youtube_shorts" | "reels" | "threads";

export interface ManualHandoff {
  channel: ManualChannel;
  /** 사람이 읽는 채널 이름. */
  label: string;
  /** 열어 볼 주소 — 🔴 **확인한 것만**. 확인 못 한 앱 스킴은 넣지 않는다. */
  openUrl: string;
  openLabel: string;
  /** ⚠️ 이 주소가 «앱으로 바로 열린다»를 우리가 재 봤나. false 면 화면도 그렇게 말하면 안 된다. */
  appOpenVerified: boolean;
  /** 화면이 그대로 보여 줄 세 걸음(«어떻게»를 고객이 추측하지 않게). */
  steps: string[];
  /** 왜 자동이 안 되나 — 한 문장(«우리가 게으른 게 아니다»를 정직하게). */
  why: string;
  /**
   * 🔴 **언제나 사람 손인 채널인가.**
   *   `true`(클립) = 계정이 있든 없든 우리가 못 올린다 — 늘 이 길이다.
   *   `false`(유튜브·릴스·스레드) = 우리가 올릴 수 있는 길이 **있다**. 그래서 이 안내는
   *   **올릴 계정이 없을 때만** 띄운다 — 계정이 멀쩡히 붙어 있는데 «직접 올려 주세요»를 띄우면
   *   그건 도움이 아니라 **거짓 안내**다(§9 «또렷하게»는 «아무 때나 크게»가 아니다).
   */
  alwaysManual: boolean;
}

const HANDOFF: Readonly<Record<ManualChannel, ManualHandoff>> = Object.freeze({
  naver_clip: {
    channel: "naver_clip",
    label: "네이버 클립",
    openUrl: "https://clip.naver.com/",
    openLabel: "네이버 클립 열기",
    appOpenVerified: false,          // ⚠️ 폰에서 앱으로 넘어가는지 우리가 재 보지 않았다
    steps: [
      "휴대폰에서 이 화면을 열어 주세요(알림을 누르면 바로 옵니다).",
      "«영상 받기»를 눌러 휴대폰에 저장해 주세요.",
      "네이버 앱에서 클립으로 올린 다음, 올린 주소를 여기에 붙여 넣어 주세요.",
    ],
    why: "네이버 클립은 휴대폰 앱에서만 올릴 수 있어요(공개된 업로드 방법이 없어요).",
    alwaysManual: true,
  },
  /* 🔴 [2026-09-21 B] 아래 셋은 **«계정 없이 영상 만들기»(R7 §1.2)가 떨어지는 자리**다.
     그 길로 만든 영상은 `account_id` 가 없어 발행에서 `no_account` → `awaiting_manual` 로 간다.
     거기까지는 이미 정직했는데(«앱에서 직접 올려 주세요») **어떻게 올리는지가 없었다** — 클립만 적혀 있었다.
     ⚠️ 주소는 **전부 2026-09-21 에 실제로 눌러 200 을 확인한 것**이다(지어낸 앱 스킴 0 · 이 파일 머리말 규율).
        폰에서 앱으로 넘어가는지는 **재 보지 않았다** ⇒ `appOpenVerified: false` 로 두고 화면도 그렇게 말하면 안 된다. */
  youtube_shorts: {
    channel: "youtube_shorts",
    label: "유튜브 쇼츠",
    openUrl: "https://www.youtube.com/upload",   // 2026-09-21 200 확인
    openLabel: "유튜브 올리기 열기",
    appOpenVerified: false,
    steps: [
      "휴대폰에서 이 화면을 열어 주세요(알림을 누르면 바로 옵니다).",
      "«영상 받기»를 눌러 휴대폰에 저장해 주세요.",
      "유튜브 앱에서 쇼츠로 올린 다음, 올린 주소를 여기에 붙여 넣어 주세요.",
    ],
    why: "아직 유튜브 계정을 연결하지 않으셨어요. 연결하면 저희가 대신 올려 드려요.",
    alwaysManual: false,
  },
  reels: {
    channel: "reels",
    label: "인스타그램 릴스",
    openUrl: "https://www.instagram.com/",       // 2026-09-21 200 확인
    openLabel: "인스타그램 열기",
    appOpenVerified: false,
    steps: [
      "휴대폰에서 이 화면을 열어 주세요(알림을 누르면 바로 옵니다).",
      "«영상 받기»를 눌러 휴대폰에 저장해 주세요.",
      "인스타그램 앱에서 릴스로 올린 다음, 올린 주소를 여기에 붙여 넣어 주세요.",
    ],
    why: "아직 인스타그램 계정을 연결하지 않으셨어요. 연결하면 저희가 대신 올려 드려요.",
    alwaysManual: false,
  },
  threads: {
    channel: "threads",
    label: "스레드",
    openUrl: "https://www.threads.com/",         // 2026-09-21 200 확인
    openLabel: "스레드 열기",
    appOpenVerified: false,
    steps: [
      "휴대폰에서 이 화면을 열어 주세요(알림을 누르면 바로 옵니다).",
      "«영상 받기»를 눌러 휴대폰에 저장해 주세요.",
      "스레드 앱에서 올린 다음, 올린 주소를 여기에 붙여 넣어 주세요.",
    ],
    why: "아직 스레드 계정을 연결하지 않으셨어요. 연결하면 저희가 대신 올려 드려요.",
    alwaysManual: false,
  },
});

/**
 * 이 영상을 «사람 손으로 올려야 하나» — 그렇다면 그 길을, 아니면 `null`.
 *
 *   🔴 **채널만으로 정하지 않는다.** 클립은 늘 사람 손이지만(`alwaysManual`), 유튜브·릴스·스레드는
 *      **계정이 붙어 있으면 우리가 올린다.** 계정이 있는데도 «직접 올려 주세요»를 띄우면 거짓 안내가 된다.
 *      그래서 `noAccount` 를 받는다 — 부르는 쪽이 그 piece 의 `account_id` 를 보고 넘긴다.
 *   ⚠️ 옛 호출처(인자 하나)는 **클립만 받던 그대로** 돈다(소급 0).
 */
export function manualHandoffFor(channel: unknown, opts: { noAccount?: boolean } = {}): ManualHandoff | null {
  const h = HANDOFF[String(channel ?? "") as ManualChannel];
  if (!h) return null;
  return h.alwaysManual || opts.noAccount === true ? h : null;
}

/** 이 채널을 우리가 **영영 못 올리나**(계정이 있어도). 화면이 «연결하면 대신 올려 드려요»를 말할지 가른다. */
export function isAlwaysManualChannel(channel: unknown): boolean {
  return HANDOFF[String(channel ?? "") as ManualChannel]?.alwaysManual === true;
}

/** 그 글 화면으로 가는 링크 — 알림이 **목록이 아니라 그 글**로 보내야 폰에서 한 번에 닿는다. */
export function pieceLink(pieceId: number | null | undefined): string {
  const id = Math.floor(Number(pieceId ?? 0)) || 0;
  return id ? `/app/piece.html?id=${id}` : "/app/pieces.html";
}
