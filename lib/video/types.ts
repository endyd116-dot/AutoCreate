/**
 * lib/video/types.ts — 영상 축 어휘·페이로드 정본(계약 P1R5 §0.2 · §1.1 · §2.1 · §5 — 글자 그대로). 순수(임포트 0).
 *   B(생성 두뇌)·B2(러너·출구)·A(화면 mock)가 같은 파일을 본다. 어휘를 늘리면 칸 폭(AC-21/30)을 같이 잰다:
 *   VideoStage ≤ 8자 · format ≤ 8자 · pieces.format varchar(24) · piece_assets.kind varchar(12).
 */
export type VideoFormat = "graphic" | "talking" | "clip";
export type VideoSeconds = 15 | 30 | 60;
export type VideoChannel = "youtube_shorts" | "naver_clip" | "reels" | "threads";
export type ProviderKey = "omni" | "veo_lite" | "veo_fast" | "veo" | "wan" | "hailuo" | "kling";
export type ClipTier = "filler" | "standard" | "money";
export type VideoStage = "script" | "tts" | "clips" | "render" | "judging" | "done" | "failed";
export type JudgeGrade = "P0" | "P1" | "P2";
export type TtsProvider = "typecast" | "gemini";

export const VIDEO_CHANNELS: ReadonlySet<string> = new Set<VideoChannel>(["youtube_shorts", "naver_clip", "reels", "threads"]);
export const VIDEO_FORMATS: readonly VideoFormat[] = ["graphic", "talking", "clip"];
export const VIDEO_SECONDS: readonly VideoSeconds[] = [15, 30, 60];
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
  captions: { preset: "keyword_center" | "talking_big" | "clip_top"; phrases: RenderPhrase[]; srtKey: string };
  audio: { narration: { key: string; startMs: number }[]; bgm: { key: string; gainDb: -18 } | null; sfx: [] | null; loudnorm: { I: -16; TP: -1.5; LRA: 11 } };
  overlay: { badge: { text: string; corner: "tr" } | null; safeZone: { top: 220; bottom: 300 }; endcard: { text: string; url?: string } | null };
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
}

/* ───────── 심사(계약 §5 judgeVideo) ───────── */
export interface JudgeAxis { key: string; label: string; pass: boolean; grade: JudgeGrade; detail?: string }
export interface JudgeResult { grade: JudgeGrade; pass: boolean; axes: JudgeAxis[]; repaired: boolean }

/* ───────── chainStage(계약 §1.4) ───────── */
export interface ChainStage { stage: VideoStage; at: string; cutsDone?: number; cutsTotal?: number }
export interface ChainLock { at: string; by: string }
export interface ChainResume { count: number; at?: string }

/** 컷 예산(계약 §1.4-3) — 15분 수명 − 합성·업로드 여유 4분. 상수 1곳.
 *   env `CHAIN_BUDGET_MS` 는 **로컬 전용 손잡이**(C 하니스 이어달리기 재현 · 크론 CRON_BUDGET_MS 관례) — 프로덕션에 설정하지 않는다. */
export const CHAIN_BUDGET_MS = (() => { const v = Number(process.env.CHAIN_BUDGET_MS); return Number.isFinite(v) && v >= 10_000 ? Math.floor(v) : 11 * 60_000; })();
/** `VIDEO_PROVIDER_STUB=1` — provider·TTS·심사 비전 호출을 고정 응답으로 대체(로컬 하니스 전용 · ai_usage 는 model «stub» 로 기록 · 원가 0). 실호출은 이 변수가 없을 때만. */
export function videoStub(): boolean { return String(process.env.VIDEO_PROVIDER_STUB ?? "").trim() === "1"; }
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
export function paletteLabelKo(palette: unknown): string { return PALETTE_LABELS_KO[String(palette ?? "")] ?? "기본"; }

/** 훅 연출 사람말 이름 — 키 = `scenes.ts HOOK_TYPES`. */
export const HOOK_LABELS_KO: Readonly<Record<string, string>> = {
  event_pushin: "사건으로 시작",
  number_typo: "숫자로 시작",
  extreme_closeup: "확대로 시작",
  question: "질문으로 시작",
  contrast: "반전으로 시작",
};
export function hookLabelKo(hookType: unknown): string { return HOOK_LABELS_KO[String(hookType ?? "")] ?? "기본"; }
