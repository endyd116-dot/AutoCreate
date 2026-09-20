/**
 * lib/pay-route.ts — 결제 라인(인증/비인증) 판정 **단일 소스**.
 *   원본: HamkkeWorkOn `lib/pay-route.ts`(복사 2026-09-14) · AC 변경점 = 정책 저장소가 `getPolicies()` 가 아니라 **운영센터 전역 설정**(`ops_settings.payment`).
 *
 *   배경: 법인카드가 인증(앱카드/ISP) 결제창에서 거절되는 문제 → KICC 비인증 전용 MID 를 따로 둔다.
 *   비인증(keyin)으로 가려면 **세 가지가 모두** 참이어야 한다(하나라도 아니면 인증 결제로 **조용히 폴백** — «결제 실패»가 아니라 «기존 방식으로 정상 결제»):
 *     ① 고객이 결제 화면에서 «카드번호 직접 입력»을 골랐다(body.payRoute === "keyin" 또는 body.keyin === true)
 *     ② 운영센터 정책 `payment.keyinEnabled === true`(기본 false)
 *     ③ `KICC_MALL_ID_KEYIN`(비인증 MID)이 실제로 등록돼 있다
 *   ③ 이 있는 이유: MID 가 비기 전에 정책만 켜지면 인증 MID 로 비인증 화면 코드를 보내 결제창이 아예 안 뜬다.
 *   🔎 출처: AC 신규(계약 KICC 이중 MID · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { isKeyinMidConfigured, type PayRoute } from "./kicc";
import { readOpsSetting } from "./ops/settings";

export type { PayRoute };

/** 클라이언트가 보낸 값이 «비인증 요청»인지. body.payRoute==="keyin" 또는 body.keyin===true 둘 다 허용. */
export function wantsKeyin(body: unknown): boolean {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  return b.keyin === true || String(b.payRoute ?? "") === "keyin";
}

/** 결제 라인 정책(운영센터 «결제» 메뉴 토글). 실패·미설정은 전부 꺼진 것으로 본다(안전측). */
export async function paymentPolicy(): Promise<{ keyinEnabled: boolean; keyinLabel: string; keyinNotice: string }> {
  const p = await readOpsSetting("payment");
  const label = typeof p.keyinLabel === "string" && p.keyinLabel.trim() ? p.keyinLabel.trim() : "카드번호 직접 입력";
  return { keyinEnabled: p.keyinEnabled === true, keyinLabel: label, keyinNotice: typeof p.keyinNotice === "string" ? p.keyinNotice : "" };
}

/** 최종 결제 라인. 위 3조건을 모두 통과할 때만 "keyin". */
export async function resolvePayRoute(body: unknown): Promise<PayRoute> {
  if (!wantsKeyin(body)) return "auth";
  if (!isKeyinMidConfigured()) return "auth";              // MID 미등록 → 기존 라인
  try {
    if (!(await paymentPolicy()).keyinEnabled) return "auth";
  } catch { return "auth"; }                                // 정책 조회 실패도 안전측(기존 라인)
  return "keyin";
}

/** 결제 화면에 «카드번호 직접 입력» 선택지를 노출할지 + 문구. 클라이언트는 MID·정책 원본을 모른다.
 *  ⚠️ **단건 결제(코인)용이다.** 카드 등록(빌키)은 아래 `keyinOptionForBillingKey()` 를 써라 — 거기선 고객이 고를 것이 없다. */
export async function keyinOption(): Promise<{ available: boolean; label: string; notice: string }> {
  const pol = await paymentPolicy().catch(() => ({ keyinEnabled: false, keyinLabel: "카드번호 직접 입력", keyinNotice: "" }));
  return { available: pol.keyinEnabled && isKeyinMidConfigured(), label: pol.keyinLabel, notice: pol.keyinNotice };
}

/**
 * 🔴 **카드 등록(빌키) 화면용** — 여기서는 «카드번호 직접 입력»을 **고를 수 없다**(2026-09-21 · B 실측).
 *
 *   ══ 왜 «못 고른다»가 정답인가(재 보고 정했다) ══
 *     `lib/billing/billing-key.ts:43` 이 빌키 라인을 **이렇게 정한다**:
 *       `isKeyinMidConfigured() ? "keyin" : (opts.route === "keyin" ? "keyin" : "auth")`
 *     ⇒ ①키인 MID 가 **있으면** — 고객이 무엇을 고르든 **언제나 keyin** 이다(고를 것이 없다. 이미 그쪽으로 간다).
 *       ②키인 MID 가 **없으면** — keyin 을 골라도 `getKiccConfig("keyin")` 이 auth MID 로 떨어진다(고를 수가 없다).
 *     **어느 쪽이든 고객의 선택이 결과를 못 바꾼다.** 그런데 화면은 체크박스를 그려 `payRoute` 를 보내고 있었고,
 *     서버는 그걸 **읽지도 않았다** ⇒ 🔴 «물어 놓고 버리는» 상태였다.
 *
 *   ⇒ 고쳐야 할 것은 «서버가 받기»가 **아니다**(받아도 결과가 같다 — 그건 연극이다). **묻지 않는 것**이다.
 *      대신 §9 대로 **무엇이 일어나는지 말해 준다** — `notice` 를 비워 두지 않는다(화면이 그대로 실으면 된다).
 */
export async function keyinOptionForBillingKey(): Promise<{ available: false; label: string; notice: string }> {
  const pol = await paymentPolicy().catch(() => ({ keyinEnabled: false, keyinLabel: "카드번호 직접 입력", keyinNotice: "" }));
  return {
    available: false,
    label: pol.keyinLabel,
    notice: isKeyinMidConfigured()
      ? "카드 등록은 카드번호를 직접 입력하는 창으로 열려요."
      : "카드 등록은 카드사 인증 창으로 열려요. 카드번호 직접 입력은 코인을 살 때 고를 수 있어요.",
  };
}
