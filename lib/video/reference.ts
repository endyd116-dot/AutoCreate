/**
 * lib/video/reference.ts — 레퍼런스 URL → «구조 템플릿»(계약 §1.11 · §0.1-3).
 *   AM 원본: ../AutoMarketing/lib/shorts-reference.ts (`ANALYZE_PROMPT`·`sanitizeTemplateForStorage`·URL 직독 2026-09-15 · 원본 35,529B 2026-09-11)
 *   AC 로 옮기며 바꾼 것: 저장 스키마를 AC `shorts_templates`(name·structure `[string]`·hook_type·style) 로 · 호출은 `callGeminiJson({ fileUri })`(모델 체인·ai_usage·AC-26 를 공짜로 얻는다).
 *
 *   🔴 **저작권 게이트가 이 파일의 존재 이유다.** 모델이 대사·자막 원문을 어느 키에 실어 보내든,
 *      저장은 `sanitizeTemplate` 의 **화이트리스트 복사**만 통과한다(그 키는 저장 모양에 아예 없다).
 *      길이 캡이 두 번째 이빨 — goal·principle 에 통짜 대본을 밀어 넣는 우회까지 막는다(AM 원본 주석 그대로).
 *   코인 0 · 하루 3회(감사 `topics_reference` COUNT · `topics-refresh` 와 같은 패턴) · 실패는 정직 사유(폴백 템플릿 날조 0).
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../db-util";
import { callGeminiJson } from "../ai";
import { MODEL_VIDEO_READ } from "../ai-models";
import { videoStub } from "./types";

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

/** 훅 유형(계약 어휘 · DDL hook_type varchar(24)). 모델이 다른 값을 내면 curiosity_gap 으로 접는다. */
export const HOOK_TYPES: readonly string[] = ["curiosity_gap", "contrast", "question", "number", "confession"];

export interface TemplateStyle {
  /** 그림 스타일 서술(프롬프트 STYLE 절 재료). */
  visual: string;
  /** 팔레트 원칙(COLOR 절 재료). */
  palette: string;
  /** 자막 배치 문법. */
  caption: string;
  /** 호흡·컷 속도. */
  pace: string;
  /** 연출 규칙(≤6 · AM visualGrammar.rules — 컷 프롬프트 재료라 버리지 않는다). */
  rules?: string[];
  /** 훅이 작동하는 원리(≤80자 · hook_type 만으로는 못 담는다). */
  hookPrinciple?: string;
  /** 카메라 문법(컷당 비트 수·이동 규칙). */
  camera?: string;
}
export interface ShortsTemplate {
  id: number;
  name: string;
  /** 서사 단계 — «라벨 — 하는 일»(소재 지운 추상). 대본 프롬프트의 structure 로 그대로 간다. */
  structure: string[];
  hook: string;
  style: TemplateStyle;
  sourceUrl?: string | null;
}

const line = (v: unknown, cap: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, cap);
const slug = (v: unknown, cap: number): string =>
  String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, cap);

/**
 * sanitizeTemplate — 분석 산출 → **저장 가능한 모양**(구조·문법만).
 *   🔴 여기 나열된 키·길이만 살아남는다. `quotes`·`sentences`·`script`·`transcript` 같은 키로 원문을 실어 보내도 저장 모양에 그 키가 없다.
 */
export function sanitizeTemplate(raw: unknown): { name: string; structure: string[]; hookType: string; style: TemplateStyle } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const st = (r.structure && typeof r.structure === "object" ? r.structure : r) as Record<string, unknown>;
  const vg = (r.visualGrammar && typeof r.visualGrammar === "object" ? r.visualGrammar
    : r.visual_grammar && typeof r.visual_grammar === "object" ? r.visual_grammar : {}) as Record<string, unknown>;

  const stagesRaw = Array.isArray(st.stages) ? st.stages : Array.isArray(r.stages) ? r.stages : [];
  const structure: string[] = stagesRaw.slice(0, 8).map((s, i) => {
    if (typeof s === "string") return line(s, 120);
    const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const label = line(o.label, 40) || `단계 ${i + 1}`;
    const goal = line(o.goal, 120);
    return goal ? `${label} — ${goal}` : "";
  }).filter(Boolean);

  const hookRaw = (st.hook && typeof st.hook === "object" ? st.hook : {}) as Record<string, unknown>;
  const hookSlug = slug(hookRaw.type, 24);
  const hookType = HOOK_TYPES.includes(hookSlug) ? hookSlug : "curiosity_gap";

  const rulesRaw = Array.isArray(vg.rules) ? vg.rules : [];
  const style: TemplateStyle = {
    visual: line(vg.style ?? vg.visual, 240),
    palette: line(vg.color ?? vg.palette, 160),
    caption: line(vg.captionStyle ?? vg.caption_style ?? vg.caption, 160),
    pace: line(vg.pace ?? vg.rhythm, 120),
    rules: rulesRaw.slice(0, 6).map((x) => line(x, 160)).filter(Boolean),
    hookPrinciple: line(hookRaw.principle, 80),
    camera: line(vg.camera, 240),
  };
  return { name: line(r.name ?? r.title ?? st.title, 80) || "구조 템플릿", structure, hookType, style };
}

/** 유튜브 주소인가 — 직독은 유튜브만 실증됐다(다른 호스트는 모델이 못 본다). */
export function isYoutubeUrl(u: string): boolean {
  return /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(String(u ?? "").trim());
}

const ANALYZE_PROMPT = `이 쇼츠 영상을 «구조 템플릿»으로 역공학하라. 산출은 JSON 하나만.

⚠️ 저작권 절대 규칙: 영상의 **문장·대사·자막 원문·구체 소재(고유명사 주제)를 한 글자도 옮기지 마라.**
   구조(단계가 하는 일)와 비주얼 문법(스타일·색·카메라·자막 배치)만 추상어로 서술한다.
   예: «[당연하게 알던 대상] → [뜻밖의 충격적 문제] → [잘못된 1차 해결/부작용] → [발상의 전환 해결] → [거대한 스케일·결론]»
   처럼 소재를 지운 괄호 구조로 쓴다.

JSON 스키마:
{
  "name": "이 구조의 이름(≤30자·소재 무관)",
  "structure": {
    "stages": [{"key":"영문_슬러그","label":"단계 이름(≤15자)","goal":"이 단계가 하는 일(≤80자·추상)"}],
    "hook": {"type":"curiosity_gap|contrast|question|number|confession 중 하나","principle":"훅이 작동하는 원리(≤80자·추상)"}
  },
  "visualGrammar": {
    "style": "그림 스타일 서술(영문 권장·프롬프트 STYLE 절 재료)",
    "color": "팔레트 원칙",
    "camera": "카메라 문법(컷당 비트 수·이동 규칙)",
    "captionStyle": "자막 배치 문법",
    "pace": "호흡·컷 속도",
    "rules": ["연출 규칙 최대 6개"]
  }
}`;

/** 스텁(계약 §1.4b) — 실호출 없이 고정 구조. 저장 모양·게이트는 실경로와 같게 통과시킨다. */
function stubRaw(): unknown {
  return {
    name: "반전 체인",
    structure: {
      stages: [
        { key: "familiar", label: "당연한 대상", goal: "누구나 안다고 믿는 것을 한 컷으로 보여 준다" },
        { key: "problem", label: "뜻밖의 문제", goal: "그 믿음이 깨지는 장면을 내놓는다" },
        { key: "wrong_fix", label: "잘못된 해결", goal: "흔한 해결이 왜 부작용을 내는지 보여 준다" },
        { key: "twist", label: "발상의 전환", goal: "관점을 바꾸는 진짜 해법을 제시한다" },
        { key: "scale", label: "스케일 결론", goal: "적용 범위를 넓혀 여운을 남긴다" },
      ],
      hook: { type: "curiosity_gap", principle: "아는 줄 알았던 것에 빈칸을 내서 끝까지 보게 한다" },
    },
    visualGrammar: { style: "semi-stylized 3D, clean studio light", color: "deep navy base with one warm accent", camera: "two beats per cut: hold then push-in", captionStyle: "big keyword centered, one line", pace: "cut every 5s", rules: ["빨강은 계측선에만", "인물은 실루엣·뒷모습"] },
  };
}

export type AnalyzeResult = { ok: true; template: ShortsTemplate } | { ok: false; step: string; error: string };

/**
 * analyzeReference — URL → 구조 템플릿 1행(`shorts_templates`).
 *   실패는 정직 사유로 돌려준다(폴백 템플릿을 지어내지 않는다 — 지어낸 구조는 «레퍼런스로 배웠다»는 화면 문구를 거짓말로 만든다).
 */
export async function analyzeReference(tenantId: number, url: string): Promise<AnalyzeResult> {
  const u = String(url ?? "").trim();
  if (!isYoutubeUrl(u)) return { ok: false, step: "url", error: "유튜브 주소를 넣어 주세요(youtube.com · youtu.be)." };

  let parsed: unknown;
  if (videoStub()) parsed = stubRaw();
  else {
    const r = await callGeminiJson<Record<string, unknown>>({
      purpose: "video_reference", chain: [MODEL_VIDEO_READ], user: ANALYZE_PROMPT,
      fileUri: u, tenantId, ref: `reference:${tenantId}:${Date.now()}`,
      mode: "flash", temperature: 0.4, maxOutputTokens: 4000, timeoutMs: 120_000,   // 영상 직독은 수십 초
    });
    if (!r.ok) return { ok: false, step: "ai", error: `영상을 읽지 못했어요(${r.reason.slice(0, 80)}). 공개된 쇼츠 링크인지 확인해 주세요.` };
    parsed = r.data;
  }

  // 🔴 저작권 게이트 — 저장 직전 단 한 곳.
  const clean = sanitizeTemplate(parsed);
  if (!clean.structure.length) return { ok: false, step: "structure", error: "서사 단계를 뽑지 못했어요. 다른 영상으로 해 볼까요?" };

  const [row] = await q(sql`INSERT INTO shorts_templates (tenant_id, name, source_url, structure, hook_type, style)
    VALUES (${tenantId}, ${clean.name}, ${u}, ${jsonb(clean.structure)}, ${clean.hookType}, ${jsonb(clean.style as unknown as Record<string, unknown>)})
    RETURNING id`);
  const id = Number(row?.id) || 0;
  if (!id) return { ok: false, step: "insert", error: "구조를 저장하지 못했어요." };
  // 쓴 직후 모양 확인까지가 쓰기다(PITFALLS #1 · structure 는 배열 · style 은 객체).
  const [chk] = await q(sql`SELECT jsonb_typeof(structure) AS s, jsonb_typeof(style) AS y FROM shorts_templates WHERE id = ${id}`);
  if (chk?.s !== "array" || chk?.y !== "object") console.error("[video/reference] jsonb_typeof 이상", chk);

  return { ok: true, template: { id, name: clean.name, structure: clean.structure, hook: clean.hookType, style: clean.style, sourceUrl: u } };
}

/** 오늘(KST) 분석 횟수 — 감사 행이 곧 횟수(`topics-refresh` 와 같은 패턴). */
export async function referenceCountToday(tid: number): Promise<number> {
  const [r] = await q(sql`SELECT COUNT(*) AS c FROM audit_logs WHERE tenant_id = ${tid} AND action = 'topics_reference'
    AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date = (NOW() AT TIME ZONE 'Asia/Seoul')::date`);
  return Number(r?.c || 0);
}

/** 템플릿 1건 읽기(디렉터·대본이 `factors.structureTemplateId` 로 부른다 · 테넌트 것 또는 내장(tenant_id NULL)). */
export async function templateOf(tid: number, id: number): Promise<ShortsTemplate | null> {
  const [r] = await q(sql`SELECT id, name, structure, hook_type, style, source_url FROM shorts_templates
    WHERE id = ${id} AND (tenant_id = ${tid} OR tenant_id IS NULL)`);
  if (!r) return null;
  const structure = Array.isArray(r.structure) ? (r.structure as unknown[]).map((x) => String(x)) : [];
  return { id: Number(r.id), name: String(r.name), structure, hook: String(r.hook_type ?? "curiosity_gap"), style: (r.style ?? {}) as TemplateStyle, sourceUrl: r.source_url ? String(r.source_url) : null };
}

/** 목록(화면 «구조: …» 부제 재료 · 내장 + 테넌트 것). */
export async function listTemplates(tid: number, limit = 20): Promise<ShortsTemplate[]> {
  const rows = await q(sql`SELECT id, name, structure, hook_type, style, source_url FROM shorts_templates
    WHERE tenant_id = ${tid} OR tenant_id IS NULL ORDER BY id DESC LIMIT ${Math.max(1, Math.min(100, limit))}`);
  return rows.map((r) => ({
    id: Number(r.id), name: String(r.name),
    structure: Array.isArray(r.structure) ? (r.structure as unknown[]).map((x) => String(x)) : [],
    hook: String(r.hook_type ?? "curiosity_gap"), style: (r.style ?? {}) as TemplateStyle,
    sourceUrl: r.source_url ? String(r.source_url) : null,
  }));
}
