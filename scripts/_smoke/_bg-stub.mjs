// 스모크 전용 배경 함수 스텁 — POST 무엇이든 202 즉시.
//   왜: `netlify dev` 는 `-background` 함수를 **동기로** 실행한다(프로덕션은 202 즉시 반환).
//   그래서 크론 produce 가 triggerGenerate 에서 생성이 끝날 때까지(수 분) 막혀 함수 타임아웃 500 이 난다 — 로컬 한정 인공물.
//   크론 스텝 자체를 재려면 생성 파이프라인(R1 에서 이미 실증)을 떼어 놓아야 한다.
import http from "node:http";
let n = 0;
http.createServer((req, res) => {
  n++; console.log(`bg-stub #${n} ${req.method} ${req.url}`);
  req.resume();
  res.writeHead(202, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, stub: true }));
}).listen(3990, () => console.log("bg-stub 3990"));
