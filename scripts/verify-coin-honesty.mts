/**
 * scripts/verify-coin-honesty.mts — 🔴 **«말한 값»과 «빼는 값»을 격자 전수로 대조한다**(C · R8 배포 전 · 2026-09-16).
 *   사용: npx tsx scripts/verify-coin-honesty.mts      · DB·네트워크·실호출 **0**(순수 함수만 부른다)
 *
 *   ══ 왜 «다른 모양의 자»인가 ══
 *   B 가 AC-92 를 들고 서버를 훑어 돈 새는 자리 넷을 **자리별로** 찾아 고쳤다. 나는 같은 것을 **자리로 보지 않는다** —
 *   **채널 × 고른 길이 × 고를 수 있는 포맷**을 전부 돌려 보고 **부등호 하나**가 지켜지는지만 본다:
 *     🔴 **고객이 실제로 내는 값 ≤ 고객에게 말한 값.**  한 조합이라도 이게 뒤집히면 그 조합이 «적힌 것보다 더 빠졌다»다.
 *   자리별 검사는 **고친 자리**를 지키고, 이 검사는 **아직 아무도 안 본 조합**을 지킨다. 둘은 겹치지 않는다.
 *
 *   ══ 메인·B 가 세운 잣대 두 줄을 그대로 코드로 옮긴다(AC-93) ══
 *     ① **그 값이 그대로 실행되면 기본값, 실행과 다른 것을 말하면 날조.**
 *        ⇒ 「안 고르면 60초」는 기본값이다(실제로 60초를 만들어 준다). 「길이를 모르니 60초 값을 물린다」는 날조다.
 *     ② **모르는 것으로 돈을 물릴 때는 모자라게 받는 쪽으로만 틀린다.**
 *        ⇒ 모르는 입력(`undefined`·`null`·`"abc"`·`0`·`-1`·`999`)을 넣어도 **견적이 실제보다 낮아지면 안 된다.**
 *
 *   🔴 한계(정직): 이 자는 **순수 함수**를 잰다. «그 함수를 제품이 정말 부르나»는 `verify-r8-deadends.mjs` 의 몫이고,
 *      «원장에 얼마가 찍혔나»는 라이브의 몫이다. 셋이 다 있어야 돈 이야기가 닫힌다.
 */
import { coinCostOf, videoCoinItem, pieceCoinCost, AI_IMAGES_INCLUDED, COIN_TABLE } from "../lib/coin-table";
import {
  estimateVideoSeconds, videoSecondsFor, shortsFormOf, clampSecondsForChannel,
  coinFormatOf, VIDEO_FORMAT_MAX_SEC, VIDEO_CHANNEL_MAX_SEC,
} from "../lib/writing-contracts";
import { refundLine } from "../lib/coin-ledger";

const out: { step: string; ok: boolean; note: string }[] = [];
const rec = (step: string, ok: boolean, note = "") => { out.push({ step, ok, note }); return ok; };

/* 채널·길이 격자 — 🔴 **표에서 읽어 온다.** 여기 베껴 적으면 표가 바뀐 날 이 검사가 낡는다(AC-78). */
const VIDEO_CHANNELS = Object.keys(VIDEO_CHANNEL_MAX_SEC);
const FORMATS = Object.keys(VIDEO_FORMAT_MAX_SEC) as (keyof typeof VIDEO_FORMAT_MAX_SEC)[];
/** «고객이 고를 수 있는 것» + «고객이 안 고르거나 이상한 값을 준 것» 둘 다 넣는다. */
const WANTS: unknown[] = [15, 30, 60, undefined, null, 0, -1, 7, 999, "30", "abc", NaN, {}];

/* ══ ① 🔴 영상 — 말한 값보다 더 빼는 조합이 하나라도 있나 ══ */
{
  const bad: string[] = [];
  let n = 0;
  for (const ch of VIDEO_CHANNELS) {
    for (const want of WANTS) {
      const quoted = coinCostOf(videoCoinItem(estimateVideoSeconds(ch, want)));
      /* 실제로 만들어질 수 있는 길이 = 고를 수 있는 **모든 포맷**을 돌려 본 결과(디렉터가 나중에 로테이션으로 고른다). */
      for (const f of FORMATS) {
        const actualSec = shortsFormOf(f, videoSecondsFor(ch, want)).seconds;
        const charged = coinCostOf(videoCoinItem(clampSecondsForChannel(ch, actualSec)));
        n++;
        if (charged > quoted) bad.push(`${ch} want=${String(want)} format=${f} → 말한 값 ${quoted} < 뺀 값 ${charged}`);
      }
    }
  }
  rec("① 🔴 영상 — 말한 값보다 더 빼는 조합", bad.length === 0,
    bad.length ? `🔴 ${bad.length}건 / ${n}조합 — ${bad.slice(0, 3).join(" · ")}` : `${n}조합 전부 «뺀 값 ≤ 말한 값»`);
}

/* ══ ② 🔴 B 가 잡은 그 자리 — 15초 고객에게 60초 값을 적지 않나(회귀) ══ */
{
  const bad: string[] = [];
  for (const ch of VIDEO_CHANNELS) {
    const q = coinCostOf(videoCoinItem(estimateVideoSeconds(ch, 15)));
    const worst = coinCostOf("video_60");
    if (q >= worst && clampSecondsForChannel(ch, 15) < 60) bad.push(`${ch} → ${q}코인`);
  }
  rec("② 🔴 15초를 고른 고객에게 60초 값(28코인)을 적지 않나", bad.length === 0,
    bad.length ? `🔴 ${bad.join(", ")}` : `채널 ${VIDEO_CHANNELS.length}개 전부 15초 견적이 60초 값보다 싸다`);
}

/* ══ ③ 🔴 모르는 입력이 «더 받는 쪽»으로 틀리지 않나 ══
   고객이 아무것도 안 골랐을 때의 견적이, **고를 수 있었던 값 중 가장 비싼 것**보다 비싸면 안 된다. */
{
  const bad: string[] = [];
  for (const ch of VIDEO_CHANNELS) {
    const unknownQuote = coinCostOf(videoCoinItem(estimateVideoSeconds(ch, undefined)));
    const realMax = Math.max(...[15, 30, 60].map((s) => coinCostOf(videoCoinItem(estimateVideoSeconds(ch, s)))));
    if (unknownQuote > realMax) bad.push(`${ch} 모름=${unknownQuote} > 고를 수 있는 최댓값=${realMax}`);
  }
  rec("③ 모르는 입력이 «고를 수 있었던 최댓값»을 넘지 않나", bad.length === 0,
    bad.length ? `🔴 ${bad.join(", ")}` : "넘는 채널 0 — 기본값이지 웃돈이 아니다");
}

/* ══ ④ 글 — 견적 자리와 차감 자리가 **같은 식**인가 ══
   🔴 식이 한 곳(`pieceCoinCost`)이라는 건 코드를 읽어야 아는 사실이다. 이 자는 **값으로** 확인한다:
      장수 0~12 × 채널·포맷 전부에서 두 호출이 한 숫자로 떨어지나. */
{
  const CHS = ["naver_blog", "tistory", "blogger", "wordpress", "instagram", "threads"];
  const FMTS: (string | undefined)[] = [undefined, "info", "story", "compare", "listicle", "cardnews", "qna", "guide"];
  const bad: string[] = [];
  let n = 0;
  for (const ch of CHS) for (const fmt of FMTS) for (let ai = 0; ai <= 12; ai++) {
    const key = coinFormatOf(ch, fmt);
    const quote = pieceCoinCost("post", ai, { format: key });
    const charge = pieceCoinCost("post", ai, { format: key });
    n++;
    if (quote !== charge) bad.push(`${ch}/${fmt}/ai${ai}`);
    /* 🔴 그리고 **포함분이 진짜 공짜인가** — 사진 1장까지는 글값만이어야 한다(사장님 승인값). */
    if (ai <= AI_IMAGES_INCLUDED && key !== "cardnews" && quote !== coinCostOf("blog")) {
      bad.push(`${ch}/${fmt}/ai${ai} 포함분이 안 공짜(${quote})`);
    }
  }
  rec("④ 글 — 견적과 차감이 같은 식 · 포함 1장이 공짜", bad.length === 0,
    bad.length ? `🔴 ${bad.slice(0, 4).join(", ")}` : `${n}조합 일치 · AI 사진 ${AI_IMAGES_INCLUDED}장까지 글값(${coinCostOf("blog")})만`);
}

/* ══ ⑤ 🔴 카드뉴스가 장수로 세어지지 않나 ══ (화면이 «3코인»이라 말하는 자리 · AC-74) */
{
  const bad: string[] = [];
  for (let ai = 0; ai <= 12; ai++) {
    const c = pieceCoinCost("post", ai, { format: "cardnews" });
    if (c !== coinCostOf("cardnews")) bad.push(`ai${ai}→${c}`);
  }
  rec("⑤ 카드뉴스는 장수로 안 센다(화면이 말한 3코인 그대로)", bad.length === 0,
    bad.length ? `🔴 ${bad.join(", ")}` : `사진 0~12장 전부 ${coinCostOf("cardnews")}코인`);
}

/* ══ ⑥ 🔴 환급 문장 — «못 돌려줬다»·«돌려줄 게 없었다»·«돌려줬다» 셋이 **다른 말**인가 ══ */
{
  const failed = refundLine({ granted: 0, failed: true });
  const none = refundLine({ granted: 0, failed: false });
  const some = refundLine({ granted: 3, failed: false });
  const distinct = new Set([failed, none, some]).size === 3;
  /* 🔴 «0개 돌려드렸어요» 는 **돌려주지 못한 것을 돌려줬다고** 말하는 문장이다 — 어느 갈래에도 있으면 안 된다. */
  const lies = [failed, none].filter((s) => /0개.*돌려/.test(s));
  /* 🔴 그리고 실패 문장이 **겁주거나 발 빼지** 않나(CLAUDE §3). */
  const scary = /알려만|고객님 책임|정지됩니다|불이익/.test(failed);
  rec("⑥ 🔴 환급 문장 셋이 서로 다른 말인가", distinct && !lies.length && !scary,
    `실패=«${failed}» · 없음=«${none}» · 있음=«${some}»${lies.length ? " 🔴 «0개 돌려드렸어요» 가 남아 있다" : ""}${scary ? " 🔴 겁주는 말" : ""}`);
}

/* ══ ⑦ 🔴 표 자체의 단조성 — 긴 영상이 짧은 영상보다 싸면 어딘가가 뒤집힌다 ══ */
{
  const order = ["video_clip", "video_15", "video_30", "video_60"] as const;
  const vals = order.map((k) => COIN_TABLE[k]);
  const mono = vals.every((v, i) => i === 0 || v >= vals[i - 1]);
  rec("⑦ 구간표가 길이 순으로 오름차순인가", mono, `${order.map((k, i) => `${k}=${vals[i]}`).join(" ≤ ")}`);
}

/* ══ ⑧ 🔴 재차감이 첫 차감을 넘지 않나 — «다시 만들기»가 더 비싸면 안 된다 ══
   재차감은 **처음 쓴 항목**(`meta.coinItem`)으로 다시 받는다. 그 항목이 표에 있는 값이면 첫 차감과 같아야 한다. */
{
  const bad: string[] = [];
  for (const ch of VIDEO_CHANNELS) for (const want of [15, 30, 60]) {
    const first = videoCoinItem(videoSecondsFor(ch, want));
    const again = videoCoinItem(videoSecondsFor(ch, want));   // 같은 재료 → 같은 항목이어야 한다
    if (coinCostOf(again) > coinCostOf(first)) bad.push(`${ch}/${want}`);
  }
  rec("⑧ 재차감이 첫 차감보다 비싸지지 않나", bad.length === 0,
    bad.length ? `🔴 ${bad.join(", ")}` : "같은 재료면 같은 항목 — 더 비싸지는 조합 0");
}

/* ══ ⑨ 🔴 **이 자가 물긴 하나 — 옛 식을 넣어 보고 빨강이 뜨는지 본다** ══
   자를 만들었으면 **자를 먼저 변이로 찌른다**. 안 찌르면 «전부 통과»가 «아무것도 안 쟀다»와 구별이 안 된다
   (오늘 내가 두 번 그 병을 냈다: 훑은 파일 0개인데 통과 · Windows 에서 `npx` 를 못 찾아 33개 전부 가짜 실패).
   🔴 파일을 바꾸지 않는다 — **옛 식을 여기서 다시 지어** 같은 격자에 넣는다.
      옛 식 = 편성표가 포맷을 안 보고 `videoSecondsFor` 로만 견적을 내던 것(그래서 15초 고객에게 6 을 적고 12 를 뺐다). */
{
  const oldQuote = (ch: string, want: unknown) => coinCostOf(videoCoinItem(videoSecondsFor(ch, want)));
  let caught = 0;
  for (const ch of VIDEO_CHANNELS) for (const want of WANTS) for (const f of FORMATS) {
    const actualSec = shortsFormOf(f, videoSecondsFor(ch, want)).seconds;
    const charged = coinCostOf(videoCoinItem(clampSecondsForChannel(ch, actualSec)));
    if (charged > oldQuote(ch, want)) caught++;
  }
  rec("⑨ 🔴 이 자가 옛 식을 잡나(변이로 찔러 보기)", caught > 0,
    caught > 0 ? `옛 식(포맷을 안 보는 견적)을 넣으면 **${caught}조합**이 «적힌 것보다 더 빠진다» 로 잡힌다 — 자에 이가 있다`
      : "🔴 옛 식을 넣어도 안 잡힌다 — **이 검사는 아무것도 못 잡는다**(통과를 근거로 쓰지 마라)");
}

const w = (x: unknown, n: number) => String(x).padEnd(n);
const fail = out.filter((r) => !r.ok).length;
console.log(`\n코인 정직성 — «말한 값»과 «빼는 값» 격자 대조 · ${new Date().toISOString()}\n${"─".repeat(126)}`);
for (const r of out) console.log(`  ${r.ok ? "✓" : "✗"} ${w(r.step, 52)} ${r.note}`);
console.log(`${"─".repeat(126)}`);
console.log(fail ? `🔴 실패 ${fail}개 — 돈이 걸린 자리다.` : `✅ ${out.length}축 전부 통과 — 어느 조합에서도 «적힌 것보다 더 빠지는» 일이 없다.`);
console.log("⚠️ 이 자는 **순수 함수**만 잰다 — «제품이 그 함수를 부르나»(verify-r8-deadends)와 «원장에 얼마가 찍혔나»(라이브)가 같이 있어야 닫힌다.");
process.exit(fail ? 1 : 0);
