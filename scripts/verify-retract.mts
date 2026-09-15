/**
 * scripts/verify-retract.mts — «내릴 수 있나» 판정이 **정직한지** 확인한다(R8 §3 · DESIGN §5E · 2026-09-15 B2).
 *
 *   🔴 이 기능은 **되돌릴 수 없는 일**을 한다. 그래서 검사도 두 방향을 본다:
 *     ① **못 내리는 채널을 열지 않는가**(되는 척 금지 — 없는 단추를 만들면 고객이 눌렀는데 아무 일도 안 난다)
 *     ② 🔴 **내릴 수 있는 채널을 닫아 버리지 않는가**(전부 막으면 «안전»이 아니라 **기능이 없는 것**이다)
 *
 *   🔴 «올릴 수 있다»가 «내릴 수 있다»가 아니라는 것도 여기서 고정한다 —
 *      유튜브는 **올리는 스코프만** 있고(`youtube.upload`) `videos.delete` 권한이 없다.
 *      표에서 그걸 `retractVia: null` 로 적어 두지 않으면 «API 채널이니 되겠지»로 새어 나간다.
 *
 *   실행: npx --yes tsx scripts/verify-retract.mts        (DB·네트워크 0)
 */
import { retractViaOf, canRetract, publishViaOf } from "../lib/channel-registry";

interface C { ch: string; retract: string | null; why: string }
const CASES: C[] = [
  { ch: "naver_blog", retract: "runner", why: "러너가 브라우저로 지운다" },
  { ch: "tistory", retract: "runner", why: "러너가 브라우저로 지운다" },
  { ch: "wordpress", retract: "api", why: "앱 비밀번호로 DELETE wp/v2/posts — 추가 권한 없음" },
  { ch: "blogger", retract: "api", why: "OAuth 스코프가 auth/blogger(전체)라 posts.delete 가 된다" },
  { ch: "youtube_shorts", retract: null, why: "🔴 올릴 수는 있는데 못 내린다 — youtube.upload 에 videos.delete 가 없다" },
  { ch: "naver_clip", retract: null, why: "🔴 올리지도 못한다(앱 전용)" },
  { ch: "threads", retract: null, why: "🔴 삭제 엔드포인트를 확인 못 했다 — 확인 못 한 길을 열지 않는다" },
  { ch: "reels", retract: null, why: "커넥터 없음" },
  { ch: "instagram", retract: null, why: "커넥터 없음" },
  { ch: "tiktok", retract: null, why: "커넥터 없음" },
  { ch: "없는채널", retract: null, why: "🔴 모르는 채널을 추측해서 열지 않는다" },
];

let pass = 0; const fails: string[] = [];
console.log("\n  내리기 경로 판정 (순수 함수 · DB 0)\n");
for (const c of CASES) {
  const got = retractViaOf(c.ch);
  const ok = got === c.retract && canRetract(c.ch) === (c.retract !== null);
  if (ok) pass++; else fails.push(`${c.ch} — 기대 ${c.retract} · 실제 ${got}  (${c.why})`);
  console.log(`  ${ok ? "✓" : "✗"} ${c.ch.padEnd(15)} 올리기=${String(publishViaOf(c.ch)).padEnd(7)} 내리기=${String(got).padEnd(7)} ${c.why}`);
}

/* 🔴 ①: 못 내리는 채널이 열려 있지 않은가 */
const wrongOpen = CASES.filter((c) => c.retract === null && canRetract(c.ch));
console.log(`\n  ${wrongOpen.length === 0 ? "✓" : "✗"} 못 내리는 채널이 열려 있지 않다`);
if (wrongOpen.length) fails.push(`열리면 안 되는 채널이 열렸다: ${wrongOpen.map((c) => c.ch).join(", ")}`);

/* 🔴 ②: 내릴 수 있는 채널이 살아 있는가 — 전부 막으면 «안전»이 아니라 기능이 없는 것이다 */
const open = CASES.filter((c) => canRetract(c.ch));
console.log(`  ${open.length >= 4 ? "✓" : "✗"} 내릴 수 있는 채널이 살아 있다(${open.length}개: ${open.map((c) => c.ch).join(", ")})`);
if (open.length < 4) fails.push("전부 막혔다 — 이건 «안전»이 아니라 기능이 없는 것이다");

/* 🔴 «올릴 수 있는데 못 내리는» 채널이 실제로 구분되는가 — 이걸 뭉개면 유튜브가 조용히 열린다 */
const asym = CASES.filter((c) => publishViaOf(c.ch) !== null && retractViaOf(c.ch) === null).map((c) => c.ch);
console.log(`  ${asym.length > 0 ? "✓" : "✗"} «올리기는 되는데 내리기는 안 되는» 채널을 구분한다(${asym.join(", ") || "없음"})`);
if (!asym.length) fails.push("올리기/내리기를 한 값으로 뭉갰다 — 유튜브가 조용히 열린다");

console.log(`\n  통과 ${pass}/${CASES.length}`);
if (fails.length) { console.error("\n  ✗ 실패:\n" + fails.map((f) => `    · ${f}`).join("\n") + "\n"); process.exitCode = 1; }
else console.log("\n  ✓ 내릴 수 있는 채널만 열고, 나머지는 «직접 내려 주세요»로 보낸다.\n");
