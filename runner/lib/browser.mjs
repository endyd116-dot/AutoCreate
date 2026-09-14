/**
 * runner/lib/browser.mjs — 브라우저 컨텍스트·스냅샷·이미지 내려받기.
 *   AM 원본: ../AutoMarketing/scripts/content-runner-core.mjs(세션·프로필·이미지 다운로드 관례 이식 2026-09-14).
 *
 *   🔴 AC-3(세션 섞임) — 계정마다 **영구 프로필 폴더**(`runner/profiles/{profileKey}`)를 쓰고,
 *      **피스(잡)마다 새 컨텍스트**를 열고 끝나면 닫는다. 컨텍스트를 재사용하면 다른 계정에 글이 올라간다.
 *      «계정 N개» 제품에서 이건 미관 문제가 아니라 **사고**다.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./api.mjs";

export const PROFILES_DIR = path.join(ROOT, "profiles");
export const SHOTS_DIR = path.join(ROOT, "_shots");
export const TMP_DIR = path.join(ROOT, "tmp");
export const SHOTS_ON = String(process.env.RUNNER_SHOTS ?? "") === "1";

const safe = (s) => String(s ?? "").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64) || "default";

export function profileDir(profileKey) {
  const dir = path.join(PROFILES_DIR, safe(profileKey));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * openContext — 잡 1건용 영구 컨텍스트. 끝나면 반드시 close().
 *   headed: 사람이 봐야 하는 잡(세션 로그인)·`--headed` 일 때 true.
 */
export async function openContext({ chromium }, { profileKey, proxyUrl, headed, locale = "ko-KR" }) {
  const dir = profileDir(profileKey);
  const opts = {
    headless: !headed,
    locale,
    timezoneId: "Asia/Seoul",
    viewport: { width: 1440, height: 960 },
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"],
  };
  if (proxyUrl) {
    try {
      const u = new URL(proxyUrl);
      opts.proxy = { server: `${u.protocol}//${u.host}` };
      if (u.username) opts.proxy.username = decodeURIComponent(u.username);
      if (u.password) opts.proxy.password = decodeURIComponent(u.password);
    } catch { /* 프록시 주소가 깨졌으면 프록시 없이(발행을 막지 않는다 · 로그만) */ }
  }
  const ctx = await chromium.launchPersistentContext(dir, opts);
  ctx.setDefaultTimeout(20_000);
  ctx.setDefaultNavigationTimeout(45_000);
  return ctx;
}

/** claim 이 준 쿠키를 컨텍스트에 심는다(로그인 단계 건너뛰기). 모양이 안 맞는 쿠키는 건너뛴다. */
export async function applyCookies(ctx, cookies) {
  if (!Array.isArray(cookies) || !cookies.length) return 0;
  const ok = cookies
    .filter((c) => c && typeof c === "object" && c.name && c.value)
    .map((c) => {
      const o = { name: String(c.name), value: String(c.value), path: String(c.path || "/") };
      if (c.domain) o.domain = String(c.domain); else if (c.url) o.url = String(c.url);
      if (!o.domain && !o.url) return null;
      if (Number.isFinite(Number(c.expires)) && Number(c.expires) > 0) o.expires = Number(c.expires);
      if (typeof c.httpOnly === "boolean") o.httpOnly = c.httpOnly;
      if (typeof c.secure === "boolean") o.secure = c.secure;
      if (c.sameSite && ["Strict", "Lax", "None"].includes(String(c.sameSite))) o.sameSite = String(c.sameSite);
      return o;
    })
    .filter(Boolean);
  if (!ok.length) return 0;
  try { await ctx.addCookies(ok); return ok.length; } catch { return 0; }
}

/** 단계 스냅샷(눈검사) — RUNNER_SHOTS=1 일 때만. 반환 = shotKey(실패 보고에 실린다). */
export function shotKeyFor(jobId) { return `job-${jobId}-${Date.now().toString(36)}`; }

export async function shot(page, shotKey, step, fullPage = false) {
  if (!SHOTS_ON || !page) return null;
  try {
    const dir = path.join(SHOTS_DIR, safe(shotKey));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${String(step).replace(/[^A-Za-z0-9가-힣_-]/g, "_").slice(0, 40)}.png`);
    await page.screenshot({ path: file, fullPage });
    return file;
  } catch { return null; }
}

/** 실패 스냅샷은 RUNNER_SHOTS 와 무관하게 남긴다 — «무엇에 막혔나»는 화면을 봐야 안다. */
export async function failShot(page, shotKey) {
  if (!page) return null;
  try {
    const dir = path.join(SHOTS_DIR, safe(shotKey));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "FAIL.png");
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch { return null; }
}

/** 이미지 내려받기 — 에디터는 «파일»을 받는다(URL 이 아니라). 실패한 장은 null(글은 계속 나간다). */
export async function downloadImages(urls) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const out = new Map();
  for (const url of urls) {
    if (!url || out.has(url)) continue;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) { out.set(url, null); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length || buf.length > 15 * 1024 * 1024) { out.set(url, null); continue; }
      const ct = String(r.headers.get("content-type") ?? "");
      const ext = /png/i.test(ct) ? "png" : /webp/i.test(ct) ? "webp" : /gif/i.test(ct) ? "gif" : "jpg";
      const file = path.join(TMP_DIR, `img-${Date.now().toString(36)}-${out.size}.${ext}`);
      fs.writeFileSync(file, buf);
      out.set(url, file);
    } catch { out.set(url, null); }
  }
  return out;
}

/** 잡이 끝나면 내려받은 파일을 치운다(디스크가 조용히 차지 않게). */
export function cleanupFiles(fileMap) {
  for (const f of fileMap?.values?.() ?? []) { if (f) { try { fs.unlinkSync(f); } catch { /* 무시 */ } } }
}

/** 사람처럼 잠깐 쉰다(기계적 등간격 클릭을 피한다 — AM 봇탐지 완화 관례). */
export const settle = (page, min = 400, max = 0) =>
  page.waitForTimeout(max > min ? min + Math.floor(Math.random() * (max - min)) : min).catch(() => {});
