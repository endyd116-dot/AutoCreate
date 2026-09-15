#!/usr/bin/env node
/**
 * runner/ac-runner.mjs — AutoCreate 내 PC 러너 엔트리(계약 §7 · DESIGN §8.1 «내 PC 러너»).
 *   AM 원본: ../AutoMarketing/scripts/runner-start.bat + content-runner-core.mjs 의 루프 관례(이식 2026-09-14).
 *
 *   쓰는 법
 *     node ac-runner.mjs --token acr_xxx    처음 한 번(토큰을 runner/.token 에 저장한다)
 *     node ac-runner.mjs                    계속 돌기(하트비트 + 큐 소비)
 *     node ac-runner.mjs --peek             큐만 들여다보기(아무것도 실행하지 않는다)
 *     node ac-runner.mjs --once             한 건만 처리하고 끝
 *     node ac-runner.mjs --headed           창을 띄워서(눈으로 보며)
 *     node ac-runner.mjs --canary           자사 테스트 계정으로 «임시저장까지» 드라이런(발행 안 함)
 *     node ac-runner.mjs --dry-run          집어온 잡을 임시저장까지만 하고 큐에 되돌림(발행 안 함)
 *   환경변수: AC_SERVER(기본 라이브) · RUNNER_SHOTS=1(단계 스냅샷) · AC_LOGIN_WAIT_MS
 *
 *   🔴 시각 표기는 KST(사람이 보는 것) · 서버 저장은 UTC(DESIGN §13.5).
 */
import { readToken, saveToken, serverBase, maskToken, heartbeat, claim, VERSION } from "./lib/api.mjs";
import { tick, canary, log, claimableKinds, runnerCaps } from "./core.mjs";
import { applyUpdate, isNewer, RESTART_EXIT_CODE } from "./lib/update.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

const OPT = {
  token: valueOf("--token"),
  peek: has("--peek"),
  once: has("--once"),
  headed: has("--headed"),
  canary: has("--canary"),
  dryRun: has("--dry-run") || has("--canary"),
  max: Number(valueOf("--max") ?? 1) || 1,
};

async function loadChromium() {
  try {
    const pw = await import("playwright");
    return pw.chromium;
  } catch {
    console.error("");
    console.error("  ✗ 브라우저 도구(playwright)가 설치되지 않았어요.");
    console.error("    runner 폴더에서 다음 두 줄을 차례로 실행해 주세요:");
    console.error("      npm install");
    console.error("      npx playwright install chromium");
    console.error("");
    process.exit(2);
  }
}

async function main() {
  console.log(`\n  AutoCreate 러너 v${VERSION}  ·  서버 ${serverBase()}\n`);

  if (OPT.token) { saveToken(OPT.token); log(`토큰을 저장했어요(${maskToken(OPT.token)}).`); }
  const token = readToken(OPT.token);
  if (!token) {
    console.error("  ✗ 토큰이 없어요. 앱의 «내 PC에서 켜기» 화면에서 받은 토큰으로 한 번만 실행해 주세요:");
    console.error("      node ac-runner.mjs --token acr_...\n");
    process.exit(1);
  }

  // 연결 확인 — 토큰이 틀렸으면 여기서 바로 말한다(큐를 돌다가 조용히 실패하지 않게).
  const hello = await heartbeat(token, { jobs: 0, caps: runnerCaps() });
  if (!hello?.ok) { console.error(`  ✗ ${hello?.error ?? "서버에 연결하지 못했어요."}\n`); process.exit(1); }
  log(`서버 연결 확인 · 대기 중인 잡 ${hello.jobsWaiting ?? 0}건`);

  /* --peek — 큐만 본다. 🔴 claim 은 선점이라 «보기»가 아니다. 그래서 하트비트가 알려 준 개수만 쓴다. */
  if (OPT.peek) {
    log(`대기 중인 잡: ${hello.jobsWaiting ?? 0}건 (다음 확인까지 ${hello.sleepSec ?? 60}초)`);
    log("--peek 는 큐를 집어 가지 않아요. 실제로 돌리려면 --once 또는 인자 없이 실행하세요.\n");
    return;
  }

  const chromium = await loadChromium();

  if (OPT.canary) { await canary({ chromium, token, headed: OPT.headed }); return; }

  if (OPT.once) {
    const { count, results } = await tick({ chromium, token, kinds: claimableKinds(), max: OPT.max, headed: OPT.headed, dryRun: OPT.dryRun });
    if (!count) { log("지금은 할 일이 없어요."); return; }
    /* 🔴 실패했으면 **종료코드로 말한다**. 검증 하니스가 잡 행만 보고 판정하면 드라이런 실패에 ✓ 가 찍힌다
       (드라이런은 잡을 큐로 되돌리므로 행만으로는 성공·실패가 같아 보인다 · 2026-09-14 실측). */
    const failed = results.filter((r) => !r?.ok);
    if (failed.length) {
      for (const f of failed) log(`  실패 사유: ${f.errorKind} — ${f.detail ?? ""}`);
      process.exitCode = 1;
    }
    return;
  }

  // 계속 돌기 — 서버가 알려 주는 sleepSec 을 존중한다(할 일이 있으면 5초·없으면 60초).
  let stop = false;
  const bye = () => { if (!stop) { stop = true; log("종료합니다(진행 중인 잡은 마무리해요)."); } };
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);

  let idleRounds = 0;
  /* 업데이트 실패는 **다음 하트비트에 실어** 서버에 알린다(전용 요청을 더 만들지 않는다).
     한 번 실패한 판을 매분 다시 받으러 가지 않도록 그 버전은 기억해 둔다 — 서버가 새 판을 올리면 다시 시도한다. */
  let updateFailed = null;
  const updateTried = new Set();
  while (!stop) {
    let sleepSec = 60;
    try {
      const hb = await heartbeat(token, { jobs: 0, caps: runnerCaps(), ...(updateFailed ? { updateFailed } : {}) });
      if (hb?.ok) sleepSec = Number(hb.sleepSec ?? 60) || 60;
      else log(`하트비트 실패: ${String(hb?.error ?? "").slice(0, 80)}`);
      updateFailed = null;                                  // 보냈으면 비운다(같은 사유를 매번 다시 보내지 않는다)

      /* 🔴 **잡을 집기 전에** 갱신한다. 잡을 들고 있는 동안 자기 파일을 갈아 끼우면
         돌고 있는 코드와 디스크의 코드가 달라진다 — 그 상태의 실패는 재현조차 안 된다.
         여기(=집기 직전, 아무것도 안 들고 있음)가 한 바퀴 중 유일하게 안전한 자리다. */
      const offer = hb?.ok ? hb.update : null;
      if (offer && isNewer(offer.version) && !updateTried.has(offer.version)) {
        updateTried.add(offer.version);
        const r = await applyUpdate(offer, log);
        if (r.ok) {
          log("새 판으로 다시 시작할게요(창은 그대로 두세요).");
          process.exit(RESTART_EXIT_CODE);                  // run.bat/run.sh 가 다시 띄운다
        }
        // 🔴 실패해도 **옛 판 그대로 계속 돈다** — 오늘 나가야 할 글이 업데이트 때문에 멈추면 안 된다.
        log(`업데이트를 건너뜁니다(지금 판으로 계속해요): ${r.reason}`);
        updateFailed = { version: offer.version, reason: String(r.reason ?? "").slice(0, 200) };
      }

      const { count: done } = await tick({ chromium, token, kinds: claimableKinds(), max: OPT.max, headed: OPT.headed, dryRun: OPT.dryRun });
      if (done) { idleRounds = 0; sleepSec = 5; }
      else if (++idleRounds === 1) log("할 일이 없어요 — 기다립니다(창을 닫지 마세요).");
    } catch (e) {
      log(`루프 오류(계속 돕니다): ${String(e?.message ?? e).slice(0, 120)}`);
      sleepSec = 30;
    }
    for (let i = 0; i < sleepSec && !stop; i++) await new Promise((r) => setTimeout(r, 1000));
  }
}

main().catch((e) => { console.error(`\n  ✗ ${String(e?.message ?? e)}\n`); process.exit(1); });
