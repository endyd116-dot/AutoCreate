/**
 * runner/channels/tistory.mjs — 티스토리 발행(신규 · Open API 는 2024-02 종료라 러너만이 길이다).
 *   AC 신규 2026-09-14(B2). 구조는 네이버 러너와 같고 **셀렉터만 티스토리 것**이다.
 *
 *   🔴 전략: **HTML 모드 우선.** 티스토리 에디터는 모드를 «기본/마크다운/HTML» 로 고를 수 있고,
 *      HTML 모드에서는 `bodyHtml`(§4B 렌더 계약 정본)을 **그대로** 넣을 수 있다 —
 *      한 글자씩 연주하는 것보다 서식이 정확하고, 셀렉터 의존도 훨씬 낮다(도구모음을 안 건드린다).
 *      HTML 모드를 못 열면 기본 모드에서 ops 를 연주하는 폴백으로 내려앉는다(글은 나간다 · 장식은 준다).
 *
 *   🔴 로그인은 **두 길**이다: 티스토리 자체 아이디 · **카카오 계정**(실측상 다수가 이쪽).
 *      카카오 경로는 자동 로그인을 시도하되, **캡차·2단계·기기 확인이 뜨면 즉시 정직 실패**하고
 *      헤드풀 재로그인(session.login)으로 보낸다 — 자동으로 뚫으려 들면 계정이 잠긴다.
 */
import { shot, failShot, settle, downloadImages, cleanupFiles } from "../lib/browser.mjs";
import { BLOCK, KAKAO_AUTH_HOST, kakaoLogin } from "../lib/auth-kakao.mjs";   // 카카오 로그인은 공용(애드핏과 같은 세션)


const B_TITLE = '#post-title-inp, input[placeholder*="제목"], .textarea_tit';
/* 🔴 실측 정정(2026-09-15 job #214 · 사장님 화면 확인 «메뉴 열려서 기본모드가 선택돼 있었다»):
   모드 메뉴는 DOM 에 **두 벌**이다.
     ① `#editor-mode-html-tistory` … 조상이 전부 `[0,0,0,0]` · 패널 `display:none` 인 **죽은 복제본**
     ② `#editor-mode-html` (`.mce-tistory-mode-item`) … `[982,71,116,30]` 에 실제로 그려지는 **진짜**
   접미사 `-tistory` 가 «정답»이라던 앞선 주석은 **틀렸다** — 그건 복제본이다.
   그래서 «메뉴가 열렸나»를 복제본으로 판정해 «안 열렸다»로 읽고 버튼을 계속 눌러 **열었다 닫았다만** 했다.
   판정도 클릭도 **보이는 쪽**으로 한다(`querySelectorAll`·`.first()` 는 숨은 것도 집는다 — 그게 이 사고의 뿌리다). */
const B_MODE_OPEN = "#editor-mode-layer-btn-open, #editor-mode-layer-btn, button:has-text('기본모드'), .btn_editor_mode";
/* 여는 순서대로 = 진짜 → 관계기반 → 죽은 복제본(최후). 고르는 건 언제나 **보이는 것**. */
const B_HTML_ITEMS = ["#editor-mode-html", "div.mce-tistory-mode-item:has-text('HTML')", "[data-mode='html']", "#editor-mode-html-tistory"];

const B_CM = ".CodeMirror";
/* 실측(2026-09-14 job #74 · TinyMCE 티스토리 에디터): 하단에 «임시저장 N»(저장) · «완료»(발행 레이어 열기),
   우상단에 «기본모드 ∨»(모드 전환). 텍스트가 자식 span 에 있어 :has-text 가 못 잡을 수 있어 getByText 폴백을 함께 쓴다. */
const B_DONE = "#publish-layer-btn, button:has-text('완료'), a:has-text('완료')";
const B_SAVE = "#save-btn, button:has-text('임시저장'), a:has-text('임시저장'), .btn_save, [class*='save']";
/* 🔴 2026-09-15 실측으로 잡은 폭탄: `:has-text()` 는 **부분일치**라 `button:has-text('공개')` 가 **«비공개»를 집는다**
   (Playwright 로 직접 확인: `<button>비공개</button>` 가 그 셀렉터에 걸린다).
   발행 레이어에는 «공개/비공개/보호» 가 나란히 있으므로, 옛 목록대로면 **실발행 첫 시도에 «비공개»를 눌러**
   «발행했는데 아무도 못 보는 글»이 될 수 있었다 — 그러고도 URL 은 생기니 **성공으로 보고**된다(제일 나쁜 실패).
   그래서 «공개»라는 느슨한 후보를 **뺐다**. 남긴 것은 전부 «발행» 동작을 뜻하는 것뿐이다. */
const B_PUBLISH = "#publish-btn, .btn_publish, button:has-text('공개 발행'), button:has-text('발행하기'), button:has-text('발행')";

/* ═══ [P1R8 §3.3] 셀렉터 표 — 🔴 **여기 값은 «묶여 온 표»(zip 안의 기본값)다** ═══
   서버가 서명된 표를 내려 주면 그 칸이 이깁니다. 못 주거나 못 믿으면 **이 값 그대로** 돕니다
   (`runner/lib/recipe.mjs` · «배포는 편의고 발행이 본업»).
   🔴 `S` 가 모듈 변수인 것이 안전한 이유: 러너는 잡을 **한 건씩 순차로** 돈다(`core.mjs tick` 의 `for … await`).
      동시에 두 잡을 돌리게 되는 날엔 **여기를 먼저 고쳐야 한다** — 그래서 적어 둔다. */
export const BUNDLED_SELECTORS = {
  title: B_TITLE, modeOpen: B_MODE_OPEN, htmlItems: B_HTML_ITEMS.join(", "),
  codemirror: B_CM, done: B_DONE, save: B_SAVE, publish: B_PUBLISH,
};
let S = { ...BUNDLED_SELECTORS };
/** 후보 목록이 필요한 자리(«보이는 것»을 고르려면 낱개로 봐야 한다 · AC-43). */
const htmlItems = () => String(S.htmlItems || "").split(",").map((x) => x.trim()).filter(Boolean);

/** [R17-B2] `session.verify` 도 같은 규칙으로 호스트를 만든다(커스텀 도메인 포함) — 두 벌로 적지 않는다. */
export function blogHost(handle) {
  const h = String(handle ?? "").replace(/^@/, "").trim();
  if (!h) return null;
  if (/^https?:\/\//i.test(h)) { try { return new URL(h).host; } catch { return null; } }
  if (h.includes(".")) return h;                       // 커스텀 도메인 또는 xxx.tistory.com
  return `${h}.tistory.com`;
}

/**
 * [R17-B2 · 2026-09-23] 🔴 **`export` 를 붙였다 — `session.verify` 가 이 판정을 그대로 쓴다.**
 *   옮기지 않고 **잰 자리에 둔다**: 이 셀렉터는 티스토리 발행을 실제로 통과시키면서 얻은 것이고,
 *   복사해 두 벌이 되면 한쪽만 늙는다(채널 표가 네 곳이었던 것과 같은 병 · `lib/channel-registry.ts` 머리말).
 *   🔴 추측한 판정을 `session-verify.mjs` 에 새로 적지 않는다 — 그게 이 프로젝트에서 제일 비싼 실수였다.
 */
export async function isLoggedIn(page, host) {
  try {
    await page.goto(`https://${host}/manage`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const url = page.url();
    if (/auth\/login|accounts\.kakao\.com/i.test(url)) return false;
    return (await page.locator("#kakaoHead, .wrap_admin, #mArticle, [class*='admin']").count().catch(() => 0)) > 0 || /\/manage/i.test(url);
  } catch { return false; }
}


/** 티스토리 자체 아이디 로그인. 카카오 경로면 위 함수로 넘어간다. */
async function loginWithIdPw(page, id, pw, shotKey) {
  await page.goto("https://www.tistory.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  if (/accounts\.kakao\.com/i.test(page.url()) || String(process.env.AC_TISTORY_LOGIN ?? "") === "kakao") {
    return kakaoLogin(page, id, pw, shotKey);
  }
  const idBox = page.locator("#loginId, input[name='loginId'], input[type='email']").first();
  if (!(await idBox.isVisible({ timeout: 6000 }).catch(() => false))) {
    throw BLOCK("login_fail", "티스토리 로그인 화면을 찾지 못했어요. 앱에서 «다시 로그인»을 눌러 주세요.");
  }
  await idBox.fill(id).catch(() => {});
  await page.locator("#loginPw, input[name='password'], input[type='password']").first().fill(pw).catch(() => {});
  await page.locator("button[type='submit'], .btn_login, button:has-text('로그인')").first().click({ timeout: 8000 }).catch(() => {});
  await settle(page, 4000);
  // 🔴 여기도 «보이는 글자»로 — 원본 HTML 에는 스크립트·클래스명에 captcha 가 흔히 들어 있다(AC-10 · 거짓 안내 방지).
  const seenSelf = ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  if (/자동입력 방지|보안문자|캡차/.test(seenSelf)) throw BLOCK("captcha", "티스토리가 자동입력 방지를 띄웠어요.");
  if (/auth\/login/i.test(page.url())) throw BLOCK("login_fail", "아이디 또는 비밀번호가 맞지 않아요.");
}

/** 글쓰기 화면 진입 + 임시저장 복구 팝업 닫기. */
async function openEditor(page, host, shotKey) {
  await page.goto(`https://${host}/manage/newpost/`, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
  if (/auth\/login|accounts\.kakao\.com/i.test(page.url())) throw BLOCK("login_fail", "글쓰기에 들어가려는데 다시 로그인을 요구했어요(세션 만료).");
  await settle(page, 1800);
  // «작성 중인 글이 있습니다» 복구 팝업 — 취소(새 글로 간다).
  for (const sel of ["button:has-text('취소')", ".btn_cancel", "#mceu_cancel", "button[class*='cancel']"]) {
    try {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 1200 }).catch(() => false)) { await b.click({ timeout: 3000 }).catch(() => {}); break; }
    } catch { /* 무시 */ }
  }
  await shot(page, shotKey, "01-에디터진입");
  // 🔴 실측 DOM 덤프(RUNNER_DEBUG=1) — 이 화면은 세션이 안 남아 매번 2FA 라, 한 번 뜰 때 실제 버튼·모드·에디터 이름을 받아 적는다.
  if (process.env.RUNNER_DEBUG === "1") {
    const d = await page.evaluate(() => {
      const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${(el.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 2).join(".")}[${(el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 12)}]`;
      const btns = [...document.querySelectorAll("button, a[role='button'], [class*='btn']")].filter((e) => /저장|완료|발행|공개|모드|HTML|기본/.test(e.textContent || "")).slice(0, 20).map(desc);
      const ifr = [...document.querySelectorAll("iframe")].map((f) => f.id || f.name || "(no-id)");
      const titles = [...document.querySelectorAll("input,textarea")].filter((e) => /제목|title/i.test((e.placeholder || "") + (e.id || "") + (e.className || ""))).map(desc);
      return { btns, ifr, titles, ce: document.querySelectorAll("[contenteditable='true']").length };
    }).catch(() => null);
    console.log("  · [probe] 버튼:", JSON.stringify(d?.btns)); console.log("  · [probe] iframe:", JSON.stringify(d?.ifr), "제목칸:", JSON.stringify(d?.titles), "ce:", d?.ce);
  }
  if (!(await page.locator(S.title).first().isVisible({ timeout: 10_000 }).catch(() => false))) {
    const seen = ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    throw BLOCK("selector_changed", `글쓰기 화면을 찾지 못했어요 — url=${page.url().slice(0, 90)} · 화면="${seen.slice(0, 120)}"`);
  }
}

/**
 * HTML 모드로 전환하고 bodyHtml 을 통째로 넣는다.
 *   반환 `{ ok, step, detail? }` — 🔴 **어디서 막혔는지를 돌려준다**(AC-27).
 *   종전엔 모든 실패 경로가 `return false` 였다. 그래서 «HTML 모드를 못 열었다»만 남고
 *   ①버튼이 없는 건지 ②레이어에 HTML 항목이 없는 건지 ③확인 팝업에 막힌 건지 ④CodeMirror 가 안 뜬 건지를
 *   **영영 알 수 없었다** — 고칠 수가 없는 실패다. 단계마다 이름을 붙이고 막힌 자리의 화면을 찍는다.
 */
async function tryHtmlMode(page, bodyHtml, shotKey) {
  const fail = async (step, detail) => {
    await shot(page, shotKey, `02x-HTML모드실패-${step}`).catch(() => {});
    console.log(`  · [html-mode] 막힌 자리: ${step}${detail ? ` — ${detail}` : ""}`);
    return { ok: false, step, detail };
  };
  /* 폴백(기본 모드)을 **일부러** 태워 보는 스위치. 두 길이 다 살아 있는지 확인하는 유일한 방법이고,
     티스토리가 HTML 모드를 또 바꿔 놓았을 때 배포 없이 내려앉힐 손잡이이기도 하다. */
  if (String(process.env.AC_TISTORY_NO_HTML ?? "") === "1") {
    console.log("  · [html-mode] AC_TISTORY_NO_HTML=1 — 건너뛰고 기본 모드로 간다(폴백 점검)");
    return { ok: false, step: "disabled", detail: "AC_TISTORY_NO_HTML=1 로 껐어요(폴백 점검용)" };
  }
  /* 🔴 Playwright 는 `confirm()`·`alert()` 를 **기본값으로 «취소»** 한다(핸들러가 없으면).
     즉 티스토리가 «HTML 모드로 바꾸면 서식이 바뀔 수 있어요, 계속할까요?» 를 띄웠다면
     우리는 **매번 조용히 취소를 눌러 왔다** — 화면엔 아무 흔적도 안 남는다(PITFALLS #7 조용한 누락).
     여기서만 «수락»으로 바꾸고, **무슨 말이 떴는지 반드시 적는다**(안 떴으면 안 떴다는 것도 증거다). */
  const dialogs = [];
  const onDialog = async (d) => { dialogs.push(`${d.type()}«${String(d.message() ?? "").replace(/\s+/g, " ").slice(0, 90)}»`); await d.accept().catch(() => {}); };
  page.on("dialog", onDialog);
  try {
    /* 🔴 후보가 여럿일 땐 `locator("a, b, c").first()` 를 쓰면 **DOM 순서상 첫 요소**가 잡힌다 —
       그게 «안 보이는 것»이면 멀쩡한 뒤 후보가 있어도 실패한다(2026-09-15 실측). 그래서 하나씩 돈다.
       그런데 «보이는 것»으로 고르면 이번처럼 **보이지만 안 열리는 미끼**(`#editor-mode-layer-btn-open`)를 집는다.
       그래서 합격 기준을 «보이나»가 아니라 «**메뉴가 열리나**»로 둔다 — 후보 × 여는 방법을 돌려 보고 열린 조합에서 멈춘다.
       실패는 통째로 로그에 남긴다(다음 사람이 같은 자리에서 또 헤매지 않게).

       🔴 «눌렀다»와 «열렸다»는 다르다. 내 DOM 덤프는 `querySelectorAll` 이라 **숨은 항목까지 잡아서**
          «항목은 있는데 못 찾는다»는 모순된 증거를 만들었다(TinyMCE 는 메뉴를 한 번 만들어 두고 숨겨 둔다).
          그래서 «열림»의 판정은 오직 **항목이 보이나**로 한다. */
    const openerSels = S.modeOpen.split(",").map((x) => x.trim()).filter(Boolean);
    /* 🔴 이 한 함수가 이번 사고의 교훈이다: 후보를 돌되 **`.first()` 가 아니라 «보이는 것»** 을 돌려준다.
       같은 뜻의 요소가 숨은 복제본으로 한 벌 더 있는 화면에서 `.first()` 는 매번 시체를 집는다. */
    const firstVisible = async (sels) => {
      for (const s of sels) {
        const l = page.locator(s);
        const n = Math.min(await l.count().catch(() => 0), 4);
        for (let i = 0; i < n; i++) {
          const c = l.nth(i);
          if (await c.isVisible().catch(() => false)) return { loc: c, sel: n > 1 ? `${s}[${i}]` : s };
        }
      }
      return null;
    };
    let menuItem = null;
    /* 🔴 2차 실측(job #208·#212): **네 가지 방법으로 눌러도 안 열렸다.** 그러니 «한 번 더 누르기»도, «다르게 누르기»도
       답이 아니었다 — **누르는 대상이 틀렸던 것**이다. 그래서 «후보 × 여는 방법» 을 표로 돌린다.
       클릭 오류는 삼키지 않고 적는다(AC-27: «가려져서 못 눌렀다»와 «눌렀는데 안 열렸다»는 다른 사건이다). */
    // «열렸다»의 판정 = **보이는 HTML 항목이 잡히나**. 잡히면 그 자리에서 눌러야 하니 로케이터째 들고 온다.
    const menuVisible = async () => { menuItem = await firstVisible(htmlItems()); return !!menuItem; };
    const methods = [
      ["click", async (t) => { await t.click({ timeout: 4000 }); }],
      // TinyMCE 패널 버튼은 구현에 따라 click 이 아니라 **mousedown** 에서 연다. 그리고 뒤이은 click 이 **도로 닫는다** —
      // 그래서 mousedown «만» 쏘는 칸을 따로 둔다(열자마자 내가 닫는 자책골 방지).
      ["mousedown-only", async (t) => { await t.dispatchEvent("mousedown"); }],
      // 투명한 층이 위를 덮고 있으면 Playwright 는 (일부러) 안 눌러 준다 — DOM 클릭은 그 층을 지나간다.
      ["dom-click", async (t) => { await t.evaluate((el) => el.click()); }],
      // 좌표로 진짜 마우스를 찍는다(래퍼가 아니라 **그 자리에 그려진 것**을 누른다).
      ["mouse-xy", async (t) => { const b = await t.boundingBox(); if (!b) throw new Error("좌표를 못 구했다"); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }],
    ];
    let menuOpen = false, openedBy = null, sawOpener = false;
    const tried = [];
    outer:
    for (const sel of openerSels) {
      const cand = page.locator(sel).first();
      if (!(await cand.isVisible({ timeout: 1200 }).catch(() => false))) { tried.push(`${sel} → 안 보임`); continue; }
      sawOpener = true;
      for (const [name, run] of methods) {
        const err = await run(cand).then(() => null, (e) => String(e?.message ?? e).split("\n")[0].slice(0, 80));
        await settle(page, 450);            // isVisible 은 안 기다린다 — 메뉴가 그려질 틈을 내가 준다
        if (await menuVisible()) {
          menuOpen = true; openedBy = `${sel} · ${name} → ${menuItem.sel}`; break outer;
        }
        tried.push(`${sel} · ${name} → 안 열림${err ? ` (${err})` : ""}`);
        await page.keyboard.press("Escape").catch(() => {});   // 열렸다 닫혔을 수도 있으니 다음 칸은 깨끗한 상태에서
        await settle(page, 200);
      }
    }
    console.log(`  · [html-mode] 모드 메뉴 열림: ${menuOpen}${openedBy ? ` (${openedBy})` : ""}`);
    if (!menuOpen) for (const t of tried) console.log(`      ✗ ${t}`);
    // «버튼 자체가 없다»와 «버튼은 있는데 안 열린다»는 고칠 자리가 다르다 — 이름을 나눠 붙인다.
    if (!sawOpener) return await fail("opener_not_found", tried.join(" / ").slice(0, 200));
    await settle(page, 400);

    /* 안 열렸으면 **누가 숨기고 있는지**를 남긴다 — «DOM 엔 있는데 안 보인다»까지만 알면 또 못 고친다.
       ⚠️ 1차 진단은 항목 자신의 «크기 0» 에서 멈춰 아무것도 못 알려 줬다(부모가 display:none 이면 자식은 당연히 0×0 이다).
          그러니 **진짜 숨긴 층**(display/visibility/aria-hidden)을 끝까지 찾아 올라가고, 크기 0 은 그 다음에 적는다. */
    const hiddenBy = menuOpen ? null : await page.evaluate(() => {
      const el = document.querySelector("#editor-mode-html") || document.querySelector("#editor-mode-html-tistory");
      if (!el) return "항목이 DOM 에도 없다";
      const name = (n) => `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}${String(n.className || "").trim() ? "." + String(n.className).trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
      let zero = null;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n), r = n.getBoundingClientRect();
        const hard = cs.display === "none" ? "display:none"
          : cs.visibility === "hidden" ? "visibility:hidden"
          : Number(cs.opacity) === 0 ? "opacity:0"
          : n.getAttribute("aria-hidden") === "true" ? "aria-hidden" : null;
        if (hard) return `${name(n)} → ${hard}`;                       // 진짜 범인
        if (!zero && (r.width === 0 || r.height === 0)) zero = `${name(n)} → 크기 0`;
      }
      return zero ?? "숨긴 층을 못 찾았다(보이는데 Playwright 만 못 본 것)";
    }).catch(() => null);
    if (hiddenBy) console.log(`  · [html-mode] 안 열린 이유: ${hiddenBy}`);

    /* 🔴 실측 3차: 내가 «맞다»고 짠 셀렉터 셋이 **하나도 안 맞았는데**(0건) 화면엔 «기본모드 ∨» 가 멀쩡히 보였다.
       즉 내 DOM 그림이 틀렸다. 추측을 한 번 더 하지 말고 **구조를 그대로 적어 온다** —
       항목에서 위로 올라간 조상 사슬 + «기본모드» 글자를 가진 버튼들의 좌표. 다음 셀렉터는 이 출력에서 나온다. */
    if (!menuOpen) {
      const probe = await page.evaluate(() => {
        const box = (n) => { const r = n.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
        const nm = (n) => `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}${String(n.className || "").trim() ? "." + String(n.className).trim().split(/\s+/).join(".") : ""}`;
        const item = document.querySelector("#editor-mode-html") || document.querySelector("#editor-mode-html-tistory");
        const chain = [];
        for (let n = item, i = 0; n && i < 7; n = n.parentElement, i++) chain.push(`${nm(n)}{${getComputedStyle(n).display}}${JSON.stringify(box(n))}`);
        const cands = [...document.querySelectorAll("button,a,div,span")]
          .filter((n) => /기본\s?모드/.test((n.textContent || "")) && (n.textContent || "").trim().length < 12 && n.getBoundingClientRect().width > 0)
          .slice(0, 6).map((n) => `${nm(n)}${JSON.stringify(box(n))}«${(n.textContent || "").trim().slice(0, 10)}»`);
        const o = document.querySelector("#editor-mode-layer-btn-open");
        return { chain, cands, opener: o ? `${nm(o)}${JSON.stringify(box(o))} ${o.outerHTML.slice(0, 160).replace(/\s+/g, " ")}` : "없음" };
      }).catch((e) => ({ chain: [], cands: [], opener: `probe 실패: ${String(e?.message ?? e).slice(0, 60)}` }));
      console.log(`  · [html-mode] 항목 조상사슬: ${JSON.stringify(probe.chain)}`);
      console.log(`  · [html-mode] «기본모드» 보이는 것들: ${JSON.stringify(probe.cands)}`);
      console.log(`  · [html-mode] #editor-mode-layer-btn-open = ${probe.opener}`);
    }

    /* 레이어가 열렸으면 **무엇이 들어 있는지** 항상 남긴다(디버그 플래그 없이도).
       실패를 고치려면 «그 자리에 무엇이 있었나»가 있어야 한다 — 없으면 다음 사람이 같은 자리에서 또 헤맨다. */
    const layer = await page.evaluate(() => [...document.querySelectorAll("a,button,li,span,div")]
      .filter((e) => /HTML|마크다운|기본\s?모드/i.test(e.textContent || "") && (e.textContent || "").trim().length < 20)
      .slice(0, 12).map((e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${(e.className || "").toString().trim() ? "." + (e.className || "").toString().trim().split(/\s+/).slice(0, 2).join(".") : ""}[${(e.textContent || "").trim().slice(0, 12)}]`)).catch(() => []);
    if (!menuOpen) console.log("  · [html-mode] 모드 레이어:", JSON.stringify(layer));   // 잘 열렸을 땐 소음이다

    let clicked = false;
    if (menuOpen) {
      const e = await menuItem.loc.click({ timeout: 3000 }).then(() => null, (x) => String(x?.message ?? x).split("\n")[0].slice(0, 80));
      if (e) console.log(`  · [html-mode] HTML 항목 클릭 실패: ${e}`);   // 삼키지 않는다(AC-27)
      else console.log(`  · [html-mode] HTML 항목 클릭: ${menuItem.sel}`);
      clicked = true;
    }
    if (!clicked) {
      const again = await firstVisible(htmlItems());   // 한 번 더 — 그새 그려졌을 수도
      if (again) { await again.loc.click({ timeout: 3000 }).catch(() => {}); clicked = true; }
    }
    if (!clicked) {
      // 글자로 찾고 **클릭 가능한 조상**까지 올라간다(카카오 «계속하기» 와 같은 처치).
      const byText = page.getByText(/^\s*HTML\s*$/).first();
      if (await byText.isVisible({ timeout: 1500 }).catch(() => false)) {
        const anc = byText.locator("xpath=ancestor-or-self::*[self::button or self::a or self::li or @role='menuitem'][1]").first();
        await (await anc.isVisible({ timeout: 400 }).catch(() => false) ? anc : byText).click({ timeout: 3000 });
        clicked = true;
      }
    }
    if (!clicked) {
      /* 마지막 칸: 메뉴가 안 열려도 **항목에 달린 핸들러**는 살아 있을 수 있다(TinyMCE 는 항목 엘리먼트에 건다).
         숨은 요소는 Playwright 가 (일부러) 안 눌러 주니 DOM 으로 부른다.
         🔴 «불렀다»를 «됐다»로 치지 않는다 — 성공 판정은 아래 CodeMirror 가 뜨느냐로만 한다. */
      const fired = await page.evaluate((sels) => {
        const el = sels.map((s) => { try { return document.querySelector(s); } catch { return null; } }).find(Boolean);
        if (!el) return false;
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        el.click();
        return true;
      }, ["#editor-mode-html", "#editor-mode-html-tistory"]).catch(() => false);
      if (fired) { clicked = true; console.log("  · [html-mode] 숨은 항목에 DOM 클릭(메뉴는 끝내 안 열렸다)"); }
    }
    if (!clicked) return await fail("html_item_not_found", `${hiddenBy ?? ""} · 레이어 후보=${JSON.stringify(layer).slice(0, 200)}`);
    await settle(page, 1500);

    // 모드 전환 확인 팝업(«편집이 제한될 수 있습니다» 등) — 있으면 승인. 없으면 그냥 지나간다.
    for (const sel of ["button:has-text('확인')", "button:has-text('예')", ".btn_confirm", "button[class*='confirm']", ".btn_g.highlight"]) {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 800 }).catch(() => false)) { await b.click({ timeout: 3000 }).catch(() => {}); break; }
    }
    await settle(page, 1400);
    if (dialogs.length) console.log(`  · [html-mode] 확인창: ${dialogs.join(" / ")}`);   // 떴으면 무슨 말이었나

    if (!(await page.locator(S.codemirror).first().isVisible({ timeout: 6000 }).catch(() => false))) {
      /* 🔴 «눌렀다»와 «바뀌었다»는 또 다르다. 모드 버튼의 **글자를 되읽어** 전환 자체가 됐는지 본다 —
         «기본모드» 그대로면 전환이 막힌 것이고, «HTML» 인데 편집기가 없으면 편집기 셀렉터가 틀린 것이다.
         고칠 자리가 다른 두 실패를 하나의 `codemirror_not_shown` 으로 뭉뚱그리면 또 못 고친다.
         (라벨은 **여기서만** 읽는다 — 성공 경로에서 일찍 읽으면 갱신 전 값이라 거짓 «기본모드»가 찍힌다.) */
      const modeLabel = (await page.locator("#editor-mode-layer-btn-open, #editor-mode-layer-btn").first().innerText({ timeout: 1500 }).catch(() => "")).replace(/\s+/g, "");
      const switched = /html/i.test(modeLabel);
      console.log(`  · [html-mode] 전환 후 모드 라벨: «${modeLabel || "(못 읽음)"}»`);
      /* 편집기가 CodeMirror 가 아닐 수도 있다 — 그 자리에 **무엇이 생겼는지** 적어 둔다(다음 한 수의 재료). */
      const editors = await page.evaluate(() => [...document.querySelectorAll("textarea,div.CodeMirror,div[class*='code'],div[class*='html']")]
        .filter((e) => e.getBoundingClientRect().width > 100 && e.getBoundingClientRect().height > 60)
        .slice(0, 6).map((e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${String(e.className || "").trim() ? "." + String(e.className).trim().split(/\s+/).slice(0, 2).join(".") : ""}`)).catch(() => []);
      console.log(`  · [html-mode] 그 자리에 있는 큰 편집기들: ${JSON.stringify(editors)}`);
      return await fail(switched ? "editor_not_found" : "mode_not_switched",
        switched ? `HTML 모드로는 바뀌었는데 편집기를 못 찾았다(후보=${JSON.stringify(editors).slice(0, 120)})`
          : `항목은 눌렀는데 모드가 «${modeLabel || "?"}» 그대로다${dialogs.length ? ` · 확인창=${dialogs.join(" / ")}` : " · 확인창 없음"}`);
    }
    /* CodeMirror 는 키 입력으로 긴 HTML 을 넣으면 자동 들여쓰기·괄호 보정이 끼어든다 —
       인스턴스 API 로 값을 **그대로** 세팅한다(그게 HTML 모드를 고른 이유다). */
    const set = await page.evaluate((html) => {
      const el = document.querySelector(".CodeMirror");
      const cm = el && el.CodeMirror;
      if (!cm) return { ok: false, why: "instance_missing" };
      cm.setValue(html);
      cm.refresh();
      const got = cm.getValue();
      return { ok: got.length > 0, len: got.length };
    }, String(bodyHtml ?? "")).catch((e) => ({ ok: false, why: String(e?.message ?? e).slice(0, 80) }));
    if (!set?.ok) return await fail("setvalue_failed", set?.why ?? "값이 들어가지 않았다");

    await shot(page, shotKey, "02-HTML모드본문");
    console.log(`  · [html-mode] ✓ 들어갔다(${set.len}자)`);
    return { ok: true, step: "done" };
  } catch (e) {
    return await fail("exception", String(e?.message ?? e).slice(0, 120));
  } finally {
    // 🔴 여기서만 «수락»이다. 폴백·발행 경로까지 끌고 가면 엉뚱한 확인창을 대신 눌러 준다 — 반드시 걷어낸다.
    page.off("dialog", onDialog);
  }
}

/**
 * 본문 편집 영역에 **확실히** 포커스를 준다. 못 주면 던진다.
 *   🔴 2026-09-14 실측(job #119 · 사장님 확인): TinyMCE 본문은 **iframe 안**이라 부모 문서 셀렉터로는 캐럿이 안 들어가고,
 *      그 클릭 실패를 **조용히 삼켜서** 직전 제목칸 포커스가 남아 **본문 전체가 제목칸에 입력됐다**.
 *      눈 감고 타자를 치느니 멈추는 게 낫다 — 실패는 던진다.
 */
async function focusEditorBody(page) {
  try {
    await page.frameLocator("iframe#editor-tistory_ifr").locator("body").first().click({ timeout: 6000 });
    return "iframe";
  } catch { /* 다음 후보 */ }
  const cm = page.locator(".CodeMirror").first();
  if (await cm.isVisible({ timeout: 1500 }).catch(() => false)) { await cm.click({ timeout: 6000 }).catch(() => {}); return "codemirror"; }
  const ce = page.locator("[contenteditable='true']").first();
  if (await ce.isVisible({ timeout: 1500 }).catch(() => false)) { await ce.click({ timeout: 6000 }).catch(() => {}); return "contenteditable"; }
  throw BLOCK("selector_changed", "본문 편집 영역에 포커스를 주지 못했어요(제목칸에 쓸 위험이 있어 중단했어요).");
}

/** 지금 본문에 들어 있는 글자(되읽기용). 못 읽으면 빈 문자열. */
async function readBodyText(page) {
  try {
    const t = await page.frameLocator("iframe#editor-tistory_ifr").locator("body").first().innerText({ timeout: 3000 });
    if (t) return t;
  } catch { /* 다음 */ }
  try { return await page.locator(".CodeMirror").first().innerText({ timeout: 1500 }); } catch { /* 다음 */ }
  try { return await page.locator("[contenteditable='true']").first().innerText({ timeout: 1500 }); } catch { /* 없음 */ }
  return "";
}

/**
 * [R9-11] 🔴 **기본 모드에서 «진짜 요소»가 장식으로 내려앉는 자리** — op → 고객 화면이 아는 이름.
 *
 *   HTML 모드에서는 `<blockquote>`·`<hr>`·`<h2>` 진짜 요소로 들어가는데, 기본 모드 폴백은 **글자로 흉내**낸다
 *   (인용 → `“…”` · 구분선 → `———` · 소제목 → 평문). 글은 나가지만 **모양이 깎인다.**
 *   🔴 종전엔 그 사실이 `notes` 한 줄로만 남았고 **서버가 notes 를 버려서 고객에게 안 닿았다**(CLAUDE §9 ② 위반 —
 *      자동 승인이면 아무도 모르는 채 깎인 글이 나간다). 이제 **구조화된 칸**으로 올려 검수 화면 칩에 그대로 실린다.
 *   🔴 **새 이름을 만들지 않는다**(AC-75) — 여기 오른쪽은 전부 `lib/blocks.ts BlockType` 어휘 그대로고,
 *      사유도 이미 있는 `no_editor_op`(«블록 자체를 에디터 요소로 못 세웠다»)를 쓴다.
 */
const DEGRADED_FIELD = { quote: "quote", divider: "divider", list: "list", check: "checklist", faq: "faq", link: "affiliate" };

/**
 * op 하나 → «깎였다»고 적을 이름(없으면 `null` = 원래 평문이라 깎일 것이 없다).
 *   🔴 **순수 함수로 뺐다** — 안 그러면 검사가 «그 줄이 있나»만 보고 **«도나»는 못 본다.**
 *      실제로 첫판에 `if (field)` 를 `if (false)` 로 바꾼 변이가 **초록으로 지나갔다**(AC-99 · 오늘 세 번째다).
 */
export function degradedFieldOf(op) {
  if (!op || typeof op !== "object") return null;
  if (op.op === "heading") return Number(op.level) === 3 ? "h3" : "h2";
  return DEGRADED_FIELD[op.op] ?? null;
}

/** 기본 모드 폴백 — ops 를 연주한다(장식은 줄지만 글은 나간다). */
async function playOpsFallback(page, plan, files, shotKey, missed) {
  const where = await focusEditorBody(page);
  console.log(`  · 기본 모드 본문 포커스: ${where}`);
  let wrote = false;
  for (const op of plan.ops) {
    if (op.op === "note") continue;
    if (op.op === "image") {
      const file = files.get(op.url);
      if (!file) { missed.imageDownload++; continue; }
      const sels = ["button[data-name='image']", ".btn_image", "button[title*='사진']", "button:has-text('사진')"];
      let done = false;
      for (const sel of sels) {
        try {
          const btn = page.locator(sel).first();
          if (!(await btn.isVisible({ timeout: 1500 }).catch(() => false))) continue;
          const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10_000 }), btn.click()]);
          await chooser.setFiles([file]);
          await settle(page, 3000);
          done = true; break;
        } catch { /* 다음 */ }
      }
      if (!done) missed.image++;
      wrote = true;
      continue;
    }
    const text = op.op === "list" ? `• ${op.text}` : op.op === "check" ? `☑ ${op.text}`
      : op.op === "quote" ? `“${op.text}”` : op.op === "divider" ? "———"
        : op.op === "link" ? `${op.text} ${op.url}` : String(op.text ?? "");
    if (!text) continue;
    /* 🔴 **깎인 것을 센다** — 글자로 흉내 냈으면 «넣었다»가 아니다. */
    const field = degradedFieldOf(op);
    if (field) missed.degraded.push({ kind: field, why: "no_editor_op", sample: String(op.text ?? "").slice(0, 20) });
    if (wrote) await page.keyboard.press("Enter").catch(() => {});
    await page.keyboard.insertText(text);
    wrote = true;
    await settle(page, 200, 500);
  }
  await shot(page, shotKey, "02-기본모드본문");
  /* 🔴 되읽기 — 본문이 비어 있으면 타자가 **다른 칸으로 샌** 것이다(제목칸 사고의 재발 방지).
     «썼다»고 보고하고 넘어가면 제목에 본문이 통째로 들어간 글이 임시저장된다. */
  if (wrote) {
    const got = (await readBodyText(page)).trim();
    if (!got) throw BLOCK("selector_changed", "본문에 글이 들어가지 않았어요(타자가 다른 칸으로 샜을 수 있어요).");
  }
  return wrote;
}

/** 발행 레이어: 카테고리·공개·태그 → 확정. dryRun 이면 레이어 전에 임시저장하고 끝낸다. */
async function finishPublish(page, plan, options, shotKey, dryRun) {
  /* 🔴 탐침은 **드라이런일 때만** 켜진다. 실발행 중에 이 깃발이 켜져 있으면 «발행한 줄 알았는데 안 나갔다»가 되고,
     그건 조용한 실패다 — 실발행은 깃발을 무시하고 끝까지 간다. */
  const probe = dryRun && String(process.env.AC_TISTORY_PROBE_PUBLISH ?? "") === "1";
  if (dryRun && !probe) {
    /* 🔴 임시저장 버튼을 CSS 로 못 찾으면 글자로(«임시저장») 찾고 클릭 가능한 조상까지 올라간다.
       그래도 없으면 — TinyMCE 티스토리는 **자동 저장**이 돈다(«자동 저장 완료 HH:MM:SS»). 그 지표가 보이면
       드라이런의 목표(발행 없이 초안 저장)는 이미 이뤄진 것이라 성공으로 본다(임시저장까지만 · 발행 0). */
    let saved = false;
    let save = page.locator(S.save).first();
    if (!(await save.isVisible({ timeout: 3000 }).catch(() => false))) {
      const byText = page.getByText("임시저장", { exact: false }).first();
      if (await byText.isVisible({ timeout: 2000 }).catch(() => false)) {
        save = byText.locator("xpath=ancestor-or-self::*[self::button or self::a or @role='button'][1]").first();
        if (!(await save.isVisible({ timeout: 500 }).catch(() => false))) save = byText;
      } else { save = null; }
    }
    if (save) { await save.click({ timeout: 6000 }).catch(() => {}); await settle(page, 2500); saved = true; }
    const autosaved = await page.getByText(/자동 저장 완료/).first().isVisible({ timeout: 3000 }).catch(() => false);
    await shot(page, shotKey, "90-임시저장");
    if (!saved && !autosaved) throw BLOCK("selector_changed", "임시저장 버튼도 자동저장 지표도 찾지 못했어요(에디터 화면이 바뀐 것 같아요).");
    return { dryRun: true, notes: [saved ? "임시저장 클릭" : "자동저장 확인(버튼 미발견)"] };
  }

  /* 🔴 후보 목록에 `.first()` 를 쓰면 **DOM 순서상 첫 요소**가 잡힌다 — 그게 숨은 복제본이면 «못 찾았다»가 된다.
     티스토리 에디터에서 실제로 그랬다(모드 메뉴가 두 벌 · AC-43). 그래서 여기도 **보이는 것**을 고른다. */
  const visibleOf = async (selList) => {
    for (const sel of String(selList).split(",").map((x) => x.trim()).filter(Boolean)) {
      const l = page.locator(sel);
      const cnt = Math.min(await l.count().catch(() => 0), 4);
      for (let i = 0; i < cnt; i++) { const c = l.nth(i); if (await c.isVisible().catch(() => false)) return { loc: c, sel }; }
    }
    return null;
  };

  const doneHit = await visibleOf(S.done);
  if (!doneHit) throw BLOCK("selector_changed", "«완료» 버튼을 찾지 못했어요(에디터 화면이 바뀐 것 같아요).");
  console.log(`  · [publish] 완료 버튼: ${doneHit.sel}`);
  await doneHit.loc.click({ timeout: 8000 });
  await settle(page, 1500);
  await shot(page, shotKey, "91-발행레이어");

  /* 🔴 **탐침 모드**(`AC_TISTORY_PROBE_PUBLISH=1`) — «완료»를 눌러 발행 레이어까지만 가고 **발행하지 않는다.**
     이 구간은 지금까지 **한 번도 지나간 적이 없다**(카나리가 임시저장에서 끝났다). 그래서 실발행 전에
     «무슨 창이 뜨고 무엇이 성공 신호인가»를 눈으로 확인할 길이 필요하다 — 확인창(AC-42)·죽은 복제 셀렉터(AC-43)가
     이 자리에 잠복해 있을 확률이 높다. 레이어 안의 실제 요소를 찍어 남기고 거기서 멈춘다. */
  if (probe) {
    const layer = await page.evaluate(() => {
      const box = (n) => { const r = n.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
      const nm = (n) => `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}${String(n.className || "").trim() ? "." + String(n.className).trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
      const vis = (n) => n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0;
      const btns = [...document.querySelectorAll("button,a[role='button'],input[type='radio'],input[type='checkbox'],label")]
        .filter((n) => vis(n) && /발행|공개|비공개|보호|예약|확인|취소|닫기|카테고리|태그/.test((n.textContent || "") + (n.value || "")))
        .slice(0, 20).map((n) => `${nm(n)}${JSON.stringify(box(n))}«${((n.textContent || n.value || "").trim()).slice(0, 12)}»`);
      const inputs = [...document.querySelectorAll("input,textarea")].filter(vis).slice(0, 12)
        .map((n) => `${nm(n)}[type=${n.type ?? ""}${n.checked ? " checked" : ""}]«${(n.placeholder || "").slice(0, 14)}»`);
      return { btns, inputs, url: location.href };
    }).catch((e) => ({ btns: [], inputs: [], url: `probe 실패: ${String(e?.message ?? e).slice(0, 60)}` }));
    console.log(`  · [publish-probe] 레이어 URL: ${layer.url}`);
    console.log(`  · [publish-probe] 보이는 버튼/선택: ${JSON.stringify(layer.btns)}`);
    console.log(`  · [publish-probe] 입력칸: ${JSON.stringify(layer.inputs)}`);
    const pubHit = await visibleOf(S.publish);
    console.log(`  · [publish-probe] «공개 발행» 후보: ${pubHit ? pubHit.sel : "🔴 못 찾음 — 실발행 때 여기서 막힌다"}`);
    return { dryRun: true, notes: ["발행 레이어까지만 확인(발행 안 함)", `버튼 ${layer.btns.length}개 · 발행버튼 ${pubHit ? "찾음" : "못 찾음"}`] };
  }

  // 카테고리(지정이 있을 때만 · 없으면 블로그 기본값)
  const wantCat = String(options?.category ?? "").trim();
  if (wantCat) {
    try {
      await page.locator("#category-btn, .btn_category").first().click({ timeout: 3000 });
      await settle(page, 500);
      await page.getByText(wantCat, { exact: true }).first().click({ timeout: 3000 });
      await settle(page, 400);
    } catch { /* 기본 카테고리로 나간다 */ }
  }
  // 공개 설정 — 명시적으로 «공개».
  await page.locator("#open20, input[value='20']").first().check({ force: true }).catch(async () => {
    await page.getByText("공개", { exact: true }).first().click({ timeout: 2500 }).catch(() => {});
  });
  // 태그
  const tags = (plan.tags ?? []).slice(0, 10);
  if (tags.length) {
    try {
      const hit = await visibleOf("#tagText, input[placeholder*='태그']");
      if (hit) {
        await hit.loc.click({ timeout: 3000 });
        /* 🔴 **포커스가 태그칸에 실제로 들어갔는지 확인하고서야 타자를 친다.**
           여기서 Enter 를 누르는데, 포커스가 딴 데(예: «발행» 버튼)에 있으면 **그 Enter 가 발행을 눌러 버린다** —
           카테고리·공개설정도 안 끝난 채로. 클릭 실패를 삼키던 종전 구조에서 실제로 가능한 사고였다(AC-27 의 짝).
           확인이 안 되면 태그를 **포기한다**(태그는 부가 정보고, 잘못된 Enter 는 되돌릴 수 없다). */
        const focused = await hit.loc.evaluate((el) => el === document.activeElement).catch(() => false);
        if (focused) {
          for (const t of tags) { await page.keyboard.type(t, { delay: 12 }); await page.keyboard.press("Enter"); await settle(page, 120); }
        } else {
          console.log("  · [publish] 태그칸에 포커스가 안 들어가 태그를 건너뜁니다(엉뚱한 곳에 Enter 를 치지 않는다)");
        }
      }
    } catch { /* 태그 실패해도 발행은 계속 */ }
  }
  await settle(page, 800, 1800);

  /* 🔴 발행 확인창을 **받는다**(AC-42). Playwright 는 핸들러가 없으면 `confirm()` 을 자동으로 «취소»하는데,
     티스토리가 «발행하시겠습니까?» 를 띄운다면 우리는 조용히 취소를 누르고 **URL 을 45초 기다리다 실패**한다 —
     화면·로그에 흔적이 없어 원인을 영영 못 찾는다(HTML 모드에서 실제로 이틀을 태운 함정이다).
     여기서만 수락하고 무슨 말이었는지 남긴다. 끝나면 반드시 걷어낸다(다른 확인창을 대신 눌러 주지 않게). */
  const pubDialogs = [];
  const onPubDialog = async (d) => { pubDialogs.push(`${d.type()}«${String(d.message() ?? "").replace(/\s+/g, " ").slice(0, 90)}»`); await d.accept().catch(() => {}); };
  page.on("dialog", onPubDialog);

  const before = page.url();
  const pubHit2 = await visibleOf(S.publish);
  if (!pubHit2) { page.off("dialog", onPubDialog); throw BLOCK("selector_changed", "«공개 발행» 버튼을 찾지 못했어요(에디터 화면이 바뀐 것 같아요)."); }
  console.log(`  · [publish] 발행 버튼: ${pubHit2.sel}`);
  await pubHit2.loc.click({ timeout: 8000 });
  await settle(page, 1200);
  if (pubDialogs.length) console.log(`  · [publish] 확인창: ${pubDialogs.join(" / ")}`);

  // 발행되면 글 주소(/{entryId} 또는 /entry/...)로 이동한다.
  let found = null;
  for (let waited = 0; waited < 45_000 && !found; waited += 600) {
    for (const p of page.context().pages()) {
      const u = p.url();
      if (u === before) continue;
      const m = /^https?:\/\/[^/]+\/(?:entry\/[^/?#]+|(\d+))(?:[/?#]|$)/i.exec(u);
      if (m && !/manage/i.test(u)) { found = { url: u.split("#")[0], id: m[1] ?? null }; break; }
    }
    if (found) break;
    await settle(page, 600);
  }
  await shot(page, shotKey, "92-발행후");
  page.off("dialog", onPubDialog);            // 🔴 반드시 걷어낸다 — 뒤따르는 다른 확인창을 대신 눌러 주지 않게
  if (!found) {
    // 확인창이 떴었다면 그 문구가 원인 추적의 전부다 — 실패 사유에 함께 싣는다(«그냥 못 찾았다»로 끝내지 않는다).
    throw BLOCK("unknown", `발행 후 글 주소를 회수하지 못했어요(현재 ${page.url().slice(0, 70)})${pubDialogs.length ? ` · 확인창=${pubDialogs.join(" / ")}` : " · 확인창 없음"}.`);
  }
  return { externalUrl: found.url, channelRef: found.id ? `tistory:${found.id}` : `tistory:${found.url.slice(-40)}` };
}

/* ───────────────────── 진입점 ───────────────────── */

export async function run({ ctx, job, plan, shotKey, dryRun, recipe }) {
  /* [P1R8 §3.3] 이 잡에 쓸 표를 고른다 — 서버 값이 있는 칸만 덮고 **나머지는 묶여 온 값 그대로**다.
     한 칸만 와도 나머지가 종전대로 돌아야 한다(전부 아니면 전무가 아니다). */
  S = { ...BUNDLED_SELECTORS };
  if (recipe) for (const k of Object.keys(BUNDLED_SELECTORS)) { const v = recipe.sel(k); if (v && v !== BUNDLED_SELECTORS[k]) S[k] = v; }
  const account = job.account ?? {};
  const host = blogHost(account.handle);
  if (!host) throw BLOCK("login_fail", "티스토리 블로그 주소(핸들)가 없어요. 계정을 다시 연결해 주세요.");

  const page = ctx.pages()[0] ?? await ctx.newPage();
  /* [R9-11] `degraded` — 기본 모드에서 **진짜 요소가 장식으로 내려앉은** 목록(구조화 · 고객 화면까지 간다). */
  const missed = { image: 0, imageDownload: 0, htmlMode: 0, degraded: [] };
  /* 🔴 실패 스냅샷은 모든 단계를 덮는다(네이버와 같은 수리 · 2026-09-14 실측에서 로그인 실패 시 사진이 0장이었다). */
  let files = null;
  try {
  if (!(await isLoggedIn(page, host))) {
    /* 🔴 근본 수리(job #77~#84 실측): **카카오 계정은 무인 자동 로그인을 하지 않는다.**
       카카오는 2단계(휴대폰 승인) + 동의 화면 + OAuth 콜백을 거치는데, 콜백이 자동화 컨텍스트에서 세션을 완성하지 못하고
       티스토리 로그인으로 **되돌아오는 리다이렉트 루프**가 있다(FAIL 스냅샷 = 티스토리 로그인 페이지). 봇이 뚫을 수 있는 화면이 아니다.
       ⇒ 사람이 «다시 로그인»(session.login · 헤드풀)으로 **한 번** 로그인해 쿠키를 저장하면, 이후 발행은 그 쿠키(claim 이 실어 준다)로 돈다.
          이게 실제 사용자 흐름이다. 여기서 자동 로그인으로 계정을 위험에 빠뜨리지 않는다. */
    if (account.login?.method === "kakao") {
      throw BLOCK("login_fail", "카카오 로그인은 창에서 한 번 직접 해 주셔야 해요. 앱에서 «다시 로그인»을 누르면 창이 열리고, 그 로그인 세션으로 이후 글이 자동으로 올라갑니다.");
    }
    if (!account.login?.id || !account.login?.pw) throw BLOCK("login_fail", "저장된 로그인이 만료됐어요. 앱에서 «다시 로그인»을 눌러 주세요.");
    await loginWithIdPw(page, account.login.id, account.login.pw, shotKey);
    /* 🔴 카카오 동의 뒤 티스토리 OAuth 콜백이 자동화에서 세션을 못 세우고 authorize 로 되돌아오는 루프가 있다(job #84 실측).
       콜백이 세션을 세웠을 수도 있어 «에디터로 직접» 몇 번 가 본다(OAuth 춤이 멈춘 뒤 정착할 시간). 그래도 안 서면
       그건 사람이 완료해야 하는 화면이라 — 자동 재시도로 뚫지 않고 «다시 로그인»(헤드풀 세션 로그인)으로 정직하게 넘긴다. */
    let settled = false;
    for (let i = 0; i < 3 && !settled; i++) { if (await isLoggedIn(page, host)) settled = true; else await settle(page, 2500); }
    if (!settled) throw BLOCK("login_fail", "카카오 로그인이 자동으로 끝나지 않았어요(로그인 화면이 되돌아와요). 앱에서 «다시 로그인»을 눌러 창에서 직접 한 번 로그인해 주시면 그 세션으로 자동 발행됩니다.");
  }
  await shot(page, shotKey, "00-로그인확인");

  await openEditor(page, host, shotKey);

  // 제목 — 🔴 실측(job #75): fill 이 조용히 빗나가 제목이 **본문에 섞여 들어갔다**. 채운 뒤 값을 되읽어 확인하고,
  //   비었으면 클릭 후 타자로 다시(그래도 비면 notes 로 보고 · 조용히 넘기지 않는다).
  const titleText = String(job.payload?.title ?? "");
  const titleBox = page.locator("textarea#post-title-inp, #post-title-inp, .textarea_tit").first();
  const titleNotes = [];
  if (await titleBox.isVisible({ timeout: 8000 }).catch(() => false)) {
    await titleBox.fill(titleText).catch(() => {});
    if ((await titleBox.inputValue().catch(() => "")) !== titleText) {
      await titleBox.click({ timeout: 4000 }).catch(() => {});
      await page.keyboard.press("Control+A").catch(() => {});
      await page.keyboard.type(titleText, { delay: 8 }).catch(() => {});
    }
    const got = await titleBox.inputValue().catch(() => "");
    if (got !== titleText) titleNotes.push(`제목 입력 확인 실패(들어간 값 "${got.slice(0, 20)}")`);
  } else {
    titleNotes.push("제목 칸을 못 찾았어요(textarea#post-title-inp)");
  }
  await settle(page, 600);

  files = await downloadImages(plan.ops.filter((o) => o.op === "image").map((o) => o.url));
  {
    // 본문 — HTML 모드 우선(가장 안전), 안 되면 연주 폴백.
    const notes = [];
    const html = await tryHtmlMode(page, job.payload?.bodyHtml, shotKey);
    if (!html.ok) {
      missed.htmlMode++;
      /* 🔴 **막힌 자리를 그대로 보고에 싣는다.** 종전엔 «HTML 모드를 열지 못해…» 한 줄뿐이라
         다음 사람이 처음부터 다시 파야 했다(AC-27). 이제 어느 단계인지가 notes 로 서버까지 올라간다. */
      notes.push(`HTML 모드를 열지 못해 기본 모드로 넣었어요(서식 일부 폴백 · 막힌 자리: ${html.step}${html.detail ? ` — ${String(html.detail).slice(0, 80)}` : ""})`);
      const wrote = await playOpsFallback(page, plan, files, shotKey, missed);
      if (!wrote) throw BLOCK("selector_changed", "본문에 한 글자도 넣지 못했어요.");
    }
    /* 🔴 제목 오염 검사 — 본문 타자가 제목칸으로 새면 제목에 글이 통째로 들어간다(2026-09-14 실측 job #119).
       본문을 넣은 **뒤** 제목을 다시 읽어 확인하고, 어긋났으면 제목을 되돌린 뒤 사실을 남긴다(조용히 넘기지 않는다). */
    if (titleText) {
      const titleAfter = await titleBox.inputValue().catch(() => "");
      if (titleAfter !== titleText) {
        notes.push(`제목이 본문 입력에 오염돼 되돌렸어요(들어가 있던 길이 ${titleAfter.length})`);
        await titleBox.fill(titleText).catch(() => {});
      }
    }
    if (missed.image) notes.push(`사진 버튼 ${missed.image}건 미발견`);
    if (missed.imageDownload) notes.push(`사진 ${missed.imageDownload}장 내려받기 실패`);
    notes.push(...titleNotes);
    notes.push(...(plan.stats.notes ?? []));

    /* [R9-11] 🔴 «서식이 깎였다»를 **구조화된 칸**으로 올린다 — `notes` 는 서버가 버린다(그래서 고객에게 안 닿았다).
       네이버와 **같은 모양·같은 파이프**(`formatMarks.demoted`)라 서버도 화면도 새로 만들 것이 없다.
       ⚠️ 말투는 화면이 만든다 — 여기서는 «사실»만 보낸다(«이 글은 인용구가 따옴표로 대신 들어갔어요»는 화면 몫). */
    const formatMarks = missed.degraded.length
      ? { demoted: missed.degraded.slice(0, 40), htmlMode: missed.htmlMode }
      : null;
    const out = await finishPublish(page, plan, job.payload?.options, shotKey, dryRun);
    return { ...out, notes: [...notes, ...(out.notes ?? [])], ...(formatMarks ? { formatMarks } : {}) };
  }
  } catch (e) {
    await failShot(page, shotKey);
    throw e;
  } finally {
    if (files) cleanupFiles(files);
  }
}

export const channel = "tistory";
