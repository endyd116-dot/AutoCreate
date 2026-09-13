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
 *   norm_key = 공백제거·NFC·lower(title). 30일 내 used/picked 와 같으면 버림. expires_at = +7일.
 */
import { db } from "../db/index";
import { sql, type SQL } from "drizzle-orm";
import { jsonb, utcDate } from "./db-util";
import { callGeminiJson } from "./ai";
import { CHAIN_DIRECTOR } from "./ai-models";
import { lookupVolumes, normKw, type KeywordVolume } from "./naver-volume";
import { lookupGrowth } from "./naver-datalab";
import { seasonalFor, seasonLine } from "./kr-calendar";
import { listAccounts, TEXT_CHANNELS } from "./accounts";
import { AD_LAW_BANNED, normalizeForBanScan } from "./banned-words";

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

export type TopicIntent = "info" | "commercial" | "mixed";
export interface TopicFactors { volume?: number; growthPct?: number; competition?: "low" | "mid" | "high"; intent: TopicIntent; pain?: number; seasonal?: string; performance?: number }
export interface Topic { id: number; title: string; angle: string; channelHint: string; score: number; status: string; factors: TopicFactors; expiresAt: string }

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
interface Candidate { title: string; angle: string; seedKeywords: string[]; channelHint: string; intent: TopicIntent; pain: number }

async function tenantContext(tid: number) {
  const [t] = await q(sql`SELECT settings FROM tenants WHERE id = ${tid}`);
  const settings = (t?.settings && typeof t.settings === "object" ? t.settings : {}) as Record<string, unknown>;
  const accounts = await listAccounts(tid);
  const accountChannels = [...new Set(accounts.map((a) => a.channel))].filter((c) => TEXT_CHANNELS.has(c));
  const settingChannels = (Array.isArray(settings.channels) ? (settings.channels as unknown[]).map(String) : []).filter((c) => TEXT_CHANNELS.has(c));
  const channels = accountChannels.length ? accountChannels : settingChannels.length ? settingChannels : ["naver_blog", "tistory"];
  const personaIds = [...new Set(accounts.map((a) => a.personaId).filter(Boolean))] as number[];
  const personas = personaIds.length ? await q(sql`SELECT name, profile FROM personas WHERE tenant_id = ${tid} AND id IN (${sql.join(personaIds.map((i) => sql`${i}`), sql`, `)})`) : await q(sql`SELECT name, profile FROM personas WHERE tenant_id = ${tid} ORDER BY id LIMIT 2`);
  const recent = await q(sql`SELECT title FROM topics WHERE tenant_id = ${tid} AND created_at > NOW() - interval '30 days' ORDER BY id DESC LIMIT 60`);
  return { settings, channels, personas: personas.map((p) => ({ name: String(p.name), profile: (p.profile || {}) as Record<string, unknown> })), recentTitles: recent.map((r) => String(r.title)) };
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
    "출력은 JSON 하나: { \"candidates\": [ { \"title\": string(검색어가 앞에 오는 자연스러운 한국어 제목 25자 내), \"angle\": string(어떤 관점·경험으로 풀지 한 문장), \"seedKeywords\": [string×3 · 네이버에서 실제로 치는 짧은 검색어 · 공백 없이], \"channelHint\": string(아래 채널 키 중 하나), \"intent\": \"info\"|\"commercial\"|\"mixed\", \"pain\": number(0~1 · 얼마나 절실한 고민인가) } ×15 ] }",
    "채널 힌트 규칙: 경험담·생활 밀착·사진이 어울리면 naver_blog · 정리·비교·가이드는 tistory 또는 blogger/wordpress · 짧은 훅·의견은 threads.",
    "15개는 서로 다른 주제여야 하고(같은 주제의 변주 금지), 상업 의도(intent commercial/mixed)를 5개 안팎 섞는다.",
  ].join("\n");
  const user = [
    `[대상 채널] ${ctx.channels.join(", ")}`,
    ctx.personas.length ? `[운영자 페르소나(사정)]\n${ctx.personas.map(personaLine).join("\n")}` : "[운영자 페르소나] 아직 없음 — 1인 가구·직장인·자취 같은 넓은 사정으로",
    `[계절] ${seasonLine()}`,
    ctx.recentTitles.length ? `[최근 30일 이미 쓴 소재 — 겹치지 말 것]\n${ctx.recentTitles.slice(0, 40).map((t) => `- ${t}`).join("\n")}` : "",
    "위 조건으로 후보 15개를 JSON 으로.",
  ].filter(Boolean).join("\n\n");
  const r = await callGeminiJson<{ candidates?: Candidate[] }>({ purpose: "topics", chain: CHAIN_DIRECTOR, role: "director", system, user, tenantId: tid, ref: `topics:${tid}`, mode: "pro", maxOutputTokens: 6000 });
  if (!r.ok) throw Object.assign(new Error(`소재 후보 생성 실패: ${r.reason}`), { step: "ai" });
  const list = Array.isArray(r.data?.candidates) ? r.data.candidates : [];
  return list.map((c) => ({
    title: String(c?.title ?? "").trim().slice(0, 120),
    angle: String(c?.angle ?? "").trim().slice(0, 300),
    seedKeywords: (Array.isArray(c?.seedKeywords) ? c.seedKeywords : []).map((k) => String(k ?? "").replace(/\s+/g, "").trim()).filter(Boolean).slice(0, 3),
    channelHint: TEXT_CHANNELS.has(String(c?.channelHint)) && ctx.channels.includes(String(c.channelHint)) ? String(c.channelHint) : ctx.channels[0],
    intent: (["info", "commercial", "mixed"].includes(String(c?.intent)) ? String(c.intent) : "info") as TopicIntent,
    pain: Math.max(0.3, Math.min(1, Number(c?.pain) || 0.5)),
  })).filter((c) => c.title && !hasSuperlative(`${c.title} ${c.angle}`));
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

export function toTopic(r: Row): Topic {
  const f = (r.factors && typeof r.factors === "object" ? r.factors : {}) as Record<string, unknown>;
  const factors: TopicFactors = { intent: (["info", "commercial", "mixed"].includes(String(f.intent)) ? String(f.intent) : "info") as TopicIntent };
  if (Number.isFinite(Number(f.volume)) && f.volume !== undefined && f.volume !== null) factors.volume = Number(f.volume);
  if (Number.isFinite(Number(f.growthPct)) && f.growthPct !== undefined && f.growthPct !== null) factors.growthPct = Number(f.growthPct);
  if (["low", "mid", "high"].includes(String(f.competition))) factors.competition = String(f.competition) as TopicFactors["competition"];
  if (Number.isFinite(Number(f.pain)) && f.pain !== undefined && f.pain !== null) factors.pain = Number(f.pain);
  if (f.seasonal) factors.seasonal = String(f.seasonal);
  factors.performance = Number(f.performance) || 0;
  return { id: Number(r.id), title: String(r.title), angle: String(r.angle ?? ""), channelHint: String(r.channel_hint ?? ""), score: Number(r.score ?? 0), status: String(r.status), factors, expiresAt: utcDate(r.expires_at)?.toISOString() ?? "" };
}

export async function listTopics(tid: number, status = "candidate"): Promise<Topic[]> {
  const rows = status === "all"
    ? await q(sql`SELECT * FROM topics WHERE tenant_id = ${tid} ORDER BY score DESC, id DESC LIMIT 100`)
    : await q(sql`SELECT * FROM topics WHERE tenant_id = ${tid} AND status = ${status} AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY score DESC, id DESC LIMIT 100`);
  return rows.map(toTopic);
}

export async function refreshCountToday(tid: number): Promise<number> {
  const [r] = await q(sql`SELECT COUNT(*) AS c FROM audit_logs WHERE tenant_id = ${tid} AND action = 'topics_refresh'
    AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date = (NOW() AT TIME ZONE 'Asia/Seoul')::date`);
  return Number(r?.c || 0);
}

/** refreshTopics — 후보 생성 → 검색량·트렌드 → 스코어 → upsert. 반환 added(새로 만든 행 수). */
export async function refreshTopics(tid: number): Promise<{ added: number; skipped: number; volumesKnown: boolean; growthKnown: boolean }> {
  const ctx = await tenantContext(tid);
  const cands = await generateCandidates(tid, ctx);
  const seeds = cands.flatMap((c) => c.seedKeywords.length ? c.seedKeywords : [c.title.replace(/\s+/g, "")]);
  const vols = await lookupVolumes(seeds);
  const volumesKnown = vols.size > 0;
  const bestKw: string[] = [];
  const enriched = cands.map((c) => {
    const bv = bestVolume(c.seedKeywords.length ? c.seedKeywords : [c.title.replace(/\s+/g, "")], vols);
    if (bv.keyword) bestKw.push(bv.keyword);
    return { c, bv };
  });
  const growth = await lookupGrowth(bestKw);
  const growthKnown = growth.size > 0;
  const used = await q(sql`SELECT norm_key FROM topics WHERE tenant_id = ${tid} AND status IN ('used','picked') AND created_at > NOW() - interval '30 days'`);
  const usedKeys = new Set(used.map((r) => String(r.norm_key)));
  let added = 0, skipped = 0;
  for (const { c, bv } of enriched) {
    const nk = normKey(c.title);
    if (!nk || usedKeys.has(nk)) { skipped++; continue; }
    const seasonal = seasonalFor(`${c.title} ${c.angle}`);
    const factors: TopicFactors = { intent: c.intent, pain: Math.round(c.pain * 100) / 100, performance: 0 };
    if (bv.volume !== undefined) factors.volume = bv.volume;
    const comp = competitionOf(bv.compIdx); if (comp) factors.competition = comp;
    const g = bv.keyword ? growth.get(bv.keyword) : undefined; if (g !== undefined) factors.growthPct = g;
    if (seasonal.label) factors.seasonal = seasonal.label;
    const score = computeScore({ demand: demandScore(bv.volume), intent: intentScore(c.intent), pain: c.pain, compGap: compGapScore(bv.compIdx), difficulty: channelDifficulty(c.channelHint), seasonal: seasonal.weight, performance: 1 });
    const [ex] = await q(sql`SELECT id, score, status FROM topics WHERE tenant_id = ${tid} AND norm_key = ${nk} ORDER BY id DESC LIMIT 1`);
    if (ex && String(ex.status) === "candidate") {
      await q(sql`UPDATE topics SET angle = ${c.angle}, channel_hint = ${c.channelHint}, factors = ${jsonb(factors)}, score = ${score}, expires_at = NOW() + interval '7 days' WHERE id = ${Number(ex.id)}`);
      skipped++; continue;
    }
    await q(sql`INSERT INTO topics (tenant_id, title, angle, norm_key, channel_hint, source, factors, score, status, expires_at)
      VALUES (${tid}, ${c.title}, ${c.angle}, ${nk}, ${c.channelHint}, ${"ai"}, ${jsonb(factors)}, ${score}, ${"candidate"}, NOW() + interval '7 days')`);
    added++;
  }
  const [chk] = await q(sql`SELECT jsonb_typeof(factors) AS t FROM topics WHERE tenant_id = ${tid} ORDER BY id DESC LIMIT 1`);
  if (chk && chk.t !== "object") console.error("[topics] factors jsonb_typeof !== object", chk);
  if (!volumesKnown) console.warn(`[topics] tid=${tid} 검색량 미상(키워드툴 키 없음 또는 실패) — volume 키 생략`);
  return { added, skipped, volumesKnown, growthKnown };
}
