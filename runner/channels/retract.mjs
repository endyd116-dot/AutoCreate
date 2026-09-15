/**
 * runner/channels/retract.mjs — **올린 글을 내린다**(DESIGN §5E · 잡 `publish.retract`).
 *   대상: 네이버 블로그 · 티스토리(러너 채널). API 채널은 서버가 직접 지운다(`lib/publish/retract-api.ts`).
 *
 *   🔴 **이 파일은 되돌릴 수 없는 일을 한다.** 그래서 다른 채널보다 한 겹 더 조심한다:
 *     ① **고객이 «내려 줘»를 눌렀을 때만** 잡이 생긴다(서버가 보장 · 크론이 이 잡을 만들지 않는다).
 *     ② **주소를 확인하고 지운다** — payload 의 주소로 직접 가고, 목록에서 «비슷한 제목»을 찾아 지우지 않는다.
 *        (제목으로 찾으면 같은 제목의 **다른 글**을 지운다. 되돌릴 수 없는 일에 추측을 섞지 않는다.)
 *     ③ **이미 없으면 성공**이다 — `already_gone` 으로 돌려보낸다(서버가 성공으로 센다 · §5E.3).
 *     ④ **드라이런**(`--dry-run`)이면 **삭제 단추를 누르지 않는다**. 어디까지 갔는지만 보고한다.
 *     ⑤ 확인창(«정말 삭제하시겠습니까?»)은 **이 잡에서만** 자동 승인한다 — 발행 채널처럼 범위를 좁혀 걸고 바로 걷는다
 *        (전역 자동 승인은 «발행하시겠습니까»까지 눌러 줄 수 있다 · AC-42 의 반대 방향 사고).
 *
 *   🔴 **«눌렀다»는 «지워졌다»가 아니다**(AC-54). 누른 뒤 그 주소를 다시 열어 **없어졌는지 확인**하고,
 *      확인이 안 되면 «지웠다»고 말하지 않는다 — 서버가 `verify.post_alive` 로 한 번 더 본다.
 */
import { settle, shot, failShot } from "../lib/browser.mjs";

const BLOCK = (kind, msg) => Object.assign(new Error(`[block:${kind}] ${msg}`), { errorKind: kind });
/** «이미 없다» — 실패가 아니라 우리가 원한 상태(서버가 성공으로 센다). */
const GONE = (msg) => Object.assign(new Error(`[block:already_gone] ${msg}`), { errorKind: "already_gone" });

/** 그 글이 이미 없을 때 화면에 나오는 말(post-alive.mjs 와 같은 어휘를 쓴다). */
const GONE_RE = /삭제(된|되었|하였)|존재하지 않는 (글|페이지)|페이지를 찾을 수 없|없는 페이지|잘못된 접근/;

/** 삭제 단추 후보 — 🔴 `:has-text()` 는 **부분일치**다(AC-55). «삭제»가 «삭제취소»를 집지 않게 좁은 것부터 본다. */
const DELETE_SEL = [
  "button.btn_delete", "a.btn_delete", "#deleteBtn", "button#delete",
  "button:has-text('글 삭제')", "a:has-text('글 삭제')",
  "button:has-text('삭제하기')", "a:has-text('삭제하기')",
];
/** 확인 레이어의 «확인/삭제» — 취소를 집지 않게. */
const CONFIRM_SEL = ["button:has-text('확인')", "button:has-text('삭제')", ".btn_confirm", "button.confirm"];

/** 보이는 것 중 첫 번째(숨은 복제본을 집지 않는다 · AC-43). */
async function firstVisible(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel);
    const cnt = await loc.count().catch(() => 0);
    for (let i = 0; i < Math.min(cnt, 5); i++) {
      const one = loc.nth(i);
      if (await one.isVisible({ timeout: 400 }).catch(() => false)) return { loc: one, sel };
    }
  }
  return null;
}

export async function run({ ctx, job, shotKey, dryRun }) {
  const payload = job.payload ?? {};
  const url = String(payload.externalUrl ?? "").trim();
  if (!/^https?:\/\//i.test(url)) throw BLOCK("unknown", "내릴 글의 주소가 없어요.");

  const page = ctx.pages()[0] ?? await ctx.newPage();
  const dialogs = [];
  /* ⑤ 이 잡 동안만 확인창을 받는다 — 끝나면 반드시 걷는다(전역 자동 승인 금지). */
  const onDialog = async (d) => {
    dialogs.push(`${d.type()}«${String(d.message() ?? "").replace(/\s+/g, " ").slice(0, 80)}»`);
    await d.accept().catch(() => {});
  };
  page.on("dialog", onDialog);
  try {
    let status = 0;
    try {
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      status = res?.status() ?? 0;
    } catch (e) {
      throw BLOCK("network", `글 주소에 접속하지 못했어요(${String(e?.message ?? e).slice(0, 60)}).`);
    }
    await settle(page, 1500);
    await shot(page, shotKey, "00-대상글");

    // ③ 이미 없으면 성공 — 지울 것이 없다.
    if (status === 404 || status === 410) throw GONE("이미 내려가 있었어요(404).");
    const body = ((await page.locator("body").innerText().catch(() => "")) || "");
    if (GONE_RE.test(body)) throw GONE("이미 내려가 있었어요(삭제된 글 화면).");

    /* 로그인이 풀렸으면 삭제 단추 자체가 없다 — «단추를 못 찾았다»가 아니라 «로그인이 풀렸다»로 말한다(AC-10). */
    if (/로그인|nidlogin|accounts\.kakao/i.test(page.url())) {
      throw BLOCK("login_fail", "로그인이 풀려서 글을 내리지 못했어요. 앱에서 «다시 로그인»을 눌러 주세요.");
    }

    const hit = await firstVisible(page, DELETE_SEL);
    if (!hit) {
      await failShot(page, shotKey);
      throw BLOCK("selector_changed", "글 삭제 단추를 찾지 못했어요(채널 화면이 바뀐 것 같아요).");
    }

    // ④ 드라이런 — 여기까지만. 🔴 **누르지 않는다.**
    if (dryRun) {
      return { retract: { dryRun: true, foundSelector: hit.sel }, notes: [`드라이런 — 삭제 단추(${hit.sel})까지 확인하고 누르지 않았어요`] };
    }

    await hit.loc.click({ timeout: 8000 }).catch(() => {});
    await settle(page, 1200);
    // 레이어형 확인이면 한 번 더(브라우저 confirm 은 위 onDialog 가 받는다).
    const cf = await firstVisible(page, CONFIRM_SEL);
    if (cf) { await cf.loc.click({ timeout: 6000 }).catch(() => {}); await settle(page, 1500); }
    await shot(page, shotKey, "01-삭제후");

    /* 🔴 «눌렀다»는 «지워졌다»가 아니다(AC-54) — 그 주소를 **다시 열어** 없어졌는지 본다.
       못 확인하면 «지웠다»고 말하지 않는다(서버가 `verify.post_alive` 로 한 번 더 본다). */
    let goneNow = false;
    try {
      const res2 = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const st2 = res2?.status() ?? 0;
      await settle(page, 1200);
      const body2 = ((await page.locator("body").innerText().catch(() => "")) || "");
      goneNow = st2 === 404 || st2 === 410 || GONE_RE.test(body2);
    } catch { goneNow = false; }

    if (!goneNow) {
      await failShot(page, shotKey);
      throw BLOCK("unknown", `삭제를 눌렀는데 그 글이 아직 보여요${dialogs.length ? ` (확인창: ${dialogs.join(" ")})` : ""}. 직접 확인해 주세요.`);
    }
    return {
      retract: { removed: true },
      notes: [`글을 내렸어요(확인 완료)${dialogs.length ? ` · 확인창 ${dialogs.length}개` : ""}`],
    };
  } finally {
    page.off("dialog", onDialog);          // 🔴 반드시 걷는다 — 다음 잡에서 «발행하시겠습니까»를 눌러 주면 안 된다
  }
}

export const channel = "retract";
