// AM 원본: ../AutoMarketing/lib/ai-models.ts (복사 2026-09-14 · 무수정 — 🔴 모델명 단일 출처 · DB 오버레이는 lib/ai-model-overrides.ts(Phase 4))
/**
 * ai-models — 🔴 **제미나이 모델 이름이 사는 유일한 곳**(사장님 지시 2026-09-11).
 *
 *   사장님 원문: 「AI 변수는 한 곳에서만 관리하자. 어디든 뭐고 어디든 뭐고 이러니 헷갈린다.」
 *
 *   왜 이 파일이 생겼나 — 2026-09-11 실측: 모델 이름을 **자기 파일에 직접 적어 둔 자리가 20곳**이었고,
 *   그중 **12곳이 `gemini-3-flash-preview`**(구세대)로 굳어 있었다. 사진 태깅·소재 심판·이미지 관문·
 *   랜딩 검수·문서 OCR·후기 읽기가 전부 그 모델로 돌고 있었는데 **아무도 올린 적이 없다.**
 *   흩어져 있으면 «전 체인 최신화»를 할 때마다 몇 곳은 반드시 빠진다 — 실제로 8/16 재리스트업이 그랬다.
 *
 * ── 규율 ─────────────────────────────────────────────────────────────
 *   ① 🔴 **모델 이름 문자열을 다른 파일에 적지 마라.** 여기서 import 한다(#293 — 두 벌로 적으면 갈린다).
 *   ② 🔴 **목록에 있다고 쓰지 마라 — 우리 키로 «불러 보고» 넣어라.**
 *      전례: `gemini-3.6-flash` 는 모델 목록에 있는데 우리 키의 «이미지» 경로에서 400 이었다(hero-prompt:302).
 *      전례: `gemini-3.1-pro-preview` 는 `thinkingBudget:0` 을 400 으로 거부해 **한 번도 답한 적이 없다**(ai.ts §186).
 *      ⇒ `scripts/verify-ai-models.mjs` 가 이 파일의 전 모델을 실제로 호출해 살아 있는지 잰다.
 *   ③ 🔴 **«0.1 씩 내린다»는 규칙으로 만들지 마라.** 실재하는 판은 3.8·3.7·3.6·3.5·3.1·3 뿐이고
 *      3.4·3.3·3.2 는 **없다**. 규칙으로 만들면 없는 모델을 부른다. 실측 목록을 내림차순으로 적는다.
 *   ④ env override 는 그대로 둔다(PAT 잠금 우회로 급할 때 쓰는 문이다).
 *
 * ── 2026-09-11 실측(우리 키·직접 호출) ───────────────────────────────
 *   gemini-3.8-flash  단발 200/1.5s · +googleSearch 200/2.7s · +JSON강제 200/1.4s
 *                     thinkingBudget:0 **200**(3.6 이 400 뱉던 인자를 받는다) · -1 200(생각 124) · 미지정 200(생각 114)
 *   gemini-3.6-flash  텍스트 200/2.8s (이미지 경로만 400 이었다)
 *   모델 목록에 실재: 3-flash-preview · 3.1-{flash-lite,pro-preview,flash-image,tts} · 3.5-{flash,flash-lite}
 *                     · 3.6-flash · 3.7-flash · 3.8-flash · 3-pro-image · 3.1-flash-image
 */

/** 문자열(콤마) → 배열. env override 를 같은 문법으로 받는다. */
function chain(envValue: string | undefined, fallback: string): string[] {
  return String(envValue || fallback).split(",").map((s) => s.trim()).filter(Boolean);
}

/* ═══════════════════ ① 글 쓰는 모델 — 세 체인 ═══════════════════ */

/**
 * HIGH — 복잡한 판단(배경·전략). **띵킹은 mode:"pro" 가 켠다**(체인이 아니다).
 *   🔴 전략브리프가 이 체인이다(`mode:"pro"` + googleSearch).
 *   꼬리에 lite 하나 — 전 상위가 동시에 503 이어도 «산출 0» 은 만들지 않는다(정상 시 안 탄다).
 */
export const CHAIN_HIGH = chain(process.env.GEMINI_CHAIN_HIGH,
  "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.1-flash-lite");

/**
 * LOW — 간단·대량.
 *   🔴 **헤드를 lite 로 두는 것이 이 체인의 «목적»이다.** 최신이라고 헤드를 올리면 대량 경로 비용이 통째로 바뀐다.
 *   꼬리만 최신 — 앞이 다 죽었을 때는 품질로 마감한다(사장님 취지).
 */
export const CHAIN_LOW = chain(process.env.GEMINI_CHAIN_LOW,
  "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.8-flash");

/**
 * DIRECTOR — 🔴 **모든 «디렉터»가 이 한 체인을 쓴다**(사장님 지시 2026-09-11).
 *   소재 디렉터 · 콘텐츠 디렉터 · 히어로 브랜드 디렉터 · 외부 편집 디렉터 · 소재 시나리오.
 *   전부 `mode:"pro"`(띵킹 ON)로 부른다 — 2026-09-10 HOOKWIRE 에서 마지막 셋까지 켰다(확인함).
 *   🔴 `gemini-3.1-pro-preview` 는 넣지 마라 — `thinkingBudget:0` 을 400 으로 거부해 한 번도 답한 적이 없다.
 *   ⚠️ 꼬리 3.5 는 «flash 로 부르는 자리가 남아 있어도 통째로 죽지 않게» 하는 보루다(budget:0 도 200).
 */
export const CHAIN_DIRECTOR = chain(process.env.GEMINI_CHAIN_DIRECTOR,
  "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash");

/** 랜딩·스토리 생성 전용(배치는 mode:"pro"·16384 토큰 / 동기는 flash — 26초 벽). */
export const CHAIN_LANDING_GEN = chain(process.env.GEMINI_CHAIN_LANDING,
  "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.1-flash-lite");

/** 단일 모델 기본값(체인을 안 쓰는 옛 호출부). */
export const MODEL_DEFAULT = process.env.GEMINI_MODEL || process.env.GEMINI_MODEL_FLASH || "gemini-3.8-flash";

/* ═══════════════════ ② 보는 모델 — 사진·영상·문서 ═══════════════════ */

/**
 * VISION — 사진·이미지를 «읽는» 모델. 태깅·심판·관문·검수·OCR·후기 읽기가 전부 이 한 값을 쓴다.
 *   🔴 2026-09-11 이전까지 **12곳이 각자 `gemini-3-flash-preview`(구세대)를 적어 두고 있었다.**
 *      「전 체인 최신화」를 두 번 했는데 두 번 다 이 12곳은 안 움직였다 — 흩어져 있었기 때문이다.
 *   ⚠️ 이미지를 «만드는» 모델과 다르다(그건 IMAGE_*).
 */
export const MODEL_VISION = process.env.GEMINI_MODEL_VISION || process.env.GEMINI_MODEL_FLASH || "gemini-3.8-flash";

/** 영상을 읽는 모델(레퍼런스 분석). */
export const MODEL_VIDEO_READ = process.env.GEMINI_MODEL_VIDEO_READ || process.env.GEMINI_MODEL || "gemini-3.8-flash";

/* ═══════════════════ ③ 만드는 모델 — 그림·음성 ═══════════════════ */

/**
 * IMAGE — 그림을 «만드는» 체인. 🔴 글 모델과 세대가 다르다 — 최신이라고 같이 올리지 마라.
 *   실측(creative-image-gen.ts:31): 3-pro-image·nano-banana-pro-preview 는 **503** ·
 *   `gemini-3.1-flash-image` 만 **200 · 2400x1792**. 그 실측이 이 값의 근거다.
 */
export const CHAIN_IMAGE = chain(process.env.GEMINI_MODEL_IMAGE,
  "gemini-3.1-flash-image,gemini-3.1-flash-image-preview,gemini-3-pro-image");

/** 키가 살아 있나만 보는 «가장 싼» 모델 — 검증 1회용이라 최신일 필요가 없다(그 사실이 이 주석이다). */
export const MODEL_KEY_VALIDATE = "gemini-2.5-flash-lite";

/** 음성(TTS). */
export const MODEL_TTS = process.env.GEMINI_MODEL_TTS || "gemini-3.1-flash-tts-preview";


/* ═══════════════════ ③-b 영상을 «만드는» 모델 — P1R5 쇼츠 공장(AM video-providers/registry.ts 2026-09-03 실측치 이식 · 모델명은 여기 한 곳) ═══════════════════ */

/**
 * OMNI — Gemini Omni 1.1 Flash(Interactions API · 동기 ~35s · $0.10/s). 그래픽 스토리 쇼츠의 기본 provider(계약 P1R5 §0.1-1).
 *   AM SHORTS1 실증(2026-09-03): 9:16 · 8초 · 실물 1컷 생성 성공. ⚠️ 1:1 은 400 — 9:16/16:9 만.
 */
export const MODEL_OMNI = process.env.GEMINI_MODEL_OMNI || "gemini-omni-1.1-flash";
/** VEO 3.1 3등급(predictLongRunning 폴링 · durationSeconds 4·6·8 만 · 1:1 400). Lite 가 video_15 강제 티어(원가 역전 방지). */
export const MODEL_VEO = process.env.GEMINI_MODEL_VEO || "veo-3.1-generate-preview";
export const MODEL_VEO_FAST = process.env.GEMINI_MODEL_VEO_FAST || "veo-3.1-fast-generate-preview";
export const MODEL_VEO_LITE = process.env.GEMINI_MODEL_VEO_LITE || "veo-3.1-lite-generate-preview";
/** fal.ai 게이트웨이 모델 경로(FAL_KEY 있을 때만 · kling 은 명시 지정 시만 — 자기재사용 조항). */
export const FAL_MODEL_WAN = "fal-ai/wan/v2.2-5b/image-to-video";
export const FAL_MODEL_HAILUO = "fal-ai/minimax/hailuo-02/standard/image-to-video";
export const FAL_MODEL_KLING = "fal-ai/kling-video/v2.6/pro/image-to-video";
/** 영상 모델은 `verify-ai-models` 텍스트 프로브로 못 잰다(영상 출력·과금) — 살아 있음 확인은 C 라이브 1컷 실증이 정본. */
export const VIDEO_MODELS: string[] = [MODEL_OMNI, MODEL_VEO, MODEL_VEO_FAST, MODEL_VEO_LITE];

/* ═══════════════════ ④ 하니스가 쓰는 «전 모델» 목록 ═══════════════════ */

/** 🔴 이 파일이 선언한 모든 모델(중복 제거). `verify-ai-models` 가 이걸 실제로 호출해 살아 있는지 잰다. */
export const ALL_DECLARED_MODELS: string[] = [...new Set([
  ...CHAIN_HIGH, ...CHAIN_LOW, ...CHAIN_DIRECTOR, ...CHAIN_LANDING_GEN, ...CHAIN_IMAGE,
  MODEL_DEFAULT, MODEL_VISION, MODEL_VIDEO_READ, MODEL_TTS,
])];

/* ═══════════════════ ⑤ 🔴 운영이 **무배포로 바꿀 수 있는 역할** — 이름·말·사슬이 여기 한 곳 (AC-252 · 2026-09-23) ═══════════════════ */

/**
 * 🔴 **CLAUDE §2 의 약속이 절반만 참이었다.**
 *   «모델명은 `lib/ai-models.ts` 한 파일에만 · DB 오버레이 `ai_model_overrides` 로 **무배포 갱신**» 이라고 적어 뒀는데,
 *   운영센터가 실제로 바꿀 수 있는 것은 **글·사진 다섯**(high·low·director·landing·image)뿐이었다(메인 실측 2026-09-23).
 *   🔴 **영상·음성 전부가 밖**이었다 — `MODEL_TTS`·`MODEL_OMNI`·`MODEL_VEO/_FAST/_LITE`·`MODEL_VISION`·`MODEL_VIDEO_READ`·FAL 3종.
 *   ⇒ 그 모델이 죽거나 값이 바뀌면 **배포를 해야 한다.** 제공사가 미리보기 모델을 내리는 일이 잦은데 그때마다 배포다.
 *
 *   ══ 그래서 무엇이 바뀌나 ══
 *     역할 목록을 **여기 한 곳**에 두고 `ops-ai` 가 그걸 그대로 읽는다. 역할을 더하면 **운영 화면이 저절로 따라간다.**
 *     🔴 **`label`(사람말)도 여기서 준다** — C 가 짚었다: 화면(`public/ops/ai.html:32`)이 `ROLE` 손 표를 들고 있어
 *        서버가 역할을 넓히면 **영문 키가 그대로 찍힌다**(AC-52 · CLAUDE §3 «말은 사람말»).
 *        ⇒ 화면은 손 표를 지우고 `label` 을 그대로 그린다. **그 표가 서버보다 먼저 낡는 일이 없어진다.**
 *
 *   ══ ⚠️ 잴 수 있는 것과 없는 것을 갈라 둔다 ══
 *     `probe: "text"` — `verify-ai-models` 가 **우리 키로 불러 보고** 살아 있음을 잰다(CLAUDE §4.9).
 *     `probe: "none"` — 텍스트 프로브로 **못 잰다**(영상 출력·과금·별도 게이트웨이). 🔴 «안 잰다»가 아니라 **«못 잰다»**이고,
 *        바꾸기 전에 **사람이 1컷 실증**해야 한다. 화면이 그 말을 그대로 보여 준다(겁주지 않고 사실만 · §3).
 */
export interface AiRoleSpec {
  /** `ai_model_overrides.role` 키. 🔴 바꾸면 저장된 오버레이와 끊긴다 — 늘리기만 한다. */
  role: string;
  /** 🔴 사람말(운영 화면이 그대로 그린다 · 화면이 지어내지 않는다 · AC-52). */
  label: string;
  /** 코드가 들고 있는 기본 사슬(오버레이가 없을 때 쓰는 것). */
  codeChain: string[];
  /** 무엇에 쓰는 모델인가 — 한 문장(운영자가 고를 때 읽는다). */
  note: string;
  /** `text` = 우리 키로 불러 살아 있음을 잰다 · `none` = 텍스트 프로브로 **못 잰다**(사람이 1컷 실증). */
  probe: "text" | "none";
}

/**
 * 🔴 **운영이 바꿀 수 있는 역할 표 — 정본.** `netlify/functions/ops-ai.ts` 가 이걸 그대로 읽는다.
 *   ⚠️ 여기 없는 모델은 **여전히 배포해야 바뀐다.** 새 모델을 `lib/ai-models.ts` 에 더하면 **이 표에도 넣어라** —
 *      안 넣으면 «무배포 갱신» 약속이 또 절반만 참이 된다(그게 이 표를 만든 까닭이다).
 */
export const AI_ROLE_SPECS: readonly AiRoleSpec[] = [
  { role: "high",     label: "글(공들여)",     codeChain: CHAIN_HIGH,        note: "본문을 공들여 쓸 때", probe: "text" },
  { role: "low",      label: "글(가볍게)",     codeChain: CHAIN_LOW,         note: "짧은 글·요약처럼 가벼운 일", probe: "text" },
  { role: "director", label: "디렉터",         codeChain: CHAIN_DIRECTOR,    note: "소재를 고르고 지시서를 짤 때", probe: "text" },
  { role: "landing",  label: "소개 페이지",     codeChain: CHAIN_LANDING_GEN, note: "소개 페이지 문안", probe: "text" },
  { role: "image",    label: "사진",           codeChain: CHAIN_IMAGE,       note: "그림을 만들 때", probe: "text" },
  /* 🔴 여기부터가 이번에 들어온 것 — 여태 배포해야만 바뀌던 자리다. */
  { role: "tts",       label: "목소리",          codeChain: [MODEL_TTS],        note: "영상 내레이션을 읽는 목소리", probe: "text" },
  { role: "vision",    label: "그림 읽기",       codeChain: [MODEL_VISION],     note: "만든 그림·화면을 살펴볼 때", probe: "text" },
  { role: "videoRead", label: "영상 살펴보기",   codeChain: [MODEL_VIDEO_READ], note: "만든 영상을 검수할 때", probe: "text" },
  /* 🔴 아래 넷은 **텍스트로 못 잰다** — 영상이 나오고 돈이 든다. 바꾸기 전에 사람이 1컷을 만들어 봐야 한다. */
  { role: "videoOmni", label: "영상(옴니)",      codeChain: [MODEL_OMNI],       note: "그래픽 쇼츠를 만드는 기본", probe: "none" },
  { role: "videoVeo",  label: "영상(베오)",      codeChain: [MODEL_VEO, MODEL_VEO_FAST, MODEL_VEO_LITE], note: "실사 느낌 쇼츠(세 등급)", probe: "none" },
  { role: "videoFal",  label: "영상(팔 게이트웨이)", codeChain: [FAL_MODEL_WAN, FAL_MODEL_HAILUO, FAL_MODEL_KLING], note: "FAL_KEY 가 있을 때 쓰는 바깥 게이트웨이", probe: "none" },
];

/** 역할 키 → 사양(한 곳에서 찾는다). 모르는 역할이면 `undefined` — **지어내지 않는다**(AC-9). */
export const aiRoleSpec = (role: string): AiRoleSpec | undefined => AI_ROLE_SPECS.find((r) => r.role === role);
