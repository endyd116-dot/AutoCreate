/**
 * scripts/verify-gate-pair.mjs — 🔴 «막는 손 ↔ 푸는 손» 짝 검사 (R11-15 · AC-102)
 *
 *   AM 실사고: 한 집이 막혔는데 **그 상태를 푸는 길이 막힌 손 뒤에 있었다.** 고객이 스스로 못 빠져나왔다.
 *
 *   🔴 [2026-09-19 · 2판] **1판은 값이 거의 없었다.** B 가 변이 넷을 새로 짜서 넣었더니 **넷 다 초록**이었다
 *   (몸통만 비우기 · 푸는 문을 다른 담 뒤로 · 푸는 화면 통째로 치우기 · 깨우는 손의 호출자 끊기).
 *   1판이 보증하던 문장은 «푸는 손의 **이름**이 아직 그 파일에 적혀 있다» 한 줄뿐이었다. 2판에서 넓혔다:
 *     ① 🔴 막는 상태 목록을 **서버(`lib/guards.ts` NON_WRITABLE)에서 읽어 온다** — 자와 서버가 갈라지지 않게.
 *        **새 막음이 늘었는데 «푸는 길»을 안 적었으면 빨강**이다.
 *     ② 🔴 갇힘 축을 **막는 상태 전부**로 — 푸는 표면을 이름으로 못 박고, 거기에 `requireWritable` 가 붙으면 빨강.
 *     ③ 🔴 표면 축을 «`export const config` 가 있나»가 아니라 **그 경로 문자열**(`/api/auth-reset`)로 잰다.
 *        화면을 통째로 치우면 빨개진다.
 *     ④ 🔴 **호출자 축** — 시간이 풀어 주는 손은 **부르는 데가 끊기면** 죽는다(크론 스텝).
 *        🔴 «이름이 있나»로 재면 **import 줄에 걸려 안 운다**(2판 첫 시도가 그랬다) — **부르는 모양**(`이름(`)으로 잰다.
 *     ⑤ 🔴 **부분일치 금지** — B 가 M0 에서 속았다: `locked_until = NULL` 을 `locked_until = NULL_DISABLED` 로
 *        바꿨는데 그냥 통과했다. **초록이 «안 운다»가 아니라 «변이가 안 먹었다»였다.** 끝 경계를 막는다.
 *
 *   🔴 **이 자가 보증하지 않는 것**(정적으로 못 잰다 · AC-9 로 적어 둔다):
 *     · 푸는 손의 **몸통이 실제로 일을 하나**(이름·시그니처만 남기고 속을 비우면 못 본다)
 *     · 그 화면이 **고객 눈에 실제로 보이나**(경로가 코드에 있는 것과 화면에 버튼이 있는 것은 다르다)
 *     ⇒ 재려면 스모크의 몫이다. **초록을 «나올 문이 있다»로 읽지 마라.**
 *
 *   🔴 §9(하드 게이트 0개)와 한 몸이다. 여기 남은 막음은 전부 **돈·계약**(§9 밖)이다 —
 *      막아도 되는 대신 **나올 문이 반드시 있어야** 한다.
 *
 *   백슬래시 없는 검사만 쓴다(AC-100 — 이 셸이 한 겹 먹는다).
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

/** 🔴 부분일치 금지 — needle 뒤에 낱말 글자가 붙어 있으면 «없는 것»으로 본다(B 의 M0 교훈). */
function hit(path, needle) {
  const s = read(path);
  /* 🔴 경계는 needle 이 **낱말로 끝날 때만** 본다 — `이름(` 처럼 기호로 끝나는 검사에 경계를 걸면
     바로 뒤 글자(`ctx` 의 c)에 걸려 **멀쩡한 코드를 «없다»고 읽는다**(2판에서 실제로 그랬다). */
  const guard = /[A-Za-z0-9_]/.test(needle[needle.length - 1]);
  let i = s.indexOf(needle);
  while (i >= 0) {
    if (!guard) return true;
    const after = s[i + needle.length];
    if (after === undefined || !/[A-Za-z0-9_]/.test(after)) return true;
    i = s.indexOf(needle, i + 1);
  }
  return false;
}

/** 🔴 경로는 **`export const config` 안에서만** 찾는다 — 파일 전체를 보면 **머리 주석에 적어 둔 경로**에 걸린다.
 *  B 의 M8: `config.path` 를 `/api/password-reset` 으로 갈아 **URL 이 실제로 404 가 돼도** 초록이었다(표면 7개 전부
 *  «주석 + config.path» 두 군데에 경로를 갖고 있다 · CLAUDE §4.2 «config.path 누락 = 404»). */
function hitPath(path, api) {
  const s = read(path);
  const i = s.indexOf("export const config");
  if (i < 0) return false;
  const end = s.indexOf("}", i);
  return s.slice(i, end < 0 ? undefined : end).includes(api);
}

/** 🔴 requireWritable 를 실제로 거는 표면을 **폴더에서 센다** — 손으로 박아 두면 새 담을 못 본다(AC-108). */
function walledNow() {
  const dir = "netlify/functions";
  const out = new Set();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".ts") && hit(`${dir}/${f}`, "requireWritable")) out.add(`${dir}/${f}`);
  }
  return out;
}

/** 🔴 서버의 NON_WRITABLE 을 읽어 온다 — 목록을 여기 베껴 두면 서버가 늘 때 자가 못 본다. */
function nonWritableStates() {
  const s = read("lib/guards.ts");
  const i = s.indexOf("NON_WRITABLE");
  if (i < 0) return null;
  const seg = s.slice(i, s.indexOf("]", i));
  const out = [];
  /* 🔴 거르개가 소문자만 받으면 «pastDue»·«past-due» 같은 새 막음이 **조용히 빠진다**(B 의 M6·M7:
     늘려도 초록이었다). 축 ① 의 값이 상태 이름의 **철자**에 달리면 안 된다. */
  for (const part of seg.split('"')) if (/^[A-Za-z0-9_-]+$/.test(part)) out.push(part);
  return out.length ? out : null;
}

/** 집 전체를 막는 상태마다 — «그 막음을 푸는 길». 🔴 여기 없는 상태가 NON_WRITABLE 에 있으면 빨강이다. */
const TENANT_RELEASE = {
  readonly: {
    why: "체험이 끝났거나 탈퇴를 신청한 집이다 — 요금제를 고르거나 탈퇴를 되돌리면 바로 이어서 써야 한다",
    doors: [
      { surface: "netlify/functions/subscription.ts", api: "/api/subscription-change", what: "요금제 고르기" },
      { surface: "netlify/functions/account-close.ts", api: "/api/account-restore", what: "탈퇴 되돌리기" },
    ],
    hand: ["lib/subscription.ts", "UPDATE tenants SET status = 'active'"],
  },
  suspended: {
    why: "결제가 밀렸다(§9 밖 · 계약이다) — 그래도 결제하면 즉시 살아나야 한다",
    doors: [
      { surface: "netlify/functions/subscription.ts", api: "/api/subscription-change", what: "결제 수단 고치기" },
      { surface: "netlify/functions/coin-purchase.ts", api: "/api/coin-purchase-start", what: "충전" },
    ],
    hand: ["lib/subscription.ts", "suspended_at = NULL"],
  },
  cancelled: {
    why: "해지 예약이 기간 끝에 닿았다(lib/cron/billing-charge.ts) — 다시 구독하면 살아나야 한다",
    doors: [
      { surface: "netlify/functions/subscription.ts", api: "/api/subscription-change", what: "다시 구독" },
    ],
    hand: ["lib/subscription.ts", "UPDATE tenants SET status = 'active'"],
  },
};

/** 집이 아니라 **계정 하나**가 막히는 자리. 갇힘 축은 안 건다(집이 막힌 게 아니다). */
const ACCOUNT_PAIRS = [
  { name: "계정 정지·휴식",
    block: ["lib/account-health.ts", "UPDATE accounts SET status = ${next}"],
    free:  ["lib/account-health.ts", "UPDATE accounts SET status = 'active'"],
    caller:["lib/cron/reap.ts", "sweepAccountStates("],
    why:   "러너가 로그인 실패·차단을 만나면 계정을 재운다 — 깨어나는 손을 **부르는 데가 끊기면** 그 계정은 영영 안 돈다" },
  { name: "계정 연결 끊김",
    block: ["lib/publish/tokens.ts", "UPDATE accounts SET status = 'disconnected'"],
    free:  ["netlify/functions/accounts.ts", "accounts-oauth-start"],
    api:   ["netlify/functions/accounts.ts", "/api/accounts-oauth-start"],
    why:   "토큰이 죽으면 연결이 끊긴다 — 다시 잇는 길이 화면에 없으면 계정을 지웠다 다시 만드는 수밖에 없다" },
  { name: "계정 칸 멈춤(결제)",
    block: ["lib/account-slots.ts", "SET status = 'paused'"],
    free:  ["lib/account-slots.ts", "SET status = 'active'"],
    api:   ["netlify/functions/account-slots.ts", "/api/account-slot-renew"],
    why:   "결제가 밀리면 칸이 멈춘다 — 결제하면 즉시 살아나는 길이 있어야 한다" },
  { name: "로그인 잠금",
    block: ["lib/auth-service.ts", "locked_until = NOW() +"],
    free:  ["lib/auth-service.ts", "locked_until = NULL"],
    api:   ["netlify/functions/auth-reset.ts", "/api/auth-reset"],
    why:   "비번을 여러 번 틀리면 잠긴다 — 비번 재설정으로 즉시 풀리는 길이 없으면 기다리는 것 말고 방법이 없다" },
  { name: "내 AI 키 무효",
    block: ["lib/ai-key-byo.ts", 'SET status = ${"invalid"}'],
    free:  ["lib/ai-key-byo.ts", '${"active"}, NOW()) RETURNING id'],
    api:   ["netlify/functions/ai-key.ts", "/api/ai-key"],
    why:   "키가 거부되면 무효로 내린다 — 새 키를 꽂아 되살리는 길이 없으면 그 집은 AI 가 통째로 멎는다" },
];

let pass = 0, fail = 0;
const say = (ok, line) => { ok ? pass++ : fail++; console.log(`${ok ? "\u2713" : "\u2717"} ${line}`); };

const W = walledNow();
const states = nonWritableStates();
console.log(`\u25a0 «막는 손 \u2194 푸는 손» 짝 검사 2판 — 막힌 집을 못 들이는 문 ${W.size}개를 폴더에서 세어 놓고 잰다\n`);

if (!states) {
  say(false, "🔴 `lib/guards.ts` 의 NON_WRITABLE 을 못 읽었다 — 서버 목록을 못 읽으면 이 자는 잴 것이 없다");
} else {
  console.log(`  서버가 말하는 «쓰기를 막는 상태» = ${states.join(" · ")}\n`);
  for (const st of states) {
    const r = TENANT_RELEASE[st];
    if (!r) {
      say(false, `🔴 **«${st}» 를 푸는 길이 이 자에 안 적혀 있다** — 서버에 막음이 늘었는데 나올 문을 아무도 안 적었다`);
      continue;
    }
    say(hit(r.hand[0], r.hand[1]), `${st} — 푸는 손이 있다 (${r.hand[0]})  \u27f5 ${r.why}`);
    for (const d of r.doors) {
      say(hitPath(d.surface, d.api), `${st} — «${d.what}» 길이 살아 있다 (${d.surface} 가 ${d.api} 를 연다)`);
      say(!W.has(d.surface), `${st} — 🔴 **«${d.what}» 문이 자기가 막은 담 뒤에 없다** (${d.surface} 에 requireWritable 가 없다)  \u27f5 AM 사고가 이 모양이었다`);
    }
  }
}

console.log("");
for (const p of ACCOUNT_PAIRS) {
  say(hit(p.block[0], p.block[1]), `${p.name} — 막는 손이 있다 (${p.block[0]})`);
  say(hit(p.free[0], p.free[1]), `${p.name} — 🔴 **푸는 손**이 있다 (${p.free[0]})  \u27f5 ${p.why}`);
  if (p.api) say(hitPath(p.api[0], p.api[1]), `${p.name} — 푸는 길이 화면에서 닿는다 (${p.api[0]} 가 ${p.api[1]} 를 연다)`);
  if (p.caller) say(hit(p.caller[0], p.caller[1]), `${p.name} — 🔴 **푸는 손을 부르는 데가 살아 있다** (${p.caller[0]})`);
}

console.log(`\n\u25a0 PASS ${pass} \u00b7 FAIL ${fail}`);
console.log(`\u2298 이 자가 **못 재는 것 둘** — 푸는 손의 **몸통이 실제로 일을 하나** \u00b7 그 화면이 **고객 눈에 보이나**.`);
console.log(`   \u21d2 🔴 **초록은 «나올 문이 있다»가 아니라 «나올 문의 자리가 아직 다 있다»까지다.**`);
if (fail) console.log(`🔴 막아 놓고 **나올 문이 없다.** §9 밖(돈·계약)이라 막는 건 되지만, 나올 문까지 없으면 계약이 아니라 감금이다.`);
process.exit(fail ? 1 : 0);
