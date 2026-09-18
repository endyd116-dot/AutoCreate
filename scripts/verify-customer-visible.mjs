/**
 * scripts/verify-customer-visible.mjs — 🔴 **«가입한 손님이 운영 화면에서 보이나»**(C · 수리 라운드 2026-09-19).
 *   사용: node scripts/verify-customer-visible.mjs
 *         node scripts/verify-customer-visible.mjs --list   (삼켜지는 이름을 전부 찍는다)
 *
 *   ══ 왜 이 자가 있나 — 운영자가 손님에게 «가입 기록이 없는데요»라고 말하게 된다 ══
 *   2026-09-19 시나리오 B 가 **진짜로 가입하는 손님**을 하나 만들어 끝까지 눌러 봤다 —
 *   「스모크하우스 바베큐」(`smokehouse@naver.com`). 고깃집이다.
 *     가입 직후            → `ops-tenants?q=smokehouse` **total 1** ✅ 보인다
 *     하루 한 번 도는 크론이 돌고 나면 → **내부로 켬**
 *     그 뒤                → **total 0** · 화면은 «**0곳**» + 빈 표
 *   `lib/ops/internal.ts:23 INTERNAL_KEY_RE` 에 `smoke` 가 있고, 테넌트 키는 **가입 메일 앞부분**에서 나온다
 *   (`lib/validate.ts:14 tenantKeyFrom`). ⇒ **상호가 그 낱말로 시작하는 진짜 손님이 통째로 사라진다.**
 *
 *   🔴 **세 겹으로 나쁘다**
 *     ① 규칙이 진짜 상호를 삼킨다(아래 ①축).
 *     ② 서버는 «N집 숨겼다»고 **말해 주는데**(`ops-tenants.ts:83` `internal:{excluded,hidden}`)
 *        **화면이 그 말을 버린다** — `public/ops/tenants.html` 에 `internal` 이라는 글자가 **한 번도 안 나온다**(아래 ②축).
 *     ③ 숨은 줄 알아도 **꺼낼 손잡이가 화면에 없다**(`internal=1` 을 보내는 화면이 0곳 · 아래 ③축).
 *
 *   ══ 🔴 왜 «한 줄짜리 자»로는 못 막았나 ══
 *   `tsc` 도 `verify-r8-deadends`(«정의가 있나»·«호출이 있나») 도 이 병을 못 본다 —
 *   **정의도 있고 호출도 있다.** 틀린 것은 **규칙이 무엇을 삼키는가**이고, 그건 **이름을 넣어 봐야** 안다.
 *
 *   ══ ①축의 «손님 이름»은 어디서 오나 — 🔴 정직하게 적는다 ══
 *   이 축만은 **표본이 필요하다**(규칙이 «우리»와 «손님»을 가르는지 보려면 손님 이름이 있어야 한다).
 *   아래 `CUSTOMERS` 는 **내가 고른 그럴듯한 상호**다 — 라이브에서 긁어 온 것이 아니다.
 *   🔴 그래서 이 축은 «**이 이름들은 삼켜진다**»까지만 증명한다. «삼켜지는 이름이 이것뿐»은 증명하지 않는다.
 *   (라이브 손님은 지금 0곳이라 긁어 올 것이 없다 — 손님이 생기면 그때 진짜 표본으로 바꿔라.)
 *
 *   ══ 🔴 이 자가 **아직 못 하는 것**(못으로 박아 둔다 · AC-109 ㉰) ══
 *   · 라이브 왕복은 안 한다(DB·네트워크 0). «화면에 정말 뜨나»는 시나리오 B 가 브라우저로 잰다.
 *   · 🔴 **①축은 «키 규칙»만 본다**(그게 진짜 상호를 삼키는 그 규칙이라). **대조군은 «도메인 + 키»를 같이 본다** —
 *     제품이 그렇게 가르기 때문이다(`internal.ts:72~74`·`:83`). 이 둘을 섞어 재면 한쪽이 거짓 빨강을 낸다(아래 주석).
 *   · 셋째 신호 «**사용자가 아예 없는 집**»은 안 본다 — 글자로는 못 재고 DB 를 타야 한다(«못 쟀음»).
 *   · `is_internal` 을 **손으로 켠 것**(`internal_manual_at`)은 안 본다.
 *
 *   종료코드: 0 = 손님이 안 사라진다 · 1 = 사라진다 · 2 = 못 쟀다.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.env.CUSTOMER_VISIBLE_ROOT ? path.resolve(process.env.CUSTOMER_VISIBLE_ROOT) : path.resolve(import.meta.dirname, "..");
const LIST = process.argv.includes("--list");
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
const out = [];
const rec = (step, ok, note) => { out.push({ step, ok, note }); console.log(`  ${ok ? "✓" : "✗"} ${step}  — ${note}`); return ok; };

/* ═══ 규칙과 키 만들기를 **제품 소스에서 그대로 읽어 온다** ═══
   🔴 여기 베껴 적으면 규칙이 바뀐 날 이 자가 낡는다(AC-78). 글자로 뽑아 쓴다. */
const internalSrc = path.join(ROOT, "lib", "ops", "internal.ts");
const validateSrc = path.join(ROOT, "lib", "validate.ts");
if (!existsSync(internalSrc) || !existsSync(validateSrc)) { console.error("⊘ 못 쟀어요 — lib/ops/internal.ts · lib/validate.ts 가 없습니다."); process.exit(2); }
const mRe = codeOnly(readFileSync(internalSrc, "utf8")).match(/INTERNAL_KEY_RE\s*=\s*\/(.+?)\/([a-z]*)\s*;/);
if (!mRe) { console.error("⊘ 못 쟀어요 — INTERNAL_KEY_RE 를 소스에서 못 읽었습니다(이 자가 낡았습니다)."); process.exit(2); }
const KEY_RE = new RegExp(mRe[1], mRe[2]);
const mKey = codeOnly(readFileSync(validateSrc, "utf8")).match(/tenantKeyFrom[\s\S]{0,300}?replace\(([^)]+)\)[\s\S]{0,40}?slice\(0,\s*(\d+)\)/);
const KEY_LEN = mKey ? Number(mKey[2]) : 12;
/** 제품과 **같은 식**으로 메일에서 키 앞부분을 만든다(뒤의 난수는 판정에 안 쓰인다 — 정규식이 `^` 로 앞만 본다). */
const keyBaseOf = (email) => email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, KEY_LEN) || "user";

/* ═══ ① 규칙이 진짜 상호를 삼키나 ═══
   🔴 표본이다(머리말 참고). 「우리 것」과 「손님」을 나란히 둬야 **가르는지**를 볼 수 있다. */
const CUSTOMERS = [
  ["smokehouse@naver.com", "스모크하우스 바베큐(고깃집)"],
  ["demolition@gmail.com", "데몰리션 철거"],
  ["skipper@daum.net", "스키퍼 요트"],
  ["testkim@naver.com", "김테스트 사진관(성이 테스트)"],
  ["r2coffee@gmail.com", "R2 커피"],
  ["r3design@naver.com", "R3 디자인"],
  ["demoday@startup.kr", "데모데이 컨설팅"],
  ["harmony@naver.com", "하모니 피아노"],
  ["testarossa@gmail.com", "테스타로사 수입차"],
  ["verygoodfood@naver.com", "베리굿푸드"],
  ["smokedduck@naver.com", "훈제오리 전문점"],
  ["c+cafe@gmail.com", "씨플러스 카페"],
];
/** 대조군 — **우리 것**은 반드시 삼켜져야 한다(안 삼키면 규칙이 아예 안 도는 것이다). */
const OURS = [
  ["verify-p1r7@autocreate.test", "C 검증 하니스"],
  ["smoke-b2@autocreate.test", "B2 스모크"],
  ["harness1@autocreate.test", "하니스"],
  ["p1r5run@autocreate.test", "P1R5 러너"],
];

/* 🔴 **2026-09-19 · B 수리를 받고 대조군을 고쳤다 — 내 자가 과했다.**
   첫 판의 대조군은 «우리 하니스가 **키 규칙에** 걸리나»만 봤다. 그런데 제품은 키 규칙 **하나로만** 가르지 않는다
   (`lib/ops/internal.ts:72~74`·`:83`): ①**내부 메일 도메인** ②키 규칙 ③**사용자가 아예 없는 집**.
   B 가 키 규칙을 좁히자(진짜 상호를 안 삼키게) 내 대조군이 1/4 로 떨어져 **빨개졌는데**,
   🔴 우리 하니스는 전부 `@autocreate.test` 라 **①로 그대로 걸린다** — B 의 수리는 안전하고 **내 자가 틀린 것**이었다.
   «새 결함을 찾았다»고 보고하기 직전이었다(AC-112). ⇒ 대조군도 **제품과 같은 세 신호**로 본다. */
const domMatch = codeOnly(readFileSync(internalSrc, "utf8")).match(/INTERNAL_EMAIL_DOMAINS[^=]*=\s*\[([^\]]*)\]/);
const INTERNAL_DOMAINS = domMatch ? (domMatch[1].match(/["'`]([^"'`]+)["'`]/g) ?? []).map((s) => s.slice(1, -1)) : [];
/** 제품의 `looksInternal` 과 같은 뜻(글자로) — 도메인이거나 키 규칙이거나. */
const looksInternalLike = (email) => INTERNAL_DOMAINS.some((d) => email.toLowerCase().endsWith(`@${d}`)) || KEY_RE.test(keyBaseOf(email));

/** 아무것도 안 맞는 규칙 — 변이에서 «규칙을 비운다»를 뜻한다. */
const NEVER = /$^/;
const swallowed = CUSTOMERS.filter(([e]) => KEY_RE.test(keyBaseOf(e)));
const oursCaught = OURS.filter(([e]) => looksInternalLike(e));
const oursByKeyOnly = OURS.filter(([e]) => KEY_RE.test(keyBaseOf(e)));

console.log(`\n«가입한 손님이 운영 화면에서 보이나» · ${new Date().toISOString()}`);
console.log(`규칙(소스에서 읽음): ${KEY_RE}`);
console.log("─".repeat(120));

rec("① 🔴 규칙이 **진짜 상호를 삼키지 않는다**", swallowed.length === 0,
  swallowed.length ? `손님 표본 ${CUSTOMERS.length}개 중 **${swallowed.length}개가 사라진다**` : `손님 표본 ${CUSTOMERS.length}개 전부 보인다`);
if (swallowed.length && (LIST || true)) for (const [e, who] of swallowed) console.log(`   🔴 ${who.padEnd(26)} ${e.padEnd(28)} → 키 «${keyBaseOf(e)}» 가 규칙에 걸려 **운영 화면에서 사라진다**`);

rec("대조군 — **우리 하니스**는 그대로 내부로 걸린다(도메인·키 세 신호 중 하나로)", oursCaught.length === OURS.length,
  `${oursCaught.length}/${OURS.length} 걸린다 — 그중 **키 규칙으로** 걸리는 것은 ${oursByKeyOnly.length}개(나머지는 내부 메일 도메인이 받는다)`);
/* 🔴 «어느 신호가 받았나»를 찍어 둔다 — 규칙이 또 좁아질 때 **무엇이 받쳐 주고 있는지**를 다음 사람이 알아야 한다. */
console.log(`   내부 메일 도메인(소스에서 읽음): ${INTERNAL_DOMAINS.join(" · ") || "(못 읽음)"}`);
for (const [e, who] of OURS) console.log(`   · ${who.padEnd(14)} ${e.padEnd(30)} 키규칙 ${KEY_RE.test(keyBaseOf(e)) ? "걸림" : "안걸림"} · 도메인 ${INTERNAL_DOMAINS.some((d) => e.toLowerCase().endsWith("@" + d)) ? "걸림" : "안걸림"}`);

/* ═══ ② 서버가 «숨겼다»고 말하면 화면이 그 말을 받나 ═══
   🔴 손 목록이 아니다 — 응답에 «숨김»을 알리는 키를 **서버 소스에서 찾아**, 그 경로를 부르는 화면이 그 키를 읽는지 본다. */
function walk(dir, re, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, re, acc);
    else if (re.test(e.name)) acc.push(p);
  }
  return acc;
}
const FN = path.join(ROOT, "netlify", "functions");
const PUB = path.join(ROOT, "public");
const screens = walk(PUB, /\.(html|js)$/).map((f) => ({ file: rel(f), src: codeOnly(readFileSync(f, "utf8")) }));
/** 응답에 «몇 집을 숨겼다»를 싣는 자리 — `internal: {` · `hidden:` 를 **json(...)** 안에서 찾는다. */
const hideTellers = [];
for (const f of walk(FN, /\.ts$/)) {
  const src = codeOnly(readFileSync(f, "utf8"));
  if (!/json\([^;]*\binternal\s*:\s*\{/.test(src)) continue;
  const cfg = src.match(/export\s+const\s+config\s*=\s*\{[^}]*?path\s*:\s*(\[[^\]]*\])/s);
  const all = cfg ? (cfg[1].match(/["'`](\/[^"'`]+)["'`]/g) ?? []).map((s) => s.slice(1, -1)) : [];
  /* 🔴 **파일이 아니라 경로로 좁힌다.** `ops-tenants.ts` 는 경로를 아홉 개 서비스하는데
     `internal:{…}` 를 내는 것은 **목록 하나**다. 파일로 세면 나머지 여덟을 부르는 화면까지
     «말을 버린다»로 찍혀 **거짓 빨강 12곳**이 난다(첫 판이 그랬다 · AC-95). */
  const marks = [...src.matchAll(/if\s*\(\s*path\.endsWith\s*\(\s*["'`]([^"'`]+)["'`]\s*\)\s*\)/g)];
  const blockOf = (m) => {
    const open = src.indexOf("{", m.index + m[0].length - 1);
    if (open < 0) return "";
    let d = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") d++;
      else if (src[i] === "}") { d--; if (!d) return src.slice(m.index, i + 1); }
    }
    return src.slice(m.index);
  };
  const telling = marks.filter((m) => /json\([^;]*\binternal\s*:\s*\{/.test(blockOf(m))).map((m) => "/api" + m[1]);
  /* 라우트 블록 밖(공통)에서 내면 어느 경로인지 못 가른다 — 그때만 전부로 본다(느슨한 쪽). */
  const routes = telling.length ? telling.filter((r) => all.includes(r) || true) : all;
  hideTellers.push({ file: rel(f), routes, scoped: telling.length > 0 });
}
const blindScreens = [];
for (const t of hideTellers) {
  for (const r of t.routes) {
    const callers = screens.filter((s) => s.src.includes(r));
    for (const c of callers) {
      if (!/\binternal\b/.test(c.src)) blindScreens.push({ route: r, screen: c.file, server: t.file });
    }
  }
}
rec("② 🔴 서버가 «N집 숨겼다»고 말하면 **화면이 그 말을 읽는다**", blindScreens.length === 0,
  blindScreens.length
    ? `말을 버리는 화면 ${blindScreens.length}곳 — ${blindScreens.map((b) => `${b.screen}(${b.route})`).join(", ")}`
    : hideTellers.length ? `«숨김»을 알리는 응답 ${hideTellers.length}곳 전부 화면이 읽는다` : "🔴 «숨김»을 알리는 응답이 하나도 없다");

/* ═══ ③ 숨은 집을 **꺼낼 손잡이**가 화면에 있나 ═══ */
const includeKnob = codeOnly(readFileSync(path.join(ROOT, "lib", "ops", "internal.ts"), "utf8")).match(/includeInternalOf[\s\S]{0,200}?get\(\s*["'`]([^"'`]+)["'`]/);
const knobName = includeKnob ? includeKnob[1] : "internal";
const knobScreens = screens.filter((s) => new RegExp(`${knobName}\\s*[=:]\\s*["'\`]?1`).test(s.src) || s.src.includes(`${knobName}=1`));
rec(`③ 🔴 숨은 집을 **꺼낼 손잡이**(\`${knobName}=1\`)를 화면이 보낸다`, knobScreens.length > 0,
  knobScreens.length ? `${knobScreens.map((s) => s.file).join(", ")}` : "🔴 보내는 화면 0곳 — 숨은 줄 알아도 꺼낼 길이 없다");

/* ═══ ⓪ 자기 찌르기 — 🔴 «자를 냈다»가 아니라 «우는가»다(AC-108) ═══
   🔴 **규칙을 양쪽으로 흔들어** 축이 따라 움직이는지 본다. 한쪽만 보면 «늘 빨간 자»인지 알 수 없다.
   (여기서 «올바른 고침»을 흉내 내지는 않는다 — 그건 B 의 몫이고, 이 자는 **재기만** 한다.) */
{
  const swallowedBy = (re) => CUSTOMERS.filter(([e]) => re.test(keyBaseOf(e))).length;
  const oursBy = (re) => OURS.filter(([e]) => re.test(keyBaseOf(e))).length;
  const none = swallowedBy(/^ $/);
  rec("⓪a 자기 찌르기 — **아무것도 안 삼키는 규칙**을 넣으면 ①이 초록이 된다(늘 빨간 자가 아니다)",
    none === 0, `삼킨 손님 ${none}명`);
  const all = swallowedBy(/^/);
  rec("⓪b 자기 찌르기 — **전부 삼키는 규칙**을 넣으면 ①이 더 크게 운다(축이 규칙을 따라간다)",
    all === CUSTOMERS.length && all > swallowed.length, `삼킨 손님 ${all}/${CUSTOMERS.length}명 (지금 규칙은 ${swallowed.length}명)`);
  /* 🔴 대조군 변이도 **세 신호**를 따라가게 고쳤다 — 도메인까지 막아야 «안 걸린다»가 성립한다.
     (키 규칙만 흔들면 도메인이 받아 주므로 그 변이는 **아무것도 안 재는 변이**가 된다 · AC-112) */
  const oursAll = (re, domains) => OURS.filter(([e]) => domains.some((d) => e.toLowerCase().endsWith("@" + d)) || re.test(keyBaseOf(e))).length;
  rec("⓪c 자기 찌르기 — **세 신호를 다 막으면** 대조군이 운다(대조군이 신호를 따라간다)",
    oursAll(NEVER, []) === 0 && oursAll(KEY_RE, INTERNAL_DOMAINS) === OURS.length,
    `빈 규칙+도메인 없음 ${oursAll(NEVER, [])}/${OURS.length} · 지금 ${oursAll(KEY_RE, INTERNAL_DOMAINS)}/${OURS.length}`);
  rec("⓪e 자기 찌르기 — 🔴 **키 규칙만 흔들면 도메인이 받아 준다**(그래서 키 규칙만 보면 안 된다)",
    oursAll(NEVER, INTERNAL_DOMAINS) === OURS.length,
    `키 규칙을 비워도 도메인이 ${oursAll(NEVER, INTERNAL_DOMAINS)}/${OURS.length} 를 받는다 — 첫 판이 여기서 거짓 빨강을 냈다`);
  /* ②축 — 화면이 그 키를 읽으면 초록이 되나(글자를 바꿔 먹여 본다 · 진짜 파일 무접촉). */
  const fixedScreens = screens.map((s) => (s.file === "public/ops/tenants.html" ? { ...s, src: s.src + "\n/*x*/ r.internal.hidden;" } : s));
  const stillBlind = [];
  for (const t of hideTellers) for (const r of t.routes) for (const c of fixedScreens.filter((s) => s.src.includes(r))) if (!/\binternal\b/.test(c.src)) stillBlind.push(c.file);
  rec("⓪d 자기 찌르기 — 화면이 `internal` 을 읽게 하면 ②의 그 줄이 사라진다",
    !stillBlind.includes("public/ops/tenants.html"), `고친 뒤 남은 화면: ${stillBlind.join(", ") || "없음"}`);
}

console.log("─".repeat(120));
const fails = out.filter((o) => !o.ok);
console.log(`PASS ${out.length - fails.length} · FAIL ${fails.length}`);
console.log("🔴 ①축의 손님 이름은 **내가 고른 표본**이다 — «이 이름들은 삼켜진다»까지만 증명한다(머리말).\n");
process.exit(fails.length ? 1 : 0);
