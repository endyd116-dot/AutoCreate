/**
 * scripts/verify-thread-chain.mts — 쓰레드 **연결글 나누기**를 실제로 돌려 본다(R8CLOSE §B5 · 네트워크 0 · DB 0).
 *   사용: npx --yes tsx scripts/verify-thread-chain.mts
 *
 *   🔴 이 함수가 조용히 틀리면 **고객 글이 문장 한가운데서 끊긴 채 남의 계정에 올라간다.**
 *      되돌리려면 «내려 주기»를 써야 하고, 그건 이미 나간 뒤다. 그래서 여기서 다 잰다.
 *
 *   ══ 재는 것 ══
 *     ① 🔴 **문장 한가운데서 안 끊는다** — 이 파일의 존재 이유
 *     ② 🔴 **고지는 첫 조각에**(§16B · 공정위는 «본문 중간»을 부적절한 위치로 본다)
 *     ③ 🔴 **글자를 잃지 않는다** — 잃으면 `dropped` 로 **말한다**(AC-9)
 *     ④ 한 조각도 500자를 안 넘는다(플랫폼 규격)
 *     ⑤ 통과해야 하는 것도 같은 수만큼(AC-68) — 짧은 글은 **한 덩이 그대로**(무회귀)
 */
import { splitThreadChain, runThreadChain, cutAt, THREADS_MAX, MAX_PARTS } from "../lib/publish/thread-chain";
import { readFileSync } from "node:fs";

let pass = 0; let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ""}`); }
};
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `받은 값: ${JSON.stringify(got)}\n      기대값: ${JSON.stringify(want)}`);

/** 🔴 «문장 한가운데»를 기계로 판정한다 — 조각 끝이 종결어미·문장부호로 끝나야 한다. */
const endsCleanly = (s: string) => /(?:[.!?…]|다|요|임|함|죠|네|까|군|겠|[)\]」』"'])$/.test(s.trim());
/**
 * 첫 조각에서 고지(맨 앞)·태그(맨 뒤)를 떼고 **본문만** 남긴다.
 * 🔴 끊은 자리를 보려면 **본문 끝**을 봐야 한다 — 처음엔 안 떼고 재서 «실패»가 났는데,
 *    그건 **검사가 틀린 것**이지 코드가 틀린 게 아니었다(태그가 첫 조각 끝에 붙는 게 맞는 동작이다).
 */
const bodyOf = (p: string) => p.split("\n\n").filter((x) => x.trim() !== DISC && !x.trim().startsWith("#")).join("\n\n");

const SENT = [
  "에어프라이어 청소, 진짜 3분이면 됨.",
  "베이킹소다랑 식초만 있으면 되는데요.",
  "바스켓을 빼서 따뜻한 물에 10분만 담가 둡니다.",
  "그다음 부드러운 솔로 문지르면 기름때가 그냥 떨어져요.",
  "저는 이걸 모르고 2년을 박박 닦았습니다.",
  "열선 쪽은 물을 직접 뿌리면 안 됩니다.",
  "마른 천으로만 닦아 주세요.",
  "이거 하고 나서 튀김 맛이 달라졌어요.",
];
const long = SENT.join(" ");                       // 한 문단 · 문장 여러 개
const paras = [SENT.slice(0, 3).join(" "), SENT.slice(3, 6).join(" "), SENT.slice(6).join(" ")].join("\n\n");
const DISC = "이 글은 광고를 포함하고 있어요.";
const TAG = "#에어프라이어";

console.log("① 🔴 문장 한가운데서 안 끊는다 — 이 파일의 존재 이유");
{
  const r = splitThreadChain(DISC, long, TAG, 200, MAX_PARTS);
  ok("두 조각 이상으로 나뉜다", r.parts.length >= 2, `조각 ${r.parts.length}`);
  r.parts.forEach((p, i) => {
    /* 마지막 조각은 원문 끝이라 그대로고, 앞 조각들은 **우리가 끊은 자리**다 — 거기가 깨끗해야 한다. */
    if (i < r.parts.length - 1) ok(`조각 ${i + 1} 끝이 문장 끝이다`, endsCleanly(bodyOf(p)), `본문 끝 20자: «${bodyOf(p).slice(-20)}»`);
  });
}
{
  /* 문단이 있으면 **문단 경계**를 더 좋아해야 한다.
     🔴 상한을 «한 문단은 들어가고 두 문단은 안 들어가는» 크기로 잡아야 이 질문을 **실제로 묻는** 것이 된다 —
        처음엔 220 으로 잡았는데 세 문단이 한 조각에 다 들어가서, 그건 «문단에서 끊나»를 **묻지도 못한** 검사였다.
        («실패»가 났을 때 코드를 고치기 전에 **검사가 무엇을 묻고 있었나**를 먼저 봐야 하는 자리다.) */
  const onePara = paras.split("\n\n")[0].length;
  const r = splitThreadChain("", paras, "", onePara + 10, MAX_PARTS);
  ok("두 조각 이상으로 나뉜다(질문이 성립한다)", r.parts.length >= 2, `조각 ${r.parts.length} · 한 문단 ${onePara}자`);
  ok("🔴 조각 안에 문단 경계가 안 남는다(= 문단에서 끊었다)", r.parts.every((p) => !p.includes("\n\n")));
  r.parts.forEach((p, i) => { if (i < r.parts.length - 1) ok(`문단 조각 ${i + 1} 끝이 깨끗하다`, endsCleanly(bodyOf(p))); });
}

console.log("② 🔴 고지는 **첫 조각**에 · 태그도 첫 조각에");
{
  const r = splitThreadChain(DISC, long, TAG, 200, MAX_PARTS);
  ok("첫 조각이 고지로 시작한다", r.parts[0].startsWith(DISC), `시작: «${r.parts[0].slice(0, 30)}»`);
  ok("태그가 첫 조각에 있다", r.parts[0].includes(TAG));
  ok("🔴 고지가 뒤 조각에 없다(중간에 끼면 부적절한 위치다)", r.parts.slice(1).every((p) => !p.includes(DISC)));
  ok("태그도 뒤 조각에 없다", r.parts.slice(1).every((p) => !p.includes(TAG)));
}
{
  /* 🔴 고지·태그만으로 한 조각이 꽉 차는 극단 — **법이 먼저 쓴다**(AC-73). */
  const r = splitThreadChain("이 글은 광고를 포함하고 있어요.", long, TAG, 40, MAX_PARTS);
  ok("자리가 없어도 고지는 나간다", r.parts[0].includes("광고를 포함"));
  ok("🔴 그때 버린 글자를 **말한다**", r.dropped > 0);
}

console.log("③ 🔴 글자를 잃지 않는다(잃으면 말한다)");
{
  const r = splitThreadChain("", long, "", THREADS_MAX, MAX_PARTS);
  const joined = r.parts.join(" ").replace(/\s+/g, "");
  ok("합치면 원문과 같다(공백 무시)", joined === long.replace(/\s+/g, ""), `길이 ${joined.length} vs ${long.replace(/\s+/g, "").length}`);
  eq("버린 글자 0", r.dropped, 0);
}
{
  /* 조각 상한에 부딪히게 만든다 — **조용히 버리지 않는다**. */
  const huge = Array.from({ length: 40 }, () => SENT.join(" ")).join(" ");
  const r = splitThreadChain("", huge, "", 200, 2);
  eq("상한(2조각)을 안 넘는다", r.parts.length, 2);
  ok("🔴 남은 글자를 dropped 로 말한다", r.dropped > 0, `dropped=${r.dropped}`);
}

console.log("④ 플랫폼 규격 — 한 조각도 500자를 안 넘는다");
{
  for (const limit of [200, 300, THREADS_MAX]) {
    const r = splitThreadChain(DISC, long, TAG, limit, MAX_PARTS);
    ok(`limit=${limit}: 모든 조각이 상한 이하`, r.parts.every((p) => p.length <= limit), `최대 ${Math.max(...r.parts.map((p) => p.length))}`);
  }
}

console.log("⑤ 🔴 통과해야 하는 것 — 짧은 글은 **한 덩이 그대로**(무회귀)");
{
  const short = "에어프라이어 청소, 진짜 3분이면 됨.";
  const r = splitThreadChain("", short, "", THREADS_MAX, MAX_PARTS);
  eq("한 조각", r.parts.length, 1);
  eq("내용 그대로", r.parts[0], short);
  eq("계약을 안 넘는다", r.overContract, false);

  const withHead = splitThreadChain(DISC, short, TAG, THREADS_MAX, MAX_PARTS);
  eq("고지·태그가 있어도 500 안이면 한 조각", withHead.parts.length, 1);
  ok("한 조각 안에 셋 다 있다", withHead.parts[0].includes(DISC) && withHead.parts[0].includes(short) && withHead.parts[0].includes(TAG));

  const empty = splitThreadChain("", "", "", THREADS_MAX, MAX_PARTS);
  eq("빈 글이면 조각 1개(빈 문자열)", empty.parts.length, 1);
}
{
  /* 계약(2~3개)을 넘으면 **막지 않고 말한다**(CLAUDE §9). */
  const r = splitThreadChain("", Array.from({ length: 12 }, () => SENT.join(" ")).join(" "), "", 200, MAX_PARTS);
  ok("🔴 3개를 넘으면 overContract 로 말한다(막지 않는다)", r.parts.length > 3 ? r.overContract : true, `조각 ${r.parts.length}`);
}

console.log("⑥ cutAt — 자를 자리 고르기");
{
  eq("상한 안이면 통째로", cutAt("짧은 글.", 100), "짧은 글.".length);
  const s = "첫 문장입니다. 둘째 문장입니다. 셋째 문장입니다.";
  const at = cutAt(s, 20);
  ok("문장 끝에서 자른다", endsCleanly(s.slice(0, at).trim()), `«${s.slice(0, at)}»`);
  /* 🔴 한 낱말이 상한보다 길면(주소 등) 그때만 글자로 자른다 — 그래도 **멈추지 않는다**. */
  const url = `https://example.com/${"a".repeat(300)}`;
  eq("긴 낱말 하나면 글자로 자른다", cutAt(url, 50), 50);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ⑦~⑨ 🔴 **정말 이어 올리나** — AC-73 이 아무도 안 물어서 난 바로 그 질문
 *
 *   AC-73: 계약은 «태그 0~1개»로 고쳐졌는데 **발행 경로가 안 따라와** 캡션에 10개가 실렸다.
 *   여기서 같은 모양이 나려면: `reply_to_id` 를 안 넘겨 조각들이 **서로 모르는 낱개 글 3개**가 되는 것.
 *   🔴 세 개 다 200 이라 **어느 검사도 못 잡는다** — 그래서 루프를 순수 함수로 뽑아 여기서 직접 묻는다.
 * ═══════════════════════════════════════════════════════════════════════════ */
console.log("⑦ 🔴 이어 올리기 — 2번째가 1번째의 **답글**인가");
{
  const calls: { text: string; replyTo: string | null }[] = [];
  const post = async (text: string, replyTo: string | null) => {
    calls.push({ text, replyTo });
    return { ok: true as const, id: `id${calls.length}` };
  };
  const saved: string[][] = [];
  const r = await runThreadChain(["가", "나", "다"], [], post, async (d) => { saved.push([...d]); });

  eq("세 조각 다 올렸다", r.done, ["id1", "id2", "id3"]);
  eq("첫 조각은 새 글(답글 아님)", calls[0].replyTo, null);
  /* 🔴 이 두 줄이 이 하니스의 존재 이유다. */
  eq("🔴 2번째는 **1번째의 답글**", calls[1].replyTo, "id1");
  eq("🔴 3번째는 **2번째의 답글**(첫 글이 아니다)", calls[2].replyTo, "id2");
  eq("순서대로 올린다", calls.map((c) => c.text), ["가", "나", "다"]);
  /* 🔴 한 조각마다 남겨야 «2개 올리고 죽으면 1개부터 다시»가 안 난다. */
  eq("한 조각 올릴 때마다 남긴다", saved, [["id1"], ["id1", "id2"], ["id1", "id2", "id3"]]);
}

console.log("⑧ 🔴 두 번 안 올린다 — 중간에 죽은 뒤 다시 와도");
{
  const calls: { text: string; replyTo: string | null }[] = [];
  const post = async (text: string, replyTo: string | null) => { calls.push({ text, replyTo }); return { ok: true as const, id: `id${calls.length + 1}` }; };
  /* 지난번에 1조각까지 올리고 죽었다 — `done=["id1"]` 로 다시 온다. */
  const r = await runThreadChain(["가", "나", "다"], ["id1"], post);
  eq("🔴 1번째를 **다시 안 올린다**", calls.map((c) => c.text), ["나", "다"]);
  eq("🔴 이어 붙일 자리를 안다(2번째는 id1 의 답글)", calls[0].replyTo, "id1");
  eq("결과는 세 개", r.done.length, 3);
  ok("첫 글 id 가 보존된다(그 piece 의 주소다)", r.done[0] === "id1");
}
{
  /* 전부 이미 올렸으면 **한 번도 안 부른다**(재시도가 글을 늘리지 않는다). */
  let n = 0;
  const r = await runThreadChain(["가", "나"], ["a", "b"], async () => { n++; return { ok: true as const, id: "x" }; });
  eq("이미 다 올렸으면 호출 0", n, 0);
  eq("결과 그대로", r.done, ["a", "b"]);
}

console.log("⑨ 🔴 중간에 실패하면 — 앞에 올린 것은 **살려 두고** 어디서 멈췄는지 말한다");
{
  const calls: string[] = [];
  const post = async (text: string) => {
    calls.push(text);
    return calls.length === 2 ? { ok: false as const, detail: "429 rate" } : { ok: true as const, id: `id${calls.length}` };
  };
  const r = await runThreadChain(["가", "나", "다"], [], post);
  ok("실패로 끝난다", !r.ok);
  eq("🔴 이미 올린 것은 남는다(다음 틱이 이어받는다)", r.done, ["id1"]);
  eq("어디서 멈췄나", r.failedAt, 1);
  ok("사유를 그대로 전한다", String(r.detail).includes("429"));
  eq("실패 뒤로는 안 올린다", calls.length, 2);
}

console.log("\n⑩ 🔴 «문장 한가운데를 끊었나»가 **밖으로 나온다**(B-1 이 찾은 것 · AC-9 의 남은 반쪽)");
{
  /* 통과해야 하는 쪽부터(AC-68) — 평범한 원고는 문장 자리에서 끊기니 **깃발이 서면 안 된다.** */
  const r = splitThreadChain(DISC, long, TAG, 200, MAX_PARTS);
  ok("여러 조각으로 나뉘었다", r.parts.length >= 2);
  eq("🔴 평범한 글은 문장 한가운데가 아니다", r.cutMidSentence, false);
  ok("끊은 자리는 문단·문장·줄뿐", r.cutKinds.every((k) => k === "paragraph" || k === "sentence" || k === "line"), JSON.stringify(r.cutKinds));
}
{
  const r = splitThreadChain("", "짧은 글 하나.", "", 200, MAX_PARTS);
  eq("한 덩이면 끊은 자리가 없다", r.cutKinds, []);
  eq("한 덩이면 깃발도 안 선다", r.cutMidSentence, false);
}
{
  /* 🔴 한 낱말이 상한보다 길다(주소 같은 것) — **글자로 자를 수밖에 없고**, 그때는 말해야 한다. */
  const r = splitThreadChain("", "x".repeat(300), "", 100, MAX_PARTS);
  eq("🔴 글자로 끊었다고 말한다", r.cutMidSentence, true);
  ok("어디서 끊었는지도 말한다", r.cutKinds.includes("char"), JSON.stringify(r.cutKinds));
  eq("글자는 안 버렸다", r.parts.join("").length, 300);
}
{
  /* 문장부호도 종결어미도 없이 낱말만 이어진 원고 — 낱말 경계로 끊지만 **그래도 문장 한가운데**다. */
  const r = splitThreadChain("", Array.from({ length: 60 }, (_, i) => `단어${i}`).join(" "), "", 100, MAX_PARTS);
  eq("🔴 낱말에서 끊어도 문장 한가운데다", r.cutMidSentence, true);
  ok("낱말 자리로 끊었다", r.cutKinds.includes("word"), JSON.stringify(r.cutKinds));
}

console.log("\n⑪ 🔴 **어디까지 올렸는지 못 남기면 더 안 올린다** — 중복 게시를 막는 마지막 빗장");
{
  const calls: string[] = [];
  const post = async (text: string) => { calls.push(text); return { ok: true as const, id: `id${calls.length}` }; };
  const r = await runThreadChain(["가", "나", "다"], [], post, async () => { throw new Error("thChain 저장 확인 실패"); });
  ok("끝까지 안 간다", !r.ok);
  eq("🔴 한 조각 올리고 멈춘다(두 번째를 안 올린다)", calls.length, 1);
  eq("올린 것은 남는다", r.done, ["id1"]);
  ok("«못 남겨서» 멈춘 것임을 알린다", String(r.detail).startsWith("progress:"), String(r.detail));
}
{
  /* 통과 쪽(AC-68) — 잘 남으면 끝까지 간다. */
  const calls: string[] = [];
  const post = async (text: string) => { calls.push(text); return { ok: true as const, id: `id${calls.length}` }; };
  const saved: string[][] = [];
  const r = await runThreadChain(["가", "나", "다"], [], post, async (d) => { saved.push([...d]); });
  ok("잘 남으면 끝까지 간다", r.ok);
  eq("세 조각 다 올린다", calls.length, 3);
  eq("🔴 한 조각 올릴 때마다 남긴다(마지막에 몰아서가 아니다)", saved.length, 3);
}

console.log("\n⑫ 🔴 사슬 — **커넥터가 정말 그러나**(순수 함수 검사는 이걸 절대 못 잡는다 · AC-69)");
{
  const code = readFileSync("lib/publish/threads.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  ok("🔴 쓴 직후 jsonb_typeof 로 확인한다(CLAUDE §4.5 · PITFALLS #1)", /jsonb_typeof\(meta -> \$\{CHAIN_FIELD\}\)/.test(code), "확인 없이 쓰면 그 칸이 안 남아도 모른다 — 다음 틱이 1조각부터 다시 올린다");
  ok("개수까지 본다(타입만 맞고 비어 있어도 같은 사고다)", /jsonb_array_length/.test(code));
  ok("🔴 못 남기면 이어 올리기를 멈춘다", /if \(await saveChainState\(tid, piece\.id, done\)\) return;/.test(code));
  ok("🔴 멈춘 뒤 channelRef 를 남겨 «다시 올리기»가 첫 조각을 또 안 올리게 한다", /if \(posted\.length\) return \{ ok: true/.test(code));
  ok("못 남긴 사실을 감사로 말한다", /threads_chain_state_unsaved/.test(code));
  ok("🔴 문장 한가운데서 끊었으면 감사로 말한다", /threads_chain_cut_midsentence/.test(code));
  ok("그 글 화면이 쓸 재료도 meta 에 남긴다", /thChainCut/.test(code));
}

console.log(`\n${fail ? "🔴" : "✅"} ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
