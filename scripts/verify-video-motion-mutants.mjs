/**
 * scripts/verify-video-motion-mutants.mjs — 🔴 **`verify-video-motion.mjs` 가 정말 잡는가**(AC-100 ⑦).
 *   `node scripts/verify-video-motion-mutants.mjs` · 종료코드 0 = 표가 건강하다.
 *
 *   ══ 왜 이 자가 또 필요한가 ══
 *     초록인 검사는 «잡는다»의 증거가 아니다 — **아무것도 안 도는 검사도 초록**이다.
 *     ⇒ 렌더를 **일부러 망가뜨려** 검사가 **빨개지는지** 본다.
 *
 *   ══ 🔴 이 표의 규칙 셋(오늘 우리를 다섯 번 속인 것들) ══
 *     ① **맨 윗줄은 «원판»이다.** 원판이 초록이 아니면 **표 전체를 버린다** — 나머지 빨강은 «다 잡는다»가 아니라
 *        «아무것도 안 돈다»일 수 있다.
 *     ② **변이를 심은 자리 수를 센다.** 0곳이면 «못 심음»(검사가 아니라 내 치환이 틀린 것) ·
 *        2곳 이상이면 **하니스 고장**(한 변이가 여러 축을 동시에 흔들어 무엇이 잡혔는지 모른다).
 *     ③ **«주석 걷은 본문»에서 센다.** 같은 글자가 주석에 있으면 치환이 주석을 고치고 본문은 멀쩡하다
 *        (2026-09-17 B2 창에서 같은 병이 네 번 났다).
 */
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "runner/channels/render-video.mjs");
const MUT = join(ROOT, "runner/channels/.mutant-render-video.mjs");   // 같은 폴더여야 `../lib/browser.mjs` 가 풀린다
const HARNESS = join(ROOT, "scripts/verify-video-motion.mjs");
const HARNESS_MUT = join(ROOT, "scripts/.mutant-verify-video-motion.mjs");

/** 주석을 걷은 본문 — 치환 자리를 **본문에서만** 센다(규칙 ③). */
function codeOnly(src) {
  return String(src)
    .split("\n")
    .map((l) => (l.trimStart().startsWith("*") || l.trimStart().startsWith("//") || l.trimStart().startsWith("/*") ? "" : l))
    .join("\n");
}

const original = readFileSync(SRC, "utf8");
const harness = readFileSync(HARNESS, "utf8");

/** 변이본을 옆에 두고 하니스도 그 파일을 보게 바꿔서 돌린다. */
function runHarness(src) {
  writeFileSync(MUT, src, "utf8");
  writeFileSync(HARNESS_MUT, harness.split("../runner/channels/render-video.mjs").join("../runner/channels/.mutant-render-video.mjs"), "utf8");
  try {
    const r = spawnSync(process.execPath, [HARNESS_MUT], { encoding: "utf8", cwd: ROOT, timeout: 120_000 });
    return r.status;
  } finally {
    try { rmSync(MUT, { force: true }); } catch { /* */ }
    try { rmSync(HARNESS_MUT, { force: true }); } catch { /* */ }
  }
}

/* 🔴 변이 — «무엇을 망가뜨리면 어느 축이 빨개져야 하나». */
const MUTANTS = [
  { name: "원판(아무것도 안 바꿈)", from: null, to: null, want: 0, why: "🔴 이 줄이 초록이 아니면 아래 표를 전부 버린다" },
  { name: "전환 길이를 컷에서 안 빌린다(늘리기를 없앤다)", from: "const target = s.durMs + (tr.extendMs[i] ?? 0);", to: "const target = s.durMs;", want: 1, why: "② 전체 길이 불변" },
  { name: "xfade offset 에서 전환 길이를 안 뺀다", from: "offset=${sec(acc - tr.ms)}", to: "offset=${sec(acc)}", want: 1, why: "② 전체 길이 불변" },
  { name: "짧은 컷에도 전환을 건다", from: "at.push(d[i] >= TRANSITION_MIN_CUT_MS && d[i + 1] >= TRANSITION_MIN_CUT_MS);", to: "at.push(true);", want: 1, why: "② 짧은 컷 건너뛰기" },
  { name: "고지·엔드카드에도 모션을 건다", from: 'if (String(kind) !== "phrase") return "none";', to: "", want: 1, why: "④ 대조군 짝(AC-68)" },
  { name: "짧은 구절에도 모션을 건다", from: "if (!(Number(windowMs) >= CAPTION_MOTION_MIN_WINDOW_MS)) return \"none\";", to: "", want: 1, why: "④ 대조군 짝" },
  { name: "모르는 모션 이름도 그대로 낸다", from: 'if (!CAPTION_MOTIONS.has(want) || want === "none") return "none";', to: 'if (want === "none") return "none";', want: 1, why: "③ 못 냈어요" },
  { name: "모르는 전환 이름도 그대로 낸다", from: "if (!TRANSITION_XFADE[k] || n < 2) return off;", to: "if (n < 2) return off;", want: 1, why: "③ 못 냈어요" },
  { name: "안 켜도 모션 필터를 붙인다(무회귀 깨기)", from: "const m = deco ? l.motion : \"none\";", to: "const m = l.motion;", want: 2, why: "① 무회귀 — 🔴 본문 2곳(입력 조립·필터 조립)이라 **want=2 가 정상**이다" },
  { name: "오버레이를 `eof_action=pass` 로 되돌린다", from: "eof_action=repeat", to: "eof_action=pass", want: 1, why: "⑦ 오버레이가 정말 얹히나 — 🔴 단일 프레임은 t=0 에 EOF 라 pass 면 자막·고지가 통째로 사라진다" },
  { name: "확인기 날 프레임 갈래를 없앤다(x264 를 태운다)", from: "if (ctx.rawProbe) {", to: "if (false) {", want: 1, why: "⑧ 확인기 — 🔴 인코딩을 태우면 율 제어가 달라 늘 «그려졌다»가 된다" },
  { name: "확인기가 고지 말고 아무 층이나 고른다", from: 'for (const r of ["disclosure", "badge"]) { const i = byRole(r); if (i >= 0) return i; }', to: "", want: 1, why: "⑧ 법이 읽는 것부터" },
  { name: "확인기가 창 길이를 안 본다", from: "return L.length ? L.findIndex((x) => x && (x.endMs - x.startMs) >= 200) : -1;", to: "return L.length ? 0 : -1;", want: 1, why: "⑧ 🔴 «못 잰다» 조건에 입력이 둘이면 대조군이 있어야 한다(B 규칙)" },
  { name: "영상 조각을 안 늘린다(tpad 제거)", from: "ext > 0 && s.isClip", to: "false", want: 1, why: "② 전체 길이 불변" },
];

let bad = 0;
console.log("변이표 — 🔴 맨 윗줄이 «원판»이다\n");
for (const [i, m] of MUTANTS.entries()) {
  let src = original, planted = 0;
  if (m.from !== null) {
    planted = codeOnly(original).split(m.from).length - 1;
    src = original.split(m.from).join(m.to);
  }
  const status = runHarness(src);
  const red = status !== 0;

  if (i === 0) {
    if (red) { console.log(`  ✗ ${m.name} — 🔴 **원판이 빨강이다. 표 전체를 버린다.**`); process.exit(1); }
    console.log(`  ✓ ${m.name} — 원판 초록(표를 읽어도 된다)`);
    continue;
  }
  if (planted !== m.want) {
    bad++;
    console.log(`  ✗ ${m.name} — 변이를 **${planted}곳**에 심었다(기대 ${m.want}곳). ${planted === 0 ? "못 심었다 — 치환 글자가 본문에 없다" : "하니스 고장 — 한 변이가 여러 자리를 흔든다"}`);
    continue;
  }
  if (!red) { bad++; console.log(`  ✗ ${m.name} — 망가뜨렸는데 **초록이다**(${m.why} 축이 안 돈다)`); }
  else console.log(`  ✓ ${m.name} → 빨강 (${m.why})`);
}

console.log(`\n${bad === 0 ? "초록" : "빨강"} — 변이 ${MUTANTS.length - 1}개 중 놓친 것 ${bad}`);
process.exit(bad === 0 ? 0 : 1);
