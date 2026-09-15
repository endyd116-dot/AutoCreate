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
];
const SRC = new Map(PRODUCT.map((p) => [p, read(p)]));
/** 주석을 걷어 낸 본문 — «주석에만 적혀 있는 호출»을 호출로 세지 않기 위해(AC-59). */
const CODE = new Map([...SRC].map(([p, t]) => [p, t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")]));

/**
 * 이름 하나의 제품 호출처를 센다.
 *   🔴 [2026-09-15 C 수리] 첫 판은 **정의 파일을 통째로 뺐다.** 그래서 «자기 파일 안에서 불리는» 함수가
 *      «제품 호출 0곳» 이라는 **가짜 빨강**으로 나왔다(`channelSpec`·`classifyFpBinding` — 둘 다 자기 파일이 쓴다).
 *      죽은 통로의 뜻은 «아무도 안 부른다» 이지 «남의 파일이 안 부른다» 가 아니다.
 *   ⇒ 정의 파일도 센다. 다만 **정의 줄 자체**(`export function X` · `const X =` · `type X`)는 호출이 아니라서 뺀다.
 */
function callSites(name, ownerFile) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${esc}\\b`);
  const defRe = new RegExp(`^\\s*(export\\s+)?(async\\s+)?(function|const|let|var|type|interface|class)\\s+${esc}\\b`);
  const hits = [];
  let importOnly = 0, own = 0;
  for (const [p, code] of CODE) {
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
  ["🔴 대표 이미지 — «필요하다»를 읽는 자리", "heroNeeded", "lib/director.ts", "네이버·티스토리 대표 이미지가 «필요하다»고 적히기만 하고 목록·검색에 빈자리로 나간다"],
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
  ["🔴 장소 카드 — 블록이 실제로 흐른다", "place", "lib/blocks.ts", "타입만 만들고 파싱·렌더가 없어 모델이 내도 **조용히 버려진다**"],
];

for (const [label, sym, owner, harm, mode] of TARGETS) {
  const ownerSrc = read(owner);
  const defined = ownerSrc.includes(sym);
  if (!defined) { rec(`죽은 통로 — ${label}(\`${sym}\`)`, "WARN", `정의 파일 ${owner} 에서 이름을 못 찾았다 — 이름이 바뀌었나(검사를 고쳐라)`); continue; }
  const { hits, importOnly, own } = callSites(sym, owner);
  /* 🔴 `external` = **남이 읽으라고 만든 값**(화면·편성이 소비할 값). 자기 파일 안 등장은 타입 선언·자기 참조라 «소비»가 아니다.
     함수는 자기 파일이 써도 «쓰인다»가 맞지만, 내보내려고 만든 **값**은 바깥에서 읽혀야 산 것이다.
     🔴 이 구분이 없으면 `floorMin` 이 «자기 파일 8곳»으로 **초록이 되어 버린다**(그 8곳은 전부 타입·자기 참조다). */
  const ok = mode === "external" ? hits.length > 0 : hits.length + own > 0;
  rec(`🔴 죽은 통로 — ${label}(\`${sym}\`) 을 **제품이 부른다**`, ok,
    `바깥 ${hits.length}곳${hits.length ? ` [${hits.join(" · ")}]` : ""} · 자기 파일 ${own}곳${importOnly ? ` · 임포트만 ${importOnly}곳` : ""}`
    + (mode === "external" ? " (바깥에서 읽혀야 산 값)" : "") + (ok ? "" : ` ⇒ ${harm}`));
}

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
  ["계정의 옷장 — 읽기(설계 §3.6)", "/api/account-styles", "netlify/functions/account-styles.ts",
    "배운 스타일을 어디서도 못 본다", true],
  ["계정의 옷장 — 기본으로 걸기", "/api/account-style-default", "netlify/functions/account-styles.ts",
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
];
for (const [label, needle, owner, harm, needApp] of SURFACES) {
  if (!read(owner) && !SRC.has(owner)) { rec(`🔴 화면이 부르나 — ${label}`, "WARN", `서버 정본 ${owner} 를 못 읽었다 — 파일이 옮겨졌나(검사를 고쳐라)`); continue; }
  const hits = screenCalls(needle);
  const apps = APPS(hits);
  const ok = needApp ? apps.length > 0 : hits.length > 0;
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
