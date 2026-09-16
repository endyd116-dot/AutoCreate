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

  /* ═══ [R10-6] 🔴 사장님이 더하라 하신 칸 — «디자인·타이포그래피·자막·영상 스피드» ═══
   *
   *   원칙(설계 §2.2 · B2 실측 2026-09-16): **우리가 못 내는 축은 배우지 않는다 — 배워도 장식이다.**
   *   ⇒ 아래는 전부 **지금 렌더가 받을 수 있는 축**이다(자막이 HTML/CSS 라 원리상 되고, 상수를 값으로 열었다).
   *   🔴 **[R12] 그 «일부러 뺀 둘»이 이제 열렸다** — `captionMotion`(글자 등장 방식) · `transition`(컷 전환).
   *      R10 까지의 사유는 「자막은 구절당 PNG 한 장이라 «애니메이션 도중» 프레임이 없고, 씬은 `concat` 뿐이라 하드컷」이었다.
   *      R12 가 **그 구조를 바꿨다**: PNG 는 여전히 **한 장**이고 **ffmpeg 가 그 한 장의 자리·투명도·크기를 시간에 따라 바꾼다**,
   *      전환은 **컷 «안»에서 빌려** `xfade` 로 겹친다(전체 길이 불변). ⇒ 이제 «낼 수 있는 축»이라 배운다.
   *      🔴 **열린 만큼만 배운다** — 모션 넷(`none|fade|slide_up|pop`) · 전환 셋(`none|fade|slide`). 그 밖은 `undefined` 로 떨어지고
   *      `reference-apply.ts` 가 «못 내요»로 적는다(배워 와도 **우리가 못 내면 장식**이다).
   *   🔴 전부 **선택**이다 — 모델이 못 읽으면 `undefined` 고, 그게 «못 읽었다»다. 기본값으로 메우지 않는다(AC-92).
   */
  /** 자막 글자(굵기 100~900 · 외곽선 px · 그림자 세기 0~3). 렌더가 CSS 로 그대로 그린다. */
  typography?: { weight?: number; strokeWidth?: number; shadow?: "none" | "soft" | "hard" };
  /** 자막 자리·줄 수·강조색 — 🔴 `maxCharsPerLine` 이 «2줄 이내»를 **우연**에서 **규칙**으로 바꾸는 값이다. */
  captionPlace?: { position?: "top" | "middle" | "bottom"; maxCharsPerLine?: number; accentColor?: string };
  /** 속도 — 컷당 초 · 영상 전체 길이(초). 🔴 «cut every 5s» 같은 글에서 숫자를 읽는다. */
  speed?: { secPerCut?: number; totalSec?: number };
  /** 디자인 — 쓰는 색 수 · 가로 여백(px). 안전영역은 채널이 정하므로 배우지 않는다(우리가 이미 안다). */
  design?: { colorCount?: number; sideMargin?: number };
  /**
   * 🟠 말 속도(0.5~2.0). 🔴 **이번 라운드는 «저장까지»다**(트리거 B2-6).
   *   손잡이는 `lib/tts-typecast.ts` 에 이미 있지만(0.5~2.0 클램프) 이 값을 실제로 넘기는 것은 **새 규칙**이다 —
   *   나레이션 길이가 바뀌면 **자막 시각·컷 창·전체 길이가 전부 따라 움직인다**(작은 일이 아니다).
   *   ⇒ 배워서 저장하고 `refUnused` 에 «아직 반영 안 함»으로 남긴다. 반영은 다음 라운드(R11).
   */
  audioTempo?: number;
  /**
   * [R12-1] 자막 글자 등장 방식 — 🔴 **우리가 낼 수 있는 넷만**. 기본은 `none`(= 지금 그대로 · 무회귀).
   *   `fade` 서서히 · `slide_up` 아래에서 올라옴 · `pop` 톡 튀어나옴.
   *   🔴 **다섯째는 없다.** «타자기처럼 한 글자씩»을 배워 와도 우리가 못 내므로 `undefined` 로 떨어뜨리고 «못 내요»로 적는다(AC-9).
   *   🔴 **나가는 모션(퇴장)은 배우지 않는다** — 다음 자막과 겹치면 두 줄이 동시에 보이고, 그건 심사(`judge.ts`)의 «자막 2줄» 규칙과 싸운다.
   *   🔴 **모션 «길이»도 배우지 않는다** — 120~200ms 안에서 우리가 정한다. 길면 **읽을 시간을 먹는다**(`judge.ts` `reading_time`).
   */
  captionMotion?: "none" | "fade" | "slide_up" | "pop";
  /**
   * [R12-2] 컷 전환 — 🔴 **셋만**. 기본은 `none`(딱딱 끊김 = 지금 그대로 · 무회귀).
   *   🔴 **길이는 배우지 않는다**(러너가 0.3초로 정하고 상한 0.4초). 컷 «사이»가 아니라 컷 «안»에서 빌리므로 **전체 길이가 안 바뀐다**.
   *   ⚠️ `xfade` 는 ffmpeg **4.3 이상**이다 — 고객 PC 가 못 내면 러너가 `none` 으로 내려앉히고 «못 냈어요»를 적는다(**막지는 않는다** · CLAUDE §9).
   */
  transition?: "none" | "fade" | "slide";
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
/** 값이 하나라도 있으면 그 객체를, 전부 못 읽었으면 `undefined`. 🔴 **빈 객체를 저장하지 않는다** — «{}» 는 «읽었는데 비었다»로 읽힌다. */
const compact = <T extends object>(o: T): T | undefined => {
  const e = Object.entries(o).filter(([, v]) => v !== undefined);
  return e.length ? (Object.fromEntries(e) as T) : undefined;
};
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

  /* [R10-6] 새 칸 — 🔴 **허용 목록 안에서만** 산다(§3.5 «금지 목록이면 새 키로 새는 구멍이 영원히 남는다»).
     아래에 없는 키는 모델이 무엇을 실어 보내도 저장 모양에 **자리가 없다.**
     🔴 그리고 **못 읽은 축은 키 자체를 안 만든다** — `undefined` 가 «못 읽었다»다(0·"normal" 로 메우지 않는다 · AC-92). */
  const num = (v: unknown, lo: number, hi: number): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 100) / 100 : undefined;
  };
  const hex = (v: unknown): string | undefined => {
    const s = String(v ?? "").trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : undefined;
  };
  const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => {
    const s = String(v ?? "").trim().toLowerCase() as T;
    return allowed.includes(s) ? s : undefined;
  };
  const ty = (vg.typography && typeof vg.typography === "object" ? vg.typography : {}) as Record<string, unknown>;
  const cp = (vg.captionPlace && typeof vg.captionPlace === "object" ? vg.captionPlace : {}) as Record<string, unknown>;
  const sp = (vg.speed && typeof vg.speed === "object" ? vg.speed : {}) as Record<string, unknown>;
  const dz = (vg.design && typeof vg.design === "object" ? vg.design : {}) as Record<string, unknown>;

  const typography = compact({ weight: num(ty.weight, 100, 900), strokeWidth: num(ty.strokeWidth, 0, 12), shadow: pick(ty.shadow, ["none", "soft", "hard"] as const) });
  const captionPlace = compact({ position: pick(cp.position, ["top", "middle", "bottom"] as const), maxCharsPerLine: num(cp.maxCharsPerLine, 4, 40), accentColor: hex(cp.accentColor) });
  const speed = compact({ secPerCut: num(sp.secPerCut, 0.5, 20), totalSec: num(sp.totalSec, 5, 180) });
  const design = compact({ colorCount: num(dz.colorCount, 1, 8), sideMargin: num(dz.sideMargin, 0, 200) });
  if (typography) style.typography = typography;
  if (captionPlace) style.captionPlace = captionPlace;
  if (speed) style.speed = speed;
  if (design) style.design = design;
  const tempo = num(vg.audioTempo, 0.5, 2.0);
  if (tempo !== undefined) style.audioTempo = tempo;
  /* [R12-1·2] 🔴 **닫힌 어휘**다 — 목록 밖 값은 `undefined` 로 떨어진다(«타자기»·«와이프»를 배워 와도 **자리가 없다**).
     그 «못 읽음»은 `reference-apply.ts` 가 «못 내요»로 옮겨 적는다(조용히 버리지 않는다 · AC-9). */
  const capMotion = pick(vg.captionMotion, ["none", "fade", "slide_up", "pop"] as const);
  if (capMotion !== undefined) style.captionMotion = capMotion;
  const trans = pick(vg.transition, ["none", "fade", "slide"] as const);
  if (trans !== undefined) style.transition = trans;
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
    "rules": ["연출 규칙 최대 6개"],

    "typography":  {"weight": "자막 글자 굵기 100~900 숫자", "strokeWidth": "글자 외곽선 두께 px(없으면 0)", "shadow": "none|soft|hard"},
    "captionPlace":{"position": "top|middle|bottom", "maxCharsPerLine": "자막 한 줄 글자 수(세어 본 값)", "accentColor": "강조 낱말 색 #RRGGBB"},
    "speed":       {"secPerCut": "컷 하나가 머무는 초(재 본 값)", "totalSec": "영상 전체 길이 초"},
    "design":      {"colorCount": "화면에 쓰는 색 가짓수", "sideMargin": "자막 좌우 여백 px(1080 폭 기준 환산)"},
    "audioTempo":  "말 속도 배수 0.5~2.0(보통이면 1.0)",

    "captionMotion": "자막 글자가 나타나는 방식 — none|fade|slide_up|pop 중 하나만",
    "transition":    "컷이 바뀌는 방식 — none|fade|slide 중 하나만"
  }
}

🔴 **모르면 그 키를 빼라. 지어내지 마라.** 「보통」·「평범」으로 메운 값은 **틀린 값보다 나쁘다** —
   우리가 그걸 «재 봤더니 그렇더라»로 믿고 영상에 그대로 넣는다.

🔴 **captionMotion·transition 은 위 목록 밖 값을 쓰지 마라.** 「타자기처럼 한 글자씩」·「와이프」·「줌 전환」처럼
   목록에 없는 것을 봤으면 **그 키를 빼라** — 억지로 비슷한 것을 고르면 우리는 못 내고 **배운 척만** 남는다.
🔴 **자막이 «사라지는» 방식은 묻지 않는다** — 우리는 들어오는 것만 낸다(나가는 모션은 다음 자막과 겹친다).
🔴 **모션·전환의 «길이»는 묻지 않는다** — 그건 우리가 정한다.`;

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
