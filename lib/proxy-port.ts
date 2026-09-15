/**
 * lib/proxy-port.ts — 🔴 **B ↔ B2 경계**(계약 P1R7 §2.5/§2.6 · 메인 판정 2026-09-15 «IP 배정 API 는 B2 가 정본»).
 *   B 의 계정 슬롯(§3.6)은 IP 를 «어떻게» 고르는지 모른다(재고 우선순위·sticky·공급사 분산은 전부 B2 `lib/proxies.ts` 안).
 *   여기서는 B2 의 결과를 **B 가 읽는 두 가지 상태**로만 접는다:
 *     `{ proxyId }`      = 붙었다(이미 붙어 있던 것도 포함 — B2 의 `already`+proxyId · 운영자가 먼저 붙여 준 경우) → 이제 첫 기간을 받는다
 *     `{ pending:true }` = 아직 없다(B2 `no_stock`) · 계정이 없다 · 모듈 오류 → «IP 준비 중» · 차감 0 · 크론이 매일 다시 묻는다
 *   🔴 `pending` 은 실패가 아니라 **상태**다(B2 머리말 그대로) — 고객은 계정을 샀고 IP 는 우리가 들여오면 된다.
 *   🔴 접속 주소(url_enc)는 여기로 오지 않는다(B2 가 SELECT 에서부터 뺐다) — 응답·감사에 실을 일이 없다.
 *   `bindProxy` 는 스모크·예외 상황에서 구현을 갈아끼우는 용도(publish-port 관례). 평상시엔 정적 결합이 정본.
 */
import { assignProxy as b2Assign, releaseProxy as b2Release } from "./proxies";

export type AssignProxyResult = { proxyId: number; pending?: false } | { pending: true; proxyId?: undefined };
export type AssignProxyFn = (accountId: number) => Promise<AssignProxyResult>;
export type ReleaseProxyFn = (accountId: number) => Promise<void>;
export interface ProxyImpl { assignProxy: AssignProxyFn; releaseProxy: ReleaseProxyFn }

const b2Impl: ProxyImpl = {
  async assignProxy(accountId) {
    const r = await b2Assign(accountId);
    if (r.ok && "proxyId" in r && r.proxyId) return { proxyId: r.proxyId };
    if (!r.ok && r.reason === "already" && r.proxyId) return { proxyId: r.proxyId };   // 운영자가 먼저 붙여 뒀다 — 배정된 것으로 본다(그때 받는다)
    return { pending: true };
  },
  async releaseProxy(accountId) { await b2Release(accountId); },
};
let bound: ProxyImpl = b2Impl;
/** 구현 갈아끼우기(스모크·예외). null 이면 B2 정본으로 되돌린다. */
export function bindProxy(impl: ProxyImpl | null): void { bound = impl ?? b2Impl; }
export function proxyBound(): boolean { return bound === b2Impl; }

/** 계정에 전용 IP 를 붙여 달라. 재고 없음·오류 = pending(정직) · 던지지 않는다. */
export async function assignProxy(accountId: number): Promise<AssignProxyResult> {
  try { return await bound.assignProxy(accountId); }
  catch (e) { console.warn("[proxy-port] assignProxy 실패 — pending 으로", String((e as Error)?.message ?? e).slice(0, 120)); return { pending: true }; }
}
/** 계정의 전용 IP 를 풀로 돌려준다(슬롯 종료). 던지지 않는다. */
export async function releaseProxy(accountId: number): Promise<void> {
  try { await bound.releaseProxy(accountId); }
  catch (e) { console.warn("[proxy-port] releaseProxy 실패", String((e as Error)?.message ?? e).slice(0, 120)); }
}
