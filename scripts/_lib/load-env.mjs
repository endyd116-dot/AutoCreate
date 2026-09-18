/**
 * scripts/_lib/load-env.mjs — 🔴 **`.env` 를 «import 보다 먼저» 읽는다**(C · 2026-09-19).
 *
 *   ══ 왜 파일로 떼어 뒀나 ══
 *   `.env` 읽는 코드를 스크립트 **본문**에 두면 늦는다 — ESM 은 `import` 를 먼저 평가하므로
 *   `import { db } from "../db/index"` 가 **본문이 한 줄도 돌기 전에** `process.env.NETLIFY_DATABASE_URL` 을 읽고
 *   빈 문자열로 풀을 만든다. 그러면 첫 질의에서 `read ECONNRESET` 이 난다(2026-09-19 실측).
 *   🔴 **«못 쟀다»도 «틀렸다»도 아닌, 자가 스스로 만든 가짜 빨강**이다.
 *
 *   ⇒ 쓰는 법 — **맨 위 첫 줄**에 두면 된다(ESM 은 형제 import 를 적힌 차례대로 평가한다):
 *     import "./_lib/load-env.mjs";
 *     import { db } from "../db/index";
 *
 *   🔴 이미 있는 값은 **안 덮는다** — 셸이 준 것이 이긴다(`TZ=UTC node …` 같은 시험을 막지 않으려고).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
for (const name of [".env"]) {
  const p = path.join(ROOT, name);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;          // 셸이 준 값이 이긴다
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
