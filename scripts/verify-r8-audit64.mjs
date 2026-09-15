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
const rec = (row, state, why) => results.push({ row, state, why });

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
  { n: 3, name: "`ai-meter.ts`·`ai-key.ts` 이식",
    check: () => {
      const has = ["lib/ai-meter.ts", "lib/ai-key.ts"].filter((p) => existsSync(p));
      return has.length === 2 ? ["닫힘", has.join(",")] : ["열림", `파일 ${has.length}/2 — 설계 §3.3 표에 적힌 파일이 없다(CLAUDE §8 전본 규칙)`];
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
      return n === 4 ? ["닫힘", "4/4"] : [n ? "🟠 일부" : "열림", `유튜브 ${yt} · 인스타 파트너십 ${ig} · 분기재확인 ${quarterly} · 쇼핑태그 ${shop} = ${n}/4`];
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
for (const r of THREE) { const [state, why] = r.check(); rec(`③ ${r.name}(${r.rows}행)`, state, why); }

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
}
process.exit(0);
