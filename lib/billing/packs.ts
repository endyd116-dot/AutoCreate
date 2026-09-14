/**
 * lib/billing/packs.ts — 코인 팩·단가표 **DB 오버레이**(계약 §1.1 · §2.1 ops-plans · DESIGN §11.4 요금제) + 주문번호 규약 + 부가세.
 *   코드 기본값 = `lib/coin-table.ts`(AM 과 동일 · 변경 0) · 운영센터가 `coin_price_overrides` 에 덮어쓴 값이 이긴다(60초 캐시 · graceful).
 *   🔴 AC-6: 오버레이는 **모양이 같을 때만** 받는다(pack = {krw,coins,bonusPct,oncePerTenant,active} · item = {coins} · 숫자 아닌 값은 무시).
 *   주문번호: `AC-COIN-{tid}-{packCode}-{base36ms}`(≤40자 · 콜백에 세션이 없어 되파싱한다 · AM 의 `AM-COIN-` 규약 이식 · 접두만 AC).
 *   부가세(§12.0 별도): 팩 가격 = 공급가 · 청구 = 공급가 + vatOf. 응답엔 krw·vatKrw·totalKrw 를 따로.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { vatOf } from "../billing-math";
import { COIN_PACKS, COIN_TABLE, type CoinItem, type CoinPackId } from "../coin-table";

const n = (v: unknown) => Number(v || 0);
export interface CoinPack { id: string; krw: number; coins: number; bonusPct: number; oncePerTenant: boolean; active: boolean }
export interface CoinPackView extends CoinPack { vatKrw: number; totalKrw: number }

let cache: { at: number; packs: CoinPack[]; table: Record<string, number> } | null = null;
const TTL = 60_000;

/** 오버레이 적용 팩·단가(캐시 60초). 조회 실패 = 코드 기본값. */
export async function loadPacksAndTable(force = false): Promise<{ packs: CoinPack[]; table: Record<string, number> }> {
  if (!force && cache && Date.now() - cache.at < TTL) return { packs: cache.packs, table: cache.table };
  const packs: CoinPack[] = COIN_PACKS.map((p) => ({ id: p.id, krw: p.krw, coins: p.coins, bonusPct: p.bonusPct, oncePerTenant: p.oncePerTenant, active: true }));
  const table: Record<string, number> = { ...COIN_TABLE };
  try {
    const rows = await q(sql`SELECT key, kind, value, active FROM coin_price_overrides`);
    for (const r of rows) {
      const v = (r.value && typeof r.value === "object" && !Array.isArray(r.value) ? r.value : null) as Record<string, unknown> | null;
      if (!v) continue;   // AC-6: 모양이 다르면 무시
      const key = String(r.key);
      if (String(r.kind) === "pack" && key.startsWith("pack:")) {
        const id = key.slice(5); const i = packs.findIndex((p) => p.id === id);
        const patch: Partial<CoinPack> = {};
        if (Number.isFinite(n(v.krw)) && n(v.krw) > 0) patch.krw = Math.floor(n(v.krw));
        if (Number.isFinite(n(v.coins)) && n(v.coins) > 0) patch.coins = Math.floor(n(v.coins));
        if (Number.isFinite(n(v.bonusPct))) patch.bonusPct = Math.max(0, Math.floor(n(v.bonusPct)));
        if (typeof v.oncePerTenant === "boolean") patch.oncePerTenant = v.oncePerTenant;
        patch.active = r.active !== false && v.active !== false;
        if (i >= 0) packs[i] = { ...packs[i], ...patch };
        else if (patch.krw && patch.coins) packs.push({ id, krw: patch.krw, coins: patch.coins, bonusPct: patch.bonusPct ?? 0, oncePerTenant: patch.oncePerTenant ?? false, active: patch.active ?? true });
      } else if (String(r.kind) === "item" && key.startsWith("item:")) {
        const item = key.slice(5); const coins = n(v.coins);
        if (item in COIN_TABLE && Number.isFinite(coins) && coins >= 0 && r.active !== false) table[item] = Math.floor(coins);
      }
    }
  } catch (e) { console.warn("[billing/packs] 오버레이 읽기 실패 — 코드 기본값", String((e as Error)?.message ?? e).slice(0, 100)); }
  cache = { at: Date.now(), packs, table };
  return { packs, table };
}
export function invalidatePackCache(): void { cache = null; }

export function packView(p: CoinPack): CoinPackView { const vatKrw = vatOf(p.krw); return { ...p, vatKrw, totalKrw: p.krw + vatKrw }; }
export async function findPack(packId: unknown): Promise<CoinPack | null> {
  const { packs } = await loadPacksAndTable();
  return packs.find((p) => p.id === String(packId ?? "") && p.active) ?? null;
}
/** 오버레이 적용 단가(코인 소비 게이트가 쓰면 운영센터 수정이 즉시 반영). */
export async function coinCostOverlay(item: CoinItem): Promise<number> { const { table } = await loadPacksAndTable(); return table[item] ?? COIN_TABLE[item] ?? 0; }

/* ───────── 주문번호 ───────── */
/** 팩 id → 주문번호용 짧은 코드('pack_50k' → '50k' · 'pack_trial' → 'trial'). 주문번호에 '_' 를 넣지 않기 위한 축약. */
export function packCodeOf(packId: string): string { return String(packId).replace(/^pack_/, "").replace(/[^0-9a-z]/gi, "").toLowerCase() || "x"; }
export function packIdOfCode(code: string): CoinPackId | string { return `pack_${code}`; }
export function coinOrderNo(tid: number, packId: string, nowMs = Date.now()): string { return `AC-COIN-${tid}-${packCodeOf(packId)}-${nowMs.toString(36)}`.slice(0, 40); }
/** 주문번호 되파싱(콜백엔 세션이 없다). 실패 = null. */
export function parseCoinOrderNo(orderNo: string): { tenantId: number; packCode: string } | null {
  const m = /^AC-COIN-(\d{1,12})-([0-9a-z]+)-([0-9a-z]+)$/.exec(String(orderNo ?? "").trim());
  return m ? { tenantId: Number(m[1]), packCode: m[2] } : null;
}
export function isCoinOrderNo(v: unknown): boolean { return /^AC-COIN-/.test(String(v ?? "")); }
