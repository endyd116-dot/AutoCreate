/**
 * scripts/_lib/find-playwright.mjs — **playwright 를 어디서 빌려 오나**(메인 · 2026-09-16).
 *
 *   ══ 왜 ══
 *   `verify-runner-scrape.mts`·`verify-runner-wait.mts` 는 `createRequire(runner/package.json)` 로
 *   playwright 를 찾았다. 그런데 `runner/node_modules` 는 **B2·C 폴더에만** 있다 —
 *   메인·A·B 폴더에서는 두 검사가 늘 **빨강**이었다. 제품이 틀린 게 아니라 **재료가 없는 것**인데
 *   «실패 2개»로 찍혔다. 🔴 **누가 돌려도 빨강 2개가 나오면 곧 아무도 빨강을 안 본다**(AC-95).
 *
 *   ⇒ `verify-r8-ops-aicost.mjs` 가 이미 쓰던 관례를 그대로 쓴다 — **없으면 옆 리포에서 빌린다.**
 *   ⇒ 그래도 없으면 **exit 2**(«못 쟀다») 다. 🔴 **«통과»라고 말하지 않는다**(AC-9).
 *      exit 1(제품이 틀렸다) 과 exit 2(잴 재료가 없다) 는 다른 말이다 — `verify-safe-list.mjs` 가 갈라서 센다.
 *
 *   쓰는 법:
 *     import { requirePlaywright } from "./_lib/find-playwright.mjs";
 *     const { chromium } = await requirePlaywright();   // 없으면 안내 찍고 exit 2
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** 🔴 찾는 순서 — **우리 러너 것이 먼저**다(고객이 실제로 쓰는 판). 그다음이 빌려 오는 것. */
export function playwrightDirs() {
  const dirs = [path.join(ROOT, "runner", "node_modules")];
  if (process.env.PW_DIR) dirs.push(path.resolve(ROOT, process.env.PW_DIR, "node_modules"));
  dirs.push(path.resolve(ROOT, "..", "AutoMarketing", "node_modules"));
  dirs.push(path.join(ROOT, "node_modules"));
  return dirs;
}

/** 찾으면 진입점 경로, 못 찾으면 null. */
export function findPlaywright() {
  for (const d of playwrightDirs()) {
    const entry = path.join(d, "playwright", "index.mjs");
    if (existsSync(entry)) return entry;
  }
  return null;
}

/** 찾아서 불러 준다. 🔴 못 찾으면 **exit 2** — «못 쟀다»이지 «통과»가 아니다. */
export async function requirePlaywright() {
  const entry = findPlaywright();
  if (!entry) {
    console.error(
      "⊘ 못 쟀어요 — playwright 를 못 찾았습니다(제품이 틀린 게 아닙니다).\n" +
      "  찾아본 곳:\n" + playwrightDirs().map((d) => `    · ${path.join(d, "playwright")}`).join("\n") +
      "\n  거는 법: runner 폴더에서 `npm i` · 또는 PW_DIR=<playwright 가 깔린 리포> 로 알려 주세요.",
    );
    process.exit(2);
  }
  return await import(pathToFileURL(entry).href);
}
