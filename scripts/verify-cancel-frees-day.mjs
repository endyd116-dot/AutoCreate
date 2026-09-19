/**
 * scripts/verify-cancel-frees-day.mjs — 🔴 **«취소가 취소인가»** — 세는 쪽과 놓아 주는 쪽이 갈라지지 않았나 (B · 2026-09-21)
 *
 *   ══ 왜 ══
 *   하루 몫은 «나간 글 + 잡아 둔 글»을 센다. 그런데 **세는 목록**과 **놓아 주는 목록**이 두 곳에 손으로 적혀 있었고
 *   **서로의 여집합이 아니었다**:
 *     · `cadence-check` (세는 쪽)  = «`failed`·`rejected`·`published` 빼고 다 센다»
 *     · `slots-skip`   (푸는 쪽)  = «`generating`·`draft`·`in_review`·`approved`·`scheduled` 일 때만 버린다»
 *   ⇒ 그 틈에 있던 **`awaiting_manual`(라이브 11건)·`edited`(2건)** 은 «이날은 건너뛰기»를 눌러도 **그날 몫이 안 풀렸다.**
 *   손님 눈엔 «취소했는데 오늘 더 못 올린다» — 그냥 고장이다.
 *
 *   🔴 **메인이 말한 `draft` 는 이 고장의 얼굴이 아니었다**(2026-09-21 실측):
 *      제품 코드에 `status = 'draft'` 를 **쓰는 곳이 0곳**이고, 라이브 `draft` 4건은 **전부 `scheduled_for` 가 NULL** 이라
 *      세는 질의에 애초에 안 걸린다. 진짜 새던 자리는 **위의 두 목록이 어긋난 곳**이다.
 *      ⇒ 자는 «누가 세느냐»가 아니라 **«두 목록이 한 벌인가»**를 잰다.
 *
 *   ══ 무엇을 재나 (파일만 읽는다 · `safe`) ══
 *     ① 🔴 놓아 주는 쪽이 **손 목록으로 돌아가지 않았다**(`status IN ('generating', …)` 가 되살아나면 또 갈라진다).
 *     ② 🔴 두 곳이 **같은 한 벌**(`DAY_FREED_STATUSES`)을 본다 — 정의만 있고 안 쓰면 소용없다(AC-69: 정의가 아니라 **호출**).
 *     ③ 🔴 놓아 줄 때 빼는 것은 **되돌릴 수 없는 것 하나**(`publishing`)뿐이다 — 더 빼면 그만큼 또 «안 풀리는 상태»가 생긴다.
 *     대조군 — 세는 쪽이 여전히 **잡아 둔 글을 센다**(이 자가 «다 놓아 줘라»가 아니다).
 *
 *   🔴 **이 자가 못 하는 것**(AC-9):
 *     · 실제로 몫이 **풀리는지**는 안 본다(그건 라이브가 필요하다 · `scripts/_smoke/cancel-frees-day-smoke.mts` 가 잰다:
 *       `awaiting_manual` 0→1→**0** · `edited` 0→1→**0** · `publishing` 은 막힌다).
 *     · 다른 «취소»(버리기 `pieces-reject`)는 안 본다 — 거긴 이미 `rejected` 로 간다.
 *
 *   백슬래시 없는 검사만(AC-100) · 주석을 걷고 센다(AC-109 ①).
 *
 *   쓰기: node scripts/verify-cancel-frees-day.mjs
 */
import { readFileSync, existsSync } from "node:fs";

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const COUNT_FILE = "lib/cadence-check.ts";      // 세는 쪽
const FREE_FILE = "netlify/functions/rules.ts"; // 놓아 주는 쪽(«이날은 건너뛰기»)
const countSrc = codeOnly(read(COUNT_FILE));
const freeSrc = codeOnly(read(FREE_FILE));

const out = [];
const rec = (step, ok, note) => { out.push({ ok }); console.log(`  ${ok ? "✓" : "✗"} ${step}  — ${note}`); return ok; };

console.log(`\n«취소가 취소인가 — 세는 쪽과 놓아 주는 쪽이 한 벌인가» · ${new Date().toISOString()}`);
console.log(`■ 내가 세는 모수 — 세는 쪽 1곳(${COUNT_FILE}) · 놓아 주는 쪽 1곳(${FREE_FILE})`);
console.log("─".repeat(120));

/* ① 손 목록이 되살아나지 않았나 */
{
  /* 옛 모양: `AND status IN ('generating','draft','in_review','approved','scheduled')` */
  const hand = [...freeSrc.matchAll(/status\s+IN\s*\(\s*'(?:generating|draft|in_review|approved|scheduled)'/gi)];
  rec("① 🔴 놓아 주는 쪽이 **손으로 적은 목록**으로 돌아가지 않았다", hand.length === 0,
    hand.length ? `🔴 손 목록 ${hand.length}곳이 되살아났다 — 세는 쪽과 또 어긋난다(그 틈의 상태는 취소해도 안 풀린다)`
      : "«그날을 놓아 준 상태»의 여집합으로만 버린다");
}

/* ② 두 곳이 같은 한 벌을 **쓰나**(정의가 아니라 호출) */
{
  const defined = /export const DAY_FREED_STATUSES\s*=/.test(countSrc);
  const usedByCount = /statusListSql\(\s*DAY_FREED_STATUSES\s*\)/.test(countSrc);
  const usedByFree = /DAY_FREED_STATUSES/.test(freeSrc) && /statusListSql\(/.test(freeSrc);
  const imported = /import\s*\{[^}]*DAY_FREED_STATUSES[^}]*\}\s*from\s*"[^"]*cadence-check"/.test(freeSrc);
  const ok = defined && usedByCount && usedByFree && imported;
  rec("② 🔴 두 곳이 **같은 한 벌**을 본다(정의만 있고 안 쓰는 것이 아니다 · AC-69)", ok,
    ok ? "`DAY_FREED_STATUSES` 를 세는 쪽·놓아 주는 쪽이 둘 다 질의에 끼워 쓴다"
      : `🔴 정의=${defined} · 세는 쪽이 씀=${usedByCount} · 놓아 주는 쪽이 씀=${usedByFree} · 가져옴=${imported}`);
}

/* ③ 놓아 줄 때 빼는 것은 «되돌릴 수 없는 것» 하나뿐인가 */
{
  const m = freeSrc.match(/statusListSql\(\s*\[\s*\.\.\.\s*DAY_FREED_STATUSES\s*,([^\]]*)\]/);
  const extras = m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : null;
  const ok = !!extras && extras.length === 1 && extras[0] === "publishing";
  rec("③ 🔴 놓아 줄 때 빼는 것은 **«지금 나가는 중»** 하나뿐이다", ok,
    extras === null ? "🔴 놓아 주는 목록을 못 찾았다 — 이 자를 고쳐라(조용히 통과시키지 않는다)"
      : ok ? "`publishing` 만 뺀다 — 그것만 되돌릴 수 없다"
        : `🔴 더 빼고 있다: ${extras.join(", ")} — 뺀 만큼 «취소해도 안 풀리는 상태»가 다시 생긴다`);
}

/* 대조군 — 세는 쪽이 여전히 «잡아 둔 글»을 센다 */
{
  const countsPlanned = /FROM pieces x/.test(countSrc) && /scheduled_for IS NOT NULL/.test(countSrc);
  const countsPosted = /FROM posts p/.test(countSrc) && /published_at IS NOT NULL/.test(countSrc);
  rec("대조군 — **이 자는 «다 놓아 줘라»가 아니다**(잡아 둔 글은 여전히 센다)", countsPlanned && countsPosted,
    countsPlanned && countsPosted ? "나간 글 + 잡아 둔 글을 같은 날(KST)로 함께 센다 — 그래야 하루에 다섯 편이 안 잡힌다"
      : `🔴 세는 쪽이 헐거워졌다 — 잡아 둔 글=${countsPlanned} · 나간 글=${countsPosted}`);
}

console.log("─".repeat(120));
const bad = out.filter((x) => !x.ok).length;
console.log(bad ? `🔴 FAIL ${bad} / ${out.length}` : `PASS ${out.length} · FAIL 0`);
console.log("🔴 이 자는 **두 목록이 한 벌인가**까지 잰다 — 몫이 실제로 풀리는지는 `_smoke/cancel-frees-day-smoke.mts` 가 잰다(머리말).");
process.exit(bad ? 1 : 0);
