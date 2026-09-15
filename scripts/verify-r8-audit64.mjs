// scripts/verify-r8-audit64.mjs — 🔴 **설계 대비 «남은 64행» 진척을 코드로 다시 센다**(C · R8 계약 §7).
//   사용: node scripts/verify-r8-audit64.mjs [--json]
//
//   입력 = `docs/active/2026-09-15-DESIGN-AUDIT.md` §10.3 의 ③54 + ④12(문서 표기 · 메인 전언은 ④10 이었다 — 숫자를 여기서 못 박는다).
//   🔴 **세션 보고를 믿지 않는다**(메인 지시 · 전수조사에서 그 규칙이 실제로 1건을 잡았다 — B2 «WP 위젯 코드만» 이 실제로는 0이었다).
//   🔴 **«정의가 있나»가 아니라 «부르는 자리가 있나»로** 센다(AC-69). 그리고 CLAUDE §4.8 —
//      **서버만 있고 화면이 없으면 «닫혔다»가 아니다.**
//
//   각 행: [번호, 이름, 조사 당시 «지금», 지금 다시 재는 법]
//     · `server`  = 서버 쪽 근거가 있나(파일·심볼)
//     · `screen`  = 화면에서 쓸 수 있나(public/** 에 그 말·그 호출이 있나)
//     · 둘 다 필요한 행은 **둘 다** 있어야 닫힌 것으로 센다.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";

const JSON_OUT = process.argv.includes("--json");
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const walk = (dir, exts, out = []) => {
  let e = []; try { e = readdirSync(dir); } catch { return out; }
  for (const f of e) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = `${dir}/${f}`;
    if (statSync(p).isDirectory()) walk(p, exts, out); else if (exts.some((x) => f.endsWith(x))) out.push(p);
  }
  return out;
};
const SERVER = [...walk("lib", [".ts", ".mts"]), ...walk("netlify/functions", [".ts", ".mts"]), ...walk("runner", [".mjs", ".js"])]
  .map((p) => [p, read(p)]);
const SCREEN = [...walk("public", [".js", ".html"])].map((p) => [p, read(p)]);
const hit = (files, re) => files.filter(([, t]) => re.test(t)).map(([p]) => p);

/** ④ 진짜 미개발 12행 — 조사 §10.3-④ 표 그대로. */
const FOUR = [
  { n: 1, name: "탈퇴 버튼이 앱에 있나", was: "API·크론은 완성 · 화면 grep 0",
    server: () => hit(SERVER, /account-close/), screen: () => hit(SCREEN, /탈퇴/) },
  { n: 2, name: "매체 기준일이 화면에 뜨나", was: "서버는 dayBasis 를 내려보냄 · revenue.html 표기 0",
    server: () => hit(SERVER, /dayBasisNote|DAY_BASIS_NOTE/), screen: () => hit(SCREEN, /dayBasis|기준일/) },
  { n: 3, name: "`ai-meter.ts`·`ai-key.ts` 이식", was: "파일 없음",
    server: () => [existsSync("lib/ai-meter.ts") && "lib/ai-meter.ts", existsSync("lib/ai-key.ts") && "lib/ai-key.ts"].filter(Boolean), screen: null },
  { n: 4, name: "고지 게이트 사유가 홈에 뜨나", was: "홈 해야 할 일 13종에 고지 거부 없음",
    server: () => hit(SERVER.filter(([p]) => /home-summary/.test(p)), /disclosure|고지|review_blocked/), screen: () => hit(SCREEN, /review_blocked|고지/) },
  { n: 5, name: "WP 사이드바 위젯 광고 코드", was: "grep widget = 0",
    server: () => hit(SERVER, /\bwidget\b/i), screen: null },
  { n: 6, name: "`publish-now`(지금 올리기)", was: "grep 0 — 승인 뒤 5분 크론만",
    server: () => hit(SERVER, /publish-now|publishNow/), screen: () => hit(SCREEN, /지금 올리|publish-now/) },
  { n: 7, name: "`avatar`(계정 사진)", was: "accounts.ts 에서 avatar: null 고정",
    server: () => hit(SERVER, /avatar:\s*(?!null)[A-Za-z_]/), screen: null },
  { n: 8, name: "`account_groups` 표·화면", was: "accounts.group_id 칸만 · 표·화면 0",
    server: () => hit(SERVER, /account_groups/), screen: () => hit(SCREEN, /묶음|account_group/) },
  { n: 9, name: "CS 이메일·카카오 유입", was: "앱 티켓만",
    server: () => hit(SERVER, /inboundEmail|메일로 온 문의|kakao/i), screen: null },
  { n: 10, name: "팩트체크 «수치 주장 표시»", was: "그라운딩은 있고 수치 표시 0",
    server: () => hit(SERVER, /numericClaim|수치 주장|factCheck/i), screen: null },
  { n: 11, name: "러너 PC 세션 파일 암호화", was: "runner/ 에 암호화 grep 0",
    server: () => hit(SERVER.filter(([p]) => /^runner\//.test(p)), /encrypt|createCipher|aes-256/i), screen: null },
  { n: 12, name: "클립 «앱에서 올리기» 딥링크", was: "문구·내려받기까지 ✓ · 딥링크 0",
    server: () => hit(SERVER, /deepLink|딥링크|naverclip:\/\/|appOpen/i), screen: () => hit(SCREEN, /앱으로 열|딥링크/) },
];

/** ③ R8 으로 민 것 중 **R8 에서 실제로 손댄다고 한 묶음**만 — 나머지는 «미룬 것»이 맞으므로 세지 않는다. */
const THREE = [
  { name: "`lib/channel-registry.ts` 정본 통합(2행)", rows: 2,
    server: () => hit(SERVER, /channel-registry/), screen: null,
    extra: () => (hit(SERVER, /connectMethodOf\(.*\)\s*===\s*["']oauth["']/).length ? "🔴 옛 추측 폴백이 남아 있다" : "") },
  { name: "고지 축 4행(유튜브 유료 프로모션·파트너십 라벨·분기 재확인·쇼핑 태그)", rows: 4,
    server: () => hit(SERVER, /paid_?promotion|selfDeclaredMadeForKids|is_paid_partnership|유료 프로모션/i), screen: null },
  { name: "편성·규칙 화면 — 채널 다중 규칙(1행)", rows: 1,
    server: () => hit(SERVER.filter(([p]) => /rules\.ts/.test(p)), /rules/), screen: () => hit(SCREEN, /규칙 N개|규칙\s*\$\{|다중/) },
  { name: "자동승인 «신뢰 계정»(1행)", rows: 1,
    server: () => hit(SERVER, /trustLevel|신뢰 계정|trusted/i), screen: () => hit(SCREEN, /신뢰/) },
];

const results = [];
const rec = (step, ok, note) => results.push({ step, ok: ok === "WARN" ? "WARN" : !!ok, note });

let closed = 0, open = 0, partial = 0;
for (const r of FOUR) {
  const s = r.server ? r.server() : [];
  const c = r.screen ? r.screen() : null;
  const needScreen = r.screen !== null;
  const serverOk = s.length > 0;
  const screenOk = !needScreen || (c && c.length > 0);
  const state = serverOk && screenOk ? "닫힘" : serverOk ? "🟠 서버만(화면 없음 = CLAUDE §4.8 로 «닫힘» 아님)" : "열림";
  if (state === "닫힘") closed++; else if (serverOk) partial++; else open++;
  rec(`④-${r.n} ${r.name}`, state === "닫힘" ? true : serverOk ? "WARN" : false,
    `${state} · 서버 ${s.length ? s.slice(0, 2).join(",") : "0"}${needScreen ? ` · 화면 ${c && c.length ? c.slice(0, 2).join(",") : "0"}` : ""} · 조사 당시: ${r.was}`);
}
rec("④ 합계 — **화면까지 있어야 닫힘**(CLAUDE §4.8)", open === 0 && partial === 0,
  `닫힘 ${closed} · 서버만 ${partial} · 열림 ${open} / 12행 (조사 당시 12행 전부 열림)`);

for (const r of THREE) {
  const s = r.server ? r.server() : [];
  const c = r.screen ? r.screen() : null;
  const needScreen = r.screen !== null;
  const serverOk = s.length > 0;
  const screenOk = !needScreen || (c && c.length > 0);
  const warn = r.extra ? r.extra() : "";
  rec(`③ ${r.name}`, serverOk && screenOk && !warn ? true : serverOk ? "WARN" : false,
    `서버 ${s.length ? s.slice(0, 2).join(",") : "0"}${needScreen ? ` · 화면 ${c && c.length ? c.slice(0, 2).join(",") : "0"}` : ""}${warn ? ` · ${warn}` : ""} · ${r.rows}행`);
}

if (JSON_OUT) console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
else {
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\n설계 대비 «남은 64행» 진척 — 코드로 다시 셈(R8 §7) · ${new Date().toISOString()}\n${"─".repeat(150)}`);
  for (const r of results) console.log(`${r.ok === "WARN" ? "△" : r.ok ? "✓" : "✗"} ${w(r.step, 52)} ${w(r.note, 94)}`);
  console.log(`${"─".repeat(150)}`);
  console.log("🔴 «서버만 있고 화면이 없는 것»은 닫힌 것으로 세지 않는다(CLAUDE §4.8) · «정의가 있나»가 아니라 «부르는 자리가 있나»로 센다(AC-69).");
}
process.exit(0);
