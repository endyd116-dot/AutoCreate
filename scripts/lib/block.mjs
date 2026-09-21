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
 *     · ④ **주석이 알리바이** — 덩이를 정확히 잡고도 **주석에 이름이 남아** 코드를 지운 변이가 통과했다(B2·B 둘 다).
 *     · ⑤ **창이 넓어 옆 코드를 줍는다** — 주석을 걷어도 남는다. B2 가 `writeAudit\([\s\S]{0,400}` 로 바로 뒤
 *       `return json({…recovered})` 를 주워 왔고, B 는 감사 축에 **코드 미끼**를 심어 뚫어 보였다.
 *       🔴 **④를 고쳤다고 ⑤가 닫히지 않는다** — 따로 막아야 한다.
 *     · (가로지름) 🔴 **닻이 여럿인데 첫 것만 본다** — «엉뚱한 **덩이**»를 본다. B 가 `INSERT INTO notifications`
 *       5곳에서 겪었다(제품은 멀쩡한데 빨강 · 반대 방향이면 **조용한 초록**). ⇒ `blockOf` 기본 `unique:true`.
 *
 *   🔴 한 줄로: ①②③ = «못 잡았는데 답했다» · ④⑤ = «잡았는데 **엉뚱한 글자**» · 가로지름 = «**엉뚱한 덩이**».
 *      고침도 그 결대로 셋이다 — **`null` 내고 ⊘** · **주석 걷기 + 창 좁히기** · **닻의 유일성**.
 *      그리고 **셋 다 변이 한 종**이 있어야 고쳤다고 할 수 있다.
 *
 *   ══ 고침은 한 가지다 ══
 *     🔴 **`null` 을 내고 «못 쟀다»로 적는다.** `✗`(제품이 틀렸다) 가 아니라 **`⊘`(자가 못 쟀다)** 로.
 *        · `⊘` 를 `✓` 에 섞으면 → **조용한 초록**(오늘 둘)
 *        · `⊘` 를 `✗` 에 섞으면 → **자가 깨진 것이 제품이 틀린 것으로 보인다**(오늘 하나)
 *     🔴 그리고 **그걸 잰 변이가 없으면 고쳤다고 할 수 없다** — 「**덩이를 못 잡게 만드는**」 변이
 *        (닻을 지운다 · 끝 표식을 지운다 · 화살표 함수로 바꾼다)가 한 종은 있어야 한다.
 *        이건 축이 «우는» 게 아니라 자가 «멈추는» 쪽이라 **기존 변이 목록과 칸을 나눠** 두는 게 읽기 좋다(B 조언).
 */

/* ═══ 🔴 주석 걷기는 **여기서 만들지 않는다** — 이미 집이 있다(B 지적 2026-09-22) ═══
 *   `scripts/_lib/code-only.mjs` 가 **바로 이 병으로 태어난 파일**이다: 2026-09-19 에 **세 창이 각자 만들어
 *   각자 틀렸고**(B2 둘 · C 하나) 「셈을 두 벌·세 벌로 두면 또 갈린다 — **여기 한 곳**에서 나온다」로 합친 것이다.
 *   🔴 나는 그걸 못 보고 `stripComments` 를 새로 팠다 — **세 번째 판**이 될 뻔했다.
 *      «두 벌을 만들지 마라»를 배운 파일 옆에서 두 벌을 만든 것이라, 이 주석을 길게 남긴다.
 *   ⚠️ 다만 내가 **필요로 한 것은 진짜로 없던 것**이었다: `codeOnly` 는 줄 수는 지키지만 주석 글자를 **빼서
 *      자리(index)가 밀린다** — 순서를 `indexOf` 로 재는 자에겐 못 쓴다.
 *      ⇒ B 가 **새 모듈이 아니라 그 파일의 갈래**로 `codeOnlyKeepIndex` 를 냈다(공백으로 치환 · 길이·자리 보존).
 *   🔴 한계는 `codeOnly` 와 **똑같다**(문자열 속 `//`·정규식 속 `\/\/` 는 못 가린다) — 그래서 **같은 눈**을 쓴다.
 *      한쪽만 고치면 또 갈린다. 고칠 일이 있으면 `scripts/_lib/code-only.mjs` 를 고쳐라.
 */
export { codeOnlyKeepIndex as stripComments } from "../_lib/code-only.mjs";

/** 닻이 몇 번 나오나(겹치지 않게 센다). */
function countOf(src, anchor) {
  let n = 0; let i = src.indexOf(anchor);
  while (i >= 0) { n++; i = src.indexOf(anchor, i + anchor.length); }
  return n;
}

/**
 * 닻(`anchor`)으로 시작해 **끝 표식 중 가장 먼저 오는 것**까지를 덩이로 잡는다.
 *   @param {string} text  소스(보통 **이미 좁혀 놓은** 덩이)
 *   @param {string} anchor  덩이의 시작 표식(문자열 그대로)
 *   @param {string[]} enders  끝 표식 후보들(문자열 그대로) — **하나도 못 찾으면 `null`**
 *   @param {{maxChars?: number, unique?: boolean}} [opts]
 *     `maxChars` 안전 상한(그 안에서 끝 표식을 못 찾아도 `null`) ·
 *     `unique` **기본 켬** — 닻이 둘 이상이면 `null`(아래 까닭)
 *   @returns {{ body: string, start: number, end: number, count: number } | null}
 *     🔴 **`null` 은 «덩이를 못 잡았다»다 — «가드가 없다»가 아니다.** 부르는 쪽이 `⊘` 로 적어야 한다.
 *
 *   🔴 ══ **닻이 여럿이면 답이 거짓이다**(B 가 짚었다 · 2026-09-22) ══
 *     종전엔 `indexOf` 로 **첫 번째**를 집었다. 그런데 닻이 여럿이면 **엉뚱한 덩이**를 떠 오고,
 *     그 답은 **빨강이든 초록이든 거짓**이다. B 가 실제로 겪었다: `INSERT INTO notifications` 가
 *     `runner-jobs.ts` 에 **5곳**이라 딴 알림 자리를 떠 왔고 **제품은 멀쩡한데 빨개졌다.**
 *     🔴 이번엔 빨강이라 알아챘지만 **반대 방향이면 조용한 초록**이다.
 *     ⇒ 기본을 **`unique: true`** 로 둔다 — 애매하면 답하지 않는다(그게 이 파일의 전부다).
 *     ⇒ 일부러 첫 것을 쓰려면 `unique:false` 로 **적어서** 쓴다(그러면 `count` 를 보고 판단하라).
 *     ⚠️ 부르는 쪽이 **먼저 범위를 좁히는 것**이 정답이다 — 갈래 몸통을 잡고 그 안에서 닻을 찾아라.
 */
export function blockOf(text, anchor, enders, opts = {}) {
  const src = String(text ?? "");
  const count = countOf(src, anchor);
  if (count === 0) return null;                     // 🔴 닻이 없다 — 코드가 바뀌었다. «가드 없음»이 아니다.
  if (count > 1 && opts.unique !== false) return null;   // 🔴 애매하다 — 첫 것을 집어 답하지 않는다
  const start = src.indexOf(anchor);
  const limit = Math.min(src.length, start + (opts.maxChars ?? 20_000));
  let end = -1;
  for (const e of enders) {
    const i = src.indexOf(e, start + anchor.length);
    if (i >= 0 && i < limit && (end < 0 || i < end)) end = i;
  }
  if (end < 0) return null;                          // 🔴 끝을 못 찾았다 — **파일 끝까지 넓히지 않는다**
  return { body: src.slice(start, end), start, end, count };
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
