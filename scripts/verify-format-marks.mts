/**
 * scripts/verify-format-marks.mts — 🔴 **인라인 꾸밈(뜻 마크) · 채널 꾸밈 표 · «못 낸 서식»** 을 순수 함수로 잰다(R9-1·4·5 · B · 2026-09-16).
 *   사용: npx --yes tsx scripts/verify-format-marks.mts      · DB·네트워크·실호출 0
 *
 *   ══ 재는 것 ══
 *     ① validateMarks — 범위 밖·겹침·모르는 종류·너무 긴 구간을 **버리되 사유를 남긴다**(조용히 0건 금지)
 *     ② 렌더 — 마크가 HTML 태그로 나오고, 인덱스는 **원문** 기준이며(이스케이프와 무관), 마크 없는 글은 종전과 **한 글자도 안 다르다**(무회귀 · AC-68)
 *     ③ 채널 표 — false 는 벗기고(글자는 남고) null·true 는 그린다 · 표 없는 채널은 손대지 않는다 · 모델에게 시키는 종류는 true 뿐
 *     ④ 상한 — 넘친 마크는 앞쪽부터 남기고 뒤를 budget 으로 적는다
 *     ⑤ 투영 — formatUnusedOf 가 kind×why 로 묶어 label(서버 정본)·n 을 싣고, 러너 보고는 append(재보고 멱등 · bleed 없으면 키 없음)
 *     ⑥ 🔴 음성 대조(AC-87) — 검사를 일부러 어겨 보고 빨강이 나는지(«방어를 빼면 잡히나»)
 *     ⑦ 사람말 — WHY_SAY·FIELD_LABEL 에 시스템 낱말·겁주는 말이 없다(CLAUDE §3)
 */
import { validateMarks, inlineMarked, renderBlocksHtml, normalizeBlocks, MARK_KINDS, MARK_BUDGET, MARK_LABEL, type Block, type MarkDrop } from "../lib/blocks";
import { formatCapsOf, inlineMarksAllowed, FORMAT_CAP_KEYS, CHANNELS } from "../lib/channel-registry";
import { applyMarkBudget, stripUnsupportedMarks, buildFormatMarks, mergeRunnerFormatMarks, formatUnusedOf, dropsToDemotions, WHY_SAY, FIELD_LABEL, marksPromptLine } from "../lib/format-marks";

let pass = 0; let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ""}`); } };

console.log("① validateMarks — 어긋난 마크는 버리되 사유를 남긴다");
{
  const t = "전기요금이 3만 2천원 나왔어요. 작년보다 40% 줄었어요.";
  const v = validateMarks(t, [
    { s: 6, e: 13, kind: "value" },          // «3만 2천원» ✓
    { s: 20, e: 30, kind: "line" },           // 문장 ✓
    { s: 8, e: 10, kind: "bold" },            // 겹침 → overlap
    { s: -1, e: 3, kind: "underline" },       // 범위 밖
    { s: 5, e: 5, kind: "underline" },        // s>=e
    { s: 0, e: 999, kind: "underline" },      // e>len
    { s: 0, e: 3, kind: "neon" },             // 모르는 종류
    { s: 0, e: 200, kind: "value" },          // too_long(60 초과) — 위 e>len 과 겹치지 않게 별도 텍스트로 아래에서 다시 본다
  ]);
  ok("살아남은 마크 2개(value·line)", v.marks.length === 2 && v.marks[0].kind === "value" && v.marks[1].kind === "line", JSON.stringify(v.marks));
  const whys = v.dropped.map((d) => d.why).sort();
  ok("버린 사유 5개 — overlap·range_invalid×3·unknown_kind (조용히 버린 것 0)", whys.filter((w) => w === "range_invalid").length === 4 && whys.includes("overlap") && whys.includes("unknown_kind"), whys.join(","));
  const long = "가".repeat(100);
  const v2 = validateMarks(long, [{ s: 0, e: 100, kind: "value" }]);
  ok("value 60자 넘는 구간 → too_long", v2.marks.length === 0 && v2.dropped[0]?.why === "too_long");
  const v3 = validateMarks("", [{ s: 0, e: 1, kind: "bold" }]);
  ok("text 없는 블록의 마크 → no_text", v3.dropped[0]?.why === "no_text");
  ok("정렬 — s 순으로 돌려준다", validateMarks("abcdef", [{ s: 3, e: 5, kind: "bold" }, { s: 0, e: 2, kind: "value" }]).marks.map((m) => m.s).join(",") === "0,3");
}

console.log("② 렌더 — 원문 인덱스 · 이스케이프 · 무회귀");
{
  const t = "A&B 는 <3만원> 이에요";
  const html = inlineMarked(t, [{ s: 6, e: 11, kind: "value" }]);   // «<3만원>» 6..11
  ok("마크 안 글자도 이스케이프된다(<>)", html.includes('<mark class="value">&lt;3만원&gt;</mark>'), html);
  ok("마크 밖 & 도 이스케이프", html.startsWith("A&amp;B"), html);
  ok("마크 없으면 종전 inline 과 같다(무회귀)", inlineMarked("a **b** c\nd", undefined) === "a <strong>b</strong> c<br>d");
  ok("마크 + 마크다운 굵게 공존", inlineMarked("**굵게** 그리고 밑줄", [{ s: 11, e: 13, kind: "underline" }]) === "<strong>굵게</strong> 그리고 <u>밑줄</u>", inlineMarked("**굵게** 그리고 밑줄", [{ s: 11, e: 13, kind: "underline" }]));
  const six = MARK_KINDS.map((k) => inlineMarked("xx", [{ s: 0, e: 2, kind: k }]));
  ok("여섯 종류 전부 태그가 다르다", new Set(six).size === 6, six.join(" | "));
  const blocks: Block[] = [{ type: "para", text: "문단 하나", marks: [{ s: 0, e: 2, kind: "line" }] }, { type: "h2", text: "소제목", marks: [{ s: 0, e: 3, kind: "bold" }] }, { type: "tip", text: "팁", marks: [{ s: 0, e: 1, kind: "value" }] }, { type: "summary", text: "요약", marks: [{ s: 0, e: 2, kind: "underline" }] }, { type: "quote", text: "인용", marks: [{ s: 0, e: 2, kind: "italic" }] }, { type: "hook", text: "훅", marks: [{ s: 0, e: 1, kind: "row" }] }];
  const html2 = renderBlocksHtml(blocks, "blogger");
  ok("블로거(HTML 채널): para·h2·tip·summary·quote·hook 여섯 자리 모두 마크가 그려진다", ['<mark class="line">문단</mark>', "<strong>소제목</strong>", '<mark class="value">팁</mark>', "<u>요약</u>", "<em>인용</em>", '<mark class="row">훅</mark>'].every((s) => html2.includes(s)), html2);
}

console.log("③ 채널 표 — false 는 벗기고 null·true 는 그린다 · 모델엔 true 만 시킨다");
{
  const blocks: Block[] = [{ type: "para", text: "밑줄 그리고 형광펜", marks: [{ s: 0, e: 2, kind: "underline" }, { s: 7, e: 10, kind: "line" }, { s: 4, e: 6, kind: "italic" }] }];
  const threads = renderBlocksHtml(blocks, "threads");
  ok("쓰레드(글자만): 태그 0 · 글자는 그대로", !/<(mark|u|em)\b/.test(threads) && threads.includes("밑줄 그리고 형광펜"), threads);
  const naver = renderBlocksHtml(blocks, "naver_blog");
  ok("네이버: underline·line 은 그리고 italic(false · 안 낸다)은 벗긴다", naver.includes("<u>밑줄</u>") && naver.includes('<mark class="line">형광펜</mark>') && !naver.includes("<em>"), naver);
  const tistory = renderBlocksHtml(blocks, "tistory");
  ok("티스토리(모름 null): 벗기지 않는다 — 러너가 올려 보고 적는다", tistory.includes("<u>밑줄</u>") && tistory.includes("<em>"), tistory);
  const unknown = renderBlocksHtml(blocks, "no_such_channel");
  ok("표 없는 채널: 손대지 않는다", unknown.includes("<u>밑줄</u>"));
  ok("모델에게 시키는 종류 — 네이버 5종(italic 제외) · 쓰레드 0 · 티스토리 0(모름은 안 시킨다) · 블로거 6", JSON.stringify([inlineMarksAllowed("naver_blog").length, inlineMarksAllowed("threads").length, inlineMarksAllowed("tistory").length, inlineMarksAllowed("blogger").length]) === "[5,0,0,6]",
    JSON.stringify({ naver: inlineMarksAllowed("naver_blog"), tistory: inlineMarksAllowed("tistory"), blogger: inlineMarksAllowed("blogger") }));
  ok("naver italic 은 false(«안 낸다» · null 아님 · B2 합의)", formatCapsOf("naver_blog")?.italic === false);
  ok("표가 있는 채널은 15칸 전부 값(true|false|null)이 있다", CHANNELS.filter((c) => c.formatCaps).every((c) => FORMAT_CAP_KEYS.every((k) => k in (c.formatCaps as object))));
  ok("영상 채널·브런치·클립 게시물형은 표 자체가 null", ["youtube_shorts", "brunch", "naver_clip_post", "reels"].every((k) => formatCapsOf(k) === null));
  const strip = stripUnsupportedMarks(blocks, "threads");
  ok("stripUnsupportedMarks(쓰레드): 마크 0 · 강등 3건 channel_unsupported", !strip.blocks[0].marks && strip.dropped.length === 3 && strip.dropped.every((d) => d.why === "channel_unsupported"), JSON.stringify(strip.dropped));
  ok("프롬프트 줄 — 시킬 게 없으면 빈 문자열(줄 자체가 빠진다)", marksPromptLine([]) === "" && marksPromptLine(inlineMarksAllowed("naver_blog")).includes("underline") && !marksPromptLine(inlineMarksAllowed("naver_blog")).includes("italic"));
}

console.log("④ 상한 — 앞쪽부터 남기고 뒤를 budget 으로");
{
  const many: Block[] = Array.from({ length: 5 }, (_, i) => ({ type: "para" as const, text: "가나다라마바사아자차카타파하".repeat(2), marks: Array.from({ length: 4 }, (_, j) => ({ s: j * 3, e: j * 3 + 2, kind: "value" as const })) }));
  const r = applyMarkBudget(many);   // value 20개 → 12개
  const kept = r.blocks.reduce((a, b) => a + (b.marks?.length ?? 0), 0);
  ok(`value 20개 → ${MARK_BUDGET.value.perPost}개 남기고 8개 budget`, kept === MARK_BUDGET.value.perPost && r.dropped.length === 8 && r.dropped.every((d) => d.why === "budget"), `kept=${kept} dropped=${r.dropped.length}`);
  ok("앞 문단(독자가 먼저 보는 곳)이 살아남는다", (r.blocks[0].marks?.length ?? 0) === 4 && !r.blocks[4].marks);
}

console.log("⑤ 투영·합치기");
{
  const drops: MarkDrop[] = [];
  const blocks = normalizeBlocks([{ type: "para", text: "  앞공백 3만원", marks: [{ s: 6, e: 9, kind: "value" }, { s: 0, e: 99, kind: "bold" }] }], { drops });
  ok("normalizeBlocks — trim 만큼 인덱스를 당긴다(«3만원» 6..9 → 4..7)", blocks[0].marks?.[0]?.s === 4 && blocks[0].marks?.[0]?.e === 7, JSON.stringify(blocks[0].marks));
  ok("normalizeBlocks — 어긋난 마크는 drops 로 나온다", drops.length === 1 && drops[0].why === "range_invalid");
  const fm = buildFormatMarks([{ type: "para", text: "x", marks: [{ s: 0, e: 1, kind: "value" }, { s: 0, e: 1, kind: "line" }] }], [{ type: "para", text: "x", marks: [{ s: 0, e: 1, kind: "value" }] }], [...dropsToDemotions(drops), { kind: "line", why: "channel_unsupported", by: "server" }]);
  ok("planned{value:1,line:1} · kept{value:1}", fm.planned.value === 1 && fm.planned.line === 1 && fm.kept?.value === 1 && !fm.kept?.line, JSON.stringify(fm));
  const merged = mergeRunnerFormatMarks(fm, { applied: { value: 1, bogus: -3 }, kept: { value: 9 }, demoted: [{ kind: "table", why: "no_editor_op", sample: "이 표는 스무 자가 넘는 긴 표본 문장입니다 정말로" }, { kind: "value", why: "caret_drift" }], breaks: 7, breakFails: 1,
    bleed: { total: 40, bad: 5, pct: 12.34, red: 1, center: 0, italic: 2, underline: 2, bold: 0, samples: ["고객 본문 조각은 안 싣는다"] }, htmlMode: 2 });
  ok("러너 보고 — applied 는 받고 음수는 버리고, kept 는 서버 값이 이기고, 강등은 append(by:runner) · sample 20자", merged.applied?.value === 1 && merged.applied?.bogus === undefined && merged.kept?.value === 1 && merged.demoted.length === 4 && merged.demoted[2].by === "runner" && (merged.demoted[2].sample?.length ?? 0) <= 20, JSON.stringify(merged));
  ok("breaks·breakFails·bleed(B2 모양 · pct 12.3 · samples 는 버림)·htmlMode 가 실린다", merged.breaks === 7 && merged.breakFails === 1 && merged.bleed?.pct === 12.3 && merged.bleed?.italic === 2 && !("samples" in (merged.bleed ?? {})) && merged.htmlMode === 2, JSON.stringify(merged.bleed));
  ok("옛 모양(bleed 숫자 하나)도 pct 로 읽는다 · htmlMode 0 이면 키 없음", mergeRunnerFormatMarks(fm, { bleed: 3 }).bleed?.pct === 3 && !("htmlMode" in mergeRunnerFormatMarks(fm, { htmlMode: 0 })));
  const again = mergeRunnerFormatMarks(merged, { demoted: [{ kind: "table", why: "no_editor_op", sample: "이 표는 스무 자가 넘는 긴 표본 문장입니다 정말로" }] });
  ok("재보고 멱등 — 같은 강등이 두 번 쌓이지 않는다", again.demoted.length === 4);
  const noBleed = mergeRunnerFormatMarks(fm, { applied: { value: 1 } });
  ok("🔴 bleed 를 안 보내면 키가 없다(«못 쟀다» ≠ 0%)", !("bleed" in noBleed));
  const fu = formatUnusedOf(merged);
  ok("formatUnusedOf — kind×why 묶음 · label 은 서버 정본 · n", fu.length === 4 && fu.every((x) => x.label && x.why && x.n >= 1) && fu.find((x) => x.field === "line")?.label === MARK_LABEL.line, JSON.stringify(fu));
  ok("비어 있으면 []", formatUnusedOf(null).length === 0 && formatUnusedOf({ planned: {}, demoted: [] }).length === 0);
}

console.log("⑥ 🔴 음성 대조 — 방어를 빼면 빨개지나");
{
  /* 옛 렌더 = 마크를 무시하던 inline. 마크가 있는 글을 옛 렌더로 그리면 태그가 없어야 «이 검사가 마크를 실제로 본다»가 증명된다. */
  const withMark = inlineMarked("3만원", [{ s: 0, e: 3, kind: "value" }]);
  const oldRender = inlineMarked("3만원", undefined);
  ok("마크 있는 글 ≠ 마크 없는 글(검사가 마크를 실제로 본다)", withMark !== oldRender);
  /* 채널 표를 무시하는 렌더(모든 종류를 그린다)를 쓰레드에 대 보면 태그가 남는다 → 우리 렌더는 벗긴다. 둘이 다르면 표가 실제로 작동한다. */
  const naive = inlineMarked("밑줄", [{ s: 0, e: 2, kind: "underline" }]);
  const ours = renderBlocksHtml([{ type: "para", text: "밑줄", marks: [{ s: 0, e: 2, kind: "underline" }] }], "threads");
  ok("표를 무시한 렌더(태그 있음) ≠ 우리 렌더(쓰레드 · 태그 없음) — 표가 작동한다", naive.includes("<u>") && !ours.includes("<u>"));
  /* validateMarks 를 안 거치면(생짜 마크) 겹침이 렌더에서 하나 사라진다 — 즉 validate 가 실제로 무언가를 한다. */
  const raw = [{ s: 0, e: 4, kind: "value" as const }, { s: 2, e: 6, kind: "line" as const }];
  const validated = validateMarks("가나다라마바사", raw).marks;
  ok("겹침을 validate 가 걸러 렌더 입력이 줄어든다(2 → 1)", raw.length === 2 && validated.length === 1);
}

console.log("⑦ 사람말 — 시스템 낱말·겁주는 말 0");
{
  const texts = [...Object.values(WHY_SAY), ...Object.values(FIELD_LABEL)];
  const banned = texts.filter((s) => /러너|테넌트|크론|piece|슬롯|정지됩니다|불이익|알려만|책임/.test(s));
  ok("WHY_SAY·FIELD_LABEL 에 금지 낱말 0", banned.length === 0, banned.join(" | "));
}

console.log(`\n${fail ? `🔴 실패 ${fail}` : `✅ ${pass}개 통과`} (통과 ${pass} · 실패 ${fail})`);
process.exit(fail ? 1 : 0);
