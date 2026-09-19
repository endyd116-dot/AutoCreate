/**
 * scripts/verify-soft-door-pair.mts — 🔴 **같은 소프트 규칙인데 «넘길 문»이 한쪽에만 있나.**
 *
 *   사용:  npx --yes tsx scripts/verify-soft-door-pair.mts            (0 = 전부 통과)
 *          npx --yes tsx scripts/verify-soft-door-pair.mts --mutate   (🔴 스스로 망가뜨려 본다 · AC-108)
 *
 *   ══ 왜 (2026-09-20 B2 · 하루에 **두 번** 나왔다) ══
 *     ① 워밍업은 §9 로 **소프트**다(«우리 추정이지 규칙이 아니다»). `publish-now` 에는 «그래도 올릴래요» 문이
 *        **처음부터 있었는데** 글을 **만드는** 쪽(`pieces-self` → `checkCadenceAt`)에는 **없었다.**
 *        ⇒ 🔴 주간 몫을 쓴 고객은 **글을 아예 못 썼다 — 나중에 올릴 예약조차.**
 *     ② 그리고 그때 하는 말이 «**다른 날로 잡아 주세요**» 였다. `cap 0` 은 **모든 날짜를 막는다** ⇒
 *        🔴 **할 수 없는 일을 하라고 안내했다.** 막는 것보다 **틀린 길을 가리키는 것**이 나쁘다.
 *
 *   🔴 `verify-gate-pair`(막는 손 ↔ 푸는 손)의 **사촌**이다. 거기는 «막았으면 푸는 손이 있나»,
 *      여기는 «**소프트 규칙이면 넘길 문이 모든 입구에 있나**».
 *
 *   🔴 DB 0 · 네트워크 0 · 순수 함수와 소스만 본다.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
/** 리포의 주석 걷기 소도구 — 🔴 두 벌로 만들지 않는다(`verify-safe-list` 도 이걸 쓴다). */
import { codeOnly } from "./_lib/code-only.mjs";

const MUTATE = process.argv.includes("--mutate");
let bad = 0, measured = 0;
const rec = (name: string, ok: boolean, detail = "") => {
  measured++; if (!ok) bad++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function run(): Promise<void> {
  const { effectiveDailyCap } = await import("../lib/warmup.js");
  const { ensurePhotoCreditHtml } = await import("../lib/publish/gate.js");

  /* 주간 몫을 다 쓴 새 계정 — 오늘 이 계정이 실제로 그 상태였다. */
  const warm = { openedAt: null, createdAt: new Date(Date.now() - 86_400_000).toISOString(), off: false, postsThisWeek: 1 };
  const CUSTOMER_CAP = 2;

  console.log("\n① 🔴 문이 **양쪽에** 있나 — 소프트 규칙은 모든 입구에서 같아야 한다");
  rec("문을 안 열면 워밍업이 막는다(0)", effectiveDailyCap(CUSTOMER_CAP, warm, new Date()) === 0);
  rec("문을 열면 자리가 생긴다(1)", effectiveDailyCap(CUSTOMER_CAP, warm, new Date(), { override: true }) === 1);

  /* 🔴 **주석을 걷고 본다**(AC-109 · AC-117). 내 주석에 옛 문구를 **인용**해 뒀더니 그 축이 내 설명을 잡았다 —
     그러면 사람은 주석이 아니라 **축을 지운다**. 코드만 본다. 리포에 이미 있는 소도구를 쓴다(두 벌 금지). */
  const cad = codeOnly(readFileSync("lib/cadence-check.ts", "utf8")) as string;
  const pub = readFileSync("netlify/functions/publish-now.ts", "utf8");
  const self = readFileSync("netlify/functions/pieces-self.ts", "utf8");
  const pself = codeOnly(readFileSync("lib/piece-self.ts", "utf8")) as string;
  /* 🔴 **캡 호출에 못 박는다.** 종전엔 «`override: a.warmupOverride` 라는 글자가 어딘가 있나»만 봤는데,
     간격 쪽에 같은 글자가 생기자 **캡 문을 도로 막아도 이 축이 통과했다**(변이가 잡아 줬다).
     축이 «어느 함수의» 문인지 말하지 않으면, 옆에 같은 글자가 생기는 순간 **우연한 덮개**가 된다. */
  rec("🔴 **쓰기** 입구에 문이 있다(`checkCadenceAt` 이 override 를 받는다)",
    /warmupOverride\?:\s*boolean/.test(cad) && /effectiveDailyCap\([\s\S]{0,90}override: a\.warmupOverride === true/.test(cad));
  rec("🔴 **발행** 입구에 문이 있다(`publish-now`)", /override:\s*warmupOverride/.test(pub));
  rec("🔴 두 입구가 **같은 낱말**을 쓴다(화면이 두 말을 안 하게 · AC-52)",
    /warmupOverride/.test(pub) && /warmupOverride/.test(self) && /warmupOverride/.test(pself));
  rec("🔴 고객이 **직접 누른 것**만 연다(기본은 닫혀 있다)", /b\.warmupOverride === true/.test(self) && /a\.warmupOverride === true/.test(pself));

  console.log("\n② 🔴 넘겨도 **고객이 정한 값**은 못 넘는다(워밍업만 소프트 · daily_cap 은 하드)");
  rec("문을 열어도 daily_cap 위로는 안 올라간다",
    effectiveDailyCap(1, { ...warm, postsThisWeek: 1 }, new Date(), { override: true }) === 1, "daily_cap=1 이면 1");
  rec("두 입구가 **같은 선**을 긋는다(`customerCap` 을 천장으로)",
    /const cap = a\.warmupOverride === true \? customerCap : warmCap/.test(cad) && /const cap = warmupOverride \? customerCap : warmCap/.test(pub));

  console.log("\n②-b 🔴 **캡에만 문을 내면 안 된다** — 같은 «우리 추정»인 간격에도 있어야 한다");
  const { effectiveMinGapMin } = await import("../lib/warmup.js");
  const CUSTOMER_GAP = 180;
  rec("문을 안 열면 워밍업이 간격을 올린다(360)", effectiveMinGapMin(CUSTOMER_GAP, warm, new Date()) === 360);
  rec("🔴 문을 열면 **고객이 정한 간격**으로 돌아간다(180)", effectiveMinGapMin(CUSTOMER_GAP, warm, new Date(), { override: true }) === CUSTOMER_GAP);
  rec("🔴 열어도 **고객 값 아래로는 안 내려간다**(우리가 더 풀어 주지 않는다)",
    effectiveMinGapMin(600, warm, new Date(), { override: true }) === 600, "고객이 600분이면 600분");
  rec("🔴 캐던스가 그 문을 간격에도 넘긴다(⚠️ 배선)", /effectiveMinGapMin\([\s\S]{0,90}override: a\.warmupOverride === true/.test(cad));

  console.log("\n③ 🔴 안내가 **할 수 있는 일**을 가리키나(§3 ①사실 ②어떻게 ③우리가 해 주는 것)");
  rec("🔴 «다른 날로 잡아 주세요»를 cap 0 자리에 **안 쓴다**(모든 날짜가 막히는데 그렇게 말했다)",
    !/cap === 0[\s\S]{0,220}다른 날로 잡아 주세요/.test(cad));
  rec("넘길 문이 도움이 될 때 그 문을 **말해 준다**", /그래도 올릴래요/.test(cad));
  rec("도움이 안 될 땐 **사실만** 말한다(없는 길을 권하지 않는다)", /다음 주가 되면 다시 올릴 수 있어요/.test(cad));
  rec("🔴 겁주거나 발뺌하지 않는다(§3)", !/정지|불이익|책임|알려만/.test(cad));
  rec("🔴 `canOverride` 가 화면까지 흘러간다(끊기면 우리가 낸 문이 **없는 문**이 된다 · AC-69)",
    /canOverride\?: boolean/.test(cad) && /canOverride\?: boolean/.test(pself));

  console.log("\n④ 발행 본문 손질이 **멱등한가**(곁가지 — 메인이 넘긴 `gate.ts` 백스페이스 건)");
  const imgs = [{ url: "x", sort: 0, source: { kind: "stock" }, stock: { provider: "pexels", author: "Jane", sourceUrl: "https://p/1" } }];
  let html = "<p>본문</p>";
  for (let i = 0; i < 3; i++) html = ensurePhotoCreditHtml(html, imgs as never);
  rec("🔴 사진 출처를 세 번 붙여도 **한 덩이**다(쌓이면 남의 블로그에 같은 줄이 늘어난다)",
    (html.match(/class="photo-credit"/g) || []).length === 1, `${(html.match(/class="photo-credit"/g) || []).length}덩이`);
  /* 🔴 [2026-09-20 넓혔다] 종전엔 `lib/publish/gate.ts` **한 파일**만 봤다. 그런데 같은 날 **두 번째**가 났다 —
     내가 파이썬 heredoc 으로 `\b` 를 쓰다 `runner/lib/plan.mjs` 에 **진짜 백스페이스**를 박았고,
     정규식이 `<a\b` 대신 `<a` 가 되어 **링크 걷기가 통째로 안 먹었다**(그런데 문법 오류는 안 난다).
     🔴 `grep`·편집기는 백스페이스를 «앞 글자 지우기»로 그려서 **눈으로는 정상으로 보인다.**
     ⇒ **나무 전체를 훑는다.** 한 파일만 보는 축은 다음 파일에서 그대로 뚫린다. */
  const roots = ["lib", "runner/lib", "runner/channels", "netlify/functions", "scripts", "db"];
  const bad08: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const f = `${dir}/${e.name}`;
      if (e.isDirectory()) { walk(f); continue; }
      if (!/\.(ts|mts|mjs|js|json)$/.test(e.name)) continue;
      if (readFileSync(f).includes(0x08)) bad08.push(f);
    }
  };
  for (const r of roots) { try { walk(r); } catch { /* 없는 폴더는 건너뛴다 */ } }
  rec("🔴 소스 **전체**에 보이지 않는 글자(0x08)가 없다 — `grep` 은 이걸 정상으로 그린다",
    bad08.length === 0, bad08.length ? bad08.join(" · ") : `${roots.length}개 뿌리를 훑었다`);
}

const MUTANTS = [
  { what: "쓰기 입구의 문을 도로 막는다(= 2026-09-20 이전 · 고객이 글을 아예 못 쓴다)",
    file: "lib/cadence-check.ts", from: "const warmCap = effectiveDailyCap(customerCap, warm, at, { override: a.warmupOverride === true });",
    to: "const warmCap = effectiveDailyCap(customerCap, warm, at);", expect: "**쓰기** 입구에 문이 있다" },
  { what: "넘기면 고객이 정한 값까지 넘게 한다(하드 선을 무르게)",
    file: "lib/cadence-check.ts", from: "const cap = a.warmupOverride === true ? customerCap : warmCap;",
    to: "const cap = a.warmupOverride === true ? 99 : warmCap;", expect: "두 입구가 **같은 선**을 긋는다" },
  { what: "«다른 날로 잡아 주세요»를 도로 쓴다(할 수 없는 일을 하라고 안내)",
    file: "lib/cadence-check.ts", from: `: "이 계정은 이번 주 몫을 다 썼어요(새로 연결한 계정은 천천히 늘려요). 다음 주가 되면 다시 올릴 수 있어요.")`,
    to: `: "이 계정은 이번 주 몫을 다 썼어요. 다른 날로 잡아 주세요.")`, expect: "«다른 날로 잡아 주세요»를 cap 0 자리에 **안 쓴다**" },
  { what: "간격에는 문을 안 낸다(캡 문으로 들어가도 «360분 띄워요»에 막힌다 · 2026-09-20 실물)",
    file: "lib/cadence-check.ts", from: "const gapMin = effectiveMinGapMin(n(acc.min_gap_min) || 180, warm, at, { override: a.warmupOverride === true });",
    to: "const gapMin = effectiveMinGapMin(n(acc.min_gap_min) || 180, warm, at);", expect: "캐던스가 그 문을 간격에도 넘긴다" },
  { what: "문을 열면 고객이 정한 간격보다 **더** 풀어 준다(고객 설정이 무의미해진다)",
    file: "lib/warmup.ts", from: "  if (opts?.override) return gap;", to: "  if (opts?.override) return 0;", expect: "고객 값 아래로는 안 내려간다" },
  { what: "`canOverride` 를 화면까지 안 흘린다(우리가 낸 문이 없는 문이 된다)",
    file: "lib/piece-self.ts", from: "postsToday?: number; capped?: boolean; canOverride?: boolean };",
    to: "postsToday?: number; capped?: boolean };", expect: "`canOverride` 가 화면까지 흘러간다" },
];

async function mutate(): Promise<void> {
  console.log("\n🔴 변이 — 일부러 망가뜨려 본다(안 울면 이 자는 값이 0 이다)\n");
  for (const m of MUTANTS) {
    const orig = readFileSync(m.file, "utf8");
    if (!orig.includes(m.from)) { console.log(`  ⊘ «${m.what}» — 심을 자리를 못 찾았다(자가 낡았다)`); bad++; continue; }
    try {
      writeFileSync(m.file, orig.replace(m.from, m.to));
      let caught = false, out = "";
      try { execFileSync("npx", ["--yes", "tsx", "scripts/verify-soft-door-pair.mts"], { encoding: "utf8", stdio: "pipe", shell: true }); }
      catch (e) { caught = true; out = String((e as { stdout?: string })?.stdout ?? ""); }
      const byName = caught && out.split("\n").some((l) => l.startsWith("  ✗") && l.includes(m.expect));
      console.log(`  ${byName ? "✓" : "✗"} «${m.what}» — ${caught ? (byName ? `잡혔다(맞는 축 «${m.expect}»)` : "딴 축이 잡았다(우연한 덮개)") : "🔴 안 잡혔다"}`);
      if (!byName) bad++;
    } finally {
      writeFileSync(m.file, orig);
      if (readFileSync(m.file, "utf8") !== orig) { console.error(`🔴🔴 되돌리기 실패 — ${m.file} 를 손으로 확인하라`); process.exit(1); }
    }
  }
}

console.log("■ 소프트 규칙이면 «넘길 문»이 모든 입구에 있나 (verify-gate-pair 의 사촌)");
await run();
if (MUTATE) await mutate();
console.log(`\n${bad ? `🔴 실패 ${bad}` : `✅ 잰 ${measured}축 전부 통과`}`);
process.exit(bad ? 1 : 0);
