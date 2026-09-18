/**
 * lib/validate.ts — 입력 검증 소도구(zod 얇은 래퍼) + 공용 헬퍼.
 *   🔎 출처: AC 신규(계약 phase0 · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
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

/**
 * 🔴 [2026-09-19 수리 ⑤] 칸 이름 → **사람말**. 여기 없는 칸은 **이름을 아예 안 쓴다.**
 *   종전엔 `${i.path.join(".")}: ${i.message}` 라 손님 화면에 «**password: 8자 이상**» 이 그대로 떴다(시나리오 A §1).
 *   §3 «시스템 용어 금지» — 손님은 우리 변수 이름을 모른다.
 */
const FIELD_SAY: Record<string, string> = {
  email: "이메일", password: "비밀번호", password2: "비밀번호 확인", current: "현재 비밀번호",
  name: "이름", displayName: "표시명", title: "제목", subject: "한 줄 요약", text: "내용", body: "내용",
  url: "주소", siteUrl: "사이트 주소", loginId: "아이디", appPassword: "앱 비밀번호", referralCode: "추천 코드",
};
/** 링크로 오는 한 번 쓰는 값 — 칸이 아니라 **링크**가 잘못된 것이다. 칸 이름을 말하면 손님이 어디를 고칠지 모른다. */
const TOKEN_FIELDS = new Set(["t", "token", "nonce", "code"]);
/** zod 기본 **영어** 메시지 → 사람말. 우리가 메시지를 안 준 스키마가 그대로 새 나가던 자리(«t: String must contain at least 10 character(s)»). */
function humanize(msg: string, label: string): string {
  const who = label || "입력하신 값";
  let m = msg.match(/must contain at least (\d+) character/i);
  if (m) return `${who}은(는) ${m[1]}자 이상이어야 해요.`;
  m = msg.match(/must contain at most (\d+) character/i);
  if (m) return `${who}은(는) ${m[1]}자까지예요.`;
  if (/invalid email/i.test(msg)) return "이메일 주소를 다시 확인해 주세요.";
  if (/invalid url/i.test(msg)) return "주소를 다시 확인해 주세요.";
  if (/required|invalid_type|expected/i.test(msg) && /received undefined|required/i.test(msg)) return `${who}을(를) 입력해 주세요.`;
  if (/^[\x20-\x7E]+$/.test(msg)) return `${who}을(를) 다시 확인해 주세요.`;   // 아직 못 옮긴 영어는 **내보내지 않는다**
  return label ? `${label}: ${msg}` : msg;                                       // 우리가 한국어로 적어 둔 메시지는 그대로
}

/** 첫 zod 이슈를 **사람말로**. 🔴 영어 칸 이름·영어 문장은 손님에게 내보내지 않는다. 자: `scripts/verify-people-words.mjs` */
export function firstIssue(err: z.ZodError): string {
  const i = err.issues[0];
  if (!i) return "입력값을 확인해 주세요.";
  const key = String(i.path[i.path.length - 1] ?? "");
  if (TOKEN_FIELDS.has(key)) return "링크가 올바르지 않아요. 메일에서 버튼을 다시 눌러 주세요.";
  return humanize(String(i.message ?? ""), FIELD_SAY[key] ?? "");
}
