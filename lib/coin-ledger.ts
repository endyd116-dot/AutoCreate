/**
 * lib/coin-ledger.ts — 코인 원장(잔액·차감·지급). AM 원본: ../AutoMarketing/lib/coin-ledger.ts §5~§7 (이식·축약 2026-09-14)
 *   가져온 약속 ①잔액 = 원장 합산(잔액 컬럼 없음) ②음수 불가(부족은 명시 실패·throw 0) ③같은 ref consume 1회(재생성·수리 무료)
 *   ④included 우선 소진 → purchased 는 «자동 생성»이면 옵트인(tenants.settings.coinAutoUsePurchased===true)일 때만 · 사람이 누른 생성은 허용.
 *   뺀 것: 플랜 미터링 여부(AC 는 전 테넌트 계량) · 월 포함분 자기치유 · 정지 차단(Phase 4 결제) · 파트너 대행 표식.
 *   멱등 최종 보증 = DB 유니크 coin_ledger_idem(tenant_id,kind,ref,bucket) — 23505 는 «이미 차감됨»으로 ok 처리.
 *   단가 정본 = lib/coin-table.ts(coinCostOf).
 */
import { db } from "../db/index";
import { sql, type SQL } from "drizzle-orm";
import { coinCostOf, COIN_ITEM_LABEL, type CoinItem } from "./coin-table";
import { utcDate } from "./db-util";

export type CoinBucket = "included" | "purchased";
type Exec = { execute: (q: SQL) => Promise<unknown> };
type Row = Record<string, unknown>;
const rows = async (exec: Exec, q: SQL): Promise<Row[]> => (await exec.execute(q)) as unknown as Row[];

/** 테넌트별 advisory lock 네임스페이스('CO') — 동시 차감의 이중 지출 차단. */
export const COIN_LOCK_NS = 0x434f;

export interface CoinBalance { balance: number; included: number; purchased: number }

/** 버킷별 잔액 — SUM(delta) · 만료된 부여 행 제외(음수 행은 만료가 없어 항상 센다). */
async function readBalance(exec: Exec, tid: number): Promise<CoinBalance> {
  const r = await rows(exec, sql`SELECT bucket, COALESCE(SUM(delta),0) AS s FROM coin_ledger
    WHERE tenant_id = ${tid} AND (expires_at IS NULL OR expires_at > NOW()) GROUP BY bucket`);
  let included = 0, purchased = 0;
  for (const x of r) { if (String(x.bucket) === "purchased") purchased = Number(x.s || 0); else included += Number(x.s || 0); }
  included = Math.max(0, included); purchased = Math.max(0, purchased);
  return { balance: included + purchased, included, purchased };
}

/** balance(tid) — 원장 합산(만료 제외). throw 0(실패 시 0). */
export async function balance(tid: number): Promise<CoinBalance> {
  try { return await readBalance(db, tid); } catch (e) { console.error("[coin-ledger] balance", e); return { balance: 0, included: 0, purchased: 0 }; }
}

/** «자동 생성도 충전 코인을 쓸까» 옵트인(tenants.settings.coinAutoUsePurchased). */
export async function autoUsePurchased(tid: number): Promise<boolean> {
  try {
    const r = await rows(db, sql`SELECT settings->>'coinAutoUsePurchased' AS v FROM tenants WHERE id = ${tid}`);
    return String(r[0]?.v ?? "") === "true";
  } catch { return false; }
}

export type ConsumeResult =
  | { ok: true; charged: number; alreadyCharged: boolean; fromIncluded: number; fromPurchased: number; balance: number }
  | { ok: false; reason: "insufficient"; need: number; have: number; charged: 0; balance: number; purchasedBlockedByOptIn: boolean }
  | { ok: false; reason: "write_failed"; charged: 0; balance: number };

export interface ConsumeOpts {
  /** 자동 경로(크론·편성표)면 true — purchased 는 옵트인일 때만. 사람이 누른 생성(디렉터 확정)은 false(기본) → purchased 허용. */
  auto?: boolean;
  /** 명시 오버라이드(테스트·특수). 지정하면 auto 판정을 덮는다. */
  allowPurchased?: boolean;
  reason?: string;
  actorId?: number | null;
}

/**
 * consume(tid, item, ref, opts) — piece 1건 차감. 테넌트 락 안에서 «읽고-판정하고-기입».
 *   같은 (tid,'consume',ref) 가 이미 있으면 charged 0 · ok true(재생성·수리·재시도 무료).
 */
export async function consume(tid: number, item: CoinItem, ref: string, opts: ConsumeOpts = {}): Promise<ConsumeResult> {
  const cost = coinCostOf(item);
  const key = String(ref || "").trim();
  const allowPurchased = typeof opts.allowPurchased === "boolean" ? opts.allowPurchased : (opts.auto ? await autoUsePurchased(tid) : true);
  const label = (opts.reason || COIN_ITEM_LABEL[item] || item).slice(0, 200);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${COIN_LOCK_NS}, ${tid})`);
      if (key) {
        const dup = await rows(tx, sql`SELECT 1 FROM coin_ledger WHERE tenant_id = ${tid} AND kind = 'consume' AND ref = ${key} LIMIT 1`);
        if (dup.length) { const b = await readBalance(tx, tid); return { ok: true, charged: 0, alreadyCharged: true, fromIncluded: 0, fromPurchased: 0, balance: b.balance }; }
      }
      const b = await readBalance(tx, tid);
      if (cost <= 0) return { ok: true, charged: 0, alreadyCharged: false, fromIncluded: 0, fromPurchased: 0, balance: b.balance };
      const fromIncluded = Math.min(b.included, cost);
      const rest = cost - fromIncluded;
      const fromPurchased = allowPurchased ? Math.min(b.purchased, rest) : 0;
      const shortfall = rest - fromPurchased;
      if (shortfall > 0) {
        return { ok: false, reason: "insufficient", need: shortfall, have: allowPurchased ? b.balance : b.included, charged: 0, balance: b.balance, purchasedBlockedByOptIn: !allowPurchased && b.purchased > 0 };
      }
      const ins = async (delta: number, bucket: CoinBucket) => {
        try {
          await tx.execute(sql`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, item, ref, reason, actor_id)
            VALUES (${tid}, ${"consume"}, ${bucket}, ${-delta}, ${item}, ${key || null}, ${label}, ${opts.actorId ?? null})
            ON CONFLICT (tenant_id, kind, ref, bucket) WHERE ref IS NOT NULL DO NOTHING`);
        } catch (e) { if ((e as { code?: string })?.code !== "23505") throw e; }   // 유니크 = 이미 차감(멱등)
      };
      if (fromIncluded > 0) await ins(fromIncluded, "included");
      if (fromPurchased > 0) await ins(fromPurchased, "purchased");
      return { ok: true, charged: cost, alreadyCharged: false, fromIncluded, fromPurchased, balance: b.balance - cost };
    });
  } catch (e) {
    console.error("[coin-ledger] consume failed", tid, key, String((e as Error)?.message ?? e));
    const b = await balance(tid);
    return { ok: false, reason: "write_failed", charged: 0, balance: b.balance };
  }
}

/**
 * grant(tid, coins, reason, actorId, ref?) — 지급(included · 만료 없음). ref 가 있으면 멱등(환급 `refund:piece:{id}`).
 *   반환 = 실제 기입된 코인(멱등 재호출 0).
 */
export async function grant(tid: number, coins: number, reason: string, actorId: number | null = null, ref: string | null = null): Promise<{ ok: boolean; granted: number; balance: number }> {
  const n = Math.max(0, Math.trunc(coins));
  if (!n) { const b = await balance(tid); return { ok: true, granted: 0, balance: b.balance }; }
  try {
    const r = await rows(db, sql`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, ref, reason, actor_id)
      VALUES (${tid}, ${"grant"}, ${"included"}, ${n}, ${ref}, ${String(reason || "지급").slice(0, 200)}, ${actorId})
      ON CONFLICT (tenant_id, kind, ref, bucket) WHERE ref IS NOT NULL DO NOTHING RETURNING id`);
    const b = await balance(tid);
    return { ok: true, granted: r.length ? n : 0, balance: b.balance };
  } catch (e) {
    if ((e as { code?: string })?.code === "23505") { const b = await balance(tid); return { ok: true, granted: 0, balance: b.balance }; }
    console.error("[coin-ledger] grant failed", e);
    const b = await balance(tid);
    return { ok: false, granted: 0, balance: b.balance };
  }
}

/**
 * 환급 — 그 piece 로 나간 consume 합(ref `piece:{id}` · `piece:{id}:img*` · 재생성 `piece:{id}:regen*`) − 이미 환급한 합 = 순액을 grant.
 *   ref = `refund:piece:{id}:c{누적소비}` — 같은 누적 소비에 두 번 환급되지 않는다(멱등) · 재차감 뒤 다시 실패하면 누적이 달라져 새 환급이 된다. 원장 행은 지우지 않는다.
 */
export async function refundPiece(tid: number, pieceId: number): Promise<number> {
  try {
    const [c] = await rows(db, sql`SELECT COALESCE(SUM(-delta),0) AS c FROM coin_ledger
      WHERE tenant_id = ${tid} AND kind = 'consume' AND (ref = ${`piece:${pieceId}`} OR ref LIKE ${`piece:${pieceId}:%`})`);
    const [g] = await rows(db, sql`SELECT COALESCE(SUM(delta),0) AS g FROM coin_ledger
      WHERE tenant_id = ${tid} AND kind = 'grant' AND ref LIKE ${`refund:piece:${pieceId}%`}`);
    const consumed = Number(c?.c || 0), refunded = Number(g?.g || 0);
    const net = consumed - refunded;
    if (net <= 0) return 0;
    const r = await grant(tid, net, `글을 만들지 못해 돌려드린 코인(piece ${pieceId})`, null, `refund:piece:${pieceId}:c${consumed}`);
    return r.granted;
  } catch { return 0; }
}

export interface LedgerRow { kind: string; bucket: string; delta: number; item?: string; reason?: string; ref?: string; createdAt: string }
/** 최근 원장(화면 «최근 사용»). graceful. */
export async function recentLedger(tid: number, limit = 20): Promise<LedgerRow[]> {
  try {
    const r = await rows(db, sql`SELECT kind, bucket, delta, item, reason, ref, created_at FROM coin_ledger WHERE tenant_id = ${tid} ORDER BY id DESC LIMIT ${Math.max(1, Math.min(100, limit))}`);
    return r.map((x) => {
      const o: LedgerRow = { kind: String(x.kind), bucket: String(x.bucket), delta: Number(x.delta || 0), createdAt: utcDate(x.created_at)?.toISOString() || "" };
      if (x.item) o.item = String(x.item);
      if (x.reason) o.reason = String(x.reason);
      if (x.ref) o.ref = String(x.ref);
      return o;
    });
  } catch { return []; }
}
