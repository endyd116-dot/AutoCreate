/**
 * scripts/lib/block.mjs — 🔴 **소스에서 «덩이»를 잡되, 못 잡으면 못 잡았다고 말한다**(AC-216 · B2 · 2026-09-22).
 *
 *   ══ 왜 이 파일이 생겼나 — 하루에 **다섯 자리**에서 같은 병이 나왔다 ══
 *     B(`autocreate-b-f8`)가 잣대를 세웠다: **「창을 넓히는 자리는 전부 이 병을 품는다」.**
 *     코드에서 그 병은 세 꼴로 나타난다 —
 *       ① **못 찾으면 파일 전체** (`text.slice(i)` · `src.length` 까지)
 *       ② **못 찾으면 N자**       (`i + 700` · `i + 900` 같은 고정 창 폴백)
 *       ③ **경계가 없어 안 닫힘** (화살표 함수를 `function 이름` 으로 찾는다)
 *     🔴 셋 다 한 문장으로 같다: **«못 잡았는데 답을 냈다».** 넓어진 창은 **옆 덩이를 먹고 조용히 통과시킨다.**
 *
 *   ══ 실제로 겪은 것(짐작이 아니다) ══
 *     · C `verify-requeue-guarded.mjs` — ③. `ops-runners.ts` 핸들러가 화살표라 몸통이 파일 전체가 됐고,
 *       **`import` 한 줄만으로 그 파일의 모든 문이 초록**이었다(B2 가 변이로 확인).
 *     · B `verify-formatmarks-contract.mjs` — ①. `bodyOf` 가 「중괄호가 안 맞으면 `text.slice(i)`」였다.
 *     · B `verify-proxy-failclosed.mjs` — ②. 「못 찾으면 `i + 900`」. 🔴 **바로 위 주석에 그 병을 고친 이야기가 적혀 있었다** —
 *       고친 자리와 안 고친 자리가 한 함수 안에 같이 있었다.
 *     · B2 `verify-subtitle-font.mts` — ②. `+700`·`+900`·`+400`. **변이로 재 보니 둘이 조용한 초록이었다**
 *       (가드를 빼도 통과 · 2026-09-22 `_tmp/mutate-windows.mjs`).
 *     · B2 의 **변이 하니스 자신** — 종료코드만 보고 「자가 아니라고 했다」와 「**자를 못 돌렸다**」를 한 값으로 뭉갰다.
 *
 *   ══ 고침은 한 가지다 ══
 *     🔴 **`null` 을 내고 «못 쟀다»로 적는다.** `✗`(제품이 틀렸다) 가 아니라 **`⊘`(자가 못 쟀다)** 로.
 *        · `⊘` 를 `✓` 에 섞으면 → **조용한 초록**(오늘 둘)
 *        · `⊘` 를 `✗` 에 섞으면 → **자가 깨진 것이 제품이 틀린 것으로 보인다**(오늘 하나)
 *     🔴 그리고 **그걸 잰 변이가 없으면 고쳤다고 할 수 없다** — 「**덩이를 못 잡게 만드는**」 변이
 *        (닻을 지운다 · 끝 표식을 지운다 · 화살표 함수로 바꾼다)가 한 종은 있어야 한다.
 *        이건 축이 «우는» 게 아니라 자가 «멈추는» 쪽이라 **기존 변이 목록과 칸을 나눠** 두는 게 읽기 좋다(B 조언).
 */

/**
 * 🔴 **주석을 걷어 낸다** — 「찾긴 찾았는데 **주석에서** 찾았다」도 같은 병이다(2026-09-22 실측).
 *   덩이를 아무리 정확히 잡아도, 그 안의 **설명 주석**에 `formatMarks` 같은 이름이 적혀 있으면
 *   **코드를 지워도 그 낱말이 남아** 자가 초록을 낸다. 실제로 그랬다:
 *   `runner/core.mjs` 렌더 분기의 가드를 빼도 바로 위 내 주석(「`formatMarks` 를 여기서도 싣는다」)이
 *   걸려서 통과했다. 🔴 **주석이 코드의 알리바이가 됐다** — AC-59(주석이 코드보다 앞서 나갔다)의 사촌이다.
 *   ⚠️ 문자열 리터럴 안의 `//` 는 안 건드린다(자리만 공백으로 치환해 **인덱스를 보존**한다 — 순서 판정이 살아야 한다).
 */
export function stripComments(text) {
  const src = String(text ?? "");
  let out = ""; let i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); const end = e < 0 ? src.length : e + 2; out += " ".repeat(end - i); i = end; continue; }
    if (c === "/" && d === "/") { const e = src.indexOf("\n", i); const end = e < 0 ? src.length : e; out += " ".repeat(end - i); i = end; continue; }
    if (c === '"' || c === "'" || c === "`") {                       // 리터럴은 통째로 넘긴다(그 안의 // 는 주석이 아니다)
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === "\\") j++; j++; }
      out += src.slice(i, Math.min(j + 1, src.length)); i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

/**
 * 닻(`anchor`)으로 시작해 **끝 표식 중 가장 먼저 오는 것**까지를 덩이로 잡는다.
 *   @param {string} text  소스 전문
 *   @param {string} anchor  덩이의 시작 표식(문자열 그대로)
 *   @param {string[]} enders  끝 표식 후보들(문자열 그대로) — **하나도 못 찾으면 `null`**
 *   @param {{maxChars?: number}} [opts]  안전 상한(그 안에서 끝 표식을 못 찾아도 `null`)
 *   @returns {{ body: string, start: number, end: number } | null}
 *     🔴 **`null` 은 «덩이를 못 잡았다»다 — «가드가 없다»가 아니다.** 부르는 쪽이 `⊘` 로 적어야 한다.
 */
export function blockOf(text, anchor, enders, opts = {}) {
  const src = String(text ?? "");
  const start = src.indexOf(anchor);
  if (start < 0) return null;                       // 🔴 닻이 없다 — 코드가 바뀌었다. «가드 없음»이 아니다.
  const limit = Math.min(src.length, start + (opts.maxChars ?? 20_000));
  let end = -1;
  for (const e of enders) {
    const i = src.indexOf(e, start + anchor.length);
    if (i >= 0 && i < limit && (end < 0 || i < end)) end = i;
  }
  if (end < 0) return null;                          // 🔴 끝을 못 찾았다 — **파일 끝까지 넓히지 않는다**
  return { body: src.slice(start, end), start, end };
}

/**
 * 덩이 안에서 **A 가 B 보다 앞인가** — «있나»가 아니라 «**어디에** 있나».
 *   🔴 순서로 재면 창이 조금 넓어도 잘 버틴다: 옆 덩이의 것을 주워도 **자리가 뒤**라 걸린다.
 *   @returns {{ ok: boolean, why: string } | null} `null` = 둘 중 하나를 못 찾았다(⊘)
 */
export function orderIn(body, firstRe, secondRe) {
  if (body == null) return null;
  const a = body.search(firstRe);
  const b = body.search(secondRe);
  if (a < 0 || b < 0) return null;
  return { ok: a < b, why: a < b ? "" : "🔴 순서가 뒤바뀌었다" };
}

/**
 * 자 한 벌의 «세 값» 집계기 — `✓ 맞다` · `✗ 틀리다` · `⊘ 못 쟀다`.
 *   🔴 **`⊘` 가 하나라도 있으면 종료코드가 0 이 아니다.** 「못 쟀는데 통과」가 이 파일이 막으려는 전부다.
 *   종료코드: 0 = 전부 ✓ · 1 = ✗ 가 있다(제품) · 2 = ✗ 는 없고 ⊘ 가 있다(**자가 못 쟀다**)
 */
export function tally() {
  let pass = 0, fail = 0, unmeasured = 0;
  return {
    ok(name, cond, extra = "") {
      if (cond) { pass++; console.log(`  ✓ ${name}`); }
      else { fail++; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ""}`); }
    },
    /** 🔴 덩이를 못 잡았을 때. **✗ 로 적지 마라** — 제품이 틀린 게 아니라 자가 못 잰 것이다. */
    unmeasured(name, why = "") {
      unmeasured++;
      console.log(`  ⊘ ${name} — 못 쟀음${why ? `(${why})` : ""}`);
    },
    /** 덩이가 `null` 이면 ⊘, 아니면 판정. 부르는 쪽이 매번 갈래를 안 쓰게. */
    okOr(name, block, judge, extra = "") {
      if (block == null) return this.unmeasured(name, "덩이를 못 잡았다 — 닻이나 끝 표식이 바뀌었나");
      return this.ok(name, judge(block), extra);
    },
    done(label) {
      const mark = fail > 0 ? "🔴" : unmeasured > 0 ? "⊘" : "🟢";
      console.log(`\n${mark} ${label ? `${label} — ` : ""}pass ${pass} · fail ${fail} · 못 쟀음 ${unmeasured}`);
      if (unmeasured > 0 && fail === 0) {
        console.log("🔴 **못 쟀는데 통과로 넘기지 않는다** — 자가 덩이를 못 잡았다면 그건 «맞다»가 아니다(종료 2).");
      }
      return fail > 0 ? 1 : unmeasured > 0 ? 2 : 0;
    },
  };
}
