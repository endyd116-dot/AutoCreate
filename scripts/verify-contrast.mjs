/**
 * scripts/verify-contrast.mjs — 🔴 **글자 대비를 낱말이 아니라 숫자로 잰다**(C · R8 마감 · 2026-09-16).
 *   사용: node scripts/verify-contrast.mjs
 *
 *   ══ 왜 이 파일이 필요한가 ══
 *   ① `verify-r8-audit64.mjs` 의 D 묶음이 대비를 `/4\.5:1|contrastRatio/` **낱말**로 쟀다 — 대용물이다(AC-70).
 *      소스 주석에 «4.5:1» 이라고 적어 두기만 해도 통과한다. **색이 실제로 그런지는 한 번도 안 쟀다.**
 *   ② 🔴 진짜로 재던 것은 `scratchpad/shot.mjs` 였다(`public/css/ac.css:9` 가 그렇게 적어 뒀다).
 *      **scratchpad 는 저장소 밖이라 지금 없다** — 그래서 «21건 미달»도 «그 뒤 전부 통과»도 **다시 재 볼 방법이 없었다.**
 *      재 본 적 없는 값을 문서가 나르면 다음 사람이 그 값을 믿는다(AC-78 의 뿌리).
 *   ⇒ 토큰을 `public/css/ac.css` 에서 **직접 읽어** WCAG 2.1 상대휘도로 계산한다. 의존성 0 · 브라우저 0.
 *
 *   ⚠️ 이 하니스가 재는 것은 **토큰 짝**이다. «어느 화면이 그 짝을 실제로 쓰나»는 다른 축이고,
 *      그건 라벨·화면 하니스의 몫이다. 🔴 여기서 통과했다고 «전 화면 통과»라고 말하면 안 된다.
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("public/css/ac.css", "utf8");

/** `:root{…}` 계열 블록에서 `--x:#rrggbb` 를 긁는다. 어두운 테마는 `[data-theme="dark"]` 블록. */
function tokensFrom(blockRe) {
  const m = CSS.match(blockRe);
  if (!m) return null;
  const out = {};
  for (const [, k, v] of m[0].matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)) out[k] = v;
  return out;
}
const light = tokensFrom(/:root\{[\s\S]*?\}/);
const darkRaw = tokensFrom(/:root\[data-theme="dark"\]\{[\s\S]*?\}/);
if (!light) { console.error("🔴 :root 토큰을 못 읽었다 — ac.css 구조가 바뀌었나"); process.exit(2); }
const dark = { ...light, ...(darkRaw ?? {}) };   // 다크는 덮어쓰는 것만 적혀 있다

const hex = (h) => {
  let s = h.replace("#", "");
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
/** WCAG 2.1 상대휘도 */
const lum = (h) => {
  const [r, g, b] = hex(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/**
 * 재는 짝 — **글자색 → 그 글자가 실제로 얹히는 바탕**.
 *   🔴 `--faint` 는 «글자로 쓰지 않는 색»이다(ac.css:376 이 그렇게 못 박았다) → 테두리·구분선용이라 **대상이 아니다**.
 *      대상이 아닌 것을 넣으면 매번 빨강이 뜨고, 빨강이 늘 있으면 아무도 안 본다.
 *   🔴 큰 글씨 예외(3:1)는 **안 쓴다** — 우리 화면의 회색 글씨는 죄다 12.5~14.5px 본문이다.
 */
const PAIRS = [
  ["--ink", "--ground"], ["--ink", "--surface"],
  ["--sub", "--ground"], ["--sub", "--surface"],
  ["--muted", "--ground"], ["--muted", "--surface"],
  ["--money-ink", "--ground"], ["--money-ink", "--surface"], ["--money-ink", "--money-soft"],
  ["--danger-ink", "--ground"], ["--danger-ink", "--surface"], ["--danger-ink", "--danger-soft"],
  ["--warn-ink", "--ground"], ["--warn-ink", "--surface"], ["--warn-ink", "--warn-soft"],
  ["--on-brand", "--brand"],
];
const AA = 4.5;
const rows = [];
let fail = 0;
for (const [mode, T] of [["라이트", light], ["다크", dark]]) {
  for (const [fg, bg] of PAIRS) {
    const f = T[fg.slice(2)]; const b = T[bg.slice(2)];
    if (!f || !b) { rows.push([mode, fg, bg, "—", `🔴 토큰 없음(${!f ? fg : bg})`]); fail++; continue; }
    const r = ratio(f, b);
    const ok = r >= AA;
    if (!ok) fail++;
    rows.push([mode, `${fg} ${f}`, `${bg} ${b}`, r.toFixed(2), ok ? "통과" : `🔴 미달(${AA} 필요)`]);
  }
}

const w = (x, n) => String(x).padEnd(n);
console.log(`\n글자 대비 — ac.css 토큰을 읽어 WCAG 2.1 로 직접 계산 · ${new Date().toISOString()}\n${"─".repeat(96)}`);
console.log(`${w("테마", 6)} ${w("글자색", 24)} ${w("바탕", 26)} ${w("비", 7)} 판정`);
for (const r of rows) console.log(`${w(r[0], 6)} ${w(r[1], 24)} ${w(r[2], 26)} ${w(r[3], 7)} ${r[4]}`);
console.log(`${"─".repeat(96)}`);
console.log(`짝 ${rows.length}개 중 **미달 ${fail}개** (AA 본문 기준 ${AA}:1 · 큰 글씨 예외 안 씀)`);
console.log("⚠️ 이건 **토큰 짝**이다 — «어느 화면이 그 짝을 쓰나»는 다른 축이고 여기서 통과해도 전 화면 통과가 아니다.");
process.exit(fail ? 1 : 0);
