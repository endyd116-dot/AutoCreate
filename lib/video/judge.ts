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
import { r2Get } from "../r2";
import { findBannedWords, BLOG_EXTRA_BANNED } from "../banned-words";
import { checkVideoDisclosure } from "../disclosure";
import { checkHook } from "./script";
import { hammingHex, phashFromGray32, PHASH_SIMILAR_MAX_DISTANCE } from "./fingerprint";
import { JUDGE_COST_USD } from "./cost";
import { videoStub, type JudgeAxis, type JudgeGrade, type JudgeResult, type RenderPayload } from "./types";

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

export const VISION_BLIND_REASON = "심사를 돌리지 못했습니다(AI 판정이 일시 장애로 응답하지 않음) — 영상은 정상적으로 만들어졌습니다. 품질 문제가 아니므로 다시 만들 필요는 없습니다: 화면에서 보시고 이대로 예약하거나 잠시 뒤 다시 시도해 주세요.";
/** 자막 읽기 속도 상한(초당 글자 · AM CAPTION 계약 5.5자/초 + 여유). */
export const READ_CHARS_PER_SEC = 6.5;
const AXIS_LABEL: Record<string, string> = { hook_first: "첫 컷이 훅", safe_area: "자막·배지가 안전영역 안", reading_time: "자막 읽을 시간 충분", text_broken: "깨진 글자 없음", black_margin: "검은 여백 없음", frames_not_blank: "빈 프레임 없음", cut_rhythm: "컷 리듬 살아 있음", forbidden: "금칙·내부 문자열 없음", disclosure: "제휴 고지(배지·자막·설명란)", duration_fit: "길이 규격 안", similarity: "다른 계정 영상과 겹치지 않음" };
const GRADE_OF: Record<string, JudgeGrade> = { forbidden: "P0", disclosure: "P0", duration_fit: "P0", frames_not_blank: "P0", text_broken: "P1", black_margin: "P1", safe_area: "P1", hook_first: "P1", similarity: "P1", reading_time: "P2", cut_rhythm: "P2" };
const axis = (key: string, pass: boolean, detail?: string): JudgeAxis => ({ key, label: AXIS_LABEL[key] ?? key, pass, grade: GRADE_OF[key] ?? "P2", ...(detail ? { detail } : {}) });

/* ═══ 결정론 축(페이로드) ═══ */
export function judgePayloadDeterministic(p: RenderPayload, meta: Record<string, unknown>, report?: { durationMs?: number; bytes?: number; frameCount?: number } | null, hookText?: string): { axes: JudgeAxis[]; repairedPayload: RenderPayload | null } {
  const axes: JudgeAxis[] = [];
  let repaired: RenderPayload | null = null;
  const totalMs = p.scenes.length ? Math.max(...p.scenes.map((s) => s.endMs)) : 0;
  // ① hook_first
  const h = checkHook(hookText ?? p.captions.phrases[0]?.text ?? "");
  axes.push(axis("hook_first", h.ok && p.scenes[0]?.startMs === 0, h.ok ? undefined : h.reason ?? undefined));
  // ② safe_area — 프리셋·세이프존 존재 + 배지 코너 tr
  axes.push(axis("safe_area", p.overlay.safeZone.top === 220 && p.overlay.safeZone.bottom === 300 && (!p.overlay.badge || p.overlay.badge.corner === "tr")));
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
  // duration_fit — 실측 길이 ≤ maxSeconds+1s · ≥ 60% · bytes·frameCount 일관
  if (report) {
    const dur = n(report.durationMs); const okDur = dur > 0 && dur <= (p.out.maxSeconds + 1) * 1000 && dur >= p.out.maxSeconds * 1000 * 0.6;
    const frames = n(report.frameCount); const okFrames = frames === 0 || Math.abs(frames - dur * 30 / 1000) <= 45;
    axes.push(axis("duration_fit", okDur && okFrames, okDur ? (okFrames ? undefined : `프레임 수 ${frames} 가 길이 ${dur}ms 와 안 맞음`) : `길이 ${Math.round(dur / 100) / 10}s(규격 ${Math.round(p.out.maxSeconds * 0.6)}~${p.out.maxSeconds}s)`));
    axes.push(axis("frames_not_blank", n(report.bytes) > 150_000, n(report.bytes) > 150_000 ? undefined : `파일 ${n(report.bytes)}B — 빈 영상 의심`));
  }
  return { axes, repairedPayload: repaired };
}

/* ═══ 비전 축(포스터 + 컷 대표 프레임) ═══ */
async function visionAxes(tenantId: number, pieceId: number, keys: string[]): Promise<{ axes: JudgeAxis[]; blind: boolean; grayHash?: string }> {
  if (videoStub()) { void recordAiUsage({ tenantId, purpose: "video_judge", model: "stub", inTokens: 0, outTokens: 0, costUsd: 0, ref: `piece:${pieceId}:judge` }); return { axes: [axis("text_broken", true, "stub"), axis("black_margin", true, "stub"), axis("frames_not_blank", true, "stub")], blind: false }; }
  const apiKey = String(process.env.GEMINI_API_KEY ?? "").trim();
  const parts: Record<string, unknown>[] = [];
  for (const k of keys.slice(0, 4)) { const obj = await r2Get(k); if (obj) parts.push({ inlineData: { mimeType: obj.contentType.startsWith("image/") ? obj.contentType : "image/jpeg", data: Buffer.from(obj.bytes).toString("base64") } }); }
  if (!apiKey || !parts.length) return { axes: [], blind: true };
  parts.push({ text: "You are judging frames from a Korean vertical short video. Answer JSON only: { \"textBroken\": boolean (any garbled/fake Korean glyphs or unreadable letters baked into the picture), \"blackMargin\": boolean (black letterbox bars or large empty black areas), \"blank\": boolean (frame is blank/solid/uniform), \"uiOverlap\": boolean (captions or badge overlap the top 220px or bottom 300px zone), \"notes\": string }" });
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 40_000);
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_VISION}:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1024 + 2048, thinkingConfig: { thinkingBudget: 2048 } } }) });
    if (!resp.ok) return { axes: [], blind: true };
    const data = (await resp.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();   // AC-26: parts 전체를 잇는다(사고 파트 뒤에 본문)
    void recordAiUsage({ tenantId, purpose: "video_judge", model: MODEL_VISION, inTokens: data.usageMetadata?.promptTokenCount ?? 0, outTokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0), costUsd: JUDGE_COST_USD, ref: `piece:${pieceId}:judge` });
    if (!text) return { axes: [], blind: true };
    let j: Record<string, unknown> = {}; try { j = JSON.parse(text.replace(/^```[a-z]*\s*|\s*```$/g, "")); } catch { return { axes: [], blind: true }; }
    return { axes: [axis("text_broken", j.textBroken !== true, j.textBroken === true ? String(j.notes ?? "깨진 글자") : undefined), axis("black_margin", j.blackMargin !== true, j.blackMargin === true ? "검은 여백" : undefined), axis("frames_not_blank", j.blank !== true, j.blank === true ? "빈 프레임" : undefined), axis("safe_area", j.uiOverlap !== true, j.uiOverlap === true ? "자막·배지가 UI 영역과 겹침(비전)" : undefined)], blind: false };
  } catch { return { axes: [], blind: true }; }
  finally { clearTimeout(t); }
}

/** 계정 간 프레임 지문 비교(§1.9) — 러너가 report 에 32×32 그레이(thumbGray base64)를 실었을 때만. 없으면 통과(판정 불능은 미달이 아니다 · AC-9). */
async function similarityAxis(tenantId: number, pieceId: number, accountId: number | null, thumbGrayB64: string | null | undefined): Promise<JudgeAxis> {
  if (!thumbGrayB64) return axis("similarity", true, "지문 없음(러너 미제공) — 대본 유사도만 적용");
  const gray = Buffer.from(thumbGrayB64, "base64"); if (gray.length < 1024) return axis("similarity", true, "지문 길이 부족");
  const hash = phashFromGray32(gray);
  await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ frameHash: hash })} WHERE id = ${pieceId}`);
  const others = await q(sql`SELECT id, meta->>'frameHash' AS h FROM pieces WHERE tenant_id = ${tenantId} AND kind = 'video' AND id <> ${pieceId} AND account_id IS DISTINCT FROM ${accountId} AND created_at > NOW() - interval '14 days' AND meta->>'frameHash' IS NOT NULL LIMIT 50`);
  let best: { id: number; d: number } | null = null;
  for (const o of others) { const d = hammingHex(hash, String(o.h)); if (!best || d < best.d) best = { id: n(o.id), d }; }
  return axis("similarity", !best || best.d > PHASH_SIMILAR_MAX_DISTANCE, best && best.d <= PHASH_SIMILAR_MAX_DISTANCE ? `다른 계정 영상 #${best.id} 과 프레임 지문 거리 ${best.d}(≤${PHASH_SIMILAR_MAX_DISTANCE})` : undefined);
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
  const det = judgePayloadDeterministic(payload, meta, video ? { durationMs: n(vmeta.durationMs), bytes: n(vmeta.bytes), frameCount: n(vmeta.frameCount) } : null, String(meta.hook ?? ""));
  const vis = await visionAxes(tid, pieceId, [thumb?.r2_key, ...assets.filter((a) => a.kind === "clip").slice(0, 2).map((a) => a.r2_key)].filter(Boolean).map(String));
  const sim = await similarityAxis(tid, pieceId, p.account_id ? n(p.account_id) : null, String(vmeta.thumbGray ?? "") || null);
  // 비전이 결정론 축(safe_area·frames_not_blank)과 겹치면 «둘 중 실패»를 채택 — 비전 불능이면 결정론만
  const byKey = new Map<string, JudgeAxis>();
  for (const a of det.axes) byKey.set(a.key, a);
  for (const a of vis.axes) { const cur = byKey.get(a.key); byKey.set(a.key, cur && !cur.pass ? cur : a); }
  byKey.set("similarity", sim);
  if (vis.blind) { for (const k of ["text_broken", "black_margin"]) if (!byKey.has(k)) byKey.set(k, axis(k, true, VISION_BLIND_REASON)); }
  const axes = ["hook_first", "safe_area", "reading_time", "text_broken", "black_margin", "frames_not_blank", "cut_rhythm", "forbidden", "disclosure", "duration_fit", "similarity"].map((k) => byKey.get(k)).filter((a): a is JudgeAxis => !!a);
  const fails = axes.filter((a) => !a.pass);
  const grade: JudgeGrade = fails.some((a) => a.grade === "P0") ? "P0" : fails.some((a) => a.grade === "P1") ? "P1" : fails.length ? "P2" : "P2";
  const pass = !fails.some((a) => a.grade === "P0");   // 3등급: P0 만 차단 · P1/P2 는 기록하고 통과
  const repaired = !!det.repairedPayload;
  if (repaired) await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ render: det.repairedPayload })} WHERE id = ${pieceId}`);
  return { grade, pass, axes, repaired };
}
