/**
 * scripts/verify-gate-pair.mjs — 🔴 «막는 손 ↔ 푸는 손» 짝 검사 (R11-15 · AC-102)
 *
 *   AM 실사고에서 받았다: 한 집이 막힌 상태로 들어갔는데 **그 상태를 푸는 길이 막힌 손 뒤에 있었다.**
 *   ⇒ 고객이 스스로 못 빠져나온다. 사람이 DB 를 직접 만져야 풀렸다.
 *
 *   이 자가 재는 것은 «푸는 함수가 파일에 있나»가 **아니다**(그건 E6 가 가짜 초록이던 모양이다).
 *   세 축으로 잰다:
 *     ① 짝    — 막는 손마다 **푸는 손**이 있나
 *     ② 🔴 갇힘 — 푸는 손이 **자기가 막은 문 뒤에** 있지 않나  ← AM 사고의 진짜 모양
 *     ③ 표면  — 푸는 길이 **화면에서 닿나**(config.path 가 있나)
 *
 *   🔴 §9(하드 게이트 0개)와 한 몸이다. §9 가 «우리 판단으로 막지 마라»면
 *      여기 남은 막음은 전부 **돈·계약**(§9 밖)이다 — 막아도 되는 대신 **나올 문이 반드시 있어야** 한다.
 *
 *   백슬래시 없는 정규식만 쓴다(AC-100 — 이 셸이 한 겹 먹는다).
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const has = (p, re) => re.test(read(p));

/** 🔴 requireWritable 를 거는 표면 파일 = «막힌 집은 못 들어오는 문».
 *  손으로 박아 두면 **담이 새로 생겨도 못 본다** — 2026-09-19 내 첫 판이 정확히 그래서
 *  «푸는 문을 담 뒤로 옮기는» 변이에 **한 번도 안 울었다**. 그래서 폴더를 직접 센다. */
function walledNow() {
  const dir = "netlify/functions";
  const out = new Set();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".ts")) continue;
    const p = `${dir}/${f}`;
    if (has(p, /requireWritable/)) out.add(p);
  }
  return out;
}

const PAIRS = [
  { name: "탈퇴 readonly",
    block: ["lib/account-close.ts", /status = [$][{]"readonly"[}]/],
    free:  ["lib/account-close.ts", /export async function restoreAccount/],
    face:  ["netlify/functions/account-close.ts", /["']\/api\/account-restore["']/],
    why:   "탈퇴 신청하면 readonly 가 된다 — 30일 안에 **되돌릴 길**이 없으면 그건 탈퇴가 아니라 삭제다" },

  { name: "계정 정지·휴식",
    block: ["lib/account-health.ts", /UPDATE accounts SET status = [$][{]next[}]/],
    free:  ["lib/account-health.ts", /UPDATE accounts SET status = 'active'/],
    face:  ["lib/runner-jobs.ts", /UPDATE accounts SET status = 'active'/],
    why:   "러너가 로그인 실패·차단을 만나면 계정을 재운다 — **깨어나는 길**(휴식 만료·재로그인 성공)이 없으면 그 계정은 영영 안 돈다" },

  { name: "계정 연결 끊김",
    block: ["lib/publish/tokens.ts", /UPDATE accounts SET status = 'disconnected'/],
    free:  ["netlify/functions/accounts.ts", /accounts-oauth-start/],
    face:  ["netlify/functions/accounts.ts", /export const config/],
    why:   "토큰이 죽으면 연결이 끊긴다 — **다시 잇는 길**이 화면에 없으면 고객은 계정을 지웠다 다시 만드는 수밖에 없다" },

  { name: "계정 칸 멈춤(결제)",
    block: ["lib/account-slots.ts", /SET status = 'paused'/],
    free:  ["lib/account-slots.ts", /SET status = 'active'/],
    face:  ["netlify/functions/account-slots.ts", /export const config/],
    why:   "결제가 밀리면 칸이 멈춘다(§9 밖 · 계약이다) — 그래도 **결제하면 즉시 살아나는 길**이 있어야 한다" },

  { name: "로그인 잠금",
    block: ["lib/auth-service.ts", /locked_until = NOW[(][)] [+]/],
    free:  ["lib/auth-service.ts", /locked_until = NULL/],
    face:  ["lib/auth-service.ts", /reset_nonce = NULL/],
    why:   "비번을 여러 번 틀리면 잠긴다 — **비번 재설정으로 즉시 풀리는 길**이 없으면 기다리는 것 말고 방법이 없다" },

  { name: "내 AI 키 무효",
    block: ["lib/ai-key-byo.ts", /SET status = [$][{]"invalid"[}]/],
    free:  ["lib/ai-key-byo.ts", /[$][{]"active"[}], NOW[(][)][)] RETURNING id/],
    face:  ["netlify/functions/ai-key.ts", /export const config/],
    why:   "키가 거부되면 무효로 내린다 — **새 키를 꽂아 되살리는 길**이 없으면 그 집은 AI 가 통째로 멎는다" },
];

/** ② 갇힘 축 — 푸는 손·표면이 «막힌 집은 못 들어오는 문» 뒤에 있으면 안 된다.
 *  🔴 단, 막음이 «그 집 전체가 readonly» 일 때만 문제다. 계정 하나가 쉬는 것은 집이 막힌 게 아니다. */
const TENANT_WIDE = new Set(["탈퇴 readonly"]);

let pass = 0, fail = 0;
const say = (ok, line) => { ok ? pass++ : fail++; console.log(`${ok ? "✓" : "✗"} ${line}`); };

const W = walledNow();
console.log(`■ «막는 손 ↔ 푸는 손» 짝 검사 — 막힌 집을 못 들이는 문 ${W.size}개를 세어 놓고 잰다\n`);

for (const p of PAIRS) {
  const [bf, bre] = p.block, [ff, fre] = p.free, [cf, cre] = p.face;
  say(has(bf, bre), `${p.name} — 막는 손이 있다 (${bf})`);
  say(has(ff, fre), `${p.name} — 🔴 **푸는 손**이 있다 (${ff})  ⟵ ${p.why}`);
  say(has(cf, cre), `${p.name} — 푸는 길이 화면에서 닿는다 (${cf})`);
  if (TENANT_WIDE.has(p.name)) {
    const caged = W.has(cf);
    say(!caged, `${p.name} — 🔴 **푸는 문이 자기가 막은 담 뒤에 없다** (${cf} 에 requireWritable 가 없다)  ⟵ AM 사고가 정확히 이 모양이었다`);
  }
}

console.log(`\n■ PASS ${pass} · FAIL ${fail}`);
if (fail) {
  console.log(`🔴 막아 놓고 **나올 문이 없다.** §9 밖(돈·계약)이라 막는 건 되지만, 나올 문까지 없으면 그건 계약이 아니라 감금이다.`);
}
process.exit(fail ? 1 : 0);
