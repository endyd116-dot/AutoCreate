/**
 * runner/channels/reference-capture.mjs — **글 레퍼런스 캡처**(R10-1 · 설계 §3.1~3.3).
 *   잡 `reference.capture` — 고객이 붙여넣은 주소를 **러너가 열고 폰 폭으로 찍어** 서버에 넘긴다.
 *
 * ══ 왜 러너가 여나 (사장님 2026-09-16) ══
 *   «**남의 블로그 플랫폼을 러너로 긁지 마라라고 한 적이 없는데? 그거 네가 만든 게이트 아니야? 없애.**»
 *   ⇒ 러너가 여는 것이 **첫 번째 길**이다. «화면을 찍어 올려 주세요»는 못 열었을 때의 **사람 경로**지
 *      우리가 먼저 미는 길이 아니다(막지 않는다 · CLAUDE §9).
 *
 * ══ 🔴 안전선 — 막는 게 아니라 «긁기로 번지지 않게»(설계 §3.3) ══
 *   ① **고객이 손으로 넣은 주소만** — 자동 수집 0. 이 파일은 링크를 **따라가지 않는다**(a 태그를 안 본다).
 *   ② **한 번에 하나** — 잡 하나 = 주소 하나. 러너는 잡을 순차로 돈다(`core.mjs tick`).
 *   ③ 🔴 **캡처는 즉시 버린다** — 남의 글은 **한 장도 안 남는다.**
 *      ⇒ 🔴 **디스크에 아예 안 쓴다.** `page.screenshot({clip})` 이 돌려주는 **버퍼**를 그대로 base64 로 실어 보내고
 *         함수가 끝나면 사라진다. `runner/tmp` 도 `_shots` 도 안 쓴다 — **지우는 것보다 안 쓰는 게 세다**
 *         (지우기는 잊거나 실패할 수 있고, `finally` 가 안 도는 죽음도 있다).
 *      ⇒ 🔴 **로그에 주소·본문을 안 남긴다** — 장수·크기·높이만. 제목도 안 찍는다.
 *   ④ **공개된 글만** — 로그인 벽을 만나면 `login_wall` 로 정직하게 물러난다(뚫지 않는다).
 */
import { planCaptureSlices, PHONE_WIDTH, PHONE_VIEWPORT_HEIGHT } from "../lib/capture-slice.mjs";
import { BLOCK } from "../lib/auth-naver.mjs";

/** Netlify 본문 6MB 벽(B 와 합의 2026-09-16) — base64 합계 상한. 넘으면 **장수를 줄이지 않고 품질을 낮춘다.** */
const TOTAL_B64_CAP = 4_500_000;
const PER_SHOT_CAP = 800_000;
const QUALITY_STEPS = [80, 68, 56, 45, 35];

/** 로그인 벽을 «긍정 신호»로 본다 — 🔴 «본문이 안 보인다»로 추정하지 않는다(AC-9: 없음의 부재로 판정 금지). */
const LOGIN_WALL = /로그인|sign\s?in|log\s?in|계정에\s?로그인|본인확인/i;
const BLOCKED = /접근이\s?제한|차단|blocked|forbidden|비정상적인\s?접근|robot|자동화된/i;
const NOT_FOUND = /삭제되었거나|존재하지\s?않|없는\s?페이지|not found|404/i;

export async function run({ ctx, job }) {
  const payload = job.payload ?? {};
  const url = String(payload.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) throw BLOCK("nav", "주소가 올바르지 않아요(http/https 로 시작해야 해요).");

  const width = Number(payload.width) > 0 ? Number(payload.width) : PHONE_WIDTH;
  const viewportHeight = Number(payload.viewportHeight) > 0 ? Number(payload.viewportHeight) : PHONE_VIEWPORT_HEIGHT;

  const page = ctx.pages()[0] ?? await ctx.newPage();
  /* 🔴 **폰 폭으로 찍는다** — 데스크톱 폭이면 한 문단이 2줄로 보이는데 실제 독자(모바일)에겐 5줄이다.
     독자가 보는 폭이 아니면 «문단 리듬»이 **틀린 값**이 된다(사장님 2026-09-16). */
  await page.setViewportSize({ width, height: viewportHeight });

  let resp = null;
  try {
    resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch (e) {
    /* 🔴 갈래를 **글자 그대로** 쓴다 — 삼항으로 접어 두면 «이 코드가 timeout 을 내긴 하나»를 검사가 못 본다
       (실제로 `verify-reference-capture` C-19 가 그래서 빨개졌다 · AC-69 의 사촌: 이름이 있어야 셀 수 있다). */
    if (/timeout|Timeout/.test(String(e?.message ?? e))) throw BLOCK("timeout", "그 주소가 제때 열리지 않았어요.");
    throw BLOCK("nav", "그 주소를 열지 못했어요.");
  }
  const status = resp?.status() ?? 0;
  if (status === 404 || status === 410) throw BLOCK("not_found", "그 주소에 글이 없어요(지워졌거나 주소가 바뀐 것 같아요).");
  if (status === 403 || status === 429) throw BLOCK("blocked", "그 사이트가 접근을 막았어요.");

  /* 스크롤로 게으른 이미지를 깨운다 — 사진이 안 뜬 채로 찍으면 «사진 몇 장·어디에»가 **0으로 잘못 읽힌다**(AC-9). */
  await autoScroll(page);
  await page.waitForTimeout(700);

  /* 🔴 화면 문구로 «못 여는 이유»를 가른다 — 본문 길이로 추정하지 않는다.
     ⚠️ 본문을 **읽지 않는다**: 아래 evaluate 는 문구 **매칭 결과(불리언)만** 돌려주고 글자를 밖으로 내보내지 않는다. */
  const wall = await page.evaluate((pats) => {
    const t = (document.body?.innerText ?? "").slice(0, 4000);
    const has = (re) => new RegExp(re.source, re.flags).test(t);
    return {
      login: has(new RegExp(pats.login, "i")),
      blocked: has(new RegExp(pats.blocked, "i")),
      notFound: has(new RegExp(pats.notFound, "i")),
      textLen: t.replace(/\s+/g, "").length,
    };
  }, { login: LOGIN_WALL.source, blocked: BLOCKED.source, notFound: NOT_FOUND.source }).catch(() => null);

  if (wall?.notFound) throw BLOCK("not_found", "그 주소에 글이 없어요(지워졌거나 주소가 바뀐 것 같아요).");
  if (wall?.blocked) throw BLOCK("blocked", "그 사이트가 접근을 막았어요.");
  /* 🔴 로그인 벽은 **문구가 있고 본문이 거의 없을 때만** — 글 안에 «로그인» 이라는 낱말이 나오는 것만으로 판정하면
     멀쩡한 글을 «못 읽었다»로 돌려보낸다(AC-68: 전부 거절은 막는 게 아니라 고장이다). */
  if (wall?.login && wall.textLen < 400) throw BLOCK("login_wall", "로그인해야 보이는 글이라 열지 못했어요.");

  const pageHeight = await page.evaluate(() => Math.max(
    document.body?.scrollHeight ?? 0, document.documentElement?.scrollHeight ?? 0,
    document.body?.offsetHeight ?? 0, document.documentElement?.offsetHeight ?? 0,
  )).catch(() => 0);

  const plan = planCaptureSlices(pageHeight, {
    width, viewportHeight,
    ...(Number(payload.maxShots) > 0 ? { max: Number(payload.maxShots) } : {}),
    ...(Number(payload.overlapPct) > 0 ? { overlapPct: Number(payload.overlapPct) } : {}),
    ...(Number(payload.viewportsPerShot) > 0 ? { viewportsPerShot: Number(payload.viewportsPerShot) } : {}),
  });
  /* 🔴 높이를 못 쟀으면 **한 장도 안 찍는다** — 지어낸 높이로 찍으면 «없는 부분»을 모델이 읽는다(AC-92). */
  if (!plan.count) throw BLOCK("nav", "글의 길이를 재지 못해서 몇 장으로 찍을지 정할 수 없었어요.");

  const finalUrl = page.url();
  let shots = null;
  let usedQuality = 0;
  /* 🔴 합계가 벽을 넘으면 **장수를 줄이지 않고 품질을 낮춘다**(B 와 합의) — 처음·중간·끝이 **다 있어야** 한다.
     한 장을 빼면 그 구간의 «어떻게 생겼나»는 영영 못 읽는다. 품질은 낮아져도 굵게·밑줄은 남는다. */
  for (const q of QUALITY_STEPS) {
    const out = [];
    let total = 0;
    for (const s of plan.slices) {
      const buf = await page.screenshot({
        type: "jpeg", quality: q,
        clip: { x: 0, y: s.y, width, height: Math.min(s.h, Math.max(1, plan.pageHeight - s.y)) },
      });
      const data = buf.toString("base64");
      total += data.length;
      out.push({ i: s.index, mime: "image/jpeg", data, w: width, h: s.h, y0: s.y, y1: s.y + s.h });
    }
    const biggest = Math.max(...out.map((o) => o.data.length));
    if (total <= TOTAL_B64_CAP && biggest <= PER_SHOT_CAP) { shots = out; usedQuality = q; break; }
    /* 다음 품질로 — 🔴 앞 판의 버퍼는 여기서 참조가 끊긴다(디스크에 안 썼으니 지울 것도 없다). */
  }
  if (!shots) {
    /* 가장 낮은 품질로도 벽을 못 넘겼다 — 🔴 **조용히 장수를 깎지 않는다.** 정직하게 실패하고 사람 경로로 넘긴다. */
    throw BLOCK("blocked", "글이 너무 길어서 사진으로 담지 못했어요. 화면을 직접 찍어서 올려 주시면 그대로 읽어 드릴게요.");
  }

  /* 🔴 로그에 **주소·제목·본문 0** — 장수·크기·높이만(설계 §3.3 ③ «남의 글은 한 장도 안 남는다»의 로그판).
     ⚠️ 크기도 **미리 숫자로 빼서** 찍는다 — 로그 줄 안에서 `shot.data` 를 건드리면 다음 사람이 거기에
        «주소도 한 줄»을 붙이기 쉽다. 검사(`verify-reference-capture` C-16)가 그 줄을 통째로 본다. */
  const totalKb = Math.round(shots.reduce((a, s) => a + s.data.length, 0) / 1024);
  console.log(`  · 레퍼런스 캡처 ${shots.length}장(폭 ${width} · 페이지 ${plan.pageHeight}px · 품질 ${usedQuality} · 합계 ${totalKb}KB)`);
  for (const line of plan.why) console.log(`  · ${line}`);

  return {
    shots,
    page: { height: plan.pageHeight, finalUrl, width, count: shots.length, quality: usedQuality, overlapPct: plan.overlapPct },
    why: plan.why,
    notes: plan.why,
  };
}

/** 게으른 이미지·무한 스크롤을 깨운다. 🔴 **끝까지 못 가도 실패가 아니다** — 잰 높이로 자른다. */
async function autoScroll(page, maxMs = 12_000) {
  const deadline = Date.now() + maxMs;
  let last = -1;
  while (Date.now() < deadline) {
    const h = await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight * 0.9);
      return Math.max(document.body?.scrollHeight ?? 0, document.documentElement?.scrollHeight ?? 0);
    }).catch(() => -1);
    if (h < 0) break;
    const atEnd = await page.evaluate(() => (window.scrollY + window.innerHeight) >= (document.documentElement.scrollHeight - 4)).catch(() => true);
    if (atEnd && h === last) break;
    last = h;
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

export const channel = "reference_capture";
