/**
 * lib/proxy-port.ts — 🔴 **B ↔ B2 경계**(계약 P1R7 §2.5/§2.6 · 메인 판정 2026-09-15 «IP 배정 API 는 B2 가 정본»).
 *   B 의 계정 슬롯(§3.6)은 IP 를 «어떻게» 고르는지 모른다. 아는 것은 두 함수뿐이다(이름·모양은 메인이 정했다):
 *     `assignProxy(accountId) → { proxyId } | { pending:true }` · `releaseProxy(accountId)`
 *   B2 의 `lib/proxies.ts` 가 머지되면 아래 `bindProxy` 자리에 정적 import 한 줄로 꿴다(publish-port 와 같은 관례 —
 *   «변수 지정자 동적 import» 는 esbuild 번들에 안 담기므로 쓰지 않는다 · AC-11).
 *   🔴 미연결 상태의 정직한 답 = **`{ pending:true }`**(«IP 준비 중») — 슬롯은 만들어지되 코인은 배정되는 날 빠진다. 거짓으로 배정됐다고 하지 않는다.
 */
export type AssignProxyResult = { proxyId: number; pending?: false } | { pending: true; proxyId?: undefined };
export type AssignProxyFn = (accountId: number) => Promise<AssignProxyResult>;
export type ReleaseProxyFn = (accountId: number) => Promise<void>;
export interface ProxyImpl { assignProxy: AssignProxyFn; releaseProxy: ReleaseProxyFn }

let bound: ProxyImpl | null = null;
/** B2 구현 꿰기(머지 후 정적 import 로 · 스모크는 목 구현). null 이면 미연결(pending). */
export function bindProxy(impl: ProxyImpl | null): void { bound = impl; }
export function proxyBound(): boolean { return !!bound; }

/** 계정에 전용 IP 를 붙여 달라. 미연결·재고 없음 = pending(정직) · 던지지 않는다. */
export async function assignProxy(accountId: number): Promise<AssignProxyResult> {
  if (!bound) return { pending: true };
  try { return await bound.assignProxy(accountId); }
  catch (e) { console.warn("[proxy-port] assignProxy 실패 — pending 으로", String((e as Error)?.message ?? e).slice(0, 120)); return { pending: true }; }
}
/** 계정의 전용 IP 를 풀로 돌려준다(슬롯 종료). 미연결이면 아무 일도 없다 · 던지지 않는다. */
export async function releaseProxy(accountId: number): Promise<void> {
  if (!bound) return;
  try { await bound.releaseProxy(accountId); }
  catch (e) { console.warn("[proxy-port] releaseProxy 실패", String((e as Error)?.message ?? e).slice(0, 120)); }
}
