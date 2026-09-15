/**
 * scripts/verify-coin-tier-honesty.mts — 🔴 **등급제(간단히 1 · 보통 2 · 프리미엄 3)에서도 «내는 값 ≤ 말한 값»**(C · R10-7 · 2026-09-16 · 순수 · DB 0).
 *   사용: npx --yes tsx scripts/verify-coin-tier-honesty.mts
 *
 *   ══ 왜 «다른 모양의 자»인가 ══
 *   B 는 `pieceCoinCost` 안의 식을 지킨다. 이 자는 **등급 × 채널 × 포맷 × AI 장수(0~12) × 모르는 입력** 격자를 돌리고
 *   부등호 하나만 본다 — 🔴 **고객이 실제로 내는 값 ≤ 고객에게 말한 값(등급 표의 coins)**.
 *   그리고 «식이 한 곳»이라는 말을 **값과 호출부**로 확인한다: 견적 자리(편성표·디렉터·규칙) 중 **tier 를 안 넘기는 곳**이 있으면
 *   그 자리는 1코인을 말하고 실제 차감은 3코인이 된다 — 그게 이 라운드에서 돈이 새는 가장 쉬운 길이다.
 *
 *   ══ 자를 먼저 찌른다 ══
 *   «옛 식»(글 1 + 사진 1장 초과분 × 1)을 같은 격자에 넣어 «상한 3»이 깨지는 것을 본다. 안 잡히면 이 자는 이가 없다.
 *
 *   ⚠️ B 가 커밋하기 전에는 `COIN_TIERS` 가 없어 **열림**(종료코드 1)이다.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out: { step: string; ok: boolean; note: string }[] = [];
const rec = (step: string, ok: boolean, note = "") => { out.push({ step, ok, note }); return ok; };

type Cost = (kind: string, ai: number, opts?: Record<string, unknown>) => number;

(async () => {
  const ct = await import(pathToFileURL(join(ROOT, "lib", "coin-table.ts")).href);
  const wc = await import(pathToFileURL(join(ROOT, "lib", "writing-contracts.ts")).href);
  const pieceCoinCost: Cost = ct.pieceCoinCost;
  const coinCostOf: (k: string) => number = ct.coinCostOf;
  const coinFormatOf: (ch: string, f?: string) => string | undefined = wc.coinFormatOf;

  const TIERS: Record<string, { coins: number; aiImages?: [number, number]; label?: string }> | undefined = ct.COIN_TIERS;
  const KEYS: string[] = Array.isArray(ct.COIN_TIER_KEYS) ? ct.COIN_TIER_KEYS : TIERS ? Object.keys(TIERS) : [];
  const CHS = ["naver_blog", "tistory", "blogger", "wordpress", "instagram", "threads"];
  const FMTS: (string | undefined)[] = [undefined, "info", "story", "compare", "listicle", "cardnews", "qna", "guide"];
  const AIS = Array.from({ length: 13 }, (_, i) => i);
  const UNKNOWN: unknown[] = [undefined, null, "abc", 0, -1, 999, NaN, {}, "xyz ", "Simple2"];
  /* B 는 대소문자·앞뒤 공백을 **정규화해 아는 값으로** 읽는다(«PREMIUM »·« standard») — 그건 «모르는 값»이 아니라 «알아들은 값»이라 정규화된 등급과 같아야 한다. */
  const NORMALIZED: [unknown, string][] = [["PREMIUM", "premium"], ["premium ", "premium"], [" standard", "standard"], ["Simple", "simple"]];

  /* ⓪ 자를 먼저 찌른다 — 옛 식은 상한 3 을 넘는다 */
  {
    const old = (ai: number) => coinCostOf("blog") + coinCostOf("image") * Math.max(0, ai - 1);
    const caught = AIS.filter((ai) => old(ai) > 3).length;
    rec("⓪ 🔴 이 격자가 옛 식(글 1 + 사진 초과분)을 잡나(상한 3 초과)", caught > 0, caught ? `AI ${caught}장수에서 «3 초과»가 잡힌다 — 자에 이가 있다` : "🔴 옛 식도 통과 — 이 자는 아무것도 못 잡는다");
  }

  if (!TIERS || !KEYS.length) {
    rec("① COIN_TIERS 가 lib/coin-table.ts 에 있다(R10-7)", false, "🔴 없음 — 등급제 미착(열림)");
  } else {
    /* ① 표 자체 */
    const coins = KEYS.map((k) => TIERS[k].coins);
    rec("① 등급 셋 · 말한 값 1·2·3 · 상한 3 · 오름차순", KEYS.length === 3 && coins.every((c) => c >= 1 && c <= 3) && coins.every((c, i) => i === 0 || c > coins[i - 1]),
      KEYS.map((k, i) => `${k}=${coins[i]}`).join(" < "));
    const table = ct.COIN_TABLE as Record<string, number>;
    const derived = KEYS.every((k) => table[`post_${k}`] === TIERS[k].coins);
    rec("① COIN_TABLE.post_<tier> 와 COIN_TIERS.coins 가 한 값(두 벌 아님)", derived, KEYS.map((k) => `post_${k}=${table[`post_${k}`]}`).join(" · "));
    rec("① «최소»라는 말을 안 쓴다(사장님 — 간단히·보통·프리미엄)", !KEYS.some((k) => /최소/.test(String(TIERS[k].label ?? ""))), KEYS.map((k) => TIERS[k].label).join("·"));

    /* ② 🔴 격자 — 내는 값 ≤ 말한 값 · AI 0장이어도 1 · 상한 3 · 카드뉴스 3 */
    {
      const bad: string[] = []; let n = 0;
      for (const tier of KEYS) for (const ch of CHS) for (const fmt of FMTS) for (const ai of AIS) {
        const key = coinFormatOf(ch, fmt);
        const said = key === "cardnews" ? coinCostOf("cardnews") : TIERS[tier].coins;
        const pay = pieceCoinCost("post", ai, { format: key, tier });
        n++;
        if (pay > said) bad.push(`${tier}/${ch}/${fmt}/ai${ai}: 말한 ${said} < 낸 ${pay}`);
        if (pay > 3 && key !== "cardnews") bad.push(`${tier}/${ch}/${fmt}/ai${ai}: 상한 3 초과 ${pay}`);
        if (pay < 1) bad.push(`${tier}/${ch}/${fmt}/ai${ai}: 0코인(${pay}) — 사진 0장이어도 1`);
        if (ai === 0 && key !== "cardnews" && pay !== 1) bad.push(`${tier}/${ch}/${fmt}/ai0: ${pay} ≠ 1(AI 0장이어도 1)`);
        if (key === "cardnews" && pay !== coinCostOf("cardnews")) bad.push(`${tier}/${ch}/cardnews/ai${ai}: ${pay} ≠ ${coinCostOf("cardnews")}`);
      }
      rec(`② 🔴 등급 × 채널 × 포맷 × AI 0~12 = ${n}조합 — «낸 값 ≤ 말한 값» · 0장=1 · 상한 3 · 카드뉴스 그대로`, bad.length === 0,
        bad.length ? `🔴 ${bad.length}건 — ${bad.slice(0, 3).join(" · ")}` : `${n}조합 전부`);
    }
    /* ③ 🔴 덜 구우면 덜 받나 — 프리미엄 골랐는데 AI 0·1장이면 1 · AI 에 대해 단조 · 내 사진·스톡은 값을 안 올린다 */
    {
      const bad: string[] = [];
      for (const tier of KEYS) {
        const seq = AIS.map((ai) => pieceCoinCost("post", ai, { tier }));
        if (seq.some((v, i) => i > 0 && v < seq[i - 1])) bad.push(`${tier}: AI 가 늘었는데 값이 준다(${seq.join(",")})`);
        if (pieceCoinCost("post", 0, { tier }) !== 1 || pieceCoinCost("post", 1, { tier }) !== 1) bad.push(`${tier}: AI 0·1장인데 1 이 아니다`);
        for (const ai of AIS) {
          const base = pieceCoinCost("post", ai, { tier });
          const withMine = pieceCoinCost("post", ai, { tier, myPhotos: 12, stockPhotos: 9, totalImages: ai + 21 });
          if (withMine !== base) bad.push(`${tier}/ai${ai}: 내 사진·스톡을 넘기니 값이 변한다(${base}→${withMine})`);
        }
      }
      const premium = KEYS[KEYS.length - 1];
      rec("③ 🔴 덜 구우면 덜 받는다 — 프리미엄인데 AI 0장이면 1 · AI 단조 · 내 사진·스톡은 값을 못 올린다", bad.length === 0 && pieceCoinCost("post", 0, { tier: premium }) === 1,
        bad.length ? `🔴 ${bad.slice(0, 3).join(" · ")}` : `${premium}/AI0 = ${pieceCoinCost("post", 0, { tier: premium })}코인`);
    }
    /* ④ 🔴 모르는 tier — «고를 수 있었던 최댓값(3)»을 안 넘고, B 가 못 박은 대로 **모자라게(1)** */
    {
      const bad: string[] = [];
      for (const t of UNKNOWN) for (const ai of [0, 1, 3, 5, 12]) {
        let v: number;
        try { v = pieceCoinCost("post", ai, { tier: t as never }); } catch (e) { bad.push(`tier=${String(t)}/ai${ai}: 던짐`); continue; }
        if (v > 3) bad.push(`tier=${String(t)}/ai${ai}: ${v} > 3`);
        if (v > 1) bad.push(`tier=${String(t)}/ai${ai}: ${v} — 모르면 모자라게(1)여야(AC-93)`);
        if (v < 1) bad.push(`tier=${String(t)}/ai${ai}: ${v} < 1`);
      }
      for (const [raw, norm] of NORMALIZED) for (const ai of [0, 3, 5]) {
        try { const a = pieceCoinCost("post", ai, { tier: raw as never }), b = pieceCoinCost("post", ai, { tier: norm }); if (a !== b) bad.push(`tier=${JSON.stringify(raw)}/ai${ai}: ${a} ≠ ${norm} 의 ${b}`); }
        catch { bad.push(`tier=${JSON.stringify(raw)}/ai${ai}: 던짐`); }
      }
      rec("④ 🔴 모르는 tier(undefined·null·\"abc\"·0·-1·999·NaN·{}·\"xyz \"·\"Simple2\") → 1(모자라게 · 던지지 않는다) · 대소문자·공백은 정규화된 등급과 같은 값", bad.length === 0, bad.length ? `🔴 ${bad.slice(0, 3).join(" · ")}` : `모르는 ${UNKNOWN.length}입력 × 5장수 전부 1 · 정규화 ${NORMALIZED.length}종 일치`);
    }
    /* ⑤ 🔴 재차감·정산 — 같은 재료면 같은 값 · 정산액(min(계획, 실제)) ≤ 첫 차감 */
    {
      const bad: string[] = [];
      for (const tier of KEYS) for (const planned of AIS) for (const actual of AIS) {
        const first = pieceCoinCost("post", planned, { tier });
        const settle = pieceCoinCost("post", Math.min(planned, actual), { tier });
        if (settle > first) bad.push(`${tier}/계획${planned}/실제${actual}: 정산 ${settle} > 첫 차감 ${first}`);
        if (pieceCoinCost("post", planned, { tier }) !== first) bad.push(`${tier}/ai${planned}: 두 번 불러 다른 값`);
      }
      rec("⑤ 재차감·정산이 첫 차감보다 비싸지는 조합 0(계획×실제 전 조합)", bad.length === 0, bad.length ? `🔴 ${bad.slice(0, 3).join(" · ")}` : `${KEYS.length * 13 * 13}조합 전부`);
    }
    /* ⑥ 🔴 견적 자리 셋이 같은 식 — 호출부가 tier 를 넘기나(안 넘기면 1 을 말하고 3 을 뺀다) */
    {
      const files = [...walk(join(ROOT, "lib")), ...walk(join(ROOT, "netlify", "functions"))].filter((p) => !/coin-table\.ts$/.test(p));
      const calls: { file: string; line: number; text: string; hasTier: boolean; isVideo: boolean }[] = [];
      for (const p of files) {
        const src = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/[^\n]*/g, "$1");
        const lines = src.split("\n");
        lines.forEach((ln, i) => {
          if (!/pieceCoinCost\s*\(/.test(ln)) return;
          const text = lines.slice(i, i + 3).join(" ");
          calls.push({ file: p.replace(ROOT, "").replace(/\\/g, "/"), line: i + 1, text: ln.trim().slice(0, 100), hasTier: /\btier\b/.test(text), isVideo: /"shorts"|"video"|r\.kind|o\.kind|kind,/.test(text) });
        });
      }
      const noTier = calls.filter((c) => !c.hasTier);
      rec(`⑥ 🔴 pieceCoinCost 호출부 ${calls.length}곳(편성표·디렉터·규칙·정산·자동) 전부 tier 를 넘긴다`, calls.length > 0 && noTier.length === 0,
        noTier.length ? `🔴 tier 없이 부르는 곳(1 을 말하고 3 을 뺀다): ${noTier.map((c) => `${c.file}:${c.line}`).join(", ")}` : `${calls.length}곳 전부 tier 동반`);
      const slots = readFileSync(join(ROOT, "lib", "slots.ts"), "utf8");
      /* B: 편성표는 계정별 `accounts.quality_tier`(DDL 0035) 맵을 읽어 규칙·자리마다 그 계정 등급으로 센다. 안 고른 계정 = simple(그대로 실행되는 값 = 기본값 · AC-93). */
      const slotsCode = slots.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      const readsMap = /quality_tier|defaultTier/.test(slotsCode);
      rec("⑥ 편성표 견적(coinsPerWeek·slots-list.coinCost)이 계정별 등급(accounts.quality_tier / defaultTier)을 코드로 읽는다(주석 제외)", readsMap,
        readsMap ? `읽는다(${/quality_tier/.test(slotsCode) ? "quality_tier" : "defaultTier"})` : /\btier\b/.test(slotsCode) ? "🟠 tier 낱말은 있으나 계정 등급 맵을 안 읽는다 — 어디서 오나 사람이 확인" : "🔴 slots.ts 에 tier 가 없다 — 편성표는 옛 값을 말한다");
      /* DDL 칸 — B 는 0031~0039 · 0035 가 실제로 그 파일이고 accounts 에 quality_tier 를 더하나(IF NOT EXISTS) */
      const ddl = existsSync(join(ROOT, "drizzle")) ? readdirSync(join(ROOT, "drizzle")).filter((f) => /^0035/.test(f)) : [];
      const ddlOk = ddl.some((f) => /quality_tier/.test(readFileSync(join(ROOT, "drizzle", f), "utf8")) && /IF NOT EXISTS/i.test(readFileSync(join(ROOT, "drizzle", f), "utf8")));
      rec("⑥ DDL 0035(B 칸)가 accounts.quality_tier 를 IF NOT EXISTS 로 더한다 · schema.ts 에도 같은 칸", ddlOk && /quality_tier/.test(readFileSync(join(ROOT, "db", "schema.ts"), "utf8")),
        ddl.length ? `${ddl.join(",")} · schema.ts quality_tier=${/quality_tier/.test(readFileSync(join(ROOT, "db", "schema.ts"), "utf8"))}` : "🔴 drizzle/0035* 없음");
    }
    /* ⑦ 요금제 «몇 편» — piecesByTier = floor(포함 코인 / 등급 코인)이 서버에 있고 화면이 셈하지 않는다 */
    {
      const plans = existsSync(join(ROOT, "lib", "plans.ts")) ? readFileSync(join(ROOT, "lib", "plans.ts"), "utf8") : "";
      const fnFiles = walk(join(ROOT, "netlify", "functions")).filter((p) => /piecesByTier/.test(readFileSync(p, "utf8")));
      const tpl = existsSync(join(ROOT, "public", "app", "_tpl.txt")) ? readFileSync(join(ROOT, "public", "app", "_tpl.txt"), "utf8") : "";
      const screenComputes = /piecesByTier[^\n]*Math\.floor|Math\.floor\([^\n]*includedCoins[^\n]*coins/.test(tpl);
      rec("⑦ 요금제 «몇 편»(piecesByTier)을 서버가 셈하고 화면은 그대로 그린다(AC-74)", (/piecesByTier/.test(plans) || fnFiles.length > 0) && !screenComputes,
        `${/piecesByTier/.test(plans) || fnFiles.length ? `서버: ${[/piecesByTier/.test(plans) ? "lib/plans.ts" : "", ...fnFiles.map((p) => p.replace(ROOT, ""))].filter(Boolean).join(",")}` : "🔴 서버에 piecesByTier 없음"}${screenComputes ? " · 🔴 화면이 floor 로 셈한다" : ""}`);
    }
  }

  const w = (x: unknown, n: number) => String(x).padEnd(n);
  const fail = out.filter((r) => !r.ok).length;
  console.log(`\n코인 등급제 정직성 — «낸 값 ≤ 말한 값» 격자 · ${new Date().toISOString()}\n${"─".repeat(126)}`);
  for (const r of out) console.log(`  ${r.ok ? "✓" : "✗"} ${w(r.step, 88)} ${r.note}`);
  console.log(`${"─".repeat(126)}`);
  console.log(fail ? `🔴 실패 ${fail}개 — 돈이 걸린 자리다.` : `✅ ${out.length}축 전부 통과`);
  console.log("⚠️ 순수 함수 + 호출부 글자만 잰다 — «원장에 post_premium 한 행이 찍혔나»는 라이브 몫이다.");
  process.exit(fail ? 1 : 0);
})();

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, acc); else if (/\.(ts|mts)$/.test(f)) acc.push(p);
  }
  return acc;
}
