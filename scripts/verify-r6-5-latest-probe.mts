/** scripts/verify-r6-5-latest-probe.mts — R2 `autocreate/runner/latest.json` 을 그대로 찍는다(C 하니스 ⑤가 응답 sha256 과 대조). */
import { r2Get } from "../lib/r2";
const g = await r2Get("autocreate/runner/latest.json");
console.log(g ? Buffer.from(g.bytes).toString("utf8") : "null");
process.exit(0);
