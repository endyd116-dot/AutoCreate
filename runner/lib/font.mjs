/**
 * runner/lib/font.mjs — 🔴 **«자막을 어느 폰트로 그렸나»를 잰다**(AC-202 · B2 · 2026-09-22).
 *
 *   ══ 왜 이게 폰트 동봉보다 **먼저**인가 ══
 *     `render-video.mjs` 의 `@font-face` 는 `src: local("Pretendard")` **하나뿐**이었다.
 *     `local()` 은 «그 PC 에 깔려 있으면»이라는 뜻이다 — 없으면 브라우저가 **조용히** 다음 후보로 내려간다.
 *     러너에 한글 폰트 파일은 **0개**였다(2026-09-22 실측: `.ttf/.otf/.woff*` 셋뿐이고 전부 playwright 아이콘 폰트).
 *     ⇒ 지금까지 구운 **모든 자막이 맑은 고딕**이었을 가능성이 크다. **글자가 안 깨지니 아무도 못 봤다.**
 *     🔴 그런데 **재지 않고 고치면 고쳤는지 모른다.** 그래서 축이 먼저다.
 *
 *   ══ 어떻게 재나 — 🔴 **자 셋을 대고 서로 같은 말을 할 때만 «맞다»고 한다** ══
 *     ① `@font-face` 의 **status** — 브라우저가 그 면(face)을 **실제로 받았나**. `loaded` / `error` / `unloaded`.
 *        🔴 **제일 센 자다.** 2026-09-22 첫 실측에서 이 값이 곧바로 `"error"` 로 나왔다 —
 *           `local("Pretendard")` 가 **없는 폰트를 가리키고 있었다**는 브라우저의 자백이다.
 *     ② `document.fonts.check()` — 「이 패밀리를 쓸 수 있나」. 🔴 `document.fonts.ready` 를 기다린 **뒤에**
 *        물어야 한다(안 기다리면 멀쩡히 동봉한 `url()` 폰트도 «없다»로 나온다).
 *     ③ **글자 너비** — canvas 로 같은 문장을 재서 **대조군과 견준다.** 대조군은 «절대 없는 이름»이고
 *        그게 곧 **브라우저 기본**이다. 「Pretendard 로 쟀는데 기본과 폭이 같다」 = 안 걸렸다는 뜻.
 *     🔴 셋을 다 보는 까닭: `check()` 는 이름만 보고 참을 낼 수 있고, 폭만 보면 우연히 같은 폭인 폰트를 못 가른다.
 *        **한 자만 믿으면 조용히 틀린다.**
 *
 *   🔴 ══ 첫 실측이 **내 자의 결함**을 먼저 잡았다(2026-09-22) ══
 *     처음엔 「`used` 가 맑은 고딕 폭과 같으면 맑은 고딕이다」로 적어 놨다. 그런데 실측해 보니
 *     **네 폭이 전부 1605.57 로 같았다** — 이 PC(한국어 윈도)에서는 **브라우저 기본이 곧 맑은 고딕**이라
 *     「이름 있는 폴백에 맞았다」와 「그냥 기본으로 떨어졌다」를 **폭으로는 가를 수 없다.**
 *     그런데도 자는 «맑은 고딕»이라고 **단정**하고 있었다 — 못 가르는 것을 가른 척한 것이다(AC-9).
 *     ⇒ 이제 그 경우는 `family` 를 주되 `ambiguous:true` 를 같이 적는다. **결론(«Pretendard 가 아니다»)은
 *        그대로 단단하다** — 그건 폭이 아니라 ①face status 와 ②check 가 받치기 때문이다.
 *
 *   🔴 판정은 **세 값**이다(AC-9): `bundled`(뜻대로 그렸다) · `fallback`(다른 걸로 그렸다 · 무엇인지도 적는다) ·
 *      `unknown`(**못 쟀다**). 못 잰 것을 «맞다»로 접지 않는다 — 그러면 이 축이 있으나 마나다.
 *
 *   순수 함수(`judgeFont`)와 브라우저 호출(`measureOverlayFont`)을 갈라 놨다 —
 *   `scripts/verify-subtitle-font.mts` 가 브라우저 없이 판정만 돌린다.
 */

/** 자막에 실제로 나오는 모양대로 잰다 — 한글·숫자·영문·문장부호가 섞인 문장이라야 폭 차이가 드러난다. */
export const FONT_SAMPLE = "전기요금 3만원 아끼는 법 ABC 123";

/** 절대 설치돼 있을 리 없는 이름 = **브라우저 기본**을 끌어내는 대조군. */
export const BOGUS_FAMILY = "__ac_no_such_font_9x8y7z__";

/**
 * 🔴 판정(순수). 브라우저가 가져온 숫자만 보고 «어느 폰트로 그렸나»를 가른다.
 *
 * @param m.faceStatus `"loaded"|"error"|"unloaded"|null` — 노린 패밀리의 `@font-face` 상태(제일 센 자)
 * @param m.checks  `{ target:boolean, fallbackNamed?:boolean }` — `document.fonts.check()` 결과
 * @param m.widths  `{ used, target, bogus, fallbackNamed? }` — canvas 로 잰 픽셀 폭
 * @param m.targetFamily 노리는 패밀리 이름(보통 "Pretendard")
 * @param m.fallbackName 대 볼 폴백 이름(보통 "Malgun Gothic") — 없으면 이름까지는 못 짚는다
 * @returns `{ kind, family, why, ambiguous?, evidence }`
 *   · `bundled`  자들이 같은 말을 한다 — 노린 폰트로 그렸다
 *   · `fallback` 노린 폰트가 **안 걸렸다** — `family` 에 무엇으로 그렸는지(알면 이름, 모르면 null)
 *     🔴 `ambiguous:true` 면 **이름은 짚었지만 브라우저 기본과 폭이 같아 둘을 못 가른다**(결론은 그대로 «Pretendard 아님»)
 *   · `unknown`  🔴 **못 쟀다.** 숫자가 안 왔거나 자들이 어긋난다 — «맞다»로도 «틀리다»로도 접지 않는다
 */
export function judgeFont(m) {
  const target = String(m?.targetFamily ?? "Pretendard");
  const fbName = m?.fallbackName ? String(m.fallbackName) : null;
  const w = m?.widths ?? {};
  const c = m?.checks ?? {};
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const used = num(w.used), tw = num(w.target), bw = num(w.bogus), fw = num(w.fallbackNamed);
  const evidence = { checks: c, widths: { used, target: tw, bogus: bw, fallbackNamed: fw } };

  // 숫자가 안 왔으면 거기서 끝이다 — 못 쟀다.
  if (used === null || tw === null || bw === null) {
    return { kind: "unknown", family: null, why: "widths_missing", evidence };
  }

  const status = m?.faceStatus ?? null;
  evidence.faceStatus = status;
  const checkSaysYes = c.target === true;
  /* 🔴 «노린 폰트가 실제로 다른 글꼴이다»의 증거 = **기본과 폭이 다르다.**
     같으면 `@font-face` 가 안 걸려 기본으로 그려진 것이다(이름만 적혀 있고 실체가 없는 상태). */
  const widthSaysYes = tw !== bw;

  /* 🔴 ① face status 가 `error` 면 **거기서 끝이다.** 브라우저가 «그 면을 못 받았다»고 말한 것이라
     다른 자가 뭐라 하든 노린 폰트로 그려질 수가 없다. 2026-09-22 실측이 정확히 이 값이었다. */
  if (status === "error") {
    return { kind: "fallback", ...nameFallback(), evidence };
  }

  if (checkSaysYes && widthSaysYes && status !== "unloaded") {
    return { kind: "bundled", family: target, why: null, evidence };
  }

  /* 🔴 자들이 **어긋나면** `unknown` 이다 — 한쪽을 골라 믿지 않는다.
     (예: check 는 참인데 폭이 기본과 같다 = 이름은 아는데 실제로는 기본으로 그렸을 수도,
      우리 측정이 틀렸을 수도 있다. 둘을 가를 재료가 없으므로 «못 쟀다»가 정직하다.) */
  if (checkSaysYes !== widthSaysYes) {
    return { kind: "unknown", family: null, why: "signals_disagree", evidence };
  }
  /* face 를 아직 안 받았는데 폭도 기본과 같다 — 받는 중일 수 있다. 단정하지 않는다. */
  if (status === "unloaded" && !widthSaysYes) {
    return { kind: "unknown", family: null, why: "face_unloaded", evidence };
  }

  // 자들이 다 «아니다» — 확실히 폴백이다. 무엇으로 그렸는지 짚어 본다.
  return { kind: "fallback", ...nameFallback(), evidence };

  /**
   * 🔴 **무엇으로 그렸는지**를 짚되, 못 짚는 경우를 «짚은 척» 하지 않는다.
   *   이름 있는 폴백 폭 == 브라우저 기본 폭이면(한국어 윈도가 그렇다 — 기본이 곧 맑은 고딕)
   *   둘을 **가를 수 없다.** 이름은 주되 `ambiguous` 를 달아 보낸다.
   */
  function nameFallback() {
    const matchesNamed = fbName && fw !== null && used === fw;
    const matchesDefault = used === bw;
    if (matchesNamed && matchesDefault) {
      return { family: fbName, why: "named_fallback_equals_default", ambiguous: true };
    }
    if (matchesNamed) return { family: fbName, why: "matched_named_fallback" };
    if (matchesDefault) return { family: null, why: "browser_default" };
    return { family: null, why: "target_absent" };
  }
}

/**
 * 오버레이 페이지에서 실제로 잰다. **이미 열려 있는 page** 를 받는다(새로 열지 않는다 — 같은 페이지라야 같은 조건이다).
 *   ⚠️ 던지지 않는다 — 폰트를 못 쟀다고 영상 굽기를 멈추면 그게 «모른다로 막기»다(CLAUDE §9).
 */
export async function measureOverlayFont(page, opts = {}) {
  const targetFamily = String(opts.targetFamily ?? "Pretendard");
  const fallbackName = opts.fallbackName === undefined ? "Malgun Gothic" : opts.fallbackName;
  const sample = String(opts.sample ?? FONT_SAMPLE);
  try {
    const m = await page.evaluate(async ([target, fbName, sample, bogus]) => {
      /* 🔴 `url()` 폰트는 **받아야** 쓸 수 있다 — 안 기다리고 물으면 멀쩡히 동봉한 폰트도 «없다»가 된다.
         ⚠️ **`document.fonts.ready` 만으로는 모자랐다**(2026-09-22 실측): 화면에 그 글꼴로 그려진 글자가
            아직 없으면 브라우저는 **아예 받기 시작하지도 않는다**. 처음엔 이걸 몰라서 동봉한 뒤에도
            status 가 `"loading"` 인 채로 재고 «폴백»이라 읽었다 — **자가 고친 것을 못 봤다.**
         ⇒ `document.fonts.load()` 로 **그 굵기·그 글자를 콕 집어 받으라고 시키고** 기다린다. */
      try { await document.fonts.load(`800 100px "${target}"`, sample); } catch { /* 없으면 아래에서 드러난다 */ }
      try { await document.fonts.ready; } catch { /* 없으면 그냥 간다 */ }
      const ctx = document.createElement("canvas").getContext("2d");
      const widthOf = (family) => {
        try { ctx.font = `800 100px ${family}`; const v = ctx.measureText(sample).width; return Number.isFinite(v) ? Math.round(v * 100) / 100 : null; }
        catch { return null; }
      };
      const checkOf = (family) => { try { return document.fonts.check(`800 100px ${family}`); } catch { return null; } };
      const q = (n) => `"${String(n).replace(/"/g, "")}"`;
      return {
        widths: {
          /* 🔴 `used` 는 **body 가 실제로 쓰는 스택 그대로** 잰다 — 우리가 고른 이름이 아니라 «그려진 것»을 재야 한다. */
          used: widthOf(getComputedStyle(document.body).fontFamily || q(target)),
          target: widthOf(q(target)),
          bogus: widthOf(q(bogus)),
          ...(fbName ? { fallbackNamed: widthOf(q(fbName)) } : {}),
        },
        checks: { target: checkOf(q(target)), ...(fbName ? { fallbackNamed: checkOf(q(fbName)) } : {}) },
        bodyStack: getComputedStyle(document.body).fontFamily || null,
        faces: [...(document.fonts || [])].map((f) => ({ family: f.family, status: f.status })).slice(0, 8),
        /* 🔴 노린 패밀리의 `@font-face` 상태 — **제일 센 자다.** 없으면 null(«면 자체가 없다»). */
        faceStatus: (() => {
          try { for (const f of document.fonts) if (String(f.family).replace(/["']/g, "") === target) return f.status; } catch { /* 무시 */ }
          return null;
        })(),
      };
    }, [targetFamily, fallbackName, sample, BOGUS_FAMILY]);
    const v = judgeFont({ ...m, targetFamily, fallbackName });
    return { ...v, bodyStack: m.bodyStack, faces: m.faces, sample };
  } catch (e) {
    return { kind: "unknown", family: null, why: `measure_failed:${String(e?.message ?? e).slice(0, 60)}`, evidence: null, sample };
  }
}

/** 사람말 한 줄 — 보고(`notes`)에 싣는다. 🔴 «못 쟀음»을 «맞다»로 적지 않는다. */
export function fontSay(v) {
  if (!v) return "자막 폰트를 못 쟀어요";
  if (v.kind === "bundled") return `자막을 ${v.family} 로 그렸어요`;
  if (v.kind === "fallback") {
    /* 🔴 «못 가른 것»은 말에서도 못 가른 대로 적는다 — 화면이 확정으로 읽으면 안 된다. */
    if (v.family && v.ambiguous) return `🔴 자막이 Pretendard 가 아닌 글꼴로 그려졌어요(${v.family} 로 보이지만 기본 글꼴과 구별은 못 했어요)`;
    if (v.family) return `🔴 자막이 ${v.family} 로 그려졌어요(Pretendard 가 안 걸렸어요)`;
    return "🔴 자막이 기본 글꼴로 그려졌어요(Pretendard 가 안 걸렸어요)";
  }
  return `자막 폰트를 못 쟀어요(${v.why ?? "이유 모름"})`;
}
