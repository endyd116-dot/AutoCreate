/**
 * runner/lib/api.mjs — 서버 큐 클라이언트(계약 §2) + 설정 읽기. 의존성 0(node 20 fetch).
 *   🔴 토큰은 파일(`runner/.token`)·env·인자에서만 읽고 **로그에 찍지 않는다**(찍으면 그 로그가 곧 계정 열쇠다).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION = "1.0.0";

const TOKEN_FILE = path.join(ROOT, ".token");
const DEFAULT_SERVER = "https://autocreate-endyd.netlify.app";

/** 토큰 — ①--token 인자 ②AC_RUNNER_TOKEN ③runner/.token 파일. 없으면 null. */
export function readToken(argToken) {
  const fromArg = String(argToken ?? "").trim();
  if (fromArg) return fromArg;
  const fromEnv = String(process.env.AC_RUNNER_TOKEN ?? "").trim();
  if (fromEnv) return fromEnv;
  try { return fs.readFileSync(TOKEN_FILE, "utf8").trim() || null; } catch { return null; }
}
export function saveToken(token) {
  fs.writeFileSync(TOKEN_FILE, String(token).trim() + "\n", { encoding: "utf8", mode: 0o600 });
}
export function serverBase() {
  return String(process.env.AC_SERVER ?? DEFAULT_SERVER).replace(/\/$/, "");
}
/** 토큰 마스킹 — 로그에 쓸 때만. */
export const maskToken = (t) => (t ? `${String(t).slice(0, 8)}…${String(t).slice(-4)}` : "(없음)");

async function call(pathname, token, body, timeoutMs = 30_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${serverBase()}${pathname}`, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json; charset=utf-8", "x-runner-token": token, "User-Agent": `ac-runner/${VERSION}` },
      body: JSON.stringify(body ?? {}),
    });
    let json = null;
    try { json = await r.json(); } catch { /* 본문 없음 */ }
    if (r.status === 401) return { ok: false, status: 401, error: "러너 토큰이 올바르지 않아요. 앱에서 기기를 다시 등록해 주세요." };
    if (!r.ok) return { ok: false, status: r.status, error: String(json?.error ?? `서버 오류 ${r.status}`) };
    return json ?? { ok: false, error: "빈 응답" };
  } catch (e) {
    return { ok: false, status: 0, error: `서버에 연결하지 못했어요(${String(e?.message ?? e).slice(0, 80)})` };
  } finally { clearTimeout(timer); }
}

export const heartbeat = (token, body) => call("/api/runner-heartbeat", token, { version: VERSION, ...body });
export const claim = (token, kinds, max) => call("/api/runner-queue", token, { action: "claim", kinds, max });
export const report = (token, jobId, result) => call("/api/runner-queue", token, { action: "report", jobId, result });
export const release = (token, jobId, reason) => call("/api/runner-queue", token, { action: "release", jobId, reason });
export const uploadSession = (token, accountId, cookies, verifiedAt) =>
  call("/api/runner-session-upload", token, { accountId, cookies, verifiedAt });
