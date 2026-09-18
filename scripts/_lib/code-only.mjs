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
 *   ⚠️ **문자열 안의 `/*` 는 안 가린다.** 이 함수는 «그 낱말이 **실행되는 코드**에 있나»를 보는 데 쓰라고 만든 것이고,
 *      거기에는 이 정도면 넉넉하다. 파서가 필요한 일에는 쓰지 마라.
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
      const end = t.indexOf(NL, i);
      i = end < 0 ? t.length : end;      // 줄바꿈 자체는 안 먹는다(다음 바퀴에서 그대로 실린다)
      continue;
    }
    out += t[i];
    i += 1;
  }
  return out;
}

/** 본문에서만 센다 — 「변이를 몇 곳에 심었나」·「그 낱말이 코드에 있나」의 정본. */
export function countInCode(src, needle) {
  if (!needle) return 0;
  return codeOnly(src).split(needle).length - 1;
}
