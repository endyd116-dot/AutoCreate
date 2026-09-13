/** lib/validate.ts — 입력 검증 소도구(zod 얇은 래퍼) + 공용 헬퍼. */
import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(160);
export const passwordSchema = z.string().min(8, "8자 이상").max(72).regex(/[A-Za-z]/, "영문 포함").regex(/[0-9]/, "숫자 포함");

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { return {} as T; }
}

export function tenantKeyFrom(email: string): string {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "user";
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 첫 zod 이슈를 사람말로. */
export function firstIssue(err: z.ZodError): string {
  const i = err.issues[0];
  return i ? `${i.path.join(".") || "입력"}: ${i.message}` : "입력값을 확인해 주세요.";
}
