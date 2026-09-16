/**
 * lib/ops/company.ts — 운영센터 «회사 정보»(계약 P1R6 §1.3 · DESIGN §11.4). `ops_settings` 의 `company` 행 한 벌.
 *   🔴 영수증(`GET /api/invoice` 의 supplier) · 약관 하단(`GET /api/company`) · 세금계산서 모두 **이 한 출처**를 읽는다 — 코드에 상호·사업자번호를 박지 않는다.
 *   supplierOf(): 상호·사업자등록번호가 비어 있으면 null → 화면 «준비 중» 한 줄(금액·결제일은 그대로 보인다).
 *   쓰기는 super_admin 만(netlify/functions/ops-company.ts · 감사 high). 읽기는 60초 캐시(lib/ops/settings.ts).
 *   🔎 출처: AC 신규(계약 P1R6-B §1.1~§1.4 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { utcDate } from "../db-util";
import { readOpsSetting, writeOpsSetting } from "./settings";

export const COMPANY_KEY = "company";
export const COMPANY_FIELDS = ["name", "ceo", "bizNo", "mailOrderNo", "address", "email", "phone"] as const;
export type CompanyField = typeof COMPANY_FIELDS[number];
export type CompanyInfo = Record<CompanyField, string>;
export interface CompanyRecord extends CompanyInfo { updatedBy: number | null; updatedAt: string | null; configured: boolean }
const MAX: Record<CompanyField, number> = { name: 80, ceo: 40, bizNo: 12, mailOrderNo: 40, address: 200, email: 160, phone: 30 };

/** 사업자등록번호 — 숫자 10자리면 000-00-00000 로 · 아니면 그대로(운영자가 눈으로 본다). */
export function formatBizNo(v: unknown): string {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : String(v ?? "").trim().slice(0, MAX.bizNo);
}
function str(v: unknown, max: number): string { return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max); }
function fromBag(bag: Record<string, unknown>): CompanyInfo {
  return { name: str(bag.name, MAX.name), ceo: str(bag.ceo, MAX.ceo), bizNo: formatBizNo(bag.bizNo), mailOrderNo: str(bag.mailOrderNo, MAX.mailOrderNo), address: str(bag.address, MAX.address), email: str(bag.email, MAX.email).toLowerCase(), phone: str(bag.phone, MAX.phone) };
}
/** 회사 정보 읽기(캐시 60초). 값이 하나도 없으면 빈 문자열 7개 + configured false. */
export async function readCompany(force = false): Promise<CompanyRecord> {
  const bag = await readOpsSetting(COMPANY_KEY, force);
  const info = fromBag(bag);
  let updatedBy: number | null = null, updatedAt: string | null = null;
  if (force) {
    try { const [r] = await q(sql`SELECT updated_by, updated_at FROM ops_settings WHERE key = ${COMPANY_KEY}`); if (r) { updatedBy = r.updated_by === null || r.updated_by === undefined ? null : Number(r.updated_by); updatedAt = utcDate(r.updated_at)?.toISOString() ?? null; } } catch { /* 표시용 */ }
  }
  return { ...info, updatedBy, updatedAt, configured: !!(info.name && info.bizNo) };
}
/** 영수증·세금계산서의 공급자 — 상호·사업자번호가 있어야 «있다». 없으면 null(«준비 중»). */
export function supplierOf(c: CompanyInfo): CompanyInfo | null {
  if (!c.name || !c.bizNo) return null;
  return Object.fromEntries(COMPANY_FIELDS.map((k) => [k, c[k] ?? ""])) as CompanyInfo;   // 공개 7칸만(updatedBy 등 운영 메타는 싣지 않는다)
}

export type CompanyInput = Partial<Record<CompanyField, unknown>>;
export type CompanyValidation = { ok: true; patch: Partial<CompanyInfo> } | { ok: false; step: CompanyField; error: string };
/** 저장 전 검증 — 온 키만 본다(부분 갱신). 사업자번호는 10자리 · 메일 모양 · 나머지는 길이만. */
export function validateCompanyInput(b: CompanyInput): CompanyValidation {
  const patch: Partial<CompanyInfo> = {};
  for (const k of COMPANY_FIELDS) {
    if (!(k in b) || b[k] === undefined) continue;
    const v = k === "bizNo" ? formatBizNo(b[k]) : k === "email" ? str(b[k], MAX.email).toLowerCase() : str(b[k], MAX[k]);
    if (k === "bizNo" && v && !/^\d{3}-\d{2}-\d{5}$/.test(v)) return { ok: false, step: "bizNo", error: "사업자등록번호는 숫자 10자리예요(000-00-00000)." };
    if (k === "email" && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { ok: false, step: "email", error: "메일 주소 모양이 아니에요." };
    patch[k] = v;
  }
  return { ok: true, patch };
}
/** 저장(얕은 병합 · 캐시 무효화) → 저장된 전체. */
export async function writeCompany(patch: Partial<CompanyInfo>, operatorId: number | null): Promise<CompanyRecord> {
  await writeOpsSetting(COMPANY_KEY, patch, operatorId);
  return await readCompany(true);
}
