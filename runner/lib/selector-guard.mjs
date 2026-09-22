/**
 * runner/lib/selector-guard.mjs — 🔴 **서버가 밀어 준 셀렉터가 «죽은 모양»이면 안 쓴다**(AC-205 · B2 · 2026-09-23).
 *
 *   ══ 왜 ══
 *     어제 `locator("text=이용이 제한, text=제재")` 가 **한 번도 안 걸렸다** — 콤마가 CSS 목록 문법이라
 *     `text=` 엔진과 섞이면 **한 문자열**로 읽힌다(브라우저로 쟀다: 실제 문구에 0/0).
 *     그래서 **제재당한 계정에 계속 글을 밀어 넣었다.**
 *     🔴 그건 소스에 적힌 것이라 고쳤는데, **같은 모양이 서버 레시피로 들어올 수 있다** —
 *        `recipe.mjs sel(name)` 은 **비어 있지만 않으면 무엇이든** 쓴다(검사 0).
 *        레시피는 «러너를 다시 배포하지 않고 셀렉터를 고치는 길»이라 **오타 한 번이면 그대로 나간다.**
 *     🔴 그리고 **안 보인다**: 호출부가 거의 다 `.catch(() => 0)` 이라 **터져도 «없네»로 읽힌다.**
 *
 *   ══ 🔴 규율 — «내가 죽었다고 **잰** 모양»만 거부한다 ══
 *     거짓 빨강은 조용한 초록만큼 나쁘다(오늘 B 에게 배운 것). 여기서 멀쩡한 셀렉터를 거부하면
 *     **서버가 고쳐 보낸 수리가 묻힌다** — 그게 더 비쌀 수 있다.
 *     ⇒ 아래 두 가지만 본다. 둘 다 `scripts/probe-selector-guard.mjs` 가 **진짜 브라우저로** 죽은 것을 확인했다.
 *       ① **콤마로 엔진 섞기** — 안 터지고 조용히 한 문자열이 된다(제일 위험하다)
 *       ② **괄호·대괄호가 안 맞음** — 터진다(그리고 `.catch` 가 삼킨다)
 *     🔴 «의심스럽다»는 거부 사유가 아니다. 새 규칙은 **브라우저로 재서** 넣어라.
 *
 *   ══ 거부하면 조용하지 않게 ══
 *     거부 = **묶여 온 표로 되돌아간다**(영상·글은 그대로 나간다 · CLAUDE §9 «막지 않는다»).
 *     🔴 다만 **적는다** — `recipe.rejected` 로 보고에 실려 운영이 «서버 표가 깨졌다»를 본다.
 *        안 적으면 서버 표가 깨진 채로 조용히 묶여 온 표로 돌고, 아무도 모른다.
 *
 *   순수 함수다(DOM·네트워크 0).
 */

/** 셀렉터 엔진 앞머리 — 콤마로 이어지면 CSS 목록으로 읽혀 **한 문자열**이 된다. */
const ENGINE = /(?:^|,)\s*(?:text|css|xpath|role|id|data-testid|internal:[a-z-]+)\s*=/g;

/**
 * 🔴 «죽은 모양»인가(순수). @returns `{ dead: boolean, why: string }`
 *   `dead:false` 는 «맞다»가 **아니다** — «내가 아는 죽은 모양은 아니다»까지다(AC-9).
 *   과녁이 틀린 셀렉터는 여기서 못 잡는다. 그건 실물 화면이 답한다.
 */
export function selectorLooksDead(sel) {
  const s = String(sel ?? "");
  if (!s.trim()) return { dead: true, why: "empty" };

  /* ① 콤마로 엔진 둘 이상 — 실측으로 죽었다(실제 문구에 0). */
  const engines = s.match(ENGINE) ?? [];
  if (engines.length > 1) return { dead: true, why: "engines_joined_by_comma" };

  /* ② 괄호·대괄호 짝 — 안 맞으면 터진다.
     🔴 **따옴표 안은 안 센다** — `[aria-label="a]b"]` 같은 멀쩡한 것을 거부하면 그게 거짓 빨강이다. */
  let round = 0; let square = 0; let quote = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(") round++;
    else if (c === ")") { round--; if (round < 0) return { dead: true, why: "unbalanced_paren" }; }
    else if (c === "[") square++;
    else if (c === "]") { square--; if (square < 0) return { dead: true, why: "unbalanced_bracket" }; }
  }
  if (quote) return { dead: true, why: "unclosed_quote" };
  if (round !== 0) return { dead: true, why: "unbalanced_paren" };
  if (square !== 0) return { dead: true, why: "unbalanced_bracket" };

  return { dead: false, why: "" };
}

/** 사람말(운영 화면용 · CLAUDE §3 — 위협 0 · 무엇이 왜 · 우리가 한 것). */
export const SELECTOR_REJECT_SAY = {
  empty: "서버 표의 값이 비어 있어 묶여 온 값으로 돌렸어요.",
  engines_joined_by_comma: "서버 표의 값이 콤마로 이어져 있어 한 덩어리로 읽혀요 — 묶여 온 값으로 돌렸어요.",
  unbalanced_paren: "서버 표의 값에 괄호가 맞지 않아 묶여 온 값으로 돌렸어요.",
  unbalanced_bracket: "서버 표의 값에 대괄호가 맞지 않아 묶여 온 값으로 돌렸어요.",
  unclosed_quote: "서버 표의 값에 따옴표가 닫히지 않아 묶여 온 값으로 돌렸어요.",
};
