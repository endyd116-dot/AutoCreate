/**
 * scripts/verify-r11-axis.mts — [R11+R12 · B · 2026-09-17] 🔴 **이 라운드에 새로 만든 판정들을 «실제로 돌려» 본다.**
 *   사용: `npx --yes tsx scripts/verify-r11-axis.mts` (종료코드 0 = 전부 통과)
 *
 *   ══ 왜 이 파일이 따로 있나 ══
 *     `verify-r8-deadends.mjs` 는 «**부르는 곳이 있나**»를 센다. 그건 «있나»이지 «**도나**»가 아니다(AC-99 ⑩) —
 *     함수 본문을 `return null` 로 바꿔도 **호출은 그대로라 초록**이다. 그래서 판정을 전부 순수 함수로 빼 두고
 *     여기서 **입력을 넣어 출력을 본다.**
 *
 *   ══ 🔴 이 파일이 스스로 지키는 셋 ══
 *     ① **원판 줄을 먼저 찍는다**(AC-100 ⑦) — 변이표를 돌리기 전에 «안 건드린 입력»이 **기대대로 나오는지** 먼저 본다.
 *        모든 칸이 빨강인 표는 «다 잡는다»가 아니라 «아무것도 안 돈다»일 수 있다.
 *     ② **대조군을 짝으로 둔다**(AC-99 ⑫) — «내림»을 세는 축에는 «**안 떨어진 것**»도 넣어 **안 세어지는지** 본다.
 *        양성만 넣으면 `return true` 로 바꿔도 초록이다.
 *     ③ **무회귀를 축으로 둔다**(계약 §5) — «아무것도 안 보내면 어제와 똑같은가»를 숫자로 잰다.
 */
import { trendOf, trendSince, dropAlertOf, TREND_MIN_SAMPLES, DROP_ALERT_PCT } from "../lib/revenue/trend";
import { buildByAxis, AXIS_LABEL } from "../lib/revenue/aggregate";
import { axisOfChannel, axesOfChannels, channelMonetizable, maxPhotosOf, formatCapsOf, channelSpec } from "../lib/channel-registry";
import { ruleKindOfPiece } from "../lib/slots";
import { crowdOf } from "../lib/publish-gap";
import { tiltOrder, rankBuckets, TILT_MIN_SAMPLES } from "../lib/learn-tilt";
import { candidatesFor, BEST_HOURS } from "../lib/best-time";
import { videoCoinItem, coinCostOf } from "../lib/coin-table";
import { clampSecondsForChannel, shortsFormOf, VIDEO_CHANNEL_MAX_SEC } from "../lib/writing-contracts";
import { syllableRatioOf, effectiveTempo } from "../lib/video/tempo";
import { normalizeBlocks, renderBlocksHtml, type Block } from "../lib/blocks";
import { applyMarkBudget, stripUnsupportedMarks, countMarks } from "../lib/format-marks";
import type { StatBucket } from "../lib/outcomes";
import { breadcrumbJsonLd, publisherOf, jsonLdScript, isOurWidget, widgetBlockHtml, ensureLatestPostsWidget, WP_WIDGET_INSTANCE } from "../lib/publish/wp-advanced";
import type { PublishPiece } from "../lib/publish/contract";
import { disclosureVerdict } from "../lib/video/judge";

/** 🔴 `renderBlocksHtml` 은 본문에 **광고 자리**를 끼워 넣는다(`insertAdSlots`) — 꾸밈을 견주는 자리에선 그걸 떼고 본다.
 *  ⚠️ 이 줄도 «원판 줄을 먼저 찍어» 알았다: 첫 판은 광고 자리를 안 떼서 **멀쩡한 코드가 빨갛게** 나왔다(AC-100 ⑦). */
const noAds = (h: string) => h.split(AD_MID).join("").split(AD_END).join("").trim();
const AD_MID = '<div class="ad-slot" data-slot="mid"></div>';
const AD_END = '<div class="ad-slot" data-slot="end"></div>';

let fail = 0, pass = 0;
const ok = (name: string, cond: boolean, note = "") => {
  if (cond) { pass++; console.log(`✓ ${name}${note ? `  ${note}` : ""}`); }
  else { fail++; console.log(`✗ ${name}  ${note}`); }
};
const eq = (name: string, got: unknown, want: unknown) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);

console.log("\n══ ① 원판 줄 — 변이 전에 «안 건드린 입력»이 기대대로 나오나(AC-100 ⑦) ══");

/* ─ R11-1 종류 배지 ─ */
eq("원판 · 글 piece → post", ruleKindOfPiece("post", "listicle"), "post");
eq("원판 · 영상 piece → shorts", ruleKindOfPiece("video", "story"), "shorts");
eq("원판 · 카드뉴스 → cardnews", ruleKindOfPiece("post", "cardnews"), "cardnews");
/* 🔴 대조군 — «영상인데 format 이 cardnews» 면 **영상이 이긴다**(순서를 뒤집으면 여기가 빨개진다). */
eq("대조군 · 영상 + cardnews → shorts(영상이 이긴다)", ruleKindOfPiece("video", "cardnews"), "shorts");
eq("대조군 · 모르는 값 → post", ruleKindOfPiece(null, undefined), "post");

/* ══ 🔴 **C 가 실측으로 잡아 준 구멍**(2026-09-17) — 여기가 이 격자의 값이다 ══
   내 첫 판은 «`pieces.kind` 는 `post|video` 둘뿐»이라는 전제로 `format === "cardnews"` 만 봤다. **전제가 틀렸다**:
     · `lib/director.ts:694` 가 넣는 값은 **세 개** — `isVideo ? "video" : isCard ? "cardnews" : "post"`
     · `isCard` 는 **채널**에서 온다(`isCardnewsChannel`) — format 이 아니다
     · 인스타 카드뉴스 계약의 `formats` 는 **다섯**(`writing-contracts.ts:343`)
   ⇒ 인스타 카드뉴스 글의 format 은 **5번 중 4번** `cardnews` 가 아니고, 그때 배지가 **빈칸**이었다.

   ⚠️ 🔴 **왜 내 자가 못 잡았나** — 격자에 `format === "cardnews"` 경로**만** 있었다(AC-99 ⑨).
      «잡아야 할 것»이 표본에 없으면 그 검사의 무력화는 **영영 안 보인다.** 그래서 **실제 계약의 다섯 format 을 전부** 넣는다.
      🔴 이 목록을 **계약에서 읽어 오지 않고 손으로 적은** 까닭: 계약이 줄어도 이 격자는 «다섯이던 시절»을 계속 재야 한다
         (옛 글이 그 format 을 들고 DB 에 남아 있다). 계약을 따라가면 표본이 계약과 함께 사라진다. */
for (const f of ["cardnews", "steps", "listicle", "compare", "qna"]) {
  eq(`🔴 인스타 카드뉴스 · kind=cardnews · format=${f} → cardnews`, ruleKindOfPiece("cardnews", f), "cardnews");
}
/* 🔴 대조군 짝 — `kind` 가 카드뉴스가 **아닌데** 같은 format 이면 **cardnews 로 안 샌다**(`||` 를 `&&` 로 좁히면 여기가 아니라 위가 빨개지고, 반대로 넓히면 여기가 빨개진다). */
for (const f of ["steps", "listicle", "compare", "qna"]) {
  eq(`🔴 대조군 · kind=post · format=${f} → post(카드뉴스로 안 샌다)`, ruleKindOfPiece("post", f), "post");
}
eq("🔴 옛 글 호환 · kind=post · format=cardnews → cardnews", ruleKindOfPiece("post", "cardnews"), "cardnews");

/* ─ R11-10 축 ─ */
eq("원판 · 네이버 블로그 = 글 축", axisOfChannel("naver_blog"), "text");
eq("원판 · 쇼츠 = 영상 축", axisOfChannel("youtube_shorts"), "video");
eq("🔴 대조군 · 표에 없는 채널 = null(«글»로 접지 않는다)", axisOfChannel("no_such_channel"), null);
eq("🔴 대조군 · 빈 값 = null", axisOfChannel(""), null);
eq("원판 · 축 모으기", axesOfChannels(["naver_blog", "tistory", "reels", "no_such"]).sort(), ["text", "video"]);
eq("대조군 · 글만 있으면 축 하나", axesOfChannels(["naver_blog", "tistory"]), ["text"]);

console.log("\n══ ② 수익 «어디서 났나» — 못 가른 돈이 한쪽에 몰리지 않나(AC-92) ══");
{
  const rows = [{ channel: "naver_blog", krw: 1000 }, { channel: "reels", krw: 500 }, { channel: null, krw: 300 }, { channel: "kakao_unknown", krw: 7 }];
  const out = buildByAxis(rows, ["text", "video"]);
  eq("원판 · 세 줄(글·영상·그 밖)", out.map((x) => [x.axis, x.krw]), [["text", 1000], ["video", 500], ["other", 307]]);
  ok("라벨은 서버 정본", out[0].label === AXIS_LABEL.text && out[2].label === AXIS_LABEL.other, out.map((x) => x.label).join("/"));
  ok("«그 밖»에만 설명 한 줄", !out[0].note && !!out[2].note, String(out[2].note));
  /* 🔴 대조군 — «그 밖»이 0원이면 **줄이 아예 없어야** 한다(0을 보여 주면 «뭔가 잘못됐나» 싶다). */
  const out2 = buildByAxis([{ channel: "naver_blog", krw: 1000 }], ["text", "video"]);
  eq("대조군 · 그 밖 0원이면 줄 없음", out2.map((x) => x.axis), ["text", "video"]);
  /* 🔴 변이 — 모르는 채널을 «글»로 접으면(폴백) 이 줄이 틀어진다. 지금은 안 접는다. */
  const out3 = buildByAxis([{ channel: "kakao_unknown", krw: 900 }], ["text"]);
  eq("🔴 변이 · 모르는 채널 900원은 «글»이 아니라 «그 밖»", out3.map((x) => [x.axis, x.krw]), [["text", 0], ["other", 900]]);
  /* 🔴 합계는 어느 경우에도 보존된다 — 합계 ≠ 내역이 되면 고객은 «없어진 돈»을 본다. */
  const sum = (a: { krw: number }[]) => a.reduce((x, y) => x + y.krw, 0);
  ok("🔴 합계 보존(내역 합 = 원장 합)", sum(out) === 1807, String(sum(out)));
}

console.log("\n══ ③ 추세 — 표본이 모자라면 «아직 몰라요»(AC-9) · 대조군 짝(AC-99 ⑫) ══");
eq("원판 · 늘었다", trendOf({ recentKrw: 2000, prevKrw: 1000, samples: 5, basis: "pieces" }).dir, "up");
eq("원판 · 줄었다", trendOf({ recentKrw: 500, prevKrw: 1000, samples: 5, basis: "pieces" }).dir, "down");
eq("🔴 대조군 · 안 움직였다 → flat(«down» 으로 안 세어진다)", trendOf({ recentKrw: 1050, prevKrw: 1000, samples: 5, basis: "pieces" }).dir, "flat");
eq(`🔴 대조군 · 표본 ${TREND_MIN_SAMPLES - 1}편 → unknown(금액이 반토막이어도)`, trendOf({ recentKrw: 10, prevKrw: 1000, samples: TREND_MIN_SAMPLES - 1, basis: "pieces" }).dir, "unknown");
ok("🔴 unknown 은 «멈춤»이 아니다(문장이 다르다)",
  trendOf({ recentKrw: 10, prevKrw: 1000, samples: 1, basis: "pieces" }).say !== trendOf({ recentKrw: 1000, prevKrw: 1000, samples: 9, basis: "pieces" }).say);
ok("🔴 unknown 에는 pct 를 안 싣는다(0% 로 위장하지 않는다)", trendOf({ recentKrw: 10, prevKrw: 1000, samples: 1, basis: "days" }).pct === undefined);
ok("🔴 지난주 0원이면 %를 안 만든다(÷0)", trendOf({ recentKrw: 500, prevKrw: 0, samples: 9, basis: "days" }).pct === undefined);
ok("«무엇을 셌나»를 말한다(편/일)",
  trendOf({ recentKrw: 1, prevKrw: 1, samples: 1, basis: "days" }).say.includes("일") && trendOf({ recentKrw: 1, prevKrw: 1, samples: 1, basis: "pieces" }).say.includes("편"));
{
  /* 🔴 «언제부터» — 창이 둘뿐이면 **말하지 않는다**(지어내지 않는다). */
  const w = [{ from: "2026-09-11", krw: 400 }, { from: "2026-09-04", krw: 800 }, { from: "2026-08-28", krw: 1600 }, { from: "2026-08-21", krw: 1500 }];
  /* 🔴 내림이 이어진 창은 **0(9/11)·1(9/04) 둘**이다 — 창 2(8/28 → 8/21 대비 +6%)에서 끊긴다.
     그래서 답은 «내림이 시작된 창의 첫날» = **9/04**. ⚠️ 이 줄은 처음에 8/28 로 적었다가 **검사가 틀렸음을 알려 줘서** 고쳤다
     (원판 줄을 먼저 찍은 값이다 — AC-100 ⑦ 이 말하는 것이 이것이다). */
  eq("원판 · 내림이 9/04 창부터", trendSince("down", w), "2026-09-04");
  eq("🔴 대조군 · 창이 둘이면 null", trendSince("down", w.slice(0, 2)), null);
  eq("🔴 대조군 · flat 이면 «언제부터»가 없다", trendSince("flat", w), null);
}

console.log("\n══ ④ 성과 저하 알림 — 문턱·문구(겁주지 않기 · CLAUDE §3) ══");
{
  const a = dropAlertOf({ recentKrw: 700, avgKrw: 1000, worked: ["에어프라이어", "주방 정리"] });
  ok("원판 · 30% 낮으면 뜬다", !!a, JSON.stringify(a?.pct));
  ok("잘 먹힌 소재가 문장에 실린다", !!a && a.desc.includes("에어프라이어"), a?.desc ?? "");
  /* 🔴 대조군 — 문턱 바로 위(안 떨어진 쪽)는 **안 떠야** 한다. */
  eq(`🔴 대조군 · ${DROP_ALERT_PCT - 1}% 낮으면 안 뜬다`, dropAlertOf({ recentKrw: 860, avgKrw: 1000 }), null);
  eq("🔴 대조군 · 오히려 늘었으면 안 뜬다", dropAlertOf({ recentKrw: 1500, avgKrw: 1000 }), null);
  eq("🔴 대조군 · 견줄 평균이 0이면 판정 안 한다", dropAlertOf({ recentKrw: 0, avgKrw: 0 }), null);
  /* 🔴 겁주는 말이 섞이면 빨개진다 — 문구 규칙을 **검사로** 박는다(§3). */
  const bad = ["정지", "불이익", "책임", "떨어지고 있", "주의하", "위험합니다", "알려만"];
  const text = `${a?.title ?? ""} ${a?.desc ?? ""}`;
  ok("🔴 겁주는 낱말 0개", bad.every((w) => !text.includes(w)), text);
  const b = dropAlertOf({ recentKrw: 700, avgKrw: 1000, worked: [] });
  ok("🔴 잘 먹힌 소재를 못 찾으면 그 줄이 빠진다(«없어요» 라고 안 한다)", !!b && !b.desc.includes("없"), b?.desc ?? "");
}

console.log("\n══ ⑤ «이날 겹쳐요» — 세는 것이지 거절하는 게 아니다(CLAUDE §9) ══");
{
  const t = Date.UTC(2026, 8, 17, 1, 0);   // KST 10:00
  const others = [
    { accountId: 7, channel: "naver_blog", atMs: Date.UTC(2026, 8, 17, 4, 0) },   // 같은 계정 · 같은 날(KST)
    { accountId: 9, channel: "naver_blog", atMs: t + 10 * 60_000 },               // 다른 계정 · 10분 뒤 = 붙는다
  ];
  const c = crowdOf({ atMs: t, accountId: 7, handle: "cook_a", others, channel: "naver_blog", gapMin: 30 });
  eq("원판 · 같은 계정 같은 날 1편", c.sameAccountSameDay, 1);
  eq("원판 · 가장 가까운 이웃 10분", c.nearestMin, 10);
  ok("원판 · 붙는다고 말한다", c.tight && c.say.includes("@cook_a") && c.say.includes("30분"), c.say);
  /* 🔴 대조군 — 넉넉히 떨어져 있으면 **문장이 비어야** 한다(화면이 줄을 안 그린다). */
  const far = crowdOf({ atMs: t, accountId: 7, handle: "cook_a", others: [{ accountId: 9, channel: "naver_blog", atMs: t + 5 * 3600_000 }], channel: "naver_blog", gapMin: 30 });
  ok("🔴 대조군 · 5시간 떨어지면 말할 게 없다", far.say === "" && !far.tight, JSON.stringify(far));
  /* 🔴 대조군 — 계정이 안 정해진 자리는 «같은 계정 몇 편»을 **셀 수 없다**(0 을 사실로 말하지 않는다). */
  const auto = crowdOf({ atMs: t, accountId: null, others, channel: "naver_blog", gapMin: 30 });
  ok("🔴 대조군 · 계정 미정이면 «이날 N편»을 말하지 않는다", !auto.say.includes("이날"), auto.say);
  /* 🔴 다른 채널은 «붙는» 상대가 아니다. */
  const other = crowdOf({ atMs: t, accountId: 7, others: [{ accountId: 9, channel: "tistory", atMs: t + 60_000 }], channel: "naver_blog", gapMin: 30 });
  ok("🔴 대조군 · 다른 채널 1분 뒤는 안 센다", !other.tight, JSON.stringify(other));
  /* 🔴 이 함수는 boolean 을 안 돌려준다 — «막을까»를 여기서 정할 수 없게 한 설계다. */
  ok("🔴 거절 신호가 없다(막는 칸이 없다)", !("blocked" in c) && !("ok" in c));
}

console.log("\n══ ⑥ 되먹임 — 기울이기지 덮어쓰기가 아니다(R12-10) ══");
{
  eq("원판 · 선호대로 앞으로 당긴다", tiltOrder(["a", "b", "c"], ["c"]), ["c", "a", "b"]);
  eq("🔴 후보 밖의 선호는 버린다(없는 것을 만들지 않는다)", tiltOrder(["a", "b"], ["z", "b"]), ["b", "a"]);
  eq("🔴 후보를 빼지 않는다(기울이기지 게이트가 아니다)", tiltOrder(["a", "b", "c"], ["b"]).length, 3);
  eq("🔴 대조군 · 선호가 없으면 순서 그대로(무회귀)", tiltOrder(["a", "b", "c"], []), ["a", "b", "c"]);

  const B = (key: string, samples: number, avgViews: number | null): StatBucket => ({ key, samples, avgViews, avgRevenue: null });
  eq("원판 · 기준선(안 쓴 것)보다 나은 것만", rankBuckets([B("(없음)", 10, 100), B("listicle", 10, 300), B("story", 10, 50)]), ["listicle"]);
  eq(`🔴 대조군 · 표본 ${TILT_MIN_SAMPLES - 1} 은 후보가 아니다`, rankBuckets([B("(없음)", 10, 100), B("listicle", TILT_MIN_SAMPLES - 1, 9999)]), []);
  eq("🔴 대조군 · 못 잰 것(null)은 0 으로 안 센다", rankBuckets([B("(없음)", 10, 100), B("listicle", 10, null)]), []);
  eq("🔴 대조군 · 기준선보다 나쁘면 추천 안 한다", rankBuckets([B("(없음)", 10, 500), B("listicle", 10, 100)]), []);

  /* 🔴 시각 기울이기 — 고객이 고른 것을 **이기지 않는다**. */
  const ch = "naver_blog";
  const table = BEST_HOURS[ch].map((x) => x.h);
  eq("🔴 대조군 · 안 배웠으면 표 순서 그대로(무회귀)", candidatesFor(ch, null, null, null).map((x) => x.h), table);
  eq("🔴 배운 시각이 앞으로 온다", candidatesFor(ch, null, null, null, [table[table.length - 1]]).map((x) => x.h)[0], table[table.length - 1]);
  eq("🔴 표 밖의 시각은 안 만든다", candidatesFor(ch, null, null, null, [3]).map((x) => x.h), table);
  eq("🔴 고객 골든타임이 있으면 학습은 아무 일도 안 한다", candidatesFor(ch, [21], null, null, [table[0]]).map((x) => x.h), [21]);
  eq("🔴 규칙 고정 시각이 있으면 학습은 아무 일도 안 한다", candidatesFor(ch, null, 7, 5, [table[0]]), [{ h: 7, m: 5 }]);
  eq("🔴 후보 수가 줄지 않는다", candidatesFor(ch, null, null, null, [table[2]]).length, table.length);
}

console.log("\n══ ⑦ 릴스 90초 — 셋이 같이 움직였나(길이표·코인·포맷) ══");
eq("원판 · 릴스 상한 90", VIDEO_CHANNEL_MAX_SEC.reels, 90);
eq("🔴 대조군 · 클립 채널은 그대로 30", VIDEO_CHANNEL_MAX_SEC.naver_clip, 30);
eq("🔴 대조군 · 쇼츠는 그대로 60", VIDEO_CHANNEL_MAX_SEC.youtube_shorts, 60);
eq("릴스에 90 을 넣으면 90", clampSecondsForChannel("reels", 90), 90);
eq("🔴 쇼츠에 90 을 넣으면 60 으로 내려앉는다", clampSecondsForChannel("youtube_shorts", 90), 60);
eq("🔴 클립 채널에 90 → 30", clampSecondsForChannel("naver_clip", 90), 30);
eq("🔴 클립 **포맷**은 90 을 받아도 30 으로 접힌다", shortsFormOf("clip", 90).seconds, 30);
eq("그래픽 90 은 컷이 늘어난다", shortsFormOf("graphic", 90).cuts.default, 13);
eq("🔴 대조군 · 60초 컷 수는 한 숫자도 안 바뀐다(무회귀)", shortsFormOf("graphic", 60).cuts, { min: 6, max: 12, default: 9 });
eq("🔴 대조군 · 30초 컷 수도 그대로", shortsFormOf("graphic", 30).cuts, { min: 4, max: 6, default: 5 });
eq("90초 코인 칸이 있다", videoCoinItem(90), "video_90");
eq("🔴 대조군 · 60초는 여전히 video_60", videoCoinItem(60), "video_60");
eq("🔴 대조군 · 62초(±여유)도 video_60", videoCoinItem(62), "video_60");
ok("🔴 90초 값이 60초보다 비싸다(«90초인데 값은 60초» 방지)", coinCostOf("video_90") > coinCostOf("video_60"), `${coinCostOf("video_90")} > ${coinCostOf("video_60")}`);

console.log("\n══ ⑧ 말 속도 — 안 보내면 어제와 똑같은가(계약 §5 무회귀) ══");
eq("🔴 못 배웠으면 비율이 정확히 1", syllableRatioOf(undefined), 1);
eq("🔴 1.0 을 배웠어도 비율이 1", syllableRatioOf(1.0), 1);
eq("🔴 못 배웠으면 넘기는 속도도 우리 기본(1.1)", effectiveTempo(undefined), 1.1);
ok("느리게 배우면 비율이 1보다 작다(대본이 짧아진다)", syllableRatioOf(0.9) < 1, String(syllableRatioOf(0.9)));
ok("🔴 대조군 · 빠르게 배우면 1보다 크다", syllableRatioOf(1.2) > 1, String(syllableRatioOf(1.2)));

console.log("\n══ ⑨ 당근 — «수익 없음»과 «서식 0» 이 확인된 사실로 실리나(AC-10 · AC-92) ══");
{
  const d = channelSpec("daangn");
  ok("당근이 표에 있다", !!d, JSON.stringify(d?.key));
  eq("글 축", axisOfChannel("daangn"), "text");
  eq("세션 쿠키로 붙는다", d?.connect, "session");
  eq("러너가 올린다", d?.publishVia, "runner");
  eq("잡 이름(B2 와 맞춘 글자)", d?.jobKind, "publish.daangn");
  eq("🔴 수익이 안 붙는다(확인함)", channelMonetizable("daangn"), false);
  eq("🔴 대조군 · 네이버는 수익이 붙는다", channelMonetizable("naver_blog"), true);
  eq("사진 10장", maxPhotosOf("daangn"), 10);
  eq("🔴 대조군 · 안 재 본 채널은 null(수를 지어내지 않는다)", maxPhotosOf("naver_blog"), null);
  const caps = formatCapsOf("daangn")!;
  const isFalse = Object.entries(caps).filter(([k]) => k !== "emoji" && k !== "image").every(([, v]) => v === false);
  ok("🔴 서식이 전부 false(«안 재 봤다»인 null 이 아니다)", isFalse, JSON.stringify(caps));
  ok("🔴 null 이 하나도 없다", Object.values(caps).every((v) => v !== null));
}

console.log("\n══ ⑩ 목록·표 «안»의 꾸밈 — 번짐이 항목 경계를 넘지 않나(R12-5) ══");
{
  /* 🔴 원판 줄 — 마크가 **없으면** 종전 렌더와 한 글자도 같아야 한다(무회귀). */
  const plain = normalizeBlocks([{ type: "list", items: ["가나다", "라마바", "사아자"] }]);
  const plainHtml = noAds(renderBlocksHtml(plain, "wordpress"));
  ok("🔴 원판 · itemMarks 가 없으면 종전과 같다", plainHtml === "<ul><li>가나다</li><li>라마바</li><li>사아자</li></ul>", plainHtml);

  /* 🔴 설계 §6 이 시킨 축 그대로: «목록 3항목 중 2번째만 밑줄 · 1·3번은 평문». */
  const blocks = normalizeBlocks([{ type: "list", items: ["가나다", "라마바", "사아자"], itemMarks: [{ i: 1, marks: [{ s: 0, e: 3, kind: "underline" }] }] }]);
  const html = noAds(renderBlocksHtml(blocks, "wordpress"));
  ok("2번째 항목만 밑줄", html === "<ul><li>가나다</li><li><u>라마바</u></li><li>사아자</li></ul>", html);
  ok("🔴 대조군 · 1·3번은 평문(번지지 않았다)", !/가나다<\/?u>|<u>가나다|<u>사아자/.test(html), html);

  /* 🔴 변이 — 항목 길이를 넘는 마크는 **버려져야** 한다(이어 붙인 문자열로 재면 여기가 통과한다). */
  const over = normalizeBlocks([{ type: "list", items: ["가나다", "라마바"], itemMarks: [{ i: 0, marks: [{ s: 0, e: 6, kind: "underline" }] }] }]);
  ok("🔴 변이 · 항목 경계를 넘는 마크는 버린다", !over[0].itemMarks, JSON.stringify(over[0].itemMarks));

  /* 🔴 빈 항목이 빠져 인덱스가 밀려도 **엉뚱한 항목에 옮겨 붙지 않는다.** */
  const shifted = normalizeBlocks([{ type: "list", items: ["", "라마바"], itemMarks: [{ i: 1, marks: [{ s: 0, e: 3, kind: "bold" }] }] }]);
  eq("🔴 변이 · 빈 항목이 빠지면 인덱스를 되짚는다", shifted[0].itemMarks, [{ i: 0, marks: [{ s: 0, e: 3, kind: "bold" }] }]);

  /* 표 칸 — `rows[r][c]` 좌표 그대로(헤더 r=0). */
  const tbl = normalizeBlocks([{ type: "table", rows: [["항목", "값"], ["전기", "3천원"]], cellMarks: [{ r: 1, c: 1, marks: [{ s: 0, e: 2, kind: "value" }] }] }]);
  const tHtml = renderBlocksHtml(tbl, "wordpress");
  ok("표 본문 칸만 칠해진다", tHtml.includes('<td><mark class="value">3천</mark>원</td>'), tHtml);
  ok("🔴 대조군 · 헤더는 평문", tHtml.includes("<th>항목</th>") && tHtml.includes("<th>값</th>"), tHtml);
  const badCell = normalizeBlocks([{ type: "table", rows: [["a", "b"]], cellMarks: [{ r: 9, c: 9, marks: [{ s: 0, e: 1, kind: "bold" }] }] }]);
  ok("🔴 변이 · 없는 칸 좌표는 버린다", !badCell[0].cellMarks, JSON.stringify(badCell[0].cellMarks));

  /* 🔴 faq — «질문 + 줄바꿈 + 답» 한 덩이 기준이고, 걸친 마크는 버린다. */
  const faqSrc = [{ type: "faq", items: [`Q. 얼마인가요?${String.fromCharCode(10)}A. 3천원이에요.`], itemMarks: [{ i: 0, marks: [{ s: 15, e: 17, kind: "value" }] }] }];
  const faq = normalizeBlocks(faqSrc);
  const fHtml = renderBlocksHtml(faq, "wordpress");
  ok("faq 답 쪽 좌표가 산다", fHtml.includes("<dd>") && fHtml.includes('<mark class="value">'), fHtml);
  ok("🔴 대조군 · 질문 쪽은 평문", /<dt>얼마인가요\?<\/dt>/.test(fHtml), fHtml);

  /* 🔴 상한은 **글 전체 합** — 항목마다 따로 세면 목록 10줄 글에 120개가 실린다. */
  const many: Block[] = [{ type: "list", items: Array.from({ length: 10 }, (_, i) => `줄${i}`),
    itemMarks: Array.from({ length: 10 }, (_, i) => ({ i, marks: [{ s: 0, e: 2, kind: "line" as const }] })) }];
  const bud = applyMarkBudget(many);
  const kept = countMarks(bud.blocks).line ?? 0;
  eq("🔴 목록 마크도 글당 상한을 탄다(line 6)", kept, 6);
  ok("버린 것은 사유로 남는다", bud.dropped.length === 4 && bud.dropped.every((d) => d.why === "budget"), JSON.stringify(bud.dropped.length));

  /* 🔴 채널이 «못 낸다»고 한 종류는 목록 안에서도 벗겨져야 한다(문단만 벗기면 목록으로 새어 나간다). */
  const strip = stripUnsupportedMarks([{ type: "list", items: ["가나다"], itemMarks: [{ i: 0, marks: [{ s: 0, e: 3, kind: "line" }] }] }], "threads");
  ok("🔴 쓰레드 목록에서도 형광펜이 벗겨진다", !strip.blocks[0].itemMarks && strip.dropped.length === 1, JSON.stringify(strip.dropped));
  /* 🔴 대조군 — 낼 수 있는 채널에서는 **안 벗겨진다**(전부 벗기는 함수로 바꾸면 여기가 빨개진다). */
  const keep = stripUnsupportedMarks([{ type: "list", items: ["가나다"], itemMarks: [{ i: 0, marks: [{ s: 0, e: 3, kind: "line" }] }] }], "wordpress");
  ok("🔴 대조군 · 워드프레스에서는 그대로 남는다", !!keep.blocks[0].itemMarks && keep.dropped.length === 0, JSON.stringify(keep.dropped));
}

console.log("\n══ ⑪ 워드프레스 고급 — 지어내지 않고, 막지 않나(R12-9) ══");
{
  const piece = { id: 1, tenantId: 1, title: "에어프라이어 기름때 3분 청소", bodyHtml: "<p>본문</p>", tags: [], images: [] } as unknown as PublishPiece;
  const withName = breadcrumbJsonLd(piece, { home: "https://ex.com", name: "우리집 살림" });
  ok("원판 · 빵부스러기 두 마디", !!withName && (withName.itemListElement as unknown[]).length === 2, JSON.stringify(withName));
  ok("🔴 마지막 마디엔 주소를 안 적는다(글 주소는 발행 뒤에야 생긴다)",
    !!withName && !("item" in ((withName.itemListElement as Record<string, unknown>[])[1])), JSON.stringify(withName));
  eq("🔴 대조군 · 홈 주소가 없으면 만들지 않는다", breadcrumbJsonLd(piece, { home: "" }), null);
  eq("🔴 대조군 · 제목이 없으면 만들지 않는다", breadcrumbJsonLd({ ...piece, title: "" } as unknown as PublishPiece, { home: "https://ex.com" }), null);

  eq("🔴 사이트 이름을 못 읽으면 publisher 를 안 넣는다(빈 이름 금지)", publisherOf({ home: "https://ex.com" }), null);
  eq("🔴 대조군 · 이름이 있으면 넣는다", publisherOf({ home: "https://ex.com", name: "우리집 살림" }), { "@type": "Organization", name: "우리집 살림" });
  ok("🔴 publisher 에 logo 를 지어내지 않는다", !JSON.stringify(publisherOf({ home: "https://ex.com", name: "n" })).includes("logo"));

  eq("🔴 대조군 · null 이면 스크립트 줄 자체가 없다", jsonLdScript(null), "");
  ok("🔴 </script> 조기 종료를 막는다", jsonLdScript({ a: "</script>" }).includes("<" + String.fromCharCode(92) + "/script>"), jsonLdScript({ a: "</script>" }));

  /* 🔴 멱등의 근거 — 우리 도장(className)으로만 가른다(제목은 고객이 바꿀 수 있다). */
  ok("우리 위젯을 알아본다", isOurWidget({ id_base: "block", instance: { raw: { content: widgetBlockHtml() } } }));
  ok("🔴 대조군 · 남의 위젯은 우리 것이 아니다", !isOurWidget({ id_base: "block", instance: { raw: { content: "<!-- wp:latest-posts --><!-- /wp:latest-posts -->" } } }));
  ok("🔴 대조군 · 제목만 같은 위젯도 우리 것이 아니다", !isOurWidget({ rendered: "<h3>최근 글</h3>" }));
  ok("블록 마크업에 우리 도장이 있다", widgetBlockHtml().includes(WP_WIDGET_INSTANCE.className));
}

console.log("\n══ ⑫ 워드프레스 위젯 — 🔴 «없는 길»과 «고장»을 가르나 · 막지 않나 ══");
{
  const R = (status: number, json: unknown) => async () => ({ status, json });
  /* 🔴 5.8 미만 = **없는 길**이다(고장이 아니다) — 조용히 넘어가되 사유를 말한다. */
  const old = await ensureLatestPostsWidget("https://ex.com", "b", R(404, null));
  ok("🔴 5.8 미만은 «없는 길»로 넘어간다", !old.ok && old.why.includes("5.8"), JSON.stringify(old));
  const noPerm = await ensureLatestPostsWidget("https://ex.com", "b", R(403, null));
  ok("🔴 권한이 없어도 넘어간다(글은 나간다)", !noPerm.ok && noPerm.why.includes("권한"), JSON.stringify(noPerm));
  const noBar = await ensureLatestPostsWidget("https://ex.com", "b", R(200, [{ id: "wp_inactive_widgets", widgets: [] }]));
  ok("🔴 비활성 보관함에는 안 꽂는다", !noBar.ok && noBar.why.includes("사이드바가 없"), JSON.stringify(noBar));

  /* 멱등 — 이미 우리 것이 있으면 아무것도 안 한다. */
  let posted = 0;
  const already = await ensureLatestPostsWidget("https://ex.com", "b", async (u, init) => {
    if ((init.method ?? "GET") === "POST") { posted++; return { status: 201, json: { id: "x" } }; }
    if (u.includes("/sidebars")) return { status: 200, json: [{ id: "sidebar-1", widgets: ["block-9"] }] };
    return { status: 200, json: [{ id_base: "block", instance: { raw: { content: widgetBlockHtml() } } }] };
  });
  ok("🔴 이미 있으면 다시 안 꽂는다(멱등)", already.ok && (already as { already: boolean }).already && posted === 0, `${JSON.stringify(already)} posted=${posted}`);

  /* 🔴 대조군 — 비어 있으면 **꽂는다**(«아무것도 안 하는 함수»로 바꾸면 여기가 빨개진다). */
  let posted2 = 0;
  const fresh = await ensureLatestPostsWidget("https://ex.com", "b", async (u, init) => {
    if ((init.method ?? "GET") === "POST") { posted2++; return { status: 201, json: { id: "new-1" } }; }
    return { status: 200, json: [{ id: "sidebar-1", widgets: [] }] };
  });
  ok("🔴 대조군 · 비어 있으면 꽂는다", fresh.ok && !(fresh as { already: boolean }).already && posted2 === 1, `${JSON.stringify(fresh)} posted=${posted2}`);
}

console.log("\n══ ⑬ 고지 축 — 🔴 «pending 이 뜨나»가 아니라 «**안 떠야 할 때 안 뜨나**»(B2 지적 2026-09-17) ══");
{
  const OK = { ok: true };
  const BAD = { ok: false, detail: "고지 누락(제휴): 우상단 배지" };

  /* 🔴 **여기가 대조군의 심장이다** — 고지가 필요 없는 글에 «못 쟀어요»가 뜨면 그건 소음이다.
     `needDisclosure` 를 무시하고 `overlayVerified !== true` 만 보면 **전 영상이 pending** 이 되고, 그래도 «pending 이 뜨나» 검사는 초록이다. */
  for (const ov of [undefined, true, false] as const) {
    const v = disclosureVerdict(OK, false, ov);
    ok(`🔴 대조군 · 고지 불필요 + overlayVerified=${String(ov)} → pending 안 뜬다`, !v.pending, JSON.stringify(v));
  }
  ok("🔴 대조군 · 고지 불필요면 detail 도 없다(조용하다)", disclosureVerdict(OK, false, undefined).detail === undefined);

  /* 표 그대로 — 고지가 필요한 글. */
  const seen = disclosureVerdict(OK, true, true);
  ok("고지 필요 + 쟀고 실렸다 → 통과 · pending 아님", seen.pass && !seen.pending && seen.detail === undefined, JSON.stringify(seen));
  const unseen = disclosureVerdict(OK, true, undefined);
  ok("🔴 고지 필요 + 못 쟀다 → pending(막지는 않는다 · pass 그대로)", unseen.pass && unseen.pending, JSON.stringify(unseen));
  ok("«못 쟀다»를 문장으로 말한다", !!unseen.detail && unseen.detail.includes("못 쟀다"), unseen.detail ?? "");
  const absent = disclosureVerdict(OK, true, false);
  ok("🔴 재 봤고 안 실렸다 → **실패**(보류가 아니다)", !absent.pass && !absent.pending, JSON.stringify(absent));
  ok("«안 실렸다»를 문장으로 말한다", !!absent.detail && absent.detail.includes("안 실렸다"), absent.detail ?? "");

  /* 계획 자체가 모자라면 이미 실패다 — 보류를 덧씌우지 않는다(`pendingIf` 와 같은 규율). */
  const planBad = disclosureVerdict(BAD, true, undefined);
  ok("🔴 계획이 모자라면 실패이지 보류가 아니다", !planBad.pass && !planBad.pending, JSON.stringify(planBad));
  eq("🔴 그때 문장은 **계획 쪽 사유**를 그대로 쓴다(덮지 않는다)", planBad.detail, BAD.detail);

  /* 🔴 그리고 «막지 않는다»(CLAUDE §9) — pending 은 pass 다. 여기가 뒤집히면 고객 영상이 멈춘다. */
  ok("🔴 pending 은 pass 다(막지 않는다)", disclosureVerdict(OK, true, undefined).pass === true);
}

console.log("\n══ ⑭ 🔴 «조건의 입력이 둘 이상인 갈래»를 전수로 — 내 규칙을 내 코드에 댄다(B2 되돌려 줌) ══");
{
  /* B2 가 내 규칙(«pending 조건에 입력이 둘 이상이면 대조군») 으로 자기 쪽 `pickVerifyLayer` 를 잡았다.
     그래서 이번 라운드에 내가 만든 «빼는/안 하는» 갈래 중 **입력이 둘 이상인 것**을 전수로 훑었다. 둘이 나왔다(`buildByAxis` · `crowdOf`).

     🔴 **그런데 재 보니 둘 다 이미 잡히고 있었다 — 내 첫 짐작이 틀렸다.**
        처음 이 블록을 쓸 때 «옛 축들은 전부 초록이었다»고 적었는데, **확인하니 아니었다**:
          · `&&` → `||` 변이 → 옛 자 **exit 1**(«그 밖 0원이면 줄 없음» 축이 잡았다)
          · `nearestMin` 0 폴백 변이 → 옛 자 **exit 1**(«다른 채널 1분 뒤는 안 센다» 축이 잡았다)
        ⇒ 짐작을 지우고 **잰 것만 남긴다**(이번 라운드 내내 고친 그 병이다 · B2 의 «관찰과 해석을 갈라 적어라»).

     🔴 그래도 아래 축은 남긴다. 까닭이 다르다:
        두 변이를 잡은 것은 **다른 것을 재던 축이 우연히 걸린 것**이다(«그 밖 0원» 축은 `other` 줄을 보러 만든 것이고,
        «다른 채널» 축은 채널 가르기를 보러 만든 것이다). **우연한 덮개는 그 축이 바뀌는 날 함께 사라진다.**
        ⇒ 「안 가진 축인데 돈이 있다」와 「이웃이 0명이다」를 **이름 붙여 직접** 잰다. 덮개를 **의도**로 바꾸는 일이다. */

  /* ── ⓐ `buildByAxis`: `if (!ownedAxes.includes(a) && sum[a] === 0) continue` — 입력 **둘**(가졌나 × 0원인가) ──
     여기가 틀어지면 **안 가진 축의 돈이 통째로 사라진다**(합계 ≠ 내역 → 고객은 «없어진 돈»을 본다). 그 뜻을 이름 붙여 직접 잰다. */
  const gone = buildByAxis([{ channel: "reels", krw: 700 }], ["text"]);
  eq("🔴 안 가진 축인데 돈이 있으면 그 줄도 낸다(계정을 지운 뒤)", gone.map((x) => [x.axis, x.krw]), [["text", 0], ["video", 700]]);
  ok("🔴 합계 보존 — 내역 합이 원장 합과 같다", gone.reduce((a, b) => a + b.krw, 0) === 700, String(gone.reduce((a, b) => a + b.krw, 0)));
  /* 대조군의 짝 — 안 가졌고 돈도 없으면 **그 줄은 없어야** 한다(둘 다 내면 «영상에서 0원»이 소음이 된다). */
  eq("🔴 대조군 · 안 가졌고 돈도 없으면 줄 없음", buildByAxis([{ channel: "naver_blog", krw: 100 }], ["text"]).map((x) => x.axis), ["text"]);

  /* ── ⓑ `crowdOf`: `tight = nearestMin !== undefined && nearestMin < gap` — 입력 **둘**(이웃이 있나 × 가까운가) ──
     `nearestMin` 을 0 으로 메우는 폴백이 생기는 순간 **이웃이 없는 자리에 «0분 안에 붙어요»**가 뜬다(«모른다»를 «값»으로 · AC-92). */
  const alone = crowdOf({ atMs: Date.UTC(2026, 8, 17, 1, 0), accountId: 7, handle: "cook_a", others: [], channel: "naver_blog", gapMin: 30 });
  ok("🔴 이웃이 0명이면 nearestMin 키가 아예 없다(0분으로 메우지 않는다)", alone.nearestMin === undefined, JSON.stringify(alone));
  ok("🔴 이웃이 0명이면 붙는다고 말하지 않는다", !alone.tight && alone.say === "", JSON.stringify(alone));
  /* 대조군의 짝 — 같은 계정 같은 날은 있는데 **채널 이웃은 없는** 자리: «이날 N편»만 말하고 «붙어요»는 안 말한다. */
  const sameDayOnly = crowdOf({
    atMs: Date.UTC(2026, 8, 17, 1, 0), accountId: 7, handle: "cook_a",
    others: [{ accountId: 7, channel: "tistory", atMs: Date.UTC(2026, 8, 17, 4, 0) }], channel: "naver_blog", gapMin: 30,
  });
  ok("🔴 같은 날 있지만 같은 채널 이웃은 없다 → «이날 1편»만, «붙어요»는 없다",
    sameDayOnly.say.includes("이날") && !sameDayOnly.say.includes("붙어요") && !sameDayOnly.tight, sameDayOnly.say);
}

console.log(`\n${fail ? "FAIL" : "PASS"} ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
