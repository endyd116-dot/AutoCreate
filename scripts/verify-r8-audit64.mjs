// scripts/verify-r8-audit64.mjs — 🔴 **설계 대비 «남은 64행» 진척을 코드로 다시 센다**(C · R8 계약 §7).
//   사용: node scripts/verify-r8-audit64.mjs [--json]
//
//   입력 = `docs/active/2026-09-15-DESIGN-AUDIT.md` §10.3 의 **③54 + ④12**(문서 표기 · 메인 전언은 ④10 이었다 — 숫자를 여기서 못 박는다).
//
//   ══ 세는 규율 ══
//     ① 🔴 **세션 보고를 믿지 않는다**(메인 지시). 전수조사에서 그 규칙이 실제로 1건을 잡았다(B2 «WP 위젯 코드만» → 실제 0).
//     ② 🔴 **«정의가 있나»가 아니라 «부르는 자리가 있나»**(AC-69). 열거값·타입만 있는 것은 «있다»가 아니다.
//     ③ 🔴 **서버만 있고 화면이 없으면 닫힌 게 아니다**(CLAUDE §4.8 «완료 = 화면에서 쓸 수 있을 때»).
//     ④ 🔴 판정을 **세 갈래**로 낸다 — `닫힘` · `🟠 일부`(사유를 적는다) · `열림`. 두 갈래로 뭉치면 어느 쪽으로든 거짓말한다.
//
//   🔴 첫 판에서 내 정규식이 헐거워 **가짜 닫힘 3건**을 만들었다(팩트체크가 `video/cost.ts` 에, 딥링크가 `affiliate-coupang.ts` 에,
//      CS 가 `referral.ts` 에 걸렸다). 그래서 이 판은 행마다 **틀릴 수 없는 근거**(파일 경로 + 그 파일 안의 특정 문자열)로 좁혔다.
import { readFileSync, existsSync } from "node:fs";

const JSON_OUT = process.argv.includes("--json");
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
/** 그 파일 안에 그 패턴이 있나 — **파일을 지목**해서 본다(전역 grep 은 엉뚱한 파일에 걸린다). */
const inFile = (p, re) => re.test(read(p));
const anyFile = (ps, re) => ps.filter((p) => inFile(p, re));

const results = [];
/** 한 줄이 몇 «칸»인가 — 묶음 행(접근성 6·팀 4·트레이 2·레지스트리 2·고지 4)은 한 줄이 여러 칸이다.
 *  🔴 칸 수를 안 달면 줄을 세는 것과 칸을 세는 것이 갈려 분모가 또 흔들린다(오늘 «64·66·67» 로 세 번 흔들렸다). */
const rec = (row, state, why, w = 1, split = null) => results.push({ row, state, why, w, split });

/* ══ ④ 진짜 미개발 12행 — 조사 §10.3-④ 표 그대로 ══ */
const FOUR = [
  { n: 1, name: "탈퇴 버튼이 앱에 있나",
    check: () => {
      const s = anyFile(["public/app/home.html", "public/app/settings.html"], /account-close/);
      const srv = existsSync("netlify/functions/account-close.ts") || inFile("lib/account-close.ts", /./);
      return s.length && srv ? ["닫힘", `서버 있음 · 화면 ${s.join(",")} 가 /api/account-close 를 부른다`] : ["열림", `화면 ${s.length}곳`];
    } },
  { n: 2, name: "매체 기준일이 화면에 뜨나",
    check: () => {
      const s = inFile("public/app/revenue.html", /dayBasis/);
      const srv = inFile("lib/revenue/types.ts", /DAY_BASIS_NOTE/);
      return s && srv ? ["닫힘", "revenue.html 이 서버 dayBasis 를 그린다(문구는 라벨 하니스가 서버와 대조 중)"] : ["열림", `화면 ${s} 서버 ${srv}`];
    } },
  /* 🔴 [2026-09-15 메인 지적 · C 수리] 이 행은 **파일 이름으로 세면 안 된다.**
     설계가 스스로 «`ai-meter` → `lib/billing/ai-cost-cap.ts` 로 **흡수**» 라고 옮겨 적어 뒀다(`docs/DESIGN.md:175`).
     옛 이름(`lib/ai-meter.ts`)으로 세면 영영 «열림» 이다 — **설계가 이름을 옮긴 항목에서 파일명 검사는 대용물이다**(AC-70 의 새 얼굴).
     ⇒ 한 줄이 둘을 묶고 있던 것을 **두 칸으로 쪼갠다**. `ai-meter` 는 «그 기능이 도는가» 로, `ai-key` 는 아직 파일도 기능도 없다. */
  { n: "3a", name: "`ai-meter` → `ai-cost-cap` 흡수(사용량·원가 상한)",
    check: () => {
      const file = existsSync("lib/billing/ai-cost-cap.ts");
      const callers = ["lib/director.ts", "lib/video/cost.ts"].filter((p) => inFile(p, /checkAiCostCap|requireAiBudget/));
      const opsDoor = inFile("netlify/functions/ops-ai.ts", /ai-cost-cap|costCap/i);
      return file && callers.length ? ["닫힘", `lib/billing/ai-cost-cap.ts · 부르는 곳 ${callers.join(",")}${opsDoor ? " · 운영 입구 ops-ai" : ""}`]
        : ["열림", `파일 ${file} · 부르는 곳 ${callers.length}`];
    } },
  { n: "3b", name: "`ai-key`(키 로테이션)",
    check: () => {
      const file = existsSync("lib/ai-key.ts");
      const rotate = inFile("lib/ai.ts", /rotate|keyPool|다음 키/i);
      return file || rotate ? ["닫힘", `파일 ${file} · 로테이션 ${rotate}`]
        : ["열림", "키를 여러 개 돌려 쓰는 길 0 — 지금은 키가 1개라 안 아프지만 설계 §3.3 이 요구한다(B-1 발주됨)"];
    } },
  { n: 4, name: "고지 게이트 사유가 홈에 뜨나",
    check: () => {
      const srv = inFile("netlify/functions/home-summary.ts", /kind:\s*"review_blocked"/);
      const ui = inFile("public/js/ui.js", /review_blocked/);
      return srv && ui ? ["닫힘", "home-summary 가 review_blocked todo 를 내고 화면에 아이콘이 있다"] : srv ? ["🟠 일부", "서버는 내는데 화면 어휘에 없다"] : ["열림", "todo 에 없다"];
    } },
  { n: 5, name: "WP 사이드바 위젯 광고 코드",
    check: () => {
      const hits = anyFile(["lib/publish/wordpress.ts", "lib/publish/ads.ts"], /widget/i);
      return hits.length ? ["닫힘", hits.join(",")] : ["열림", "lib/publish/wordpress.ts·ads.ts 에 widget 0 — 조사의 «B2 는 🟡라 했지만 실제 0» 이 **그대로**다"];
    } },
  { n: 6, name: "`publish-now`(지금 올리기)",
    check: () => {
      const srv = existsSync("netlify/functions/publish-now.ts");
      const ui = inFile("public/app/piece.html", /publish-now/);
      return srv && ui ? ["닫힘", "함수 + piece.html 이 부른다"] : ["열림", `서버 ${srv} 화면 ${ui}`];
    } },
  { n: 7, name: "`avatar`(계정 사진)",
    check: () => {
      const fixed = inFile("lib/accounts.ts", /avatar:\s*null/);
      return fixed ? ["열림", "lib/accounts.ts 가 여전히 `avatar: null` 고정 — 값이 어디서도 안 온다"] : ["닫힘", "고정값 아님"];
    } },
  { n: 8, name: "`account_groups` 표·화면",
    check: () => {
      const ddl = anyFile(["drizzle/0001-init.sql"], /account_groups/).length > 0;
      const srv = inFile("netlify/functions/accounts.ts", /account_groups/);
      const ui = inFile("public/app/settings.html", /account_group|묶음/);
      return ddl && srv && ui ? ["닫힘", "표 + accounts.ts + settings.html"] : ["🟠 일부", `표 ${ddl} 서버 ${srv} 화면 ${ui}`];
    } },
  { n: 9, name: "CS 이메일·카카오 유입",
    check: () => {
      /* 🔴 **열거값은 유입이 아니다.** `TicketSource` 에 "email"·"kakao" 가 있어도, 밖에서 티켓을 만드는 길이 없으면 «앱 티켓만» 그대로다(AC-69). */
      const enumOnly = inFile("lib/cs.ts", /"email"\s*\|\s*"kakao"/);
      const inbound = anyFile(["netlify/functions/support.ts", "netlify/functions/cs-inbound.ts", "netlify/functions/ops-cs.ts"], /inbound|webhook|mail(gun|hook)|카카오 채널/i);
      return inbound.length ? ["닫힘", inbound.join(",")]
        : ["열림", `열거값만 있다(lib/cs.ts TicketSource=${enumOnly}) · **밖에서 티켓을 만드는 길 0** — «있다»가 아니다(AC-69)`];
    } },
  { n: 10, name: "팩트체크 «수치 주장 표시»(글)",
    check: () => {
      /* 🔴 영상엔 `factcheckRoundTrip` 이 있다(`lib/video/script.ts`) — **그건 이 행이 아니다**(이 행은 §16 글 축이다). */
      const textMark = inFile("lib/ai-tell-gate.ts", /numeric_claim|수치 주장/) || inFile("lib/content-gen.ts", /numericClaims/);
      const videoOnly = inFile("lib/video/gen.ts", /factcheckRoundTrip/);
      return textMark ? ["닫힘", "글 축에 수치 주장 표시가 있다"]
        : ["열림", `글 축엔 «쓰지 마라» 프롬프트와 superlative 근거 요구만 있고 **표시(사람이 확인할 수 있게)는 0** · 영상 팩트체크(${videoOnly})는 다른 행이다`];
    } },
  { n: 11, name: "러너 PC 세션 파일 암호화",
    check: () => {
      const hits = anyFile(["runner/lib/browser.mjs", "runner/lib/profile.mjs", "runner/index.mjs"], /createCipheriv|aes-256|encrypt/i);
      return hits.length ? ["닫힘", hits.join(",")] : ["열림", "runner 자체 코드에 암호화 0(node_modules 매치는 남의 코드다) — 고객 PC 에 세션이 평문"];
    } },
  { n: 12, name: "클립 «앱에서 올리기» 딥링크",
    check: () => {
      const path = existsSync("lib/manual-upload.ts");
      const honest = inFile("lib/manual-upload.ts", /URL 스킴을 지어내지 않는다/);
      const ui = inFile("public/app/piece.html", /appOpenVerified/);
      if (path && honest && ui) return ["🟠 일부", "출구는 났다(`lib/manual-upload.ts` + piece.html `appOpenVerified` 스위치) · 🔴 **딥링크 자체는 일부러 안 만들었다**(«URL 스킴을 지어내지 않는다») ⇒ 설계 문장(§17 «딥링크»)과 **결정이 다르다** — 설계를 고칠지 메인 판단"];
      return path ? ["🟠 일부", "manual-upload 는 있으나 화면 스위치가 없다"] : ["열림", "출구 0"];
    } },
];

for (const r of FOUR) { const [state, why] = r.check(); rec(`④-${r.n} ${r.name}`, state, why); }

/* ══ ③ R8 으로 민 54행 중 **R8 에서 실제로 손댄다고 한 묶음**만 ══ */
const THREE = [
  { name: "`lib/channel-registry.ts` 정본 통합", rows: 2,
    check: () => {
      const has = existsSync("lib/channel-registry.ts");
      const guessGone = !inFile("lib/publish/contract.ts", /connectMethodOf/);
      return has && guessGone ? ["닫힘", "표 한 곳 + 추측 폴백 제거(모르면 null)"] : ["🟠 일부", `표 ${has} 추측제거 ${guessGone}`];
    } },
  { name: "고지 축(유튜브 유료 프로모션·파트너십 라벨·분기 재확인·쇼핑 태그)", rows: 4,
    check: () => {
      const yt = inFile("lib/publish/youtube.ts", /paidPromotion|유료 프로모션|selfDeclared/i);
      const ig = inFile("lib/publish/instagram.ts", /is_paid_partnership/);
      const quarterly = existsSync("lib/cron/policy-review.ts");
      const shop = inFile("lib/publish/instagram.ts", /product_tag|쇼핑 태그/i);
      const n = [yt, ig, quarterly, shop].filter(Boolean).length;
      /* 🔴 이 줄은 **4칸**이다 — 셋이 닫히고 하나가 열렸으면 «일부 4칸» 이 아니라 «닫힘 3 · 열림 1» 이다.
         내역을 안 실으면 일부가 부풀고 닫힘·열림이 둘 다 과소평가된다(첫 판에 일부 15 가 그렇게 나왔다). */
      return n === 4 ? ["닫힘", "4/4"] : [n ? "🟠 일부" : "열림",
        `유튜브 ${yt} · 인스타 파트너십 ${ig} · 분기재확인 ${quarterly} · 쇼핑태그 ${shop} = ${n}/4`, [n, 0, 4 - n]];
    } },
  { name: "편성·규칙 화면 — 채널 다중 규칙", rows: 1,
    check: () => {
      const srv = inFile("netlify/functions/rules.ts", /rules/);
      const ui = inFile("public/app/settings.html", /규칙/) || inFile("public/app/home.html", /규칙/);
      return srv && ui ? ["🟠 일부", "서버는 규칙을 몇 개든 받고 화면에 «규칙» 어휘는 있다 · **1채널 다중 규칙 UI 인지는 화면 실물 확인 필요**(정적으로 못 가른다)"] : ["열림", `서버 ${srv} 화면 ${ui}`];
    } },
  { name: "자동승인 «신뢰 계정»", rows: 1,
    check: () => {
      const srv = anyFile(["lib/content-approve.ts", "lib/cron/review-deadline.ts", "lib/accounts.ts"], /trustLevel|신뢰 계정|trusted/i);
      return srv.length ? ["닫힘", srv.join(",")] : ["열림", "서버·화면 0"];
    } },
];
for (const r of THREE) { const [state, why, split] = r.check(); rec(`③ ${r.name}(${r.rows}행)`, state, why, r.rows, split ?? null); }

/* ══ ③ 나머지 — 🔴 **손으로 센 스냅샷을 박아 두지 않는다.** 내가 조사할 때 쓴 근거를 그대로 predicate 로 옮겨
      다시 돌릴 때마다 **다시 재지게** 한다. 안 그러면 이 숫자가 조용히 낡는다(그게 우리가 오늘 열 번 잡은 병이다). ══ */
const SCREEN_TEXT = ["public/js/ui.js", "public/js/mock.js", "public/app/home.html", "public/app/revenue.html", "public/app/settings.html"].map(read).join("\n");
const SERVER_TEXT = ["lib/referral.ts", "netlify/functions/ops-center.ts", "lib/cs.ts"].map(read).join("\n");
const yes = (v) => (v ? "닫힘" : "열림");
const THREE_REST = [
  /* A. 다음 Phase 채널·잡 12칸 — 판정은 «표에 있나»가 아니라 «라우팅표가 그 커넥터를 부르나» */
  ["A1 클립 게시물형", () => [yes(inFile("lib/publish/index.ts", /naver_clip_post:/)), "라우팅표에 없으면 못 올린다"]],
  ["A2 인스타 피드", () => [yes(inFile("lib/publish/index.ts", /instagram:\s*publishInstagramFeed/)), "publishInstagramFeed 라우팅"]],
  ["A3 페북", () => [yes(inFile("lib/publish/index.ts", /facebook:\s*publishFacebookPost/)), "facebook.ts"]],
  ["A4 X(글)", () => [yes(inFile("lib/publish/index.ts", /x:\s*publishToX/)), "x.ts"]],
  ["A5 브런치", () => [yes(inFile("lib/publish/index.ts", /brunch:/)), "커넥터 0 · 표에서도 via=null"]],
  ["A6 틱톡", () => [yes(inFile("lib/publish/index.ts", /tiktok:\s*publishToTiktok/)), "tiktok.ts"]],
  ["A7 페북릴스/롱폼/X영상(한 칸에 셋)", () => {
    const fb = inFile("lib/publish/index.ts", /facebook_reels:/), yl = inFile("lib/publish/index.ts", /youtube_long:/);
    const xv = !inFile("lib/publish/x.ts", /x_video_not_supported/);
    const n = [fb, yl, xv].filter(Boolean).length;
    return [n === 3 ? "닫힘" : n ? "🟠 일부" : "열림", `페북릴스 ${fb} · 롱폼 ${yl} · X영상 ${xv}(x.ts 가 정직하게 막는다) = ${n}/3` /* 🔴 split 안 준다 — 이건 **한 칸 안의 셋**이지 세 칸이 아니다(칸 수와 내역은 다른 것) */];
  }],
  ["A8 텐핑·애드픽", () => [yes(inFile("lib/revenue/types.ts", /tenping/) && inFile("public/app/revenue.html", /revenue-manual/)), "수동 수익원 + 화면이 /api/revenue-manual 을 부른다"]],
  ["A9 쇼핑커넥트", () => [yes(inFile("lib/revenue/types.ts", /shopping_connect/) && inFile("public/app/revenue.html", /revenue-manual/)), "같음"]],
  ["A10 `publish.brunch` 잡", () => [yes(inFile("lib/channel-registry.ts", /jobKind:\s*"publish\.brunch"/)), "잡 이름 0"]],
  ["A11 커넥터 신규(더할 길이 있나)", () => {
    /* 🔴 «길이 선언돼 있나»가 아니라 **«그 길을 실제로 지나갔나»**로 읽는다 — R8 에서 다섯 채널이 그 길로 붙었다. */
    const table = inFile("lib/channel-registry.ts", /export const CHANNELS/);
    const route = inFile("lib/publish/index.ts", /facebook:|x:|tiktok:/);
    return [yes(table && route), "표 1곳 + 라우팅 1곳 + 모듈 1개 — R8 에서 페북·X·틱톡·인스타피드·롱폼이 이 길로 붙었다"];
  }],
  ["A12 §17 P5(릴스 90초)", () => [yes(inFile("lib/video/types.ts", /VideoSeconds = 15 \| 30 \| 60 \| 90/)),
    "VIDEO_SECONDS 에 90 없음 · 🔴 «AM↔AC 코인 이전»은 운영 축 E4 로 옮겼다(원표가 같은 것을 두 칸에 적었다)"]],
  /* B. 글 품질 축 9행 */
  ["B1 유사도 «계정 간» 중복 0", () => {
    const sameBriefOrAccount = inFile("lib/content-gen.ts", /brief_id = \$\{[^}]*\} OR \(account_id/);
    return [sameBriefOrAccount ? "🟠 일부" : "열림",
      "🔴 같은 brief **또는 같은 계정** 30일만 본다 — **다른 brief·다른 계정끼리는 안 본다**. 설계 §4.3 «계정 간 중복 0» 은 아직 반쪽"];
  }],
  ["B2 페르소나 적합도 LLM", () => [yes(anyFile(["lib/ai-tell-gate.ts", "lib/content-approve.ts"], /personaFit|적합도/).length), "0건"]],
  ["B3 신조어 화이트리스트", () => [yes(anyFile(["lib/ai-tell-gate.ts", "lib/banned-words.ts"], /slangWhitelist|신조어/).length), "0건"]],
  ["B4 장소 카드", () => [yes(anyFile(["lib/blocks.ts", "lib/writing-contracts.ts"], /placeCard|장소 카드/).length), "0건"]],
  ["B5 쓰레드 연결글", () => [yes(inFile("lib/publish/threads.ts", /연결글|threadChain|reply_to/), ), "0건"]],
  ["B6 블로거·WP AEO 규격", () => {
    /* 🔴 낱말 «AEO» 는 계약의 visual 라벨(«FAQ(AEO)»)에도 있다 — 그건 **규격 구현이 아니다**(대용물 · AC-57).
       규격이라면 seo.ts 가 구조화 데이터·질문형 헤딩을 실제로 내보내야 한다. */
    const label = inFile("lib/writing-contracts.ts", /FAQ(AEO)/);
    const impl = inFile("lib/publish/seo.ts", /faqPage|FAQPage|question/i);
    return [impl ? "닫힘" : "열림", impl ? "seo.ts 가 구조화 데이터를 낸다" : `계약 라벨에 «AEO» 글자만 있다(label=${label}) · seo.ts 구현 0`];
  }],
  ["B7 에디터 실제 요소", () => [yes(inFile("lib/writing-contracts.ts", /editorElements/), ), "0건"]],
  ["B8 목표 매체 채널 선택", () => [yes(inFile("lib/director.ts", /targetChannel|목표 매체/), ), "0건"]],
  ["B9 `images.heroNeeded` 실동작", () => {
    const written = anyFile(["lib/director.ts", "lib/cron/director-auto.ts"], /heroNeeded:/).length > 0;
    const readBy = anyFile(["lib/content-gen.ts", "lib/ai-image.ts", "netlify/functions/pieces.ts"], /heroNeeded/).length > 0;
    /* 🔴 [2026-09-16 B-1] 설명줄이 **판정을 따라가지 않아** «읽는 곳 true ⇒ 죽은 통로» 라는 모순을 찍고 있었다.
       하니스가 거짓말하면 다음 조사가 그걸 믿는다(AC-78 «값을 베낀 검사는 낡는다» 와 같은 뿌리). */
    return [readBy ? "닫힘" : "열림", `적는 곳 ${written} · **읽는 곳 ${readBy}**${readBy ? " ⇒ content-gen 이 대표 자리를 세우고 meta.hero 로 말해 준다" : " ⇒ 죽은 통로(대표 이미지가 안 붙는다)"}`];
  }],
  /* C. 인프라·규율 8행(레지스트리 2·신뢰계정 1 은 위 THREE 에서 이미 셌다) */
  ["C1 소재 90일", () => [yes(inFile("lib/cron/assign-topics.ts", /interval '90 days'/)), "주석 아니라 실제 쿼리"]],
  ["C2 추천인 코인 화면", () => [yes(inFile("public/app/account.html", /\/api\/referral/)), "account.html 이 부른다"]],
  ["C3 brief 상태 4종", () => {
    /* 🔴 따옴표가 두 가지다 — `${"proposed"}`(템플릿 안 쌍따옴표)와 `status = 'confirmed'`(SQL 홑따옴표).
       내 첫 판은 홑따옴표만 봐서 `proposed` 를 놓치고 «3종» 이라는 가짜 일부를 냈다. */
    const st = ["proposed", "confirmed", "producing", "done"].filter((s) => anyFile(["lib/director.ts", "lib/cron/brief-sweep.ts"], new RegExp(`["']${s}["']`)).length);
    return [st.length === 4 ? "닫힘" : "🟠 일부", `전이 코드에서 확인한 상태 ${st.join("→")}`];
  }],
  ["C4 piece 상태 `edited`", () => [yes(anyFile(["db/schema.ts", "lib/content-approve.ts"], /["']edited["']/).length), "`editedByUser` 는 다른 것이다"]],
  ["C5 AC-1 헤더 일괄", () => "AC1_HEADER"],
  /* D~I */
  ["D 접근성 6(대비·당겨새로고침·햅틱·계좌연결·스와이프·기기시간대)", () => {
    /* 🔴 낱말 하나로 뭉쳐 세면 틀린다 — 첫 판에서 `contrast` 가 **훅 이름**(«반전으로 시작»)에 걸려 가짜로 세어졌다.
       여섯 항목을 **각각 그 기능의 실물**로 재고, 내역을 칸 수에 그대로 실어 보낸다(일부로 뭉치면 닫힘·열림이 둘 다 과소평가된다). */
    const SC = ["public/js/ui.js", "public/app/home.html", "public/app/create.html", "public/app/settings.html", "public/app/revenue.html"].map(read).join("\n");
    const items = [
      ["대비 4.5:1", /4\.5:1|contrastRatio/],
      ["당겨서 새로고침", /당겨서 새로고침|pullToRefresh/],
      ["햅틱", /햅틱|vibrate\(/],
      ["계좌연결 패턴", /계좌 연결/],
      ["소재 스와이프", /swipe|스와이프/],
      ["기기 시간대", /deviceTz|resolvedOptions\(\)\.timeZone/],
    ];
    const got = items.filter(([, re]) => re.test(SC)).map(([n]) => n);
    const miss = items.filter(([, re]) => !re.test(SC)).map(([n]) => n);
    return [got.length === 6 ? "닫힘" : got.length ? "🟠 일부" : "열림",
      `있는 것 ${got.length}/6 [${got.join(",")}] · 없는 것 [${miss.join(",")}]`, [got.length, 0, miss.length]];
  }],
  ["E1 AI 원가 provider 분해", () => [yes(inFile("netlify/functions/ops-ai.ts", /byProvider|provider 분해/)), "0건"]],
  ["E2 추천인 이벤트", () => {
    const active = inFile("lib/referral.ts", /활성인 추천 이벤트/);
    const ops = inFile("lib/referral.ts", /ops-promotions|kind:s*"referral"/);
    return [active && ops ? "닫힘" : "열림", active ? "referral.ts:106 «지금 활성인 추천 이벤트의 코인 수» + ops-promotions kind:referral" : "0건"];
  }],
  ["E3 티켓 한 화면", () => [yes(existsSync("public/ops/cs.html")), "public/ops/cs.html"]],
  ["E4 AM↔AC 코인 이전", () => [yes(inFile("netlify/functions/coin-transfer.ts", /amDebit/)), "coin-transfer → am-bridge amDebit (칸12 에서 이리로 옮김)"]],
  ["E5 정본 동기화 PR", () => [yes(anyFile(["lib/am-bridge.ts"], /syncPr|동기화 PR/).length), "0건"]],
  ["E6 운영자 화면 조정", () => [yes(existsSync("netlify/functions/ops-center.ts")), "ops-center"]],
  ["F 팀 축 4(시트·초대·accept·팀 승인)", () => [yes(SERVER_TEXT.includes("team-invite") || SERVER_TEXT.includes("team_members")), "lib·netlify·public 전수 0건"]],
  ["H1 카드뉴스 kind", () => [yes(inFile("lib/slots.ts", /cardnews/)), "verify-cardnews PASS 20"]],
  ["H3 상태 16종", () => [yes(inFile("public/js/ui.js", /UI\.SLOT_STATUS/)), "UI.SLOT_STATUS 17종"]],
  ["I 러너 트레이 앱 2", () => [yes(existsSync("runner/tray.mjs") || existsSync("runner/tray")), "트레이 앱 파일 0"]],
];
for (const [name, fn] of THREE_REST) {
  let out = fn();
  if (out === "AC1_HEADER") {
    /* lib/*.ts 중 **출처 헤더가 아예 없는** 파일 수 — 있는 채로 남으면 다음 사람이 출처를 못 따라간다(AC-1). */
    const { readdirSync } = await import("node:fs");
    const files = readdirSync("lib").filter((f) => f.endsWith(".ts"));
    const missing = files.filter((f) => !/AM 원본|AC 신규|출처/.test(read(`lib/${f}`).split("\n").slice(0, 12).join("\n")));
    out = [missing.length === 0 ? "닫힘" : "🟠 일부", `lib/*.ts ${files.length}개 중 출처 헤더 없는 것 **${missing.length}개**(${missing.slice(0, 3).join(",")}…)`];
  }
  const W = { "D 접근성": 6, "F 팀 축": 4, "I 러너 트레이 앱": 2 };
  const wk = Object.keys(W).find((k) => name.startsWith(k));
  rec(`③ ${name}`, out[0], out[1], wk ? W[wk] : 1, out[2] ?? null);
}

const four = results.filter((r) => r.row.startsWith("④"));
const closed = four.filter((r) => r.state === "닫힘").length;
const partial = four.filter((r) => r.state.startsWith("🟠")).length;
const open = four.filter((r) => r.state === "열림").length;

if (JSON_OUT) console.log(JSON.stringify({ at: new Date().toISOString(), four: { closed, partial, open }, results }, null, 2));
else {
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\n설계 대비 «남은 64행» 진척 — 코드로 다시 셈(R8 §7) · ${new Date().toISOString()}\n${"─".repeat(156)}`);
  for (const r of results) console.log(`${r.state === "닫힘" ? "✓" : r.state === "열림" ? "✗" : "△"} ${w(r.row, 44)} ${w(r.state, 7)} ${w(r.why, 98)}`);
  console.log(`${"─".repeat(156)}`);
  console.log(`④ 진짜 미개발 12행 — **닫힘 ${closed} · 🟠 일부 ${partial} · 열림 ${open}** (조사 당시 12행 전부 열림)`);
  console.log("🔴 «서버만 있고 화면이 없는 것»·«열거값만 있는 것»은 닫힌 것으로 안 센다(CLAUDE §4.8 · AC-69).");
  /* 🔴 **분모를 여기서 못 박는다.** 오늘 «64·66·67» 로 세 번 흔들렸다 — 다음 사람이 또 헤매지 않게 하니스가 직접 센다.
     칸 = 조사 §10.3 의 ③54 + ④13(ai-meter/ai-key 를 쪼갠 값 · 메인 확정 2026-09-15). */
  /* 🔴 묶음 행은 **내부 내역(split)** 이 있으면 그걸로 센다 — 없으면 행 전체가 한 상태다.
     split 없이 «일부» 를 칸 수만큼 세면 «일부» 가 부풀고 닫힘·열림이 둘 다 과소평가된다(첫 판에 일부 15 가 그렇게 나왔다). */
  let C = 0, P = 0, O = 0;
  for (const r of results) {
    const w = r.w ?? 1;
    if (r.split) { C += r.split[0]; P += r.split[1]; O += r.split[2]; continue; }
    if (r.state === "닫힘") C += w; else if (String(r.state).startsWith("🟠")) P += w; else O += w;
  }
  const T = C + P + O;
  console.log(`
■ **${T}칸 중 닫힘 ${C} · 일부 ${P} · 열림 ${O} (${Math.round((C / T) * 100)}%)**  ← 사장님 보고용 한 줄(분모 = ③54 + ④13)`);
}
process.exit(0);
