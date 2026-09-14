/**
 * lib/billing/callback.ts — KICC **복귀(returnUrl) 파라미터 읽기 한 곳**(계약 §1.6 · 2026-09-15 라이브 실측으로 생김).
 *   원본 관례: HamkkeWorkOn `netlify/functions/payment-kicc-return.ts`(복사 2026-09-15) — 그쪽은 실전에서 **POST form 복귀**를 겪고 이렇게 짰다.
 *
 *   🔴 사고(2026-09-15): 우리 콜백 두 곳이 `url.searchParams` 만 읽었다. KICC 는 결제창 종료 후 **POST(form)** 로 돌아온다 —
 *      그래서 주문번호·승인번호가 빈 값이 되고, 그 자리에서 «실패» 리다이렉트로 빠졌다. **감사도 안 남아** 밖에서 보면
 *      «콜백이 아예 안 왔다»로 보였다(사장님 카드 등록 1회 낭비 · 돈은 0원). 여기가 그 수리다.
 *   ✓ GET 쿼리 + POST 본문(x-www-form-urlencoded · multipart · json) 전부 읽는다.
 *   ✓ 이름 폴백: 주문번호 `shopOrderNo|shoporderno|shop_order_no|pgOrderNo|o` · 승인번호 `authorizationId|authorizationid|authorization_id`.
 *   ✓ 성공 판정: `resCd === "0000"` 또는 (`resCd` 없고 `authorizationId` 있음) — ON 판 그대로.
 *   🔴 값은 로그·감사에 싣지 않는다 — **받은 키 이름 목록과 method 만**(카드·승인번호가 감사에 남으면 안 된다).
 */
export interface CallbackParams {
  method: string;
  /** 받은 파라미터 **이름**만(값 금지 · 감사용). */
  keys: string[];
  orderNo: string;
  authorizationId: string;
  resCd: string;
  resMsg: string;
  /** KICC 가 «성공»이라고 말했는가(승인은 아직 — 승인은 우리가 따로 호출한다). */
  success: boolean;
  raw: Record<string, string>;
}

const pick = (o: Record<string, string>, names: string[]): string => {
  for (const n of names) { const v = o[n]; if (v !== undefined && String(v).trim()) return String(v).trim(); }
  return "";
};

export async function readKiccCallback(req: Request): Promise<CallbackParams> {
  const obj: Record<string, string> = {};
  try { for (const [k, v] of new URL(req.url).searchParams) obj[k] = v; } catch { /* URL 파싱 실패는 무시 */ }
  if (req.method === "POST") {
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("multipart/form-data")) {
      try { const fd = await req.formData(); fd.forEach((v, k) => { if (typeof v === "string") obj[k] = v; }); } catch { /* 본문은 한 번만 읽을 수 있다 — 폴백 없음 */ }
    } else {
      const raw = await req.text().catch(() => "");
      if (raw) {
        if (ct.includes("application/json")) { try { Object.assign(obj, JSON.parse(raw) as Record<string, string>); } catch { /* 아니면 폼으로 */ } }
        else for (const [k, v] of new URLSearchParams(raw)) obj[k] = v;
      }
    }
  }
  const orderNo = pick(obj, ["shopOrderNo", "shoporderno", "shop_order_no", "pgOrderNo", "orderNo", "o"]);
  const authorizationId = pick(obj, ["authorizationId", "authorizationid", "authorization_id", "authId"]);
  const resCd = pick(obj, ["resCd", "rescd", "res_cd"]);
  const resMsg = pick(obj, ["resMsg", "resmsg", "res_msg", "errorMessage", "resultMsg"]);
  const success = resCd === "0000" || (!resCd && !!authorizationId);
  return { method: req.method, keys: Object.keys(obj), orderNo, authorizationId, resCd, resMsg, success, raw: obj };
}

/** 복귀가 어긋나도 **흔적은 남긴다**(AC-9 · 값 금지 · 이름만). 실패 사유 코드는 화면 쿼리로도 나간다. */
export function callbackAudit(p: CallbackParams, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { method: p.method, keys: p.keys.slice(0, 30), hasOrderNo: !!p.orderNo, hasAuthId: !!p.authorizationId, resCd: p.resCd || null, success: p.success, ...extra };
}
