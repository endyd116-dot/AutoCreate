/**
 * lib/account-close.ts — 탈퇴 예약 · 되돌리기 · 개인정보 파기(계약 P1R7 §3.1 · DESIGN §16 · 전수조사 상위 16).
 *
 *   ══ 3단 ══
 *     ① `closeAccount(tid)` — 지금 바로 `readonly`(열람 O · 생성/발행 X · `requireWritable` 가 막는다) + `purge_at = now + 30일`.
 *        30일은 **되돌릴 수 있는 창**이다(«그 전엔 되돌릴 수 있어요»). 구독이 살아 있으면 먼저 해지하게 한다(돈이 계속 나가면 안 된다).
 *     ② `restoreAccount(tid)` — 기한 전이면 직전 상태로 되돌린다(`close_prev_status`).
 *     ③ `purgeTenant(tid)` — 크론 `tenant.purge` 가 기한 지난 곳에만. DB 행 + R2 `autocreate/{tid}/` 삭제 · 감사 1행(내용 없이 tid·행 수만).
 *
 *   ══ 무엇을 남기나(법정 보존) ══
 *     · `invoices` — 전자상거래법 제6조(대금 결제·재화 공급 기록 **5년**)·부가세법 증빙. 대신 **개인 식별자는 지운다**(tax_biz 마스킹 · detail 정리).
 *     · `ai_usage` — 원가 이력(테넌트 식별자 외 개인정보 없음 · 대청소 스크립트와 같은 판단).
 *     · `tenants` 1행 = **묘비**(status `purged` · 이름/키 마스킹). 지우면 위 보존분의 FK 가 끊긴다.
 *     나머지 테넌트 데이터(계정·자격·글·슬롯·원장·티켓·감사…)는 **전부 삭제**한다.
 *
 *   🔴 안전장치(B2 teardown 방식 그대로 · 순서까지 같다): ①보호 id 먼저 거부 ②상태 확인(기한·구독) ③실행.
 *   🔴 `purgeTenant` 는 «기한이 지났다»를 **자기가 다시 확인한다** — 부르는 쪽 실수로 살아 있는 집이 지워지지 않게.
 *   🔎 출처: AC 신규(계약 P1R7-B §3 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { sql, type SQL } from "drizzle-orm";
import { q } from "./accounts";
import { writeAudit } from "./audit";
import { utcDate } from "./db-util";
import { r2DeletePrefix } from "./r2";

const n = (v: unknown) => Number(v || 0);
export const CLOSE_GRACE_DAYS = 30;
/** 🔴 절대 파기하지 않는 집(보존 4집 + 사장님 계정 198) — id 검사가 **가장 먼저**다(패턴·상태보다 앞). */
export const PROTECTED_TENANT_IDS: readonly number[] = [3, 13, 109, 116, 198];
/** 파기해도 남기는 표(법정 보존·원가 이력). 여기 없는 테넌트 표는 전부 지운다. */
export const PURGE_KEEP_TABLES: readonly string[] = ["tenants", "invoices", "ai_usage"];

export type CloseFail = "protected" | "already" | "subscription" | "not_found";
export interface CloseResult { ok: boolean; reason?: CloseFail; error?: string; closedAt?: string; purgeAt?: string; prevStatus?: string }

/** 지금 살아 있는 유료 구독인가(해지 예약은 «살아 있음»이 아니다 — 기간 끝까지 쓰고 끝난다). */
async function liveSubscription(tid: number): Promise<{ live: boolean; nextBillingAt: string | null }> {
  const [s] = await q(sql`SELECT status, cancel_at_period_end, next_billing_at FROM subscriptions WHERE tenant_id = ${tid}`);
  if (!s) return { live: false, nextBillingAt: null };
  const live = String(s.status) === "active" && s.cancel_at_period_end !== true && !!s.next_billing_at;
  return { live, nextBillingAt: utcDate(s.next_billing_at)?.toISOString() ?? null };
}

/** ① 탈퇴 신청 — readonly + 30일 뒤 파기 예약. 이미 신청했으면 그대로 돌려준다(멱등). */
export async function closeAccount(tid: number, opts: { reason?: string; actorId?: number | null; ip?: string | null } = {}): Promise<CloseResult> {
  if (PROTECTED_TENANT_IDS.includes(tid)) return { ok: false, reason: "protected", error: "이 계정은 탈퇴할 수 없어요. 운영팀에 문의해 주세요." };
  const [t] = await q(sql`SELECT id, status, closed_at, purge_at, close_prev_status FROM tenants WHERE id = ${tid}`);
  if (!t) return { ok: false, reason: "not_found", error: "계정을 찾을 수 없어요." };
  if (t.closed_at) return { ok: true, reason: "already", closedAt: utcDate(t.closed_at)?.toISOString(), purgeAt: utcDate(t.purge_at)?.toISOString(), prevStatus: t.close_prev_status ? String(t.close_prev_status) : undefined };
  const sub = await liveSubscription(tid);
  if (sub.live) return { ok: false, reason: "subscription", error: "구독이 아직 살아 있어요. 요금제 화면에서 해지한 뒤에 탈퇴해 주세요." };
  const prev = String(t.status ?? "trial");
  const reason = String(opts.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null;
  const [u] = await q(sql`UPDATE tenants SET status = ${"readonly"}, readonly_at = COALESCE(readonly_at, NOW()), closed_at = NOW(), close_reason = ${reason},
      close_prev_status = ${prev}, purge_at = NOW() + make_interval(days => ${CLOSE_GRACE_DAYS}), updated_at = NOW()
    WHERE id = ${tid} AND closed_at IS NULL RETURNING closed_at, purge_at`);
  if (!u) return await closeAccount(tid, opts);   // 동시에 두 번 눌렀다 — 위의 already 경로로 다시 읽는다
  const closedAt = utcDate(u.closed_at)?.toISOString(), purgeAt = utcDate(u.purge_at)?.toISOString();
  await writeAudit({ tenantId: tid, action: "account_close", actorType: "user", actorId: opts.actorId ?? null, ip: opts.ip ?? null, riskLevel: "high", detail: { prevStatus: prev, purgeAt, graceDays: CLOSE_GRACE_DAYS, reason } });
  await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"account_closing"}, ${"탈퇴가 접수됐어요"},
    ${`${CLOSE_GRACE_DAYS}일 뒤에 데이터가 지워져요. 그 전에는 «되돌리기»로 그대로 돌아올 수 있어요. 지금은 보기만 할 수 있어요.`}, ${"/app/settings.html"})`);
  return { ok: true, closedAt, purgeAt, prevStatus: prev };
}

/** ② 되돌리기 — 파기 전이면 직전 상태로. 이미 파기됐으면 되돌릴 수 없다(정직). */
export async function restoreAccount(tid: number, opts: { actorId?: number | null; ip?: string | null } = {}): Promise<{ ok: boolean; status?: string; error?: string; step?: string }> {
  const [t] = await q(sql`SELECT id, status, closed_at, purged_at, close_prev_status FROM tenants WHERE id = ${tid}`);
  if (!t) return { ok: false, step: "not_found", error: "계정을 찾을 수 없어요." };
  if (t.purged_at) return { ok: false, step: "purged", error: "이미 파기된 계정이라 되돌릴 수 없어요." };
  if (!t.closed_at) return { ok: true, status: String(t.status) };   // 탈퇴 상태가 아니다 — 아무 일도 없었던 것처럼
  const prev = String(t.close_prev_status ?? "readonly");
  const back = prev === "purged" ? "readonly" : prev;
  await q(sql`UPDATE tenants SET status = ${back}, readonly_at = ${back === "readonly" ? sql`readonly_at` : sql`NULL`}, closed_at = NULL, close_reason = NULL,
    close_prev_status = NULL, purge_at = NULL, updated_at = NOW() WHERE id = ${tid}`);
  await writeAudit({ tenantId: tid, action: "account_restore", actorType: "user", actorId: opts.actorId ?? null, ip: opts.ip ?? null, riskLevel: "high", detail: { restoredTo: back } });
  await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"account_restored"}, ${"탈퇴를 되돌렸어요"}, ${"데이터는 그대로예요. 하던 대로 쓰시면 돼요."}, ${"/app/index.html"})`);
  return { ok: true, status: back };
}

/* ───────── ③ 파기 ───────── */
export interface PurgeResult { ok: boolean; tid: number; reason?: "protected" | "not_due" | "not_found" | "subscription"; rows?: number; tables?: Record<string, number>; r2?: { listed: number; deleted: number; failed: number }; error?: string }

/** tenant_id 칸이 있는 표(보존 표 제외) — 표 이름은 information_schema 에서 읽는다(새 표가 생겨도 자동으로 따라간다). */
async function tenantTables(): Promise<string[]> {
  const rows = await q(sql`SELECT DISTINCT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id' AND table_name NOT IN (${sql.join(PURGE_KEEP_TABLES.map((t) => sql`${t}`), sql`, `)}) ORDER BY table_name`);
  return rows.map((r) => String(r.table_name));
}
/** tenant_id 가 없이 FK 로만 매달린 자식(ticket_messages 등) — 부모의 id 서브쿼리로 먼저 지운다. */
async function orphanChildren(parents: Set<string>): Promise<{ child: string; col: string; parent: string; pcol: string }[]> {
  const fks = await q(sql`SELECT tc.table_name AS child, kcu.column_name AS col, ccu.table_name AS parent, ccu.column_name AS pcol
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`);
  return fks.filter((f) => parents.has(String(f.parent)) && !parents.has(String(f.child)) && !PURGE_KEEP_TABLES.includes(String(f.child)))
    .map((f) => ({ child: String(f.child), col: String(f.col), parent: String(f.parent), pcol: String(f.pcol) }));
}

/**
 * purgeTenant — 개인정보 파기. **기한을 자기가 다시 확인한다**(force 는 검증용).
 *   순서: ①보호 id 거부 ②기한·구독 확인 ③자식(고아) → 테넌트 표 → R2 ④보존분 마스킹 + 묘비 ⑤감사 1행(행 수만).
 */
export async function purgeTenant(tid: number, opts: { force?: boolean; dryRun?: boolean; now?: Date } = {}): Promise<PurgeResult> {
  if (PROTECTED_TENANT_IDS.includes(tid)) return { ok: false, tid, reason: "protected", error: "보호 테넌트는 파기하지 않아요." };
  const [t] = await q(sql`SELECT id, key, name, status, closed_at, purge_at, purged_at FROM tenants WHERE id = ${tid}`);
  if (!t) return { ok: false, tid, reason: "not_found" };
  if (t.purged_at) return { ok: true, tid, rows: 0, tables: {}, r2: { listed: 0, deleted: 0, failed: 0 } };   // 이미 파기(멱등)
  const due = utcDate(t.purge_at);
  if (!opts.force && (!t.closed_at || !due || due.getTime() > (opts.now ?? new Date()).getTime())) return { ok: false, tid, reason: "not_due" };
  const sub = await liveSubscription(tid);
  if (sub.live) return { ok: false, tid, reason: "subscription", error: "구독이 살아 있어 파기하지 않았어요." };

  const tables = await tenantTables();
  const parents = new Set([...tables, "tenants"]);
  const counted: Record<string, number> = {};
  let rows = 0;
  if (opts.dryRun) {
    for (const tb of tables) {
      try { const [c] = await q(sql`SELECT COUNT(*)::int AS c FROM ${sql.identifier(tb)} WHERE tenant_id = ${tid}`); if (n(c?.c)) { counted[tb] = n(c.c); rows += n(c.c); } } catch { /* 셀 수 없으면 건너뛴다 */ }
    }
    const r2 = await r2DeletePrefix(`autocreate/${tid}/`, { dryRun: true });
    return { ok: true, tid, rows, tables: counted, r2: { listed: r2.listed, deleted: 0, failed: 0 } };
  }

  // ③-a 고아 자식(ticket_messages 등) 먼저 — 손자까지 2단.
  const orphans = await orphanChildren(parents);
  for (const f of orphans) {
    const inParent: SQL = sql`SELECT ${sql.identifier(f.pcol)} FROM ${sql.identifier(f.parent)} WHERE tenant_id = ${tid}`;
    const grand = orphans.filter((g) => g.parent === f.child);
    for (const g of grand) {
      try { await q(sql`DELETE FROM ${sql.identifier(g.child)} WHERE ${sql.identifier(g.col)} IN (SELECT ${sql.identifier(g.pcol)} FROM ${sql.identifier(f.child)} WHERE ${sql.identifier(f.col)} IN (${inParent}))`); } catch { /* 다음 패스에서 */ }
    }
    try {
      const del = await q(sql`DELETE FROM ${sql.identifier(f.child)} WHERE ${sql.identifier(f.col)} IN (${inParent}) RETURNING 1 AS x`);
      if (del.length) { counted[f.child] = (counted[f.child] ?? 0) + del.length; rows += del.length; }
    } catch { /* 아래 본 삭제에서 FK 가 풀리면 다시 시도된다 */ }
  }
  // ③-b 테넌트 표 — FK 순서를 모르니 «되는 것부터» 4패스(대청소 스크립트와 같은 방식).
  let left = [...tables];
  for (let pass = 0; pass < 4 && left.length; pass++) {
    const next: string[] = [];
    for (const tb of left) {
      try {
        const del = await q(sql`DELETE FROM ${sql.identifier(tb)} WHERE tenant_id = ${tid} RETURNING 1 AS x`);
        if (del.length) { counted[tb] = (counted[tb] ?? 0) + del.length; rows += del.length; }
      } catch { next.push(tb); }
    }
    left = next;
  }
  // ③-c R2(글·이미지·영상·내보내기 ZIP) — 접두는 `autocreate/{tid}/` 꼴만 받는다(r2.ts 가 거부한다).
  let r2 = { listed: 0, deleted: 0, failed: 0 };
  try { const d = await r2DeletePrefix(`autocreate/${tid}/`); r2 = { listed: d.listed, deleted: d.deleted, failed: d.failed }; }
  catch (e) { console.error("[purge] R2 삭제 실패", tid, String((e as Error)?.message ?? e).slice(0, 200)); }

  // ④ 보존분 마스킹 + 묘비. invoices 는 금액·기간·주문번호만 남기고 사람 정보를 지운다.
  await q(sql`UPDATE invoices SET tax_biz = NULL, detail = COALESCE(detail, '{}'::jsonb) - 'taxDoc' - 'email' - 'buyer', updated_at = NOW() WHERE tenant_id = ${tid}`);
  await q(sql`UPDATE tenants SET status = ${"purged"}, name = ${"탈퇴한 계정"}, key = ${`purged-${tid}`}, settings = '{}'::jsonb, ops_note = NULL,
    close_reason = NULL, referral_code = NULL, trial_fp = NULL, purged_at = NOW(), updated_at = NOW() WHERE id = ${tid}`);
  // ⑤ 감사 1행 — 🔴 내용은 없다(tid · 표별 행 수 · R2 수만). 지운 데이터를 감사에 옮겨 적지 않는다.
  await writeAudit({ tenantId: tid, action: "tenant_purged", actorType: "system", riskLevel: "high", target: `tenant:${tid}`,
    detail: { rows, tables: counted, r2, leftTables: left.length ? left : undefined, kept: PURGE_KEEP_TABLES } });
  if (left.length) console.error("[purge] 못 지운 표", tid, left.join(","));
  return { ok: true, tid, rows, tables: counted, r2 };
}

/** 파기 기한이 지난 테넌트(보호 id 제외 · 이미 파기된 곳 제외). 크론이 하루 1번 읽는다. */
export async function duePurgeTenants(limit = 20): Promise<number[]> {
  const rows = await q(sql`SELECT id FROM tenants WHERE purge_at IS NOT NULL AND purged_at IS NULL AND purge_at <= NOW()
    AND id NOT IN (${sql.join(PROTECTED_TENANT_IDS.map((i) => sql`${i}`), sql`, `)}) ORDER BY purge_at LIMIT ${Math.max(1, Math.min(100, limit))}`);
  return rows.map((r) => n(r.id));
}
/** 고객 화면이 읽는 탈퇴 상태(설정 화면 «탈퇴» 줄). */
export async function closeStateOf(tid: number): Promise<{ closed: boolean; closedAt?: string; purgeAt?: string; daysLeft?: number; graceDays: number }> {
  const [t] = await q(sql`SELECT closed_at, purge_at FROM tenants WHERE id = ${tid}`);
  const closedAt = utcDate(t?.closed_at), purgeAt = utcDate(t?.purge_at);
  if (!closedAt || !purgeAt) return { closed: false, graceDays: CLOSE_GRACE_DAYS };
  return { closed: true, closedAt: closedAt.toISOString(), purgeAt: purgeAt.toISOString(), daysLeft: Math.max(0, Math.ceil((purgeAt.getTime() - Date.now()) / 86400_000)), graceDays: CLOSE_GRACE_DAYS };
}
