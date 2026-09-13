/**
 * scripts/verify-b2-runner.mts — 🔴 **셀렉터 실증 한 방 스크립트**(계정이 풀리면 이 한 줄이면 끝난다).
 *
 *   `npx tsx --env-file=.env scripts/verify-b2-runner.mts tistory`
 *   `npx tsx --env-file=.env scripts/verify-b2-runner.mts naver_blog`
 *
 *   한 프로세스 안에서 전부 한다:
 *     ① 로컬 함수 서버(임의 포트 · `netlify/functions/runner.ts` 의 default export 를 그대로)
 *     ② 자사 테스트 계정(.env TEST_*)으로 테넌트·계정·자격·piece 생성 → `publish()` 로 러너 잡 적재
 *     ③ 기기 등록 → `runner/ac-runner.mjs --once --headed --dry-run` 을 자식 프로세스로 실행
 *     ④ 서버에 남은 자취(잡·piece·계정·알림·감사) + 스냅샷 폴더를 출력
 *     ⑤ 테넌트 정리(남기려면 `--keep`)
 *
 *   🔴 **임시저장까지만.** `--dry-run` 고정이라 발행 버튼을 누르지 않는다. 러너의 dry-run 은 report 하지 않고
 *      release 하므로 서버 상태도 «발행됨»으로 바뀌지 않는다.
 *   🔴 사람이 옆에 있는 검증이므로 `AC_2FA_WAIT_MS` 를 켠다 — 카카오 2단계·네이버 기기확인이 뜨면
 *      창에서 직접 승인할 시간을 준다(운영 헤드리스에서는 이 값이 0이라 기다리지 않는다).
 *   ⚠️ 임의 포트를 쓴다 — 8899 에 다른 프로그램이 떠 있어 엉뚱한 응답을 받은 적이 있다(2026-09-14).
 */
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { jsonb } from "../lib/db-util";
import { encryptObj } from "../lib/creds-crypto";
import { registerDevice } from "../lib/runner-jobs";
import { publish, loadPublishPiece, loadPublishAccount } from "../lib/publish/index";
import handler, { config } from "../netlify/functions/runner";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const env = (k: string) => String(process.env[k] ?? "").trim();
/* ⚠️ `import.meta.url` 의 pathname 은 **퍼센트 인코딩**돼 있다(한글 경로 «작업» → %EC%9E%91%EC%97%85).
   그대로 spawn 하면 ENOENT 로 죽는다 — fileURLToPath 로 디코드한다(2026-09-14 실측). */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BODY = `<div class="disclosure">이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</div>
<p>겨울 이불, 집에서 빨까 맡길까 한참 고민했어요.</p>
<h2>결론부터</h2>
<p>코인워시가 싸게 먹혔습니다. 이불 두 채에 6천 원이었어요.</p>
<blockquote>물세탁 표시가 있으면 집에서도 됩니다.</blockquote>
<hr>
<ul class="check"><li>세탁 표시 확인</li><li>건조까지 한 번에</li></ul>
<p>다음엔 건조기까지 돌려 보려고요.</p>
<p class="tags">#겨울이불 #코인워시</p>`;

function startServer(): Promise<{ port: number; close: () => void }> {
  const paths: string[] = Array.isArray(config?.path) ? config.path : [String(config?.path ?? "")];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!paths.includes(url.pathname)) { res.writeHead(404).end('{"ok":false,"step":"harness"}'); return; }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    try {
      const out = await handler(new Request(`http://127.0.0.1${req.url}`, {
        method: req.method ?? "GET", headers, ...(body.length && req.method !== "GET" ? { body } : {}),
      }));
      const text = await out.text();
      const h: Record<string, string> = {}; out.headers.forEach((v, k) => { h[k] = v; });
      res.writeHead(out.status, h).end(text);
    } catch (e) { res.writeHead(500).end(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) })); }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ port, close: () => server.close() });
    });
  });
}

async function main() {
  const channel = String(process.argv[2] ?? "tistory");
  const keep = process.argv.includes("--keep");
  if (!["tistory", "naver_blog"].includes(channel)) { console.error("사용법: verify-b2-runner.mts <tistory|naver_blog> [--keep]"); process.exit(2); }

  const cfg = channel === "tistory"
    ? { id: env("TEST_TISTORY_ID"), pw: env("TEST_TISTORY_PW"), handle: env("TEST_TISTORY_BLOG"), method: env("TEST_TISTORY_LOGIN") || "self" }
    : { id: env("TEST_NAVER_ID"), pw: env("TEST_NAVER_PW"), handle: env("TEST_NAVER_BLOG") || env("TEST_NAVER_ID"), method: "self" };
  if (!cfg.id || !cfg.pw || !cfg.handle) {
    console.error(`\n  ✗ ${channel}: .env 에 TEST_* 값이 없어요(사장님께 계정을 받아 넣어 주세요).\n`);
    process.exit(2);
  }

  const { port, close } = await startServer();
  const stamp = Date.now();
  console.log(`\n── B2 러너 셀렉터 실증 (${channel} · @${cfg.handle} · 임시저장까지) ──`);
  console.log(`   로컬 함수 서버 127.0.0.1:${port}\n`);

  const [t] = await q(sql`INSERT INTO tenants (key, name, plan_key, status)
    VALUES (${`b2ver${stamp}`.slice(0, 40)}, ${"B2실증"}, 'starter', 'active') RETURNING id`);
  const tid = n(t?.id);
  let ok = false;
  try {
    /* 🔴 프로필 키는 **실행마다 바뀌면 안 된다**. 하니스가 매번 새 테넌트를 만드는 바람에 `t{tid}-{channel}` 도
       매번 달라졌고, 그래서 **브라우저 프로필이 매번 새로 생겼다** — 카카오·네이버 입장에서는 늘 «처음 보는 브라우저»라
       2단계·기기 확인이 매번 뜬다. 사장님이 «이 브라우저에서 2단계 인증 사용 안 함»을 켜도 다음 실행엔 사라진다
       (2026-09-14 실측: 티스토리 2단계가 두 번 연속 뜬 진짜 이유). 검증용 프로필은 채널당 하나로 고정한다.
       ⚠️ 운영에서는 계정마다 다른 키가 맞다(AC-3 세션 섞임 방지) — 여기는 자사 테스트 계정 1개짜리 검증이다. */
    const [a] = await q(sql`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key, daily_cap, min_gap_min)
      VALUES (${tid}, ${channel}, ${cfg.handle}, 'session', 'active', ${`verify-${channel}`}, 3, 60) RETURNING id`);
    const accountId = n(a?.id);
    await q(sql`INSERT INTO account_creds (tenant_id, account_id, kind, enc)
      VALUES (${tid}, ${accountId}, 'password', ${encryptObj({ loginId: cfg.id, password: cfg.pw, method: cfg.method })})`);
    const [p] = await q(sql`INSERT INTO pieces (tenant_id, account_id, channel, kind, format, title, body, blocks, meta, status)
      VALUES (${tid}, ${accountId}, ${channel}, 'post', 'info', ${`[실증 드라이런] 겨울 이불 세탁 ${stamp}`}, ${BODY}, ${jsonb([])},
              ${jsonb({ tags: ["겨울이불", "코인워시"], disclosure: "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.", affiliate: { provider: "coupang", url: "https://link.coupang.com/x", subId: "piece_0" } })},
              'scheduled') RETURNING id`);
    const pieceId = n(p?.id);

    const r = await publish((await loadPublishPiece(tid, pieceId))!, (await loadPublishAccount(tid, accountId))!, { actor: "user" });
    if (!r.ok) { console.error(`  ✗ 잡 적재 실패: ${r.reason} ${r.error}`); return; }
    const reg = await registerDevice(tid, "실증 PC", "own");
    console.log(`   테넌트 ${tid} · 계정 ${accountId} · piece ${pieceId} · job ${r.ok ? r.jobId : "-"}\n`);

    // ── 러너 실행(자식 프로세스 · 창을 띄운다) ──
    const code = await new Promise<number>((resolve) => {
      const child = spawn(process.execPath, [path.join(ROOT, "runner", "ac-runner.mjs"), "--once", "--headed", "--dry-run"], {
        cwd: path.join(ROOT, "runner"),
        stdio: "inherit",
        env: {
          ...process.env,
          AC_SERVER: `http://127.0.0.1:${port}`,
          AC_RUNNER_TOKEN: reg.device.token,
          RUNNER_SHOTS: "1",
          AC_2FA_WAIT_MS: String(Number(env("AC_2FA_WAIT_MS")) || 180_000),
        },
      });
      child.on("exit", (c) => resolve(c ?? 1));
    });

    // ── 자취 ──
    console.log(`\n── 서버에 남은 자취(러너 종료코드 ${code}) ──`);
    const jobs = await q(sql`SELECT id, kind, status, attempts, error_kind, result FROM runner_jobs WHERE tenant_id = ${tid} ORDER BY id`);
    for (const j of jobs) {
      const res = (j.result ?? {}) as Record<string, unknown>;
      console.log(`   job #${j.id} ${j.kind} → ${j.status}${j.error_kind ? ` (${j.error_kind})` : ""}${res.detail ? ` · ${String(res.detail).slice(0, 110)}` : ""}`);
      if (res.released) console.log(`      released: ${String(res.released)}`);
    }
    console.log(`   piece  : ${JSON.stringify(await q(sql`SELECT id, status, external_url FROM pieces WHERE tenant_id = ${tid}`))}`);
    console.log(`   account: ${JSON.stringify(await q(sql`SELECT id, status, last_error_kind FROM accounts WHERE tenant_id = ${tid}`))}`);
    console.log(`   posts  : ${(await q(sql`SELECT id FROM posts WHERE tenant_id = ${tid}`)).length}행 (드라이런이므로 0이 정상)`);

    const shots = path.join(ROOT, "runner", "_shots");
    const dirs = fs.existsSync(shots) ? fs.readdirSync(shots).map((d) => ({ d, t: fs.statSync(path.join(shots, d)).mtimeMs })).sort((x, y) => y.t - x.t).slice(0, 1) : [];
    if (dirs.length) {
      const dir = path.join(shots, dirs[0].d);
      console.log(`\n   📸 스냅샷: runner/_shots/${dirs[0].d}/`);
      for (const f of fs.readdirSync(dir)) console.log(`      · ${f}`);
    }
    /* 🔴 판정은 **러너의 종료코드**로 한다. 잡 행으로 판정하면 드라이런 실패에도 ✓ 가 찍힌다 —
       드라이런은 잡을 큐로 되돌리므로(release) 성공·실패가 행에서 똑같이 `queued`·error_kind 없음으로 보인다.
       2026-09-14 실측에서 실제로 실패(job #13 티스토리)에 «✓ 임시저장까지 도달»을 찍었다(PITFALLS #9 재발).
       추가 안전벨트: 성공이면 마지막 스냅샷에 임시저장 단계(`90-`)가 있어야 한다. */
    ok = code === 0;
    console.log(ok
      ? "\n   ✓ 임시저장까지 도달(셀렉터 살아 있음) — 잡은 큐로 되돌려졌다.\n"
      : "\n   ✗ 임시저장까지 못 갔다 — 위 사유와 FAIL.png 를 보고 고친다.\n");
  } finally {
    if (!keep) {
      for (const table of ["posts", "runner_jobs", "runner_devices", "account_creds", "pieces", "accounts", "notifications", "audit_logs"]) {
        await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${tid}`);
      }
      await q(sql`DELETE FROM tenants WHERE id = ${tid}`);
      console.log(`   (테넌트 ${tid} 정리 완료 — 남기려면 --keep)`);
    } else {
      console.log(`   (테넌트 ${tid} 유지 — 정리: seed-b2-runner.mts clean ${tid})`);
    }
    close();
    await pgClient.end({ timeout: 5 });
    process.exit(ok ? 0 : 1);
  }
}

main().catch(async (e) => { console.error("\n실증 예외:", e); await pgClient.end({ timeout: 5 }); process.exit(1); });
