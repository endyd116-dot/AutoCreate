/**
 * 관리형 러너 «신청»(계약 P1R6 §3.1 · DESIGN §9.0).
 *   GET  /api/managed-runner            → { ok, eligible, reason?, price:{ amountKrw, vatKrw, totalKrw }, status, assigned, max, devices?, requestedAt? }
 *   POST /api/managed-runner { devices, note? } → { ok, status:"requested", devices, price:{…} }
 *
 *   🔴 **실기기 프로비저닝은 이번 범위 밖**(계약 §3.1). 이 함수는 «신청서»를 받을 뿐이고,
 *      실제 배정은 운영자가 운영센터 «러너 팜»에서 손으로 한다(`ops-runner-assign` rebind).
 *      그래서 신청 표(`managed_runner_requests`)와 기기 표(`runner_devices`)를 **섞지 않는다** —
 *      섞으면 «신청만 했는데 기기가 생긴 것처럼» 보이는 화면이 된다.
 *   🔴 `price` 는 **대당 공급가**다(부가세 별도 · §12.0). 값은 `lib/plans.ts` 한 곳에서만 온다(화면 상수 금지).
 *      대수를 곱한 합계는 신청 시점에 `managed_runner_requests.total_krw` 로 **스냅샷**한다
 *      (요금이 나중에 바뀌어도 «그때 얼마로 신청했는지»가 남아야 한다).
 *   🔴 감사는 **await**(계약 §0 · `void writeAudit` 금지).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, requireWritable } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { q } from "../../lib/accounts";
import { utcDate } from "../../lib/db-util";
import { tenantPlan, requireFeature, managedRunnerUnitKrw, MANAGED_RUNNER_ACCOUNT_KRW } from "../../lib/plans";
import { vatOf } from "../../lib/billing-math";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/managed-runner"] };
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** 지금 이 테넌트에 **배정된** 관리형 기기 수(신청 수가 아니다). */
async function assignedCount(tid: number): Promise<number> {
  const [r] = await q(sql`SELECT COUNT(*) c FROM runner_devices WHERE tenant_id = ${tid} AND kind = 'managed'`);
  return n(r?.c);
}
/** 열려 있는 신청 1건(테넌트당 하나 · 부분 유니크 인덱스로 보장). */
async function openRequest(tid: number) {
  const [r] = await q(sql`SELECT id, devices, amount_krw, vat_krw, total_krw, created_at
    FROM managed_runner_requests WHERE tenant_id = ${tid} AND status = 'requested' LIMIT 1`);
  return r ?? null;
}

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  try {
    const { planKey, plan } = await tenantPlan(tid);
    const grade = plan.features.managedRunner;              // no | option | included
    const eligible = grade !== "no";
    const unit = managedRunnerUnitKrw(plan);                 // 이 플랜이 **실제로 내는** 계정당 공급가(Agency=0 · 프록시 포함가)
    /* 🔴 화면에 보일 가격은 «못 쓴다»와 «공짜다»를 구분해야 한다 — 둘 다 0원으로 내보내면
       Starter 화면에 «관리형 러너 ₩0» 이 떠서 **공짜처럼 읽힌다**(스모크에서 실제로 그렇게 나왔다).
       못 쓰는 플랜에는 **안내용 정가**(Pro 기준)를 보여 준다 — «Pro 로 바꾸면 계정당 얼마»가 화면의 할 말이다.
       실제 청구는 신청 시점 스냅샷(total_krw)이고 거기엔 언제나 `unit` 이 들어간다(안내가가 새지 않는다). */
    const shownUnit = eligible ? unit : MANAGED_RUNNER_ACCOUNT_KRW;
    const price = { amountKrw: shownUnit, vatKrw: vatOf(shownUnit), totalKrw: shownUnit + vatOf(shownUnit) };
    /* 🔴 상한이 «대수»가 아니라 **계정 수**다(사장님 결정 4). 기기 한도(runnerDevices)로 막으면
       계정 5개를 맡기려는 Pro 고객이 «2대까지»에 걸린다 — 단위가 다른 값으로 막는 것은 버그다. */
    const max = n(plan.limits.maxAccounts) || 1;

    if (req.method === "GET") {
      const assigned = await assignedCount(tid);
      const open = await openRequest(tid);
      // 배정돼 있으면 active · 아니면 신청 중 · 아니면 없음. (신청했는데 배정 전이면 «검토 중»이다)
      const status = assigned > 0 ? "active" : open ? "requested" : "none";
      const out: Record<string, unknown> = { ok: true, eligible, price, status, assigned, max, planKey };
      if (!eligible) out.reason = "지금 요금제에는 관리형 러너가 없어요. Pro 로 바꾸면 신청할 수 있어요.";
      if (grade === "included") out.reason = "Agency 요금제에는 관리형 러너가 포함돼 있어요(추가 요금 없음).";
      // 새 이름으로 내보내되 옛 이름도 함께 둔다(A 화면이 바뀌는 동안 깨지지 않게 · 바뀌면 devices 를 뺀다).
      if (open) { out.accounts = n(open.accounts) || n(open.devices); out.devices = out.accounts; out.requestedAt = utcDate(open.created_at)?.toISOString(); }
      return json(out);
    }

    if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);

    /* 🔴 AC-35 — 가드는 «부수효과를 확인하고 호출 자체를 가른다». 읽기전용·정지 테넌트는 신청 자체를 만들지 않는다. */
    const w = await requireWritable(tid); if (!w.ok) return w.res;
    const feat = await requireFeature(tid, "managedRunner"); if (!feat.ok) return feat.res;   // Starter → 402 plan_feature

    const b = await readJson<{ accounts?: unknown; devices?: unknown; note?: unknown }>(req);
    // 화면이 새 이름(accounts)으로 보내고, 아직 안 바뀐 화면은 옛 이름(devices)으로 보낸다 — 둘 다 받는다.
    const accounts = n(b.accounts) || n(b.devices);
    if (accounts < 1 || accounts > max) {
      return badRequest(`계정 수는 1~${max}개 사이로 골라 주세요(지금 요금제 기준).`, "accounts");
    }
    const assigned = await assignedCount(tid);
    if (assigned >= max) {
      return json({ ok: false, step: "already", error: `이미 ${assigned}개가 배정돼 있어요. 더 필요하면 문의해 주세요.` }, 409);
    }
    const note = String(b.note ?? "").slice(0, 500) || null;
    const totalKrw = (unit + vatOf(unit)) * accounts;

    /* 열린 신청이 있으면 **새로 만들지 않고 고친다**(부분 유니크 인덱스가 중복을 막는다 ·
       운영 목록이 같은 집 신청서로 지저분해지지 않게). */
    const open = await openRequest(tid);
    if (open) {
      await q(sql`UPDATE managed_runner_requests SET accounts = ${accounts}, devices = ${accounts}, plan_key = ${planKey},
          amount_krw = ${unit}, vat_krw = ${vatOf(unit)}, total_krw = ${totalKrw},
          note = COALESCE(${note}, note), updated_at = NOW() WHERE id = ${n(open.id)}`);
    } else {
      await q(sql`INSERT INTO managed_runner_requests (tenant_id, accounts, devices, status, plan_key, amount_krw, vat_krw, total_krw, note, requested_by)
        VALUES (${tid}, ${accounts}, ${accounts}, 'requested', ${planKey}, ${unit}, ${vatOf(unit)}, ${totalKrw}, ${note}, ${n(auth.user.uid)})`);
    }

    // 🔴 감사·알림은 await(계약 §0 — 던지고 잊지 않는다).
    await writeAudit({ tenantId: tid, action: open ? "managed_runner_request_update" : "managed_runner_request",
      actorType: "user", actorId: n(auth.user.uid), target: `tenant:${tid}`,
      detail: { accounts, planKey, amountKrw: unit, totalKrw }, riskLevel: "medium" });
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
      VALUES (${tid}, ${"managed_runner"}, ${"관리형 러너 신청을 받았어요"},
              ${`계정 ${accounts}개 신청이 접수됐어요. 담당이 확인하고 준비되면 알려 드릴게요.`}, ${"/app/runner.html"})`);

    // 옛 이름도 함께(A 화면 전환 중 호환 · 전환되면 devices 를 뺀다).
    return json({ ok: true, status: "requested", accounts, devices: accounts, price, totalKrw });
  } catch (err) {
    return jsonError("managed_runner", err);
  }
};
