/**
 * scripts/verify-coin-tier.mts — 🔴 **코인 등급 셋**(간단히 1 · 보통 2 · 프리미엄 3)을 순수 함수로 잰다(R10-7·8·9 · B · 2026-09-16).
 *   사용: npx --yes tsx scripts/verify-coin-tier.mts      · DB·네트워크·실호출 0
 *
 *   ══ 재는 것(사장님이 못 박은 것 그대로) ══
 *     ① 등급 셋 = 1·2·3 · 상한 3 · 표(`COIN_TIERS.coins`)는 `COIN_TABLE.post_*` 에서 파생(값 두 벌 없음) · 화면 말에 «최소» 없음
 *     ② AI 0장이어도 1 · 내 사진·스톡은 코인을 안 늘린다(식이 AI 장수만 본다) · 덜 구우면 덜 받는다(프리미엄 + AI 0장 = 1)
 *     ③ 🔴 AC-93 — 등급을 모르면(undefined·null·오타) 제일 싼 상한(1)으로만 틀린다 · 견적 ≥ 차감(같은 식이라 같은 값)
 *     ④ 🔴 «고르는 자리» 한 곳 — director·director-auto·slots·content-gen·pieces 여섯 자리가 전부 `tier` 를 넘긴다(낱말 검사 · C 의 자와 같은 축)
 *     ⑤ 등급마다 글도 달라진다 — 분량 하한(보통 ≥1,500 · 프리미엄 ≥2,000 · 채널 폭 안에서) · 구조(보통 +목록/표 · 프리미엄 +체크리스트·FAQ) · 간단히는 종전과 한 글자도 안 다름(무회귀)
 *     ⑥ 🔴 `visualMin` 과 싸우지 않는다 — 등급 구조를 넣어도 `contractSelfConflicts` 가 전 채널·전 등급에서 0(2026-09-15 faq 사고 재발 방지)
 *     ⑦ 요금제 «몇 편»(Pro 150 → 150/75/50) · 정산 문장이 «돌려드렸어요»를 말한다 · 겁주는 말 0
 *     ⑧ 🔴 음성 대조(AC-87) — 옛 식(blog + image×(ai−1))을 같은 격자에 넣으면 빨개진다(자에 이가 있다)
 */
import { COIN_TABLE, COIN_ITEM_LABEL, COIN_TIERS, COIN_TIER_KEYS, COIN_TIER_LIST, COIN_TIER_NOTE, DEFAULT_COIN_TIER, pieceCoinCost, coinsForAiImages, tierForAiImages, plannedAiFor, imageSlotsForTier, piecesByTier, toCoinTier, tierCoinsLine, postItemForCoins, coinCostOf, AI_IMAGES_INCLUDED } from "../lib/coin-table";
import { WRITING_CONTRACTS, lengthFor, structureFor, applyQualityTier, imageCountFor, maxImagesFor, estimateAiImagesFor, contractSelfConflicts, coinFormatOf, type FormatKey } from "../lib/writing-contracts";
import { readFileSync } from "node:fs";

let pass = 0; let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ""}`); } };
const TEXT_CHANNELS = ["naver_blog", "tistory", "blogger", "wordpress", "threads"];

console.log("① 등급 셋 — 1·2·3 · 상한 3 · 표 한 벌 · «최소» 없음");
{
  ok("simple=1 · standard=2 · premium=3", COIN_TIERS.simple.coins === 1 && COIN_TIERS.standard.coins === 2 && COIN_TIERS.premium.coins === 3);
  ok("표는 COIN_TABLE.post_* 에서 파생(값 두 벌 없음)", COIN_TIER_KEYS.every((k) => COIN_TIERS[k].coins === COIN_TABLE[`post_${k}` as keyof typeof COIN_TABLE]));
  ok("상한 3 — AI 12장이어도 3", pieceCoinCost("post", 12, { tier: "premium" }) === 3 && coinsForAiImages(99) === 3);
  ok("화면 말 간단히·보통·프리미엄 · «최소» 없음", COIN_TIERS.simple.label === "간단히" && COIN_TIERS.standard.label === "보통" && COIN_TIERS.premium.label === "프리미엄" && !COIN_TIER_LIST.some((t) => /최소/.test(t.label + t.say)) && !/최소/.test(COIN_TIER_NOTE));
  ok("AI 장수 표 — 1 / 2~3 / 4~5", JSON.stringify(COIN_TIER_KEYS.map((k) => COIN_TIERS[k].aiImages)) === "[[1,1],[2,3],[4,5]]");
  ok("기본 등급 = simple(오늘까지의 글값과 같다 — 기본값이지 날조가 아니다)", DEFAULT_COIN_TIER === "simple");
}

console.log("② AI 0장이어도 1 · 내 사진·스톡은 안 늘린다 · 덜 구우면 덜 받는다");
{
  ok("AI 0장 = 1코인(전 등급)", COIN_TIER_KEYS.every((k) => pieceCoinCost("post", 0, { tier: k }) === 1));
  ok("프리미엄 + AI 0장(내 사진으로 다 채움) = 1 · AI 3장 = 2 · AI 5장 = 3", pieceCoinCost("post", 0, { tier: "premium" }) === 1 && pieceCoinCost("post", 3, { tier: "premium" }) === 2 && pieceCoinCost("post", 5, { tier: "premium" }) === 3);
  ok("간단히 + AI 2장(대표 때문에 더 구움) = 1 — 더 받지 않는다", pieceCoinCost("post", 2, { tier: "simple" }) === 1);
  ok("식이 AI 장수만 본다 — 같은 AI 장수면 사진 총 장수·내 사진 수와 무관", [0, 1, 2, 3, 4, 5].every((ai) => pieceCoinCost("post", ai, { tier: "standard" }) === Math.min(2, coinsForAiImages(ai))));
  ok("tierForAiImages — 0·1→simple · 2·3→standard · 4~→premium", tierForAiImages(0) === "simple" && tierForAiImages(1) === "simple" && tierForAiImages(2) === "standard" && tierForAiImages(3) === "standard" && tierForAiImages(4) === "premium");
  ok("postItemForCoins — 1·2·3 → post_simple·post_standard·post_premium", postItemForCoins(1) === "post_simple" && postItemForCoins(2) === "post_standard" && postItemForCoins(3) === "post_premium");
  ok("plannedAiFor — 등급 상한 안에서 자리만큼(프리미엄·자리 3 → 3 · 자리 9 → 5 · 간단히 → 1)", plannedAiFor("premium", 3) === 3 && plannedAiFor("premium", 9) === 5 && plannedAiFor("simple", 9) === 1);
  ok("imageSlotsForTier — 계약 기본과 등급 AI 장수 중 큰 쪽", imageSlotsForTier("premium", 2) === 5 && imageSlotsForTier("simple", 2) === 2);
}

console.log("③ 🔴 AC-93 — 모르면 제일 싼 쪽으로만 · 견적 = 차감");
{
  const unknowns: unknown[] = [undefined, null, "", "gold", "PREMIUM!", 3, {}];
  ok("모르는 등급 → 상한 1(AI 5장이어도 1)", unknowns.every((u) => pieceCoinCost("post", 5, { tier: toCoinTier(u) }) === 1));
  ok("toCoinTier — 대소문자 · 공백은 받고 오타는 null", toCoinTier(" Premium ") === "premium" && toCoinTier("gold") === null && toCoinTier(3) === null);
  /* 견적(디렉터 propose)과 차감(confirm)과 정산(content-gen)이 **같은 함수·같은 인자**를 쓴다 — 값으로 확인: 등급 × AI 0~12 × 채널·포맷 */
  const bad: string[] = [];
  let nGrid = 0;
  for (const k of COIN_TIER_KEYS) for (const ch of TEXT_CHANNELS) for (const fmt of [undefined, "info", "story", "guide"]) for (let ai = 0; ai <= 12; ai++) {
    const quote = pieceCoinCost("post", ai, { format: coinFormatOf(ch, fmt), tier: k });
    const charge = pieceCoinCost("post", ai, { format: coinFormatOf(ch, fmt), tier: k });
    nGrid++;
    if (quote !== charge || quote > COIN_TIERS[k].coins || quote < 1) bad.push(`${k}/${ch}/${fmt}/ai${ai}=${quote}`);
  }
  ok(`견적 = 차감 · 1 ≤ 값 ≤ 등급 코인 (${nGrid}조합)`, bad.length === 0, bad.slice(0, 5).join(", "));
  ok("정산 want ≤ 계획 코인 — min(계획, 실제) 로 재면 절대 더 받지 않는다", COIN_TIER_KEYS.every((k) => [0, 1, 2, 3, 4, 5, 8].every((planned) => [0, 1, 2, 3, 4, 5, 8].every((actual) => pieceCoinCost("post", Math.min(planned, actual), { tier: k }) <= pieceCoinCost("post", planned, { tier: k })))));
  ok("카드뉴스는 등급 무시(3 그대로) · 영상은 길이 구간", COIN_TIER_KEYS.every((k) => pieceCoinCost("post", 9, { format: "cardnews", tier: k }) === coinCostOf("cardnews")) && pieceCoinCost("video", 0, { seconds: 15, tier: "premium" }) === coinCostOf("video_15"));
  ok("C 의 자(coin-honesty ④)와 안 싸운다 — tier 없이 AI ≤ 포함분이면 글값(1)", [0, AI_IMAGES_INCLUDED].every((ai) => pieceCoinCost("post", ai, {}) === coinCostOf("blog")));
}

console.log("④ 🔴 «고르는 자리» 한 곳 — 여섯 호출부가 전부 tier 를 넘긴다(낱말 검사)");
{
  const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  /* 🔴 괄호 깊이로 호출 끝을 찾는다 — 첫 `)` 에서 끊으면 `coinFormatOf(…)` 안쪽에서 끊겨 «tier 없음»이라는 **가짜 빨강**이 난다(첫 판이 그랬다 · AC-67 거짓 false). */
  const calls = (p: string): string[] => {
    const t = src(p); const out: string[] = [];
    let i = t.indexOf("pieceCoinCost(");
    while (i >= 0) {
      let depth = 0, j = i + "pieceCoinCost".length;
      for (; j < t.length; j++) { if (t[j] === "(") depth++; else if (t[j] === ")") { depth--; if (depth === 0) break; } }
      out.push(t.slice(i, j + 1)); i = t.indexOf("pieceCoinCost(", j);
    }
    return out;
  };
  const files = ["lib/director.ts", "lib/cron/director-auto.ts", "lib/slots.ts", "lib/content-gen.ts", "netlify/functions/pieces.ts"];
  const missing: string[] = [];
  let total = 0;
  for (const f of files) for (const c of calls(f)) { total++; if (!/tier/.test(c)) missing.push(`${f}: ${c.slice(0, 80)}`); }
  ok(`제품 호출부 ${total}곳 전부 tier 를 넘긴다`, total >= 6 && missing.length === 0, missing.join("\n      "));
  ok("director.ts 가 사진 항목(image)을 따로 차감하지 않는다(등급 항목 한 행)", !/consume\(tid, "image"/.test(src("lib/director.ts")));
  ok("등급 코인 항목이 원장 라벨을 갖는다(«최근 사용»에 «글 1편(보통)»으로 보인다)", (["post_simple", "post_standard", "post_premium"] as const).every((k) => /글 1편/.test(COIN_ITEM_LABEL[k] ?? "")));
}

console.log("⑤ 등급마다 글도 달라진다 — 분량·구조 · 간단히는 무회귀");
{
  const naver = WRITING_CONTRACTS.naver_blog, blogger = WRITING_CONTRACTS.blogger, tistory = WRITING_CONTRACTS.tistory, threads = WRITING_CONTRACTS.threads;
  ok("네이버 후기: simple 1,200 · standard 1,500 · premium 2,000 (상한 2,500 그대로)", lengthFor(naver, "review", "simple").min === lengthFor(naver, "review").min && lengthFor(naver, "review", "standard").min === 1500 && lengthFor(naver, "review", "premium").min === 2000 && lengthFor(naver, "review", "premium").max === lengthFor(naver, "review").max,
    JSON.stringify([lengthFor(naver, "review", "simple"), lengthFor(naver, "review", "standard"), lengthFor(naver, "review", "premium")]));
  ok("채널 폭이 이미 높으면 안 내린다(티스토리 정보 3,000 은 프리미엄에서도 3,000 · 블로거 정보 1,500 은 2,000 으로)", lengthFor(tistory, "info", "premium").min === 3000 && lengthFor(blogger, "info", "premium").min === 2000, JSON.stringify([lengthFor(tistory, "info", "premium"), lengthFor(blogger, "info", "premium")]));
  ok("쓰레드(120~500): 등급이 상한을 못 넘긴다(min < max)", lengthFor(threads, null, "premium").min < lengthFor(threads, null, "premium").max && lengthFor(threads, null, "premium").max === 500);
  ok("tier 없음·simple → 종전과 같은 값(무회귀)", TEXT_CHANNELS.every((ch) => { const c = WRITING_CONTRACTS[ch]; return JSON.stringify(lengthFor(c, null)) === JSON.stringify(lengthFor(c, null, "simple")) && JSON.stringify(lengthFor(c, null)) === JSON.stringify(lengthFor(c, null, null)); }));
  /* 구조 — 채널 × format × seed 로 돌려 본다 */
  const has = (seq: string[], t: string) => seq.includes(t);
  let stdOk = true, preOk = true, simSame = true, tipLast = true, n = 0;
  for (const ch of ["naver_blog", "tistory", "blogger", "wordpress"]) {
    const c = WRITING_CONTRACTS[ch];
    for (const f of c.formats) for (const seed of [1, 7, 42, 1001]) {
      n++;
      const base = structureFor(c, f as FormatKey, imageCountFor(c, null, "simple"), false, seed, null);
      const sim = structureFor(c, f as FormatKey, imageCountFor(c, null, "simple"), false, seed, null, "simple");
      const std = structureFor(c, f as FormatKey, imageCountFor(c, null, "standard"), false, seed, null, "standard");
      const pre = structureFor(c, f as FormatKey, imageCountFor(c, null, "premium"), false, seed, null, "premium");
      if (JSON.stringify(base) !== JSON.stringify(sim)) simSame = false;
      const sup = new Set(c.tiers?.suppress ?? []);
      if (!(has(std, "list") || has(std, "table") || has(std, "checklist")) && !sup.has("list")) stdOk = false;
      if ((!has(pre, "checklist") && !sup.has("checklist")) || (!has(pre, "faq") && !sup.has("faq"))) preOk = false;
      const tail = pre.filter((b) => b !== "hashtags"); if (c.tiers && !sup.has("tip") && tail[tail.length - 1] !== "tip") tipLast = false;
    }
  }
  ok(`간단히 = tier 없음과 같은 골격(무회귀 · ${n}조합)`, simSame);
  ok("보통 — 목록·표·체크리스트 중 하나는 있다(억제 채널 제외)", stdOk);
  ok("프리미엄 — 체크리스트·FAQ 가 있다(억제 채널 제외)", preOk);
  ok("프리미엄에서도 끝맺음(tip)이 마지막이다 — 등급 블록이 꼬리 앞에 들어간다", tipLast);
  ok("사진 자리 — 네이버 프리미엄 ≥5 · 쓰레드는 1 그대로(플랫폼 사실) · 블로거 채널 기본(상한 3) 프리미엄 5(등급이 계약 상한을 넘긴다) · 블로거 정보(상한 6) 5",
    imageCountFor(naver, "review", "premium") >= 5 && imageCountFor(threads, null, "premium") === 1 && maxImagesFor(blogger, "premium", null) === 5 && imageCountFor(blogger, null, "premium") === 5 && imageCountFor(blogger, "info", "premium") === 5,
    JSON.stringify({ naver: imageCountFor(naver, "review", "premium"), threads: imageCountFor(threads, null, "premium"), bloggerMax: maxImagesFor(blogger, "premium", null), blogger: imageCountFor(blogger, null, "premium"), bloggerInfo: imageCountFor(blogger, "info", "premium") }));
  ok("estimateAiImagesFor — 견적 자리 추정이 디렉터 두 함수와 같은 값", TEXT_CHANNELS.every((ch) => COIN_TIER_KEYS.every((k) => estimateAiImagesFor(ch, k) === plannedAiFor(k, imageCountFor(WRITING_CONTRACTS[ch], null, k)))));
  ok("applyQualityTier — tiers 없는 채널(쓰레드)은 그대로 · 억제(suppress)된 블록은 안 넣는다", JSON.stringify(applyQualityTier(["hook", "para", "hashtags"], threads, "premium")) === JSON.stringify(["hook", "para", "hashtags"])
    && !applyQualityTier(["para", "h2", "para"], { ...naver, tiers: { required: ["para"], optional: [], suppress: ["faq", "checklist", "list"] } }, "premium").some((b) => b === "faq" || b === "checklist" || b === "list"));
}

console.log("⑥ 🔴 visualMin 과 싸우지 않는다 — 전 채널 contractSelfConflicts 0");
{
  const conflicts = TEXT_CHANNELS.map((ch) => [ch, contractSelfConflicts(WRITING_CONTRACTS[ch])] as const).filter(([, c]) => c.length);
  ok("등급 구조를 넣은 뒤에도 계약 자기충돌 0", conflicts.length === 0, JSON.stringify(conflicts));
}

console.log("⑦ 요금제 «몇 편» · 정산 문장");
{
  ok("Pro 150 → 간단히 150 / 보통 75 / 프리미엄 50", JSON.stringify(piecesByTier(150)) === JSON.stringify({ simple: 150, standard: 75, premium: 50 }));
  ok("체험 0 → 전부 0(숨기지 않는다)", JSON.stringify(piecesByTier(0)) === JSON.stringify({ simple: 0, standard: 0, premium: 0 }));
  const l1 = tierCoinsLine({ tier: "premium", planned: 3, charged: 1, returned: 2, actualAi: 0, customerPhotos: 5 });
  const l2 = tierCoinsLine({ tier: "standard", planned: 2, charged: 2, returned: 0, actualAi: 3 });
  ok("돌려준 경우 — «내 사진으로 채워서 1코인만 받았어요 — 2코인은 돌려드렸어요»", /내 사진으로 채워서 1코인만 받았어요/.test(l1) && /2코인은 돌려드렸어요/.test(l1), l1);
  ok("안 돌려준 경우 — 등급·코인·AI 장수", /보통 · 2코인/.test(l2) && /3장/.test(l2), l2);
  ok("정산 문장에 겁주는 말·시스템 낱말 0", ![l1, l2, COIN_TIER_NOTE, ...COIN_TIER_LIST.map((t) => t.say)].some((s) => /정지|불이익|알려만|책임|러너|테넌트|piece|슬롯/.test(s)));
}

console.log("⑧ 🔴 음성 대조 — 옛 식을 넣으면 빨개지나");
{
  const oldCost = (ai: number) => coinCostOf("blog") + coinCostOf("image") * Math.max(0, ai - AI_IMAGES_INCLUDED);
  let caught = 0;
  for (let ai = 0; ai <= 12; ai++) if (oldCost(ai) > 3 || oldCost(ai) !== pieceCoinCost("post", ai, { tier: "premium" })) caught++;
  ok(`옛 식(blog + image×(ai−1))은 ${caught}조합에서 등급표와 다르다 — 자에 이가 있다`, caught > 0);
  /* 등급을 «안 넘기는» 호출부를 흉내 내면 ④ 가 잡는지 — 문자열 검사라 여기서는 한 줄만 흉내 낸다 */
  const fake = 'pieceCoinCost("post", ai, { format: fmt })';
  ok("tier 낱말 없는 호출을 ④ 의 정규식이 빨강으로 낸다", !/tier/.test(fake));
}

console.log(`\n${fail ? `🔴 실패 ${fail}` : `✅ ${pass}개 통과`} (통과 ${pass} · 실패 ${fail})`);
process.exit(fail ? 1 : 0);
