/**
 * scripts/verify-keyless-ready.mjs — [R17-B2 · 2026-09-23] 🔴 **«키 꽂으면 즉시 가동»을 말이 아니라 자로 지킨다.**
 *
 *   ══ 왜 ══
 *   사장님 지시(2026-09-23): «키도 심사도 없이 할 수 있는 거 먼저 다 해놔. 나중에 한 번에 심사·키 다 받을 거니까.»
 *   그런데 «다 해 놨다»는 **말로는 확인이 안 된다.** R17 트리거 §3 이 그 말의 뜻을 넷으로 적어 뒀다 —
 *   이 자가 채널마다 그 넷을 센다. 🔴 **하나라도 비면 그 채널은 «키 꽂는 날» 그냥 안 켜진다.**
 *
 *   ══ 네 가지(트리거 §3 그대로) ══
 *     ① 키가 없을 때 **정직하게 말한다** — 커넥터가 `provider_not_configured` 를 «불렀는데 실패»와 갈라서 낸다.
 *        🔴 이게 없으면 키 없는 상태가 «알 수 없는 오류»로 보이고, 키를 꽂아도 뭐가 고쳐졌는지 아무도 모른다.
 *     ② **화면이 미리 안다** — 고객이 누르기 전에 «준비 중이에요»를 본다(`connectable`·`connectableReason` 경로).
 *     ③ **키 꽂는 자리가 있다** — `.env.example` 에 그 이름이 적혀 있다(어디에 넣는지 모르면 그날 못 꽂는다).
 *     ④ **꽂은 뒤 스스로 켜진다** — 레지스트리 `planned → active` 가 **운영 화면**에서 된다(손으로 SQL 치는 일이 아니다).
 *
 *   ② 와 ④ 는 채널마다 다르지 않고 **경로 하나**라, 한 번만 보고 전 채널에 같이 적용한다.
 *   🔴 읽기 전용 — 고치지 않는다. 어긋나면 종료코드 1.
 */
import { readFileSync } from "node:fs";

const reg = readFileSync("lib/channel-registry.ts", "utf8");
const idx = readFileSync("lib/publish/index.ts", "utf8");
const oauth = readFileSync("lib/oauth-providers.ts", "utf8");
const envEx = readFileSync(".env.example", "utf8");
const accountsTs = readFileSync("lib/accounts.ts", "utf8");
const appTpl = readFileSync("public/app/_tpl.txt", "utf8");
const opsTpl = readFileSync("public/ops/_tpl.txt", "utf8");

/** 표에서 `publishVia: "api"` 인 채널(= 앱 키가 필요할 수 있는 채널). */
const apiChannels = [...reg.matchAll(/\{\s*key:\s*"([^"]+)"[^}]*\}/g)]
  .map((m) => ({ key: m[1], via: (/publishVia:\s*"([a-z]+)"/.exec(m[0]) ?? [])[1] ?? null }))
  .filter((c) => c.via === "api").map((c) => c.key);

/** 채널 → 커넥터 파일. `API_CONNECTORS` 표의 함수 이름에서 import 한 파일을 되짚는다. */
const connBlock = /const API_CONNECTORS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(idx)?.[1] ?? "";
/* 🔴 표의 값은 **두 모양**이다: `blogger: publishToBlogger,` 와
   `threads: (p, a) => (p.kind === "video" ? publishThreadsVideo(p, a) : publishThreadsText(p, a)),`.
   앞 모양만 보면 threads 가 «못 되짚었다»로 **거짓 빨강**이 된다(첫 판에 실제로 그랬다 · AC-219c «과녁이 좁은 자»).
   ⇒ 값에서 **`publish…` 로 시작하는 첫 이름**을 집는다(화살표든 아니든 커넥터 이름은 그 꼴이다). */
/* 🔴 **줄 단위로** 집는다. 종전엔 `,\n` 까지 읽었는데, 표의 **마지막 항목**(`threads`)은 잘린 블록의 끝이라
   뒤에 줄바꿈이 없어서 통째로 샜다 — «못 되짚었다»는 거짓 빨강이 거기서 났다(AC-219c 와 같은 자리: **과녁이 좁은 자**). */
const fnOf = new Map(connBlock.split("\n")
  .map((line) => [(/^\s{2}([a-z_]+):/.exec(line) ?? [])[1], (/\b(publish[A-Za-z]+)/.exec(line) ?? [])[1]])
  .filter(([key, fn]) => key && fn));
const fileOfFn = new Map();
for (const m of idx.matchAll(/import \{([^}]+)\} from "\.\/([a-z-]+)"/g)) {
  for (const name of m[1].split(",").map((s) => s.trim())) fileOfFn.set(name, m[2]);
}

/** 그 채널이 우리 앱 키를 쓰나(OAuth 채널인가) — 안 쓰면 ①③ 은 «해당 없음»이다(워드프레스 앱 비밀번호). */
const oauthKeys = new Set([...(/export const OAUTH_CHANNELS[^=]*=\s*new Set\(\[([\s\S]*?)\]\);/.exec(oauth)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
/** 채널 → 필요한 env 이름들(`appCreds` 표에서). */
const providerOf = new Map([...(/const PROVIDER_OF[^=]*=\s*\{([\s\S]*?)\n\};/.exec(oauth)?.[1] ?? "").matchAll(/([a-z_]+):\s*"([a-z]+)"/g)].map((m) => [m[1], m[2]]));
const envOf = new Map([...(/const m: Record<ProviderKey, \[string, string\]> = \{([\s\S]*?)\n  \};/.exec(oauth)?.[1] ?? "").matchAll(/([a-z]+):\s*\["([A-Z_]+)",\s*"([A-Z_]+)"\]/g)].map((m) => [m[1], [m[2], m[3]]]));

/* ②④ — 경로 하나라 한 번만 본다. */
const screenKnows = /connectableReason/.test(accountsTs) && /connectableReason/.test(appTpl);
/* 🔴 [R17-B2 · B 가 «네 자가 그걸 실제로 재나»라고 물어서 올렸다] 종전엔 **운영 화면에 칩이 있나**만 봤다 —
   그건 «켤 수 있다»의 **대용물**이다(AC-178): 칩이 있어도 서버가 그 칸을 안 쓰거나, 쓰는 칸과 **읽는 칸이 다르면** 안 켜진다.
   ⇒ 이제 길 **셋**을 다 본다: ①화면이 그 문을 부르나 ②서버가 `status` 를 **쓰나**(화이트리스트를 지나) ③고객 쪽이 **같은 칸을 읽나**.
   ⚠️ 그래도 **라이브 왕복은 아니다** — 채널을 실제로 `active` 로 뒤집으면 그 순간 고객 연결 그리드가 바뀐다(공개 토글 · CLAUDE §4.5 사장님 승인 사안).
      그래서 «코드의 길이 이어져 있나»까지만 잰다. 이 한계를 여기 적어 둔다(안 적으면 다음 사람이 «실증했다»로 읽는다). */
const opsSrv = readFileSync("netlify/functions/ops-channels.ts", "utf8");
const opsToggles = /UI\.seg\("status",\s*\[\["active"/.test(opsTpl)            // ① 화면에 칩
  && /api\/ops-channels/.test(opsTpl)                                          //   + 그 문을 부른다
  && /STATUS\.has\(s\)/.test(opsSrv) && /sets\.push\(sql`status = \$\{s\}`\)/.test(opsSrv)   // ② 서버가 쓴다(화이트리스트 통과)
  && /SELECT key, label, category, publish_via, status FROM channel_registry/.test(accountsTs); // ③ 고객 쪽이 같은 칸을 읽는다

const problems = [];
console.log(`«키 꽂으면 즉시 가동» — API 채널 ${apiChannels.length}개\n`);
console.log(`  ② 화면이 미리 안다(connectable 사유 경로): ${screenKnows ? "✓" : "✗"}`);
console.log(`  ④ planned→active 가 운영 화면에서 된다   : ${opsToggles ? "✓" : "✗"}`);
if (!screenKnows) problems.push("🔴 ②: 화면이 «왜 못 붙나»를 서버 사유(connectableReason)로 말하지 않는다 — 고객이 눌러 봐야 안다");
if (!opsToggles) problems.push("🔴 ④: 운영 화면에서 채널 상태를 못 바꾼다 — 키를 꽂아도 **손으로 SQL 을 쳐야** 켜진다");

console.log("\n  채널별 ① 정직한 «키 없음» · ③ 키 꽂는 자리");
for (const key of apiChannels) {
  const fn = fnOf.get(key);
  const file = fn ? fileOfFn.get(fn) : null;
  if (!file) { problems.push(`🔴 ${key}: API_CONNECTORS 에서 커넥터 파일을 못 되짚었다(index.ts 모양이 바뀌었다)`); continue; }
  const src = readFileSync(`lib/publish/${file}.ts`, "utf8");
  const needsKey = oauthKeys.has(key);
  const honest = /provider_not_configured/.test(src);
  const envNames = needsKey ? (envOf.get(providerOf.get(key) ?? "") ?? []) : [];
  /* 🔴 `.env.example` 은 **한 줄에 둘씩** 적는다(`GOOGLE_OAUTH_CLIENT_ID= GOOGLE_OAUTH_CLIENT_SECRET=   # 블로거·유튜브`).
     줄머리로 찾으면 둘째 이름이 늘 «없다»가 되어 **거짓 빨강**이 아홉 개 났다(첫 판에 실제로 그랬다).
     ⇒ 줄 안 어디에 있든 «그 이름 = » 꼴이면 자리가 있는 것이다. */
  const inEnvEx = envNames.length ? envNames.every((n) => new RegExp(`(^|\\s)${n}\\s*=`, "m").test(envEx)) : true;
  const mark = (b) => (b ? "✓" : "✗");
  console.log(`   ${key.padEnd(16)} ① ${mark(!needsKey || honest)}  ③ ${mark(inEnvEx)}   ${needsKey ? envNames.join(" · ") : "(앱 키 불필요)"}`);
  /* 🔴 앱 키를 쓰는데 «키 없음»을 안 가르면, 키 없는 상태가 «알 수 없는 오류»로 보인다(AC-170 ②). */
  if (needsKey && !honest) problems.push(`🔴 ${key}: lib/publish/${file}.ts 가 provider_not_configured 를 안 가른다 — «열쇠가 없다»와 «불렀는데 실패했다»가 한 문장이 된다`);
  if (!inEnvEx) problems.push(`🔴 ${key}: .env.example 에 ${envNames.join("·")} 가 없다 — 키를 받아도 **어디에 넣는지 모른다**`);
}

/* 🔴 아무것도 못 읽었으면 «다 맞다»가 아니라 정규식이 빗나간 것이다(이 프로젝트의 자 규율 · AC-100 ⑦). */
if (!apiChannels.length || !fnOf.size || !oauthKeys.size || !envOf.size) {
  console.log("\n🔴 표를 못 읽었다 — channel-registry·publish/index·oauth-providers 의 모양이 바뀌었다(정규식이 빗나갔다)");
  process.exit(1);
}
if (problems.length) { console.log("\n" + problems.join("\n")); process.exit(1); }
console.log("\n✅ API 채널 전부 «키 꽂는 칸만 비어 있고 나머지는 서 있다»");
