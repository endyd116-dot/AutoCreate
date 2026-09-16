/**
 * scripts/types.d.ts — 🔴 **«타입이 없는 것»을 «타입이 없다»고 적는 곳**(2026-09-16 B2).
 *
 * ══ 왜 이 파일이 있나 ══
 *   `tsconfig` 에 `scripts/**` 를 넣자 17건이 떴고 **10건이 여기 것**이었다.
 *   그런데 그 10건은 **결함이 아니다** — «우리가 그렇게 두기로 한 것»이다:
 *
 *   🔴 **러너(`runner/**.mjs`)는 고객 PC 에서 도는 `.mjs` 라 빌드를 안 거친다.** zip 으로 내려가 그대로 실행된다 —
 *      그게 설계다(빌드 단계를 넣으면 고객 PC 에 node 툴체인이 필요해진다).
 *      ⇒ 여기에 **손으로 타입을 붙이면 «정의는 있는데 실물과 다른 것»**이 생긴다. 러너를 고칠 때마다 타입도 같이
 *         고쳐야 하는데 안 고치면 **타입이 옛 모양을 말하고**, 그걸 믿은 하니스가 **옛 모양을 재게 된다.**
 *         그게 2026-09-16 하루에 우리를 여덟 번 속인 바로 그 모양이다(AC-87·AC-78).
 *      ⇒ 🔴 **`any` 는 게으름이 아니라 «모른다»를 «모른다»로 두는 결정이다.** 지어낸 타입보다 정직하다.
 *
 *   ⚠️ 그래서 이 파일이 하는 일은 **타입을 주는 것이 아니라 «없다»를 선언하는 것**이다.
 *      타입이 필요해지면 그때는 **러너를 TS 로 옮기는 일**이지 여기에 손으로 적는 일이 아니다.
 *
 * ══ 🔴 지금 타입검사가 **안 보는 것** (알고 두는 것이다) ══
 *   · `scripts/**.mjs` **50개**는 검사 **밖**이다 — `allowJs` 를 안 켰다(켜면 또 다른 크기다).
 *     ⇒ 「`.mts` 는 재고 `.mjs` 는 안 잰다」가 **지금의 사실**이다. 다음 사람이 «전부 검사받는다»고 믿지 않게 여기 적는다.
 *     남은 일은 `docs/active/B2-HANDOFF.md` 에 적어 뒀다.
 *   · `runner/**` 는 `exclude` 라 애초에 검사 밖이다(위 이유 그대로).
 */

/* ─── 러너 모듈 — 고객 PC 에서 도는 `.mjs`(빌드 없음 · 타입 없음이 **의도**다) ─── */
declare module "*/runner/lib/plan.mjs";
declare module "*/runner/lib/money.mjs";
declare module "*/runner/lib/recipe.mjs";
declare module "*/runner/lib/capture-slice.mjs";
declare module "*/runner/lib/format-bleed.mjs";
declare module "*/runner/channels/render-video.mjs";
declare module "*/runner/channels/naver-blog.mjs";
declare module "*/runner/channels/tistory.mjs";

/* ─── 하니스 공용 `.mjs` — 검사 도구끼리 쓰는 것(제품이 아니다) ─── */
declare module "*find-playwright.mjs";

declare module "*tiny-dom.mjs";

/**
 * 🔴 `playwright` 는 **루트에 없다 — 러너 폴더에만 있다**(`runner/node_modules`). 일부러 그렇다:
 *   브라우저를 쓰는 것은 러너뿐이고, 서버 배포(Netlify)에 200MB 를 끌고 갈 이유가 없다.
 *   ⇒ 브라우저를 쓰는 하니스는 **`runner/node_modules` 가 있는 폴더에서만 돈다**(트리거의 그 줄).
 *      타입만 없다고 적어 두고, **못 찾으면 그 하니스가 «못 쟀다»로 떨어진다**(«틀렸다»가 아니라).
 */
declare module "playwright";
