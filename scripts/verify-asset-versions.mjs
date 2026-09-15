/**
 * scripts/verify-asset-versions.mjs — 🔴 **모든 화면이 같은 판의 CSS·JS 를 부르나**.
 *
 *   2026-09-16 배포 직후 실측: `public/app/home.html` 이 혼자 `ac.css?v=19` 를 부르고 있었다(나머지는 v21).
 *   까닭: `home.html`·`team-accept.html`·`public/*.html`·`ops/login.html` 은 **`_tpl.txt` 에 없는 손수 관리 화면**이라
 *        `scripts/build-pages.mjs` 가 판을 올려도 **안 따라온다.** 생성물만 갱신되고 손수 파일은 남는다.
 *   🔴 왜 위험한가: 그 화면만 **브라우저 캐시의 옛 CSS·JS** 를 쓴다. 고객이 새로 오면 멀쩡하고
 *        **다시 오는 고객만** 옛 화면을 본다 — 우리 쪽에선 아무 오류도 안 난다(AC-86 의 손수 파일판).
 *   정본 = `scripts/build-pages.mjs` 가 선언한 값.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const bp = readFileSync("scripts/build-pages.mjs", "utf8");
const want = {
  "ac.css": (bp.match(/ac\.css\?v=(\d+)/) || [])[1],
  "ui.js": (bp.match(/\/js\/ui\.js\?v=(\d+)/) || [])[1],
  "mock.js": (bp.match(/\/js\/mock\.js\?v=(\d+)/) || [])[1],
};
const files = [];
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
  const p = join(d, e.name);
  if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); }
  else if (e.name.endsWith(".html")) files.push(p);
} };
walk("public");

const bad = [];
for (const f of files) {
  const s = readFileSync(f, "utf8");
  for (const [asset, v] of Object.entries(want)) {
    if (!v) continue;
    const re = new RegExp(asset.replace(".", "\.") + "\?v=(\d+)", "g");
    let m;
    while ((m = re.exec(s))) if (m[1] !== v) bad.push({ f, asset, got: m[1], want: v });
  }
}
console.log(`\n🔎 화면이 부르는 CSS·JS 판 — 파일 ${files.length}개 · 정본 ${Object.entries(want).map(([k, v]) => `${k} v${v}`).join(" · ")}\n`);
for (const b of bad) console.log(`✗ ${b.f}  ${b.asset}?v=${b.got}  →  v${b.want}`);
if (bad.length) {
  console.log(`\n🔴 ${bad.length}곳. 🔴 **손수 관리 화면**(\`_tpl.txt\` 에 없는 것)은 \`build-pages.mjs\` 가 안 건드린다 —`);
  console.log(`   그 화면만 브라우저 캐시의 옛 CSS·JS 를 쓴다. **다시 오는 고객만** 옛 화면을 본다.`);
  process.exit(1);
}
console.log("✓ 모든 화면이 같은 판을 부른다.");
process.exit(0);
