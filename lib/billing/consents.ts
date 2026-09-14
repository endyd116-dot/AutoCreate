/**
 * lib/billing/consents.ts — 약관 동의 기록·확인(계약 §2.4(7) · §19 · DESIGN §16).
 *   가입: `consents:{ terms, privacy, paidTerms, automationNotice }` → 표 `consents`(kind·version·시각·IP). 결제 첫 회: `agreePaidTerms:true` 없고
 *   `paid_terms` 동의가 0건이면 400 «유료 약관에 동의해 주세요»(그 뒤엔 다시 묻지 않는다 · 메인 승인).
 *   문서 버전은 여기 상수 한 곳(A 의 문서 파일과 같은 낱말). 문서를 고치면 버전을 올린다 — 그러면 재동의 대상이 된다.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";

export type ConsentKind = "terms" | "privacy" | "paid_terms" | "automation_notice" | "sanction_notice" | "creds_storage" | "marketing";
/** 문서 버전 정본(A 의 public/terms.html·privacy.html·paid-terms.html·automation-notice.html 과 짝). */
export const CONSENT_VERSIONS: Readonly<Record<ConsentKind, string>> = {
  terms: "2026-09-14", privacy: "2026-09-14", paid_terms: "2026-09-14", automation_notice: "2026-09-14", sanction_notice: "2026-09-14", creds_storage: "2026-09-14", marketing: "2026-09-14",
};
/** 가입 body 의 낱말(camel) → kind. */
export const REGISTER_CONSENT_KEYS: Readonly<Record<string, ConsentKind>> = { terms: "terms", privacy: "privacy", paidTerms: "paid_terms", automationNotice: "automation_notice", sanctionNotice: "sanction_notice", credsStorage: "creds_storage", marketing: "marketing" };
/** 가입에 반드시 있어야 하는 동의. */
export const REQUIRED_AT_SIGNUP: readonly ConsentKind[] = ["terms", "privacy"];

export async function recordConsents(tid: number, uid: number | null, kinds: ConsentKind[], meta: { ip?: string | null; ua?: string | null } = {}): Promise<number> {
  let written = 0;
  for (const k of [...new Set(kinds)]) {
    try {
      await q(sql`INSERT INTO consents (tenant_id, user_id, kind, version, ip, user_agent) VALUES (${tid}, ${uid}, ${k}, ${CONSENT_VERSIONS[k]}, ${meta.ip ?? null}, ${(meta.ua ?? "").slice(0, 200) || null})`);
      written++;
    } catch (e) { console.error("[consents] 기록 실패", k, String((e as Error)?.message ?? e).slice(0, 100)); }
  }
  return written;
}
/** 현재 버전으로 동의했나. */
export async function hasConsent(tid: number, kind: ConsentKind): Promise<boolean> {
  const [r] = await q(sql`SELECT 1 FROM consents WHERE tenant_id = ${tid} AND kind = ${kind} AND version = ${CONSENT_VERSIONS[kind]} LIMIT 1`);
  return !!r;
}
/** 결제 첫 회 유료 약관 게이트 — body.agreePaidTerms 가 true 면 기록하고 통과 · 이미 있으면 통과 · 아니면 false(400). */
export async function requirePaidTerms(tid: number, uid: number | null, agree: unknown, meta: { ip?: string | null; ua?: string | null } = {}): Promise<boolean> {
  if (await hasConsent(tid, "paid_terms")) return true;
  if (agree === true) { await recordConsents(tid, uid, ["paid_terms"], meta); return true; }
  return false;
}
/** 가입 body 의 consents 객체 → 기록할 kind 목록(true 인 것만). 필수(terms·privacy) 누락이면 missing 에 담는다. */
export function parseSignupConsents(body: unknown): { kinds: ConsentKind[]; missing: ConsentKind[] } {
  const c = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const kinds: ConsentKind[] = [];
  for (const [k, kind] of Object.entries(REGISTER_CONSENT_KEYS)) if (c[k] === true) kinds.push(kind);
  return { kinds, missing: REQUIRED_AT_SIGNUP.filter((k) => !kinds.includes(k)) };
}
