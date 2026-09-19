/**
 * scripts/verify-published-format.mts — 🔴 **«올라갔다»가 아니라 «그대로 실렸나».**
 *
 *   사용:
 *     npx --yes tsx scripts/verify-published-format.mts            (오프라인 — 자에 이가 있나 · 네트워크 0)
 *     npx --yes tsx scripts/verify-published-format.mts --mutate   (🔴 스스로 망가뜨려 본다 · AC-108)
 *     npx --yes tsx scripts/verify-published-format.mts --url https://blog.naver.com/…   (🔴 **라이브 읽기**)
 *
 *   ══ 왜 ══
 *     발행은 «성공»인데 **에디터가 꾸밈을 안 받은** 경우를 우리 원장만 보고는 영영 모른다.
 *     2026-09-20 첫 실발행은 **민글 한 문단**이라 인용·색·형광펜·사진 배치가 **한 번도 확인이 안 됐다**(사장님 지적).
 *     ⇒ 나간 물건을 **되읽어** 본다. 🔴 우리가 **보낸 것**과 **실린 것**을 맞대는 것이 이 자의 본업이다.
 *
 *   ══ 🔴🔴 **첫 실물에서 이 자가 틀렸다**(2026-09-20 · 거짓 ❌ 둘 · 거짓 ✅ 하나) ══
 *     `https://blog.naver.com/endy1116/224417433862` 을 되읽고 «5 실렸다 / 5 안 실렸다»를 냈는데 **셋이 틀렸다.**
 *     실제 마크업을 떠 보니:
 *       `<b> 12건 · font-weight 0건` · 소제목 = `<b>하나. 글자 꾸밈` · 목록 = `<b>• 목록 첫째 줄`
 *     · **소제목 ❌ 는 거짓** — 네이버는 소제목을 `<h*>` 가 아니라 **굵은 글자**로 낸다(실렸는데 못 봤다).
 *     · **목록 ❌ 도 거짓** — `<ul>` 이 아니라 **글머리 기호가 붙은 글자**로 낸다(실렸는데 못 봤다).
 *     · 🔴 **굵게 ✅ 는 거짓 양성** — 우리가 보낸 bold 는 `planned 0` 이었는데
 *       **소제목·목록이 쓴 `<b>`** 를 우리 서식으로 읽었다.
 *
 *   🔴 **그래서 이 자의 구조적 한계는 이것이다**: 마크업만 보면
 *      **«우리가 칠한 굵게»와 «네이버가 소제목에 쓴 굵게»를 가를 수 없다.**
 *      ⇒ 옳은 설계는 «HTML 에 그 모양이 있나»가 아니라 **«우리가 보낸 계획(`planEditorOps` 의 ops·parts)과
 *         실린 것을 **짝지어** 대조»**다. 그 전까지 이 자의 숫자는 **«대강»이지 판정이 아니다.**
 *      🔴 **이 숫자를 사장님·보고에 그대로 올리지 마라.** 뚜렷한 넷(인용·구분선·사진·해시태그)만 믿을 만하다.
 *
 *   ══ 🔴 이 자의 한계를 먼저 적는다(AC-9 · AC-116) ══
 *     · 판정은 «그 자리에 그 스타일이 **있나**»까지다 — **자리·크기·정렬이 맞는지는 못 잰다.**
 *     · 사진은 «`<img>` 가 있나»다 — 🔴 **여러 장·정렬·본문 중간 배치는 이 자로 못 잰다.**
 *       한 장 실린 것을 보고 «이미지 배치 ✅»라고 쓰면 그게 AC-116 이다.
 *     · 네이버 클래스 이름(`se-…`)은 **우리 밖의 것**이라 언제든 바뀐다 ⇒ 모양보다 **CSS 속성**을 먼저 본다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const URL_ARG = arg("--url");
const MUTATE = process.argv.includes("--mutate");
let bad = 0, measured = 0;
const rec = (name: string, ok: boolean, detail = "") => {
  measured++; if (!ok) bad++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** 한 항목의 판정 — 🔴 `null` 은 «못 쟀다»(통과도 실패도 아니다 · AC-9). */
export interface FormatAxis { what: string; got: boolean | null; how: string }

/**
 * judgePublishedHtml — 되읽은 본문 HTML → 항목별 판정. **순수**(네트워크 0) 라서 오프라인으로 잴 수 있다.
 *   🔴 **모양(class 이름)보다 CSS 속성을 먼저 본다** — 남의 마크업은 바뀌고 우리 자는 그때 조용히 초록이 된다.
 */
export function judgePublishedHtml(html: string, text = ""): FormatAxis[] {
  const has = (re: RegExp) => re.test(html);
  return [
    /* 🔴 **우리 굵게와 네이버가 소제목·목록에 쓴 굵게를 못 가른다**(2026-09-20 거짓 ✅ 를 실제로 냈다).
       ⇒ `<b>` 가 있어도 우리가 굵게를 **안 보냈을** 수 있으므로 **«못 쟀다»(null)** 로 둔다.
       계획(ops)과 짝지어 대조하기 전까지는 이게 정직한 답이다. */
    { what: "굵게", got: (has(/<(b|strong)\b/i) || has(/font-weight:\s*(bold|[6-9]00)/i)) ? null : false,
      how: "🔴 소제목·목록의 굵게와 못 가른다 — 계획과 짝지어야 안다" },
    { what: "밑줄", got: has(/<u\b/i) || has(/text-decoration[^;"']*underline/i), how: "<u> 또는 text-decoration:underline" },
    { what: "형광펜(배경색)", got: has(/background-color:\s*(?!transparent|#fff[^0-9a-f]|#ffffff|rgba?\(\s*255,\s*255,\s*255)/i), how: "background-color 가 흰색·투명이 아님" },
    { what: "글자색", got: has(/(?<!background-)(?<![a-z-])color:\s*(?!inherit|initial|#000[^0-9a-f]|#000000|rgba?\(\s*0,\s*0,\s*0)/i), how: "color 가 검정·상속이 아님" },
    { what: "인용문구", got: has(/<blockquote\b/i) || has(/se[-_]quotation/i), how: "<blockquote> 또는 네이버 인용 컴포넌트" },
    /* 🔴 [2026-09-20 실물에서 고침] 네이버는 소제목을 `<h*>` 가 아니라 **굵은 글자 줄**로 낸다 —
       `<h*>` 만 보면 **실렸는데 ❌** 가 나온다(첫 실물에서 실제로 그랬다). 굵게와 못 가르므로 «못 쟀다»로 둔다. */
    { what: "소제목", got: (has(/<h[1-4]\b/i) || has(/se[-_]sectionTitle|se-documentTitle/i)) ? true : (has(/<(b|strong)\b/i) ? null : false),
      how: "<h*>·네이버 제목 컴포넌트면 확실 · 굵은 글자뿐이면 굵게와 못 가른다" },
    /* 🔴 목록도 `<ul>` 이 아니라 **글머리 기호가 붙은 글자**로 나온다. 둘을 **가려서** 적는다 — 뭉치면 사실이 사라진다. */
    { what: "목록(요소)", got: has(/<(ul|ol)\b/i) || has(/<li\b/i), how: "<ul>/<ol>/<li> — 네이버는 대개 안 쓴다" },
    { what: "목록(글머리 기호)", got: /[•·‣▪]\s*\S/.test(html) || /[•·‣▪]/.test(text), how: "글머리 기호가 붙은 줄(네이버가 실제로 내는 모양)" },
    { what: "구분선", got: has(/<hr\b/i) || has(/se[-_]horizontalLine/i), how: "<hr> 또는 네이버 구분선 컴포넌트" },
    { what: "사진(한 장이라도)", got: has(/<img\b/i), how: "<img>" },
    { what: "해시태그", got: /#\S/.test(text) || has(/hashtag|se[-_]tag/i), how: "본문·태그 영역의 #" },
  ];
}

/* ═══ 오프라인 — 🔴 **이 자에 이가 있나** (변이 없이도 «빨개질 줄 아는가»를 먼저 본다) ═══ */
const RICH = `<div class="se-main-container">
  <p><strong>굵게</strong> 와 <span style="text-decoration:underline">밑줄</span> 과
     <span style="background-color:#ffe400">형광펜</span> 과 <span style="color:#ff4444">빨강</span>.</p>
  <blockquote class="se-quotation">인용</blockquote>
  <h2>소제목</h2><ul><li>목록</li></ul><hr>
  <img src="x.jpg"><p>#태그</p></div>`;
const PLAIN = `<div class="se-main-container"><p>꾸밈이 하나도 없는 민글 한 문단입니다.</p></div>`;

function offline(): void {
  console.log("\n① 자에 이가 있나 — 꾸밈이 **있는** 글");
  const rich = judgePublishedHtml(RICH, "#태그");
  const got = (w: string) => rich.find((a) => a.what === w)?.got;
  /* 🔴 **항목마다 기대가 다르다.** 「전부 true 여야 한다」로 두면, 어떤 축을 정직하게 «못 쟀다»로 바꾼 날
     이 자가 빨개지고 사람은 **축을 도로 거짓말쟁이로 되돌린다.** 그래서 기대값을 하나씩 적는다. */
  for (const w of ["밑줄", "형광펜(배경색)", "글자색", "인용문구", "구분선", "사진(한 장이라도)", "해시태그"]) {
    rec(`«${w}» 를 잡는다`, got(w) === true);
  }
  rec("«소제목» 은 `<h*>` 면 확실히 잡는다", got("소제목") === true);
  rec("«목록(요소)» 는 `<ul>` 이 있으면 잡는다", got("목록(요소)") === true);
  rec("🔴 «굵게» 는 **«못 쟀다»**로 둔다 — 소제목·목록의 굵게와 못 가른다(첫 실물에서 거짓 ✅ 를 냈다)",
    got("굵게") === null);

  console.log("\n② 🔴 반증 — 꾸밈이 **없는** 민글에서 ✅ 가 뜨면 이 자는 거짓말쟁이다");
  const plain = judgePublishedHtml(PLAIN, "");
  const falsePos = plain.filter((a) => a.got === true);
  rec("🔴 민글에서는 하나도 안 잡힌다(어제 올린 그 글이 이 모양이었다)", falsePos.length === 0,
    falsePos.length ? `거짓 ✅: ${falsePos.map((a) => a.what).join(" · ")}` : "0개");

  console.log("\n③ 🔴 남의 마크업이 바뀌어도 버티나 — class 가 아니라 **CSS 속성**으로 본다");
  const cssOnly = `<div><span style="font-weight:700">굵</span><span style="background-color:#ff0">형</span>
    <span style="text-decoration:underline">밑</span><span style="color:#f00">색</span></div>`;
  const c = judgePublishedHtml(cssOnly);
  for (const w of ["밑줄", "형광펜(배경색)", "글자색"]) {
    rec(`«${w}» 를 class 없이 style 만으로도 잡는다`, c.find((a) => a.what === w)?.got === true);
  }
  const white = judgePublishedHtml(`<div><span style="background-color:#ffffff">흰 배경</span><span style="color:#000000">검정</span></div>`);
  rec("🔴 흰 배경·검정 글자를 «칠했다»로 안 센다(그건 기본값이다)",
    white.find((a) => a.what === "형광펜(배경색)")?.got === false && white.find((a) => a.what === "글자색")?.got === false);

  console.log("\n④ 🔴 이 자가 **못 재는 것**을 스스로 밝히나(AC-9 · AC-116)");
  const src = readFileSync("scripts/verify-published-format.mts", "utf8");
  rec("머리말이 «여러 장·정렬·배치는 못 잰다»를 적는다", /여러 장·정렬·본문 중간 배치는 이 자로 못 잰다/.test(src));
  rec("사진 축 이름이 «한 장이라도»라고 못 박는다(«배치 ✅»로 읽히지 않게)",
    judgePublishedHtml(`<img src="x">`).some((a) => a.what === "사진(한 장이라도)"));
}

/* ═══ 라이브 — 🔴 읽기만 한다(쓰기 0 · 삭제 0 · 로그인 0) ═══ */
async function live(url: string): Promise<void> {
  /* 🔴 playwright 는 **러너 쪽에만** 깔려 있다(`runner/node_modules`) — 뿌리에는 없다.
     오프라인 축은 이 줄을 안 지나므로 **평소엔 playwright 없이도 이 자가 돈다**(그래서 `safe` 로 남는다). */
  const { chromium } = await import(new URL("../runner/node_modules/playwright/index.mjs", import.meta.url).href)
    .catch(() => import("playwright"));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ locale: "ko-KR" });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2500);
    let html = "", text = "";
    for (const f of page.frames()) {
      try {
        const h = await f.evaluate(() => {
          const el = document.querySelector(".se-main-container") ?? document.querySelector("#postViewArea") ?? document.body;
          return { html: el?.innerHTML ?? "", text: (el as HTMLElement | null)?.innerText ?? "" };
        });
        if (h.html.length > html.length) { html = h.html; text = h.text; }
      } catch { /* 못 읽는 프레임은 건너뛴다 */ }
    }
    if (!html) { console.log("⊘ 못 쟀음 — 본문을 못 읽었다(로그인이 필요한 글이거나 구조가 바뀌었다)."); process.exit(2); }
    console.log(`\n읽은 본문 ${html.length}자 · 글자 ${text.length}자 · ${url}\n`);
    let ok = 0, ng = 0;
    for (const a of judgePublishedHtml(html, text)) {
      console.log(`  ${a.got === null ? "⊘" : a.got ? "✅" : "❌"} ${a.what.padEnd(16)} — ${a.how}`);
      if (a.got === true) ok++; else if (a.got === false) ng++;
    }
    console.log(`\n실렸다 ${ok} · 안 실렸다 ${ng}`);
    console.log(`🔴 못 쟀다: 사진 **여러 장·정렬·본문 중간 배치** · 글자 크기 · 자간 — 이 자의 범위 밖이다.`);
    console.log(`\n본문 앞 400자:\n${html.slice(0, 400)}`);
    process.exit(ng ? 1 : 0);
  } finally { await browser.close(); }
}

const MUTANTS = [
  { what: "민글에서도 «밑줄 ✅»가 뜨게 한다(거짓 초록 — 제일 나쁜 고장)",
    from: `{ what: "밑줄", got: has(/<u\\b/i) || has(/text-decoration[^;"']*underline/i)`,
    to: `{ what: "밑줄", got: true || has(/<u\\b/i)`, expect: "민글에서는 하나도 안 잡힌다" },
  /* 🔴 [2026-09-20] **정직한 «못 쟀다»를 도로 ✅ 로 바꾸는 변이** — 첫 실물에서 실제로 난 거짓 ✅ 그 자체다. */
  { what: "«굵게»를 도로 ✅ 로 단정한다(소제목·목록의 굵게를 우리 것으로 읽는다 · 첫 실물의 그 거짓 ✅)",
    from: `{ what: "굵게", got: (has(/<(b|strong)\\b/i) || has(/font-weight:\\s*(bold|[6-9]00)/i)) ? null : false,`,
    to: `{ what: "굵게", got: (has(/<(b|strong)\\b/i) || has(/font-weight:\\s*(bold|[6-9]00)/i)),`,
    expect: "«굵게» 는 **«못 쟀다»**로 둔다" },
  { what: "흰 배경도 «형광펜»으로 센다(기본값을 «칠했다»로 읽는다)",
    from: `has(/background-color:\\s*(?!transparent|#fff[^0-9a-f]|#ffffff|rgba?\\(\\s*255,\\s*255,\\s*255)/i)`,
    to: `has(/background-color:/i)`, expect: "흰 배경·검정 글자를 «칠했다»로 안 센다" },
  { what: "class 이름에만 기대게 한다(네이버가 마크업 바꾸면 조용히 초록)",
    from: `{ what: "인용문구", got: has(/<blockquote\\b/i) || has(/se[-_]quotation/i)`,
    to: `{ what: "인용문구", got: has(/se[-_]quotation-v9-does-not-exist/i)`, expect: "«인용문구» 를 잡는다" },
];

async function mutate(): Promise<void> {
  console.log("\n🔴 변이 — 일부러 망가뜨려 본다(안 울면 이 자는 값이 0 이다)\n");
  const F = "scripts/verify-published-format.mts";
  for (const m of MUTANTS) {
    const orig = readFileSync(F, "utf8");
    if (!orig.includes(m.from)) { console.log(`  ⊘ «${m.what}» — 심을 자리를 못 찾았다(자가 낡았다)`); bad++; continue; }
    try {
      writeFileSync(F, orig.replace(m.from, m.to));
      let caught = false, out = "";
      try { execFileSync("npx", ["--yes", "tsx", F], { encoding: "utf8", stdio: "pipe", shell: true }); }
      catch (e) { caught = true; out = String((e as { stdout?: string })?.stdout ?? ""); }
      const byName = caught && out.split("\n").some((l) => l.startsWith("  ✗") && l.includes(m.expect));
      console.log(`  ${byName ? "✓" : "✗"} «${m.what}» — ${caught ? (byName ? `잡혔다(맞는 축 «${m.expect}»)` : "딴 축이 잡았다(우연한 덮개)") : "🔴 안 잡혔다"}`);
      if (!byName) bad++;
    } finally {
      writeFileSync(F, orig);
      if (readFileSync(F, "utf8") !== orig) { console.error(`🔴🔴 되돌리기 실패 — ${F} 를 손으로 확인하라`); process.exit(1); }
    }
  }
}

if (URL_ARG) { await live(URL_ARG); }
else {
  console.log("■ 올린 글에 서식이 «그대로 실렸나» — 자에 이가 있나(오프라인)");
  offline();
  if (MUTATE) await mutate();
  console.log(`\n${bad ? `🔴 실패 ${bad}` : `✅ 잰 ${measured}축 전부 통과`}`);
  console.log(`🔴 이건 **자를 잰 것**이지 «실린 글을 잰 것»이 아니다 — 실물은 \`--url\` 로.`);
  process.exit(bad ? 1 : 0);
}
