/**
 * scripts/verify-p1r7-outputs-probe.mts — **R7 §1·§2 산출물 되짚기**(C · DB 는 읽기 전용).
 *   `npx tsx --env-file=.env scripts/verify-p1r7-outputs-probe.mts`
 *
 *   «만들었다» 가 아니라 **남아 있는 물건**을 센다. 두 부분이다.
 *     [A] 실물 — 진짜 발행된 글이 있는가 · 그 주소가 지금도 열리는가 · 수익 매칭 열쇠가 붙었는가
 *     [B] 고지 — 남의 서버로 나가기 직전 게이트(`runPublishGate`)가 **첫머리 고지**를 실제로 세우는가
 *
 *   🔴 [A] 가 0건일 때 그것을 «통과» 로 접지 않는다(AC-9). 0건은 «못 쟀다» 이고, 그 사유를 note 에 적는다.
 *      0건의 사유가 **teardown**(테스트 집을 지웠다)인지 **미실행**(그 길을 아직 아무도 안 지나갔다)인지를 갈라 적는다 — 둘은 전혀 다른 얘기다.
 */
import "./_lib/load-env.mjs";   // [R17-B2] 🔴 맨 위 — 없으면 db/index 가 빈 URL 로 풀을 만들어 `read ECONNRESET` 이라는 **가짜 빨강**을 낸다
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { runPublishGate, countAffiliateLinks } from "../lib/publish/gate";
import { disclosureTextFor } from "../lib/disclosure";
import { renderBlocksHtml, type Block } from "../lib/blocks";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const out = (step: string, ok: boolean | "WARN", note: string) => console.log(`RESULT ${JSON.stringify({ step, ok, note })}`);
const N = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
/** 수익이 **영상 id(channel_ref)** 로 붙는 채널(`lib/revenue/youtube.ts:35` 계열). 나머지는 주소로 귀속한다. */
const REF_CHANNELS = new Set(["youtube", "youtube_shorts", "instagram", "threads", "tiktok"]);
const isFake = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1)/.test(u);

async function alive(url: string): Promise<string> {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 8000);
    const r = await fetch(url, { redirect: "follow", signal: c.signal, headers: { "User-Agent": "Mozilla/5.0 AutoCreate-verify" } });
    clearTimeout(t);
    return String(r.status);
  } catch (e) { return `못 엶(${String((e as Error)?.message ?? e).slice(0, 40)})`; }
}

async function sectionA() {
  const rows = await q(sql`SELECT p.id, p.tenant_id, p.channel, p.status, p.external_url, p.channel_ref,
      (SELECT email FROM users WHERE tenant_id = p.tenant_id ORDER BY id LIMIT 1) AS email
    FROM posts p WHERE p.external_url IS NOT NULL AND p.external_url <> '' ORDER BY p.id DESC LIMIT 60`);
  const real = rows.filter((r) => !isFake(String(r.external_url)));
  const byCh = [...real.reduce((m, r) => m.set(String(r.channel), (m.get(String(r.channel)) ?? 0) + 1), new Map<string, number>())]
    .map(([c, n]) => `${c} ${n}`).join(" · ");

  out("§2.1 실발행 — 남의 서버에 진짜로 올라간 글", real.length > 0 ? true : "WARN",
    real.length ? `${real.length}건 · ${byCh}`
      : "0건 — **미실행**이다(teardown 탓이 아니다). 계약 §2.1 은 사장님 계정 로그인 1회가 선결이라 합동 세션 항목이고, 산출물 docs/history/2026-09-15-first-publish.md 도 아직 없다");

  const probe = real.slice(0, 6);
  const codes: string[] = [];
  for (const r of probe) codes.push(`post ${r.id} ${r.channel} → ${await alive(String(r.external_url))}`);
  out("§2.1 그 주소가 **지금도 열린다**(쿠키 없는 GET)", probe.length === 0 ? "WARN" : codes.every((c) => c.endsWith("200")),
    probe.length === 0 ? "잴 주소가 0건 — 못 쟀다(통과 아님)" : codes.join(" · "));

  const needRef = real.filter((r) => REF_CHANNELS.has(String(r.channel)));
  const missRef = needRef.filter((r) => !String(r.channel_ref ?? "").trim());
  const badRef = real.filter((r) => !REF_CHANNELS.has(String(r.channel)) && String(r.channel_ref ?? "").trim());
  out("§1.3 수익 매칭 열쇠 — 영상 id 로 귀속하는 채널엔 channel_ref 가 있다", needRef.length === 0 ? "WARN" : missRef.length === 0,
    needRef.length === 0 ? "해당 채널 실발행 0건 — 못 쟀다" : `대상 ${needRef.length}건 · 빠진 것 ${missRef.length}건`);
  out("🔴 §1.3 모양이 안 굳은 채널(네이버·티스토리·블로거·WP)엔 **틀린 ref 를 넣지 않았다**(없는 ref < 틀린 ref)",
    badRef.length === 0, badRef.length ? `틀린 ref ${badRef.length}건` : `대상 ${real.length - needRef.length}건 · 틀린 ref 0건`);

  const [vid] = await q(sql`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE meta ? 'measured')::int AS measured FROM piece_assets WHERE kind = 'video'`);
  out("§1.5 영상 산출물 — piece_assets(video) 행", N(vid?.n) > 0 ? true : "WARN",
    N(vid?.n) > 0 ? `video ${vid?.n}행 · 실측표시 ${vid?.measured}행`
      : "0행 — **teardown 탓**이다(R5·R6 의 렌더는 전부 테스트 집이라 정리 때 함께 지웠다). 실측 지속의 증거는 P1R5 보고서의 row id 로 남아 있다 · 여기선 못 쟀다");

  const [mark] = await q(sql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'post_marked_manual'`);
  out("§1.3 «올린 주소 적기» 를 지나간 흔적(감사 post_marked_manual)", N(mark?.n) > 0 ? true : "WARN",
    `${mark?.n}행 — 0 이면 **미실행**(코드는 있고 아직 아무도 안 지나갔다)`);
}

/** [B] 고지 — 실제 게이트 함수에 실제 본문을 먹인다. DB 접근 0. */
function sectionB() {
  const DIS = disclosureTextFor("coupang");
  const link = `<a class="affiliate" href="https://link.coupang.com/a/abc">이 제품</a>`;
  const firstBlock = (html: string) => (html.match(/<div[^>]*class="[^"]*\bdisclosure\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ?? [])[0] ?? "";
  const startsWithDis = (html: string) => /^\s*<div[^>]*class="[^"]*\bdisclosure\b/i.test(html);
  const disCount = (html: string) => (html.match(/class="[^"]*\bdisclosure\b/gi) || []).length;

  /* ① 사람이 고지를 지운 제휴 글 → 정본 문구가 **첫 요소로** 복원 */
  const g1 = runPublishGate({ channel: "tistory", title: "가을 이불 고르기", bodyHtml: `<p>본문입니다</p>${link}`, affiliate: { provider: "coupang" } });
  out("🔴 §16B 고지 — 사람이 지워도 발행 직전에 **본문 첫 요소로** 되살아난다",
    g1.ok && startsWithDis(g1.bodyHtml) && disCount(g1.bodyHtml) === 1 && firstBlock(g1.bodyHtml).includes(DIS),
    `ok=${g1.ok} 첫요소=${startsWithDis(g1.bodyHtml)} 고지수=${disCount(g1.bodyHtml)} 문구=«${DIS.slice(0, 22)}…» 본문바뀜=${g1.changed}`);

  /* ② 고지가 본문 한가운데 묻힌 글 → 첫머리로 올라오고 **중복이 남지 않는다** */
  const g2 = runPublishGate({ channel: "tistory", title: "t", bodyHtml: `<p>머리말</p><div class="disclosure">${DIS}</div><p>본문</p>${link}`, affiliate: { provider: "coupang" } });
  out("§16B 고지 — 가운데 묻힌 고지는 첫머리로 올라오고 중복이 남지 않는다",
    startsWithDis(g2.bodyHtml) && disCount(g2.bodyHtml) === 1, `첫요소=${startsWithDis(g2.bodyHtml)} 고지수=${disCount(g2.bodyHtml)}`);

  /* ③ 🔴 음성 대조 — 제휴가 **아닌** 글엔 고지를 만들어 붙이지 않는다(없는 광고를 있다고 말하지 않는다) */
  const g3 = runPublishGate({ channel: "tistory", title: "일기", bodyHtml: `<p>오늘은 비가 왔다</p>` });
  out("🔴 §16B 음성 대조 — 제휴가 아닌 글엔 고지를 **안 붙인다**(없는 광고를 있다고 말하지 않는다)",
    g3.ok && disCount(g3.bodyHtml) === 0 && !g3.changed, `ok=${g3.ok} 고지수=${disCount(g3.bodyHtml)} 본문바뀜=${g3.changed}`);

  /* ④ 금칙어 · ⑤ 제휴 링크 3개 → **발행 금지**(경고 아님) */
  const g4 = runPublishGate({ channel: "tistory", title: "100% 효과 보장", bodyHtml: `<p>최저가 보장! 부작용 없음</p>${link}`, affiliate: { provider: "coupang" } });
  const g5 = runPublishGate({ channel: "tistory", title: "t", bodyHtml: `<p>x</p>${link}${link}${link}`, affiliate: { provider: "coupang" } });
  out("§16B 광고법 금칙어가 있으면 **발행 금지**(고지는 살아 있어도 ok=false)",
    g4.ok === false && g4.report.checks.some((c) => c.key === "banned_words" && !c.pass),
    `ok=${g4.ok} · 떨어진 검사 ${g4.report.checks.filter((c) => !c.pass).map((c) => c.key).join(",")}`);
  out("§16B 제휴 링크 3개 → 발행 금지(2개 이하)",
    g5.ok === false && countAffiliateLinks(g5.bodyHtml) === 3, `링크 ${countAffiliateLinks(g5.bodyHtml)}개 · ok=${g5.ok}`);

  /* ⑤b 🔴 **진짜 렌더러로** 만든 본문으로 다시 센다 — 문자열 흉내가 아니라 `renderBlocksHtml` 이 내놓는 그 모양(AC-31).
        설계 §16B 는 «제휴 링크 2개 이하» 다. 쿠팡 상품 2개짜리 정상 글이 여기서 막히면 그건 게이트가 고객을 막는 것이다. */
  const prod = (i: number): Block => ({ type: "affiliate", affiliate: { url: `https://link.coupang.com/a/prod${i}`, productName: `상품 ${i}`, price: 19900 } } as Block);
  const body2 = renderBlocksHtml([{ type: "para", text: "본문입니다" } as Block, prod(1), prod(2)], "tistory");
  const g5b = runPublishGate({ channel: "tistory", title: "가을 이불 2종 비교", bodyHtml: body2, affiliate: { provider: "coupang" } });
  out("🔴 §16B 쿠팡 상품 **2개**짜리 정상 글은 통과해야 한다(렌더러가 내놓는 진짜 본문으로 잰다)",
    g5b.ok === true && countAffiliateLinks(body2) === 2,
    `<a> 2개인데 센 값 ${countAffiliateLinks(body2)}개 · ok=${g5b.ok}${g5b.ok ? "" : " · 떨어진 검사 " + g5b.report.checks.filter((c) => !c.pass).map((c) => c.key).join(",")}`);
  const body3 = renderBlocksHtml([prod(1), prod(2), prod(3)], "tistory");
  out("§16B …그러나 3개는 여전히 막는다(양성 대조가 게이트를 무력화하지 않았다)",
    countAffiliateLinks(body3) === 3 && runPublishGate({ channel: "tistory", title: "t", bodyHtml: body3, affiliate: { provider: "coupang" } }).ok === false,
    `<a> 3개 → 센 값 ${countAffiliateLinks(body3)}개`);
  const hand = `${renderBlocksHtml([prod(1)], "tistory")}\n<p>그리고 <a href="https://link.coupang.com/a/hand">이것도</a></p>`;
  out("§16B 사람이 손으로 붙인 쿠팡 직링크도 **같이** 센다(렌더 1 + 손 1 = 2)",
    countAffiliateLinks(hand) === 2, `센 값 ${countAffiliateLinks(hand)}개`);

  /* ⑥ 광고 자리 — 키 없으면 **빈 div 를 남의 블로그에 남기지 않는다** · 네이버는 애초에 안 붙인다 */
  const slot = `<p>a</p><div class="ad-slot" data-slot="mid"></div><p>b</p>`;
  const g6 = runPublishGate({ channel: "tistory", title: "t", bodyHtml: slot });
  const g7 = runPublishGate({ channel: "tistory", title: "t", bodyHtml: slot }, { adsensePub: "ca-pub-1234567890" });
  const g8 = runPublishGate({ channel: "naver_blog", title: "t", bodyHtml: slot }, { adsensePub: "ca-pub-1234567890" });
  const label = /ad-label">광고</;
  out("§16B.3 광고 자리 — 키가 없으면 **빈 자리를 지운다**(남의 블로그에 빈 div 를 남기지 않는다)",
    !/ad-slot|adsense/i.test(g6.bodyHtml), `남은 자리 ${(g6.bodyHtml.match(/ad-slot|adsense/gi) || []).length}개`);
  out("§16B.3 키가 있으면 실제 유닛 + «광고» 라벨(본문과 혼동 금지)",
    /adsbygoogle/.test(g7.bodyHtml) && label.test(g7.bodyHtml) && g7.bodyHtml.includes("ca-pub-1234567890"),
    `유닛=${/adsbygoogle/.test(g7.bodyHtml)} 라벨=${label.test(g7.bodyHtml)}`);
  out("§16B.3 네이버 블로그엔 애드센스를 붙이지 않는다(애드포스트 채널 · 키가 있어도)",
    !/adsbygoogle/.test(g8.bodyHtml), `유닛 ${(g8.bodyHtml.match(/adsbygoogle/g) || []).length}개`);
}

async function main() {
  try { await sectionA(); sectionB(); }
  catch (e) { out("산출물 프로브 예외", false, String((e as Error)?.stack ?? e).slice(0, 220)); }
  finally { await pgClient.end().catch(() => {}); }
}
await main();
