// scripts/verify-r8-deadends.mjs — 🔴 **«정의는 있는데 부르는 자리가 없는 것»을 한꺼번에 센다**(C · R8 · AC-69/AC-29).
//   사용: node scripts/verify-r8-deadends.mjs [--json]
//
//   왜: 2026-09-15 하루에만 **다섯 번** 나왔다 — `post_alive` 적재 0 · `learn.ts` · `ads.*` · `coinCostOverlay` · `blocksCharCount`.
//       그리고 순수 함수 하니스는 이걸 **절대 못 잡는다**: 함수 자체는 맞게 동작하므로 14/14 초록이 나온다.
//       «있나»를 **«정의가 있나»가 아니라 «호출이 있나»로** 세야 한다(R8 계약 §7 · 메인 지시).
//
//   세는 법(정직하게):
//     · 제품 호출 = `lib/**`·`netlify/functions/**`·`runner/**`·`public/**` 에서 **자기 파일을 뺀** 등장 횟수
//     · 🔴 `scripts/**`(하니스)는 **호출로 세지 않는다** — 검사가 자기를 부르는 건 «쓰인다»가 아니다
//     · 🔴 `docs/**` 도 세지 않는다 — 문서에 적혀 있는 것은 «한다»가 아니다(AC-59)
//     · import 줄만 있고 실제 호출이 없으면 **«임포트만»** 으로 따로 적는다(그것도 죽은 통로다)
import { readFileSync, readdirSync, statSync } from "node:fs";

const JSON_OUT = process.argv.includes("--json");
const results = [];
const rec = (step, ok, note = "") => { results.push({ step, ok: ok === "WARN" ? "WARN" : !!ok, note }); };
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const walk = (dir, exts, out = []) => {
  let e = []; try { e = readdirSync(dir); } catch { return out; }
  for (const f of e) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = `${dir}/${f}`;
    if (statSync(p).isDirectory()) walk(p, exts, out); else if (exts.some((x) => f.endsWith(x))) out.push(p);
  }
  return out;
};

/** 제품 파일 전부(하니스·문서 제외). */
const PRODUCT = [
  ...walk("lib", [".ts", ".mts"]),
  ...walk("netlify/functions", [".ts", ".mts"]),
  ...walk("runner", [".mjs", ".js"]),
  ...walk("public", [".js", ".html"]),
].filter((p) => !/[/]js[/]mock/.test(p));   /* 🔴 [2026-09-16 메인 · b-49] **모의 층은 제품이 아니다.**
   예전엔 SCREENS 에서만 뺐고 PRODUCT·CODE 에선 **안 뺐다** — 한쪽만 뺀 것이라
   «모의에만 키를 적어도 바깥 호출처로 세어지는» 구멍이 남아 12줄의 수를 부풀리고 있었다.
   b-49 가 전수로 쟀다: 빼도 **빨개지는 줄 0개**(수만 준다). */
const SRC = new Map(PRODUCT.map((p) => [p, read(p)]));
/** 주석을 걷어 낸 본문 — «주석에만 적혀 있는 호출»을 호출로 세지 않기 위해(AC-59). */
const CODE = new Map([...SRC].map(([p, t]) => [p, t
  .replace(/[/][*][\s\S]*?[*][/]/g, " ")
  .replace(/(^|[^:])[/][/].*/g, "$1 ")
  .replace(/<!--[\s\S]*?-->/g, " ")]));
/* 🔴 [2026-09-16 메인 · b-49 가 잡았다] **HTML 주석(<!-- -->)을 안 걷고 있었다.** 표본이 전부 `.ts` 였던 탓이다 —
   실례: `public/app/settings.html` 의 HTML 주석 한 줄이 `targetChannelOrder` 의 «바깥 호출처»로 세어졌다.
   🔴 **표본에 없는 고장은 변이로도 안 보인다**(AC-99 ⑨ · b-49 가 자기 §1 을 스스로 되돌리며 찾았다).
   ⚠️ `//` 쪽은 `.` 이 줄바꿈을 원래 안 먹으므로 **역슬래시 없이** 쓴다(AC-100 — 이 셸이 역슬래시를 한 겹 먹는다). */

/* ═══ [R11-13 ③ · C 2026-09-17] 🔴 **문자열 리터럴도 걷은 본문** — b-49 §8-3 ═══
   b-49 가 셈법을 찔러 보이고 갔다: 이 자는 «부른다»가 아니라 **«그 낱말이 어딘가에 있다»**를 센다.
   주석만 빼고 전부 센다 — **문자열 · 주소 · 남의 지역 변수 · 같은 이름의 다른 함수 · 객체 속성 · 타입 자리.**
   그중 **문자열**이 제일 나쁘다: AI 프롬프트의 영어 산문(«when a **place** is implied») · 인라인 CSS(`place-items`) ·
   타입 union 안의 다른 뜻 문자열이 전부 «호출»로 세어졌다. `place` 는 **진짜 소비처를 다 가려도 바깥 12곳으로 초록**이었다.

   ⇒ 식별자 심볼은 **문자열을 걷은 본문**으로 센다. 템플릿 리터럴은 `${…}` **안이 코드**라 그 부분만 남긴다.
   🔴 **두 가지는 일부러 안 건드린다(b-49 의 경고 그대로):**
     ① `SURFACES`(화면이 부르나)는 **일부러 `/api/…` 문자열을 찾는 자리**다 — 거기서 문자열을 걷으면 축이 통째로 죽는다.
        **두 셈법을 가른 채로 둔다.**
     ② 🔴 **식별자가 아닌 심볼**(잡 kind `reference.capture` · 타입 조각 `place?: { name`)은 **원래 문자열 안에 산다.**
        걷으면 진짜 배선을 «산문»으로 오판한다 — 2026-09-17 C 가 자기 meter 에서 **거짓 빨강 1건**으로 먼저 밟았다. */
const isIdent = (s) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
const CODE_NS = new Map([...CODE].map(([p, t]) => [p, t
  .replace(/`(?:[^`\\]|\\.)*`/g, (m) => (m.match(/[$][{][^}]*[}]/g) || []).join(" "))
  .replace(/"(?:[^"\\\n]|\\.)*"/g, " ")
  .replace(/'(?:[^'\\\n]|\\.)*'/g, " ")]));

/**
 * 이름 하나의 제품 호출처를 센다.
 *   🔴 [2026-09-15 C 수리] 첫 판은 **정의 파일을 통째로 뺐다.** 그래서 «자기 파일 안에서 불리는» 함수가
 *      «제품 호출 0곳» 이라는 **가짜 빨강**으로 나왔다(`channelSpec`·`classifyFpBinding` — 둘 다 자기 파일이 쓴다).
 *      죽은 통로의 뜻은 «아무도 안 부른다» 이지 «남의 파일이 안 부른다» 가 아니다.
 *   ⇒ 정의 파일도 센다. 다만 **정의 줄 자체**(`export function X` · `const X =` · `type X`)는 호출이 아니라서 뺀다.
 */
function callSites(name, ownerFile, maps = null) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${esc}\\b`);
  const defRe = new RegExp(`^\\s*(export\\s+)?(async\\s+)?(function|const|let|var|type|interface|class)\\s+${esc}\\b`);
  const hits = [];
  let importOnly = 0, own = 0;
  for (const [p, code] of (maps || (isIdent(name) ? CODE_NS : CODE))) {
    const lines = code.split("\n").filter((l) => re.test(l));
    if (!lines.length) continue;
    const real = lines.filter((l) => !/^\s*import\b/.test(l) && !/^\s*export\s+\{/.test(l) && !/^\s*}\s*from\s+/.test(l) && !defRe.test(l));
    if (!real.length) { importOnly++; continue; }
    if (p === ownerFile) own += real.length; else hits.push(`${p}(${real.length})`);
  }
  return { hits, importOnly, own };
}

/* ═══ R8 에서 새로 생긴 것들 — «만들었다»고 보고된 물건의 목록 ═══
   각 항목: [사람이 읽는 이름, 심볼, 정의 파일, 이게 죽으면 무슨 일이 나나] */
const TARGETS = [
  ["간격 정책(사장님 «10:00/10:05»)", "gapMinFor", "lib/publish-gap.ts", "편성이 옛 상수 30분을 계속 써서 계정을 붙여 올릴 수 없다"],
  ["간격 정책 — 고객이 내릴 수 있는 바닥", "floorMin", "lib/publish-gap.ts", "«5분까지 내릴 수 있다»가 화면에 영영 안 닿는다", "external"],
  ["채널 «성질» 정본", "channelSpec", "lib/channel-registry.ts", "채널마다 다른 성질을 각자 추측해서 또 갈라진다"],
  ["내려 주기 — 할 수 있나", "canRetract", "lib/channel-registry.ts", "«내릴 수 있다»를 아무도 안 물어 유튜브가 조용히 열린다"],
  ["내려 주기 — 실제 수행", "retractPost", "lib/publish/retract.ts", "«내려 줘» 단추가 아무것도 안 한다"],
  ["코인 단가 정본", "coinCostOf", "lib/coin-table.ts", "운영자가 고친 코인 값이 아무 데도 안 닿는다"],
  ["본문 글자 수", "blocksCharCount", "lib/blocks.ts", "분량 판정이 대용물(태그 길이)로 흐른다", "external"],
  ["러너 지문 구속", "classifyFpBinding", "lib/runner-jobs.ts", "훔친 토큰이 다른 PC 에서 그대로 통한다"],
  ["스톡 사진 찾기(§10 사진값)", "searchStock", "lib/stock/index.ts", "사진이 전부 AI 로만 만들어져 편당 원가의 85%가 그대로 남는다"],
  ["스톡 사진 붙이기(§10 사진값)", "attachStockPhoto", "lib/stock/attach.ts", "찾기만 되고 글에 못 붙여 «고를 수는 있는데 쓸 수는 없는» 기능이 된다"],
  /* [2026-09-16 메인] 🔴 A 가 «크레딧 함수를 부르는 곳이 0» 을 잡았다 — 하니스가 못 봤던 자리라 여기에 박는다.
     스톡 약관이 작가·출처 표기를 요구하고, 그게 빠지면 **키가 죽어 스톡이 통째로 멈춘다**(편당 원가 세 배). */
  ["스톡 사진 크레딧 — 본문에 넣어 준다", "ensurePhotoCreditHtml", "lib/publish/gate.ts", "스톡 작가·출처가 발행 본문에 안 실려 약관을 어기고 키가 죽는다"],
  ["스톡 사진 크레딧 — 줄을 만든다", "creditLines", "lib/photo-source.ts", "크레딧 문장을 만드는 기계가 하니스에서만 돌고 제품에서는 안 돈다"],
  ["카드뉴스 채널 판정(§2.5)", "isCardnewsChannel", "lib/writing-contracts.ts", "편성·코인·생성이 각자 «인스타면 카드뉴스»를 따로 적어 언젠가 갈라진다"],
  ["수치 주장 표시(§2.4)", "findNumericClaims", "lib/fact-claims.ts", "«근거 없는 수치 금지»가 프롬프트에만 있고 지키는지 아무도 안 재는 상태로 돌아간다"],
  ["수치 주장 문구(§2.4)", "claimsLine", "lib/fact-claims.ts", "검수 화면이 «확인해 주세요»를 제 문장으로 또 지어 서버와 갈린다", "external"],
  /* ── [R9+R10 · B 2026-09-16] 서식·유사도·등급·옷장 — «정의가 있나»가 아니라 «제품이 부르나»(계약 §4-3 · AC-69) ── */
  ["인라인 마크 검증(R9-1)", "validateMarks", "lib/blocks.ts", "모델이 낸 marks 가 검증 없이 렌더로 흘러 겹침·범위 밖 마크가 조용히 사라지거나 깨진다"],
  ["마크 렌더(R9-1)", "inlineMarked", "lib/blocks.ts", "marks 를 적어도 HTML 에 태그가 안 나와 «적기만 하고 아무도 안 그린다»가 된다"],
  ["채널 꾸밈 표(R9-4)", "formatCapsOf", "lib/channel-registry.ts", "표를 만들어 놓고 렌더·프롬프트·화면·러너 아무도 안 봐서 «못 내는 채널에 마크를 시킨다»"],
  ["모델에게 시킬 마크(R9-1)", "inlineMarksAllowed", "lib/channel-registry.ts", "채널 표가 있어도 프롬프트가 안 읽어 쓰레드에 형광펜을 시킨다"],
  ["마크 상한(R9-1)", "applyMarkBudget", "lib/format-marks.ts", "AM 실측 상한(value 12 · line 6)이 러너에만 있고 서버는 무제한으로 보낸다"],
  ["못 낸 서식 투영(R9-5)", "formatUnusedOf", "lib/format-marks.ts", "meta.formatMarks 가 쌓여도 검수 화면까지 길이 없어 «만들어 놓고 아무도 안 부른다»"],
  ["러너 서식 보고 합치기(R9-5)", "mergeRunnerFormatMarks", "lib/format-marks.ts", "러너가 강등을 보고해도 서버 planned 를 덮어쓰거나 append 안 되어 «발행 뒤 못 낸 것»이 사라진다"],
  ["계정 간 유사도(R9-8)", "crossAccountSimilarity", "lib/cross-account.ts", "IP 는 나눠 놓고 글 내용은 계정끼리 안 견줘 «같은 사람이 여러 계정» 판정을 못 막는다(위험도 1번)"],
  ["등급 코인 식(R10-7)", "coinsForAiImages", "lib/coin-table.ts", "«덜 구우면 덜 받는다»가 표에만 있고 정산·재차감이 옛 식으로 돈다"],
  ["등급별 골격(R10-8)", "applyQualityTier", "lib/writing-contracts.ts", "프리미엄이 사진 수만 다르고 글은 같아 «프리미엄»이 거짓말이 된다"],
  ["규칙 등급(R10-9)", "ruleTierOf", "lib/slots.ts", "편성표가 계정 등급을 안 읽어 프리미엄 계정에 «주 3코인»이라 말하고 9 를 뺀다"],
  ["정산 문장(R10-9)", "tierCoinsLine", "lib/coin-table.ts", "덜 받고 돌려준 걸 조용히 돌려줘서 고객이 모른다"],
  ["요금제 몇 편(R10-9)", "piecesByTier", "lib/coin-table.ts", "화면이 «150코인 → 몇 편»을 스스로 셈해 단가가 바뀌는 날 화면만 옛 셈으로 남는다"],
  ["스타일 소독기(R10-3)", "sanitizeTextStyleForStorage", "lib/text-style.ts", "저장 직전 소독이 안 돌아 남의 문장이 jsonb 에 남는다(저작권 게이트가 문 밖에 있는 상태)"],
  ["스타일 → 프롬프트(R10-4)", "textStylePromptLines", "lib/text-style.ts", "배운 스타일이 DB 에만 쌓이고 글에 한 줄도 안 닿는다(영상 refStyle 이 겪은 그것)"],
  ["스타일 → 골격(R10-4)", "applyTextStyleShape", "lib/text-style.ts", "배운 구성 요소(인용·표·결론 위치)가 프롬프트 문장으로만 가서 구조가 이긴다(AC-63)"],
  ["캡처 보고 처리(R10-2)", "handleReferenceCaptureReport", "lib/text-style-capture.ts", "러너가 찍어 보내도 서버가 안 받아 «찍었는데 아무 일도 안 난다»"],
  ["비전 읽기(R10-2)", "readTextStyleFromShots", "lib/text-style-read.ts", "캡처를 받아도 모델에 안 보내 스타일이 영영 안 생긴다"],
  ["옷장 저장(R10-4)", "createTextStyle", "lib/text-style-store.ts", "읽은 결과가 저장 한 곳을 안 지나 소독 없이 다른 길로 들어간다"],
  /* ── [R9R10 · C 2026-09-16] B 목록에 없던 다섯 — 러너 쪽 정의와 «고르기»·«잡 kind»(하나라도 안 불리면 «배웠는데/재 놓고 아무 데도 안 간다») ── */
  ["번짐 — 문단 경계에서 끊는다(R9-3)", "breakFormatBeforePara", "runner/lib/format-bleed.mjs", "세 겹 중 첫 겹이 안 불려 색이 다음 문단까지 간다(AM 네 번째 판)"],
  ["번짐 — 발행 직전 자가검사 판정(R9-3)", "bleedVerdict", "runner/lib/format-bleed.mjs", "재 놓고 판정을 안 물어 번진 글이 그대로 나간다"],
  ["캡처 — 자르기 계획(R10-1)", "planCaptureSlices", "runner/lib/capture-slice.mjs", "러너가 한 장으로 찍어 모델이 밑줄과 굵게를 구분 못 한다"],
  ["레퍼런스 — 이 글의 스타일을 고른다(R10-4)", "textStyleOf", "lib/text-style-store.ts", "계정에 걸어 둬도 생성이 안 읽어 «옷장»이 장식이 된다(§4.2 영상판과 같은 병)"],
  ["레퍼런스 — 러너가 찍는다(잡 kind · R10-1)", "reference.capture", "runner/core.mjs", "서버가 잡을 쌓아도 러너가 그 kind 를 안 받아 영영 queued 로 남는다"],
  ["원장 추천(R10-10)", "recommendTextStyle", "lib/text-style-store.ts", "되먹임 원장의 첫 실사용이 정의만 있고 화면에 «이 스타일이 반응이 좋았어요»가 영영 안 뜬다"],
  /* ── [P1R8 §3.3 · B2] 셀렉터 표(recipe) — 이 라운드에 통째로 새로 생긴 사슬이라 **양끝을 다 센다** ── */
  ["셀렉터 표 — 서버가 잡에 실어 준다", "recipeForRunner", "lib/recipe-store.ts", "표를 만들어 놓고 **아무 잡에도 안 실려** 러너가 영영 묶여 온 표만 쓴다"],
  ["셀렉터 표 — 운영이 올린다", "putRecipe", "lib/recipe-store.ts", "표를 **넣을 길이 없어** 배포 기계가 통째로 죽은 채 초록으로 보인다"],
  ["셀렉터 표 — 넓히기", "promoteCandidate", "lib/recipe-store.ts", "후보가 영원히 카나리 단계에 머문다(화면엔 «시험 중»으로 보인다)"],
  ["셀렉터 표 — 되돌리기", "rollbackCandidate", "lib/recipe-store.ts", "깨진 표가 퍼진 채 아무도 못 되돌린다"],
  /* 🔴 제품이 부르는 이름은 `makeRecipe` 다 — 판정 자체(`decideRecipe`)는 **일부러 안쪽에 두고**
     하니스(`scripts/verify-recipe.mts`)로만 직접 잰다(순수 함수라 그래야 양성·음성을 같은 수로 잴 수 있다).
     그래서 여기서 세는 것은 «제품이 실제로 부르는 문»이어야 한다 — 이 검사가 그걸 짚어 줘서 고쳤다. */
  ["셀렉터 표 — 러너가 믿을지 판정", "makeRecipe", "runner/lib/recipe.mjs", "검증 없이 쓰거나 멀쩡한 표를 다 버린다(둘 다 조용하다)"],
  ["🔴 셀렉터 표 — 채널이 실제로 그 값을 쓰나", "BUNDLED_SELECTORS", "runner/channels/tistory.mjs", "표를 내려 줘도 채널이 **옛 상수**를 그대로 써서 배포가 아무것도 안 바꾼다"],
  ["로그인 보관 상태 — 잰다", "probeFleet", "runner/lib/profile-seal.mjs", "«리눅스가 몇 대인가»를 영영 모른 채 봉인을 만들지 말지 정하게 된다"],
  /* ── [R8CLOSE §B5] 쓰레드 연결글 — 🔴 **계약만 고치고 발행이 안 따라오는** 그 모양(AC-73)을 막는 사슬 ── */
  ["쓰레드 연결글 — 나눈다", "splitThreadChain", "lib/publish/thread-chain.ts", "계약엔 «2~3개 연결»인데 발행은 500자에서 그냥 잘라 **넘친 글이 조용히 사라진다**"],
  ["🔴 쓰레드 연결글 — 이어 올린다", "runThreadChain", "lib/publish/thread-chain.ts", "조각이 **서로 모르는 낱개 글**로 나간다 — 셋 다 200 이라 어느 검사도 못 잡는다(AC-73)"],
  /* ── [R8CLOSE §R9-2.2] 레퍼런스 벤치마킹 — 🔴 **배워 놓고 아무도 안 읽던** 자리(오늘 열다섯 번째 «만들어 놓고 안 부른다») ── */
  ["레퍼런스 — 배워 온 것을 가른다", "applyReferenceStyle", "lib/video/reference-apply.ts", "그림·색·규칙·호흡이 **DB 에만 쌓이고** 프롬프트엔 한 글자도 안 간다 — 오류도 로그도 없다(실측 2026-09-16 §2)"],
  ["레퍼런스 — 배워 온 색을 화면 칩에 넣는다", "applyRefPalette", "lib/video/reference-apply.ts", "색이 프롬프트에만 들어가 **칩은 «네이비» 인데 그림은 다른 색**이 된다(화면이 거짓말 · AC-52)"],
  /* ── [P1R8 §3.1] 프로필 봉인 — 새로 생긴 사슬이라 **양끝을 다 센다**(서버가 열쇠를 주나 · 러너가 실제로 봉하나) ── */
  ["봉인 — 서버가 열쇠를 준다", "ensureProfileKey", "lib/profile-seal.ts", "열쇠를 만들어 놓고 **잡에 안 실려** 러너가 영영 봉하지 못한다"],
  ["봉인 — 누구에게 켤지 고른다", "sealWantedFor", "lib/profile-seal.ts", "약하다고 «잰» 기기 대신 전 기기에 켜져 멀쩡한 윈도우에 새 위험을 심는다"],
  ["봉인 — 러너가 잠근다", "sealProfile", "runner/lib/profile-seal.mjs", "열쇠는 오는데 **아무것도 안 잠가서** 복사 방어가 0 인 채 «켰다»고 믿는다"],
  ["봉인 — 러너가 푼다", "unsealProfile", "runner/lib/profile-seal.mjs", "봉해만 놓고 못 풀어 **고객이 전 계정 재로그인**을 한다(캡차를 부른다)"],
  ["봉인 — 폐기(기기 분실)", "purgeProfileKeys", "lib/profile-seal.ts", "훔쳐 간 봉인본을 **막을 길이 없다** — 폐기가 이 설계의 진짜 값인데 부르는 자리가 없다"],
  /* ── [P1R8 §3.3 · B-1] AI 키 로테이션 — **양끝을 다 센다**(고르는 쪽·알려 주는 쪽) ── */
  ["AI 키 고르기(§3.3)", "leaseAiKey", "lib/ai-key.ts", "호출부가 각자 env 를 읽어, 한 키가 맞은 429 를 나머지가 몰라 계속 때린다"],
  ["🔴 AI 키 결과 알리기(§3.3)", "reportAiKeyOutcome", "lib/ai-key.ts", "이걸 안 부르면 쉬는 키가 **영영 안 생겨** 로테이션이 장식이 된다(«만들어 놓고 아무도 안 부른다»)"],
  /* ── [R8CLOSE-B1 §B9] 대표 이미지 — 🔴 **이게 바로 이 하니스가 잡아야 했던 모양이다.**
     `director` 가 `heroNeeded` 를 적고 `piece.meta` 로 나르는데 **읽는 곳이 0** 이었다(2026-09-16 조사).
     정의도 있고 값도 흐르는데 아무 일도 안 일어나는 것 — 그래서 **적는 쪽이 아니라 «읽는 쪽»을 센다.** ── */
  /* 🔴 [R11-13 ⑨ · C 2026-09-17] `mode:"read"` — b-49 가 짚은 그 줄이다.
     `director.ts` 는 **적는 쪽**이라 자기 파일 등장 4곳으로 **읽는 쪽이 0이어도 초록**이었다(그게 이 줄이 잡으려던 병 자체다).
     이제 «읽는 모양»(`meta.heroNeeded` · `heroNeeded &&` · 인자로 넘김)만 센다 — 적는 모양(`heroNeeded:` · `heroNeeded =`)은 안 센다. */
  ["🔴 대표 이미지 — «필요하다»를 읽는 자리", "heroNeeded", "lib/director.ts", "네이버·티스토리 대표 이미지가 «필요하다»고 적히기만 하고 목록·검색에 빈자리로 나간다", "read"],
  ["대표 이미지 — 자리를 정한다", "heroPlanOf", "lib/stock/plan.ts", "사진 자리가 0개인 글에 대표가 영영 안 생긴다(막지 않고 **대신 넣어 주는** 자리다)"],
  ["대표 이미지 — 어떻게 됐는지 말해 준다", "heroFactOf", "lib/stock/plan.ts", "대표가 섰는지 **고객이 볼 길이 없다** — 막지 않기로 했으면 말해 주기가 값이다(§9)"],
  /* ── [R8CLOSE-B1 §B8] 목표 매체 → 채널 선택. 🔴 **부르는 자리가 `director.propose` 하나뿐**이라 더 죽기 쉽다. ── */
  ["🔴 목표 매체 → 채널 순서", "targetChannelOrder", "lib/director-goal.ts", "설계 §5.3-1 의 셋째 재료(목표 매체)가 다시 0건이 되고 «목표가 뭐든 같은 채널»로 돌아간다"],
  ["매체가 살아 있나(라이브 상태)", "mediaLiveOf", "lib/director-goal.ts", "애드센스는 러너가 `linked` 로 적는데 `approved` 만 보면 **영영 «안 붙었다»** 가 된다"],
  ["왜 이 채널인지 한 줄", "channelReason", "lib/director.ts", "순서는 바뀌는데 **왜 바뀌었는지 아무도 못 본다**(막지 않는 대신 말해 주기로 한 값 · §9)"],
  /* ── [R8CLOSE-B1 §B2] 페르소나 적합도 — 🔴 **양끝을 다 센다**(재는 쪽 · 배정이 쓰는 쪽). ── */
  ["🔴 페르소나 적합도 — 잰다", "personaFitOf", "lib/persona-fit.ts", "배정이 다시 건강도·캐던스만 보게 되고 캠핑 계정과 재테크 계정에 같은 소재가 떨어진다"],
  ["🔴 페르소나 적합도 — 배정이 쓴다", "personaFitsFor", "lib/persona-fit.ts", "재기만 하고 **순위를 안 바꾼다** — 설계 §5.3-2 의 셋째 재료가 또 장식이 된다"],
  ["페르소나 적합도 — 가산점 천장", "personaFitBonus", "lib/persona-fit.ts", "천장 없이 더하면 적합도가 건강도를 이겨 **아픈 계정에 글이 몰린다**(순위가 아니라 게이트가 된다)"],
  ["왜 이 계정인지 한 줄", "personaFit", "lib/director.ts", "낮아도 배정은 됐는데 **낮다는 걸 아무도 못 본다**(막지 않는 대신 말해 주기로 한 값 · §9)"],
  /* ── [R8CLOSE-B1 §B3] 신조어 화이트리스트 — 🔴 **표·검사·프롬프트 세 끝을 다 센다**(표만 살아 있기 제일 쉬운 모양이다). ── */
  ["🔴 신조어 표 — 검사가 본다", "slangAllowedFor", "lib/slang-whitelist.ts", "표만 있고 검사가 안 봐서, 다음 사람이 신조어를 목록에 넣는 순간 20대 글이 반려되고 재작성이 돈다(돈 두 배)"],
  ["🔴 신조어 표 — 프롬프트가 본다", "slangPromptLine", "lib/slang-whitelist.ts", "«쓰지 마라»만 있고 «써도 된다»가 없어 20대 계정 글이 계속 무난한 말로만 나온다"],
  ["신조어 — 값이 연령대인가", "toAgeBand", "lib/slang-whitelist.ts", "옛 데이터·오타가 그대로 흘러들어 표가 엉뚱하게 먹거나 안 먹는다"],
  ["신조어 — 사전이 표를 받는 칸", "allowSlang", "lib/banned-words.ts", "사전이 표를 못 받아 연령대와 상관없이 모두 잡힌다(순수 리프 계약을 지키려고 import 대신 값으로 받는다)"],
  /* ── [R8CLOSE-B1 §B4] 장소/링크 카드 — 🔴 블록만 만들고 **파싱·렌더·러너 중 하나가 빠지면 조용히 0건**이 된다. ── */
  /* 🔴 [2026-09-16 메인 · b-49 가 잡았다] 옛 심볼은 그냥 `place` 였다 — **너무 흔했다.**
     진짜 소비처를 **다 가려도 바깥 12곳으로 초록**이었다: AI 프롬프트의 영어 산문(«when a place is implied») ·
     카메라 지시문 · channel-registry 의 다른 뜻 문자열 · 인라인 CSS `place-items`.
     🔴 **배선이 내일 통째로 지워져도 초록으로 남는 상태**였다 — «만들면 줄을 박아라»를 지켜 박은 줄인데
     **그 줄이 초록을 거저 받고 있었다.** ⇒ 그 배선에만 있는 글자로 바꾼다(`lib/blocks.ts:28` 선언). */
  ["🔴 장소 카드 — 블록이 실제로 흐른다", "place?: { name", "lib/blocks.ts", "타입만 만들고 파싱·렌더가 없어 모델이 내도 **조용히 버려진다**"],
  /* ── [R11+R12 · B 2026-09-17] 이 라운드에 «부르게 만든» 것들 ──
     🔴 이 묶음의 절반은 **원래 죽어 있던 정의**다(`TEXT_AXIS_KEYS`·`VIDEO_CHANNEL_KEYS`·`bestHoursFor`).
        R11-10 이 이 라운드의 «양심»인 까닭이 그것이고, 그래서 **여기 줄을 박는 것까지가 그 일**이다.
     ⚠️ 🔴 **«거저 초록»을 조심했다**(계약 §4-3 · `place` 가 소비처를 다 가려도 초록이던 사고):
        아래 이름들은 전부 **그 배선에만 있는 글자**다. 흔한 낱말(`axis`·`reader`·`crowd`·`trend`)은 **일부러 안 썼다** —
        그런 글자는 주석·산문·CSS 에서도 나와 배선이 통째로 지워져도 초록으로 남는다. */
  /* ⚠️ 🔴 이 둘은 **`external` 이 아니다** — 내가 처음에 그렇게 달았다가 이 검사가 빨갛게 잡아 줘서 고쳤다(2026-09-17 B).
     `external` 의 뜻은 «자기 파일 안 등장은 **타입 선언·자기 참조**라 소비가 아니다» 인데(`floorMin` 이 그 경우다),
     이 둘의 자기 파일 등장은 **진짜 소비**다 — 바로 아래 `axisOfChannel` **함수 본문이 이 목록을 읽는다.**
     🔴 그리고 이건 «거저 초록»이 아니다: 사슬이 **두 마디**이고 **양쪽을 다 센다** —
        ① 목록을 읽는 곳이 없어지면 이 줄이 빨개지고 ② `axisOfChannel` 을 부르는 곳이 없어지면 다음 줄이 빨개진다.
        한 마디만 세면 «목록만 남기고 판정을 다시 적은» 상태가 통과한다. */
  ["🔴 축 — 글 축 채널 목록을 **누가 읽나**(R11-10)", "TEXT_AXIS_KEYS", "lib/channel-registry.ts", "16채널이 갈려 있는데 다시 **부르는 곳 0곳**이 된다 — 수익·화면이 각자 «네이버면 글»을 또 적는다"],
  ["🔴 축 — 영상 축 채널 목록을 **누가 읽나**(R11-10)", "VIDEO_CHANNEL_KEYS", "lib/channel-registry.ts", "위와 같은 자리의 영상 쪽 — 한쪽만 읽히면 «그 밖»이 조용히 부푼다"],
  ["🔴 축 판정 한 문(R11-10)", "axisOfChannel", "lib/channel-registry.ts", "축을 쓰는 자리마다 판정식을 또 적어 채널이 늘 때 갈라진다"],
  ["🔴 종류 배지 — 화면 어휘로 옮기는 자리(R11-1)", "ruleKindOfPiece", "lib/slots.ts", "만든 글 목록에서 영상·카드뉴스 이름표가 **다시 안 붙는다**(빈 배지로 돌아간다)"],
  ["수익 «어디서 났나» 3단(R11-4)", "buildByAxis", "lib/revenue/aggregate.ts", "못 가른 돈이 «그 밖»으로 안 가고 한쪽에 몰려 **돈 이야기에서 거짓말**이 된다(AC-92)"],
  ["채널 추세 판정(R11-5)", "trendOf", "lib/revenue/trend.ts", "«오름·멈춤·내림»을 재는 함수가 정의만 남고 매체별 줄이 영영 비어 있다"],
  ["🔴 성과 저하 한 줄(R11-6)", "dropAlertOf", "lib/revenue/trend.ts", "`learn.ts` 가 모은 것의 **첫 실사용**이 사라져 되먹임 원장이 또 «모으기만» 한다"],
  ["성과 저하 재료 — 주간 조회 견주기(R11-6)", "viewsWeekCompare", "lib/outcomes.ts", "판정기는 있는데 재료를 읽는 곳이 없어 홈에 그 줄이 영영 안 뜬다"],
  ["🔴 «이날 겹쳐요»(R11-7)", "crowdOf", "lib/publish-gap.ts", "막지 않기로 한 대신 **말해 주기**로 간 자리인데, 안 불리면 **막지도 않고 말해 주지도 않는** 최악이 된다(CLAUDE §9)"],
  ["계정마다 독자 — 생성이 읽는다(R11-8)", "accReader", "lib/content-gen.ts", "계정에 적어 둔 독자가 프롬프트에 한 글자도 안 가고 «저장은 200 인데 새로고침하면 사라지는» 다섯 번째 자리가 된다"],
  ["영상 레퍼런스 월 한도(R11-11)", "videoRefQuota", "lib/video/reference.ts", "«하루 3개»가 남아 글 레퍼런스(«이번 달 N개»)와 **둘이 다른 말**을 계속한다"],
  ["🔴 되먹임 — 디렉터가 읽는다(R12-10)", "learnedTiltFor", "lib/learn-tilt.ts", "모은 성과가 **다음 글에 한 글자도 안 간다** — 원장이 또 «모으기만» 하는 상태로 돌아간다"],
  ["🔴 되먹임 — 배운 시각을 편성이 읽는다(R12-10)", "bestHoursFor", "lib/cron/learn.ts", "주석엔 «편성이 읽는다»고 적혀 있는데 **부르는 곳이 0곳**이던 그 자리다(AC-59) — 다시 죽으면 학습 두 줄 중 하나가 통째로 장식"],
  ["말 속도 → 대본 길이(R12-3)", "syllableRatioOf", "lib/video/tempo.ts", "느리게 말하는 영상의 대본이 안 줄어 **규격을 넘고 코인이 틀어진다**(길이 구간제)"],
  ["🔴 목록 항목 «안»의 꾸밈 — 실제로 흐른다(R12-5)", "itemMarks?: { i: number", "lib/blocks.ts", "타입만 만들고 파싱·렌더가 없어 모델이 내도 **조용히 버려진다**(`place` 와 같은 모양)"],
  ["🔴 표 칸 «안»의 꾸밈 — 실제로 흐른다(R12-5)", "cellMarks?: { r: number", "lib/blocks.ts", "위와 같은 자리의 표 쪽 — 한쪽만 흐르면 «목록은 되는데 표는 안 되는» 어긋남이 된다"],
  ["당근 — 수익이 안 붙는 채널을 말해 준다(R12-6)", "channelMonetizable", "lib/channel-registry.ts", "당근 계정의 0원이 **고장으로 보인다**(AC-10 «설정 안 됨은 오류가 아니다»)"],
  ["당근 — 사진 몇 장까지인가(R12-6)", "maxPhotosOf", "lib/channel-registry.ts", "화면이 «10장까지»를 **베껴 적게** 되고 채널이 늘면 두 곳이 갈린다(AC-52)"],
  ["워드프레스 고급 — 사이드바 위젯(R12-9)", "ensureLatestPostsWidget", "lib/publish/wp-advanced.ts", "만들어 놓고 발행이 안 불러 사이드바가 영영 비어 있다(내부 링크 0)"],
  ["워드프레스 고급 — 빵부스러기(R12-9)", "breadcrumbJsonLd", "lib/publish/wp-advanced.ts", "«구조화 데이터를 넣었다»는데 본문엔 Article 한 덩이뿐인 상태로 돌아간다"],
  ["워드프레스 고급 — 발행처 이름(R12-9)", "publisherOf", "lib/publish/wp-advanced.ts", "Article 에 publisher 가 안 붙는다(그리고 빈 이름을 막는 문이 없어진다)"],
];

/* [R11-13 ⑨ · C 2026-09-17] 🔴 **«적는 곳»과 «읽는 곳»이 갈리는 줄** — b-49 §2.5-9.
   `heroNeeded` 가 그 모양이었다: `director.ts` 가 **적기만** 하고(`heroNeeded: ch === "naver_blog"`) 읽는 곳이 0이었는데,
   적는 줄이 **자기 파일 등장**으로 세어져 **읽는 쪽이 통째로 없어도 초록**이었다. 정의도 있고 값도 흐르는데 아무 일도 안 일어난다 —
   🔴 **이 자가 잡아야 했던 바로 그 모양**인데 못 잡았다.
   ⇒ `mode: "read"` = «**읽는 모양**의 바깥 등장이 하나라도 있어야 산 값». 적는 모양(`x:` 객체 키 · `x =` 대입)은 안 센다. */
const READ_SHAPE = (sym) => {
  const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [new RegExp(`[.]\\s*${esc}\\b`), new RegExp(`\\b${esc}\\s*[)?&|,\\]]`), new RegExp(`\\b${esc}\\s*===`), new RegExp(`${esc}\\s*[(]`)];
};
const WRITE_SHAPE = (sym) => {
  const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [new RegExp(`\\b${esc}\\s*:`), new RegExp(`\\b${esc}\\s*=[^=]`)];
};
/** 바깥 파일들에서 «읽는 모양»인 줄이 있는 파일만 센다. */
function readSites(sym, ownerFile) {
  const rd = READ_SHAPE(sym), wr = WRITE_SHAPE(sym);
  const maps = isIdent(sym) ? CODE_NS : CODE;
  const out = [];
  for (const [p, code] of maps) {
    if (p === ownerFile) continue;
    const lines = code.split("\n").filter((l) => rd.some((r) => r.test(l)) && !wr.some((w) => w.test(l)));
    if (lines.length) out.push(`${p}(${lines.length})`);
  }
  return out;
}
/** [R11-13 ②] 🔴 **이 심볼로 잴 수 있나** — 산문·문자열이 떠받치면 자가 «못 잰다»고 말한다. */
const unmeasurable = [];
for (const [label, sym, owner, harm, mode] of TARGETS) {
  const ownerSrc = read(owner);
  const defined = ownerSrc.includes(sym);
  if (!defined) { rec(`죽은 통로 — ${label}(\`${sym}\`)`, "WARN", `정의 파일 ${owner} 에서 이름을 못 찾았다 — 이름이 바뀌었나(검사를 고쳐라)`); continue; }
  const { hits, importOnly, own } = callSites(sym, owner);
  /* 🔴 `external` = **남이 읽으라고 만든 값**(화면·편성이 소비할 값). 자기 파일 안 등장은 타입 선언·자기 참조라 «소비»가 아니다.
     함수는 자기 파일이 써도 «쓰인다»가 맞지만, 내보내려고 만든 **값**은 바깥에서 읽혀야 산 것이다.
     🔴 이 구분이 없으면 `floorMin` 이 «자기 파일 8곳»으로 **초록이 되어 버린다**(그 8곳은 전부 타입·자기 참조다). */
  const reads = mode === "read" ? readSites(sym, owner) : null;
  const ok = mode === "read" ? reads.length > 0 : mode === "external" ? hits.length > 0 : hits.length + own > 0;
  rec(`🔴 죽은 통로 — ${label}(\`${sym}\`) 을 **제품이 부른다**`, ok,
    `바깥 ${hits.length}곳${hits.length ? ` [${hits.join(" · ")}]` : ""} · 자기 파일 ${own}곳${importOnly ? ` · 임포트만 ${importOnly}곳` : ""}`
    + (mode === "external" ? " (바깥에서 읽혀야 산 값)" : "")
    + (mode === "read" ? ` · 🔴 **읽는 곳** ${reads.length}곳${reads.length ? ` [${reads.join(" · ")}]` : ""}(적는 곳은 안 센다)` : "")
    + (ok ? "" : ` ⇒ ${harm}`));

  /* ② 🔴 문자열을 안 걷었다면 초록이었을 줄 = **그 심볼로는 못 잰다**(`place` 가 그 상태였다).
     🔴 이 줄이 이 자의 «자기 의심»이다 — 박는 사람에게 «더 구체적인 글자를 쓰라»고 돌려준다. */
  if (isIdent(sym)) {
    const loose = callSites(sym, owner, CODE);
    const okLoose = mode === "external" ? loose.hits.length > 0 : mode === "read" ? true : loose.hits.length + loose.own > 0;
    const junk = loose.hits.filter((h) => !hits.includes(h));
    if (!ok && okLoose) unmeasurable.push(`${sym} ⇐ 산문·문자열 ${junk.length}곳 [${junk.join(" · ")}]`);
    else if (ok && junk.length >= 3) unmeasurable.push(`${sym} 🔸 지금은 산 줄이지만 산문·문자열에도 ${junk.length}곳 나온다 — 배선이 지워지는 날 그것들이 떠받친다`);
  }
}
rec("🔴 [R11-13 ②] 이 심볼들로 «잴 수 있나» — 산문·문자열이 떠받치는 줄이 없다", unmeasurable.filter((u) => !u.includes("🔸")).length === 0,
  unmeasurable.length ? unmeasurable.join(" | ") + " ⇒ 그 배선에만 있는 글자로 바꿔라(예: `place` → `place?: { name`)" : `식별자 심볼 전부 «쓰는 자리»로 초록이다(문자열을 걷어도 판정이 안 바뀐다)`);

/* ═══ [R8-A2] 🔴 **한 층 위의 죽은 통로 — «서버는 다 됐는데 화면이 부르나»** ═══
   위의 TARGETS 는 «lib 의 이름을 제품이 부르나»를 센다. 그런데 2026-09-15 하루를 여덟 번 관통한 사고는 한 층 위였다:
   **핸들러가 완성인데 `public/**` 이 그 경로를 한 번도 안 부른다.** 정의로 세면 전부 초록이고(파일도 있고 `config.path` 도 있다),
   화면 스샷으로도 안 잡힌다(그 화면 자체가 없으니까). 유일하게 잡는 방법은 «**화면이 이 문자열을 부르나**»를 세는 것이다.
   🔴 주석은 호출로 세지 않는다 — CODE 는 주석을 걷어 낸 본문이다(AC-59 · «주석에 적어 둔 것»은 «한다»가 아니다).
   🔴 새 API 를 만들면 **여기에 한 줄 박는 것까지가 그 기능이다**(CLAUDE §4.8) — 안 박으면 다음 라운드에 또 죽은 통로가 된다. */
const SCREEN = [...CODE].filter(([p]) => p.startsWith("public/"));
const screenCalls = (needle) => SCREEN.filter(([, code]) => code.includes(needle)).map(([p]) => p);
const APPS = (hits) => hits.filter((p) => /^public\/(app|ops)\//.test(p));

/** [사람이 읽는 이름, 화면이 불러야 하는 문자열, 서버 정본 파일, 안 부르면 무슨 일이 나나, 화면 파일에서까지 불려야 하나] */
const SURFACES = [
  ["직접 쓰기(§5D① · 사장님 «주요 골자»)", "/api/pieces-self", "netlify/functions/pieces-self.ts",
    "AI 를 안 쓰고 내 글을 올리는 길이 화면에 없어, 자기 글을 올리려면 **AI 로 한 편 만들어 코인을 쓰고 통째로 덮어써야** 한다", true],
  ["내리기 — 신고 목록(§5E.2 ③)", "/api/takedowns", "netlify/functions/takedown.ts",
    "통지를 받은 고객이 알림의 «확인하러 가기»를 눌러도 **아무 데도 아닌 곳**이 열린다(서버가 `/app/settings.html#takedown` 으로 보낸다)", true],
  ["내리기 — 두 갈래 답(§5E.2 ⑤)", "/api/takedown-action", "netlify/functions/takedown.ts",
    "«제가 직접 내렸어요»·«대신 내려 주세요»를 누를 자리가 없어 신고가 영영 안 끝난다", false],
  ["수치 주장 표시(§2.4)", "numberClaims", "netlify/functions/pieces.ts",
    "서버가 실어 보내는 «우리가 준 자료에 없는 숫자»를 검수 화면이 안 그려, 근거 없는 수치가 그대로 나간다", true],
  ["내 사진 넣기(§5D.4 «①의 전제»)", "/api/piece-photo-add", "netlify/functions/piece-photos.ts",
    "직접 쓰기가 **글자만 쓰는 길**이 된다(설계가 «사진 업로드가 ①의 전제»라고 못 박은 자리다)", false],
  ["신고 두 갈래 시트를 화면이 연다", "UI.takedownSheet", "public/js/ui.js",
    "함수만 있고 여는 화면이 없어 또 «정의는 있는데 부르는 자리가 없는 것»이 된다", true],
  ["사진 시트를 화면이 연다", "UI.photoSheet", "public/js/ui.js",
    "함수만 있고 여는 화면이 없어 사진을 넣을 길이 여전히 없다", true],
  ["팀 — 자리를 늘리는 길(§4.5)", "/api/team-invite", "netlify/functions/team.ts",
    "요금표가 «Agency 팀 자리 5개»를 **팔면서 늘릴 길이 0**이 된다(§4.8 «완료 = 화면에서 쓸 수 있을 때»의 반대)", true],
  ["팀 — 초대를 거두는 길(§4.5)", "/api/team-revoke", "netlify/functions/team.ts",
    "잘못 보낸 초대가 **영영 자리를 먹은 채** 남는다(대기 중 초대도 자리를 센다)", true],
  ["발행 전 검사 줄을 두 화면이 같이 쓴다", "UI.gateList", "public/js/ui.js",
    "검수 화면과 직접 쓰기 화면이 각자 그려, 축이 늘 때마다 한쪽만 낡는다(AC-52 의 화면 쪽 얼굴)", true],
  /* ── [R9R10-A · 2026-09-16] 서식 · 레퍼런스 · 코인 등급 — 🔴 이번 라운드에 화면이 **새로 읽는 키·부르는 길**. 트리거 «네가 배선한 것을 여기 줄로 박아라».
     B 의 서버 파일이 아직 없으면 △(경고)로 뜨고, 머지되면 그대로 대조가 된다. 정본 키는 docs/active/2026-09-16-R9R10-AB-keys.md. ── */
  ["못 낸 꾸밈(설계 §2.1e) — 검수 화면이 읽는다", "formatUnused", "netlify/functions/pieces.ts",
    "서버가 적어도 아무도 안 봐서 «배웠는데 이 채널에선 못 냈다»가 조용히 사라진다(영상 refUnused 와 같은 사고)", true],
  ["채널 꾸밈 표 — 검수 화면이 «올려 봐야 알아요»를 말한다", "formatCaps", "netlify/functions/pieces.ts",
    "모르는 종류(표가 null)를 되는 것처럼 보여 준다", true],
  ["글 레퍼런스 — 주소로 배우기(설계 §3.1)", "/api/style-reference", "netlify/functions/style-reference.ts",
    "레퍼런스 학습이 API 로만 있고 화면에 입구가 없다(§4.8 «완료 = 화면에서 쓸 수 있을 때»)", true],
  ["글 레퍼런스 — 못 열면 캡처 올리기(설계 §3.1)", "/api/style-reference-upload", "netlify/functions/style-reference.ts",
    "로그인 벽·차단에 막힌 고객이 갈 길이 없다", true],
  ["글 레퍼런스 — 복붙(마지막 예비)", "/api/style-reference-text", "netlify/functions/style-reference.ts",
    "마지막 예비 길이 없다(꾸밈이 날아간다고 말해 주는 자리도 같이 없다)", true],
  /* [2026-09-16 C] 🔴 서버 정본 파일은 `style-reference.ts` 하나가 여섯 경로를 config.path 배열로 받는다 — `account-styles.ts` 는 없는 파일이었다(AC-82 · B 가 잡았다). */
  ["계정의 옷장 — 읽기(설계 §3.6)", "/api/account-styles", "netlify/functions/style-reference.ts",
    "배운 스타일을 어디서도 못 본다", true],
  ["계정의 옷장 — 기본으로 걸기", "/api/account-style-default", "netlify/functions/style-reference.ts",
    "«기본 = 계정에 걸어 둔다»가 화면에 없어 공장이 안 돈다", true],
  ["코인 등급 — 계정 기본값(계약 §13)", "defaultTier", "netlify/functions/accounts.ts",
    "등급 기본값을 정할 자리가 없어 전부 서버 기본(간단히)으로만 만들어진다", true],
  ["코인 등급 — 글마다 덮어쓰기(디렉터 손보기 → 견적·확정)", "patch.tier", "lib/director.ts",
    "손보기에서 고른 등급이 견적·확정에 안 실려 «고른 등급과 다른 값»이 나간다", true],
  ["코인 등급 — 요금제 «몇 편»(계약 §15)", "piecesByTier", "netlify/functions/plans-list.ts",
    "요금제 화면이 코인 수만 말하고 몇 편인지 안 말한다(트리거 A-6)", true],
  ["코인 등급 — 덜 받고 돌려준 문장(트리거 A-5)", "coins.line", "netlify/functions/pieces.ts",
    "조용히 돌려줘서 고객이 모른다", true],
  ["등급 줄을 화면이 연다", "UI.tierRows", "public/js/ui.js",
    "함수만 있고 여는 화면이 없어 또 «정의는 있는데 부르는 자리가 없는 것»이 된다", true],
  ["옷장 시트를 화면이 연다", "UI.styleSheet", "public/js/ui.js",
    "함수만 있고 여는 화면이 없어 레퍼런스 학습 입구가 0 이 된다", true],
  /* ── [R11 · C 2026-09-17] 🔴 **서버가 새로 싣는 두 칸을 화면이 읽나** — 계약 §4-7 «가운데를 먼저 정한다»의 읽는 쪽.
     B 가 TARGETS 에 «만드는 쪽»(`ruleKindOfPiece`·`buildByAxis`)을 박았고 그건 초록이다. 그런데 **그 값을 읽는 화면이 없으면**
     설계가 고치려던 바로 그 상태 그대로다 — 🔴 **TARGETS 는 그걸 원리상 못 본다**(만드는 쪽만 세니까).
     ⚠️ 이 두 줄은 **지금 빨강이다.** 그게 맞다 — §4.8 «완료 = 화면에서 쓸 수 있을 때». A 가 화면을 달면 초록이 된다. ── */
  ["🔴 종류 배지 — 화면이 서버 `ruleKind` 를 읽나(R11-1)", "ruleKind", "netlify/functions/pieces.ts",
    "서버는 «shorts·cardnews»를 실어 보내는데 화면이 `p.kind`(post|video)를 배지표에 그대로 넣어 **이름표가 늘 빈칸**이다 — 설계 §1.2 가 «지금 틀린 것»이라 부른 그 상태로 되돌아간다", true],
  ["🔴 수익 «어디서 났나» — 화면이 `byAxis` 를 읽나(R11-4)", "byAxis", "netlify/functions/revenue.ts",
    "3단(piece→account→그 밖)으로 갈라 놓은 돈이 화면에 한 줄도 안 나온다 — 사장님이 «수익 내는 방식이 두 개»라고 하신 그 구별이 서버에만 산다", true],
  /* 🔴 §9 의 값이 걸린 자리다 — «막지 않는 대신 말해 준다»로 갔는데 **말하는 화면이 없으면 막지도 않고 말하지도 않는 것**이 된다.
     서버는 `lib/slots.ts:397` 에서 `o.crowd = c` 로 이미 실어 보낸다(`crowdOf` 는 순수 · 막는 칸이 없다). */
  ["🔴 «이날 겹쳐요» — 화면이 서버 `crowd` 를 말해 주나(R11-7)", "crowd", "lib/slots.ts",
    "겹침을 재 놓고 **아무 화면도 안 말한다** — 막지 않기로 한 대신 말해 주기로 했는데, 그 말이 어디에도 안 뜬다(§9-①)", true],
];
/* 🔴 [2026-09-16 메인] **서버 정본을 «파일 이름»으로 찾으면 오늘 세 번 틀렸다.**
   ·E6(감사): «이름만 맞는 파일이 있어서» 가짜 초록 — `ops-center.ts` 는 실제로 `/api/ops-audit` 를 연다
   ·여기 둘: «이름이 안 맞아서» 가짜 WARN — `/api/account-styles` 를 여는 파일은 `style-reference.ts` 다
   ⇒ **경로가 진짜 계약이다.** 이름 붙은 파일이 없으면 `config.path` 로 찾는다. */
const FN_FILES = PRODUCT.filter((p) => p.startsWith("netlify/functions/"));
const ownerOf = (owner, needle) => {
  if (read(owner) || SRC.has(owner)) return owner;
  const api = String(needle).match(/[/]api[/][a-z0-9-]+/);
  if (!api) return null;
  return FN_FILES.find((f) => { const t = SRC.get(f) || ""; return t.includes("export const config") && t.includes(api[0]); }) || null;
};
for (const [label, needle, owner0, harm, needApp] of SURFACES) {
  const owner = ownerOf(owner0, needle);
  if (!owner) { rec(`🔴 화면이 부르나 — ${label}`, "WARN", `서버 정본 ${owner0} 를 못 읽었다 — config.path 로도 못 찾았다(검사를 고쳐라)`); continue; }
  const hits = screenCalls(needle);
  const apps = APPS(hits);
  /* 🔴 [2026-09-16 C] «화면 파일»만 세면 **공용 시트를 거치는 길**을 죽은 통로로 오판한다 — A 가 레퍼런스 시트를 ui.js 의 `UI.styleSheet` 한 곳에 두고
     계정·만들기·직접쓰기·디렉터가 그걸 부른다(설계 «한 곳»). 그래서 ui.js 안에서 needle 을 품은 `UI.xxx = ` 블록을 찾고, 그 xxx 를 화면 파일이 부르면 «화면이 부른다»로 센다.
     (하나라도 빠지면 여전히 빨강 — ui.js 에 정의만 있고 화면이 안 부르면 그것이 바로 이 축이 잡으려는 병이다.) */
  const viaUi = (() => {
    const ui = CODE.get("public/js/ui.js") || "";
    const blocks = ui.split(/\r?\n(?=  UI\.\w+ = )/);
    const fns = blocks.filter((b) => b.includes(needle)).map((b) => (b.match(/^  UI\.(\w+) = /) || [])[1]).filter(Boolean);
    return fns.filter((fn) => [...CODE].some(([pp, c]) => /^public\/(app|ops)\//.test(pp) && c.includes(`UI.${fn}(`)));
  })();
  const ok = needApp ? (apps.length > 0 || viaUi.length > 0) : hits.length > 0;
  rec(`🔴 화면이 부르나 — ${label}(\`${needle}\`)`, ok,
    `화면 ${hits.length}곳${hits.length ? ` [${hits.join(" · ")}]` : ""}${needApp ? ` · 그중 화면 파일 ${apps.length}곳` : ""}` + (ok ? "" : ` ⇒ ${harm}`));
}

/* ═══ [R8-B §4.5] 🔴 **서버가 메일·알림에 박아 보내는 주소에 그 파일이 정말 있나** ═══
   위의 SURFACES 는 «화면이 서버를 부르나»를 센다. 그런데 반대 방향의 죽은 통로가 하나 더 있다:
   **서버가 고객에게 보내는 링크가 없는 파일을 가리키는 것.** 이건 아무 검사에도 안 걸린다 —
   서버는 정상이고(`siteUrl()/app/team-accept.html?token=` 을 메일에 잘 싣는다), 화면 스샷도 그 화면이 없으니 못 본다.
   고객만 안다: 초대 메일의 단추를 눌렀는데 **404** 다. 2026-09-16 에 팀 시트에서 실제로 그랬다(A 가 눈으로 찾았다).
   🔴 서버 코드에서 `/app/....html` 문자열을 **전부 긁어** `public/` 에 그 파일이 있는지 본다. 새 링크를 만들면 자동으로 걸린다.
   🔴 `#해시`·`?쿼리`는 떼고 본다 — `/app/settings.html#takedown` 은 파일로는 `settings.html` 이다. */
{
  const LINK_RE = /["'`](\/app\/[A-Za-z0-9_-]+\.html)(?:[?#][^"'`]*)?["'`]/g;
  const miss = new Map();   // 없는 파일 → 그걸 가리키는 서버 자리
  let seen = 0;
  for (const [f, code] of CODE) {
    if (f.startsWith("public/") || f.startsWith("scripts/") || f.startsWith("docs/")) continue;   // 서버·러너 쪽만 본다
    for (const m of code.matchAll(LINK_RE)) {
      const p = m[1]; seen++;
      if (read(`public${p}`)) continue;
      if (!miss.has(p)) miss.set(p, []);
      miss.get(p).push(f);
    }
  }
  const lines = [...miss].map(([p, fs]) => `${p} ← ${[...new Set(fs)].join(" · ")}`);
  rec("🔴 서버가 보내는 링크가 없는 화면을 가리키지 않는다", miss.size === 0,
    lines.length ? lines.slice(0, 3).join(" | ") + " ⇒ 고객이 메일·알림의 단추를 누르면 404 다" : `서버가 가리키는 화면 주소 ${seen}곳 전부 있다`, lines);
}

/* 🔴 [R8-A2 §9] **화면이 서버보다 엄하면 그것도 게이트다** — 서버는 `HARD_GATE_KEYS = []` 인데
   `piece.html` 이 `grade === "P0"` 일 때 «이대로 예약»을 `disabled` 로 잠그고 있었다. 되살아나면 여기서 잡는다.
   🔴 판정을 지우라는 게 아니다(§9 «검사를 지우지 마라») — **잠그지만 말라**는 것이라 `grade === "P0"` 자체는 세지 않는다. */
{
  const pieceHtml = CODE.get("public/app/piece.html") ?? "";
  const locks = [...pieceHtml.matchAll(/grade\s*===\s*"P0"\s*\?\s*"disabled"/g)].length;
  rec("🔴 화면에 남은 하드 게이트 — 심사 P0 로 «이대로 예약»을 잠그지 않는다", locks === 0,
    locks ? `piece.html 이 ${locks}곳에서 단추를 잠근다 ⇒ 서버는 막지 않는데 화면만 막는다(§9 가 내린 바로 그 게이트다)` : "잠그는 자리 0곳 — 판정은 그대로 두고 단추만 열려 있다");
}

/* ═══ 짝 검사: 옛 상수가 아직 살아 있나 — 새 정본을 만들었는데 옛 값이 그대로면 «하나가 썩는다»(AC-64) ═══ */
const OLD = [
  ["간격 30분 상수", "ACCOUNT_GAP_MIN", "lib/best-time.ts", "gapMinFor", "lib/publish-gap.ts"],
];
for (const [label, oldSym, oldOwner, newSym, newOwner] of OLD) {
  const { hits: oldHits } = callSites(oldSym, oldOwner);
  const { hits: newHits } = callSites(newSym, newOwner);
  rec(`🔴 옛 값과 새 정본 — «${label}» 을 쓰는 곳이 새 정본으로 옮겨졌나`, oldHits.length === 0 || newHits.length > 0,
    `옛 \`${oldSym}\` 쓰는 곳 ${oldHits.length}곳 [${oldHits.join(" · ")}] ↔ 새 \`${newSym}\` 쓰는 곳 ${newHits.length}곳`
    + (oldHits.length && !newHits.length ? " ⇒ 🔴 **새 정본은 아무도 안 부르고 옛 값이 전부 돌고 있다**" : ""));
}

/* ═══ [2026-09-16 · C 가 잡은 E1 · B 수리] 🔴 **서버가 내는 AI 원가 분해를 화면이 읽나** ═══
   이 병은 오늘 열다섯 번 잡은 그것인데 **방향이 반대라 더 나쁘다**: 서버·순수 하니스가 다 초록이라 아무도 안 본다.
   🔴 그리고 C 가 보고한 것보다 **넓었다** — `byProvider` 만이 아니라 `calls`·`byPurpose`·`byModel`·`excluded`·`overPlan` 이 **다 안 읽혔다**.
      `public/ops/index.html` 은 `aiCost` 에서 `usd`·`krw`·`fxMissing` 셋만 그린다(실측).

   🔴 **왜 위 심볼 목록에 안 넣었나**: 저 셈법은 «정의 파일이 자기를 쓰면 호출로 센다»(C 의 가짜 빨강 수리).
      그런데 **응답 키**는 자기 파일이 «쓰는» 게 당연하다 — 그건 소비가 아니라 **생산**이다. 그대로 넣으면 **늘 초록인 가짜 검사**가 된다.
      ⇒ «누가 읽나»는 **읽는 쪽(public/**)에서** 세야 한다.

   🔴 **음성·양성 대조를 같이 둔다**: `fxMissing` 은 화면이 **이미 읽는** 키다. 그게 0으로 나오면 **이 검사 자체가 고장 난 것**이다
      (셈법이 틀렸는데 «다 죽었다»고 빨갛게 우는 검사가 제일 나쁘다). */
{
  /* 🔴 [2026-09-16 · A 지적] **모의 층은 «화면»이 아니다.** `public/js/mock*.js` 를 세면
     «모의에만 키를 적어도 초록»이 된다 — 가짜 초록의 교과서다(A 가 자기 mock 이 초록에 기여하는 걸 보고 알려 줬다).
     진짜 화면 파일만 센다. */
  const SCREENS = PRODUCT.filter((p) => p.startsWith("public/") && !/\/js\/mock/.test(p));
  const readsInScreens = (key) => {
    const re = new RegExp(`\\b${key}\\b`);
    return SCREENS.filter((p) => re.test(CODE.get(p) ?? "")).map((p) => p.replace("public/", ""));
  };
  /* 양성 대조 — 이게 0이면 셈법이 고장 난 것이다. */
  const control = readsInScreens("fxMissing");
  rec("🔴 사슬 검사 자체가 도나(양성 대조 · 화면이 이미 읽는 키)", control.length > 0,
    control.length ? `fxMissing 을 화면 ${control.length}곳이 읽는다 [${control.slice(0, 2).join(" ")}]` : "🔴 대조 키마저 0 — 이 검사의 셈법이 고장 났다(빨강을 믿지 마라)");

  const AI_KEYS = [
    ["제공사별(호출 수 기준)", "byProvider", "«어디에 많이 기대고 있나»를 서버만 알고 운영자는 영영 못 본다"],
    ["용도별(무엇이 비싼가)", "byPurpose", "«사진이 85%»를 서버만 알고 화면은 합계 한 줄만 보여 준다"],
    ["모델별", "byModel", "어떤 모델이 돈을 먹는지 화면에서 못 본다"],
    ["우리가 안은 몫", "overPlan", "«스톡이 비어서 AI 가 다 구웠다»는 신호가 감사에만 남는다"],
    ["뺀 몫(내부·하니스·고객 키)", "excluded", "«왜 이 숫자가 작아 보이나»를 화면이 설명하지 못한다"],
    /* 🔴 «호출 수»는 따로 안 센다 — 키가 `aiCost.calls` 인데 `calls` 는 화면 어디에나 있는 낱말이라
       **가짜 초록**이 나온다. 위 두 줄(`byPurpose`·`byProvider`)이 줄마다 `calls` 를 이미 들고 있어 그걸 그리면 같이 닿는다.
       🔴 재지 못하는 것을 «재는 척»하지 않는다(AC-9). */
  ];
  for (const [label, key, harm] of AI_KEYS) {
    /* `excluded`·`calls` 는 흔한 낱말이라 **`aiCost` 를 같이 읽는 화면**에서만 센다(엉뚱한 곳을 세지 않게). */
    const where = readsInScreens(key).filter((p) => /aiCost/.test(CODE.get(`public/${p}`) ?? "") || key === "byProvider" || key === "overPlan");
    rec(`🔴 운영 화면이 «AI 원가 — ${label}»(\`${key}\`)을 읽나`, where.length > 0,
      where.length ? `화면 ${where.length}곳 [${where.slice(0, 3).join(" ")}]` : `읽는 화면 0곳 — ${harm}`);
  }
}

/* ═══ [R11-13 ⑥ · C 2026-09-17] 🔴 **빌드 어긋남 — «끊겨도 초록»이 아니라 «낡아도 초록»이다** ═══
   b-49 §7 이 두 방향을 다 모사해 보고 적었다. 이 자는 `walk("public", [".js",".html"])` 로 **생성물만** 읽는다 —
   정본은 `public/{app,ops}/_tpl.txt`(`scripts/build-pages.mjs` 의 **입력**)인데 `.txt` 는 훑지도 않는다.
     · **생성물에만 남았다**(정본에선 지웠는데 안 빌드) → 🔴 **여전히 초록** — 낡은 빌드가 초록을 떠받친다
     · **정본에만 있다**(아직 안 빌드)             → 빨강 — 멀쩡히 만든 것을 «죽은 통로»라 부른다
   ⚠️ 메인 짐작(«tpl 만 보면 빌드가 끊겨도 초록»)은 **방향이 반대**였다(b-49 가 바로잡았다).
   ⇒ 여기서 **한 줄로** 잰다. 🔴 셸(레일·탭·앱바)을 **다시 구현하지 않는다** — 그건 대용물이고 언젠가 갈린다(AC-97).
      정본 블록의 본문·스크립트가 생성물 **안에 글자 그대로 있나**만 본다(담김 검사). 그리고 **고아 생성물**(정본에 없는 화면)도 센다. */
{
  const miss = [], orphan = [];
  let blocks = 0;
  for (const dir of ["public/app", "public/ops"]) {
    const tpl = read(`${dir}/_tpl.txt`);
    if (!tpl) { miss.push(`${dir}/_tpl.txt 를 못 읽었다`); continue; }
    const named = new Set();
    for (const b of tpl.split(/^=== /m).slice(1)) {
      const [head, ...rest] = b.split("\n");
      const file = head.replace(/ ===\s*$/, "").split("|")[0].trim();
      if (!file) continue;
      named.add(file); blocks++;
      const gen = read(`${dir}/${file}`);
      if (!gen) { miss.push(`${dir}/${file} 생성물이 없다(정본에만 있다 — 빌드를 안 돌렸다)`); continue; }
      const [html, js] = rest.join("\n").split(/^--- script ---\s*$/m);
      /* 🔴 **어느 쪽이 새것인지 같이 찍는다**(2026-09-17 A 되먹임 · 이 자가 실제로 A 를 잡은 뒤에 받은 말).
         첫 판은 문구가 «⇒ `node scripts/build-pages.mjs`» 로 끝났다. 그런데 이번에 잡힌 실물은 **생성물이 새것**이었고,
         그 말을 그대로 따랐으면 A 의 라이브 수리(55시간 갇힌 글)가 **날아갔다.**
         🔴 «둘이 다르다»만 말하고 방향은 **사람이 30초 안에 가리게** 줄 수를 옆에 적는다 — 자가 방향을 모를 땐 **시키지 않는다.** */
      const onlyIn = (a, b) => { const B = new Set(b.split("\n").map((l) => l.trim()).filter(Boolean)); return a.split("\n").map((l) => l.trim()).filter((l) => l && !B.has(l)).length; };
      const side = (part) => `정본에만 ${onlyIn(part, gen)}줄 · 생성물에만 ${onlyIn(gen, part)}줄`;
      if (html && html.trim() && !gen.includes(html.trim())) miss.push(`${dir}/${file} 본문이 정본과 다르다(${side(html.trim())})`);
      if (js && js.trim() && !gen.includes(js.trim())) miss.push(`${dir}/${file} 스크립트가 정본과 다르다(${side(js.trim())})`);
    }
    /* 🔴 **«정본에 없다»만으로 고아라고 부르면 거짓 양성이 난다**(2026-09-17 C 가 먼저 밟았다):
       `team-accept.html`(초대 수락) · `ops/login.html` 은 셸을 안 쓰는 **홑페이지**라 정본에 없는 게 맞다.
       ⇒ **빌더가 찍는 셸을 그대로 이고 있는데 정본 블록이 없는 것**만 고아로 센다 — 그게 «손으로 베낀 셸»이고,
          정본의 셸이 바뀌는 날 이 화면만 조용히 낡는다(그리고 이 자는 낡은 것을 읽고 초록을 준다). */
    const looksGenerated = (t) => t.includes('<div class="shell">') && t.includes('<nav class="rail"') && t.includes('<nav class="tabs"');
    for (const p of PRODUCT) {
      if (!p.startsWith(`${dir}/`) || !p.endsWith(".html")) continue;
      const f = p.slice(dir.length + 1);
      if (!f.includes("/") && !named.has(f) && looksGenerated(SRC.get(p) || "")) orphan.push(p);
    }
  }
  /* 🔴 **고아(손수 관리 화면)는 여기서 빨강으로 안 센다** — 이미 주인이 있다: `scripts/verify-asset-versions.mjs` 가
     `home.html`·`team-accept.html`·`ops/login.html` 을 이름까지 적어 두고 CSS·JS 판을 잰다(2026-09-16 실측으로 태어난 자).
     🔴 **두 자가 같은 것을 다르게 세면 언젠가 갈린다**(AC-101 · b-49 §2.5-9). 여기선 **적기만** 하고 판정은 그 자에게 맡긴다.
     이 줄이 빨개지는 것은 **정본과 생성물이 실제로 어긋났을 때뿐**이다. */
  const tail = orphan.length ? ` · 🔸 손수 관리 화면 ${orphan.length}곳(${orphan.join(" · ")}) — 판정은 verify-asset-versions.mjs 가 한다` : "";
  rec("🔴 정본(_tpl.txt)과 생성물이 안 어긋났다 — 이 자는 생성물만 읽는다(«낡아도 초록»)", miss.length === 0,
    (miss.length ? miss.slice(0, 4).join(" | ") + (miss.length > 4 ? ` 외 ${miss.length - 4}건` : "")
      + " ⇒ 🔴 **어느 쪽이 새것인지 먼저 보고** 옮기거나 빌드해라(생성물이 새것이면 그냥 빌드하면 그 수정이 날아간다)"
      : `정본 ${blocks}절 ↔ 생성물 전부 같다`) + tail);
}

/* ═══ 주석이 코드보다 앞서 나가지 않았나(AC-59) ═══ */
const gapSrc = read("lib/publish-gap.ts");
const claimsSingleSource = /값이 나오는 곳은 여기 하나다|한 곳에서만 나온다/.test(gapSrc);
const bestTimeHasOwn = /export const ACCOUNT_GAP_MIN\s*=/.test(read("lib/best-time.ts"));
rec("🔴 주석이 코드보다 앞서 나가지 않았나(AC-59)", !(claimsSingleSource && bestTimeHasOwn),
  claimsSingleSource && bestTimeHasOwn
    ? "publish-gap.ts 는 «값이 나오는 곳은 여기 하나»라고 적었는데 best-time.ts 에 `ACCOUNT_GAP_MIN` 이 그대로 있다 — 주석이 거짓이다"
    : "주석과 코드가 같다");

if (JSON_OUT) console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
else {
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\nR8 죽은 통로 전수(AC-69 · «정의가 있나»가 아니라 «호출이 있나») · ${new Date().toISOString()}\n${"─".repeat(140)}`);
  for (const r of results) console.log(`${r.ok === "WARN" ? "△" : r.ok ? "✓" : "✗"} ${w(r.step, 60)} ${w(r.note, 76)}`);
  const pass = results.filter((r) => r.ok === true).length, fail = results.filter((r) => r.ok === false).length, warn = results.filter((r) => r.ok === "WARN").length;
  console.log(`${"─".repeat(140)}\nPASS ${pass} · FAIL ${fail} · WARN ${warn}`);
  console.log("🔴 하니스(scripts/**)·문서(docs/**)는 호출로 세지 않는다 — 검사가 자기를 부르는 건 «쓰인다»가 아니다.");
}
process.exit(results.some((r) => r.ok === false) ? 1 : 0);
