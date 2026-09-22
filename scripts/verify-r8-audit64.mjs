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
import { readFileSync, existsSync as existsSync0 } from "node:fs";

/* 🔴 ══ **이 자의 stdout 을 누가 먹나** — 새 줄을 찍기 전에 반드시 읽어라 ══
 *   `scripts/verify-audit-selftest.mjs:29` 가 `--json` 으로 이 자를 돌려 **stdout 을 통째로 `JSON.parse`** 한다.
 *   ⇒ 🔴 **`--json` 일 때 stdout 에 나가는 것은 `:593` 의 JSON 한 덩이뿐이어야 한다.**
 *      사람에게 할 말은 **`console.error`(stderr)** 로 보내라 — 먹는 쪽은 stdout 만 읽는다.
 *   실제로 밟았다(2026-09-22 C · 배포 직전 전수 검사가 잡았다): 내가 맨 끝에 «내가 읽은 제품 파일 …» 한 줄을
 *   `console.log` 로 찍었더니 **JSON 뒤에 붙어** `Unexpected non-whitespace character after JSON at position 9187` 로 죽었다.
 *   🔴 **«내 자리»라고 생각한 곳이 남의 입구였다** — 자를 고칠 때는 **그 자를 부르는 자까지** 돌려 봐야 한다(AC-240 · 옛 번호 AC-219 는 B 가 먼저 쓴 자리라 내가 비켰다). */
const JSON_OUT = process.argv.includes("--json");
/* [2026-09-16 메인 · b-49 실측] 주석을 걷어 낸 본문 — «주석에만 적혀 있는 것»을 만든 것으로 세지 않는다(AC-59).
   b-49 가 찔러 보니 11칸 중 **9칸**이 주석 한 줄로 닫혔다(A10·B7·B8·H1·E4·C1·A12·C2·H3).
   지금 당장 틀린 값은 아니었지만(주석 덕에 초록인 칸 0) «계획을 주석에 적는 우리 관습»과 만나는 순간 거짓말이 된다.
   형제 하니스 `verify-r8-deadends.mjs` 가 이미 같은 일을 한다 — **자가 두 벌인 게 제일 나쁘다**(AC-82).
   HTML 주석도 같이 건다(C2 가 `<!-- -->` 로 닫혔다).
   [예외] ③C5 는 **산출물 자체가 주석**이라 `read()` 를 그대로 쓴다(아래 headerOf). */
const stripComments = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
  .replace(/<!--[\s\S]*?-->/g, " ");
/* ══ [자 점검용 손잡이 셋] (b-49 설계 · 2026-09-16) 🔴 **환경변수가 없으면 아래 셋은 전부 항등식이다** ══
   AC_HIDE="경로[,경로…]"    그 파일을 **빈 파일**로 읽는다(+ existsSync 도 false) — «이 칸이 정말 그 파일을 읽나»
   AC_INJECT="경로::글[§§…]"  읽히는 내용 **뒤에 한 줄** 덧댄다(디스크는 안 건드린다) — «이 칸이 닫힐 수 있는 자인가»
   AC_STRIP=1                모든 파일을 **주석 지운 본문**으로 읽는다 — «이 칸이 주석을 세고 있나»
   🔴 **판정 로직은 한 줄도 안 바뀐다** — 바꾸는 것은 «읽히는 내용»뿐이다.
   ⚠️ `AC_INJECT` 의 글에 `::` 나 `§§` 를 넣지 마라(구분자다).
   ⚠️ 🔴 **③C5 는 손잡이가 안 먹는다** — `read()` 를 안 쓰고 `readdirSync` + 자기 `headerOf()` 로 돈다. 그 칸은 직접 변이로 재라.
   근거: `docs/active/2026-09-16-audit-measure-review.md` — 이 손잡이로 가짜 초록 둘(④7·E6)을 찾았다. */
const AC_HIDE = (process.env.AC_HIDE || "").split(",").filter(Boolean);
const AC_INJECT = (process.env.AC_INJECT || "").split("§§").filter(Boolean).map((x) => x.split("::"));
const AC_STRIP = process.env.AC_STRIP === "1";
/** 경로 끝맞춤(윈도우 역슬래시도 받는다). */
const acPath = (p) => String(p).split(String.fromCharCode(92)).join("/");
const acHidden = (p) => AC_HIDE.length > 0 && AC_HIDE.some((h) => acPath(p).endsWith(h));
const existsSync = (p) => (acHidden(p) ? false : existsSync0(p));
/** AC_INJECT 덧대기 — 🔴 `AC_HIDE` 와 **같은 파일에** 걸 수 있어야 한다(«근거는 지우고 주석만 남긴다» 를 한 파일에서 재려면 · b-49). */
const injectOf = (p, t) => { for (const [ip, txt] of AC_INJECT) if (acPath(p).endsWith(ip)) t += "\n" + txt; return t; };
/** 🔴 **날것**으로 읽는다(주석 포함) — ③C5 처럼 «주석이 곧 산출물»인 칸만 이걸 쓴다. */
const read = (p) => {
  if (acHidden(p)) return injectOf(p, "");
  let t; try { t = readFileSync(p, "utf8"); } catch { return ""; }
  if (AC_STRIP) t = stripComments(t);
  return injectOf(p, t);
};
/* 🔴 [2026-09-16 메인 · b-49 가 잡았다] **주석을 걷어 낸 본문 — 기본은 이쪽이다.**
   앞 판은 걷어내기를 `inFile` **안에** 숨겼다. 그래서 `read()` 를 직접 쓰는 자리(다섯 곳)가 **조용히 뚫렸다** —
   🔴 실제로 **D 접근성**이 그랬다: `revenue.html` 에 «햅틱·당겨서 새로고침·스와이프 는 **다음 라운드에 만든다**»라는
   HTML 주석 한 줄을 넣으면 그 셋이 «있다»가 되어 **닫힘 6/6** 이 떴다(b-49 실측).
   **우리는 계획을 주석에 적는다 — 가정이 아니라 우리 관습이다.**
   ⇒ 보호를 **이름 있는 함수로 꺼낸다.** 새 칸을 쓰는 사람이 `read` 와 `readCode` 중 고르게 되고, 고르지 않으면 안 뚫린다. */
const readCode = (p) => (AC_STRIP ? read(p) : stripComments(read(p)));
/** 그 파일 안에 그 패턴이 있나 — **파일을 지목**해서 본다(전역 grep 은 엉뚱한 파일에 걸린다). 🔴 주석은 뺀 본문에서 본다. */
const inFile = (p, re) => re.test(readCode(p));
const anyFile = (ps, re) => ps.filter((p) => inFile(p, re));

/* ═══ 🔴 **«없다»를 말하려면 «봤다»부터 말해야 한다**(2026-09-22 C · AC-217) ═══
   `verify-experiment-holds` 로 이 자를 재니, **제품을 통째로 비운 나무에서도** 두 줄이 «닫힘»이었다:
     · `lib/channel-registry.ts 정본 통합` — `!inFile(…, /connectMethodOf/)` 가 **부정형**이라
       그 파일이 **비어도 참**이 된다(AC-121 «없어야 한다»는 대상을 못 찾아도 통과한다).
     · `E3 티켓 한 화면` — `existsSync(…)` 만 봐서 **빈 파일도 «있다»**가 된다.
   🔴 둘 다 «찾았다»가 아니라 **«못 찾았다»를 통과로 쓴 것**이다(AC-141 ②).
   ⇒ 아래 둘을 쓴다. 파일을 **실제로 읽었을 때만** 판정하고, 못 읽었으면 **false**(= 안전한 쪽으로 틀린다). */
/** 그 파일을 실제로 읽었나 — 없거나 비었으면 false. */
const alive = (p) => readCode(p).trim().length > 0;
/** 🔴 «그 파일에 그 패턴이 **없다**» — **읽은 파일에 대해서만** 참이다. */
const notInFile = (p, re) => alive(p) && !inFile(p, re);

const results = [];
/** 한 줄이 몇 «칸»인가 — 묶음 행(접근성 6·팀 4·트레이 2·레지스트리 2·고지 4)은 한 줄이 여러 칸이다.
 *  🔴 칸 수를 안 달면 줄을 세는 것과 칸을 세는 것이 갈려 분모가 또 흔들린다(오늘 «64·66·67» 로 세 번 흔들렸다). */
const rec = (row, state, why, w = 1, split = null) => results.push({ row, state, why, w, split });

/* ══ [화면 축] 🔴 **판정에 안 쓴다. 출력에만 붙는다.** ══
   CLAUDE §4.8 «완료 = 화면에서 쓸 수 있을 때» 를 **자가 안 재는 칸**을 눈에 보이게 하려는 표시다.
   🔴 «화면에 이 낱말이 있나»로 재지 않는다 — 그건 가짜 빨강을 만든다(§8.3: 유사도·장소 카드는
      `UI.gateList`·`bodyHtml` 이 **일반 렌더**로 그려서 열쇠 낱말이 화면에 있을 이유가 없다).
   🔴 조각은 «그 칸을 가리키는 가장 짧고 안 바뀔 말»로 고른다. 칸 이름을 통째로 적으면 이름이 조금만 바뀌어도 미분류가 된다. */
const SCREEN_AXIS = [
  ["④-1 탈퇴", "고객"], ["④-2 매체 기준일", "고객"], ["④-3a", "운영"], ["④-3b", "해당없음"],
  ["④-4 고지 게이트", "고객"], ["④-5 WP 사이드바", "고객"], ["④-6 `publish-now`", "고객"],
  ["④-7 `avatar`", "고객"], ["④-8 `account_groups`", "고객"], ["④-9 CS 이메일", "운영"],
  ["④-10 팩트체크", "고객"], ["④-11 러너 PC 세션", "해당없음"], ["④-12 클립", "고객"],
  ["`lib/channel-registry.ts` 정본 통합", "해당없음"], ["고지 축(", "고객"],
  ["편성·규칙 화면", "고객"], ["자동승인 «신뢰 계정»", "고객"],
  ["A1 클립 게시물형", "고객"], ["A2 인스타 피드", "고객"], ["A3 페북", "고객"], ["A4 X(글)", "고객"],
  ["A5 브런치", "고객"], ["A6 틱톡", "고객"], ["A7 페북릴스", "고객"], ["A8 텐핑", "고객"],
  ["A9 쇼핑커넥트", "고객"], ["A10 `publish.brunch`", "해당없음"], ["A11 커넥터 신규", "해당없음"],
  ["A12 §17 P5", "고객"],
  ["B1 유사도", "고객"], ["B2 페르소나 적합도", "고객"], ["B3 신조어", "고객"], ["B4 장소 카드", "고객"],
  ["B5 쓰레드 연결글", "고객"], ["B6 블로거·WP AEO", "해당없음"], ["B7 에디터 실제 요소", "해당없음"],
  ["B8 목표 매체", "고객"], ["B9 `images.heroNeeded`", "고객"],
  ["C1 소재 90일", "해당없음"], ["C2 추천인 코인 화면", "고객"], ["C3 brief 상태", "고객"],
  ["C4 piece 상태", "해당없음"], ["C5 AC-1 헤더", "해당없음"],
  ["D 접근성", "고객"],
  ["E1 AI 원가", "운영"], ["E2 추천인 이벤트", "해당없음"], ["E3 티켓 한 화면", "운영"],
  ["E4 AM↔AC", "고객"], ["E5 정본 동기화", "운영"], ["E6 운영자 화면 조정", "운영"],
  ["F 팀 축", "고객"], ["H1 카드뉴스 kind", "고객"], ["H3 상태 16종", "고객"],
  ["I 러너 트레이 앱", "해당없음"],
];
/* 🔴 «이 칸이 public/ 을 지목하나» — 판정에 안 쓴다. 자를 고치면 **저절로 따라온다**(사람 표가 안 낡는다). */
const _selfLines = read("scripts/verify-r8-audit64.mjs").split("\n");
const _rowStarts = _selfLines.map((l, i) => ((/^\s*\["(.+?)", \(\) =>/.test(l) || /^\s*\{ (?:n: .*?)?name: "(.+?)"/.test(l)) ? i : -1)).filter((i) => i >= 0);
const READS_SCREEN = new Map();
_rowStarts.forEach((s, k) => {
  const nm = (_selfLines[s].match(/\["(.+?)"/) || _selfLines[s].match(/name: "(.+?)"/) || [])[1] || "";
  const body = stripComments(_selfLines.slice(s, _rowStarts[k + 1] ?? _selfLines.length).join("\n"));
  if (nm) READS_SCREEN.set(nm, /"public\//.test(body) || /\bSC\b/.test(body));
});
const axisOf = (row) => { const h = SCREEN_AXIS.find(([k]) => row.includes(k)); return h ? h[1] : "미분류"; };
const readsScreenOf = (row) => { for (const [nm, v] of READS_SCREEN) if (row.includes(nm)) return v; return null; };


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
      /* 🔴 [2026-09-16 · C] 옛 판은 `file || rotate` 였다 — **파일만 있어도 닫힘**이라 화면에 «파일 true · 로테이션 false» 를
         찍으면서 «닫힘»이라 말했다(판정과 설명이 어긋난 자리 · AC-80). 게다가 `rotate` 정규식이 실제 이름을 몰랐다 —
         고르는 자리는 `leaseAiKey()` 다(AC-75). ⇒ **그 자리를 실제로 부르나**로 잰다(고르기 + 결과 되먹임 둘 다). */
      const file = existsSync("lib/ai-key.ts");
      const rotate = inFile("lib/ai.ts", /leaseAiKey\(/) && inFile("lib/ai.ts", /reportAiKeyOutcome\(/);
      return file && rotate ? ["닫힘", "lib/ai-key.ts + lib/ai.ts:291 이 leaseAiKey() 로 고르고 reportAiKeyOutcome() 으로 되먹인다"]
        : [file ? "🟠 일부" : "열림", `파일 ${file} · 고르는 자리를 부르나 ${rotate} — 파일만 있고 안 부르면 닫힌 게 아니다(AC-69)`];
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
      /* 🔴 [2026-09-16 메인 · b-49 가 잡았다] 옛 판은 «`avatar: null` 고정이 **없으면** 닫힘»이라는 **부정형**이었다.
         그래서 `lib/accounts.ts` 를 **통째로 가려도 «닫힘»**이 나왔다 — 파일이 지워져도·이름이 바뀌어도 초록이다.
         그 «닫힘»은 «계정 사진이 된다»가 아니라 «**내가 아는 나쁜 모양을 못 찾았다**»였다(AC-87 의 제일 비싼 얼굴).
         ⇒ **긍정 증거**로 바꾼다 — 읽고 · 싣고 · **화면이 그린다**(머리말 ③ 규율 그대로). 이웃 칸 6·8 과 같은 모양이다. */
      const sel = inFile("lib/accounts.ts", /a\.avatar_url/);
      const map = inFile("lib/accounts.ts", /avatar:\s*r\.avatar_url/);
      const ui = inFile("public/js/ui.js", /\.avatar/);
      const fixed = inFile("lib/accounts.ts", /avatar:\s*null\s*[,}]/);
      return sel && map && ui && !fixed
        ? ["닫힘", "accounts.ts 가 avatar_url 을 읽어 싣고 ui.js 가 그린다"]
        : ["🟠 일부", `SELECT ${sel} 매핑 ${map} 화면 ${ui}${fixed ? " · 🔴 avatar: null 고정이 남아 있다" : ""}`];
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
      /* 🔴 [2026-09-16 · C] **옛 이름으로 재고 있었다**(AC-75). 이 줄은 `lib/content-gen.ts` 에서 `numericClaims`(소문자 n)를
         찾았는데 실제 이름은 **`findNumericClaims`**(대문자 N)라 안 걸렸고, `ai-tell-gate.ts` 의 `numeric_claim` 은 0건이었다.
         사슬은 네 마디로 다 이어져 있다 — C 가 처음부터 끝까지 따라가 확인했다:
           ①순수 lib/fact-claims.ts:81 findNumericClaims
           ②생성 lib/content-gen.ts:455 가 부르고 :471 이 meta.numberClaims 로 적는다
           ③서버 netlify/functions/pieces.ts:142 가 summary·items·line 으로 내려준다
           ④화면 public/app/piece.html:82 renderClaims() · :233 에서 부른다
         🔴 잣대를 **«화면이 그리나»**로 올린다(메인 지시) — **빌드 산출물**(piece.html)을 본다.
            _tpl.txt 만 보면 빌드가 끊겨도 초록이 뜬다. */
      const gen = inFile("lib/content-gen.ts", /findNumericClaims\(/);
      const srv = inFile("netlify/functions/pieces.ts", /numberClaims/);
      const drawDef = inFile("public/app/piece.html", /function renderClaims/);
      const drawCall = inFile("public/app/piece.html", /renderClaims\(\)\s*;/);
      if (gen && srv && drawDef && drawCall) return ["닫힘", "생성 content-gen:455 → 서버 pieces.ts:142 → **화면 piece.html renderClaims() 가 그린다**(정의+호출 둘 다)"];
      if (gen && srv && drawDef) return ["🟠 일부", "화면에 그리는 함수는 있는데 **부르는 자리가 없다**(AC-69)"];
      return ["열림", `생성 ${gen} · 서버 ${srv} · 화면정의 ${drawDef} · 화면호출 ${drawCall}`];
    } },
  { n: 11, name: "러너 PC 세션 파일 암호화",
    check: () => {
      /* 🔴 [메인 2026-09-16 · AC-75] 옛 파일 이름으로 재고 있었다. B2 가 §3.1 에서 **`runner/lib/profile-seal.mjs`** 로 만들었고
         `runner/core.mjs` 가 실제로 `sealProfile`·`unsealProfile` 을 부른다(:155·:259) · `ac-runner.mjs` 가 `sealLine` 을 부른다.
         🔴 «있나»가 아니라 «**제품이 부르나**»까지 본다 — 파일만 있고 안 부르면 이 칸은 안 닫힌다(AC-69). */
      /* 🔴 [2026-09-16 메인] `runner/lib/profile.mjs`·`runner/index.mjs` 는 **없는 파일**이었다(C 의 자가검사가 물었다 · AC-82).
         지금은 앞 둘이 있어 통과하지만, 앞 둘이 이름을 바꾸면 **죽은 경로만 남아 조용히 «없음»**이 된다. */
      const has = anyFile(["runner/lib/profile-seal.mjs", "runner/lib/browser.mjs"], /createCipheriv|aes-256|encrypt/i);
      const used = anyFile(["runner/core.mjs", "runner/ac-runner.mjs"], /sealProfile|unsealProfile|profile-seal/);
      /* 🔴 [2026-09-16 · C 재검] **서버 마디를 같이 본다.** 러너가 아무리 불러도 `account.profileSealKey` 가 안 내려오면
         러너의 그 if 는 영영 거짓이고 봉인은 한 번도 안 돈다. C 가 사슬 여섯 마디를 직접 따라갔다:
           러너 probeFleet(core.mjs:77) → 하트비트 caps(ac-runner.mjs:65) → runner_devices.caps 적재(runner-jobs.ts:489)
           → claim 이 되읽음(runner-jobs.ts:706 deviceCaps) → sealWantedFor → ensureProfileKey → 응답 profileSealKey
         이 줄이 없으면 **서버가 열쇠를 끊어도 하니스는 계속 초록**이다. */
      const srvIssues = inFile("lib/runner-jobs.ts", /ensureProfileKey\(/) && inFile("lib/profile-seal.ts", /sealWantedFor/);
      if (has.length && used.length && srvIssues) return ["닫힘", `${has.join(",")} · 러너가 부른다 · **서버가 열쇠를 내린다**(runner-jobs ensureProfileKey)`];
      if (has.length && used.length) return ["🟠 일부", "러너는 부르는데 **서버가 열쇠를 안 내린다** — profileSealKey 가 늘 비면 봉인은 영영 안 돈다"];
      if (has.length) return ["열림", `암호화는 있는데 **부르는 곳이 0**이다(${has.join(",")}) — 만들어 놓고 아무도 안 쓴다`];
      return ["열림", "runner 자체 코드에 암호화 0(node_modules 매치는 남의 코드다) — 고객 PC 에 세션이 평문"];
    } },
  { n: 12, name: "클립 «앱에서 올리기» 딥링크",
    check: () => {
      const path = existsSync("lib/manual-upload.ts");
      const honest = inFile("lib/manual-upload.ts", /URL 스킴을 지어내지 않는다/);
      const ui = inFile("public/app/piece.html", /appOpenVerified/);
      /* 🔴 [2026-09-16 · C 판정 · 메인이 맡긴 것] 메인이 ««일부»가 아니라 «결정으로 미룸»으로 세도 된다»고 했다.
         **세지 않는다 — 분모에 그대로 둔다.** 트레이(I)와 **다른 경우**이기 때문이다:
           · 트레이 = «**안 만든다**». 대체물(run.bat --autostart)이 이미 있고 **남은 일이 0**이라 분모 밖이 맞다.
           · 딥링크 = «**아직 안 만든다**». 설계(§17 · 메인 301f5d3)가 «클립 앱을 한 번 보면 그때 만든다»로 바뀌었다 —
             **남은 일이 있고**, 막은 것은 우리 결정이 아니라 **외부 선결조건**(그 앱을 본 적이 없다)이다.
         CLAUDE §8 은 외부 선결조건으로 막힌 항목을 «먼저 완성하고 키 꽂으면 즉시 가동» 상태로 두라고 한다 — **지도에 남기라는 뜻**이다.
         🔴 AC-75 는 양쪽으로 벤다: 안 만들 것을 미개발로 세면 거짓말이고, **만들 것을 분모에서 빼도 거짓말이다**(%가 공짜로 오른다). */
      if (path && honest && ui) return ["🟠 일부", "출구는 났다(`lib/manual-upload.ts` + piece.html `appOpenVerified` 스위치) · 딥링크 자체는 **아직** 안 만든다 — 설계 §17 이 «클립 앱을 한 번 보면 그때»로 바뀌었다(메인 301f5d3) · 🔴 **분모에 남긴다**(«안 만든다»인 트레이와 달리 **남은 일이 있다** · 막은 건 외부 선결조건이다)"];
      return path ? ["🟠 일부", "manual-upload 는 있으나 화면 스위치가 없다"] : ["열림", "출구 0"];
    } },
];

for (const r of FOUR) { const [state, why] = r.check(); rec(`④-${r.n} ${r.name}`, state, why); }

/* ══ ③ R8 으로 민 54행 중 **R8 에서 실제로 손댄다고 한 묶음**만 ══ */
const THREE = [
  { name: "`lib/channel-registry.ts` 정본 통합", rows: 2,
    check: () => {
      const has = existsSync("lib/channel-registry.ts");
      const guessGone = notInFile("lib/publish/contract.ts", /connectMethodOf/);
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
    const xv = notInFile("lib/publish/x.ts", /x_video_not_supported/);
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
  /* 🔴 [2026-09-16 메인 · b-49 실측] 옛 판은 **타입 별칭 글자**를 봤다 — 실제 배열 `VIDEO_SECONDS` 에 90 을 넣어도 **열림 그대로**였다.
     «90초를 진짜로 켜도 빨강이 안 풀리는 자»다. ⇒ **실제로 고를 수 있는 값**(런타임 배열)을 본다. */
  ["A12 §17 P5(릴스 90초)", () => [yes(inFile("lib/video/types.ts", /VIDEO_SECONDS[^=]*=\s*\[[^\]]*90/)),
    "VIDEO_SECONDS 에 90 없음 · 🔴 «AM↔AC 코인 이전»은 운영 축 E4 로 옮겼다(원표가 같은 것을 두 칸에 적었다)"]],
  /* B. 글 품질 축 9행 */
  ["B1 유사도 «계정 간» 중복 0", () => {
    const sameBriefOrAccount = inFile("lib/content-gen.ts", /brief_id = \$\{[^}]*\} OR \(account_id/);
    /* [2026-09-16 C · R9-8] 🔴 보던 자리가 **옛 자리**였다(AC-75) — B 가 `lib/cross-account.ts crossAccountSimilarity` 로 **다른 계정끼리**를 잰다
       (`account_id <> 현재` · 테넌트 전체) 그리고 승인(content-approve)·생성(content-gen) 두 경로가 부른다(verify-r8-deadends 확인 · gate 축 cross_account · meta.crossSimilarity{measured}).
       «있나»가 아니라 «다른 계정을 보나 + 두 경로가 부르나 + 못 쟀으면 measured:false 로 적나(AC-9)»로 잰다. */
    const cross = inFile("lib/cross-account.ts", /account_id <> \$\{accountId\}/) && inFile("lib/cross-account.ts", /measured:\s*(true|false)/);
    const called = inFile("lib/content-approve.ts", /crossAccountSimilarity\(/) && inFile("lib/content-gen.ts", /crossAccountSimilarity\(/);
    if (cross && called) return ["닫힘", "lib/cross-account.ts 가 다른 계정 글과 잰다(account_id <> 현재 · 테넌트 전체) · 승인·생성 두 경로가 부른다 · 못 쟀으면 measured:false"];
    return [sameBriefOrAccount ? "🟠 일부" : "열림",
      "🔴 같은 brief **또는 같은 계정** 30일만 본다 — **다른 brief·다른 계정끼리는 안 본다**. 설계 §4.3 «계정 간 중복 0» 은 아직 반쪽"];
  }],
  /* 🔴 [2026-09-16 B-1] 보던 자리가 **틀렸다.** 적합도는 «다 쓴 글을 재는 것»(ai-tell-gate·content-approve)이 아니라
     **«계정을 고르는 것»**(DESIGN §5.3-2 배정)이다. 엉뚱한 파일을 보고 있으면 진짜로 만들어도 영영 열림이고,
     반대로 그 파일에 «적합도»라는 낱말만 스쳐도 닫힘이 된다(AC-78 의 다음 층 — 검사가 **엉뚱한 곳**을 본다).
     ⇒ 판정기(`lib/persona-fit.ts`)가 있고 **두 경로가 다 배정에 쓰는가**로 바꾼다. 느슨해진 게 아니라 더 조인 것이다.
     🔴 이름에 «LLM» 이 붙어 있지만 **LLM 은 일부러 안 붙였다**(메인 지시 · 돈이 두 배) — 글자로 재고 못 잰 축은 «못 쟀다»로 적는다. */
  ["B2 페르소나 적합도", () => {
    const has = inFile("lib/persona-fit.ts", /personaFitOf/);
    const human = inFile("lib/director.ts", /assignAccount.accounts, ch, fit.bonus./);
    const auto = inFile("lib/cron/director-auto.ts", /assignAccount.accounts, slot.channel, fit.bonus./);
    return [yes(has && human && auto), has ? `판정기 ${has} · 사람 경로 ${human} · 자동 경로 ${auto}` : "0건"];
  }],
  /* 🔴 [2026-09-16 B-1] 종전 판정은 **주석에 «신조어»라는 낱말만 스쳐도 닫힘**이었다(두 파일 본문 검색).
     표만 만들고 아무도 안 봐도 통과한다 — AC-69 가 말하는 «정의가 있나»식 검사다.
     ⇒ ①표가 있고 ②검사가 본다(게이트가 allowSlang 을 넘긴다) ③프롬프트가 본다, **셋 다**로 조인다. */
  ["B3 신조어 화이트리스트", () => {
    const table = inFile("lib/slang-whitelist.ts", /SLANG_BY_AGE/);
    const gate = inFile("lib/ai-tell-gate.ts", /allowSlang: slangAllowedFor/);
    const prompt = inFile("lib/content-gen.ts", /slangPromptLine/);
    return [yes(table && gate && prompt), table ? `표 ${table} · 검사 ${gate} · 프롬프트 ${prompt}` : "0건"];
  }],
  /* 🔴 [2026-09-16 B-1] 종전 판정은 주석에 «장소 카드»만 스쳐도 닫힘이었다(B3 와 같은 모양).
     ⇒ ①블록 어휘에 있고 ②러너가 **실제로 내려앉히고** ③🔴 계약이 스스로 안 싸우는가(visualMin 에 안 넣었나), 셋으로 조인다.
     ③ 이 없으면 2026-09-15 `visualMin.faq` 사고(네이버 글 10편 중 8편 재작성 · 돈 두 배)를 그대로 다시 낸다. */
  ["B4 장소 카드", () => {
    const block = inFile("lib/blocks.ts", /place.: . name: string/);
    const runner = inFile("runner/lib/plan.mjs", /장소 카드는 아직 못 넣어서/);
    const notForced = notInFile("lib/writing-contracts.ts", /visualMin: .[^}]*place/);
    return [yes(block && runner && notForced), block ? `블록 ${block} · 러너 링크대체 ${runner} · visualMin 에 안 넣음 ${notForced}` : "0건"];
  }],
  /* [R8CLOSE §B5 · B2 2026-09-16] 🔴 **낱말로 세면 주석만 있어도 «닫힘»이 된다**(AC-59).
     종전 `/연결글|threadChain|reply_to/` 는 «연결글은 아직 없다»라고 **적어 두기만 해도** 통과했다.
     이 칸이 묻는 건 두 가지고, 둘 다 **동작**이다:
       ① 나눈 조각을 **정말 이어 올리나**(`reply_to_id` 를 넘기나) — 안 넘기면 서로 모르는 낱개 글이 된다(AC-73)
       ② 그 루프를 **제품이 부르나**(`runThreadChain`) — 만들어만 두면 종전 경로가 그대로 돈다(AC-69) */
  ["B5 쓰레드 연결글", () => {
    const chains = inFile("lib/publish/threads.ts", /reply_to_id/);
    const wired = inFile("lib/publish/threads.ts", /runThreadChain\s*\(/);
    const splits = inFile("lib/publish/thread-chain.ts", /export function splitThreadChain/);
    return [yes(chains && wired && splits),
      chains && wired && splits ? "나누기 + reply_to_id 로 이어 올리기 + 커넥터가 부른다"
        : `빠진 것: ${[!splits && "나누기", !chains && "reply_to_id", !wired && "커넥터 배선"].filter(Boolean).join(" · ")}`];
  }],
  ["B6 블로거·WP AEO 규격", () => {
    /* 🔴 낱말 «AEO» 는 계약의 visual 라벨(«FAQ(AEO)»)에도 있다 — 그건 **규격 구현이 아니다**(대용물 · AC-57).
       🔴 [2026-09-16 · C 자체검사] 옛 판은 `seo.ts` 에서 `/faqPage|FAQPage|question/i` 를 찾았는데 **유일한 매치가 주석**이었다:
          «**FAQPage JSON-LD — 안 만든다**»(구글이 2025-05-08 지원 중단). 즉 «안 만든다»고 정직하게 적어 둔 그 문장이
          «만든다»로 세어졌다 — B2 가 B5 에서 찾은 병과 **똑같다**(`verify-audit-selftest.mjs` 가 잡았다).
          🔴 정직하게 적을수록 초록이 되는 검사는 최악이다. ⇒ **살아 있는 규격**(Article JSON-LD)을 **발행이 부르나**로 잰다.
          FAQPage·HowTo 는 «아직 안 한 것»이 아니라 **«하지 않기로 한 것»**이라 잣대가 아니다. */
    const impl = inFile("lib/publish/seo.ts", /export function articleJsonLdScript/);
    const callers = ["lib/publish/blogger.ts", "lib/publish/wordpress.ts"].filter((p) => inFile(p, /articleJsonLdScript\(/));
    const extra = inFile("lib/publish/wordpress.ts", /excerptOf\(/) && inFile("lib/publish/wordpress.ts", /slugOf\(/);
    return [impl && callers.length === 2 ? "닫힘" : impl ? "🟠 일부" : "열림",
      impl && callers.length === 2
        ? `seo.ts articleJsonLdScript 를 **발행이 부른다**(${callers.join(",")})${extra ? " + WP 는 excerpt·slug 도 보낸다" : ""} · FAQPage·HowTo 는 일부러 안 만든다(구글 지원 중단)`
        : `구현 ${impl} · 부르는 곳 ${callers.length}/2 — 만들어 놓고 안 부르면 닫힌 게 아니다(AC-69)`];
  }],
  /* 🔴 [2026-09-16 메인 · B2 가 원문을 찾아왔다] 옛 판은 `lib/writing-contracts.ts` 의 `editorElements` 를 봤다 —
     **그 이름은 이 저장소 어디에도 없다**(이 검사 줄 자신이 유일한 등장이었다). 한 번도 만든 적 없는 이름을 찾고 있었다.
     원래 감사가 물은 것은 `docs/active/2026-09-15-DESIGN-AUDIT.md:867` 에 있다:
       «§5C.3 에디터 실제 요소 변환 — blocks.ts:87 ad-slot 은 있으나 **SE ONE 인용구·구분선 모듈 grep 0**»
     ⇒ 계약층(`writing-contracts.ts`)은 «어떤 블록을 쓸까»를 정할 뿐이고 **버튼을 누르는 건 러너**다.
        그 파일엔 영영 안 생긴다 — **자가 엉뚱한 층을 보고 있었다.**
     ⇒ 넷을 다 본다(전부 «끊기면 빨개지는 것» · 🔴 메인이 변이로 넷 다 확인했다).
       ①계획: 못 세운 블록을 `no_editor_op` 로 적나(plan.mjs:236)
       ②셀렉터: 🔴 **감사가 «grep 0»이라 적었던 바로 그 둘**(naver-blog.mjs:161·166)
       ③🔴 **부르는 곳**: 정의만 있으면 안 닫힌 것이다(AC-69 · :717·:737)
       ④폴백을 **센다**: 조용한 폴백 금지(:719·:742)
     ⚠️ 티스토리는 주 경로가 HTML 모드라 `<blockquote>`·`<hr>` 진짜 요소로 더 세다.
        폴백(평문)은 세기는 하는데 **그 사실이 고객에게 안 닿는다** — 그건 B7 이 아니라 별도 칸이다(B2 제기). */
  ["B7 에디터 실제 요소", () => {
    const plan = inFile("runner/lib/plan.mjs", /no_editor_op/);
    const sel = inFile("runner/channels/naver-blog.mjs", /se-insert-quotation-default-toolbar-button/)
             && inFile("runner/channels/naver-blog.mjs", /se-insert-horizontal-line-default-toolbar-button/);
    const call = inFile("runner/channels/naver-blog.mjs", /clickToolbarItem[(]ctx, "quotation"[)]/)
              && inFile("runner/channels/naver-blog.mjs", /clickToolbarItem[(]ctx, "horizontalLine"[)]/);
    const count = inFile("runner/channels/naver-blog.mjs", /missed[.]quote[+][+]/)
               && inFile("runner/channels/naver-blog.mjs", /missed[.]divider[+][+]/);
    return [plan && sel && call && count ? "닫힘" : "열림",
      plan && sel && call && count
        ? "블록 19종 → 에디터 op(plan.mjs) · SE ONE **인용구·구분선 버튼을 실제로 누른다**(naver-blog.mjs) · 못 세운 것은 no_editor_op / 폴백은 missed 로 **센다**"
        : `계획 ${plan} · 셀렉터 ${sel} · **부르는 곳 ${call}** · 폴백 계수 ${count}`];
  }],
  /* 🔴 [2026-09-16 B-1] 설명줄이 판정을 안 따라가 «닫힘 … 0건» 이라는 모순을 찍고 있었다(B9 와 같은 뿌리).
     하니스가 거짓말하면 다음 조사가 그걸 믿는다. */
  ["B8 목표 매체 채널 선택", () => { const on = inFile("lib/director.ts", /targetChannel|목표 매체/);
    return [yes(on), on ? "director.propose 가 targetChannelOrder 로 순서를 정하고 channelReason 을 남긴다" : "0건"]; }],
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
    /* 🔴 `readCode` 로 읽는다 — 날것으로 읽으면 «다음 라운드에 만든다» 같은 **계획 주석**이 «있다»가 된다(b-49 실측). */
    const SC = ["public/js/ui.js", "public/app/home.html", "public/app/create.html", "public/app/settings.html", "public/app/revenue.html"].map(readCode).join("\n");
    const items = [
      ["당겨서 새로고침", /당겨서 새로고침|pullToRefresh/],
      ["햅틱", /햅틱|vibrate\(/],
      ["소재 스와이프", /swipe|스와이프/],
    ];
    /* 🔴 [2026-09-16 · C] **둘은 낱말로 재면 안 되는 항목이라 여기서 뺐다** — 둘 다 «대용물»이었다(AC-70):
         · **대비 4.5:1** — 옛 판은 소스에서 `/4\.5:1|contrastRatio/` 를 찾았다. 주석에 «4.5:1»이라고 적어 두기만 해도 통과한다.
           **색이 실제로 그런지는 한 번도 안 쟀다.** 진짜로 재던 것은 scratchpad 의 shot.mjs 였는데 **저장소 밖이라 지금 없다**
           (`public/css/ac.css:9` 가 그렇게 적어 뒀다) — 그래서 «21건 미달»도 «그 뒤 전부 통과»도 다시 재 볼 수 없었다.
           ⇒ `scripts/verify-contrast.mjs` 가 ac.css 토큰을 읽어 WCAG 로 **직접 계산**한다(짝 32개 · 지금 미달 0).
         · **기기 시간대** — 옛 판은 `/deviceTz|resolvedOptions\(\)\.timeZone/` 를 찾아 «없다 ⇒ 미개발»로 셌다.
           🔴 **우리 규약은 정반대다**: 화면은 Asia/Seoul 을 고정하므로 그 낱말이 **있으면 오히려 냄새**다.
           그리고 설계(`docs/DESIGN.md:1134`)는 이걸 기능이 아니라 «**검증 항목(C)**»으로 적어 뒀다 — 만들 게 아니라 **돌려 볼 것**이다.
           ⇒ `scripts/verify-kst-surface.mjs` 가 프로세스를 UTC·America/New_York·Pacific/Kiritimati 로 **진짜 띄워** 같은 글자가 나오는지 잰다.
       ⇒ 이 묶음은 **4칸**만 낱말로 세고, 나머지 2칸은 그 하니스 **파일이 있나**로 센다(있으면 머지마다 돈다 · 없으면 열림). */
    const realHarness = [
      ["대비 4.5:1(실측)", "scripts/verify-contrast.mjs"],
      ["기기 시간대(실행)", "scripts/verify-kst-surface.mjs"],
    ];
    /* 🔴 [2026-09-16 · C · 메인 C1-⑤] **«계좌연결 패턴»은 두 겹으로 틀리게 재고 있었다.**
       ①파일이 틀렸다 — 이 묶음은 다섯 파일만 읽는데 계정 연결 화면은 `public/app/accounts.html` 이다(AC-82).
       ②낱말이 틀렸다 — «계좌 연결»은 **토스 패턴의 이름**이고(`docs/DESIGN.md:1024`), 우리 화면은 «계정 연결»이라 써야 맞다.
         우리가 붙이는 건 은행 계좌가 아니다. 그 낱말을 화면에서 찾으면 **제대로 만들수록 못 찾는다.**
       ⇒ 이름이 아니라 **패턴의 모양**을 잰다(DESIGN §13.0b 의 «구체 형태» 그대로):
         채널 마크 그리드 · 연결 수 표기 · 눌러서 채널별 연결 · 끝나면 완료를 말해 준다. */
    const A = readCode("public/app/accounts.html");   // 🔴 날것 금지 — 위와 같은 까닭
    const acc = [/UI\.mark\(/.test(A), /개 연결됨/.test(A), /연결 시트|openConnect|data-k=/.test(A), /connected/.test(A)]
      .filter(Boolean).length >= 3;
    const shape = [["계좌연결 패턴(모양)", acc]];
    const got = [...items.filter(([, re]) => re.test(SC)).map(([n]) => n),
      ...shape.filter(([, ok]) => ok).map(([n]) => n),
      ...realHarness.filter(([, p]) => existsSync(p)).map(([n]) => n)];
    const miss = [...items.filter(([, re]) => !re.test(SC)).map(([n]) => n),
      ...shape.filter(([, ok]) => !ok).map(([n]) => n),
      ...realHarness.filter(([, p]) => !existsSync(p)).map(([n]) => n)];
    return [got.length === 6 ? "닫힘" : got.length ? "🟠 일부" : "열림",
      `있는 것 ${got.length}/6 [${got.join(",")}] · 없는 것 [${miss.join(",")}]`, [got.length, 0, miss.length]];
  }],
  ["E1 AI 원가 provider 분해", () => {
    /* 🔴 [2026-09-16 · C] 옛 판은 `ops-ai.ts` 를 봤는데 실물은 **`ops-dashboard.ts:148`** 에 있다(파일을 잘못 지목 · AC-75).
       그런데 **운영 화면이 그 값을 한 번도 안 읽는다** — CLAUDE §4.8 «서버만 있고 화면이 없으면 닫힌 게 아니다». ⇒ 일부.
       🔴 이건 «가짜 열림»을 고치다가 **«가짜 닫힘»으로 넘어가지 않게** 세운 자리다(메인이 물은 반대 방향). */
    const srv = inFile("netlify/functions/ops-dashboard.ts", /byProvider/);
    const ui = ["public/ops/index.html", "public/ops/ai.html"].filter((p) => inFile(p, /byProvider/)).length > 0;
    return [srv && ui ? "닫힘" : srv ? "🟠 일부" : "열림",
      srv && ui ? "ops-dashboard.ts:148 + 운영 화면이 그린다"
        : srv ? "서버는 낸다(ops-dashboard.ts:148 · 호출 수 기준) · 🔴 **운영 화면이 안 읽는다** — 만들어 놓고 아무도 안 본다(AC-69)"
          : "0건"];
  }],
  ["E2 추천인 이벤트", () => {
    /* 🔴 [2026-09-16 · C 자체검사] 옛 판은 `/활성인 추천 이벤트/` — **한국어 주석 문장**이었다(referral.ts:106 의 JSDoc).
       주석을 지우면 이 칸이 열림으로 뒤집혔다. 코드가 아니라 글자를 세고 있었다는 뜻이다.
       ⇒ 실제로 **이벤트 표를 읽어 코인 수를 정하는 호출**을 잰다. 그리고 그 값을 **쓰는 자리**까지 본다(AC-69). */
    const reads = inFile("lib/referral.ts", /activePromotions\(\s*"referral"\s*\)/);
    const used = inFile("lib/referral.ts", /referralRewardCoins\(/);
    return [reads && used ? "닫힘" : reads ? "🟠 일부" : "열림",
      reads && used ? "referral.ts:109 activePromotions(\"referral\") 로 이벤트 표를 읽고 referralRewardCoins() 를 쓴다(없으면 0)"
        : `이벤트 표를 읽나 ${reads} · 그 값을 쓰나 ${used}`];
  }],
  ["E3 티켓 한 화면", () => [yes(alive("public/ops/cs.html")), "public/ops/cs.html"]],   /* 🔴 존재만 보면 **빈 파일도 «있다»** 가 된다(AC-217) */
  ["E4 AM↔AC 코인 이전", () => [yes(inFile("netlify/functions/coin-transfer.ts", /amDebit/)), "coin-transfer → am-bridge amDebit (칸12 에서 이리로 옮김)"]],
  /* 🔴 [2026-09-16 · B] 보는 자리를 고쳤다 — 원래 `lib/am-bridge.ts`(AM↔AC 코인 다리)를 보고 있었는데 **거기가 아니다.**
     정본 동기화는 «DB 오버레이를 `lib/ai-models.ts` 로 되돌리는 PR»이라 그 코드는 `lib/ai-models-sync.ts` 에 산다.
     🔴 **검사를 맞추려고 코드를 엉뚱한 파일에 넣지 않는다** — 그러면 검사는 초록인데 물건은 남의 집에 있다. */
  ["E5 정본 동기화 PR", () => [yes(anyFile(["lib/ai-models-sync.ts", "netlify/functions/ops-ai-sync.ts"], /openSyncPr|정본 동기화/).length), "오버레이가 파일과 갈라진 채 굳으면 «파일이 정본»이 거짓말이 된다"]],
  /* 🔴 [2026-09-16 메인 · b-49 가 잡았다] 옛 판은 `existsSync("netlify/functions/ops-center.ts")` **파일 이름 하나**로 셌다.
     그런데 그 파일이 서비스하는 경로는 **`/api/ops-audit`** 이고(`:12`), 화면이 부르는 엔드포인트 어디에도 `ops-center` 가 없다.
     **이름만 맞는 파일이 있어서 초록**이었다(AC-70). 기능은 실제로 **다른 곳**에 다 있다:
       ①서버 `netlify/functions/ops-tenants.ts` 가 `/api/ops-impersonate`·`-end` 를 서비스
       ②운영 화면 `public/ops/tenant.html` 의 `#imp` 가 부른다(정본은 `public/ops/_tpl.txt`)
       ③🔴 고객 화면 `public/js/ui.js` 가 «운영자가 보고 있어요» 배너를 그린다(`impBanner`)
     ⇒ 셋을 다 본다. 하나라도 끊기면 빨개진다 — **화면 축까지 재는 칸**이다. */
  ["E6 운영자 화면 조정", () => {
    const srv = inFile("netlify/functions/ops-tenants.ts", /ops-impersonate/);
    const ops = inFile("public/ops/tenant.html", /ops-impersonate/);
    const cust = inFile("public/js/ui.js", /impBanner/);
    return srv && ops && cust
      ? ["닫힘", "ops-tenants.ts 가 /api/ops-impersonate 를 열고 · ops/tenant.html 이 부르고 · ui.js 가 «운영자가 보고 있어요» 배너를 그린다"]
      : ["🟠 일부", `서버 ${srv} 운영화면 ${ops} 고객배너 ${cust}`];
  }],
  ["F 팀 축 4(시트·초대·accept·팀 승인)", () => {
    /* 🔴 [2026-09-16 · C] 옛 판은 `SERVER_TEXT`(= referral.ts·ops-center.ts·cs.ts 셋)에서 팀을 찾았다 — **팀과 아무 상관없는 파일 셋**이라
       lib/team.ts·netlify/functions/team.ts·public/app/team.html 이 다 생긴 뒤에도 «전수 0건»을 찍었다(**가짜 열림 4칸**).
       ⇒ 파일을 지목한다. 그리고 네 칸을 **각각** 잰다 — 뭉치면 «일부»가 부풀고 닫힘·열림이 둘 다 과소평가된다. */
    const sheet = existsSync("public/app/team.html") && inFile("public/app/team.html", /\/api\/team/);
    const invite = inFile("netlify/functions/team.ts", /team-invite/) && inFile("lib/team.ts", /invite/i);
    const accept = existsSync("public/app/team-accept.html") && inFile("netlify/functions/team.ts", /team-accept/);
    /* 팀 승인은 «크론이 실제로 건너뛰나»까지 본다 — 정의만 있으면 안 닫힌 것이다(AC-69). 두 겹을 다 지목한다. */
    const approval = inFile("lib/content-approve.ts", /step:\s*"team_approval"/)
      && inFile("lib/cron/review-deadline.ts", /needsOwnerApproval\(/)
      && inFile("lib/cron/review-deadline.ts", /"team_approval"/);
    const n = [sheet, invite, accept, approval].filter(Boolean).length;
    return [n === 4 ? "닫힘" : n ? "🟠 일부" : "열림",
      `시트 ${sheet} · 초대 ${invite} · accept ${accept} · 팀승인 ${approval}(크론 두 겹) = ${n}/4`, [n, 0, 4 - n]];
  }],
  ["H1 카드뉴스 kind", () => [yes(inFile("lib/slots.ts", /cardnews/)), "verify-cardnews PASS 20"]],
  ["H3 상태 16종", () => [yes(inFile("public/js/ui.js", /UI\.SLOT_STATUS/)), "UI.SLOT_STATUS 17종"]],
  /* 🔴 [메인 2026-09-16] **안 만들기로 결정한 항목**이다(DESIGN §8.1 · 사유 `docs/active/2026-09-15-runner-tray-decision.md`).
     AC-75 가 적은 그대로 — «**없는 항목을 미개발로 세는 것도 거짓말이다**». 진척률이 실제보다 낮게 나오고,
     아무도 안 만들 일을 다음 라운드가 계속 떠안는다. ⇒ «열림»이 아니라 **분모에서 뺀다**(아래 DROPPED).
     🔴 되살아나면(=누가 트레이를 만들면) 설계와 어긋난 것이니 **빨갛게** 잡는다. */
  ["I 러너 트레이 앱 2 — **안 만들기로 결정**", () => [existsSync("runner/tray.mjs") || existsSync("runner/tray") ? "열림" : "제외",
    "DESIGN §8.1 · 자동 시작 옵트인으로 대체(재부팅 복귀만 진짜 문제였다) · 자기 PC 러너 실고객 0명", null]],
];
for (const [name, fn] of THREE_REST) {
  let out = fn();
  if (out === "AC1_HEADER") {
    /* lib/*.ts 중 **출처 헤더가 아예 없는** 파일 수 — 있는 채로 남으면 다음 사람이 출처를 못 따라간다(AC-1).

       🔴 [2026-09-16 · b-49] **«앞 12행»은 대용물이었다 — 자를 «헤더 주석 구역»으로 바꾼다.**
         관례(CLAUDE §2)는 «헤더 주석에 적는다»지 «앞 12행에 적는다»가 아니다. 그런데 이 저장소의 실제 관례는
         🔴 **출처를 헤더 블록 «끝»에 적는 것**이고 헤더 구역은 평균 15행이다 — 12행 창은 그 끝을 못 본다.
         그래서 «없다»고 세던 14개가 **전부 이미 적혀 있었다**(진짜 없는 것 0개).
         AC-97(«낱말로 세는 검사는 있는데 못 본다도 만든다»)의 두 번째 얼굴이고, 그 헛수는 사람에게
         **없는 출처를 지어내라고 시킨다** — 제일 나쁜 결과다(실제로 내가 format-pick.ts 에 한 줄을 겹쳐 적었다).
       🔴 느슨해진 것이 아니다: **코드가 처음 나오는 줄에서 멈춘다.** 본문 깊숙이 «출처»라고 적어도 안 세어진다.
         `//` 머리줄(AM 복사본 관례 · ai-models·response·billing-math·sso-role)과 블록 주석을 **둘 다** 잡는다.
         바꾸기 전후를 lib/*.ts 93개 전수로 견줬다: **통과→실패 0개** · 실패→통과 14개 · 남는 것 0개. */
    const { readdirSync } = await import("node:fs");
    const files = readdirSync("lib").filter((f) => f.endsWith(".ts"));
    /** 파일 맨 앞 **주석 구역**(코드가 시작되면 끝). */
    const headerOf = (text) => {
      const out = []; let inBlock = false;
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (inBlock) { out.push(line); if (t.includes("*/")) inBlock = false; continue; }
        if (t === "") { out.push(line); continue; }
        if (t.startsWith("//")) { out.push(line); continue; }
        if (t.startsWith("/*")) { out.push(line); if (!t.includes("*/")) inBlock = true; continue; }
        break;                                   // 🔴 코드다 — 여기서 멈춘다
      }
      return out.join("\n");
    };
    const missing = files.filter((f) => !/AM 원본|AC 신규|출처/.test(headerOf(read(`lib/${f}`))));
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
  let C = 0, P = 0, O = 0, D = 0;
  for (const r of results) {
    const w = r.w ?? 1;
    if (r.split) { C += r.split[0]; P += r.split[1]; O += r.split[2]; continue; }
    if (r.state === "제외") { D += w; continue; }   // 🔴 «안 만들기로 결정» 은 분모 밖이다(AC-75)
    if (r.state === "닫힘") C += w; else if (String(r.state).startsWith("🟠")) P += w; else O += w;
  }
  const T = C + P + O;
  console.log(`
■ **${T}칸 중 닫힘 ${C} · 일부 ${P} · 열림 ${O} (${Math.round((C / T) * 100)}%)**  ← 사장님 보고용 한 줄` +
    (D ? `
   (분모 = ③54 + ④13 = 67 중 **안 만들기로 결정한 ${D}칸을 뺐다** — 없는 항목을 미개발로 세면 그것도 거짓말이다 · AC-75)` : "  (분모 = ③54 + ④13)"));

/* 🔴 표가 칸을 못 따라가면 **큰 소리로** 말한다 — 조용히 빠지는 것이 이 표의 유일한 실패다. */
const _axisHits = new Map(SCREEN_AXIS.map(([k]) => [k, 0]));
const _unmatched = [], _doubled = [];
for (const r of results) {
  const hits = SCREEN_AXIS.filter(([k]) => r.row.includes(k));
  hits.forEach(([k]) => _axisHits.set(k, _axisHits.get(k) + 1));
  if (hits.length === 0) _unmatched.push(r.row);
  if (hits.length > 1) _doubled.push(`${r.row} → ${hits.map(([k]) => k).join(" / ")}`);
}
const _deadKeys = [..._axisHits].filter(([, n]) => n === 0).map(([k]) => k);
const _orphan = results.filter((r) => readsScreenOf(r.row) === null);
if (_unmatched.length) console.log(`🔴 화면 축 표에 **없는 칸 ${_unmatched.length}개** — 새 칸이 생겼으면 SCREEN_AXIS 에 한 줄 더해라: ${_unmatched.join(" · ")}`);
if (_doubled.length)   console.log(`🔴 화면 축 표에 **두 번 걸리는 칸 ${_doubled.length}개** — 조각이 너무 짧다: ${_doubled.join(" · ")}`);
if (_deadKeys.length)  console.log(`🔴 화면 축 표에 **아무 칸도 안 가리키는 조각 ${_deadKeys.length}개** — 칸 이름이 바뀌었다: ${_deadKeys.join(" · ")}`);
if (_orphan.length)    console.log(`🔴 «화면을 보나»를 **못 잰 칸 ${_orphan.length}개** — 칸 선언 모양이 바뀌었다(위 _rowStarts 정규식): ${_orphan.map((r) => r.row).join(" · ")}`);
const _blind = results.filter((r) => ["고객", "운영"].includes(axisOf(r.row)) && readsScreenOf(r.row) === false && r.state === "닫힘");
console.log(`   닫힘 가운데 ${_blind.length}칸은 «서버에 있다»까지만 보고 셌어요 — 화면에 실제로 보이는지는 이 숫자가 말해 주지 않아요.`);
console.log(`   (어느 칸인지·왜 그런지는 docs/active/2026-09-16-audit-measure-review.md §8·§12)`);

}

/* ═══ 🔴 **이 자는 «점수판»이라 늘 0 으로 끝난다 — 그래서 «내가 읽기는 했나»를 스스로 말한다**(2026-09-22 C · AC-217) ═══
   `verify-experiment-holds` 로 재 보니, **제품을 통째로 비운 나무에서도** 이 자는 종료코드 0 이었다.
   칸을 고쳐 «닫힘»이 안 나오게 해도, **점수판이 늘 0 이면 «이 자가 돌았다»와 «이 자가 아무것도 못 봤다»가 같은 글자**다.
   ⇒ 실제로 **읽은 제품 파일 수**를 세고, 너무 적으면 **종료코드 2(못 쟀음)** 로 멈춘다. 초록으로 뭉개지 않는다(AC-9·AC-141 ②). */
{
  const PROBE = ["lib/channel-registry.ts", "lib/publish/contract.ts", "public/js/ui.js", "db/schema.ts", "netlify/functions/pieces.ts"];
  const aliveN = PROBE.filter((p2) => { try { return readCode(p2).trim().length > 0; } catch { return false; } }).length;
  /* 🔴 **stdout 은 이 자의 것이 아니다 — 남이 먹는다.**
     `--json` 이면 `:593` 이 stdout 에 **JSON 한 덩이**를 뱉고, `scripts/verify-audit-selftest.mjs:29` 가
     그걸 그대로 `JSON.parse` 한다. 내가 여기 사람말을 `console.log` 로 찍었더니 **JSON 뒤에 붙어 파싱이 죽었다**
     (2026-09-22 · 배포 직전 전수 검사가 잡았다 · position 9187).
     🔴 오늘 종일 잡던 그 병의 다른 얼굴이다 — **«내 자리»라고 생각한 곳이 남의 입구였다.**
     ⇒ 사람말은 **stderr** 로 보낸다(기계가 먹는 것은 stdout 뿐이다). 판정은 `--json` 에서도 그대로 산다. */
  console.error(`   ■ 내가 읽은 제품 파일: 표본 ${PROBE.length}개 중 **${aliveN}개**가 살아 있다`);
  if (aliveN < 2) {
    console.error(`⊘ 못 쟀어요 — 표본 ${PROBE.length}개 중 ${aliveN}개만 읽혔다. 제품을 못 보고 낸 점수판은 점수가 아니다.`);
    process.exit(2);
  }
}
process.exit(0);
