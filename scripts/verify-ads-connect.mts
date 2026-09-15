/**
 * scripts/verify-ads-connect.mts — «광고 붙이기» 길 판정이 **정직하게 막는지** 확인한다(R8 §3.2 · 2026-09-15 B2).
 *
 *   🔴 왜: 이 기능이 없던 이유가 «코드가 없어서»가 아니라 **«문이 없어서»**였다.
 *      `lib/publish/ads.ts`(128줄)도, `ads.setup_*` 잡 4종(종류·우선순위·보고 처리·러너 채널)도 다 있었는데
 *      **부르는 사람이 0명**이었다 — `verify.post_alive` 와 같은 모양이다.
 *      문을 새로 내는 김에, **«길이 없는 채널을 되는 척하지 않는지»**를 검사로 박아 둔다
 *      (B3 의 `publishVia: null` 규율과 같은 것 — «곧 될 거니까 미리 api 로»가 지금 구멍의 원인이었다).
 *
 *   🔴 DB 0 — 길 판정은 순수 함수다. 실제 삽입은 남의 사이트를 건드리는 일이라 여기서 돌리지 않는다.
 *   실행: npx --yes tsx scripts/verify-ads-connect.mts
 */
import { adsWayOf, adsRemovable, adsConnectable } from "../lib/ads-connect";

interface C { channel: string; way: string | null; connect: boolean; disconnect: boolean; why: string }
const CASES: C[] = [
  { channel: "wordpress", way: "wp_widget",      connect: true,  disconnect: true,  why: "코어 REST 로 우리가 직접 · 되돌리기 있음" },
  { channel: "blogger",   way: "runner_blogger", connect: true,  disconnect: true,  why: "러너가 템플릿에 넣고 뺀다(백업 원문 보관)" },
  { channel: "tistory",   way: "runner_tistory", connect: true,  disconnect: false, why: "🔴 러너가 **상태를 읽기만** 한다 — 뗄 코드가 없으니 «뗐어요»라고 하면 거짓말" },
  /* ── 🔴 음성 대조: 길이 없는 채널이 **전부 막혀야** 한다 ── */
  { channel: "naver_blog", way: null, connect: false, disconnect: false, why: "🔴 애드센스를 붙일 길이 없다(네이버는 애드포스트다)" },
  { channel: "instagram",  way: null, connect: false, disconnect: false, why: "🔴 커넥터도 없다" },
  { channel: "tiktok",     way: null, connect: false, disconnect: false, why: "🔴 커넥터도 없다" },
  { channel: "threads",    way: null, connect: false, disconnect: false, why: "🔴 길 없음" },
  { channel: "youtube",    way: null, connect: false, disconnect: false, why: "🔴 유튜브 광고는 YPP 지 우리가 붙이는 게 아니다" },
  { channel: "",           way: null, connect: false, disconnect: false, why: "빈 값" },
  { channel: "없는채널",     way: null, connect: false, disconnect: false, why: "🔴 모르는 채널을 추측해서 열어 주지 않는다" },
];

let pass = 0; const fails: string[] = [];
console.log("\n  광고 붙이기 길 판정 (순수 함수 · DB 0)\n");
for (const c of CASES) {
  const way = adsWayOf(c.channel);
  const s = adsConnectable(c.channel);
  const bad: string[] = [];
  if (way !== c.way) bad.push(`way 기대 ${c.way} · 실제 ${way}`);
  if (s.connect !== c.connect) bad.push(`connect 기대 ${c.connect} · 실제 ${s.connect}`);
  if (s.disconnect !== c.disconnect) bad.push(`disconnect 기대 ${c.disconnect} · 실제 ${s.disconnect}`);
  if (adsRemovable(way) !== c.disconnect) bad.push(`adsRemovable 이 adsConnectable 과 다르다`);
  if (!bad.length) pass++; else fails.push(`${c.channel || "(빈값)"} — ${bad.join(" · ")}  (${c.why})`);
  console.log(`  ${bad.length ? "✗" : "✓"} ${(c.channel || "(빈값)").padEnd(12)} way=${String(way).padEnd(15)} 붙이기=${String(s.connect).padEnd(5)} 떼기=${String(s.disconnect).padEnd(5)} ${c.why}`);
  for (const x of bad) console.log(`        ${x}`);
}

/* 🔴 음성 대조 — 길이 있는 채널과 없는 채널이 **둘 다** 나와야 한다.
   전부 열려 있으면 «되는 척»이고, 전부 막혀 있으면 기능이 없는 것이다. */
const ways = new Set(CASES.map((c) => String(adsWayOf(c.channel))));
const spread = ways.has("null") && ways.size >= 4;
console.log(`\n  ${spread ? "✓" : "✗"} 음성 대조 — 나온 길 ${[...ways].join(", ")}`);
if (!spread) fails.push("길이 한쪽으로 쏠렸다 — 초록이어도 의미가 없다");

/* 🔴 «붙일 수는 있는데 뗄 수 없는» 채널이 실제로 있는지 — 그걸 뭉개면 없는 되돌리기를 약속하게 된다. */
const asym = CASES.some((c) => adsConnectable(c.channel).connect && !adsConnectable(c.channel).disconnect);
console.log(`  ${asym ? "✓" : "✗"} «붙이기는 되는데 떼기는 안 되는» 채널을 구분한다(티스토리)`);
if (!asym) fails.push("붙이기/떼기를 한 값으로 뭉갰다 — 없는 되돌리기를 약속하게 된다");

console.log(`\n  통과 ${pass}/${CASES.length}`);
if (fails.length) { console.error("\n  ✗ 실패:\n" + fails.map((f) => `    · ${f}`).join("\n") + "\n"); process.exitCode = 1; }
else console.log("\n  ✓ 길이 있는 채널만 열고, 없는 채널은 정직하게 막는다.\n");
