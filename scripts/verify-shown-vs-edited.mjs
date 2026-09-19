/**
 * scripts/verify-shown-vs-edited.mjs — 🔴 **«보여 줄 값»과 «고칠 값»이 한 칸을 겸하지 않나** (B · 2026-09-21)
 *
 *   ══ 왜 ══
 *   `lib/accounts.ts` 는 `dailyCap`·`minGapMin` 을 **유효값**(워밍업이 깎은 값)으로 바꿔 내보낸다. 그 자체는 옳다 —
 *   화면이 «오늘 몇 개 남았나»를 말해야 하고, 게이트 셋이 그 값을 본다.
 *   🔴 **그런데 설정 시트가 그 값을 «고객이 정한 값»으로 알고 미리 채웠다.** 열었다 **저장만 해도** 덮어써진다.
 *   실제로 메인이 그걸로 **`min_gap` 180 → 360 을 부쉈다**(계정 466 · 되돌렸다).
 *
 *   🔴 뿌리가 둘이었다:
 *     ① `dailyCapBase`(고객 값)가 **워밍업 중일 때만** 실렸다 — 화면은 «있으면 쓰고 없으면 유효값» 으로 짤 수밖에 없다.
 *     ② `minGapMin` 은 **원래 값을 담는 칸이 아예 없었다** — 화면이 쓸 것이 유효값뿐이었다.
 *     ③ 게다가 `dailyCapBase` 는 **읽는 곳이 0곳**이었다(있으나 마나 · «저장만 하고 아무도 안 읽는 칸»).
 *
 *   ══ 무엇을 재나 (파일만 읽는다 · `safe`) ══
 *     ① 🔴 서버가 **언제나** 두 갈래를 싣는다(«워밍업 중일 때만»이 아니다 — 있다 없다 하면 화면이 유효값으로 떨어진다).
 *     ② 🔴 워밍업은 **«보여 줄 값»만** 바꾼다(`base` 를 덮어쓰지 않는다).
 *     ③ 🔴 **편집 시트가 «고칠 값»을 미리 채운다**(AC-52 — 서버만 고치면 반쪽이고, 덮어쓰기는 그대로 난다).
 *     ④ 모의 사본도 같은 칸을 준다(화면이 모의로 돌 때 갈리지 않게).
 *     대조군 — «보여 줄 값»은 **여전히 워밍업을 반영한다**(이 자는 «워밍업을 없애라»가 아니다).
 *
 *   🔴 **이 자가 못 하는 것**(AC-9):
 *     · 실제로 값이 지켜지는지는 안 본다 — `scripts/_smoke/cap-overwrite-smoke.mts` 가 잰다
 *       (워밍업 1주차에서 보여 줄 값 1·360 / 고칠 값 2·180 · 저장 뒤 **2·180 그대로**).
 *     · 다른 화면(운영센터)의 같은 모양은 안 본다.
 *
 *   백슬래시 없는 검사만(AC-100) · 주석을 걷고 센다(AC-109 ①).
 *
 *   쓰기: node scripts/verify-shown-vs-edited.mjs
 */
import { readFileSync, existsSync } from "node:fs";

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const noHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, " ");

const SRV = "lib/accounts.ts";
const TPL = "public/app/_tpl.txt";
const MOCK = "public/js/mock.js";
const srv = codeOnly(read(SRV));
const tpl = noHtmlComments(read(TPL));
const mock = codeOnly(read(MOCK));

/** 「보여 줄 값」 ↔ 「고칠 값」 짝. 새 짝이 생기면 여기 한 줄이다. */
const PAIRS = [{ shown: "dailyCap", edit: "dailyCapBase" }, { shown: "minGapMin", edit: "minGapBase" }];

const out = [];
const rec = (step, ok, note) => { out.push({ ok }); console.log(`  ${ok ? "✓" : "✗"} ${step}  — ${note}`); return ok; };

console.log(`\n«보여 줄 값과 고칠 값이 한 칸을 겸하지 않나» · ${new Date().toISOString()}`);
console.log(`■ 내가 세는 모수 — 짝 ${PAIRS.length}개(${PAIRS.map((p) => `${p.shown}↔${p.edit}`).join(" · ")}) · 서버 1 · 화면 1 · 모의 1`);
console.log("─".repeat(120));

/* ① 서버가 언제나 두 갈래를 싣나 — `toAccountRow` 의 **첫 만들기**에 둘 다 있어야 한다(조건 안이면 «있다 없다» 한다) */
{
  const body = (srv.match(/export function toAccountRow[\s\S]*?\n\}/) || [""])[0];
  const head = (body.match(/const o: AccountRow = \{[\s\S]*?\n  \};/) || [""])[0];
  const missing = PAIRS.filter((p) => !new RegExp(`\\b${p.edit}\\s*:`).test(head));
  /* 타입에서도 선택(`?:`)이 아니어야 한다 — 선택이면 화면이 «없을 수도 있다»로 짜고 유효값으로 떨어진다. */
  const optional = PAIRS.filter((p) => new RegExp(`\\b${p.edit}\\?\\s*:`).test(srv));
  const ok = !!head && missing.length === 0 && optional.length === 0;
  rec("① 🔴 서버가 **언제나** 「고칠 값」을 싣는다(워밍업 중일 때만이 아니다)", ok,
    !head ? "🔴 `toAccountRow` 의 첫 만들기를 못 찾았다 — 이 자를 고쳐라"
      : missing.length ? `🔴 조건 밖에서 안 채우는 칸: ${missing.map((p) => p.edit).join(", ")} — 있다 없다 하면 화면이 유효값으로 떨어진다`
        : optional.length ? `🔴 타입이 선택(?)이다: ${optional.map((p) => p.edit).join(", ")} — 선택이면 화면이 «없을 수도»로 짜게 된다`
          : `${PAIRS.map((p) => p.edit).join(" · ")} 를 처음부터 채운다`);
}

/* ② 워밍업이 「보여 줄 값」만 바꾸나 */
{
  const warm = (srv.match(/if \(w\.active\) \{[\s\S]*?\n  \}/) || [""])[0];
  const overwrites = PAIRS.filter((p) => new RegExp(`o\\.${p.edit}\\s*=`).test(warm));
  const setsShown = PAIRS.filter((p) => new RegExp(`o\\.${p.shown}\\s*=`).test(warm));
  const ok = !!warm && overwrites.length === 0 && setsShown.length === PAIRS.length;
  rec("② 🔴 워밍업은 **「보여 줄 값」만** 바꾼다(「고칠 값」을 덮지 않는다)", ok,
    !warm ? "🔴 워밍업 블록을 못 찾았다 — 이 자를 고쳐라"
      : overwrites.length ? `🔴 「고칠 값」을 덮어쓴다: ${overwrites.map((p) => p.edit).join(", ")} — 그러면 고객 값이 사라진다`
        : `유효값 ${setsShown.length}개만 바꾸고 원래 값은 그대로 둔다`);
}

/* ③ 🔴 편집 시트가 「고칠 값」을 미리 채우나 — 여기가 실제 고장 자리였다 */
{
  const bad = [], good = [];
  for (const p of PAIRS) {
    /* `UI.stepper("cap", …)` · `UI.chips("gap", …, …)` 처럼 **미리 채우는 자리**만 본다. */
    const fills = [...tpl.matchAll(new RegExp(`UI\\.(?:stepper|chips)\\([^)]*a\\.${p.shown}[^)]*\\)`, "g"))];
    const usesEdit = new RegExp(`a\\.${p.edit}\\s*\\?\\?`).test(tpl);
    /* 유효값이 **폴백으로만** 쓰이면 괜찮다(`a.base ?? a.shown`). 앞에 단독으로 있으면 덮어쓴다. */
    const rawFirst = fills.some((m) => !new RegExp(`a\\.${p.edit}\\s*\\?\\?[^,)]*a\\.${p.shown}`).test(m[0]));
    if (!usesEdit || rawFirst) bad.push(p.edit); else good.push(p.edit);
  }
  rec("③ 🔴 **편집 시트가 「고칠 값」을 미리 채운다**(AC-52 · 서버만 고치면 반쪽)", bad.length === 0,
    bad.length ? `🔴 시트가 유효값을 미리 채우는 칸: ${bad.join(", ")} — 열었다 저장만 해도 고객 값이 덮어써진다`
      : `${good.join(" · ")} 로 미리 채운다(유효값은 폴백으로만)`);
}

/* ④ 모의 사본도 같은 칸을 주나 — 🔴 **계정 한 줄씩** 본다 */
{
  /* 🔴 [변이 M5 가 고치게 했다] 첫 판은 «파일 어디든 그 낱말이 있나»였다 — 그래서 **계정 하나에서 빼도 안 울었다**
     (다른 계정에 남아 있으니까). 모의 계정은 **한 줄에 하나**라, 그 줄 안에서 짝이 맞는지 본다.
     ⚠️ `dailyCap` 은 캐던스 **오류 응답**에도 나온다(계정 행이 아니다) — `handle:` 이 있는 줄만 계정으로 센다. */
  const rows = mock.split("\n").filter((l) => /\bhandle\s*:/.test(l) && PAIRS.some((p) => new RegExp(`\\b${p.shown}\\s*:`).test(l)));
  const bad = [];
  for (const l of rows) {
    for (const p of PAIRS) {
      if (new RegExp(`\\b${p.shown}\\s*:`).test(l) && !new RegExp(`\\b${p.edit}\\s*:`).test(l)) {
        bad.push(`${(l.match(/handle:\s*"([^"]*)"/) || [, "?"])[1]}→${p.edit}`);
      }
    }
  }
  rec("④ 모의 사본도 같은 칸을 준다(계정 **한 줄씩** · 화면이 모의로 돌 때 갈리지 않게)", rows.length > 0 && bad.length === 0,
    !rows.length ? "🔴 모의 계정 줄을 못 찾았다 — 이 자를 고쳐라(조용히 통과시키지 않는다)"
      : bad.length ? `🔴 「고칠 값」이 빠진 모의 계정 ${bad.length}곳: ${bad.join(", ")} — 모의로 보면 «괜찮아 보이는» 화면이 된다`
        : `모의 계정 ${rows.length}줄이 전부 두 갈래를 준다`);
}

/* 대조군 — 「보여 줄 값」은 여전히 워밍업을 반영한다 */
{
  const warm = (srv.match(/if \(w\.active\) \{[\s\S]*?\n  \}/) || [""])[0];
  const ok = /effectiveDailyCap\(/.test(warm) && /effectiveMinGapMin\(/.test(warm);
  rec("대조군 — **이 자는 «워밍업을 없애라»가 아니다**(보여 줄 값은 여전히 깎인다)", ok,
    ok ? "워밍업이 도는 동안 `dailyCap`·`minGapMin` 은 유효값이다 — 게이트 셋이 그걸 본다"
      : "🔴 워밍업이 유효값을 안 만든다 — 그건 고친 게 아니라 부순 것이다");
}

console.log("─".repeat(120));
const bad = out.filter((x) => !x.ok).length;
console.log(bad ? `🔴 FAIL ${bad} / ${out.length}` : `PASS ${out.length} · FAIL 0`);
console.log("🔴 실제로 값이 지켜지는지는 `_smoke/cap-overwrite-smoke.mts` 가 잰다(머리말).");
process.exit(bad ? 1 : 0);
