/**
 * scripts/verify-channel-tables.mjs — 채널 표 두 벌이 어긋나지 않는지 본다(읽기 전용 · P1R8 §5.2).
 *   `node scripts/verify-channel-tables.mjs`
 *
 *   ══ 무엇을 보나 ══
 *     ① `lib/channel-registry.ts` 의 `textGen: true` 채널에 **글 계약**(`lib/writing-contracts.ts WRITING_CONTRACTS`)이 있나
 *        — 없으면 «글을 만들어 준다»고 해 놓고 못 만든다.
 *     ② 글 계약에만 있고 표에 없는 채널(오타·유령 채널)
 *     ③ `publishVia: "runner"` 인데 `jobKind` 가 없는 채널 — «러너로 간다»는데 적재할 잡 이름이 없다.
 *     ④ [P1R8 §3.4] 🔴 `publishVia: "api"` 인데 **`lib/publish/index.ts API_CONNECTORS` 에 없는** 채널
 *        — «API 로 올린다»고 대답해 놓고 발행하면 «아직 이 채널로는 발행할 수 없어요»가 나온다.
 *          이건 예전에 `instagram`·`tiktok` 이 폴백 추측으로 «api» 라고 답하던 것과 **같은 종류의 거짓말**이고,
 *          채널을 늘릴 때 제일 빠뜨리기 쉬운 자리다(표 한 줄은 쓰고 커넥터 배선을 잊는다).
 *     ⑤ [P1R8 §3.4] 🔴 `retractVia: "api"` 인데 **`lib/publish/retract-api.ts` 에 그 채널 분기가 없는** 것
 *        — 화면에 «내려 주기» 단추가 켜지는데 누르면 «표와 코드가 갈라졌다»로 실패한다(그 파일 끝줄이 그렇게 말한다).
 *     ⑥⑦ 채널 «이름»이 시드·화면(`UI.CH`)·마크 배경(`.mk.<키>`)에 다 있나 · 글자가 같나.
 *     ⑧ [R17-B2] 🔴 `jobKind` **글자가 있다**와 **서버가 그 잡을 만들 수 있다**는 다른 칸이다 —
 *        그 글자가 `lib/runner-jobs.ts` 의 네 칸(union·`RUNNER_JOB_KINDS`·`JOB_PRIORITY`·`PUBLISH_JOB_KINDS`)과
 *        `runner/core.mjs HANDLERS` 에 **실제로 있는지**. ③은 «비었나»만 봐서 이걸 못 봤다(AC-178 대용물).
 *     ⑨ [R17-B2] 🔴 `retractVia: "runner"` 인데 `runner/channels/retract.mjs RETRACTABLE_CHANNELS` 에 없는 것 —
 *        삭제 셀렉터는 **채널마다 다르다.** ⑤보다 위험하다(되돌릴 수 없고, 헛손질이 엉뚱한 글을 지울 수 있다).
 *   🔴 ⑧⑨ 는 변이로 확인했다: 네 칸에서 하나 빼면 빨강+종료코드 1, 되돌리면 초록+0(2026-09-23 B2).
 *   🔴 두 파일을 **합치지 않고** 검사만 하는 이유: 성격이 다르고(성질 vs 글 계약), R8 §2 에서 다른 세션이 계약 파일을 고치는 중이다.
 *   🔴 읽기 전용 — 고치지 않는다. 어긋나면 종료코드 1.
 *   🔎 출처: AC 신규(계약 P1R8 §5.2 · 생성 2026-09-15) — AM 원본 없음.
 */
import { readFileSync } from "node:fs";

const reg = readFileSync("lib/channel-registry.ts", "utf8");
const con = readFileSync("lib/writing-contracts.ts", "utf8");

/* 표 파싱 — 정규식으로 «key: "…"» 와 그 행의 칸들을 뽑는다(모듈을 import 하면 DB·타입 의존이 딸려 온다). */
const rows = [...reg.matchAll(/\{\s*key:\s*"([^"]+)"[^}]*\}/g)].map((m) => {
  const body = m[0];
  /* 값 그대로 뽑는다(따옴표는 벗긴다) — 한 행이 한 줄이라 줄 단위 정규식으로 충분하다. */
  const pick = (name) => {
    const m2 = body.match(new RegExp(name + ":\\s*(\"[^\"]*\"|null|true|false)"));
    if (!m2) return null;
    const v = m2[1];
    if (v === "null") return null;
    return v.startsWith("\"") ? v.slice(1, -1) : v;
  };
  return { key: m[1], publishVia: pick("publishVia"), retractVia: pick("retractVia"), jobKind: pick("jobKind"), textGen: pick("textGen") === "true" };
});

/* [P1R8 §3.4] ④⑤의 재료 — **코드에서** 읽는다(문서나 주석이 아니라 · AC-59).
   `API_CONNECTORS` 는 `{ 채널키: 함수 }` 표라 열쇠만 뽑으면 «배선된 채널»이 된다.
   retract 는 분기가 `ctx.channel === "wordpress"` 꼴이라 그 글자를 센다. */
const idx = readFileSync("lib/publish/index.ts", "utf8");
const connBlock = /const API_CONNECTORS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(idx)?.[1] ?? "";
const wiredApi = new Set([...connBlock.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]));
const retractSrc = readFileSync("lib/publish/retract-api.ts", "utf8");
const wiredRetract = new Set([...retractSrc.matchAll(/ctx\.channel\s*===\s*"([a-z_]+)"/g)].map((m) => m[1]));

/* [P1R8 §3.4] ⑥⑦의 재료 — 채널 «이름»은 **세 곳**에 있다. 셋이 갈리면 조용히 이상해진다:
     · `scripts/seed-plans.mjs` — 새 설치가 DB 에 넣는 이름(그리고 DDL 이 라이브에 넣는 그 값)
     · `public/js/ui.js UI.CH`  — 화면이 쓰는 이름. **없으면 «facebook_reels» 라는 열쇠 글자가 그대로 뜬다**
   ⇒ 표에 있는 채널은 둘 다에 있어야 하고, 이름은 **글자까지 같아야** 한다(AC-52 «모의가 서버와 다른 낱말»). */
const seedSrc = readFileSync("scripts/seed-plans.mjs", "utf8");
const seedLabel = new Map([...seedSrc.matchAll(/\["([a-z_]+)",\s*"([^"]+)",\s*"(?:text|video)"/g)].map((m) => [m[1], m[2]]));
const uiSrc = readFileSync("public/js/ui.js", "utf8");
const uiBlock = /UI\.CH\s*=\s*\{([\s\S]*?)\n\s*\};/.exec(uiSrc)?.[1] ?? "";
const uiLabel = new Map([...uiBlock.matchAll(/([a-z_]+):\s*\{\s*label:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
/* [R12 마감 · 2026-09-17 · A 가 **눈으로** 찾은 것을 자에 박는다] 🔴 **이름표와 마크 배경은 한 짝이다.**
     당근을 넣을 때 `UI.CH` 한 줄만 넣으니 **이 검사는 초록인데 화면은 빈칸**이었다 —
     `.mk` 는 `color:#fff` 만 갖고 배경은 `.mk.<키>` 가 채널마다 따로 준다. 없으면 **흰 글자가 배경 없이 사라진다.**
   ⇒ 이름표가 있으면 `public/css/ac.css` 에 `.mk.<키>` 배경 규칙도 있어야 한다.
   🔴 이 줄이 없었기 때문에 A 가 사람 눈으로 찾아야 했다 — 「검사가 못 본 것은 다음에도 못 본다」. */
const cssSrc = readFileSync("public/css/ac.css", "utf8");
const mkStyled = new Set([...cssSrc.matchAll(/\.mk\.([a-z_]+)\b/g)].map((m) => m[1]));
/** 글 계약에 있는 채널 키 — `WRITING_CONTRACTS` 의 최상위 키(`naver_blog: {` 꼴). */
const contractKeys = new Set([...con.matchAll(/^\s{2}([a-z_]+):\s*\{$/gm)].map((m) => m[1]));

/* ═══ [R17-B2 · 2026-09-23] ⑧ 🔴 **`jobKind` 가 «있다»와 «서버가 그 잡을 만들 수 있다»는 다른 칸이다** ═══
   R16 재측정에서 `daangn` 이 그렇게 걸렸다: 표는 `jobKind:"publish.daangn"` 이라 말하고 러너엔 처리기까지 있는데,
   `lib/runner-jobs.ts` 의 **네 칸**(union · `RUNNER_JOB_KINDS` · `JOB_PRIORITY` · `PUBLISH_JOB_KINDS`) 이 비어 있어
   `publishJobKindOf("daangn")` 이 언제나 `null` 이었다 ⇒ 발행이 «아직 이 채널로는 발행할 수 없어요»로 막혔다.
   🔴 **위 ③은 «jobKind 가 비었나»만 봐서 이걸 못 봤다** — 글자는 채워져 있었기 때문이다(AC-178 대용물).
   ⇒ 이제 **그 글자가 네 칸에 실제로 있는지**와 **러너가 그 잡을 집을 수 있는지**를 센다.
   🔴 «키 꽂으면 즉시 가동»(CLAUDE §8)을 **말이 아니라 자로** 지키는 자리다. */
const jobsSrc = readFileSync("lib/runner-jobs.ts", "utf8");
const pickList = (re) => new Set([...(re.exec(jobsSrc)?.[1] ?? "").matchAll(/"([a-z_.]+)"/g)].map((m) => m[1]));
const allKinds = pickList(/export const RUNNER_JOB_KINDS[^=]*=\s*\[([\s\S]*?)\n\];/);
const pubKinds = pickList(/const PUBLISH_JOB_KINDS\s*=\s*\[([\s\S]*?)\]\s*as const;/);
const priKinds = pickList(/export const JOB_PRIORITY[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\);/);
/* 러너가 실제로 처리하는 잡 — `runner/core.mjs` 의 `HANDLERS` 표 열쇠. 여기 없으면 집어도 «모르는 잡»이다. */
const coreSrc = readFileSync("runner/core.mjs", "utf8");
const handlerKinds = new Set([...(/const HANDLERS\s*=\s*\{([\s\S]*?)\n\};/.exec(coreSrc)?.[1] ?? "").matchAll(/"([a-z_.]+)":/g)].map((m) => m[1]));
/* ⑨ 🔴 [R17-B2] **러너 내리기는 채널마다 셀렉터가 다르다** — API 쪽(⑤)과 같은 검사를 러너 쪽에도 건다.
   `daangn` 이 `retractVia:"runner"` 였는데 `runner/channels/daangn.mjs` 에 삭제가 **0줄**이라,
   화면엔 «내려 주기»가 켜지고 눌러도 네이버·티스토리용 셀렉터로 헛손질만 했다(9일 동안 아무도 못 봤다).
   🔴 되돌릴 수 없는 일이라 ⑤보다 위험하다 — 헛손질이 **엉뚱한 글을 지울** 수 있는 자리다. */
const retractRunnerSrc = readFileSync("runner/channels/retract.mjs", "utf8");
const runnerRetractable = new Set([...(/export const RETRACTABLE_CHANNELS\s*=\s*\[([\s\S]*?)\];/.exec(retractRunnerSrc)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
/* ⑩ 🔴 [R17-B2] **«로그인 확인» 목록을 서버와 러너가 둘 다 가진다** — 러너는 별도 번들이라 import 로 못 묶는다.
   갈리면 고객이 «확인»을 눌렀는데 러너가 «아직 이 채널은 확인을 지원하지 않아요»로 실패한다 —
   **못 하는 일을 화면에 단추로 내놓는** 꼴이다. 🔴 당근이 네 칸에서 갈렸던 그 병과 같은 모양이라, 생기기 전에 센다. */
const sessVerifySrc = readFileSync("runner/channels/session-verify.mjs", "utf8");
const runnerVerifiable = new Set([...(/const CHECK = \{([\s\S]*?)\n\};/.exec(sessVerifySrc)?.[1] ?? "").matchAll(/^  async ([a-z_]+)\(/gm)].map((m) => m[1]));
/* 🔴 서버쪽 정본은 **순수 리프** `lib/channel-registry.ts` 다(`runner-jobs` 에 두면 `accounts` 가 고리에 걸린다 · AC-17).
   `runner-jobs.ts` 는 그 이름을 다시 내보내기만 한다 — 그래서 여기서도 **정본 파일**을 읽는다(재수출을 읽으면 정본이 옮겨가도 모른다). */
const serverVerifiable = new Set([...(/export const SESSION_VERIFY_CHANNELS[^=]*=\s*new Set\(\[([\s\S]*?)\]\);/.exec(reg)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));

const problems = [];
for (const r of rows) {
  if (r.textGen && !contractKeys.has(r.key)) problems.push(`🔴 ${r.key}: textGen=true 인데 글 계약이 없다 — «글을 만들어 준다»고 해 놓고 못 만든다`);
  if (r.publishVia === "runner" && !r.jobKind) problems.push(`🔴 ${r.key}: 러너 발행인데 jobKind 가 없다 — 적재할 잡 이름이 없다`);
  /* [R17-B2] ⑧ jobKind 글자가 **네 칸에 실제로 있나** — 하나라도 비면 그 채널은 «되는 척»이다. 칸마다 무엇이 깨지는지 따로 말한다. */
  if (r.jobKind) {
    if (!allKinds.has(r.jobKind)) problems.push(`🔴 ${r.key}: jobKind «${r.jobKind}» 가 RUNNER_JOB_KINDS 에 없다 — 러너가 claim 조차 못 한다(isRunnerJobKind=false)`);
    if (!priKinds.has(r.jobKind)) problems.push(`🟡 ${r.key}: jobKind «${r.jobKind}» 가 JOB_PRIORITY 에 없다 — 기본 50 으로 밀려 발행이 수익 스크랩보다 뒤로 간다`);
    if (!handlerKinds.has(r.jobKind)) problems.push(`🔴 ${r.key}: jobKind «${r.jobKind}» 를 runner/core.mjs HANDLERS 가 모른다 — 러너가 집어도 못 한다`);
    if (r.publishVia === "runner" && !pubKinds.has(r.jobKind)) problems.push(`🔴 ${r.key}: jobKind «${r.jobKind}» 가 PUBLISH_JOB_KINDS 화이트리스트에 없다 — publishJobKindOf 가 null 이라 **서버가 잡을 못 만든다**(«키 꽂으면 즉시»가 거짓이 된다)`);
  }
  if (r.publishVia === "api" && !wiredApi.has(r.key)) problems.push(`🔴 ${r.key}: publishVia=api 인데 lib/publish/index.ts API_CONNECTORS 에 없다 — «올린다»고 답해 놓고 발행이 막힌다`);
  if (r.retractVia === "api" && !wiredRetract.has(r.key)) problems.push(`🔴 ${r.key}: retractVia=api 인데 lib/publish/retract-api.ts 에 분기가 없다 — «내려 주기» 단추가 켜지는데 눌러도 실패한다`);
  /* [R17-B2] ⑨ 러너 내리기도 같은 검사 — 🔴 되돌릴 수 없는 일이라 ⑤보다 위험하다. */
  if (r.retractVia === "runner" && !runnerRetractable.has(r.key)) problems.push(`🔴 ${r.key}: retractVia=runner 인데 runner/channels/retract.mjs RETRACTABLE_CHANNELS 에 없다 — 삭제 셀렉터가 다른 채널 것이라 헛손질(엉뚱한 글을 지울 수 있다)`);
  if (!seedLabel.has(r.key)) problems.push(`🔴 ${r.key}: scripts/seed-plans.mjs 에 없다 — 새로 깐 DB 에는 이 채널이 통째로 없다`);
  if (!uiLabel.has(r.key)) problems.push(`🔴 ${r.key}: public/js/ui.js UI.CH 에 없다 — 화면에 «${r.key}» 라는 열쇠 글자가 그대로 뜬다`);
  /* 🔴 이름표는 있는데 마크 배경이 없으면 **«흰 글자가 배경 없이»** 사라진다(A 실측 2026-09-17). 이름표가 없는 채널은 위 줄이 이미 잡았으니 여기선 안 센다. */
  if (uiLabel.has(r.key) && !mkStyled.has(r.key)) problems.push(`🔴 ${r.key}: public/css/ac.css 에 .mk.${r.key} 배경이 없다 — 마크가 흰 글자만 남아 화면에서 사라진다(이름표와 한 짝이다)`);
  const [a, b] = [seedLabel.get(r.key), uiLabel.get(r.key)];
  if (a && b && a !== b) problems.push(`🟡 ${r.key}: 이름이 다르다 — 시드 «${a}» ↔ 화면 «${b}»(같은 채널을 서로 다른 말로 부른다)`);
}
/* 거꾸로도 본다 — 배선은 있는데 표가 «api» 가 아니면 그 커넥터는 **아무도 안 부른다**(AC-69 죽은 통로). */
for (const k of wiredApi) if (!rows.some((r) => r.key === k && r.publishVia === "api")) problems.push(`🟡 ${k}: 커넥터는 배선돼 있는데 표의 publishVia 가 api 가 아니다 — 부르는 자리가 없다(죽은 통로)`);
for (const k of contractKeys) if (!rows.some((r) => r.key === k)) problems.push(`🟡 ${k}: 글 계약에는 있는데 채널 표에 없다(유령 채널·오타?)`);

console.log(`채널 표 ${rows.length}행 · 글 계약 ${contractKeys.size}채널`);
console.log(`  textGen=true: ${rows.filter((r) => r.textGen).map((r) => r.key).join(" ") || "(없음)"}`);
console.log(`  publishVia=null(아직 못 올림): ${rows.filter((r) => !r.publishVia).map((r) => r.key).join(" ") || "(없음)"}`);
/* 🔴 **센 것을 찍는다.** 이 줄이 «(없음)» 이면 위 ④⑤는 아무것도 안 본 것이고, 그래도 초록이 뜬다 —
   그게 이 프로젝트가 제일 싫어하는 모양이라(AC-58 «검사 코드의 catch 가 검사자의 눈을 가린다») 눈에 보이게 둔다. */
console.log(`  배선된 커넥터(index.ts): ${[...wiredApi].join(" ") || "(없음)"}`);
console.log(`  배선된 내리기(retract-api.ts): ${[...wiredRetract].join(" ") || "(없음)"}`);
if (!rows.length || !contractKeys.size) { console.log("🔴 표를 못 읽었다 — 파일 모양이 바뀌었나 본다(검사 자체가 조용히 통과하지 않게 실패로 둔다)"); process.exit(1); }
console.log(`  이름표: 시드 ${seedLabel.size}개 · 화면 ${uiLabel.size}개`);
/* 🔴 [R17-B2] 센 것을 찍는다 — 0 이면 «어긋난 게 없다»가 아니라 **정규식이 빗나간 것**이다(위 ④⑤와 같은 규율). */
console.log(`  잡 이름: 전체 ${allKinds.size} · 발행 화이트리스트 ${pubKinds.size} · 우선순위 ${priKinds.size} · 러너 처리기 ${handlerKinds.size}`);
console.log(`  러너가 내릴 줄 아는 채널: ${[...runnerRetractable].join(" ") || "(없음)"}`);
console.log(`  로그인 확인: 러너 ${[...runnerVerifiable].join(" ") || "(없음)"} ↔ 서버 ${[...serverVerifiable].join(" ") || "(없음)"}`);
if (!runnerVerifiable.size || !serverVerifiable.size) { console.log("🔴 로그인 확인 목록을 못 읽었다 — session-verify.mjs 의 CHECK 또는 runner-jobs.ts 의 SESSION_VERIFY_CHANNELS 모양이 바뀌었다"); process.exit(1); }
for (const k of runnerVerifiable) if (!serverVerifiable.has(k)) problems.push(`🟡 ${k}: 러너는 로그인 확인을 할 줄 아는데 서버 SESSION_VERIFY_CHANNELS 에 없다 — 만들어 둔 길을 아무도 안 부른다(AC-29)`);
for (const k of serverVerifiable) if (!runnerVerifiable.has(k)) problems.push(`🔴 ${k}: 서버는 로그인 확인을 약속하는데 러너 session-verify.mjs 가 모른다 — 고객이 «확인»을 누르면 실패한다`);
if (!runnerRetractable.size) { console.log("🔴 러너 내리기 목록을 못 읽었다 — runner/channels/retract.mjs 의 RETRACTABLE_CHANNELS 모양이 바뀌었다"); process.exit(1); }
if (!allKinds.size || !pubKinds.size || !priKinds.size || !handlerKinds.size) { console.log("🔴 잡 이름 표를 못 읽었다 — lib/runner-jobs.ts·runner/core.mjs 의 모양이 바뀌었다(정규식이 빗나갔다)"); process.exit(1); }
if (!wiredApi.size || !wiredRetract.size) { console.log("🔴 커넥터 배선을 못 읽었다 — index.ts·retract-api.ts 의 모양이 바뀌었다(정규식이 빗나갔다)"); process.exit(1); }
if (!seedLabel.size || !uiLabel.size) { console.log("🔴 이름표를 못 읽었다 — seed-plans.mjs·ui.js 의 모양이 바뀌었다(정규식이 빗나갔다)"); process.exit(1); }
/* 🔴 같은 까닭으로 마크 배경도 0개면 **정규식이 빗나간 것**이지 «배경이 없는 것»이 아니다 —
   그대로 두면 전 채널이 한꺼번에 빨개져 «다 잡는다»처럼 보이는데 실은 **아무것도 안 돈다**(AC-100 ⑦). */
if (!mkStyled.size) { console.log("🔴 마크 배경을 못 읽었다 — public/css/ac.css 의 `.mk.<키>` 모양이 바뀌었다(정규식이 빗나갔다)"); process.exit(1); }
if (problems.length) { console.log("\n" + problems.join("\n")); process.exit(1); }
console.log("\n✅ 두 표가 어긋나지 않는다");
