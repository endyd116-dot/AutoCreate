/**
 * lib/creds-crypto.ts — 계정 자격 암복호화(AES-256-GCM). AM 원본: ../AutoMarketing/lib/channel-creds.ts §1 (발췌 복사 2026-09-14 · 키 파생을 hex 32B 우선으로)
 *   키 = `CREDS_ENC_KEY`. 🔴 폴백 없음(JWT_SECRET 등으로 대체 금지) — 미설정이면 저장·복호화 모두 **정직 500**(throw).
 *   키 형식: hex 64자(32B)면 그대로 · 아니면 sha256(문자열) 32B(AM 호환).
 *   포맷: "v1:iv:tag:ct"(base64url). 객체는 JSON 직렬화 후 암호화(encryptObj/decryptObj).
 *   평문 표면 2곳 규칙(DESIGN §7.1): 러너 claim · 운영 열람(+감사). 그 외 응답·로그 평문 0 — maskSecret 만.
 */
import crypto from "node:crypto";

const ALGO = "aes-256-gcm";

export function credsEncConfigured(): boolean {
  return Boolean(String(process.env.CREDS_ENC_KEY ?? "").trim());
}

function encKey(): Buffer {
  const src = String(process.env.CREDS_ENC_KEY ?? "").trim();
  if (!src) throw Object.assign(new Error("CREDS_ENC_KEY 미설정 — 계정 자격을 저장할 수 없어요."), { code: "CREDS_ENC_KEY_MISSING" });
  if (/^[0-9a-fA-F]{64}$/.test(src)) return Buffer.from(src, "hex");
  return crypto.createHash("sha256").update(src, "utf8").digest();
}

const b64u = (b: Buffer) => b.toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url");

/** 평문 → "v1:iv:tag:ct". 빈 입력은 빈 문자열. 키 미설정 throw. */
export function encrypt(plain: string): string {
  const s = String(plain ?? "");
  if (!s) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, encKey(), iv);
  const enc = Buffer.concat([cipher.update(s, "utf8"), cipher.final()]);
  return `v1:${b64u(iv)}:${b64u(cipher.getAuthTag())}:${b64u(enc)}`;
}

/** "v1:…" → 평문. 키 미설정 throw · 손상/키 불일치는 null(호출자가 재연결 유도). */
export function decrypt(blob: string | null | undefined): string | null {
  const b = String(blob ?? "");
  if (!b) return null;
  const key = encKey();
  try {
    const parts = b.split(":");
    if (parts.length !== 4 || parts[0] !== "v1") return null;
    const decipher = crypto.createDecipheriv(ALGO, key, unb64u(parts[1]));
    decipher.setAuthTag(unb64u(parts[2]));
    return Buffer.concat([decipher.update(unb64u(parts[3])), decipher.final()]).toString("utf8");
  } catch { return null; }
}

export function encryptObj(obj: Record<string, unknown>): string { return encrypt(JSON.stringify(obj)); }
export function decryptObj<T = Record<string, unknown>>(blob: string | null | undefined): T | null {
  const s = decrypt(blob);
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

/** 로그·응답용 마스킹("naver_id" → "na*****"). */
export function maskSecret(v: string | null | undefined): string {
  const s = String(v ?? "");
  if (!s) return "";
  if (s.length <= 2) return "*".repeat(s.length);
  return s.slice(0, 2) + "*".repeat(Math.min(8, Math.max(3, s.length - 2)));
}

/** proxy URL 은 호스트만 남긴다(계정 응답용 · 자격 부분 제거). */
export function maskProxyUrl(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  try { const u = new URL(s); return `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}`; } catch { return maskSecret(s); }
}
