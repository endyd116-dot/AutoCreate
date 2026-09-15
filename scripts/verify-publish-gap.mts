/**
 * scripts/verify-publish-gap.mts — 계정 간 간격 판정이 **무엇을 근거로** 폭을 주는지 확인한다(R8 · 2026-09-15 B2).
 *
 *   🔴 이 판정의 핵심은 «5분으로 내린다»가 아니라 **«무엇을 알 때만 내릴 수 있게 하는가»**다.
 *      제일 위험한 실수는 «프록시가 배정됐다»를 «IP 가 다르다»로 읽는 것이다(AC-57) —
 *      프록시는 죽어 있을 수 있고, 그러면 우리 집 IP 로 나가면서 «전용 IP 라 안전하다»고 믿게 된다.
 *      그래서 **러너가 실제로 잰 출구 IP** 가 있을 때만 폭을 준다. 그 규율이 지켜지는지가 이 검사의 전부다.
 *
 *   🔴 음성 대조 둘: ①모르면 안 준다 ②전부 안 주면 기능이 없는 것이다.
 *   실행: npx --yes tsx scripts/verify-publish-gap.mts      (DB 0)
 */
import { decideGap, ACCOUNT_GAP_MIN_DEFAULT, ACCOUNT_GAP_MIN_FLOOR } from "../lib/publish-gap";

const A = "203.0.113.10", B = "203.0.113.20";
interface C { name: string; inp: Parameters<typeof decideGap>[0]; floor: number; basis: string; why: string }
const CASES: C[] = [
  { name: "같은 채널에 이 계정뿐", inp: { hasProxy: false, myExitIp: null, others: [] },
    floor: ACCOUNT_GAP_MIN_FLOOR, basis: "only_account", why: "부딪힐 상대가 없다" },
  { name: "프록시 없음(같은 집 IP)", inp: { hasProxy: false, myExitIp: null, others: [{ accountId: 2, exitIp: null }] },
    floor: ACCOUNT_GAP_MIN_DEFAULT, basis: "shared_ip", why: "🔴 같은 IP 에서 붙여 올리면 연좌제의 원인" },
  { name: "🔴 프록시 배정만 · 아직 안 쟀다", inp: { hasProxy: true, myExitIp: null, others: [{ accountId: 2, exitIp: B }] },
    floor: ACCOUNT_GAP_MIN_DEFAULT, basis: "proxy_assigned_unverified",
    why: "🔴 «배정됨»을 «다르다»로 읽으면 죽은 프록시를 안전하다고 믿는다(AC-57)" },
  { name: "🔴 내 IP 는 쟀는데 상대를 못 쟀다", inp: { hasProxy: true, myExitIp: A, others: [{ accountId: 2, exitIp: null }] },
    floor: ACCOUNT_GAP_MIN_DEFAULT, basis: "proxy_assigned_unverified",
    why: "🔴 모르는 쪽을 «다르다»로 유리하게 읽지 않는다(AC-9)" },
  { name: "🔴 실제로 같은 IP 였다", inp: { hasProxy: true, myExitIp: A, others: [{ accountId: 2, exitIp: A }] },
    floor: ACCOUNT_GAP_MIN_DEFAULT, basis: "shared_ip", why: "🔴 프록시가 있어도 같은 IP 면 소용없다" },
  { name: "✅ 둘 다 쟀고 서로 다르다", inp: { hasProxy: true, myExitIp: A, others: [{ accountId: 2, exitIp: B }] },
    floor: ACCOUNT_GAP_MIN_FLOOR, basis: "measured_distinct_ip", why: "여기서만 폭을 준다" },
  { name: "✅ 셋 다 쟀고 전부 다르다", inp: { hasProxy: true, myExitIp: A, others: [{ accountId: 2, exitIp: B }, { accountId: 3, exitIp: "198.51.100.7" }] },
    floor: ACCOUNT_GAP_MIN_FLOOR, basis: "measured_distinct_ip", why: "여러 개여도 전부 달라야 한다" },
  { name: "🔴 셋 중 하나가 같다", inp: { hasProxy: true, myExitIp: A, others: [{ accountId: 2, exitIp: B }, { accountId: 3, exitIp: A }] },
    floor: ACCOUNT_GAP_MIN_DEFAULT, basis: "shared_ip", why: "🔴 하나만 겹쳐도 안 준다" },
];

let pass = 0; const fails: string[] = [];
console.log("\n  계정 간 간격 판정 (순수 함수 · DB 0)\n");
for (const c of CASES) {
  const d = decideGap(c.inp);
  const ok = d.floorMin === c.floor && d.basis === c.basis && d.gapMin === ACCOUNT_GAP_MIN_DEFAULT && d.risk.length > 10;
  if (ok) pass++; else fails.push(`${c.name} — 기대 floor ${c.floor}/${c.basis} · 실제 ${d.floorMin}/${d.basis}  (${c.why})`);
  console.log(`  ${ok ? "✓" : "✗"} ${c.name.padEnd(30)} 바닥 ${String(d.floorMin).padStart(2)}분 · ${d.basis.padEnd(26)} ${c.why}`);
}

/* 🔴 ① 모르면 안 준다 — «못 쟀다»가 하나라도 있으면 폭이 없어야 한다. */
const unknownGivesWidth = CASES.filter((c) => c.basis === "proxy_assigned_unverified" && decideGap(c.inp).floorMin < ACCOUNT_GAP_MIN_DEFAULT);
console.log(`\n  ${unknownGivesWidth.length === 0 ? "✓" : "✗"} 모르면 폭을 주지 않는다`);
if (unknownGivesWidth.length) fails.push("모르는데 폭을 줬다 — 죽은 프록시를 안전하다고 믿게 된다");

/* 🔴 ② 전부 막으면 기능이 없는 것이다. */
const widened = CASES.filter((c) => decideGap(c.inp).floorMin < ACCOUNT_GAP_MIN_DEFAULT);
console.log(`  ${widened.length >= 2 ? "✓" : "✗"} 폭을 주는 경우가 살아 있다(${widened.length}건)`);
if (widened.length < 2) fails.push("전부 30분이면 사장님이 원하신 10:00/10:05 가 영원히 안 된다");

/* 🔴 ③ 근거가 갈려 나오나 — 한 종류만 나오면 판정이 헛돈다. */
const bases = new Set(CASES.map((c) => decideGap(c.inp).basis));
console.log(`  ${bases.size >= 4 ? "✓" : "✗"} 근거가 갈린다(${[...bases].join(", ")})`);
if (bases.size < 4) fails.push("근거가 한쪽으로 쏠렸다");

/* 🔴 ④ 위험 문구가 경우마다 다른가 — 같은 말이면 고객이 왜 30분인지 모른다. */
const risks = new Set(CASES.map((c) => decideGap(c.inp).risk));
console.log(`  ${risks.size >= 4 ? "✓" : "✗"} 위험 안내가 경우마다 다르다(${risks.size}종)`);
if (risks.size < 4) fails.push("안내 문구가 겹친다 — 고객이 왜 못 줄이는지 모른다");

console.log(`\n  통과 ${pass}/${CASES.length}`);
if (fails.length) { console.error("\n  ✗ 실패:\n" + fails.map((f) => `    · ${f}`).join("\n") + "\n"); process.exitCode = 1; }
else console.log("\n  ✓ 실제로 잰 IP 가 다를 때만 폭을 준다(모르면 안 준다).\n");
