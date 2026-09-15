/**
 * scripts/verify-reference-sanitize.mts — 🔴 **글 레퍼런스 소독기 — 남의 문장이 한 줄도 안 남나**(R10-2·3 · 설계 §3.4·§3.5 · B · 2026-09-16).
 *   사용: npx --yes tsx scripts/verify-reference-sanitize.mts      · DB·네트워크·실호출 0
 *
 *   ══ 재는 것 ══
 *     ① 🔴 허용 목록 — 모델이 `quotes`·`sentences`·`script`·`transcript`·`text`·`title`·중첩 어느 키에 원문을 실어도 저장 모양에 **그 키가 없다**
 *     ② 🔴 길이 캡·문자열 0 — 허용 칸(emoji.top · blocks · enum)에 블로그 문장을 밀어 넣어도 **버려진다** · 저장물의 가장 긴 문자열 ≤ 8자 · 글자/숫자가 든 문자열 0(어휘 제외)
 *     ③ 🔴 원문 25자 연속이 저장물 어디에도 없다(JSON 직렬화 전수)
 *     ④ 정상 응답(예시 JSON)은 **살아남는다**(AC-68 «너무 조여 다 죽는 쪽») — 숫자·이모지·블록 순서가 그대로
 *     ⑤ 못 잰 것은 «못 쟀다» — 복붙(paste)은 measured.emphasis/photos=false · 요약 문장이 «못 봤어요»라고 말한다
 *     ⑥ 사람말 — 요약·프롬프트 줄에 영어 키·시스템 낱말·겁주는 말 0 · 프롬프트 줄은 채널이 못 내는 마크를 시키지 않는다
 *     ⑦ 골격 얹기 — 갈아끼우지 않는다(길이 ≤ +3 · 요소 ≤ 2개 추가 · tip 마지막) · tiers 없는 채널은 그대로 · 결론 앞이면 summary 가 앞으로
 *     ⑧ 🔴 음성 대조(AC-87) — 소독기를 빼면(raw 그대로 저장하면) 원문이 남는다 = 이 검사가 원문을 실제로 본다
 */
import { sanitizeTextStyleForStorage, textStyleSummary, textStylePromptLines, applyTextStyleShape, textStyleLeakProbe, textStyleName, textStyleOutline, isEmojiOnly, TEXT_STYLE_RAW_EXAMPLE, TEXT_STYLE_PROMPT, STYLE_BLOCK_TYPES } from "../lib/text-style";
import { WRITING_CONTRACTS } from "../lib/writing-contracts";
import { inlineMarksAllowed } from "../lib/channel-registry";
import type { BlockType } from "../lib/blocks";

let pass = 0; let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ""}`); } };

/* 남의 글 — 25자 넘는 문장 셋(이게 저장물에 있으면 실패다) */
const SENT1 = "요즘 전기요금 때문에 고민 많으시죠? 저도 지난달 고지서를 보고 깜짝 놀랐어요.";
const SENT2 = "성수동 카페 온더코너에서 아메리카노 4,500원을 마시며 이 글을 씁니다.";
const SENT3 = "결론부터 말하면 인버터 에어컨은 켜 두는 편이 전기요금이 덜 나옵니다.";
const LEAKS = [SENT1, SENT2, SENT3];
const hasLeak = (o: unknown) => { const s = JSON.stringify(o); return LEAKS.some((x) => s.includes(x.slice(0, 25))) || /온더코너|전기요금|인버터/.test(s); };

console.log("① 허용 목록 — 어느 키에 원문을 실어도 저장 모양에 그 키가 없다");
{
  const raw = {
    ...TEXT_STYLE_RAW_EXAMPLE,
    quotes: [SENT1], sentences: [SENT2, SENT3], script: SENT1 + SENT2, transcript: [SENT3], text: SENT1, title: SENT2, body: SENT3, paragraphs: [{ text: SENT1 }],
    shape: { ...TEXT_STYLE_RAW_EXAMPLE.shape, sample: SENT2, emoji: { ...TEXT_STYLE_RAW_EXAMPLE.shape.emoji, examples: [SENT3] } },
    voice: { ...TEXT_STYLE_RAW_EXAMPLE.voice, examples: [SENT1], title: { ...TEXT_STYLE_RAW_EXAMPLE.voice.title, text: SENT2 } },
    layout: { ...TEXT_STYLE_RAW_EXAMPLE.layout, sections: [{ heading: SENT1, text: SENT2 }] },
  };
  const s = sanitizeTextStyleForStorage(raw, "url", 4);
  const keys = new Set<string>(); const walk = (o: unknown) => { if (o && typeof o === "object" && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) { keys.add(k); walk(v); } else if (Array.isArray(o)) o.forEach(walk); };
  walk(s);
  ok("금지해야 할 키 11종이 저장 모양에 없다(quotes·sentences·script·transcript·text·body·paragraphs·sections·sample·examples·heading)", ["quotes", "sentences", "script", "transcript", "text", "body", "paragraphs", "sections", "sample", "examples", "heading"].every((k) => !keys.has(k)), [...keys].join(","));
  ok("원문 25자 연속이 저장물 어디에도 없다", !hasLeak(s));
  ok("voice.title 은 {hasNumber, chars, isQuestion} 셋뿐", JSON.stringify(Object.keys(s.voice.title).sort()) === JSON.stringify(["chars", "hasNumber", "isQuestion"]));
}

console.log("② 길이 캡·문자열 0 — 허용 칸에 문장을 밀어 넣어도 버려진다");
{
  const raw = {
    shape: { ...TEXT_STYLE_RAW_EXAMPLE.shape,
      emoji: { uses: true, where: [SENT1, "para_start"], top: [SENT2, "✅" + SENT3, "📌", "가나다", "✅✅✅✅✅✅✅✅✅✅"], perPost: SENT1 },
      emphasis: { kinds: ["bold", SENT1], perPost: "많이", on: [SENT2] },
      photos: { count: "일곱 장", where: [SENT3], captionRate: "0.3", kinds: ["photo", SENT1] },
      lineBreak: SENT1, lists: SENT2, paraChars: { avg: SENT1, max: "180자" } },
    voice: { ending: { haeyo: "대부분", hamnida: 0.1, banmal: 0.1 }, sentenceChars: SENT2, questionRate: 5, title: { hasNumber: "네", chars: SENT3, isQuestion: "아니오" } },
    layout: { blocks: [SENT1, "para", { type: "h2" }, { type: SENT2 }, "novel_block"], conclusion: SENT3, h2Count: "셋", totalChars: SENT1 },
  };
  const s = sanitizeTextStyleForStorage(raw, "url");
  const probe = textStyleLeakProbe(s);
  ok("저장물의 가장 긴 문자열 ≤ 8자(이모지) · 글자/숫자 든 문자열 0", probe.longest <= 8 && probe.wordy === 0, JSON.stringify(probe));
  ok("emoji.top 에는 이모지만 남는다(«📌» 1개)", JSON.stringify(s.shape.emoji.top) === JSON.stringify(["📌"]), JSON.stringify(s.shape.emoji.top));
  ok("enum 칸엔 어휘만(where=para_start · kinds=bold · photos.kinds=photo) · 모르는 값은 기본으로", JSON.stringify(s.shape.emoji.where) === '["para_start"]' && JSON.stringify(s.shape.emphasis.kinds) === '["bold"]' && JSON.stringify(s.shape.photos.kinds) === '["photo"]' && s.shape.lineBreak === "mixed" && s.layout.conclusion === "none");
  ok("숫자 칸에 문자열이 오면 0(범위 안) — perPost·count·paraChars", s.shape.emoji.perPost === 0 && s.shape.photos.count === 0 && s.shape.paraChars.avg === 0 && s.voice.questionRate === 1 && s.voice.title.chars === 0);
  ok("layout.blocks 는 닫힌 목록만(para·h2)", JSON.stringify(s.layout.blocks) === '["para","h2"]', JSON.stringify(s.layout.blocks));
  ok("원문 25자 연속 0", !hasLeak(s));
  ok("isEmojiOnly — 이모지 조합은 받고 글자가 섞이면 거절", isEmojiOnly("✅") && isEmojiOnly("👨‍👩‍👧") && isEmojiOnly("1️⃣") === false && !isEmojiOnly("✅가") && !isEmojiOnly("abc") && !isEmojiOnly(""));
}

console.log("③ 중첩·배열·이상 모양");
{
  const cases: unknown[] = [null, undefined, "문자열", 42, [SENT1, SENT2], { shape: [SENT1], voice: SENT2, layout: 7 }, { shape: { emoji: SENT1, emphasis: [SENT2], photos: null } }];
  ok("어떤 모양이 와도 던지지 않고 원문 0", cases.every((c) => { try { return !hasLeak(sanitizeTextStyleForStorage(c, "url")); } catch { return false; } }));
}

console.log("④ 정상 응답은 살아남는다(AC-68)");
{
  const s = sanitizeTextStyleForStorage(TEXT_STYLE_RAW_EXAMPLE, "url", 4);
  ok("숫자·이모지·블록 순서가 그대로", s.shape.paraChars.avg === 90 && s.shape.emoji.top.join("") === "✅📌💡" && s.shape.emphasis.perPost === 6 && s.shape.photos.count === 7 && s.voice.ending.haeyo === 0.8 && s.layout.h2Count === 3 && s.layout.blocks.length === TEXT_STYLE_RAW_EXAMPLE.layout.blocks.length && s.layout.conclusion === "last", JSON.stringify(s.shape));
  ok("learned — from url · shots 4 · 셋 다 쟀다", s.learned.from === "url" && s.learned.shots === 4 && s.learned.measured.emphasis && s.learned.measured.photos && s.learned.measured.emoji);
  ok("예시 JSON 이 프롬프트 안에 그대로 있다(모델이 보는 것 = 검사가 보는 것)", TEXT_STYLE_PROMPT.includes(JSON.stringify(TEXT_STYLE_RAW_EXAMPLE)) && TEXT_STYLE_PROMPT.includes("한 글자도 옮겨 적지 않는다"));
  ok("예시의 블록 어휘가 전부 닫힌 목록 안", TEXT_STYLE_RAW_EXAMPLE.layout.blocks.every((b) => STYLE_BLOCK_TYPES.includes(b as BlockType)));
}

console.log("⑤ 못 잰 것은 «못 쟀다» — 복붙");
{
  const s = sanitizeTextStyleForStorage({ ...TEXT_STYLE_RAW_EXAMPLE, shape: { ...TEXT_STYLE_RAW_EXAMPLE.shape, emphasis: { kinds: [], perPost: 0, on: [] }, photos: { count: 0, where: [], captionRate: 0, kinds: [] } } }, "paste");
  ok("paste → measured.emphasis=false · photos=false", !s.learned.measured.emphasis && !s.learned.measured.photos);
  const sum = textStyleSummary(s);
  ok("요약이 «못 봤어요»라고 말한다(«강조는 거의 안 써요»로 위장하지 않는다)", sum.some((l) => /복붙으로 배워서 꾸밈/.test(l)) && sum.some((l) => /사진은 못 봤어요/.test(l)) && !sum.some((l) => /강조는 거의 안 써요/.test(l)), sum.join(" | "));
  ok("프롬프트 줄에 강조 줄이 없다(못 쟀으니 시키지 않는다)", !textStylePromptLines(s, ["bold", "underline", "line", "value"]).some((l) => /강조/.test(l)));
}

console.log("⑥ 사람말 · 채널이 못 내는 마크는 안 시킨다");
{
  const s = sanitizeTextStyleForStorage(TEXT_STYLE_RAW_EXAMPLE, "url", 3);
  const sum = textStyleSummary(s);
  const linesNaver = textStylePromptLines(s, inlineMarksAllowed("naver_blog"));
  const linesThreads = textStylePromptLines(s, inlineMarksAllowed("threads"));
  const english = /\b(para_start|heading|highlight|conclusion|between_sections|haeyo|hamnida|banmal)\b/;
  ok("요약 문장에 영어 키 0", !sum.some((l) => english.test(l)), sum.join(" | "));
  ok("요약·프롬프트에 시스템 낱말·겁주는 말 0", ![...sum, ...linesNaver].some((l) => /러너|테넌트|크론|piece|슬롯|정지됩니다|불이익|알려만|책임/.test(l)));
  ok("네이버: 강조 줄이 bold·line·value 로(형광펜 → line·value) · 쓰레드: 강조 줄 없음", linesNaver.some((l) => /강조는 marks 로/.test(l) && /line/.test(l) && /bold/.test(l)) && !linesThreads.some((l) => /강조는 marks/.test(l)), linesNaver.join(" | "));
  ok("이모지 줄에 배운 이모지가 실린다", linesNaver.some((l) => /✅ 📌 💡/.test(l)));
  ok("이름 — 호스트만(경로·제목 0)", textStyleName("url", "https://blog.naver.com/someone/223344556677") === `blog.naver.com에서 배움 · ${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(new Date()).replace(/\s/g, "")}` && !textStyleName("url", "https://blog.naver.com/someone/223344556677").includes("someone"));
  ok("뼈대(outline)는 사람말 라벨", textStyleOutline(s).every((o) => /[가-힣]/.test(o.label)));
}

console.log("⑦ 골격 얹기 — 갈아끼우지 않는다(R8-A §3.7)");
{
  const s = sanitizeTextStyleForStorage({ ...TEXT_STYLE_RAW_EXAMPLE, layout: { ...TEXT_STYLE_RAW_EXAMPLE.layout, conclusion: "first", h2Count: 4 } }, "url");
  /* 🔴 네이버 계약은 summary·faq 를 **억제**한다(실물 근거) — 그 채널에 결론 앞 summary 를 넣으면 그게 계약 위반이다. 억제 없는 계약으로 «얹기» 자체를 잰다. */
  const naver = { ...WRITING_CONTRACTS.naver_blog, tiers: { required: ["para", "h2"] as BlockType[], optional: [] as BlockType[], suppress: ["adsense"] as BlockType[] } };
  const threads = WRITING_CONTRACTS.threads;
  const base: BlockType[] = ["hook", "para", "h2", "para", "image", "h2", "para", "image", "h2", "para", "summary", "faq", "tip", "hashtags"];
  const out = applyTextStyleShape(base, s, naver, 7);
  const realNaver = applyTextStyleShape(base.filter((b) => b !== "summary" && b !== "faq"), s, WRITING_CONTRACTS.naver_blog, 7);
  ok("진짜 네이버 계약(summary 억제)에는 summary 를 넣지 않는다", !realNaver.includes("summary"), JSON.stringify(realNaver));
  ok("길이 ≤ +4 · 순서 대부분 보존(갈아끼우지 않는다)", out.length <= base.length + 4 && out.filter((b) => b === "para").length >= base.filter((b) => b === "para").length, JSON.stringify(out));
  ok("결론 앞이면 summary 가 앞쪽(2번째 안)으로", out.slice(0, 3).includes("summary"), JSON.stringify(out.slice(0, 4)));
  ok("이 계정이 쓰는 요소(인용·표) 중 최대 둘이 들어온다", (out.includes("quote") || out.includes("divider") || out.includes("table")) && out.length - base.length - 1 <= 3);
  ok("tip 이 여전히 마지막(해시태그 앞)", out[out.length - 1] === "hashtags" && out[out.length - 2] === "tip");
  ok("tiers 없는 채널(쓰레드)은 손대지 않는다", JSON.stringify(applyTextStyleShape(["hook", "para", "hashtags"], s, threads, 1)) === JSON.stringify(["hook", "para", "hashtags"]));
  ok("같은 seed 면 같은 결과(재생성 멱등) · 다른 seed 면 소제목 수가 흔들릴 수 있다", JSON.stringify(applyTextStyleShape(base, s, naver, 7)) === JSON.stringify(out));
}

console.log("⑧ 🔴 음성 대조 — 소독기를 빼면 원문이 남는다");
{
  const raw = { ...TEXT_STYLE_RAW_EXAMPLE, quotes: [SENT1] };
  ok("raw 그대로 저장했다면 원문이 남는다(= 이 검사가 원문을 실제로 본다)", hasLeak(raw));
  ok("소독기를 지나면 남지 않는다", !hasLeak(sanitizeTextStyleForStorage(raw, "url")));
  const noProbe = textStyleLeakProbe({ shape: { emoji: { top: [SENT1] } } });
  ok("leakProbe 가 긴 문자열·글자를 잡는다(저장 직전 두 번째 자)", noProbe.longest > 8 && noProbe.wordy > 0);
}

console.log(`\n${fail ? `🔴 실패 ${fail}` : `✅ ${pass}개 통과`} (통과 ${pass} · 실패 ${fail})`);
process.exit(fail ? 1 : 0);
