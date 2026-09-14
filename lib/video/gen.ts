/**
 * lib/video/gen.ts — 영상 생성 오케스트레이터(계약 §1.4 · 6단계). 🔴 15분 벽 3종 세트를 처음부터: `meta.chainStage` 하트비트 · `meta.chainLock`(20분) · `meta.chainResume`(11분 예산 · 상한 3).
 *   AM 원본: ../AutoMarketing/lib/shorts-graphic-story.ts (체인 구조·이어달리기·잠금 관례 이식 2026-09-15 · 원본 af3b237c7 2026-09-10 · creative_assets 대신 pieces/piece_assets · AM SHORTSBILL 실측 수리(#912 $6.9 두 번 쓸 뻔·첫 실행 15분 소실)를 설계에 내장)
 *   단계: script → tts → clips → render(enqueueRender · B2) → judging(finalizeRender 가 judgeVideo) → done.
 *   🔴 컷·문장 산출물은 **만들자마자** `piece_assets`(kind clip|audio) 에 저장한다 — 이어받기에서 다시 만들지 않는다(돈 두 배 금지).
 *   실패 = piece failed + meta.failReason + 코인 환급 + 알림(조용한 0건 금지 · AC-16).
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../db-util";
import { refundPiece } from "../coin-ledger";
import { contractFor, shortsFormOf, type ShortsFormat } from "../writing-contracts";
import { videoBadgeText, videoDescriptionFirstLine, videoOpeningCaption } from "../disclosure";
import { decryptObj } from "../creds-crypto";
import { searchProducts, deeplink, envCoupangKeys, subIdFor, type CoupangKeys } from "../affiliate-coupang";
import { toTopic } from "../topics";
import { buildVideoScript, factcheckRoundTrip, checkScriptGates, youtubeMetaOf } from "./script";
import { buildCutPlans, planCutWindows, PALETTES } from "./scenes";
import { generateClip, generateStill } from "./providers";
import { synthesizeTypecast, typecastAvailable } from "./tts-typecast";
import { synthesizeGemini, isGeminiVoice, type TtsResult, type TtsWord } from "./tts";
import { splitPhrasesForLines, phrasesToRender, phrasesToSrt } from "./captions";
import { checkVideoBudget, estimateVideoCostUsd, videoBudgetMessage, recordVideoBudget } from "./cost";
import { enqueueRender } from "./render-queue";
import { r2Put } from "../r2";
import {
  CHAIN_BUDGET_MS, CHAIN_LOCK_MIN, CHAIN_RESUME_MAX, videoStub,
  type CutPlan, type RenderPayload, type RenderScene, type ScriptLine, type VideoFormat, type VideoSeconds, type VideoSpec, type VideoStage,
} from "./types";

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const nowIso = () => new Date().toISOString();

export type GenResult = { ok: boolean; status: "in_review" | "generating" | "failed" | "skipped"; stage?: VideoStage; reason?: string; resumed?: boolean };

/* ═══ 하트비트·잠금 ═══ */
async function stamp(pieceId: number, stage: VideoStage, extra: Record<string, unknown> = {}): Promise<void> {
  await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ stage, chainStage: { stage, at: nowIso(), ...extra }, ...extra })}, updated_at = NOW() WHERE id = ${pieceId}`);
}
/** 잠금 획득 — 살아 있는 잠금(20분 안)이면 false(즉시 반환) · 죽은 잠금은 뺏는다. */
async function acquireLock(pieceId: number, by: string): Promise<boolean> {
  const [p] = await q(sql`SELECT meta FROM pieces WHERE id = ${pieceId}`);
  const lock = ((p?.meta ?? {}) as Record<string, unknown>).chainLock as { at?: string; by?: string } | null | undefined;
  if (lock?.at && Date.now() - new Date(lock.at).getTime() < CHAIN_LOCK_MIN * 60_000) { console.warn(`[video/gen] piece ${pieceId} 잠금 살아 있음(by ${lock.by}) — 즉시 반환`); return false; }
  await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ chainLock: { at: nowIso(), by } })} WHERE id = ${pieceId}`);
  return true;
}
async function releaseLock(pieceId: number): Promise<void> { await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ chainLock: null })} WHERE id = ${pieceId}`); }

async function failPiece(tid: number, pieceId: number, reason: string, slotId: number | null): Promise<GenResult> {
  const refunded = await refundPiece(tid, pieceId);
  await q(sql`UPDATE pieces SET status = 'failed', meta = meta || ${jsonb({ stage: "failed", chainLock: null, failReason: reason, refunded })}, updated_at = NOW() WHERE id = ${pieceId}`);
  if (slotId) await q(sql`UPDATE slots SET status = 'failed', note = ${reason.slice(0, 300)}, updated_at = NOW() WHERE id = ${slotId}`);
  await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"piece_failed"}, ${"영상을 만들지 못했어요"}, ${`${reason.slice(0, 120)} 코인 ${refunded}개는 돌려드렸어요.`}, ${"/app/pieces.html?status=failed"})`);
  console.error(`[video/gen] piece ${pieceId} 실패: ${reason}`);
  return { ok: false, status: "failed", reason };
}

/* ═══ 재료 ═══ */
async function coupangKeysFor(tid: number, accountId: number | null): Promise<CoupangKeys | null> {
  if (accountId) { const [c] = await q(sql`SELECT enc FROM account_creds WHERE tenant_id = ${tid} AND account_id = ${accountId} AND kind = 'coupang' AND purged_at IS NULL ORDER BY id DESC LIMIT 1`);
    if (c?.enc) { const o = decryptObj<{ accessKey: string; secretKey: string }>(String(c.enc)); if (o?.accessKey && o?.secretKey) return { accessKey: o.accessKey, secretKey: o.secretKey }; } }
  return envCoupangKeys();
}
async function personaFactsFor(tid: number, accountId: number | null): Promise<{ facts: string[]; tone?: string; signature?: string; dict?: Record<string, string> | null }> {
  const [acc] = accountId ? await q(sql`SELECT persona_id FROM accounts WHERE tenant_id = ${tid} AND id = ${accountId}`) : [undefined];
  const [p] = acc?.persona_id ? await q(sql`SELECT profile FROM personas WHERE id = ${n(acc.persona_id)}`) : await q(sql`SELECT profile FROM personas WHERE tenant_id = ${tid} ORDER BY id LIMIT 1`);
  const f = ((p?.profile ?? {}) as Record<string, unknown>);
  const facts: string[] = [];
  for (const [k, label] of [["region", "사는 곳"], ["family", "가족"], ["job", "직업"], ["home", "집"]] as const) { const v = String(f[k] ?? "").trim(); if (v) facts.push(`${label}: ${v}`); }
  return { facts: facts.slice(0, 2), tone: f.tone ? String(f.tone) : undefined, signature: f.signature ? String(f.signature) : undefined, dict: (f.reading && typeof f.reading === "object" ? f.reading as Record<string, string> : null) };
}

/* ═══ 메인 ═══ */
export async function generateVideo(tid: number, pieceId: number, opts: { resume?: boolean; by?: string } = {}): Promise<GenResult> {
  const [p0] = await q(sql`SELECT * FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId} AND kind = 'video'`);
  if (!p0) return { ok: false, status: "failed", reason: "piece 없음(video)" };
  if (String(p0.status) !== "generating") return { ok: true, status: "skipped", reason: "already_done" };   // 멱등
  if (!(await acquireLock(pieceId, opts.by ?? "background"))) return { ok: true, status: "generating", reason: "locked" };
  const slotId = p0.slot_id ? n(p0.slot_id) : null;
  const meta = (p0.meta || {}) as Record<string, unknown>;
  const spec = (meta.video ?? {}) as VideoSpec;
  const t0 = Date.now();
  const overBudget = () => Date.now() - t0 > CHAIN_BUDGET_MS;
  try {
    const [trow] = await q(sql`SELECT * FROM topics WHERE tenant_id = ${tid} AND id = ${n(p0.topic_id)}`);
    if (!trow) return await failPiece(tid, pieceId, "소재를 찾을 수 없어요.", slotId);
    const topic = toTopic(trow);
    const channel = String(p0.channel);
    const accountId = p0.account_id ? n(p0.account_id) : null;
    const format = (spec.format ?? "graphic") as VideoFormat;
    const seconds = (spec.seconds ?? 60) as VideoSeconds;
    const form = shortsFormOf(format as ShortsFormat, seconds);
    const cuts = Math.max(form.cuts.min, Math.min(form.cuts.max, spec.cuts || form.cuts.default));
    const aff = (meta.affiliate ?? null) as { provider: string; productQuery: string } | null;
    const persona = await personaFactsFor(tid, accountId);
    void (await contractFor(channel, "script"));   // 감성 오버레이 접촉(운영자 조정분 반영 · 값은 form 이 정본)

    /* ── ① script ── */
    let script = (meta.script ?? null) as Awaited<ReturnType<typeof buildVideoScript>> extends { ok: true; script: infer S } ? S | null : null;
    if (!opts.resume || !script) {
      await stamp(pieceId, "script");
      const r = await buildVideoScript({ tenantId: tid, pieceId, format, seconds, cuts, channel, topic: { title: topic.title, angle: String(meta.angle || topic.angle), intent: topic.factors.intent, seasonal: topic.factors.seasonal }, persona: { facts: persona.facts, tone: persona.tone, signature: persona.signature }, hookType: spec.variant?.hookType ?? "event_pushin", structure: (meta.structure as string[] | undefined) ?? null, affiliate: aff ? { productQuery: aff.productQuery } : null });
      if (!r.ok) return await failPiece(tid, pieceId, r.reason, slotId);
      let s = r.script; let drafts = r.drafts;
      const fc = await factcheckRoundTrip(tid, pieceId, s);
      if (fc.failed) return await failPiece(tid, pieceId, fc.reason ?? "확인 안 되는 사실이 남아 있어요.", slotId);
      s = fc.script;
      const g = checkScriptGates(s);
      if (!g.ok) {
        const r2 = await buildVideoScript({ tenantId: tid, pieceId, format, seconds, cuts, channel, topic: { title: topic.title, angle: String(meta.angle || topic.angle), intent: topic.factors.intent, seasonal: topic.factors.seasonal }, persona: { facts: persona.facts, tone: persona.tone, signature: persona.signature }, hookType: spec.variant?.hookType ?? "event_pushin", structure: (meta.structure as string[] | undefined) ?? null, affiliate: aff ? { productQuery: aff.productQuery } : null, rewrite: `[다시 쓰기 — 아래에 걸렸다]\n${g.issues.map((x) => `- ${x}`).join("\n")}` });
        if (r2.ok) { const g2 = checkScriptGates(r2.script); if (g2.ok || g2.issues.length < g.issues.length) { s = r2.script; drafts = r2.drafts; } }
      }
      const gateNote = checkScriptGates(s);
      script = s as never;
      await q(sql`UPDATE pieces SET title = ${s.youtube.title.slice(0, 120)}, meta = meta || ${jsonb({ script: s, drafts, hook: s.hook, scriptIssues: gateNote.issues, factcheck: s.factcheck?.status ?? "skipped" })}, updated_at = NOW() WHERE id = ${pieceId}`);
    }
    const sc = (await q(sql`SELECT meta FROM pieces WHERE id = ${pieceId}`))[0];
    const m2 = (sc?.meta ?? {}) as Record<string, unknown>;
    const theScript = m2.script as { lines: ScriptLine[]; hook: string; closing: string; youtube: { title: string; description: string; tags: string[] } };
    const drafts = (m2.drafts ?? []) as { key: string; subject: string; palette?: string }[];
    if (!theScript?.lines?.length) return await failPiece(tid, pieceId, "대본이 비었어요.", slotId);

    /* ── ② tts(문장마다 즉시 저장 · 이어받기) ── */
    await stamp(pieceId, "tts");
    const have = await q(sql`SELECT sort, r2_key, meta FROM piece_assets WHERE piece_id = ${pieceId} AND kind = 'audio' ORDER BY sort`);
    const audio = new Map<number, { key: string; durationMs: number; words: TtsWord[]; provider: string }>();
    for (const a of have) { const am = (a.meta ?? {}) as Record<string, unknown>; audio.set(n(a.sort), { key: String(a.r2_key), durationMs: n(am.durationMs), words: (Array.isArray(am.words) ? am.words : []) as TtsWord[], provider: String(am.provider ?? "typecast") }); }
    const useTypecast = typecastAvailable() || videoStub();
    const voiceId = spec.variant?.voiceId || spec.voice?.voiceId || "";
    for (const [i, line] of theScript.lines.entries()) {
      if (audio.has(i)) continue;
      if (overBudget()) return await handOff(tid, pieceId, "tts", m2, slotId);
      let r: TtsResult = useTypecast && !isGeminiVoice(voiceId)
        ? await synthesizeTypecast({ tenantId: tid, pieceId, text: line.text, keySuffix: `l${i}` }, { voiceId, previousText: theScript.lines[i - 1]?.text ?? null, nextText: theScript.lines[i + 1]?.text ?? null, dict: persona.dict })
        : await synthesizeGemini({ tenantId: tid, pieceId, text: line.text, voice: voiceId, keySuffix: `l${i}`, dict: persona.dict });
      if (!r.ok && useTypecast) r = await synthesizeGemini({ tenantId: tid, pieceId, text: line.text, voice: "Charon", keySuffix: `l${i}`, dict: persona.dict });   // 키 없음·throttle → 정직 폴백(자막 균등 분할)
      if (!r.ok) return await failPiece(tid, pieceId, `목소리를 만들지 못했어요(${r.reason}).`, slotId);
      await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, caption, meta, sort) VALUES (${tid}, ${pieceId}, ${"audio"}, ${r.key}, ${line.text.slice(0, 200)}, ${jsonb({ durationMs: r.durationMs, words: r.words, provider: r.provider, notes: r.notes ?? [] })}, ${i})`);
      audio.set(i, { key: r.key, durationMs: r.durationMs, words: r.words, provider: r.provider });
      await stamp(pieceId, "tts", { cutsDone: audio.size, cutsTotal: theScript.lines.length });
    }
    // 문장 시각(누적 · 컷 경계 = 문장 경계)
    let at = 0;
    const timed = theScript.lines.map((l, i) => { const a = audio.get(i)!; const startMs = at; const endMs = startMs + Math.max(400, a.durationMs) + 120; at = endMs; return { ...l, startMs, endMs, words: a.words, key: a.key }; });
    const totalMs = at;

    /* ── ③ clips(컷마다 즉시 저장 · 이어받기 · 예산 초과 시 이어달리기) ── */
    await stamp(pieceId, "clips");
    const windows = planCutWindows(timed.map((l) => ({ idx: l.idx, cutIdx: l.cutIdx, startMs: l.startMs, endMs: l.endMs })));
    const palette = spec.variant?.palette || PALETTES[(accountId ?? 0) % PALETTES.length];
    const { plans, risks } = buildCutPlans({ windows, lines: timed, drafts, format, seconds, hookType: spec.variant?.hookType ?? "event_pushin", palette });
    if (risks.some((r) => r.risks.some((x) => x.level === "p0"))) return await failPiece(tid, pieceId, `장면 서술이 정책에 걸려요(${risks[0].risks[0].issue}).`, slotId);
    const clipRows = await q(sql`SELECT sort, r2_key FROM piece_assets WHERE piece_id = ${pieceId} AND kind = 'clip' ORDER BY sort`);
    const clips = new Map<number, string>(clipRows.map((c) => [n(c.sort), String(c.r2_key)]));
    // 정지 이미지 컷(토킹 포맷 · §1.4c(2)) — 이미 만든 장은 다시 굽지 않는다.
    const stillRows = await q(sql`SELECT sort, r2_key FROM piece_assets WHERE piece_id = ${pieceId} AND kind = 'image' ORDER BY sort`);
    const stills = new Map<number, string>(stillRows.map((c) => [n(c.sort), String(c.r2_key)]));
    // 🔴 돈이 나가기 직전 원가 관문 재검사(§1.4c(1)) — 소프트는 통과(운영 알림만) · 하드/전역만 막는다. 남은 컷만 센다(이어달리기에서 이미 만든 컷을 두 번 세지 않는다).
    const remain = plans.filter((c) => !(c.mode === "still" ? stills.has(c.idx) : clips.has(c.idx))).length;
    if (remain > 0) {
      const perCut = estimateVideoCostUsd(format, seconds, form.provider, plans.length) / Math.max(1, plans.length);
      const b = await checkVideoBudget(tid, perCut * remain);
      await recordVideoBudget(tid, b, { at: "clips", pieceId, remainCuts: remain });
      if (!b.allowed) return await failPiece(tid, pieceId, videoBudgetMessage(b), slotId);
    }
    for (const cut of plans) {
      if (cut.mode === "still" ? stills.has(cut.idx) : clips.has(cut.idx)) continue;   // 이미 만든 컷은 다시 만들지 않는다(돈 두 배 금지)
      if (overBudget()) return await handOff(tid, pieceId, "clips", m2, slotId);
      if (cut.mode === "still") {
        // 🔴 스킵 금지(계약 §1.4c(2)) — 스킵하면 `clipKey`·`imageKey` 둘 다 없는 장면이 러너에 가서 검은 화면이 된다.
        const s = await generateStill({ tenantId: tid, pieceId, cutIdx: cut.idx, prompt: cut.prompt, ref: `piece:${pieceId}:still${cut.idx}` });
        if (!s.ok) return await failPiece(tid, pieceId, `장면 그림을 만들지 못했어요(${s.reason}).`, slotId);
        await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, caption, meta, sort) VALUES (${tid}, ${pieceId}, ${"image"}, ${s.key}, ${cut.keyword || null}, ${jsonb({ still: true, cutIdx: cut.idx, motion: "kenburns", model: s.model, costUsd: s.costUsd, prompt: cut.prompt.slice(0, 2000) })}, ${cut.idx})`);
        stills.set(cut.idx, s.key);
        await stamp(pieceId, "clips", { cutsDone: clips.size + stills.size, cutsTotal: plans.length });
        continue;
      }
      const r = await generateClip({ tenantId: tid, pieceId, cutIdx: cut.idx, prompt: cut.prompt, providerKey: form.provider, seconds, durationSec: Math.min(8, Math.max(4, Math.round((cut.endMs - cut.startMs) / 1000))), mode: "t2v", ref: `piece:${pieceId}:cut${cut.idx}` });
      if (!r.ok) {
        if (r.policyBlocked) return await failPiece(tid, pieceId, "장면이 정책에 걸려 만들지 못했어요.", slotId);
        return await failPiece(tid, pieceId, `장면을 만들지 못했어요(${r.reason}).`, slotId);
      }
      await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, caption, meta, sort) VALUES (${tid}, ${pieceId}, ${"clip"}, ${r.key}, ${cut.keyword || null}, ${jsonb({ interactionId: r.interactionId ?? null, provider: r.provider, model: r.model, costUsd: r.costUsd, durationSec: r.durationSec, prompt: cut.prompt.slice(0, 2000) })}, ${cut.idx})`);
      clips.set(cut.idx, r.key);
      await stamp(pieceId, "clips", { cutsDone: clips.size + stills.size, cutsTotal: plans.length });
    }

    /* ── 제휴 링크(설명란) ── */
    let affiliateMeta: { provider: string; url: string; subId: string; productName?: string } | null = (m2.affiliateLink ?? null) as never;
    if (aff && !affiliateMeta && !videoStub()) {
      const keys = await coupangKeysFor(tid, accountId);
      if (keys) { const list = await searchProducts(keys, aff.productQuery, 3, subIdFor(pieceId));
        if (list.length) { const prod = list[0]; const subId = subIdFor(pieceId); const url = (await deeplink(keys, prod.productUrl, subId)) || prod.productUrl;
          await q(sql`INSERT INTO affiliate_links (tenant_id, piece_id, provider, sub_id, url, product) VALUES (${tid}, ${pieceId}, ${"coupang"}, ${subId}, ${url}, ${jsonb(prod)})`);
          affiliateMeta = { provider: "coupang", url, subId, productName: prod.productName }; } }
    }

    /* ── ④ render 페이로드 → 러너 잡 ── */
    await stamp(pieceId, "render");
    const phrases = splitPhrasesForLines(timed.map((l) => ({ i: l.idx, text: l.text, startMs: l.startMs, endMs: l.endMs, sceneIdx: l.cutIdx, words: l.words })));
    const srt = phrasesToSrt(phrases);
    const srtKey = `autocreate/${tid}/${pieceId}/captions.srt`;
    await r2Put(srtKey, Buffer.from(srt, "utf8"), "text/plain; charset=utf-8");
    const renderPhrases = phrasesToRender(phrases);
    const scenes: RenderScene[] = plans.map((c) => {
      const clipKey = clips.get(c.idx); const imageKey = stills.get(c.idx);
      const captionIdx = renderPhrases.filter((ph) => ph.startMs >= c.startMs && ph.startMs < c.endMs).map((ph) => ph.idx);
      return { idx: c.idx, startMs: c.startMs, endMs: c.endMs, ...(clipKey ? { clipKey } : imageKey ? { imageKey, motion: "kenburns" as const } : {}), captionIdx };
    });
    // 🔴 계약 §2.1 «clipKey|imageKey 중 하나» — 둘 다 없는 장면은 러너에서 검은 화면이 된다. 잘못된 payload 를 내보내느니 여기서 멈춘다(조용한 축소 0).
    const blind = scenes.filter((s) => !s.clipKey && !s.imageKey);
    if (blind.length) return await failPiece(tid, pieceId, `장면 ${blind.map((s) => s.idx + 1).join("·")}번의 화면이 비어 있어 멈췄어요.`, slotId);
    const affiliate = !!aff;
    const firstLine = affiliate ? videoDescriptionFirstLine(aff?.provider ?? "coupang") : "";
    const yt = youtubeMetaOf(theScript as never, { firstLine, tags: [] });
    const description = affiliateMeta ? `${yt.description}\n\n${affiliateMeta.productName ?? "상품"} 보러가기: ${affiliateMeta.url}` : yt.description;
    const payload: RenderPayload = {
      pieceId, tenantId: tid,
      out: { w: 1080, h: 1920, fps: 30, maxSeconds: seconds, crf: 20 },
      scenes,
      captions: { preset: form.captionPreset, phrases: renderPhrases, srtKey },
      audio: { narration: timed.map((l) => ({ key: l.key, startMs: l.startMs })), bgm: null, sfx: null, loudnorm: { I: -16, TP: -1.5, LRA: 11 } },
      overlay: { badge: affiliate ? { text: videoBadgeText(), corner: "tr" } : null, safeZone: { top: 220, bottom: 300 }, endcard: { text: theScript.closing.slice(0, 40) } },
      disclosureCaption: affiliate ? { text: videoOpeningCaption(), untilMs: 3000 } : null,
    };
    await q(sql`UPDATE pieces SET body = ${description}, blocks = ${jsonb([{ type: "video" }, { type: "srt" }, { type: "hashtags", items: yt.tags }])},
      meta = meta || ${jsonb({ render: payload, youtube: { ...yt, description }, affiliateLink: affiliateMeta, affiliateHint: aff && !affiliateMeta ? aff.productQuery : undefined, totalMs, cutCount: plans.length, disclosure: affiliate ? firstLine : null, adDisclosure: affiliate })}, updated_at = NOW() WHERE id = ${pieceId}`);
    const [chk] = await q(sql`SELECT jsonb_typeof(meta) AS m, jsonb_typeof(blocks) AS b FROM pieces WHERE id = ${pieceId}`);
    if (chk?.m !== "object" || chk?.b !== "array") console.error("[video/gen] jsonb_typeof 이상", chk);
    const enq = await enqueueRender(pieceId, payload);
    console.log(`[video/gen] piece ${pieceId} 렌더 잡 ${enq.jobId}(created=${enq.created}) · 컷 ${plans.length} · ${Math.round(totalMs / 100) / 10}s`);
    await releaseLock(pieceId);
    return { ok: true, status: "generating", stage: "render" };
  } catch (e) {
    await releaseLock(pieceId);
    return await failPiece(tid, pieceId, `만드는 중에 문제가 생겼어요(${String((e as Error)?.message ?? e).slice(0, 160)}).`, slotId);
  }
}

/** 이어달리기 — 예산을 넘기면 스스로 멈추고 같은 함수를 다시 부른다(재시도와 다른 축 · 상한 3). */
async function handOff(tid: number, pieceId: number, stage: VideoStage, meta: Record<string, unknown>, slotId: number | null): Promise<GenResult> {
  const resume = ((meta.chainResume ?? {}) as { count?: number }).count ?? 0;
  if (resume >= CHAIN_RESUME_MAX) return await failPiece(tid, pieceId, `제작이 너무 오래 걸려 멈췄어요(${stage} 단계까지 진행).`, slotId);
  await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ chainResume: { count: resume + 1, at: nowIso() }, chainLock: null, stage })}, updated_at = NOW() WHERE id = ${pieceId}`);
  const fired = await triggerVideo(pieceId, tid, true);
  console.warn(`[video/gen] piece ${pieceId} 이어달리기 ${resume + 1}/${CHAIN_RESUME_MAX}(${stage}) fired=${fired}`);
  return { ok: true, status: "generating", stage, resumed: true };
}

/** 배경 함수 호출(계약 §1.2·§1.4 · AC-16: 실패를 삼키지 않는다 · netlify dev 는 background 를 동기 실행하므로 타임아웃은 «닿았다»로 본다 · AC-12). */
export async function triggerVideo(pieceId: number, tid: number, resume = false): Promise<boolean> {
  const secret = String(process.env.INTERNAL_SECRET ?? "").trim();
  const site = String(process.env.SITE_URL ?? "").replace(/\/$/, "");
  if (!secret || !site) { const missing = !secret ? "INTERNAL_SECRET" : "SITE_URL"; await failPiece(tid, pieceId, `서버 설정(${missing})이 없어 만들기를 시작하지 못했어요.`, null); return false; }
  try {
    const r = await fetch(`${site}/api/generate-video-background`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-secret": secret }, body: JSON.stringify({ pieceId, tenantId: tid, resume }), signal: AbortSignal.timeout(6_000) });
    if (r.status !== 202 && !r.ok) { await failPiece(tid, pieceId, `만들기를 시작하지 못했어요(서버 응답 ${r.status}).`, null); return false; }
    return true;
  } catch (e) {
    const err = e as Error;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") return true;
    await failPiece(tid, pieceId, "만들기를 시작하지 못했어요(서버에 연결하지 못했어요).", null);
    return false;
  }
}

/**
 * 확정 직전 원가 관문 선검사(계약 §1.2 · §1.4c(1)) — 코인 차감 **전**에 부른다.
 *   🔴 소프트(플랜 일일 상한) 초과는 **통과**시킨다 — 고객은 이미 코인을 냈다. 운영 알림만 남는다(`recordVideoBudget`).
 *   막는 것은 하드(일일 상한 × 3) · 전역 월 상한 · kill switch · 조회 실패뿐.
 */
export async function precheckVideoBudget(tid: number, format: VideoFormat, seconds: VideoSeconds, providerKey: VideoSpec["provider"]["key"], cuts: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const add = estimateVideoCostUsd(format, seconds, providerKey, cuts);
  const b = await checkVideoBudget(tid, add);
  await recordVideoBudget(tid, b, { at: "precheck", addUsd: add, format, seconds, cuts });
  return b.allowed ? { ok: true } : { ok: false, error: videoBudgetMessage(b) };
}
void (undefined as unknown as CutPlan);
