/**
 * runner/lib/api.mjs — 서버 큐 클라이언트(계약 §2) + 설정 읽기. 의존성 0(node 20 fetch).
 *   🔴 토큰은 파일(`runner/.token`)·env·인자에서만 읽고 **로그에 찍지 않는다**(찍으면 그 로그가 곧 계정 열쇠다).
 */
import { spawnSync } from "node:child_process";
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
/**
 * 열쇠 저장 — 🔴 **권한을 «좁혔다»고 믿으면 안 된다. 플랫폼이 무시한다**(R8 §3.1 · 2026-09-15 실측).
 *
 *   종전엔 `mode: 0o600` 한 줄이 전부였다. 그런데 **Windows 는 POSIX 모드를 안 본다** —
 *   실제 디스크에서 `.token` 은 **`-rw-r--r--`(644)** 였다. 즉 **같은 PC 를 쓰는 다른 사람이 그냥 읽는다.**
 *   그 사람은 **같은 기기라 지문도 맞으므로** 서버의 기기 구속으로도 안 막힌다 — 열쇠 하나면 계정 자격이 나간다.
 *   ⇒ Windows 에서는 `icacls` 로 **현재 사용자만** 읽게 좁힌다(외부 의존성 0 · OS 기본 명령).
 *   ⚠️ 못 좁혔으면 **조용히 넘어가지 않는다** — 한 줄 남긴다(«했다»고 믿게 두는 것이 제일 나쁘다).
 */
export function saveToken(token) {
  fs.writeFileSync(TOKEN_FILE, String(token).trim() + "\n", { encoding: "utf8", mode: 0o600 });
  const r = restrictTokenAcl(TOKEN_FILE);
  if (!r.ok) console.log(`  · [주의] 열쇠 파일 권한을 좁히지 못했어요(${r.why}) — 이 PC 를 함께 쓰는 사람이 있으면 «${TOKEN_FILE}» 를 확인해 주세요.`);
}

/**
 * restrictTokenAcl — Windows 에서 파일 권한을 현재 사용자만으로 좁힌다. 다른 OS 는 0600 이 실제로 걸리므로 그대로 둔다.
 *   @returns { ok:true } | { ok:false, why } — **«모른다»를 «됐다»로 바꾸지 않는다**(AC-9).
 */
export function restrictTokenAcl(file) {
  if (process.platform !== "win32") return { ok: true };               // POSIX 는 위의 0600 이 진짜로 걸린다
  const user = process.env.USERNAME ? `${process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\` : ""}${process.env.USERNAME}` : "";
  if (!user) return { ok: false, why: "사용자 이름을 못 읽었어요" };
  try {
    /* `/inheritance:r` = 상속받은 권한(= Users 그룹 읽기)을 끊고, `/grant:r` = 나만 전체 권한.
       셸을 안 거친다(shell:false) — 사용자 이름에 공백·특수문자가 있어도 안전하다. */
    const r = spawnSync("icacls", [file, "/inheritance:r", "/grant:r", `${user}:F`], { encoding: "utf8", shell: false, timeout: 15_000 });
    if (r.error) return { ok: false, why: String(r.error.message ?? r.error).slice(0, 60) };
    if (r.status !== 0) return { ok: false, why: `icacls 종료코드 ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, why: String(e?.message ?? e).slice(0, 60) };
  }
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
