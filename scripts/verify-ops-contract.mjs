/**
 * scripts/verify-ops-contract.mjs — 🔴 **«같은 이름으로 부르나»** (B · 수리 라운드 2026-09-19)
 *
 *   ══ 왜 이 자가 필요한가 ══
 *   2026-09-19 운영센터 20화면을 눌러 보니 결함 아홉 중 **여섯이 한 가지 모양**이었다:
 *     **화면이 읽거나 보내는 이름 ↔ 서버가 보내거나 읽는 이름이 다르다.**
 *       · 메모: 화면이 `text` 를 보내고 서버는 `note` 를 읽었다 → `ops_note=''` 로 덮었다. 🔴 **응답은 `ok:true`.**
 *       · 상세: 화면이 `coinsSplit`·`slots.planned`·`notes` 를 읽는데 서버는 `coinDetail`·`slots.upcoming`·`note` 를 보냈다.
 *       · 목록: 서버가 `internal:{hidden}` 을 보내는데 화면이 **아예 안 읽어** 손님이 «0곳»으로 사라졌다.
 *   🔴 이 축을 재는 자가 **하나도 없었다.** `verify-r8-deadends` 는 «정의가 있나»·«호출이 있나»를 잰다 —
 *      둘 다 초록인 채로 여섯 자리가 죽어 있었다. 이름이 어긋난 것은 **호출도 정의도 멀쩡하기 때문**이다.
 *   🔴 특히 «보내는 이름»이 어긋나면 **오류가 안 난다**(서버가 못 읽은 칸을 빈 값으로 본다) — 조용히 죽는다.
 *      조용히 죽는 자리는 스모크로도 안 잡힌다(200 이 온다). **이름을 맞대 보는 수밖에 없다.**
 *
 *   ══ 어떻게 재나 ══
 *   파일만 읽는다(`safe` 갈래 — `verify-safe-list.mjs` 가 자동으로 그렇게 가른다). DB·네트워크에 안 붙는다.
 *     ① **읽는 축** — 서버가 응답에 싣는 키를 그 화면이 읽나.
 *     ② **보내는 축** — 화면이 body 에 싣는 칸을 그 핸들러가 읽나.  🔴 이게 새로 생긴 축이다.
 *     ③ **«모름»을 «0»으로 뭉개지 않나** — `?? 0` 으로 null 을 삼키는 자리(AC-9).
 *     ④ **자동 분류가 진짜 상호를 안 삼키나** — 실제 상호로 표를 만들어 정규식을 돌린다.
 *     ⑤ **JS 규칙과 SQL 규칙이 갈라지지 않나** — `INTERNAL_KEY_RE.source` 를 SQL 이 `~*` 로 그대로 쓴다.
 *
 *   🔴 **부분일치 금지**(AC-108 · B 가 M0 에서 속은 그것) — 키 이름 뒤에 낱말 글자가 붙어 있으면 «없는 것»으로 본다.
 *      `note` 를 찾는데 `notes` 에 걸리면 **고쳐지지도 않았는데 초록**이 된다. 이 자에서는 그게 치명적이다.
 *
 *   백슬래시 없는 검사만 쓴다(AC-100 — 이 셸이 한 겹 먹는다).
 */
import { readFileSync, existsSync } from "node:fs";

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

/** 🔴 낱말 경계로 찾는다 — `note` 가 `notes` 에 걸리면 안 된다(그러면 안 고쳐도 초록이다). */
function hasWord(src, word) {
  let i = src.indexOf(word);
  while (i >= 0) {
    const before = src[i - 1];
    const after = src[i + word.length];
    const okB = before === undefined || !/[A-Za-z0-9_]/.test(before);
    const okA = after === undefined || !/[A-Za-z0-9_]/.test(after);
    if (okB && okA) return true;
    i = src.indexOf(word, i + 1);
  }
  return false;
}

const results = [];
const add = (ok, title, detail) => { results.push({ ok, title, detail }); };

/* ═══════════ ① 읽는 축 — 서버가 싣는 키를 화면이 읽나 ═══════════ */
/* 🔴 [변이 시험이 고치게 한 것 · AC-108] 첫 판은 **낱말만** 찾았다 — 그래서 여섯 변이가 **안 울었다**:
     · `r.internal` 을 지워도 같은 파일의 질의 문자열 `&internal=1` 이 검사를 초록으로 만들었다.
     · 응답에서 `notes` 를 빼도 위쪽 지역변수 `notes` 가 남아 초록이었다.
     · 화면 body 에서 `note:` 를 빼도 경로 문자열 `/api/ops-tenant-note` 가 초록으로 만들었다.
   ⇒ **«그 자리에서 그렇게 쓰는 모양»** 을 못 박는다. 낱말은 너무 헐겁다. */
const READ_AXIS = [
  { key: "internal", server: "netlify/functions/ops-tenants.ts", screen: "public/ops/tenants.html",
    serverNeedle: "internal: { excluded:", screenNeedle: "r.internal",
    why: "숨긴 집 수 — 안 읽으면 손님이 «0곳»으로 사라진다(시나리오 B ①)" },
  { key: "coinsSplit", server: "netlify/functions/ops-tenants.ts", screen: "public/ops/tenant.html",
    serverNeedle: "coinsSplit: coins", screenNeedle: "r.coinsSplit",
    why: "코인 포함/충전 분해" },
  { key: "notes", server: "netlify/functions/ops-tenants.ts", screen: "public/ops/tenant.html",
    serverNeedle: "        notes, audit, setup", screenNeedle: "r.notes",
    why: "운영 메모 목록 — 안 맞으면 영원히 «메모 없음»" },
  { key: "trialToPaidPct", server: "netlify/functions/ops-dashboard.ts", screen: "public/ops/index.html",
    serverNeedle: "trialToPaidPct,", screenNeedle: "r.trialToPaidPct",
    why: "체험→유료" },
  { key: "duplicate", server: "netlify/functions/ops-tenants.ts", screen: "public/ops/tenant.html",
    serverNeedle: "duplicate: true", screenNeedle: "r.duplicate",
    why: "코인 두 번 눌렀을 때 «한 번만 들어갔어요»(시나리오 B ④)" },
];
for (const t of READ_AXIS) {
  const inServer = read(t.server).includes(t.serverNeedle);
  const inScreen = read(t.screen).includes(t.screenNeedle);
  add(inServer && inScreen, `읽는 축 — 서버가 «${t.key}» 를 싣고 화면이 그걸 읽나`,
    inServer && inScreen ? `${t.server.split("/").pop()} → ${t.screen.split("/").pop()}`
      : !inServer ? `🔴 서버(${t.server})가 «${t.key}» 를 안 싣는다 — ${t.why}`
        : `🔴 화면(${t.screen})이 «${t.key}» 를 안 읽는다 — ${t.why}`);
}

/* ═══════════ ② 🔴 보내는 축 — 화면이 싣는 칸을 핸들러가 읽나 (새 축) ═══════════ */
const SEND_AXIS = [
  { field: "note", screen: "public/ops/tenant.html", server: "netlify/functions/ops-tenants.ts",
    screenNeedle: "note: d.text", serverNeedle: "b.text ?? b.note",
    why: "메모 — 옛 판은 화면이 text 만 보내고 서버는 note 만 읽어 **있던 메모까지 지웠다**(ok:true 로)" },
  { field: "idem", screen: "public/ops/tenant.html", server: "netlify/functions/ops-tenants.ts",
    screenNeedle: "reason: d.reason, idem", serverNeedle: "b.idem",
    why: "코인 멱등 키 — 없으면 더블클릭이 두 번 들어간다" },
  { field: "internal=1", screen: "public/ops/tenants.html", server: "lib/ops/internal.ts",
    screenNeedle: "&internal=1", serverNeedle: 'searchParams.get("internal")',
    why: "«내부 포함» 토글 — 숨은 집을 꺼낼 길" },
  { field: "password", screen: "public/ops/operators.html", server: "netlify/functions/ops-operators.ts",
    screenNeedle: "id: o.id, password: d.password", serverNeedle: "b.password",
    why: "운영자 임시 비번 — 없으면 뽑아도 못 들여보낸다(시나리오 B ⑥)" },
];
for (const t of SEND_AXIS) {
  const inScreen = read(t.screen).includes(t.screenNeedle);
  const inServer = read(t.server).includes(t.serverNeedle);
  add(inScreen && inServer, `보내는 축 — 화면이 «${t.field}» 를 싣고 서버가 그걸 읽나`,
    inScreen && inServer ? `${t.screen.split("/").pop()} → ${t.server.split("/").pop()}`
      : !inScreen ? `🔴 화면(${t.screen})이 «${t.field}» 를 안 보낸다 — ${t.why}`
        : `🔴 서버(${t.server})가 «${t.field}» 를 안 읽는다 — ${t.why}`);
}

/* 경로가 실제로 붙어 있나 — 새로 낸 손은 config.path 에 없으면 라이브에서 404 다(CLAUDE §4.2). */
for (const route of ["/api/ops-operator-password"]) {
  const src = read("netlify/functions/ops-operators.ts");
  add(src.includes(`"${route}"`) && src.includes(`endsWith("${route.replace("/api", "")}")`),
    `경로 — «${route}» 가 config.path 와 분기 양쪽에 있나`,
    src.includes(`"${route}"`) ? "둘 다 있다" : "🔴 config.path 에 없으면 라이브 404(CLAUDE §4.2)");
}

/* ═══════════ ③ «모름»을 «0»으로 뭉개지 않나 (AC-9) ═══════════ */
const NULL_AXIS = [
  { file: "public/ops/index.html", bad: "r.trialToPaidPct ?? 0", why: "표본이 없어 못 잰 전환율이 «0%»(장사가 망했다)로 읽힌다" },
  { file: "public/ops/index.html", bad: "r.churn?.pct ?? 0", why: "잴 집이 없는 날 «이탈 0%»는 잰 적 없는 값이다" },
];
for (const t of NULL_AXIS) {
  const src = read(t.file);
  add(!src.includes(t.bad), `«모름»을 «0»이라 하지 않나 — ${t.file.split("/").pop()} «${t.bad}»`,
    src.includes(t.bad) ? `🔴 아직 뭉갠다 — ${t.why}` : "못 쟀으면 못 쟀다고 적는다");
}
/* 서버도 같이 — null 을 주기로 한 칸이 0 으로 돌아가면 화면만 고쳐 봐야 소용없다. */
{
  const d = read("netlify/functions/ops-dashboard.ts");
  add(/churnBase > 0 \? [^:]+: null/.test(d), "«모름»을 «0»이라 하지 않나 — 서버 churn.pct",
    /churnBase > 0 \? [^:]+: null/.test(d) ? "표본 0이면 null 을 준다" : "🔴 서버가 표본 0에 «0%»를 준다(AC-9)");
}

/* ═══════════ ④ 🔴 자동 분류가 «가입한 사람»을 삼키지 않나 ═══════════ */
const internalSrc = read("lib/ops/internal.ts");
const m = internalSrc.match(/INTERNAL_KEY_RE = \/([^/]+)\/i/);
if (!m) {
  add(false, "내부 분류 — INTERNAL_KEY_RE 를 못 찾았다", "🔴 정규식 모양이 바뀌었다. 이 자를 고쳐라(조용히 통과시키지 않는다)");
} else {
  const re = new RegExp(m[1], "i");
  /* 🔴 실제로 삼켰던 상호 + 삼킬 법한 상호. `tenantKeyFrom` 이 «메일앞부분 12자-무작위6자» 로 만든다. */
  const REAL = ["smokehouse-x097e0", "demolition-k2abcd", "skipper-ccdd11", "testkim-x9aa02", "r3design-bb77zz",
    "r2coffee-aa19kk", "harvestfarm-p2", "demoday-kr7788", "verynice-ee0011", "normalshop-ff2233",
    "smokehouse20-aa11", "demolab-9x2b"];
  /* 🔴 라이브에 **실제로 있는** 하니스 키를 그대로 썼다(2026-09-19 조회) — 지어낸 표로는 이 자가 값이 없다. */
  const HARNESS = ["test-56j02y", "smoke6178942-7aeqh4", "verify1789012-abc123", "r8ta17894918-29buhy",
    "r4smokea1789-hmgo1c", "skipb1789437-lbcnf0", "skip-b1789437", "demo-1789400000", "p1r4-smoke01", "harness-1789400"];
  const swallowed = REAL.filter((k) => re.test(k));
  const escaped = HARNESS.filter((k) => !re.test(k));
  add(swallowed.length === 0, "내부 분류 — 진짜 상호를 삼키지 않나",
    swallowed.length ? `🔴 삼킨다: ${swallowed.join(" · ")} — 그 집은 운영 목록에서 사라진다` : `상호 ${REAL.length}개 전부 통과`);
  add(escaped.length === 0, "내부 분류 — 하니스 키는 그대로 잡나",
    escaped.length ? `🔴 놓친다: ${escaped.join(" · ")} — 시험 집이 매출에 섞인다` : `하니스 키 ${HARNESS.length}개 전부 잡는다`);

  /* ⑤ JS 규칙 ↔ SQL 규칙 — SQL 이 `~*` 로 이 source 를 그대로 쓴다. POSIX 로 못 도는 모양이면 라이브에서 터진다. */
  add(internalSrc.includes("INTERNAL_KEY_RE.source"), "내부 분류 — SQL 이 같은 정규식을 쓰나",
    internalSrc.includes("INTERNAL_KEY_RE.source") ? "SQL 이 JS 의 source 를 그대로 쓴다(갈라질 수 없다)" : "🔴 SQL 이 규칙을 따로 적었다 — 둘이 갈라진다");
  add(!/\(\?[=!]/.test(m[1]), "내부 분류 — 정규식이 POSIX 로도 도나",
    /\(\?[=!]/.test(m[1]) ? "🔴 앞보기(?=·?!)가 있다 — Postgres `~*` 와 갈라질 수 있다" : "앞보기 없음");
}
/* 돈을 낸 집은 자동 규칙이 못 건드린다 — 이 안전선이 지워지면 다시 삼킬 수 있다. */
/* 🔴 첫 판은 `includes("PAID_TRACE")` 였다 — 변이가 `PAID_TRACE_OFF` 로 이름만 바꾸니 **안 울었다.**
   `verify-gate-pair` 가 적어 둔 그 함정(«부분일치 금지»)에 이 자가 그대로 걸렸다. 선언과 **쓰는 자리**를 둘 다 본다. */
const paidDecl = /const PAID_TRACE = sql`/.test(internalSrc);
const paidUsed = internalSrc.includes("AND NOT ${PAID_TRACE})");
add(paidDecl && paidUsed, "내부 분류 — 돈 낸 집은 자동으로 안 켜나",
  paidDecl && paidUsed ? "결제 흔적이 있으면 자동 분류가 비껴간다(선언 + 쓰는 자리 둘 다)"
    : !paidDecl ? "🔴 안전선 선언이 없다 — 결제한 집도 내부로 켜질 수 있다" : "🔴 선언만 있고 UPDATE 가 안 쓴다(죽은 안전선)");

/* ═══════════ ⑥ 상태만 바꿀 때 구독 장부를 건드리지 않나 ═══════════ */
{
  const srv = read("netlify/functions/ops-tenants.ts");
  const scr = read("public/ops/tenant.html");
  add(/planKey === String\(t\.plan_key\)/.test(srv), "상태만 바꾸기 — 같은 플랜이면 서버가 구독을 안 건드리나",
    /planKey === String\(t\.plan_key\)/.test(srv) ? "같은 플랜이면 장부를 그대로 둔다" : "🔴 같은 플랜에도 UPSERT 가 돈다 — 고객의 해지 예약이 풀린다");
  add(/planKey !== wasPlan/.test(scr), "상태만 바꾸기 — 화면이 바뀐 것만 부르나",
    /planKey !== wasPlan/.test(scr) ? "플랜 칩이 그대로면 plan-change 를 안 부른다" : "🔴 화면이 언제나 plan-change 를 부른다");
  add(/planWarn/.test(scr), "상태만 바꾸기 — 무엇이 함께 바뀌는지 말해 주나",
    /planWarn/.test(scr) ? "누르기 전에 적어 준다(CLAUDE §9 — 막지 않는 대신 말해 준다)" : "🔴 운영자가 무엇을 지우는지 모른 채 누른다");
}

/* ═══════════ ⑦ 코인 멱등 — 키가 «시계»에서 나오지 않나 ═══════════ */
{
  const srv = read("netlify/functions/ops-tenants.ts");
  const clockRef = /const ref = `ops:\$\{o\.ops\.oid\}:\$\{Date\.now\(\)\}`/.test(srv);
  add(!clockRef, "코인 멱등 — 키가 시계에서 나오지 않나",
    clockRef ? "🔴 `Date.now()` 로 만든다 — 누를 때마다 다른 키라 두 번 들어간다" : "뜻(또는 화면이 준 idem)으로 만든다");
  /* 회수도 같은 자를 지나야 한다 — grant() 를 안 거치므로 손으로 ON CONFLICT 를 적어야 한다. */
  const revokeGuard = srv.includes('${"revoke"}') && /revoke[\s\S]{0,400}ON CONFLICT/.test(srv);
  add(revokeGuard, "코인 멱등 — 회수도 두 번 안 빠지나",
    revokeGuard ? "회수 INSERT 에도 ON CONFLICT 가 붙어 있다" : "🔴 회수는 멱등하지 않다 — 두 번 누르면 두 번 빠진다");
}

/* ═══════════ ⑧ 운영자 초대 — 들여보낼 길이 있나 ═══════════ */
{
  const auth = read("lib/auth-service.ts");
  const scr = read("public/ops/operators.html");
  /* 🔴 낱말 경계로 — 변이가 `setOperatorTempPasswordX` 로 꼬리만 붙였을 때 첫 판은 안 울었다. 부르는 자리도 같이 본다. */
  const tempDecl = hasWord(auth, "setOperatorTempPassword");
  const tempCalled = hasWord(read("netlify/functions/ops-operators.ts"), "setOperatorTempPassword");
  add(tempDecl && tempCalled, "운영자 초대 — 남의 비번을 정해 주는 손이 있나",
    tempDecl && tempCalled ? "임시 비번(must_change_password=true)을 쥐여 줄 수 있다 · 핸들러가 부른다"
      : !tempDecl ? "🔴 손이 없다 — 뽑아도 로그인 자체가 안 된다" : "🔴 손은 있는데 아무도 안 부른다(죽은 통로 · AC-69)");
  add(/must_change_password = true/.test(auth), "운영자 초대 — 임시 비번이 «임시»인가",
    /must_change_password = true/.test(auth) ? "첫 로그인에서 본인이 바꾼다(우리 손에 안 남는다)" : "🔴 임시가 아니다 — 우리가 남의 비번을 쥐고 있게 된다");
  /* 🔴 **단추를 그리는 자리**와 **그 단추에 손을 다는 자리**를 둘 다 본다 —
     첫 판은 `[data-pw]` 선택자만 남아 있어도 초록이었다(표에서 단추를 빼도 안 울었다). */
  const btnDrawn = scr.includes('data-pw="${o.id}"');
  const btnBound = scr.includes('UI.$$("[data-pw]")');
  add(btnDrawn && btnBound, "운영자 초대 — 화면에 그 단추가 있나",
    btnDrawn && btnBound ? "«비번 주기» 단추를 그리고 손도 달려 있다"
      : !btnDrawn ? "🔴 표에 단추를 안 그린다(CLAUDE §4.8 — API 로만 되는 기능은 없는 기능)" : "🔴 단추는 그리는데 아무 일도 안 한다");
}

/* ═══════════ 찍기 ═══════════ */
const W = 76;
console.log(`\n운영센터 계약 — «같은 이름으로 부르나» · ${new Date().toISOString()}\n${"─".repeat(W + 46)}`);
let bad = 0;
for (const r of results) {
  if (!r.ok) bad++;
  console.log(`${r.ok ? "✓" : "✗"} ${r.title.padEnd(W).slice(0, W)}  ${r.detail}`);
}
console.log(`${"─".repeat(W + 46)}`);
console.log(bad ? `🔴 FAIL ${bad} / ${results.length}` : `PASS ${results.length} · FAIL 0`);
console.log("🔴 이 자는 «이름이 맞나»만 잰다 — 그 이름이 **뜻대로 도나**는 스모크의 몫이다(AC-9).");
process.exit(bad ? 1 : 0);
