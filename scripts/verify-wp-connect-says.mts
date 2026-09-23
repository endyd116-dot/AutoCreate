/**
 * scripts/verify-wp-connect-says.mts — [R17-B2 · 2026-09-23] 🔴 **워드프레스 연결이 실패할 때 «무엇이 틀렸는지» 말하나.**
 *
 *   ══ 왜 ══
 *   R16 에서 워드프레스는 «키도 심사도 없이 지금 붙일 수 있는데 계정이 0개»인 채널이었다.
 *   메인이 «사이트 없이도 잴 수 있는 것을 재라»고 했고, 재 보니 이랬다:
 *     `verifyWordpress` 는 실패를 **다섯 갈래**로 가르는데(`http_401`·`http_403`·`http_404`·`no_user`·연결 실패)
 *     고객에게는 전부 **«워드프레스 로그인 정보를 확인해 주세요»** 한 문장이 나가고,
 *     화면은 **늘 «앱 비밀번호» 칸**을 빨갛게 칠했다.
 *   🔴 404(REST 가 꺼져 있다)·연결 실패(주소가 안 열린다)에서 그 말은 **거짓**이다 —
 *      고객을 «비밀번호 다시 만들기»라는 아무 소용 없는 곳으로 보낸다(AC-10 거짓 안내).
 *
 *   ══ 어떻게 재나 — 🔴 **진짜 워드프레스 없이 잰다** ══
 *   가짜 WP 를 한 대 띄우고 경로마다 다른 응답을 주게 한다(401·403·404·200이지만 사용자 없음·아예 안 뜸).
 *   그 주소로 실제 연결 흐름(`POST /api/accounts-add`)이 아니라 **말을 만드는 함수**(`wpAuthSay`)를
 *   `verifyWordpress` 의 **실제 반환값**으로 먹여 본다 — 그래야 «다섯 갈래가 진짜 다섯 갈래로 갈리나»를 잰다.
 *   🔴 두 함수 다 `netlify/functions/accounts.ts` 안에 있어 import 가 안 된다 ⇒ **원문을 떼어** 평가한다
 *      (베껴 적으면 두 벌이 되고 고친 쪽만 초록이 된다 · AC-52).
 *
 *   쓰기: npx tsx scripts/verify-wp-connect-says.mts
 */
import "./_lib/load-env.mjs";
import http from "node:http";
/* 🔴 **진짜 그 함수를 부른다.** 한 번은 정규식으로 원문을 떼어 `new Function` 에 먹였는데,
   TS 타입 표기를 손으로 벗기다 «과녁 좁은 자»가 됐다(AC-219c). 두 함수를 `export` 로 열어 **그대로 import** 한다 —
   베껴 적거나 떼어 내면 두 벌이 되고, 고친 쪽만 초록이 된다(AC-52). */
import { verifyWordpress, wpAuthSay } from "../netlify/functions/accounts";
const mod = { verifyWordpress, wpAuthSay };

/* 가짜 워드프레스 — 경로마다 다른 얼굴. 🔴 실제 REST 응답 모양을 흉내 낸다(공개 문서에 있는 것만). */
const server = http.createServer((req, res) => {
  const p = req.url ?? "";
  if (p.startsWith("/ok/")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ id: 7, name: "김사장" })); }
  if (p.startsWith("/nouser/")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: true })); }
  if (p.startsWith("/401/")) { res.writeHead(401); return res.end("{}"); }
  if (p.startsWith("/403/")) { res.writeHead(403); return res.end("{}"); }
  res.writeHead(404); res.end("{}");
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;

const fails: string[] = [];
const ok = (cond: boolean, say: string) => { console.log(`   ${cond ? "✓" : "✗"} ${say}`); if (!cond) fails.push(say); };

console.log("\n── 워드프레스 연결 실패 — 무엇이 틀렸는지 말하나(가짜 WP 로 실측) ──");
const seen = new Map<string, { error: string; field: string }>();
for (const [label, url, wantField] of [
  ["아이디·앱 비밀번호가 틀림(401)", `${base}/401`, "appPassword"],
  ["보안 플러그인이 막음(403)", `${base}/403`, "appPassword"],
  ["REST 가 꺼졌거나 주소가 틀림(404)", `${base}/404`, "siteUrl"],
  ["로그인은 됐는데 권한 없음", `${base}/nouser`, "loginId"],
  ["사이트가 아예 안 뜸", "http://127.0.0.1:1", "siteUrl"],
] as const) {
  const v = await mod.verifyWordpress(url, "kim", "abcd efgh");
  const said = mod.wpAuthSay(v.reason);
  console.log(`   · ${label}`);
  console.log(`       → [${said.field}] ${said.error}`);
  ok(!v.ok, `${label}: 연결이 실패로 잡힌다`);
  ok(said.field === wantField, `${label}: 빨간 줄이 «${wantField}» 칸에 간다(받은 칸: ${said.field})`);
  /* 🔴 겁주지 않는다(§3) — 사실만 던지고 끝내지 않고 **다음 손**을 같이 준다. */
  /* 🔴 과녁을 좁게 잡지 않는다 — 첫 판엔 «해 주세요»만 찾다가 «붙여넣어 주세요»를 놓쳐 **거짓 빨강**이 났다(AC-219c). */
  ok(/주세요|주시면|보세요/.test(said.error), `${label}: 무엇을 하면 되는지 같이 말한다`);
  ok(!/정지|불이익|차단됩니다|책임/.test(said.error), `${label}: 겁주는 말이 없다`);
  seen.set(label, said);
}

/* 🔴 본론 — **다섯 갈래가 진짜 다섯 갈래인가.** 문장이 겹치면 갈랐다고 할 수 없다. */
const msgs = [...seen.values()].map((s) => s.error);
ok(new Set(msgs).size === msgs.length, `다섯 갈래가 서로 다른 말을 한다(서로 다른 문장 ${new Set(msgs).size}/${msgs.length})`);

/* 성공 경로도 본다 — 실패만 재면 «전부 실패시키기»로도 초록이 된다. */
const good = await mod.verifyWordpress(`${base}/ok`, "kim", "abcd efgh");
ok(good.ok === true && good.name === "김사장", `맞는 자격이면 통과하고 이름을 읽어 온다(받은 이름: ${good.name})`);

/* 🔴 서버가 **다 닫힌 뒤에** 끝낸다 — `process.exit` 과 겹치면 libuv 가 죽으며 «Assertion failed» 를 뱉고,
   그건 검사 결과와 무관한데도 빨강처럼 보인다(가짜 빨강을 만들지 않는다). */
/* 🔴 서버가 **다 닫힌 뒤에** 끝낸다 — `process.exit` 과 겹치면 윈도우 libuv 가 «Assertion failed … async.c» 를 뱉으며
   **종료코드 127** 로 죽는다. 검사 결과와 아무 상관없는데 CI 에서는 빨강으로 보인다(가짜 빨강을 만들지 않는다).
   그래서 ①서버를 닫고 ②`fetch` 가 남긴 연결이 정리되게 한 틱 쉬고 ③그때 끝낸다. */
/* 🔴 서버가 **다 닫힌 뒤에** 끝낸다 — `process.exit` 과 겹치면 윈도우 libuv 가 «Assertion failed … async.c» 를 뱉으며
   **종료코드 127** 로 죽는다. 검사 결과와 아무 상관없는데 CI 에서는 빨강으로 보인다(가짜 빨강을 만들지 않는다).
   ⇒ ①`fetch` 가 물고 있는 **keep-alive 연결까지** 끊고 ②`process.exit` 을 **안 부른다**(`exitCode` 만 두고 자연 종료). */
server.closeAllConnections();
await new Promise<void>((r) => server.close(() => r()));
console.log(fails.length ? `\n🔴 ${fails.length}건 실패\n` : "\n✅ 다섯 갈래를 갈라서, 어느 칸이 문제인지까지 말한다\n");
process.exitCode = fails.length ? 1 : 0;
