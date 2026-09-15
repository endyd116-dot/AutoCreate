/**
 * lib/am-bridge.ts — AM(AutoMarketing) ↔ AC 코인 다리 · **AC 쪽 응답 규약**(계약 P1R6 §1.4). AM 쪽 배선은 AM 계약 합의 뒤(이번 범위 밖).
 *   🔴 키 없으면 `not_configured` 정직(화면 «준비 중») — 어떤 폴백도 없다. 키를 꽂으면 즉시 가동(AM KICC 관례).
 *
 *   ══ 규약(AM 이 구현해야 하는 두 끝점) ══
 *   ① 차감  POST {AM_BRIDGE_URL}/coin-transfer-out   body { requestId, acTenantKey, email, coins, at }
 *          → 200 { ok:true, amOrderNo, debited, remaining? }                             (같은 requestId 재요청 = 같은 amOrderNo · 멱등)
 *          → 200 { ok:false, step:"insufficient"|"not_linked"|"denied"|"…", error }      (사람말 error 는 그대로 화면 토스트)
 *   ② 되돌림 POST {AM_BRIDGE_URL}/coin-transfer-cancel body { requestId, amOrderNo, at }   (AC 기입이 실패했을 때만 · 멱등)
 *          → 200 { ok:true } | { ok:false, error }
 *   서명: 헤더 `X-AC-Timestamp: {at}` · `X-AC-Signature: hex(HMAC-SHA256(AM_BRIDGE_SECRET, `${at}.${rawBody}`))` · 5분 창. 응답에도 같은 방식의 `X-AM-Signature` 가 있으면 검증(없으면 통과 · 있는데 틀리면 실패).
 *   환경: AM_BRIDGE_URL(끝점 접두 · 뒤 슬래시 없이) · AM_BRIDGE_SECRET(32자 이상 공유 비밀). 🔴 값은 로그·응답·감사에 찍지 않는다(등록 여부 boolean 만).
 */
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

const TIMEOUT_MS = 15_000;
export type AmDebitResult =
  | { ok: true; amOrderNo: string; debited: number; remaining: number | null; requestId: string }
  | { ok: false; step: "not_configured" | "insufficient" | "not_linked" | "denied" | "network" | "bad_response" | "signature" | string; error: string; requestId: string };

export function isAmBridgeConfigured(): boolean {
  return !!(process.env.AM_BRIDGE_URL && String(process.env.AM_BRIDGE_URL).startsWith("http") && process.env.AM_BRIDGE_SECRET && String(process.env.AM_BRIDGE_SECRET).length >= 16);
}
export function amBridgeStatus(): { configured: boolean; host: string | null } {
  if (!isAmBridgeConfigured()) return { configured: false, host: null };
  try { return { configured: true, host: new URL(String(process.env.AM_BRIDGE_URL)).host }; } catch { return { configured: true, host: null }; }
}
export function signBridge(at: string, rawBody: string, secret = String(process.env.AM_BRIDGE_SECRET ?? "")): string {
  return createHmac("sha256", secret).update(`${at}.${rawBody}`).digest("hex");
}
function safeEq(a: string, b: string): boolean { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export const HUMAN: Record<string, string> = {
  insufficient: "저쪽 잔액이 모자라요.", not_linked: "저쪽에 같은 메일로 된 계정이 없어요.", denied: "저쪽에서 이전을 막았어요.",
  network: "저쪽 서비스와 연결하지 못했어요. 잠시 뒤 다시 해 주세요.", bad_response: "저쪽 응답을 읽지 못했어요.", signature: "저쪽 응답 서명이 맞지 않아요.",
};

async function call(path: "coin-transfer-out" | "coin-transfer-cancel", body: Record<string, unknown>): Promise<{ ok: true; j: Record<string, unknown> } | { ok: false; step: string; error: string }> {
  const at = new Date().toISOString(); const raw = JSON.stringify({ ...body, at });
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${String(process.env.AM_BRIDGE_URL).replace(/\/+$/, "")}/${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-AC-Timestamp": at, "X-AC-Signature": signBridge(at, raw) }, body: raw, signal: ctl.signal });
    const text = await res.text();
    let j: Record<string, unknown> | null = null; try { j = JSON.parse(text); } catch { /* 아래 */ }
    if (!j || typeof j !== "object") return { ok: false, step: "bad_response", error: `${HUMAN.bad_response} (HTTP ${res.status})` };
    const sig = res.headers.get("x-am-signature"); const rat = res.headers.get("x-am-timestamp") ?? "";
    if (sig && !safeEq(sig, signBridge(rat, text))) return { ok: false, step: "signature", error: HUMAN.signature };
    if (j.ok !== true) { const step = String(j.step ?? "denied"); return { ok: false, step, error: String(j.error ?? HUMAN[step] ?? "저쪽에서 처리하지 못했어요.").slice(0, 200) }; }
    return { ok: true, j };
  } catch (e) {
    const aborted = (e as { name?: string })?.name === "AbortError";
    return { ok: false, step: "network", error: aborted ? "저쪽 서비스가 응답하지 않아요(15초). 잠시 뒤 다시 해 주세요." : HUMAN.network };
  } finally { clearTimeout(timer); }
}

/** AM 에 «coins 만큼 빼 달라» — 성공하면 amOrderNo(AC 멱등 ref 의 재료). requestId 는 재시도 멱등 키(호출부가 같은 값을 다시 보낼 수 있다). */
export async function amDebit(input: { acTenantKey: string; email: string | null; coins: number; requestId?: string }): Promise<AmDebitResult> {
  const requestId = input.requestId ?? `ac-${randomUUID()}`;
  if (!isAmBridgeConfigured()) return { ok: false, step: "not_configured", error: "아직 준비 중이에요", requestId };
  const coins = Math.floor(Number(input.coins));
  if (!Number.isFinite(coins) || coins <= 0) return { ok: false, step: "denied", error: "옮길 코인 수를 확인해 주세요.", requestId };
  const r = await call("coin-transfer-out", { requestId, acTenantKey: input.acTenantKey, email: input.email, coins });
  if (!r.ok) return { ok: false, step: r.step, error: r.error, requestId };
  const amOrderNo = String(r.j.amOrderNo ?? "").trim().slice(0, 80);
  const debited = Math.floor(Number(r.j.debited ?? coins));
  if (!amOrderNo || !Number.isFinite(debited) || debited <= 0) return { ok: false, step: "bad_response", error: "저쪽 응답에 주문번호가 없어요.", requestId };
  const remaining = r.j.remaining === undefined || r.j.remaining === null ? null : Number(r.j.remaining);
  return { ok: true, amOrderNo, debited, remaining: Number.isFinite(remaining as number) ? remaining : null, requestId };
}
/** AC 기입이 실패했을 때 AM 차감을 되돌린다(최선 노력 · 멱등). 실패해도 던지지 않는다 — 호출부가 감사·티켓으로 남긴다. */
export async function amCancel(input: { requestId: string; amOrderNo: string }): Promise<{ ok: boolean; error?: string }> {
  if (!isAmBridgeConfigured()) return { ok: false, error: "not_configured" };
  const r = await call("coin-transfer-cancel", { requestId: input.requestId, amOrderNo: input.amOrderNo });
  return r.ok ? { ok: true } : { ok: false, error: `${r.step}: ${r.error}` };
}
