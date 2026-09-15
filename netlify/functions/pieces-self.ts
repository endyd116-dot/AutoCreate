/**
 * POST /api/pieces-self — **내가 직접 쓴 글**을 우리 편성표에 올린다(DESIGN §5D ① · 사장님 «주요 골자»).
 *
 *   요청 { channel, accountId?, title, bodyHtml, slotId? | scheduleAt?, monetize?: { sponsored?, gift?, affiliate? } }
 *   응답 { ok, pieceId, status:"in_review", origin:"self",
 *          coins: { charged, ref },                 // 🔴 서버가 **원장에서 읽은** 값(리터럴 0 이 아니다)
 *          gate:  { ok, checks:[…] },               // 안 잰 축도 `skipped:true` 로 **실려 온다**
 *          slot:  { id, publishAt } | null,
 *          notice?: string }                        // 계정이 없어 자리를 못 잡았을 때만
 *   400 step:"cadence" (+ retryAt·gapMin·dailyCap·postsToday·capped) — `publish-now` 와 **같은 모양**(화면이 두 곳에서 다른 말을 하지 않게)
 *   400 step:"channel"|"title"|"body"|"when"|"slot"|"account"
 *
 *   🔴 일하는 몸통은 `lib/piece-self.ts` 에 있다 — HTTP 없이 되짚을 수 있어야 하기 때문이다(`netlify dev` 를 띄우는 자리가 AC-53 사고가 난 곳이다).
 *      이 파일은 «받아서 넘기고, 사유를 상태코드로 옮기는» 일만 한다.
 */
import { json, jsonError } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, requireWritable } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { createSelfPiece } from "../../lib/piece-self";

export const config = { path: "/api/pieces-self" };
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** 사유 → 상태코드. 캐던스·입력은 400, 서버가 못 한 것은 500. */
const STATUS: Readonly<Record<string, number>> = { insert: 500 };

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);
  try {
    const w = await requireWritable(auth.tid); if (!w.ok) return w.res;
    const b = await readJson<Record<string, unknown>>(req);
    const mon = (b.monetize && typeof b.monetize === "object" ? b.monetize : {}) as Record<string, unknown>;

    const r = await createSelfPiece({
      tenantId: auth.tid, userId: auth.user.uid,
      channel: String(b.channel ?? ""),
      accountId: n(b.accountId) || null,
      title: String(b.title ?? ""),
      bodyHtml: String(b.bodyHtml ?? ""),
      slotId: n(b.slotId) || null,
      scheduleAt: b.scheduleAt ? String(b.scheduleAt) : null,
      monetize: { sponsored: mon.sponsored === true, gift: mon.gift === true, affiliate: mon.affiliate },
    });
    if (!r.ok) return json(r, STATUS[r.step] ?? 400);

    await writeAudit({ tenantId: auth.tid, actorId: auth.user.uid, actorType: "user", action: "piece_self_created", target: `piece:${r.pieceId}`,
      detail: { channel: String(b.channel ?? ""), slotId: r.slot?.id ?? null, at: r.slot?.publishAt ?? null, charged: r.coins.charged, gateOk: r.gate.ok,
        failed: r.gate.checks.filter((c) => !c.pass).map((c) => c.key), skipped: r.gate.checks.filter((c) => c.skipped).map((c) => c.key) } });
    return json(r);
  } catch (err) { return jsonError("pieces_self", err); }
};
