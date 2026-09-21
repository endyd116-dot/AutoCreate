/**
 * scripts/_lib/code-only.mjs — **주석을 걷은 본문**. 🔴 순수(임포트 0).
 *
 *   ══ 왜 «한 곳»인가 ══
 *     2026-09-19 에 **두 창이 각자 만들어 각자 틀렸다**:
 *       · B2 `verify-video-motion-mutants.mjs` — 「줄 앞이 `*` 면 지운다」 ⇒ 블록 주석의 **이어지는 줄**이 남았다(C 실측: **42줄**)
 *       · B2 `verify-runner-live-inside.mts`   — 같은 방식으로 시작했다가 **거짓 빨강**을 냈다
 *       · C  `verify-runner-live-content.mts`  — 주석을 **아예 안 걷어** 거짓 빨강을 냈다
 *     🔴 **그 병(«주석과 본문을 안 가른다»)을 재려고 만든 자들이 그 병에 걸렸다.** 셋 다 같은 자리다.
 *     ⇒ 셈을 두 벌·세 벌로 두면 또 갈린다. **여기 한 곳**에서 나온다.
 *
 *   ══ 🔴 줄 수를 **보존한다** ══
 *     C 가 이걸 재다 한 번 더 틀렸다: 블록 주석을 공백 하나로 접었더니 **줄 번호가 어긋나** 「주석인데 살아남은 줄 215개」라는
 *     거짓 표가 나왔다(`import {…}` 까지 섞였다). 🔴 **두 본문을 줄 번호로 맞댈 때 한쪽이 줄을 잃으면 그 표는 통째로 거짓이다.**
 *     ⇒ 걷어 낸 자리의 **줄바꿈은 되넣는다**. 그래야 「원본 N번째 줄」과 「걷은 N번째 줄」이 같은 줄을 가리킨다.
 *
 *   ══ ⚠️ **아직 못 하는 것 — 알고 둔다**(«넉넉하다»로 뭉개지 않는다) ══
 *     이 함수는 파서가 아니라 **글자 훑기**다. 문자열·정규식 안을 모른다.
 *       · `"https://x"` — 🔴 **가린다**(`:` 바로 뒤의 `//` 는 주석으로 안 본다 · 2026-09-19 추가)
 *       · `"a // b"`    — ❌ **못 가린다**. `//` 뒤가 지워진다. 러너 .mjs 37개를 훑어 **그런 줄은 0개**라 지금은 안 물린다
 *       · 🔴 **정규식 리터럴 안의 `\/\/`** — ❌ **못 가린다. 그리고 이건 실제로 물렸다**(2026-09-21 B2).
 *         `if (/https?:\/\//.test(...)) { await waitLinkCards(); … }` 한 줄이 **통째로 사라져**
 *         그 줄을 보는 축이 **거짓 빨강**을 냈다(`verify-enter-split` c2). 🔴 **주석에 속는 것보다 줄이 사라지는 것이 크다.**
 *         ⇒ 주소 검사·경로 정규식이 든 줄을 보는 축은 **`raw` 를 봐라**(그 대신 그 낱말을 주석에 쓰지 마라)
 *       · 문자열 안에 **블록 주석 여는 글자**가 든 경우 — ❌ **못 가린다**. 같은 이유
 *     ⇒ 「그 낱말이 **실행되는 코드**에 있나」를 보는 데 쓴다. **파서가 필요한 일에는 쓰지 마라.**
 *     🔴 이 목록을 **비워 두지 않는다** — 「이 정도면 넉넉하다」로 적어 두면 다음 사람이 한계를 모르고 넓힌다.
 */

const NL = String.fromCharCode(10);   // 🔴 이 환경의 셸이 역슬래시를 먹는다 — 이스케이프를 아예 안 쓴다

/** 주석을 지운 소스(줄 수 보존). */
export function codeOnly(src) {
  const t = String(src ?? "");
  let out = "";
  let i = 0;
  while (i < t.length) {
    const two = t.slice(i, i + 2);
    if (two === "/*") {
      const end = t.indexOf("*" + "/", i + 2);
      const stop = end < 0 ? t.length : end + 2;
      /* 🔴 지운 자리의 줄바꿈만 되넣는다 — 줄 번호가 안 밀려야 «몇 번째 줄»이 참말이 된다. */
      for (let k = i; k < stop; k++) if (t[k] === NL) out += NL;
      i = stop;
      continue;
    }
    if (two === "//") {
      /* 🔴 **`:` 바로 뒤의 `//` 는 주석이 아니다** — `https://…` 다(2026-09-19 · C 실측 · B2 재확인).
         안 가리면 **코드가 사라진다**: 러너 .mjs 37개 중 **20파일 47줄**이 `await page.goto(`https:` 에서 잘렸다.
         🔴 앞의 «44줄 누수»와 **방향이 반대라 더 나쁘다** — 그건 주석이 코드로 보이는 것이고(헛 빨강),
            이건 **코드가 없어 보이는 것**이다(«그 낱말이 코드에 없다» = 조용한 초록).
         잣대는 우리 안에 이미 있었다: `verify-r8-deadends.mjs` 의 «`:` 바로 뒤가 아닐 때만 줄 주석». */
      if (t[i - 1] === ":") { out += t[i]; i += 1; continue; }
      const end = t.indexOf(NL, i);
      i = end < 0 ? t.length : end;      // 줄바꿈 자체는 안 먹는다(다음 바퀴에서 그대로 실린다)
      continue;
    }
    out += t[i];
    i += 1;
  }
  return out;
}

/**
 * 🔴 **자리 표까지 보존하는 판**(2026-09-22 · AC-193 · B2 가 필요로 해서 **여기 한 곳에** 만든다).
 *
 *   ══ 왜 또 하나인가 ══
 *     위 `codeOnly` 는 **줄 수**는 지키지만 **글자 자리(index)**는 안 지킨다(주석 글자를 통째로 뺀다).
 *     그래서 「어느 쪽이 **먼저** 나오나」(순서 판정)를 `indexOf` 로 재는 자는 걷은 본문으로는 **답이 달라진다.**
 *     ⇒ 주석 글자를 **공백으로 바꿔** 길이·자리를 그대로 둔다. 줄바꿈은 줄바꿈으로 남긴다.
 *        「원문에서 잰 자리」와 「걷은 본문에서 잰 자리」가 **같은 곳**을 가리킨다.
 *
 *   ══ 🔴 왜 «두 벌»을 안 만드는가 ══
 *     2026-09-22 에 B2 가 자기 자에 `stripComments` 를 따로 만들었다. 좋은 함수였지만 **두 벌째**다 —
 *     이 파일 머리말이 적어 둔 그대로 «두 벌·세 벌로 두면 또 갈린다»의 세 번째 판이 될 뻔했다.
 *     ⇒ 필요한 것은 **새 모듈이 아니라 이 파일의 변이형**이었다. 갈래가 늘면 **여기에** 는다.
 *
 *   ⚠️ 한계는 `codeOnly` 와 **똑같다**(문자열 안 `//`·정규식 안 `\/\/` 는 못 가린다) — 위 머리말 그대로다.
 *      한쪽만 고치면 또 갈리므로 **둘은 같은 눈을 쓴다**(아래 구현이 `codeOnly` 와 한 몸인 이유).
 */
export function codeOnlyKeepIndex(src) {
  const t = String(src ?? "");
  const out = [];
  let i = 0;
  const blank = (from, to) => { for (let k = from; k < to; k++) out.push(t[k] === NL ? NL : " "); };
  while (i < t.length) {
    const two = t.slice(i, i + 2);
    if (two === "/*") {
      const end = t.indexOf("*" + "/", i + 2);
      const stop = end < 0 ? t.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (two === "//") {
      if (t[i - 1] === ":") { out.push(t[i]); i += 1; continue; }   // `https://…` — 주석이 아니다
      const end = t.indexOf(NL, i);
      const stop = end < 0 ? t.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    out.push(t[i]);
    i += 1;
  }
  return out.join("");
}

/** 본문에서만 센다 — 「변이를 몇 곳에 심었나」·「그 낱말이 코드에 있나」의 정본. */
export function countInCode(src, needle) {
  if (!needle) return 0;
  return codeOnly(src).split(needle).length - 1;
}
