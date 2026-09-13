/**
 * runner/channels/post-alive.mjs — 발행한 글이 살아 있나 · 조회수는 얼마나(계약 §2 `verify.post_alive`·`revenue.stats`).
 *   DESIGN §7.2 health_score 재료(«발행 후 삭제» 감지) · §5B.7 learn 스텝의 러너 채널 경로.
 *
 *   🔴 정직 규율 — **모르면 모른다고 한다.**
 *      · alive 는 «404/410 이면 false», 「우리가 못 읽었다」는 false 가 아니라 `unknown`(서버가 상태를 뒤집지 않는다).
 *      · 조회수는 화면에 숫자가 실제로 보일 때만 싣는다. 0 을 지어내지 않는다(빈 키를 안 싣는 게 계약이다).
 */
import { settle } from "../lib/browser.mjs";

const BLOCK = (kind, msg) => Object.assign(new Error(`[block:${kind}] ${msg}`), { errorKind: kind });

const num = (s) => {
  const m = String(s ?? "").replace(/[,\s]/g, "").match(/\d+/);
  return m ? Number(m[0]) : null;
};

/** 티스토리 조회수 위젯 후보(스킨마다 다르다 — 못 찾으면 안 싣는다). */
const TISTORY_VIEW_SEL = [
  ".count_num", ".txt_count", "[class*='view_count']", "[class*='hit']", "#counter",
];

export async function run({ ctx, job }) {
  const payload = job.payload ?? {};
  const url = String(payload.externalUrl ?? "").trim();
  if (!/^https?:\/\//i.test(url)) throw BLOCK("unknown", "확인할 글 주소가 없어요.");

  const page = ctx.pages()[0] ?? await ctx.newPage();
  let status = 0;
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    status = res?.status() ?? 0;
  } catch (e) {
    throw BLOCK("network", `글 주소에 접속하지 못했어요(${String(e?.message ?? e).slice(0, 60)}).`);
  }
  await settle(page, 1500);

  if (status === 404 || status === 410) return { stats: {}, alive: false, notes: ["글이 사라졌어요(404)"] };

  const body = ((await page.locator("body").innerText().catch(() => "")) || "");
  const gone = /삭제(된|되었)|존재하지 않는 (글|페이지)|페이지를 찾을 수 없|비공개( 글)?입니다/.test(body);
  if (gone) return { stats: {}, alive: false, notes: ["글이 삭제·비공개 상태예요"] };

  const stats = {};
  const channel = String(job.account?.channel ?? "");
  if (channel === "tistory") {
    for (const sel of TISTORY_VIEW_SEL) {
      const t = await page.locator(sel).first().innerText({ timeout: 1200 }).catch(() => "");
      const v = num(t);
      if (v !== null) { stats.views = v; break; }
    }
  } else if (channel === "naver_blog") {
    /* 네이버 블로그 조회수는 본문 iframe 안의 «조회 N» 에 있다(스킨·설정에 따라 없을 수도 있다).
       못 찾으면 **안 싣는다** — 0 으로 적으면 «조회 0» 이 사실처럼 굳는다. */
    const frames = [page, ...page.frames()];
    for (const f of frames) {
      const t = await f.locator("text=/조회\\s*[\\d,]+/").first().innerText({ timeout: 1000 }).catch(() => "");
      const v = num(t);
      if (v !== null) { stats.views = v; break; }
    }
  }

  const notes = [];
  if (stats.views === undefined) notes.push("조회수는 화면에서 찾지 못했어요(안 싣습니다)");
  // ⏰ lastSyncAt 은 서버가 UTC 로 찍는다(저장 UTC · 표시 KST — DESIGN §13.5). 러너는 숫자만 보낸다.
  return { stats, alive: true, notes };
}

export const channel = "verify";
