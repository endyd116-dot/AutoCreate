// AM 원본: ../AutoMarketing/lib/sso-role.ts (복사 2026-09-14 · 무수정)
/**
 * lib/sso-role.ts — MIS(싸이렌) 허브 SSO role claim → AM operators.role 매핑 판정(순수·DB 무관).
 *   계약 정본: docs/active/2026-07-13-mis-sso-role-contract.md (HOME-AM B 작업1).
 *
 * 규칙(사장님 확정·오강등 사고 방지):
 *   - claim 값은 "super_admin"|"admin"|"operator"만 유효 — 그 외 문자열/부재는 "claim 없음"으로 취급(하위호환).
 *   - claim 없음: 기존 운영자는 role 무변(등급 반영이 안 될 뿐 SSO는 동작) · 신규는 기존 기본값 admin(옛 동작 보존).
 *   - claim 있음 + 신규 계정: claim 그대로 부여(assign).
 *   - claim 있음 + 기존 계정: **상향만 자동 반영**(upgrade) · 하향은 반영하지 않고 감사만(hold_downgrade) ·
 *     동급은 무변(keep). 하향 확정은 수동(메인).
 */

export type SsoRole = "super_admin" | "admin" | "operator";

export const SSO_VALID_ROLES: readonly SsoRole[] = ["super_admin", "admin", "operator"];

/** 등급 서열(높을수록 권한 큼) — 상향/하향 판정의 단일 기준. */
const ROLE_RANK: Record<SsoRole, number> = { operator: 0, admin: 1, super_admin: 2 };

/** claim 원문 → 유효 role 또는 null(부재/미지값 — 계약: 미지값은 무시하고 기존 동작). */
export function parseSsoRoleClaim(raw: unknown): SsoRole | null {
  return SSO_VALID_ROLES.includes(raw as SsoRole) ? (raw as SsoRole) : null;
}

export type SsoRoleAction =
  | "assign"          // 신규 계정에 claim 부여
  | "legacy_default"  // 신규 계정·claim 없음 → 기본 admin(옛 동작)
  | "keep"            // 기존 계정·변경 없음(claim 없음 또는 동급)
  | "upgrade"         // 기존 계정·상향 자동 반영
  | "hold_downgrade"; // 기존 계정·하향 요청 → 보류(감사만·수동 확정)

export interface SsoRoleDecision {
  role: SsoRole;            // 최종 적용 role
  action: SsoRoleAction;
  /** 감사 대상 여부 — assign/upgrade/hold_downgrade만 audit(sso_role_map) 기록(로그 스팸 방지). */
  audit: boolean;
}

/**
 * resolveSsoRole — 기존 role(null=신규 계정)과 claim으로 최종 role을 판정한다.
 *   기존 수동 super_admin 보존은 이 서열 규칙에 포함된다(어떤 claim도 super_admin을 하향시키지 못함).
 */
export function resolveSsoRole(currentRole: SsoRole | null, claim: SsoRole | null): SsoRoleDecision {
  if (currentRole == null) {
    // 신규 계정 — claim 있으면 그대로, 없으면 옛 기본(admin·2026-06-09 배관과 동일).
    return claim
      ? { role: claim, action: "assign", audit: true }
      : { role: "admin", action: "legacy_default", audit: false };
  }
  if (!claim || claim === currentRole) {
    return { role: currentRole, action: "keep", audit: false };
  }
  if (ROLE_RANK[claim] > ROLE_RANK[currentRole]) {
    return { role: claim, action: "upgrade", audit: true };
  }
  // 하향 요청 — 반영하지 않고 보류(감사 기록만·오강등 방지·수동 확정은 메인).
  return { role: currentRole, action: "hold_downgrade", audit: true };
}
