// AM 원본: ../AutoMarketing/lib/kicc.ts (복사 2026-09-14 · 무수정 · 키 없으면 no-op)
/**
 * lib/kicc.ts — KICC(이지페이) 결제 API 클라이언트 (AutoMarketing Phase 10 R2).
 * MIS(tbfa-mis/lib/kicc.ts)의 순수 API층 차용 — db 로깅은 제거(여기선 lib/billing.ts가 담당).
 * 환경변수는 MIS와 동일: KICC_MODE·KICC_API_DOMAIN·KICC_MALL_ID·KICC_SECRET_KEY (그대로 차용).
 *
 * ★ graceful: 키 미설정 시 모든 호출이 success:false{KICC_NOT_CONFIGURED} 반환 — 크래시 없음.
 *   결제는 항상 명시 트리거(자율 자동집행 아님). 키 꽂으면 즉시 라이브.
 *
 * 흐름:
 *  - 빌키 등록: registerTrade({isBillingKey:true})→authPageUrl(브라우저)→approveTrade(authorizationId)→billKey
 *  - 정기 청구: chargeWithBillingKey({billingKey,...})
 *  - 취소: cancelPayment / 빌키삭제: removeBillingKey / 조회: retrieveTransaction
 */
import crypto from "crypto";

export type ErrorCategory =
  | "card_invalid"
  | "insufficient_funds"
  | "declined"
  | "network"
  | "not_configured"
  | "rate_limit"
  | "unknown";

export interface ChargeResult {
  success: boolean;
  pgTid?: string;
  shopOrderNo?: string;
  amount?: number;
  statusCode?: string;
  approvedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  errorCategory?: ErrorCategory;
  retryable?: boolean;
  raw?: any;
}

export interface RegisterResult {
  success: boolean;
  authPageUrl?: string;
  shopOrderNo?: string;
  errorCode?: string;
  errorMessage?: string;
  raw?: any;
}

export interface ApproveResult {
  success: boolean;
  pgTid?: string;
  amount?: number;
  statusCode?: string;
  cardCompany?: string;
  cardNumberMasked?: string;
  cardType?: string;
  billKey?: string;
  approvedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  errorCategory?: ErrorCategory;
  retryable?: boolean;
  raw?: any;
}

export interface CancelResult {
  success: boolean;
  status?: string;
  canceledAt?: string;
  cancelAmount?: number;
  pgTid?: string;
  errorCode?: string;
  errorMessage?: string;
  raw?: any;
}

/* ── 환경 ─────────────────────────────────────────────── */

export function getKiccConfig(): { mode: "test" | "live"; apiDomain: string; mallId: string; secretKey: string } {
  const mode = ((process.env.KICC_MODE || "test").toLowerCase() === "live" ? "live" : "test") as "test" | "live";
  let apiDomain =
    process.env.KICC_API_DOMAIN ||
    (mode === "live" ? "https://pgapi.easypay.co.kr" : "https://testpgapi.easypay.co.kr");
  apiDomain = apiDomain.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(apiDomain)) apiDomain = "https://" + apiDomain;
  const mallId = process.env.KICC_MALL_ID || "";
  const secretKey = process.env.KICC_SECRET_KEY || "";
  return { mode, apiDomain, mallId, secretKey };
}

/** 키 설정 여부 — 미설정이면 결제 경로 전체 graceful no-op. */
export function isKiccConfigured(): boolean {
  const { mallId, secretKey } = getKiccConfig();
  return !!mallId && !!secretKey;
}

function notConfigured<T extends { success: boolean; errorCode?: string; errorMessage?: string; errorCategory?: ErrorCategory; retryable?: boolean }>(): T {
  return {
    success: false,
    errorCode: "KICC_NOT_CONFIGURED",
    errorMessage: "KICC 가맹 키 미설정 — 결제 비활성",
    errorCategory: "not_configured",
    retryable: false,
  } as T;
}

export function signMsgAuth(plain: string): string {
  const { secretKey } = getKiccConfig();
  return crypto.createHmac("sha256", secretKey).update(plain, "utf8").digest("hex");
}

export function verifyMsgAuth(j: any): boolean {
  const { secretKey } = getKiccConfig();
  if (!secretKey || !j?.msgAuthValue || j?.pgCno == null) return false;
  const plain = `${j.pgCno}|${j.amount}|${j.transactionDate}`;
  return signMsgAuth(plain) === String(j.msgAuthValue);
}

/**
 * L2 — 응답 무결성(msgAuthValue) 불일치 시 거부할지. test=경고만(통과·현 동작 보존),
 *   live=기본 거부(응답 위변조 차단). 단 KICC_MSGAUTH_ENFORCE='off'면 live에서도 경고만
 *   (6/18 운영 응답의 서명포맷 실측 전·포맷 불일치로 전건 거부되는 사고 대비 비상 해제용).
 */
export function msgAuthBlocks(): boolean {
  return getKiccConfig().mode === "live" && process.env.KICC_MSGAUTH_ENFORCE !== "off";
}

/* ── 헬퍼 ─────────────────────────────────────────────── */

function reqDateYmd(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, "0")}${String(kst.getUTCDate()).padStart(2, "0")}`;
}

export function makeTxId(base: string, suffix: string): string {
  const s = `${base}-${suffix}`;
  return s.length > 60 ? s.slice(s.length - 60) : s;
}

async function kiccPost(path: string, body: any): Promise<{ ok: boolean; status: number; json: any; networkError?: string }> {
  const { apiDomain } = getKiccConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await fetch(`${apiDomain}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let json: any = null;
    try { json = await resp.json(); } catch { json = null; }
    return { ok: resp.ok, status: resp.status, json };
  } catch (e: any) {
    return { ok: false, status: 0, json: null, networkError: String(e?.message || e).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

function isOk(j: any): boolean {
  return String(j?.resCd) === "0000";
}

export function normalizeKiccError(input: any): { code: string; message: string; category: ErrorCategory; retryable: boolean } {
  const code = String(input?.resCd || input?.code || input?.errorCode || "UNKNOWN");
  const message = String(input?.resMsg || input?.message || input?.errorMessage || "알 수 없는 오류");
  if (/한도|초과|잔액|부족/.test(message)) return { code, message, category: "insufficient_funds", retryable: true };
  if (/만료|유효기간|분실|도난|정지|해지|등록되지|유효하지|비밀번호|타입오류|불일치/.test(message))
    return { code, message, category: "card_invalid", retryable: false };
  if (/거절|불가|실패|취소/.test(message)) return { code, message, category: "declined", retryable: true };
  if (/타임아웃|timeout|네트워크|통신|지연/i.test(message)) return { code, message, category: "network", retryable: true };
  return { code, message, category: "unknown", retryable: true };
}

function cardTypeKo(cardGubun: any): string {
  if (cardGubun === "Y") return "체크";
  if (cardGubun === "G") return "기프트";
  return "신용";
}

/* ── 1. 거래등록(webpay) — 일시·정기 공용 ───────────────── */

/** ★PAYLINK B2 — ON 2026-07-05 핫픽스 이식: deviceTypeCode "pc" 하드코딩이면 모바일에 PC 결제창
 *  (ISP 팝업·PC 크기 카드사 페이지)이 떠 팝업차단으로 결제 실패(WN14). 요청 User-Agent로 판별해
 *  "mobile"을 넘기면 카드사 모바일 전용(팝업 없는) 흐름. 결제링크는 대부분 폰에서 열린다. */
export function deviceTypeFromUA(ua: string | null | undefined): "pc" | "mobile" {
  return /android|iphone|ipad|ipod|mobile|windows phone/i.test(String(ua || "")) ? "mobile" : "pc";
}

export interface RegisterTradeParams {
  shopOrderNo: string;
  amount: number;
  goodsName: string;
  returnUrl: string;
  isBillingKey?: boolean;
  customerName?: string;
  customerEmail?: string;
  /** ★PAYLINK B2 — 미지정이면 "pc"(기존 호출부 무회귀). deviceTypeFromUA(req UA)로 넘겨라. */
  deviceTypeCode?: "pc" | "mobile";
}

export async function registerTrade(p: RegisterTradeParams): Promise<RegisterResult> {
  if (!isKiccConfigured()) return notConfigured<RegisterResult>();
  const { mallId } = getKiccConfig();
  const body: any = {
    mallId,
    shopOrderNo: p.shopOrderNo,
    amount: p.isBillingKey ? 0 : p.amount,
    payMethodTypeCode: p.isBillingKey ? "81" : "00",
    currency: "00",
    clientTypeCode: "00",
    returnUrl: p.returnUrl,
    deviceTypeCode: p.deviceTypeCode || "pc",   // ★PAYLINK B2 — UA 판별값 수용(기본 "pc" 무회귀)
    orderInfo: {
      goodsName: p.goodsName,
      customerInfo: { customerName: p.customerName || "", customerMail: p.customerEmail || "" },
    },
  };
  if (p.isBillingKey) body.payMethodInfo = { billKeyMethodInfo: { certType: "0" } };
  else body.payMethodInfo = { cardMethodInfo: { displayArea: ["CARD", "SPAY"] } };
  const r = await kiccPost("/api/ep9/trades/webpay", body);
  if (r.networkError) return { success: false, errorCode: "NETWORK_ERROR", errorMessage: r.networkError, raw: { networkError: r.networkError } };
  const j = r.json || {};
  if (!isOk(j)) { const e = normalizeKiccError(j); return { success: false, errorCode: e.code, errorMessage: e.message, raw: j }; }
  return { success: true, authPageUrl: j.authPageUrl || j.authPageURL || j.pageUrl || "", shopOrderNo: j.shopOrderNo || p.shopOrderNo, raw: j };
}

/* ── 2. 승인(approval) — 일시결제 / 빌키발급 공용 ───────── */

export async function approveTrade(p: { authorizationId: string; shopOrderNo: string }): Promise<ApproveResult> {
  if (!isKiccConfigured()) return notConfigured<ApproveResult>();
  const { mallId } = getKiccConfig();
  const body: any = {
    mallId,
    shopTransactionId: makeTxId(p.shopOrderNo, "AP"),
    authorizationId: p.authorizationId,
    shopOrderNo: p.shopOrderNo,
    approvalReqDate: reqDateYmd(),
  };
  const r = await kiccPost("/api/ep9/trades/approval", body);
  if (r.networkError)
    return { success: false, errorCode: "NETWORK_ERROR", errorMessage: r.networkError, errorCategory: "network", retryable: true, raw: { networkError: r.networkError } };
  const j = r.json || {};
  if (!isOk(j)) {
    const e = normalizeKiccError(j);
    return { success: false, errorCode: e.code, errorMessage: e.message, errorCategory: e.category, retryable: e.retryable, raw: j };
  }
  // ⚠️ H2 — live(차단모드)에선 msgAuthValue **필수**. 필드 누락으로 무결성 검증을 우회하지 못하게 없을 때도 거부.
  if (msgAuthBlocks()) {
    if (!j.msgAuthValue || !verifyMsgAuth(j)) return { success: false, errorCode: "MSGAUTH_MISMATCH", errorMessage: "승인 응답 무결성 검증 실패(msgAuthValue 누락/불일치)", errorCategory: "unknown", retryable: false, raw: j };
  } else if (j.msgAuthValue && !verifyMsgAuth(j)) {
    console.warn(`[kicc] approval msgAuthValue 불일치(${getKiccConfig().mode}·비차단) ${p.shopOrderNo}`);
  }
  const paymentInfo = j.paymentInfo || {};
  const cardInfo = paymentInfo.cardInfo || {};
  const hasBillKey = typeof cardInfo.cardMaskNo === "string" && cardInfo.cardMaskNo.length > 0;
  return {
    success: true,
    pgTid: j.pgCno,
    amount: Number(j.amount),
    statusCode: j.statusCode,
    cardCompany: cardInfo.issuerName || cardInfo.acquirerName,
    cardNumberMasked: hasBillKey ? cardInfo.cardMaskNo : cardInfo.cardNo,
    cardType: cardTypeKo(cardInfo.cardGubun),
    billKey: hasBillKey ? cardInfo.cardNo : undefined,
    approvedAt: j.transactionDate,
    raw: j,
  };
}

/* ── 3. 자동결제(approval/batch) — 빌키 청구 ─────────────── */

export interface ChargeParams {
  billingKey: string;
  shopOrderNo: string;
  amount: number;
  goodsName: string;
  customerName?: string;
  customerEmail?: string;
}

export async function chargeWithBillingKey(p: ChargeParams): Promise<ChargeResult> {
  if (!isKiccConfigured()) return notConfigured<ChargeResult>();
  const { mallId } = getKiccConfig();
  const body: any = {
    mallId,
    shopTransactionId: makeTxId(p.shopOrderNo, "BT"),
    shopOrderNo: p.shopOrderNo,
    approvalReqDate: reqDateYmd(),
    amount: p.amount,
    currency: "00",
    orderInfo: { goodsName: p.goodsName },
    payMethodInfo: { billKeyMethodInfo: { batchKey: p.billingKey }, cardMethodInfo: { installmentMonth: 0 } },
  };
  const r = await kiccPost("/api/trades/approval/batch", body);
  if (r.networkError)
    return { success: false, shopOrderNo: p.shopOrderNo, errorCode: "NETWORK_ERROR", errorMessage: r.networkError, errorCategory: "network", retryable: true, raw: { networkError: r.networkError } };
  const j = r.json || {};
  if (!isOk(j)) {
    const e = normalizeKiccError(j);
    return { success: false, shopOrderNo: p.shopOrderNo, errorCode: e.code, errorMessage: e.message, errorCategory: e.category, retryable: e.retryable, raw: j };
  }
  // ⚠️ H2 — live(차단모드)에선 msgAuthValue **필수**(필드 누락 우회 차단).
  if (msgAuthBlocks()) {
    if (!j.msgAuthValue || !verifyMsgAuth(j)) return { success: false, shopOrderNo: p.shopOrderNo, errorCode: "MSGAUTH_MISMATCH", errorMessage: "결제 응답 무결성 검증 실패(msgAuthValue 누락/불일치)", errorCategory: "unknown", retryable: false, raw: j };
  } else if (j.msgAuthValue && !verifyMsgAuth(j)) {
    console.warn(`[kicc] batch msgAuthValue 불일치(${getKiccConfig().mode}·비차단) ${p.shopOrderNo}`);
  }
  return {
    success: true,
    pgTid: j.pgCno,
    shopOrderNo: j.shopOrderNo || p.shopOrderNo,
    amount: Number(j.amount) || p.amount,
    statusCode: j.statusCode,
    approvedAt: j.transactionDate,
    raw: j,
  };
}

/* ── 4. 취소·환불(revise) — 요청 msgAuthValue 필수 ──────── */

export async function cancelPayment(p: { pgTid: string; amount?: number; reviseTypeCode?: string; reason?: string }): Promise<CancelResult> {
  if (!isKiccConfigured()) return notConfigured<CancelResult>();
  if (!p.pgTid) return { success: false, errorCode: "MISSING_PG_TID", errorMessage: "pgTid(pgCno)가 없습니다" };
  const { mallId } = getKiccConfig();
  const reviseTypeCode = p.reviseTypeCode || "40";
  const shopTransactionId = makeTxId(p.pgTid, `CX${Date.now().toString(36)}`);
  const body: any = {
    mallId,
    shopTransactionId,
    pgCno: p.pgTid,
    reviseTypeCode,
    cancelReqDate: reqDateYmd(),
    msgAuthValue: signMsgAuth(`${p.pgTid}|${shopTransactionId}`),
    reviseMessage: (p.reason || "관리자 취소").slice(0, 100),
  };
  if (typeof p.amount === "number" && p.amount > 0) body.amount = Math.floor(p.amount);
  const r = await kiccPost("/api/trades/revise", body);
  if (r.networkError) return { success: false, errorCode: "NETWORK_ERROR", errorMessage: r.networkError, raw: { networkError: r.networkError } };
  const j = r.json || {};
  if (!isOk(j)) { const e = normalizeKiccError(j); return { success: false, errorCode: e.code, errorMessage: e.message, raw: j }; }
  return {
    success: true,
    status: j.statusCode || "TS02",
    canceledAt: j.transactionDate,
    cancelAmount: Number(j.cancelAmount) || p.amount,
    pgTid: j.cancelPgCno || j.oriPgCno || p.pgTid,
    raw: j,
  };
}

/* ── 5. 빌키 삭제(removeBatchKey) ───────────────────────── */

export async function removeBillingKey(p: { billingKey: string }): Promise<{ success: boolean; raw?: any; errorCode?: string; errorMessage?: string }> {
  if (!isKiccConfigured()) return notConfigured<{ success: boolean; errorCode?: string; errorMessage?: string }>();
  if (!p.billingKey) return { success: false, errorCode: "MISSING_BILLKEY", errorMessage: "빌키가 없습니다" };
  const { mallId } = getKiccConfig();
  const body: any = {
    mallId,
    shopTransactionId: makeTxId(p.billingKey.slice(0, 30), `RM${Date.now().toString(36)}`),
    batchKey: p.billingKey,
    removeReqDate: reqDateYmd(),
  };
  const r = await kiccPost("/api/trades/removeBatchKey", body);
  if (r.networkError) return { success: false, errorCode: "NETWORK_ERROR", errorMessage: r.networkError, raw: { networkError: r.networkError } };
  const j = r.json || {};
  if (!isOk(j)) { const e = normalizeKiccError(j); return { success: false, errorCode: e.code, errorMessage: e.message, raw: j }; }
  return { success: true, raw: j };
}

/* ── 6. 거래조회(retrieveTransaction) — 승인 미수신 복구용 ─ */

export async function retrieveTransaction(p: { shopTransactionId: string; transactionDate?: string }): Promise<{
  success: boolean; statusCode?: string; amount?: number; pgTid?: string; raw?: any; errorCode?: string; errorMessage?: string;
}> {
  if (!isKiccConfigured()) return notConfigured<{ success: boolean; errorCode?: string; errorMessage?: string }>();
  const { mallId } = getKiccConfig();
  const body: any = { mallId, shopTransactionId: p.shopTransactionId, transactionDate: p.transactionDate || reqDateYmd() };
  const r = await kiccPost("/api/trades/retrieveTransaction", body);
  if (r.networkError) return { success: false, errorCode: "NETWORK_ERROR", errorMessage: r.networkError, raw: { networkError: r.networkError } };
  const j = r.json || {};
  if (!isOk(j)) { const e = normalizeKiccError(j); return { success: false, errorCode: e.code, errorMessage: e.message, raw: j }; }
  return { success: true, statusCode: j.statusCode, amount: Number(j.amount), pgTid: j.pgCno, raw: j };
}

/**
 * 재청구 전 이중청구 가드(L1) — orderNo의 자동결제(batch) 거래가 KICC에 이미 승인됐는지 조회.
 *   스턱 회수(charging→pending) 후 재청구 직전 호출: 직전 시도가 PG엔 성공했으나 기록 전 크래시한 경우를 잡는다.
 *   ★ test/미설정/미발견/오류는 전부 alreadyPaid:false(graceful) — 정상 청구 흐름 보존(test 절대 깨지 말 것).
 *   ⚠️ 보수 판정: 조회 성공 + pgCno(거래번호) 존재 + 금액>0 일 때만 결제완료로 본다(미발견=resCd≠0000→success:false→false).
 *      6/18 운영 응답의 statusCode 의미 실측 후 정밀화 가능.
 */
export async function isOrderAlreadyPaid(shopOrderNo: string): Promise<{ alreadyPaid: boolean; pgTid?: string }> {
  if (!isKiccConfigured()) return { alreadyPaid: false };
  try {
    const r = await retrieveTransaction({ shopTransactionId: makeTxId(shopOrderNo, "BT") });
    // ⚠️ H3(★2026-07-10 P0 리허설 라이브 실측으로 확정) — KICC retrieveTransaction은 취소거래에
    //   cancelYn/cancelDate/cancelAmount를 **주지 않는다**(필드 부재·이전 판정이 전부 통과해 취소를 결제완료로 오판했음).
    //   실제 취소 신호 = statusCode뿐: **TS02=전체취소**(원금 전액 환원→미결제) / **TS06=부분취소**(누적 전액도 TS06).
    //   취소돼도 raw.amount는 원금 유지. → 전체취소(TS02)만 미결제로 본다. 부분취소(TS06)는 원 결제가 유효하므로
    //   결제완료 유지(스턱 회수 재청구 시 이중청구 방지 — 이 함수의 유일 목적). cancelYn 등은 미래 포맷 대비 병기.
    //   ([[kicc-retrieve-no-cancel-fields]] 메모리·전체 코드표는 KICC 문서 대조 권장.)
    const raw = (r.raw || {}) as Record<string, any>;
    const sc = String(raw.statusCode ?? r.statusCode ?? "").toUpperCase();
    const fullyCancelled = sc === "TS02"
      || String(raw.cancelYn ?? raw.cancelYN ?? "").toUpperCase() === "Y"   // 미래 포맷 대비(현재 부재)
      || !!(raw.cancelDate || raw.cancelDate8 || raw.cancelInfo);
    const paid = r.success && !!r.pgTid && Number(r.amount || 0) > 0 && !fullyCancelled;
    return { alreadyPaid: paid, pgTid: r.pgTid };
  } catch { return { alreadyPaid: false }; }
}

/* ── 주문번호·재시도 헬퍼 (pg 비종속) ───────────────────── */

/** 정기 청구 주문번호 — 동일 테넌트·월·차수는 동일 → 이중청구 방지. (≤40자) */
export function generateBillingOrderId(tenantId: number, period: string, attempt: number = 1): string {
  const ym = period.replace(/-/g, "");
  const suffix = attempt > 1 ? `-r${attempt}` : "";
  return `AM-BILL-${ym}-${tenantId}${suffix}`;
}

/** 빌키 등록 주문번호 — 테넌트·등록 시도별. */
export function generateRegisterOrderId(tenantId: number): string {
  return `AM-BK-${tenantId}-${Date.now().toString(36)}`;
}

/** 1차 실패→+1일 / 2차 실패→+3일 / 3차 이상→null(자동해지) */
export function calculateNextRetryAt(attemptNumber: number): Date | null {
  const now = new Date();
  if (attemptNumber === 1) { const n = new Date(now); n.setDate(n.getDate() + 1); return n; }
  if (attemptNumber === 2) { const n = new Date(now); n.setDate(n.getDate() + 3); return n; }
  return null;
}

/** billingDay(1~28) 기준 다음 청구일(월말 보정). */
export function calculateNextBillingDate(billingDay: number, from: Date = new Date()): Date {
  const y = from.getFullYear(), m = from.getMonth(), d = from.getDate();
  let ny: number, nm: number;
  if (d < billingDay) { ny = y; nm = m; }
  else { ny = m === 11 ? y + 1 : y; nm = m === 11 ? 0 : m + 1; }
  const lastDay = new Date(ny, nm + 1, 0).getDate();
  return new Date(ny, nm, Math.min(billingDay, lastDay));
}

/** 현재 기간 'YYYY-MM' (KST). */
export function currentPeriod(date: Date = new Date()): string {
  const kst = new Date(date.getTime() + 9 * 3600 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}
