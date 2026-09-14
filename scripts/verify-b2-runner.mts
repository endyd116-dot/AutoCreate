/**
 * scripts/verify-b2-runner.mts — 🔴 **셀렉터 실증 한 방 스크립트**(계정이 풀리면 이 한 줄이면 끝난다).
 *
 *   `npx tsx --env-file=.env scripts/verify-b2-runner.mts tistory`
 *   `npx tsx --env-file=.env scripts/verify-b2-runner.mts naver_blog`
 *   `npx tsx --env-file=.env scripts/verify-b2-runner.mts naver_blog --with-image`   (사진 삽입 경로까지)
 *   `npx tsx --env-file=.env scripts/verify-b2-runner.mts naver_blog --job=revenue.adpost`   (수익 스크랩 · 서버에 안 보냄)
 *   `npx tsx --env-file=.env scripts/verify-b2-runner.mts tistory --job=ads.setup_tistory`  (애드센스 상태 읽기)
 *   `node --env-file=.env scripts/verify-b2-runner.mts naver_blog --canary --keep`   (🐤 카나리 경로 · DESIGN §19)
 *
 *   🐤 `--canary` — 러너의 **카나리 경로**(`ac-runner --canary`)를 태운다. 보통 드라이런과 달리 결과를 **하트비트 canary 필드**로
 *      보고하고 서버가 `canary_runs`(하루·채널 1행)에 적재한다 = 매일 05시(KST) 크론 `runner.canary` 가 읽을 바로 그 값.
 *      `canary_runs` 는 테넌트 스코프가 아니라 정리 뒤에도 남는다(증거). 감사행까지 보려면 `--keep`.
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
import { deflateSync as zlibSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { jsonb } from "../lib/db-util";
import { encryptObj } from "../lib/creds-crypto";
import { registerDevice, enqueueJob, isRunnerJobKind, type RunnerJobKind } from "../lib/runner-jobs";
import { publish, loadPublishPiece, loadPublishAccount } from "../lib/publish/index";
import handler, { config } from "../netlify/functions/runner";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
/** 사람이 2단계 인증을 누를 시간(--login-first 로그인 단계 전용 · 5분). */
const LOGIN_WAIT_MS = 300_000;
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

/**
 * 시험용 사진 — 외부 URL 에 기대지 않고 하니스 서버가 직접 낸다(자립 · 외부 서비스 흔들림 0).
 *   최소 PNG 인코더(zlib + CRC32). 320×200 · 주황 단색. 네이버가 «너무 작은 사진»으로 거르지 않을 크기.
 */
function makePng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crcTable = new Int32Array(256).map((_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc32 = (buf: Buffer) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const TEST_PNG = makePng(320, 200, [255, 140, 0]);

function startServer(): Promise<{ port: number; close: () => void }> {
  const paths: string[] = Array.isArray(config?.path) ? config.path : [String(config?.path ?? "")];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/img/ac-test.png") { res.writeHead(200, { "Content-Type": "image/png", "Content-Length": String(TEST_PNG.length) }).end(TEST_PNG); return; }
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
  const withImage = process.argv.includes("--with-image");
  /* --canary — `--once --dry-run` 대신 러너의 **카나리 경로**(ac-runner --canary)를 태운다(DESIGN §19 · P1R4).
     차이: 카나리는 드라이런 결과를 **하트비트의 canary 필드**로 보고하고, 서버가 `canary_runs`(하루·채널 1행)에 적재한다.
     즉 «매일 새벽 05시에 돌 것»과 **같은 경로**를 지금 한 번 태워 보는 것이다(첫 증거). */
  const canaryMode = process.argv.includes("--canary");
  /* --login-first — 사람이 창에서 한 번 로그인(session.login)한 **다음** 같은 계정으로 드라이런까지 이어서 한다.
     티스토리처럼 무인 로그인을 폐지한 채널은 이것 없이는 영원히 login_fail 이다(창조차 안 뜬다). */
  const loginFirst = process.argv.includes("--login-first");
  /* ♻ 이미 로그인해 둔 테넌트를 재사용한다(쿠키 그대로 · 사람 2단계 0회). 고친 곳만 다시 재는 용도. */
  const reuseTid = Number(String(process.argv.find((a) => a.startsWith("--reuse-tid=")) ?? "").slice(12)) || 0;
  /* --job=revenue.adpost 등 — 발행 대신 그 잡을 계정에 직접 적재한다(수익 스크랩·광고 상태 읽기 실측용). */
  const jobArg = String(process.argv.find((a) => a.startsWith("--job=")) ?? "").slice(6);
  const jobKind: RunnerJobKind | null = jobArg && isRunnerJobKind(jobArg) ? jobArg : null;
  if (jobArg && !jobKind) { console.error(`알 수 없는 잡 종류: ${jobArg}`); process.exit(2); }
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
  const imgUrl = `http://127.0.0.1:${port}/img/ac-test.png`;
  /* 🔴 사진 삽입 경로 실증(네이버 «개별사진» 팝업·자리 잡을 때까지 대기·캡션)은 이미지 있는 원고로만 탄다.
     사진은 하니스 서버가 직접 낸다(외부 URL 의존 0). */
  const body = withImage
    ? BODY.replace("<hr>", `<figure><img src="${imgUrl}" alt=""><figcaption>세탁 전 이불 사진(시험용)</figcaption></figure>
<hr>`)
    : BODY;
  console.log(`\n── B2 러너 셀렉터 실증 (${channel} · @${cfg.handle} · 임시저장까지) ──`);
  console.log(`   로컬 함수 서버 127.0.0.1:${port}\n`);

  /* ♻ --reuse-tid=N — **이미 로그인해 둔** 테넌트/계정을 그대로 쓴다(쿠키 재사용 · 사람 2단계 0회).
     왜 필요한가: 하니스는 실행마다 새 테넌트를 만들어서, 서식·셀렉터를 한 줄 고칠 때마다 사장님께 2단계 인증을
     다시 부탁해야 했다(2026-09-14 실측: 티스토리 2단계 유효시간 만료로 두 번 허비). 저장된 쿠키가 살아 있으면
     로그인을 건너뛰고 **고친 부분만** 다시 잰다. 재사용 시에는 테넌트를 지우지 않는다. */
  let tid: number;
  if (reuseTid) {
    const [t0] = await q(sql`SELECT id FROM tenants WHERE id = ${reuseTid} LIMIT 1`);
    if (!t0) { console.error(`\n  ✗ 테넌트 ${reuseTid} 이(가) 없어요.\n`); close(); await pgClient.end({ timeout: 5 }); process.exit(2); }
    tid = reuseTid;
  } else {
    const [t] = await q(sql`INSERT INTO tenants (key, name, plan_key, status)
      VALUES (${`b2ver${stamp}`.slice(0, 40)}, ${"B2실증"}, 'starter', 'active') RETURNING id`);
    tid = n(t?.id);
  }
  let ok = false;
  let canaryVerdict: "ok" | "fail" | "unknown" = "unknown";
  try {
    /* 🔴 프로필 키는 **실행마다 바뀌면 안 된다**. 하니스가 매번 새 테넌트를 만드는 바람에 `t{tid}-{channel}` 도
       매번 달라졌고, 그래서 **브라우저 프로필이 매번 새로 생겼다** — 카카오·네이버 입장에서는 늘 «처음 보는 브라우저»라
       2단계·기기 확인이 매번 뜬다. 사장님이 «이 브라우저에서 2단계 인증 사용 안 함»을 켜도 다음 실행엔 사라진다
       (2026-09-14 실측: 티스토리 2단계가 두 번 연속 뜬 진짜 이유). 검증용 프로필은 채널당 하나로 고정한다.
       ⚠️ 운영에서는 계정마다 다른 키가 맞다(AC-3 세션 섞임 방지) — 여기는 자사 테스트 계정 1개짜리 검증이다. */
    let accountId: number;
    if (reuseTid) {
      // 저장된 쿠키가 살아 있는 계정만 고른다 — 없으면 재사용의 의미가 없다(로그인부터 다시 해야 한다).
      const [a0] = await q(sql`SELECT a.id FROM accounts a
        WHERE a.tenant_id = ${tid} AND a.channel = ${channel}
          AND EXISTS (SELECT 1 FROM account_creds c WHERE c.account_id = a.id AND c.kind = 'cookies' AND c.purged_at IS NULL)
        ORDER BY a.id DESC LIMIT 1`);
      if (!a0) { console.error(`\n  ✗ 테넌트 ${tid} 에 «${channel}» 쿠키가 저장된 계정이 없어요(먼저 --login-first 로 한 번 로그인).\n`); return; }
      accountId = n(a0.id);
      console.log(`   ♻ 재사용: 테넌트 ${tid} · 계정 ${accountId} — 저장된 쿠키를 쓰므로 **로그인·2단계 없음**\n`);
    } else {
      const [a] = await q(sql`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key, daily_cap, min_gap_min)
        VALUES (${tid}, ${channel}, ${cfg.handle}, 'session', 'active', ${`verify-${channel}`}, 3, 60) RETURNING id`);
      accountId = n(a?.id);
      await q(sql`INSERT INTO account_creds (tenant_id, account_id, kind, enc)
        VALUES (${tid}, ${accountId}, 'password', ${encryptObj({ loginId: cfg.id, password: cfg.pw, method: cfg.method })})`);
    }
    const [p] = await q(sql`INSERT INTO pieces (tenant_id, account_id, channel, kind, format, title, body, blocks, meta, status)
      VALUES (${tid}, ${accountId}, ${channel}, 'post', 'info', ${`[실증 드라이런] 겨울 이불 세탁 ${stamp}`}, ${body}, ${jsonb([])},
              ${jsonb({ tags: ["겨울이불", "코인워시"], disclosure: "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.", affiliate: { provider: "coupang", url: "https://link.coupang.com/x", subId: "piece_0" } })},
              'scheduled') RETURNING id`);
    const pieceId = n(p?.id);
    if (withImage) {
      await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, caption, meta, sort)
        VALUES (${tid}, ${pieceId}, 'image', ${"harness/ac-test.png"}, ${"세탁 전 이불 사진(시험용)"}, ${jsonb({ url: imgUrl })}, 0)`);
    }

    const reg = await registerDevice(tid, "실증 PC", "own");
    /** 러너를 자식 프로세스로 한 번 돌린다(창을 띄운다). 반환 = 종료코드. */
    const runRunner = (runnerArgs: string[], waitMs?: number) => new Promise<number>((resolve) => {
      const child = spawn(process.execPath, [path.join(ROOT, "runner", "ac-runner.mjs"), ...runnerArgs], {
        cwd: path.join(ROOT, "runner"),
        stdio: "inherit",
        env: {
          ...process.env,
          AC_SERVER: `http://127.0.0.1:${port}`,
          AC_RUNNER_TOKEN: reg.device.token,
          RUNNER_SHOTS: "1",
          AC_2FA_WAIT_MS: String(waitMs ?? (Number(env("AC_2FA_WAIT_MS")) || 180_000)),
        },
      });
      child.on("exit", (c) => resolve(c ?? 1));
    });

    /* ── ①(--login-first) 사람이 한 번 로그인한다 ──────────────────────────────
       🔴 티스토리·블로거는 **무인 로그인을 하지 않는다**(카카오 OAuth 콜백 루프·구글 봇탐지 → 2026-09-14 근본진단).
          그래서 publish 잡은 세션이 없으면 즉시 `login_fail` 로 멈춘다 — 창을 띄우지 않는다.
          로그인은 **session.login 잡**의 몫이고, 거기서 받은 쿠키(account_creds kind='cookies')를
          다음 claim 이 job.account.cookies 로 실어 준다. 그래서 «로그인 → 드라이런»은 **같은 계정**에서 이어야 한다
          (하니스가 실행마다 새 테넌트를 만들기 때문에 따로 돌리면 쿠키가 이어지지 않는다).
       ⚠️ 우선순위상 publish(10) 가 session.login(20) 보다 먼저 잡히므로 **로그인을 먼저 끝내고** 발행 잡을 넣는다. */
    if (loginFirst) {
      await enqueueJob({ tenantId: tid, kind: "session.login", accountId, payload: { channel, handle: cfg.handle, verify: true } });
      console.log(`   ① 로그인 창을 띄웁니다 — 카카오/네이버 2단계를 **직접** 눌러 주세요(최대 ${Math.round(LOGIN_WAIT_MS / 60000)}분).\n`);
      await runRunner(["--once", "--headed"], LOGIN_WAIT_MS);
      const [cred] = await q(sql`SELECT id FROM account_creds WHERE account_id = ${accountId} AND kind = 'cookies' AND purged_at IS NULL LIMIT 1`);
      if (!cred) {
        console.error("\n   ✗ 쿠키가 저장되지 않았어요(로그인 미완료). 임시저장 드라이런을 건너뜁니다.\n");
        return;
      }
      console.log("\n   ✓ 로그인 쿠키 저장 확인 — 이어서 «임시저장까지» 드라이런을 돕니다.\n");
    }

    let jobIdShown: number | string = "-";
    if (jobKind) {
      const j = await enqueueJob({ tenantId: tid, kind: jobKind, accountId, payload: { channel, handle: cfg.handle, verify: true } });
      jobIdShown = j.id;
    } else {
      const r = await publish((await loadPublishPiece(tid, pieceId))!, (await loadPublishAccount(tid, accountId))!, { actor: "user" });
      if (!r.ok) { console.error(`  ✗ 잡 적재 실패: ${r.reason} ${r.error}`); return; }
      jobIdShown = r.ok ? String(r.jobId) : "-";
    }
    console.log(`   테넌트 ${tid} · 계정 ${accountId} · piece ${pieceId} · job ${jobIdShown}${jobKind ? ` (${jobKind})` : ""}\n`);

    // ── ② 러너 실행(자식 프로세스 · 창을 띄운다) ──
    const code = await runRunner(canaryMode ? ["--canary", "--headed"] : ["--once", "--headed", "--dry-run"]);

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

    /* 🔴 카나리 증거 — canary_runs 는 테넌트 스코프가 아니라(하루·채널 1행) 아래 정리에서도 살아남는다.
       이 행이 곧 «매일 05시 크론이 읽을 것»이다. ok 는 3값(true/false/null=판정불가 · AC-9). */
    if (canaryMode) {
      const cr = await q(sql`SELECT channel, ok, step, detail, shot_key FROM canary_runs
        WHERE day = (NOW() AT TIME ZONE 'Asia/Seoul')::date AND channel <> '__eval__' ORDER BY channel`);
      /* 🔴 판정은 **이 행**으로 한다 — `ac-runner --canary` 는 결과와 무관하게 종료코드 0 이라
         종료코드로 판정하면 login_fail 에도 «✓ 임시저장까지 도달»이 찍힌다(2026-09-14 티스토리에서 실제로 찍었다 · PITFALLS #9 재발). */
      const mine = cr.find((r) => String(r.channel) === channel);
      canaryVerdict = mine?.ok === true ? "ok" : mine?.ok === false ? "fail" : "unknown";
      console.log(`\n   🐤 canary_runs(오늘 KST) ${cr.length}행 — 크론 runner.canary 가 읽을 값`);
      for (const r of cr) {
        const okTxt = r.ok === null ? "null(판정 불가)" : r.ok === true ? "true(정상)" : "false(깨짐 의심)";
        console.log(`      · ${String(r.channel)} → ok=${okTxt} step=${r.step ?? "-"}${r.shot_key ? ` shot=${r.shot_key}` : ""}${r.detail ? ` · ${String(r.detail).slice(0, 90)}` : ""}`);
      }
      if (!cr.length) console.log("      (행 없음 — 하트비트가 canary 필드를 못 실었다. 러너 로그를 봐라.)");
    }

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
    if (canaryMode) {
      ok = canaryVerdict === "ok";
      console.log(ok
        ? "\n   ✓ 카나리 정상 — 임시저장까지 도달(셀렉터 살아 있음). 잡은 큐로 되돌려졌다.\n"
        : canaryVerdict === "unknown"
          ? "\n   · 카나리 판정 불가 — 셀렉터 문제가 아니다(세션/로그인/네트워크). 크론은 이걸 실패로 세지 않는다(AC-9).\n"
          : "\n   ✗ 카나리 실패 — 셀렉터가 깨졌다. shot_key 폴더의 FAIL.png 를 보고 고친다.\n");
    } else {
      ok = code === 0;
      console.log(ok
        ? "\n   ✓ 임시저장까지 도달(셀렉터 살아 있음) — 잡은 큐로 되돌려졌다.\n"
        : "\n   ✗ 임시저장까지 못 갔다 — 위 사유와 FAIL.png 를 보고 고친다.\n");
    }
  } finally {
    // ♻ 재사용 테넌트는 **절대 지우지 않는다** — 지우면 어렵게 받은 로그인 쿠키가 날아가 사장님께 2단계를 또 부탁해야 한다.
    if (!keep && !reuseTid) {
      for (const table of ["posts", "runner_jobs", "runner_devices", "account_creds", "piece_assets", "pieces", "accounts", "notifications", "audit_logs"]) {
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
