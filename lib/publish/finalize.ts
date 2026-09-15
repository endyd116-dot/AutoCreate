/**
 * lib/publish/finalize.ts — «발행이 끝났다»를 기록하는 **단 하나의 자리**(계약 §10 · §4.3 발행 멱등).
 *   AC 신규 2026-09-14(B2). AM 관례: ../AutoMarketing/lib/content-runner.ts reportRunnerResult(published 도장 규율).
 *
 *   이 함수만 건드리는 것:
 *     · `posts` 행 1개(piece 당 1행)
 *     · `pieces` status `published` · published_at · external_url · channel_ref
 *     · `slots` status `published`
 *     · `accounts` posts_today++ · last_post_at
 *     · 알림 1행
 *
 *   🔴 멱등(CLAUDE §4.7 «발행 멱등 — channel_ref/external_url 있으면 재게시 금지»):
 *      **조건부 UPDATE 한 문장으로 선점**한다(`WHERE external_url IS NULL AND status <> 'published'`).
 *      졌으면 아무것도 바꾸지 않고 already:true — 같은 piece 를 두 번 넣어도 posts 는 1행이다.
 *      «먼저 SELECT 하고 없으면 INSERT» 는 동시 호출(API 성공 + 러너 report)에서 두 행을 만든다 — 그래서 안 쓴다.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../db-util";
import { writeAudit } from "../audit";
import type { FinalizeInput, FinalizeResult } from "./contract";

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** 🔴 정본. 멱등 — 이미 발행돼 있으면 아무것도 바꾸지 않고 기존 post 를 돌려준다. */
export async function finalizePublish(pieceId: number, input: FinalizeInput): Promise<FinalizeResult> {
  const id = n(pieceId);
  if (!id) return { ok: false, reason: "not_found", error: "글을 찾을 수 없어요." };
  const externalUrl = input.externalUrl ? String(input.externalUrl).slice(0, 300) : null;
  const channelRef = input.channelRef ? String(input.channelRef).slice(0, 160) : null;
  if (!externalUrl && !channelRef) return { ok: false, reason: "no_url", error: "글 주소가 없어 발행을 확정할 수 없어요." };

  let piece: Row | undefined;
  try {
    [piece] = await q(sql`SELECT id, tenant_id, account_id, slot_id, channel, title, status, external_url, channel_ref, meta   /* [P1R8 §5.1] meta = 대가 여부(쇼핑 태그 안내 판정) */
      FROM pieces WHERE id = ${id} LIMIT 1`);
  } catch (e) { return { ok: false, reason: "db", error: "발행 기록을 저장하지 못했어요.", detail: String((e as Error)?.message ?? e).slice(0, 160) }; }
  if (!piece) return { ok: false, reason: "not_found", error: "글을 찾을 수 없어요." };

  const tid = n(piece.tenant_id);
  if (input.tenantId && n(input.tenantId) !== tid) return { ok: false, reason: "tenant_mismatch", error: "글을 찾을 수 없어요." };
  const accountId = n(input.accountId) || n(piece.account_id);
  const slotId = n(piece.slot_id);

  try {
    /* ① 선점 — 이긴 호출만 아래를 실행한다(동시 호출에서도 posts 1행). */
    const claimed = await q(sql`
      UPDATE pieces SET status = 'published',
        published_at = ${input.publishedAt ? sql`${input.publishedAt}::timestamptz AT TIME ZONE 'UTC'` : sql`NOW()`},
        external_url = COALESCE(${externalUrl}, external_url),
        channel_ref  = COALESCE(${channelRef}, channel_ref),
        updated_at = NOW()
      WHERE id = ${id} AND external_url IS NULL AND channel_ref IS NULL AND status <> 'published'
      RETURNING id`);

    if (!claimed.length) {
      // 이미 발행돼 있다. post 행이 없으면(과거 사고·수리) 그때만 채우고, 카운터는 손대지 않는다.
      const [existing] = await q(sql`SELECT id, external_url, channel_ref FROM posts WHERE tenant_id = ${tid} AND piece_id = ${id} ORDER BY id LIMIT 1`);
      if (existing) {
        const out: FinalizeResult = {
          ok: true, postId: n(existing.id), pieceId: id, tenantId: tid, already: true,
          ...(existing.external_url ? { externalUrl: String(existing.external_url) } : {}),
          ...(existing.channel_ref ? { channelRef: String(existing.channel_ref) } : {}),
          ...(slotId ? { slotId } : {}), ...(accountId ? { accountId } : {}),
        };
        return out;
      }
      const [repaired] = await q(sql`
        INSERT INTO posts (tenant_id, piece_id, account_id, channel, external_url, channel_ref, published_via, stats, published_at)
        VALUES (${tid}, ${id}, ${accountId || null}, ${String(piece.channel ?? "")},
                ${externalUrl ?? (piece.external_url ? String(piece.external_url) : null)},
                ${channelRef ?? (piece.channel_ref ? String(piece.channel_ref) : null)},
                ${input.via}, ${jsonb(input.stats ?? {})}, NOW())
        RETURNING id`);
      return {
        ok: true, postId: n(repaired?.id), pieceId: id, tenantId: tid, already: true,
        ...(externalUrl ? { externalUrl } : {}), ...(channelRef ? { channelRef } : {}),
        ...(slotId ? { slotId } : {}), ...(accountId ? { accountId } : {}),
      };
    }

    /* ② posts 행 */
    const [post] = await q(sql`
      INSERT INTO posts (tenant_id, piece_id, account_id, channel, external_url, channel_ref, published_via, stats, published_at)
      VALUES (${tid}, ${id}, ${accountId || null}, ${String(piece.channel ?? "")}, ${externalUrl}, ${channelRef},
              ${input.via}, ${jsonb(input.stats ?? {})},
              ${input.publishedAt ? sql`${input.publishedAt}::timestamptz AT TIME ZONE 'UTC'` : sql`NOW()`})
      RETURNING id`);
    const postId = n(post?.id);

    /* ③ 슬롯 */
    if (slotId) {
      await q(sql`UPDATE slots SET status = 'published', updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${slotId}`);
    }

    /* ④ 계정 카운터 — 캐던스(daily_cap·min_gap)가 읽는 값이라 발행과 같은 트랜잭션 감각으로 함께 쓴다. */
    if (accountId) {
      await q(sql`UPDATE accounts SET posts_today = posts_today + 1, last_post_at = NOW(), updated_at = NOW()
        WHERE tenant_id = ${tid} AND id = ${accountId}`);
    }

    /* ⑤ 알림 1행(침묵 금지) */
    try {
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
        VALUES (${tid}, 'post_published', ${"글이 올라갔어요"},
                ${`«${String(piece.title ?? "").slice(0, 40)}» 이(가) 올라갔어요.`}, ${externalUrl ? externalUrl.slice(0, 200) : "/app/posts.html"})`);
    } catch (e) { console.error("[finalize] notify failed", e); }

    /* ⑥ [P1R8 §5.1] 🔴 **유튜브 쇼핑 태그는 우리가 못 단다** — 공식 문서상 Data API v3 에 상품 태그 필드가 없다
       (태그는 스튜디오·쇼핑 제휴 프로그램에서 단다 · Merchant Reports API 는 «읽기»만).
       그렇다고 조용히 넘기면 고객은 «제휴 글인데 왜 상품이 안 붙지»를 영영 모른다(AC-9) — **한 번만** 알려 준다.
       제휴가 걸린 유튜브 영상일 때만 · kind 로 평생 1회(같은 말을 매번 하지 않는다). */
    try {
      const isYoutube = String(piece.channel ?? "") === "youtube_shorts";
      const meta = (piece.meta && typeof piece.meta === "object" ? piece.meta : {}) as Record<string, unknown>;
      const paid = !!(meta.affiliate ?? meta.affiliateLink ?? meta.affiliateHint) || meta.adDisclosure === true || meta.sponsored === true || meta.gift === true;
      if (isYoutube && paid) {
        await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
          SELECT ${tid}, 'youtube_shopping_manual', ${"쇼핑 태그는 유튜브에서 직접 달아 주세요"},
                 ${"상품 태그는 유튜브가 API 로 열어 두지 않아서 우리가 대신 달 수 없어요. 유튜브 스튜디오에서 이 영상에 상품을 달면 수익이 붙어요."},
                 ${externalUrl ? externalUrl.slice(0, 200) : "/app/posts.html"}
          WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE tenant_id = ${tid} AND kind = 'youtube_shopping_manual')`);
      }
    } catch (e) { console.error("[finalize] shopping-tag notice failed", e); }

    await writeAudit({
      tenantId: tid, action: "post_published", actorType: "system", target: `piece:${id}`,
      detail: { postId, channel: String(piece.channel ?? ""), via: input.via, accountId: accountId || null, slotId: slotId || null, externalUrl },
      riskLevel: "low",
    });

    return {
      ok: true, postId, pieceId: id, tenantId: tid, already: false,
      ...(externalUrl ? { externalUrl } : {}), ...(channelRef ? { channelRef } : {}),
      ...(slotId ? { slotId } : {}), ...(accountId ? { accountId } : {}),
    };
  } catch (e) {
    console.error("[finalize] failed", e);
    return { ok: false, reason: "db", error: "발행 기록을 저장하지 못했어요.", detail: String((e as Error)?.message ?? e).slice(0, 160) };
  }
}
