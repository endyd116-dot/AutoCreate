/**
 * scripts/verify-runner-version-surface.mts — 🔴 **«고객 PC 가 받아 가는 판»이 운영 화면에 서 있나.**
 *
 *   사용:  npx --yes tsx scripts/verify-runner-version-surface.mts            (0 = 전부 통과)
 *          npx --yes tsx scripts/verify-runner-version-surface.mts --mutate   (🔴 스스로 망가뜨려 본다 · AC-108)
 *
 *   ══ 왜 ══
 *     2026-09-15 에 «고객 러너는 v1.3.0» 이라는 말이 **세 번 인용됐는데 라이브는 v1.1.8** 이었다.
 *     근거가 `runner/package.json`(= 우리 소스)이었기 때문이다 — 고객이 받아 가는 것은 R2 의 `latest.json` 이다.
 *     `scripts/read-runner-live.mts` 가 그때 생겼지만 **사람이 손으로 부르는 자**라, 운영자가 `/ops/runners` 를
 *     보고 있는 동안에는 아무도 그 사실을 모른다.
 *
 *   ══ 🔴 이 자가 지키는 것 ══
 *     ① **잣대가 한 벌인가** — 화면의 «낡음»과 하트비트의 «업데이트 권함»이 **같은 조건**이어야 한다.
 *        갈리면 «화면은 낡았다는데 러너는 안 받는» 유령이 생긴다.
 *     ② **«못 쟀다»를 «최신»으로 접지 않는가**(AC-9) — R2 를 못 읽은 것과 «이 기기는 최신» 은 다른 사실이다.
 *     ③ **롤백했을 때 멀쩡한 기기를 «낡음»이라고 하지 않는가** — 우리가 판을 내리면 기기가 더 높을 수 있다.
 *
 *   🔴 R2·DB·네트워크 0. 순수 함수 + 배선 검사만. provider 실호출 0.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const MUTATE = process.argv.includes("--mutate");
let bad = 0, measured = 0;
const rec = (name: string, ok: boolean, detail = "") => {
  measured++; if (!ok) bad++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const live = (version: string | null, extra: Partial<{ measured: boolean; reason: string }> = {}) =>
  ({ measured: extra.measured ?? true, version, releasedAt: null, bytes: 1, sha256: null, notes: null, zipOk: true, bytesMatch: true, ...extra }) as never;

async function run(): Promise<void> {
  const { runnerUpToDate, cmpVersion } = await import("../lib/runner-release.js");

  /* ── 잡는 축 ── */
  rec("① 기기가 뒤처지면 «낡음»", runnerUpToDate("1.1.8", live("1.4.0")) === false);
  rec("② 같은 판이면 «최신»", runnerUpToDate("1.4.0", live("1.4.0")) === true);

  /* ── 반증 축 — «낡음»이라고 하면 안 되는 자리 ── */
  rec("③ 🔴 롤백 — 기기가 더 높아도 «낡음»이 아니다", runnerUpToDate("1.5.0", live("1.4.0")) === true, "우리가 판을 내린 경우");
  rec("④ 🔴 라이브를 못 읽었으면 «못 쟀다»(null) — «최신»으로 접지 않는다",
    runnerUpToDate("1.1.8", live(null, { measured: false, reason: "R2 없음" })) === null);
  rec("⑤ 🔴 기기가 판을 안 알려 줬으면 «못 쟀다»(null)", runnerUpToDate(null, live("1.4.0")) === null);
  rec("⑥ 🔴 형식이 아닌 판은 «낡음»이라고 단정하지 않는다", runnerUpToDate("dev-build", live("1.4.0")) === null, "«dev-build»");

  /* ⑦ 🔴 **잣대가 한 벌** — 화면의 «낡음» ⟺ 하트비트가 업데이트를 권하는 조건(`cmpVersion(live, device) > 0`).
        둘이 갈리면 «화면은 낡았다는데 러너는 안 받는» 유령이 생긴다. 표로 전수 대조한다. */
  const PAIRS: [string, string][] = [["1.4.0", "1.1.8"], ["1.4.0", "1.4.0"], ["1.4.0", "1.5.0"], ["2.0.0", "1.9.9"], ["1.0.1", "1.0.0"], ["1.0.0", "1.0.1"]];
  const mismatch = PAIRS.filter(([L, D]) => (runnerUpToDate(D, live(L)) === false) !== (cmpVersion(L, D) > 0));
  rec("⑦ 🔴 화면의 «낡음» = 하트비트가 권하는 조건(잣대 한 벌)", mismatch.length === 0,
    mismatch.length ? `어긋남 ${mismatch.map(([L, D]) => `live ${L}/기기 ${D}`).join(" · ")}` : `${PAIRS.length}쌍 전수 일치`);

  /* ── 배선(⚠️ 실행 아님 — R2·로그인이 있어야 도는 자리라 여기선 «달렸나»만 본다 · AC-9) ── */
  const api = readFileSync("netlify/functions/ops-runners.ts", "utf8");
  rec("⑧ 서버가 라이브 판을 실어 보낸다(⚠️ 배선)", /releaseHealth\(\)/.test(api) && /release,\s*farm:/.test(api));
  rec("⑨ 서버가 기기마다 판정해 보낸다(화면이 다시 짜지 않는다 · AC-74)(⚠️ 배선)", /upToDate:\s*runnerUpToDate\(/.test(api));

  /* 🔴 **정본을 읽는다**(생성물이 아니라). `public/ops/runners.html` 은 `_tpl.txt` 에서 **빌드되는 것**이라
     거기만 고치면 다음 빌드에 날아간다 — 2026-09-19 에 내가 실제로 그렇게 고쳤다가 `verify-r8-deadends` 에 잡혔다.
     ⚠️ «정본과 생성물이 어긋났나»는 이 자가 아니라 `verify-r8-deadends` 가 본다(두 자가 같은 것을 다르게 세면 갈린다 · AC-101). */
  const html = readFileSync("public/ops/_tpl.txt", "utf8");
  rec("⑩ 화면이 라이브 판을 그린다(⚠️ 배선)", /r\.release/.test(html) && /받아 가는 판/.test(html));
  rec("⑪ 🔴 화면이 «못 쟀어요»라고 말한다(«없다»로 접지 않는다 · AC-9)(⚠️ 배선)", /못 쟀어요/.test(html));
  rec("⑫ 🔴 가리키는 zip 이 없으면 화면이 그 말을 한다(러너가 받다 실패한다)(⚠️ 배선)", /zipOk === false/.test(html));
  rec("⑬ 시각은 KST 소도구로만(§4.5b)(⚠️ 배선)", /OPS\.dateKST\(rel\.releasedAt\)/.test(html) && !/new Date\(rel\.releasedAt\)/.test(html));
}

/* ── 🔴 스스로 변이(AC-108) ── */
const MUTANTS = [
  { what: "«못 쟀다»를 «최신»으로 접는다(AC-9 위반 — 이게 2026-09-15 사고의 모양이다)",
    file: "lib/runner-release.ts",
    from: "  if (!rel.measured || !rel.version) return null;", to: "  if (!rel.measured || !rel.version) return true;", expect: "④" },
  { what: "잣대를 화면 전용으로 따로 짠다(하트비트와 갈린다)",
    file: "lib/runner-release.ts",
    from: "  return cmpVersion(rel.version, v) <= 0;", to: "  return rel.version === v;", expect: "③" },
  { what: "서버 판정을 빼고 화면에 맡긴다(AC-74)",
    file: "netlify/functions/ops-runners.ts",
    from: "        upToDate: runnerUpToDate(", to: "        upToDateX: runnerUpToDate(", expect: "⑨" },
];

async function mutate(): Promise<void> {
  console.log("\n🔴 변이 — 일부러 망가뜨려 본다(안 울면 이 자는 값이 0 이다)\n");
  for (const m of MUTANTS) {
    const orig = readFileSync(m.file, "utf8");
    if (!orig.includes(m.from)) { console.log(`  ⊘ «${m.what}» — 심을 자리를 못 찾았다(자가 낡았다)`); bad++; continue; }
    try {
      writeFileSync(m.file, orig.replace(m.from, m.to));
      let caught = false, out = "";
      try { execFileSync("npx", ["--yes", "tsx", "scripts/verify-runner-version-surface.mts"], { encoding: "utf8", stdio: "pipe", shell: true }); }
      catch (e) { caught = true; out = String((e as { stdout?: string })?.stdout ?? ""); }
      const byName = caught && out.split("\n").some((l) => l.startsWith("  ✗") && l.includes(m.expect));
      console.log(`  ${byName ? "✓" : "✗"} «${m.what}» — ${caught ? (byName ? `잡혔다(맞는 축 «${m.expect}»)` : "잡히긴 했는데 **딴 축**이 잡았다(우연한 덮개)") : "🔴 안 잡혔다"}`);
      if (!byName) bad++;
    } finally {
      writeFileSync(m.file, orig);
      if (readFileSync(m.file, "utf8") !== orig) { console.error(`🔴🔴 되돌리기 실패 — ${m.file} 를 손으로 확인하라`); process.exit(1); }
    }
  }
}

console.log("■ 러너 판이 운영 화면에 서 있나 — 그리고 잣대가 한 벌인가\n");
await run();
if (MUTATE) await mutate();
console.log(`\n${bad ? `🔴 실패 ${bad}` : `✅ 잰 ${measured}축 전부 통과`}`);
process.exit(bad ? 1 : 0);
