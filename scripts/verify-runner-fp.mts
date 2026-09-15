/**
 * scripts/verify-runner-fp.mts — 기기 지문 구속이 **진짜 막는지** 돌려서 확인한다(R8 §3.1 · 2026-09-15 B2).
 *
 *   🔴 왜 검사가 꼭 필요한가: 2026-09-15 실측으로 **묶인 기기가 0대**였다(등록 16대 전부 지문 이전 판).
 *      즉 이 구속은 **여태 한 번도 실제로 작동한 적이 없다** — 라이브를 봐서는 «되는지» 알 수 없다.
 *      «없음»을 «괜찮음»으로 읽지 않으려면(AC-33) 여기서 만들어 먹여 보는 수밖에 없다.
 *
 *   🔴 무엇이 걸려 있나: 이 문이 열려 있으면 `.token` 을 복사한 사람이 **헤더를 빼기만 하면** 구속을 피하고,
 *      그 토큰으로 `claim` 하면 서버가 **계정 자격을 평문으로** 내려 준다(설계상 평문 표면 2곳 중 하나).
 *      세션 파일이 암호화돼 있어도 소용없다 — **토큰 하나면 새 세션을 받아 간다.**
 *
 *   🔴 **DB 를 안 건드린다.** 판정을 순수 함수(`classifyFpBinding`)로 뽑아 놨기 때문이다 —
 *      처음엔 임시 테넌트를 만드는 하니스를 쓰려다 그만뒀다: 라이브 데이터를 만들 이유가 없고(사장님 Allow 사안),
 *      순수 함수면 훨씬 촘촘히 잴 수 있다.
 *
 *   실행: npx --yes tsx scripts/verify-runner-fp.mts          (DB·네트워크 0)
 */
import { classifyFpBinding } from "../lib/runner-jobs";

const FP_A = "a".repeat(64);
const FP_B = "b".repeat(64);

interface C { name: string; bound: string | null; header: string | null | undefined; want: string; why: string }
const CASES: C[] = [
  /* ── 안 묶인 기기(지문 이전 판) — 멈추면 안 된다 ── */
  { name: "안 묶임 + 지문 없음", bound: null, header: undefined, want: "pass", why: "옛 러너가 업데이트 하나로 멈추면 안 된다" },
  { name: "안 묶임 + 빈 문자열", bound: null, header: "", want: "pass", why: "위와 같다" },
  { name: "안 묶임 + 형식 오류", bound: null, header: "not-a-fp", want: "pass", why: "묶을 값이 없으니 통과(옛 기기 보호)" },
  { name: "안 묶임 + 지문 있음 → 묶는다", bound: null, header: FP_A, want: "bind", why: "처음 온 값을 묶는다" },
  { name: "안 묶임 + 대문자 지문 → 묶는다", bound: null, header: FP_A.toUpperCase(), want: "bind", why: "대소문자는 같은 값이다" },

  /* ── 🔴 묶인 기기 — 이 검사의 이유 ── */
  { name: "🔴 묶임 + 지문 **없음**", bound: FP_A, header: undefined, want: "refuse_missing",
    why: "🔴 여기가 열려 있으면 토큰 복사본이 헤더만 빼고 들어온다 — 종전 코드가 정확히 이걸 통과시켰다" },
  { name: "🔴 묶임 + 빈 문자열", bound: FP_A, header: "", want: "refuse_missing", why: "🔴 «없음»의 다른 모양" },
  { name: "🔴 묶임 + 공백만", bound: FP_A, header: "   ", want: "refuse_missing", why: "🔴 trim 뒤 없음" },
  { name: "묶임 + 형식 오류(짧음)", bound: FP_A, header: "abc123", want: "refuse_missing", why: "형식은 «없음»과 다른 사건으로 기록한다" },
  { name: "묶임 + 형식 오류(hex 아님)", bound: FP_A, header: "z".repeat(64), want: "refuse_missing", why: "길이는 맞아도 hex 가 아니다" },
  { name: "묶임 + 다른 PC 지문", bound: FP_A, header: FP_B, want: "refuse_other", why: "종전 동작(회귀 확인)" },

  /* ── 🔴 음성 대조: 전부 거절이면 «막는다»가 아니라 «고장났다»다 ── */
  { name: "🔴 음성: 묶임 + 맞는 지문", bound: FP_A, header: FP_A, want: "pass", why: "🔴 정상 러너가 막히면 전 고객이 멈춘다" },
  { name: "🔴 음성: 묶임 + 맞는 지문(대문자)", bound: FP_A, header: FP_A.toUpperCase(), want: "pass", why: "🔴 대소문자로 정상 러너를 막으면 안 된다" },
  { name: "🔴 음성: 묶인 값에 공백이 섞여 있어도", bound: ` ${FP_A} `, header: FP_A, want: "pass", why: "🔴 DB 에 공백이 끼어 전 고객이 막히면 안 된다" },
];

let pass = 0; const fails: string[] = [];
console.log("\n  기기 지문 구속 실측 (순수 함수 · DB 0)\n");
for (const c of CASES) {
  const d = classifyFpBinding(c.bound, c.header);
  const ok = d.action === c.want;
  if (ok) pass++; else fails.push(`${c.name} — 기대 ${c.want} · 실제 ${d.action}  (${c.why})`);
  console.log(`  ${ok ? "✓" : "✗"} ${c.name.padEnd(40)} → ${d.action.padEnd(15)} (${d.fpState})`);
}

/* 🔴 «없음»과 «형식»이 실제로 **갈라져서** 나오는지 — 뭉쳐 있으면 원인을 못 찾는다(메인 지시). */
const absent = classifyFpBinding(FP_A, undefined);
const malformed = classifyFpBinding(FP_A, "abc");
const split = absent.fpState === "absent" && malformed.fpState === "malformed" && absent.action === malformed.action;
console.log(`\n  ${split ? "✓" : "✗"} «없음»과 «형식 오류»가 갈린다 — ${absent.fpState} / ${malformed.fpState}`);
if (!split) fails.push("«없음»과 «형식 오류»가 안 갈린다 — 나중에 형식만 바뀌었을 때 원인을 못 찾는다");

/* 🔴 사람에게 나갈 문구가 **서로 달라야** 한다 — 같으면 고객이 무엇을 해야 할지 모른다. */
const m1 = "message" in absent ? absent.message : "";
const m2 = "message" in malformed ? malformed.message : "";
const m3 = "message" in classifyFpBinding(FP_A, FP_B) ? (classifyFpBinding(FP_A, FP_B) as { message: string }).message : "";
const distinct = new Set([m1, m2, m3]).size === 3 && m1.includes("최신 프로그램") && m3.includes("다른 PC");
console.log(`  ${distinct ? "✓" : "✗"} 세 경우의 안내 문구가 서로 다르다`);
if (!distinct) fails.push("안내 문구가 겹친다 — 고객이 무엇을 해야 할지 모른다");

/* 🔴 판정이 한쪽으로 쏠렸나 — 통과와 거절이 둘 다 나와야 검사가 의미 있다. */
const acts = new Set(CASES.map((c) => classifyFpBinding(c.bound, c.header).action));
const spread = acts.has("pass") && acts.has("bind") && acts.has("refuse_missing") && acts.has("refuse_other");
console.log(`  ${spread ? "✓" : "✗"} 음성 대조 — 나온 판정 ${[...acts].join(", ")}`);
if (!spread) fails.push("판정이 한쪽으로 쏠렸다 — 초록이어도 의미가 없다");

console.log(`\n  통과 ${pass}/${CASES.length}`);
if (fails.length) { console.error("\n  ✗ 실패:\n" + fails.map((f) => `    · ${f}`).join("\n") + "\n"); process.exitCode = 1; }
else console.log("\n  ✓ 지문 없는 요청이 묶인 기기에서 막힌다(옛 기기·정상 러너는 안 건드린다).\n");
