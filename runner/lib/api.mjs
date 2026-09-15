/**
 * runner/lib/api.mjs — 서버 큐 클라이언트(계약 §2) + 설정 읽기. 의존성 0(node 20 fetch).
 *   🔴 토큰은 파일(`runner/.token`)·env·인자에서만 읽고 **로그에 찍지 않는다**(찍으면 그 로그가 곧 계정 열쇠다).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* 🔴 버전은 **여기와 package.json 두 곳**에 있다. 빌더가 읽는 건 package.json 이고 서버에 보고되는 건 이 값이라,
   어긋나면 «서버는 새 판이라는데 러너는 갱신 안 됨»이 영원히 반복된다. 그래서 package.json 을 읽어 온다. */
export const VERSION = (() => {
  try { return String(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version || "0.0.0"); }
  catch { return "0.0.0"; }
})();

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

/**
 * 기기 지문 — 「이 토큰이 **다른 PC** 에서 켜졌다」를 알아채기 위한 값(계약 «묶기» ②).
 *   호스트명 + 첫 물리 MAC 을 해시한다. 🔴 **원본을 보내지 않는다** — 해시만 보낸다.
 *   그래야 서버(와 서버를 들여다보는 사람)가 고객 PC 의 이름·MAC 을 알지 못한다. 필요한 건 «같나 다르나» 뿐이다.
 *   완벽한 자물쇠가 아니다(고치려면 고칠 수 있다). 목적은 «복사해서 열 명이 나눠 쓰기»를 **눈에 띄게** 만드는 것이다.
 */
export function deviceFingerprint() {
  const macs = Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && !n.internal && n.mac && n.mac !== "00:00:00:00:00:00")
    .map((n) => n.mac).sort();
  const seed = `${os.hostname()}|${macs[0] ?? "no-mac"}|${os.platform()}`;
  return crypto.createHash("sha256").update(seed, "utf8").digest("hex");
}

async function call(pathname, token, body, timeoutMs = 30_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${serverBase()}${pathname}`, {
      method: "POST", signal: ctrl.signal,
      /* 🔴 지문은 **모든 요청의 헤더**로 간다(하트비트 본문이 아니다 · 2026-09-15 실측으로 잡은 구멍).
         서버는 인증 자리에서 지문을 보므로, 하트비트에만 실으면 복사본이 하트비트를 건너뛰고
         `claim` 만 때려도 그대로 통과한다 — 관문이 아니라 장식이 된다(AC-35). */
      headers: { "Content-Type": "application/json; charset=utf-8", "x-runner-token": token, "x-runner-fp": deviceFingerprint(), "User-Agent": `ac-runner/${VERSION}` },
      body: JSON.stringify(body ?? {}),
    });
    let json = null;
    try { json = await r.json(); } catch { /* 본문 없음 */ }
    /* 🔴 401 을 한 문구로 뭉치지 않는다(2026-09-15 실측으로 잡음). 서버는 «토큰이 틀렸다»와
       «이 열쇠는 다른 PC 에 묶여 있다»를 구분해서 말해 주는데, 여기서 덮어쓰면 고객은 엉뚱한 일을 하게 된다
       (토큰을 다시 복사해 넣으며 «왜 안 되지»를 반복한다 · AC-10 우리 탓/계정 탓 가르기와 같은 규율). */
    if (r.status === 401) return { ok: false, status: 401, error: String(json?.error || "러너 열쇠가 올바르지 않아요. 앱에서 기기를 다시 등록해 주세요.") };
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
