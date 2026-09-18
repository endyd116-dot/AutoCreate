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
/** 🔴 **남겨 둔 한계** — 초록으로도 빨강으로도 세지 않는다.
 *  초록으로 세면 «괜찮은 것»으로 굳고(AC-9), 늘 빨갛게 두면 아무도 이 자를 안 본다.
 *  ⇒ **따로 세고 끝에 다시 외친다.** 사라지면 «이제 고쳐졌다 · 이 항목을 지워라»로 바뀐다. */
const known: string[] = [];
const note = (name: string, stillBroken: boolean, detail: string) => {
  if (stillBroken) { known.push(name); console.log(`  ⊘ [남겨 둔 한계] ${name} — ${detail}`); }
  else console.log(`  ✓ [고쳐졌다] ${name} — 이 자의 «남겨 둔 한계» 항목을 지워 주세요`);
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
  /* 🔴 **내가 처음에 틀리게 말한 자리다 — 정정을 코드에 박아 둔다**(2026-09-19 · 메인이 잡았다).
     나는 `[5000×4]` **하나**를 재고 «수리본은 **제 검사를 절대 통과하지 못한다**»고 단정했다.
     그건 **완전 균등**이라는 한 점에서만 참이다. 메인이 «실제 대본의 씬은 안 고르다 —
     이미 리듬이 있는 입력에 8%를 더 밀면 문턱을 넘길 수도 있다»고 짚었고, **재 보니 그 말이 맞았다.**

     ══ 산수 ══ 수리는 짝끼리 ±shift(=0.08·mean). 짝수 자리는 `|dev₀+shift|`, 홀수 자리는 `|dev₀−shift|`.
        문턱 0.1·mean 을 넘으려면 **`dev₀ ≥ 0.02·mean`** 이면 된다 ⇒ **dev₀=0(완전 균등)일 때만 절대 실패.**
     ══ 실측 ══ 근사균등 무작위 3,920편: **56.4% 통과**. 흔들림별 0.5%→0% · 1%→0% · 2%→9.2% · 3%→49.9% · 5%→74.9%.
        🔴 **실제 경로**(`planCutWindows` 정본 + 10~28음절 문장) 3,000편: 씬 불균등도 중앙값 **47%** · **최소 4.8%** —
        `cut_rhythm` 이 «균등»으로 걸린 편은 **0.20%(6편)**이고 **그 6편은 수리본이 100% 통과**했다.
     ⇒ 🔴 **순손해가 아니다. 지우지 않는다**(메인 판정 기준 «한 번도 안 통과하면 지워라»에 해당하지 않는다).
        옳은 자리는 여전히 `scenes.ts` **계획 단계**이고 그건 A/V 싱크가 걸린 설계라 메인이 다음 판으로 가져간다. */
  note("cut_rhythm 수리는 **완전 균등 입력에서만** 제 검사를 못 통과한다(전부는 아니다 — 내 첫 주장이 틀렸다)",
    rhythm1?.pass === false, "이 한 점만 실패 · 근사균등 56.4% · 실제 경로 6/6 통과 → **지울 것이 아니다**(아래 축들이 잰다)");

  /* 🔴 «이 수리가 통과하는 입력이 존재하나» — 메인 지시로 **실행해서** 센다(씨앗 고정이라 흔들리지 않는다). */
  const mkLens = (lens: number[]) => {
    let t = 0;
    const scenes = lens.map((l, i) => { const s = t; t += l; return { idx: i, startMs: s, endMs: t, clipKey: "k" }; });
    return { ...(payload as unknown as Record<string, unknown>), scenes } as never;
  };
  const tryRepair = (lens: number[]): boolean | null => {
    const a = judgePayloadDeterministic(mkLens(lens), {}, null, "훅");
    if (a.axes.find((x: { key: string }) => x.key === "cut_rhythm")?.pass !== false || !a.repairedPayload) return null;
    return judgePayloadDeterministic(a.repairedPayload, {}, null, "훅").axes.find((x: { key: string }) => x.key === "cut_rhythm")?.pass !== false;
  };
  let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let trig = 0, ok = 0;
  for (let k = 0; k < 1200; k++) {
    const n0 = 3 + Math.floor(rnd() * 9), mean = 2000 + Math.floor(rnd() * 6000), spread = rnd() * 0.10;
    const r0 = tryRepair(Array.from({ length: n0 }, () => Math.round(mean * (1 + (rnd() * 2 - 1) * spread))));
    if (r0 !== null) { trig++; if (r0) ok++; }
  }
  rec("🔴 수리가 **통과하는 입력이 존재한다**(= 순손해가 아니다 · 지울 것이 아니다)", trig > 0 && ok > 0,
    `근사균등 ${trig}편 중 ${ok}편 통과(${trig ? (ok / trig * 100).toFixed(1) : "—"}%)`);
  rec("🔴 완전 균등은 **그 한 점만** 실패한다(dev₀=0 이면 8% 를 밀어도 10% 문턱에 못 닿는다)",
    tryRepair([5000, 5000, 5000, 5000]) === false && tryRepair([5000, 5000, 5000, 5000, 5000]) === false);
  rec("🔴 dev₀ ≥ 2%·mean 이면 넘긴다 — 문턱이 산수대로다", tryRepair([5100, 4900, 5100, 4900]) === true, "±2% 입력");

  /* 🔴 **실제 경로로 잰다** — 무작위 분포가 아니라 `planCutWindows` **정본**에 현실적인 문장(10~28음절 · 계약 상한)을 태운다.
     여기서 나오는 씬은 **전혀 고르지 않다** ⇒ «완전 균등»은 실제로는 거의 안 나오는 입력이라는 것을 숫자로 남긴다. */
  const { planCutWindows } = await import("../lib/video/scenes.js");
  const { speechSecondsOf } = await import("../lib/video/tts.js");
  let made = 0, fired = 0, firedOk = 0, minDev = 1;
  for (let k = 0; k < 800; k++) {
    const cuts = 4 + Math.floor(rnd() * 6), nLines = cuts + Math.floor(rnd() * cuts);
    let t = 0;
    const lines = Array.from({ length: nLines }, (_, i) => {
      const s = t; t += Math.round(speechSecondsOf(10 + Math.floor(rnd() * 19)) * 1000);
      return { idx: i, cutIdx: Math.min(cuts - 1, Math.floor(i * cuts / nLines)), startMs: s, endMs: t };
    });
    const wins = planCutWindows(lines);
    if (wins.length < 3) continue;
    made++;
    const lens = wins.map((w: { startMs: number; endMs: number }) => w.endMs - w.startMs);
    const mean = lens.reduce((a: number, b: number) => a + b, 0) / lens.length;
    minDev = Math.min(minDev, Math.max(...lens.map((l: number) => Math.abs(l - mean))) / mean);
    const r0 = tryRepair(lens);
    if (r0 !== null) { fired++; if (r0) firedOk++; }
  }
  rec("🔴 실제 컷 창은 **고르지 않다** — «완전 균등»은 이 경로에서 안 나온다",
    minDev > 0.02, `${made}편 중 가장 고른 편도 불균등도 ${(minDev * 100).toFixed(1)}%(문턱 10% · 절대 실패선 2%)`);
  rec("🔴 실제 경로에서 수리가 불려도 **통과한다**(불린 편이 없으면 그것도 사실대로 적는다)",
    fired === 0 || firedOk === fired, fired ? `${fired}편 걸림 · ${firedOk}편 통과` : `${made}편 중 «균등»으로 걸린 편 0 — 이 축은 이번 표본에서 못 쟀다`);
  console.log(`  · 참고(판정 아님): 실제 경로 ${made}편 중 cut_rhythm 이 «균등»으로 걸린 편 ${fired}편(${(fired / Math.max(1, made) * 100).toFixed(2)}%) — **이 축은 거의 잠들어 있다**`);
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
if (known.length) {
  console.log(`⊘ 남겨 둔 한계 ${known.length}개 — **통과로 세지 않는다**(메인 결정 2026-09-19: 지우지 말고 남긴다 · 옳은 자리는 \`scenes.ts\` 계획 단계 → 다음 판 설계):`);
  known.forEach((k) => console.log(`   · ${k}`));
}
process.exit(bad ? 1 : 0);
