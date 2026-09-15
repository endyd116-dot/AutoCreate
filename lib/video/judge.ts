/**
 * lib/video/judge.ts — 렌더 결과 8축 심사(결정론 + 비전) · 3등급(P0 차단 · P1 1회 편집 재생성 후 통과 표시 · P2 기록) · 결정론 수리. 계약 §1.4-5 · §0.1-7 · §5 judgeVideo.
 *   AM 원본: ../AutoMarketing/lib/creative-judge.ts (복사 2026-09-15 · 원본 342534db8 2026-09-11 · 2,475줄 중 축 8(MASTER §7-1)·3등급(SHORTS5)·결정론 수리 관례 이식 · 광고 소재 축(CTA 씬·브랜드 색·카드뉴스)은 제외)
 *   축(§7-1): ①hook_first ②safe_area ③reading_time ④text_broken ⑤black_margin ⑥frames_not_blank ⑦cut_rhythm ⑧forbidden — + AC 고유 disclosure(§16B)·duration_fit·similarity(§1.9).
 *   결정론 우선(①③⑦⑧ + duration·disclosure 는 페이로드에서 · 비용 0) · 비전은 포스터 1장 + 컷 대표 프레임을 한 호출에(축별 boolean · 단발 총점 금지) · AC-26: thinking 모델 «본문 0» 을 실패로 세지 않는다(finishReason·parts).
 *   비전 «불능»(429·타임아웃)은 미달이 아니다 — P2 기록 + 사람 말 사유(AM VISION_BLIND_REASON) · 합부에 손대지 않는다.
 *   등급: P0 = forbidden·disclosure·duration_fit·frames_not_blank 실패 → 차단(수리 후 재큐) · P1 = text_broken·black_margin·safe_area·hook_first·similarity → 기록·통과(1회 재생성은 gen 단계에서) · P2 = reading_time·cut_rhythm(수리 가능) → 수리·기록.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../db-util";
import { MODEL_VISION } from "../ai-models";
import { recordAiUsage } from "../ai";
import { leaseAiKey, reportAiKeyOutcome, isRateLimitReason } from "../ai-key";   // [R8 · §3.3] 키를 고르는 자리 한 곳 — 🔴 `GEMINI_API_KEYS` 만 꽂은 집에서 여기가 env 를 직접 읽으면 «키 없음»으로 죽는다
import { r2Get } from "../r2";
import { findBannedWords, BLOG_EXTRA_BANNED } from "../banned-words";
import { checkVideoDisclosure } from "../disclosure";
import { checkHook } from "./script";
import { hammingHex, phashFromGray32, PHASH_SIMILAR_MAX_DISTANCE } from "./fingerprint";
import { JUDGE_COST_USD } from "./cost";
import { videoStub, safeZoneOf, type JudgeAxis, type JudgeGrade, type JudgeResult, type RenderPayload, type RenderReport } from "./types";

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

export const VISION_BLIND_REASON = "심사를 돌리지 못했습니다(AI 판정이 일시 장애로 응답하지 않음) — 영상은 정상적으로 만들어졌습니다. 품질 문제가 아니므로 다시 만들 필요는 없습니다: 화면에서 보시고 이대로 예약하거나 잠시 뒤 다시 시도해 주세요.";
/** 자막 읽기 속도 상한(초당 글자 · AM CAPTION 계약 5.5자/초 + 여유). */
export const READ_CHARS_PER_SEC = 6.5;
/** 컨테이너가 영상 트랙보다 이만큼 넘게 길면 «끝에 정지 화면이 붙었다»로 본다(§AC-31). 키프레임·mux 오차는 이 아래다. */
export const TAIL_TOLERANCE_MS = Number(process.env.VIDEO_TAIL_TOLERANCE_MS || "500");
const AXIS_LABEL: Record<string, string> = { hook_first: "첫 컷이 훅", safe_area: "자막·배지가 안전영역 안", caption_lines: "자막 2줄 이내", reading_time: "자막 읽을 시간 충분", text_broken: "깨진 글자 없음", black_margin: "검은 여백 없음", frames_not_blank: "빈 프레임 없음", cut_rhythm: "컷 리듬 살아 있음", forbidden: "금칙·내부 문자열 없음", disclosure: "제휴 고지(배지·자막·설명란)", duration_fit: "길이 규격 안", similarity: "다른 계정 영상과 겹치지 않음" };
const GRADE_OF: Record<string, JudgeGrade> = { forbidden: "P0", disclosure: "P0", duration_fit: "P0", frames_not_blank: "P0", text_broken: "P1", black_margin: "P1", safe_area: "P1", caption_lines: "P2", hook_first: "P1", similarity: "P1", reading_time: "P2", cut_rhythm: "P2" };
const axis = (key: string, pass: boolean, detail?: string): JudgeAxis => ({ key, label: AXIS_LABEL[key] ?? key, pass, grade: GRADE_OF[key] ?? "P2", ...(detail ? { detail } : {}) });
/** [R7 §1.5] «못 쟀다»를 «괜찮다»로 접지 않는다(AC-33 · AC-9) — 막지는 않지만(`pass:true`) 잰 척도 하지 않는다.
    실패한 축에는 붙이지 않는다: 떨어뜨릴 만큼은 쟀다는 뜻이라 보류가 아니다. */
const pendingIf = (a: JudgeAxis, pending: boolean): JudgeAxis => (pending && a.pass ? { ...a, pending: true } : a);

/* ═══ 자막·배지가 «그 채널의» 안전영역 안인가 (R8-A §3) ═══
   🔴 종전 축은 «자막·배지가 안전영역 안»이라는 **이름을 달고** 실제로는 `safeZone.top === 220 && bottom === 300`,
      즉 **«그 숫자가 그 숫자인가»**를 쟀다(AC-57 의 교과서적 모양). 결과가 뒤집혀 있었다:
      틀린 값(300)을 «통과»로 도장 찍고, 쇼츠에 맞게 390 으로 고치면 **그 순간 축이 빨강**이 됐다 — **고치면 검사가 막았다.**
   ⇒ 이제 이름이 말하는 것을 잰다: **자막 블록과 배지가 플랫폼 UI 띠를 침범하지 않는가.**

   렌더러가 실제로 그리는 자리(`runner/channels/render-video.mjs buildOverlayHtml`):
     · 자막 = `bottom: safeZone.bottom` (프리셋 `clip_top` 이면 `top: safeZone.top`) · 좌우 = `side`
     · 배지 = 오른쪽 위 `top: safeZone.top`
   그래서 «침범하지 않았다» = 그 값들이 **그 채널의 UI 띠 두께 이상**이라는 뜻이다. */
export const CAPTION_SIDE_PX = 60;
function checkSafeArea(p: RenderPayload): JudgeAxis {
  const want = safeZoneOf(p.channel);                    // 채널이 없으면 가장 보수적인 값(AC-9)
  const got = p.overlay.safeZone;
  const bad: string[] = [];
  if (!(got.bottom >= want.bottom)) bad.push(`아래 ${got.bottom}px < 필요 ${want.bottom}px(자막 마지막 줄이 UI 에 가려진다)`);
  if (!(got.top >= want.top)) bad.push(`위 ${got.top}px < 필요 ${want.top}px`);
  const side = Number(got.side ?? CAPTION_SIDE_PX);
  if (!(side >= want.side)) bad.push(`좌우 ${side}px < 필요 ${want.side}px`);
  /* 🔴 제휴 고지 **배지**도 같이 본다 — 배지가 UI 에 가려지면 §16B 고지가 안 보이는 것이라 품질이 아니라 **정책** 문제다. */
  if (p.overlay.badge && !(got.top >= want.top)) bad.push("제휴 배지가 상단 UI 안");
  if (p.overlay.badge && p.overlay.badge.corner !== "tr") bad.push(`배지 코너 ${p.overlay.badge.corner}(tr 이어야 한다)`);
  const ch = p.channel ?? "(채널 없음 — 보수적 기준)";
  return axis("safe_area", bad.length === 0, bad.length ? `${ch}: ${bad.join(" · ")}` : undefined);
}

/* ═══ 자막 줄 수 (R8-A §3) ═══
   한국어 자막 표준: **한 줄 16~18자 · 최대 2줄**(넷플릭스 한국어 지침은 한 줄 16자).
   🔴 우리에겐 **줄 수 규칙이 아예 없었다** — `white-space:pre-wrap` 의 자동 줄바꿈에 맡겨 두고 아무도 정하지 않았다.
      지금 값(구절 ≤12음절)으로는 우연히 2줄 안에 들어가지만, **우연히 맞는 것은 규칙이 아니다**(다음 사람이 글자 크기만 키우면 깨진다).
   글자 폭은 한글 기준 ≈ 글자 크기(1em)로 잡는다 — 정확한 폰트 메트릭 없이 재는 근사라 **보수적으로** 본다. */
export const CAPTION_MAX_LINES = 2;
const PRESET_FONT_PX: Record<string, number> = { keyword_center: 78, talking_big: 92, clip_top: 64 };
export function captionLinesOf(text: string, fontPx: number, boxPx: number): number {
  const chars = String(text ?? "").replace(/\s/g, "").length;
  const perLine = Math.max(1, Math.floor(boxPx / Math.max(1, fontPx)));
  return Math.max(1, Math.ceil(chars / perLine));
}
function checkCaptionLines(p: RenderPayload): JudgeAxis {
  const fontPx = PRESET_FONT_PX[p.captions.preset] ?? 78;
  const side = Number(p.overlay.safeZone.side ?? CAPTION_SIDE_PX);
  const boxPx = Math.max(1, p.out.w - side * 2);
  const over = p.captions.phrases
    .map((ph) => ({ t: ph.text, n: captionLinesOf(ph.text, fontPx, boxPx) }))
    .filter((x) => x.n > CAPTION_MAX_LINES);
  return axis("caption_lines", over.length === 0,
    over.length ? `${over.length}구절이 ${CAPTION_MAX_LINES}줄을 넘는다(${fontPx}px·${boxPx}px 기준): ${over.slice(0, 2).map((x) => `«${x.t.slice(0, 14)}»(${x.n}줄)`).join(" ")}` : undefined);
}

/* ═══ 결정론 축(페이로드) ═══ */
export function judgePayloadDeterministic(p: RenderPayload, meta: Record<string, unknown>, report?: Partial<RenderReport> | null, hookText?: string): { axes: JudgeAxis[]; repairedPayload: RenderPayload | null } {
  const axes: JudgeAxis[] = [];
  let repaired: RenderPayload | null = null;
  const totalMs = p.scenes.length ? Math.max(...p.scenes.map((s) => s.endMs)) : 0;
  // ① hook_first
  const h = checkHook(hookText ?? p.captions.phrases[0]?.text ?? "");
  axes.push(axis("hook_first", h.ok && p.scenes[0]?.startMs === 0, h.ok ? undefined : h.reason ?? undefined));
  // ② safe_area — 🔴 **그 채널의 안전영역 안인가**(R8-A §3 · 2026-09-15)
  axes.push(checkSafeArea(p));
  // ②b caption_lines — 자막이 최대 2줄인가(R8-A §3 · 한국어 자막 표준: 한 줄 16~18자 · 최대 2줄)
  axes.push(checkCaptionLines(p));
  // ③ reading_time — 구절 글자 ≤ 표시 초 × 6.5 · 수리 = 뒤 구절 시작을 밀지 않고 endMs 연장(다음 구절 start 까지)
  const slow: string[] = []; let fixedRead = false;
  const phrases = p.captions.phrases.map((ph, i, arr) => {
    const chars = ph.text.replace(/\s/g, "").length; const need = (chars / READ_CHARS_PER_SEC) * 1000;
    if (ph.endMs - ph.startMs < need * 0.8) { slow.push(`«${ph.text.slice(0, 12)}»`); const nextStart = arr[i + 1]?.startMs ?? totalMs; if (nextStart - ph.startMs >= need * 0.8) { fixedRead = true; return { ...ph, endMs: Math.min(nextStart, ph.startMs + Math.round(need)) }; } }
    return ph;
  });
  axes.push(axis("reading_time", slow.length === 0 || fixedRead, slow.length ? `읽을 시간 부족 ${slow.length}구절: ${slow.slice(0, 3).join(" ")}${fixedRead ? " (표시 시간 연장으로 수리)" : ""}` : undefined));
  if (fixedRead) repaired = { ...p, captions: { ...p.captions, phrases } };
  // ⑦ cut_rhythm — 씬 3개 이상인데 길이가 사실상 균등(±10%)이면 미달 · 수리 = 홀수 씬 경계를 ±8% 이동
  if (p.scenes.length >= 3) {
    const lens = p.scenes.map((s) => s.endMs - s.startMs); const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const maxDev = Math.max(...lens.map((l) => Math.abs(l - mean)));
    const monotone = maxDev < mean * 0.1;
    axes.push(axis("cut_rhythm", !monotone, monotone ? `전 씬이 사실상 균등(${Math.round(mean)}ms ±${Math.round(maxDev)}ms)` : undefined));
    if (monotone) {
      const base = repaired ?? p; const sc = base.scenes.map((s) => ({ ...s }));
      for (let i = 1; i < sc.length; i += 2) { const shift = Math.round(mean * 0.08); sc[i - 1].endMs += shift; sc[i].startMs += shift; }
      repaired = { ...base, scenes: sc };
    }
  } else axes.push(axis("cut_rhythm", true, "씬 2개 이하 — 판정 대상 아님"));
  // ⑧ forbidden — 자막·엔드카드·설명란 금칙어 + 내부 문자열(cut:·stub·TODO·{{)
  const texts = [...p.captions.phrases.map((x) => x.text), p.overlay.endcard?.text ?? "", String(meta.description ?? "")].join("\n");
  const banned = findBannedWords(texts, BLOG_EXTRA_BANNED); const internal = /cut:\d|\bstub\b|TODO|\{\{|\}\}|undefined|NaN/.test(texts);
  axes.push(axis("forbidden", banned.length === 0 && !internal, banned.length ? `금칙어 ${banned.join(", ")}` : internal ? "내부 문자열 흔적" : undefined));
  // disclosure(§16B)
  const d = checkVideoDisclosure({ badge: p.overlay.badge?.text ?? null, disclosureCaption: p.disclosureCaption?.text ?? null, descriptionFirstLine: String(meta.description ?? "").split("\n")[0] ?? "" }, { affiliate: meta.affiliate, adDisclosure: meta.adDisclosure === true });
  axes.push(axis("disclosure", d.ok, d.detail));
  /* duration_fit — 길이 ≤ maxSeconds+1s · ≥ 60% · 🔴 **컨테이너와 영상 트랙이 갈라지지 않았는가**.
     2026-09-14 C 수리: 종전엔 러너가 보낸 `durationMs`(= 인코딩에 넘긴 `-t` 값)와 그걸로 나눈 `frameCount` 를 견줬다.
     두 값이 같은 식에서 나오니 `|frames − dur×fps|` 는 **항상 참인 항등식**이었고, AC-31 의 «정지 화면 + 음악 13초 꼬리»가
     («컨테이너 15s · 영상 12s») 그대로 통과했다 — 심사가 산출물이 아니라 **계획서**를 보고 있었다.
     이제 러너가 `measured:true` 로 ffprobe 실측을 실어 보내면 그 값으로 본다. 안 실려 오면(옛 러너·ffprobe 없음)
     길이 규격만 보고 **꼬리 판정은 보류**한다 — 통과도 실패도 아니다(AC-9: 못 재는 것을 «괜찮다»로 접지 않는다). */
  if (report) {
    const dur = n(report.durationMs); const okDur = dur > 0 && dur <= (p.out.maxSeconds + 1) * 1000 && dur >= p.out.maxSeconds * 1000 * 0.6;
    const measured = report.measured === true;
    const containerMs = n(report.containerMs); const videoMs = n(report.videoMs) || dur;
    const tailMs = measured && containerMs > 0 ? containerMs - videoMs : 0;
    const okTail = !measured || tailMs <= TAIL_TOLERANCE_MS;
    const detail = !okDur ? `길이 ${Math.round(dur / 100) / 10}s(규격 ${Math.round(p.out.maxSeconds * 0.6)}~${p.out.maxSeconds}s)`
      : !okTail ? `컨테이너 ${(containerMs / 1000).toFixed(2)}s 가 영상 ${(videoMs / 1000).toFixed(2)}s 보다 ${(tailMs / 1000).toFixed(2)}s 길어요 — 끝에 정지 화면이 붙어 있어요`
        : measured ? undefined : "러너가 잰 값이 아니라 계획값 — 꼬리 판정 보류(러너 ffprobe 필요)";
    axes.push(pendingIf(axis("duration_fit", okDur && okTail, detail), !measured));   // 꼬리(컨테이너−영상)를 못 쟀다 → 통과 표시를 하지 않는다
    /* frames_not_blank — 🔴 **바이트 크기로 «빈 영상»을 의심하지 않는다**(B2 실측: 단색 6초 mp4 = 31KB · H.264 는 디테일이 없으면 그만큼만 쓴다).
       예전 기준(>150KB)은 저디테일 실사(단색 배경 토킹 컷)의 멀쩡한 영상을 P0 로 죽였다.
       판정은 **프레임이 실제로 있는가**(길이 + 프레임 수)로 하고, 바이트는 «헤더만 있는 파일»(8KB 미만)만 거른다. */
    const bytes = n(report.bytes); const frameCount = n(report.frameCount);
    const headerOnly = bytes > 0 && bytes < 8_000;
    /* 🔴 프레임 수는 **실측일 때만** 판정에 쓴다(2026-09-14 C 수리). 계획값은 `dur/1000×fps` 라 «10장 미만»이 영영 안 나온다 —
       조건이 있는데 이빨이 없는 상태였다. 실측이 오면 그 두 조건이 그때 비로소 산다. */
    const noFrames = dur <= 0 || (measured && frameCount > 0 && frameCount < 10);
    const framesShort = measured && frameCount > 0 && videoMs > 0 && frameCount < Math.floor((videoMs / 1000) * p.out.fps * 0.5);
    axes.push(pendingIf(axis("frames_not_blank", !headerOnly && !noFrames && !framesShort,
      headerOnly ? `파일 ${bytes}B — 헤더만 있는 파일(빈 영상)`
        : noFrames ? (dur <= 0 ? "길이 0 — 프레임이 없음" : `프레임 ${frameCount}장 — 빈 영상`)
          : framesShort ? `프레임 ${frameCount}장 — ${(videoMs / 1000).toFixed(1)}초 ${p.out.fps}fps 에 한참 못 미쳐요(끊긴 인코딩)`
            : measured ? undefined : "프레임 수가 계획값 — 판정 보류(러너 ffprobe 필요)"), !measured));
  }
  return { axes, repairedPayload: repaired };
}

/* ═══ 비전 축(포스터 + 컷 대표 프레임) ═══ */
async function visionAxes(tenantId: number, pieceId: number, keys: string[]): Promise<{ axes: JudgeAxis[]; blind: boolean; grayHash?: string }> {
  if (videoStub()) { void recordAiUsage({ tenantId, purpose: "video_judge", model: "stub", inTokens: 0, outTokens: 0, costUsd: 0, ref: `piece:${pieceId}:judge` }); /* 스텁은 **판정한 게 아니다** — 보류로 표시해 하니스 초록이 «증거»로 둔갑하지 않게 한다(#9 «하니스 green ≠ 증거»). */
    return { axes: [pendingIf(axis("text_broken", true, "스텁 — 실제 판정 아님"), true), pendingIf(axis("black_margin", true, "스텁 — 실제 판정 아님"), true), pendingIf(axis("frames_not_blank", true, "스텁 — 실제 판정 아님"), true)], blind: false }; }
  /* [R8 · §3.3] 🔴 키는 `lib/ai-key.ts` 가 고른다 — 글·사진과 **같은 풀**이라 한쪽이 맞은 429 를 여기서도 안다. */
  const lease = leaseAiKey();
  const apiKey = lease?.key ?? "";
  const parts: Record<string, unknown>[] = [];
  for (const k of keys.slice(0, 4)) { const obj = await r2Get(k); if (obj) parts.push({ inlineData: { mimeType: obj.contentType.startsWith("image/") ? obj.contentType : "image/jpeg", data: Buffer.from(obj.bytes).toString("base64") } }); }
  if (!apiKey || !parts.length) return { axes: [], blind: true };
  parts.push({ text: "You are judging frames from a Korean vertical short video. Answer JSON only: { \"textBroken\": boolean (any garbled/fake Korean glyphs or unreadable letters baked into the picture), \"blackMargin\": boolean (black letterbox bars or large empty black areas), \"blank\": boolean (frame is blank/solid/uniform), \"uiOverlap\": boolean (captions or badge overlap the top 220px or bottom 300px zone), \"notes\": string }" });
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 40_000);
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_VISION}:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1024 + 2048, thinkingConfig: { thinkingBudget: 2048 } } }) });
    if (!resp.ok) {
      /* 🔴 429 면 그 키를 쉬게 한다 — 안 알려 주면 로테이션이 장식이 된다. 그 밖(503·500)은 키 탓이 아니다. */
      reportAiKeyOutcome(lease, isRateLimitReason(`gemini_error_${resp.status}`) ? "rate_limited" : "error");
      return { axes: [], blind: true };
    }
    reportAiKeyOutcome(lease, "ok");
    const data = (await resp.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();   // AC-26: parts 전체를 잇는다(사고 파트 뒤에 본문)
    void recordAiUsage({ tenantId, purpose: "video_judge", model: MODEL_VISION, inTokens: data.usageMetadata?.promptTokenCount ?? 0, outTokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0), costUsd: JUDGE_COST_USD, ref: `piece:${pieceId}:judge` });
    if (!text) return { axes: [], blind: true };
    let j: Record<string, unknown> = {}; try { j = JSON.parse(text.replace(/^```[a-z]*\s*|\s*```$/g, "")); } catch { return { axes: [], blind: true }; }
    return { axes: [axis("text_broken", j.textBroken !== true, j.textBroken === true ? String(j.notes ?? "깨진 글자") : undefined), axis("black_margin", j.blackMargin !== true, j.blackMargin === true ? "검은 여백" : undefined), axis("frames_not_blank", j.blank !== true, j.blank === true ? "빈 프레임" : undefined), axis("safe_area", j.uiOverlap !== true, j.uiOverlap === true ? "자막·배지가 UI 영역과 겹침(비전)" : undefined)], blind: false };
  } catch { return { axes: [], blind: true }; }
  finally { clearTimeout(t); }
}

/**
 * 계정 간 프레임 지문 비교(§1.9 · §6.2 «중복 업로드 판정 회피» · §16B.3 유튜브 반복 콘텐츠).
 *
 *   ══ [R7 §1.5] 종전엔 «지문 없음 = 통과» 였다 ══
 *     러너가 지문을 한 번도 보낸 적이 없어서(`runner/channels/render-video.mjs` 전송 0 · 2026-09-15 설계감사 19번)
 *     이 축은 **늘 초록이었다**. 게이트가 있는데 아무것도 막지 않는 상태 — 있는 줄 알고 안심하는 게 더 나쁘다.
 *     이제 셋을 가른다:
 *       ① 지문이 있다        → 실제로 잰다(해밍 거리)
 *       ② 지문이 없는데 견줄 상대도 없다 → **진짜 통과**(겹칠 대상이 아예 없다 — 못 잰 게 아니다)
 *       ③ 지문이 없는데 견줄 상대는 있다 → **판정 보류**(AC-33 · «없음»을 «괜찮음»으로 접지 않는다)
 */
async function similarityAxis(tenantId: number, pieceId: number, accountId: number | null, fp: { gray?: string | null; phash?: string | null }): Promise<JudgeAxis> {
  /* 내 지문 — 러너가 그레이를 보냈으면 여기서 해시하고, 이미 해시해서 보냈으면 그걸 쓴다(둘 중 하나면 된다). */
  let hash = "";
  if (fp.gray) { const g = Buffer.from(fp.gray, "base64"); if (g.length >= 1024) hash = phashFromGray32(g); }
  if (!hash && fp.phash && /^[0-9a-f]{16}$/i.test(String(fp.phash))) hash = String(fp.phash).toLowerCase();

  /* 견줄 상대 — 같은 테넌트의 **다른 계정** 최근 14일 영상.
     🔴 계정이 없는 영상(§1.2 수동 «만들기»)은 뺄 계정 자체가 없다 — 그때는 테넌트의 다른 영상 전부와 견준다.
        `account_id IS DISTINCT FROM NULL` 은 NULL 끼리를 «같다»로 보아 **다른 무계정 영상을 통째로 건너뛴다**(= 손으로 올리는 사람은 검사를 못 받는다). */
  const scope = accountId ? sql`AND account_id IS DISTINCT FROM ${accountId}` : sql``;
  const others = await q(sql`SELECT id, meta->>'frameHash' AS h FROM pieces
    WHERE tenant_id = ${tenantId} AND kind = 'video' AND id <> ${pieceId} ${scope}
      AND created_at > NOW() - interval '14 days' ORDER BY id DESC LIMIT 50`);

  if (!hash) {
    // ② 견줄 상대가 없으면 못 잰 게 아니라 **겹칠 일이 없는 것**이다 — 보류로 겁주지 않는다.
    if (!others.length) return axis("similarity", true, "견줄 다른 계정 영상이 없어요");
    // ③ 상대는 있는데 내 지문이 없다 — 판정 보류.
    return pendingIf(axis("similarity", true, `영상 지문이 오지 않아 못 쟀어요(견줄 영상 ${others.length}편) — 내 PC 프로그램이 대표 프레임을 보내야 잽니다`), true);
  }

  await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ frameHash: hash })} WHERE id = ${pieceId}`);
  const withHash = others.filter((o) => o.h);
  if (!withHash.length) {
    // 내 지문은 있는데 상대 지문이 하나도 없다 — 견줄 게 없으니 이번엔 잴 수 없다(다음 영상부터 이어진다).
    return others.length
      ? pendingIf(axis("similarity", true, `견줄 영상 ${others.length}편에 아직 지문이 없어요 — 다음 영상부터 견줍니다`), true)
      : axis("similarity", true, "견줄 다른 계정 영상이 없어요");
  }
  let best: { id: number; d: number } | null = null;
  for (const o of withHash) { const d = hammingHex(hash, String(o.h)); if (!best || d < best.d) best = { id: n(o.id), d }; }
  const tooClose = !!best && best.d <= PHASH_SIMILAR_MAX_DISTANCE;
  return axis("similarity", !tooClose,
    tooClose ? `다른 계정 영상 #${best!.id} 과 프레임 지문 거리 ${best!.d}(≤${PHASH_SIMILAR_MAX_DISTANCE}) — 훅·팔레트를 바꿔 다시 만들어 주세요`
      : `가장 가까운 영상과 거리 ${best!.d}(기준 >${PHASH_SIMILAR_MAX_DISTANCE} · ${withHash.length}편과 견줌)`);
}

/** judgeVideo(pieceId) — 계약 §5. piece.meta.render(페이로드)·piece_assets(video/thumb)·meta 로 판정. 수리된 페이로드는 meta.render 에 다시 넣는다. */
export async function judgeVideo(pieceId: number): Promise<JudgeResult> {
  const [p] = await q(sql`SELECT tenant_id, account_id, meta FROM pieces WHERE id = ${pieceId} AND kind = 'video'`);
  if (!p) return { grade: "P0", pass: false, axes: [axis("frames_not_blank", false, "piece 없음")], repaired: false };
  const tid = n(p.tenant_id); const meta = (p.meta || {}) as Record<string, unknown>;
  const payload = (meta.render ?? null) as RenderPayload | null;
  if (!payload) return { grade: "P0", pass: false, axes: [axis("frames_not_blank", false, "렌더 페이로드 없음")], repaired: false };
  const assets = await q(sql`SELECT kind, r2_key, meta FROM piece_assets WHERE piece_id = ${pieceId} AND kind IN ('video','thumb','clip') ORDER BY kind, sort`);
  const video = assets.find((a) => a.kind === "video"); const thumb = assets.find((a) => a.kind === "thumb");
  const vmeta = (video?.meta ?? {}) as Record<string, unknown>;
  const det = judgePayloadDeterministic(payload, meta, video
    ? { durationMs: n(vmeta.durationMs), bytes: n(vmeta.bytes), frameCount: n(vmeta.frameCount),
        // 실측이 실려 있으면 그대로 넘긴다 — 없으면 넘기지 않는다(계획값을 잰 값인 척 하지 않는다 · AC-9)
        ...(vmeta.measured === true ? { containerMs: n(vmeta.containerMs), videoMs: n(vmeta.videoMs), audioMs: n(vmeta.audioMs), measured: true } : {}) }
    : null, String(meta.hook ?? ""));
  const vis = await visionAxes(tid, pieceId, [thumb?.r2_key, ...assets.filter((a) => a.kind === "clip").slice(0, 2).map((a) => a.r2_key)].filter(Boolean).map(String));
  const sim = await similarityAxis(tid, pieceId, p.account_id ? n(p.account_id) : null, { gray: String(vmeta.thumbGray ?? "") || null, phash: String(vmeta.framePhash ?? "") || null });
  // 비전이 결정론 축(safe_area·frames_not_blank)과 겹치면 «둘 중 실패»를 채택 — 비전 불능이면 결정론만
  const byKey = new Map<string, JudgeAxis>();
  for (const a of det.axes) byKey.set(a.key, a);
  for (const a of vis.axes) { const cur = byKey.get(a.key); byKey.set(a.key, cur && !cur.pass ? cur : a); }
  byKey.set("similarity", sim);
  // [R7 §1.5] 비전이 못 돌았으면 그 축은 **보류**다 — 종전엔 사유만 달고 초록으로 보였다(AC-33 «없음»을 «괜찮음»으로 접지 않는다).
  if (vis.blind) { for (const k of ["text_broken", "black_margin"]) if (!byKey.has(k)) byKey.set(k, pendingIf(axis(k, true, VISION_BLIND_REASON), true)); }
  const axes = ["hook_first", "safe_area", "reading_time", "text_broken", "black_margin", "frames_not_blank", "cut_rhythm", "forbidden", "disclosure", "duration_fit", "similarity"].map((k) => byKey.get(k)).filter((a): a is JudgeAxis => !!a);
  const fails = axes.filter((a) => !a.pass);
  const grade: JudgeGrade = fails.some((a) => a.grade === "P0") ? "P0" : fails.some((a) => a.grade === "P1") ? "P1" : fails.length ? "P2" : "P2";
  const pass = !fails.some((a) => a.grade === "P0");   // 3등급: P0 만 차단 · P1/P2 는 기록하고 통과
  const repaired = !!det.repairedPayload;
  if (repaired) await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ render: det.repairedPayload })} WHERE id = ${pieceId}`);
  return { grade, pass, axes, repaired };
}
