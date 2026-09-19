/**
 * lib/publish/index.ts — 발행 진입점(계약 §3·§10). B 의 크론 publisher 는 이 파일의 `publish()` / `publishPieceById()` 하나만 부른다.
 *   AC 신규 2026-09-14(B2).
 *
 *   흐름
 *     ① 멱등 — piece 에 external_url/channel_ref 가 있으면 **아무것도 하지 않는다**(CLAUDE §4.7 절대 게이트).
 *     ② 발행 가능 상태인가 · 계정이 살아 있나
 *     ③ 발행 직전 최종 검사(§16B) — 고지 복원·금칙어·제휴 링크 ≤2.
 *        🔴 **실패해도 막지 않는다**(`CLAUDE.md §9` · 사장님 2026-09-15 «말해 주기로 내려. 고객 계정이야»).
 *        감사 `publish_gate_risks` 에 남기고 `gate_report` 를 **늘 저장**해 «나갈 때 어떤 위험이 있었나»가 발행함에 보이게 한 뒤 **그대로 내보낸다.**
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
import { formatCapsOf } from "../channel-registry";   // [R9-4] 채널 꾸밈 표 — 러너 payload 에 같이 싣는다
import { publishViaOf as strictPublishViaOf, type PublishPiece, type PublishImage, type PublishAccount, type PublishOpts, type PublishResult, type PublishOk, type PublishFailReason } from "./contract";
import { connectMethodOf } from "../accounts";
import { runPublishGate } from "./gate";
import { finalizePublish } from "./finalize";
import { publishToBlogger } from "./blogger";
import { publishToWordpress } from "./wordpress";
import { publishYoutubeShorts, publishYoutubeLong } from "./youtube";
import { publishReels, publishInstagramFeed } from "./instagram";
import { publishThreadsText, publishThreadsVideo } from "./threads";
// [P1R8 §3.4] 다음 Phase 채널 — 페북(글·릴스) · X · 틱톡.
import { publishFacebookPost, publishFacebookReels } from "./facebook";
import { publishToX } from "./x";
import { publishToTiktok } from "./tiktok";
import { enqueueJob as enqueueRunnerJob, fleetState, publishJobKindOf, type RunnerJobKind, type RunnerPublishPayload } from "../runner-jobs";

export * from "./contract";
export { finalizePublish } from "./finalize";
export { runPublishGate } from "./gate";

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/* ═══ [P1R8 §3.4] API 채널 → 커넥터 표 ═══
 *   종전엔 삼항 사슬이었는데 채널이 5개에서 **11개**가 되면서 읽을 수 없게 됐다.
 *   🔴 표로 바꾸면서 지킨 선: **이 표에 없으면 «아직 못 올린다»** 이지 «추측해서 보낸다»가 아니다
 *      (`channel-registry` 가 `publishVia: "api"` 라고 말했는데 여기 없으면 그건 두 표가 갈라진 것이고,
 *       `scripts/verify-channel-tables.mjs` 가 그걸 잡는다).
 *   🔴 스레드는 **글도 영상도** 되는 채널이라 `piece.kind` 로 가른다 — 채널만 보고는 못 가르는 자리다(P1R7 §2.3).
 *      종전엔 무조건 영상으로 보내서, 스레드로 예약한 **글은 «올릴 영상이 아직 없어요»로 영원히 막혔다**.
 */
type ApiConnector = (piece: PublishPiece, account: PublishAccount) => Promise<PublishResult | { ok: true; externalUrl: string; channelRef?: string } | { ok: false; reason: PublishFailReason; retriable: boolean; error: string; detail?: string }>;
const API_CONNECTORS: Readonly<Record<string, ApiConnector>> = {
  blogger: publishToBlogger,
  wordpress: publishToWordpress,
  youtube_shorts: publishYoutubeShorts,
  youtube_long: publishYoutubeLong,
  reels: publishReels,
  instagram: publishInstagramFeed,
  facebook: publishFacebookPost,
  facebook_reels: publishFacebookReels,
  x: publishToX,
  tiktok: publishToTiktok,
  threads: (p, a) => (p.kind === "video" ? publishThreadsVideo(p, a) : publishThreadsText(p, a)),
};

/** 발행을 걸 수 있는 piece 상태 — 검수 전(generating·draft·in_review)·거절·이미 발행은 안 된다. */
const PUBLISHABLE: ReadonlySet<string> = new Set(["approved", "scheduled", "publishing", "awaiting_manual", "failed"]);
/** 계정이 이 상태면 발행하지 않는다(사람이 손봐야 한다). */
const BLOCKED_ACCOUNT: ReadonlySet<string> = new Set(["suspended", "disconnected", "pending_login", "limited"]);

/* ─────────────────────────── 로더 ─────────────────────────── */

/** pieces + piece_assets → PublishPiece. B 가 행을 다시 짜지 않도록 B2 가 한 벌만 만든다. */
export async function loadPublishPiece(tid: number, pieceId: number): Promise<PublishPiece | null> {
  const [p] = await q(sql`SELECT id, tenant_id, channel, kind, account_id, slot_id, title, body, blocks, meta, status, scheduled_for, external_url, channel_ref
    FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId} LIMIT 1`);
  if (!p) return null;
  const meta = (p.meta && typeof p.meta === "object" ? p.meta : {}) as Record<string, unknown>;
  const assets = await q(sql`SELECT caption, meta, sort FROM piece_assets WHERE piece_id = ${pieceId} AND kind = 'image' ORDER BY sort`);
  const out: PublishPiece = {
    id: n(p.id), tenantId: n(p.tenant_id), channel: String(p.channel ?? ""), kind: String(p.kind ?? "post"), accountId: n(p.account_id) || null,
    title: String(p.title ?? ""), bodyHtml: String(p.body ?? ""),
    blocks: normalizeBlocks(p.blocks) as Block[],
    images: assets.map((a) => {
      const m = (a.meta && typeof a.meta === "object" ? a.meta : {}) as Record<string, unknown>;
      const img: PublishImage = { url: String(m.url ?? ""), sort: n(a.sort) };
      if (a.caption) img.caption = String(a.caption);
      // alt 는 `meta.alt`(B-1 84a2372 가 남긴다). 아직 없는 옛 행이면 캡션으로 내려앉는다 — 지금까지와 같은 동작.
      if (m.alt) img.alt = String(m.alt).slice(0, 200);
      /* [2026-09-16] 🔴 출처를 여기서 안 실으면 크레딧을 쓸 재료가 발행까지 못 온다(A 가 잡은 죽은 통로). */
      if (m.source && typeof m.source === "object") img.source = m.source as PublishImage["source"];
      if (m.stock && typeof m.stock === "object") img.stock = m.stock as PublishImage["stock"];
      return img;
    }).filter((i) => !!i.url),
    tags: Array.isArray(meta.tags) ? (meta.tags as unknown[]).map(String).slice(0, 20) : [],
    disclosure: meta.disclosure ? String(meta.disclosure) : null,
    status: String(p.status ?? ""),
  };
  if (n(p.slot_id)) out.slotId = n(p.slot_id);
  /* [R9-9] 🔴 **허용 목록에 넣는 것까지가 «값을 만든 것»이다.** 2026-09-16 하루에 허용 목록 **세 곳**이
     값을 조용히 먹었다(`ALLOWED_SETTINGS`·`sanitizeProfile`·`pieces-get meta`) — 여기가 네 번째가 되지 않게 한다. */
  if (Array.isArray(meta.productTags)) {
    const tags = (meta.productTags as unknown[])
      .map((t) => (t && typeof t === "object" ? t : {}) as Record<string, unknown>)
      .map((t) => ({
        productId: String(t.productId ?? t.product_id ?? "").trim(),
        ...(Number.isFinite(Number(t.x)) ? { x: Number(t.x) } : {}),
        ...(Number.isFinite(Number(t.y)) ? { y: Number(t.y) } : {}),
      }))
      .filter((t) => t.productId)
      .slice(0, 5);   // 인스타 한 장짜리 사진의 상한(공식 문서)
    if (tags.length) out.productTags = tags;
  }
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
    /* 🔴 [2026-09-20 첫 발행 라운드] **«아직 안 한 것»은 «막힌 것»이 아니다.**
       옛 판은 넷을 다 `account_blocked` 로 냈고, 그러면 `publish-one.ts HUMAN` 이 **«계정이 막혀 있어요»** 로 뭉갠다 —
       고객은 «내 계정이 정지됐나» 하고 놀란다. 사실도 틀렸다(막힌 적이 없다).
       🔴 **«다시»도 지웠다** — `pending_login` 은 **한 번도 안 한 것**이라 «다시 로그인»이 거짓말이었다.
          계정 화면이 쓰는 말(«아직 로그인 전이에요 · 한 번만 하면 돼요»)에 맞춘다. */
    const firstLogin = account.status === "pending_login";
    return {
      ok: false, reason: firstLogin ? "account_login_needed" : "account_blocked", retriable: false,
      error: firstLogin
        ? `@${account.handle} 계정은 아직 로그인 전이에요 — 한 번만 해 두면 그다음부터는 저절로 올라가요.`
        : `@${account.handle} 계정을 지금은 쓸 수 없어요.`,
      detail: `account_status=${account.status}`,
    };
  }

  // ③ 🔴 발행 직전 최종 게이트(§16B)
  const gate = runPublishGate(
    { channel: piece.channel, title: piece.title, bodyHtml: piece.bodyHtml, affiliate: piece.affiliate ?? null, adDisclosure: !!piece.disclosure,
      images: piece.images },   // [2026-09-16] 🔴 스톡 크레딧을 쓰려면 사진 출처가 여기까지 와야 한다(A 가 «부르는 곳 0» 을 잡았다)
    { adsensePub: String((account.monetize as Record<string, unknown> | undefined)?.adsensePub ?? "") },
  );
  /* 🔴 [§9] `gate_report` 는 **늘** 저장한다 — 종전엔 본문이 바뀐 경우에만 썼는데,
     이제 막지 않으므로 «나갈 때 어떤 위험이 있었나»가 **남는 유일한 자리**다(발행함·되먹임 원장이 읽는다). */
  if (!opts.dryRun) {
    // 고친 본문을 저장한다 — «올린 것 = 저장된 것»(검수창·발행함이 같은 본문을 본다).
    try { await q(sql`UPDATE pieces SET body = ${gate.bodyHtml}, gate_report = ${jsonb(gate.report)}, updated_at = NOW() WHERE id = ${piece.id}`); }
    catch (e) { console.error("[publish] body persist failed", e); }
  }
  /* 🔴 [CLAUDE §9 · 사장님 2026-09-15 «말해 주기로 내려. 고객 계정이야. 우리가 책임지는 게 아니야.»]
     **여기서 발행을 세우지 않는다.** 종전에는 `ok:false → reason:"gate"` 로 막고 고객에게 «직접 올려 주세요»를 줬는데,
     그 계정은 고객 것이고 **막힌 고객에게는 푸는 길이 없었다**(§9 «막으면 공장이 선다»).
     대신 ①감사에 남기고 ②위 `gate_report` 로 **나간 뒤에도 발행함에서 보이게** 하고(§9-2) ③그대로 내보낸다.
     되돌릴 길은 §5E «이 글 내리기»가 준다(§9-3).
     🔴 **검사를 끈 것이 아니다** — `runPublishGate` 는 그대로 돌고, ①고지 복원도 그대로 한다(§9-4 «대신 해 줄 건 대신»). */
  if (!gate.ok && !opts.dryRun) {
    await writeAudit({
      tenantId: piece.tenantId, action: "publish_gate_risks", actorType: "system", target: `piece:${piece.id}`,
      detail: { risks: gate.report.checks.filter((c) => !c.pass).map((c) => ({ key: c.key, detail: c.detail ?? null })), note: "막지 않고 내보냄(CLAUDE §9)" },
      riskLevel: "medium",
    });
  }
  const prepared: PublishPiece = { ...piece, bodyHtml: gate.bodyHtml };

  if (opts.dryRun) return { ok: true, via, dryRun: true };

  /* ④-A 러너 채널 — 잡을 적재하고 러너가 가져가기를 기다린다. */
  if (via === "runner") {
    const kind = publishJobKindOf(piece.channel);
    if (!kind) return { ok: false, reason: "unsupported_channel", retriable: false, error: "아직 이 채널로는 발행할 수 없어요.", detail: piece.channel };
    const payload: RunnerPublishPayload = {
      title: prepared.title, bodyHtml: prepared.bodyHtml, blocks: prepared.blocks,
      images: prepared.images.map((i) => ({ url: i.url, ...(i.caption ? { caption: i.caption } : {}), ...(i.alt ? { alt: i.alt } : {}) })),
      tags: prepared.tags, disclosure: prepared.disclosure,
      /* [R9-4] 서버가 믿는 꾸밈 표를 러너도 본다 — `blocks[].marks` 를 어디까지 누를지 러너가 같은 표로 정한다(표가 없으면 null). */
      formatCaps: formatCapsOf(piece.channel),
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
  /* P1R5 §2.3 — 영상 3종이 붙었다. 유튜브·릴스·스레드는 **OAuth API** 채널이라 여기서 바로 올린다.
     ⚠️ 릴스·스레드는 «컨테이너 → 처리 대기 → 게시» 3단계라 아직 처리 중이면 `video_processing`(retriable) 이 돌아온다 —
        실패가 아니라 «조금 뒤에»다. publisher 가 다음 틱에 다시 부르고, 그때 컨테이너를 새로 만들지 않는다(중복 게시 0). */
  const connector = API_CONNECTORS[piece.channel];
  const r = connector
    ? await connector(prepared, account)
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
 * 포트용 채널 판정 — **표 하나만 본다**(`lib/channel-registry.ts`).
 *   🔴 [P1R8 §5.2] 예전엔 표에 없으면 `connectMethodOf` 로 **추측**했다(«oauth 니까 api 겠지»).
 *      그래서 커넥터가 없는 `instagram`·`tiktok` 이 «API 로 올릴 수 있다»고 대답했다(2026-09-15 프로브로 확인).
 *      = 없는 것을 기본값으로 위장(AC-9) + 연결 방식이라는 **대용물로 발행 경로를 판정**(AC-57).
 *      이제 **모르면 null** 이고, 호출부가 «아직 올릴 수 없다»로 막는다. 채널을 켜는 사람이 표에 값을 넣어야 한다.
 */
export function publishViaOf(channel: string): "api" | "runner" | null {
  return strictPublishViaOf(channel);
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
/** 워드프레스 광고 위젯 삽입/되돌리기(P1R3 v3.4 §2.2 · 백업 = accounts.monetize.wpAdWidget). */
export { insertWordpressAdWidget, removeWordpressAdWidget, adsenseWidgetHtml } from "./ads";

/** 편의 진입점 — 행 로드까지 B2 가 한다. B 의 publisher 는 id 만 주면 된다. */
export async function publishPieceById(tenantId: number, pieceId: number, opts: PublishOpts = {}): Promise<PublishResult> {
  const piece = await loadPublishPiece(tenantId, pieceId);
  if (!piece) return { ok: false, reason: "not_publishable", retriable: false, error: "글을 찾을 수 없어요.", detail: `piece:${pieceId}` };
  const account = piece.accountId ? await loadPublishAccount(tenantId, piece.accountId) : null;
  return publish(piece, account, opts);
}
