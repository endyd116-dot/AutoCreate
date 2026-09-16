// scripts/verify-r11-mutants.mjs — [R11+R12 · B · 2026-09-17] 🔴 **변이표: 일부러 망가뜨려 보고, «무엇이 잡았는지»까지 찍는다.**
//   사용: node scripts/verify-r11-mutants.mjs [--names]   (종료코드 0 = 모든 변이가 잡혔다)
//
//   ══ 왜 종료코드만으로는 모자란가 (B2 가 구조로 만든 것을 그대로 받았다 · 2026-09-17) ══
//     변이를 넣고 «exit 1» 만 보면 **무엇이 잡았는지**를 모른다. 그런데 그게 중요하다:
//       · **이름이 맞는 축**이 잡았다 → 그 축이 실제로 그 뜻을 지킨다.
//       · 🔴 **이름이 딴판인 축**만 잡았다 → «우연한 덮개»다. **그 축이 바뀌는 날 덮개도 같이 사라진다.**
//     이 둘을 자동으로는 못 가른다 — 그래서 **사람이 읽을 자리**로 두고(`--names`), 읽은 결과를 아래 머리말에 적는다.
//
//   🔴 이 파일이 실제로 겪은 일: 나는 처음에 「이 변이는 옛 자가 못 잡았다」를 **재 보지 않고** 주석에 썼다.
//      재 보니 **잡고 있었다**(다만 다른 것을 재던 축이 우연히). 짐작을 지우고 잰 것만 남겼고, 이 파일이 그 재기를 **되풀이할 수 있게** 만든 것이다.
//
//   ══ 2026-09-17 에 읽은 결과 ══
//     9개 변이 전부 **이름이 맞는 축**이 잡는다. 아래 `expectAxis` 가 그 읽기를 박아 둔 것이고,
//     🔴 **그 축이 아닌 것만 잡으면 이 검사가 빨개진다** — 덮개가 덮개로 바뀌는 순간을 잡으려는 것이다.
//
//   ⚠️ 이 검사는 **원본 파일을 잠깐 고쳤다 되돌린다.** 중간에 죽어도 되돌리도록 finally 로 감쌌고,
//      되돌리기에 실패하면 **크게 외치고 1 로 죽는다**(조용히 망가진 나무를 남기지 않는다).

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const SHOW_NAMES = process.argv.includes("--names");
const HARNESS = "scripts/verify-r11-axis.mts";

/**
 * 변이 하나.
 *   `file`·`from`·`to` = 무엇을 어떻게 망가뜨리나 · `what` = 사람이 읽는 뜻
 *   `expectAxis` = 🔴 **이 변이를 잡아야 하는 축의 이름 조각.** 이게 이 파일의 값이다 —
 *                  «잡히기만 하면 된다»가 아니라 «**맞는 축이** 잡아야 한다».
 */
const MUTANTS = [
  { what: "축 판정이 모르는 채널을 «글»로 접는다(폴백이 «모른다»를 «값»으로 · AC-92)",
    file: "lib/channel-registry.ts",
    from: '  if (VIDEO_CHANNEL_KEYS.includes(k)) return "video";\n  return null;',
    to: '  if (VIDEO_CHANNEL_KEYS.includes(k)) return "video";\n  return "text";',
    expectAxis: "표에 없는 채널 = null" },

  { what: "목록·표 마크를 글당 상한에서 뺀다(목록 10줄 글에 120개가 실린다)",
    file: "lib/format-marks.ts",
    from: "  return [...(b.marks ?? []), ...(b.itemMarks ?? []).flatMap((x) => x.marks), ...(b.cellMarks ?? []).flatMap((x) => x.marks)];",
    to: "  return [...(b.marks ?? [])];",
    expectAxis: "목록 마크도 글당 상한을 탄다" },

  { what: "추세의 표본 바닥을 없앤다(한 편으로 «내림»이라고 단정한다 · AC-9)",
    file: "lib/revenue/trend.ts",
    from: "  if (samples < TREND_MIN_SAMPLES) {",
    to: "  if (false) {",
    expectAxis: "unknown" },

  { what: "고지 축이 «고지가 필요한가»를 안 본다 → 전 영상이 pending(넓히면 오히려 더 잘 통과한다)",
    file: "lib/video/judge.ts",
    from: "  const pending = pass && needDisclosure && overlayVerified !== true;",
    to: "  const pending = pass && overlayVerified !== true;",
    expectAxis: "고지 불필요" },

  { what: "고지 축이 «재 봤고 안 실렸다»(false)를 실패로 안 센다",
    file: "lib/video/judge.ts",
    from: "  const pass = d.ok && overlayVerified !== false;",
    to: "  const pass = d.ok;",
    expectAxis: "재 봤고 안 실렸다" },

  { what: "고지 축의 보류를 아예 안 만든다(어제까지의 거짓 초록으로 되돌리기)",
    file: "lib/video/judge.ts",
    from: "  const pending = pass && needDisclosure && overlayVerified !== true;",
    to: "  const pending = false;",
    expectAxis: "못 쟀다" },

  { what: "«안 가진 축인데 돈이 있는» 줄을 뺀다(합계 ≠ 내역 · 고객이 «없어진 돈»을 본다)",
    file: "lib/revenue/aggregate.ts",
    from: "    if (!ownedAxes.includes(a) && sum[a] === 0) continue;",
    to: "    if (!ownedAxes.includes(a) || sum[a] === 0) continue;",
    expectAxis: "안 가진 축인데 돈이 있으면" },

  { what: "🔴 종류 배지가 «kind=cardnews» 를 안 본다(C 가 실측으로 잡은 그 버그 — 인스타 5종 중 4종이 빈칸이 된다)",
    file: "lib/slots.ts",
    from: '  if (k === "cardnews" || String(format ?? "") === "cardnews") return "cardnews";',
    to: '  if (String(format ?? "") === "cardnews") return "cardnews";',
    expectAxis: "kind=cardnews · format=steps" },

  { what: "이웃이 0명인데 «가장 가까운 이웃 0분»으로 메운다(«모른다»를 «값»으로)",
    file: "lib/publish-gap.ts",
    from: "  const nearestMin = diffs.length ? Math.min(...diffs) : undefined;",
    to: "  const nearestMin = diffs.length ? Math.min(...diffs) : 0;",
    expectAxis: "이웃이 0명이면 nearestMin 키가 아예 없다" },
];

/** 하니스를 돌리고 **빨개진 축 이름**을 모은다. 종료코드 0 이면 «아무도 안 잡았다». */
function runHarness() {
  let out = "";
  let code = 0;
  /* 🔴 **`execFileSync("npx", ...)` 를 쓰면 안 된다** — 윈도에서 `npx` 는 `.cmd` 라 셸 없이는 못 뜬다.
     첫 판이 그래서 **여덟 변이가 전부 «우연한 덮개»로 보였다**(하니스가 아예 안 돌았는데 «안 잡혔다»로 읽혔다).
     ⚠️ 하마터면 그 거짓 빨강을 믿고 멀쩡한 축들을 «덮개»라고 적을 뻔했다 — **원판 줄이 같이 빨개진 것**이 그걸 알려 줬다(AC-100 ⑦). */
  try { out = execSync(`npx --yes tsx ${HARNESS}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: true }); }
  catch (e) { code = 1; out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
  const failed = out.split("\n").filter((l) => l.startsWith("✗")).map((l) => l.slice(1).trim());
  return { code, failed };
}

let bad = 0;
for (const m of MUTANTS) {
  const original = readFileSync(m.file, "utf8");
  if (!original.includes(m.from)) {
    console.log(`✗ 변이를 넣을 자리를 못 찾았다 — ${m.file} (코드가 바뀌었다 · 이 변이를 고쳐라)\n    ${m.what}`);
    bad++; continue;
  }
  try {
    writeFileSync(m.file, original.replace(m.from, m.to), "utf8");
    const { code, failed } = runHarness();
    if (code === 0) {
      console.log(`✗ 🔴 **아무도 안 잡았다** — ${m.what}`);
      bad++;
    } else {
      /* 🔴 여기가 이 파일의 값이다 — «잡혔나»가 아니라 «**맞는 축이** 잡았나». */
      const byRightAxis = failed.some((f) => f.includes(m.expectAxis));
      if (byRightAxis) console.log(`✓ ${m.what}\n    잡은 축 ${failed.length}개 · 그중 «${m.expectAxis}» 있음`);
      else {
        console.log(`✗ 🟠 **우연한 덮개다** — ${m.what}\n    «${m.expectAxis}» 축은 안 걸렸다. 걸린 것: ${failed.slice(0, 4).join(" / ")}`);
        bad++;
      }
      if (SHOW_NAMES) for (const f of failed) console.log(`      · ${f}`);
    }
  } finally {
    /* 🔴 되돌리기에 실패하면 **조용히 넘어가지 않는다** — 망가진 나무를 남기는 것이 이 검사가 할 수 있는 제일 나쁜 일이다. */
    try { writeFileSync(m.file, original, "utf8"); }
    catch (e) { console.error(`🔴🔴 되돌리기 실패 — ${m.file} 을 손으로 되돌려라: ${String(e?.message ?? e)}`); process.exit(1); }
  }
}

/* 🔴 **원판 줄을 마지막에 한 번 더 찍는다**(AC-100 ⑦) — 되돌리기가 제대로 됐는지까지가 이 검사다. */
const back = runHarness();
if (back.code !== 0) { console.log(`✗ 🔴 되돌린 뒤에도 하니스가 빨갛다 — 나무가 망가졌다: ${back.failed.slice(0, 3).join(" / ")}`); bad++; }
else console.log("✓ 원판 — 되돌린 뒤 하니스 초록");

console.log(`\n${bad ? "FAIL" : "PASS"} 변이 ${MUTANTS.length - bad}/${MUTANTS.length}`);
process.exit(bad ? 1 : 0);
