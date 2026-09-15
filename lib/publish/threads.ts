/**
 * lib/publish/threads.ts — 스레드(Threads) **영상** 발행(계약 P1R5 §2.3).
 *   AC 신규 2026-09-14(B2). 이식 관례: ../AutoMarketing/lib/publish-threads.ts.
 *
 *   규격(Threads API · graph.threads.net): 릴스와 **같은 3단계**지만 호스트·필드가 다르다.
 *     ① POST /{threads-user-id}/threads        { media_type:"VIDEO", video_url, text }  → creation_id
 *     ② GET  /{creation_id}?fields=status      → FINISHED | IN_PROGRESS | ERROR
 *     ③ POST /{threads-user-id}/threads_publish { creation_id }                         → 게시 id
 *
 *   🔴 공식 안내: 컨테이너를 만들고 **약 30초** 뒤에 게시하라. 그래서 여기서 오래 기다리지 않고,
 *      아직이면 `video_processing`(retriable) 으로 돌려 **다음 틱**이 이어받게 한다 — 릴스와 같은 관례.
 *   🔴 `creation_id` 를 piece.meta 에 남긴다 — 중복 게시 0(같은 영상이 두 번 올라가면 되돌릴 수 없다).
 *   🔴 본문 **첫 줄**이 고지(§16B).
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../db-util";
import { ensureFreshToken } from "./tokens";
import { buildCaption, videoPublicUrlOf } from "./instagram";
// [R8CLOSE §B5] 연결글 — 문단·문장 자리에서 끊는 순수 함수(하니스 `scripts/verify-thread-chain.mts`).
import { splitThreadChain, runThreadChain, THREADS_MAX } from "./thread-chain";
import { disclosureTextFor } from "../disclosure";
import { writeAudit } from "../audit";
import type { PublishPiece, PublishAccount, PublishResult } from "./contract";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

const GRAPH = "https://graph.threads.net/v1.0";
const TIMEOUT_MS = 30_000;
const POLL_TRIES = 3;
const POLL_WAIT_MS = 5_000;
const META_FIELD = "thCreationId";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graph(url: string, init?: RequestInit): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    let json: Record<string, unknown> | null = null;
    try { json = await r.json() as Record<string, unknown>; } catch { /* 본문 없음 */ }
    return { status: r.status, json };
  } finally { clearTimeout(t); }
}

async function savedId(tid: number, pieceId: number): Promise<string> {
  const [p] = await q(sql`SELECT meta FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId} LIMIT 1`);
  const meta = (p?.meta && typeof p.meta === "object" ? p.meta : {}) as Record<string, unknown>;
  return String(meta[META_FIELD] ?? "").trim();
}

function thError(status: number, json: Record<string, unknown> | null): { reason: "auth_failed" | "channel_error" | "config"; retriable: boolean; error: string; detail: string } {
  const e = (json?.error ?? {}) as { message?: string; code?: number };
  const msg = String(e?.message ?? "").slice(0, 200);
  const code = Number(e?.code ?? 0);
  if (status === 401 || code === 190) return { reason: "auth_failed", retriable: false, error: "스레드 로그인이 만료됐어요. 계정을 다시 연결해 주세요.", detail: msg };
  if (code === 4 || code === 17 || status === 429) return { reason: "channel_error", retriable: true, error: "스레드 요청 한도에 걸렸어요. 잠시 후 다시 올릴게요.", detail: msg };
  if (status >= 500) return { reason: "channel_error", retriable: true, error: "스레드가 지금 응답하지 않아요. 잠시 후 다시 시도할게요.", detail: `${status} ${msg}` };
  return { reason: "config", retriable: false, error: "스레드가 이 영상을 받지 않았어요.", detail: `${status} ${code} ${msg}` };
}

/** 토큰·사용자 id — 글·영상 두 경로가 **똑같이** 쓰는 앞머리(둘이 갈리면 한쪽만 고치는 사고가 난다). */
async function threadsAuth(tid: number, account: PublishAccount): Promise<{ ok: true; token: string; userId: string } | { ok: false; res: PublishResult }> {
  const tok = await ensureFreshToken(tid, account.id, "threads", account.handle);
  if (!tok.ok) {
    if (tok.reason === "provider_not_configured") return { ok: false, res: { ok: false, reason: "provider_not_configured", retriable: false, error: "스레드 연결이 아직 준비 중이에요." } };
    if (tok.reason === "no_creds") return { ok: false, res: { ok: false, reason: "no_creds", retriable: false, error: "스레드 계정을 다시 연결해 주세요." } };
    return { ok: false, res: { ok: false, reason: "auth_failed", retriable: false, error: "스레드 로그인이 만료됐어요. 다시 연결해 주세요.", detail: tok.detail } };
  }
  const userId = String((tok.token.extra as Record<string, unknown> | undefined)?.threadsUserId ?? tok.token.externalId ?? "").trim();
  if (!userId) return { ok: false, res: { ok: false, reason: "no_creds", retriable: false, error: "스레드 계정을 찾지 못했어요. 다시 연결해 주세요." } };
  return { ok: true, token: tok.token.accessToken, userId };
}

/* ═══ [R8CLOSE §B5] 연결글 — 상태와 조각 만들기 ═══ */

/** 어디까지 올렸나(게시된 id 를 순서대로). 중간에 죽어도 **이미 올린 조각을 다시 안 올린다**. */
const CHAIN_FIELD = "thChain";

async function chainState(tid: number, pieceId: number): Promise<{ done: string[] }> {
  const [p] = await q(sql`SELECT meta FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId} LIMIT 1`);
  const meta = (p?.meta && typeof p.meta === "object" ? p.meta : {}) as Record<string, unknown>;
  const raw = meta[CHAIN_FIELD];
  const done = Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
  return { done };
}
/**
 * 어디까지 올렸나를 남긴다. 🔴 **쓴 직후 `jsonb_typeof` 확인까지가 쓰기다**(CLAUDE §4.5 · PITFALLS #1).
 *
 *   🔴 이 자리가 특히 무서운 이유: 이 칸이 배열로 안 남으면 `chainState` 가 «아무것도 안 올렸다»로 읽고
 *      **다음 틱이 이미 올라간 조각을 처음부터 다시 올린다.** 조각마다 쌓아서 막아 둔 그 사고가
 *      **한 겹 아래에서 되살아나는 것**이고, 남의 타임라인에 같은 글이 두 번 나가는 건 **되돌릴 수 없다.**
 *   개수까지 본다 — 타입만 맞고 내용이 안 들어간 경우도 같은 사고를 낸다.
 */
async function saveChainState(tid: number, pieceId: number, done: string[]): Promise<boolean> {
  await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ [CHAIN_FIELD]: done })}, updated_at = NOW()
    WHERE tenant_id = ${tid} AND id = ${pieceId}`);
  const [chk] = await q(sql`SELECT jsonb_typeof(meta -> ${CHAIN_FIELD}) AS t,
      CASE WHEN jsonb_typeof(meta -> ${CHAIN_FIELD}) = 'array' THEN jsonb_array_length(meta -> ${CHAIN_FIELD}) ELSE -1 END AS n
    FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId}`);
  const saved = String(chk?.t ?? "") === "array" && Number(chk?.n) === done.length;
  if (!saved) console.error(`[threads] 🔴 ${CHAIN_FIELD} 이 배열로 안 남았다 piece=${pieceId} typeof=${String(chk?.t)} n=${String(chk?.n)} want=${done.length}`);
  return saved;
}

/**
 * 이 글을 연결글 조각으로 나눈다.
 *   🔴 **고지와 태그를 본문과 따로 뽑아** 첫 조각에 붙인다(`splitThreadChain` 머리말):
 *     · 고지 = §16B(법) · 공정위는 «본문 중간»을 부적절한 위치로 본다
 *     · 태그 = 쓰레드는 게시물당 **토픽 태그 1개**이고, 사람들이 타고 들어오는 건 **첫 글**이다.
 *       🔴 `buildCaption` 을 그대로 쓰면 태그가 **맨 뒤 = 마지막 조각**에 붙어 아무도 안 본다(AC-73 의 다음 칸).
 */
function threadPartsOf(piece: PublishPiece) {
  const disc = piece.disclosure ?? (piece.affiliate ? disclosureTextFor(piece.affiliate.provider) : null);
  /* 태그는 인스타와 **같은 표**(`TAG_MAX.threads = 1`)를 쓴다 — 상한을 여기서 다시 적지 않는다. */
  const tags = (piece.tags ?? []).map((t) => `#${String(t).replace(/^#/, "")}`);
  if (piece.affiliate && !tags.some((t) => t === "#광고")) tags.unshift("#광고");
  const tail = tags.slice(0, THREADS_TAG_MAX).join(" ");
  const body = String(piece.bodyHtml || "").replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").replace(/ ?\n ?/g, "\n").trim();
  return splitThreadChain(disc ?? "", body, tail, THREADS_MAX);
}
/** 쓰레드 토픽 태그 상한 — 공식 «게시물당 1개»(R8-A §4 · instagram.ts TAG_MAX 와 같은 값). */
const THREADS_TAG_MAX = 1;

/** 게시 결과 id → 사람이 여는 주소. */
const threadsUrl = (handle: string, id: string) => {
  const h = String(handle || "").replace(/^@/, "");
  return h ? `https://www.threads.net/@${h}/post/${id}` : `https://www.threads.net/post/${id}`;
};

/**
 * 스레드 **글**(텍스트) 발행 — 계약 P1R7 §2.3.
 *
 *   🔴 왜 따로 만드나: `publish/index.ts` 가 스레드를 **무조건 영상으로** 보내고 있었다. 그래서 글 한 편을
 *      스레드로 예약하면 «올릴 영상이 아직 없어요»로 영원히 막혔다 — 설계 §2.1 이 스레드를 **글 채널(P2 보조 배포)**
 *      로 둔 것과 어긋난다(B2 전수조사 §2.1 «쓰레드» 행).
 *   🔴 영상과 **단계 수가 다르다**: 텍스트는 컨테이너를 만들자마자 바로 게시할 수 있다(처리 대기가 없다).
 *      영상 경로의 폴링을 그대로 베끼면 30초를 헛기다리고 `video_processing` 으로 되돌아가 **영원히 안 올라간다**.
 *   🔴 본문 **첫 줄이 고지**(§16B).
 *   🔴 [R8CLOSE §B5] **연결글**(«500자 이하 · 스레드 2~3개 연결»)이라 `buildCaption` 을 **안 쓴다** —
 *      그 함수는 고지·본문·태그를 한 덩이로 붙이고 끝에서 자르는데, 그러면 ①문장 한가운데서 끊기고
 *      ②태그가 **마지막 조각**에 붙어 아무도 안 본다. 여기는 `threadPartsOf` 로 셋을 **따로 뽑아** 첫 조각에 싣는다.
 *      (영상 경로는 한 덩이라 지금도 `buildCaption` 이 맞다 — 두 경로가 다른 이유가 이것이다.)
 *   중복 게시 0: 올린 조각의 게시 id 를 `piece.meta.thChain` 에 **한 조각씩** 남긴다(영상과 같은 규율).
 */
export async function publishThreadsText(piece: PublishPiece, account: PublishAccount): Promise<PublishResult> {
  const tid = piece.tenantId;
  const auth = await threadsAuth(tid, account);
  if (!auth.ok) return auth.res;
  const { token, userId } = auth;

  /* [R8CLOSE §B5] 🔴 **연결글**(DESIGN §5C.1 «500자 이하 · 스레드 2~3개 연결»).
     종전엔 `buildCaption(piece, 500)` 으로 **500자에서 그냥 자르고 한 덩이**로 올렸다 —
     넘친 글은 **조용히 사라졌고** 잘린 자리는 문장 한가운데였다. 계약엔 «2~3개 연결»이 적혀 있었는데 구현이 0이었다
     (AC-73 과 같은 모양 — 계약만 고쳐지고 발행 경로가 안 따라온 자리).
     이제 `splitThreadChain` 이 **문단 → 문장 → 줄** 순서로 끊을 자리를 찾고, 커넥터가 **답글로 잇는다**. */
  const parts = threadPartsOf(piece);
  if (!parts.parts.length || !parts.parts[0].trim()) {
    return { ok: false, reason: "not_publishable", retriable: false, error: "올릴 내용이 비어 있어요." };
  }

  /* 어디까지 올렸나 — 🔴 **중간에 죽어도 첫 글을 두 번 올리지 않는다**(중복 게시가 이 채널에서 제일 무서운 사고다).
     `done` 에 **게시된 id** 를 순서대로 쌓고, 다음 조각은 **바로 앞 id 의 답글**로 붙인다. */
  const state = await chainState(tid, piece.id);

  /* 한 조각 올리기 = 컨테이너 → 게시. 텍스트는 처리 대기가 없다(그래서 폴링이 없다 · 영상 경로와 다른 점).
     🔴 루프 자체는 `runThreadChain`(순수)이 돈다 — «2번째가 1번째의 답글인가»·«이미 올린 걸 또 올리나»를
        하니스가 직접 물을 수 있어야 하기 때문이다(AC-73 이 그 질문을 아무도 안 물어서 났다). */
  let lastFail: { reason: "network" | "channel_error" | "auth_failed" | "config"; retriable: boolean; error: string } | null = null;
  const post = async (text: string, replyToId: string | null) => {
    const body = new URLSearchParams({ media_type: "TEXT", text, access_token: token });
    if (replyToId) body.set("reply_to_id", replyToId);
    const r = await graph(`${GRAPH}/${encodeURIComponent(userId)}/threads`, { method: "POST", body }).catch(() => null);
    if (!r) { lastFail = { reason: "network", retriable: true, error: "스레드에 연결하지 못했어요. 잠시 후 다시 시도할게요." }; return { ok: false as const, detail: "network" }; }
    if (r.status < 200 || r.status >= 300) { const c = thError(r.status, r.json); lastFail = { reason: c.reason, retriable: c.retriable, error: c.error }; return { ok: false as const, detail: c.detail }; }
    const creationId = String(r.json?.id ?? "").trim();
    if (!creationId) { lastFail = { reason: "channel_error", retriable: true, error: "스레드가 업로드 번호를 주지 않았어요." }; return { ok: false as const, detail: "no_creation_id" }; }

    const pub = await graph(`${GRAPH}/${encodeURIComponent(userId)}/threads_publish`, {
      method: "POST", body: new URLSearchParams({ creation_id: creationId, access_token: token }),
    }).catch(() => null);
    if (!pub) { lastFail = { reason: "network", retriable: true, error: "스레드에 연결하지 못했어요. 잠시 후 다시 시도할게요." }; return { ok: false as const, detail: "network_publish" }; }
    if (pub.status < 200 || pub.status >= 300) { const c = thError(pub.status, pub.json); lastFail = { reason: c.reason, retriable: c.retriable, error: c.error }; return { ok: false as const, detail: c.detail }; }
    const id = String(pub.json?.id ?? "").trim();
    if (!id) { lastFail = { reason: "channel_error", retriable: true, error: "올렸는데 스레드가 게시 번호를 주지 않았어요." }; return { ok: false as const, detail: "no_media_id" }; }
    return { ok: true as const, id };
  };

  /* 🔴 **한 조각 올릴 때마다 바로 남긴다**(`onProgress`). 마지막에 몰아서 쓰면 2조각을 올리고 죽었을 때
     다음 틱이 1조각부터 다시 올려 **같은 글이 두 번 나간다** — 되돌릴 수 없는 사고다. */
  let posted: string[] = [...state.done];
  let unsaved = "";
  const run = await runThreadChain(parts.parts, state.done, post, async (done) => {
    posted = done;
    if (await saveChainState(tid, piece.id, done)) return;
    /* 🔴 **여기서 멈춘다.** 어디까지 올렸는지 못 남겼는데 계속 올리면, 다음 틱이 1조각부터 다시 올려
       **같은 글이 두 번** 나간다. 더 올리는 것보다 **여기서 그치는 쪽이 되돌릴 수 있다.** */
    unsaved = `${CHAIN_FIELD} 저장 확인 실패(${done.length}조각)`;
    throw new Error(unsaved);
  });
  state.done = run.done;
  if (unsaved) {
    await writeAudit({ tenantId: tid, action: "threads_chain_state_unsaved", actorType: "system", target: `piece:${piece.id}`,
      detail: { posted: posted.length, parts: parts.parts.length, note: "올린 자리를 기록하지 못해 이어 올리기를 멈췄다(같은 글이 두 번 나가지 않게)" }, riskLevel: "high" })
      .catch((e: unknown) => console.warn("[threads] 감사 기록 실패", String((e as Error)?.message ?? e).slice(0, 80)));
    /* 🔴 **성공으로 닫는다** — 실패로 닫으면 `channel_ref` 가 안 남고, 사람이 «다시 올리기»를 누르는 순간
       **첫 조각부터 또 나간다**(발행 멱등 §4.7 은 `channel_ref` 가 있을 때만 막아 준다).
       올라간 데까지는 진짜로 올라갔으니 그 주소를 남기고, 못 이은 사실은 **감사로 말한다.** */
    if (posted.length) return { ok: true, via: "api", externalUrl: threadsUrl(account.handle, posted[0]), channelRef: posted[0] };
  }
  if (!run.ok) {
    const f = lastFail ?? { reason: "channel_error" as const, retriable: true, error: "스레드에 올리지 못했어요." };
    return { ok: false, reason: f.reason, retriable: f.retriable, error: f.error, detail: `part${(run.failedAt ?? 0) + 1} ${run.detail ?? ""}`.trim() };
  }

  /* 🔴 글자를 버렸으면 **말한다**(조용히 사라지게 두지 않는다 · AC-9). 막지는 않는다 — 글은 이미 나갔다. */
  if (parts.dropped > 0) {
    await writeAudit({ tenantId: tid, action: "threads_chain_truncated", actorType: "system", target: `piece:${piece.id}`,
      detail: { parts: parts.parts.length, droppedChars: parts.dropped, note: "연결글 조각 상한에 걸려 뒷부분이 안 나갔다" }, riskLevel: "medium" })
      .catch((e: unknown) => console.warn("[threads] 감사 기록 실패", String((e as Error)?.message ?? e).slice(0, 80)));
  }
  /* 🔴 **문장 한가운데서 끊었으면 말한다** — 버린 글자를 말하는 것과 **같은 규율의 남은 반쪽**이다(AC-9).
     한 문장이 500자를 넘는 원고에서는 끊을 수밖에 없는데, 그게 **조용히** 일어나면 아무도 모른다. */
  if (parts.cutMidSentence) {
    await writeAudit({ tenantId: tid, action: "threads_chain_cut_midsentence", actorType: "system", target: `piece:${piece.id}`,
      detail: { parts: parts.parts.length, cutKinds: parts.cutKinds, note: "문장 자리를 못 찾아 낱말·글자에서 끊었다(한 문장이 조각 상한보다 길다)" }, riskLevel: "low" })
      .catch((e: unknown) => console.warn("[threads] 감사 기록 실패", String((e as Error)?.message ?? e).slice(0, 80)));
  }

  /* 끝났으니 이어 올리기 상태는 지운다. 🔴 다만 **어떻게 끊겼는지는 남긴다** — 감사는 운영이 보고,
     이 칸은 **그 글 화면**이 나중에 보여 줄 재료다(A 가 그릴 때 서버가 이미 갖고 있어야 한다 · AC-52). */
  const cutNote = parts.cutMidSentence || parts.dropped > 0
    ? sql` || ${jsonb({ thChainCut: { midSentence: parts.cutMidSentence, kinds: parts.cutKinds, droppedChars: parts.dropped, parts: parts.parts.length } })}`
    : sql``;
  await q(sql`UPDATE pieces SET meta = ((meta - ${META_FIELD}) - ${CHAIN_FIELD})${cutNote}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${piece.id}`);
  /* 🔴 그 글의 주소는 **첫 글**이다 — 답글 주소를 적으면 «글 보기»가 이야기 중간으로 떨어진다. */
  return { ok: true, via: "api", externalUrl: threadsUrl(account.handle, state.done[0]), channelRef: state.done[0] };
}

export async function publishThreadsVideo(piece: PublishPiece, account: PublishAccount): Promise<PublishResult> {
  const tid = piece.tenantId;

  const auth = await threadsAuth(tid, account);
  if (!auth.ok) return auth.res;
  const { token, userId } = auth;

  /* ① 컨테이너(있으면 재사용 — 중복 게시 0) */
  let creationId = await savedId(tid, piece.id);
  if (!creationId) {
    const videoUrl = await videoPublicUrlOf(tid, piece.id);
    if (!videoUrl) return { ok: false, reason: "not_publishable", retriable: false, error: "올릴 영상이 아직 없어요(렌더가 끝나지 않았어요)." };
    const body = new URLSearchParams({ media_type: "VIDEO", video_url: videoUrl, text: buildCaption(piece, 500), access_token: token });
    const r = await graph(`${GRAPH}/${encodeURIComponent(userId)}/threads`, { method: "POST", body }).catch(() => null);
    if (!r) return { ok: false, reason: "network", retriable: true, error: "스레드에 연결하지 못했어요. 잠시 후 다시 시도할게요." };
    if (r.status < 200 || r.status >= 300) { const c = thError(r.status, r.json); return { ok: false, reason: c.reason, retriable: c.retriable, error: c.error, detail: c.detail }; }
    creationId = String(r.json?.id ?? "").trim();
    if (!creationId) return { ok: false, reason: "channel_error", retriable: true, error: "스레드가 업로드 번호를 주지 않았어요.", detail: "no_creation_id" };
    await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ [META_FIELD]: creationId })}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${piece.id}`);
  }

  /* ② 처리 대기 — 공식 권고는 «30초 뒤». 여기선 짧게만 보고 아직이면 다음 틱으로 넘긴다. */
  let st = "";
  for (let i = 0; i < POLL_TRIES; i++) {
    const r = await graph(`${GRAPH}/${encodeURIComponent(creationId)}?fields=status&access_token=${encodeURIComponent(token)}`).catch(() => null);
    st = String(r?.json?.status ?? "").toUpperCase();
    if (st === "FINISHED") break;
    if (st === "ERROR") {
      await q(sql`UPDATE pieces SET meta = meta - ${META_FIELD}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${piece.id}`);
      return { ok: false, reason: "config", retriable: false, error: "스레드가 이 영상을 처리하지 못했어요(형식 확인 필요).", detail: "container_error" };
    }
    if (i < POLL_TRIES - 1) await sleep(POLL_WAIT_MS);
  }
  if (st !== "FINISHED") {
    return { ok: false, reason: "video_processing", retriable: true,
      error: "스레드가 영상을 준비하고 있어요. 잠시 뒤에 올릴게요.", detail: `status=${st || "unknown"}` };
  }

  /* ③ 게시 */
  const pub = await graph(`${GRAPH}/${encodeURIComponent(userId)}/threads_publish`, {
    method: "POST", body: new URLSearchParams({ creation_id: creationId, access_token: token }),
  }).catch(() => null);
  if (!pub) return { ok: false, reason: "network", retriable: true, error: "스레드에 연결하지 못했어요. 잠시 후 다시 시도할게요." };
  if (pub.status < 200 || pub.status >= 300) { const c = thError(pub.status, pub.json); return { ok: false, reason: c.reason, retriable: c.retriable, error: c.error, detail: c.detail }; }
  const id = String(pub.json?.id ?? "").trim();
  if (!id) return { ok: false, reason: "channel_error", retriable: true, error: "올렸는데 스레드가 게시 번호를 주지 않았어요.", detail: "no_media_id" };

  await q(sql`UPDATE pieces SET meta = meta - ${META_FIELD}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${piece.id}`);
  return { ok: true, via: "api", externalUrl: threadsUrl(account.handle, id), channelRef: id };
}
