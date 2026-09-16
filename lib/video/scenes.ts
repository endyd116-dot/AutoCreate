/**
 * lib/video/scenes.ts — 컷 계획(문장→컷 창) · 컷 프롬프트 계약(SUBJECT/STYLE/COLOR/CAMERA BEAT · 채록본) · 충돌 점검 · 키워드. 전부 순수.
 *   AM 원본: ../AutoMarketing/lib/shorts-scenes.ts (복사 2026-09-15 · 원본 832232bbd 2026-09-08 · 1,411줄 중 계약 핵심 이식: planGraphicCutWindows·buildGraphicShotPrompt·checkCutConflicts·stripKoreanParticle·bakedWordOk·cameraGrammarRule·applyStyleMode)
 *   뺀 것: 붉은 표식 라벨 도해(VIDEOFIT·SURPASS 층 — 지식쇼츠 전용) · 공간 지문 · 밴딧 오프너(hookType 로 대체). 실측 수리 이력(글자 요구 무해화·«»꺾쇠 글리프·하드컷 요구형·인물 캐스팅 고정)은 보존.
 *   🔴 무인물·무텍스트·무로고 규칙(DESIGN §5C.3·§19) — 한글은 «새길 낱말 1개» 예외만. 인물은 스타일라이즈드/실루엣 또는 «한국 성인 · 전 컷 같은 캐스팅».
 */
import { PALETTE_LABELS_KO, HOOK_LABELS_KO, type CutPlan, type ClipTier, type ScriptLine, type VideoFormat, type VideoSeconds } from "./types";

export const GRAPHIC_CUT_SEC = 8;
export const CUT_MIN_MS = 1800;
export const DEFAULT_GRAPHIC_STYLE = "semi-stylized 3D architectural visualization, halfway low-poly and photoreal, matte, no mirror gloss, soft studio daylight";
export const DEFAULT_GRAPHIC_COLOR = "rich and clean palette, no gray wash";
export const WORLD_CAST_CLAUSE = "every human figure is a Korean adult";
export const PUNCH_IN_ZOOM = 1.15;
/** 팔레트 후보(다계정 변주 COLOR 절 · 계약 §1.1 variant.palette). */
export const PALETTES = ["warm terracotta and cream", "cool teal and off-white", "deep navy and amber", "sage green and sand", "charcoal and coral"] as const;
/** 훅 연출 후보(계약 §1.1 variant.hookType · AM SHORTS3 오프너 3종 + 대본 훅 유형). */
export const HOOK_TYPES = ["event_pushin", "number_typo", "extreme_closeup", "question", "contrast"] as const;

export type StyleMode = "graphic" | "hybrid" | "photoreal";
const PERSON_SIGNAL = /\b(person|people|man|woman|figure|character|worker|student|mom|dad|kid|child)\b/i;
const STYLIZED_SIGNAL = /\b(stylized|silhouette|low-poly|from behind|back view|faceless|3d character)\b/i;
/** 🔴 `reference-apply.ts` 도 이 잣대를 쓴다 — 레퍼런스가 배워 온 규칙을 **여기와 다른 목록**으로 거르면 그게 AC-57 이다. */
export const P0_LIKENESS = /\b(celebrity|actor|actress|idol|president|famous|look-alike|lookalike)\b|유명인|연예인|배우|아이돌|대통령|닮은/i;
const P0_PHOTOREAL_PERSON = /\b(photoreal(istic)? (person|people|face)|real (person|face)|close-up of (a|the) face)\b/i;
/** 🔴 위와 같은 이유로 내보낸다(레퍼런스 규칙 거르기). */
export const TEXT_SIGNAL = /\b(text|letters?|logo|brand name|signage|sign board|caption|subtitle)\b|글자|로고|간판|문구|자막/i;
const TEXT_DEMAND_KILL_RE = /(본문|문단|설명문|자막|캡션|장문|줄글|paragraphs?|sentences?|articles?|document ?text|body ?copy|captions?|subtitles?|transcripts?|prose)/i;

export interface CutRisk { level: "p0" | "high" | "warn"; issue: string }
export interface CutDraft { key: string; subject: string; palette?: string; redMeasureLine?: boolean; redProp?: boolean; pace?: "fast" | "normal" | "hold" }

/* ═══ 문장 → 컷 창 ═══ */
/** planCutWindows — 문장 실측 시각(TTS) + 컷 키 → 컷 창. 같은 cutKey 연속 = 한 창 · 1.8초 미만은 앞에 흡수 · 8초 초과는 문장 경계에서 쪼갬. */
export function planCutWindows(lines: (Pick<ScriptLine, "idx" | "cutIdx"> & { startMs: number; endMs: number })[]): { idx: number; lineIdx: number[]; startMs: number; endMs: number }[] {
  const sorted = [...lines].sort((a, b) => a.startMs - b.startMs);
  const wins: { idx: number; lineIdx: number[]; startMs: number; endMs: number }[] = [];
  for (const l of sorted) {
    const last = wins[wins.length - 1];
    const sameKey = last && sorted.find((x) => x.idx === last.lineIdx[last.lineIdx.length - 1])?.cutIdx === l.cutIdx;
    if (last && sameKey && l.endMs - last.startMs <= GRAPHIC_CUT_SEC * 1000) { last.lineIdx.push(l.idx); last.endMs = l.endMs; continue; }
    wins.push({ idx: wins.length, lineIdx: [l.idx], startMs: l.startMs, endMs: l.endMs });
  }
  // 짧은 창(<1.8s) 은 앞 창에 흡수(첫 창은 뒤와 합침)
  for (let i = wins.length - 1; i >= 0; i--) {
    if (wins[i].endMs - wins[i].startMs >= CUT_MIN_MS || wins.length === 1) continue;
    if (i > 0) { wins[i - 1].lineIdx.push(...wins[i].lineIdx); wins[i - 1].endMs = wins[i].endMs; wins.splice(i, 1); }
    else { wins[1].lineIdx.unshift(...wins[0].lineIdx); wins[1].startMs = wins[0].startMs; wins.splice(0, 1); }
  }
  return wins.map((w, i) => ({ ...w, idx: i }));
}
export function cutDurationSec(startMs: number, endMs: number): number { return Math.max(2, Math.min(GRAPHIC_CUT_SEC, Math.ceil((endMs - startMs) / 1000))); }

/* ═══════════ [R12-4] 컷당 초 **하한** ═══════════
 *
 *   설계(R12 §5): 컷 길이의 **하한**만 받는다(«이 컷은 최소 2초는 보여 줘»). 🔴 **나레이션을 이긴다는 뜻이 아니다** —
 *   나레이션이 더 길면 나레이션이 이긴다. 까닭: **컷이 나레이션보다 짧으면 말이 잘린다**(되돌릴 수 없는 종류의 나쁨).
 *   ⇒ 우리는 **늘리기만 하고 줄이지 않는다.**
 *
 *   🔴 **무회귀**: `floorMs` 가 없거나 0 이면 **들어온 것을 그대로 돌려준다**(같은 객체 모양·같은 숫자).
 *      값이 와도 늘릴 창이 하나도 없으면 역시 그대로다 — «칸을 열었더니 영상이 달라졌다»가 없어야 한다.
 *
 *   🔴 **무엇이 같이 움직이나**: 창을 늘리면 뒤 창이 밀리고, **그 창의 문장도 같이 밀려야** 한다.
 *      안 밀면 다음 컷의 나레이션이 **앞 컷 그림 위에서** 들린다(자막·음성·그림이 갈라진다).
 *      늘어난 몫은 창 **끝**에 붙는다 — 말이 끝난 뒤 그 장면에 더 머무는 것이지, 말을 늦추는 것이 아니다.
 *
 *   🔴 **하한을 다 더해 규격을 넘으면 하한을 통째로 버린다**(설계 §5). 반 만 거는 것은 «장면을 더 보여 준다»도
 *      «규격을 지킨다»도 아니어서, 어느 쪽 약속도 못 지킨 상태가 된다. 버렸다는 사실은 `why` 로 돌려준다(AC-9).
 */

/** 하한의 천장 — 컷 하나가 머물 수 있는 최대(=`GRAPHIC_CUT_SEC`). 이보다 큰 하한은 여기서 잘린다(상한을 두 벌로 두지 않는다). */
export const CUT_FLOOR_MAX_MS = GRAPHIC_CUT_SEC * 1000;

export interface CutFloorLine { idx: number; startMs: number; endMs: number }
export interface CutFloorWindow { idx: number; lineIdx: number[]; startMs: number; endMs: number }
export interface CutFloorResult {
  windows: CutFloorWindow[];
  lines: CutFloorLine[];
  /** 실제로 걸린 하한(ms). 🔴 안 걸었으면 `null` — 0 으로 메우지 않는다(«안 걸었다»와 «0 을 걸었다»는 다르다 · AC-92). */
  appliedMs: number | null;
  /** 🔴 사람말 — 못 건 이유. 걸었거나 애초에 안 받았으면 `null`. */
  why: string | null;
}

/**
 * 컷 하한 적용. 🔴 **순수**(입력을 안 고친다 — 새 배열을 돌려준다).
 * @param windows `planCutWindows` 산출
 * @param lines   문장 실측 시각(창과 같은 타임라인)
 * @param floorMs 컷 하한. 없음·0·NaN = 아무것도 안 한다
 * @param capMs   규격(15/30/60초 → ms). 늘린 합이 이걸 넘으면 **통째로 버린다**
 */
export function applyCutFloor(
  windows: CutFloorWindow[],
  lines: CutFloorLine[],
  floorMs: unknown,
  capMs: number,
): CutFloorResult {
  const keep = (why: string | null, appliedMs: number | null): CutFloorResult => ({
    windows: windows.map((w) => ({ ...w, lineIdx: [...w.lineIdx] })),
    lines: lines.map((l) => ({ ...l })),
    appliedMs, why,
  });

  const raw = Number(floorMs);
  if (!Number.isFinite(raw) || raw <= 0) return keep(null, null);        // 🔴 무회귀 자리 — 안 받으면 손도 안 댄다
  const floor = Math.min(CUT_FLOOR_MAX_MS, Math.round(raw));
  if (!windows.length) return keep(null, null);

  const ordered = [...windows].sort((a, b) => a.startMs - b.startMs);
  const needs = ordered.map((w) => Math.max(0, floor - (w.endMs - w.startMs)));
  if (!needs.some((n) => n > 0)) return keep(null, floor);               // 걸 것이 없다 = 이미 다 하한보다 길다

  const total = ordered[ordered.length - 1].endMs + needs.reduce((a, b) => a + b, 0);
  const cap = Math.max(1000, Math.round(Number(capMs) || 0));
  if (total > cap) {
    return keep(
      `장면을 ${Math.round(floor / 100) / 10}초씩 보여 달라고 하셨는데, 그러면 ${Math.round(total / 100) / 10}초가 되어 ${Math.round(cap / 1000)}초를 넘어서 못 했어요.`,
      null,
    );
  }

  /* 창마다 «그 창이 시작되기 전까지 밀린 몫»을 적어 둔다 — 문장도 그 몫으로 같이 민다. */
  const shiftOfLine = new Map<number, number>();
  const outWindows: CutFloorWindow[] = [];
  let shift = 0;
  for (const [i, w] of ordered.entries()) {
    const dur = w.endMs - w.startMs;
    for (const li of w.lineIdx) shiftOfLine.set(li, shift);
    outWindows.push({ idx: i, lineIdx: [...w.lineIdx], startMs: w.startMs + shift, endMs: w.startMs + shift + dur + needs[i] });
    shift += needs[i];
  }
  /* 🔴 창에 안 들어간 문장은 **그대로 둔다**(못 본 것을 옮기면 조용히 어긋난다). 정상 경로에서는 0건이다. */
  const outLines = lines.map((l) => { const d = shiftOfLine.get(l.idx) ?? 0; return { ...l, startMs: l.startMs + d, endMs: l.endMs + d }; });
  return { windows: outWindows, lines: outLines, appliedMs: floor, why: null };
}

/* ═══ 키워드(중앙 대형 자막 재료) ═══ */
const TAILS = ["으로부터", "에서는", "에게서", "이라는", "라는", "에서", "부터", "까지", "처럼", "보다", "마다", "조차", "밖에", "으로", "에게", "한테", "이나", "라도", "인데", "이며", "이고", "이라", "은데", "는데", "을", "를", "이", "가", "은", "는", "의", "에", "도", "와", "과", "만", "로", "며", "고", "라"];
export function stripKoreanParticle(word: string): string | null {
  const w = String(word ?? "").trim(); if (!w) return null;
  if (!/[가-힣]$/.test(w)) return w;
  for (const t of TAILS) { if (w.length > t.length + 1 && w.endsWith(t)) { const body = w.slice(0, -t.length); if ([...body].length >= 2) return body; } }
  if (/[해되하니며어아주서게밖]$/.test(w) && [...w].length <= 4) return null;
  return w;
}
export function extractSceneKeyword(text: string): string | null {
  const words = String(text ?? "").replace(/[^가-힣0-9A-Za-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const cands = words.map(stripKoreanParticle).filter((w): w is string => !!w && [...w].length >= 2 && [...w].length <= 6);
  if (!cands.length) return null;
  return cands.sort((a, b) => b.length - a.length)[0];
}
/** 그림에 새길 낱말 규칙(AM §7 B4): ≤4음절 한글 또는 «숫자+단위» ≤5자. */
export function bakedWordOk(word: unknown): boolean {
  const w = String(word ?? "").trim(); if (!w) return false;
  if (/^[가-힣]{1,4}$/.test(w)) return true;
  return /^\d{1,3}[가-힣A-Za-z%]{1,2}$/.test(w) && [...w].length <= 5;
}

/* ═══ 프롬프트 계약 ═══ */
export function applyStyleMode(style: string, mode: StyleMode): string {
  const base = String(style ?? "").replace(/,?\s*halfway low-poly and photoreal/gi, "").replace(/\bphotoreal(istic)?\b,?/gi, "").replace(/\s{2,}/g, " ").trim();
  if (mode === "photoreal") return `${base}, photoreal 3D render, cinematic daylight, atmospheric depth, natural skin and fabric (no celebrity likeness)`;
  if (mode === "hybrid") return `${base}, photoreal people and environments (cinematic daylight, natural skin and fabric, no celebrity likeness) — but every information layer (labels, dimension lines, diagrams, engraved words, UI chips) is flat clean graphics`;
  return `${base}, stylized 3D render with a clean low-poly / clay look, matte materials, simplified stylized human figures (no photorealistic skin, no real faces) — NOT photographic, NOT live-action`;
}
export function defuseTextDemand(rule: string): string {
  const s = String(rule ?? ""); if (!TEXT_DEMAND_KILL_RE.test(s)) return s;
  return s.replace(TEXT_DEMAND_KILL_RE, "shapes") + " (form only — no readable text)";
}
function splitCutBeats(durationSec: number, pace?: "fast" | "normal" | "hold" | null): number[] {
  const d = Math.max(2, Math.round(durationSec));
  const per = pace === "fast" ? 2 : pace === "hold" ? 4 : 3;
  const n = Math.max(1, Math.min(4, Math.round(d / per)));
  const base = Math.floor(d / n); const rest = d - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}
export function cameraGrammarRule(durationSec: number, pace?: "fast" | "normal" | "hold" | null): string {
  const beats = splitCutBeats(durationSec, pace).length;
  return `CAMERA GRAMMAR: cut ${beats} times inside this shot as instructed above — every cut is an instant change of camera setup, never a slow drift. Within each cut move laterally only (lateral dolly, no crane, no orbit). End the shot with a rapid push-in close-up of about ${PUNCH_IN_ZOOM}x.`;
}

export interface ShotPromptOpts { durationSec?: number; isHook?: boolean; hookType?: string | null; bakedWord?: string | null; styleMode?: StyleMode | null; palette?: string | null; endcard?: boolean;
  /* ── [R8CLOSE · B2] 레퍼런스가 배워 온 것이 들어오는 자리(없으면 종전과 **한 글자도 안 달라진다**) ── */
  /** STYLE 절 바탕 — 비면 `DEFAULT_GRAPHIC_STYLE`. */
  styleBase?: string | null;
  /** RULES 절에 덧붙는다(≤6 · 이미 `reference-apply` 가 안전 규칙과 싸우는 것을 걸렀다). */
  extraRules?: string[] | null;
  /** 컷 안 비트 수 — 🔴 **컷 자신의 pace 가 먼저다**(대본 모델이 그 컷을 보고 정한 값이라 더 구체적이다). */
  pace?: "fast" | "normal" | "hold" | null;
}

/** buildShotPrompt — 컷 1개 → t2v 프롬프트(채록 계약: SUBJECT → STYLE → COLOR IS RICH AND CLEAN → CAMERA BEAT → 규칙). */
export function buildShotPrompt(cut: CutDraft, opts: ShotPromptOpts = {}): string {
  const mode: StyleMode = opts.styleMode ?? "graphic";
  /* 🔴 레퍼런스가 배워 온 그림 스타일이 있으면 그것이 바탕이다 — 이 한 줄이 «배워 놓고 안 읽는다»를 끝낸다. */
  const style = defuseTextDemand(applyStyleMode(String(opts.styleBase ?? "").trim() || DEFAULT_GRAPHIC_STYLE, mode));
  const palette = String(opts.palette ?? cut.palette ?? "").trim();
  const color = defuseTextDemand(palette ? `${palette}, ${DEFAULT_GRAPHIC_COLOR}` : DEFAULT_GRAPHIC_COLOR);
  const dur = Math.max(2, Math.min(GRAPHIC_CUT_SEC, Math.round(Number(opts.durationSec) || GRAPHIC_CUT_SEC)));
  const twoBeats = dur >= 4; const isHook = opts.isHook === true; const mid = Math.min(2, Math.max(1, Math.round(dur * 0.3)));
  let subject = String(cut.subject ?? "").trim();
  if (PERSON_SIGNAL.test(subject)) {
    if (mode === "graphic") subject += STYLIZED_SIGNAL.test(subject) ? " — keep every human figure stylized (no photorealistic skin, no live-action look)" : " — all human figures as stylized 3D characters, silhouette or back view only, no realistic faces";
    else subject += ` — ${WORLD_CAST_CLAUSE}, consistent casting in every shot of this piece, natural skin, no celebrity likeness`;
  }
  /* 컷 자신의 pace(대본 모델) → 없으면 레퍼런스 pace. 둘 다 없으면 종전과 같은 기본 호흡이다. */
  const pace = cut.pace ?? opts.pace ?? null;
  const baked = bakedWordOk(opts.bakedWord) ? String(opts.bakedWord).trim() : "";
  const lines: string[] = [`SUBJECT: ${subject}`, `STYLE: ${style}`, `COLOR IS RICH AND CLEAN: ${color}`];
  if (baked) {
    lines.push(`TYPOGRAPHY: Render ONE Korean word as large bold letter-spaced letters (3D standing in the scene or flat over it), matte, same lighting, casting soft shadow, kept in the upper two thirds of the frame. The word is exactly these ${[...baked].length} characters and nothing else: ${baked}`);
    lines.push("TYPOGRAPHY RULE: draw the characters only — no quotation marks, no guillemets, no angle brackets, no frame or box around them.");
  }
  const opener = isHook ? (opts.hookType ?? "event_pushin") : null;
  if (twoBeats) {
    if (isHook) {
      if (opener === "number_typo") { lines.push(baked ? `CAMERA, BEAT ONE (0-${mid}s): the very first frame is the word ${baked} filling the frame, absolutely still — no camera move at all` : `CAMERA, BEAT ONE (0-${mid}s): the very first frame is one stark graphic form filling the frame, absolutely still — no camera move at all`); lines.push(`CAMERA, BEAT TWO (${mid}s-${dur}s): sudden fast push-in past it into the scene behind`); }
      else if (opener === "extreme_closeup") { lines.push(`CAMERA, BEAT ONE (0-${mid}s): extreme macro close-up — the texture fills the whole frame, the subject is unrecognisable at first`); lines.push(`CAMERA, BEAT TWO (${mid}s-${dur}s): rapid pull-back to a wide shot revealing the whole scene at once — the wide shot must land on a recognisable subject (a person, a place, an object), never on bare abstract texture`); }
      else if (opener === "contrast") { lines.push(`CAMERA, BEAT ONE (0-${mid}s): two halves of the frame show the before and the after side by side, static`); lines.push(`CAMERA, BEAT TWO (${mid}s-${dur}s): rapid push-in into the "after" half`); }
      else { lines.push(`CAMERA, BEAT ONE (0-${mid}s): the event is ALREADY happening in the very first frame — fast push-in toward the point of change, no establishing shot, no slow build`); lines.push(`CAMERA, BEAT TWO (${mid}s-${dur}s): hold tight on the single most striking detail`); }
    } else {
      const pieces = splitCutBeats(dur, pace); let at = 0;
      const plan = pieces.map((s) => { const from = at; at += s; return `${from}-${at}s`; }).join(" | ");
      lines.push(`CAMERA: this shot is edited as EXACTLY ${pieces.length} hard cuts — ${pieces.map((s) => `${s}s`).join(" + ")} (${plan}). A hard cut means the framing changes instantly to a new angle, a new distance or a different part of the scene — it is NOT a dolly, NOT a zoom and NOT a pan.`);
      lines.push(`CAMERA CONTINUITY: keep the same room, the same character, the same wardrobe and the same lighting across all ${pieces.length} cuts — only the camera setup changes. Cut 1 opens with the event already happening; the last cut ends on a rapid push-in close-up of about ${PUNCH_IN_ZOOM}x.`);
    }
  } else lines.push(`CAMERA, ONE BEAT (0-${dur}s): rapid push-in to a close-up — a single camera move, nothing else`);
  const rules: string[] = [baked
    ? `Follow the CAMERA cut count above exactly. No text anywhere in the frame except the single word ${baked} — no other letters, no numerals, no logos, no quotation marks or brackets.`
    : "Follow the CAMERA cut count above exactly. No text, no letters, no numerals, no logos anywhere in the frame."];
  rules.push(cameraGrammarRule(dur, pace));
  if (cut.redMeasureLine && !cut.redProp) rules.push("Red is reserved for measurement guide lines only: draw thin red dimension lines with end ticks; state whether each guide line is fixed or moving.");
  else if (cut.redProp) rules.push("This cut contains a red prop — do NOT draw any red measurement guide lines (red stays exclusive to the prop).");
  else rules.push("Do not use red accents (red is reserved for measurement lines, which this cut does not have).");
  /* 🔴 레퍼런스 규칙은 **여기**다 — 우리 안전 규칙(무인물·무로고)이 **뒤에** 와서 마지막 말이 되게 한다. */
  for (const r of opts.extraRules ?? []) { const x = String(r ?? "").trim(); if (x) rules.push(defuseTextDemand(x)); }
  rules.push("No real people's likeness, no celebrities, no identifiable real faces, no brand logos or trademarks, no watermark.");
  if (opts.endcard) rules.push("This is the END CARD shot: a calm, clean composition with generous empty space in the upper two thirds so a caption can be placed over it later.");
  lines.push(`RULES: ${rules.join(" ")}`);
  return lines.join("\n");
}

/** checkCutConflicts — 컷 서술의 위험(P0 = 생성 0 · high/warn = 원장 기록). */
export function checkCutConflicts(cut: CutDraft, styleMode: StyleMode = "graphic"): CutRisk[] {
  const risks: CutRisk[] = []; const s = String(cut.subject ?? "");
  if (P0_LIKENESS.test(s)) risks.push({ level: "p0", issue: "실존 인물·유명인 얼굴 요구 — 초상권 위반(어느 룩에서도 생성 0)" });
  if (styleMode === "graphic" && P0_PHOTOREAL_PERSON.test(s)) risks.push({ level: "p0", issue: "실사 인물 요구 — 이 편은 그래픽 룩이다" });
  if (cut.redMeasureLine && cut.redProp) risks.push({ level: "high", issue: "빨간 소품 컷에 계측선 요청 — 채록 규칙 충돌(계측선을 끈다)" });
  if (TEXT_SIGNAL.test(s)) risks.push({ level: "high", issue: "피사체 서술에 글자·로고 신호 — no text/logos 계약이 프롬프트에서 강제 제거" });
  if (PERSON_SIGNAL.test(s)) risks.push({ level: "warn", issue: styleMode === "graphic" ? "인물 서술 — 스타일라이즈드/실루엣 절 강제" : `실사 룩 인물 컷 — «${WORLD_CAST_CLAUSE}» 강제` });
  if (!s.trim()) risks.push({ level: "p0", issue: "피사체 서술이 비었다 — 생성 불가" });
  return risks;
}

/** 포맷·초 → 컷 티어(계약 §0.1-1): 15초 = filler(Lite) · graphic 60 = standard(Omni) · money 는 훅·착지 컷만. */
export function tierFor(format: VideoFormat, seconds: VideoSeconds, isHookOrLanding: boolean): ClipTier {
  if (seconds === 15) return "filler";
  if (format === "talking") return "filler";
  return isHookOrLanding ? "money" : "standard";
}

/** 컷 계획 조립(순수) — 창 + 대본 컷 초안 + 변주 → CutPlan[]. */
export function buildCutPlans(a: { windows: { idx: number; lineIdx: number[]; startMs: number; endMs: number }[]; lines: ScriptLine[]; drafts: CutDraft[]; format: VideoFormat; seconds: VideoSeconds; hookType: string; palette: string; bakedWords?: (string | null)[];
  /** [R8CLOSE · B2] 레퍼런스가 배워 온 것 중 **닿는 것만**(`reference-apply.ts applyReferenceStyle`). */
  refStyle?: { style?: string; rules?: string[]; pace?: "fast" | "normal" | "hold" } | null }): { plans: CutPlan[]; risks: { cut: number; risks: CutRisk[] }[] } {
  const plans: CutPlan[] = []; const risks: { cut: number; risks: CutRisk[] }[] = [];
  const byIdx = new Map(a.lines.map((l) => [l.idx, l]));
  /* 토킹 포맷 컷 종류(계약 §1.3 표 그대로): «**B-roll 3~4** · 나머지 정지 이미지».
     🔴 예전 규칙(i%2 = 절반씩)은 표와 달랐다 — 60초 12컷이면 B-roll 이 6개가 되어 원가가 표의 두 배가 된다.
     B-roll 은 첫 컷(훅)과 마지막 컷(엔드카드)을 포함해 **고르게** 흩는다 — 움직이는 그림이 앞뒤와 중간에 하나씩 있어야 정지 구간이 지루하지 않다. */
  const brollAt = new Set<number>();
  if (a.format === "talking") {
    const n = a.windows.length;
    const want = Math.max(1, Math.min(4, Math.min(n, n <= 4 ? Math.ceil(n / 2) : n >= 10 ? 4 : 3)));
    for (let k = 0; k < want; k++) brollAt.add(Math.round((k * (n - 1)) / Math.max(1, want - 1)));
  }
  a.windows.forEach((w, i) => {
    const lead = byIdx.get(w.lineIdx[0]);
    const draft = a.drafts[Math.min(a.drafts.length - 1, lead?.cutIdx ?? i)] ?? a.drafts[i] ?? { key: `cut:${i}`, subject: lead?.text ?? "" };
    const isHook = i === 0; const isLast = i === a.windows.length - 1;
    const r = checkCutConflicts(draft); if (r.length) risks.push({ cut: i, risks: r });
    const mode: CutPlan["mode"] = a.format === "talking" ? (brollAt.has(i) ? "t2v" : "still") : "t2v";
    const keyword = extractSceneKeyword(w.lineIdx.map((li) => byIdx.get(li)?.text ?? "").join(" ")) ?? "";
    plans.push({ idx: i, startMs: w.startMs, endMs: w.endMs, lineIdx: w.lineIdx, keyword, tier: tierFor(a.format, a.seconds, isHook || (isLast && lead?.role === "landing")), mode,
      prompt: buildShotPrompt(draft, { durationSec: cutDurationSec(w.startMs, w.endMs), isHook, hookType: a.hookType, palette: a.palette, bakedWord: a.bakedWords?.[i] ?? null, endcard: isLast, styleBase: a.refStyle?.style ?? null, extraRules: a.refStyle?.rules ?? null, pace: a.refStyle?.pace ?? null }) });
  });
  return { plans, risks };
}

/* 사람말 이름 짝 대조(§13.0) — 프롬프트 문구를 고치고 `types.ts PALETTE_LABELS_KO`·`HOOK_LABELS_KO` 를 안 고치면 화면 칩이 «기본» 으로 떨어진다. 조용히 틀리지 않게 기동 때 알린다. */
for (const p of PALETTES) if (!PALETTE_LABELS_KO[p]) console.error(`[video/scenes] 팔레트 «${p}» 의 사람말 이름이 types.ts PALETTE_LABELS_KO 에 없습니다`);
for (const h of HOOK_TYPES) if (!HOOK_LABELS_KO[h]) console.error(`[video/scenes] 훅 «${h}» 의 사람말 이름이 types.ts HOOK_LABELS_KO 에 없습니다`);
