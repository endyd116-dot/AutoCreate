/**
 * scripts/verify-runner-wait.mts — «기다렸다»와 «준비됐다»를 가르는 자리를 진짜 브라우저로 확인한다(2026-09-15 B2).
 *
 *   🔴 AC-57 의 같은 모양: 우리가 알고 싶은 것은 «**화면이 준비됐나**»인데, 코드가 실제로 하는 것은 «**N밀리초 잤다**»다.
 *      대용물이라 양쪽으로 갈라진다:
 *        · 너무 짧으면 → 아직 안 그려진 화면을 재고 «내용이 없다»고 판정한다 → «주소를 못 찾았어요(우리 버그)»라는
 *          **거짓 보고**가 나간다. 실제로 클립 채널에 «SPA 는 렌더가 느려 3.5초 준다»는 상수 키운 자국이 남아 있다.
 *        · 너무 길면 → 준비가 끝났는데도 계속 잔다. 잡마다 몇 초씩, 크론 예산(`ctx.deadline`)을 갉아먹는다.
 *      ⇒ 조건이 **참이 될 때까지 훑고**, 안 되면 «안 됐다»고 말해야 한다(잠은 사람처럼 쉬는 용도로만 남긴다).
 *
 *   🔴 진짜 DOM 이 필요하다 — 늦게 그려지는 화면을 흉내내려면 시간이 지나야 요소가 생겨야 한다.
 *      러너에 있는 chromium + 로컬 서버로 만든다(네트워크·계정 0).
 *
 *   실행: npx --yes tsx scripts/verify-runner-wait.mts
 */
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { requirePlaywright } from "./_lib/find-playwright.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 🔴 [2026-09-16 메인] 예전엔 `createRequire(runner/package.json)` 였다 — 그런데 `runner/node_modules` 는
   **B2·C 폴더에만** 있어서 메인·A·B 폴더에서는 이 검사가 **늘 빨강**이었다(제품이 아니라 재료 문제).
   ⇒ 없으면 옆 리포에서 빌리고, 그래도 없으면 **exit 2(«못 쟀다»)** 로 끝낸다 — «통과»라고 말하지 않는다. */
const { chromium } = (await requirePlaywright()) as typeof import("playwright");
const { gotoFirst, hasContent } = await import(pathToFileURL(path.join(ROOT, "runner", "lib", "scrape.mjs")).href) as {
  gotoFirst: (p: unknown, urls: string[], accept: (p: unknown) => Promise<boolean>, settleMs?: number) => Promise<string | null>;
  hasContent: (p: unknown, min?: number) => Promise<boolean>;
};

/** 늦게 그려지는 화면(SPA) 을 흉내낸다 — `?delay=` 밀리초 뒤에 내용이 생긴다. */
const page = (delayMs: number, text: string) => `<html><body><div id="app"></div>
<script>setTimeout(function(){document.getElementById('app').textContent=${JSON.stringify(text)};}, ${delayMs});</script>
</body></html>`;

const ROUTES: Record<string, string> = {
  "/fast": page(0, "수입 현황 표가 여기 있습니다. 일자 금액 2026-09-14 1,200원 합계"),
  "/slow": page(1200, "수입 현황 표가 여기 있습니다. 일자 금액 2026-09-14 1,200원 합계"),
  "/never": page(99_000, "이 화면은 검사 시간 안에 절대 안 그려진다"),
};

const server = http.createServer((r, res) => {
  const p = new URL(r.url ?? "/", "http://x").pathname;
  const body = ROUTES[p];
  if (!body) { res.writeHead(404); res.end("no"); return; }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
});

await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
const addr = server.address();
const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

const b = await chromium.launch({ headless: true });
const pg = await b.newPage();
let pass = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail: string, why: string) => {
  if (ok) pass++; else fails.push(`${name} — ${detail}  (${why})`);
  console.log(`  ${ok ? "✓" : "✗"} ${name.padEnd(46)} ${detail}`);
};

console.log(`\n  «준비됐나» 판정 실측 (진짜 DOM · 늦게 그려지는 화면)  ${base}\n`);

/* ① 바로 그려지는 화면 — 당연히 찾는다(기준선). */
{
  const t0 = Date.now();
  const got = await gotoFirst(pg, [`${base}/fast`], async (p) => await hasContent(p), 300);
  check("바로 그려지는 화면", got !== null, `${got ? "찾음" : "못 찾음"} · ${Date.now() - t0}ms`, "기준선");
}

/* ② 🔴 늦게 그려지는 화면 — **짧게 잤다고 «내용 없음»으로 단정하면 안 된다.**
   조건이 참이 될 때까지 훑으면 1.2초 뒤에 찾아진다. 고정 수면이면 300ms 에 재고 포기한다. */
{
  const t0 = Date.now();
  const got = await gotoFirst(pg, [`${base}/slow`], async (p) => await hasContent(p), 300);
  check("🔴 1.2초 뒤에 그려지는 화면(짧은 대기값)", got !== null,
    `${got ? "찾음" : "못 찾음"} · ${Date.now() - t0}ms`,
    "🔴 못 찾으면 «주소를 못 찾았어요(우리 버그)»라는 거짓 보고가 나간다 — 화면은 멀쩡했다");
}

/* ③ 음성 대조 — 영영 안 그려지는 화면을 **찾았다고 하면 안 된다**(마냥 기다려 주는 것도 답이 아니다). */
{
  const t0 = Date.now();
  const got = await gotoFirst(pg, [`${base}/never`], async (p) => await hasContent(p), 300);
  const ms = Date.now() - t0;
  check("음성① 영영 안 그려지는 화면", got === null, `${got ? "🔴 찾았다고 함" : "못 찾음"} · ${ms}ms`,
    "🔴 안 그려진 화면을 «도착»으로 읽으면 빈 표를 «수익 0원»으로 적는다");
  check("음성② 그 대기가 무한이 아니다", ms < 20_000, `${ms}ms 만에 포기`, "잡이 큐를 붙들면 안 된다");
}

/* ④ 🔴 빠르면 빨리 돌아온다 — 조건이 참이 되는 즉시 나와야 잡 시간을 안 버린다.
   («언제나 최대치만큼 잔다»면 그건 그냥 고정 수면이다.) */
{
  const t0 = Date.now();
  await gotoFirst(pg, [`${base}/fast`], async (p) => await hasContent(p), 8000);
  const ms = Date.now() - t0;
  check("🔴 대기값이 커도 준비되면 바로 나온다", ms < 6000, `${ms}ms (대기값 8000)`,
    "🔴 최대치를 다 자면 잡마다 몇 초씩 버리고 크론 예산을 갉아먹는다");
}

await b.close();
await new Promise<void>((ok) => server.close(() => ok()));

console.log(`\n  통과 ${pass}/5`);
if (fails.length) { console.error("\n  ✗ 실패:\n" + fails.map((f) => `    · ${f}`).join("\n") + "\n"); process.exitCode = 1; }
else console.log("\n  ✓ «준비됐나»를 조건으로 판정한다(잠으로 대신하지 않는다).\n");
