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
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAP_ONLY = process.argv.includes("--map");

/** 출처: docs/active/2026-09-19-REPAIR-round.md · 2026-09-19-scenario-a-walk.md §A · 2026-09-19-scenario-b-ops.md §2·§4 */
const ITEMS = [
  { id: "A①", what: "체크박스가 화면에 안 보인다", ruler: "verify-paint.mjs" },
  { id: "A②", what: "로그인 잠금이 서버 시간대에 매달린다", ruler: "verify-server-time.mjs" },
  { id: "A③", what: "당근 «수익 안 붙어요»가 안 뜬다", ruler: "verify-norevenue-reach.mjs", by: "A" },
  { id: "A④", what: "401 오독 — 손님이 로그인 화면으로 쫓겨난다", ruler: "verify-401-surface.mjs" },
  { id: "A⑤", what: "탈퇴한 집에 «체험이 끝났어요»", ruler: "verify-honest-unknown.mjs" },
  { id: "A⑥", what: "온보딩이 나갔다 오면 안 이어진다", ruler: "verify-onboarding-resume.mjs", by: "A" },
  /* 🔴 지도는 이걸 **한 칸**으로 적었다(«글자수/말투»). 첫 판에 둘로 쪼갰더니 점수판이 **19칸**이 나왔다 —
     🔴 **내가 하루 종일 잡은 병(«같은 것을 다른 모수로 센다»)을 내 점수판이 저질렀다.** 바로 맞췄다.
     한 칸에 자가 둘이면 **둘 다 초록일 때만** 그 칸이 초록이다(하나만 초록 = 반쪽 수리). */
  { id: "A⑦", what: "글자수·말투(한 화면에 둘 · 시스템 용어)", rulers: ["verify-one-charcount.mjs", "verify-people-words.mjs"], by: "A" },
  { id: "B①", what: "가입한 손님이 운영 화면에서 사라진다", ruler: "verify-customer-visible.mjs" },
  { id: "B②", what: "«모름»을 «0»이라고 말한다", ruler: "verify-honest-unknown.mjs" },
  { id: "B③", what: "회원 상세가 서버 값을 못 읽는다", ruler: "verify-key-contract.mjs" },
  { id: "B④", what: "코인 지급 멱등이 시계에서 나온다", ruler: "verify-money-idem.mjs" },
  { id: "B⑤", what: "운영 손이 고객 해지 예약을 지운다", ruler: "verify-silent-erase.mjs" },
  { id: "B⑥", what: "운영 메모가 안 남고 있던 것을 지운다", ruler: "verify-key-contract.mjs" },
  { id: "B⑦", what: "러너 최신 버전을 화면이 안 말해 준다", ruler: null, why: "«화면이 부르나» 목록(verify-r8-deadends)에 한 줄 더할 일 — 새 자를 만들 것이 아니다" },
  { id: "B⑧", what: "«오늘 AI 에 얼마 썼나» 화면이 없다", ruler: null, why: "같은 이유 — 화면이 안 그리는 것이라 기존 목록의 몫" },
  { id: "B⑨", what: "실패한 로그인이 감사에 안 남는다", ruler: "verify-audit-gap.mjs" },
  { id: "B⑩", what: "상담원을 뽑아도 들여보낼 수가 없다", ruler: null, why: "🔴 «없는 길»이다 — 자로 덮을 것이 아니라 기능을 만들 일" },
  { id: "AC-111", what: "스텁이 가짜를 돌려주고 말하지 않는다", ruler: "verify-stub-silence.mjs" },
];

const rows = [];
const cache = new Map();
function runRuler(file) {
  if (cache.has(file)) return cache.get(file);
  const p = path.join(ROOT, "scripts", file);
  let r;
  if (!existsSync(p)) r = { code: -1, note: "🔴 그 자가 없다(이름이 바뀌었나?)" };
  else if (MAP_ONLY) r = { code: null, note: "안 돌렸다(--map)" };
  else {
    try { execFileSync(process.execPath, [p], { stdio: "ignore", timeout: 600_000 }); r = { code: 0, note: "" }; }
    catch (e) { r = { code: e.status ?? 1, note: e.status === 2 ? "⊘ 못 쟀다" : "" }; }
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
  const state = worst.code === -1 ? "자사라짐" : worst.code === null ? "안돌림" : worst.code === 0 ? "초록" : worst.code === 2 ? "못쟀음" : "빨강";
  rows.push({ ...it, list, state, note: worst.note });
}

const ICON = { 초록: "✅", 빨강: "🔴", 못쟀음: "⊘", 자없음: "✖", 자사라짐: "❗", 안돌림: "·" };
for (const r of rows) {
  const who = r.by ? ` [${r.by} 가 낸 자]` : "";
  console.log(`  ${ICON[r.state]} ${r.id.padEnd(7)} ${r.what.padEnd(34)} ${r.list.length ? r.list.join(" + ") + who : "—"}`);
  if (r.state === "자없음") console.log(`      ⊘ 자 없음 — ${r.why}`);
  if (r.state === "자사라짐") console.log(`      🔴 ${r.note}`);
}

const green = rows.filter((r) => r.state === "초록").length;
const red = rows.filter((r) => r.state === "빨강").length;
const none = rows.filter((r) => r.state === "자없음").length;
const gone = rows.filter((r) => r.state === "자사라짐").length;
const unk = rows.filter((r) => r.state === "못쟀음").length;
const covered = rows.filter((r) => r.list.length).length;

console.log("─".repeat(112));
console.log(`■ 자가 있는 칸 **${covered}/${ITEMS.length}**   ·   ✅ 초록 ${green}  🔴 빨강 ${red}  ⊘ 못 쟀음 ${unk}  ✖ 자 없음 ${none}${gone ? `  ❗ 자 사라짐 ${gone}` : ""}`);
console.log(`🔴 «자 없음»은 **통과가 아니다**(AC-9). «초록»은 **그 자를 실제로 돌린 종료코드 0** 이지 내가 적은 말이 아니다.`);
console.log(`🔴 이 표는 문서에서 **손으로 옮긴 것**이다 — 낡는 것이 이 자의 유일한 위험이다(머리말).\n`);
process.exit(gone ? 2 : red ? 1 : 0);
