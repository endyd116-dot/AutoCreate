// 스모크 전용 정적 서버 — netlify dev 의 내장 정적 서버(고정 포트 3999)를 피하려고 쓴다.
//   같은 PC 에서 A·C 세션도 netlify dev 를 돌리는데 3999 는 하나뿐이라 두 번째부터 EADDRINUSE 로 죽는다.
//   `netlify dev --command "node scripts/_smoke/_static.mjs" --target-port <내 포트>` 로 붙인다.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const PORT = Number(process.env.PORT || process.argv[2] || 3995);
const ROOT = path.resolve("public");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  let p = path.join(ROOT, url);
  if (!p.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p)) { res.writeHead(404).end("not found"); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => console.log(`static ${PORT} ← ${ROOT}`));
