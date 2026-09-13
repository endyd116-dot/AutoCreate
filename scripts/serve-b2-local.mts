/**
 * scripts/serve-b2-local.mts — B2 러너 왕복 검증용 **로컬 전용** 함수 서버(검증 하니스).
 *   실행: `npx tsx --env-file=.env scripts/serve-b2-local.mts`  → http://127.0.0.1:8899
 *
 *   왜 netlify dev 가 아니라 이것인가: netlify dev 는 함수가 404 를 내면 같은 경로에 `.html` 을 붙여 다시 부르고
 *   **마지막 시도의 응답**이 클라이언트에 간다(PITFALLS AC-7) — 라이브에 없는 가짜 증상이 섞인다.
 *   여기서는 `netlify/functions/runner.ts` 의 **default export 를 그대로** 불러 진짜 Request/Response 로 왕복시킨다.
 *
 *   ⚠️ 127.0.0.1 에만 바인드한다. 배포물이 아니다(운영에 올리지 않는다).
 *   ⚠️ `config.path` 목록을 그대로 읽어 라우팅한다 — 경로 누락(=라이브 404)도 여기서 잡힌다.
 */
import http from "node:http";
import handler, { config } from "../netlify/functions/runner";

const PORT = Number(process.env.PORT ?? 8899);
const PATHS: string[] = Array.isArray(config?.path) ? config.path : [String(config?.path ?? "")];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (!PATHS.includes(url.pathname)) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "no_route", step: "harness", known: PATHS }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);

  const request = new Request(url.toString(), {
    method: req.method ?? "GET",
    headers,
    ...(body.length && req.method !== "GET" ? { body } : {}),
  });
  try {
    const out = await handler(request);
    const text = await out.text();
    const h: Record<string, string> = {};
    out.headers.forEach((v, k) => { h[k] = v; });
    res.writeHead(out.status, h);
    res.end(text);
    console.log(`${req.method} ${url.pathname} → ${out.status} ${text.slice(0, 120)}`);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }));
    console.error(`${req.method} ${url.pathname} → 500`, e);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  B2 로컬 함수 서버 → http://127.0.0.1:${PORT}`);
  console.log(`  경로 ${PATHS.length}개: ${PATHS.join(" ")}\n`);
});
