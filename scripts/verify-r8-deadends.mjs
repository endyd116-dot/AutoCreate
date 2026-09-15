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
  ["발행 전 검사 줄을 두 화면이 같이 쓴다", "UI.gateList", "public/js/ui.js",
    "검수 화면과 직접 쓰기 화면이 각자 그려, 축이 늘 때마다 한쪽만 낡는다(AC-52 의 화면 쪽 얼굴)", true],
];
for (const [label, needle, owner, harm, needApp] of SURFACES) {
  if (!read(owner) && !SRC.has(owner)) { rec(`🔴 화면이 부르나 — ${label}`, "WARN", `서버 정본 ${owner} 를 못 읽었다 — 파일이 옮겨졌나(검사를 고쳐라)`); continue; }
  const hits = screenCalls(needle);
  const apps = APPS(hits);
  const ok = needApp ? apps.length > 0 : hits.length > 0;
  rec(`🔴 화면이 부르나 — ${label}(\`${needle}\`)`, ok,
    `화면 ${hits.length}곳${hits.length ? ` [${hits.join(" · ")}]` : ""}${needApp ? ` · 그중 화면 파일 ${apps.length}곳` : ""}` + (ok ? "" : ` ⇒ ${harm}`));
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
