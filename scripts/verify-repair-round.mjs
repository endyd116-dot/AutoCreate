/**
 * scripts/verify-repair-round.mjs — 🔴 **수리 라운드 점수판을 «손으로 세지 않는다»**(C · 2026-09-19).
 *   사용: node scripts/verify-repair-round.mjs          (자들을 실제로 돌려 점수판을 찍는다)
 *         node scripts/verify-repair-round.mjs --map    (표만 찍는다 · 아무것도 안 돌린다)
 *
 *   ══ 왜 이 자가 있나 ══
 *   이 라운드의 점수는 «**자가 우는 건 N/18**」이다. 그런데 그 N 을 **사람이 세면** 오늘 세 번 난 병이 또 난다 —
 *   🔴 «같은 것을 다른 모수로 세어 서로 다른 수를 말한다»(내가 «16 중 14», A 가 «10»이라 한 그것).
 *   ⇒ 점수판은 **자를 실제로 돌려서** 나와야 한다. 이 파일이 그 한 줄이다.
 *
 *   ══ 🔴 이 표는 «손으로 옮긴 것»이다 — 정직하게 적는다 ══
 *   아래 `ITEMS` 는 `docs/active/2026-09-19-REPAIR-round.md` 와 두 시나리오 문서에서 **사람이 옮겨 적은 목록**이다.
 *   그 문서에 기계가 읽을 목록이 없어서 그렇다(AC-108 이 경계한 «손 목록»이 맞다).
 *   그래서 **덜 위험하게** 만들었다:
 *     · 각 칸이 가리키는 **자 파일이 정말 있는지** 이 자가 확인한다(이름이 바뀌면 운다).
 *     · «자 없음»으로 적은 칸은 **초록으로 세지 않는다** — ⊘ 로 센다(AC-9).
 *     · 판정은 **그 자를 실제로 돌린 종료코드**로만 한다. 내가 «고쳐졌다»고 적을 자리가 없다.
 *   🔴 **이 표가 낡는 것이 이 자의 유일한 위험이다.** 라운드가 끝나면 이 파일도 같이 끝난다.
 *
 *   종료코드: 0 = 열여덟 칸에 «자가 우는 빨강»이 하나도 없다 · 1 = 있다 · 2 = 자를 못 돌렸다.
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAP_ONLY = process.argv.includes("--map");

/** 출처: docs/active/2026-09-19-REPAIR-round.md · 2026-09-19-scenario-a-walk.md §A · 2026-09-19-scenario-b-ops.md §2·§4 */
const ITEMS = [
  { id: "A①", what: "체크박스가 화면에 안 보인다", ruler: "verify-paint.mjs" , own: "A" },
  { id: "A②", what: "로그인 잠금이 서버 시간대에 매달린다", ruler: "verify-server-time.mjs" },
  { id: "A③", what: "당근 «수익 안 붙어요»가 안 뜬다", ruler: "verify-norevenue-reach.mjs", by: "A" , own: "A" },
  { id: "A④", what: "401 오독 — 손님이 로그인 화면으로 쫓겨난다", ruler: "verify-401-surface.mjs" , own: "A" },
  { id: "A⑤", what: "탈퇴한 집에 «체험이 끝났어요»", ruler: "verify-honest-unknown.mjs" , mine: "home-summary" },
  { id: "A⑥", what: "온보딩이 나갔다 오면 안 이어진다", ruler: "verify-onboarding-resume.mjs", by: "A" , own: "A" },
  /* 🔴 지도는 이걸 **한 칸**으로 적었다(«글자수/말투»). 첫 판에 둘로 쪼갰더니 점수판이 **19칸**이 나왔다 —
     🔴 **내가 하루 종일 잡은 병(«같은 것을 다른 모수로 센다»)을 내 점수판이 저질렀다.** 바로 맞췄다.
     한 칸에 자가 둘이면 **둘 다 초록일 때만** 그 칸이 초록이다(하나만 초록 = 반쪽 수리). */
  { id: "A⑦", what: "글자수·말투(한 화면에 둘 · 시스템 용어)", rulers: ["verify-one-charcount.mjs", "verify-people-words.mjs"], by: "A" , own: "A" },
  { id: "B①", what: "가입한 손님이 운영 화면에서 사라진다", ruler: "verify-customer-visible.mjs" , own: "B" },
  { id: "B②", what: "«모름»을 «0»이라고 말한다", ruler: "verify-honest-unknown.mjs" , own: "B" , mine: "뭉개는 자리 [1-9]" },
  { id: "B③", what: "회원 상세가 서버 값을 못 읽는다", ruler: "verify-key-contract.mjs" , mine: "slots\.planned" },
  { id: "B④", what: "코인 지급 멱등이 시계에서 나온다", ruler: "verify-money-idem.mjs" , own: "B" },
  { id: "B⑤", what: "운영 손이 고객 해지 예약을 지운다", ruler: "verify-silent-erase.mjs" , own: "B" },
  { id: "B⑥", what: "운영 메모가 안 남고 있던 것을 지운다", ruler: "verify-key-contract.mjs" , own: "B" , mine: "ops-tenant-note" },
  { id: "B⑦", what: "러너 최신 버전을 화면이 안 말해 준다", ruler: null, why: "«화면이 부르나» 목록(verify-r8-deadends)에 한 줄 더할 일 — 새 자를 만들 것이 아니다" , own: "B2" },
  { id: "B⑧", what: "«오늘 AI 에 얼마 썼나» 화면이 없다", ruler: null, why: "같은 이유 — 화면이 안 그리는 것이라 기존 목록의 몫" },
  { id: "B⑨", what: "실패한 로그인이 감사에 안 남는다", ruler: "verify-audit-gap.mjs" },
  { id: "B⑩", what: "상담원을 뽑아도 들여보낼 수가 없다", ruler: null, why: "🔴 «없는 길»이다 — 자로 덮을 것이 아니라 기능을 만들 일" , own: "B" },
  { id: "AC-111", what: "스텁이 가짜를 돌려주고 말하지 않는다", ruler: "verify-stub-silence.mjs" , own: "B2" },
  /* 🔴 **이 칸은 «지도 ↔ 내 표» 축이 찾아냈다** — 넣자마자 B2 가 «지도 3 / 내 표 2» 로 어긋났다.
     내 표에 **B2 의 셋째 몫이 빠져 있었다.** 손으로 옮긴 표가 낡는다는 것이 바로 이 모양이고,
     그 위험을 «머리말에 적어 두는 것»으로 끝냈으면 **아무도 몰랐다.** 축으로 세우니 한 번에 나왔다. */
  { id: "B2③", what: "영상 «받을 것» 중 급한 것", ruler: null, own: "B2",
    why: "🔴 B2 가 아직 착수 전이다(사장님 손) — **무엇을 고칠지 정해지면** 자를 붙인다. 지금은 «못 쟀음»" },
];

const rows = [];
const cache = new Map();
function runRuler(file) {
  if (cache.has(file)) return cache.get(file);
  const p = path.join(ROOT, "scripts", file);
  let r;
  if (!existsSync(p)) r = { code: -1, note: "🔴 그 자가 없다(이름이 바뀌었나?)", stdout: "" };
  else if (MAP_ONLY) r = { code: null, note: "안 돌렸다(--map)", stdout: "" };
  else {
    /* 🔴 **찍힌 글자도 받아 둔다** — 한 자가 두 칸을 겸할 때 «그 칸의 줄»만 따로 보려고(아래 `mine`). */
    try { const stdout = execFileSync(process.execPath, [p], { encoding: "utf8", timeout: 600_000, stdio: ["ignore", "pipe", "pipe"] }); r = { code: 0, note: "", stdout }; }
    catch (e) { r = { code: e.status ?? 1, note: e.status === 2 ? "⊘ 못 쟀다" : "", stdout: String(e.stdout ?? "") + String(e.stderr ?? "") }; }
  }
  cache.set(file, r);
  return r;
}

console.log(`\n수리 라운드 점수판 — 🔴 **자를 돌려서** 낸다(사람이 세지 않는다) · ${new Date().toISOString()}`);
console.log(`출처: docs/active/2026-09-19-REPAIR-round.md · scenario-a-walk.md · scenario-b-ops.md`);
console.log("─".repeat(112));

for (const it of ITEMS) {
  const list = it.rulers ?? (it.ruler ? [it.ruler] : []);
  if (!list.length) { rows.push({ ...it, list, state: "자없음" }); continue; }
  const rs = list.map((f) => runRuler(f));
  /* 🔴 한 칸에 자가 둘이면 **둘 다 초록일 때만** 그 칸이 초록이다 — 하나만 초록이면 **반쪽 수리**다. */
  const worst = rs.find((r) => r.code === -1) ?? rs.find((r) => r.code && r.code !== 2) ?? rs.find((r) => r.code === 2) ?? rs[0];
  let state = worst.code === -1 ? "자사라짐" : worst.code === null ? "안돌림" : worst.code === 0 ? "초록" : worst.code === 2 ? "못쟀음" : "빨강";
  /* 🔴 **한 자가 두 칸을 겸할 때, 그 칸의 몫만 가른다.**
     `honest-unknown` 은 A⑤+B② 를, `key-contract` 는 B③+B⑥ 을 같이 잰다 — 자가 빨갛다고
     **두 칸이 다 안 고쳐진 것은 아니다.** 지금까지는 내가 **말로** 갈라 보고했는데,
     🔴 말로 가르는 것이 바로 AC-114 의 씨앗이다(다음 사람은 그 말을 못 듣는다).
     ⇒ 칸에 `mine`(그 칸이 제 것이라고 주장하는 글자)이 있으면 **그 글자가 아직 보이는지**로 칸을 가른다.
     `mine` 이 없는 칸은 종전대로 자 전체의 종료코드를 따른다. */
  let split = "";
  if (state === "빨강" && it.mine) {
    const still = rs.some((r) => new RegExp(it.mine).test(r.stdout ?? ""));
    if (!still) { state = "초록"; split = `자는 아직 빨갛지만 **이 칸의 몫은 사라졌다**(다른 칸이 그 자를 붙들고 있다)`; }
    else split = `이 칸의 몫이 그 자 안에 **아직 보인다**`;
  }
  rows.push({ ...it, list, state, note: worst.note, split });
}

const ICON = { 초록: "✅", 빨강: "🔴", 못쟀음: "⊘", 자없음: "✖", 자사라짐: "❗", 안돌림: "·" };
for (const r of rows) {
  const who = r.by ? ` [${r.by} 가 낸 자]` : "";
  console.log(`  ${ICON[r.state]} ${r.id.padEnd(7)} ${r.what.padEnd(34)} ${r.list.length ? r.list.join(" + ") + who : "—"}`);
  if (r.state === "자없음") console.log(`      ⊘ 자 없음 — ${r.why}`);
  if (r.state === "자사라짐") console.log(`      🔴 ${r.note}`);
  if (r.split) console.log(`      ↳ ${r.split}  (그 칸의 자국: «${r.mine}»)`);
}

const green = rows.filter((r) => r.state === "초록").length;
const red = rows.filter((r) => r.state === "빨강").length;
const none = rows.filter((r) => r.state === "자없음").length;
const gone = rows.filter((r) => r.state === "자사라짐").length;
const unk = rows.filter((r) => r.state === "못쟀음").length;
const covered = rows.filter((r) => r.list.length).length;

/* ═══ 🔴 **지도와 내 표를 맞댄다 — 이 표가 낡는 것이 이 자의 유일한 위험이라서** ═══
   지도(`docs/active/2026-09-19-REPAIR-round.md` §1 분배)의 표는 **기계가 읽을 수 있다**: 「화면 5」·「서버·운영 6」·「러너·영상 3」.
   내 표의 «분배에 있는 칸» 수와 그 수가 어긋나면 **둘 중 하나가 낡은 것**이다 — 그때 이 자가 운다.
   🔴 항목 **이름**이 바뀌는 것까지는 못 잡는다. 잡는 것은 **범위가 바뀌는 것**이고, 그게 메인이 짚은 위험이다. */
const MAP = path.join(ROOT, "docs", "active", "2026-09-19-REPAIR-round.md");
if (existsSync(MAP)) {
  const md = readFileSync(MAP, "utf8");
  const want = {};
  for (const m of md.matchAll(/\|\s*\*\*(A|B|B2)\*\*\s*\|\s*[^0-9|]*?(\d+)\s*—/g)) want[m[1]] = Number(m[2]);
  const mine = {};
  for (const r of rows) if (r.own) mine[r.own] = (mine[r.own] ?? 0) + 1;
  const keys = [...new Set([...Object.keys(want), ...Object.keys(mine)])].sort();
  const same = keys.every((k) => (want[k] ?? 0) === (mine[k] ?? 0));
  console.log("─".repeat(112));
  console.log(`  ${same ? "✓" : "✗"} 🔴 지도의 분배 수 ↔ 내 표의 분배 수  — ${keys.map((k) => `${k}: 지도 ${want[k] ?? "?"} / 내 표 ${mine[k] ?? 0}`).join("  ·  ")}`);
  if (!same) console.log(`      🔴 어긋났다 — **둘 중 하나가 낡았다.** 지도를 읽고 이 표를 고치거나, 지도가 바뀐 것이면 그대로 옮겨라.`);
  if (!same) process.exitCode = 1;
}

console.log("─".repeat(112));
console.log(`■ 자가 있는 칸 **${covered}/${ITEMS.length}**   ·   ✅ 초록 ${green}  🔴 빨강 ${red}  ⊘ 못 쟀음 ${unk}  ✖ 자 없음 ${none}${gone ? `  ❗ 자 사라짐 ${gone}` : ""}`);
console.log(`🔴 지도의 «열여덟 건»과 이 표의 ${ITEMS.length}칸은 **같은 셈이 아니다**(AC-114) — 지도의 분배는 **맡긴 것 14건**이고, 이 표는 **시나리오가 찾은 것 전부**다.`);
console.log(`🔴 «자 없음»은 **통과가 아니다**(AC-9). «초록»은 **그 자를 실제로 돌린 종료코드 0** 이지 내가 적은 말이 아니다.`);
console.log(`🔴 이 표는 문서에서 **손으로 옮긴 것**이다 — 낡는 것이 이 자의 유일한 위험이다(머리말).\n`);
/* 🔴 `process.exitCode` 로 이미 1 이 찍혔으면(지도와 어긋남) **그걸 덮지 않는다** — 덮으면 그 축이 조용해진다. */
process.exit(gone ? 2 : red ? 1 : (process.exitCode || 0));
