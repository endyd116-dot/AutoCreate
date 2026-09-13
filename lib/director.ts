/**
 * lib/director.ts — 디렉터(DESIGN §5.3 결정 규칙 6 을 결정론 함수로 · LLM 은 «앵글 가르기» 1콜). 계약 §3 v1.1.
 *   AM 관례(content-director «앞뒤만 한다»): 재료 모으기·배정·게이트만. 글은 content-gen 하나가 쓴다.
 *   propose: 채널 = topic.channelHint ∩ 계정 있는 글 채널(힌트 먼저 · 최대 3채널 · 채널당 1piece) · 계정 = active|pending_login · posts_today<daily_cap · health 높은 순
 *            · 구성 = 그 계정 직전 글과 다른 format(writing-contracts 로테이션) · 일정 = best-time(계정 간 30분·min_gap·지난 시각이면 내일)
 *            · 제휴 = intent commercial|mixed → coupang(productQuery=소재 검색어 · slot mid/end) · 이미지 = 채널 기본 · coinCost = blog 1 + image×count.
 *   confirm: 패치 적용 → 잔액 선검사 → piece(generating·meta.stage writing)+slot(manual·producing) → consume(piece:{id} · piece:{id}:img{i}) → 경합 실패 시 refund+삭제 롤백 → 배경 생성 함수 호출.
 *   Brief.goal: tistory/blogger/wordpress 계정 → adsense · naver_blog → adpost · intent commercial → affiliate · 섞이면 mixed.
 */
import { sql } from "drizzle-orm";
import { jsonb, utcDate } from "./db-util";
import { q, listAccounts, TEXT_CHANNELS, type AccountRow } from "./accounts";
import { contractFor, pickFormat, defaultImageCount, type FormatKey, type WritingContract } from "./writing-contracts";
import { pickPublishAt, kstDateStr } from "./best-time";
import { balance, consume, refundPiece } from "./coin-ledger";
import { coinCostOf } from "./coin-table";
import { callGeminiJson } from "./ai";
import { CHAIN_DIRECTOR } from "./ai-models";
import { toTopic, type Topic } from "./topics";
import { guardSlot, type PieceOrigin } from "./slot-gate";
import { seasonalFor } from "./kr-calendar";

const n = (v: unknown) => Number(v || 0);

export type Goal = "adsense" | "adpost" | "affiliate" | "ypp" | "clip_incentive" | "mixed";
export interface Affiliate { provider: "coupang"; productQuery: string; slot: "mid" | "end" | "both" }
export interface PieceSpec {
  key: string; channel: string; accountId: number | null; accountHandle: string | null;
  format: FormatKey; emotionKey: string; composition: string; lengthHint: { words: number };
  images: { count: number; style: "photo" | "illust" | "infographic"; heroNeeded: boolean };
  monetize: { affiliate: Affiliate | null; adDisclosure: boolean };
  schedule: { at: string; slotReason: string }; coinCost: number;
  /** 추가(계약 외 · A 무시 가능): 채널별로 가른 앵글 — content-gen 재료. */
  angle: string;
}
export interface Brief { id: number; topicId: number; goal: Goal; mode: "auto" | "reviewed"; coinCost: number; coinsLeft: number; reasons: string[]; pieces: PieceSpec[] }
export interface PieceSpecPatch { key: string; accountId?: number; format?: string; emotionKey?: string; images?: { count?: number; style?: string }; monetize?: { affiliate?: { productQuery: string; slot: string } | null }; schedule?: { at: string }; drop?: true }

const wordsOf = (c: WritingContract) => { const w = Math.round(((c.length?.min ?? 1500) + (c.length?.max ?? 2500)) / 2 / 2.2); return Number.isFinite(w) ? w : 900; };   // 한국어 글자→어절 근사
const pieceCoin = (imageCount: number) => coinCostOf("blog") + coinCostOf("image") * imageCount;

export function goalOf(pieces: { channel: string }[], intent: string): Goal {
  const set = new Set<Goal>();
  for (const p of pieces) { if (p.channel === "naver_blog" || p.channel === "naver_clip") set.add("adpost"); else if (["tistory", "blogger", "wordpress"].includes(p.channel)) set.add("adsense"); }
  if (intent === "commercial") set.add("affiliate");
  if (set.size === 0) return "mixed";
  return set.size === 1 ? [...set][0] : "mixed";
}

/** 테넌트가 잡아 둔 발행 시각(채널별 · 계정별) — 계정 간 30분 · min_gap 계산 재료. */
async function takenTimes(tid: number): Promise<{ byChannel: Map<string, Date[]>; byAccount: Map<number, Date[]> }> {
  const rows = await q(sql`
    SELECT channel, account_id, publish_at AS at FROM slots WHERE tenant_id = ${tid} AND publish_at IS NOT NULL AND status NOT IN ('skipped','failed','published') AND publish_at > NOW() - interval '1 day'
    UNION ALL
    SELECT channel, account_id, scheduled_for AS at FROM pieces WHERE tenant_id = ${tid} AND scheduled_for IS NOT NULL AND status IN ('scheduled','approved','publishing','generating','in_review') AND scheduled_for > NOW() - interval '1 day'`);
  const byChannel = new Map<string, Date[]>(); const byAccount = new Map<number, Date[]>();
  for (const r of rows) {
    const at = utcDate(r.at); if (!at) continue;
    const ch = String(r.channel); byChannel.set(ch, [...(byChannel.get(ch) ?? []), at]);
    if (r.account_id) { const a = n(r.account_id); byAccount.set(a, [...(byAccount.get(a) ?? []), at]); }
  }
  return { byChannel, byAccount };
}

async function recentFormats(tid: number, accountId: number | null, channel: string): Promise<string[]> {
  const rows = accountId
    ? await q(sql`SELECT format FROM pieces WHERE tenant_id = ${tid} AND account_id = ${accountId} AND status <> 'rejected' ORDER BY id DESC LIMIT 5`)
    : await q(sql`SELECT format FROM pieces WHERE tenant_id = ${tid} AND channel = ${channel} AND status <> 'rejected' ORDER BY id DESC LIMIT 5`);
  return rows.map((r) => String(r.format || "")).filter(Boolean);
}

/** 계정 배정(§5.3-2): active|pending_login · posts_today < daily_cap · health 높은 순(→ id). */
export function assignAccount(accounts: AccountRow[], channel: string): AccountRow | null {
  const pool = accounts.filter((a) => a.channel === channel && (a.status === "active" || a.status === "pending_login") && a.postsToday < a.dailyCap)
    .sort((a, b) => b.healthScore - a.healthScore || a.id - b.id);
  return pool[0] ?? null;
}

/* ───────── propose ───────── */
export async function propose(tid: number, topicId: number): Promise<{ ok: true; brief: Brief } | { ok: false; step: string; error: string }> {
  const [trow] = await q(sql`SELECT * FROM topics WHERE tenant_id = ${tid} AND id = ${topicId}`);
  if (!trow) return { ok: false, step: "not_found", error: "소재를 찾을 수 없어요." };
  const topic = toTopic(trow);
  if (!["candidate", "picked"].includes(topic.status)) return { ok: false, step: "topic_state", error: "이미 쓴 소재예요. 다른 소재를 골라 주세요." };
  const accounts = await listAccounts(tid);
  const connected = [...new Set(accounts.filter((a) => TEXT_CHANNELS.has(a.channel) && a.status !== "suspended" && a.status !== "disconnected").map((a) => a.channel))];
  if (!connected.length) return { ok: false, step: "no_account", error: "먼저 글 채널 계정을 하나 연결해 주세요." };
  const channels = [...(connected.includes(topic.channelHint) ? [topic.channelHint] : []), ...connected.filter((c) => c !== topic.channelHint)].slice(0, 3);

  const taken = await takenTimes(tid);
  const intent = topic.factors.intent;
  const affiliateBase: Affiliate | null = intent === "commercial" ? { provider: "coupang", productQuery: topic.title, slot: "mid" } : intent === "mixed" ? { provider: "coupang", productQuery: topic.title, slot: "end" } : null;
  const specs: PieceSpec[] = [];
  for (const ch of channels) {
    const c = await contractFor(ch);
    const acc = assignAccount(accounts, ch);
    const format = pickFormat(c, await recentFormats(tid, acc?.id ?? null, ch), `${topic.id}:${ch}:${acc?.id ?? 0}`);
    const chTaken = taken.byChannel.get(ch) ?? [];
    const sched = pickPublishAt({ channel: ch, goldenHours: acc?.goldenHours ?? null, taken: chTaken, takenSameAccount: acc ? (taken.byAccount.get(acc.id) ?? []) : [], minGapMin: acc?.minGapMin });
    taken.byChannel.set(ch, [...chTaken, sched.at]);
    if (acc) taken.byAccount.set(acc.id, [...(taken.byAccount.get(acc.id) ?? []), sched.at]);
    const imageCount = defaultImageCount(ch);
    specs.push({
      key: `${ch}:${acc?.id ?? 0}`, channel: ch, accountId: acc?.id ?? null, accountHandle: acc?.handle ?? null,
      format, emotionKey: c.emotionKey, composition: c.formatLabel[format] || format, lengthHint: { words: wordsOf(c) },
      images: { count: imageCount, style: c.images.style, heroNeeded: ch === "naver_blog" || ch === "tistory" },
      monetize: { affiliate: affiliateBase ? { ...affiliateBase } : null, adDisclosure: !!affiliateBase },
      schedule: { at: sched.at.toISOString(), slotReason: sched.reason }, coinCost: pieceCoin(imageCount), angle: topic.angle,
    });
  }

  // LLM 1콜 — 채널별로 앵글을 가른다(같은 소재 두 채널이면 다른 관점) + 이유 3줄(사람말)
  const reasons: string[] = [];
  try {
    const system = "너는 콘텐츠 디렉터다. 같은 소재를 채널마다 «다른 관점»으로 갈라 준다(같은 문장·같은 구조 금지). 근거 없는 수치·최상급 금지. 출력 JSON: { \"pieces\": [ { \"key\": string, \"angle\": string(그 채널 독자에게 맞춘 관점 한 문장 · 60자 내) } ], \"reasons\": [string×3 · 왜 이 배치인지 사용자에게 말하듯 한 문장씩 · 시스템 용어 금지] }";
    const user = [
      `[소재] ${topic.title}\n[기본 앵글] ${topic.angle}\n[검색 의도] ${intent}${topic.factors.volume ? ` · 월 검색 ${topic.factors.volume.toLocaleString()}` : ""}${topic.factors.seasonal ? ` · 시즌 ${topic.factors.seasonal}` : ""}`,
      `[배치]\n${specs.map((s) => `- key ${s.key} · ${s.channel} · ${s.composition} · 계정 ${s.accountHandle ?? "미정"} · ${s.monetize.affiliate ? "제휴 상품 포함" : "제휴 없음"} · ${s.schedule.slotReason}`).join("\n")}`,
    ].join("\n\n");
    const r = await callGeminiJson<{ pieces?: { key: string; angle: string }[]; reasons?: string[] }>({ purpose: "director", chain: CHAIN_DIRECTOR, role: "director", system, user, tenantId: tid, ref: `topic:${topic.id}`, mode: "pro", maxOutputTokens: 1500, budgetMs: 20_000 });
    if (r.ok) {
      for (const p of r.data?.pieces ?? []) { const s = specs.find((x) => x.key === p?.key); if (s && p?.angle) s.angle = String(p.angle).trim().slice(0, 200); }
      for (const x of r.data?.reasons ?? []) if (typeof x === "string" && x.trim()) reasons.push(x.trim().slice(0, 120));
    }
  } catch (e) { console.warn("[director] 앵글 LLM 실패 — 기본 앵글 유지", String((e as Error)?.message ?? e).slice(0, 100)); }
  if (reasons.length < 3) {
    const season = seasonalFor(topic.title);
    const fill = [
      specs.length > 1 ? `${specs.map((s) => s.accountHandle ? `@${s.accountHandle}` : s.channel).join(" · ")}에 서로 다른 관점으로 나눠 실어요.` : `${specs[0].accountHandle ? `@${specs[0].accountHandle}` : specs[0].channel}에 ${specs[0].composition} 구성으로 써요.`,
      topic.factors.volume ? `«${topic.title}»는 한 달에 ${topic.factors.volume.toLocaleString()}번 검색돼요${topic.factors.competition === "low" ? " · 경쟁이 낮은 편이에요" : ""}.` : season.label ? `${season.label} 시즌이라 지금 올리면 좋아요.` : `직전 글과 다른 구성이라 계정이 단조로워 보이지 않아요.`,
      specs[0].schedule.slotReason + "에 나가요.",
    ];
    for (const f of fill) if (reasons.length < 3) reasons.push(f);
  }

  const goal = goalOf(specs, intent);
  const coinCost = specs.reduce((a, s) => a + s.coinCost, 0);
  const [b] = await q(sql`INSERT INTO briefs (tenant_id, topic_id, goal, pieces, reasons, mode, status, coin_cost)
    VALUES (${tid}, ${topic.id}, ${goal}, ${jsonb(specs)}, ${jsonb(reasons)}, ${"reviewed"}, ${"proposed"}, ${coinCost}) RETURNING id`);
  const briefId = n(b?.id);
  const [chk] = await q(sql`SELECT jsonb_typeof(pieces) AS t FROM briefs WHERE id = ${briefId}`);
  if (chk?.t !== "array") console.error("[director] briefs.pieces jsonb_typeof !== array", chk);
  const bal = await balance(tid);
  return { ok: true, brief: { id: briefId, topicId: topic.id, goal, mode: "reviewed", coinCost, coinsLeft: bal.balance, reasons, pieces: specs } };
}

/* ───────── confirm ───────── */
export type ConfirmResult =
  | { ok: true; briefId: number; pieceIds: number[]; coinsCharged: number; coinsLeft: number }
  | { ok: false; step: "coin_short"; error: string; need: number; have: number }
  | { ok: false; step: string; error: string };

/**
 * confirm 옵션(P1R2 — 자동 편성).
 *   🔴 `origin` 기본값은 **"auto"(fail-closed)**: 아무 말 없이 부르면 게이트를 탄다(CLAUDE §4.7 · PITFALLS AC-2).
 *      사람이 누르는 경로(`/api/director-confirm`)는 `origin:"manual"` 을 **명시**한다. 빼먹으면 열리는 설계는 결국 열린다.
 *   `slotId` 가 오면 **새 슬롯을 만들지 않고 그 편성 자리를 쓴다**(크론 경로) — 없으면 지금처럼 새 슬롯을 만든다(사람 경로).
 */
export interface ConfirmOpts { slotId?: number | null; origin?: PieceOrigin }

async function applyPatches(tid: number, specs: PieceSpec[], patches: PieceSpecPatch[]): Promise<{ ok: true; specs: PieceSpec[] } | { ok: false; error: string }> {
  const accounts = await listAccounts(tid);
  const out: PieceSpec[] = [];
  for (const s of specs) {
    const p = patches.find((x) => x?.key === s.key);
    if (!p) { out.push(s); continue; }
    if (p.drop) continue;
    const c = await contractFor(s.channel, p.emotionKey || s.emotionKey);
    const next: PieceSpec = { ...s, images: { ...s.images }, monetize: { ...s.monetize }, schedule: { ...s.schedule } };
    if (p.accountId !== undefined) {
      const a = accounts.find((x) => x.id === n(p.accountId) && x.channel === s.channel);
      if (!a) return { ok: false, error: "그 채널의 계정이 아니에요." };
      next.accountId = a.id; next.accountHandle = a.handle; next.key = `${s.channel}:${a.id}`;
    }
    if (p.format !== undefined) { if (!c.formats.includes(p.format as FormatKey)) return { ok: false, error: "이 채널에서 쓸 수 없는 구성이에요." }; next.format = p.format as FormatKey; next.composition = c.formatLabel[next.format] || next.format; }
    if (p.emotionKey) next.emotionKey = String(p.emotionKey).slice(0, 40);
    if (p.images?.count !== undefined) next.images.count = Math.max(c.images?.min ?? 0, Math.min(c.images?.max ?? 10, Math.trunc(n(p.images.count))));
    if (p.images?.style && ["photo", "illust", "infographic"].includes(p.images.style)) next.images.style = p.images.style as PieceSpec["images"]["style"];
    if (p.monetize && "affiliate" in p.monetize) {
      const af = p.monetize.affiliate;
      next.monetize.affiliate = af && af.productQuery ? { provider: "coupang", productQuery: String(af.productQuery).slice(0, 120), slot: (["mid", "end", "both"].includes(String(af.slot)) ? af.slot : "mid") as Affiliate["slot"] } : null;
      next.monetize.adDisclosure = !!next.monetize.affiliate;
    }
    if (p.schedule?.at) { const d = new Date(p.schedule.at); if (Number.isNaN(d.getTime())) return { ok: false, error: "시각 형식을 확인해 주세요." }; if (d.getTime() < Date.now() + 10 * 60_000) return { ok: false, error: "지금보다 10분 이상 뒤로 잡아 주세요." }; next.schedule = { at: d.toISOString(), slotReason: "직접 고른 시각" }; }
    next.coinCost = pieceCoin(next.images.count);
    out.push(next);
  }
  return { ok: true, specs: out };
}

export async function confirm(tid: number, briefId: number, patches: PieceSpecPatch[] = [], actorId: number | null = null, opts: ConfirmOpts = {}): Promise<ConfirmResult> {
  const origin: PieceOrigin = opts.origin === "manual" ? "manual" : "auto";   // 기본 auto = fail-closed
  const reuseSlotId = Math.floor(Number(opts.slotId) || 0) || null;
  const [b] = await q(sql`SELECT * FROM briefs WHERE tenant_id = ${tid} AND id = ${briefId}`);
  if (!b) return { ok: false, step: "not_found", error: "지시서를 찾을 수 없어요." };
  if (String(b.status) !== "proposed") {
    // 재확정 = 멱등: 이미 만든 piece 들을 돌려준다(코인 재차감 0)
    const ex = await q(sql`SELECT id FROM pieces WHERE tenant_id = ${tid} AND brief_id = ${briefId} ORDER BY id`);
    const bal = await balance(tid);
    return { ok: true, briefId, pieceIds: ex.map((r) => n(r.id)), coinsCharged: 0, coinsLeft: bal.balance };
  }
  const base = (Array.isArray(b.pieces) ? b.pieces : []) as PieceSpec[];
  const ap = await applyPatches(tid, base, Array.isArray(patches) ? patches : []);
  if (!ap.ok) return { ok: false, step: "patch", error: ap.error };
  const specs = ap.specs;
  if (!specs.length) return { ok: false, step: "empty", error: "만들 글이 없어요. 하나는 남겨 주세요." };
  const total = specs.reduce((a, s) => a + s.coinCost, 0);
  const bal0 = await balance(tid);
  if (bal0.balance < total) return { ok: false, step: "coin_short", error: `코인이 ${total - bal0.balance}개 부족해요.`, need: total - bal0.balance, have: bal0.balance };

  /* 🔴 슬롯 게이트(CLAUDE §4.7 절대 게이트) — 자동 경로가 piece 를 만들려면 «어느 편성 자리의 몫인지» 말해야 한다.
     사람 경로(origin:"manual")는 통과. 거부는 감사 + 홈 «해야 할 일»에 남는다(조용한 0건 금지 · AC-2). */
  const gate = await guardSlot({ tenantId: tid, channel: specs[0].channel, origin, slotId: reuseSlotId, source: "director.confirm", topic: String(b.topic_id ?? "") });
  if (!gate.ok) return { ok: false, step: "slot_gate", error: gate.reason ?? "편성표에 없는 자동 생성이에요." };

  const topicId = n(b.topic_id);
  // 빌려 쓸 자리의 원래 상태·채널(롤백 복원용 · 채널 대조용). 게이트를 이미 통과했으니 행은 있다.
  let reuseSlotPrevStatus = "topic_assigned", reuseChannel = specs[0].channel, usedReuseSlot = false;
  if (reuseSlotId) {
    const [rs] = await q(sql`SELECT status, channel FROM slots WHERE tenant_id = ${tid} AND id = ${reuseSlotId}`);
    if (rs) { reuseSlotPrevStatus = String(rs.status); reuseChannel = String(rs.channel); }
  }
  const created: { pieceId: number; slotId: number; reused?: { prevStatus: string } }[] = [];
  let charged = 0;
  const rollback = async (reason: string) => {
    for (const c of created) {
      await refundPiece(tid, c.pieceId);
      // 빌려 쓴 편성 자리는 **지우지 않는다** — 원래 상태로 돌려놓는다(달력에서 자리가 증발하면 그날은 영영 비어 있다).
      if (c.reused) await q(sql`UPDATE slots SET status = ${c.reused.prevStatus}, piece_id = NULL, brief_id = NULL, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${c.slotId}`);
      else await q(sql`DELETE FROM slots WHERE tenant_id = ${tid} AND id = ${c.slotId}`);
      await q(sql`DELETE FROM piece_assets WHERE piece_id = ${c.pieceId}`);
      await q(sql`DELETE FROM pieces WHERE tenant_id = ${tid} AND id = ${c.pieceId}`);
    }
    console.warn(`[director] confirm 롤백 brief=${briefId} reason=${reason} pieces=${created.map((c) => c.pieceId).join(",")}`);
  };
  try {
    for (const s of specs) {
      const meta = { stage: "writing", key: s.key, emotionKey: s.emotionKey, format: s.format, composition: s.composition, imageCount: s.images.count, imageStyle: s.images.style, heroNeeded: s.images.heroNeeded, affiliate: s.monetize.affiliate, adDisclosure: s.monetize.adDisclosure, scheduleAt: s.schedule.at, slotReason: s.schedule.slotReason, angle: s.angle, lengthWords: s.lengthHint.words, coinItem: "blog", regenCount: 0 };
      const [p] = await q(sql`INSERT INTO pieces (tenant_id, brief_id, topic_id, account_id, channel, kind, format, status, meta, scheduled_for)
        VALUES (${tid}, ${briefId}, ${topicId}, ${s.accountId}, ${s.channel}, ${"post"}, ${s.format}, ${"generating"}, ${jsonb(meta)}, ${s.schedule.at}::timestamptz AT TIME ZONE 'UTC') RETURNING id`);
      const pieceId = n(p?.id);
      /* 편성 자리를 빌려 쓰는가(크론) — 아니면 지금처럼 새 자리를 만든다(사람이 «만들기»로 끼워 넣는 글).
         빌려 쓰는 자리는 **채널이 같은 첫 spec 하나**에만 준다(한 자리에 두 글이 들어갈 수 없다). */
      let slotId: number, reused: { prevStatus: string } | undefined;
      if (reuseSlotId && !usedReuseSlot && s.channel === reuseChannel) {
        usedReuseSlot = true;
        const [sl] = await q(sql`UPDATE slots SET piece_id = ${pieceId}, brief_id = ${briefId}, topic_id = ${topicId}, account_id = ${s.accountId},
            status = ${"producing"}, note = NULL, updated_at = NOW()
          WHERE tenant_id = ${tid} AND id = ${reuseSlotId} AND piece_id IS NULL RETURNING id`);
        if (!sl) { await rollback("slot_taken"); return { ok: false, step: "slot_gate", error: "편성 자리를 그새 다른 글이 차지했어요." }; }
        slotId = reuseSlotId; reused = { prevStatus: reuseSlotPrevStatus };
      } else {
        const slotDate = kstDateStr(new Date(s.schedule.at));
        const [sl] = await q(sql`INSERT INTO slots (tenant_id, slot_date, channel, kind, account_id, topic_id, brief_id, piece_id, publish_at, status, origin)
          VALUES (${tid}, ${slotDate}::date, ${s.channel}, ${"post"}, ${s.accountId}, ${topicId}, ${briefId}, ${pieceId}, ${s.schedule.at}::timestamptz AT TIME ZONE 'UTC', ${"producing"}, ${origin}) RETURNING id`);
        slotId = n(sl?.id);
      }
      await q(sql`UPDATE pieces SET slot_id = ${slotId} WHERE id = ${pieceId}`);
      created.push({ pieceId, slotId, ...(reused ? { reused } : {}) });
      const c1 = await consume(tid, "blog", `piece:${pieceId}`, { actorId, auto: origin === "auto", reason: `블로그 글(${s.channel})` });
      if (!c1.ok) { await rollback(c1.reason); return c1.reason === "insufficient" ? { ok: false, step: "coin_short", error: `코인이 ${c1.need}개 부족해요.`, need: c1.need, have: c1.have } : { ok: false, step: "coin_write", error: "코인 차감에 실패했어요. 잠시 후 다시 해 주세요." }; }
      charged += c1.charged;
      for (let i = 1; i <= s.images.count; i++) {
        const ci = await consume(tid, "image", `piece:${pieceId}:img${i}`, { actorId, auto: origin === "auto", reason: `이미지 ${i}/${s.images.count}` });
        if (!ci.ok) { await rollback(ci.reason); return ci.reason === "insufficient" ? { ok: false, step: "coin_short", error: `코인이 ${ci.need}개 부족해요.`, need: ci.need, have: ci.have } : { ok: false, step: "coin_write", error: "코인 차감에 실패했어요. 잠시 후 다시 해 주세요." }; }
        charged += ci.charged;
      }
    }
    const [chk] = await q(sql`SELECT jsonb_typeof(meta) AS t FROM pieces WHERE id = ${created[0].pieceId}`);
    if (chk?.t !== "object") console.error("[director] pieces.meta jsonb_typeof !== object", chk);
    await q(sql`UPDATE briefs SET status = 'confirmed', pieces = ${jsonb(specs)}, coin_cost = ${total} WHERE id = ${briefId}`);
    await q(sql`UPDATE topics SET status = 'used', used_at = NOW() WHERE tenant_id = ${tid} AND id = ${topicId}`);
  } catch (e) {
    await rollback(String((e as Error)?.message ?? e));
    throw e;
  }
  await Promise.all(created.map((c) => triggerGenerate(c.pieceId, tid)));   // ★C4 fix: 호출 실패를 삼키지 않는다(배경 함수는 202 즉답) · piece 여럿이면 동시에
  const bal = await balance(tid);
  return { ok: true, briefId, pieceIds: created.map((c) => c.pieceId), coinsCharged: charged, coinsLeft: bal.balance };
}

/**
 * 배경 생성 호출 실패 처리 — piece 를 failed 로 내리고 코인 환급·알림·슬롯 표시(content-gen 실패 경로와 같은 처치).
 *   ★C4 fix(2026-09-14 · PITFALLS AC-6): 호출이 실패해도 piece 가 generating 에 남으면 «코인은 빠졌는데 화면은 영원히 만드는 중»이 된다 —
 *   홈 «해야 할 일»은 in_review 만 세므로 사용자에게 아무 신호도 가지 않는다(조용한 0건 금지).
 */
async function failTrigger(tid: number, pieceId: number, reason: string): Promise<void> {
  try {
    const [p] = await q(sql`SELECT slot_id, meta FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId} AND status = 'generating'`);
    if (!p) return;   // 이미 다른 경로가 처리함(멱등)
    const refunded = await refundPiece(tid, pieceId);
    const meta = (p.meta || {}) as Record<string, unknown>;
    const body = `«${String(meta.angle || "").slice(0, 40) || "글"}» 을(를) 시작하지 못했어요. 코인 ${refunded}개는 돌려드렸어요.`;
    // piece·slot·알림을 한 왕복으로(왕복이 늘면 동기 함수 한도 안에서 중간에 잘려 «failed 로만 바뀌고 알림은 없는» 반쪽 상태가 된다 — 실측 2026-09-14)
    await q(sql`WITH up AS (
        UPDATE pieces SET status = 'failed', meta = meta || ${jsonb({ stage: "failed", failReason: reason, refunded })}, updated_at = NOW()
        WHERE id = ${pieceId} AND tenant_id = ${tid} RETURNING slot_id
      ), sl AS (
        UPDATE slots SET status = 'failed', note = ${reason}, updated_at = NOW()
        WHERE tenant_id = ${tid} AND id = (SELECT slot_id FROM up) RETURNING id
      )
      INSERT INTO notifications (tenant_id, kind, title, body, link)
      SELECT ${tid}, ${"piece_failed"}, ${"글을 만들지 못했어요"}, ${body}, ${"/app/pieces.html?status=failed"} FROM up`);
  } catch (e) { console.error("[director] failTrigger 실패", String((e as Error)?.message ?? e)); }
}

/** 배경 생성 함수 호출(POST · x-internal-secret). 실패는 전부 정직하게 piece failed + 환급 + 알림(폴백 0). */
export async function triggerGenerate(pieceId: number, tid: number): Promise<boolean> {
  const secret = String(process.env.INTERNAL_SECRET ?? "").trim();
  const site = String(process.env.SITE_URL ?? "").replace(/\/$/, "");
  if (!secret || !site) {
    const missing = !secret ? "INTERNAL_SECRET" : "SITE_URL";
    console.error(`[director] ${missing} 미설정 — 배경 생성 호출 불가`);
    await failTrigger(tid, pieceId, `서버 설정(${missing})이 없어 생성을 시작하지 못했어요.`);
    return false;
  }
  try {
    const r = await fetch(`${site}/api/generate-piece-background`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-secret": secret }, body: JSON.stringify({ pieceId, tenantId: tid }) });
    if (r.status !== 202 && !r.ok) {
      console.error(`[director] 배경 함수 호출 ${r.status}`);
      await failTrigger(tid, pieceId, `생성을 시작하지 못했어요(서버 응답 ${r.status}).`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[director] 배경 함수 호출 실패", String((e as Error)?.message ?? e));
    await failTrigger(tid, pieceId, "생성을 시작하지 못했어요(서버에 연결하지 못했어요).");
    return false;
  }
}
