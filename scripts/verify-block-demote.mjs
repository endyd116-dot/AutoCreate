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

console.log(`\nverify-block-demote: ${pass}/${fail} (통과/실패)`);
process.exit(fail ? 1 : 0);
