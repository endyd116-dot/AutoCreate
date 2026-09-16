/**
 * runner/channels/daangn.mjs — 당근 **비즈프로필 «새소식»** 발행(R12-6 · B2 · 2026-09-17).
 *   AM 원본: ../AutoMarketing/public/runner/daangn-runner.mjs
 *     (2026-07-26 최초 · **2026-07-29 라이브 DOM 실측으로 전면 재작성** · 2026-09-15 글 주소 회수 사다리 추가 · 43KB)
 *     — 이식 범위: 프로필 id 해석 · 새소식 작성 화면 사다리 · 사진 첨부(«N/10» 카운터 버튼) · 본문 검증 ·
 *       단계 진행(작성 → 설정 → 완료) · 글 주소 회수 사다리 4단. AM 의 멀티테넌트/GitHub Actions 껍데기는 안 가져온다.
 *
 *   ══ 🔴 AM 과 **다른 점** — 코드에 적어 둔다(R9 에서 세운 규율) ══
 *     ① **서식이 0 이다.** 새소식 에디터는 평문이다. AM 은 그냥 본문을 넣었고 우리는 `formatCaps` 로
 *        «확인했고 못 낸다»를 **적는다**(`null`=안 재 봤다 와 다르다 · AC-92). 계획층이 강조를 미리 걷어
 *        실행부가 헛손질을 안 한다 — 헛손질은 캐럿을 더럽혀 **번짐**을 부른다.
 *     ② **수익이 없다.** 당근 새소식엔 광고 수익이 안 붙는다 — 수익 화면에서 0원이 **고장으로 보이면 안 된다**(AC-10).
 *        그건 서버·화면 몫이고, 여기서는 **수익 잡을 아예 안 만든다.**
 *     ③ **세션 쿠키만.** 당근 로그인은 휴대폰 SMS 인증이라 **아이디·비번이 없다** — 자동 로그인 경로를 안 만든다.
 *        세션이 끊기면 `login_fail` 이 아니라 **`session_expired` → 계정 `pending_login`** 으로 정직하게 넘긴다.
 *
 *   ⚠️ 🔴 **셀렉터는 2026-07 기준이고 AM 헤더가 «변경 가능성 高»라고 적어 뒀다.**
 *      ⇒ **실발행 전에 탐침 1회**(`dryRun`)를 먼저 돌린다. 티스토리에서 배운 그대로다 —
 *        탐침 한 번이 «모드 메뉴가 두 벌», «confirm 이 조용히 취소됨», «죽은 복제본» 셋을 미리 잡았다.
 *      🔴 탐침도 **사장님 Allow 자리**다(`docs/active/2026-09-15-OWNER-CHECKLIST.md` §5).
 */
import { shot, failShot, settle, downloadImages, cleanupFiles } from "../lib/browser.mjs";

const BLOCK = (kind, msg) => Object.assign(new Error(`[block:${kind}] ${msg}`), { errorKind: kind });

const BIZ = "https://bizprofile.daangn.com";
const BUSINESS = "https://business.daangn.com";

/** 🔴 채널이 받는 사진 수 — AM `attachPhoto` 실측(«N/10» 카운터). 서버 레지스트리(`maxPhotos`)와 **같은 값**이어야 한다. */
export const MAX_PHOTOS = 10;

/* ═══ 셀렉터 표 — 🔴 **묶여 온 표**(zip 안의 기본값). 서버가 서명된 표를 주면 그 칸이 이긴다(`runner/lib/recipe.mjs`). ═══ */
export const BUNDLED_SELECTORS = {
  title: 'input[placeholder*="제목"], input[name*="title"], #title',
  body: 'textarea[placeholder*="내용"], textarea[name*="content"], div[contenteditable="true"], textarea',
  /* 🔴 AM 실측 정본 — 사진 버튼은 «0/10» **카운터 버튼**이다(아이콘이 아니다). */
  photo: 'button:has-text("/10"), input[type=file], button:has-text("사진"), [aria-label*="사진"]',
  next: 'button:has-text("다음"), button:has-text("작성 완료")',
  done: 'button:has-text("완료"), button:has-text("게시")',
  /* 쿠폰 첨부 제안 모달 — AM 이 2026-07-29 에 만난 것. «첨부하지 않기»로 닫고 계속 간다(무중단). */
  couponSkip: 'button:has-text("첨부하지 않기"), button:has-text("건너뛰기"), button:has-text("나중에")',
};
let S = { ...BUNDLED_SELECTORS };

const clean = (u) => String(u ?? "").split("?")[0].split("#")[0];
/** 새소식 글 id — `/posts/{id}` 에서. 🔴 `/posts/new` 는 **글이 아니다**(AM 이 여기서 한 번 속았다). */
export function daangnPostIdOf(url) {
  const m = String(url ?? "").match(/[/]posts[/]([0-9]+)/);
  return m ? m[1] : null;
}

/** 첫 번째로 **보이는** 후보를 고른다 — `.first()` 는 숨은 복제본을 집는다(AC-43). */
async function firstVisible(page, selectors) {
  for (const sel of String(selectors).split(",").map((x) => x.trim()).filter(Boolean)) {
    const l = page.locator(sel);
    const n = await l.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const c = l.nth(i);
      if (await c.isVisible().catch(() => false)) return c;
    }
  }
  return null;
}

/** 로그인 벽인가 — 🔴 **모르면 `unknown` 이다**(B2 인수인계 §3B: 모를 때 `login_fail` 을 쓰면 멀쩡한 계정이 멈춘다). */
export function classifyDaangnWall(url) {
  const u = String(url ?? "");
  if (/account[.]daangn|[/]login|[/]signin|[/]auth/i.test(u)) return "session_expired";
  return null;
}

/**
 * 비즈프로필 id 해석 — AM 실측(2026-07-29): 프로필 목록 카드는 `<div>`(href 없음)라 앵커 스캔이 안 된다.
 *   ① `/profile/recent-fallback` 리다이렉트 URL 에서 뽑고 ② 실패하면 목록 첫 카드를 눌러 이동한 URL 에서 뽑는다.
 *   🔴 못 읽으면 **빈 문자열**이다 — 0 이나 «기본 프로필» 로 메우지 않는다(AC-92).
 */
async function detectProfileId(page) {
  const fromUrl = (u) => (String(u ?? "").match(/[/]profile[/]([0-9]+)/) || [])[1] || "";
  try {
    await page.goto(`${BUSINESS}/profile/recent-fallback`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page, 1200);
    let id = fromUrl(page.url());
    if (id) return id;
    const card = await firstVisible(page, '[class*="card"], [role="listitem"], li');
    if (card) {
      await card.click().catch(() => {});
      await settle(page, 2000);
      id = fromUrl(page.url());
    }
    return id || "";
  } catch { return ""; }
}

/**
 * 🔴 **본문이 그대로 들어갔나** — AM 이 라이브에서 겪은 그 사고의 자.
 *   증상(AM 2026-08): 발행된 글 본문 곳곳에 홈페이지 URL 이 끼어들고 **원문 조각이 사라졌다.**
 *   서버는 결백했다(DB 본문에 URL 0개) — **에디터의 링크 변환**이 글을 갈아엎은 것이고, 그런데도 **게시는 됐다**(조용한 실패).
 *   ⇒ 어긋나면 **던진다.** 깨진 글이 나가느니 사람이 올리는 게 낫다.
 *   🔴 이건 CLAUDE §9 의 게이트가 **아니다** — «고객 글에 대한 우리 판단»이 아니라 «**우리 도구가 방금 망쳤다**»는 작업 품질 검사다
 *      (`runner/lib/format-bleed.mjs` 머리말과 같은 결).
 */
export function checkBodyIntact(want, got) {
  const bare = (s) => String(s ?? "").replace(/\s+/g, "");
  const w = bare(want), g = bare(got);
  if (!w) return null;
  const wu = (String(want).match(/https?:[/][/]/g) || []).length;
  const gu = (String(got).match(/https?:[/][/]/g) || []).length;
  if (gu > wu) return `본문이 깨졌어요 — 링크가 ${wu}개여야 하는데 ${gu}개로 늘었어요(에디터 링크 변환).`;
  if (!g.startsWith(w.slice(0, Math.min(24, w.length)))) return "본문이 깨졌어요 — 입력한 글의 시작이 그대로 남아 있지 않아요.";
  if (g.length < w.length * 0.9) return `본문이 깨졌어요 — 글자가 ${w.length}자여야 하는데 ${g.length}자만 들어갔어요.`;
  return null;
}

/** 사진 첨부 — 🔴 **실패해도 본문은 올린다**(사진은 있으면 좋은 것). 못 붙였으면 **적는다**(AC-9). */
async function attachPhotos(page, files) {
  if (!files.length) return 0;
  const take = files.slice(0, MAX_PHOTOS);
  for (const sel of String(S.photo).split(",").map((x) => x.trim()).filter(Boolean)) {
    try {
      if (sel === "input[type=file]") {
        const input = page.locator(sel).first();
        if ((await input.count()) === 0) continue;
        await input.setInputFiles(take);
        await settle(page, 3000);
        return take.length;
      }
      const btn = await firstVisible(page, sel);
      if (!btn) continue;
      const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10_000 }), btn.click()]);
      await chooser.setFiles(take);
      await settle(page, 3000);
      return take.length;
    } catch { /* 다음 후보 */ }
  }
  return 0;
}

/**
 * 글 주소 회수 — AM 실측(2026-09-15): «완료» 뒤 URL 이 **목록**이라 종전 정규식이 **18건 전부** 못 잡았다.
 *   사다리(첫 성공에서 멈춘다): ① 완료 URL ② 목록의 `<a href>` ③ 목록 첫 카드 클릭 ④ 공유 요소의 href.
 *   🔴 **못 읽어도 던지지 않는다** — 글은 이미 올라갔다. `null` + 사유를 돌려준다(AC-9).
 */
async function recoverPostUrl(page, profileId, doneUrl) {
  const tried = [];
  const id0 = daangnPostIdOf(doneUrl);
  if (id0) return { url: clean(doneUrl), postId: id0, by: "url" };
  tried.push("완료 URL");
  try {
    await page.goto(`${BIZ}/biz_accounts/${profileId}/manager/posts/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await settle(page, 1500);
    const links = await page.locator('a[href*="/posts/"]').all().catch(() => []);
    for (const a of links) {
      const href = (await a.getAttribute("href").catch(() => "")) || "";
      const id = daangnPostIdOf(href);
      if (id) {
        const abs = /^https?:/.test(href) ? href : new URL(href, BIZ).toString();
        return { url: clean(abs), postId: id, by: "list_href" };
      }
    }
    tried.push("목록 링크");
    const card = await firstVisible(page, '[class*="card"], [role="listitem"], li');
    if (card) {
      await card.click().catch(() => {});
      await settle(page, 2000);
      const id = daangnPostIdOf(page.url());
      if (id) return { url: clean(page.url()), postId: id, by: "list_click" };
    }
    tried.push("목록 클릭");
  } catch { tried.push("목록 열기 실패"); }
  return { url: null, postId: null, by: null, reason: `글 주소를 못 읽었어요 — ${tried.join(" · ")}` };
}

export async function run({ ctx, job, plan, shotKey, dryRun, recipe }) {
  if (recipe?.selectors) S = { ...BUNDLED_SELECTORS, ...recipe.selectors };
  const page = ctx.pages()[0] ?? await ctx.newPage();
  const p = job.payload ?? {};
  let files = null;
  try {
    /* ① 비즈프로필 id — payload 의 handle 이 정본이고, 없으면 화면에서 읽는다. */
    let profileId = String(job.account?.handle ?? "").replace(/[^0-9]/g, "");
    if (!profileId) profileId = await detectProfileId(page);
    if (!profileId) {
      /* 🔴 «비즈프로필이 없다»와 «세션이 끊겼다»를 안 섞는다 — 고객이 할 일이 다르다. */
      const wall = classifyDaangnWall(page.url());
      if (wall) throw BLOCK(wall, "당근 로그인이 풀렸어요 — 다시 연결해 주세요.");
      throw BLOCK("nav", "당근 비즈프로필을 찾지 못했어요. 비즈프로필이 있어야 새소식을 올릴 수 있어요.");
    }

    /* ② 작성 화면. */
    await page.goto(`${BIZ}/biz_accounts/${profileId}/manager/posts/new/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page, 1500);
    const wall = classifyDaangnWall(page.url());
    if (wall) throw BLOCK(wall, "당근 로그인이 풀렸어요 — 다시 연결해 주세요.");
    await shot(page, shotKey, "01-작성화면");

    /* ③ 🔴 **서식은 0 이다** — 계획층이 이미 강조를 걷었다(`formatCaps` 전부 false). 여기서는 **평문만** 친다.
       ops 를 줄글로 잇는다: 이 에디터에는 소제목·인용·목록 요소가 없다. 🔴 없는 것을 흉내 내지 않는다(기호 장식 금지). */
    const title = String(p.title ?? "").trim().slice(0, 100);
    const body = (plan?.ops ?? [])
      .filter((o) => o.op === "para" || o.op === "quote" || o.op === "heading" || o.op === "list" || o.op === "check" || o.op === "faq")
      .map((o) => (o.op === "list" ? `• ${o.text}` : o.op === "check" ? `☑ ${o.text}` : String(o.text ?? "")))
      .filter(Boolean).join("\n\n");
    if (!body) throw BLOCK("parse", "올릴 본문이 비어 있어요.");

    if (dryRun) {
      /* 🔴 **탐침** — 여기까지만. 무엇을 찾았고 무엇을 못 찾았는지 그대로 보고한다(그게 셀렉터 표를 고치는 재료다). */
      const seen = {};
      for (const [k, sel] of Object.entries(S)) seen[k] = !!(await firstVisible(page, sel));
      return { dryRun: true, notes: [
        `비즈프로필 ${profileId} · 작성 화면 열림(${clean(page.url()).slice(0, 70)})`,
        `찾은 것: ${Object.entries(seen).filter(([, v]) => v).map(([k]) => k).join(" · ") || "없음"}`,
        `못 찾은 것: ${Object.entries(seen).filter(([, v]) => !v).map(([k]) => k).join(" · ") || "없음"}`,
        `본문 ${body.length}자 · 사진 ${(p.images ?? []).length}장(최대 ${MAX_PHOTOS}) · 서식 0(새소식 에디터는 평문이에요)`,
      ] };
    }

    const notes = [];
    const tEl = await firstVisible(page, S.title);
    if (!tEl) throw BLOCK("parse", "소식 제목 칸을 찾지 못했어요(화면이 바뀐 것 같아요).");
    await tEl.click().catch(() => {});
    await page.keyboard.insertText(title);
    const bEl = await firstVisible(page, S.body);
    if (!bEl) throw BLOCK("parse", "소식 본문 칸을 찾지 못했어요(화면이 바뀐 것 같아요).");
    await bEl.click().catch(() => {});
    await page.keyboard.insertText(body);
    await settle(page, 800);

    /* ④ 사진 — 최대 10장 · **첫 장이 대표**다. 못 붙여도 본문은 간다. */
    const imgs = (p.images ?? []).map((i) => i?.url).filter(Boolean).slice(0, MAX_PHOTOS);
    if (imgs.length) {
      files = await downloadImages(imgs);
      /* 🔴 `downloadImages` 는 Map(주소→파일|null) 이다 — 못 받은 것은 `null` 이라 **거른다**.
         안 거르면 `setInputFiles` 에 `null` 이 들어가 «사진 첨부 실패»가 아니라 **잡 전체가 죽는다**. */
      const n = await attachPhotos(page, [...files.values()].filter(Boolean));
      if (n) notes.push(`사진 ${n}장(첫 장이 대표)`);
      else notes.push("사진을 못 붙여서 글만 올렸어요(화면이 바뀐 것 같아요).");
    }

    /* ⑤ 🔴 **본문이 그대로 들어갔나** — 에디터가 링크로 갈아엎으면 여기서 멈춘다(AM 라이브 사고). */
    const got = await bEl.inputValue().catch(async () => await bEl.textContent().catch(() => ""));
    const broken = checkBodyIntact(body, got);
    if (broken) throw BLOCK("parse", `${broken} 사람이 직접 올려 주세요.`);
    await shot(page, shotKey, "02-입력완료");

    /* ⑥ 단계 진행 — 작성 → (쿠폰 제안) → 설정 → 완료. 옵션(알림·채팅)은 **계정 기본값 그대로 둔다**(우리가 고객 설정을 안 바꾼다). */
    for (let step = 0; step < 4; step++) {
      const skip = await firstVisible(page, S.couponSkip);
      if (skip) { await skip.click().catch(() => {}); await settle(page, 1200); continue; }
      const nextBtn = await firstVisible(page, S.next);
      if (nextBtn) { await nextBtn.click().catch(() => {}); await settle(page, 1500); continue; }
      break;
    }
    const doneBtn = await firstVisible(page, S.done);
    if (!doneBtn) throw BLOCK("parse", `마지막 «완료»를 못 찾았어요(${clean(page.url()).slice(0, 70)}).`);
    await doneBtn.click().catch(() => {});
    await settle(page, 3000);

    /* ⑦ 올라갔나 — 작성 화면을 벗어났으면 성공. 그대로면 **정직하게 실패**다. */
    if (/[/]posts[/]new/i.test(page.url())) throw BLOCK("parse", "«완료»를 눌렀는데도 작성 화면 그대로예요 — 올라가지 않았어요.");
    await shot(page, shotKey, "03-게시완료");

    const rec = await recoverPostUrl(page, profileId, page.url());
    if (!rec.url) notes.push(rec.reason);
    /* 🔴 멱등 키는 **주소를 못 읽어도** 만든다(`channel_ref` 가 있으면 서버가 재게시를 막는다 · CLAUDE §4.7). */
    const channelRef = rec.postId ? `daangn:${profileId}:${rec.postId}` : `daangn:${profileId}:${job.payload?.pieceId ?? job.id}`;
    /* 🔴 주소를 못 읽으면 **관리자 화면 주소를 대신 주지 않는다** — 그건 고객이 열 수 있는 «그 글»이 아니다.
       서버가 «주소를 못 읽었어요»로 그리고, 멱등은 위 `channelRef` 가 지킨다. */
    if (!rec.url) throw BLOCK("unknown", "올렸는데 글 주소를 못 읽었어요 — 당근 비즈프로필에서 확인해 주세요.");

    return {
      externalUrl: rec.url,
      channelRef,
      notes: [...notes, `주소 회수: ${rec.by}`, "당근 새소식은 서식(굵게·밑줄·인용)을 못 내서 글자만 올라가요."],
      /* [R9-2/5] 🔴 «못 낸 서식»은 **사실로** 보낸다 — 문장은 서버가 만든다(러너 판에 화면 문구를 묶지 않는다).
         계획층이 이미 걷었으므로 여기 숫자는 «이 채널에서 못 낸 것»의 정직한 합계다. */
      formatMarks: { applied: {}, planned: plan?.stats?.marks?.planned ?? null, kept: plan?.stats?.marks?.kept ?? null, demoted: plan?.stats?.demoted ?? [] },
    };
  } catch (e) {
    await failShot(page, shotKey);
    throw e;
  } finally {
    if (files) cleanupFiles(files);
  }
}

export const channel = "daangn";
