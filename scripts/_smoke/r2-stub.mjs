// 로컬 스모크용 S3 호환 스텁(PUT 200 저장 · GET 반환) — 라이브 R2 자격이 없을 때 «글 경로»를 끝까지 재현하기 위한 하니스. 커밋 대상 아님(scripts/_smoke).
import http from "node:http";
const store = new Map();
http.createServer((req, res) => {
  const key = decodeURIComponent(req.url.replace(/^\/[^/]+\//, ""));
  if (req.method === "PUT") { const ch = []; req.on("data", (c) => ch.push(c)); req.on("end", () => { store.set(key, Buffer.concat(ch)); res.writeHead(200, { ETag: '"stub"' }); res.end(); }); return; }
  if (req.method === "GET") { const b = store.get(key); if (!b) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": "image/png", "Content-Length": b.length }); return res.end(b); }
  res.writeHead(200); res.end();
}).listen(3903, () => console.log("r2-stub on 3903"));
