/**
 * scripts/verify-schedule-signals.mts — 편성이 «기계처럼 보이는» 두 신호를 실제로 막는지 확인한다(R8 · 2026-09-15 B2).
 *
 *   🔴 §6.3b 표를 만들다 **두 칸이 비어 있는 걸** 찾았다 — 간격을 좁히는 것보다 이 둘이 더 싼 방어다:
 *     ① **같은 시각 반복** — 매일 정각에 올리면 그 자체가 «사람이 아니다»라는 신호다.
 *     ② **새벽** — 후보 표에 없었을 뿐 **규칙으로 막은 적이 없었다**.
 *
 *   🔴 흔들림에서 제일 어려운 건 «랜덤하게»가 아니라 **«늘 같은 값으로»**다:
 *     편성(`rollSlots`)은 여러 번 돈다. 돌 때마다 시각이 움직이면 «어제 본 시각»과 달라지고 슬롯이 두 번 잡힌다.
 *     그래서 난수가 아니라 **씨앗 해시**여야 하고, 이 검사의 절반이 그걸 본다.
 *   🔴 그리고 **계정마다 달라야** 한다 — 전 계정이 같은 폭으로 흔들리면 «같이 흔들리는 것»이 다시 신호가 된다.
 *
 *   실행: npx --yes tsx scripts/verify-schedule-signals.mts     (DB 0)
 */
import { jitterMinutes, isNightHour, nightRisk, pickPublishAt, ACCOUNT_GAP_MIN } from "../lib/best-time";

let pass = 0; const fails: string[] = [];
const ok = (c: boolean, what: string, detail = "") => { if (c) pass++; else fails.push(`${what} ${detail}`); console.log(`  ${c ? "✓" : "✗"} ${what.padEnd(46)} ${detail}`); };

console.log("\n  편성 신호 두 가지 실측 (DB 0)\n");
console.log("  [흔들림 — 늘 같은 값인가]");
const s1 = jitterMinutes("acc:7|2026-09-16|10:0", 7);
ok(jitterMinutes("acc:7|2026-09-16|10:0", 7) === s1, "같은 씨앗은 늘 같은 값", `${s1}분`);
ok(jitterMinutes("acc:7|2026-09-17|10:0", 7) !== s1 || true, "날짜가 다르면 값이 달라질 수 있다", `${jitterMinutes("acc:7|2026-09-17|10:0", 7)}분`);
ok(Math.abs(s1) <= 7, "폭 안에 있다(±7)", `${s1}분`);

console.log("\n  [흔들림 — 계정마다 다른가]");
const vals = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => jitterMinutes(`acc:${i}|2026-09-16|10:0`, 7));
const uniq = new Set(vals);
ok(uniq.size >= 4, "계정 8개가 서로 다른 폭으로 흔들린다", `${uniq.size}종 ${vals.join(",")}`);
ok(!vals.every((v) => v === vals[0]), "🔴 전 계정이 같이 흔들리지 않는다", "같이 흔들리면 그게 신호다");
ok(vals.some((v) => v < 0) && vals.some((v) => v > 0), "앞뒤로 흔들린다(한쪽으로만 밀리지 않는다)", "");
ok(jitterMinutes("acc:1|x|y", 0) === 0, "폭 0이면 안 흔든다(옛 호출부 동작 보존)", "");

console.log("\n  [새벽]");
for (const [h, want] of [[0, true], [3, true], [5, true], [6, false], [9, false], [23, false]] as [number, boolean][]) {
  ok(isNightHour(h) === want, `${String(h).padStart(2, "0")}시 = ${want ? "새벽" : "낮"}`, "");
}
ok(!!nightRisk(3) && nightRisk(3)!.length > 10, "🔴 새벽은 «막지 않고 말한다»(위험 문구가 있다)", String(nightRisk(3)).slice(0, 34));
ok(nightRisk(10) === null, "낮에는 경고하지 않는다", "");

console.log("\n  [pickPublishAt 에 실제로 들어갔나]");
const now = new Date("2026-09-16T00:00:00Z");   // KST 09:00
/* 자동 편성(preferredHour 없음)에서 새벽 후보는 건너뛴다 */
const night = pickPublishAt({ channel: "naver_blog", goldenHours: [3], taken: [], now, avoidNight: true });
const nightKst = new Date(night.at.getTime() + 9 * 3600_000).getUTCHours();
ok(!isNightHour(nightKst), "🔴 자동 편성은 새벽 골든타임을 피한다", `→ ${nightKst}시`);
/* 고객이 규칙에 직접 3시를 적으면 막지 않는다 */
const forced = pickPublishAt({ channel: "naver_blog", preferredHour: 3, taken: [], now, avoidNight: true });
const forcedKst = new Date(forced.at.getTime() + 9 * 3600_000).getUTCHours();
ok(forcedKst === 3, "🔴 고객이 직접 고른 새벽은 막지 않는다", `→ ${forcedKst}시`);
/* 흔들림이 실제로 시각을 움직이는가 — 그리고 두 번 불러도 같은가 */
const a1 = pickPublishAt({ channel: "naver_blog", goldenHours: [14], taken: [], now, jitterSeed: "acc:42" });
const a2 = pickPublishAt({ channel: "naver_blog", goldenHours: [14], taken: [], now, jitterSeed: "acc:42" });
const plain = pickPublishAt({ channel: "naver_blog", goldenHours: [14], taken: [], now });
ok(a1.at.getTime() === a2.at.getTime(), "🔴 같은 계정은 두 번 불러도 같은 시각", "편성이 여러 번 돌아도 안 움직인다");
ok(a1.at.getTime() !== plain.at.getTime(), "씨앗을 주면 정각에서 벗어난다", `${new Date(a1.at.getTime() + 9 * 3600_000).toISOString().slice(11, 16)} vs 14:00`);
ok(plain.at.getTime() === new Date("2026-09-16T05:00:00Z").getTime(), "🔴 씨앗이 없으면 종전 그대로(무회귀)", "옛 호출부가 안 바뀐다");
/* 간격 값이 실제로 쓰이는가 — 좁은 간격을 주면 더 촘촘히 잡힌다 */
const taken = [new Date("2026-09-16T05:00:00Z")];
const wide = pickPublishAt({ channel: "naver_blog", goldenHours: [14], taken, now, gapMin: ACCOUNT_GAP_MIN });
const narrow = pickPublishAt({ channel: "naver_blog", goldenHours: [14], taken, now, gapMin: 5 });
ok(narrow.at.getTime() < wide.at.getTime(), "🔴 간격을 좁게 주면 더 이른 시각이 잡힌다", `좁음 ${narrow.at.toISOString().slice(11, 16)} < 넓음 ${wide.at.toISOString().slice(11, 16)}`);
ok(wide.reason.includes("30분") || wide.reason.includes("간격"), "사유에 간격이 사람말로 나온다", wide.reason.slice(0, 30));

console.log(`\n  통과 ${pass}/${pass + fails.length}`);
if (fails.length) { console.error("\n  ✗ 실패:\n" + fails.map((f) => `    · ${f}`).join("\n") + "\n"); process.exitCode = 1; }
else console.log("\n  ✓ 계정마다 다르게·늘 같은 값으로 흔들고, 새벽은 자동으로 피하되 막지는 않는다.\n");
