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
import { syllablesOf, speechSecondsOf } from "./tts";
import { HOOK_TYPES, type CutDraft } from "./scenes";
import { videoStub, type ScriptLine, type VideoFormat, type VideoScript, type VideoSeconds } from "./types";

/* ═══ 게이트(순수) ═══ */
const HOOK_MAX_SYLLABLES = 16;
const HOOK_WEAK_OPENERS = /^(오늘부터|요즘|혹시|여러분|우리|만약|가끔|보통|사실|그런데|그리고|자,|이제|안녕하세요)/;
const HOOK_WEAK_TAIL = /(하지 않나요|않으신가요|일까요|겠죠|시죠)\s*\??$/;
export function checkHook(text: string): { ok: boolean; reason: string | null; syllables: number } {
  const t = String(text ?? "").trim(); const syl = (t.match(/[가-힣]/g) ?? []).length;
  if (!t) return { ok: false, reason: "훅이 비었다", syllables: 0 };
  if (syl > HOOK_MAX_SYLLABLES) return { ok: false, reason: `훅이 ${syl}음절(3초 상한 ${HOOK_MAX_SYLLABLES}음절 초과 — 배경 설명은 두 번째 문장으로, 첫 문장은 사실 한 방으로)`, syllables: syl };
  if (HOOK_WEAK_OPENERS.test(t)) return { ok: false, reason: `훅이 도입어로 시작한다("${t.slice(0, 8)}…") — 첫 글자부터 사실·숫자·반전이어야 한다`, syllables: syl };
  if (HOOK_WEAK_TAIL.test(t)) return { ok: false, reason: "훅이 완만한 공감 질문으로 끝난다 — 단언 또는 상식을 깨는 질문으로", syllables: syl };
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
export function checkScriptGates(script: VideoScript): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const h = checkHook(script.hook || script.lines[0]?.text || ""); if (!h.ok && h.reason) issues.push(`훅: ${h.reason}`);
  const all = script.lines.map((l) => l.text).join("\n");
  const banned = findBannedWords(`${script.youtube.title}\n${all}`, BLOG_EXTRA_BANNED); if (banned.length) issues.push(`광고법 금칙어: ${banned.join(", ")}`);
  const inc = findIncomeClaim(script.lines); if (inc) issues.push(`수익 약속 표현: «${inc.slice(0, 40)}»`);
  const cli = CLICHES.filter((c) => c.re.test(all)).map((c) => c.label); if (cli.length) issues.push(`상투 표현: ${cli.slice(0, 3).join(", ")}`);
  const total = script.lines.reduce((a, l) => a + syllablesOf(l.text), 0);
  if (script.lines.length < 4 || script.lines.length > 12) issues.push(`문장 수 ${script.lines.length}(계약 4~12)`);
  if (total < 20) issues.push("대본이 너무 짧다");
  return { ok: issues.length === 0, issues };
}

/* ═══ 대본 생성(LLM) ═══ */
export interface ScriptInput {
  tenantId: number; pieceId: number; format: VideoFormat; seconds: VideoSeconds; cuts: number; channel: string;
  topic: { title: string; angle: string; intent: string; seasonal?: string };
  persona: { facts: string[]; tone?: string; signature?: string };
  hookType: string; structure?: string[] | null;
  affiliate?: { productQuery: string } | null;
  /** 재작성 지시(게이트 실패·팩트체크 정정). */
  rewrite?: string | null;
}
const FORMAT_RULE: Record<VideoFormat, string> = {
  graphic: "그래픽 스토리 — 무음 시청 전제 · 문장마다 화면이 바뀐다(문장 = 컷) · 사물·공간·수치 중심 · 인물은 실루엣/뒷모습.",
  talking: "토킹 — 나레이션이 본체 · 한 사람이 카메라를 보고 말하듯 · 문장 사이에 B-roll(사물·손·공간) 컷이 들어간다 · 정지 이미지로 대체 가능한 장면을 절반 이상.",
  clip: "클립형(생활밀착 15~30초) — 한 장면 한 메시지 · 짧은 문장 4~6개 · 첫 문장이 곧 결론 · 마지막은 한 줄 팁.",
};
function budgetFor(seconds: VideoSeconds): { minSyl: number; maxSyl: number; lines: [number, number] } {
  const maxSyl = Math.floor(seconds * 4.6 * 0.85); return { minSyl: Math.floor(maxSyl * 0.55), maxSyl, lines: seconds === 15 ? [4, 6] : seconds === 30 ? [5, 8] : [7, 12] };
}
function stubScript(inp: ScriptInput): { script: VideoScript; drafts: CutDraft[] } {
  const n = Math.max(4, Math.min(inp.cuts, 9)); const per = Math.max(1, Math.round(inp.seconds / n));
  const lines: ScriptLine[] = Array.from({ length: n }, (_, i) => ({ idx: i, text: i === 0 ? `${inp.topic.title}, 이것 하나면 끝.` : i === n - 1 ? "오늘 바로 해 보세요." : `${inp.topic.angle.slice(0, 20)} 장면 ${i}.`, role: i === 0 ? "hook" : i === n - 1 ? "closing" : "body", seconds: per, cutIdx: i }));
  return { script: { lines, hook: lines[0].text, closing: lines[n - 1].text, youtube: { title: inp.topic.title.slice(0, 60), description: inp.topic.angle, tags: ["쇼츠", "생활팁"] }, factcheck: { status: "skipped", claims: [] } }, drafts: lines.map((l, i) => ({ key: `cut:${i}`, subject: `stylized 3D scene about ${inp.topic.title}, cut ${i}` })) };
}

/** buildVideoScript — 포맷 계약대로 대본 + 컷 서술 JSON 1콜(재작성 지시 포함). */
export async function buildVideoScript(inp: ScriptInput): Promise<{ ok: true; script: VideoScript; drafts: CutDraft[]; model: string } | { ok: false; reason: string }> {
  if (videoStub()) { const s = stubScript(inp); return { ok: true, ...s, model: "stub" }; }
  const b = budgetFor(inp.seconds);
  const system = [
    inp.rewrite ?? "",
    `[역할] 한국 숏폼 대본 작가. ${inp.channel} ${inp.seconds}초 · 포맷 ${inp.format}: ${FORMAT_RULE[inp.format]}`,
    `[구조] 첫 문장 = 3초 훅(≤16음절 · 도입어·완만한 질문 금지 · 사실·숫자·반전으로 시작 · 훅 유형 «${inp.hookType}»${HOOK_TYPES.includes(inp.hookType as typeof HOOK_TYPES[number]) ? "" : "(자유)"}) → 본문 → 착지(개인 판단 한 줄) → 마무리(행동 한 줄 · 광고성 CTA 금지).${inp.structure?.length ? ` 서사 단계: ${inp.structure.join(" → ")}` : ""}`,
    `[분량] 문장 ${b.lines[0]}~${b.lines[1]}개 · 총 ${b.minSyl}~${b.maxSyl}음절(초당 4.6음절 · 무음 시청 자막 본체 · 한 문장 ≤ 28음절) · 컷 ${inp.cuts}개(문장마다 cutIdx 0~${inp.cuts - 1} 배정 · 연속 문장이 같은 컷을 공유해도 된다).`,
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
  const lines: ScriptLine[] = rawLines.slice(0, 12).map((x, i) => { const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>; const text = String(o.text ?? "").replace(/\s+/g, " ").trim().slice(0, 120); const role = (["hook", "body", "bridge", "landing", "closing"].includes(String(o.role)) ? String(o.role) : i === 0 ? "hook" : "body") as ScriptLine["role"]; const cutIdx = Math.max(0, Math.min(inp.cuts - 1, Math.trunc(Number(o.cutIdx)) || Math.floor(i * inp.cuts / Math.max(1, rawLines.length)))); return { idx: i, text, role, seconds: speechSecondsOf(syllablesOf(text)), cutIdx }; }).filter((l) => l.text);
  if (!lines.length) return { ok: false, reason: "대본 문장이 비었다" };
  const rawCuts = Array.isArray(p.cuts) ? p.cuts : [];
  const drafts: CutDraft[] = rawCuts.slice(0, 12).map((c, i) => { const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>; return { key: String(o.key ?? "").trim() || `cut:${i}`, subject: String(o.subject ?? "").replace(/\s+/g, " ").trim().slice(0, 400), palette: String(o.palette ?? "").trim().slice(0, 120) || undefined, redMeasureLine: o.redMeasureLine === true, redProp: o.redProp === true, ...(["fast", "normal", "hold"].includes(String(o.pace)) ? { pace: String(o.pace) as CutDraft["pace"] } : {}) }; });
  while (drafts.length < inp.cuts) drafts.push({ key: `cut:${drafts.length}`, subject: `stylized 3D scene illustrating: ${lines[Math.min(lines.length - 1, drafts.length)]?.text ?? inp.topic.title}` });
  const yt = (p.youtube && typeof p.youtube === "object" ? p.youtube : {}) as Record<string, unknown>;
  const script: VideoScript = {
    lines, hook: String(p.hook ?? lines[0].text).trim(), closing: String(p.closing ?? lines[lines.length - 1].text).trim(),
    youtube: { title: String(yt.title ?? inp.topic.title).trim().slice(0, 100), description: String(yt.description ?? "").trim().slice(0, 4000), tags: (Array.isArray(yt.tags) ? yt.tags : []).map((t) => String(t ?? "").replace(/^#/, "").trim()).filter(Boolean).slice(0, 15) },
  };
  return { ok: true, script, drafts, model: r.model };
}

/* ═══ 팩트체크 왕복(Google 검색 그라운딩) ═══ */
export async function factcheckRoundTrip(tenantId: number, pieceId: number, script: VideoScript): Promise<{ script: VideoScript; corrected: boolean; failed: boolean; reason?: string }> {
  const world = script.lines.filter((l) => l.role !== "landing" && l.role !== "closing");
  if (videoStub() || !hasFactualClaims(world)) return { script: { ...script, factcheck: { status: "skipped", claims: [] } }, corrected: false, failed: false };
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
