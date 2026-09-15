/**
 * scripts/verify-ai-key.mts — **AI 키 로테이션**이 실제로 도나(DESIGN §3.3 · 메인 발주 2026-09-15).
 *   실행: `npx --yes tsx scripts/verify-ai-key.mts`   · DB·네트워크·**실호출 0**(돈 0원 · 429 경로는 가짜 사유로 잰다).
 *
 *   ══ 이 하니스가 지키는 것 셋 ══
 *     ① 🔴 **키가 1개면 오늘과 한 글자도 다르지 않다** — 이게 첫 번째 요구사항이었다.
 *        «틀만 만들고 실제로는 안 도는 것»을 막는 반대쪽 짝이기도 하다: 퇴화형이 진짜로 퇴화하는지 잰다.
 *     ② 🔴 **고르는 자리가 하나** — 키를 쓰는 **일곱 파일**이 env 를 직접 읽지 않는지 소스로 확인한다.
 *        🔴 발주서는 «키를 읽는 자리가 셋»이라고 했지만 세 보니 **여덟**이었다(영상 3 · TTS · models.list · registry 가 더 있었다).
 *        빠뜨렸으면 `GEMINI_API_KEYS` 만 꽂는 순간 **영상·TTS 만 조용히 «키 없음»으로** 죽었을 것이다.
 *     ③ 🔴 **막지 않는다** — 전부 쉬는 중이어도 키를 준다. 우리 안전장치가 고객 공장을 세우면 그건 고장이다(CLAUDE §9).
 *
 *   🔴 한계(정직): 제공사에 **실제로 429 를 맞아 본 적은 없다**. 사유 문자열로 재는 것까지다 —
 *      실물 429 본문이 우리 정규식과 다르면 못 잡는다. 키가 여러 개 꽂히는 날 첫 429 로그로 확인해야 한다(AC-9).
 */
import {
  aiKeysConfigured, aiKeyCount, leaseAiKey, reportAiKeyOutcome, isRateLimitReason,
  redactKeys, aiKeyStats, KEY_COOLDOWN_MS, _resetAiKeysForTest,
} from "../lib/ai-key";
import { readFileSync } from "node:fs";

const results: { step: string; ok: boolean; note: string }[] = [];
const rec = (step: string, ok: boolean, note = "") => { results.push({ step, ok: !!ok, note }); };

const setKeys = (one?: string, many?: string) => {
  delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEYS;
  if (one) process.env.GEMINI_API_KEY = one;
  if (many) process.env.GEMINI_API_KEYS = many;
  _resetAiKeysForTest();
};

/* ═══ ① 키가 없을 때 — 지금과 똑같이 «키 없음» ═══════════════════════════ */
{
  setKeys();
  rec("① 키가 없으면 없다고 말한다(호출부의 no_api_key 가 그대로 산다)",
    !aiKeysConfigured() && aiKeyCount() === 0 && leaseAiKey() === null, `configured=${aiKeysConfigured()} · lease=${String(leaseAiKey())}`);
}

/* ═══ ② 🔴 키 1개 = 오늘 그대로(퇴화형) ═══════════════════════════════════ */
{
  setKeys("AAAAAAAAAAAAAAAA1111");
  const got = [leaseAiKey(), leaseAiKey(), leaseAiKey()];
  rec("② 🔴 키 1개면 늘 그 키다(라운드로빈이 동작을 바꾸지 않는다)",
    got.every((g) => g?.key === "AAAAAAAAAAAAAAAA1111" && g?.label === "key#1"),
    got.map((g) => g?.label).join(" · "));

  /* 🔴 **여기가 핵심**: 1개뿐인 키가 429 를 맞아도 «전부 쉬는 중»이라 **그냥 그 키를 준다**. 안 그러면 공장이 선다. */
  const l = leaseAiKey();
  reportAiKeyOutcome(l, "rate_limited");
  const after = leaseAiKey();
  rec("② 🔴 하나뿐인 키가 429 를 맞아도 **그 키를 그대로 준다**(기다리지 않는다 · §9)",
    after?.key === "AAAAAAAAAAAAAAAA1111", `쉼 표시 = ${aiKeyStats()[0]?.resting} · 그래도 빌려준 키 = ${after?.label}`);
  rec("② 그래도 «쉬었다»는 숫자로 남는다(운영이 본다)", aiKeyStats()[0]?.rested === 1, JSON.stringify(aiKeyStats()[0]));
}

/* ═══ ③ 여러 개 — 라운드로빈 · 429 는 건너뛴다 ═══════════════════════════ */
{
  setKeys(undefined, "AAAA1111AAAA1111, BBBB2222BBBB2222 ,CCCC3333CCCC3333");
  rec("③ 쉼표로 세 개를 읽고 앞뒤 공백을 턴다", aiKeyCount() === 3, `${aiKeyCount()}개`);
  const order = [leaseAiKey(), leaseAiKey(), leaseAiKey(), leaseAiKey()].map((l) => l?.label);
  rec("③ 라운드로빈으로 돈다", order.join(",") === "key#1,key#2,key#3,key#1", order.join(" · "));

  /* key#2 가 429 — 다음 한 바퀴에서 **건너뛰어야** 한다. */
  _resetAiKeysForTest(); setKeys(undefined, "AAAA1111AAAA1111,BBBB2222BBBB2222,CCCC3333CCCC3333");
  leaseAiKey();                       // key#1
  const second = leaseAiKey();        // key#2
  reportAiKeyOutcome(second, "rate_limited");
  const next3 = [leaseAiKey(), leaseAiKey(), leaseAiKey()].map((l) => l?.label);
  rec("③ 🔴 429 맞은 키는 **건너뛴다**(이 기능의 값 전부)", !next3.includes("key#2"), `그다음 셋 = ${next3.join(" · ")}`);
  rec("③ 쉬는 시간이 숫자로 보인다(운영)", (aiKeyStats()[1]?.restsUntilSec ?? 0) > 0 && (aiKeyStats()[1]?.restsUntilSec ?? 0) <= KEY_COOLDOWN_MS / 1000,
    `key#2 ${aiKeyStats()[1]?.restsUntilSec}초 남음`);

  /* 성공하면 쉼이 풀린다 — 된다는 걸 방금 봤으니까. */
  const again = leaseAiKey();
  reportAiKeyOutcome(again, "ok");
  rec("③ 성공하면 그 키의 쉼이 풀린다", aiKeyStats().find((x) => x.label === again?.label)?.resting === false,
    `${again?.label} resting=${aiKeyStats().find((x) => x.label === again?.label)?.resting}`);
}

/* ═══ ④ 🔴 음성 대조 — 무엇으로 쉬게 하고 무엇으로는 안 하나 ═══════════════ */
{
  const yes = ["gemini_error_429: {...}", "RESOURCE_EXHAUSTED", "Quota exceeded for quota metric", "rate limit exceeded", "rate_limit"];
  const no = ["gemini_error_503: overloaded", "The model is overloaded. UNAVAILABLE", "timeout_60000ms", "json_parse_failed", "fetch_failed: ECONNRESET", "gemini_error_500", "4290000 tokens"];
  rec("④ 429·할당량 사유는 «키를 쉬게»로 읽는다", yes.every(isRateLimitReason), yes.filter((x) => !isRateLimitReason(x)).join(" · ") || `${yes.length}종 전부`);
  /* 🔴 503·타임아웃으로 키를 쉬게 하면 **제공사가 잠깐 흔들릴 때 멀쩡한 키가 전부 쉰다** — 여기가 새면 기능이 해가 된다. */
  const leaked = no.filter(isRateLimitReason);
  rec("④ 🔴 음성 대조 — 503·과부하·타임아웃·파싱실패는 키 탓이 **아니다**", leaked.length === 0,
    leaked.length ? `🔴 샜다: ${leaked.join(" · ")}` : `${no.length}종 전부 안 걸림(«4290000 tokens» 처럼 429 가 박힌 숫자도 포함)`);
}

/* ═══ ⑤ 🔴 키 값이 어디에도 안 남나 ═══════════════════════════════════════ */
{
  setKeys(undefined, "SECRETKEYAAAA1111,SECRETKEYBBBB2222");
  const stats = JSON.stringify(aiKeyStats());
  rec("⑤ 🔴 운영 숫자에 키 값이 없다(순번만)", !stats.includes("SECRETKEY") && stats.includes("key#1"), stats.slice(0, 90));

  const dirty = 'gemini_error_429: {"error":{"message":"quota","url":"https://x/v1beta/models/m:generateContent?key=SECRETKEYAAAA1111"}}';
  const clean = redactKeys(dirty);
  rec("⑤ 🔴 오류 본문이 되비친 키를 걷어 낸다(`?key=` 도, 키 문자열 자체도)",
    !clean.includes("SECRETKEYAAAA1111") && clean.includes("***"), clean.slice(0, 96));
  rec("⑤ 🔴 음성 대조 — 걷어 내고도 **사유는 읽을 수 있다**(429 가 남는다 · 안 남으면 원인을 못 찾는다)",
    isRateLimitReason(clean), clean.slice(0, 60));

  const lease = leaseAiKey();
  rec("⑤ 임대 이름표에 키가 안 들어 있다", lease?.label === "key#1" && !String(lease?.label).includes("SECRET"), String(lease?.label));
}

/* ═══ ⑥ 같은 키를 두 번 적으면 ═══════════════════════════════════════════ */
{
  setKeys(undefined, "SAME1111SAME1111,SAME1111SAME1111,OTHER222OTHER222");
  rec("⑥ 🔴 같은 키를 두 번 적으면 하나로 본다(안 그러면 쉬게 한 키를 바로 또 고른다)", aiKeyCount() === 2, `${aiKeyCount()}개`);
}

/* ═══ ⑦ 🔴 제품이 **이 자리를 통해서만** 키를 얻나(AC-69 죽은 통로) ═══════ */
{
  const src = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
  const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  /* 🔴 **여덟 곳이다**(발주서는 셋이라고 했지만 실제로 세 보니 여덟이었다).
     빠뜨린 자리는 `GEMINI_API_KEYS` 만 꽂는 순간 **그 기능만 조용히 «키 없음»으로** 죽는다 —
     영상·TTS·심사가 한꺼번에 그렇게 될 뻔했다. 목록을 여기 박아 다음에 또 새면 빨개지게 한다. */
  const USERS = ["lib/ai.ts", "lib/ai-image.ts", "lib/video/judge.ts", "lib/video/tts.ts",
    "lib/video/providers/index.ts", "lib/video/providers/registry.ts", "lib/cron/ai-model-watch.ts"];
  for (const f of USERS) {
    const c = code(src(f));
    const direct = /process\.env\.GEMINI_API_KEY/.test(c);
    rec(`⑦ 🔴 ${f} 가 env 를 직접 안 읽는다`, !direct,
      direct ? "🔴 아직 직접 읽는다 — GEMINI_API_KEYS 집에서 이 기능만 죽는다" : "고르는 자리를 통한다");
  }
  /* 🔴 **빌렸으면 돌려준다** — 실제로 제공사를 부르는 자리만. 안 부르면 쉬는 키가 영영 안 생긴다. */
  for (const f of ["lib/ai.ts", "lib/ai-image.ts", "lib/video/judge.ts", "lib/video/tts.ts", "lib/video/providers/index.ts", "lib/cron/ai-model-watch.ts"]) {
    const c = code(src(f));
    const lease = /\bleaseAiKey\s*\(/.test(c), report = /\breportAiKeyOutcome\s*\(/.test(c);
    rec(`⑦ ${f} 가 leaseAiKey·reportAiKeyOutcome 을 둘 다 부른다`, lease && report, `lease=${lease} · report=${report}`);
  }
  /* 🔴 «키가 있나»를 묻는 자리도 한 곳이어야 한다 — 영상 사다리가 옛 env 만 보면 통째로 «없음»이 된다. */
  rec("⑦ 🔴 geminiAvailable() 이 GEMINI_API_KEYS 도 키로 본다",
    /aiKeysConfigured\(\)/.test(code(src("lib/video/providers/registry.ts"))), "lib/video/providers/registry.ts");

  /* `ai-verify.ts` 는 **import 0** 을 지켜야 한다(standalone .mjs 가 타입 스트립으로 로드한다) — 키는 호출부가 넘긴다. */
  const v = src("lib/ai-verify.ts");
  rec("⑦ 🔴 lib/ai-verify.ts 는 여전히 import 가 0 이다(standalone 로드가 깨지지 않게)",
    !/^\s*import\s/m.test(v), /^\s*import\s/m.test(v) ? "🔴 import 가 생겼다 — verify-ai-models.mjs 가 깨진다" : "import 0 유지");
}

const w = (x: unknown, n: number) => String(x ?? "").slice(0, n).padEnd(n);
console.log(`\nAI 키 로테이션 하니스(DB·네트워크·실호출 0 · 돈 0원) · ${new Date().toISOString()}\n${"─".repeat(150)}`);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${w(r.step, 60)} ${w(r.note, 86)}`);
const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
console.log(`${"─".repeat(150)}\nPASS ${pass} · FAIL ${fail}`);
console.log("🔴 한계: 제공사에 **실제로 429 를 맞아 본 적은 없다** — 사유 문자열로 재는 것까지다. 키가 여러 개 꽂히는 날 첫 429 로그로 확인해야 한다.");
process.exit(fail ? 1 : 0);
