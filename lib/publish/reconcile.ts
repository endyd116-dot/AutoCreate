/**
 * lib/publish/reconcile.ts — 🔴 **«우리 기록이 없는 사고»를 채널에 물어 고친다**(2026-09-21 · B2 · AC-200).
 *   🔎 출처: AM `lib/naver-publish-verify.ts reconcileUnknownNaverPieces`(2026-09-04 NAVERPUB 라운드)를 **구조만** 가져왔다.
 *      복사일 2026-09-21. 바꾼 것 셋 —
 *        ① AM 은 «최근 3일 RSS» 라는 **고정 창**으로 본다. 우리는 **그 잡을 집어 간 시각(`since`)** 으로 본다.
 *           고정 창은 «3일 안에 같은 제목으로 새로 쓴 글»을 옛 글로 오인한다(재발행이 영영 안 된다).
 *        ② AM 은 찾으면 **무조건 그 주소로 갈음**한다. 우리는 `found_after`(잡 시작 뒤에 생긴 글)일 때만 갈음하고,
 *           `found_before` 는 **말해 주고 그대로 올린다**(CLAUDE §9 · 판단은 고객).
 *        ③ AM 은 네이버 전용이다. 우리는 `lib/publish/already.ts` 의 채널표를 타서 티스토리도 같이 본다.
 *
 *   ══ 왜 여기가 맞는 자리인가 ══
 *     중복은 **`publish()` 밖에서** 태어난다: 러너가 올리고 → 보고 전에 죽고 → `reapStaleJobs` 가
 *     15분 뒤 `queued` 로 되돌리고 → 다른 러너가 **같은 글을 또 올린다.** 그 길에는 멱등 검사 ①이 없다.
 *     그래서 이 화해기를 **두 자리**에서 부른다 — `publish()` 앞머리, 그리고 `reapStaleJobs` 의 되돌리기 **직전**.
 *     (AM 도 같은 자리를 골랐다: `cron-content-publisher.ts` 가 스테일을 못박기 **전에** 화해기를 먼저 부른다.)
 *
 *   🔴 **게이트가 아니다**(§9). 이 파일이 발행을 세우는 경우는 단 하나 — **이미 올라가 있을 때**이고,
 *      그건 막는 게 아니라 §4.7 «발행 멱등» 그 자체다(열쇠를 우리 장부 대신 채널에서 주워 왔을 뿐).
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb, utcDate } from "../db-util";
import { writeAudit } from "../audit";
import { channelLabelKo } from "../channel-url";
import { finalizePublish } from "./finalize";
import { askChannelForExisting, alreadySay, type AlreadyAsk } from "./already";

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

export interface ReconcileResult {
  /** 채널에서 찾아 **우리 기록을 고쳤나**(= 재발행하면 안 된다). */
  recovered: boolean;
  ask: AlreadyAsk;
  externalUrl?: string;
}

/** 조용히 넘어간 판정(물어볼 길이 없는 채널 등) — 호출부가 «안 물어봤다»를 구분할 수 있게. */
const SKIPPED: AlreadyAsk = { verdict: "unknown", source: null, hit: null, scanned: 0, why: "skipped", askedAt: "" };

async function notify(tid: number, kind: string, title: string, body: string, link?: string): Promise<void> {
  try {
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
      VALUES (${tid}, ${kind.slice(0, 32)}, ${title.slice(0, 160)}, ${body}, ${link ? link.slice(0, 200) : null})`);
  } catch (e) { console.error("[reconcile] notify failed", (e as Error)?.message ?? e); }
}

/**
 * 🔴 정본. 이 piece 가 **채널에는 이미 있는지** 묻고, 있으면 기록을 고친다.
 *   @param since 러너가 이 잡을 집어 간 시각(UTC ISO). 🔴 모르면 null — 그러면 `found_after` 는 **절대 안 난다**
 *                («우리 것»이라 단정할 근거가 없으므로 갈음하지 않는다 · AC-9).
 *   @returns `recovered:true` 면 호출부는 **다시 올리면 안 된다.**
 *
 *   ⚠️ 실패해도 던지지 않는다 — 못 물어본 것 때문에 발행이 멈추면 그게 §9 가 막는 바로 그 거래다.
 */
export async function reconcileLostPublish(input: {
  tenantId: number; pieceId: number; since?: string | null; jobId?: number | null;
}): Promise<ReconcileResult> {
  const tid = n(input.tenantId), pid = n(input.pieceId);
  if (!tid || !pid) return { recovered: false, ask: SKIPPED };
  let piece: Row | undefined;
  try {
    [piece] = await q(sql`SELECT id, tenant_id, channel, title, status, account_id, external_url, channel_ref
      FROM pieces WHERE tenant_id = ${tid} AND id = ${pid} LIMIT 1`);
  } catch (e) { console.error("[reconcile] piece load", (e as Error)?.message ?? e); return { recovered: false, ask: SKIPPED }; }
  if (!piece) return { recovered: false, ask: SKIPPED };
  // 이미 우리 장부에 있으면 물어볼 것이 없다(§4.7 ① 이 이미 잡는다).
  if (piece.external_url || piece.channel_ref) return { recovered: false, ask: SKIPPED };

  const channel = String(piece.channel ?? "");
  const title = String(piece.title ?? "");
  const accountId = n(piece.account_id);
  if (!accountId) return { recovered: false, ask: SKIPPED };
  let handle = "";
  try {
    const [a] = await q(sql`SELECT handle FROM accounts WHERE tenant_id = ${tid} AND id = ${accountId} LIMIT 1`);
    handle = String(a?.handle ?? "");
  } catch { /* 못 읽으면 아래에서 no_handle 로 떨어진다 */ }

  const ask = await askChannelForExisting({ channel, handle, title, since: input.since ?? null });

  /* 🔴 **판정은 늘 남긴다**(§9-② «사람이 안 보는 경로에서도 닿게»). 자동 승인으로 나간 글도
     나중에 «그때 채널에 뭐가 있었나»를 볼 수 있어야 한다. `unknown` 도 남긴다 — «못 물어봤다»가 사실이다. */
  try {
    await q(sql`UPDATE pieces SET meta = COALESCE(meta, '{}'::jsonb) || ${jsonb({ alreadyCheck: { ...ask, ...(input.jobId ? { jobId: n(input.jobId) } : {}) } })}, updated_at = NOW()
      WHERE tenant_id = ${tid} AND id = ${pid}`);
  } catch (e) { console.error("[reconcile] meta write", (e as Error)?.message ?? e); }

  const label = channelLabelKo(channel);
  const say = alreadySay(ask, label);

  if (ask.verdict === "found_after" && ask.hit?.url) {
    /* 🔴 **우리가 올려 놓고 기록을 잃었다.** 재발행 대신 그 주소로 확정한다 — 이것이 §4.7 멱등이다. */
    const fin = await finalizePublish(pid, {
      via: "runner", externalUrl: ask.hit.url, tenantId: tid, accountId,
      ...(ask.hit.at ? { publishedAt: ask.hit.at } : {}),
    });
    await writeAudit({
      tenantId: tid, action: "publish_recovered_from_channel", actorType: "system", target: `piece:${pid}`,
      detail: { channel, handle, url: ask.hit.url, at: ask.hit.at, since: input.since ?? null, jobId: input.jobId ?? null, scanned: ask.scanned, finalized: fin.ok },
      riskLevel: "medium",
    });
    if (fin.ok) {
      await notify(tid, "publish_recovered", "이미 올라간 글을 찾았어요", `${say ?? "채널에서 이 글을 찾아 기록을 맞췄어요."}`, ask.hit.url);
      return { recovered: true, ask, externalUrl: ask.hit.url };
    }
    /* 확정에 실패해도 **재발행은 막는다** — 채널에 글이 있는 것은 사실이고, 그 위에 또 올리면 중복이 된다. */
    console.error("[reconcile] finalize failed after channel hit", fin);
    return { recovered: true, ask, externalUrl: ask.hit.url };
  }

  if (ask.verdict === "found_before" && ask.hit?.url) {
    /* 🔴 **막지 않는다**(§9). 전부터 있던 같은 제목일 뿐이고, 올릴지는 고객이 정한다. 말해 주고 기록만 남긴다. */
    await writeAudit({
      tenantId: tid, action: "publish_same_title_exists", actorType: "system", target: `piece:${pid}`,
      detail: { channel, handle, url: ask.hit.url, at: ask.hit.at, note: "막지 않고 내보냄(CLAUDE §9)" }, riskLevel: "low",
    });
    if (say) await notify(tid, "publish_same_title", "같은 제목의 글이 이미 있어요", say, ask.hit.url);
    return { recovered: false, ask };
  }

  return { recovered: false, ask };
}

/**
 * 이 piece 를 올리려고 **러너가 집어 간 가장 최근 시각**(UTC ISO) — `since` 의 정본.
 *   🔴 `claimed_at` 이 없으면 **null 을 돌려준다**(`created_at` 으로 대신하지 않는다) —
 *      아직 아무도 안 집어 간 잡을 «시작했다»로 읽으면 그 뒤의 남의 글이 «우리 것»이 된다.
 */
export async function lastClaimAtFor(tenantId: number, pieceId: number): Promise<string | null> {
  try {
    const [r] = await q(sql`SELECT claimed_at FROM runner_jobs
      WHERE tenant_id = ${n(tenantId)} AND piece_id = ${n(pieceId)} AND kind LIKE 'publish.%' AND claimed_at IS NOT NULL
      ORDER BY claimed_at DESC LIMIT 1`);
    /* 🔴 `utcDate` 를 쓴다 — 손으로 «Z» 를 붙이면 `+00` 두 자리 오프셋에서 Invalid Date 가 나고,
       그게 조용히 새어 나가면 `since` 가 없는 것과 같아져 **`found_after` 가 영영 안 난다**(PITFALLS #4 · AC-5). */
    const d = utcDate(r?.claimed_at);
    return d ? d.toISOString() : null;
  } catch { return null; }
}
