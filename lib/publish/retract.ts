/**
 * lib/publish/retract.ts — **올라간 글을 내린다**(DESIGN §5E · 사장님 질문 2026-09-15 · R8 §3 발주).
 *
 *   ══ 왜 만드나 ══
 *     우리는 **올릴 줄만 알았다** — 러너 잡 종류에 삭제 계열이 **0개**였다.
 *     고객 계정으로 올리면서 내릴 줄은 모르는 건 반쪽이다: 잘못된 숫자가 나갔을 때 · 고지가 빠졌을 때 · 마음이 바뀌었을 때,
 *     지금은 고객이 폰에서 앱을 열고 그 글을 찾아 들어가 지워야 한다.
 *
 *   🔴 **만드는 것은 «고객이 «내려 줘»를 눌렀을 때»뿐이다**(§5E.1 ②).
 *      «우리가 고객 동의 없이 내린다»(③)는 **안 만든다** — 되돌릴 수 없고, 러너 자동 삭제도 계정 위험이고,
 *      무엇보다 **내릴 수단을 갖는 것 자체가 책임을 끌어온다**(«통제할 수 있었는데 안 했다»).
 *      그래서 이 파일의 모든 입구는 **사람이 누른 것**이어야 한다(`actor` 를 받는다 · 크론이 부르지 않는다).
 *
 *   ══ §5E.3 규율 ══
 *     · 🔴 **멱등** — 이미 내려간 글에 또 돌려도 «없음»이 **성공**이다.
 *       ⚠️ 이게 **AC-9 의 반대 얼굴**이라 방향을 헷갈리기 쉽다:
 *         AC-9 (발행·수집) — «없다»를 «0·정상»으로 읽으면 **틀린다**(못 읽은 걸 0원이라 적는 것).
 *         여기 (내리기)    — «없다»가 정확히 **우리가 원하는 상태**다. «없어서 못 찾았다»를 실패로 세면 안 된다.
 *       같은 «없음»인데 한쪽은 거짓말이고 한쪽은 성공이다 — **무엇을 물었는가**가 다르기 때문이다.
 *     · 🔴 **내려갔는지 실제로 확인한다** — «삭제 버튼을 눌렀다»는 증거가 아니다(AC-54).
 *       내린 뒤 `verify.post_alive` 를 걸어 **쿠키 없는 서버 눈으로** «정말 없나»를 본다.
 *     · **원장을 지우지 않는다** — `posts` 행은 그대로 두고 표식만 남긴다(수익 귀속·감사).
 *     · **코인 0** — 우리 잘못이든 고객 마음이든 내리는 데 돈을 받지 않는다(이 파일에 코인 호출이 없는 이유다).
 *     · **못 내리는 채널은 못 내린다고 말한다** — `retractViaOf` 가 null 이면 «직접 내려 주세요» + 그 글 링크.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../db-util";
import { writeAudit } from "../audit";
import { retractViaOf } from "../channel-registry";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

export type RetractState =
  | "done"        // 우리가 지웠고 확인까지 걸었다
  | "already"     // 이미 내려가 있었다 — **성공**이다(§5E.3 멱등)
  | "queued"      // 러너가 할 일 — 고객 PC 가 켜지면 지운다
  | "unsupported" // 우리가 대신 내려 줄 길이 없다
  | "not_found"   // 그런 글이 없다(남의 글 id 포함 — 있고 없고를 알려 주지 않는다)
  | "failed";

export interface RetractResult {
  ok: boolean;
  state: RetractState;
  message: string;
  /** 길이 없을 때 «여기서 직접 내려 주세요»로 보낼 주소(그 글 주소 그대로). */
  openUrl?: string;
  detail?: string;
}

/** 내릴 때 남기는 표식 — 🔴 `posts` 행을 **지우지 않는다**(수익 귀속·감사가 남아야 한다). */
export interface RetractMark { retractedAt: string; reason: string; by: string; verified?: boolean }

/**
 * markRetracting — 표식을 **먼저** 찍는다(`post-alive` 에서 배운 순서).
 *   잡·삭제를 먼저 하고 표식을 나중에 찍으면, 그 사이에 끊겼을 때 **같은 글을 두 번 지우러** 간다.
 *   표식이 먼저면 최악이 «표식만 있고 안 지움»인데 그건 확인 단계가 잡는다.
 *   @returns 이번 호출이 표식을 찍었나(false = 다른 요청이 이미 진행 중)
 */
async function markRetracting(tid: number, postId: number, reason: string, by: string): Promise<boolean> {
  const mark: RetractMark = { retractedAt: new Date().toISOString(), reason: reason.slice(0, 200), by };
  const rows = await q(sql`UPDATE posts SET stats = COALESCE(stats, '{}'::jsonb) || ${jsonb({ retract: mark })}
    WHERE tenant_id = ${tid} AND id = ${postId} AND (stats->'retract') IS NULL RETURNING id`);
  return rows.length > 0;
}

/**
 * retractPost — 한 글을 내린다. **사람이 누른 것만**(`by` 가 사람이어야 한다 · 크론 금지 · §5E.1 ③).
 */
export async function retractPost(tid: number, postId: number, opts: { reason: string; by: string }): Promise<RetractResult> {
  const [row] = await q(sql`SELECT id, piece_id, account_id, channel, external_url, channel_ref, stats
    FROM posts WHERE tenant_id = ${tid} AND id = ${n(postId)} LIMIT 1`);
  if (!row) return { ok: false, state: "not_found", message: "그 글을 찾을 수 없어요." };

  const channel = String(row.channel ?? "");
  const externalUrl = String(row.external_url ?? "");
  const stats = (row.stats && typeof row.stats === "object" ? row.stats : {}) as Record<string, unknown>;

  /* 이미 내린 글 — 🔴 «또 내려 줘»는 **성공**이다(§5E.3 멱등). 두 번 눌렀다고 오류를 보이면
     고객은 «안 됐나» 하고 또 누른다. */
  if (stats.retract && typeof stats.retract === "object") {
    return { ok: true, state: "already", message: "이미 내렸어요.", ...(externalUrl ? { openUrl: externalUrl } : {}) };
  }

  const via = retractViaOf(channel);
  if (!via) {
    /* 🔴 **없는 길을 단추로 만들지 않는다.** 대신 «어디로 가면 되는지»를 준다. */
    return {
      ok: false, state: "unsupported",
      message: `«${channel}» 은 우리가 대신 내려 드릴 수 없어요. 아래 주소로 가서 직접 내려 주세요.`,
      ...(externalUrl ? { openUrl: externalUrl } : {}),
    };
  }
  if (!externalUrl && !row.channel_ref) {
    return { ok: false, state: "failed", message: "그 글의 주소를 몰라서 내리지 못했어요. 직접 내려 주세요." };
  }

  if (!(await markRetracting(tid, n(row.id), opts.reason, opts.by))) {
    // 다른 요청이 방금 집어갔다 — 두 번 지우러 가지 않는다.
    return { ok: true, state: "already", message: "이미 내리는 중이에요.", ...(externalUrl ? { openUrl: externalUrl } : {}) };
  }

  await writeAudit({
    tenantId: tid, action: "post_retract_start", actorType: "user", target: `post:${n(row.id)}`,
    detail: { channel, via, reason: opts.reason.slice(0, 200), externalUrl: externalUrl.slice(0, 200) }, riskLevel: "high",
  });

  if (via === "runner") {
    // 🔴 import 는 함수 안에서(AC-17).
    const { enqueueJob } = await import("../runner-jobs");
    try {
      const j = await enqueueJob({
        tenantId: tid, kind: "publish.retract",
        accountId: row.account_id ? n(row.account_id) : null,
        pieceId: row.piece_id ? n(row.piece_id) : null,
        /* 🔴 러너가 읽는 칸 이름 · 서버가 읽는 칸 이름을 **둘 다** 싣는다
           (`post_alive`·`revenue.stats` 에서 한 칸씩 빠뜨려 기능이 통째로 조용히 죽었던 그것 — `verify-job-payloads.mts` 가 지킨다). */
        payload: { externalUrl, channel, postId: n(row.id), reason: opts.reason.slice(0, 200) } as never,
        dedupe: true,
      });
      return {
        ok: true, state: j.created ? "queued" : "already",
        message: j.created
          ? "내 PC 프로그램이 켜지면 그 글을 내릴게요. 끝나면 정말 내려갔는지 한 번 더 확인해요."
          : "이미 내리는 중이에요.",
        ...(externalUrl ? { openUrl: externalUrl } : {}),
      };
    } catch (e) {
      await unmarkRetract(tid, n(row.id));     // 🔴 표식만 남고 아무도 안 지우는 상태를 남기지 않는다
      return { ok: false, state: "failed", message: "지금은 예약하지 못했어요. 잠시 뒤 다시 눌러 주세요.", detail: String((e as Error)?.message ?? e).slice(0, 160) };
    }
  }

  /* API 채널 — 서버가 직접 지운다. */
  const { retractViaApi } = await import("./retract-api");
  const r = await retractViaApi(tid, {
    channel, accountId: row.account_id ? n(row.account_id) : null,
    externalUrl, channelRef: String(row.channel_ref ?? ""),
  });
  if (!r.ok) {
    await unmarkRetract(tid, n(row.id));
    return { ok: false, state: "failed", message: r.error, ...(externalUrl ? { openUrl: externalUrl } : {}), ...(r.detail ? { detail: r.detail } : {}) };
  }
  await afterRetracted(tid, n(row.id), { channel, externalUrl, pieceId: row.piece_id ? n(row.piece_id) : null, accountId: row.account_id ? n(row.account_id) : null });
  return {
    ok: true, state: r.alreadyGone ? "already" : "done",
    message: r.alreadyGone ? "이미 내려가 있었어요." : "글을 내렸어요. 정말 내려갔는지 한 번 더 확인할게요.",
  };
}

/** 표식 되돌리기 — 지우지도 못했는데 «내렸다»가 남으면 그 글은 영영 다시 못 내린다. */
export async function unmarkRetract(tid: number, postId: number): Promise<void> {
  await q(sql`UPDATE posts SET stats = stats - 'retract' WHERE tenant_id = ${tid} AND id = ${n(postId)}`).catch(() => {});
}

/**
 * afterRetracted — 내린 **뒤에** 할 일.
 *   🔴 «삭제 버튼을 눌렀다»는 증거가 아니다(AC-54 · §5E.3). `verify.post_alive` 를 걸어
 *      **쿠키 없는 서버 눈으로** «정말 없나»를 본다(그 잡의 보고 처리가 `stats.alive` 를 적는다).
 */
export async function afterRetracted(tid: number, postId: number, ctx: { channel: string; externalUrl: string; pieceId: number | null; accountId: number | null }): Promise<void> {
  await q(sql`UPDATE posts SET stats = COALESCE(stats,'{}'::jsonb) || ${jsonb({ retractDoneAt: new Date().toISOString() })}
    WHERE tenant_id = ${tid} AND id = ${n(postId)}`).catch(() => {});
  await writeAudit({
    tenantId: tid, action: "post_retracted", actorType: "system", target: `post:${n(postId)}`,
    detail: { channel: ctx.channel, externalUrl: ctx.externalUrl.slice(0, 200) }, riskLevel: "high",
  });
  /* 확인 잡 — 러너 채널만 건다(API 채널은 `retract-api` 가 지운 직후 서버가 바로 확인한다).
     ⚠️ 여기서 실패해도 내린 사실은 그대로다 — 확인이 안 됐다고 «못 내렸다»가 되지는 않는다. */
  if (!ctx.externalUrl) return;
  try {
    const { enqueueJob } = await import("../runner-jobs");
    if (["naver_blog", "tistory"].includes(ctx.channel)) {
      await enqueueJob({
        tenantId: tid, kind: "verify.post_alive", accountId: ctx.accountId, pieceId: ctx.pieceId,
        payload: { externalUrl: ctx.externalUrl, channel: ctx.channel, postId: n(postId), title: "" } as never,
        dedupe: true,
      });
    }
  } catch (e) {
    console.error("[retract] 확인 잡 적재 실패(비치명)", String((e as Error)?.message ?? e).slice(0, 120));
  }
}
