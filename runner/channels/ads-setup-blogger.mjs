/**
 * runner/channels/ads-setup-blogger.mjs — 블로거 템플릿에 애드센스 코드 **삽입/복원**(계약 P1R4 §2.2 · DESIGN §9.0).
 *   AC 신규 2026-09-14(B2). `ads.setup_blogger`(넣기) · `ads.revert_blogger`(되돌리기) 둘 다 이 모듈이 처리한다.
 *
 *   🔴 이건 **쓰기**다(상태 읽기 ads-status-blogger 와 다르다) — 그래서:
 *     ① 사용자가 자기 블로그에 직접 시킨 잡일 때만 온다(남의 수익 설정을 임의로 건드리지 않는다).
 *     ② **드라이런이면 저장하지 않는다**(원문 백업·삽입본을 계산하고 스샷만 · core 가 report 를 건너뛴다).
 *     ③ 구글 로그인은 자동화하지 않는다 — 세션 없으면 `login_fail` 로 정직하게 돌려보낸다(사람이 session.login 블로거).
 *     ④ 넣기 전 원문을 **백업**해 결과에 실어 준다 → 서버가 `accounts.monetize.bloggerTemplateBackup` 에 저장(복원 재료).
 *   ⚠️ 블로거 «HTML 편집» 셀렉터는 **자사 테스트 블로그 실측 전 추정**이다(구글 세션이 있어야 확정). 못 찾으면 selector_changed 로 정직히 실패.
 *   🔴 블로거 템플릿은 **XML 로 파싱**된다 — 삽입 코드는 well-formed 여야 한다(`async='async'`·닫는 태그). 안 그러면 저장이 거부된다.
 */
import { shot, failShot, settle } from "../lib/browser.mjs";

const BLOCK = (kind, msg) => Object.assign(new Error(`[block:${kind}] ${msg}`), { errorKind: kind });
const MARK = "AutoCreate AdSense";                 // 우리 삽입 표식 — 멱등(중복 삽입 방지)·복원 탐지에 쓴다
const CLIENT_RE = /^ca-pub-\d{6,}$/;               // 애드센스 게시자 ID

function snippetFor(client) {
  return `<!-- ${MARK} -->\n<script async='async' crossorigin='anonymous' src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}'></script>\n`;
}
function insertIntoHead(template, client) {
  if (template.includes(MARK) || template.includes(`client=${client}`)) return { changed: false, out: template, reason: "already" };
  const snip = snippetFor(client);
  if (/<head>/i.test(template)) return { changed: true, out: template.replace(/<head>/i, (m) => `${m}\n${snip}`) };
  if (/<\/head>/i.test(template)) return { changed: true, out: template.replace(/<\/head>/i, `${snip}</head>`) };
  return { changed: false, out: template, reason: "no_head" };
}

async function openEditor(page, blogId, shotKey) {
  await page.goto(`https://www.blogger.com/blog/themes/${encodeURIComponent(blogId)}`, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
  await settle(page, 2500);
  if (/accounts\.google\.com/i.test(page.url())) throw BLOCK("login_fail", "구글 로그인이 필요해요. 앱에서 «다시 로그인»(블로거)으로 창에서 직접 로그인해 주세요.");
  await shot(page, shotKey, "00-테마");
  const hasEditor = () => page.evaluate(() => !!(document.querySelector(".CodeMirror") || document.querySelector("textarea")));
  if (!(await hasEditor())) {
    // «맞춤설정» 옆 캐럿(더보기) → «HTML 편집». (블로거 UI 추정 — 실측 시 확정)
    await page.locator('[aria-label*="맞춤설정"], [aria-label*="Customize"], button:has-text("맞춤설정")').first().click({ timeout: 4000 }).catch(() => {});
    await page.locator("text=/HTML 편집|Edit HTML/i").first().click({ timeout: 6000 }).catch(() => {});
    await settle(page, 2500);
  }
  if (!(await hasEditor())) throw BLOCK("selector_changed", "블로거 «HTML 편집» 화면을 열지 못했어요(화면 구조 변경 추정).");
  await shot(page, shotKey, "01-에디터");
}

async function getTemplate(page) {
  return page.evaluate(() => {
    const cm = document.querySelector(".CodeMirror");
    if (cm && cm.CodeMirror) return cm.CodeMirror.getValue();
    const ta = document.querySelector("textarea");
    return ta ? ta.value : null;
  });
}
async function setTemplate(page, value) {
  return page.evaluate((v) => {
    const cm = document.querySelector(".CodeMirror");
    if (cm && cm.CodeMirror) { cm.CodeMirror.setValue(v); return true; }
    const ta = document.querySelector("textarea");
    if (ta) { ta.value = v; ta.dispatchEvent(new Event("input", { bubbles: true })); return true; }
    return false;
  }, value);
}
async function clickSave(page) {
  await page.locator('[aria-label*="저장"], [aria-label*="Save"], button:has-text("저장"), button:has-text("Save")').first().click({ timeout: 6000 });
  await settle(page, 1500);
  // 확인 대화상자가 뜨면 승인(있을 때만 · 없으면 무시).
  await page.locator('button:has-text("확인"), button:has-text("OK"), button:has-text("저장")').first().click({ timeout: 2500 }).catch(() => {});
  await settle(page, 2000);
}

export async function run({ ctx, job, shotKey, dryRun }) {
  const payload = job.payload ?? {};
  const blogId = String(payload.blogId ?? "").trim();
  if (!blogId) throw BLOCK("login_fail", "블로그 ID(blogId)가 없어요.");
  const revert = job.kind === "ads.revert_blogger";
  const page = ctx.pages()[0] ?? await ctx.newPage();
  try {
    await openEditor(page, blogId, shotKey);
    const original = await getTemplate(page);
    if (original == null || original.length < 20) throw BLOCK("selector_changed", "템플릿을 읽지 못했어요(에디터 구조 변경 추정).");

    if (revert) {
      const backup = String(payload.bloggerTemplateBackup ?? "");
      if (!backup) throw BLOCK("unknown", "복원할 백업이 없어요(먼저 광고를 넣은 적이 없어요).");
      if (dryRun) return { dryRun: true, notes: [`복원 예정(백업 ${backup.length}자) — 저장 안 함`] };
      if (!(await setTemplate(page, backup))) throw BLOCK("selector_changed", "에디터에 백업을 넣지 못했어요.");
      await clickSave(page);
      const after = await getTemplate(page);
      await shot(page, shotKey, "02-복원");
      if (after != null && after.includes(MARK)) throw BLOCK("unknown", "복원을 저장했는데 광고 코드가 남아 있어요(재시도 필요).");
      return { monetize: { reverted: true, detail: "템플릿 복원 완료" }, notes: ["블로거 템플릿을 광고 삽입 전으로 되돌렸어요."] };
    }

    // ── 삽입(setup) ──
    const client = String(payload.adsenseClient ?? payload.client ?? "").trim();
    if (!CLIENT_RE.test(client)) throw BLOCK("unknown", "애드센스 게시자 ID(ca-pub-…)가 payload 에 없어요.");
    const { changed, out, reason } = insertIntoHead(original, client);
    if (!changed) {
      if (reason === "already") return { monetize: { adsenseInserted: true, bloggerTemplateBackup: original, detail: "이미 삽입돼 있어요" }, notes: ["이미 광고 코드가 있어요(변경 없음)."] };
      throw BLOCK("selector_changed", "템플릿에서 <head> 를 찾지 못해 넣지 못했어요.");
    }
    if (dryRun) return { dryRun: true, notes: [`삽입 예정(<head> 뒤 · ${client}) — 저장 안 함 · 백업 ${original.length}자 확보`] };
    if (!(await setTemplate(page, out))) throw BLOCK("selector_changed", "에디터에 새 템플릿을 넣지 못했어요.");
    await clickSave(page);
    const after = await getTemplate(page);
    await shot(page, shotKey, "02-삽입");
    if (!(after != null && after.includes(MARK))) throw BLOCK("unknown", "저장했는데 광고 코드가 안 보여요(블로거가 XML 을 거부했을 수 있어요).");
    // 🔴 백업 원문을 함께 돌려준다 — 서버가 monetize.bloggerTemplateBackup 에 저장(복원 재료).
    return { monetize: { adsenseInserted: true, bloggerTemplateBackup: original, detail: `<head> 뒤 삽입(${client})` }, notes: ["블로거 템플릿 <head> 에 애드센스 코드를 넣었어요."] };
  } catch (e) {
    await failShot(page, shotKey);
    throw e;
  }
}

export const channel = "ads";
