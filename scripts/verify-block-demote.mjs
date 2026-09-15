/**
 * scripts/verify-block-demote.mjs — 🔴 **우리 블록 19종 → 러너 op 내리기**(R9-6 · = R8 잔여 «에디터 실제 요소» B7).
 *   node scripts/verify-block-demote.mjs            → 판정(종료코드)
 *   node scripts/verify-block-demote.mjs --table    → 표를 찍는다(문서 §3b 에 붙이는 원본)
 *
 * ══ 왜 이 검사가 있나 ══
 *   AM op 는 **7종**인데 우리 블록은 **19종**이다(`lib/blocks.ts BlockType` 18 + `place`).
 *   🔴 **내릴 수 없는 것을 «없던 일»로 만들지 않는다**(AC-9 · AM 은 그 자리를 `marksDemoted` 라 부른다).
 *      표를 손으로 적으면 낡는다 — 여기서 **코드를 실제로 돌려** 뽑는다(`--table`).
 *
 * ══ 🔴 이 검사가 잡는 것 ══
 *   ① 새 블록 종류가 생겼는데 러너가 `default` 로 조용히 흘려보내는 것
 *   ② «내려앉혔다»면서 사실은 **통째로 사라지는** 것(op 0개 · note 0개)
 *   ③ 잃는 것이 있는데 `note`·`demoted` 어디에도 안 적히는 것
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PLAN = await import(pathToFileURL(join(ROOT, "runner", "lib", "plan.mjs")).href);
const BLOCKS_TS = readFileSync(join(ROOT, "lib", "blocks.ts"), "utf8");

/* 🔴 **어휘를 손으로 적지 않는다** — `lib/blocks.ts` 의 `BlockType` 에서 읽는다.
   손으로 적으면 B 가 종류를 늘리는 날 이 검사가 **옛 목록을 재고 초록**이 된다(AC-78: 검사가 값을 베끼는 병의 사촌). */
const TYPES = (() => {
  const m = BLOCKS_TS.match(/export type BlockType\s*=\s*([^;]+);/);
  if (!m) throw new Error("lib/blocks.ts 에서 BlockType 을 못 읽었다 — 손으로 적지 말고 여기를 고쳐라");
  return m[1].split("|").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
})();

/** 종류마다 «그럴듯한 블록 한 개» — 빈 블록은 아무것도 안 만들어 검사가 통과해 버린다(빈 것으로 재지 마라). */
const SAMPLE = {
  hook: { text: "오늘 12,400원 벌었어요" },
  para: { text: "전기요금이 3만 원 줄었습니다" },
  h2: { text: "결론부터" },
  h3: { text: "왜 줄었나" },
  quote: { text: "한 문장으로 뽑으면 이렇습니다" },
  list: { items: ["첫째 항목", "둘째 항목"] },
  checklist: { items: ["확인 하나", "확인 둘"] },
  table: { rows: [["구분", "금액"], ["지난달", "3만 원"]] },
  image: { imageIndex: 0, caption: "그날 계량기" },
  divider: {},
  tip: { text: "이건 알아 두면 좋아요" },
  faq: { items: ["Q. 얼마나 걸리나요", "A. 한 달이면 보여요"] },
  /* 🔴 표본은 **제품과 같은 모양**이어야 한다 — `lib/blocks.ts:80` 이 `b.items` 로 렌더한다.
     첫판에 내가 `text` 를 줬더니 «초록»이 나왔는데 라이브에서는 items 로 와서 조용히 사라지고 있었다(C 가 잡았다). */
  hashtags: { items: ["절약", "전기요금"] },
  disclosure: { text: "이 글은 제휴 링크를 포함합니다" },
  adsense: { text: "<script>...</script>" },
  toc: { items: ["결론부터", "왜 줄었나"] },
  summary: { text: "세 줄로 줄이면 이렇습니다" },
  affiliate: { affiliate: { productName: "절전 멀티탭", url: "https://example.com/p/1" } },
  place: { place: { name: "○○카페", address: "서울 어딘가", url: "https://map.example.com/1" } },
};

const IMAGES = [{ url: "https://cdn.example.com/a.jpg", caption: "그날 계량기" }];

/** 일부러 **내리지 않는** 종류 — «사라졌다»가 아니라 «여기선 낼 수 없는 것이 맞다»인 자리. */
const INTENTIONALLY_EMPTY = {
  adsense: "스크립트라 네이버·티스토리 에디터 본문에 못 넣는다 — 서버 게이트가 채널별로 이미 걷어냈다(러너는 아무것도 안 한다)",
};

const rows = [];
for (const t of TYPES) {
  const sample = SAMPLE[t];
  if (!sample) { rows.push({ t, err: "표본이 없다 — 이 파일에 SAMPLE 을 더해라" }); continue; }
  const r = PLAN.planEditorOps({ blocks: [{ type: t, ...sample }], images: IMAGES });
  const body = r.ops.filter((o) => o.op !== "note");
  rows.push({
    t,
    ops: body.map((o) => o.op).join("+") || "(없음)",
    notes: r.stats.notes,
    demoted: r.stats.demoted.map((d) => `${d.kind}:${d.why}`),
  });
}

if (process.argv.includes("--table")) {
  console.log("| 우리 블록 | 러너 op 로 내려간 모양 | 못 낸 것(정직) |");
  console.log("|---|---|---|");
  for (const r of rows) {
    const lost = [...(r.notes ?? []), ...(r.demoted ?? [])];
    const why = INTENTIONALLY_EMPTY[r.t];
    console.log(`| \`${r.t}\` | ${r.ops === "(없음)" ? "**안 낸다**" : `\`${r.ops}\``} | ${why ? `🔴 ${why}` : lost.length ? lost.join(" · ") : "—"} |`);
  }
  process.exit(0);
}

let pass = 0, fail = 0;
const ok = (c, name, x) => { if (c) { pass++; console.log("  ✔ " + name); } else { fail++; console.log("  ✘ " + name + (x !== undefined ? " — " + String(x).slice(0, 200) : "")); } };

console.log(`\n[블록 ${TYPES.length}종 → 러너 op]`);
ok(TYPES.length >= 19, `B-00 lib/blocks.ts 에서 어휘를 읽었다(손으로 안 적었다)`, `${TYPES.length}종: ${TYPES.join("·")}`);
for (const r of rows) {
  if (r.err) { ok(false, `B-${r.t}`, r.err); continue; }
  const intended = INTENTIONALLY_EMPTY[r.t];
  const produced = r.ops !== "(없음)";
  const explained = (r.notes?.length ?? 0) > 0 || (r.demoted?.length ?? 0) > 0;
  if (intended) {
    ok(!produced, `B-${r.t} 일부러 안 낸다 — ${intended.slice(0, 40)}…`, r.ops);
  } else {
    /* 🔴 ②«내려앉혔다»면서 통째로 사라지는 것 · ③잃는 것이 있는데 아무 데도 안 적히는 것 */
    ok(produced || explained,
      `B-${r.t} → ${r.ops}${r.notes?.length ? ` · 못 낸 것: ${r.notes.join("/")}` : ""}`,
      "op 0개 + 설명 0개 = 조용히 사라진다(AC-9)");
  }
}

/* ═══ 🔴 **폴백 경로도 같은 자로 잰다** — 여기가 내 눈먼 자리였다 ═══
 *
 *   첫판에 나는 **블록 경로만** 쟀고 22/0 초록을 받았다. C 가 같은 19종을 대 보고 **셋**을 찾았다(2026-09-16):
 *     ① `place` 가 폴백에서 통째로 사라짐(`opsFromHtml` 태그 목록에 `aside` 가 없었다)
 *     ② `hashtags` 가 `items` 로 오면 op 0 · note 0 (`case` 가 `text` 만 봤다)
 *     ③ `adsense` 가 두 경로 다 op 0 · note 0
 *   🔴 교훈은 «셋을 고쳤다»가 아니라 **«내 자가 한쪽 길만 보고 있었다»**이다 —
 *      검수창에서 본문을 고친 글은 **전부 폴백으로 온다**. 그 길을 안 재면 그 글들만 조용히 깎인다.
 *   ⚠️ 그리고 **표본이 제품과 같아야 한다**: 내 `hashtags` 표본은 `text` 를 줬는데 제품(`lib/blocks.ts:80`)은
 *      `items` 로 렌더한다. **표본이 틀리면 초록도 틀린다**(AC-78 의 사촌).
 */
console.log("\n[폴백 경로(bodyHtml) — 검수창에서 본문을 고친 글이 오는 길]");
{
  const HTML_SAMPLES = {
    place: `<aside class="place"><a href="https://map.example.com/1" rel="noopener"><strong>○○카페</strong><span class="addr">서울 어딘가</span></a></aside>`,
    hashtags: `<p class="tags">#절약 #전기요금</p>`,
    table: `<table><thead><tr><th>구분</th><th>금액</th></tr></thead><tbody><tr><td>지난달</td><td>3만 원</td></tr></tbody></table>`,
    affiliate: `<a class="affiliate" href="https://example.com/p/1"><b class="name">절전 멀티탭</b></a>`,
    faq: `<dl><dt>얼마나 걸리나요</dt><dd>한 달이면 보여요</dd></dl>`,
    checklist: `<ul class="check"><li>확인 하나</li></ul>`,
    image: `<figure><img src="https://cdn.example.com/a.jpg"><figcaption>그날 계량기</figcaption></figure>`,
    quote: `<blockquote>한 문장으로 뽑으면 이렇습니다</blockquote>`,
    h2: `<h2>결론부터</h2>`,
    divider: `<hr>`,
    disclosure: `<div class="disclosure">이 글은 제휴 링크를 포함합니다</div>`,
  };
  for (const [t, html] of Object.entries(HTML_SAMPLES)) {
    const r = PLAN.planEditorOps({ bodyHtml: html });
    const body = r.ops.filter((o) => o.op !== "note");
    const explained = (r.stats.notes?.length ?? 0) > 0;
    ok(body.length > 0 || explained,
      `H-${t} → ${body.map((o) => o.op).join("+") || "(없음)"}${r.stats.notes?.length ? ` · 못 낸 것: ${r.stats.notes.join("/")}` : ""}`,
      "op 0개 + 설명 0개 = 폴백 경로에서 조용히 사라진다(AC-9)");
  }
  /* 🔴 두 길이 **같은 글**을 내나 — 다른 글을 내면 «검수창에서 고쳤더니 장소가 사라졌다»가 된다. */
  const viaBlock = PLAN.planEditorOps({ blocks: [{ type: "place", place: { name: "○○카페", address: "서울 어딘가", url: "https://map.example.com/1" } }] });
  const viaHtml = PLAN.planEditorOps({ bodyHtml: HTML_SAMPLES.place });
  ok(viaBlock.ops[0]?.op === viaHtml.ops[0]?.op && viaBlock.stats.notes.length === viaHtml.stats.notes.length,
    "H-99 🔴 같은 장소가 **두 길에서 같은 모양**으로 내려간다(블록 경로 ↔ 폴백 경로)",
    `블록 ${viaBlock.ops[0]?.op}/${viaBlock.stats.notes.length}건 ↔ 폴백 ${viaHtml.ops[0]?.op}/${viaHtml.stats.notes.length}건`);
}

/* 🔴 대조군 짝 — 모르는 종류는 «조용히 흘러가지 않는다»를 실제로 확인한다(AC-68: 통과해야 하는 것도 같이 잰다). */
{
  const r = PLAN.planEditorOps({ blocks: [{ type: "아직없는종류", text: "이 글자는 살아야 한다" }] });
  ok(r.ops.length === 1 && r.ops[0].op === "para" && r.ops[0].text === "이 글자는 살아야 한다",
    "B-99 모르는 종류는 **평문으로 살린다**(글자를 버리지 않는다 — 새 블록이 생겨도 글이 통째로 비지 않는다)",
    JSON.stringify(r.ops));
}
/* 🔴 그리고 그 «살림»이 러너 op 어휘 안에 있나 — 실행부가 아는 op 만 나와야 한다(모르는 op 는 조용히 default 로 샌다). */
{
  const NAVER = readFileSync(join(ROOT, "runner", "channels", "naver-blog.mjs"), "utf8");
  const known = new Set([...NAVER.matchAll(/case "([a-z]+)":/g)].map((m) => m[1]));
  const all = new Set(rows.flatMap((r) => (r.ops ?? "").split("+")).filter((o) => o && o !== "(없음)"));
  const unknown = [...all].filter((o) => !known.has(o));
  ok(unknown.length === 0, `B-98 계획이 내는 op 를 실행부가 **전부 안다**(${[...all].join("·")})`, `모르는 op: ${unknown.join("·")}`);
}

/* ═══ [R9-11] 🔴 «서식이 깎였다»가 **고객에게 닿나** — CLAUDE §9 ② ═══
 *
 *   티스토리 **주 경로는 HTML 모드**라 `<blockquote>`·`<hr>`·`<h2>` **진짜 요소**로 들어간다(네이버보다 세다).
 *   그런데 HTML 모드를 못 열면 **기본 모드 폴백**이 돌고, 거기선 글자로 흉내 낸다(`“…”` · `———` · 평문 소제목).
 *   🔴 종전엔 그 사실이 `notes` 한 줄로만 남았고 **서버가 notes 를 버려서** 고객에게 **안 닿았다.**
 *      §9 는 «막지 않는다»의 대가로 «**사람이 안 보는 경로(자동 승인)에서도 닿게 한다**»를 못 박았다 —
 *      자동 승인이면 **아무도 모르는 채 깎인 글이 나간다.** 그래서 «있으면 좋은 것»이 아니라 **틀린 것**이었다.
 */
console.log("\n[R9-11 «깎였다»가 고객에게 닿나 — 티스토리 기본 모드 폴백]");
{
  const TIS = readFileSync(join(ROOT, "runner", "channels", "tistory.mjs"), "utf8");
  const CORE = readFileSync(join(ROOT, "runner", "core.mjs"), "utf8");
  /* 🔴 **주석을 코드로 세지 마라.** 변이로 «알림 줄을 주석 처리»해 봤더니 **초록으로 지나갔다**(2026-09-16) —
     `// removed if (say) await notify(...)` 가 글자로는 그대로 남아 있었기 때문이다.
     오늘 **네 번째**로 같은 함정이다(AC-99). «지웠다»와 «주석으로 죽였다»는 코드에서 같은 뜻이다. */
  const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  const JOBS = codeOnly(readFileSync(join(ROOT, "lib", "runner-jobs.ts"), "utf8"));

  /* 🔴 **행동으로 잰다.** 첫판엔 «그 줄이 있나»만 봐서 `if (field)` → `if (false)` 변이가 **초록으로 지나갔다**
     (AC-99 · 오늘 세 번째다). 그래서 이름 짓는 규칙을 **순수 함수로 빼** 실제로 돌린다. */
  const { degradedFieldOf } = await import(pathToFileURL(join(ROOT, "runner", "channels", "tistory.mjs")).href);
  ok(degradedFieldOf({ op: "quote" }) === "quote"
    && degradedFieldOf({ op: "divider" }) === "divider"
    && degradedFieldOf({ op: "heading", level: 2 }) === "h2"
    && degradedFieldOf({ op: "heading", level: 3 }) === "h3"
    && degradedFieldOf({ op: "check" }) === "checklist",
    "R-01 🔴 깎인 요소에 **이름을 붙인다**(행동으로 잰다 — 소제목은 level 로 h2/h3 를 가른다)");
  ok(degradedFieldOf({ op: "para" }) === null && degradedFieldOf({ op: "image" }) === null && degradedFieldOf(null) === null,
    "R-01b 🔴 대조군 짝 — **원래 평문인 것**(para)과 **진짜로 들어가는 것**(사진)은 «깎였다»로 안 센다(안 깎였는데 칩이 뜨면 거짓말이다)");
  ok(/const field = degradedFieldOf\(op\);\s+if \(field\) missed\.degraded\.push/.test(TIS),
    "R-01c 그리고 폴백이 **그 함수를 실제로 부른다**(정의만 있으면 AC-69)");
  ok(/const formatMarks = missed\.degraded\.length/.test(TIS) && /formatMarks \? \{ formatMarks \} : \{\}/.test(TIS),
    "R-02 🔴 그 값을 **보고에 싣는다** — `notes` 가 아니라 **칸**으로(notes 는 서버가 버린다)");
  /* 🔴 **새 이름을 안 만들었나**(AC-75) — 이름이 갈리면 화면이 조용히 아무것도 안 그린다. */
  const fields = [...TIS.matchAll(/DEGRADED_FIELD = \{([^}]*)\}/g)].map((m) => m[1]).join("");
  const used = [...fields.matchAll(/(\w+): "(\w+)"/g)].map((m) => m[2]);
  const known = new Set(Object.keys(JSON.parse(JSON.stringify(
    /* 화면이 아는 어휘 = `lib/blocks.ts BlockType` — 🔴 **손으로 안 적는다**(늘어나면 저절로 따라간다). */
    Object.fromEntries(TYPES.map((t) => [t, 1]))))));
  const unknown = [...new Set([...used, "h2", "h3"])].filter((f) => !known.has(f));
  ok(unknown.length === 0,
    `R-03 🔴 «깎인 것»의 이름이 전부 **블록 어휘 그대로**다(새 이름 0 · AC-75) — ${[...new Set(used)].join("·")}`,
    `블록 어휘에 없는 이름: ${unknown.join("·")}`);
  ok(/why: "no_editor_op"/.test(TIS),
    "R-04 사유도 **이미 있는 것**을 쓴다(`no_editor_op` = «블록 자체를 에디터 요소로 못 세웠다»)");
  /* 🔴 AC-69 — 나르는 자리가 있나. 러너 코어는 **채널을 안 가리고** `publish.*` 전부를 같은 파이프로 보낸다. */
  ok((CORE.match(/formatMarks: out\.formatMarks/g) || []).length >= 2,
    "R-05 🔴 러너 코어가 **티스토리 것도** 나른다(네이버와 같은 파이프라 새로 만들 것이 없다)");
  ok(/htmlMode\?: number;/.test(JOBS) && /\{ htmlMode: Number\(fm\.htmlMode\) \}/.test(JOBS),
    "R-06 서버가 그 칸을 알고 `piece.meta.formatMarks` 로 합친다");
  /* 🔴 대조군 짝 — **HTML 모드가 열리면 아무것도 안 싣는다**(깎인 게 없는데 칩이 뜨면 그게 거짓말이다 · AC-68). */
  ok(/missed\.degraded\.length\s*\?/.test(TIS) && /: null;/.test(TIS.slice(TIS.indexOf("const formatMarks = missed.degraded.length"), TIS.indexOf("const formatMarks = missed.degraded.length") + 200)),
    "R-07 🔴 대조군 짝 — 깎인 게 **없으면 키 자체를 안 만든다**(안 깎였는데 «깎였어요»가 뜨면 그게 더 나쁘다)");

  /* ═══ 🔴 R-10~ — **닿는 길 ②: 알림**(§9-② «사람이 안 보는 경로에서도 닿게») ═══
   *   검수 화면 칩(닿는 길 ①)은 **사람이 그 글을 열어 봐야** 보인다. 자동 승인이면 아무도 안 연다 —
   *   그러면 «깎였다»가 **아무에게도 안 닿고**, 그게 이 칸이 생긴 이유 자체다.
   *   🔴 **화면 하나로는 §9 를 못 지킨다. 닿는 길이 둘이어야 한다.** */
  /* ⚠️ **문구가 실제로 나오나**(행동)는 여기서 못 잰다 — `node` 는 확장자 없는 TS import 를 못 푼다.
     그쪽은 `scripts/verify-format-notice.mts`(tsx) 가 잰다. 여기서는 **사슬**만 본다(싸고 넓게 · AC-87). */
  const JOBS2 = JOBS;
  /* ⚠️ 종전 이 축은 `formatDemotionNotice(merged, String(row.title ?? "")` 까지만 봤다 — **접두사**라
     셋째 인자를 빼는 변이가 **초록으로 지나갔다**(2026-09-16 · 오늘 다섯 번째). 인자를 **끝까지** 본다. */
  ok(/const say = formatDemotionNotice\(merged, String\(row\.title \?\? ""\), String\(row\.channel \?\? ""\)\);/.test(JOBS2)
    && /if \(say\) await notify\(tid, "format_demoted", say\.title, say\.body, pieceLink\(pieceId\)\);/.test(JOBS2),
    "R-12 🔴 그 문구를 **실제로 알림으로 보낸다** · 🔴 **채널까지 넘긴다**(안 넘기면 되돌릴 길 문장이 통째로 빠진다 — 만들어 놓고 안 부르면 AC-69)");
  /* 🔴 **자동 승인 경로에서 닿나** — 이 칸의 전부다.
     `applyFormatMarksToPiece` 는 `reportJob` 의 **발행 성공 경로**에서 불린다. 그 길은 사람이 승인했든
     자동으로 나갔든 **똑같이 지난다**(화면 핸들러가 아니다). 그래서 자동 승인에서도 닿는다. */
  const pub = JOBS2.slice(JOBS2.indexOf('if (kind.startsWith("publish."))'), JOBS2.indexOf('if (kind.startsWith("publish."))') + 900);
  ok(/await applyFormatMarksToPiece\(tid, pieceId \?\? 0, okBody\.formatMarks\);/.test(pub),
    "R-13 🔴 알림을 부르는 함수가 **발행 성공 경로**에 있다(사람이 승인했든 자동이든 **같은 길**이라 자동 승인에서도 닿는다)");
  ok(!/approve|review|검수/.test(JOBS2.slice(JOBS2.indexOf("const say = formatDemotionNotice") - 400, JOBS2.indexOf("const say = formatDemotionNotice"))),
    "R-13b 그 자리가 **검수·승인 화면에 매달려 있지 않다**(화면에 매달면 자동 경로에서 안 돈다)");
  ok(/title, channel FROM pieces/.test(JOBS2),
    "R-14 되돌릴 길을 채널별로 말하려고 `channel` 을 **미리 읽어 둔다**(§5E — 내릴 수 있는 채널과 아닌 채널이 다르다)");
}

console.log(`\nverify-block-demote: ${pass}/${fail} (통과/실패)`);
process.exit(fail ? 1 : 0);
