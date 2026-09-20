/**
 * scripts/verify-choice-not-dropped.mjs — 🔴 **손님이 고른 것을 서버가 조용히 버리지 않나** (B · 2026-09-21)
 *
 *   ══ 왜 ══
 *   `plan.html` 의 카드 등록 시트가 «카드번호 직접 입력» 체크박스를 그리고 `payRoute:"keyin"` 을 보내는데,
 *   `billing-key-start` 는 그 값을 **읽지도 않았다.** 🔴 **물어 놓고 버리는 것**이 제일 나쁘다 — 고객은 고른 줄 안다.
 *
 *   🔴 **재 보니 «서버가 받으면 된다»가 답이 아니었다**(2026-09-21 실측):
 *     `lib/billing/billing-key.ts:43` 이 빌키 라인을 `isKeyinMidConfigured() ? "keyin" : (opts.route === "keyin" ? "keyin" : "auth")` 로 정한다.
 *       · 키인 MID **있으면** → 고객이 무엇을 고르든 **언제나 keyin**(고를 것이 없다)
 *       · 키인 MID **없으면** → keyin 을 골라도 `getKiccConfig("keyin")` 이 auth MID 로 떨어진다(고를 수가 없다)
 *     ⇒ **어느 쪽이든 선택이 결과를 못 바꾼다.** 그러니 받아 주는 건 **연극**이고, **묻지 않는 것**이 정답이다.
 *     대신 §9 대로 **무엇이 일어나는지 말해 준다**(`notice`).
 *
 *   ══ 무엇을 재나 (파일만 읽는다 · `safe`) ══
 *     ① 🔴 **화면이 보내는 `payRoute` 를 그 엔드포인트가 실제로 쓴다** — 안 쓰면 «물어 놓고 버리는» 것이다.
 *        «쓴다» = 그 파일이 `resolvePayRoute`/`wantsKeyin` 을 부른다(정본 한 곳 · 여기서 두 번째 판정을 만들지 않는다).
 *     ② 🔴 **못 고르는 자리에는 선택지를 안 띄운다** — 카드 등록은 `keyinOptionForBillingKey()`(= `available:false`)를 쓴다.
 *     ③ 🔴 **안 띄우는 대신 말해 준다**(§9) — 그 서술자의 `notice` 가 비어 있지 않다.
 *     대조군 — 정말 고를 수 있는 자리(코인 단건)는 **그대로 물어보고 그대로 쓴다**.
 *
 *   🔴 **이 자가 못 하는 것**(AC-9):
 *     · KICC 가 그 창을 실제로 어떻게 그리는지는 **못 잰다** — 라이브 실거래가 필요하고 그건 금지다(사장님 선).
 *       우리 쪽 배선까지만 잰다: «MID 가 갈리나 · 청구가 같은 MID 로 가나»는 코드로 확인했고 그 근거를 머리말에 적었다.
 *     · 화면이 `notice` 를 **그리는지**는 안 본다(서버가 싣는 데까지 · 그리는 건 A 몫).
 *
 *   백슬래시 없는 검사만(AC-100) · 주석을 걷고 센다(AC-109 ①).
 *
 *   쓰기: node scripts/verify-choice-not-dropped.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const noHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, " ");
const TPL = noHtml(read("public/app/_tpl.txt"));
const ROUTE = codeOnly(read("lib/pay-route.ts"));

/** `/api/xxx` → 그 경로를 여는 함수 파일. */
const byRoute = new Map();
for (const f of readdirSync("netlify/functions")) {
  if (!f.endsWith(".ts")) continue;
  const p = path.join("netlify/functions", f);
  if (statSync(p).isDirectory()) continue;
  const src = read(p);
  const m = src.match(/export const config\s*=\s*\{[^}]*path:\s*(\[[^\]]*\]|"[^"]*")/);
  if (!m) continue;
  for (const r of m[1].matchAll(/"(\/api\/[a-z0-9-]+)"/g)) byRoute.set(r[1], p);
}

const out = [];
const rec = (step, ok, note) => { out.push({ ok }); console.log(`  ${ok ? "✓" : "✗"} ${step}  — ${note}`); return ok; };

console.log(`\n«손님이 고른 것을 서버가 조용히 버리지 않나» · ${new Date().toISOString()}`);
console.log(`■ 내가 세는 모수 — 화면이 여는 /api 경로 ${byRoute.size}개 중 **payRoute 를 보내는 자리**`);
console.log("─".repeat(120));

/* ① 화면이 payRoute 를 보내는 엔드포인트가 그 값을 실제로 쓰나 */
{
  /* 화면에서 `payRoute` 를 실어 보내는 호출을 찾는다(직접 `body.payRoute = …` 로 붙이는 모양 포함). */
  const senders = new Set();
  for (const m of TPL.matchAll(/UI\.api\("(\/api\/[a-z0-9-]+)"[^;]{0,400}?payRoute/g)) senders.add(m[1]);
  /* 🔴 `keyinBody(sh, { … })` 처럼 **함수가 붙여 주는** 모양도 본다.
     그 경우 몸통을 **앞 줄에서** 만들고 다음 줄에서 `UI.api(…, { body })` 로 보낸다 — 호출 **뒤쪽**을 봐야 한다.
     (첫 판은 «UI.api 안에서 helper 를 부른다»만 봐서 코인 쪽을 통째로 놓쳤다 — «보내는 자리가 없다»고 말하며 초록이 될 뻔했다.) */
  const helpers = [...TPL.matchAll(/const (\w+) = \([^)]*\)\s*=>\s*\{[^}]*payRoute\s*=/g)].map((m) => m[1]);
  for (const h of helpers) {
    for (const m of TPL.matchAll(new RegExp(`\\b${h}\\(`, "g"))) {
      const after = TPL.slice(m.index, m.index + 600);
      const call = after.match(/UI\.api\("(\/api\/[a-z0-9-]+)"/);
      if (call) senders.add(call[1]);
    }
  }

  const dropped = [];
  for (const r of senders) {
    const file = byRoute.get(r);
    const src = file ? codeOnly(read(file)) : "";
    if (!/resolvePayRoute\(|wantsKeyin\(/.test(src)) dropped.push(`${r}${file ? `(${path.basename(file)})` : "(서버 경로를 못 찾았다)"}`);
  }
  rec("① 🔴 화면이 보내는 `payRoute` 를 그 엔드포인트가 **실제로 쓴다**", senders.size > 0 && dropped.length === 0,
    !senders.size ? "화면이 `payRoute` 를 보내는 자리가 없다 — 묻지 않으니 버릴 것도 없다"
      : dropped.length ? `🔴 물어 놓고 버리는 자리 ${dropped.length}곳: ${dropped.join(" · ")} — 고객은 고른 줄 안다`
        : `보내는 ${senders.size}곳이 전부 \`resolvePayRoute\`(정본)를 지난다`);
}

/* ② 못 고르는 자리에는 선택지를 안 띄우나 */
{
  const sub = codeOnly(read("netlify/functions/subscription.ts"));
  const usesBk = /keyinOptionForBillingKey\(\)/.test(sub);
  const usesPlain = /[^A-Za-z]keyinOption\(\)/.test(sub);
  const declared = /available: false/.test(ROUTE) && /export async function keyinOptionForBillingKey/.test(ROUTE);
  rec("② 🔴 **못 고르는 자리에는 선택지를 안 띄운다**(카드 등록)", usesBk && !usesPlain && declared,
    !declared ? "🔴 `keyinOptionForBillingKey`(available:false)가 없다"
      : usesPlain ? "🔴 카드 등록이 단건용 서술자(`keyinOption`)를 쓴다 — 고를 수 없는 것을 물어보게 된다"
        : usesBk ? "카드 등록은 `available:false` 를 내려보낸다 — 화면이 체크박스를 아예 안 그린다"
          : "🔴 카드 등록이 어떤 서술자도 안 쓴다");
}

/* ③ 안 띄우는 대신 말해 주나(§9) */
{
  const body = (ROUTE.match(/export async function keyinOptionForBillingKey[\s\S]*?\n\}/) || [""])[0];
  const notices = [...body.matchAll(/notice:[\s\S]*?\n/g)].map((m) => m[0]);
  const hasBoth = /isKeyinMidConfigured\(\)\s*\?/.test(body) && (body.match(/"[^"]*요\./g) || []).length >= 2;
  rec("③ 🔴 **안 띄우는 대신 말해 준다**(§9 — 막는 게 아니라 알려 주는 것)", hasBoth,
    hasBoth ? "키인 MID 가 있을 때와 없을 때 **각각** 무슨 창이 열리는지 한 문장씩 내려보낸다"
      : `🔴 \`notice\` 가 비었거나 한 경우만 말한다(${notices.length}개) — 안 띄우기만 하면 그냥 사라진 것이다`);
}

/* 대조군 — 정말 고를 수 있는 자리는 그대로 물어보고 그대로 쓴다 */
{
  const coin = codeOnly(read("netlify/functions/coin-purchase.ts"));
  const asks = /keyinOption\(\)/.test(coin);
  const uses = /resolvePayRoute\(/.test(coin);
  rec("대조군 — **고를 수 있는 자리는 그대로 둔다**(이 자가 «다 지워라»가 아니다)", asks && uses,
    asks && uses ? "코인 단건은 `keyinOption()` 으로 물어보고 `resolvePayRoute()` 로 쓴다 — 이 모양이 정답이다"
      : `🔴 단건 쪽이 무너졌다 — 물어보나=${asks} · 쓰나=${uses}`);
}

console.log("─".repeat(120));
const bad = out.filter((x) => !x.ok).length;
console.log(bad ? `🔴 FAIL ${bad} / ${out.length}` : `PASS ${out.length} · FAIL 0`);
console.log("🔴 이 자는 **우리 배선**까지 잰다 — KICC 창이 실제로 어떻게 뜨는지는 라이브 실거래가 필요해 못 잰다(머리말).");
process.exit(bad ? 1 : 0);
