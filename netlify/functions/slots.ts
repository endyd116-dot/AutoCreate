/**
 * 편성 자리 조작 API(계약 P1R2 §6 · DESIGN §5B.8 슬롯 시트 4동작 중 3 — «건너뛰기»는 R1 `/api/slots-skip`):
 *   POST /api/slots-assign-topic  { slotId, topicId }  → { ok:true, slot:Slot }   // 소재 바꾸기
 *   POST /api/slots-reschedule    { slotId, at:ISO }   → { ok:true, slot:Slot }   // 시각 바꾸기
 *   POST /api/slots-produce-now   { slotId }           → { ok:true, pieceId }     // 지금 만들기(코인 즉시 차감 · 배경 생성)
 *
 *   🔴 «지금 만들기»는 **사람이 누른 것**이므로 `origin:"manual"` — 슬롯 게이트를 통과한다(사람이 곧 편성자다).
 *      그래도 `slotId` 를 실어 **그 자리에** 붙인다(유령 슬롯 0 · 같은 날 두 번 나가지 않게).
 *      코인도 사람 경로라 `auto:false` → 충전 코인을 쓸 수 있다(자동 경로만 옵트인 제한 · AM 규율).
 *   🔴 시각 바꾸기는 캐던스를 깨지 못한다(CLAUDE §4.7): 같은 채널 계정 간 30분 · 그 계정의 `min_gap_min`.
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { utcDate } from "../../lib/db-util";
import { q } from "../../lib/accounts";
import { listSlots, type Slot } from "../../lib/slots";
import { kstDateStr, kstToUtc, ACCOUNT_GAP_MIN } from "../../lib/best-time";
import { confirm } from "../../lib/director";
import { proposeForSlot, toAutoSlot } from "../../lib/cron/director-auto";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/slots-assign-topic", "/api/slots-reschedule", "/api/slots-produce-now"] };
/** netlify dev 의 정적 폴백(.html·/index.html 재시도)이 경로 매칭에서 빠지면 엉뚱한 405 가 보인다 — 꼬리를 떼고 맞춘다(AC-7). */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Number(v || 0);

/** 아직 글이 안 붙은 자리(= 사용자가 바꿀 수 있는 자리). `lib/slot-gate.ts OPEN_SLOT_STATUS` 와 같은 뜻. */
const EDITABLE = new Set(["planned", "topic_assigned", "no_topic", "coin_short"]);

/** 한 자리만 돌려준다 — 투영은 `listSlots` 한 벌을 그대로 쓴다(Slot 모양이 두 벌로 갈라지지 않게). */
async function oneSlot(tid: number, slotId: number, date: string): Promise<Slot | null> {
  const rows = await listSlots(tid, date, date);
  return rows.find((s) => s.id === slotId) ?? null;
}

/* 🔴 교차 테넌트(IDOR) 차단은 **구조로** 한다: 아래 모든 경로가 `auth.tid` 로만 슬롯을 찾는다
   (`WHERE tenant_id = ${tid} AND id = ${slotId}`). 남의 자리 id 를 실어도 행이 안 잡혀 404 로 끝난다 —
   본문의 tenantId 를 믿는 자리가 한 군데도 없다(CLAUDE §4.3·§4.6). */
export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const path = routeOf(req);
  try {
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const b = await readJson<Record<string, unknown>>(req);
    const slotId = n(b.slotId); if (!slotId) return badRequest("slotId");
    const [s] = await q(sql`SELECT id, channel, account_id, topic_id, piece_id, publish_at, status, slot_date::text AS d FROM slots WHERE tenant_id = ${tid} AND id = ${slotId}`);
    if (!s) return json({ ok: false, error: "편성 자리를 찾을 수 없어요.", step: "not_found" }, 404);
    const status = String(s.status), date = String(s.d).slice(0, 10);

    /* ───────── 소재 바꾸기 ───────── */
    if (path.endsWith("/slots-assign-topic")) {
      if (!EDITABLE.has(status)) return json({ ok: false, step: "state", error: "이미 글을 만들기 시작한 자리예요. 소재는 바꿀 수 없어요." }, 400);
      const topicId = n(b.topicId); if (!topicId) return badRequest("topicId");
      const [t] = await q(sql`SELECT id, title, status FROM topics WHERE tenant_id = ${tid} AND id = ${topicId} AND (expires_at IS NULL OR expires_at > NOW())`);
      if (!t) return json({ ok: false, step: "not_found", error: "그 소재를 찾을 수 없어요(기한이 지났을 수도 있어요)." }, 404);
      if (!["candidate", "picked"].includes(String(t.status))) return json({ ok: false, step: "topic_state", error: "이미 쓴 소재예요. 다른 소재를 골라 주세요." }, 400);

      const prev = s.topic_id ? n(s.topic_id) : null;
      // 다른 자리가 그 소재를 이미 쓰고 있으면 뺏지 않는다(한 소재 = 한 자리).
      const [taken] = await q(sql`SELECT id FROM slots WHERE tenant_id = ${tid} AND topic_id = ${topicId} AND id <> ${slotId} AND status NOT IN ('skipped','reassigned') LIMIT 1`);
      if (taken) return json({ ok: false, step: "topic_taken", error: "그 소재는 다른 자리에 이미 배정돼 있어요." }, 409);

      await q(sql`UPDATE topics SET status = 'picked', used_at = NULL WHERE tenant_id = ${tid} AND id = ${topicId} AND status = 'candidate'`);
      await q(sql`UPDATE slots SET topic_id = ${topicId}, status = 'topic_assigned', note = NULL, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${slotId}`);
      // 전에 잡아 뒀던 소재는 후보로 돌려준다(소재가 증발하지 않게).
      if (prev && prev !== topicId) await q(sql`UPDATE topics SET status = 'candidate' WHERE tenant_id = ${tid} AND id = ${prev} AND status = 'picked'`);
      await writeAudit({ tenantId: tid, action: "slot_assign_topic", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `slot:${slotId}`, detail: { topicId, prevTopicId: prev } });
      return json({ ok: true, slot: await oneSlot(tid, slotId, date) });
    }

    /* ───────── 시각 바꾸기 ───────── */
    if (path.endsWith("/slots-reschedule")) {
      if (["published", "publishing", "reassigned"].includes(status)) return json({ ok: false, step: "state", error: "이미 나간 자리는 시각을 바꿀 수 없어요." }, 400);
      const at = new Date(String(b.at ?? ""));
      if (Number.isNaN(at.getTime())) return badRequest("시각 형식을 확인해 주세요.", "at");
      if (at.getTime() < Date.now() + 10 * 60_000) return json({ ok: false, step: "too_soon", error: "지금보다 10분 이상 뒤로 잡아 주세요." }, 400);
      if (at.getTime() > Date.now() + 90 * 86400_000) return json({ ok: false, step: "too_far", error: "석 달 안으로 잡아 주세요." }, 400);

      // 캐던스 검사(CLAUDE §4.7) — 같은 채널 계정 간 30분 · 그 계정의 min_gap_min.
      const accountId = s.account_id ? n(s.account_id) : null;
      const [acc] = accountId ? await q(sql`SELECT min_gap_min, handle FROM accounts WHERE tenant_id = ${tid} AND id = ${accountId}`) : [undefined];
      const gapAcc = Math.max(ACCOUNT_GAP_MIN, n(acc?.min_gap_min));
      const neighbours = await q(sql`SELECT account_id, publish_at FROM slots
        WHERE tenant_id = ${tid} AND id <> ${slotId} AND channel = ${String(s.channel)} AND publish_at IS NOT NULL
          AND status NOT IN ('skipped','failed','reassigned') AND publish_at BETWEEN ${at.toISOString()}::timestamptz AT TIME ZONE 'UTC' - interval '1 day' AND ${at.toISOString()}::timestamptz AT TIME ZONE 'UTC' + interval '1 day'`);
      for (const x of neighbours) {
        const other = utcDate(x.publish_at); if (!other) continue;
        const diffMin = Math.abs(other.getTime() - at.getTime()) / 60_000;
        if (accountId && n(x.account_id) === accountId && diffMin < gapAcc) {
          return json({ ok: false, step: "cadence", error: `같은 계정의 다른 글과 ${gapAcc}분 이상 띄워 주세요.` }, 409);
        }
        if (diffMin < ACCOUNT_GAP_MIN) return json({ ok: false, step: "cadence", error: `같은 채널의 다른 글과 ${ACCOUNT_GAP_MIN}분 이상 띄워 주세요.` }, 409);
      }

      const newDate = kstDateStr(at);
      const reviewDeadline = kstToUtc(newDate, 2, 0);   // D-0 02:00 KST — 검수창 마감(§5B.7)
      await q(sql`UPDATE slots SET publish_at = ${at.toISOString()}::timestamptz AT TIME ZONE 'UTC', slot_date = ${newDate}::date,
        review_deadline = ${reviewDeadline.toISOString()}::timestamptz AT TIME ZONE 'UTC', updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${slotId}`);
      if (s.piece_id) await q(sql`UPDATE pieces SET scheduled_for = ${at.toISOString()}::timestamptz AT TIME ZONE 'UTC', updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${n(s.piece_id)}`);
      await writeAudit({ tenantId: tid, action: "slot_reschedule", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `slot:${slotId}`, detail: { from: utcDate(s.publish_at)?.toISOString() ?? null, to: at.toISOString() } });
      return json({ ok: true, slot: await oneSlot(tid, slotId, newDate) });
    }

    /* ───────── 지금 만들기 ───────── */
    if (path.endsWith("/slots-produce-now")) {
      if (s.piece_id) return json({ ok: true, pieceId: n(s.piece_id) });   // 멱등 — 이미 만들었다
      if (!EDITABLE.has(status)) return json({ ok: false, step: "state", error: "지금 만들 수 있는 자리가 아니에요." }, 400);
      if (!s.topic_id) return json({ ok: false, step: "no_topic", error: "먼저 소재를 골라 주세요." }, 400);

      const brief = await proposeForSlot(tid, toAutoSlot(s));
      if (!brief.ok) return json({ ok: false, step: brief.step, error: brief.error }, brief.step === "no_account" ? 409 : 400);
      // 사람이 누른 경로 — origin:"manual"(게이트 통과) · 코인은 충전분도 쓸 수 있다(auto:false).
      const r = await confirm(tid, brief.briefId, [], auth.user.uid, { slotId, origin: "manual" });
      if (!r.ok) {
        await q(sql`UPDATE briefs SET status = 'skipped' WHERE tenant_id = ${tid} AND id = ${brief.briefId}`);
        return r.step === "coin_short"
          ? json({ ok: false, step: "coin_short", error: r.error, need: (r as { need?: number }).need ?? 0, have: (r as { have?: number }).have ?? 0 }, 402)
          : json({ ok: false, step: r.step, error: r.error }, 400);
      }
      await writeAudit({ tenantId: tid, action: "slot_produce_now", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `slot:${slotId}`, detail: { briefId: brief.briefId, pieceIds: r.pieceIds, coinsCharged: r.coinsCharged } });
      return json({ ok: true, pieceId: r.pieceIds[0] ?? null, coinsCharged: r.coinsCharged, coinsLeft: r.coinsLeft }, 202);
    }

    return json({ ok: false, error: "not_found" }, 404);
  } catch (err) { return jsonError("slots", err); }
};
