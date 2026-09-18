/**
 * lib/video/types.ts — 영상 축 어휘·페이로드 정본(계약 P1R5 §0.2 · §1.1 · §2.1 · §5 — 글자 그대로). 순수(임포트 0).
 *   B(생성 두뇌)·B2(러너·출구)·A(화면 mock)가 같은 파일을 본다. 어휘를 늘리면 칸 폭(AC-21/30)을 같이 잰다:
 *   VideoStage ≤ 8자 · format ≤ 8자 · pieces.format varchar(24) · piece_assets.kind varchar(12).
 *   🔎 출처: AC 신규(계약 P1R5-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
export type VideoFormat = "graphic" | "talking" | "clip";
/* [R12-7 · 2026-09-17] 🔴 **릴스 90초**(감사 A12). 여는 것은 이 한 줄이지만 **같이 움직여야 하는 것이 셋** 더 있다 —
   채널 상한(`lib/writing-contracts.ts VIDEO_CHANNEL_MAX_SEC.reels`) · 코인 값(`lib/coin-table.ts video_90`) · 심사 축(`lib/video/judge.ts duration_fit`).
   🔴 따로 가면 «90초인데 값은 60초»가 되고, 그건 **우리가 손해 보는 쪽**이라 고객이 알려 주지 않아 더 늦게 들킨다. */
export type VideoSeconds = 15 | 30 | 60 | 90;
export type VideoChannel = "youtube_shorts" | "naver_clip" | "reels" | "threads";
export type ProviderKey = "omni" | "veo_lite" | "veo_fast" | "veo" | "wan" | "hailuo" | "kling";
export type ClipTier = "filler" | "standard" | "money";
export type VideoStage = "script" | "tts" | "clips" | "render" | "judging" | "done" | "failed";
export type JudgeGrade = "P0" | "P1" | "P2";
export type TtsProvider = "typecast" | "gemini";

export const VIDEO_CHANNELS: ReadonlySet<string> = new Set<VideoChannel>(["youtube_shorts", "naver_clip", "reels", "threads"]);

/**
 * 🔴 **채널별 안전영역**(R8-A §3 · 2026-09-15). 1080×1920 기준으로 **플랫폼 UI 가 화면을 가리는 띠의 두께**다 —
 *   `top`·`bottom` 만큼은 글자를 두면 안 된다. 좌우는 `side`.
 *
 *   🔴 종전엔 이 값이 **한 벌(220/300)로 전 채널 공용**이었고, 게다가 `RenderPayload` 에 **리터럴 타입**으로 박혀 있어
 *      («safeZone: { top: 220; bottom: 300 }») 채널별로 다르게 두는 것이 **타입 차원에서 불가능**했다.
 *      그 한 벌의 아래(300)가 **쇼츠·릴스·틱톡 셋 다 미달**이라, 자막 마지막 줄이 채널명·설명 UI 에 먹히고 있었다
 *      (쇼츠 기준 90px 침범 · 자막 한 줄 높이가 97.5px 이니 사실상 한 줄이 통째로 가려진다).
 *
 *   ⚠️ **네이버 클립은 공개 수치를 못 찾았다**(공식 크리에이터 문서 접근 불가 · 우리 계정도 아직 미가입).
 *      그래서 «모르면 안전한 쪽»으로 **가장 보수적인 값**(릴스와 같게)을 쓴다 — 가입해서 실측하면 좁힌다.
 *   ⚠️ `threads` 는 영상 채널 목록에 있지만 세로 숏폼 UI 가 릴스와 같은 계열이라 릴스 값을 따른다(**추정**).
 */
export const SAFE_ZONE_OF: Readonly<Record<VideoChannel, { top: number; bottom: number; side: number }>> = Object.freeze({
  youtube_shorts: { top: 180, bottom: 390, side: 60 },   // 공개 가이드(안전영역 900×1350)
  reels:          { top: 220, bottom: 450, side: 60 },   // 공개 가이드(안전영역 1010×1280 · 아래 420~450 중 넓은 쪽)
  naver_clip:     { top: 220, bottom: 450, side: 60 },   // ⚠️ 추정 — 공개 수치 없음 · 가장 보수적인 값
  threads:        { top: 220, bottom: 450, side: 60 },   // ⚠️ 추정
});
/** 채널을 모를 때(옛 piece·수동 호출) — 가장 보수적인 값. «모르면 안전한 쪽»(AC-9). */
export const SAFE_ZONE_FALLBACK: { top: number; bottom: number; side: number } = { top: 220, bottom: 450, side: 60 };
export function safeZoneOf(channel: unknown): { top: number; bottom: number; side: number } {
  return SAFE_ZONE_OF[String(channel) as VideoChannel] ?? SAFE_ZONE_FALLBACK;
}
export const VIDEO_FORMATS: readonly VideoFormat[] = ["graphic", "talking", "clip"];
export const VIDEO_SECONDS: readonly VideoSeconds[] = [15, 30, 60, 90];
export const VIDEO_STAGES: readonly VideoStage[] = ["script", "tts", "clips", "render", "judging", "done", "failed"];
export function isVideoChannel(v: unknown): v is VideoChannel { return VIDEO_CHANNELS.has(String(v)); }
export function isVideoFormat(v: unknown): v is VideoFormat { return VIDEO_FORMATS.includes(String(v) as VideoFormat); }
export function isVideoSeconds(v: unknown): v is VideoSeconds { return VIDEO_SECONDS.includes(Number(v) as VideoSeconds); }

/** PieceSpec.video(계약 §1.1) — 디렉터가 정하고 confirm 이 pieces.meta.video 로 굳힌다. */
export interface VideoSpec {
  format: VideoFormat;
  seconds: VideoSeconds;
  provider: { tier: ClipTier; key: ProviderKey };
  voice: { provider: TtsProvider; voiceId: string };
  /** 다계정 변주 — 같은 brief 의 영상 piece 끼리 서로 다르다(결정론). */
  variant: { hookType: string; palette: string; voiceId: string };
  cuts: number;
  disclosure: { badge: boolean; descriptionFirstLine: boolean };
  /** [P1R6 §2.3] 사용자가 고른 길이에서 **자동으로 내려간** 경우의 원래 값(채널 상한 ∩ 포맷 상한).
   *  화면이 «30초로 맞췄어요» 를 말하는 근거 — 없으면 조용히 바뀐 것이 없다는 뜻이다(조용한 하향 금지). */
  clampedFrom?: VideoSeconds;
}

/** 대본 한 줄(script 단계 산출 · pieces.blocks 재료 · 컷 경계 = 문장 경계). */
export interface ScriptLine {
  idx: number;
  text: string;
  /** hook | body | bridge | landing | closing — 훅·본문·전환·착지·마무리(AM shorts-script role 어휘). */
  role: "hook" | "body" | "bridge" | "landing" | "closing";
  /** 이 줄이 차지할 초(발화 예산에서 역산 · 컷 창 계획의 재료). */
  seconds: number;
  cutIdx: number;
}
export interface VideoScript {
  lines: ScriptLine[];
  hook: string;
  closing: string;
  youtube: { title: string; description: string; tags: string[] };
  /** 팩트체크 스탬프(있을 때만 — 사실 주장이 없는 대본은 키 없음). */
  factcheck?: { status: "verified" | "corrected" | "unverified" | "skipped"; claims: { claim: string; verdict: "ok" | "wrong" | "unknown"; note?: string }[] };
}

/** 컷 계획(scenes 단계). */
export interface CutPlan {
  idx: number;
  startMs: number;
  endMs: number;
  lineIdx: number[];
  /** 컷 프롬프트(SUBJECT/STYLE/COLOR/BEAT 계약 산출). */
  prompt: string;
  keyword: string;
  /** provider 티어(15초 = veo_lite 강제). */
  tier: ClipTier;
  /** t2v(그래픽) | i2v(정지 이미지 애니메이션) | still(정지 이미지 Ken Burns · 토킹 포맷의 대체). */
  mode: "t2v" | "i2v" | "still";
}

/* ───────── 러너 렌더 페이로드(계약 §2.1 글자 그대로) ───────── */
export interface RenderScene { idx: number; startMs: number; endMs: number; clipKey?: string; imageKey?: string; motion?: "kenburns" | "none"; captionIdx: number[] }
export interface RenderPhrase { idx: number; text: string; startMs: number; endMs: number; keyword?: string }
export interface RenderPayload {
  pieceId: number;
  tenantId: number;
  out: { w: 1080; h: 1920; fps: 30; maxSeconds: VideoSeconds; crf: 20 };
  scenes: RenderScene[];
  captions: {
    preset: "keyword_center" | "talking_big" | "clip_top";
    phrases: RenderPhrase[];
    srtKey: string;
    /**
     * [R10-6] 자막 모양 — 🔴 **안 주면 렌더가 종전 상수 그대로** 그린다(무회귀).
     *   2026-09-16 에 `render-video.mjs buildOverlayHtml` 의 상수를 이 칸으로 열었다. 레퍼런스가 배워 온 값이
     *   `lib/video/reference-apply.ts applied.captionType` 을 거쳐 여기로 온다.
     *   🔴 **크기(`size`)는 일부러 안 받는다** — 자막 크기는 프리셋이 정하고 그건 **고객이 고르는 값**이다.
     *      레퍼런스가 덮으면 화면 칩이 말하는 것과 영상이 달라진다(AC-52).
     *   🔴 `maxCharsPerLine` 에 **기본값이 없다** — 지어내면 심사(`judge.ts` 2줄)와 숫자가 두 벌이 된다(AC-92).
     */
    type?: {
      weight?: number; size?: number; lineHeight?: number;
      color?: string; accentColor?: string; shadow?: string;
      strokeWidth?: number; strokeColor?: string;
      position?: "top" | "middle" | "bottom"; side?: number;
      maxCharsPerLine?: number;
      /**
       * [R12-1] 🔴 **자막 등장 방식** — `none`(기본 · 지금 그대로) · `fade` · `slide_up` · `pop`.
       *   구절당 PNG 는 **여전히 한 장**이다 — ffmpeg 이 그 한 장의 **자리·투명도·크기를 시간에 따라** 바꾼다.
       *   프레임마다 글자를 다시 그리면 **원가가 프레임 수만큼 곱해진다**(그래서 여러 장을 안 찍는다).
       *   🔴 **길이는 payload 에 없다** — 120~200ms 안에서 러너가 정한다(길면 읽을 시간을 먹는다 · `judge.ts reading_time`).
       *   🔴 **나가는 모션은 없다** — 다음 자막과 겹치면 두 줄이 동시에 보이고 심사의 «자막 2줄»과 싸운다.
       *   🔴 **고지 자막·엔드카드에는 안 걸린다**(러너 `motionForLayer`) — 법이 읽는 문장을 우리가 꾸미지 않는다.
       */
      motion?: "none" | "fade" | "slide_up" | "pop";
    };
  };
  audio: { narration: { key: string; startMs: number }[]; bgm: { key: string; gainDb: -18 } | null; sfx: [] | null; loudnorm: { I: -16; TP: -1.5; LRA: 11 } };
  /* 🔴 `safeZone` 은 **채널마다 다르다**(`SAFE_ZONE_OF`) — 종전의 리터럴 타입 `{top:220;bottom:300}` 을 열었다.
     리터럴이면 «고치는 것» 자체가 타입 오류라, 틀린 값이 고쳐질 수 없는 상태였다. */
  overlay: { badge: { text: string; corner: "tr" } | null; safeZone: { top: number; bottom: number; side?: number }; endcard: { text: string; url?: string } | null };
  /**
   * [R12-2] 🔴 **컷 전환** — `none`(기본 · 딱딱 끊김 = 지금 그대로) · `fade` · `slide`.
   *   🔴 **전환은 컷 «사이»가 아니라 컷 «안»에서 빌린다**: 각 컷을 전환 길이만큼 늘려서 겹친다 ⇒ **전체 길이 불변**.
   *      길이가 밀리면 코인이 틀어진다(길이 구간제) — 0.3초 × 12컷 = 3.6초가 사라지는 것을 막는 것이 이 규칙이다.
   *   🔴 **나레이션·자막 시각은 안 건드린다** — 전환은 **그림에만** 건다.
   *   🔴 **길이 칸이 없다**(러너 상수 0.3초 · 상한 0.4초) · 컷이 0.8초보다 짧으면 그 경계는 **건너뛴다**.
   *   ⚠️ `xfade` 는 ffmpeg **4.3 이상**이다 — 러너가 `-filters` 로 **실제로 있는지 재고**, 없으면 `none` 으로 내려앉히고
   *      «이 컴퓨터의 ffmpeg 가 낮아서 전환 없이 만들었어요»를 `notes` 에 적는다. **막지 않는다** — 영상은 나간다(CLAUDE §9).
   */
  transition?: "none" | "fade" | "slide";
  /** 어느 채널로 나가는가 — 안전영역 판정이 이걸로 갈린다(없으면 가장 보수적인 값). */
  channel?: VideoChannel;
  disclosureCaption: { text: string; untilMs: 3000 } | null;
  /** B2 가 claim 시 채운다(presigned PUT) — B 는 비워 둔다. */
  upload?: { putUrl: string; key: string; posterPutUrl: string; posterKey: string };
}
/** 러너 report(계약 §2.1) — B2 가 R2 HEAD 로 실존 확인한 뒤 finalizeRender 에 넘기는 모양. */
/**
 * 러너가 굽고 나서 돌려주는 것. 🔴 `measured:true` 일 때만 길이·프레임이 **잰 값**이다(ffprobe).
 *   2026-09-14 C 수리(AC-31 의 짝): 종전 `durationMs`·`frameCount` 는 인코딩에 넘긴 `-t` 값과 그 산수였다 —
 *   계획끼리 일관된 숫자라 심사가 «산출물이 계획과 다르다»를 영영 볼 수 없었다(13초 정지 화면 꼬리가 통과한 이유).
 *   옛 러너는 새 필드를 안 보낸다 → 심사는 **판정 보류**(통과도 실패도 아님 · AC-9).
 */
export interface RenderReport {
  key: string; posterKey: string; durationMs: number; bytes: number; frameCount: number; ffmpegVersion?: string;
  /** ffprobe 실측 — 컨테이너 전체 길이(ms). 영상보다 길면 «정지 화면 + 음악» 꼬리다. */
  containerMs?: number;
  /** ffprobe 실측 — 영상 트랙 길이(ms). */
  videoMs?: number;
  /** ffprobe 실측 — 오디오 트랙 길이(ms) · 0 = 무음(트랙 없음). */
  audioMs?: number;
  /** 러너가 인코딩에 넘긴 계획 길이(ms) — 실측과 견주는 참고값(판정 근거로 쓰지 않는다). */
  plannedMs?: number;
  /** true 면 위 세 값과 frameCount 가 ffprobe 실측이다. 없으면 계획값(판정 보류). */
  measured?: boolean;
  /**
   * [R7 §1.5] 대표 프레임 지문 재료 — 포스터를 **32×32 그레이 raw(1024B)** 로 줄인 것의 base64.
   *   러너가 ffmpeg 한 줄로 만든다(새 의존성 0):
   *     `ffmpeg -y -i poster.jpg -vf scale=32:32,format=gray -f rawvideo -pix_fmt gray thumb.raw`  → readFileSync(...).toString("base64")
   *   서버가 이걸 받아 `phashFromGray32` 로 64bit pHash 를 만들고 **다른 계정의 최근 14일 영상**과 해밍 거리를 잰다(§1.9 · §6.2).
   *   🔴 못 만들면 **키를 아예 보내지 않는다**. 빈 문자열·0 으로 채우면 심사가 «못 쟀다»와 «닮지 않았다»를 구분하지 못한다(AC-33·AC-9).
   */
  thumbGray?: string;
  /** [R7 §1.5] 러너가 직접 pHash 를 계산했으면 hex 16자. `thumbGray` 가 있으면 서버가 다시 계산하니 **둘 중 하나만** 있으면 된다. */
  framePhash?: string;
  /**
   * [R12 마감 · 2026-09-17 · B↔B2] 🔴 **오버레이(자막·배지·고지·엔드카드)가 첫 프레임 말고도 실제로 실렸나** — 러너가 **산출물에서** 확인한 값.
   *
   *   왜 생겼나: B2·C 가 ffmpeg 8.1.2 로 실측했다 — 오버레이 필터가 `eof_action=pass` 라 **단일 프레임 PNG 가 t=0 에 EOF** 이고,
   *   그 뒤로는 본편이 그대로 통과한다. 즉 **자막·제휴 고지·배지·엔드카드가 첫 프레임에만 있었다**(`pass` @1.5s (0,0,0) ↔ `repeat` @1.5s (252,0,0)).
   *
   *   🔴 **그런데 심사(`judge.ts disclosure`)는 이걸 원리상 못 잡는다** — 그 축은 `p.overlay.badge.text`·`p.disclosureCaption.text`,
   *      즉 **계획서**를 본다(AC-33 «산출물이 아니라 계획서를 보고 도장»). 그래서 **고지가 통째로 안 실린 영상에 «고지 ✅»가 찍히고 있었다.**
   *      = 법으로 정해진 대가 표시가 **없는 채로 초록**이었다. 이 라운드에서 찾은 것 중 제일 큰 거짓 초록이다.
   *
   *   🔴 `true` = 러너가 **재서** 확인했다 · `undefined` = **못 쟀다**(«괜찮다»가 아니다 → 심사가 `pending` 으로 내린다 · AC-9).
   *      `false` 를 보내면 그건 «재 봤고 안 실렸다»라 심사가 **떨어뜨린다**(pending 이 아니다).
   *
   *   ══ 러너가 채우는 법 (B2 실측 2026-09-17 · ffmpeg 8.1.2 · 새 의존성 0) ══
   *     🔴 **그 층을 빼지 말고 «창만» 출력 밖으로 밀어** 같은 그래프를 두 번 지나가, 창 안쪽 시각의 **날 프레임**을 견준다.
   *        바이트가 같으면 «안 그려졌다»(`false`), 다르면 `true`.
   *     ⚠️ 🔴 **층을 통째로 빼는 방법은 틀린다.** ← **내가 처음 이 주석에 적어 준 방법이 그것이었고, B2 가 실물로 구워서 잡았다.**
   *        실측: 빼면 `overlay` 필터가 사라지고 **아무것도 안 그려도 바이트가 달라졌다**
   *        ⇒ «달라졌으니 그려졌다»가 늘 참이 되어 **옛 `eof_action=pass` 판을 못 잡았다.**
   *        🔴 여기서 **잰 것과 짐작한 것을 가른다**(B2 요청 — 안 그러면 다음 사람이 짐작을 실측으로 믿는다 · 이번 라운드 내내 고친 그 병이다):
   *          · **관찰한 사실** = «층을 빼면 아무것도 안 그려도 바이트가 달라졌다» — 이것만 실제로 쟀다.
   *          · **해석(B2 추정 · 분리해서 재지 않았다)** = 필터가 한 단 줄면서 픽셀 처리(색공간 왕복)가 달라진 것으로 읽는다.
   *     🔴 **x264 를 태우지 않는다**(`-f rawvideo -pix_fmt rgb24`) — `-t` 가 다른 두 판은 **율 제어부터 갈려** 오버레이와 무관하게 달라진다.
   *     🔴 창 **한참 안쪽**에서 잰다 — `fade` 는 시작 순간 투명도가 0 이라 그 자리에서 재면 «없다»가 나온다(맞는 말이지만 묻는 것이 아니다).
   *     확인 순서는 **법이 읽는 것부터**: 고지 → 배지 → 구절. 층이 하나도 없으면 **키를 아예 안 보낸다**(«확인할 게 없다»와 «못 쟀다»는 다르다).
   */
  overlayVerified?: boolean;
}

/* ───────── 심사(계약 §5 judgeVideo) ───────── */
export interface JudgeAxis {
  key: string; label: string; pass: boolean; grade: JudgeGrade; detail?: string;
  /**
   * [R7 §1.5] **판정 보류** — 통과도 실패도 아니다(AC-33 · AC-9).
   *   `pass:true` 라 막지는 않지만 «쟀고 괜찮았다»는 뜻이 **아니다**: 잴 재료가 안 와서 판정을 못 한 것이다.
   *   화면은 이 축을 ✅ 로 그리면 안 된다 — «아직 못 쟀어요»로 그린다. 없으면(undefined) 실제로 잰 결과다.
   */
  pending?: boolean;
}
export interface JudgeResult { grade: JudgeGrade; pass: boolean; axes: JudgeAxis[]; repaired: boolean }

/* ───────── chainStage(계약 §1.4) ───────── */
export interface ChainStage { stage: VideoStage; at: string; cutsDone?: number; cutsTotal?: number }
export interface ChainLock { at: string; by: string }
export interface ChainResume { count: number; at?: string }

/** 컷 예산(계약 §1.4-3) — 15분 수명 − 합성·업로드 여유 4분. 상수 1곳.
 *   env `CHAIN_BUDGET_MS` 는 **로컬 전용 손잡이**(C 하니스 이어달리기 재현 · 크론 CRON_BUDGET_MS 관례) — 프로덕션에 설정하지 않는다. */
export const CHAIN_BUDGET_MS = (() => { const v = Number(process.env.CHAIN_BUDGET_MS); return Number.isFinite(v) && v >= 10_000 ? Math.floor(v) : 11 * 60_000; })();
/** `VIDEO_PROVIDER_STUB=1` — **비싼 매체**(provider 컷·스틸 · TTS · 심사 비전)를 고정 응답으로 대체(로컬 하니스 전용 · ai_usage 는 model «stub» 로 기록 · 원가 0). 실호출은 이 변수가 없을 때만. */
export function videoStub(): boolean { return String(process.env.VIDEO_PROVIDER_STUB ?? "").trim() === "1"; }

/* ═══════════ [AC-111] 🔴 «비싼 것을 끄는 손잡이»가 «싼 것까지» 끄던 자리 ═══════════
 *   2026-09-19 C 가 전 구간 리허설에서 잡았다. `VIDEO_PROVIDER_STUB` 은 이름도 문서도 **건당 수 달러짜리 매체**(Veo·TTS·비전)를
 *   끄는 손잡이인데, `script.ts` 가 그 하나로 **대본까지**(실측 $0.033 — 글 한 번 부르는 값) 통째로 템플릿으로 갈아치웠다.
 *   ⇒ «Veo 가 비싸니 꺼 두자»로 켠 하니스가 **대본 축이 통째로 가짜인 줄 모른 채 초록**을 냈다.
 *
 *   🔴 처방 ㉯ — **축마다 손잡이.** 다만 **기존 하니스의 돈이 새면 안 된다**:
 *      지금 `VIDEO_PROVIDER_STUB=1` 하나만 켜고 도는 자들(`verify-p1r5` 등)이 여럿인데, 여기서 대본을 덜컥 실호출로 돌리면
 *      **그 자들이 전부 돈을 쓰기 시작한다.** 그래서 새 손잡이는 «따라가되, 말하면 듣는다»로 만든다:
 *        · `VIDEO_SCRIPT_STUB` 안 줌  → `VIDEO_PROVIDER_STUB` 을 **그대로 따라간다**(옛 자들 무회귀 · 돈 0)
 *        · `VIDEO_SCRIPT_STUB=0`      → 🔴 **대본만 진짜로**(Veo 컷은 계속 꺼 둔다) — AC-111 ④ 가 «없다»고 한 바로 그 손잡이
 *        · `VIDEO_SCRIPT_STUB=1`      → 대본만 스텁(provider 는 진짜로)
 */
export function videoScriptStub(): boolean {
  const raw = String(process.env.VIDEO_SCRIPT_STUB ?? "").trim();
  if (raw === "1") return true;
  if (raw === "0") return false;
  return videoStub();
}
/** 지금 그 축을 끈 손잡이의 이름 — 로그가 «어느 손잡이가 받아 버렸는지»를 말해야 한다(AC-111 ③ «한 손잡이만 열면 다른 손잡이가 말없이 받는다»). */
export function scriptStubHandle(): string {
  const raw = String(process.env.VIDEO_SCRIPT_STUB ?? "").trim();
  return raw === "1" ? "VIDEO_SCRIPT_STUB=1" : "VIDEO_PROVIDER_STUB=1(VIDEO_SCRIPT_STUB 미지정 — 따라감)";
}

/**
 * noteVideoStub — 🔴 **처방 ㉮ «스텁 경로는 «내가 스텁이다»를 반드시 찍어라».**
 *   값으로만 말하면(`model:"stub"`) 그 값을 아무도 안 읽을 때 **«스텁이었다»는 사실이 세상 어디에도 안 남는다.**
 *   🔴 **처방 ㉰ — «무엇을 못 재게 되는지»를 같이 적는다.** 안 적으면 그 축은 영원히 «초록»으로 «안 쟀다»고 말한다(AC-9 자동화판).
 *   글 쪽 `[ai-stub]`(lib/ai.ts)과 **같은 모양**으로 찍는다 — 로그를 읽는 사람이 두 벌을 외우지 않게.
 */
export function noteVideoStub(axis: string, blind: string, handle: string, howToOpen: string): void {
  console.info(`[video-stub] ${axis} — 고정 응답(실호출 0 · 원가 0) · 손잡이 ${handle}. 🔴 못 재는 것: ${blind}. 진짜로 보려면 ${howToOpen}.`);
}
/** 스위퍼 stale 판정(계약 §1.5) · 잠금 만료(§1.4 멱등). */
export const CHAIN_STALE_MIN = 20;
export const CHAIN_LOCK_MIN = 20;
/** 이어달리기 상한(§1.4-3). */
export const CHAIN_RESUME_MAX = 3;
/** 심사 미달 재큐 상한(§0.1-7 · AM RENDER_MAX_RETRY). 3회째 = in_review(사람). */
export const RENDER_MAX_RETRY = 2;

/* ═══════════ 변주 사람말 이름(계약 §13.0 «말은 사람말» · A 가 칩에 쓴다) ═══════════
 *   🔴 키 = `lib/video/scenes.ts PALETTES`·`HOOK_TYPES` 의 **영문 프롬프트 문구 그대로**(그 문구가 곧 id 다).
 *      scenes.ts 의 문구를 고치면 여기도 같이 고친다 — scenes.ts 가 기동 때 짝을 대조해 콘솔에 알린다.
 *   이 파일에 두는 이유: A·B2 가 보는 **어휘 정본**이고, types.ts 는 아무것도 import 하지 않아 어디서든 읽을 수 있다(AC-17). */
export const PALETTE_LABELS_KO: Readonly<Record<string, string>> = {
  "warm terracotta and cream": "테라코타",
  "cool teal and off-white": "청록",
  "deep navy and amber": "네이비",
  "sage green and sand": "세이지",
  "charcoal and coral": "차콜",
};
/**
 * 🔴 [R8CLOSE · B2] 표에 없는 값은 «기본»이 아니라 **«따로 정한 색»**이다.
 *   레퍼런스를 붙이면 `variant.palette` 에 **배워 온 색 문장**이 들어간다(`director.ts refPalette`).
 *   그때 칩이 «기본»이라고 말하면 **고객이 보는 말과 그림이 어긋난다** — 기본값으로 굽는 줄 알지만 실제는 레퍼런스 색이다.
 *   영문 프롬프트 문구를 그대로 보여 주지도 않는다(§13.0 «말은 사람말»).
 */
export function paletteLabelKo(palette: unknown): string {
  const key = String(palette ?? "").trim();
  return PALETTE_LABELS_KO[key] ?? (key ? "따로 정한 색" : "기본");
}

/** 훅 연출 사람말 이름 — 키 = `scenes.ts HOOK_TYPES`. */
export const HOOK_LABELS_KO: Readonly<Record<string, string>> = {
  event_pushin: "사건으로 시작",
  number_typo: "숫자로 시작",
  extreme_closeup: "확대로 시작",
  question: "질문으로 시작",
  contrast: "반전으로 시작",
};
export function hookLabelKo(hookType: unknown): string { return HOOK_LABELS_KO[String(hookType ?? "")] ?? "기본"; }

/* ═══════════ 내려받는 mp4 파일 이름 — **한 곳**(계약 R7 §1.3 · B2 `lib/runner-release.ts releaseFilename` 관례) ═══════════
 *   🔴 이름은 R2 서명 안의 `Content-Disposition` 으로만 전달된다 — 프리사인은 교차 출처라 화면의 `<a download="…">` 는 **무시된다**.
 *      B2 가 `lib/r2.ts contentDisposition()` 에 RFC 5987(`filename*=UTF-8''…` + ASCII 폴백)을 넣어 줘서(2026-09-15)
 *      **한글 제목을 그대로 쓴다**. 그전엔 한글을 떨어뜨리고 `AC-329-20260915.mp4` 를 줬는데, 고객이 받는 건 «내 영상 제목»이 아니었다.
 *   🔴 여기서 막는 것은 **파일이름으로 못 쓰는 글자**다: `contentDisposition` 이 헤더를 깨뜨리는 `" \ CR LF` 는 지우지만
 *      `/ : * ? < > |` 는 지우지 않는다 — 그대로 두면 브라우저·OS 가 저장에 실패하거나 경로로 읽는다.
 *      제어문자·앞뒤 공백·끝의 점(윈도우가 잘라 버린다)도 함께 턴다. */

/** 오늘(KST) `YYYYMMDD`. 순수 산술(+9h) — `lib/cron/base.ts kstHour` 와 같은 근거(드라이버 tz 무관 · CLAUDE §4.5b). */
export function kstDateCompact(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
}

/** 파일이름에 쓸 제목 토막(한글 그대로). 남는 글자가 없으면 `fallback`. */
export function videoNamePart(title: unknown, fallback: string): string {
  const s = String(title ?? "")
    .replace(/[\x00-\x1F\x7F]/g, " ")        // 제어문자(헤더·파일이름 양쪽에서 위험)
    .replace(/[\\/:*?"<>|]/g, " ")           // 파일이름 금지 글자(윈도우·맥 공통 · 역슬래시 포함) — 경로로 읽히지 않게
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .replace(/[.\s]+$/, "")                  // 끝의 점·공백(윈도우가 조용히 잘라 다른 이름이 된다)
    .trim();
  return s || fallback;
}

/** `AC-{pieceId}-{제목}.mp4` — 화면·응답·헤더가 모두 이 한 함수를 쓴다(이름이 두 벌이 되지 않게). */
export function videoFilename(pieceId: unknown, title: unknown, now: Date = new Date()): string {
  const id = Math.floor(Number(pieceId) || 0);
  return `AC-${id}-${videoNamePart(title, kstDateCompact(now))}.mp4`;
}

