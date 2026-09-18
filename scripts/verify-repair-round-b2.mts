/**
 * scripts/verify-repair-round-b2.mts — 🔴 수리 라운드에서 «받을 것»에서 **골라 고친 셋**을 지킨다.
 *
 *   사용:  npx --yes tsx scripts/verify-repair-round-b2.mts            (0 = 전부 통과)
 *          npx --yes tsx scripts/verify-repair-round-b2.mts --mutate   (🔴 스스로 망가뜨려 본다 · AC-108)
 *
 *   ① AM `cee28b0d6` — «쓸쥐오닦쥐오» 의 **글자 쪽**. 2026-09-19 에 소리(`applyReadingDict`)만 고쳐 **반쪽**이었다:
 *      화면 자막·유튜브 제목·원장에 남는 것은 **우리가 쓴 글자**다. ⇒ 프롬프트 + **결정론 교정**.
 *   ② AM `41fb79939` — 발화 예산 **단위/상수가 두 벌**. AM 은 «8.7자/초»와 «음절/초»가 1.36배 어긋난 채 몇 주를 갔다.
 *   ③ AM `d507ae885` — **관문 재통과**. 수리본을 저장해 놓고 등급은 수리 **전** 축으로 내면,
 *      저장된 스펙과 그 옆의 판정이 **서로 다른 물건**을 가리킨다.
 *
 *   🔴 네트워크 0 · DB 0 · provider 실호출 0. 순수 함수만 돌린다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const MUTATE = process.argv.includes("--mutate");
let bad = 0, measured = 0;
const rec = (name: string, ok: boolean, detail = "") => {
  measured++; if (!ok) bad++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
/** 🔴 **알려진 결함** — 초록으로도 빨강으로도 세지 않는다.
 *  초록으로 세면 결함이 «괜찮은 것»으로 굳고(AC-9), 늘 빨갛게 두면 아무도 이 자를 안 본다.
 *  ⇒ **따로 세고 끝에 다시 외친다.** 고쳐지면 «이제 고쳐졌다 · 이 항목을 지워라»로 바뀐다. */
const known: string[] = [];
const note = (name: string, stillBroken: boolean, detail: string) => {
  if (stillBroken) { known.push(name); console.log(`  ⊘ [알려진 결함] ${name} — ${detail}`); }
  else console.log(`  ✓ [고쳐졌다] ${name} — 이 자의 «알려진 결함» 항목을 지워 주세요`);
};

const DICT = { "쓸GO 닦GO": "쓸고 닦고" };

async function run(): Promise<void> {
  const { normalizeReadingKeySpelling, brandSpellingNote } = await import("../lib/video/script.js");
  const { judgePayloadDeterministic } = await import("../lib/video/judge.js");

  console.log("\n① 글자 쪽 — 정본 표기로 되돌린다(막지 않고 고친다)");
  /* 잡는 축 */
  rec("붙여 쓴 상호를 정본 표기로 되돌린다", normalizeReadingKeySpelling("쓸GO닦GO가 왔어요.", DICT).text === "쓸GO 닦GO가 왔어요.");
  rec("🔴 조사·어미는 건드리지 않는다", normalizeReadingKeySpelling("쓸GO닦GO의 원칙", DICT).text === "쓸GO 닦GO의 원칙", "«의» 가 그대로");
  rec("무엇을 고쳤는지 남긴다(조용한 교정 0)", normalizeReadingKeySpelling("쓸GO닦GO가", DICT).fixed.join() === "쓸GO 닦GO");
  /* 🔴 반증 축 — 고치면 **안 되는** 자리 */
  rec("🔴 이미 정본이면 한 글자도 안 바꾼다(무회귀)", normalizeReadingKeySpelling("쓸GO 닦GO가", DICT).text === "쓸GO 닦GO가"
    && normalizeReadingKeySpelling("쓸GO 닦GO가", DICT).fixed.length === 0);
  rec("🔴 상호가 없는 문장은 무변", normalizeReadingKeySpelling("오늘은 청소 이야기입니다.", DICT).text === "오늘은 청소 이야기입니다.");
  rec("🔴 사전이 없으면 무변(옛 테넌트)", normalizeReadingKeySpelling("쓸GO닦GO가", null).text === "쓸GO닦GO가");
  rec("🔴 공백 없는 열쇠는 대상이 아니다", normalizeReadingKeySpelling("ABC 입니다", { ABC: "에이비씨" }).fixed.length === 0);
  rec("🔴 짧은 열쇠는 안 문다(«A B»→«AB» 금지)", normalizeReadingKeySpelling("KAB 입니다", { "A B": "에이비" }).text === "KAB 입니다");
  /* 프롬프트 절 — 열쇠가 없으면 **빈 문자열**이어야 옛 프롬프트가 바이트 무회귀다 */
  rec("프롬프트 절이 정본 표기를 말한다", /쓸GO 닦GO/.test(brandSpellingNote(DICT)) && /적힌 그대로/.test(brandSpellingNote(DICT)));
  rec("🔴 열쇠가 없으면 절이 통째로 없다(옛 테넌트 프롬프트 무회귀)", brandSpellingNote(null) === "" && brandSpellingNote({ ABC: "에이비씨" }) === "");
  /* 🔴 소리와 글자가 **같은 문턱**을 쓰는가 — 다른 잣대면 또 갈린다 */
  const { READING_DICT_SQUASHED_MIN } = await import("../lib/video/tts.js");
  const { READING_KEY_SQUASHED_MIN } = await import("../lib/video/script.js");
  rec("🔴 소리와 글자의 문턱이 같다", READING_DICT_SQUASHED_MIN === READING_KEY_SQUASHED_MIN, `소리 ${READING_DICT_SQUASHED_MIN} · 글자 ${READING_KEY_SQUASHED_MIN}`);

  console.log("\n② 발화 예산 상수 — 두 벌 금지(⚠️ 배선 검사 · budgetFor 는 비공개라 실행으로 못 잰다)");
  const src = readFileSync("lib/video/script.ts", "utf8");
  rec("상수를 tts.ts 에서 가져다 쓴다", /SPEECH_SYLLABLES_PER_SEC/.test(src) && /from "\.\/tts"/.test(src));
  /* 🔴 **주석은 걷고 본다** — 주석에 «종전엔 4.6 이 적혀 있었다»고 쓴 글이 이 축을 빨갛게 만들면
     사람은 주석이 아니라 **축을 지운다**(자가 틀리면 자를 못 믿게 된다). 코드만 본다. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  rec("🔴 예산·프롬프트 **코드**에 맨숫자 4.6 이 없다", !/\b4\.6\b/.test(code), (code.match(/.{0,28}\b4\.6\b.{0,20}/) || [""])[0]);

  console.log("\n③ 관문 재통과 — 수리했으면 다시 잰다");
  /* 전 씬이 균등 = cut_rhythm 미달 → 수리본이 생긴다. 그 수리본으로 다시 재면 그 축이 통과해야 한다. */
  const even = (n0: number) => Array.from({ length: n0 }, (_, i) => ({ idx: i, startMs: i * 5000, endMs: (i + 1) * 5000, clipKey: "k" }));
  const payload = {
    channel: "youtube", out: { w: 1080, h: 1920, fps: 30, maxSeconds: 30, channel: "youtube" },
    scenes: even(4), captions: { preset: "phrase", phrases: [] },
    overlay: { badge: null, endcard: null, safeZone: { top: 400, bottom: 400, side: 60 } }, disclosureCaption: null,
    audio: { narration: [], bgm: null, sfx: null, loudnorm: { I: -16, TP: -1.5, LRA: 11 } },
  } as never;
  const first = judgePayloadDeterministic(payload, {}, null, "훅");
  const rhythm0 = first.axes.find((a: { key: string }) => a.key === "cut_rhythm");
  rec("균등 씬이면 cut_rhythm 이 미달이고 수리본이 나온다", rhythm0?.pass === false && !!first.repairedPayload);
  const again = first.repairedPayload ? judgePayloadDeterministic(first.repairedPayload, {}, null, "훅") : null;
  const rhythm1 = again?.axes.find((a: { key: string }) => a.key === "cut_rhythm");
  /* 🔴 **재통과를 배선했더니 곧바로 드러난 것**(2026-09-19 B2 · 이 자가 처음 잡았다):
     `cut_rhythm` 수리는 씬 경계를 **평균의 8%** 미는데 판정 문턱은 **10%** 다.
     ⇒ 수리본은 **제 검사를 절대 통과하지 못한다.** 실측 [5000×4] → [5400,4600,5400,4600] · maxDev 400 < 문턱 500.
     🔴 즉 종전 «수리»는 **아무것도 안 고치면서** 씬 경계만 나레이션에서 400ms 밀어 놓는다.
     🔴 **여기서 안 고친다** — 8%를 12%로 올리면 검사는 통과하지만 **그림이 소리에서 더 멀어진다.**
        옳은 자리는 사후 밀기가 아니라 `scenes.ts` 의 **계획 단계**이고, 그건 A/V 싱크가 걸린 설계 결정이다.
        ⇒ 메인에 보고하고 결정을 받는다(조용한 축소 0 · **조용한 확대도 0**). */
  note("cut_rhythm 수리본이 제 검사를 못 통과한다(8% 밀기 < 10% 문턱)", rhythm1?.pass === false,
    "재통과 배선이 드러냈다 · 사후 밀기는 A/V 싱크를 건드린다 → 계획 단계(scenes.ts)에서 고칠 일 · 메인 보고함");
  /* 🔴 **재통과를 실행으로 잰다**(소스 정규식이 아니라 · AM 8244b1770 «계단을 정규식이 아니라 실행으로»).
     `reading_time` 은 수리하면 **판정 문구가 바뀐다** — 수리 전엔 «읽을 시간 부족 …(표시 시간 연장으로 수리)»,
     수리본으로 다시 재면 이미 늘어나 있어 **사유가 사라진다.** 그 차이가 «정말 다시 쟀나»의 증거다. */
  const { regate } = await import("../lib/video/judge.js");
  const slowPayload = {
    channel: "youtube", out: { w: 1080, h: 1920, fps: 30, maxSeconds: 30, channel: "youtube" },
    scenes: [{ idx: 0, startMs: 0, endMs: 9000, clipKey: "k" }, { idx: 1, startMs: 9000, endMs: 20000, clipKey: "k" }],
    captions: { preset: "phrase", phrases: [
      { idx: 0, text: "스무자짜리문장을여기에넣어본다길게", startMs: 0, endMs: 1000 },
      { idx: 1, text: "짧다", startMs: 5000, endMs: 9000 }] },
    overlay: { badge: null, endcard: null, safeZone: { top: 400, bottom: 400, side: 60 } }, disclosureCaption: null,
    audio: { narration: [], bgm: null, sfx: null, loudnorm: { I: -16, TP: -1.5, LRA: 11 } },
  } as never;
  const d0 = judgePayloadDeterministic(slowPayload, {}, null, "훅");
  const read0 = d0.axes.find((a: { key: string }) => a.key === "reading_time");
  rec("읽을 시간이 모자란 자막은 수리본이 생긴다", !!d0.repairedPayload && !!read0?.detail, read0?.detail ?? "사유 없음");
  const after = regate(d0, {}, null, "훅");
  const read1 = after.axes.find((a: { key: string }) => a.key === "reading_time");
  rec("🔴 재통과가 **정말 다시 잰다**(수리 전 사유 → 수리 후 사유 사라짐 · 실행으로 쟀다)",
    !!read0?.detail && !read1?.detail, `수리 전 «${(read0?.detail ?? "").slice(0, 28)}» → 수리 후 «${read1?.detail ?? "(사유 없음)"}»`);
  rec("🔴 수리본이 없으면 받은 것을 그대로 돌려준다(무회귀)", regate({ axes: d0.axes, repairedPayload: null }, {}, null, "훅").axes === d0.axes);
  rec("🔴 재통과는 한 번만 — 수리본은 처음 것을 그대로 들고 간다(무한 되먹임 0)", after.repairedPayload === d0.repairedPayload);
  const judgeSrc = readFileSync("lib/video/judge.ts", "utf8");
  rec("judgeVideo 가 그 재통과를 쓴다(⚠️ 배선)", /const det = regate\(det0,/.test(judgeSrc));
  rec("두 번 잴 때 **같은 재료**를 쓴다(reportOf 한 곳)(⚠️ 배선)", (judgeSrc.match(/reportOf\(video, vmeta\)/g) || []).length === 2);
}

/* ── 🔴 스스로 변이(AC-108) ── */
const MUTANTS = [
  { what: "교정기가 조사까지 먹는다(«쓸GO 닦GO» 로 끝내 버린다)",
    file: "lib/video/script.ts", from: "    out = out.split(squashed).join(k);", to: "    out = k;", expect: "조사·어미는 건드리지 않는다" },
  { what: "열쇠가 없어도 프롬프트 절을 붙인다(옛 테넌트 프롬프트가 바뀐다)",
    file: "lib/video/script.ts", from: "  if (!keys.length) return \"\";", to: "  if (!keys.length) return \"[표기] 없음\";", expect: "열쇠가 없으면 절이 통째로 없다" },
  { what: "재통과가 수리본을 안 보고 받은 축을 그대로 돌려준다(저장된 스펙과 판정이 딴 물건을 가리킨다)",
    file: "lib/video/judge.ts", from: "  if (!det0.repairedPayload) return det0;", to: "  return det0;", expect: "재통과가 **정말 다시 잰다**" },
  { what: "judgeVideo 가 재통과를 안 부른다",
    file: "lib/video/judge.ts", from: "  const det = regate(det0,", to: "  const det = ((x) => x)(det0); void regate; const _unused = (", expect: "judgeVideo 가 그 재통과를 쓴다" },
  { what: "예산 상수를 도로 손으로 적는다(두 벌)",
    file: "lib/video/script.ts", from: "seconds * SPEECH_SYLLABLES_PER_SEC * 0.85", to: "seconds * 4.6 * 0.85", expect: "맨숫자 4.6 이 없다" },
];

async function mutate(): Promise<void> {
  console.log("\n🔴 변이 — 일부러 망가뜨려 본다(안 울면 이 자는 값이 0 이다)\n");
  for (const m of MUTANTS) {
    const orig = readFileSync(m.file, "utf8");
    if (!orig.includes(m.from)) { console.log(`  ⊘ «${m.what}» — 심을 자리를 못 찾았다(자가 낡았다)`); bad++; continue; }
    try {
      writeFileSync(m.file, orig.replace(m.from, m.to));
      let caught = false, out = "";
      try { execFileSync("npx", ["--yes", "tsx", "scripts/verify-repair-round-b2.mts"], { encoding: "utf8", stdio: "pipe", shell: true }); }
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

console.log("■ 수리 라운드 — «받을 것»에서 골라 고친 셋");
await run();
if (MUTATE) await mutate();
console.log(`\n${bad ? `🔴 실패 ${bad}` : `✅ 잰 ${measured}축 전부 통과`}`);
if (known.length) { console.log(`⊘ 알려진 결함 ${known.length}개 — **통과가 아니다**(메인 결정 대기):`); known.forEach((k) => console.log(`   · ${k}`)); }
process.exit(bad ? 1 : 0);
