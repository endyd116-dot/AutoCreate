/**
 * scripts/verify-ai-usage-leaks.mjs — 🔴 **돈이 나가는 길에 «기록 없는 return» 이 있나**(B 2026-09-21 · 메인 지시)
 *
 *   ══ 왜 이 자인가 ══
 *   `recordAiUsage` 가 **성공 경로에만** 있었다. 실패하면 그냥 `return`/`continue` 라 `ai_usage` 에 **한 줄도 안 남았다.**
 *   그래서 ① «몇 번 헛돌았나»를 셀 수 없었고 ② `checkAiCostCap`(= `SUM(cost_usd)`)이 그만큼을 **못 봤다.**
 *
 *   🔴 **제일 나쁜 두 자리**: 제공사가 **영상을 다 만들어 준 뒤** 우리가 못 받아 오거나(다운로드) 못 넣은(R2) 경우.
 *      그건 «제공사 실패»가 아니라 **우리 쪽 사고**라 **확실히 청구된다.** 그게 통째로 안 보였다.
 *
 *   🔴 그리고 이건 **영상만의 문제가 아니었다**(메인이 짚었다 — 재 보니 맞았다):
 *      · 글(`lib/ai.ts`)   — **이미 막혀 있었다**(`${purpose}:fail` · 이 규약을 그대로 따랐다)
 *      · 이미지(`lib/ai-image.ts`) — 🔴 **샜다.** 체인을 돌며 모델마다 실패해도 한 줄도 안 남았다
 *      · TTS(`lib/video/tts-typecast.ts`) — 🔴 **샜다.** 합성 끝나고 다운로드만 실패한 자리까지
 *
 *   ══ 재는 것 ══
 *     ① 자리    — 여섯 자리가 **실제로 기록하나**(사유를 갈라서)
 *     ② 「모름」 — 🔴 **청구 여부·금액을 모르면 0 이 아니라 NULL** 이다(AC-9). 아는 자리만 숫자를 적나
 *     ③ 관문    — 🔴 **합을 안 건드리나**(메인 지시 «새 자리는 세기만») — 새 행은 `costUsd: 0` · 관문은 `cost_usd` 만 본다
 *     ④ 칸      — DDL 과 `schema.ts` 가 같은 칸을 말하나
 *     ⑤ 🔴 훑기 — **그 밖에 «기록 없이 빠져나가는 실패»가 또 있나**(돈 쓰는 파일 전수 · 새로 생기면 여기서 잡힌다)
 *
 *   🔴 부정형 단언을 안 쓴다 — ②는 «그 자리에 `costUsdMaybe` 가 **없다**»를 재야 해서 부정형이 된다.
 *      그래서 **과녁을 제품 밖에 두지 않고** 「그 호출 덩이 안에 `failKind: "provider_failed"` 가 **있다**」를 먼저 확인한 뒤
 *      그 덩이 안에서만 금액 유무를 본다 — 과녁이 사라지면 ①축이 먼저 운다.
 *
 *   `--mutants` = 제품 사본에 변이를 넣고 이 자를 다시 돌려 **내가 정말 무는지** 본다.
 *   종료코드: 0 = 안 샌다 · 1 = 새는 곳이 있다 · 2 = 못 쟀다.
 */
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.cwd();
const rawRead = (f) => { const p = path.join(ROOT, f); return existsSync(p) ? readFileSync(p, "utf8") : null; };
/* 🔴 주석을 걷고 본다 — AC-191(내가 쓴 제품 주석이 과녁에 걸려 거짓 초록을 만든다). */
const read = (f) => { const t = rawRead(f); return t === null ? null : codeOnly(t); };
const VID = "lib/video/providers/index.ts", IMG = "lib/ai-image.ts", TTS = "lib/video/tts-typecast.ts";
const AI = "lib/ai.ts", CAP = "lib/billing/ai-cost-cap.ts", SCH = "db/schema.ts", DDL = "drizzle/0084-ai-usage-fail.sql";
const FILES = [VID, IMG, TTS, AI, CAP, SCH, DDL];

const fails = [], notes = [];
const ok  = (ax, m) => notes.push(`  ✓ ${ax} ${m}`);
const bad = (ax, m) => { notes.push(`  ✗ ${ax} ${m}`); fails.push(`${ax} ${m}`); };
const warn = (ax, m) => notes.push(`  △ ${ax} ${m}`);
const unk = (ax, m) => { notes.push(`  ⊘ ${ax} 못 쟀음 — ${m}`); fails.push(`${ax} 못 쟀음`); };

const T = {}; for (const f of FILES) T[f] = read(f);
const gone = FILES.filter((f) => T[f] === null);
if (gone.length) { console.error(`⊘ 못 쟀어요 — ${gone.join(", ")} 가 없다.`); process.exit(2); }

/* ───────── ① 자리 — 여섯 자리가 실제로 기록하나 ───────── */
notes.push("■ ① 자리 — 돈이 나간 뒤 빠져나가는 길이 **사유를 갈라** 기록하나");
const SITES = [
  ["영상: 제공사 실패 → 폴백",   VID, /failKind: "provider_failed"/],
  ["🔴 영상: 다 만들어졌는데 못 받음", VID, /failKind: "download_failed"/],
  ["🔴 영상: 다 받고 저장 실패", VID, /failKind: "store_failed"/],
  /* 🔴 과녁이 `purpose: "image:fail"` 이었는데, 저장 실패까지 같은 `purpose` 로 적으면서 **둘이 됐다** —
     체인 실패 기록을 통째로 떼도 이 축이 안 울었다(변이가 조용히 죽었다). ⇒ **그 갈래만의 글자**로 겨눈다. */
  ["이미지: 모델 호출 실패",     IMG, /purpose: "image:fail", model, inTokens: 0, outTokens: 0, costUsd: 0, failKind: kind/],
  ["TTS: 합성 요청 거절",        TTS, /failKind: "http"/],
  ["🔴 TTS: 합성 끝나고 못 받음", TTS, /failKind: "download_failed"/],
  /* 🔴 2026-09-22(AC-192) — ⑤축의 모수를 좁히자 드러난 **세 자리**. 셋 다 합성이 **200 으로 끝난 뒤**라 돈은 나갔다. */
  ["🔴 TTS: 합성됐는데 오디오가 어디 있는지 없다", TTS, /failKind: "no_audio"/],
  ["🔴 TTS: 받아 온 오디오가 비었다",             TTS, /failKind: "empty_audio"/],
  ["🔴 TTS: 다 받고 저장 실패(영상엔 있는데 없던 갈래)", TTS, /failKind: "store_failed"/],
  ["🔴 TTS: 예외 — 금액은 모르지만 **행은 남긴다**",     TTS, /failKind: "exception"/],
  ["🔴 이미지: 다 만들고 저장 실패(사유를 가른다)",      IMG, /failKind: "store_failed"/],
  ["글은 원래 막혀 있었다(규약 출처)", AI, /purpose: okEff \? a\.purpose : `\$\{a\.purpose\}:fail`/],
];
for (const [name, f, re] of SITES) (re.test(T[f]) ? ok : bad)("①", name);

/* ───────── ② 「모름」을 0으로 적지 않나 ─────────
   🔴 과녁을 «없음»에 두지 않으려고, **그 호출 덩이를 먼저 찾고**(있어야 한다) 그 안에서만 금액 유무를 본다. */
notes.push("■ ② 「모름」 — 🔴 청구 여부·금액을 모르면 **0 이 아니라 NULL**(AC-9)");
/* 🔴 **여기 있던 `[,s}]` 는 깨진 글자였다**(AC-192 · 2026-09-22 · C 가 찾고 메인이 확인했다).
   원래 뜻은 `[,\s}]`(쉼표·공백·닫는 중괄호)인데 `\s` 의 백슬래시가 **한 겹 먹혀** 낱글자 `s` 가 됐다(AC-100).
   그래서 `costUsd: 0,` 은 **쉼표로 우연히** 맞았고, 누가 `costUsd: 0` 뒤에 공백이나 줄바꿈을 두면
   «0 이 아닌 값을 넣는다»로 **잘못 읽어 맞는 제품을 빨갛게** 만든다.
   🔴 고치면서 **문자 클래스를 아예 없앴다** — 깨질 글자가 없어야 다시 안 깨진다.
      «0 다음에 숫자도 소수점도 오지 않는다» = 그 값이 정말 0 이다. */
const ZERO_COST = /costUsd: 0(?![.\d])/;
/* 🔴 **줄임 표기(`costUsd,`)를 못 보고 있었다**(2026-09-22 · TTS 를 고치자 축 넷이 거짓 빨강을 냈다).
   제품은 `costUsd: 0`(대놓고 0)과 `costUsd,`(변수를 그대로 넘김)를 둘 다 쓴다. 뒤엣것은 **그 변수가 0 인지**를 봐야 한다
   ⇒ 파일에서 `const costUsd = …` 를 찾아 **그 식이 0 인가**로 판정한다. 못 찾으면 «모른다»로 두고 통과시키지 않는다. */
const HAS_COST = /costUsd\s*[:,}]/;
const SHORTHAND = /costUsd\s*[,}]/;
function costIsZero(blk, fileText) {
  if (ZERO_COST.test(blk)) return true;                     // `costUsd: 0`
  if (/costUsd:/.test(blk)) return false;                   // `costUsd: <0 이 아닌 식>`
  if (!SHORTHAND.test(blk)) return null;                    // 칸 자체가 없다
  const m = /const costUsd = ([^;\n]+);/.exec(fileText);    // 줄임 표기 — 변수를 따라간다
  if (!m) return null;                                      // 🔴 못 쟀다 — 통과로 쓰지 않는다
  return /^0(?![.\d])/.test(m[1].trim());
}
const ZEROLESS = (x, fileText) => HAS_COST.test(x) && costIsZero(x, fileText) === false;   // 🔴 «0 이 아닌 값을 넣나»
function callBlock(text, needle) {
  const i = text.indexOf(needle);
  if (i < 0) return null;
  const s = text.lastIndexOf("recordAiUsage({", i);
  if (s < 0) return null;
  const e = text.indexOf("});", i);
  return e < 0 ? null : text.slice(s, e);
}
/* 🔴 **계약이 2026-09-21 사장님 결재로 바뀌었다** — 이 축도 같이 바뀐다.
   · 전(메인 «세기만»)  : 아는 금액 → `costUsdMaybe` · `costUsd` 는 늘 0
   · ✅ 후(사장님 «실패도 글처럼») : **아는 금액 → `costUsd`**(상한을 먹는다) · **모르는 것은 그대로 안 넣는다**
   🔴 자가 옛 계약을 재고 있으면 **맞는 제품이 빨갛게** 나온다 — 실제로 이 판에서 그랬다(축 셋). 계약이 바뀌면 자를 같이 옮긴다. */
const MONEY = [
  ["영상 provider_failed — 금액 모름",  VID, 'failKind: "provider_failed"', false],
  ["영상 download_failed — 금액 안다",  VID, 'failKind: "download_failed"', true],
  ["영상 store_failed — 금액 안다",     VID, 'failKind: "store_failed"',    true],
  ["TTS download_failed — 금액 안다",   TTS, 'failKind: "download_failed"', true],
  ["TTS http — 금액 모름",              TTS, 'failKind: "http"',            false],
  ["🔴 TTS no_audio — 금액 안다",       TTS, 'failKind: "no_audio"',        true],
  ["🔴 TTS empty_audio — 금액 안다",    TTS, 'failKind: "empty_audio"',     true],
  ["🔴 TTS store_failed — 금액 안다",   TTS, 'failKind: "store_failed"',    true],
  ["🔴 TTS exception — 어디서 터졌는지 모른다", TTS, 'failKind: "exception"', false],
  /* 🔴 이미지 `store_failed` 만 «아는데 0» 이다 — **바로 앞 성공 줄이 실제 금액을 이미 먹였다.**
     여기 또 적으면 **상한이 두 번 먹는다.** 그래서 이 줄은 «금액»이 아니라 **«사유»를 남기는 줄**이고, 0 이 맞다. */
  ["이미지 store_failed — 금액은 성공 줄이 이미 먹였다(여기선 0)", IMG, 'failKind: "store_failed"', false],
];
for (const [name, f, needle, knowsAmount] of MONEY) {
  const blk = callBlock(T[f], needle);
  if (!blk) { bad("②", `${name} — 그 기록 자체를 못 찾았다(①축이 먼저 운다)`); continue; }
  const paysIntoCap = ZEROLESS(blk, T[f]);    // `costUsd: billed` 처럼 0 이 아닌 값을 넣나
  const z = costIsZero(blk, T[f]);
  if (z === null) { unk("②", `${name} — 금액 칸을 읽을 수 없다(줄임 표기인데 \`const costUsd\` 를 못 찾았다)`); continue; }
  const zeroed = z;
  if (knowsAmount && paysIntoCap) ok("②", `${name} — \`cost_usd\` 에 넣어 **상한을 먹인다**(글과 같은 취급)`);
  else if (!knowsAmount && zeroed && !/costUsdMaybe:/.test(blk)) ok("②", `${name} — 상한에 안 넣고 금액도 NULL(못 쟀음)`);
  else if (knowsAmount) bad("②", `${name} — 아는 금액인데 \`cost_usd\` 에 안 넣는다(상한이 못 먹는다)`);
  else bad("②", `${name} — 🔴 **모르는데 금액이 새어 들어간다**(0/지어낸 수) — 오늘 막은 것이 도로아미타불이다`);
}
(/costUsdMaybe === undefined \|\| row\.costUsdMaybe === null/.test(T[AI]) ? ok : bad)("②", "🔴 기록 함수가 `?? 0` 으로 접지 않는다(모름 → NULL)");

/* ───────── ③ 관문 — 합을 안 건드리나 ───────── */
notes.push("■ ③ 관문 — 🔴 **아는 것만 먹인다 · 모르는 금액이 새어 들어가지 않나**(사장님 결재 2026-09-21)");
(/COALESCE\(SUM\(cost_usd\), 0\)/.test(T[CAP]) ? ok : bad)("③", "관문은 `cost_usd` 만 합한다(= `cost_usd_maybe` 를 안 읽는다)");
(/fail_kind IS NOT NULL/.test(T[CAP]) ? ok : bad)("③", "🔴 막힐 때 **실패분이 얼마인지 말해 준다**(있을 때만 · 없으면 문장 무회귀)");
{
  /* 🔴 **이번 결재가 연 문** — 이제 `costUsd` 에 값이 들어갈 수 있다. 그래서 «**모르는 금액이 그 문으로 새어 들어가지 않나**»를
     따로 잰다(메인이 이번에 콕 집어 물은 축). 아는 둘(`download_failed`·`store_failed`)만 값을 넣어야 한다. */
  /* 🔴 «아는 금액» 갈래 — 셋이 늘었다(2026-09-22): `no_audio`·`empty_audio` 는 합성이 끝난 뒤라 **확실히 청구**되고,
     TTS `store_failed` 는 영상의 같은 이름과 같은 자리다. `exception` 은 **모르는 쪽**이라 여기 없다. */
  const KNOWN = /download_failed|store_failed|no_audio|empty_audio/;
  const blocks = [VID, IMG, TTS].flatMap((f) => [...T[f].matchAll(/recordAiUsage\(\{[\s\S]*?\}\)/g)].map((m) => [m[0], T[f]]));
  const failBlocks = blocks.filter(([b]) => /failKind:/.test(b));
  const leaked = failBlocks.filter(([b, ft]) => !KNOWN.test(b) && ZEROLESS(b, ft));
  const pays = failBlocks.filter(([b, ft]) => KNOWN.test(b) && ZEROLESS(b, ft));
  if (!failBlocks.length) bad("③", "실패 기록을 하나도 못 찾았다");
  else if (leaked.length) bad("③", `🔴 **모르는 금액 ${leaked.length}건이 \`cost_usd\` 로 샌다** — 상한이 지어낸 수를 먹는다`);
  else ok("③", `실패 기록 ${failBlocks.length}건 중 **아는 ${pays.length}건만** 상한을 먹는다(모르는 것은 0 · 새는 것 0)`);
}

/* ───────── ④ 칸 — DDL 과 schema.ts 가 같은 말을 하나 ───────── */
notes.push("■ ④ 칸 — DDL 과 `schema.ts` 가 같은 칸을 말하나(CLAUDE §4.4 «DDL 적용과 동시에»)");
for (const col of ["fail_kind", "cost_usd_maybe"]) {
  const inDdl = new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`).test(T[DDL]);
  const inSch = new RegExp(`"${col}"`).test(T[SCH]);
  (inDdl && inSch ? ok : bad)("④", `${col} — DDL ${inDdl ? "있다" : "없다"} · schema.ts ${inSch ? "있다" : "없다"}`);
}

/* ───────── ⑤ 🔴 훑기 — 그 밖에 «기록 없이 빠져나가는 실패» ─────────
   돈 쓰는 파일에서 `return { ok: false` 를 다 찾아, **바로 앞에서** `recordAiUsage` 를 했나 본다.
   🔴 **돈을 안 쓴 실패는 세면 안 된다** — 키가 없거나 저장소 미설정이면 **호출 자체를 안 했다**. 아래 목록이 그 예외다.
      예외는 «사유 글자»로 적는다(줄 번호로 적으면 줄이 밀릴 때마다 거짓이 된다).

   🔴 **2026-09-22(AC-192) — 이 축이 «앞 12줄»로 재고 있었고, 그게 10곳을 조용히 삼켰다.**
   메인이 `generateStill` 의 실패 return 을 가리키며 «네 자에 빨강으로도 ALLOW 로도 안 나온다»고 했다. 재 보니 그 자리는
   **앞 12줄 안에 `recordAiUsage` 가 있긴 했다 — 딴 갈래(스텁)의 것이었다.** 근접은 같은 갈래라는 뜻이 아니다.
   ⇒ **모수에서 빠진 것이 모두 몇이고 왜인지를 찍는다**(AC-141 ② «모수 0 을 통과로 쓰지 마라»).
      실제로 그렇게 찍어 보니 `return { ok: false` **28곳 중 검사한 것은 9곳**이었다 — **19곳이 말없이 빠져 있었다.**
   ⇒ 면제는 **바로 앞 4줄 안 · 사이에 다른 `return`/`else`/`if (` 가 없을 때만**(= 같은 갈래의 끝). 나머지는 전부 모수에 넣고
      ALLOW 에 **까닭을 글로** 적게 한다. 좁히자마자 **진짜 구멍 셋**이 나왔다(TTS `no_audio`·`empty_audio`·`exception`). */
notes.push("■ ⑤ 🔴 훑기 — 그 밖에 «기록 없이 빠져나가는 실패» 가 또 있나");
/* 🔴 **이미 까닭을 확인한 자리**는 여기 적는다 — 안 적으면 이 축이 늘 9곳을 물고, 늘 빨간 자는 아무도 안 본다(AC-95).
   🔴 **줄 번호로 적지 않는다**(줄이 밀리면 거짓이 된다) — «어느 파일의 어떤 글자»로 적는다.
   새 자리가 생기면 여기 없으므로 **빨개진다.** 그게 이 축의 값이다. */
const ALLOW = [
  [VID, "fal_failed",       "`callProvider` 안쪽이다 — **부르는 쪽**(`generateClip`)이 `!r.ok` 로 받아 `provider_failed` 로 적는다"],
  [VID, "omni_failed",      "같은 자리(`callProvider` 안쪽) — 부르는 쪽이 `provider_failed` 로 적는다"],
  [VID, "veo_failed",       "같은 자리(`callProvider` 안쪽) — 부르는 쪽이 `provider_failed` 로 적는다"],
  [VID, 'r2Put(key, buf,',  "스텁 갈래(`videoStub()`)의 자리 채움 바이트 — provider 호출 0 · 돈 0"],
  [VID, 'r2Put(key, png,',  "정지 컷 **스텁** 갈래(1×1 PNG) — 돈 0"],
  /* 🔴 2026-09-22 새로 모수에 들어온 자리들 — 여태 «앞 12줄에 기록이 있다»로 말없이 빠져 있었다. */
  [VID, "정지 컷",           "🔴 여태 **자가 못 보던 자리**(AC-192 · C 가 찾았다). `generateStill` 은 `generateImage` 를 부르고, 실패는 **그 안에서** `image:fail` 로 이미 적힌다 — 그 앞 12줄에 있던 `recordAiUsage` 는 **스텁 갈래의 것**이라 근접은 우연이었다"],
  [IMG, "gemini_error_",    "`callImageModel` 안쪽 — 부르는 쪽이 `image:fail`(`http`)로 적는다"],
  [IMG, "empty_image",      "`callImageModel` 안쪽 — 부르는 쪽이 `image:fail`(`empty`)로 적는다"],
  [IMG, "AbortError",       "`callImageModel` 안쪽 — 부르는 쪽이 `image:fail`(`timeout`)로 적는다"],
  [IMG, "reason: lastReason", "체인을 다 돌고 나온 마지막 return — **모델마다** 이미 `image:fail` 로 적었다(여기서 또 적으면 두 번 센다)"],
  [TTS, "읽을 대본이 없습니다", "**호출 전** 가드 — 타입캐스트를 안 부른다 · 돈 0"],
  [TTS, "R2 미설정",         "**호출 전** 가드 — 돈 0"],
  [TTS, "TYPECAST_API_KEY", "**호출 전** 가드(키가 없다) — 돈 0"],
];
/* 🔴 `policyBlocked` 를 여기서 뺐다(2026-09-22) — 그건 «돈을 안 썼다»가 아니라 **«제공사가 거절했다»**다.
   그 글자가 줄에 있다는 이유로 «돈 0» 으로 치던 것이라 **까닭이 틀렸다.** 이제 모수에 들어오고 ALLOW 가 까닭을 말한다. */
const NO_MONEY = /no_api_key|r2_not_configured|no_provider_available|no_model|not_configured/;
const seen = [], fresh = [];
const drop = { noMoney: 0, recorded: 0 };
let M = 0;
for (const f of [VID, IMG, TTS]) {
  const lines = T[f].split(String.fromCharCode(10));
  lines.forEach((ln, i2) => {
    if (!/return \{ ok: false/.test(ln)) return;
    M++;
    if (NO_MONEY.test(ln)) { drop.noMoney++; return; }                // 호출 전에 끊은 것 = 돈 0
    /* 🔴 **«같은 갈래의 끝»일 때만 면제한다** — 위로 최대 4줄, 사이에 다른 `return`/`else`/`if (` 가 나오면 딴 갈래다.
       (기록이 두 줄로 쓰이는 자리가 있어 4줄이다 — `void recordAiUsage({` + 이어지는 인자 줄 + return.) */
    let recorded = false;
    for (let k = i2 - 1; k >= 0 && k >= i2 - 4; k--) {
      const up = lines[k];
      if (/recordAiUsage/.test(up)) { recorded = true; break; }
      if (/return |\} else|if \(/.test(up)) break;                    // 딴 갈래가 시작·끝났다
    }
    if (recorded) { drop.recorded++; return; }
    const a = ALLOW.find(([af, m]) => af === f && ln.includes(m));
    (a ? seen : fresh).push(a ? `${f} «${a[1]}» — ${a[2]}` : `${f}:${i2 + 1} ${ln.trim().slice(0, 100)}`);
  });
}
/* 🔴 **모수를 먼저 말한다** — «검사한 N / 전체 M». 뺀 것은 사유별로 적는다(AC-141 ② · 메인 지시 2026-09-22). */
notes.push(`  · 모수 — \`return { ok: false\` **${M}곳** 중 검사한 것 **${seen.length + fresh.length}곳** · 뺀 것 ${drop.noMoney + drop.recorded}곳(호출 전 가드 ${drop.noMoney} · 바로 앞에서 기록함 ${drop.recorded})`);
if (seen.length + fresh.length === 0) unk("⑤", "모수가 0 이다 — 훑는 눈이 깨졌다(통과로 세지 않는다)");
if (fresh.length) {
  bad("⑤", `🔴 **까닭이 안 적힌** «기록 없이 빠져나가는 실패» ${fresh.length}곳 — 돈을 썼는지 보고, 안 썼으면 ALLOW 에 까닭과 함께 적어라:`);
  for (const s2 of fresh) notes.push(`      · ${s2}`);
} else ok("⑤", `«기록 없이 빠져나가는 실패» ${seen.length}곳 전부 까닭이 적혀 있다(새 것 0)`);
/* 🔴 **적어 뒀다고 없어지지 않는다** — 확인한 자리도 매번 찍는다(`api-callers.json` 의 그 규율). */
for (const s2 of seen) notes.push(`      · 확인함 — ${s2}`);
/* 🔴 그리고 **ALLOW 가 낡으면 그것도 신호다** — 과녁이 사라지면 그 줄은 공짜로 참이 된다. */
{
  const stale = ALLOW.filter(([af, m]) => !T[af].includes(m));
  (stale.length ? bad : ok)("⑤", stale.length ? `낡은 ALLOW ${stale.length}줄 — 그 글자가 제품에 없다(${stale.map((x) => x[1]).join(", ")})` : `ALLOW ${ALLOW.length}줄 모두 제품에 과녁이 살아 있다`);
}
/* 🔴 **⑤b — 「적어 둔 자리가 정말 모수에 들어왔나」**(2026-09-22 · AC-192 에서 덴 자리를 막는 축).
   이번 병은 «ALLOW 에 없어서 안 보인 것»이 아니라 **면제 규칙이 넓어서 모수에 아예 안 들어온 것**이었다.
   그런 자리는 빨갛지도 «확인함»에도 안 뜬다 — **조용히 사라진다.** 그게 제일 나쁘다.
   ⇒ ALLOW 의 모든 줄이 **실제로 검사를 받고 나서** 면제됐는지 본다. 누가 면제 창을 도로 넓히면 여기서 운다. */
{
  const unseen = ALLOW.filter(([af, m]) => !seen.some((s2) => s2.startsWith(af) && s2.includes(`«${m}»`)));
  (unseen.length ? bad : ok)("⑤b", unseen.length
    ? `🔴 ALLOW 에 적혀 있는데 **모수에 들어오지도 않은** 자리 ${unseen.length}곳 — 면제 규칙이 너무 넓다(${unseen.map((x) => x[1]).join(", ")})`
    : `ALLOW ${ALLOW.length}줄 모두 **검사를 받고** 면제됐다(모수 밖으로 새어 나간 것 0)`);
}

/* ───────── 찍기 ───────── */
console.log("─".repeat(100));
console.log(`원장이 못 세던 돈 — 축 ${notes.filter((l) => /^  [✓✗⊘△]/.test(l)).length}개 · 새는 곳 ${fails.length}`);
for (const l of notes) console.log(l);
console.log("─".repeat(100));
if (!process.argv.includes("--mutants")) process.exit(fails.length ? 1 : 0);

/* ═════════ 🔴 변이 — 제품 무접촉(사본에서만) ═════════ */
const SELF = path.join(ROOT, "scripts", "verify-ai-usage-leaks.mjs");
function runIn(transform) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ac-leak-"));
  try {
    const box = {}; for (const f of FILES) box[f] = rawRead(f);   // 🔴 사본엔 **원문**(주석 걷은 것을 쓰면 그게 변이다 · AC-191)
    const before = JSON.stringify(box);
    if (transform) transform(box);
    const changed = JSON.stringify(box) !== before;
    for (const f of Object.keys(box)) { mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); writeFileSync(path.join(dir, f), box[f]); }
    mkdirSync(path.join(dir, "scripts", "_lib"), { recursive: true });
    writeFileSync(path.join(dir, "scripts", "_lib", "code-only.mjs"), readFileSync(path.join(ROOT, "scripts", "_lib", "code-only.mjs"), "utf8"));
    let out = "", code = 0;
    try { out = execFileSync(process.execPath, [SELF], { cwd: dir, encoding: "utf8" }); }
    catch (e) { code = e.status ?? -1; out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
    return { code, out, changed };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log("\n■ 🔴 변이 — 내가 정말 무는가(대조군을 먼저 · AC-161)");
const ctrl = runIn(null);
if (ctrl.code !== 0) { console.log("  ⊘ 못 쟀음 — 대조군(맨 판)이 이미 빨갛다. 변이 탓을 말할 수 없다."); process.exit(2); }
console.log("  ✓ 대조군(맨 판) 초록");
/* 🔴 **기록 한 덩이를 «글자로» 잘라낸다**(2026-09-22).
   여태 `/void recordAiUsage\(\{[^}]*<과녁>/` 로 뗐는데, TTS 는 `model: \`typecast:${TYPECAST_MODEL}\`` 처럼
   **인자 안에 `}` 가 들어 있어** `[^}]*` 가 거기서 멈췄다 ⇒ 변이 셋이 통째로 «안 먹었다»가 났다.
   ⇒ 과녁 글자를 찾고 **그 앞의 가장 가까운 `recordAiUsage({`** 부터 **뒤의 첫 `});`** 까지를 잘라낸다(`callBlock` 과 같은 눈). */
function cutRecord(text, token) {
  const i = text.indexOf(token);
  if (i < 0) return text;
  let s = text.lastIndexOf("recordAiUsage({", i);
  if (s < 0) return text;
  const v = text.lastIndexOf("void ", s);
  if (v >= 0 && s - v <= 5) s = v;                 // `void ` 까지 함께 뗀다
  const e = text.indexOf("});", i);
  return e < 0 ? text : text.slice(0, s) + text.slice(e + 3);
}
const MUT = [
  ["영상 폴백 기록을 뗀다",          (b) => { b[VID] = cutRecord(b[VID], 'failKind: "provider_failed"'); }, "①"],
  ["🔴 다운로드 실패 기록을 뗀다",   (b) => { b[VID] = cutRecord(b[VID], 'failKind: "download_failed"'); }, "①"],
  /* 🔴 과녁을 `purpose: "image:fail"` 에서 **`failKind: kind`** 로 옮겼다(2026-09-22) —
     이미지에 `image:fail` 기록이 **둘**이 되면서(체인 실패 + 저장 실패) 앞엣것을 떼도 뒤엣것 때문에 ①축이 안 울었다.
     🔴 **과녁이 뭉뚱그려지면 변이는 조용히 죽는다.** 갈래가 늘면 과녁도 갈라야 한다. */
  ["이미지 체인 실패 기록을 뗀다",   (b) => { b[IMG] = cutRecord(b[IMG], "failKind: kind"); }, "①"],
  ["🔴 모르는데 금액을 적는다",      (b) => { b[VID] = b[VID].replace('costUsd: 0, failKind: "provider_failed"', 'costUsd: 0, costUsdMaybe: 0, failKind: "provider_failed"'); }, "②"],
  /* 🔴 옛 변이 «아는 금액을 안 적는다»(TTS `costUsdMaybe` 를 뗀다)는 **과녁이 제품에서 사라져** 걷었다 —
     결재로 그 값이 `costUsd` 로 옮겨 갔다. 같은 뜻은 아래 «아는 금액을 상한에서 뺀다»가 덮는다.
     🔴 안 걷으면 «변이가 안 먹었다»가 매번 뜨고, 그 소리에 익숙해지면 **진짜 안 우는 날을 놓친다**(AC-95). */
  ["🔴 기록 함수가 모름을 0으로 접는다", (b) => { b[AI] = b[AI].replace("row.costUsdMaybe === undefined || row.costUsdMaybe === null", "false"); }, "②"],
  ["🔴 모르는 금액을 상한에 먹인다",  (b) => { b[VID] = b[VID].replace('costUsd: 0, failKind: "provider_failed"', 'costUsd: 0.5, failKind: "provider_failed"'); }, "③"],
  ["아는 금액을 상한에서 뺀다",       (b) => { b[VID] = b[VID].replace('costUsd: billed, failKind: "download_failed"', 'costUsd: 0, failKind: "download_failed"'); }, "②"],
  ["막힐 때 실패분을 안 말한다",      (b) => { b[CAP] = b[CAP].replace("fail_kind IS NOT NULL", "1=0"); }, "③"],
  ["schema.ts 에서 칸을 뺀다",       (b) => { b[SCH] = b[SCH].replace('numeric("cost_usd_maybe", { precision: 10, scale: 6 })', "numeric(\"zz_gone\", { precision: 10, scale: 6 })"); }, "④"],
  /* 🔴 2026-09-22(AC-192) — 이번에 덮은 자리들. 새로 만든 기록은 **떼 보고 우는지**까지가 만든 것이다. */
  ["🔴 TTS no_audio 기록을 뗀다",    (b) => { b[TTS] = cutRecord(b[TTS], 'failKind: "no_audio"'); }, "①"],
  ["🔴 TTS empty_audio 기록을 뗀다", (b) => { b[TTS] = cutRecord(b[TTS], 'failKind: "empty_audio"'); }, "①"],
  ["🔴 TTS 저장 실패 기록을 뗀다",   (b) => { b[TTS] = cutRecord(b[TTS], 'failKind: "store_failed"'); }, "①"],
  ["🔴 TTS 예외 기록을 뗀다",        (b) => { b[TTS] = cutRecord(b[TTS], 'failKind: "exception"'); }, "①"],
  ["🔴 이미지 저장 실패 기록을 뗀다", (b) => { b[IMG] = cutRecord(b[IMG], 'failKind: "store_failed"'); }, "①"],
  ["🔴 TTS 아는 금액을 0 으로 바꾼다", (b) => { b[TTS] = b[TTS].replace("const costUsd = Math.round(chars * TYPECAST_USD_PER_CHAR * 1e6) / 1e6;", "const costUsd = 0;"); }, "②"],
  /* 🔴 **⑤축엔 여태 변이가 하나도 없었다** — «새 구멍이 생기면 정말 우는가»를 한 번도 안 물어봤다는 뜻이다.
     제품 사본에 **기록 없는 실패 return 을 새로 뚫고** ⑤가 무는지 본다. */
  ["🔴 기록 없는 실패 return 을 새로 뚫는다", (b) => { b[TTS] = b[TTS].replace("const chars = [...base].length;", "const chars = [...base].length;\n  if (chars > 999999) return { ok: false, reason: \"zz_new_leak\", costUsd: 0 };"); }, "⑤"],
];
/* ═════════ 🔴 **무해 변이 — 울면 안 되는 쪽** (2026-09-22 · AC-192) ═════════
   깨진 `[,s}]` 는 **틀렸는데 초록**이었다. 실제 인자가 `costUsd: 0,` 이라 **쉼표로 우연히 맞았기 때문**이다.
   ⇒ 그런 깨짐은 «안 무는 것»이 아니라 **«맞는 제품을 물어 버리는 것»**으로 드러난다. 그래서 **뜻이 같은 고쳐쓰기**를 넣고
      **초록이 그대로인지**를 본다. 여기가 빨개지면 자가 **글자 모양**을 보고 있다는 뜻이다(뜻이 아니라). */
const HARMLESS = [
  ["금액 0 을 `costUsd: 0 ,`(공백) 로 고쳐 쓴다", (b) => { b[VID] = b[VID].replace('costUsd: 0, failKind: "provider_failed"', 'costUsd: 0 , failKind: "provider_failed"'); }],
  ["금액 0 을 줄 끝으로 민다",                    (b) => { b[TTS] = b[TTS].replace('costUsd: 0, failKind: "http"', 'failKind: "http", costUsd: 0'); }],
  ["아는 금액 칸의 앞뒤 공백을 바꾼다",            (b) => { b[VID] = b[VID].replace('costUsd: billed, failKind: "download_failed"', 'costUsd:  billed,  failKind: "download_failed"'); }],
];
let silent = 0;
for (const [name, tf, axis] of MUT) {
  const r = runIn(tf);
  if (!r.changed) { console.log(`  ⊘ ${name} — 🔴 **변이가 안 먹었다**(과녁 글자가 바뀐 듯). 통과로 세지 않는다.`); silent++; continue; }
  const cried = r.code !== 0 && new RegExp(`✗ ${axis}`).test(r.out);
  if (cried) console.log(`  ✓ ${name} → ${axis}축이 운다`);
  else { console.log(`  ✗ ${name} → 🔴 **안 운다**(종료 ${r.code}) — 이 자가 그 자리를 못 본다`); silent++; }
}
console.log("\n■ 🔴 무해 변이 — **울면 안 되는 쪽**(뜻은 같고 글자만 다르다 · 깨진 정규식은 여기서 드러난다)");
let noisy = 0;
for (const [name, tf] of HARMLESS) {
  const r = runIn(tf);
  if (!r.changed) { console.log(`  ⊘ ${name} — 🔴 **고쳐쓰기가 안 먹었다**(과녁 글자가 바뀐 듯). 통과로 세지 않는다.`); noisy++; continue; }
  if (r.code === 0) console.log(`  ✓ ${name} → 초록 그대로(글자가 아니라 뜻을 본다)`);
  else { console.log(`  ✗ ${name} → 🔴 **맞는 제품을 물었다**(종료 ${r.code}) — 자가 글자 모양에 매달려 있다`); noisy++; }
}
console.log("─".repeat(100));
console.log(silent ? `🔴 변이 ${silent}종이 안 울었다 — 자를 고쳐야 한다` : `✓ 변이 ${MUT.length}종이 모두 제 축을 울렸다`);
console.log(noisy ? `🔴 무해 변이 ${noisy}종에서 거짓 빨강 — 자를 고쳐야 한다` : `✓ 무해 변이 ${HARMLESS.length}종 모두 초록 그대로`);
process.exit(fails.length || silent || noisy ? 1 : 0);
