/**
 * scripts/verify-401-surface.mjs — 🔴 **«서버가 보낸 사람말이 손님에게 닿나»**(C · 수리 라운드 2026-09-19 · A④).
 *   사용: node scripts/verify-401-surface.mjs
 *         node scripts/verify-401-surface.mjs --list   (본 짝을 전부 찍는다)
 *
 *   ══ 왜 이 자가 있나 ══
 *   2026-09-19 시나리오 A: 설정에서 **현재 비밀번호를 한 번 틀렸더니 손님이 로그인 화면으로 쫓겨났다.**
 *   서버는 사람말을 제대로 보냈다 — `401 {"error":"현재 비밀번호가 맞지 않아요.","step":"current"}`.
 *   화면 코드도 **그 말을 칸 밑에 띄우게 적혀 있다** — `settings.html:220 UI.fieldError(f, "current", r.error)`.
 *   🔴 **그 줄에 닿기 전에 페이지가 떠나 버린다.** `public/js/ui.js:17~25` 의 `UI.api` 가
 *   **모든 401 을 «세션이 끊겼다»로만** 읽고 `location.href = "/login.html?next=…"` 로 내보내기 때문이다.
 *   손님이 보는 화면은 `/login.html` 이고 큰 글씨는 «다시 만나서 반가워요»다. 왜 안 됐는지는 **어디에도 없다.**
 *
 *   ══ 무엇을 세는가 — 🔴 «세션 401 / 아닌 401» 을 **분류하지 않는다** ══
 *   낱말로 갈래를 나누면(`step` 이 `expired` 면 세션 …) 어휘가 바뀌는 날 자가 낡는다(AC-78).
 *   ⇒ 대신 **화면의 뜻**을 읽는다: 그 호출의 **응답 `error` 를 화면에 띄우려고 적어 둔 자리**가 있는데
 *     `noRedirect: true` 가 없으면 — **그 말은 절대 못 뜬다.** 화면이 «보여 주겠다»고 해 놓고 못 보여 주는 것이다.
 *   이 리포의 관례가 이미 그렇게 갈려 있다(둘 다 실측):
 *     `login.html` → `auth-login` … `noRedirect: true` ✅ · `ops/password.html` → `ops-change-password` … `noRedirect: true` ✅
 *     `app/settings.html` → `auth-change-password` … **없다** 🔴
 *
 *   ══ 🔴 이 자가 **아직 못 하는 것**(못으로 박아 둔다 · AC-109 ㉰) ══
 *   · 🔴 **경로 ↔ 401 짝짓기가 «파일 단위»다.** `runner.ts` 처럼 한 파일이 러너 토큰 경로와 로그인 경로를
 *     같이 서비스하면, **화면이 절대 못 받는 401** 까지 그 화면 것으로 센다. 그래서 판정을 «칸 밑 오류»로 좁혔고
 *     나머지는 «△ 살펴볼 것»으로만 찍는다. **라우트 블록까지 좁히는 것이 다음 사람 몫이다.**
 *   · 🔴 «칸 밑»이 아닌 방법으로 띄우는 자리는 **판정 밖**이다 — 그중엔 진짜 결함도 섞여 있을 수 있다(«못 쟀음»).
 *   · 401 을 **안 내는** 경로에 `noRedirect` 가 빠진 것은 안 센다(내쫓길 일이 없다).
 *   · 화면이 `r.error` 를 **다른 이름으로** 받아 띄우면(구조분해 등) 못 본다 — 이 리포 관례는 `r.error` 다.
 *   · «띄우려 한다»는 글자로 본다 — 진짜 눈에 띄는지는 `verify-paint.mjs` 쪽 이야기다.
 *
 *   종료코드: 0 = 사람말이 다 닿는다 · 1 = 못 닿는 자리가 있다 · 2 = 못 쟀다.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.env.SURFACE_401_ROOT ? path.resolve(process.env.SURFACE_401_ROOT) : path.resolve(import.meta.dirname, "..");
const PUB = path.join(ROOT, "public");
const FN = path.join(ROOT, "netlify", "functions");
const LIST = process.argv.includes("--list");
if (!existsSync(PUB) || !existsSync(FN)) { console.error("⊘ 못 쟀어요 — public/ 또는 netlify/functions/ 가 없습니다."); process.exit(2); }

const out = [];
const rec = (step, ok, note) => { out.push({ step, ok, note }); console.log(`  ${ok ? "✓" : "✗"} ${step}  — ${note}`); return ok; };
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
function walk(dir, re, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, re, acc);
    else if (re.test(e.name)) acc.push(p);
  }
  return acc;
}

/* ═══ ① 401 을 내는 경로 — 핸들러에서 폴더째 찾는다 ═══ */
const routes401 = new Map();   // 경로 → { file, steps[] }
for (const f of walk(FN, /\.ts$/)) {
  const src = codeOnly(readFileSync(f, "utf8"));
  const hits = [...src.matchAll(/json\s*\(\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\s*,\s*401\s*\)/g)];
  if (!hits.length) continue;
  /* 🔴 **사람말을 실은 401 만** 본다 — `error:` 가 없으면 화면이 띄울 말도 없다. */
  const withWords = hits.filter((h) => /\berror\s*:/.test(h[1]));
  if (!withWords.length) continue;
  const steps = withWords.map((h) => (h[1].match(/step\s*:\s*["'`]([^"'`]+)/) ?? [])[1] ?? "(step없음)");
  const cfg = src.match(/export\s+const\s+config\s*=\s*\{[^}]*?path\s*:\s*(\[[^\]]*\]|["'][^"']*["'])/s);
  const paths = cfg ? (cfg[1].match(/["'`](\/[^"'`]+)["'`]/g) ?? []).map((s) => s.slice(1, -1)) : [];
  for (const p of paths) routes401.set(p, { file: rel(f), steps: [...new Set(steps)] });
}

/* ═══ ② 화면이 그 말을 «띄우려고» 적어 뒀나 · 띄울 수 있게 돼 있나 ═══ */
/** `UI.api(` 부터 괄호 균형으로 인자를 잘라 온다. */
function sliceCall(src, from) {
  let d = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "(") d++;
    else if (src[i] === ")") { d--; if (!d) return src.slice(from, i + 1); }
  }
  return src.slice(from, from + 300);
}
/* 🔴 **«칸 밑에 띄우는 말»만 본다**(`UI.fieldError`). 이유가 있다 —
   첫 판은 `UI.toast`·`textContent=` 까지 «띄우려는 뜻»으로 셌더니 **11곳 중 일곱이 거짓 빨강**이었다:
     · `runner.ts` 의 401 은 **러너 토큰 경로**의 것이라 화면(`runner-list` 등)은 애초에 그걸 못 받는다
       (내 경로↔401 짝짓기가 **파일 단위**여서 생긴 잘못이다 — 다른 자에서 이미 한 번 밟은 병이다)
     · `home-summary` 의 `step:"user"` 는 **정말 세션이 끊긴 것**이라 로그인으로 내보내는 게 **맞다**
   🔴 **칸 밑 오류는 «사람이 방금 친 값이 틀렸다»는 뜻이라 세션 문제일 수가 없다.** 그래서 이 모양만 보면
   갈래를 낱말로 분류하지 않고도(AC-78) **틀림없이 틀린 자리**만 남는다. 좁아진 대가는 아래 «못 하는 것»에 적었다. */
const SHOWS = /UI\.fieldError\s*\(/;

const pairs = [];
for (const f of walk(PUB, /\.(html|js)$/)) {
  const screen = rel(f);
  if (screen === "public/js/ui.js") continue;              // 틀 자신 — `UI.api` 가 거기 산다
  const src = codeOnly(readFileSync(f, "utf8"));
  for (const m of src.matchAll(/UI\.api\s*\(/g)) {
    const call = sliceCall(src, m.index + m[0].length - 1);
    const pm = call.match(/^\(\s*["'`](\/api\/[A-Za-z0-9_-]+)/);
    if (!pm) continue;
    const route = pm[1];
    const info = routes401.get(route);
    if (!info) continue;                                    // 401 을 안 내는 경로는 볼 것 없다
    const noRedirect = /\bnoRedirect\s*:\s*true/.test(call);
    /* 그 호출 **뒤 300자** 안에서 «응답 error 를 띄우는» 자리를 찾는다(이 리포는 한 줄로 이어 쓴다). */
    const after = src.slice(m.index, m.index + call.length + 300);
    const wantsToShow = /\.error\b/.test(after) && SHOWS.test(after);
    /* 좁히면서 잃은 신호 — «다른 방법으로 띄우려는» 자리는 판정 밖이지만 **버리지는 않는다.** */
    const softShow = !wantsToShow && /\.error\b/.test(after) && /(UI\.toast|UI\.sheet|UI\.done|UI\.err|textContent\s*=|innerHTML\s*=)/.test(after);
    pairs.push({ screen, route, noRedirect, wantsToShow, softShow, steps: info.steps, server: info.file });
  }
}

console.log(`\n«서버가 보낸 사람말이 손님에게 닿나» — 401 을 내는 경로 ${routes401.size}개 · ${new Date().toISOString()}`);
console.log("─".repeat(120));
if (LIST) for (const p of pairs) console.log(`  ${p.wantsToShow ? (p.noRedirect ? "✓닿는다" : "🔴못닿는다") : "·안띄움"}  ${p.route.padEnd(26)} ${p.screen.padEnd(30)} step[${p.steps.join(",")}]`);

const broken = pairs.filter((p) => p.wantsToShow && !p.noRedirect);
const good = pairs.filter((p) => p.wantsToShow && p.noRedirect);

rec("🔴 화면이 **띄우겠다고 적어 둔** 401 사람말은 실제로 닿는다(`noRedirect: true`)", broken.length === 0,
  broken.length ? `못 닿는 자리 ${broken.length}곳 / 띄우려는 자리 ${broken.length + good.length}곳` : `띄우려는 자리 ${good.length}곳 전부 닿는다`);
for (const b of broken) {
  console.log(`   🔴 ${b.route}`);
  console.log(`      화면 ${b.screen} 이 \`r.error\` 를 띄우게 적어 뒀는데 \`noRedirect: true\` 가 없다`);
  console.log(`      서버 ${b.server} 가 401 로 보내는 말: step[${b.steps.join(", ")}]`);
  console.log(`      ⇒ \`UI.api\`(ui.js:17~25)가 **모든 401 을 세션 끊김으로** 읽고 내보낸다. 그 줄에 닿기 전에 페이지가 떠난다.`);
}
const soft = pairs.filter((p) => p.softShow && !p.noRedirect);
if (soft.length) {
  console.log(`\n△ 살펴볼 것 — 칸 밑이 아니라 **다른 방법으로** 401 사람말을 띄우려는 자리(판정 밖 · 사람이 본다):`);
  for (const s of soft) console.log(`   · ${s.route.padEnd(26)} ${s.screen}  step[${s.steps.join(",")}]`);
  console.log(`   🔴 이 중 «정말 세션이 끊긴 401»(예: home-summary step:user)은 **내보내는 게 맞다** — 그래서 판정에 안 넣었다.`);
  console.log(`   🔴 그리고 \`runner.ts\` 의 401 은 **러너 토큰 경로**의 것이라 화면은 애초에 못 받는다(경로↔401 짝짓기가 파일 단위인 한계).`);
}

rec("대조군 — **제대로 된 자리도 있다**(이 자가 둘을 가른다)", good.length > 0,
  good.length ? `${good.slice(0, 4).map((g) => `${g.screen.replace("public/", "")}→${g.route.replace("/api/", "")}`).join(", ")}` : "🔴 하나도 없다 — 가른 적이 없다");

/* ═══ ⓪ 자기 찌르기 — 🔴 «우는가»를 잰다(AC-108) ═══ */
{
  const judge = (calls) => calls.filter((c) => c.wantsToShow && !c.noRedirect).length;
  rec("⓪a 자기 찌르기 — `noRedirect` 를 **붙이면** 그 빨강이 사라진다",
    judge(pairs.map((p) => (p.screen === "public/app/settings.html" && p.route === "/api/auth-change-password" ? { ...p, noRedirect: true } : p))) < broken.length,
    `붙인 뒤 ${judge(pairs.map((p) => (p.screen === "public/app/settings.html" && p.route === "/api/auth-change-password" ? { ...p, noRedirect: true } : p)))}곳`);
  rec("⓪b 자기 찌르기 — **멀쩡한 자리에서 `noRedirect` 를 떼면 운다**",
    judge(pairs.map((p) => (p.noRedirect ? { ...p, noRedirect: false } : p))) > broken.length,
    `전부 떼면 ${judge(pairs.map((p) => ({ ...p, noRedirect: false })))}곳이 운다(지금 ${broken.length}곳)`);
  rec("⓪c 자기 찌르기 — **띄울 뜻이 없는 호출은 안 센다**(거짓 빨강 방지)",
    judge(pairs.map((p) => ({ ...p, wantsToShow: false }))) === 0,
    `띄울 뜻을 지우면 ${judge(pairs.map((p) => ({ ...p, wantsToShow: false })))}곳 — 401 을 내도 «안 띄우는» 호출은 이 축 밖이다`);
}

console.log("─".repeat(120));
const fails = out.filter((o) => !o.ok);
console.log(`PASS ${out.length - fails.length} · FAIL ${fails.length} · 본 짝 ${pairs.length}쌍(띄우려는 자리 ${broken.length + good.length})`);
console.log("🔴 이 자는 «닿나»만 잰다 — 그 말이 눈에 띄나는 `verify-paint.mjs` 쪽이다.\n");
process.exit(fails.length ? 1 : 0);
