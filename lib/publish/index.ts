/**
 * lib/publish/index.ts — 발행 진입점(계약 §3·§10). B 의 크론 publisher 는 이 파일의 `publish()` / `publishPieceById()` 하나만 부른다.
 *   AC 신규 2026-09-14(B2).
 *
 *   흐름
 *     ① 멱등 — piece 에 external_url/channel_ref 가 있으면 **아무것도 하지 않는다**(CLAUDE §4.7 절대 게이트).
 *     ② 발행 가능 상태인가 · 계정이 살아 있나
 *     ③ 🔴 발행 직전 최종 게이트(§16B) — 고지 복원·금칙어·제휴 링크 ≤2. 실패면 발행 금지 `{ ok:false, reason:"gate" }`.
 *        게이트가 본문을 고쳤으면(고지 복원·애드센스 실체화) **저장까지 한다** — «올린 것 = 저장된 것».
 *     ④ 채널 분기 — API 채널(blogger·wordpress)은 직접 발행 후 `finalizePublish` 까지 · 러너 채널은 `runner_jobs` 적재.
 *
 *   🔴 성공 시 상태 쓰기는 finalizePublish 한 곳 · 실패 시 슬롯 처리는 B(반환 reason 으로 분기) ·
 *      러너 실패 종결은 `lib/runner-jobs.ts`(잡을 넘긴 뒤의 주인은 B2).
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb, utcDate } from "../db-util";
import { writeAudit } from "../audit";
import { normalizeBlocks, type Block } from "../blocks";
import { publishViaOf as strictPublishViaOf, type PublishPiece, type PublishAccount, type PublishOpts, type PublishResult, type PublishOk } from "./contract";
import { connectMethodOf } from "../accounts";
import { runPublishGate } from "./gate";
import { finalizePublish } from "./finalize";
import { publishToBlogger } from "./blogger";
import { publishToWordpress } from "./wordpress";
import { enqueueJob as enqueueRunnerJob, fleetState, publishJobKindOf, type RunnerJobKind, type RunnerPublishPayload } from "../runner-jobs";

export * from "./contract";
export { finalizePublish } from "./finalize";
export { runPublishGate } from "./gate";

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** 발행을 걸 수 있는 piece 상태 — 검수 전(generating·draft·in_review)·거절·이미 발행은 안 된다. */
const PUBLISHABLE: ReadonlySet<string> = new Set(["approved", "scheduled", "publishing", "awaiting_manual", "failed"]);
/** 계정이 이 상태면 발행하지 않는다(사람이 손봐야 한다). */
const BLOCKED_ACCOUNT: ReadonlySet<string> = new Set(["suspended", "disconnected", "pending_login", "limited"]);

/* ─────────────────────────── 로더 ─────────────────────────── */

/** pieces + piece_assets → PublishPiece. B 가 행을 다시 짜지 않도록 B2 가 한 벌만 만든다. */
export async function loadPublishPiece(tid: number, pieceId: number): Promise<PublishPiece | null> {
  const [p] = await q(sql`SELECT id, tenant_id, channel, account_id, slot_id, title, body, blocks, meta, status, scheduled_for, external_url, channel_ref
    FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId} LIMIT 1`);
  if (!p) return null;
  const meta = (p.meta && typeof p.meta === "object" ? p.meta : {}) as Record<string, unknown>;
  const assets = await q(sql`SELECT caption, meta, sort FROM piece_assets WHERE piece_id = ${pieceId} AND kind = 'image' ORDER BY sort`);
  const out: PublishPiece = {
    id: n(p.id), tenantId: n(p.tenant_id), channel: String(p.channel ?? ""), accountId: n(p.account_id) || null,
    title: String(p.title ?? ""), bodyHtml: String(p.body ?? ""),
    blocks: normalizeBlocks(p.blocks) as Block[],
    images: assets.map((a) => {
      const m = (a.meta && typeof a.meta === "object" ? a.meta : {}) as Record<string, unknown>;
      const img: { url: string; caption?: string; sort?: number } = { url: String(m.url ?? ""), sort: n(a.sort) };
      if (a.caption) img.caption = String(a.caption);
      return img;
    }).filter((i) => !!i.url),
    tags: Array.isArray(meta.tags) ? (meta.tags as unknown[]).map(String).slice(0, 20) : [],
    disclosure: meta.disclosure ? String(meta.disclosure) : null,
    status: String(p.status ?? ""),
  };
  if (n(p.slot_id)) out.slotId = n(p.slot_id);
  if (meta.affiliate && typeof meta.affiliate === "object") {
    const af = meta.affiliate as Record<string, unknown>;
    out.affiliate = { provider: String(af.provider ?? "coupang"), url: String(af.url ?? ""), ...(af.subId ? { subId: String(af.subId) } : {}) };
  }
  const sf = utcDate(p.scheduled_for); if (sf) out.scheduledFor = sf.toISOString();
  if (p.external_url) out.externalUrl = String(p.external_url);
  if (p.channel_ref) out.channelRef = String(p.channel_ref);
  return out;
}

/** accounts 행 → PublishAccount(🔴 자격 평문 없음 · proxyUrl 은 러너 잡용 원문). */
export async function loadPublishAccount(tid: number, accountId: number): Promise<PublishAccount | null> {
  const [a] = await q(sql`SELECT id, tenant_id, channel, handle, display_name, status, browser_profile_key, proxy_url,
      daily_cap, min_gap_min, posts_today, last_post_at, monetize
    FROM accounts WHERE tenant_id = ${tid} AND id = ${accountId} LIMIT 1`);
  if (!a) return null;
  const out: PublishAccount = {
    id: n(a.id), tenantId: n(a.tenant_id), channel: String(a.channel ?? ""), handle: String(a.handle ?? ""),
    status: String(a.status ?? ""), browserProfileKey: String(a.browser_profile_key || `t${tid}-a${n(a.id)}`),
    dailyCap: n(a.daily_cap) || 2, minGapMin: n(a.min_gap_min) || 180, postsToday: n(a.posts_today),
    monetize: (a.monetize && typeof a.monetize === "object" ? a.monetize : {}) as Record<string, unknown>,
  };
  if (a.display_name) out.displayName = String(a.display_name);
  if (a.proxy_url) out.proxyUrl = String(a.proxy_url);
  const lp = utcDate(a.last_post_at); if (lp) out.lastPostAt = lp.toISOString();
  return out;
}

/* ─────────────────────────── 정본 ─────────────────────────── */

/** 🔴 정본. piece 한 편을 채널에 맞게 발행한다(API 채널=직접 · 러너 채널=잡 적재). */
export async function publish(piece: PublishPiece, account: PublishAccount | null, opts: PublishOpts = {}): Promise<PublishResult> {
  const via = strictPublishViaOf(piece.channel);
  if (!via) return { ok: false, reason: "unsupported_channel", retriable: false, error: "아직 이 채널로는 발행할 수 없어요.", detail: piece.channel };

  // ① 멱등 — 이미 나간 글은 두 번 나가지 않는다.
  if (piece.externalUrl || piece.channelRef) {
    await writeAudit({ tenantId: piece.tenantId, action: "publish_skipped_idempotent", actorType: "system", target: `piece:${piece.id}`, detail: { externalUrl: piece.externalUrl ?? null }, riskLevel: "low" });
    const out: PublishOk = { ok: true, via, already: true };
    if (piece.externalUrl) out.externalUrl = piece.externalUrl;
    if (piece.channelRef) out.channelRef = piece.channelRef;
    return out;
  }

  // ② 발행할 수 있는 글·계정인가
  if (!PUBLISHABLE.has(piece.status)) {
    return { ok: false, reason: "not_publishable", retriable: false, error: "아직 올릴 수 있는 글이 아니에요.", detail: `status=${piece.status}` };
  }
  if (!piece.bodyHtml.trim() || !piece.title.trim()) {
    return { ok: false, reason: "not_publishable", retriable: false, error: "제목이나 본문이 비어 있어요.", detail: "empty_body" };
  }
  if (!account) return { ok: false, reason: "no_account", retriable: false, error: "올릴 계정이 없어요. 계정을 연결해 주세요." };
  if (account.channel !== piece.channel) {
    return { ok: false, reason: "no_account", retriable: false, error: "글과 계정의 채널이 달라요.", detail: `${piece.channel}≠${account.channel}` };
  }
  if (BLOCKED_ACCOUNT.has(account.status)) {
    return {
      ok: false, reason: "account_blocked", retriable: false,
      error: account.status === "pending_login" ? `@${account.handle} 계정에 다시 로그인해 주세요.` : `@${account.handle} 계정을 지금은 쓸 수 없어요.`,
      detail: `account_status=${account.status}`,
    };
  }

  // ③ 🔴 발행 직전 최종 게이트(§16B)
  const gate = runPublishGate(
    { channel: piece.channel, title: piece.title, bodyHtml: piece.bodyHtml, affiliate: piece.affiliate ?? null, adDisclosure: !!piece.disclosure },
    { adsensePub: String((account.monetize as Record<string, unknown> | undefined)?.adsensePub ?? "") },
  );
  if (gate.changed && !opts.dryRun) {
    // 고친 본문을 저장한다 — «올린 것 = 저장된 것»(검수창·발행함이 같은 본문을 본다).
    try { await q(sql`UPDATE pieces SET body = ${gate.bodyHtml}, gate_report = ${jsonb(gate.report)}, updated_at = NOW() WHERE id = ${piece.id}`); }
    catch (e) { console.error("[publish] body persist failed", e); }
  }
  if (!gate.ok) {
    await writeAudit({
      tenantId: piece.tenantId, action: "publish_gate_blocked", actorType: "system", target: `piece:${piece.id}`,
      detail: { failed: gate.report.checks.filter((c) => !c.pass).map((c) => c.key) }, riskLevel: "medium",
    });
    return { ok: false, reason: "gate", retriable: false, error: "발행 전 확인이 필요해요.", gate: gate.report };
  }
  const prepared: PublishPiece = { ...piece, bodyHtml: gate.bodyHtml };

  if (opts.dryRun) return { ok: true, via, dryRun: true };

  /* ④-A 러너 채널 — 잡을 적재하고 러너가 가져가기를 기다린다. */
  if (via === "runner") {
    const kind = publishJobKindOf(piece.channel);
    if (!kind) return { ok: false, reason: "unsupported_channel", retriable: false, error: "아직 이 채널로는 발행할 수 없어요.", detail: piece.channel };
    const payload: RunnerPublishPayload = {
      title: prepared.title, bodyHtml: prepared.bodyHtml, blocks: prepared.blocks,
      images: prepared.images.map((i) => ({ url: i.url, ...(i.caption ? { caption: i.caption } : {}) })),
      tags: prepared.tags, disclosure: prepared.disclosure,
      ...(prepared.scheduledFor ? { scheduledFor: prepared.scheduledFor } : {}),
      ...(opts.slotId ?? prepared.slotId ? { slotId: opts.slotId ?? prepared.slotId } : {}),
    };
    const job = await enqueueRunnerJob({ tenantId: piece.tenantId, kind, accountId: account.id, pieceId: piece.id, payload });
    // 러너가 집어 가기 전에 크론이 같은 piece 를 또 집지 않도록 publishing 으로 옮긴다(잡 적재 자체도 멱등).
    await q(sql`UPDATE pieces SET status = 'publishing', updated_at = NOW() WHERE id = ${piece.id} AND status <> 'published'`);
    const runner = await fleetState(piece.tenantId);
    await writeAudit({
      tenantId: piece.tenantId, action: "publish_queued_runner", actorType: "system", target: `piece:${piece.id}`,
      detail: { jobId: job.id, created: job.created, kind, accountId: account.id, runnerOnline: runner.online }, riskLevel: "low",
    });
    return { ok: true, via: "runner", jobId: job.id, runner };
  }

  /* ④-B API 채널 — 지금 바로 올리고 finalize 까지 한다. */
  const r = piece.channel === "blogger" ? await publishToBlogger(prepared, account)
    : piece.channel === "wordpress" ? await publishToWordpress(prepared, account)
      : { ok: false as const, reason: "unsupported_channel" as const, retriable: false, error: "아직 이 채널로는 발행할 수 없어요." };

  if (!r.ok) {
    await writeAudit({
      tenantId: piece.tenantId, action: "publish_failed", actorType: "system", target: `piece:${piece.id}`,
      detail: { channel: piece.channel, reason: r.reason, retriable: r.retriable, detail: r.detail ?? null }, riskLevel: "medium",
    });
    return { ok: false, reason: r.reason, retriable: r.retriable, error: r.error, ...(r.detail ? { detail: r.detail } : {}) };
  }

  const fin = await finalizePublish(piece.id, {
    via: "api", externalUrl: r.externalUrl, ...(r.channelRef ? { channelRef: r.channelRef } : {}),
    accountId: account.id, tenantId: piece.tenantId,
  });
  if (!fin.ok) {
    /* 남의 서버에는 글이 올라갔는데 우리 기록이 실패했다 — **재발행하면 중복 글이 된다**.
       그래서 실패로 돌려주되 retriable:false 로 못을 박고, 사람이 볼 수 있게 남긴다. */
    await writeAudit({
      tenantId: piece.tenantId, action: "publish_finalize_failed", actorType: "system", target: `piece:${piece.id}`,
      detail: { externalUrl: r.externalUrl, reason: fin.reason, detail: fin.detail ?? null }, riskLevel: "high",
    });
    return { ok: false, reason: "config", retriable: false, error: "글은 올라갔는데 기록에 실패했어요. 담당이 확인합니다.", detail: `finalize_${fin.reason}` };
  }

  const out: PublishOk = { ok: true, via: "api", externalUrl: r.externalUrl, finalized: true, postId: fin.postId };
  if (r.channelRef) out.channelRef = r.channelRef;
  if (fin.already) out.already = true;
  return out;
}

/* ─────────────────────── B 의 포트가 집어 가는 이름들 ───────────────────────
 *   `lib/cron/publish-port.ts` 가 이 모듈에서 `publishPieceById` · `publishViaOf` · `enqueueJob` 을 찾는다.
 *   포트의 타입에 맞춘 **어댑터**를 여기서 준다 — B 가 모양을 맞추느라 다시 짜지 않게.
 */

/**
 * 포트용 채널 판정 — 포트의 `PublishViaOfFn` 은 null 을 모른다.
 *   아직 발행을 못 하는 채널(클립·쓰레드…)은 «라우팅상» 포트의 기본 규칙과 같은 답을 주고,
 *   실제 차단은 `publish()` 가 `unsupported_channel` 로 한다(판정기 두 벌 금지 · PITFALLS #11-b).
 *   🔴 엄격한 판정(«못 올리는 채널 = null»)이 필요하면 `contract.ts` 의 동명 함수를 쓴다.
 */
export function publishViaOf(channel: string): "api" | "runner" {
  return strictPublishViaOf(channel) ?? (connectMethodOf(channel) === "session" ? "runner" : "api");
}

/** 포트용 러너 잡 적재 어댑터(포트 시그니처: `(tid, input) => { ok, jobId, already? }`). */
export async function enqueueJob(
  tid: number,
  input: { kind: RunnerJobKind; accountId?: number | null; pieceId?: number | null; payload?: Record<string, unknown>; priority?: number; dueAt?: Date | string | null },
): Promise<{ ok: true; jobId: number; already?: boolean } | { ok: false; error: string }> {
  try {
    // ⚠️ AC-5 — drizzle sql 템플릿에 Date 를 바인딩하면 postgres-js 가 터진다. ISO 문자열로 바꿔 넘긴다.
    const dueAt = input.dueAt instanceof Date ? input.dueAt.toISOString() : (input.dueAt ? String(input.dueAt) : undefined);
    const r = await enqueueRunnerJob({
      tenantId: tid, kind: input.kind,
      accountId: input.accountId ?? null, pieceId: input.pieceId ?? null,
      payload: input.payload ?? {},
      ...(Number.isFinite(Number(input.priority)) ? { priority: Number(input.priority) } : {}),
      ...(dueAt ? { dueAt } : {}),
    });
    return { ok: true, jobId: r.id, ...(r.created ? {} : { already: true }) };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) };
  }
}

/** 크론 `runner.reap`(5분) 이 부르는 이름 — 큐 SQL 을 B 가 다시 쓰지 않게 여기서도 내보낸다. */
export { reapStaleJobs, fleetState as runnerFleetState } from "../runner-jobs";
/** 크론 `slots.learn` 이 API 채널 통계를 물어보는 이름(포트 `FetchStatsFn`) — null = «못 물어봤다»(0 으로 적지 않는다 · AC-9). */
export { fetchStats } from "./stats";

/** 편의 진입점 — 행 로드까지 B2 가 한다. B 의 publisher 는 id 만 주면 된다. */
export async function publishPieceById(tenantId: number, pieceId: number, opts: PublishOpts = {}): Promise<PublishResult> {
  const piece = await loadPublishPiece(tenantId, pieceId);
  if (!piece) return { ok: false, reason: "not_publishable", retriable: false, error: "글을 찾을 수 없어요.", detail: `piece:${pieceId}` };
  const account = piece.accountId ? await loadPublishAccount(tenantId, piece.accountId) : null;
  return publish(piece, account, opts);
}
