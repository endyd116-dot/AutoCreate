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

const problems = [];
for (const r of rows) {
  if (r.textGen && !contractKeys.has(r.key)) problems.push(`🔴 ${r.key}: textGen=true 인데 글 계약이 없다 — «글을 만들어 준다»고 해 놓고 못 만든다`);
  if (r.publishVia === "runner" && !r.jobKind) problems.push(`🔴 ${r.key}: 러너 발행인데 jobKind 가 없다 — 적재할 잡 이름이 없다`);
  if (r.publishVia === "api" && !wiredApi.has(r.key)) problems.push(`🔴 ${r.key}: publishVia=api 인데 lib/publish/index.ts API_CONNECTORS 에 없다 — «올린다»고 답해 놓고 발행이 막힌다`);
  if (r.retractVia === "api" && !wiredRetract.has(r.key)) problems.push(`🔴 ${r.key}: retractVia=api 인데 lib/publish/retract-api.ts 에 분기가 없다 — «내려 주기» 단추가 켜지는데 눌러도 실패한다`);
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
if (!wiredApi.size || !wiredRetract.size) { console.log("🔴 커넥터 배선을 못 읽었다 — index.ts·retract-api.ts 의 모양이 바뀌었다(정규식이 빗나갔다)"); process.exit(1); }
if (!seedLabel.size || !uiLabel.size) { console.log("🔴 이름표를 못 읽었다 — seed-plans.mjs·ui.js 의 모양이 바뀌었다(정규식이 빗나갔다)"); process.exit(1); }
/* 🔴 같은 까닭으로 마크 배경도 0개면 **정규식이 빗나간 것**이지 «배경이 없는 것»이 아니다 —
   그대로 두면 전 채널이 한꺼번에 빨개져 «다 잡는다»처럼 보이는데 실은 **아무것도 안 돈다**(AC-100 ⑦). */
if (!mkStyled.size) { console.log("🔴 마크 배경을 못 읽었다 — public/css/ac.css 의 `.mk.<키>` 모양이 바뀌었다(정규식이 빗나갔다)"); process.exit(1); }
if (problems.length) { console.log("\n" + problems.join("\n")); process.exit(1); }
console.log("\n✅ 두 표가 어긋나지 않는다");
