/**
 * scripts/verify-publish-already.mts — 🔴 «올리기 전에 채널에 이미 있나» 판정을 잰다(AC-200 · B2 · 2026-09-21).
 *   사용: npx --yes tsx scripts/verify-publish-already.mts        · DB 0 · 네트워크 0(실물 피드 조각을 박아 뒀다)
 *
 *   ══ 재는 것 ══
 *     ① feedUrlFor — 채널별 주소. 🔴 **모르는 채널은 null**(추측 주소 0) · 티스토리 규칙은 러너와 글자 그대로 같다
 *     ② parseFeed  — 실물 RSS(2026-09-21 채취) 파싱 · 🔴 **빈 채널 제목**(없는 블로그)과 **0건**(RSS 끔)을 가른다
 *     ③ normTitle  — **좁게** 잡는다(비슷한 제목이 같아지면 멀쩡한 새 글이 «이미 있어요»가 된다)
 *     ④ judgeFeed  — 판정표 6줄 그대로
 *     ⑤ 🔴 변이(AC-87 음성 대조) — 판정을 **일부러 어긋낸 6종**을 같은 표에 돌려 **전부 빨강이 나는지** 본다.
 *          «자가 통과한다»가 아니라 «자가 **틀린 것을 잡는다**»를 재는 자리다.
 *     ⑥ 사람말 — 위협·책임 전가 0(CLAUDE §3) · absent·unknown 은 사람에게 말 걸지 않는다
 */
import { feedUrlFor, parseFeed, normTitle, judgeFeed, alreadySay, type AlreadyAsk, type FeedItem } from "../lib/publish/already";

let pass = 0; let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ""}`); } };

/* ═══ 실물 조각 — 2026-09-21 에 실제로 받아 온 모양(읽기만 · 쓰기 0) ═══ */
const NAVER_REAL = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>endy1116님의블로그</title><link>https://blog.naver.com/endy1116</link>
  <item><title><![CDATA[[서식 시험 2] 강조·인용·목록·표·사진 세 장·링크]]></title>
    <link><![CDATA[https://blog.naver.com/endy1116/224417455406?fromRss=true&trackingCode=rss]]></link>
    <pubDate>Sun, 20 Sep 2026 06:00:49 +0900</pubDate></item>
  <item><title><![CDATA[[서식 시험] 인용·강조·목록·사진 배치 확인]]></title>
    <link><![CDATA[https://blog.naver.com/endy1116/224417433862?fromRss=true&trackingCode=rss]]></link>
    <pubDate>Sun, 20 Sep 2026 04:24:43 +0900</pubDate></item>
  <item><title><![CDATA[AutoCreate 발행 시험 — 지워 주세요]]></title>
    <link><![CDATA[https://blog.naver.com/endy1116/224417400001?fromRss=true&trackingCode=rss]]></link>
    <pubDate>Sat, 19 Sep 2026 22:10:00 +0900</pubDate></item>
</channel></rss>`;

/** 🔴 없는 네이버 아이디 — **404 가 아니라 200 + 빈 태그**다(실측). 이 모양을 «0건»으로 읽으면 안 된다. */
const NAVER_NO_BLOG = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title/><link/><description/><language/><generator/></channel></rss>`;

/** 티스토리 — 블로그는 멀쩡한데 RSS 가 0건(실측: ppss·itwiki). «없다»의 증거가 못 된다. */
const TISTORY_EMPTY = `<?xml version="1.0"?><rss version="2.0"><channel>
  <title>투자하는 개발자</title><link>https://ppss.tistory.com</link></channel></rss>`;

const TISTORY_REAL = `<?xml version="1.0"?><rss version="2.0"><channel>
  <title>Notepad</title><link>https://notepad96.tistory.com</link>
  <item><title>Figma 단축키 정리</title><link>https://notepad96.tistory.com/279</link>
    <pubDate>Sun, 4 Dec 2022 20:45:05 +0900</pubDate></item>
</channel></rss>`;

console.log("① feedUrlFor — 채널별 주소(모르면 null · 추측 0)");
{
  ok("naver_blog", feedUrlFor("naver_blog", "endy1116") === "https://rss.blog.naver.com/endy1116.xml");
  ok("naver_blog — @ 접두사를 떼고 본다", feedUrlFor("naver_blog", "@endy1116") === "https://rss.blog.naver.com/endy1116.xml");
  ok("naver_blog — 주소가 통째로 와도 아이디를 뽑는다", feedUrlFor("naver_blog", "https://blog.naver.com/endy1116/224417455406") === "https://rss.blog.naver.com/endy1116.xml");
  ok("🔴 naver_blog — «이름.naver» 는 아이디가 아니다", feedUrlFor("naver_blog", "PostList.naver") === null, String(feedUrlFor("naver_blog", "PostList.naver")));
  ok("tistory — 짧은 이름은 subdomain", feedUrlFor("tistory", "notepad96") === "https://notepad96.tistory.com/rss");
  ok("tistory — 점이 있으면 커스텀 도메인 그대로(러너 blogHost 와 같은 규칙)", feedUrlFor("tistory", "tech.example.com") === "https://tech.example.com/rss");
  ok("🔴 물을 길 없는 채널은 null — wordpress·blogger·youtube_shorts·threads·daangn",
    ["wordpress", "blogger", "youtube_shorts", "threads", "daangn", "x"].every((c) => feedUrlFor(c, "abc") === null));
  ok("빈 handle 은 null", feedUrlFor("naver_blog", "") === null && feedUrlFor("naver_blog", "  ") === null);
}

console.log("\n② parseFeed — 실물 모양 · 🔴 «없는 블로그»와 «0건»을 가른다");
{
  const n = parseFeed(NAVER_REAL);
  ok("네이버 채널 제목", n.channelTitle === "endy1116님의블로그", String(n.channelTitle));
  ok("네이버 항목 3건", n.items.length === 3, String(n.items.length));
  ok("CDATA 를 푼다", n.items[0].title === "[서식 시험 2] 강조·인용·목록·표·사진 세 장·링크", n.items[0].title);
  ok("주소를 읽는다(logNo 포함)", n.items[0].url.includes("/endy1116/224417455406"), n.items[0].url);
  ok("&amp; 를 & 로 푼다", n.items[0].url.includes("&trackingCode"), n.items[0].url);
  ok("pubDate → ISO(KST +09:00 를 UTC 로)", n.items[0].at === "2026-09-19T21:00:49.000Z", String(n.items[0].at));
  const nb = parseFeed(NAVER_NO_BLOG);
  ok("🔴 없는 블로그 = 채널 제목 null(빈 태그)", nb.channelTitle === null && nb.items.length === 0, JSON.stringify(nb.channelTitle));
  const te = parseFeed(TISTORY_EMPTY);
  ok("🔴 RSS 껐지만 살아 있는 블로그 = 제목 있고 0건(위와 다른 사실)", te.channelTitle === "투자하는 개발자" && te.items.length === 0);
  const tr = parseFeed(TISTORY_REAL);
  ok("티스토리 실물", tr.channelTitle === "Notepad" && tr.items.length === 1 && tr.items[0].url === "https://notepad96.tistory.com/279");
  ok("쓰레기 입력에도 안 터진다", (() => { try { const r = parseFeed("<<>not xml"); return r.items.length === 0; } catch { return false; } })());
  ok("🔴 채널 제목을 첫 항목 제목으로 잘못 읽지 않는다",
    parseFeed(`<rss><channel><title/><item><title>글제목</title></item></channel></rss>`).channelTitle === null);
}

console.log("\n③ normTitle — 좁게 잡는다(비슷한 제목이 같아지면 안 된다)");
{
  ok("공백·대소문자·문장부호만 지운다", normTitle("  [서식 시험] 인용·강조!  ") === normTitle("[서식시험]인용강조"));
  ok("NFKC — 전각/반각을 하나로", normTitle("ＡＢＣ１２３") === normTitle("abc123"));
  ok("🔴 다른 제목은 다르게 남는다(앞자리만 보지 않는다)",
    normTitle("전기요금 줄이는 법 5가지") !== normTitle("전기요금 줄이는 법 7가지"));
  ok("🔴 긴 제목의 뒷부분을 버리지 않는다",
    normTitle("여름 전기요금 절약 — 에어컨 편") !== normTitle("여름 전기요금 절약 — 냉장고 편"));
  ok("제로폭 문자를 지운다", normTitle("전기​요금") === normTitle("전기요금"));
}

/* ═══ ④ 판정표 — 트리거 §3 «판정표를 먼저 적고 돌린다» ═══ */
interface Case { name: string; xml: string; want: string; since: string | null; verdict: AlreadyAsk["verdict"]; why?: string }
const TABLE: Case[] = [
  { name: "없는 블로그 → unknown(blog_not_found)", xml: NAVER_NO_BLOG, want: "아무 제목", since: null, verdict: "unknown", why: "blog_not_found" },
  { name: "🔴 0건 → unknown(empty_feed) — «없다»가 아니다", xml: TISTORY_EMPTY, want: "아무 제목", since: null, verdict: "unknown", why: "empty_feed" },
  /* 🔴 이 줄에서 **내가 틀렸다**(2026-09-21): 저 글의 pubDate 는 KST 09-20 06:00 = **UTC 09-19T21:00:49Z** 다.
     처음에 since 를 «2026-09-20T00:00:00Z» 로 적어 놓고 «글보다 앞»이라 여겼는데 UTC 로는 **뒤**였다 —
     자가 빨강을 냈고 코드가 아니라 **표가 틀렸다**. CLAUDE §4.5b 가 말하는 바로 그 함정(머리는 KST, 값은 UTC). */
  { name: "같은 제목이 since 뒤 → found_after", xml: NAVER_REAL, want: "[서식 시험 2] 강조·인용·목록·표·사진 세 장·링크", since: "2026-09-19T12:00:00.000Z", verdict: "found_after" },
  { name: "같은 제목이 since 앞 → found_before(막지 않는다)", xml: NAVER_REAL, want: "[서식 시험 2] 강조·인용·목록·표·사진 세 장·링크", since: "2026-09-21T00:00:00.000Z", verdict: "found_before" },
  { name: "🔴 since 를 모르면 found_before(우리 것으로 올려 읽지 않는다)", xml: NAVER_REAL, want: "AutoCreate 발행 시험 — 지워 주세요", since: null, verdict: "found_before" },
  { name: "목록엔 있는데 같은 제목 없음 → absent", xml: NAVER_REAL, want: "전혀 다른 새 글 제목", since: null, verdict: "absent" },
  { name: "제목이 비었으면 → unknown(no_title)", xml: NAVER_REAL, want: "   ", since: null, verdict: "unknown", why: "no_title" },
];

console.log("\n④ judgeFeed — 판정표 7줄");
for (const c of TABLE) {
  const r = judgeFeed(parseFeed(c.xml), c.want, c.since);
  ok(c.name, r.verdict === c.verdict && (!c.why || r.why === c.why), `verdict=${r.verdict} why=${r.why ?? "-"}`);
}
{
  const r = judgeFeed(parseFeed(NAVER_REAL), "[서식 시험 2] 강조·인용·목록·표·사진 세 장·링크", "2026-09-19T12:00:00.000Z");
  /* 🔴 verdict 를 같이 못 박는다 — 종전엔 hit 만 봐서 found_before 로도 통과했다(자가 아니었다). */
  ok("found_after 는 찾은 주소를 들고 온다", r.verdict === "found_after" && !!r.hit?.url.includes("224417455406"), `${r.verdict} ${r.hit?.url}`);
  ok("scanned 가 실제로 본 수", r.scanned === 3, String(r.scanned));
  ok("🔴 unknown 은 scanned 0 — «봤는데 없었다»로 보이면 안 된다", judgeFeed(parseFeed(TISTORY_EMPTY), "x", null).scanned === 0);
  /* 🔴 여럿 중 **가장 최근 것**을 든다 — 옛 동명 글에 매이면 새 글이 영영 안 올라간다. */
  const dup = `<rss><channel><title>t</title>
    <item><title>같은 제목</title><link>https://a/old</link><pubDate>Mon, 01 Sep 2026 00:00:00 +0900</pubDate></item>
    <item><title>같은 제목</title><link>https://a/new</link><pubDate>Mon, 21 Sep 2026 10:00:00 +0900</pubDate></item>
  </channel></rss>`;
  const rd = judgeFeed(parseFeed(dup), "같은 제목", "2026-09-21T00:00:00.000Z");
  ok("🔴 동명 글이 둘이면 최근 것 · found_after", rd.verdict === "found_after" && rd.hit?.url === "https://a/new", `${rd.verdict} ${rd.hit?.url}`);
}

/* ═══ ⑤ 🔴 변이 — 판정을 일부러 어긋낸 6종. 표가 **전부 빨강**을 내야 자에 이가 있는 것이다 ═══ */
console.log("\n⑤ 🔴 변이 6종 — 자가 «틀린 판정»을 잡는지(AC-87 음성 대조)");
type Judge = (p: { channelTitle: string | null; items: FeedItem[] }, want: string, since: string | null) => AlreadyAsk["verdict"];
const A = (v: AlreadyAsk["verdict"]) => v;
const MUTANTS: { name: string; f: Judge }[] = [
  { name: "M1 없는 블로그를 absent 로 읽는다(«안 열린다»를 «없다»로)", f: (p, w, s) => (!p.channelTitle ? A("absent") : judgeFeed(p, w, s).verdict) },
  { name: "M2 0건을 absent 로 읽는다(RSS 끔을 «없다»로)", f: (p, w, s) => (p.channelTitle && !p.items.length ? A("absent") : judgeFeed(p, w, s).verdict) },
  { name: "M3 시각 모름을 found_after 로 올려 읽는다", f: (p, w, s) => { const r = judgeFeed(p, w, s); return r.verdict === "found_before" && r.hit?.at === null ? A("found_after") : r.verdict; } },
  { name: "M4 제목 앞 10자만 비교한다(비슷한 제목을 같다고)", f: (p, w, s) => {
      const want = normTitle(w).slice(0, 10);
      if (!p.channelTitle) return A("unknown"); if (!p.items.length) return A("unknown"); if (!want) return A("unknown");
      const h = p.items.filter((i) => normTitle(i.title).slice(0, 10) === want);
      if (!h.length) return A("absent");
      const sm = s ? Date.parse(s) : NaN;
      return Number.isFinite(sm) && h[0].at && Date.parse(h[0].at) >= sm ? A("found_after") : A("found_before"); } },
  { name: "M5 동명 글 중 첫 번째(옛것)를 든다", f: (p, w, s) => {
      const want = normTitle(w);
      if (!p.channelTitle || !p.items.length || !want) return A("unknown");
      const h = p.items.filter((i) => normTitle(i.title) === want);
      if (!h.length) return A("absent");
      const sm = s ? Date.parse(s) : NaN;
      return Number.isFinite(sm) && h[0].at && Date.parse(h[0].at) >= sm ? A("found_after") : A("found_before"); } },
  { name: "M6 since 를 무시하고 찾으면 무조건 found_after(막는 자가 된다)", f: (p, w, s) => { const r = judgeFeed(p, w, s); return r.verdict === "found_before" ? A("found_after") : r.verdict; } },
];
/* M4·M5 는 위 표만으로는 안 죽는 변이라 **전용 사례**를 표에 더해 둔다(변이를 살려 두면 자가 없는 것과 같다). */
const EXTRA: Case[] = [
  /* 🔴 M3 용 — **pubDate 가 없는 항목.** 이 줄이 없으면 «시각 모름 → found_before» 규칙을 **아무도 안 지키고 있었다**
     (변이 M3 가 0줄로 살아남아 그 사실을 드러냈다 · 2026-09-21). 네이버·티스토리 둘 다 pubDate 를 주지만
     «준다»에 기대는 것이 곧 AC-9 다 — 안 왔을 때 어디로 넘어지는지를 못 박는다. */
  { name: "M3용 — pubDate 없는 같은 제목(시각 모름)", xml: `<rss><channel><title>t</title><item><title>시각 없는 글</title><link>https://a/nodate</link></item></channel></rss>`,
    want: "시각 없는 글", since: "2026-09-01T00:00:00.000Z", verdict: "found_before" },
  { name: "M4용 — 앞 10자가 같고 뒤가 다른 제목", xml: `<rss><channel><title>t</title><item><title>전기요금 줄이는 법 다섯 가지</title><link>https://a/1</link><pubDate>Mon, 01 Sep 2026 00:00:00 +0900</pubDate></item></channel></rss>`,
    want: "전기요금 줄이는 법 일곱 가지", since: null, verdict: "absent" },
  { name: "M5용 — 동명 글 둘(옛것 먼저 · since 뒤 새것)", xml: `<rss><channel><title>t</title><item><title>같은 제목</title><link>https://a/old</link><pubDate>Mon, 01 Sep 2026 00:00:00 +0900</pubDate></item><item><title>같은 제목</title><link>https://a/new</link><pubDate>Mon, 21 Sep 2026 10:00:00 +0900</pubDate></item></channel></rss>`,
    want: "같은 제목", since: "2026-09-21T00:00:00.000Z", verdict: "found_after" },
];
const FULL = [...TABLE, ...EXTRA];
for (const c of FULL) {
  const r = judgeFeed(parseFeed(c.xml), c.want, c.since);
  if (r.verdict !== c.verdict) { fail++; console.log(`  ✗ (표 자체가 틀림) ${c.name} → ${r.verdict}`); }
}
for (const m of MUTANTS) {
  const caught = FULL.filter((c) => m.f(parseFeed(c.xml), c.want, c.since) !== c.verdict);
  ok(`${m.name} — 잡힘(${caught.length}줄)`, caught.length > 0, "🔴 이 변이를 아무 줄도 못 잡는다 = 그 판정은 지금 아무도 안 지키고 있다");
}

console.log("\n⑥ 사람말 — 위협·책임 전가 0(CLAUDE §3)");
{
  const after = alreadySay(judgeFeed(parseFeed(NAVER_REAL), "[서식 시험 2] 강조·인용·목록·표·사진 세 장·링크", "2026-09-19T12:00:00.000Z"), "네이버 블로그");
  const before = alreadySay(judgeFeed(parseFeed(NAVER_REAL), "AutoCreate 발행 시험 — 지워 주세요", null), "네이버 블로그");
  ok("found_after 는 «다시 올리지 않았다»를 말한다", !!after && after.includes("다시 올리지 않"), String(after));
  ok("found_before 는 «그대로 올렸다» + 고칠 길을 준다", !!before && before.includes("그대로 올렸") && (before.includes("내리") || before.includes("바꿔")), String(before));
  ok("🔴 absent·unknown 은 사람에게 말 걸지 않는다(null)",
    alreadySay(judgeFeed(parseFeed(NAVER_REAL), "전혀 다른 제목", null)) === null && alreadySay(judgeFeed(parseFeed(TISTORY_EMPTY), "x", null)) === null);
  const BAD = ["정지", "불이익", "책임", "알려만", "경고", "위반", "제재", "삭제됩니다"];
  const all = [after, before].join(" ");
  ok("겁주는 말 0", BAD.every((b) => !all.includes(b)), BAD.filter((b) => all.includes(b)).join(","));
  ok("시스템 용어 0(테넌트·piece·러너 잡)", !/테넌트|piece|러너 잡|job/i.test(all), all);
}

console.log(`\n${fail === 0 ? "🟢" : "🔴"} pass ${pass} · fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
