/**
 * scripts/verify-job-payloads.mts — 러너 잡 payload 에 **필수 칸이 빠졌는지** 실제로 검사한다(2026-09-15 B2).
 *
 *   🔴 왜 이게 있나 — 같은 실수가 **하루에 두 번, 서로 다른 파일에서** 났다:
 *      · `lib/cron/post-alive.ts` 가 `postId` 를 빠뜨렸다 → 서버가 «죽었다»는 답을 **통째로 버렸다**(병합 건너뜀).
 *      · `lib/cron/learn.ts` 가 `externalUrl` 을 빠뜨렸다 → 러너가 첫 줄에서 즉시 실패할 잡을 계속 만들었다.
 *      둘 다 **오류가 아니라 침묵**이라 컴파일러도 테스트도 안 잡는다. 화면엔 «잡 적재 성공»만 보인다.
 *      한 채널(`runner/channels/post-alive.mjs`)이 **두 kind** 를 처리하는데 **적재하는 곳은 두 파일**이라
 *      한쪽을 고쳐도 다른 쪽이 남는다 — 실제로 그렇게 남아 있었다.
 *
 *   무엇을 하나: 적재하는 코드를 읽어 `payload` 에 필수 칸 이름이 **글자 그대로** 있는지 본다.
 *   ⚠️ 한계(정직): 이건 **정적 검사**다. «칸이 있다»만 보지 «값이 옳다»는 못 본다.
 *      그래도 우리가 실제로 낸 실수 두 건은 **둘 다 칸이 아예 없는 것**이었다 — 그 종류를 막는다.
 *
 *   🔴 음성 대조 포함: 일부러 칸을 지운 가짜 코드를 넣어 **검사가 정말 걸러내는지** 같이 확인한다.
 *      («전부 통과»만 찍고 실은 아무것도 안 보는 검사가 되면 그게 제일 나쁘다.)
 *
 *   실행: npx --yes tsx scripts/verify-job-payloads.mts        (DB·네트워크 불필요)
 *        npx --yes tsx scripts/verify-job-payloads.mts <파일...>   ← 경로를 주면 그것만 본다
 *          🔴 이 손잡이의 용도: **«이 검사가 그때 그 버그를 정말 잡았을까»를 확인하는 것.**
 *             `git show <옛커밋>:lib/cron/learn.ts` 를 꺼내 돌려 보면 ✗ 가 나와야 한다 — 안 나오면 이 검사는 장식이다.
 *             (2026-09-15 실측: 옛 판 두 개를 넣어 `externalUrl`·`postId` 누락을 **둘 다 잡았다**.)
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** kind → payload 에 반드시 있어야 하는 칸(누가 읽는지까지 적는다 — 지울 때 근거가 보이게). */
const REQUIRED: Record<string, { key: string; who: string }[]> = {
  "verify.post_alive": [
    { key: "externalUrl", who: "러너 post-alive.mjs (없으면 «확인할 글 주소가 없어요»로 즉시 실패)" },
    { key: "postId",      who: "서버 runner-jobs.ts 결과 병합 (없으면 병합을 통째로 건너뛴다)" },
    { key: "title",       who: "서버 공개 확인 (없으면 «남이 볼 수 있나»를 판정 안 한다)" },
  ],
  "revenue.stats": [
    { key: "externalUrl", who: "러너 post-alive.mjs (없으면 즉시 실패)" },
    { key: "postId",      who: "서버 runner-jobs.ts 결과 병합" },
  ],
};

/** 적재하는 파일들(한 kind 를 여러 파일이 적재할 수 있다 — 그래서 파일이 아니라 **kind 기준**으로 센다). */
const DEFAULT_FILES = ["lib/cron/post-alive.ts", "lib/cron/learn.ts"];
const ARGV = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const FILES = ARGV.length ? ARGV : DEFAULT_FILES;

interface Finding { file: string; kind: string; missing: string[]; who: string[] }

/**
 * `kind: "<K>"` 가 나온 자리에서 가까운 `payload:` 블록을 찾아 칸 이름이 있는지 본다.
 * 블록은 `payload:` 부터 중괄호 균형이 맞을 때까지(주석·문자열은 무시하지 않는다 — 칸 «이름»만 찾으므로 충분하다).
 */
function payloadOf(src: string, atIdx: number): string | null {
  const win = src.slice(atIdx, atIdx + 2000);
  const pi = win.indexOf("payload:");
  if (pi < 0) return null;
  const from = win.indexOf("{", pi);
  if (from < 0) return null;
  let depth = 0;
  for (let i = from; i < win.length; i++) {
    if (win[i] === "{") depth++;
    else if (win[i] === "}") { depth--; if (depth === 0) return win.slice(from, i + 1); }
  }
  return null;
}

function scan(label: string, src: string): Finding[] {
  const out: Finding[] = [];
  for (const [kind, reqs] of Object.entries(REQUIRED)) {
    const needle = `kind: "${kind}"`;
    let i = src.indexOf(needle);
    while (i >= 0) {
      const block = payloadOf(src, i);
      if (block) {
        const missing = reqs.filter((r) => !new RegExp(`\\b${r.key}\\b`).test(block));
        if (missing.length) out.push({ file: label, kind, missing: missing.map((m) => m.key), who: missing.map((m) => m.who) });
      }
      i = src.indexOf(needle, i + needle.length);
    }
  }
  return out;
}

console.log("\n  러너 잡 payload 필수 칸 검사\n");

let bad = 0, checked = 0;
for (const f of FILES) {
  // `resolve` 다(`join` 이 아니다) — 절대경로를 주면 `join` 은 앞에 ROOT 를 붙여 망친다(옛 판 대조 때 실제로 그랬다).
  const p = path.resolve(ROOT, f);
  if (!fs.existsSync(p)) { console.error(`  ✗ ${f} — 파일이 없다(경로가 바뀌었으면 이 목록도 고쳐야 한다)`); bad++; continue; }
  const src = fs.readFileSync(p, "utf8");
  const found = scan(f, src);
  const kinds = Object.keys(REQUIRED).filter((k) => src.includes(`kind: "${k}"`));
  checked += kinds.length;
  if (!kinds.length) { console.log(`  · ${f} — 적재 없음`); continue; }
  if (found.length) {
    bad += found.length;
    for (const x of found) {
      console.error(`  ✗ ${x.file}  [${x.kind}]  빠진 칸: ${x.missing.join(", ")}`);
      for (const w of x.who) console.error(`      └ 읽는 쪽: ${w}`);
    }
  } else console.log(`  ✓ ${f}  [${kinds.join(", ")}]  필수 칸 전부 있음`);
}

/* 🔴 음성 대조 — 일부러 칸을 지운 가짜 코드가 **반드시** 걸려야 한다.
   안 걸리면 위의 ✓ 는 «검사가 아무것도 안 본다»는 뜻이므로 초록을 취소한다. */
const FAKE = `
  const job = await enqueueRunnerJob(tid, {
    kind: "revenue.stats", accountId: 1, pieceId: 2,
    payload: { milestoneH: 24, dedupe: "x" }, priority: 80,
  });`;
const caught = scan("(음성대조)", FAKE);
const okNeg = caught.length === 1 && caught[0].missing.includes("externalUrl") && caught[0].missing.includes("postId");
console.log(`\n  ${okNeg ? "✓" : "✗"} 음성 대조 — 칸을 지운 가짜 코드를 ${okNeg ? "걸러냈다" : "🔴 못 걸렀다(이 검사는 믿을 수 없다)"}`);

if (!checked) { console.error("\n  ✗ 적재 자리를 하나도 못 찾았다 — 검사가 헛돌고 있다(kind 문자열 표기가 바뀌었나?)\n"); process.exitCode = 1; }
else if (bad || !okNeg) { console.error(`\n  ✗ 실패 ${bad}건\n`); process.exitCode = 1; }
else console.log(`\n  ✓ 적재 ${checked}자리 모두 통과 · 검사 자체도 살아 있다.\n`);
