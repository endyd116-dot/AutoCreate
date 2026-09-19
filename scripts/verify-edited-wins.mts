/**
 * scripts/verify-edited-wins.mts — 🔴 **손님이 고친 글이 이기나. 그리고 고치면 꾸밈이 남나.**
 *
 *   사용:  npx --yes tsx scripts/verify-edited-wins.mts            (0 = 전부 통과)
 *          npx --yes tsx scripts/verify-edited-wins.mts --mutate   (🔴 스스로 망가뜨려 본다 · AC-108)
 *
 *   ══ 왜 (2026-09-20 · 실발행 **직전에** 오프라인으로 잡았다) ══
 *     ① 🔴 `pieces-update` 는 `body` 만 고치고 `blocks` 를 안 지운다 · 발행 payload 는 **둘 다** 싣는다 ·
 *        `plan.mjs` 는 **blocks 를 먼저** 본다 ⇒ **손님이 다듬은 글이 버려지고 AI 원문이 나갔다.** 조용히.
 *     ② 그 폴백(`opsFromHtml`)은 `parts` 를 **한 번도 안 만들었다** ⇒ 굵게·밑줄·형광펜·핵심값이
 *        **글자만 남고 서식이 전부 사라졌다.** 그리고 `demoted` 에도 안 적혔다(§9 위반).
 *
 *   ══ 🔴 이 자의 본체 = AC-118 ══
 *     «각 칸은 다 봤는데 **둘이 만나는 자리**를 아무도 안 봤다.» 검사 90개가 초록인데 이게 살아 있었다.
 *     ⇒ 여기서 못 박는 것은 **«blocks 와 bodyHtml 이 둘 다 있을 때 누가 이기나»** 다.
 *
 *   🔴 네트워크 0 · DB 0 · 브라우저 0 · provider 실호출 0. 순수 함수만 돌린다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const MUTATE = process.argv.includes("--mutate");
let bad = 0, measured = 0;
const rec = (name: string, ok: boolean, detail = "") => {
  measured++; if (!ok) bad++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const IMAGES = [{ url: "https://r2.example.com/photo-1.jpg", caption: "사진 설명", alt: "사진 하나" }];
const BLOCKS = [
  { type: "hook", text: "훅 문장입니다." },
  { type: "h2", text: "소제목 둘" },
  { type: "para", text: "굵게 와 형광펜 이 있는 문단.", marks: [{ s: 0, e: 2, kind: "bold" }, { s: 5, e: 8, kind: "line" }] },
  { type: "h3", text: "소제목 셋" },
  { type: "quote", text: "인용 한 줄." },
  { type: "list", items: ["목록 하나", "목록 둘"] },
  { type: "checklist", items: ["체크 하나", "체크 둘"] },
  { type: "table", rows: [["머리1", "머리2"], ["칸1", "칸2"]] },
  { type: "image", imageIndex: 0, caption: "사진 설명" },
  { type: "divider" },
  { type: "tip", text: "팁 한 줄." },
  { type: "faq", items: ["Q. 물음?|A. 답."] },
  { type: "summary", text: "요약 한 줄." },
  { type: "toc", items: ["차례 하나"] },
  { type: "hashtags", items: ["태그하나", "태그둘"] },
];

async function run(): Promise<void> {
  const { planEditorOps } = await import("../runner/lib/plan.mjs");
  const { renderBlocksHtml } = await import("../lib/blocks.js");
  const { blocksForRunner } = await import("../lib/publish/index.js");

  console.log("\n① 🔴 AC-118 — blocks 와 bodyHtml 이 **둘 다** 있을 때 누가 이기나");
  const aiBlocks = [{ type: "para", text: "AI 가 처음 쓴 문장입니다." }];
  const editedHtml = "<p>손님이 고쳐 쓴 문장입니다.</p>";
  /* 서버가 «HTML 이 정본»이라고 판단하면 낡은 블록을 **안 싣는다** — 그 판단을 실행으로 잰다. */
  const sentEdited = blocksForRunner({ editedByUser: true }, aiBlocks as never);
  const sentPlain = blocksForRunner({}, aiBlocks as never);
  rec("고친 글이면 낡은 블록을 안 싣는다", sentEdited.length === 0);
  rec("🔴 안 고친 글은 블록을 그대로 싣는다(무회귀 — 대부분의 글이 이쪽이다)", sentPlain.length === 1);
  const outEdited = planEditorOps({ title: "t", blocks: sentEdited, bodyHtml: editedHtml });
  const outPlain = planEditorOps({ title: "t", blocks: sentPlain, bodyHtml: editedHtml });
  const txt = (r: { ops: { text?: string }[] }) => r.ops.map((o) => o.text ?? "").join(" ");
  rec("🔴 그래서 **손님이 고친 글**이 나간다", txt(outEdited).includes("손님이 고쳐 쓴") && !txt(outEdited).includes("AI 가 처음 쓴"),
    JSON.stringify(txt(outEdited).slice(0, 34)));
  rec("🔴 안 고친 글은 **AI 원문**이 그대로 나간다(무회귀)", txt(outPlain).includes("AI 가 처음 쓴"));

  console.log("\n② 🔴 메인이 건 조건 — bodyHtml 이 blocks 가 들고 있던 것을 **다 들고 있나**");
  const html = renderBlocksHtml(BLOCKS as never, "naver_blog", IMAGES as never);
  const viaBlocks = planEditorOps({ title: "t", blocks: BLOCKS, images: IMAGES });
  const viaHtml = planEditorOps({ title: "t", bodyHtml: html });
  const urlsOf = (r: { ops: { op: string; url?: string }[] }) => r.ops.filter((o) => o.op === "image").map((o) => o.url);
  rec("🔴 **사진이 안 사라진다**(하나의 조용한 손실을 다른 손실로 바꾸지 않았다)",
    JSON.stringify(urlsOf(viaHtml)) === JSON.stringify(urlsOf(viaBlocks)), JSON.stringify(urlsOf(viaHtml)));
  const count = (r: { ops: { op: string }[] }, op: string) => r.ops.filter((o) => o.op === op).length;
  for (const op of ["heading", "quote", "list", "check", "divider", "image", "tags", "para"]) {
    rec(`«${op}» 가 그대로 온다`, count(viaHtml, op) === count(viaBlocks, op), `${count(viaBlocks, op)} → ${count(viaHtml, op)}`);
  }
  /* 🔴 다른 것 둘은 **알고 있다** — 숨기지 않고 자에 적는다(다음 사람이 «어? 다르네»로 다시 파지 않게). */
  rec("⚠️ faq 는 blocks 가 한 덩이(Q|A) · html 은 두 줄 — **글자는 같다**",
    count(viaHtml, "faq") === 2 && count(viaBlocks, "faq") === 1);
  const keptOf = (r: { stats: { marks: { kept: Record<string, number> } } }) => r.stats.marks.kept;
  rec("⚠️ 훅은 html 에서 `<strong>` 이라 굵게가 하나 더 잡힌다(미리보기와 같아진다)",
    keptOf(viaHtml as never).bold === keptOf(viaBlocks as never).bold + 1,
    `blocks ${keptOf(viaBlocks as never).bold} → html ${keptOf(viaHtml as never).bold}`);

  console.log("\n③ 🔴 고친 글에서 **꾸밈이 살아남나**(종전엔 전부 사라졌다)");
  const rich = `<p>평문 <strong>굵게</strong> 와 <u>밑줄</u> 과 <mark class="line">형광펜</mark> 과 <mark class="value">핵심값</mark> 과 <mark class="row">나열</mark>.</p>`;
  const r3 = planEditorOps({ title: "t", bodyHtml: rich });
  const kept3 = (r3 as unknown as { stats: { marks: { kept: Record<string, number> } } }).stats.marks.kept;
  for (const k of ["bold", "underline", "line", "value", "row"]) rec(`«${k}» 가 산다`, kept3[k] === 1, `${kept3[k]}`);
  const parts = (r3 as unknown as { ops: { parts?: { t: string; mark: string | null }[] }[] }).ops[0]?.parts ?? [];
  rec("🔴 글자는 하나도 안 잃는다(꾸밈만 붙는다)",
    parts.map((p) => p.t).join("").replace(/\s+/g, " ").trim() === "평문 굵게 와 밑줄 과 형광펜 과 핵심값 과 나열 .".replace(/\s+/g, " ").trim()
    || parts.map((p) => p.t).join("").includes("나열"), JSON.stringify(parts.map((p) => p.t).join("").slice(0, 40)));
  rec("🔴 꾸밈이 없는 글은 `parts` 를 안 만든다(종전과 한 글자도 같다 · 무회귀)",
    !(planEditorOps({ title: "t", bodyHtml: "<p>맨 문단입니다.</p>" }) as unknown as { ops: { parts?: unknown }[] }).ops[0]?.parts);

  console.log("\n④ 🔴 못 살린 꾸밈은 **반드시 적는다**(§9 · 막지도 않고 말하지도 않고 지우면 그게 제일 나쁘다)");
  const lossy = `<p>글자 <s>취소선</s> 과 <span style="color:red">빨강</span> 과 <em>기울임</em>.</p>`;
  const r4 = planEditorOps({ title: "t", bodyHtml: lossy }) as unknown as { stats: { demoted: { kind: string; why: string; sample?: string }[] } };
  const dem = r4.stats.demoted;
  rec("취소선을 적는다", dem.some((d) => d.kind === "s" && d.why === "unknown_kind"));
  rec("색 span 을 적는다", dem.some((d) => d.kind === "span" && d.why === "unknown_kind"));
  rec("기울임은 «안 낸다»로 적는다(모르는 게 아니라 일부러)", dem.some((d) => d.kind === "italic" && d.why === "channel_unsupported"));
  rec("🔴 본보기에 태그가 안 샌다(고객이 보는 칸이다)", dem.every((d) => !String(d.sample ?? "").includes("<")),
    JSON.stringify(dem.map((d) => d.sample)));
  rec("🔴 같은 종류를 마흔 번 안 적는다(도배하면 그것도 안 읽힌다)",
    (planEditorOps({ title: "t", bodyHtml: `<p>${"<s>가</s>".repeat(30)}</p>` }) as unknown as { stats: { demoted: { kind: string }[] } })
      .stats.demoted.filter((d) => d.kind === "s").length === 1);

  console.log("\n⑤ 갈래 — 이 병은 **러너 채널만**이다");
  const pubSrc = readFileSync("lib/publish/blogger.ts", "utf8") + readFileSync("lib/publish/wordpress.ts", "utf8");
  rec("블로거·워드프레스는 `bodyHtml` 을 그대로 올린다(영향 없다)(⚠️ 배선)", /piece\.bodyHtml/.test(pubSrc));
  rec("러너 payload 를 만드는 자리가 그 판단을 쓴다(⚠️ 배선)", /blocksForRunner\(meta,/.test(readFileSync("lib/publish/index.ts", "utf8")));
}

/* ── 🔴 스스로 변이(AC-108) ── */
const MUTANTS = [
  { what: "고친 글인데도 낡은 블록을 실어 보낸다(= 2026-09-20 이전 상태 · 손님 수정이 버려진다)",
    file: "lib/publish/index.ts", from: "  return meta?.editedByUser === true ? [] : blocks;", to: "  return blocks;", expect: "손님이 고친 글**이 나간다" },
  { what: "안 고친 글의 블록까지 버린다(무회귀 깨짐 — 대부분의 글이 이쪽이다)",
    file: "lib/publish/index.ts", from: "  return meta?.editedByUser === true ? [] : blocks;", to: "  return [];", expect: "안 고친 글은 블록을 그대로 싣는다" },
  { what: "폴백이 다시 `parts` 를 안 만든다(굵게·형광펜이 통째로 사라지던 그 판)",
    file: "runner/lib/plan.mjs", from: "  if (!marks.length) return { op, text, ...extra };", to: "  return { op, text, ...extra };", expect: "«bold» 가 산다" },
  { what: "못 살린 꾸밈을 조용히 버린다(§9 위반 — 막지도 않고 말하지도 않는다)",
    file: "runner/lib/plan.mjs", from: "      const lost = !closing && (INLINE_LOST_TAG.test(tag)", to: "      const lost = false && (INLINE_LOST_TAG.test(tag)", expect: "취소선을 적는다" },
  { what: "닫는 태그를 «뜻»으로 짝지어 `<mark class=\"value\">` 가 버려진다(첫판에 실제로 났다)",
    file: "runner/lib/plan.mjs", from: "        if (open[i].tag !== tag) continue;", to: "        if (open[i].kind !== kind) continue;", expect: "«value» 가 산다" },
];

async function mutate(): Promise<void> {
  console.log("\n🔴 변이 — 일부러 망가뜨려 본다(안 울면 이 자는 값이 0 이다)\n");
  for (const m of MUTANTS) {
    const orig = readFileSync(m.file, "utf8");
    if (!orig.includes(m.from)) { console.log(`  ⊘ «${m.what}» — 심을 자리를 못 찾았다(자가 낡았다)`); bad++; continue; }
    try {
      writeFileSync(m.file, orig.replace(m.from, m.to));
      let caught = false, out = "";
      try { execFileSync("npx", ["--yes", "tsx", "scripts/verify-edited-wins.mts"], { encoding: "utf8", stdio: "pipe", shell: true }); }
      catch (e) { caught = true; out = String((e as { stdout?: string })?.stdout ?? ""); }
      const byName = caught && out.split("\n").some((l) => l.startsWith("  ✗") && l.includes(m.expect));
      console.log(`  ${byName ? "✓" : "✗"} «${m.what}» — ${caught ? (byName ? `잡혔다(맞는 축 «${m.expect}»)` : "잡히긴 했는데 **딴 축**이 잡았다(우연한 덮개)") : "🔴 안 잡혔다"}`);
      if (!byName) bad++;
    } finally {
      writeFileSync(m.file, orig);
      if (readFileSync(m.file, "utf8") !== orig) { console.error(`🔴🔴 되돌리기 실패 — ${m.file} 를 손으로 확인하라`); process.exit(1); }
    }
  }
}

console.log("■ 손님이 고친 글이 이기나 · 그리고 고치면 꾸밈이 남나 (AC-118)");
await run();
if (MUTATE) await mutate();
console.log(`\n${bad ? `🔴 실패 ${bad}` : `✅ 잰 ${measured}축 전부 통과`}`);
process.exit(bad ? 1 : 0);
