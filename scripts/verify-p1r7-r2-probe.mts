/**
 * scripts/verify-p1r7-r2-probe.mts — 탈퇴 파기 뒤 **R2 잔재**를 센다(C · R7 §5-③).
 *   `npx tsx --env-file=.env scripts/verify-p1r7-r2-probe.mts --tid <테스트 테넌트>`
 *   🔴 읽기만 한다(지우지 않는다) — «파기가 됐나»를 확인하는 자리이지 파기하는 자리가 아니다.
 *   출력 마지막 줄: `REMAIN <개수>` (하니스가 그 숫자만 읽는다)
 */
import { r2ListPrefix, r2Configured } from "../lib/r2";

const tid = Number(process.argv[process.argv.indexOf("--tid") + 1] || 0);
if (!Number.isInteger(tid) || tid <= 0) { console.log("tid 가 필요하다"); console.log("REMAIN -1"); process.exit(0); }
if (!r2Configured()) { console.log("R2 키 없음 — 셀 수 없다(정직)"); console.log("REMAIN -1"); process.exit(0); }
const keys = await r2ListPrefix(`autocreate/${tid}/`, 5000).catch((e) => { console.log("목록 실패:", String((e as Error)?.message ?? e).slice(0, 100)); return null; });
if (keys === null) { console.log("REMAIN -1"); process.exit(0); }
if (keys.length) console.log("남은 키 예시:", keys.slice(0, 5).join(" · "));
console.log(`REMAIN ${keys.length}`);
process.exit(0);
