// AM 원본: ../AutoMarketing/lib/billing-math.ts (복사 2026-09-14 · 무수정)
/**
 * lib/billing-math.ts — 돈 계산 순수 모듈(P0-MONEY·2026-07-10 사장님 확정). DB/IO 0 — 하니스가 결정론 검증.
 *
 * [돈-1] 3자 일치: 표시가(월 요금) = 공급가액. 청구액 = 공급가액 + VAT 10%(원 미만 절사). 영수증 = 공급가/부가세/합계 분리.
 * [돈-3] PG 진실원: 승인 성공 후 내부검증(msgAuth) 실패는 "결제 실패"가 아니다 — 파괴 처리(정지·빌키삭제) 금지.
 */

/** 부가세(10%·원 미만 절사). 공급가액(할인 적용 후) 기준. */
export function vatOf(supplyKrw: number): number {
  return Math.max(0, Math.floor(Math.max(0, Math.floor(supplyKrw)) * 0.1));
}

/** ★파운딩 월할인 — 구독료(공급가액)에 pct% 할인 적용가(0~100 클램프·원 미만 절사·VAT는 할인 후 기준). */
export function subscriptionAfterDiscount(baseKrw: number, pct: number): number {
  const base = Math.max(0, Math.floor(baseKrw));
  const p = Math.max(0, Math.min(100, Math.floor(Number(pct) || 0)));
  if (p <= 0) return base;
  return Math.floor(base * (100 - p) / 100);
}

/** 청구 총액 = 공급가액 + VAT. */
export function totalWithVat(supplyKrw: number): number {
  const s = Math.max(0, Math.floor(supplyKrw));
  return s + vatOf(s);
}

/**
 * 업그레이드 잔여일 일할 차액(공급가액·원 미만 절사).
 *   diff<=0(다운그레이드/동일)·remainDays<=0·cycleDays<=0 → 0(청구 없음). remainDays는 cycleDays로 캡.
 */
export function prorateUpgradeSupply(newMonthlyKrw: number, curMonthlyKrw: number, remainDays: number, cycleDays: number): number {
  const diff = Math.floor(newMonthlyKrw) - Math.floor(curMonthlyKrw);
  if (diff <= 0 || remainDays <= 0 || cycleDays <= 0) return 0;
  const r = Math.min(Math.floor(remainDays), Math.floor(cycleDays));
  return Math.floor((diff * r) / Math.floor(cycleDays));
}

/**
 * 청구 실패 분류([돈-3]) — MSGAUTH_MISMATCH = "PG는 승인했는데 서명검증만 실패" 가능 상태:
 *   절대 정지·빌키삭제 안 함(msgauth=true → 호출자가 거래조회 화해 → 확인 시 paid·미확인 시 +1일 비파괴 재시도).
 *   그 외 = 기존 규칙(비재시도/3회 → 정지).
 */
export function classifyChargeFailure(errorCode: string | null | undefined, retryable: boolean | undefined, attempt: number): {
  msgauth: boolean; suspend: boolean; retry: boolean;
} {
  if (String(errorCode ?? "") === "MSGAUTH_MISMATCH") return { msgauth: true, suspend: false, retry: true };
  // ★OPS-CENTER B4 — 던닝 사다리 D+0→D+3→D+7→D+10(4회차 정지). 재시도 가능한 실패는 4회차에 자동 정지.
  const suspend = retryable !== true || attempt >= 4;
  return { msgauth: false, suspend, retry: !suspend };
}

/**
 * dunningSchedule — 던닝 사다리(OPS-CENTER B4·설계 §5). attempt = 이번 실패 횟수(1-based).
 *   1(D+0) → +3일·stage1·안내없음(첫 실패 통지는 billing_failed로 별도)
 *   2(D+3) → +4일·stage2·reminder(안내 문자)
 *   3(D+7) → +3일·stage3·warning(정지 예고)
 *   4+(D+10) → 정지·stage4·suspend
 *   ★수동 개입(운영자 정지/재개/해지)은 이 사다리 밖 — 호출부가 dunning_stage를 리셋/중단.
 */
export function dunningSchedule(attempt: number): { retryDays: number | null; stage: number; notice: "none" | "reminder" | "warning" | "suspend" } {
  if (attempt <= 1) return { retryDays: 3, stage: 1, notice: "none" };
  if (attempt === 2) return { retryDays: 4, stage: 2, notice: "reminder" };
  if (attempt === 3) return { retryDays: 3, stage: 3, notice: "warning" };
  return { retryDays: null, stage: 4, notice: "suspend" };
}

/**
 * 환불 상한([돈-2]) — 누계 검증. 요청액 미지정 = 잔여 전액.
 *   반환: 거부 사유 또는 {refund(이번 실행액), newRefunded(누계), full(원금 도달), refundableAfter(실행 후 잔여)}.
 */
export function resolveRefund(amountKrw: number, refundedKrw: number, requestedKrw?: number):
  | { ok: true; refund: number; newRefunded: number; full: boolean; refundableAfter: number }
  | { ok: false; error: string; refundable: number } {
  const amount = Math.max(0, Math.floor(amountKrw));
  const already = Math.max(0, Math.floor(refundedKrw));
  const refundable = Math.max(0, amount - already);
  if (refundable <= 0) return { ok: false, error: "이미 전액 환불된 결제입니다.", refundable: 0 };
  const req = requestedKrw != null ? Math.floor(requestedKrw) : refundable;
  if (req <= 0) return { ok: false, error: "환불 금액이 올바르지 않습니다.", refundable };
  if (req > refundable) return { ok: false, error: `환불 가능액(₩${refundable.toLocaleString("ko-KR")})을 초과합니다.`, refundable };
  const newRefunded = already + req;
  return { ok: true, refund: req, newRefunded, full: newRefunded >= amount, refundableAfter: amount - newRefunded };
}
