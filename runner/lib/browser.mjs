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
  /* 🔴 **fail-closed**(계약 P1R7 §2.5-3 · 사장님 지시 «계정 하나 = IP 하나»).
     종전엔 주소가 깨지면 `catch` 로 삼키고 **프록시 없이 그냥 나갔다** — 주석은 «발행을 막지 않는다» 였지만,
     그게 정확히 사장님이 걱정하는 **연좌제**를 만든다: 이 계정이 우리 집 IP 로 나가 버리고,
     그 IP 엔 다른 계정들도 함께 있어서 하나가 정지되면 같이 물린다. 그때는 «왜 묶였는지»조차 알 수 없다.
     **프록시를 배정받은 계정은 프록시 없이는 절대 안 나간다.** 실패는 던진다(잡이 중단되고 사람이 본다).
     ⚠️ 프록시가 **없는** 계정은 지금처럼 그대로 직결이다 — 소급 적용 0(쓰던 사람이 갑자기 멈추지 않는다). */
  if (proxyUrl) {
    let u;
    try { u = new URL(proxyUrl); }
    catch { throw new Error(`PROXY_BAD_URL: 이 계정에 배정된 IP 주소를 읽지 못했어요(형식 오류) — 남의 IP 로 나가지 않도록 멈췄어요.`); }
    if (!/^(https?|socks[45]?):$/i.test(u.protocol) || !u.hostname) {
      throw new Error(`PROXY_BAD_URL: 이 계정에 배정된 IP 주소가 올바르지 않아요(${u.protocol}//…) — 멈췄어요.`);
    }
    opts.proxy = { server: `${u.protocol}//${u.host}` };
    if (u.username) opts.proxy.username = decodeURIComponent(u.username);
    if (u.password) opts.proxy.password = decodeURIComponent(u.password);
  }
  const ctx = await chromium.launchPersistentContext(dir, opts);
  ctx.setDefaultTimeout(20_000);
  ctx.setDefaultNavigationTimeout(45_000);
  /* 🔴 2026-09-15 실측(티스토리 HTML 모드): Playwright 는 핸들러가 없으면 `confirm()` 을 **자동으로 «취소»** 한다.
     티스토리가 «작성 모드를 변경하시겠습니까?» 를 띄우고 있었는데 우리는 매번 조용히 취소를 눌렀고,
     화면·로그 어디에도 흔적이 없어 **이틀을 엉뚱한 셀렉터만 뒤졌다**(PITFALLS #7 조용한 누락).
     동작은 그대로 둔다(자동 승인은 위험하다 — «발행하시겠습니까»까지 눌러 줄 수 있다). 대신 **보이게** 한다:
     뜬 확인창은 채널이 모르고 지나가더라도 여기서 한 줄로 남는다. 승인이 필요한 곳은 채널이 직접 `page.on("dialog")` 를 건다. */
  /* ⚠️ 함정 안의 함정: 리스너를 **하나라도** 달면 Playwright 의 자동 처리가 꺼진다.
     로그만 찍고 아무도 안 받으면 페이지가 확인창에서 **영영 멎는다**(발행이 통째로 죽는다).
     그래서 로그 + «조금 늦은 취소»다 — 채널이 먼저 받으면(accept) 이 취소는 조용히 실패하고,
     아무도 안 받으면 종전과 똑같이 취소된다. 동작은 그대로, 흔적만 생긴다. */
  const watchDialogs = (p) => p.on("dialog", (d) => {
    if (d.type() !== "beforeunload") {
      console.log(`  · [확인창] ${d.type()}«${String(d.message() ?? "").replace(/\s+/g, " ").slice(0, 90)}» → 채널이 안 받으면 취소`);
    }
    setTimeout(() => { d.dismiss().catch(() => {}); }, 400);
  });
  /* 🔴 `ctx.on("page")` 는 **런치 때 이미 있던 첫 페이지에는 안 걸린다** — 그런데 러너가 쓰는 게 바로 그 페이지다.
     이것만 달아 두면 «감시하고 있다»고 믿으면서 실은 아무것도 안 보는 거짓 안전망이 된다. 둘 다 건다. */
  ctx.pages().forEach(watchDialogs);
  ctx.on("page", watchDialogs);
  return ctx;
}

/**
 * 이 컨텍스트가 쓴 **실제 트래픽**을 센다(계약 P1R7 §2.5 원가표 — 메인 발주 2026-09-15).
 *
 *   왜 필요한가: 프록시 요금이 «IP 당»이냐 «GB 당»이냐로 갈리는데, 지금 원가표는 «글 1건 = 20~40MB»라는
 *   **가정**으로 서 있다. 그 가정이 2배만 틀려도 어느 쪽이 싼지가 뒤집힌다 — 그러니 재야 한다.
 *
 *   🔴 **받은 바이트는 CDP `Network.dataReceived`(encodedDataLength)** — 실제 전선 위 바이트다.
 *      `response.body().length` 로 세면 **압축 풀린 크기**라 과대계상된다(gzip 이 3~5배).
 *   ⚠️ 보낸 바이트는 정확한 신호가 없어 **요청 본문 길이의 합**으로 근사한다(헤더·TLS 는 못 센다).
 *      이미지 업로드가 업링크의 거의 전부라 이 근사로도 «몇 MB 냐»는 맞는다 — 그 한계를 표에 같이 적는다.
 *   끄고 켤 수 있게 둔다(`RUNNER_METER=0`) — 계측이 문제를 만들면 계측부터 끌 수 있어야 한다.
 */
export function meterContext(ctx) {
  const m = { rx: 0, tx: 0, requests: 0, attached: 0 };
  if (String(process.env.RUNNER_METER ?? "1") === "0") return m;
  const attach = async (page) => {
    try {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Network.enable");
      cdp.on("Network.dataReceived", (e) => { m.rx += Number(e.encodedDataLength || 0); });
      cdp.on("Network.requestWillBeSent", (e) => {
        m.requests++;
        const pd = e?.request?.postData;
        if (typeof pd === "string") m.tx += Buffer.byteLength(pd, "utf8");
        else if (Number(e?.request?.postDataEntries?.length)) {
          for (const x of e.request.postDataEntries) if (x?.bytes) m.tx += Buffer.from(String(x.bytes), "base64").length;
        }
      });
      m.attached++;
    } catch { /* 계측 실패로 잡을 막지 않는다 — 없는 숫자는 0 이 아니라 «못 쟀다»로 다룬다(호출부가 attached 로 판단) */ }
  };
  ctx.pages().forEach(attach);
  ctx.on("page", attach);
  return m;
}

/**
 * 지금 이 브라우저가 **실제로 어느 IP 로 나가는가**(계약 P1R7 §2.5-4).
 *
 *   🔴 왜 필요한가: 프록시를 «걸었다»와 «그 IP 로 나간다»는 다르다. 프록시가 죽거나 인증이 막히면
 *      Chromium 이 조용히 실패하거나 우회하는 경우가 있고, 그러면 우리는 **프록시를 쓴다고 믿으면서
 *      집 IP 로 계정을 굴린다** — 사장님이 걱정하는 연좌제가 «우리도 모르게» 성립한다.
 *      그래서 **믿지 않고 물어본다.** 이 한 번의 확인이 유일한 증거다.
 *   🔴 **브라우저 컨텍스트로** 물어야 한다(node fetch 로 물으면 러너 PC 의 IP 가 나온다 — 아무 의미가 없다).
 *   못 읽으면 `null`(네트워크가 잠깐 나쁠 수 있다) — 호출부가 «모름»과 «다름»을 구분한다(AC-9).
 */
export async function exitIp(ctx, timeoutMs = 8000) {
  const page = await ctx.newPage();
  try {
    const r = await page.goto("https://api.ipify.org?format=json", { timeout: timeoutMs, waitUntil: "domcontentloaded" });
    if (!r || !r.ok()) return null;
    const txt = await page.evaluate(() => document.body?.innerText ?? "");
    const ip = String(JSON.parse(txt)?.ip ?? "").trim();
    return /^[0-9a-f.:]{3,45}$/i.test(ip) ? ip : null;
  } catch { return null; }
  finally { await page.close().catch(() => {}); }
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
