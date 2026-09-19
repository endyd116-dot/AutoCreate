/**
 * lib/video/script.ts — 쇼츠 대본(포맷 3종) · 3초 훅 게이트 · 광고법/수익 약속/허구 게이트 · 🔴 Google 검색 팩트체크 왕복 · 유튜브 메타. 계약 §1.4-1 · DESIGN §5C.1 대본 계약.
 *   AM 원본: ../AutoMarketing/lib/shorts-script.ts (복사 2026-09-15 · 원본 af3b237c7 2026-09-10 · 1,389줄 중 게이트·왕복·메타 이식: checkHook·hasFactualClaims·unverifiedTokens·correctionLanded·factcheckRoundTrip·buildYoutubeMeta · 지식쇼츠 구조 템플릿 층은 shorts_templates 로 축약)
 *   AM 실측 보존: 팩트체크는 googleSearch(텍스트 모드)로 왕복하고 «검증 불가»가 남으면 정정 1회 → 그래도 남으면 실패(#869 truncated 교훈 → maxOutputTokens 넉넉히) · 착지·브랜드 문장(role landing|closing)은 검색에 보내지 않는다(#881).
 *   출력 = VideoScript(lines·hook·closing·youtube·factcheck) + CutDraft[](컷 서술 · scenes.ts 재료).
 */
import { callGemini, callGeminiJson, parseJsonLoose } from "../ai";
import { CHAIN_DIRECTOR, CHAIN_HIGH } from "../ai-models";
import { findBannedWords, BLOG_EXTRA_BANNED } from "../banned-words";
import { CLICHES } from "../ai-tell-gate";
import { syllablesOf, speechSecondsOf, SPEECH_SYLLABLES_PER_SEC } from "./tts";
import { HOOK_TYPES, type CutDraft } from "./scenes";
import { videoScriptStub, scriptStubHandle, noteVideoStub, type ScriptLine, type VideoFormat, type VideoScript, type VideoSeconds } from "./types";

/* ═══ 게이트(순수) ═══ */
const HOOK_MAX_SYLLABLES = 16;
const HOOK_WEAK_OPENERS = /^(오늘부터|요즘|혹시|여러분|우리|만약|가끔|보통|사실|그런데|그리고|자,|이제|안녕하세요)/;
const HOOK_WEAK_TAIL = /(하지 않나요|않으신가요|일까요|겠죠|시죠)\s*\??$/;
export function checkHook(text: string): { ok: boolean; reason: string | null; syllables: number } {
  const t = String(text ?? "").trim(); const syl = (t.match(/[가-힣]/g) ?? []).length;
  /* 🔴 [2026-09-20] **이 사유도 손님이 읽는다** — `checkScriptGates` 가 그대로 칩에 싣는다(위 주석 참고).
     그래서 «~한다» 체 개발 메모를 **사람말**로 바꿨다. «훅»은 그대로 둔다 — 이미 손님 화면의 낱말이다
     (`create.html`·`director.html`·`piece.html` 이 «훅 «반전»으로 시작» 처럼 쓴다). 뜻은 한 글자도 안 바꿨다. */
  if (!t) return { ok: false, reason: "훅(첫 문장)이 비어 있어요", syllables: 0 };
  if (syl > HOOK_MAX_SYLLABLES) return { ok: false, reason: `훅이 ${syl}음절이라 3초에 안 담겨요 — ${HOOK_MAX_SYLLABLES}음절까지가 알맞아요(배경 설명은 둘째 문장으로 미루면 돼요)`, syllables: syl };
  if (HOOK_WEAK_OPENERS.test(t)) return { ok: false, reason: `훅이 «${t.slice(0, 8)}…»로 시작해요 — 첫마디를 사실이나 숫자로 열면 더 붙잡아요`, syllables: syl };
  if (HOOK_WEAK_TAIL.test(t)) return { ok: false, reason: "훅이 부드러운 질문으로 끝나요 — 단언하거나 의외의 질문으로 바꾸면 더 붙잡아요", syllables: syl };
  return { ok: true, reason: null, syllables: syl };
}
export function hasFactualClaims(lines: { text: string }[]): boolean { return lines.some((l) => /\d/.test(l.text) || /[A-Z][a-z]{2,}/.test(l.text)); }
export function unverifiedTokens(stamp: { claims?: { claim?: string; verdict?: string }[] } | null | undefined): string[] {
  const out = new Set<string>();
  for (const c of stamp?.claims ?? []) { if (c?.verdict !== "unknown") continue; for (const m of String(c.claim ?? "").match(/\d[\d,.]*/g) ?? []) { const t = m.replace(/[,.]+$/, ""); if (t.length >= 2) out.add(t); } }
  return [...out].slice(0, 12);
}
export function correctionLanded(lines: { text: string }[], tokens: string[]): boolean {
  if (!tokens.length) return true;
  const all = (lines ?? []).map((l) => String(l.text ?? "")).join(" ");
  return !tokens.some((t) => all.includes(t));
}
/** 수익 약속(AM INCOME-CLAIM 축) — «금액 + 결과어» 같은 줄 · 관용구. 쇼츠는 매체 정책(오도성)에 바로 걸린다. */
const INCOME_OUTCOME_WORDS = ["벌기", "벌어", "버는", "벌었", "법니다", "버세요", "수익", "수입", "부수입", "순이익", "순익", "차익", "자산", "자산가", "연봉", "월세", "배당", "매출"];
const INCOME_CLAIM_PHRASES = ["경제적 자유", "인생역전", "일확천금", "돈방석", "억대 연봉", "월천만", "노후 걱정 끝", "평생 월급"];
const MONEY_RE = /\d[\d,.]*\s*(?:억|천만|백만|만|천|원)/;
export function findIncomeClaim(lines: { text: string }[]): string | null {
  for (const l of lines) { const t = String(l.text ?? "").trim(); if (!t) continue; const flat = t.replace(/\s+/g, "");
    if (INCOME_CLAIM_PHRASES.some((p) => flat.includes(p.replace(/\s+/g, "")))) return t;
    if (MONEY_RE.test(t) && INCOME_OUTCOME_WORDS.some((w) => flat.includes(w))) return t; }
  return null;
}
/** 대본 전체 게이트(순수) — 훅·금칙어·수익 약속·상투. */
/** [R12-7] 문장 수 상한 — 🔴 기본 **12**(종전 그대로 · 무회귀). 90초만 16 이다(351음절을 12문장에 담으면 한 문장이 29음절이라 계약 «≤28음절»과 싸운다). */
export function maxLinesFor(seconds: number): number { return Number(seconds) === 90 ? 16 : 12; }

/**
 * 🔴 [2026-09-20 · A 가 화면에 그리자 드러났다] **이 문장들은 이제 손님이 그대로 읽는다.**
 *   여태 개발자·모델용 메모였다가 `meta.scriptIssues` 로 검수 화면 칩이 됐다 — 그래서 **§3 말투 규칙이 여기에 걸린다.**
 *   실제로 손님 화면에 이렇게 떴다: 🔴 «문장 수 3(**계약** 4~8)» — «계약»은 시스템 용어다
 *   (9/19 에 `GATE_LABEL` 의 «계약 폭»을 «분량이 알맞음»으로 고친 그 낱말이 **다른 문에서 또 샜다**).
 *   ⇒ 한 문장씩 **사람말**로 고쳤다. 규율(§3·§9):
 *     ① **문장형**으로 — «수익 약속 표현:» 같은 이름표가 아니라 «수익을 약속하는 말이 있어요».
 *     ② **어떻게 하면 되는지**를 붙인다 — 위험만 던지고 끝내지 않는다(§9 «또렷하게 ≠ 겁주기»).
 *     ③ **막지 않는다** — 이건 세는 칸이지 거절하는 칸이 아니다(`gen.ts` 는 `ok` 와 **개수**만 쓴다 · 문장은 안 쓴다).
 *   🔴 **문장을 고쳐도 생성은 안 흔들린다** — 전수로 확인했다: 이 문자열을 프롬프트에 넣는 자리가 없다.
 *      `gen.ts:131~136` 은 `g.ok` 와 `g.issues.length` 만 본다. `judge.ts:128` 은 `checkHook` 의 사유를 쓰는데 거기서도 사람말이 낫다.
 *   🔴 자(`verify-script-issues-shown`)는 이제 **말이 아니라 «검사 호출»** 에 고정한다 — 말은 말투 규칙 때문에 바뀌지만
 *      «검사를 지우지 마라»(§9)는 검사 호출이 있나로 재야 한다(말에 고정하면 말투를 고칠 때마다 빨개진다).
 */
export function checkScriptGates(script: VideoScript, maxLines = 12): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const h = checkHook(script.hook || script.lines[0]?.text || ""); if (!h.ok && h.reason) issues.push(h.reason);
  const all = script.lines.map((l) => l.text).join("\n");
  const banned = findBannedWords(`${script.youtube.title}\n${all}`, BLOG_EXTRA_BANNED);
  if (banned.length) issues.push(`광고법에서 못 쓰는 말이 들어 있어요 — ${banned.join(", ")}. 다른 말로 바꾸면 돼요`);
  const inc = findIncomeClaim(script.lines);
  if (inc) issues.push(`수익을 약속하는 말이 있어요 — «${inc.slice(0, 40)}». 겪은 일로 바꿔 적으면 돼요`);
  const cli = CLICHES.filter((c) => c.re.test(all)).map((c) => c.label);
  if (cli.length) issues.push(`흔한 표현이 있어요 — ${cli.slice(0, 3).join(", ")}. 내 말로 바꾸면 더 잘 읽혀요`);
  const total = script.lines.reduce((a, l) => a + syllablesOf(l.text), 0);
  if (script.lines.length < 4 || script.lines.length > maxLines)
    issues.push(`문장이 ${script.lines.length}개예요 — 4~${maxLines}개가 알맞아요`);
  if (total < 20) issues.push("대본이 너무 짧아요 — 몇 문장 더 있으면 좋아요");
  return { ok: issues.length === 0, issues };
}

/* ═══ 대본 생성(LLM) ═══ */
export interface ScriptInput {
  tenantId: number; pieceId: number; format: VideoFormat; seconds: VideoSeconds; cuts: number; channel: string;
  topic: { title: string; angle: string; intent: string; seasonal?: string };
  /** 🔴 `dict` = 테넌트 읽기 사전의 **열쇠**(= 정본 표기). 소리(`tts.applyReadingDict`)와 **같은 표**를 글자 쪽에서도 쓴다. */
  persona: { facts: string[]; tone?: string; signature?: string; dict?: Record<string, string> | null };
  hookType: string; structure?: string[] | null;
  /** [R8CLOSE · B2] 레퍼런스가 배워 온 «훅이 작동하는 원리»(≤80자 · `TemplateStyle.hookPrinciple`).
      🔴 `hookType` 은 다섯 갈래뿐이라 **왜 그 훅이 먹히는가**를 못 담는다 — 그걸 담으라고 저장해 놓고 **안 읽고 있었다.** */
  hookPrinciple?: string | null;
  affiliate?: { productQuery: string } | null;
  /** 재작성 지시(게이트 실패·팩트체크 정정). */
  rewrite?: string | null;
  /**
   * [R12-3] 🔴 **음절 예산에 곱할 비율** — `lib/video/tempo.ts syllableRatioOf(refStyle?.audioTempo)`.
   *   안 넘기면 **1**(종전과 한 글자도 안 다르다 · 무회귀). 1보다 작으면 «느리게 말한다 ⇒ 대본을 짧게».
   *   🔴 규격(15/30/60/90)을 넘는지 **여기서 판정하지 않는다** — 그건 실제 음성 길이를 잰 뒤라야 알 수 있고, B2 의 `checkTempoFitsSpec` 이 재서
   *      `meta.refUnused` 에 «말 속도를 그대로 쓰면 N초를 넘어서 보통 속도로 만들었어요»를 적는다(문장을 두 벌 쓰지 않는다 · B↔B2 합의).
   */
  syllableRatio?: number;
}
const FORMAT_RULE: Record<VideoFormat, string> = {
  graphic: "그래픽 스토리 — 무음 시청 전제 · 문장마다 화면이 바뀐다(문장 = 컷) · 사물·공간·수치 중심 · 인물은 실루엣/뒷모습.",
  talking: "토킹 — 나레이션이 본체 · 한 사람이 카메라를 보고 말하듯 · 문장 사이에 B-roll(사물·손·공간) 컷이 들어간다 · 정지 이미지로 대체 가능한 장면을 절반 이상.",
  clip: "클립형(생활밀착 15~30초) — 한 장면 한 메시지 · 짧은 문장 4~6개 · 첫 문장이 곧 결론 · 마지막은 한 줄 팁.",
};
/**
 * budgetFor — 이 길이의 **발화 예산**(음절·문장 수).
 *
 *   [R12-3 · 설계 R12 §4.2 · B↔B2 합의 2026-09-17] 🔴 **말 속도를 «대본 길이»로 먼저 맞춘다.**
 *     레퍼런스에서 배운 `audioTempo` 가 0.9(느리게)면 같은 글자가 **더 오래** 걸린다 ⇒ 컷 창·자막 시각·전체 길이가 다 밀리고,
 *     길이가 밀리면 **코인이 틀어진다**(길이 구간제). 그래서 음성을 늦추기 전에 **대본을 그만큼 짧게 쓴다.**
 *   🔴 `ratio` 정본은 `lib/video/tempo.ts syllableRatioOf()` 한 곳이다(= 실제 tempo ÷ 우리 보통 속도 1.1). **여기서 다시 셈하지 않는다.**
 *   🔴 **안 넘기면 1** — 대본이 종전과 한 글자도 안 달라진다(계약 §5 무회귀 · «안 보내면 어제와 같은 영상»).
 *   🔴 예산이 0 이 되지 않게 바닥을 둔다 — 0.5배 속도라도 훅 한 문장은 써야 한다.
 *   [R12-7] 90초: 문장 9~14(상한은 `maxLinesFor`).
 */
function budgetFor(seconds: VideoSeconds, ratio = 1): { minSyl: number; maxSyl: number; lines: [number, number] } {
  const r = Number.isFinite(Number(ratio)) && Number(ratio) > 0 ? Number(ratio) : 1;
  /* [수리라운드 2026-09-19 · B2 · AM 41fb79939 «발화 예산 단위»] 🔴 종전엔 여기와 프롬프트에 `4.6` 이 **손으로 두 번** 적혀 있었다.
     AM 은 같은 자리에서 «8.7자/초» 와 «음절/초» 가 1.36배 어긋난 채 몇 주를 갔다 — **숫자를 두 곳에 적으면 언젠가 갈린다.**
     ⇒ 정본은 `tts.ts SPEECH_SYLLABLES_PER_SEC` 한 곳이고, 값은 그대로라 **바이트 무회귀**다. */
  const maxSyl = Math.max(20, Math.floor(seconds * SPEECH_SYLLABLES_PER_SEC * 0.85 * r));
  const lines: [number, number] = seconds === 15 ? [4, 6] : seconds === 30 ? [5, 8] : seconds === 90 ? [9, 14] : [7, 12];
  return { minSyl: Math.floor(maxSyl * 0.55), maxSyl, lines };
}
/* ═══════════ [수리라운드 2026-09-19 · B2 · AM cee28b0d6] 🔴 «쓸쥐오닦쥐오» 의 **글자 쪽** ═══════════
 *   2026-09-19 에 소리 쪽을 고쳤다(`tts.ts applyReadingDict` — 공백 없는 표기도 물게). 그런데 **반쪽이었다**:
 *   화면 자막·유튜브 제목·원장에 남는 것은 **우리가 쓴 글자**이고, 사장님이 보시는 것도 그것이다.
 *   열쇠가 「쓸GO 닦GO」인데 대본기가 「쓸GO닦GO가」로 쓰면 **소리는 고쳐져도 화면은 그대로 깨져 있다.**
 *
 *   ⇒ 두 겹: ① 프롬프트가 «적힌 그대로 쓰라»고 말하고 ② **막지 않고 고친다**(결정론 교정).
 *   🔴 **막는 게 아니라 되돌리는 것**이다(§9) — 사장님 문장을 깎는 게 아니라 **등록한 정본 표기**로 되돌린다.
 *   🔴 조사·어미는 **그대로 둔다**: 「쓸GO닦GO가」 → 「쓸GO 닦GO가」(뒤를 안 건드린다).
 *   ⚠️ 공백 없는 열쇠는 붙여 쓸 여지가 없으므로 **대상이 아니다**(옛 테넌트 바이트 무회귀).
 */
/** 사전 열쇠 중 «공백이 있는 것»만 — 그 열쇠의 공백 지운 형태를 정본 표기로 되돌린다. */
export function normalizeReadingKeySpelling(text: string, dict?: Record<string, string> | null): { text: string; fixed: string[] } {
  const t = String(text ?? "");
  if (!dict) return { text: t, fixed: [] };
  const keys = Object.keys(dict)
    .filter((k) => k && /\s/.test(k) && k.replace(/\s+/g, "").length >= READING_KEY_SQUASHED_MIN && k.length <= 60)
    .sort((a, b) => b.length - a.length);
  let out = t; const fixed: string[] = [];
  for (const k of keys) {
    const squashed = k.replace(/\s+/g, "");
    if (squashed === k || !out.includes(squashed)) continue;
    out = out.split(squashed).join(k);
    fixed.push(k);
  }
  return { text: out, fixed };
}
/** 🔴 `tts.ts READING_DICT_SQUASHED_MIN` 과 **같은 뜻의 문턱**이다 — 소리와 글자가 다른 잣대를 쓰면 또 갈린다. */
export const READING_KEY_SQUASHED_MIN = 4;
/** 프롬프트에 실을 «표기 그대로» 절. 열쇠가 없으면 **빈 문자열**(옛 테넌트 프롬프트 바이트 무회귀). */
export function brandSpellingNote(dict?: Record<string, string> | null): string {
  const keys = Object.keys(dict ?? {}).filter((k) => k && /\s/.test(k) && k.length <= 60).slice(0, 8);
  if (!keys.length) return "";
  return `[표기] 다음 이름은 **적힌 그대로**(띄어쓰기·대소문자 포함) 쓴다: ${keys.map((k) => `«${k}»`).join(" · ")}. 붙여 쓰거나 바꿔 쓰지 않는다(예: «${keys[0].replace(/\s+/g, "")}» 금지).`;
}

function stubScript(inp: ScriptInput): { script: VideoScript; drafts: CutDraft[] } {
  const n = Math.max(4, Math.min(inp.cuts, 9)); const per = Math.max(1, Math.round(inp.seconds / n));
  const lines: ScriptLine[] = Array.from({ length: n }, (_, i) => ({ idx: i, text: i === 0 ? `${inp.topic.title}, 이것 하나면 끝.` : i === n - 1 ? "오늘 바로 해 보세요." : `${inp.topic.angle.slice(0, 20)} 장면 ${i}.`, role: i === 0 ? "hook" : i === n - 1 ? "closing" : "body", seconds: per, cutIdx: i }));
  return { script: { lines, hook: lines[0].text, closing: lines[n - 1].text, youtube: { title: inp.topic.title.slice(0, 60), description: inp.topic.angle, tags: ["쇼츠", "생활팁"] }, factcheck: { status: "skipped", claims: [] } }, drafts: lines.map((l, i) => ({ key: `cut:${i}`, subject: `stylized 3D scene about ${inp.topic.title}, cut ${i}` })) };
}

/** buildVideoScript — 포맷 계약대로 대본 + 컷 서술 JSON 1콜(재작성 지시 포함). */
export async function buildVideoScript(inp: ScriptInput): Promise<{ ok: true; script: VideoScript; drafts: CutDraft[]; model: string; spellingFixed?: string[] } | { ok: false; reason: string }> {
  /* [AC-111] 🔴 종전엔 `if (videoStub())` 하나로 **말없이** 대본을 템플릿으로 갈아치웠다(로그 0줄).
     이제 ① 대본 전용 손잡이(`videoScriptStub` — 안 주면 종전대로 따라간다)로 묻고 ② **반드시 찍는다.** */
  if (videoScriptStub()) {
    noteVideoStub("video_script", "대본 내용·훅·제목·태그·문장 수 — 그리고 계정 간 대본 유사도(스텁은 같은 템플릿이라 늘 1 이다)",
      scriptStubHandle(), "VIDEO_SCRIPT_STUB=0 (Veo 컷은 계속 꺼 둔 채 대본만 실호출)");
    const s = stubScript(inp); return { ok: true, ...s, model: "stub" };
  }
  const b = budgetFor(inp.seconds, inp.syllableRatio);
  const system = [
    inp.rewrite ?? "",
    `[역할] 한국 숏폼 대본 작가. ${inp.channel} ${inp.seconds}초 · 포맷 ${inp.format}: ${FORMAT_RULE[inp.format]}`,
    `[구조] 첫 문장 = 3초 훅(≤16음절 · 도입어·완만한 질문 금지 · 사실·숫자·반전으로 시작 · 훅 유형 «${inp.hookType}»${HOOK_TYPES.includes(inp.hookType as typeof HOOK_TYPES[number]) ? "" : "(자유)"}${inp.hookPrinciple ? ` · 훅이 먹히는 원리: «${inp.hookPrinciple}»` : ""}) → 본문 → 착지(개인 판단 한 줄) → 마무리(행동 한 줄 · 광고성 CTA 금지).${inp.structure?.length ? ` 서사 단계: ${inp.structure.join(" → ")}` : ""}`,
    `[분량] 문장 ${b.lines[0]}~${b.lines[1]}개 · 총 ${b.minSyl}~${b.maxSyl}음절(초당 ${SPEECH_SYLLABLES_PER_SEC}음절 · 무음 시청 자막 본체 · 한 문장 ≤ 28음절) · 컷 ${inp.cuts}개(문장마다 cutIdx 0~${inp.cuts - 1} 배정 · 연속 문장이 같은 컷을 공유해도 된다).`,
    brandSpellingNote(inp.persona.dict),
    "[금지] 근거 없는 수치·연도·통계(모르면 쓰지 않는다) · 최상급(최고·1위·100%) · 수익 약속(«얼마 번다») · 상투 도입(«오늘은 ~를 알아보겠습니다») · 실존 인물·타인 상호 · 이모지.",
    "[컷 서술] cuts[].subject 는 영어 한 문장(무엇이 보이는가 · 사물·공간·동작 · 인물은 silhouette/back view/stylized 로 · 글자·로고·간판 없음 · 실존 인물 없음). palette 는 짧은 색 조합. redMeasureLine 은 치수·비교 컷에만 true.",
    `[출력 JSON] { "hook": string, "lines": [{ "text": string, "role": "hook"|"body"|"bridge"|"landing"|"closing", "cutIdx": number }], "closing": string, "cuts": [{ "key": string, "subject": string, "palette"?: string, "redMeasureLine"?: boolean, "redProp"?: boolean, "pace"?: "fast"|"normal"|"hold" }], "youtube": { "title": string(≤60자 · 검색어 앞), "description": string(2~3문장 · 첫 줄은 비워 둔다 — 시스템이 고지를 넣는다), "tags": [string×5~10] } }`,
  ].filter(Boolean).join("\n");
  const user = [
    `[소재] ${inp.topic.title}`, `[앵글] ${inp.topic.angle}`, `[검색 의도] ${inp.topic.intent}${inp.topic.seasonal ? ` · 시즌 ${inp.topic.seasonal}` : ""}`,
    inp.persona.facts.length ? `[내 사정(1~2개를 장면으로)] ${inp.persona.facts.join(" / ")}` : "",
    inp.persona.tone ? `[말투] ${inp.persona.tone}` : "",
    inp.affiliate ? `[제휴] «${inp.affiliate.productQuery}» 를 쓴 장면 1곳 — 링크·가격은 시스템이 설명란에 넣는다. 본문에서 팔지 않는다.` : "",
  ].filter(Boolean).join("\n");
  const r = await callGeminiJson<Record<string, unknown>>({ purpose: "video_script", chain: CHAIN_DIRECTOR, role: "director", system, user, tenantId: inp.tenantId, ref: `piece:${inp.pieceId}:script`, mode: "pro", maxOutputTokens: 6000, timeoutMs: 120_000 });
  if (!r.ok) return { ok: false, reason: `대본 생성 실패(${r.reason})` };
  const p = r.data ?? {};
  const rawLines = Array.isArray(p.lines) ? p.lines : [];
  const lines: ScriptLine[] = rawLines.slice(0, maxLinesFor(inp.seconds)).map((x, i) => { const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>; const text = String(o.text ?? "").replace(/\s+/g, " ").trim().slice(0, 120); const role = (["hook", "body", "bridge", "landing", "closing"].includes(String(o.role)) ? String(o.role) : i === 0 ? "hook" : "body") as ScriptLine["role"]; const cutIdx = Math.max(0, Math.min(inp.cuts - 1, Math.trunc(Number(o.cutIdx)) || Math.floor(i * inp.cuts / Math.max(1, rawLines.length)))); return { idx: i, text, role, seconds: speechSecondsOf(syllablesOf(text)), cutIdx }; }).filter((l) => l.text);
  if (!lines.length) return { ok: false, reason: "대본 문장이 비었다" };
  const rawCuts = Array.isArray(p.cuts) ? p.cuts : [];
  const drafts: CutDraft[] = rawCuts.slice(0, 12).map((c, i) => { const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>; return { key: String(o.key ?? "").trim() || `cut:${i}`, subject: String(o.subject ?? "").replace(/\s+/g, " ").trim().slice(0, 400), palette: String(o.palette ?? "").trim().slice(0, 120) || undefined, redMeasureLine: o.redMeasureLine === true, redProp: o.redProp === true, ...(["fast", "normal", "hold"].includes(String(o.pace)) ? { pace: String(o.pace) as CutDraft["pace"] } : {}) }; });
  while (drafts.length < inp.cuts) drafts.push({ key: `cut:${drafts.length}`, subject: `stylized 3D scene illustrating: ${lines[Math.min(lines.length - 1, drafts.length)]?.text ?? inp.topic.title}` });
  const yt = (p.youtube && typeof p.youtube === "object" ? p.youtube : {}) as Record<string, unknown>;
  /* [AM cee28b0d6] 🔴 **막지 않고 고친다** — 정본 표기로 되돌린다(조사·어미는 그대로). 무엇을 고쳤는지 남긴다(조용한 교정 0). */
  const fixedAll = new Set<string>();
  const fix = (t: string): string => { const r0 = normalizeReadingKeySpelling(t, inp.persona.dict); r0.fixed.forEach((k) => fixedAll.add(k)); return r0.text; };
  const fixedLines = lines.map((l) => { const t = fix(l.text); return t === l.text ? l : { ...l, text: t, seconds: speechSecondsOf(syllablesOf(t)) }; });
  const script: VideoScript = {
    lines: fixedLines, hook: fix(String(p.hook ?? fixedLines[0].text).trim()), closing: fix(String(p.closing ?? fixedLines[fixedLines.length - 1].text).trim()),
    youtube: { title: fix(String(yt.title ?? inp.topic.title).trim()).slice(0, 100), description: fix(String(yt.description ?? "").trim()).slice(0, 4000), tags: (Array.isArray(yt.tags) ? yt.tags : []).map((t) => String(t ?? "").replace(/^#/, "").trim()).filter(Boolean).slice(0, 15) },
  };
  if (fixedAll.size) console.info(`[video-script] 표기 교정 — 등록한 정본 표기로 되돌렸어요: ${[...fixedAll].join(" · ")}`);
  return { ok: true, script, drafts, model: r.model, ...(fixedAll.size ? { spellingFixed: [...fixedAll] } : {}) };
}

/* ═══ 팩트체크 왕복(Google 검색 그라운딩) ═══ */
export async function factcheckRoundTrip(tenantId: number, pieceId: number, script: VideoScript): Promise<{ script: VideoScript; corrected: boolean; failed: boolean; reason?: string }> {
  const world = script.lines.filter((l) => l.role !== "landing" && l.role !== "closing");
  /* [AC-111] 팩트체크도 «싼 축»이라 대본 손잡이를 따라간다 — 그리고 **건너뛴 것을 말한다.**
     🔴 `status:"skipped"` 는 «주장이 없어서»와 «스텁이라서»를 **한 글자로 뭉갠다** — 로그가 그 둘을 가른다. */
  if (videoScriptStub()) {
    noteVideoStub("video_factcheck", "사실 주장 검증·정정(웹 검색 그라운딩) — meta 의 factcheck.status 는 «skipped» 로 남지만 그건 «주장이 없었다»가 아니다",
      scriptStubHandle(), "VIDEO_SCRIPT_STUB=0");
    return { script: { ...script, factcheck: { status: "skipped", claims: [] } }, corrected: false, failed: false };
  }
  if (!hasFactualClaims(world)) return { script: { ...script, factcheck: { status: "skipped", claims: [] } }, corrected: false, failed: false };
  const listing = world.map((l) => `${l.idx}. ${l.text}`).join("\n");
  const r = await callGemini({ purpose: "video_factcheck", chain: CHAIN_HIGH, role: "high", googleSearch: true, mode: "pro", maxOutputTokens: 6000, timeoutMs: 120_000, tenantId, ref: `piece:${pieceId}:factcheck`,
    user: `다음 쇼츠 대본의 사실 주장(수치·연도·고유명사·사건)을 웹 검색으로 검증하라. 대본에 없는 주장을 만들지 마라.\n출력은 JSON 하나: { "claims": [ { "line": number, "claim": string, "verdict": "ok"|"wrong"|"unknown", "correct"?: string, "note"?: string } ] } — verdict wrong 이면 correct 에 올바른 값.\n\n대본:\n${listing}` });
  if (!r.ok) return { script: { ...script, factcheck: { status: "unverified", claims: [] } }, corrected: false, failed: true, reason: `팩트체크 검색 실패(${r.reason})` };
  const parsed = parseJsonLoose(r.text) as { claims?: { line?: number; claim?: string; verdict?: string; correct?: string; note?: string }[] } | null;
  const claims = (parsed?.claims ?? []).map((c) => ({ claim: String(c?.claim ?? ""), verdict: (["ok", "wrong", "unknown"].includes(String(c?.verdict)) ? String(c?.verdict) : "unknown") as "ok" | "wrong" | "unknown", ...(c?.correct ? { note: `정정: ${c.correct}` } : c?.note ? { note: String(c.note) } : {}) }));
  const bad = claims.filter((c) => c.verdict !== "ok");
  if (!bad.length) return { script: { ...script, factcheck: { status: "verified", claims } }, corrected: false, failed: false };
  // 정정 1회 — 틀린 값은 correct 로, 검증 불가는 «빼거나 «~로 알려져 있다» 로 완화»
  const fix = `[다시 쓰기 — 팩트체크에서 걸렸다. 아래 주장을 고쳐라. wrong 은 정정값으로 바꾸고, unknown 은 그 수치·연도를 문장에서 빼거나 «~로 알려져 있어요» 로 완화하라. 다른 문장은 그대로.]\n${bad.map((c) => `- (${c.verdict}) ${c.claim}${c.note ? ` → ${c.note}` : ""}`).join("\n")}\n[현재 대본]\n${script.lines.map((l) => `${l.idx}. ${l.text}`).join("\n")}\n출력 JSON: { "lines": [{ "idx": number, "text": string }] } — idx 는 그대로.`;
  const r2 = await callGeminiJson<{ lines?: { idx: number; text: string }[] }>({ purpose: "video_factfix", chain: CHAIN_DIRECTOR, role: "director", user: fix, tenantId, ref: `piece:${pieceId}:factfix`, mode: "pro", maxOutputTokens: 3000 });
  let lines = script.lines;
  if (r2.ok && Array.isArray(r2.data?.lines)) { const m = new Map(r2.data.lines.map((x) => [Number(x.idx), String(x.text ?? "").trim()])); lines = script.lines.map((l) => ({ ...l, text: m.get(l.idx) || l.text, seconds: speechSecondsOf(syllablesOf(m.get(l.idx) || l.text)) })); }
  const tokens = unverifiedTokens({ claims });
  const landed = correctionLanded(lines.filter((l) => l.role !== "landing" && l.role !== "closing"), tokens);
  return { script: { ...script, lines, factcheck: { status: landed ? "corrected" : "unverified", claims } }, corrected: true, failed: !landed, reason: landed ? undefined : `확인 안 되는 사실이 남아 있어요(${tokens.slice(0, 3).join(", ")})` };
}

/** 유튜브 메타(계약 §1.4-6) — 첫 줄 고지는 호출부(disclosure)가 넣는다. */
export function youtubeMetaOf(script: VideoScript, opts: { tags?: string[]; firstLine?: string | null }): { title: string; description: string; tags: string[] } {
  const title = script.youtube.title.slice(0, 100);
  const desc = [opts.firstLine ?? "", script.youtube.description, "", "#Shorts"].filter((x, i) => i === 0 ? !!x : true).join("\n").trim();
  const tags = [...new Set([...(script.youtube.tags ?? []), ...(opts.tags ?? [])])].slice(0, 15);
  return { title, description: desc.slice(0, 5000), tags };
}
