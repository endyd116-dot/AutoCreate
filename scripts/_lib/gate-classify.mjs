/**
 * scripts/_lib/gate-classify.mjs — 🔴 **어느 자를 «다 돌려도» 되나 — 가르는 법 한 곳**(C · 2026-09-27 · R19 C0)
 *
 *   ══ 왜 떼어 냈나 ══
 *   이 갈래는 `verify-safe-list.mjs`(C · 2026-09-16) 본문에 있었다. R19 에 배포 체인(`gate-parallel.mjs`)이
 *   **같은 갈래**로 «무엇을 체인에 넣나»를 정해야 해서 여기로 옮겼다 — 두 벌이면 한쪽만 고쳐지고 갈린다(AC-82).
 *   🔴 **낱말·판정은 한 글자도 안 바꿨다**(옮기기만) — 옮기기 전후 `verify-safe-list` 목록이 같다(커밋 글에 수를 적었다).
 *
 *   세 갈래:
 *     · `safe`  — 파일만 읽는다. 언제나 돌려도 된다.
 *     · `live`  — 🔴 **라이브에 쓴다**(가입·발행·결제) 또는 DB·네트워크에 닿는다. 사람이 뜻을 갖고 하나씩 돌린다.
 *     · `needs` — 돌리려면 뭔가 더 있어야 한다(개발 서버·인자·실호출 = 돈).
 *   🔴 갈래는 **파일을 읽어서** 정한다 — 손으로 든 목록이면 새 하니스가 생길 때마다 낡는다(AC-82).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "./code-only.mjs";

/**
 * 🔴 이 낱말들이 있으면 **밖으로 나가거나 라이브를 만진다**고 본다(의심되면 안전한 쪽으로 — `live` 로 민다).
 *   🔴 [2026-09-16 고침] 첫 판은 «쓰기»만 봤다 — 그래서 **라이브 DB 에 붙어 읽기만 하는** 하니스 둘
 *      (`verify-coin-reconcile`·`verify-r8a-text-probe`)이 `safe` 로 떨어졌고, 연결이 끊기자 «실패 2건»으로 찍혔다.
 *      읽기여도 **라이브에 붙는 것은 safe 가 아니다**: 네트워크가 나쁜 날 빨강이 되고, 접속 수를 먹고, 무엇보다
 *      «언제나 돌려도 되는 것»이라는 이 갈래의 뜻과 다르다. ⇒ **DB·네트워크에 닿으면 전부 `live`**.
 */
export const WRITES = /\bfetch\s*\(|BASE_URL|autocreate-endyd|\/api\/auth-register|teardownRun|sql`\s*(INSERT|UPDATE|DELETE)|NETLIFY_DATABASE_URL|from "postgres"|db\/index|\.\.\/db\b/i;
/** 개발 서버·인자·실호출이 필요한 것. */
export const NEEDS = /localhost:\d+|process\.argv\[2\]|사용법:|GEMINI_API_KEY/;
/** 🔴 [2026-09-19 B2] **키 이름이 있다고 «키가 필요한 자»는 아니다.**
 *   `verify-ac111-stub-voice.mts` 는 실호출을 막으려고 키를 **일부러 빈 문자열로 덮는다** — 그런데 그 낱말 때문에
 *   `needs` 로 분류돼 **safe-list 가 영영 안 돌리는 자**가 됐다(자가 있으나 마나가 된다).
 *   ⇒ 키를 **비우는 코드가 같은 파일에 있으면** 그 낱말은 «필요»의 증거가 아니다. 다른 needs 신호(개발 서버·인자)는 그대로 본다.
 *   ⚠️ 좁게 본다: `GEMINI_API_KEY: ""` 또는 `GEMINI_API_KEY = ""` 처럼 **빈 값으로 덮는 모양**만 인정한다. */
export const CLEARS_KEY = /GEMINI_API_KEYS?\s*[:=]\s*""/;
/** 🔴 «읽기만»이라고 **스스로 못 박은** 파일은 그 말을 믿되, 쓰기 낱말이 있으면 그 말보다 코드가 이긴다. */
export const SAYS_READONLY = /읽기만|읽기 전용|SELECT 만/;

/** `scripts/verify-*.{mjs,mts}` 를 세 갈래로 가른다. 반환: `{ safe, live, needs }` — 각 원소는 `[파일이름, 까닭]`. */
export function classifyGates(scriptsDir = "scripts") {
  const files = readdirSync(scriptsDir).filter((f) => /^verify-.*\.(mjs|mts)$/.test(f)).sort();
  const groups = { safe: [], live: [], needs: [] };
  for (const f of files) {
    const raw = readFileSync(path.join(scriptsDir, f), "utf8");
    /* 🔴 [2026-09-19 C] **주석을 걷고 가른다**(AC-109 ①) — 이 분류기가 그 병에 걸려 있었다.
       `verify-key-contract.mjs` 는 파일만 읽는 자인데, **머리말에 적힌 설명 한 줄**
       («`fetch()` 직접 호출은 안 본다»)이 `WRITES` 에 걸려 **`live` 로 분류돼 전수 실행에서 통째로 빠져 있었다.**
       🔴 그 자가 지키는 것이 아홉 곳인데 **배치에서는 한 번도 안 돌았다** — 손으로 돌릴 때만 빨갰으니
       «있는데 안 도는 자»인 줄 아무도 몰랐다(AC-113 «자가 안 보는 자리»의 한 층 위 판).
       ⇒ 주석을 걷으면 **판정이 더 정확해지기만 한다**: 코드에 진짜 쓰기가 있으면 그대로 걸린다. */
    const src = codeOnly(raw);
    const writes = WRITES.test(src);
    /* 🔴 [C·2026-09-19] `SAYS_READONLY` 만 `raw` 를 본다 — **주석을 읽는 것이 그 축의 본업**이다(AC-117). */
    /* 키 이름만 있고 **비우는 코드**가 같이 있으면, 그 낱말은 빼고 다시 본다(위 CLEARS_KEY 주석). */
    const needs = CLEARS_KEY.test(src) ? /localhost:\d+|process\.argv\[2\]|사용법:/.test(src) : NEEDS.test(src);
    if (writes) groups.live.push([f, SAYS_READONLY.test(raw) ? "🟠 «읽기만»이라 적혀 있는데 쓰기 낱말이 있다 — 사람이 확인" : "라이브에 쓰거나 밖으로 나간다"]);
    else if (needs) groups.needs.push([f, "개발 서버·인자·실호출이 필요"]);
    else groups.safe.push([f, "파일만 읽는다"]);
  }
  return groups;
}

/** «기다리는 빨강»(`docs/rules/pending-red.json` 의 `대기`) — 자 이름 → 그 줄. 목록이 없으면 빈 Map(전부 «진짜 빨강»으로 본다 — 안전한 쪽). */
export function pendingRed(root = ".") {
  const out = new Map();
  try {
    for (const row of JSON.parse(readFileSync(path.join(root, "docs/rules/pending-red.json"), "utf8")).대기 || []) out.set(row.자, row);
  } catch { /* 없으면 빈 손 */ }
  return out;
}
