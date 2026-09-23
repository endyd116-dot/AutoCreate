/**
 * lib/topics.ts — 소재 뽑기(Gemini 후보 15 → 네이버 검색량·트렌드 결합 → 스코어 → topics upsert). DESIGN §5 · 계약 §2.
 *   AM 원본: ../AutoMarketing/lib/content-topics.ts + magnet-topics.ts (스코어 팩터·가중 복사 2026-09-14 · 소스는 LLM 후보 1종으로 축약)
 *
 *   ★ 스코어식(DESIGN §5 팩터식 · AM magnet-topics 그대로 · 0~100):
 *       score = (demand × intent × pain × compGap) ÷ max(0.1, difficulty) × seasonal × performance × 100
 *       demand   = clamp01(log10(volume+1) / log10(50000))   volume 없으면 0.4(보수)     — 키워드툴 PC+모바일 월간 max(seed)
 *       intent   = info 0.55 · mixed 0.75 · commercial 0.9                                 — LLM 판정
 *       pain     = clamp(LLM 0~1, 0.3, 1)                                                  — LLM 판정(«얼마나 절실한 고민인가»)
 *       compGap  = compIdx 낮음 0.9 · 중간 0.6 · 높음 0.35 · 미상 0.6                       — 키워드툴 compIdx
 *       difficulty = naver_blog 1.2 · tistory 1.25 · blogger/wordpress 1.2 · threads 0.95 · 기타 1.1 — 채널 제작 난이도
 *       seasonal = kr-calendar 시즌 가중(1.0~1.35)
 *       performance = 1.0(Phase 2 전엔 고정 — factors.performance 는 0 으로 기록)
 *   🔴 환각 0: volume·growthPct·competition 은 네이버 응답값만 · 없으면 키 생략. «최고·1위·100%» 앵글은 코드 필터로 버린다.
 *   norm_key = 공백제거·NFC·lower(title). 🔴 **`TOPIC_REUSE_DAYS`(90일 · DESIGN §4.3) 내** used/picked 와 같으면 버림(2026-09-23 · 30→90). expires_at = +7일.
 */
import { db } from "../db/index";
import { sql, type SQL } from "drizzle-orm";
import { jsonb, utcDate } from "./db-util";
import { callGeminiJson } from "./ai";
import { CHAIN_DIRECTOR } from "./ai-models";
import { lookupVolumes, normKw, type KeywordVolume } from "./naver-volume";
import { lookupGrowth } from "./naver-datalab";
import { seasonalFor, seasonLine } from "./kr-calendar";
import { listAccounts, TEXT_CHANNELS, isChannel } from "./accounts";
import { VIDEO_CHANNELS } from "./video/types";          // 순수 어휘 파일(AC-17 순환 0 — types 는 아무것도 import 하지 않는다)
import { listTemplates } from "./video/reference";       // [P1R5 §1.11] 레퍼런스 구조 템플릿
import { AD_LAW_BANNED, normalizeForBanScan } from "./banned-words";
import { findBannedCategory, BANNED_CATEGORY_LABEL, type BannedHit } from "./banned-categories";
import { writeAudit } from "./audit";

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

export type TopicIntent = "info" | "commercial" | "mixed";
export interface TopicFactors {
  volume?: number; growthPct?: number; competition?: "low" | "mid" | "high"; intent: TopicIntent; pain?: number; seasonal?: string; performance?: number;
  /**
   * [R8 §2.4-라 · DESIGN §5C.6] 🔴 **`volume` 이 «누구의» 검색량인가** — 그 낱말이다.
   *   여태 `bestVolume()` 이 씨앗 낱말들 중 제일 큰 것을 골라 **`volume` 만 저장하고 `keyword` 는 버렸다.**
   *   그래서 `content-gen` 이 «검색어: {소재 제목} (월 검색 N)» 을 만들었는데 — **N 은 제목의 검색량이 아니다.**
   *   모델은 그 숫자를 믿고 **제목 문구를 노리고 쓴다.** 재려던 것(그 키워드)과 실제로 준 것(제목)이 갈린 전형적인 대용물이다(AC-57).
   *   🔴 못 찾았으면 **비워 둔다** — 제목으로 대신 채우면 같은 거짓말이 이름만 바꿔 돌아온다.
   */
  keyword?: string;
  /** [P1R5 §1.11] 레퍼런스 구조 템플릿(`shorts_templates.id`) — 영상 후보에만 붙는다. 디렉터가 `meta.structure` 로 옮겨 대본 프롬프트의 «서사 단계»가 된다. */
  structureTemplateId?: number;
}
export interface Topic { id: number; title: string; angle: string; channelHint: string; score: number; status: string; factors: TopicFactors; expiresAt: string;
  /** "ai"(추천) | "manual"(내가 넣은 것 · 화면이 «직접» 필을 단다 · 목록·자동 편성에서 먼저) */
  source: string;
  /**
   * [AC-254] **`expiresAt` 이 지났나** — 🔴 **판단은 서버가 한다**(AC-52 · 화면이 `new Date()` 로 재면 시간대가 갈린다).
   *   `expiresAt` 이 없으면 **붙이지 않는다**(AC-9 — «안 지났다»가 아니라 «시계가 없다»).
   *   `later` 목록에만 실제로 뜬다(다른 상태는 만료된 행이 애초에 안 나온다).
   */
  stale?: boolean }

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export function demandScore(volume: number | undefined): number {
  if (!(Number(volume) > 0)) return 0.4;
  return clamp01(Math.log10(Number(volume) + 1) / Math.log10(50000));
}
export function intentScore(i: TopicIntent): number { return i === "commercial" ? 0.9 : i === "mixed" ? 0.75 : 0.55; }
export function compGapScore(compIdx: string | undefined): number {
  const c = String(compIdx || "");
  if (/낮/.test(c)) return 0.9; if (/중/.test(c)) return 0.6; if (/높/.test(c)) return 0.35; return 0.6;
}
export function competitionOf(compIdx: string | undefined): "low" | "mid" | "high" | undefined {
  const c = String(compIdx || "");
  if (/낮/.test(c)) return "low"; if (/중/.test(c)) return "mid"; if (/높/.test(c)) return "high"; return undefined;
}
export function channelDifficulty(ch: string | null | undefined): number {
  switch (String(ch ?? "")) { case "naver_blog": return 1.2; case "tistory": return 1.25; case "blogger": case "wordpress": return 1.2; case "threads": return 0.95; default: return 1.1; }
}
/**
 * 성과 팩터 표(P1R3 §1.6 · DESIGN §9.3 «수익 나는 소재 학습»). 🔴 가중치는 여기 한 곳.
 *   perf(0~1) = 조회 정규화 × views + 수익 정규화 × revenue. 수익 정규화 = clamp01(30일 piece 수익 / revenueFullKrw).
 *   🔴 표본(30일 수익 행 수) < minSamples 면 **수익 항을 넣지 않는다(중립)** — 0원 구간을 «나쁜 소재»로 단정하지 않는다.
 *   점수식은 perf 를 곱수로 쓴다: performanceMultiplier(null)=1.0(모름) · perf 0→multMin · perf 1→multMax.
 */
export const PERFORMANCE_WEIGHTS = { views: 0.4, revenue: 0.6, minSamples: 5, revenueFullKrw: 30_000, multMin: 0.7, multMax: 1.3 } as const;
export function performanceOf(viewsNorm: number | null, revenueKrw: number | null, samples: number): number | null {
  const v = viewsNorm === null ? null : clamp01(viewsNorm);
  const useRev = revenueKrw !== null && samples >= PERFORMANCE_WEIGHTS.minSamples;
  if (v === null && !useRev) return null;
  if (!useRev) return Math.round(v! * 100) / 100;                       // 수익 표본 부족 → 조회만(수익 항 중립)
  const r = clamp01(revenueKrw! / PERFORMANCE_WEIGHTS.revenueFullKrw);
  const vv = v ?? r;                                                   // 조회를 모르면 수익만으로
  return Math.round((vv * PERFORMANCE_WEIGHTS.views + r * PERFORMANCE_WEIGHTS.revenue) * 100) / 100;
}
export function performanceMultiplier(perf: number | null | undefined): number {
  if (perf === null || perf === undefined || !Number.isFinite(perf)) return 1;
  return PERFORMANCE_WEIGHTS.multMin + (PERFORMANCE_WEIGHTS.multMax - PERFORMANCE_WEIGHTS.multMin) * clamp01(perf);
}
export function computeScore(f: { demand: number; intent: number; pain: number; compGap: number; difficulty: number; seasonal: number; performance?: number }): number {
  const raw = (f.demand * f.intent * f.pain * f.compGap) / Math.max(0.1, f.difficulty) * f.seasonal * (f.performance ?? 1);
  return Math.round(raw * 1000) / 10;
}

/** «최고·1위·100%…» 류 — 앵글·제목에 있으면 후보를 버린다(프롬프트 + 코드 필터). */
export function hasSuperlative(text: string): boolean {
  const blob = normalizeForBanScan(text);
  return AD_LAW_BANNED.some((w) => blob.includes(normalizeForBanScan(w))) || /최고|1위|일위|100%|완벽|끝판왕|역대급/.test(text);
}

/* ───────── ① 후보 생성(LLM) ───────── */
interface Candidate { title: string; angle: string; seedKeywords: string[]; channelHint: string; intent: TopicIntent; pain: number; structureTemplateId?: number }

async function tenantContext(tid: number) {
  const [t] = await q(sql`SELECT settings FROM tenants WHERE id = ${tid}`);
  const settings = (t?.settings && typeof t.settings === "object" ? t.settings : {}) as Record<string, unknown>;
  const accounts = await listAccounts(tid);
  const accountChannels = [...new Set(accounts.map((a) => a.channel))].filter((c) => TEXT_CHANNELS.has(c));
  const settingChannels = (Array.isArray(settings.channels) ? (settings.channels as unknown[]).map(String) : []).filter((c) => TEXT_CHANNELS.has(c));
  const channels = accountChannels.length ? accountChannels : settingChannels.length ? settingChannels : ["naver_blog", "tistory"];
  /* [P1R5 §1.11] 영상 채널 힌트 — 테넌트가 `settings.kinds` 에 "video" 를 켰고 영상 계정이 있을 때만 후보에 섞는다(디렉터 §1.1 과 같은 조건).
     레퍼런스 구조 템플릿이 있으면 목록으로 넘겨, 모델이 영상 후보마다 어울리는 구조를 고르게 한다(`factors.structureTemplateId`). */
  const kinds = Array.isArray(settings.kinds) ? (settings.kinds as unknown[]).map(String) : ["text"];
  const videoChannels = kinds.includes("video") ? [...new Set(accounts.map((a) => a.channel))].filter((c) => VIDEO_CHANNELS.has(c)) : [];
  const templates = videoChannels.length ? await listTemplates(tid, 8) : [];
  const personaIds = [...new Set(accounts.map((a) => a.personaId).filter(Boolean))] as number[];
  const personas = personaIds.length ? await q(sql`SELECT name, profile FROM personas WHERE tenant_id = ${tid} AND id IN (${sql.join(personaIds.map((i) => sql`${i}`), sql`, `)})`) : await q(sql`SELECT name, profile FROM personas WHERE tenant_id = ${tid} ORDER BY id LIMIT 2`);
  const recent = await q(sql`SELECT title FROM topics WHERE tenant_id = ${tid} AND created_at > NOW() - (${TOPIC_REUSE_DAYS} || ' days')::interval ORDER BY id DESC LIMIT 60`);
  return { settings, channels, videoChannels, templates, personas: personas.map((p) => ({ name: String(p.name), profile: (p.profile || {}) as Record<string, unknown> })), recentTitles: recent.map((r) => String(r.title)) };
}

function personaLine(p: { name: string; profile: Record<string, unknown> }): string {
  const f = p.profile;
  const parts = [f.region, f.family, f.job, f.home].filter(Boolean).map(String);
  const it = Array.isArray(f.interests) ? (f.interests as unknown[]).map(String).slice(0, 6).join(", ") : "";
  return `${p.name}: ${parts.join(" · ") || "(사정 미정)"}${it ? ` · 관심사 ${it}` : ""}`;
}

async function generateCandidates(tid: number, ctx: Awaited<ReturnType<typeof tenantContext>>): Promise<Candidate[]> {
  const system = [
    "너는 한국 블로그·SNS 소재 편성자다. 검색되는 실제 고민을 고르되, 지어낸 수치·근거 없는 최상급(최고·1위·100%·완벽)은 절대 쓰지 않는다.",
    "출력은 JSON 하나: { \"candidates\": [ { \"title\": string(검색어가 앞에 오는 자연스러운 한국어 제목 25자 내), \"angle\": string(어떤 관점·경험으로 풀지 한 문장), \"seedKeywords\": [string×3 · 네이버에서 실제로 치는 짧은 검색어 · 공백 없이], \"channelHint\": string(아래 채널 키 중 하나), \"intent\": \"info\"|\"commercial\"|\"mixed\", \"pain\": number(0~1 · 얼마나 절실한 고민인가), \"structureTemplate\": number|null(아래 구조 템플릿 번호 · 없으면 null) } ×15 ] }",
    "채널 힌트 규칙: 경험담·생활 밀착·사진이 어울리면 naver_blog · 정리·비교·가이드는 tistory 또는 blogger/wordpress · 짧은 훅·의견은 threads.",
    ctx.videoChannels.length
      ? `영상 채널(${ctx.videoChannels.join(", ")})도 대상이다 — 3초 안에 훅이 서고, 말로 60초에 끝나며, 장면이 그려지는 소재면 영상 채널 키를 고른다(설명·표·링크가 필요한 소재는 글 채널로). 15개 중 5개 안팎을 영상 후보로.`
      : "",
    ctx.templates.length
      ? `영상 후보에는 아래 «구조 템플릿» 중 어울리는 것의 번호를 "structureTemplate" 에 넣는다(안 맞으면 null · 글 후보는 항상 null).\n${ctx.templates.map((t, i) => `  ${i}. ${t.name} — ${t.structure.join(" → ").slice(0, 160)}`).join("\n")}`
      : "",
    "15개는 서로 다른 주제여야 하고(같은 주제의 변주 금지), 상업 의도(intent commercial/mixed)를 5개 안팎 섞는다.",
  ].filter(Boolean).join("\n");
  const user = [
    `[대상 채널] ${[...ctx.channels, ...ctx.videoChannels].join(", ")}`,
    ctx.personas.length ? `[운영자 페르소나(사정)]\n${ctx.personas.map(personaLine).join("\n")}` : "[운영자 페르소나] 아직 없음 — 1인 가구·직장인·자취 같은 넓은 사정으로",
    `[계절] ${seasonLine()}`,
    ctx.recentTitles.length ? `[최근 30일 이미 쓴 소재 — 겹치지 말 것]\n${ctx.recentTitles.slice(0, 40).map((t) => `- ${t}`).join("\n")}` : "",
    "위 조건으로 후보 15개를 JSON 으로.",
  ].filter(Boolean).join("\n\n");
  const r = await callGeminiJson<{ candidates?: (Candidate & { structureTemplate?: unknown })[] }>({ purpose: "topics", chain: CHAIN_DIRECTOR, role: "director", system, user, tenantId: tid, ref: `topics:${tid}`, mode: "pro", maxOutputTokens: 6000 });
  if (!r.ok) throw Object.assign(new Error(`소재 후보 생성 실패: ${r.reason}`), { step: "ai" });
  const list = Array.isArray(r.data?.candidates) ? r.data.candidates : [];
  const out: Candidate[] = list.map((c) => {
    const hint = String(c?.channelHint ?? "");
    const isVideoHint = ctx.videoChannels.includes(hint);
    // 구조 템플릿은 **영상 후보에만** · 번호가 목록 밖이면 버린다(모델이 지어낸 id 를 저장하지 않는다).
    const ti = Number(c?.structureTemplate);
    const tpl = isVideoHint && Number.isInteger(ti) && ti >= 0 && ti < ctx.templates.length ? ctx.templates[ti] : null;
    return {
      title: String(c?.title ?? "").trim().slice(0, 120),
      angle: String(c?.angle ?? "").trim().slice(0, 300),
      seedKeywords: (Array.isArray(c?.seedKeywords) ? c.seedKeywords : []).map((k) => String(k ?? "").replace(/\s+/g, "").trim()).filter(Boolean).slice(0, 3),
      channelHint: isVideoHint || (TEXT_CHANNELS.has(hint) && ctx.channels.includes(hint)) ? hint : ctx.channels[0],
      intent: (["info", "commercial", "mixed"].includes(String(c?.intent)) ? String(c.intent) : "info") as TopicIntent,
      pain: Math.max(0.3, Math.min(1, Number(c?.pain) || 0.5)),
      ...(tpl ? { structureTemplateId: tpl.id } : {}),
    };
  }).filter((c) => c.title && !hasSuperlative(`${c.title} ${c.angle}`));

  /* P1R4 §1.5 — 금칙 카테고리(성인·도박·의료 과장·비방·불법)는 소재 단계에서 거부 + 감사.
     🔴 [2026-09-15 C · AC-36] 종전엔 `.filter()` 안에서 `void writeAudit(...)` 였다 — 동기 콜백이라 await 할 자리가 없었고,
     서버리스는 응답 뒤 인보케이션을 끝내므로 **거부 기록이 될 때도 안 될 때도 있었다**(계약 P1R6 §0 «감사는 await»).
     ⇒ 거르기(순수)와 기록하기(비동기)를 갈라, 거른 뒤 **한 번에 await** 한다. 여러 건이어도 왕복은 병렬 1회다. */
  const blocked: { c: Candidate; hit: { category: string; word: string } }[] = [];
  const passed = out.filter((c) => {
    const hit = findBannedCategory(`${c.title} ${c.angle} ${c.seedKeywords.join(" ")}`);
    if (hit) blocked.push({ c, hit });
    return !hit;
  });
  if (blocked.length) {
    await Promise.all(blocked.map(({ c, hit }) => writeAudit({
      tenantId: tid, action: "topic_banned_category", actorType: "system", riskLevel: "medium",
      detail: { category: hit.category, word: hit.word, title: c.title.slice(0, 80) },
    })));
  }
  return passed;
}

/* ───────── ②③ 검색량 결합 + 스코어 ───────── */
function bestVolume(seeds: string[], vols: Map<string, KeywordVolume>): { volume?: number; compIdx?: string; keyword?: string } {
  let best: { volume: number; compIdx: string; keyword: string } | null = null;
  for (const s of seeds) {
    const v = vols.get(normKw(s)); if (!v) continue;
    const total = v.pcVolume + v.mobileVolume;
    if (!best || total > best.volume) best = { volume: total, compIdx: v.compIdx, keyword: v.keyword };
  }
  return best ?? {};
}

/* ───────── ④ upsert ───────── */
export const normKey = (title: string) => normKw(title).slice(0, 160);

/**
 * 🔴 **동일 소재를 얼마 만에 다시 써도 되나**(DESIGN §4.3 「같은 소재는 계정당 **90일** 재사용 금지」 · AC-251 · 2026-09-23).
 *
 *   ══ 왜 상수로 뺐나 ══
 *     코드가 **30일**, 설계가 **90일**이었고 **아무도 정한 적이 없었다**(9일째 그대로).
 *     🔴 CLAUDE §8: **설계가 정본**이고, 설계를 바꾸려면 사장님 승인이 먼저다 — 승인 없이 코드가 혼자 30으로 가 있던 것이
 *     그 자체로 «왜곡»이었다(메인 판정 2026-09-23). ⇒ 설계대로 **90**으로 맞춘다.
 *     🔴 **한 곳에만 둔다** — 사장님이 «30이 낫다»고 하시면 **이 줄 하나로** 되돌아온다(세 자리를 다시 찾아다니지 않는다).
 *
 *   ══ ⚠️ 이건 **막는 것이 아니다**(CLAUDE §9) ══
 *     이 창이 하는 일은 셋 다 «말해 주기»이거나 «조용히 안 버리기»다:
 *       · 프롬프트에 «최근 이만큼 쓴 소재 — 겹치지 말 것»으로 **알려 주고**(모델이 피한다)
 *       · 후보를 거를 때는 **`skipped` 로 세어 남기고**(조용한 0건 금지)
 *       · 직접 넣기는 **막지 않고 기존 것을 돌려준다**(`step:"duplicate"` — 고객이 그 소재로 갈 수 있다)
 *     🔴 90으로 늘리면서 **하드 게이트가 되면 안 된다.** 늘어나는 것은 «겹친다고 말해 주는 범위»이지 «못 하게 하는 범위»가 아니다.
 *
 *   ⚠️ **수동 소재의 만료(+30일)는 이 값이 아니다** — 그건 «직접 넣은 소재가 언제 시드나»라 뜻이 다르다(아래 `addManualTopic`).
 */
export const TOPIC_REUSE_DAYS = 90;

/**
 * [AC-254 · DESIGN §5.1] **추천 소재의 «신선도 시계»** — `expires_at = NOW() + 이 날짜`.
 *   여태 `interval '7 days'` 가 **두 군데에 글자로** 박혀 있었다(`refreshTopics` 의 갱신·삽입). `TOPIC_REUSE_DAYS` 가 30→90 으로
 *   세 군데에서 갈렸던 것과 **똑같은 병**이라 같은 처방으로 묶는다(AC-251).
 *
 *   🔴 **이 시계가 뜻하는 것은 «없어진다»가 아니라 «추천한 지 오래됐다»이다.**
 *     트렌드 후보의 검색량·경쟁도는 우리가 잰 그날의 값이다. 일주일이 지나면 **그 숫자를 더는 못 믿는다**는 뜻이지,
 *     고객이 그 소재를 못 쓴다는 뜻이 아니다. 그래서 `stale` 로 **말해 주고 막지는 않는다**(§9).
 *
 *   ⚠️ **수동 소재의 +30일은 이 값이 아니다**(`addManualTopic`) — «내가 넣은 소재가 언제 시드나»라 뜻이 다르다.
 *     `TOPIC_REUSE_DAYS` 때와 같은 판단이다: **숫자가 같아 보인다고 한 상수로 묶으면 한쪽을 고칠 때 다른 쪽이 따라 움직인다.**
 */
export const TOPIC_FRESH_DAYS = 7;

/** 소재 화면의 말 — 🔴 **화면이 글자를 지어내지 않는다**(AC-52). A 가 `create.html` 에 박아 둔 것을 그대로 옮겼다(§3 말투가 갈리면 안 된다). */
export const TOPIC_LABELS = {
  later: {
    title: "나중에 볼 소재",
    empty: "나중에 볼 소재가 아직 없어요",
    undo: "오늘 소재로",
    /** 🔴 A 가 «N일 뒤 사라져요»를 적으려 했는데 — **이제 안 사라진다.** 그 자리에 들어갈 말이다. */
    keep: "여기 둔 소재는 사라지지 않아요",
    /** 만료가 지난 소재 줄. §3 — «못 쓴다»가 아니라 «오래됐다 + 지금도 된다» */
    stale: "추천한 지 오래됐어요 · 지금도 쓸 수 있어요",
  },
} as const;

export function toTopic(r: Row): Topic {
  const f = (r.factors && typeof r.factors === "object" ? r.factors : {}) as Record<string, unknown>;
  const factors: TopicFactors = { intent: (["info", "commercial", "mixed"].includes(String(f.intent)) ? String(f.intent) : "info") as TopicIntent };
  if (Number.isFinite(Number(f.volume)) && f.volume !== undefined && f.volume !== null) factors.volume = Number(f.volume);
  /* 🔴 [R8-라] 옛 소재에는 이 칸이 없다 — 그때는 저장을 안 했다. 없으면 **없는 대로** 둔다(프롬프트가 검색량 줄을 통째로 뺀다). */
  if (typeof f.keyword === "string" && f.keyword.trim()) factors.keyword = String(f.keyword).trim().slice(0, 80);
  if (Number.isFinite(Number(f.growthPct)) && f.growthPct !== undefined && f.growthPct !== null) factors.growthPct = Number(f.growthPct);
  if (["low", "mid", "high"].includes(String(f.competition))) factors.competition = String(f.competition) as TopicFactors["competition"];
  if (Number.isFinite(Number(f.pain)) && f.pain !== undefined && f.pain !== null) factors.pain = Number(f.pain);
  if (f.seasonal) factors.seasonal = String(f.seasonal);
  factors.performance = Number(f.performance) || 0;
  if (Number.isFinite(Number(f.structureTemplateId)) && Number(f.structureTemplateId) > 0) factors.structureTemplateId = Number(f.structureTemplateId);
  const exp = utcDate(r.expires_at);
  const t: Topic = { id: Number(r.id), title: String(r.title), angle: String(r.angle ?? ""), channelHint: String(r.channel_hint ?? ""), score: Number(r.score ?? 0), status: String(r.status), factors, expiresAt: exp?.toISOString() ?? "", source: String(r.source ?? "ai") };
  if (exp) t.stale = exp.getTime() <= Date.now();   // [AC-254] 시계가 없으면 안 붙인다 — «안 지났다»와 «못 쟀다»는 다르다(AC-9)
  return t;
}

/**
 * 소재 목록. 🔴 **`later` 는 만료로 숨기지 않는다**(AC-254 · A 가 짚었다 · 2026-09-23).
 *
 *   ══ 내가 적어 놓은 계약이 거짓이었다 ══
 *     `topics.ts:92` 에 내 손으로 **«목록에서 사라지는 게 아니라 `?status=later` 로 언제든 다시 본다»**고 적어 놓고,
 *     바로 이 줄에서 `expires_at > NOW()` 를 **모든 상태에 똑같이** 걸고 있었다. 추천 소재의 시계는 **7일**이라
 *     «나중에»로 옮긴 소재는 **일주일이면 말없이 없어진다.** 고객이 겪는 것은 «옮겨 뒀는데 없어졌다»다.
 *     ⚠️ 나는 이걸 **안 쟀다** — A 가 화면을 붙이면서 «그러면 만료되면 어떻게 되나»를 물어서 드러났다.
 *
 *   🔴 **왜 `later` 만 빼나** — 만료는 **우리 추천의 신선도**이지 고객의 뜻이 아니다.
 *     `candidate` 에서 낡은 후보를 감추는 것은 우리 추천 품질 관리다(고객이 고른 적 없다).
 *     `later` 는 **고객이 «이건 남겨 둬»라고 말한 칸**이다. 거기서 우리 시계로 지우는 것은 **고객 대신 버리는 것**이다(§9).
 *     ⇒ 낡았으면 **`stale` 로 말해 주고 둔다.** 되돌리기(§`topics-later` undo)가 살아 있어야 «되돌릴 길»이 참이 된다.
 *
 *   ⚠️ **`all` 은 원래부터 안 걸렸다** — 그래서 이 판의 변화는 `later` 한 칸뿐이다(`candidate`·`picked`·`used`·`expired` 무변).
 */
export async function listTopics(tid: number, status = "candidate"): Promise<Topic[]> {
  const keepExpired = status === "all" || status === "later";
  const rows = await q(sql`SELECT * FROM topics WHERE tenant_id = ${tid}
    ${status === "all" ? sql`` : sql`AND status = ${status}`}
    ${keepExpired ? sql`` : sql`AND (expires_at IS NULL OR expires_at > NOW())`}
    ORDER BY (source = 'manual') DESC, score DESC, id DESC LIMIT 100`);   // 🔴 [topics-add] 내가 넣은 소재가 맨 위 — 점수를 부풀리지 않고 정렬 키로
  return rows.map(toTopic);
}

export async function refreshCountToday(tid: number): Promise<number> {
  const [r] = await q(sql`SELECT COUNT(*) AS c FROM audit_logs WHERE tenant_id = ${tid} AND action = 'topics_refresh'
    AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date = (NOW() AT TIME ZONE 'Asia/Seoul')::date`);
  return Number(r?.c || 0);
}

/** refreshTopics — 후보 생성 → 검색량·트렌드 → 스코어 → upsert. 반환 added(새로 만든 행 수). */
export async function refreshTopics(tid: number): Promise<{ added: number; skipped: number; volumesKnown: boolean; growthKnown: boolean }> {
  const t0 = Date.now(); const lap: Record<string, number> = {};   // ★C4: 동기 함수 한도(라이브)에서 어디가 오래 걸리는지 로그로 남긴다
  const ctx = await tenantContext(tid);
  lap.ctx = Date.now() - t0;
  const cands = await generateCandidates(tid, ctx);
  lap.llm = Date.now() - t0 - lap.ctx;
  const seeds = cands.flatMap((c) => c.seedKeywords.length ? c.seedKeywords : [c.title.replace(/\s+/g, "")]);
  const vols = await lookupVolumes(seeds);
  lap.volumes = Date.now() - t0 - lap.ctx - lap.llm;
  const volumesKnown = vols.size > 0;
  const bestKw: string[] = [];
  const enriched = cands.map((c) => {
    const bv = bestVolume(c.seedKeywords.length ? c.seedKeywords : [c.title.replace(/\s+/g, "")], vols);
    if (bv.keyword) bestKw.push(bv.keyword);
    return { c, bv };
  });
  const growth = await lookupGrowth(bestKw);
  lap.growth = Date.now() - t0 - lap.ctx - lap.llm - lap.volumes;
  const growthKnown = growth.size > 0;
  const used = await q(sql`SELECT norm_key FROM topics WHERE tenant_id = ${tid} AND status IN ('used','picked') AND created_at > NOW() - (${TOPIC_REUSE_DAYS} || ' days')::interval`);
  const usedKeys = new Set(used.map((r) => String(r.norm_key)));
  let added = 0, skipped = 0;
  for (const { c, bv } of enriched) {
    const nk = normKey(c.title);
    if (!nk || usedKeys.has(nk)) { skipped++; continue; }
    const seasonal = seasonalFor(`${c.title} ${c.angle}`);
    const factors: TopicFactors = { intent: c.intent, pain: Math.round(c.pain * 100) / 100, performance: 0 };
    if (bv.volume !== undefined) factors.volume = bv.volume;
    /* 🔴 [R8-라] 검색량을 **누구의 것인지와 함께** 저장한다. 숫자만 남기면 그 숫자가 제목에 붙어 나간다(위 `keyword` 설명). */
    if (bv.keyword) factors.keyword = String(bv.keyword).slice(0, 80);
    const comp = competitionOf(bv.compIdx); if (comp) factors.competition = comp;
    const g = bv.keyword ? growth.get(bv.keyword) : undefined; if (g !== undefined) factors.growthPct = g;
    if (seasonal.label) factors.seasonal = seasonal.label;
    if (c.structureTemplateId) factors.structureTemplateId = c.structureTemplateId;   // [P1R5 §1.11]
    const score = computeScore({ demand: demandScore(bv.volume), intent: intentScore(c.intent), pain: c.pain, compGap: compGapScore(bv.compIdx), difficulty: channelDifficulty(c.channelHint), seasonal: seasonal.weight, performance: 1 });
    const [ex] = await q(sql`SELECT id, score, status FROM topics WHERE tenant_id = ${tid} AND norm_key = ${nk} ORDER BY id DESC LIMIT 1`);
    if (ex && String(ex.status) === "candidate") {
      await q(sql`UPDATE topics SET angle = ${c.angle}, channel_hint = ${c.channelHint}, factors = ${jsonb(factors)}, score = ${score}, expires_at = NOW() + (${TOPIC_FRESH_DAYS} || ' days')::interval WHERE id = ${Number(ex.id)}`);   // [AC-254] 7 은 `TOPIC_FRESH_DAYS` 한 곳
      skipped++; continue;
    }
    await q(sql`INSERT INTO topics (tenant_id, title, angle, norm_key, channel_hint, source, factors, score, status, expires_at)
      VALUES (${tid}, ${c.title}, ${c.angle}, ${nk}, ${c.channelHint}, ${"ai"}, ${jsonb(factors)}, ${score}, ${"candidate"}, NOW() + (${TOPIC_FRESH_DAYS} || ' days')::interval)`);   // [AC-254]
    added++;
  }
  const [chk] = await q(sql`SELECT jsonb_typeof(factors) AS t FROM topics WHERE tenant_id = ${tid} ORDER BY id DESC LIMIT 1`);
  if (chk && chk.t !== "object") console.error("[topics] factors jsonb_typeof !== object", chk);
  console.log(`[topics] refresh tid=${tid} ${Date.now() - t0}ms (ctx ${lap.ctx} · llm ${lap.llm} · 검색량 ${lap.volumes} · 트렌드 ${lap.growth} · 저장 ${Date.now() - t0 - lap.ctx - lap.llm - lap.volumes - lap.growth}) added=${added}`);
  if (!volumesKnown) console.warn(`[topics] tid=${tid} 검색량 미상(키워드툴 키 없음 또는 실패) — volume 키 생략`);
  return { added, skipped, volumesKnown, growthKnown };
}

/* ═══════════ [2026-09-15 · 사장님 실측 · DESIGN §5.1] 소재를 «직접» 넣는 입구 ═══════════
 *   만들기 화면에 소재를 직접 넣는 길이 없었다(AI 추천 중 고르기·새로 뽑기·넘김·레퍼런스뿐) — «디렉터는 소재만 받으면 구성·배치를 결정»의
 *   **소재를 주는 입구**를 AI 추천 하나로만 만든 설계 누락. 고객이 첫날 부딪히는 벽이라 코인 0 · readonly 도 넣을 수 있다(막는 건 디렉터 확정에서).
 *   · 검색량: `keyword`(없으면 title)로 네이버 1회 조회 — 실패해도 topic 은 만든다. 🔴 못 재면 `volume` 을 **적지 않는다**(0 으로 적지 않는다 · AC-9 «못 재는 것을 괜찮다로 접지 않는다»).
 *   · 금칙 카테고리: R4 사전 그대로(`findBannedCategory` · 문장도 디렉터와 같은 것).
 *   · 중복: 30일 안 같은 제목(norm_key)이면 만들지 않고 기존 것을 돌려준다(`step:"duplicate"`).
 *   · 이 소재는 목록 **맨 위**(`source:"manual"` 정렬 키) · 자동 편성(assign_topics)도 먼저 집는다(점수는 부풀리지 않는다).
 */
/** topics-add 전용 도박 단독어(공용 사전 밖 · 여기서만) — 반환 모양은 `findBannedCategory` 와 같다(문장·감사 코드가 같은 길을 탄다). */
const TOPICS_ADD_EXTRA_GAMBLING: readonly string[] = ["카지노", "바카라", "토토", "배팅", "도박"];
function topicsAddExtraBanned(text: string): BannedHit | null {
  const blob = normalizeForBanScan(text);
  if (!blob) return null;
  for (const w of TOPICS_ADD_EXTRA_GAMBLING) if (blob.includes(normalizeForBanScan(w))) return { category: "gambling", label: BANNED_CATEGORY_LABEL.gambling, word: w };
  return null;
}

export type AddTopicResult =
  | { ok: true; topic: Topic; volumeKnown: boolean }
  | { ok: false; step: "title" | "banned_category" | "duplicate" | "channel"; error: string; topic?: Topic };

export async function addManualTopic(tid: number, a: { title: unknown; keyword?: unknown; channelHint?: unknown; angle?: unknown }): Promise<AddTopicResult> {
  const title = String(a.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return { ok: false, step: "title", error: "소재를 한 줄로 적어 주세요." };
  if ([...title].length > 80) return { ok: false, step: "title", error: "소재는 80자까지 적을 수 있어요." };
  const keyword = String(a.keyword ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const angle = String(a.angle ?? "").replace(/\s+/g, " ").trim().slice(0, 300);

  // 금칙 카테고리(성인·도박·의료 과장·비방·불법) — R4 사전 · 디렉터와 같은 문장 · 감사
  //   + [메인 결정 2026-09-15] **이 입구의 제목 검사에 한해** 도박 단독어(카지노·바카라·토토·배팅·도박)를 더 본다.
  //     공용 사전은 «짧은 낱말 오탐 방지»로 조합어만 두는데, 여기는 ≤80자 제목이라 오탐 피해가 작고 사용자가 문구를 보고 고쳐 쓴다.
  //     🔴 `ai-tell-gate`·`banned-categories` 사전 자체는 건드리지 않는다(다른 호출처 전부에 파급된다).
  const banned = findBannedCategory(`${title} ${keyword} ${angle}`) ?? topicsAddExtraBanned(`${title} ${keyword}`);
  if (banned) {
    await writeAudit({ tenantId: tid, action: "topic_banned_category", actorType: "user", riskLevel: "medium", detail: { category: banned.category, word: banned.word, title: title.slice(0, 80), source: "manual" } });
    return { ok: false, step: "banned_category", error: `${banned.label} 주제는 만들 수 없어요.` };
  }

  // 채널 힌트 — 없으면 연결 계정의 첫 채널 · 계정 0 이면 naver_blog
  let channelHint = String(a.channelHint ?? "").trim();
  if (channelHint && !isChannel(channelHint)) return { ok: false, step: "channel", error: "고를 수 없는 채널이에요." };
  if (!channelHint) {
    const accounts = await listAccounts(tid);
    channelHint = accounts[0]?.channel ?? "naver_blog";
  }

  // 중복 — 30일 안 같은 제목이면 만들지 않는다(기존 것을 돌려준다 · 상태 무관)
  const nk = normKey(title);
  const [dup] = await q(sql`SELECT * FROM topics WHERE tenant_id = ${tid} AND norm_key = ${nk} AND created_at > NOW() - (${TOPIC_REUSE_DAYS} || ' days')::interval ORDER BY id DESC LIMIT 1`);
  if (dup) return { ok: false, step: "duplicate", error: "같은 소재가 이미 있어요. 아래에서 그걸 쓰면 돼요.", topic: toTopic(dup) };

  // 검색량 1회 — 실패해도 만든다 · 못 재면 적지 않는다(AC-9)
  const factors: TopicFactors = { intent: "info", pain: 0.6, performance: 0 };
  let volumeKnown = false;
  let compIdx: string | undefined;
  try {
    const seeds = [...new Set([keyword, title].filter(Boolean))];
    const vols = await lookupVolumes(seeds, 8_000);
    const bv = bestVolume(seeds, vols);
    if (bv.volume !== undefined) { factors.volume = bv.volume; volumeKnown = true; }
    /* 🔴 [R8-라] 잰 낱말을 **함께** 적는다 — 숫자만 남기면 그 숫자가 «제목»에 붙어 프롬프트로 나간다(AC-57). */
    if (bv.keyword) factors.keyword = String(bv.keyword).slice(0, 80);
    compIdx = bv.compIdx;
    const comp = competitionOf(compIdx); if (comp) factors.competition = comp;
  } catch (e) { console.warn("[topics-add] 검색량 조회 실패(소재는 만든다):", String((e as Error)?.message ?? e).slice(0, 100)); }
  /* 🔴 못 쟀어도 **사용자가 직접 적은 검색어**는 목표로 남긴다 — 그건 우리가 못 잰 것이지 없는 것이 아니다(AC-9).
     이때 `volume` 은 비어 있고, 프롬프트는 «목표 검색어: X» 만 주고 검색량 괄호를 뺀다(없는 숫자를 지어내지 않는다). */
  if (!factors.keyword && keyword) factors.keyword = keyword.slice(0, 80);
  const seasonal = seasonalFor(`${title} ${angle}`);
  if (seasonal.label) factors.seasonal = seasonal.label;
  const score = computeScore({ demand: demandScore(factors.volume), intent: intentScore("info"), pain: 0.6, compGap: compGapScore(compIdx), difficulty: channelDifficulty(channelHint), seasonal: seasonal.weight, performance: 1 });

  const [row] = await q(sql`INSERT INTO topics (tenant_id, title, angle, norm_key, channel_hint, source, factors, score, status, expires_at)
    VALUES (${tid}, ${title}, ${angle || null}, ${nk}, ${channelHint}, ${"manual"}, ${jsonb(factors)}, ${score}, ${"candidate"}, NOW() + interval '30 days') RETURNING *`);
  const [chk] = await q(sql`SELECT jsonb_typeof(factors) AS t FROM topics WHERE id = ${Number(row.id)}`);
  if (chk?.t !== "object") console.error("[topics-add] factors jsonb_typeof !== object", chk);
  // 🔴 감사는 await(`void writeAudit` 금지)
  await writeAudit({ tenantId: tid, action: "topic_added", actorType: "user", riskLevel: "medium", target: `topic:${Number(row.id)}`, detail: { title: title.slice(0, 80), keyword: keyword || null, channelHint, volumeKnown, volume: factors.volume ?? null } });
  return { ok: true, topic: toTopic(row), volumeKnown };
}

/** 오늘(KST) 직접 넣은 횟수 — 감사 행이 곧 횟수(topics-refresh 관례). */
export async function addCountToday(tid: number): Promise<number> {
  const [r] = await q(sql`SELECT COUNT(*) AS c FROM audit_logs WHERE tenant_id = ${tid} AND action = 'topic_added'
    AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date = (NOW() AT TIME ZONE 'Asia/Seoul')::date`);
  return Number(r?.c || 0);
}
