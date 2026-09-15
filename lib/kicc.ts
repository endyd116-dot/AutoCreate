/**
 * lib/kicc.ts — KICC(이지페이) 결제 어댑터. **이중 MID 판**(인증/비인증 라인 · pg_mid 보존).
 *   🔎 출처: **AM 원본 있음** — 아래 두 줄이 정본이다(HamkkeWorkOn `lib/adapters/payment/kicc.ts` 298줄 · 복사일 2026-09-14 / 그전 판 AM `../AutoMarketing/lib/kicc.ts`). AC 첫 커밋 `258869e` 2026-09-14.
 *     🔴 이 줄은 **새 사실이 아니다** — 조사 하니스가 낱말 «AM 원본»으로만 찾아서 못 읽던 것을 규약대로 적어 둔 것이다.
 *   원본: HamkkeWorkOn `lib/adapters/payment/kicc.ts`(298줄 · 복사일 2026-09-14) — 그 사업자의 KICC 계약을 AC 가 함께 쓴다(사장님 지시).
 *   그전 판: AM `../AutoMarketing/lib/kicc.ts`(단일 MID · 2026-09-14 복사) — 이 파일이 대체한다.
 *
 *   ══ AC 변경점(원본 대비) ══
 *     ① **키 없으면 no-op 정직**(`isKiccConfigured`·`notConfigured` · `errorCategory:"not_configured"`) — AM/AC 관례 유지(원본엔 없다).
 *     ② `msgAuthBlocks()`(live 에서 응답 서명 불일치 차단 · `KICC_MSGAUTH_ENFORCE=off` 비상 해제) 유지 — 원본은 항상 «경고만».
 *     ③ `retrieveTransaction`·`isOrderAlreadyPaid`(스턱 회수 이중청구 가드) 유지 — 원본엔 없다. MID 인자를 더했다.
 *     ④ **`goodsName` 앞에 «AutoCreate »**(`brandGoods`) — 같은 사업자·같은 MID 를 쓰므로 카드 명세서·정산에서 함께워크ON 과 구별되어야 한다(사장님 지시).
 *     ⑤ 주문번호 헬퍼는 AC 규약(`AC-…`) 유지 — 원본의 `WON-…` 은 가져오지 않는다.
 *     ⑥ `payMethodTypeCode` 기본값 = env `KICC_PAY_METHOD_TYPE_CODE`(없으면 `"11"` 신용카드 · 원본 라이브 실측값). AM 의 `"00"`+displayArea 는 이 MID 에서 검증된 적이 없어 쓰지 않는다.
 *
 *   ══ 이중 MID(원본 주석 요약 · KICC 규칙) ══
 *     · `auth`  = `KICC_MALL_ID`        — 인증(앱카드/ISP)·간편결제. 기본 라인.
 *     · `keyin` = `KICC_MALL_ID_KEYIN`  — 비인증(카드번호 직접 입력)·법인카드 대응. **미등록이면 auth 로 조용히 폴백**(결제 실패가 아니라 «기존 방식으로 정상 결제»).
 *     · 🔴 승인·취소·빌키 청구/삭제는 **그 거래를 만든 MID** 로 해야 한다 → `invoices.pg_mid`·`coin_orders.pg_mid`·`billing_keys.pg_mid` 에 실제 MID 를 남기고 그대로 되쓴다(`midOrDefault`·`secretForMid`).
 *     · secretKey 는 두 MID 공용이 원칙 · 다르게 발급됐으면 `KICC_SECRET_KEY_KEYIN` 한 줄만 더하면 된다(취소·환불에서만 드러난다).
 *   🔴 env 값(MID·secret)은 로그·응답·감사에 **찍지 않는다**. 라인 판정은 `lib/pay-route.ts` 한 곳.
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

/** 결제 라인 — auth(인증·기본) · keyin(비인증·카드번호 직접 입력). */
export type PayRoute = "auth" | "keyin";

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
  /** 이 청구를 처리한 MID — 취소 때 그대로 쓴다. */
  mallId?: string;
}

export interface RegisterResult {
  success: boolean;
  authPageUrl?: string;
  shopOrderNo?: string;
  errorCode?: string;
  errorMessage?: string;
  raw?: any;
  /** 이 거래를 등록한 MID — 승인도 같은 MID 로 해야 한다(저장해 둘 것). */
  mallId?: string;
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
  /** 이 승인을 처리한 MID — invoices/coin_orders/billing_keys 의 pg_mid 에 그대로 저장(취소·청구에 필요). */
  mallId?: string;
  /** 카드주체 — "P"=개인 "C"=법인 "N"=기타(법인카드가 실제로 승인됐는지 확인용). */
  cardBizGubun?: string;
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

export interface KiccConfig {
  mode: "test" | "live";
  apiDomain: string;
  /** 이 라인에서 쓸 MID(keyin 미등록이면 auth MID). */
  mallId: string;
  authMid: string;
  keyinMid: string;
  /** 이 라인에서 쓸 secret. */
  secretKey: string;
  sharedSecret: string;
  keyinSecret: string;
}

export function getKiccConfig(route: PayRoute = "auth"): KiccConfig {
  const mode = ((process.env.KICC_MODE || "test").toLowerCase() === "live" ? "live" : "test") as "test" | "live";
  let apiDomain =
    process.env.KICC_API_DOMAIN ||
    (mode === "live" ? "https://pgapi.easypay.co.kr" : "https://testpgapi.easypay.co.kr");
  apiDomain = apiDomain.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(apiDomain)) apiDomain = "https://" + apiDomain;
  const authMid = (process.env.KICC_MALL_ID || "").trim();
  const keyinMid = (process.env.KICC_MALL_ID_KEYIN || "").trim();
  const mallId = route === "keyin" ? (keyinMid || authMid) : authMid;   // keyin 미등록 → auth 폴백
  const sharedSecret = process.env.KICC_SECRET_KEY || "";
  const keyinSecret = (process.env.KICC_SECRET_KEY_KEYIN || "").trim();
  const secretKey = route === "keyin" && keyinSecret ? keyinSecret : sharedSecret;
  return { mode, apiDomain, mallId, authMid, keyinMid, secretKey, sharedSecret, keyinSecret };
}

/** 키 설정 여부(인증 라인 기준) — 미설정이면 결제 경로 전체 graceful no-op. */
export function isKiccConfigured(): boolean {
  const { authMid, sharedSecret } = getKiccConfig();
  return !!authMid && !!sharedSecret;
}

/** 비인증 MID 가 실제로 등록돼 있는가(= 비인증 라인을 켤 수 있는 상태인가). */
export function isKeyinMidConfigured(): boolean {
  return !!getKiccConfig().keyinMid;
}

/** 저장된 pg_mid 로 취소·청구할 MID 결정. 빈값 = 이 칸이 없던 때의 결제 → 기존 인증 MID. */
export function midOrDefault(storedMid?: string | null): string {
  return String(storedMid || "").trim() || getKiccConfig("auth").mallId;
}

/** 저장된 pg_mid 가 어느 라인인지(운영 표시·승인 라우팅용). */
export function routeOfMid(storedMid?: string | null): PayRoute {
  const s = String(storedMid || "").trim();
  const { keyinMid } = getKiccConfig();
  return s && keyinMid && s === keyinMid ? "keyin" : "auth";
}

/** 저장된 pg_mid 에 맞는 secretKey — 취소·환불처럼 «그 거래를 만든 MID» 로 서명해야 할 때. */
export function secretForMid(storedMid?: string | null): string {
  const { keyinMid, keyinSecret, sharedSecret } = getKiccConfig();
  const s = String(storedMid || "").trim();
  return s && keyinMid && s === keyinMid && keyinSecret ? keyinSecret : sharedSecret;
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

/* ★ KICC 규격(docs.kicc.co.kr) — 인증/비인증은 서로 다른 두 필드다(원본 주석 그대로 옮김).
   ① 일반결제(단건) payMethodInfo.cardMethodInfo.paymentType : 빈값=인증(앱카드/ISP) · "0"=키인 인증 · "1"=키인 비인증 ← 우리가 쓰는 값
   ② 빌키 등록창 payMethodInfo.billKeyMethodInfo.certType    : "0"=카드번호+유효기간+생년월일+비밀번호(기존값 유지) · "1"·"2"=입력 항목 축소
      ※ certType 은 입력 화면의 항목 수일 뿐 인증/비인증 구분이 아니다 · MID 와 무관.
   ※ 두 경우 모두 카드번호는 KICC 결제창이 직접 받는다 — 우리 서버는 카드정보 경로에 들어가지 않는다(PCI 범위 밖). */
export const KICC_KEYIN_PAYMENT_TYPE = "1";
export const KICC_BILLKEY_CERT_TYPE = "0";
/** 일반결제 결제수단 코드(기본 "11" 신용카드 · 간편결제를 열려면 env 로 "11,14,15,17" 등). */
export function defaultPayMethodTypeCode(): string {
  return String(process.env.KICC_PAY_METHOD_TYPE_CODE || "").trim() || "11";
}

/** 명세서에서 함께워크ON 과 구별되게 — 상품명 앞에 «AutoCreate »(이미 붙어 있으면 그대로). */
export function brandGoods(goodsName: string): string {
  const s = String(goodsName ?? "").trim() || "결제";
  return (/^autocreate\b/i.test(s) ? s : `AutoCreate ${s}`).slice(0, 100);
}

/** 요청 서명. secret 미지정이면 인증 라인 공용 키(호출부가 MID별 키를 넘기면 그 키로). */
export function signMsgAuth(plain: string, secret?: string): string {
  const secretKey = secret || getKiccConfig().secretKey;
  return crypto.createHmac("sha256", secretKey).update(plain, "utf8").digest("hex");
}

/** 응답 무결성 — `pgCno|amount|transactionDate`. 그 거래의 MID 키로 검증(미지정이면 공용 키). */
export function verifyMsgAuth(j: any, storedMid?: string | null): boolean {
  const secretKey = secretForMid(storedMid);
  if (!secretKey || !j?.msgAuthValue || j?.pgCno == null) return false;
  return signMsgAuth(`${j.pgCno}|${j.amount}|${j.transactionDate}`, secretKey) === String(j.msgAuthValue);
}

/**
 * 응답 서명 불일치를 거부할지. test=경고만(현 동작 보존), live=기본 거부.
 *   `KICC_MSGAUTH_ENFORCE='off'` 면 live 에서도 경고만(운영 응답 서명 포맷 실측 전 비상 해제).
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

/** 모바일에 PC 결제창(ISP 팝업)이 뜨면 팝업차단으로 실패(WN14) — UA 로 판별한다. */
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
  deviceTypeCode?: "pc" | "mobile";
  /** 결제 라인 — `lib/pay-route.ts resolvePayRoute()` 가 정한다(미지정 = auth). */
  route?: PayRoute;
  /** 결제수단 코드(미지정 = defaultPayMethodTypeCode). keyin 라인은 항상 "11". */
  payMethodTypeCode?: string;
}

export async function registerTrade(p: RegisterTradeParams): Promise<RegisterResult> {
  if (!isKiccConfigured()) return notConfigured<RegisterResult>();
  const route: PayRoute = p.route === "keyin" ? "keyin" : "auth";
  const { mallId } = getKiccConfig(route);
  /* 키인(비인증)은 신용카드 직접 입력이므로 "11" 고정 — 정책에 간편결제가 섞여 있어도 키인 창엔 해당 없다. */
  const code = p.isBillingKey ? "81" : (route === "keyin" ? "11" : (String(p.payMethodTypeCode || "").trim() || defaultPayMethodTypeCode()));
  const body: any = {
    mallId,
    shopOrderNo: p.shopOrderNo,
    amount: p.isBillingKey ? 0 : p.amount,
    payMethodTypeCode: code,
    currency: "00",
    clientTypeCode: "00",
    returnUrl: p.returnUrl,
    deviceTypeCode: p.deviceTypeCode || "pc",
    orderInfo: {
      goodsName: brandGoods(p.goodsName),
      customerInfo: { customerName: p.customerName || "", customerMail: p.customerEmail || "" },
    },
  };
  /* 인증 일반결제(route=auth · 빌키 아님)에는 payMethodInfo 를 넣지 않는다 — paymentType 빈값 = 일반 신용카드 결제이므로
     필드를 생략하는 것이 곧 원본(라이브 동작 중) 요청과 같다. */
  if (p.isBillingKey) body.payMethodInfo = { billKeyMethodInfo: { certType: KICC_BILLKEY_CERT_TYPE } };
  else if (route === "keyin") body.payMethodInfo = { cardMethodInfo: { paymentType: KICC_KEYIN_PAYMENT_TYPE } };
  const r = await kiccPost("/api/ep9/trades/webpay", body);
  if (r.networkError) return { success: false, errorCode: "NETWORK_ERROR", errorMessage: r.networkError, raw: { networkError: r.networkError } };
  const j = r.json || {};
  if (!isOk(j)) { const e = normalizeKiccError(j); return { success: false, errorCode: e.code, errorMessage: e.message, raw: j }; }
  return { success: true, authPageUrl: j.authPageUrl || j.authPageURL || j.pageUrl || "", shopOrderNo: j.shopOrderNo || p.shopOrderNo, raw: j, mallId };
}

/* ── 2. 승인(approval) — 일시결제 / 빌키발급 공용 ─────────
   🔴 승인은 반드시 거래등록(webpay)과 **같은 MID** 로 — 저장해 둔 pg_mid(mid) 나 route 를 그대로 넘긴다. */

export async function approveTrade(p: { authorizationId: string; shopOrderNo: string; route?: PayRoute; mid?: string | null }): Promise<ApproveResult> {
  if (!isKiccConfigured()) return notConfigured<ApproveResult>();
  const mallId = p.mid ? midOrDefault(p.mid) : getKiccConfig(p.route === "keyin" ? "keyin" : "auth").mallId;
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
  // live(차단모드)에선 msgAuthValue **필수** — 필드 누락으로 무결성 검증을 우회하지 못하게 없을 때도 거부.
  if (msgAuthBlocks()) {
    if (!j.msgAuthValue || !verifyMsgAuth(j, mallId)) return { success: false, errorCode: "MSGAUTH_MISMATCH", errorMessage: "승인 응답 무결성 검증 실패(msgAuthValue 누락/불일치)", errorCategory: "unknown", retryable: false, raw: j, mallId };
  } else if (j.msgAuthValue && !verifyMsgAuth(j, mallId)) {
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
    mallId,
    cardBizGubun: cardInfo.cardBizGubun,
  };
}

/* ── 3. 자동결제(approval/batch) — 빌키 청구 ───────────────
   🔴 빌키는 발급한 MID 로만 청구된다 → `billing_keys.pg_mid` 를 mid 로 넘길 것(없으면 인증 MID). */

export interface ChargeParams {
  billingKey: string;
  shopOrderNo: string;
  amount: number;
  goodsName: string;
  customerName?: string;
  customerEmail?: string;
  /** 빌키를 발급한 MID(billing_keys.pg_mid). */
  mid?: string | null;
}

export async function chargeWithBillingKey(p: ChargeParams): Promise<ChargeResult> {
  if (!isKiccConfigured()) return notConfigured<ChargeResult>();
  const mallId = midOrDefault(p.mid);
  const body: any = {
    mallId,
    shopTransactionId: makeTxId(p.shopOrderNo, "BT"),
    shopOrderNo: p.shopOrderNo,
    approvalReqDate: reqDateYmd(),
    amount: p.amount,
    currency: "00",
    orderInfo: { goodsName: brandGoods(p.goodsName) },
    payMethodInfo: { billKeyMethodInfo: { batchKey: p.billingKey }, cardMethodInfo: { installmentMonth: 0 } },
  };
  const r = await kiccPost("/api/trades/approval/batch", body);
  if (r.networkError)
    return { success: false, shopOrderNo: p.shopOrderNo, errorCode: "NETWORK_ERROR", errorMessage: r.networkError, errorCategory: "network", retryable: true, raw: { networkError: r.networkError }, mallId };
  const j = r.json || {};
  if (!isOk(j)) {
    const e = normalizeKiccError(j);
    return { success: false, shopOrderNo: p.shopOrderNo, errorCode: e.code, errorMessage: e.message, errorCategory: e.category, retryable: e.retryable, raw: j, mallId };
  }
  if (msgAuthBlocks()) {
    if (!j.msgAuthValue || !verifyMsgAuth(j, mallId)) return { success: false, shopOrderNo: p.shopOrderNo, errorCode: "MSGAUTH_MISMATCH", errorMessage: "결제 응답 무결성 검증 실패(msgAuthValue 누락/불일치)", errorCategory: "unknown", retryable: false, raw: j, mallId };
  } else if (j.msgAuthValue && !verifyMsgAuth(j, mallId)) {
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
    mallId,
  };
}

/* ── 4. 취소·환불(revise) — 요청 msgAuthValue 필수 ────────
   🔴 취소는 승인한 MID 로만 가능 → 호출부가 저장된 pg_mid 를 그대로 넘긴다(서명 키도 그 MID 의 것). */

export async function cancelPayment(p: { pgTid: string; amount?: number; reviseTypeCode?: string; reason?: string; mid?: string | null }): Promise<CancelResult> {
  if (!isKiccConfigured()) return notConfigured<CancelResult>();
  if (!p.pgTid) return { success: false, errorCode: "MISSING_PG_TID", errorMessage: "pgTid(pgCno)가 없습니다" };
  const mallId = midOrDefault(p.mid);
  const reviseTypeCode = p.reviseTypeCode || "40";   // 40=전체취소 · 32=신용카드 부분취소
  const shopTransactionId = makeTxId(p.pgTid, `CX${Date.now().toString(36)}`);
  const body: any = {
    mallId,
    shopTransactionId,
    pgCno: p.pgTid,
    reviseTypeCode,
    cancelReqDate: reqDateYmd(),
    msgAuthValue: signMsgAuth(`${p.pgTid}|${shopTransactionId}`, secretForMid(p.mid)),
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

/* ── 5. 빌키 삭제(removeBatchKey) — 발급 MID 로만 ────────── */

export async function removeBillingKey(p: { billingKey: string; mid?: string | null }): Promise<{ success: boolean; raw?: any; errorCode?: string; errorMessage?: string }> {
  if (!isKiccConfigured()) return notConfigured<{ success: boolean; errorCode?: string; errorMessage?: string }>();
  if (!p.billingKey) return { success: false, errorCode: "MISSING_BILLKEY", errorMessage: "빌키가 없습니다" };
  const mallId = midOrDefault(p.mid);
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

export async function retrieveTransaction(p: { shopTransactionId: string; transactionDate?: string; mid?: string | null }): Promise<{
  success: boolean; statusCode?: string; amount?: number; pgTid?: string; raw?: any; errorCode?: string; errorMessage?: string;
}> {
  if (!isKiccConfigured()) return notConfigured<{ success: boolean; errorCode?: string; errorMessage?: string }>();
  const mallId = midOrDefault(p.mid);
  const body: any = { mallId, shopTransactionId: p.shopTransactionId, transactionDate: p.transactionDate || reqDateYmd() };
  const r = await kiccPost("/api/trades/retrieveTransaction", body);
  if (r.networkError) return { success: false, errorCode: "NETWORK_ERROR", errorMessage: r.networkError, raw: { networkError: r.networkError } };
  const j = r.json || {};
  if (!isOk(j)) { const e = normalizeKiccError(j); return { success: false, errorCode: e.code, errorMessage: e.message, raw: j }; }
  return { success: true, statusCode: j.statusCode, amount: Number(j.amount), pgTid: j.pgCno, raw: j };
}

/**
 * 재청구 전 이중청구 가드(L1) — orderNo 의 자동결제(batch) 거래가 KICC 에 이미 승인됐는지 조회.
 *   ★ 미설정·미발견·오류는 전부 alreadyPaid:false(graceful).
 *   ⚠️ KICC retrieveTransaction 은 취소거래에 cancelYn/cancelDate 를 주지 않는다(실측) — 취소 신호는 statusCode 뿐:
 *      **TS02=전체취소**(미결제로 본다) / **TS06=부분취소**(원 결제는 유효 → 결제완료 유지 · 이중청구 방지가 이 함수의 목적).
 */
export async function isOrderAlreadyPaid(shopOrderNo: string, mid?: string | null): Promise<{ alreadyPaid: boolean; pgTid?: string }> {
  if (!isKiccConfigured()) return { alreadyPaid: false };
  try {
    const r = await retrieveTransaction({ shopTransactionId: makeTxId(shopOrderNo, "BT"), mid });
    const raw = (r.raw || {}) as Record<string, any>;
    const sc = String(raw.statusCode ?? r.statusCode ?? "").toUpperCase();
    const fullyCancelled = sc === "TS02"
      || String(raw.cancelYn ?? raw.cancelYN ?? "").toUpperCase() === "Y"   // 미래 포맷 대비(현재 부재)
      || !!(raw.cancelDate || raw.cancelDate8 || raw.cancelInfo);
    const paid = r.success && !!r.pgTid && Number(r.amount || 0) > 0 && !fullyCancelled;
    return { alreadyPaid: paid, pgTid: r.pgTid };
  } catch { return { alreadyPaid: false }; }
}

/* ── 주문번호·재시도 헬퍼 (pg 비종속 · AC 규약) ─────────── */

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
