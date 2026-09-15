/**
 * lib/cron/publish-port.ts — 🔴 **B ↔ B2 경계**(계약 §10 · B2 확정본 2026-09-14 커밋 d6674f9).
 *   B 의 크론은 발행을 «어떻게» 하는지 모른다. 아는 것은 함수 하나뿐이다 — `publishPieceById(tid, pieceId, opts)`.
 *   러너/API 판단·자격 복호화·잡 적재·최종 게이트·`finalizePublish` 는 **전부 B2 안**이다. 여기서 다시 짓지 않는다.
 *
 *   ══ 왜 «포트»인가 ══
 *     같은 라운드에서 B2 가 `lib/publish/**` 를 만든다. 머지 전에는 그 모듈이 없다 — 그래도 B 는 컴파일되고 돌아야 하고,
 *     **없다는 사실을 정직하게 말해야** 한다(조용히 «발행 0건» 이 되면 그게 최악이다).
 *     그래서 ①타입은 여기(B2 확정본 그대로) ②구현은 런타임에 붙인다:
 *       · `bindPublish()` — 머지 후 한 줄로 꽂는다(권장 · `netlify/functions/cron-tick-5m.ts` 상단 import 1줄).
 *       · 안 꽂혀 있으면 첫 호출에서 `lib/publish/index` 를 **동적으로** 찾아본다(있으면 자동 연결 · 없으면 unavailable).
 *     🔴 미연결 반환은 `{ ok:false, unavailable:true }` — B2 의 실패 사유 `reason:"config"` 와 **다르다**.
 *        섞으면 «커넥터가 아직 없다» 가 «이 글은 못 나간다(failed)» 로 둔갑해 멀쩡한 글을 죽인다.
 *   🔎 출처: AC 신규(계약 P1R2-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { connectMethodOf } from "../accounts";

/* ───────── B2 확정 타입(계약 §10 · 글자 그대로) ───────── */
export type PublishVia = "api" | "runner";
export type PublishFailReason =
  | "gate" | "no_account" | "no_creds" | "account_blocked" | "auth_failed" | "provider_not_configured"
  | "channel_error" | "network" | "unsupported_channel" | "not_publishable" | "config"
  /* P1R5 §2.3 — 릴스·스레드가 영상을 **아직 처리 중**(IN_PROGRESS). 실패가 아니라 «조금 뒤에»(retriable).
     🔴 `lib/publish/contract.ts` 의 같은 이름 union 과 **짝**이다 — 한쪽만 고치면 포트가 갈라진다. */
  | "video_processing";

export interface RunnerPresence { online: boolean; devices: number; lastSeenAt?: string; offlineMin?: number }

export interface PublishOk {
  ok: true; via: PublishVia;
  externalUrl?: string; channelRef?: string; jobId?: number;
  runner?: RunnerPresence;
  /** 이미 나간 글(멱등) — 상태를 다시 쓰지 않는다. */
  already?: boolean;
  dryRun?: boolean;
  /** true = piece·slot·posts·계정 카운터를 B2 가 **이미** 끝냈다(§10 — 그럼 B 는 슬롯을 또 쓰지 않는다). */
  finalized?: boolean;
  postId?: number;
}
export interface PublishFail {
  ok: false; reason: PublishFailReason; retriable: boolean; error: string;
  detail?: unknown; gate?: unknown;
  /** 🔴 포트 전용 — B2 모듈이 아직 없다. «발행 실패»가 아니라 «아직 못 물어봤다». */
  unavailable?: boolean;
}
export type PublishResult = PublishOk | PublishFail;

export interface PublishOpts { slotId?: number | null; actor?: "cron" | "user" }
export type PublishPieceByIdFn = (tid: number, pieceId: number, opts?: PublishOpts) => Promise<PublishResult>;
export type PublishViaOfFn = (channel: string) => PublishVia;

/* ───────── 러너 잡 적재(B2 `lib/runner-jobs.ts`) ───────── */
export type RunnerJobKind = "publish.naver_blog" | "publish.tistory" | "session.login" | "session.verify" | "verify.post_alive" | "revenue.stats";
export interface EnqueueInput { kind: RunnerJobKind; accountId?: number | null; pieceId?: number | null; payload?: Record<string, unknown>; priority?: number; dueAt?: Date | null }
export type EnqueueResult = { ok: true; jobId: number; already?: boolean } | { ok: false; error: string; unavailable?: boolean };
export type EnqueueJobFn = (tid: number, input: EnqueueInput) => Promise<EnqueueResult>;

/** 발행된 글의 조회·좋아요·댓글 회수(API 채널 · B2 커넥터가 채널 API 로 물어본다). 러너 채널은 `revenue.stats` 잡이 담당. */
export interface PostStats { views?: number; likes?: number; comments?: number; alive?: boolean }
export type FetchStatsFn = (tid: number, pieceId: number) => Promise<PostStats | null>;

/** 잡 타임아웃 회수(B2 export `reapStaleJobs(staleMin = 15)`) — claim 후 무보고 잡을 되돌리고, 상한 초과 발행 잡은 awaiting_manual 로 종결한다. */
export interface ReapResult { released: number; failed: number }
export type ReapStaleJobsFn = (staleMin?: number) => Promise<ReapResult>;

/* ───────── 결합 ───────── */
/* 🔴 **B2 머지 완료(2026-09-14) — 정적 import 로 꿰었다.**
   머지 전에는 모듈이 없어 «변수 지정자 동적 import» 로 두었는데, 그 형태는 esbuild 가 번들에 담지 못해
   **모듈이 생긴 뒤에도 런타임에 여전히 «missing» 으로 보였다**(로컬 스모크 실측: `publisher` 가 `connector:"missing"` 보고 · 발행 0건).
   «있는데 연결 안 된 커넥터»는 조용한 실패라 제일 나쁘다 — 모듈이 존재하는 지금은 정적 import 가 정답이다.
   포트는 이제 **타입 경계 + 미구현 정직 반환**만 맡는다(러너/API 판단·잡 적재는 여전히 전부 B2 안 · 계약 §10). */
import { publishPieceById as b2PublishPieceById, publishViaOf as b2PublishViaOf, enqueueJob as b2EnqueueJob, reapStaleJobs as b2ReapStaleJobs, fetchStats as b2FetchStats } from "../publish/index";

interface Bound { publishPieceById: PublishPieceByIdFn; publishViaOf?: PublishViaOfFn; enqueueJob?: EnqueueJobFn; reapStaleJobs?: ReapStaleJobsFn; fetchStats?: FetchStatsFn }

let bound: Bound | null = {
  publishPieceById: b2PublishPieceById as unknown as PublishPieceByIdFn,
  publishViaOf: b2PublishViaOf as unknown as PublishViaOfFn,
  enqueueJob: b2EnqueueJob as unknown as EnqueueJobFn,
  reapStaleJobs: b2ReapStaleJobs as unknown as ReapStaleJobsFn,
  fetchStats: b2FetchStats as unknown as FetchStatsFn, // B2 제공(2026-09-14) — null = «못 물어봤다»(조회 0 으로 적지 않는다)
};

/** 구현을 갈아끼울 때만 쓴다(테스트·예외 상황). 평상시엔 위 정적 결합이 정본이다. */
export function bindPublish(impl: Bound | null): void { bound = impl; }

async function ensureBound(): Promise<Bound | null> { return bound; }

const UNAVAILABLE: PublishFail = {
  ok: false, reason: "config", retriable: true, unavailable: true,
  error: "발행 커넥터(lib/publish)가 아직 연결되지 않았어요.",
};

/**
 * publishPiece — 크론이 부르는 **유일한** 발행 입구.
 *   [P1R7 §3.2] 요금제 채널 게이트를 **여기서** 본다(계약 §3.2 «발행» 자리). 막히면 `not_publishable`·retriable false —
 *   재시도해도 요금제가 바뀌기 전엔 같은 답이라 다시 두드리지 않는다. 🔴 소급 금지: 이미 연결한 계정의 글은 막지 않는다
 *   (계정이 붙어 있는 piece 는 통과 · 계정 없이 채널만 정해 둔 글만 요금제를 본다).
 */
export async function publishPiece(tid: number, pieceId: number, opts: PublishOpts = {}): Promise<PublishResult> {
  const impl = await ensureBound();
  if (!impl) return UNAVAILABLE;
  const gate = await channelGate(tid, pieceId);
  if (gate) return gate;
  try { return await impl.publishPieceById(tid, pieceId, { actor: "cron", ...opts }); }
  catch (e) { return { ok: false, reason: "channel_error", retriable: true, error: String((e as Error)?.message ?? e).slice(0, 300) }; }
}

/** 이 글의 채널이 요금제 밖이면 실패 결과, 아니면 null. 계정이 이미 붙어 있으면 **묻지 않는다**(소급 금지). */
async function channelGate(tid: number, pieceId: number): Promise<PublishFail | null> {
  try {
    const { q } = await import("../accounts");
    const { sql } = await import("drizzle-orm");
    const rows = (await q(sql`SELECT p.channel, p.account_id FROM pieces p WHERE p.id = ${pieceId} AND p.tenant_id = ${tid}`)) as { channel?: unknown; account_id?: unknown }[];
    const r = rows[0];
    if (!r || r.account_id) return null;                       // 글이 없으면 B2 가 판정 · 계정이 붙어 있으면 소급 금지
    const { requireChannel } = await import("../plans");
    const g = await requireChannel(tid, String(r.channel ?? ""));
    if (g.ok) return null;
    return { ok: false, reason: "not_publishable", retriable: false,
      error: `지금 요금제에서는 이 채널로 발행할 수 없어요.${g.planKey === "starter" ? " Pro 로 바꾸면 열려요." : ""}`,
      detail: { planGate: true, planKey: g.planKey, channel: String(r.channel ?? ""), allowed: g.allowed } };
  } catch (e) { console.warn("[publish-port] 채널 게이트 조회 실패 — 통과", String((e as Error)?.message ?? e).slice(0, 80)); return null; }
}

/**
 * viaOf — 이 채널은 API 로 나가나 러너로 나가나.
 *   B2 가 연결돼 있으면 **B2 의 판정기**(`publishViaOf`)를 쓴다. 아직이면 AC 의 기존 정본
 *   `lib/accounts.connectMethodOf`(session = 러너 · 그 외 = API · `listChannels().publishVia` 와 같은 식)로 답한다.
 *   새 판정기를 짓지 않는다 — 두 벌이 되면 «러너 채널인데 API 로 보내는» 사고가 난다(PITFALLS #11-b).
 */
export async function viaOf(channel: string): Promise<PublishVia> {
  const impl = await ensureBound();
  if (impl?.publishViaOf) { try { return impl.publishViaOf(channel); } catch { /* 폴백으로 */ } }
  return connectMethodOf(channel) === "session" ? "runner" : "api";
}

/**
 * enqueueRunnerJob — 러너 잡 적재(세션 로그인·통계 회수).
 *   🔴 B2 의 `lib/runner-jobs.ts` 가 정본이다. 미연결이면 **직접 INSERT 하지 않는다** — `unavailable` 로 돌려주고
 *      호출부가 정직하게 기록한다. 여기서 INSERT 하면 `runner_jobs` 에 쓰는 손이 둘이 되고, 중복 적재·우선순위·
 *      due 규칙이 두 벌로 갈라진다(계약 §10 «상태는 한 곳에서만»).
 */
export async function enqueueRunnerJob(tid: number, input: EnqueueInput): Promise<EnqueueResult> {
  const impl = await ensureBound();
  if (!impl?.enqueueJob) return { ok: false, error: "러너 잡 적재기(lib/runner-jobs)가 아직 연결되지 않았어요.", unavailable: true };
  try { return await impl.enqueueJob(tid, input); }
  catch (e) { return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }; }
}

/**
 * reapStaleJobs — claim 후 오래 말이 없는 잡 회수. 🔴 큐 SQL 은 B2 한 벌이다(우선순위·attempts·종결 규칙이 거기 있다).
 *   미연결이면 `null` — 호출부가 «아직 못 물어봤다»로 센다(0건과 구분).
 */
export async function reapStaleJobs(staleMin: number): Promise<ReapResult | null> {
  const impl = await ensureBound();
  if (!impl?.reapStaleJobs) return null;
  try { return await impl.reapStaleJobs(staleMin); }
  catch (e) { console.error("[publish-port] reapStaleJobs 실패", String((e as Error)?.message ?? e).slice(0, 200)); return { released: 0, failed: 0 }; }
}

/**
 * fetchPostStats — API 채널 글의 통계 회수. 미연결이면 `null`(«0회 조회»가 아니라 «못 물어봤다» — 둘을 섞으면 성과 학습이 0 으로 오염된다).
 */
export async function fetchPostStats(tid: number, pieceId: number): Promise<PostStats | null> {
  const impl = await ensureBound();
  if (!impl?.fetchStats) return null;
  try { return await impl.fetchStats(tid, pieceId); }
  catch (e) { console.warn("[publish-port] fetchStats 실패", pieceId, String((e as Error)?.message ?? e).slice(0, 150)); return null; }
}

/** 커넥터가 붙어 있나 — 크론 응답 detail·스모크 보고용(«미구현»을 숫자로 보이게). */
export async function publishPortStatus(): Promise<"ready" | "missing"> { return (await ensureBound()) ? "ready" : "missing"; }

/** 러너가 «오프라인 30분+» 인가 — 판정 기준은 B2 가 실어 주는 값 하나뿐이다(기기 조회를 B 가 또 하지 않는다). */
export function runnerOffline(r: RunnerPresence | undefined): boolean {
  if (!r) return false;
  return r.devices === 0 || (typeof r.offlineMin === "number" && r.offlineMin >= 30);
}
