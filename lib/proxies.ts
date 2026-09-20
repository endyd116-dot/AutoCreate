/**
 * lib/proxies.ts — 계정 ↔ 전용 IP 배정(계약 P1R7 §2.5-② · 사장님 지시 «계정 하나 = IP 하나»).
 *
 *   🔴 이 파일이 지키는 불변식 하나: **프록시 1개는 계정 1개에만 붙는다.**
 *      DB 유일 인덱스(`accounts_proxy_uniq` · 0015)가 최종 방어선이고, 여기 코드는 그 앞에서 고른다.
 *      둘이 한 IP 를 쓰면 그게 곧 사장님이 걱정한 **연좌제**다 — 편의를 위해 이걸 느슨하게 하지 않는다.
 *
 *   🔴 **재고가 없으면 «준비 중»이다 — 없는 IP 를 있는 척 배정하지 않는다**(AC-9).
 *      B 의 §3.6(계정 슬롯 코인 구매)이 이 반환을 보고 «IP 준비 중» 상태로 두고 **배정될 때 차감**한다.
 *      그래서 `{ pending:true }` 는 실패가 아니라 **상태**다 — 호출부가 그렇게 읽어야 한다.
 *
 *   접속 주소(`url_enc`)는 계정 자격과 같은 취급이다 — 이 파일은 **복호화하지 않는다**.
 *   푸는 자리는 러너 claim 한 곳뿐(`lib/runner-jobs.ts loadAccountForRunner`).
 *   🔎 출처: AC 신규(계약 AC-53 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/index";
import { writeAudit } from "./audit";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

export type AssignResult =
  | { ok: true; proxyId: number; label: string }
  | { ok: true; pending: true; reason: "no_stock"; message: string }
  | { ok: false; reason: "account_not_found" | "already"; message: string; proxyId?: number };

/**
 * 계정 하나에 쓸 수 있는 프록시를 골라 붙인다.
 *
 *   고르는 순서(재고 우선순위):
 *     ① **sticky 보장**이 있는 것 먼저 — 없으면 IP 가 바뀌어 계정-IP 1:1 이 깨진다(이 기능의 존재 이유가 사라진다).
 *     ② **같은 공급사에 몰리지 않게** — 한 공급사가 막히면 전부 같이 죽는다. 덜 쓴 공급사부터.
 *     ③ **만료가 먼 것** 먼저 — 곧 끝나는 IP 를 새 계정에 붙이면 며칠 뒤 또 옮겨야 한다.
 *   🔴 `status='active'` 이고 **아직 아무 계정도 안 쓴 것**만 후보다.
 */
export async function assignProxy(accountId: number, opts: { tenantId?: number; proxyId?: number } = {}): Promise<AssignResult> {
  const [acc] = await q(sql`SELECT id, tenant_id, handle, proxy_id FROM accounts WHERE id = ${accountId} LIMIT 1`);
  if (!acc) return { ok: false, reason: "account_not_found", message: "계정을 찾을 수 없어요." };
  if (n(acc.proxy_id)) return { ok: false, reason: "already", message: "이 계정에는 이미 전용 IP 가 붙어 있어요.", proxyId: n(acc.proxy_id) };
  const tid = n(opts.tenantId) || n(acc.tenant_id);

  /* 지정 배정(운영자가 특정 IP 를 고른 경우)과 자동 배정을 한 질의로 가른다.
     🔴 `NOT EXISTS(... accounts.proxy_id = p.id)` 가 «아직 아무도 안 쓰는 것» 조건 — 유일 인덱스와 같은 뜻을 앞에서 본다. */
  const want = n(opts.proxyId);
  const cands = await q(sql`
    SELECT p.id, p.label, p.provider, p.sticky_guaranteed, p.expires_at
      FROM proxies p
     WHERE p.status = 'active'
       AND (p.tenant_id IS NULL OR p.tenant_id = ${tid})
       AND (p.expires_at IS NULL OR p.expires_at > NOW())
       AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.proxy_id = p.id)
       ${want ? sql`AND p.id = ${want}` : sql``}
     ORDER BY p.sticky_guaranteed DESC,
              (SELECT COUNT(*) FROM proxies p2 JOIN accounts a2 ON a2.proxy_id = p2.id WHERE p2.provider = p.provider) ASC,
              p.expires_at DESC NULLS FIRST,
              p.id
     LIMIT 1`);

  if (!cands.length) {
    /* 🔴 «없다»를 «실패»로 만들지 않는다 — 고객은 계정을 샀고, IP 는 우리가 들여오면 된다.
       B 의 코인 차감이 이 상태를 보고 «배정될 때 차감»으로 미룬다. */
    await writeAudit({
      tenantId: tid, action: "proxy_out_of_stock", actorType: "system", riskLevel: "medium",
      target: `account:${accountId}`, detail: { handle: String(acc.handle ?? ""), requested: want || null },
    });
    return { ok: true, pending: true, reason: "no_stock", message: "전용 IP 를 준비하고 있어요. 준비되면 바로 붙여 드릴게요." };
  }

  const p = cands[0];
  /* 🔴 마지막 방어선은 DB 다 — `WHERE proxy_id IS NULL` 을 걸어 **경쟁 상태에서 두 계정이 한 IP 를 잡는 것**을 막는다.
     (고른 뒤 붙이기까지 사이에 다른 요청이 같은 IP 를 가져갈 수 있다. 0건이면 재고가 방금 나간 것이다.) */
  const done = await q(sql`UPDATE accounts SET proxy_id = ${n(p.id)}, updated_at = NOW()
    WHERE id = ${accountId} AND proxy_id IS NULL RETURNING id`);
  if (!done.length) return { ok: false, reason: "already", message: "방금 다른 IP 가 붙었어요. 다시 확인해 주세요." };

  await writeAudit({
    tenantId: tid, action: "proxy_assigned", actorType: "system", riskLevel: "low",
    target: `account:${accountId}`, detail: { proxyId: n(p.id), label: String(p.label ?? ""), provider: String(p.provider ?? ""), sticky: p.sticky_guaranteed === true },
  });
  return { ok: true, proxyId: n(p.id), label: String(p.label ?? "") };
}

/**
 * 계정에서 프록시를 뗀다(계정 삭제·해지·교체).
 *   🔴 뗀 IP 는 **바로 다른 계정에 주지 않는다** — 그 IP 에는 앞 계정의 흔적이 남아 있고,
 *      플랫폼이 «같은 IP 에서 계정이 바뀌었다»를 보면 그게 또 신호가 된다.
 *      그래서 `status='active'` 는 유지하되 **마지막 사용 시각을 남겨** 운영이 식힐 수 있게 한다.
 */
export async function releaseProxy(accountId: number): Promise<{ ok: boolean; proxyId?: number }> {
  const [acc] = await q(sql`SELECT id, tenant_id, proxy_id FROM accounts WHERE id = ${accountId} LIMIT 1`);
  const proxyId = n(acc?.proxy_id);
  if (!acc || !proxyId) return { ok: false };
  await q(sql`UPDATE accounts SET proxy_id = NULL, last_exit_ip = NULL, last_exit_ip_at = NULL, updated_at = NOW() WHERE id = ${accountId}`);
  await q(sql`UPDATE proxies SET note = COALESCE(note, '') || ${`\n[${new Date().toISOString().slice(0, 10)}] 계정 ${accountId} 에서 해제 — 다른 계정에 주기 전에 식히세요`}, updated_at = NOW() WHERE id = ${proxyId}`);
  await writeAudit({
    tenantId: n(acc.tenant_id), action: "proxy_released", actorType: "system", riskLevel: "low",
    target: `account:${accountId}`, detail: { proxyId, note: "뗀 IP 는 바로 재배정하지 않는다(앞 계정 흔적)" },
  });
  return { ok: true, proxyId };
}

/**
 * 🔴 **fail-closed 로 멈춰 선 계정** — «막았다»가 아니라 **«길이 없어 못 갔다»**를 센다(DESIGN §7.3b).
 *
 *   막지 않는 대신 **말해 주기로** 간 이상(CLAUDE §9), 멈춘 것이 **아무에게도 안 보이면 그게 제일 나쁘다**.
 *   `claimJobs` 가 잡을 큐에 되돌리면서 `runner_jobs.error_kind` 에 까닭을 적어 두는데, 이 함수가 그걸 걷는다.
 *   🔴 **계정 이름·테넌트 이름까지 같이 준다** — 운영 화면이 «계정 231» 이라고 쓰게 두지 않는다(CLAUDE §3 시스템 용어 금지).
 *   🔴 `waitingSlots` 는 **아직 잡도 못 만든 쪽**이다 — 계정 슬롯은 샀는데 IP 재고가 없어 `waiting_ip` 로 선 것.
 *      잡 기준만 세면 «한 번도 안 돌아 본 계정»이 통째로 안 보인다(AC-9 «못 쟀음»과 «0»은 다르다).
 */
export async function proxyStopped(limit = 50): Promise<{
  count: number; jobs: number;
  accounts: { accountId: number; handle: string; channel: string; tenantId: number; tenantName: string; reason: string; waiting: number; since: string | null }[];
  waitingSlots: number;
}> {
  const lim = Math.max(1, Math.min(200, Math.floor(limit) || 50));
  const rows = await q(sql`
    SELECT a.id, a.handle, a.channel, a.tenant_id, t.name AS tenant_name,
           MIN(j.error_kind) AS reason, COUNT(*)::int AS waiting, MIN(j.updated_at) AS since
      FROM runner_jobs j
      JOIN accounts a ON a.id = j.account_id
      LEFT JOIN tenants t ON t.id = a.tenant_id
     WHERE j.status = 'queued'
       AND j.error_kind IN ('no_proxy', 'proxy_down', 'proxy_expired', 'proxy_decrypt_failed')
     GROUP BY a.id, a.handle, a.channel, a.tenant_id, t.name
     ORDER BY MIN(j.updated_at) LIMIT ${lim}`);
  const [w] = await q(sql`SELECT COUNT(*)::int AS c FROM account_slots WHERE status = 'waiting_ip'`);
  return {
    count: rows.length,
    jobs: rows.reduce((a, r) => a + n(r.waiting), 0),
    accounts: rows.map((r) => ({
      accountId: n(r.id), handle: String(r.handle ?? ""), channel: String(r.channel ?? ""),
      tenantId: n(r.tenant_id), tenantName: String(r.tenant_name ?? ""),
      reason: String(r.reason ?? "no_proxy"), waiting: n(r.waiting),
      since: r.since instanceof Date ? r.since.toISOString() : (r.since ? new Date(String(r.since) + "Z").toISOString() : null),
    })),
    waitingSlots: n(w?.c),
  };
}

/** 지금 재고 — 운영 화면·«준비 중» 판정용. 🔴 접속 주소는 세지도 내보내지도 않는다. */
export async function proxyStock(tenantId?: number): Promise<{ free: number; assigned: number; down: number }> {
  const tid = n(tenantId);
  const [r] = await q(sql`SELECT
      COUNT(*) FILTER (WHERE p.status = 'active' AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.proxy_id = p.id))::int AS free,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM accounts a WHERE a.proxy_id = p.id))::int AS assigned,
      COUNT(*) FILTER (WHERE p.status <> 'active')::int AS down
    FROM proxies p WHERE ${tid ? sql`(p.tenant_id IS NULL OR p.tenant_id = ${tid})` : sql`TRUE`}`);
  return { free: n(r?.free), assigned: n(r?.assigned), down: n(r?.down) };
}
