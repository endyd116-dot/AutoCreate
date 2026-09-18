/**
 * scripts/verify-ac111-stub-voice.mts — 🔴 **AC-111: «돈 아끼는 손잡이»가 싼 축까지 조용히 끄던 자리.**
 *
 *   사용:  npx --yes tsx scripts/verify-ac111-stub-voice.mts            (0 = 전부 통과)
 *          npx --yes tsx scripts/verify-ac111-stub-voice.mts --mutate   (🔴 스스로 망가뜨려 본다 · AC-108)
 *
 *   ══ 무엇을 재나 ══
 *     C 가 전 구간 리허설에서 잡았다: `VIDEO_PROVIDER_STUB`(= Veo·TTS 같은 **건당 수 달러** 매체를 끄는 손잡이)
 *     하나가 **대본**($0.033 · 글 한 번 부르는 값)까지 통째로 템플릿으로 갈아치웠고, **로그를 한 줄도 안 남겼다.**
 *     ⇒ «Veo 가 비싸니 꺼 두자»로 켠 하니스가 **대본 축이 가짜인 줄 모른 채 초록**을 냈다.
 *
 *     처방 셋을 그대로 축으로 만든다:
 *       ㉮ 스텁 경로는 «내가 스텁이다»를 **반드시 찍는다**(값으로만 말하면 아무도 안 듣는다)
 *       ㉯ 축마다 손잡이 — `VIDEO_SCRIPT_STUB` 로 «**대본만 진짜로**»를 고를 수 있다
 *       ㉰ 로그가 «**무엇을 못 재게 되는지**»를 같이 말한다(AC-9 자동화판)
 *
 *   ══ 🔴 돈 ══
 *     provider 실호출 0 · 네트워크 0. «손잡이가 열렸나»는 **키를 비워 두고** 재서, 열린 길이
 *     실호출 자리까지 **닿는다는 것만** 확인한다(닿아서 «키 없음»으로 떨어지는 것이 증거다).
 *     🔴 이 파일은 env 를 건드리므로 축마다 원래 값을 되돌린다(finally).
 *
 *   ⚠️ 이 검사는 `--mutate` 에서 **원본 파일을 잠깐 고쳤다 되돌린다**(house 관례 · verify-r11-mutants).
 *      되돌리기에 실패하면 크게 외치고 1 로 죽는다 — 조용히 망가진 나무를 남기지 않는다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const MUTATE = process.argv.includes("--mutate");
let bad = 0, measured = 0;
const rec = (name: string, ok: boolean | null, detail: string) => {
  if (ok === null) { console.log(`  ⊘ ${name} — ${detail}`); return; }
  measured++; if (!ok) bad++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ── env 를 이 호출 동안만 연다(되돌리기 보장) ── */
const ENV_KEYS = ["VIDEO_PROVIDER_STUB", "VIDEO_SCRIPT_STUB", "AI_STUB", "GEMINI_API_KEY", "GEMINI_API_KEYS"] as const;
async function withEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const k of ENV_KEYS) saved.set(k, process.env[k]);
  try {
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    return await fn();
  } finally { for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
/** console.info/warn 를 받아 적는다 — 「찍었나」를 **실행으로** 잰다(소스 정규식이 아니라 · AM 8244b1770 의 교훈). */
async function capture<T>(fn: () => Promise<T>): Promise<{ out: T; log: string }> {
  const lines: string[] = [];
  const oi = console.info, ow = console.warn;
  console.info = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  console.warn = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try { return { out: await fn(), log: lines.join("\n") }; } finally { console.info = oi; console.warn = ow; }
}

const TOPIC = { title: "원룸 첫 자취 필수템", angle: "이사 첫날 없으면 곤란한 것", intent: "정보" };
const scriptInput = () => ({
  topic: { ...TOPIC }, channel: "youtube", seconds: 30, format: "info", cuts: 6,
  hookType: "number_typo", persona: { facts: [] }, syllableRatio: 1,
}) as never;

async function run(): Promise<void> {
  const { buildVideoScript, factcheckRoundTrip } = await import("../lib/video/script.js");
  const { videoStub, videoScriptStub } = await import("../lib/video/types.js");

  /* ① ㉮ — 대본 스텁이 «내가 스텁이다»를 찍는가. 🔴 이 축이 AC-111 의 본체다(종전 로그 0줄). */
  const a1 = await withEnv({ VIDEO_PROVIDER_STUB: "1", VIDEO_SCRIPT_STUB: undefined },
    () => capture(() => buildVideoScript(scriptInput())));
  rec("① 대본 스텁이 찍는다(종전엔 0줄이었다)", /\[video-stub\]\s*video_script/.test(a1.log), a1.log.split("\n")[0]?.slice(0, 110) || "로그 없음");

  /* ② ㉰ — «무엇을 못 재게 되는지»를 말하는가. 유사도를 콕 집는지까지 본다(스텁이면 계정 간 유사도가 늘 1 이다). */
  rec("② 로그가 «못 재는 것»을 말한다(㉰)", /못 재는 것:/.test(a1.log) && /유사도/.test(a1.log), "");

  /* ③ ㉯/③ — **어느 손잡이가 받았는지** 말하는가. «한 손잡이만 열면 다른 손잡이가 말없이 받는다»가 함정의 본체였다. */
  rec("③ 로그가 손잡이 이름을 댄다(VIDEO_PROVIDER_STUB)", /VIDEO_PROVIDER_STUB=1/.test(a1.log), "");

  /* ④ 손잡이가 갈린다 — 대본 전용으로 켠 경우 이름이 바뀐다. */
  const a4 = await withEnv({ VIDEO_PROVIDER_STUB: undefined, VIDEO_SCRIPT_STUB: "1" },
    () => capture(() => buildVideoScript(scriptInput())));
  rec("④ VIDEO_SCRIPT_STUB=1 이면 그 이름으로 찍는다", /VIDEO_SCRIPT_STUB=1/.test(a4.log), "");

  /* ⑤ 🔴 무회귀 — 새 손잡이를 **안 주면** 종전대로 따라간다. 이게 깨지면 옛 자들이 전부 돈을 쓰기 시작한다. */
  const a5 = await withEnv({ VIDEO_PROVIDER_STUB: "1", VIDEO_SCRIPT_STUB: undefined }, async () => ({ s: videoScriptStub(), p: videoStub() }));
  rec("⑤ 🔴 무회귀 — 안 주면 VIDEO_PROVIDER_STUB 을 따라간다(옛 자들 돈 0)", a5.s === true && a5.p === true, `script=${a5.s} provider=${a5.p}`);

  /* ⑥ 🔴 AC-111 ④ 가 «없다»고 한 손잡이 — «대본만 진짜로». 키를 비워 두고 재서 **실호출 0**. */
  const a6 = await withEnv({ VIDEO_PROVIDER_STUB: "1", VIDEO_SCRIPT_STUB: "0", AI_STUB: "0", GEMINI_API_KEY: "", GEMINI_API_KEYS: "" },
    () => capture(() => buildVideoScript(scriptInput())));
  const stubbed6 = /\[video-stub\]\s*video_script/.test(a6.log) || (a6.out as { model?: string }).model === "stub";
  rec("⑥ 🔴 VIDEO_SCRIPT_STUB=0 이면 대본이 스텁을 **안 탄다**(실호출 자리까지 닿는다)", !stubbed6,
    stubbed6 ? "아직 스텁이 받아 버린다" : `실호출 자리까지 감 → ${(a6.out as { ok: boolean; reason?: string }).ok ? "ok" : `막힘(${String((a6.out as { reason?: string }).reason).slice(0, 60)})`}`);

  /* ⑦ 🔴 «대본만 열었는데 Veo 까지 열렸다»가 아니어야 한다 — 2026-09-15 $3.63 사고의 그 문. */
  const a7 = await withEnv({ VIDEO_PROVIDER_STUB: "1", VIDEO_SCRIPT_STUB: "0" }, async () => videoStub());
  rec("⑦ 🔴 그때도 provider 는 꺼진 채다(Veo 문이 같이 열리지 않는다)", a7 === true, `videoStub()=${a7}`);

  /* ⑧ 팩트체크도 같은 손잡이를 따라가고 **찍는다** — status:"skipped" 는 «주장이 없었다»와 «스텁이었다»를 뭉갠다. */
  const base = { lines: [{ idx: 0, text: "2024년에 30% 올랐습니다.", role: "body", seconds: 3, cutIdx: 0 }], hook: "h", closing: "c",
    youtube: { title: "t", description: "d", tags: [] }, factcheck: { status: "pending", claims: [] } } as never;
  const a8 = await withEnv({ VIDEO_PROVIDER_STUB: "1", VIDEO_SCRIPT_STUB: undefined },
    () => capture(() => factcheckRoundTrip(1, 1, base)));
  rec("⑧ 팩트체크 스텁도 찍는다(«skipped» 의 두 뜻을 가른다)", /\[video-stub\]\s*video_factcheck/.test(a8.log), "");

  /* ⑨ 나머지 스텁 경로에도 «찍는 입»이 달렸나 — 🔴 **배선 검사다(실행 아님)**.
     providers·tts 는 R2 가 있어야 돌아서 여기서 실행으로 못 잰다. 그러니 «쟀다»고 말하지 않는다(AC-9). */
  const wired = ["lib/video/providers/index.ts", "lib/video/tts.ts", "lib/video/tts-typecast.ts", "lib/video/judge.ts", "lib/video/reference.ts"]
    .filter((f) => readFileSync(f, "utf8").includes("noteVideoStub("));
  rec("⑨ 다른 스텁 경로 5곳에도 찍는 입이 달렸다(⚠️ 배선 검사 · 실행 아님)", wired.length === 5, `${wired.length}/5`);
}

/* ── 🔴 스스로 변이(AC-108) — 안 울면 이 자는 값이 0 이다 ── */
const MUTANTS = [
  { what: "㉮ 를 도로 없앤다 — 대본 스텁이 말없이 지나간다(AC-111 그 자체)",
    file: "lib/video/script.ts",
    from: '    noteVideoStub("video_script"', to: '    void 0 && noteVideoStub("video_script"', expect: "① 대본 스텁이 찍는다" },
  { what: "㉯ 를 도로 없앤다 — 새 손잡이가 provider 손잡이를 못 이긴다",
    file: "lib/video/types.ts",
    from: '  if (raw === "0") return false;\n  return videoStub();', to: '  return videoStub();', expect: "⑥" },
  { what: "㉰ 를 없앤다 — «무엇을 못 재는지»를 안 적는다",
    file: "lib/video/script.ts",
    from: '"대본 내용·훅·제목·태그·문장 수 — 그리고 계정 간 대본 유사도(스텁은 같은 템플릿이라 늘 1 이다)"', to: '""', expect: "②" },
];

async function mutate(): Promise<void> {
  console.log("\n🔴 변이 — 일부러 망가뜨려 본다(안 울면 이 자는 값이 0 이다)\n");
  for (const m of MUTANTS) {
    const orig = readFileSync(m.file, "utf8");
    if (!orig.includes(m.from)) { console.log(`  ⊘ «${m.what}» — 심을 자리를 못 찾았다(자가 낡았다)`); bad++; continue; }
    try {
      writeFileSync(m.file, orig.replace(m.from, m.to));
      let caught = false, out = "";
      try { execFileSync("npx", ["--yes", "tsx", "scripts/verify-ac111-stub-voice.mts"], { encoding: "utf8", stdio: "pipe", shell: true }); }
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

console.log("■ AC-111 — «돈 아끼는 손잡이»가 싼 축까지 조용히 끄나\n");
await run();
if (MUTATE) await mutate();
console.log(`\n${bad ? `🔴 실패 ${bad}` : `✅ 잰 ${measured}축 전부 통과`}`);
process.exit(bad ? 1 : 0);
