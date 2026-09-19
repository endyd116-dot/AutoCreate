/**
 * scripts/verify-publish-words.mjs — 🔴 **서버가 만든 또렷한 말이 고객에게 닿나** (B · 첫 발행 라운드 2026-09-20)
 *
 *   ══ 왜 이 자인가 ══
 *   2026-09-20 첫 실발행에서 **검사 90개가 전부 초록인 채로** 이게 났다:
 *     계정 화면 : «아직 로그인 전이에요 · 한 번만 하면 돼요»   (맞는 말)
 *     편성표 슬롯: 🔴 «계정이 막혀 있어요»                      (겁주고, 사실도 틀리다 — 막힌 적이 없다)
 *   원인은 **버려짐**이었다. `lib/publish/index.ts` 가 «@handle 계정은 아직 로그인 전이에요…» 라는 문장을
 *   `PublishFail.error` 에 담아 올려보내는데, `lib/publish-one.ts` 가 그걸 **버리고** `HUMAN[reason]`
 *   (사유당 한 마디)만 썼다. 그 한 마디가 **세 표면**으로 나간다 — 슬롯 note · 고객 알림 · `meta.failReason`.
 *   ⇒ CLAUDE §9 는 «막지 않는 대신 **또렷하게 말한다**» 인데, 그 또렷한 말이 **중간에서 사라졌다.**
 *
 *   🔴 **왜 기존 자들이 못 봤나** — 이건 «없는 기능»도 «이름 어긋남»도 아니다.
 *      호출도 정의도 멀쩡하고 화면도 뜬다. **무슨 말이 실리느냐**가 틀렸다. 그 축을 재는 자가 없었다.
 *
 *   ══ 무엇을 재나 (파일만 읽는다 · `safe` 갈래) ══
 *     ① 🔴 «사람말 한 문장» 계약을 **소비자가 지키나** — `publishOne` 이 `r.error` 를 살려 쓰나.
 *     ② 🔴 «아직 안 한 것»과 «막힌 것»이 **다른 사유**인가(`pending_login` ↛ `account_blocked`).
 *     ③ 🔴 사유 표(`HUMAN`)가 **사유 union 전체**를 덮나 — 새 사유를 넣고 표를 안 고치면 «발행에 실패했어요»로 뭉개진다.
 *     ④ 🔴 **두 곳에 적힌 같은 union 이 안 갈라졌나** — `publish/contract.ts` ↔ `cron/publish-port.ts`.
 *        (파일이 스스로 «한쪽만 고치면 포트가 갈라진다»고 적어 뒀고, 2026-09-20 에 **실제로 갈라졌다.**)
 *     ⑤ 🔴 **«넣으려다 만 자리»** — `${x ? "" : ""}` 처럼 어느 쪽이든 빈 문자열인 삼항. 있으면 운다.
 *     ⑥ 🔴 겁주는 말이 **고객 표면 기본값**으로 안 서나(CLAUDE §3) — «막혀 있어요»를 첫 로그인 전에 쓰지 않는다.
 *
 *   🔴 **이 자가 못 하는 것**(AC-9 로 적어 둔다):
 *     · 그 문장이 **화면에 예쁘게 보이나**는 안 본다(사람이 본다).
 *     · 러너가 올려보내는 말은 안 본다(여기는 서버 안의 전달만 잰다).
 *
 *   백슬래시 없는 검사만 쓴다(AC-100). 부분일치 금지(AC-108) — 낱말 경계로 찾는다.
 */
import { readFileSync, existsSync } from "node:fs";

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
/** 🔴 주석을 걷고 센다 — 주석 속 코드를 «있다»로 세면 이 자가 AC-109 ① 병에 걸린다. */
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const ONE = "lib/publish-one.ts";
const IDX = "lib/publish/index.ts";
const CON = "lib/publish/contract.ts";
const PORT = "lib/cron/publish-port.ts";
const NOW = "netlify/functions/publish-now.ts";

const out = [];
const rec = (step, ok, note) => { out.push({ ok }); console.log(`  ${ok ? "✓" : "✗"} ${step}  — ${note}`); return ok; };

console.log(`\n«서버가 만든 또렷한 말이 고객에게 닿나» · ${new Date().toISOString()}`);
console.log("─".repeat(120));

/* ═══ ① 계약을 소비자가 지키나 ═══ */
{
  const s = codeOnly(read(ONE));
  /* `why` 가 `r.error` 를 살려 쓰나 — 못 쓰면 슬롯 note·알림·failReason 셋이 한꺼번에 뭉개진다. */
  const usesSay = /const\s+say\s*=\s*String\(r\.error/.test(s) && /sayOk\s*\?\s*say\s*:/.test(s);
  /* 바닥이 남아 있나 — 기계 말이 고객에게 나가지 않게 한글 검사로 내려앉아야 한다. */
  const hasFloor = /HUMAN\[reason\]/.test(s) && /[가-힣]/.test(s) && /test\(say\)/.test(s);
  rec("① 🔴 `publishOne` 이 서버가 만든 문장(`PublishFail.error`)을 살려 쓴다", usesSay && hasFloor,
    usesSay && hasFloor ? "`why` 가 `r.error` 를 먼저 쓰고, 사람말이 아니면 `HUMAN[reason]` 으로 내려앉는다"
      : !usesSay ? "🔴 `r.error` 를 버리고 사유당 한 마디만 쓴다 — 슬롯 note·알림·failReason 셋이 같이 뭉개진다"
        : "🔴 바닥이 없다 — 채널 원문(영어·JSON)이 고객 화면에 그대로 나갈 수 있다");
}

/* ═══ ② «아직 안 한 것» ↛ «막힌 것» ═══ */
{
  const s = codeOnly(read(IDX));
  const split = /pending_login/.test(s) && /account_login_needed/.test(s);
  /* 🔴 «다시 로그인»은 첫 로그인 전인 사람에게 거짓말이다.
     🔴 **주석을 걷고 본다** — 첫 판은 `read(IDX)` 를 날것으로 봐서 **이 수리를 설명한 주석**(«…«다시 로그인»이 거짓말이었다»)에
        스스로 걸려 빨개졌다. AC-109 ① 을 내가 `codeOnly` 까지 만들어 놓고 이 줄에서만 안 썼다. */
  const noAgain = !/pending_login[\s\S]{0,200}다시 로그인/.test(s);
  rec("② 🔴 «아직 로그인 전»을 «막혔다»로 말하지 않는다", split && noAgain,
    split && noAgain ? "`pending_login` 은 `account_login_needed` 로 갈라지고 «다시»를 안 쓴다"
      : !split ? "🔴 `pending_login` 이 `account_blocked` 로 뭉친다 — 슬롯에 «계정이 막혀 있어요»가 뜬다"
        : "🔴 «다시 로그인»이라 말한다 — 한 번도 안 한 사람에게 거짓말이다");
}

/* ═══ ③ 사유 표가 union 전체를 덮나 ═══ */
{
  const con = codeOnly(read(CON));
  const m = con.match(/export type PublishFailReason\s*=([\s\S]*?);/);
  const reasons = m ? [...new Set([...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]))] : [];
  const one = codeOnly(read(ONE));
  const hm = one.match(/export const HUMAN[^=]*=\s*\{([\s\S]*?)\n\};/);
  const covered = hm ? new Set([...hm[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1])) : new Set();
  const missing = reasons.filter((r) => !covered.has(r));
  rec("③ 🔴 사유 표(`HUMAN`)가 사유를 **하나도 안 빠뜨린다**", reasons.length > 0 && missing.length === 0,
    !reasons.length ? "🔴 사유 union 을 못 읽었다 — 이 자를 고쳐라(조용히 통과시키지 않는다)"
      : missing.length ? `🔴 표에 없는 사유 ${missing.length}개: ${missing.join(", ")} — «발행에 실패했어요»로 뭉개진다`
        : `사유 ${reasons.length}개 전부 제 말이 있다`);
}

/* ═══ ④ 두 곳에 적힌 같은 union 이 안 갈라졌나 ═══ */
{
  const pick = (p, re) => { const m = codeOnly(read(p)).match(re); return m ? new Set([...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1])) : null; };
  const a = pick(CON, /export type PublishFailReason\s*=([\s\S]*?);/);
  const b = pick(PORT, /export type PublishFailReason\s*=([\s\S]*?);/);
  const diff = a && b ? [...new Set([...[...a].filter((x) => !b.has(x)), ...[...b].filter((x) => !a.has(x))])] : null;
  rec("④ 🔴 같은 이름 union 둘이 안 갈라졌다(`contract.ts` ↔ `publish-port.ts`)", !!diff && diff.length === 0,
    !diff ? "🔴 한쪽을 못 읽었다" : diff.length ? `🔴 갈라졌다: ${diff.join(", ")} — 포트가 갈라지면 한쪽 사유가 통째로 사라진다` : `${a.size}개가 양쪽에 똑같이 있다`);
}

/* ═══ ⑤ «넣으려다 만 자리» ═══ */
{
  const files = [ONE, IDX, NOW, "lib/cron/publisher.ts"];
  const dead = [];
  for (const f of files) {
    const s = codeOnly(read(f));
    for (const mm of s.matchAll(/\$\{[^}]*\?\s*""\s*:\s*""\s*\}/g)) dead.push(`${f}: ${mm[0].slice(0, 50)}`);
  }
  rec("⑤ 🔴 «넣으려다 만» 삼항이 없다(`${x ? \"\" : \"\"}` — 어느 쪽이든 빈 문자열)", dead.length === 0,
    dead.length ? `🔴 ${dead.length}곳: ${dead.join(" · ")}` : `발행 경로 ${files.length}개 파일에 0곳`);
}

/* ═══ ⑥ 겁주는 말이 첫 로그인 전 기본값으로 안 선다(CLAUDE §3) ═══ */
{
  const one = read(ONE);
  const hm = codeOnly(one).match(/export const HUMAN[^=]*=\s*\{([\s\S]*?)\n\};/);
  const body = hm ? hm[1] : "";
  const loginWord = (body.match(/account_login_needed\s*:\s*"([^"]*)"/) || [])[1] ?? "";
  const blockedWord = (body.match(/account_blocked\s*:\s*"([^"]*)"/) || [])[1] ?? "";
  const ok = !!loginWord && loginWord !== blockedWord && !/막혀|정지|불이익|차단/.test(loginWord);
  rec("⑥ 🔴 «아직 로그인 전»의 말이 겁주지 않는다(§3)", ok,
    !loginWord ? "🔴 `account_login_needed` 의 말이 없다"
      : !ok ? `🔴 «${loginWord}» — 막힘/정지 어휘이거나 «막혔다»와 같은 말이다`
        : `«${loginWord}» · «막혔다»(«${blockedWord}»)와 다른 말이다`);
}

/* ═══ 대조군 — 이 자가 «늘 초록»이 아니다 ═══ */
{
  const bridge = codeOnly(read("lib/am-bridge.ts"));
  const good = /j\.error\s*\?\?\s*HUMAN\[step\]/.test(bridge);
  rec("대조군 — **제대로 된 자리도 실제로 있다**(이 자가 둘을 가른다)", good,
    good ? "`lib/am-bridge.ts` 는 처음부터 «구체적 문장 먼저, 표는 바닥»으로 쓴다 — 이 모양이 정답이다"
      : "🔴 대조군을 못 찾았다 — 이 자의 «정답 모양»이 사라졌다(자를 고쳐라)");
}

console.log("─".repeat(120));
const bad = out.filter((x) => !x.ok).length;
console.log(bad ? `🔴 FAIL ${bad} / ${out.length}` : `PASS ${out.length} · FAIL 0`);
console.log("🔴 이 자는 «말이 전달되나»만 잰다 — 그 말이 **화면에서 어떻게 보이나**는 사람이 본다(머리말).");
process.exit(bad ? 1 : 0);
