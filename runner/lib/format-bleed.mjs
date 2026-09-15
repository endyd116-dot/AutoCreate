/**
 * runner/lib/format-bleed.mjs — **«번짐» 세 겹**(R9-3).
 *   AM 원본: ../AutoMarketing/public/runner/naver-blog-runner.mjs
 *            (`markFormatDirty` · `breakFormatBeforePara` · `measureFormatBleed` · `FORMAT_BLEED_MAX_PCT`)
 *            — 2026-09-16 이식. AM 은 202KB 한 파일에 흩어 두었고, 우리는 **이 한 파일로 모았다**(하니스가 이 파일을 그대로 돌린다).
 *
 * ══ 병 이름 = «번짐» ══
 *   한 문단에 색을 칠하면 **다음 문단까지 따라간다**(굵게·밑줄·가운데도 같다).
 *   🔴 이건 같은 병의 **네 번째 판**이다 — AM #799 색 · #800·#801 굵게 · 2026-08-20 밑줄 · 2026-09-15 빨강/가운데/기울임.
 *   사장님 실물 지적: 「어느 지점부터 **끝까지 전부** 빨강 + 가운데 정렬 + 기울임」(소제목·인용·번호·Q&A 전부 물듦).
 *
 * ══ 🔴 금지된 고침 — «캐럿을 눈감고 토글하지 마라» ══
 *   스마트에디터에서 `getSelection()` 은 **항상 빈 문자열**이다(AM 실물 5/5). 캐럿에 굵게·색이 켜져 있는지
 *   **읽을 방법이 없다.** 읽지 못하는 상태를 토글로 «끄는» 것은 추측이고, 틀리면 **반대로 켜 버린다.**
 *   ⇒ 이 파일은 `Control+b/i/u` 를 **한 번도 누르지 않는다.** 대신 이미 실측된 성질 하나만 쓴다 —
 *      **«새로 만든 글 칸은 앞 글자의 서식을 물려받지 않는다»**(AM `freshTextBlockForUrl` · 우리 `moveCaretToEnd`).
 *
 * ══ ⚠️ 이건 CLAUDE §9 의 게이트가 **아니다** (계약서 2026-09-16-R9R10 §4-1) ══
 *   §9 가 막지 말라는 것은 «**고객 글에 대한 우리 판단**»이다(금칙·유사도·품질·분량…).
 *   이건 «**우리 러너가 방금 망쳤다**»는 **작업 품질 검사**다 — 고객이 쓴 글이 아니라 *우리가 누른 버튼*을 잰다.
 *   글 전체가 빨강·가운데·기울임으로 물든 것은 «고객의 선택»이 아니라 **우리 도구의 고장**이고,
 *   그대로 나가면 사장님이 **발행물로** 알게 된다(실제로 그랬다). 조용히 나가느니 멈추는 게 낫다.
 */

/** 🔴 번짐 임계(%) — **상수 한 곳**. 환경변수로만 흔든다(코드 여러 곳에 숫자를 흩지 않는다). */
export const FORMAT_BLEED_MAX_PCT = Number(process.env.RUNNER_FORMAT_BLEED_MAX_PCT || 30);

/* ═══════════════ ① · ② 더럽힘 표시 ═══════════════ */

/**
 * 서식 상태 한 벌. 🔴 **모듈 전역이 아니다** — AM 은 전역 `FORMAT_DIRTY` 를 쓰는데,
 *   전역은 하니스가 케이스마다 씻을 수가 없다(앞 케이스의 «더럽다»가 다음 케이스로 샌다 = 검사가 거짓말한다).
 *   우리는 잡마다 새 상태를 만든다(러너는 잡을 한 건씩 순차로 돈다 — `core.mjs tick`).
 */
export function createFormatState() {
  return { dirty: false, marks: [], breaks: 0, breakFails: 0 };
}

/**
 * 🔴 방금 서식을 켜거나 칠했다 — **칠한 직후가 번짐의 출발점이다.**
 *   AM 의 옛 주석은 「칠한 뒤에 아무것도 치지 않으므로 커서에 색이 남아도 물들 데가 없다」고 적었는데 **틀렸다** —
 *   조각 루프는 바로 다음 조각을 계속 치고, 문단이 끝나도 다음 문단이 이어 친다.
 *   사장님이 보신 «어느 지점부터 끝까지 빨강»이 정확히 이 자리다.
 */
export function markFormatDirty(state, why) {
  if (!state) return;
  state.dirty = true;
  if (state.marks.length < 40) state.marks.push(String(why ?? ""));
  if (process.env.RUNNER_FORMAT_DEBUG) console.log("  · 서식 표시: " + why);
}

/* ═══════════════ ③ 문단 경계에서 끊기 ═══════════════ */

/**
 * 문단을 쓰기 **전**에 부른다 — 서식이 남아 있으면 새 칸으로 끊는다. 깨끗하면 아무 일도 안 한다(왕복 0 · 무회귀).
 *   🔴 AM 이 **URL 전용 방어였던 것을 «한 곳의 규칙»으로 올렸다.** 우리도 한 곳이어야 한다 —
 *      이 한 줄이 «어느 지점부터 끝까지»를 **문단 하나에** 가둔다.
 *
 * @param state    createFormatState() 한 벌
 * @param freshBlock  «끝에 새 글 칸을 만들고 캐럿을 거기 둔다» 를 하는 함수(Promise<boolean>).
 *        🔴 우리는 이걸 **새로 만들지 않는다** — `naver-blog.mjs moveCaretToEnd` 가 이미 그 일을 한다
 *           (AM `freshTextBlockForUrl` 과 같은 `.se-canvas-bottom-button` 경로 · 우리 쪽이 폴백 세 겹으로 더 두껍다).
 *           호출자가 그 함수를 넘긴다 — 이 파일은 DOM 을 모른다(그래서 하니스가 통째로 돌릴 수 있다).
 */
export async function breakFormatBeforePara(state, freshBlock) {
  if (!state || !state.dirty) return false;
  const ok = await freshBlock().catch(() => false);
  /* 🔴 실패하면 플래그를 **그대로 둔다** — 다음 문단에서 다시 시도한다.
     «시도했으니 깨끗하다»고 치는 것이 조용한 실패고, **이 병이 네 번 돌아온 경로**가 바로 그것이다. */
  if (ok) { state.dirty = false; state.breaks++; }
  else {
    state.breakFails++;
    console.log("  · ⚠️ 서식 끊기용 새 칸을 못 만들었습니다 — 다음 문단이 앞 서식을 물려받을 수 있어요(다음 문단에서 다시 시도합니다).");
  }
  return ok;
}

/* ═══════════════ ④ 발행 직전 자기검사 ═══════════════ */

/**
 * measureFormatBleedIn — 에디터 DOM 을 훑어 «빨강·가운데·기울임·밑줄이 걸린 문단 비율»을 센다.
 *
 * 🔴 **계획과 대조하지 않는다** — 계획에도 색이 있으니(강조는 의도다) 대조하면 판정이 흐려진다.
 *    대신 **문단 단위로 «통째로 물들었나»**를 본다: 문단의 글자 있는 span 이 **전부** 그 서식이면 1표.
 * ⚠️ 제목 칸(`se-documentTitle`)·인용 컴포넌트(`se-quotation`) 안은 **세지 않는다** —
 *    인용은 원래 가운데·기울임이라 세면 **정상 글도 임계를 넘는다**(그게 이 검사를 무용지물로 만드는 가장 쉬운 길이다).
 * ⚠️ 색 판정은 «빨강 계열»만 — 검정·회색은 정상이다.
 *
 * 🔴 **함수가 한 벌이다.** 러너는 `page.evaluate(measureFormatBleedIn)` 로 브라우저에 **이 함수 자신을** 실어 보내고,
 *    하니스는 `measureFormatBleedIn({document, getComputedStyle})` 로 **같은 함수를** 셈 DOM 에 돌린다.
 *    AM 은 202KB 원문에서 중괄호 균형으로 함수를 «잘라» 썼는데(복제는 피했지만 잘라내기가 깨질 수 있다),
 *    우리는 자를 필요가 없다 — 두 벌이 갈릴 자리가 **구조적으로 없다**.
 * ⚠️ `page.evaluate` 는 이 함수를 **문자열로** 만들어 보낸다 ⇒ 🔴 **바깥 변수를 참조하면 안 된다**(닫힘 금지).
 *    아래 본문에 이 파일의 다른 상수·함수가 하나도 안 나오는 이유가 그것이다.
 */
export function measureFormatBleedIn(env) {
  const doc = (env && env.document) || document;
  const gcs = (env && env.getComputedStyle) || getComputedStyle;
  /* 🔴 소제목 크기 — **굵게를 세려면 이 숫자가 필요하다**(아래 `bold` 참조). 러너가 자기 상수를 넘겨 준다.
     안 넘어오면 러너 기본값과 **같은 값**을 쓴다(그 값이 그대로 실행되므로 기본값이지 날조가 아니다 · AC-93). */
  const headSize = Number((env && env.headingSize) || 19);
  const bodySize = Number((env && env.bodySize) || 15);
  const out = { total: 0, bad: 0, red: 0, center: 0, italic: 0, underline: 0, bold: 0, pct: 0, samples: [] };
  const isRed = (c) => {
    const m = String(c || "").match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return false;
    const r = +m[1], g = +m[2], b = +m[3];
    return r >= 140 && g <= 90 && b <= 90;          // 빨강 계열(#ff0010·#e01 등) · 검정/회색 제외
  };
  const paras = [...doc.querySelectorAll(".se-component.se-text .se-text-paragraph")]
    .filter((p) => !p.closest(".se-quotation") && !p.closest(".se-documentTitle") && (p.textContent || "").trim().length >= 4);
  for (const p of paras) {
    out.total++;
    const ps = gcs(p);
    /* 문단이 «통째로» 물들었나 — 글자를 가진 자식 span 이 전부 그 서식이어야 1표(부분 강조는 정상 · 우리 글의 의도다). */
    const spans = [...p.querySelectorAll("span")].filter((s) => (s.textContent || "").trim().length > 0);
    const all = (fn) => spans.length > 0 && spans.every(fn);
    const red = all((s) => isRed(gcs(s).color)) || isRed(ps.color);
    const center = ps.textAlign === "center";
    const italic = all((s) => gcs(s).fontStyle === "italic") || ps.fontStyle === "italic";
    const under = all((s) => (gcs(s).textDecorationLine || "").includes("underline"))
      || (ps.textDecorationLine || "").includes("underline");
    /* 🔴 **굵게도 센다**(2026-09-16 C 실측으로 더했다). AM #800·#801 이 바로 **굵게 번짐**이었는데
       내 첫 판은 빨강·가운데·기울임·밑줄만 세어, value/bold 마크만 있는 글이 **통째로 굵게 나가도 0%** 였다.
       ⚠️ 그런데 **소제목은 원래 굵다** — 크기로 가른다: 굵으면서 **본문 크기**면 번짐, **소제목 크기**면 정상이다.
          (이 한 줄이 없으면 소제목이 많은 글이 전부 «번졌다»가 되어 검사가 무용지물이 된다 · AC-68.) */
    const wgt = (s) => { const w = String(gcs(s).fontWeight || ""); return w === "bold" || Number(w) >= 600; };
    const sizeOf = (s) => parseInt(String(gcs(s).fontSize || "0"), 10) || 0;
    const looksHeading = spans.length > 0 && spans.every((s) => sizeOf(s) >= headSize) && headSize > bodySize;
    const bold = !looksHeading && (all(wgt) || (spans.length === 0 && wgt(p)));
    if (red) out.red++;
    if (center) out.center++;
    if (italic) out.italic++;
    if (under) out.underline++;
    if (bold) out.bold++;
    if (red || center || italic || under || bold) {
      out.bad++;
      if (out.samples.length < 3) out.samples.push((p.textContent || "").trim().slice(0, 30));
    }
  }
  out.pct = out.total ? Math.round((out.bad / out.total) * 100) : 0;
  return out;
}

/**
 * 브라우저에서 잰다. 못 재면 `null` — 🔴 **«못 쟀다»를 «0% 깨끗»으로 바꾸지 않는다**(AC-92).
 * @param sizes `{ headingSize, bodySize }` — 굵게를 «소제목»과 «번짐»으로 가르는 데 쓴다(러너 상수를 그대로 넘긴다).
 */
export async function measureFormatBleed(ctx, sizes) {
  return await ctx.evaluate(measureFormatBleedIn, sizes ?? null).catch(() => null);
}

/**
 * 판정 한 곳 — 재 놓고 «멈출까»를 여기서만 답한다(숫자를 코드 여러 곳에 흩지 않는다).
 *   🔴 `null`(못 쟀다)이면 **멈추지 않는다** — 못 잰 것으로 발행을 막으면 그게 «아직 모른다로 막기»다(CLAUDE §9).
 *      대신 `measured:false` 로 돌려 보고에 «못 쟀어요»가 실린다(AC-9).
 */
export function bleedVerdict(bleed) {
  if (!bleed || !(bleed.total > 0)) return { measured: false, stop: false, line: "서식 번짐: 잴 문단이 없어 못 쟀어요" };
  const counts = `빨강 ${bleed.red} · 가운데 ${bleed.center} · 기울임 ${bleed.italic} · 밑줄 ${bleed.underline} · 굵게 ${bleed.bold ?? 0}`;
  const line = `서식 번짐 검사: ${bleed.bad}/${bleed.total} 문단(${bleed.pct}%) — ${counts}`;
  const stop = bleed.pct >= FORMAT_BLEED_MAX_PCT;
  const reason = stop
    ? `서식 번짐 ${bleed.bad}/${bleed.total} 문단(${bleed.pct}% ≥ ${FORMAT_BLEED_MAX_PCT}%) — 발행을 멈췄어요.`
      + ` ${counts}.`
      + ` 예시 문단: ${(bleed.samples || []).map((s) => `«${s}»`).join(" / ")}`
    : "";
  return { measured: true, stop, line, reason };
}
