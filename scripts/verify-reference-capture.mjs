/**
 * scripts/verify-reference-capture.mjs — **레퍼런스 캡처**(R10-1) 검사. 브라우저 0 · 바깥 접속 0.
 *   node scripts/verify-reference-capture.mjs
 *
 * ══ 무엇을 재나 ══
 *   ① **자르기가 맞나** — 폰 폭 · 2~6장 · 10~15% 겹침 · 🔴 **구멍 0** · 마지막이 페이지 끝에 붙나
 *   ② **이상한 입력에 안 지어내나** — 0·음수·NaN·문자열·아주 짧은 글·아주 긴 글(AC-92)
 *   ③ 🔴 **남의 글이 한 장도 안 남나**(설계 §3.3 ③) — 캡처 경로가 디스크·`_shots`·R2 를 **안 쓴다**
 *   ④ 🔴 **로그에 주소·본문이 안 섞이나** — 새는 자리는 대개 로그다
 *   ⑤ **보고 모양이 B 와 합의한 계약과 같나**(2026-09-16 B2↔B)
 *
 * ══ 못 재는 것(정직 · AC-9) ══
 *   🔴 **진짜 페이지를 열어 보지 않았다**(실호출 0 지시 · AC-50). 여기서 재는 것은 «자르기 산수»와 «코드가 무엇을 안 하나»다.
 *      «네이버가 실제로 열리나»·«로그인 벽 문구가 저 정규식과 맞나»는 **사장님 Allow 를 받은 뒤** 한 번 열어 봐야 안다.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const P_SLICE = join(ROOT, "runner", "lib", "capture-slice.mjs");
let SRC_SLICE = readFileSync(P_SLICE, "utf8");
let SRC_CAP = readFileSync(join(ROOT, "runner", "channels", "reference-capture.mjs"), "utf8");
const SRC_CORE = readFileSync(join(ROOT, "runner", "core.mjs"), "utf8");
/** 🔴 주석을 코드로 세지 마라 — «없어야 하는 것»을 재는 축은 **그 금지를 설명하는 주석**에 걸린다(format 하니스에서 3건 밟았다). */
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/* ═══ 🔴 변이 — «이 방어를 빼면 빨개지나»(AC-87). 빨강이 안 나면 그 축은 아무것도 못 잡는다. ═══ */
const MUTATIONS = {
  /* 🔴 c1 은 «보정을 빼면»이 아니라 «**틈을 일부러 내면**»이다.
     처음엔 보정 줄을 빼는 변이를 넣었는데 **초록으로 지나갔다** — 높이 58,601개를 전수로 재 보니
     위 산수만으로는 틈이 **0건**이라 그 줄이 여태 한 번도 안 걸렸기 때문이다(AC-68: 작동한 적 없는 안전장치).
     ⇒ 재야 할 것은 «난간이 있나»가 아니라 **«내 자가 구멍을 보기는 하나»**다. 그래서 틈을 심는다. */
  c1: { file: "slice", from: "    if (slices[i].y > prevEnd) slices[i].y = prevEnd;", to: "    slices[i].y = prevEnd + 50;",
    expect: "C-02 (조각 사이에 50px 구멍 = 글 한복판이 통째로 안 찍힌다 · 내 자가 그걸 보나)" },
  c2: { file: "slice", from: "  let h = Math.ceil(H / (1 + (count - 1) * (1 - overlapPct / 100)));", to: "  let h = target;",
    expect: "C-05/C-07b (장수에 맞춰 조각을 다시 안 내면 겹침이 50%·100% 로 튄다 = 같은 화면을 두 번 보낸다)" },
  c3: { file: "slice", from: "  if (!Number.isFinite(H) || H <= 0) {", to: "  if (false) {",
    expect: "C-09 (못 잰 높이를 그럴듯한 값으로 지어낸다 · AC-92)" },
  c4: { file: "cap", from: '  if (!plan.count) throw BLOCK("nav", "글의 길이를 재지 못해서 몇 장으로 찍을지 정할 수 없었어요.");', to: "  /* removed */",
    expect: "C-10 (높이를 못 쟀는데도 캡처를 강행한다)" },
  c5: { file: "cap", from: "        type: \"jpeg\", quality: q,", to: "        type: \"jpeg\", quality: q, path: \"shot.jpg\",",
    expect: "C-11b (캡처를 디스크에 남긴다 = 남의 글이 우리 PC 에 남는다)" },
  c6: { file: "cap", from: "  if (wall?.login && wall.textLen < 400) throw BLOCK", to: "  if (wall?.login) throw BLOCK",
    expect: "C-20 (글 안에 «로그인» 낱말만 있어도 멀쩡한 글을 돌려보낸다 · AC-68)" },
};
const argMut = (process.argv.find((a) => a.startsWith("--mutate=")) || "").split("=")[1] || "";

if (argMut === "all") {
  const rows = [];
  for (const k of Object.keys(MUTATIONS)) {
    let code = 0, out = "";
    try { out = execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--mutate=${k}`], { encoding: "utf8" }); }
    catch (e) { code = e.status ?? 1; out = String(e.stdout ?? ""); }
    const lines = out.split("\n").filter((l) => l.includes("  ✘ "));
    rows.push({ k, red: code !== 0, n: lines.length, axes: [...new Set(lines.map((l) => l.trim().split(" ")[1]))].join(","), expect: MUTATIONS[k].expect });
  }
  console.log("\n══ 변이 대조(«이 방어를 빼면 빨개지나») ══");
  for (const r of rows) console.log(`  ${r.red ? "🔴 빨강" : "⚪ 초록"}  ${r.k}  실패축 ${r.n}개 [${r.axes}]  ← ${r.expect}`);
  const silent = rows.filter((r) => !r.red);
  if (silent.length) { console.log(`\n🔴 변이 ${silent.map((r) => r.k).join("·")} 이(가) **빨개지지 않았다** — 그 축은 아무것도 못 잡는다(AC-87).`); process.exit(1); }
  console.log("\n✅ 여섯 다 빨개졌다 — 이제 «전부 통과»를 믿어도 된다.");
  process.exit(0);
}
if (argMut) {
  const m = MUTATIONS[argMut];
  if (!m) { console.error("모르는 변이: " + argMut); process.exit(2); }
  const src = m.file === "slice" ? SRC_SLICE : SRC_CAP;
  if (src.indexOf(m.from) < 0) { console.error(`🔴 변이 ${argMut}: 심을 자리를 못 찾았다 — ${m.from.slice(0, 70)}`); process.exit(3); }
  if (src.split(m.from).length > 2) { console.error(`🔴 변이 ${argMut}: 심을 자리가 여러 곳이다`); process.exit(3); }
  if (m.file === "slice") SRC_SLICE = SRC_SLICE.split(m.from).join(m.to);
  else SRC_CAP = SRC_CAP.split(m.from).join(m.to);
  console.log(`\n⚠️ 변이 ${argMut} 적용 — 빨개져야 할 축: ${m.expect}`);
}

/* 변이가 반영된 자르기 모듈을 **실제로 import** 한다(글자 검사로는 산수 무력화를 못 본다). */
const TMP = join(ROOT, "runner", "tmp", "_cap-mutate");
mkdirSync(TMP, { recursive: true });
const modPath = join(TMP, `cs-${argMut || "orig"}-${process.pid}.mjs`);
writeFileSync(modPath, SRC_SLICE);
const CS = await import(pathToFileURL(modPath).href);

let pass = 0, fail = 0;
const ok = (c, name, x) => { if (c) { pass++; console.log("  ✔ " + name); } else { fail++; console.log("  ✘ " + name + (x !== undefined ? " — " + String(x).slice(0, 220) : "")); } };

/* ═══ ① 자르기 ═══ */
console.log("\n[① 자르기 — 폰 폭 · 2~6장 · 겹침 · 🔴 구멍 0]");
{
  ok(CS.PHONE_WIDTH === 430, "C-01 🔴 폰 폭 430(사장님이 못 박은 값) — 데스크톱 폭이면 «문단 리듬»이 틀린 값이 된다", CS.PHONE_WIDTH);

  /* 실제 글 길이대로 — 짧은 글(폰 2화면) · 보통(5화면) · 긴 글(13화면) · 아주 긴 글(43화면). */
  const CASES = [400, 932, 1398, 1400, 2000, 2800, 5000, 8000, 12000, 40000];
  let worstOverlap = 100, gapCases = 0, tailWrong = 0, tooMany = 0;
  for (const H of CASES) {
    const r = CS.planCaptureSlices(H);
    const cov = CS.checkCoverage(r.slices, r.pageHeight);
    if (!cov.ok) gapCases++;
    const last = r.slices.at(-1);
    if (!last || last.y + last.h !== r.pageHeight) tailWrong++;
    if (r.count > CS.MAX_SHOTS) tooMany++;
    if (r.count > 1) worstOverlap = Math.min(worstOverlap, r.overlapPct);
  }
  ok(gapCases === 0,
    "C-02 🔴 **구멍 0** — 이웃 조각이 반드시 겹치거나 맞닿는다(구멍이 나면 글 한복판이 통째로 안 찍히고, 모델은 없는 줄도 모른다)",
    `구멍 난 경우 ${gapCases}건`);
  ok(tailWrong === 0, "C-03 마지막 조각이 **페이지 끝에 붙는다**(끝이 잘리면 «마무리 모양»을 못 읽는다)", `${tailWrong}건 어긋남`);
  ok(tooMany === 0, "C-04 6장을 안 넘는다", `${tooMany}건 초과`);
  ok(worstOverlap >= CS.OVERLAP_PCT_MIN && worstOverlap <= CS.OVERLAP_PCT_MAX,
    `C-05 겹침이 ${CS.OVERLAP_PCT_MIN}~${CS.OVERLAP_PCT_MAX}% 안에 있다(딱 자르면 경계 문단이 양쪽에서 반씩 잘려 둘 다 못 읽는다)`,
    `가장 낮은 겹침 ${worstOverlap}%`);

  /* 🔴 «겹침이 음수가 되지 않나» — 6장 상한에 긴 글이 걸릴 때 제일 위험한 자리(C 가 콕 집은 곳). */
  const longOne = CS.planCaptureSlices(12000);
  ok(longOne.count === CS.MAX_SHOTS && longOne.overlapPct > 0,
    "C-06 🔴 아주 긴 글(12,000px)에서도 겹침이 **양수**다 — 상한에 걸리면 겹침을 깎는 게 아니라 **조각을 키운다**",
    `${longOne.count}장 · ${longOne.overlapPct}% · 조각 ${longOne.slices[0]?.h}px`);
  ok(longOne.why.some((w) => /키웠어요/.test(w)),
    "C-06b 그리고 그 손해를 **말한다**(«조각이 크면 글자가 그만큼 작게 보여요» — 못 한 것은 적는다 · AC-9)");

  /* 🔴 짧은 글 — «최소 2장»이 «같은 화면을 두 번»이 되지 않나. */
  const shortOne = CS.planCaptureSlices(1398);
  ok(shortOne.count === 1,
    "C-07 🔴 폰 화면 1.5개 안에 드는 글은 **한 장**이다 — «한 장은 안 된다»는 12,000px 를 우겨넣지 말라는 뜻이지 «무조건 쪼개라»가 아니다",
    `${shortOne.count}장`);
  const nearTwo = CS.planCaptureSlices(1400);
  const dupe = nearTwo.count > 1 && nearTwo.overlapPct > CS.OVERLAP_PCT_MAX;
  ok(!dupe, "C-07b 거의 같은 화면을 두 번 보내지 않는다(겹침이 상한을 넘으면 그건 중복이다 · 요금제 한도만 깎는다)",
    `${nearTwo.count}장 · ${nearTwo.overlapPct}%`);

  /* 🔴 대조군 짝 — 보통 길이 글은 **목표 크기 근처**로 잘린다(전부 최대로 키우는 자가 아니다 · AC-68). */
  const mid = CS.planCaptureSlices(5000);
  ok(mid.count >= 3 && mid.count <= 4 && mid.slices[0].h <= Math.round(CS.PHONE_VIEWPORT_HEIGHT * 1.5),
    "C-08 대조군 짝 — 보통 글(5,000px)은 3~4장 · 조각이 «폰 화면 1.5개»를 안 넘는다",
    `${mid.count}장 · 조각 ${mid.slices[0]?.h}px`);
}

/* ═══ ② 이상한 입력 ═══ */
console.log("\n[② 이상한 입력 — 🔴 «모른다»를 «특정 값»으로 바꾸지 않는다(AC-92)]");
{
  for (const bad of [0, -1, NaN, "abc", null, undefined, Infinity]) {
    const r = CS.planCaptureSlices(bad);
    ok(r.count === 0 && r.pageHeight === null && r.why.some((w) => /재지 못했/.test(w)),
      `C-09 «${String(bad)}» → 0장 + «못 쟀어요»(그럴듯한 높이를 지어내지 않는다)`,
      `${r.count}장 · pageHeight=${r.pageHeight}`);
  }
  /* 🔴 그리고 **못 쟀으면 한 장도 안 찍는다** — 지어낸 높이로 찍으면 «없는 부분»을 모델이 읽는다. */
  ok(/if \(!plan\.count\) throw BLOCK\("nav"/.test(SRC_CAP),
    "C-10 🔴 높이를 못 쟀으면 캡처를 **아예 안 한다**(0장으로 «성공»하지 않는다)");
}

/* ═══ ③ 🔴 남의 글이 한 장도 안 남나 ═══ */
console.log("\n[③ 🔴 남의 글은 한 장도 안 남는다(설계 §3.3 ③)]");
{
  const code = codeOnly(SRC_CAP);
  ok(!/writeFileSync|createWriteStream|\bpath:\s*/.test(code) && !/require\("node:fs"\)|from "node:fs"/.test(code),
    "C-11 🔴 캡처 경로가 **파일을 안 쓴다** — 지우는 것보다 **안 쓰는 게 세다**(지우기는 잊거나 실패할 수 있고 finally 가 안 도는 죽음도 있다)",
    code.match(/writeFileSync|createWriteStream|node:fs/)?.[0]);
  ok(/page\.screenshot\(\{[\s\S]{0,200}?type: "jpeg"/.test(code) && !/screenshot\([^)]*path/.test(code),
    "C-11b `screenshot({clip})` 의 **버퍼**를 그대로 쓴다(`path:` 를 주면 디스크에 남는다)");
  ok(!/\bshot\(|failShot|SHOTS_DIR|_shots/.test(code),
    "C-12 🔴 우리 `_shots` 폴더를 **안 쓴다**(발행 잡은 화면을 찍어 두지만 이건 **남의 글**이다)");
  ok(!/TMP_DIR|runner\/tmp/.test(code), "C-12b `runner/tmp` 도 안 쓴다");
  ok(!/r2|R2|putObject|S3|presign/.test(code), "C-13 R2 에 안 올린다");
  /* 코어가 이 잡에 shotKey 를 안 싣는지 — 실으면 «찍은 화면이 있다»는 신호가 서버에 남는다. */
  const capBranch = SRC_CORE.slice(SRC_CORE.indexOf("if (CAPTURE_KINDS.has(job.kind))"), SRC_CORE.indexOf("if (REVENUE_KINDS.has(job.kind))"));
  ok(capBranch.length > 0 && !/shotKey/.test(codeOnly(capBranch)),
    "C-14 🔴 보고에 `shotKey` 를 **안 싣는다**(이 잡에서 우리 폴더에 남는 것은 없어야 한다)");
  ok(/if \(!s\.length\) return \{ ok: false/.test(capBranch),
    "C-14b 한 장도 못 찍었으면 **«성공»이 아니다**(빈 배열을 «읽을 게 없었다»로 흘려보내지 않는다 · AC-9)");
}

/* ═══ ④ 🔴 로그가 새지 않나 ═══ */
console.log("\n[④ 🔴 로그에 주소·본문이 안 섞인다]");
{
  const logs = [...codeOnly(SRC_CAP).matchAll(/console\.log\(([^;]*)\)/g)].map((m) => m[1]);
  ok(logs.length > 0, "C-15 로그를 찍긴 한다(조용한 0건 금지 — 몇 장을 찍었는지는 말해야 한다)", `${logs.length}줄`);
  const leaky = logs.filter((l) => /\burl\b|finalUrl|title|innerText|textContent|\bdata\b/.test(l));
  ok(leaky.length === 0, "C-16 🔴 로그에 주소·제목·본문·이미지 데이터가 **안 들어간다**(새는 자리는 대개 로그다)", leaky.join(" | "));
  /* 본문을 «읽어서 밖으로» 내보내는 자리가 있나 — 판정은 불리언만 돌려줘야 한다. */
  const ev = codeOnly(SRC_CAP).slice(codeOnly(SRC_CAP).indexOf("const wall = await page.evaluate"));
  ok(/textLen: t\.replace/.test(ev) && !/return t;|text: t/.test(ev),
    "C-16b 벽 판정은 **불리언과 길이만** 돌려준다(글자를 밖으로 내보내지 않는다)");
}

/* ═══ ⑤ 보고 계약(B 와 합의) ═══ */
console.log("\n[⑤ 보고 모양 — B 와 합의한 계약(2026-09-16)]");
{
  const code = codeOnly(SRC_CAP);
  ok(/mime: "image\/jpeg"/.test(code) && /i: s\.index/.test(code) && /y0: s\.y, y1: s\.y \+ s\.h/.test(code),
    "C-17 `shots[{i, mime, data, w, h, y0, y1}]` 모양 그대로");
  ok(/height: plan\.pageHeight, finalUrl/.test(code), "C-17b `page:{height, finalUrl}` 를 싣는다");
  ok(/const TOTAL_B64_CAP = 4_500_000;/.test(code) && /const PER_SHOT_CAP = 800_000;/.test(code),
    "C-18 Netlify 6MB 벽 — base64 합계 4.5MB · 장당 800KB 상한(상수 한 곳)");
  ok(/QUALITY_STEPS/.test(code) && /장수를 줄이지 않고|장수를 안 줄이/.test(SRC_CAP),
    "C-18b 🔴 넘치면 **장수를 줄이지 않고 품질을 낮춘다** — 처음·중간·끝이 **다 있어야** 한다(한 장을 빼면 그 구간은 영영 못 읽는다)");
  for (const k of ["login_wall", "blocked", "not_found", "timeout", "nav"]) {
    ok(new RegExp(`BLOCK\\("${k}"`).test(code), `C-19 실패 갈래 \`${k}\` 를 낸다(A 화면이 이 다섯으로 갈라 말한다)`);
  }
  /* 🔴 로그인 벽을 «본문이 없다»로 추정하지 않나 — AC-9(없음의 부재로 판정 금지)의 캡처판. */
  ok(/wall\?\.login && wall\.textLen < 400/.test(code),
    "C-20 🔴 로그인 벽은 **문구가 있고 본문이 거의 없을 때만** — 글 안에 «로그인» 낱말이 있다고 멀쩡한 글을 돌려보내지 않는다(AC-68)");
  ok(/autoScroll\(page\)/.test(code),
    "C-21 게으른 이미지를 깨운다(안 깨우면 «사진 몇 장»이 0으로 잘못 읽힌다 — 모르는 것을 0으로 만드는 그 자리 · AC-9)");
}

rmSync(modPath, { force: true });
console.log(`\nverify-reference-capture: ${pass}/${fail} (통과/실패)`);
process.exit(fail ? 1 : 0);
