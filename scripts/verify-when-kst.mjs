/**
 * scripts/verify-when-kst.mjs — [R17-B2 · 2026-09-23] `UI.whenKST` 가 **맞는 말을 내나**(순수 함수 · DB 0).
 *
 *   ══ 왜 재나 ══
 *   전수조사 §2.3 은 수익 신선도가 «3시간 전 가져옴»이라 **하루 지난 값인지 오늘 아침 값인지 구분이 안 된다**고 적었다.
 *   고쳐서 «어제 12:30 기준»으로 바꿨는데 — 🔴 **«어제»를 어느 시계로 가르나**가 진짜 문제다.
 *   `Date` 의 로컬 날짜로 가르면 **해외에 있는 고객 화면에서 «어제»가 하루 밀린다**(§13.5 «표시는 KST 전면»).
 *   ⇒ 이 자는 `TZ` 를 바꿔 가며 **같은 값이 나오나**를 본다. 시계를 바꿔도 안 바뀌어야 맞다.
 *
 *   쓰기: node scripts/verify-when-kst.mjs      (TZ 는 자가 스스로 바꿔 가며 잰다)
 */
import { readFileSync } from "node:fs";

/* `public/js/ui.js` 는 브라우저 전역(UI)에 매다는 파일이라 import 가 안 된다 —
   🔴 함수 **원문을 그대로 떼어** 평가한다(베껴 적으면 두 벌이 되고, 고친 쪽만 초록이 된다 · AC-52). */
const src = readFileSync("public/js/ui.js", "utf8");
const grab = (name, re) => { const m = re.exec(src); if (!m) { console.log(`🔴 ${name} 를 못 떼었다 — ui.js 모양이 바뀌었다(정규식이 빗나갔다)`); process.exit(1); } return m[0]; };
const utcSrc = grab("UI.utc", /UI\.utc = [^\n]+\n/);
const timeSrc = grab("UI.timeKST", /UI\.timeKST = [^\n]+\n/);
const dateSrc = grab("UI.dateKST", /UI\.dateKST = [^\n]+\n/);
const whenSrc = grab("UI.whenKST", /UI\.whenKST = \(iso\) => \{[\s\S]*?\n  \};/);

const UI = {};
new Function("UI", `${utcSrc}${timeSrc}${dateSrc}${whenSrc}`)(UI);

const fails = [];
const ok = (cond, say) => { console.log(`   ${cond ? "✓" : "✗"} ${say}`); if (!cond) fails.push(say); };

/* KST 기준으로 «오늘 09:05»·«어제 23:40»·«그저께» 에 해당하는 UTC 시각을 만든다.
   KST = UTC+9 라 «KST 오늘 09:05» = «UTC 오늘 00:05». */
const kstDay = (d) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const atKst = (daysAgo, hh, mm) => {
  const now = new Date();
  const [Y, M, D] = kstDay(new Date(now.getTime() - daysAgo * 86400e3)).split("-").map(Number);
  return new Date(Date.UTC(Y, M - 1, D, hh - 9, mm)).toISOString();   // KST hh:mm → UTC
};

console.log("\n── UI.whenKST — «언제 것인가»를 절대 시각으로 ──");
const today = atKst(0, 9, 5), yday = atKst(1, 23, 40), older = atKst(4, 12, 30);

ok(UI.whenKST(today).startsWith("오늘 "), `오늘 것은 «오늘»로 말한다 → «${UI.whenKST(today)}»`);
ok(UI.whenKST(yday).startsWith("어제 "), `어제 것은 «어제»로 말한다 → «${UI.whenKST(yday)}»`);
ok(!/오늘|어제/.test(UI.whenKST(older)), `그 앞은 날짜로 말한다 → «${UI.whenKST(older)}»`);
ok(/\d{2}:\d{2}$/.test(UI.whenKST(today)), `시각이 붙는다(설계 예시 «어제 12:30 기준») → «${UI.whenKST(today)}»`);
ok(UI.whenKST(older).includes("12:30"), `KST 12:30 이 12:30 으로 보인다(UTC 03:30 이 아니라) → «${UI.whenKST(older)}»`);
ok(UI.whenKST(null) === "" && UI.whenKST("") === "" && UI.whenKST("어쩌구") === "",
  "값이 없거나 이상하면 **빈 문자열**이다 — «Invalid Date» 를 화면에 내보내지 않는다");

/* 🔴 본론 — 시계를 바꿔도 같은 말이 나오나. `Intl` 은 프로세스 TZ 를 보므로 실제로 바꿔 가며 잰다. */
console.log("\n   시계를 바꿔 가며(같은 값이 나와야 맞다)");
const want = [UI.whenKST(today), UI.whenKST(yday), UI.whenKST(older)];
for (const tz of ["UTC", "America/New_York", "Australia/Sydney", "Asia/Seoul"]) {
  process.env.TZ = tz;
  const got = [UI.whenKST(today), UI.whenKST(yday), UI.whenKST(older)];
  ok(JSON.stringify(got) === JSON.stringify(want), `${tz.padEnd(18)} → ${got.join(" · ")}`);
}
process.env.TZ = "Asia/Seoul";

console.log(fails.length ? `\n🔴 ${fails.length}건 실패\n` : "\n✅ 어느 시계에서 봐도 KST 로 같은 말을 한다\n");
process.exit(fails.length ? 1 : 0);
