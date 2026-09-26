/**
 * lib/site-url.ts — «이 사이트의 주소»는 **두 가지**다. 하나로 합치면 둘 중 하나가 반드시 틀린다(B2 지적 · 메인 채택 2026-09-15).
 *   AC 신규(B-1 · PITFALLS AC-53·AC-54 의 짝). 순수(임포트 0).
 *
 *   ══ 왜 갈라야 하나 ══
 *     · 서버가 **자기 자신의 배경 함수**를 부를 때(`…-background`)는 «지금 돌고 있는 이 배포»가 맞다.
 *       로컬 `netlify dev` 에서 라이브를 부르면 스텁이 안 먹은 채로 **진짜 Veo·TTS 가 돈다**(2026-09-15 B-1 실측 $3.63 · AC-53/54).
 *     · 고객에게 **보여 주고 남는 주소**(러너 설치 안내·메일 링크·OAuth 콜백)는 «정본 사이트»가 맞다.
 *       배포 프리뷰에서 `URL` 을 쓰면 며칠 뒤 죽는 프리뷰 주소가 고객 안내에 박힌다.
 *
 *   ══ 환경변수(Netlify 가 넣어 준다) ══
 *     `URL` = 사이트 정본 주소(배포마다 같음) · `DEPLOY_PRIME_URL` = 이 배포(프리뷰면 프리뷰 주소) · `NETLIFY_DEV` = netlify dev 안이면 "true".
 *     `SITE_URL` = 우리가 .env 에 적어 둔 정본. 🔴 로컬 .env 에도 **라이브 주소**가 들어 있다 — 그래서 자기 호출에 이걸 먼저 보면 안 된다.
 */

const strip = (v: unknown) => String(v ?? "").trim().replace(/\/+$/, "");
const hostOf = (base: string): string => { try { return new URL(base).hostname.toLowerCase(); } catch { return ""; } };
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** netlify dev 안인가(함수 런타임에 `NETLIFY_DEV=true` 가 들어온다). */
export function isNetlifyDev(): boolean {
  const v = String(process.env.NETLIFY_DEV ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

/**
 * 🔴 [2026-09-26 · C · 메인 발주] **Netlify 함수 런타임 안인가** — 배포가 넣어 주는 표지로만 판정한다.
 *   · `URL`·`DEPLOY_PRIME_URL` — Netlify 가 **함수 런타임에** 넣는다(🔎 라이브 `/api/health` 실측 2026-09-26: `deploy` =
 *     `URL||DEPLOY_PRIME_URL` = `https://autocreate-endyd.netlify.app`). 🔴 우리 `.env` 에는 **없다**(키 이름으로 확인) — 스크립트엔 안 들어온다.
 *   · `AWS_LAMBDA_FUNCTION_NAME`·`LAMBDA_TASK_ROOT`·`NETLIFY=true` — 람다/빌드 표지(보조 · 라이브에서 따로 재지는 못했다).
 *   ⚠️ 알고 두는 구멍: 스크립트가 `URL` 을 **손으로 라이브 주소로** 넣으면 이 판정은 «런타임»으로 읽는다(그 경우는 못 막는다).
 *      지금 `URL` 을 넣는 자(`verify-e2e-rehearsal`·`verify-piece-sweep`)는 전부 **로컬 스텁 주소**다.
 */
export function isDeployRuntime(): boolean {
  const e = process.env;
  return !!(strip(e.URL) || strip(e.DEPLOY_PRIME_URL) || strip(e.AWS_LAMBDA_FUNCTION_NAME) || strip(e.LAMBDA_TASK_ROOT) || String(e.NETLIFY ?? "").trim().toLowerCase() === "true");
}

/**
 * **지금 돌고 있는 이 배포**의 주소 — 서버가 자기 배경 함수(`…-background`)를 부를 때만 쓴다.
 *   순서: `URL` → `DEPLOY_PRIME_URL` → `SITE_URL`.
 *   🔴 개발 안전핀: `netlify dev` 안인데 고른 주소의 호스트가 localhost/127.0.0.1 이 아니면 **던진다**.
 *      «조용히 라이브를 부르는 길»을 아예 없앤다 — 옛 서버든 .env 가 라이브든, 로컬에서는 라이브 배경 함수를 못 부른다.
 *      던지는 문장은 사람말이라 호출부가 그대로 failReason 에 실어도 된다.
 *   🔴 [2026-09-26 · C] **둘째 안전핀 — 배포 밖(스크립트)에서 라이브 주소면 던진다.**
 *      첫 안전핀은 `NETLIFY_DEV` 일 때만 섰다. `tsx`/`node` 로 돈 자·리허설은 그 값이 없어서 `.env` 의 `SITE_URL`(라이브)을
 *      그대로 돌려받았고, `INTERNAL_SECRET`(역시 `.env`)까지 실어 **라이브 `generate-video-background` 를 칠 수 있었다**
 *      — 2026-09-15 $3.63 과 같은 길이다(메인 확인: 오늘은 안 나갔다 · 구멍은 진짜). 🔴 배포 안(`isDeployRuntime`)은 **안 막는다** —
 *      라이브 영상 생성을 우리가 막으면 안 된다. 자: `scripts/verify-background-base.mts`(양팔 셋).
 */
export function backgroundBase(): string {
  const base = strip(process.env.URL) || strip(process.env.DEPLOY_PRIME_URL) || strip(process.env.SITE_URL);
  if (!base) throw new Error("서버 주소(URL·SITE_URL)가 없어 배경 작업을 시작하지 못했어요.");
  if (isNetlifyDev() && !LOCAL_HOSTS.has(hostOf(base))) {
    throw new Error(`로컬(netlify dev)에서 라이브 배경 함수를 부르려 했어요(${hostOf(base)}) — 멈췄어요. 로컬 주소로만 부를 수 있어요.`);
  }
  if (!isDeployRuntime() && !LOCAL_HOSTS.has(hostOf(base))) {
    throw new Error(`배포 밖(이 컴퓨터의 스크립트)에서 라이브 배경 함수를 부르려 했어요(${hostOf(base)}) — 멈췄어요. 스크립트에서는 URL 을 로컬 스텁 주소로 두세요.`);
  }
  return base;
}

/**
 * **고객에게 보여 주고 남을 주소** — 러너 설치 안내·메일 링크·OAuth 콜백처럼 사람 손에 남는 곳에만 쓴다.
 *   순서: `SITE_URL` → `URL` → 기본값(라이브). **던지지 않는다**(안내문이 빈칸이 되는 것보다 정본 주소가 낫다).
 *   ⚠️ 배경 함수 호출에 쓰면 안 된다 — 로컬에서 라이브를 부른다(`backgroundBase` 를 써라).
 */
export function publicBase(): string {
  return strip(process.env.SITE_URL) || strip(process.env.URL) || "https://autocreate-endyd.netlify.app";
}
