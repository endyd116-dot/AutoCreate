/**
 * scripts/verify-runner-dist.mts — 「내 PC 러너」 배포·업데이트·묶기 **실증** 하니스.
 *
 *   npx --yes tsx --env-file=.env scripts/verify-runner-dist.mts
 *
 *   무엇을 증명하나 — 사장님이 실제로 하실 일을 **그대로** 한다:
 *     ① `/api/runner-download` 로 링크를 받아 **진짜 내려받고** sha256 을 대조한다.
 *     ② 그 zip 을 **새 폴더**에 풀고, 그 폴더의 러너로 **하트비트까지** 간다(우리 개발 폴더가 아니라 «받은 것»으로).
 *     ③ 토큰을 **다른 PC 지문**으로 쓰면 거절당하고 알림이 남는지 본다(복사 방어).
 *     ④ 옛 판으로 돌려놓고 돌리면 **스스로 새 판을 받아** 종료코드 75 로 나가는지 본다(자동 업데이트).
 *     ⑤ 해시를 일부러 틀리게 줘도 **옛 판을 그대로 두는지** 본다(반쪽 업데이트 방지 · 음성 대조).
 *
 *   🔴 실패를 «종료코드 0» 으로 덮지 않는다 — 한 항목이라도 어긋나면 1 로 나간다(PITFALLS #9 거짓 초록).
 *   ⚠️ 로컬 전용. 발행은 일어나지 않는다(러너는 --peek 로만 돌린다).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import handler, { config } from "../netlify/functions/runner";
import { db, pgClient } from "../db/index";
import { signUserToken, USER_COOKIE } from "../lib/auth";
import { registerDevice, hashRunnerToken } from "../lib/runner-jobs";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

const ROOT = path.resolve(import.meta.dirname, "..");
const RUNNER_SRC = path.join(ROOT, "runner");
const { zipRead } = await import(pathToFileURL(path.join(RUNNER_SRC, "lib/zip.mjs")).href) as {
  zipRead: (b: Buffer) => { name: string; data: Buffer; mode: number }[];
};

let failures = 0;
const ok = (msg: string) => console.log(`   ✓ ${msg}`);
const bad = (msg: string) => { failures++; console.log(`   ✗ ${msg}`); };
const check = (cond: unknown, good: string, worse: string) => (cond ? ok(good) : bad(worse));

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
      const out = await handler(new Request(`http://127.0.0.1${req.url}`, { method: req.method ?? "GET", headers, ...(body.length && req.method !== "GET" ? { body } : {}) }));
      const text = await out.text();
      const h: Record<string, string> = {}; out.headers.forEach((v, k) => { h[k] = v; });
      res.writeHead(out.status, h).end(text);
    } catch (e) { res.writeHead(500).end(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) })); }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ port: (server.address() as { port: number }).port, close: () => server.close() })));
}

/**
 * 실증용 테넌트 — 러너가 있는 플랜이면 된다. 없으면 만든다(이름으로 찾아 재사용 · 쓰레기를 늘리지 않는다).
 *   🔴 **`trial` 로 만든다.** 처음엔 `pro` 로 했는데, 그러면 실증을 돌릴 때마다 라이브 대시보드에
 *      «유료 고객» 한 줄이 생긴다(구독행 0이라 매출엔 영향 없지만 **숫자를 읽는 사람이 속는다**).
 *      trial 도 `runnerDevices: 1` 이라 게이트를 그대로 통과하고, 오히려 **러너가 있는 가장 낮은 플랜**으로
 *      확인하는 셈이라 검증으로도 더 낫다.
 */
async function testTenant(): Promise<{ tid: number; uid: number }> {
  const [t] = await q(sql`SELECT id FROM tenants WHERE name = '러너배포실증' LIMIT 1`);
  let tid = n(t?.id);
  if (!tid) {
    const [ins] = await q(sql`INSERT INTO tenants (key, name, plan_key, status) VALUES ('runner-dist-verify', '러너배포실증', 'trial', 'active') RETURNING id`);
    tid = n(ins?.id);
  } else {
    await q(sql`UPDATE tenants SET plan_key = 'trial', status = 'active' WHERE id = ${tid}`);
  }
  const [u] = await q(sql`SELECT id FROM users WHERE tenant_id = ${tid} ORDER BY id LIMIT 1`);
  let uid = n(u?.id);
  if (!uid) {
    const [ins] = await q(sql`INSERT INTO users (tenant_id, email, name, role, password_hash)
      VALUES (${tid}, ${`runner-dist-${tid}@example.invalid`}, '러너배포실증', 'owner', 'x') RETURNING id`);
    uid = n(ins?.id);
  }
  return { tid, uid };
}

async function main() {
  console.log("\n── 러너 배포·업데이트·묶기 실증 ──");
  const { port, close } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  console.log(`   로컬 함수 서버 ${base}`);

  const { tid, uid } = await testTenant();
  const cookie = `${USER_COOKIE}=${encodeURIComponent(signUserToken({ uid, tid, role: "owner" }))}`;
  console.log(`   테넌트 ${tid} · 사용자 ${uid}\n`);

  /* ───── ① 인증 다운로드 ───── */
  console.log("① 내려받기(로그인·플랜·짧은 링크)");
  const noAuth = await fetch(`${base}/api/runner-download`);
  check(noAuth.status === 401, "비로그인은 받을 수 없다(401)", `비로그인이 ${noAuth.status} 로 통과했다 — 관문이 없다`);

  const r = await fetch(`${base}/api/runner-download`, { headers: { cookie } });
  const dl = await r.json() as { ok?: boolean; url?: string; sha256?: string; bytes?: number; version?: string; filename?: string; expiresInSec?: number; error?: string };
  if (!dl.ok || !dl.url) { bad(`내려받기 링크를 못 받았다: ${dl.error ?? r.status}`); close(); await pgClient.end({ timeout: 5 }); process.exit(1); }
  ok(`링크 받음 · v${dl.version} · ${Number(dl.bytes).toLocaleString()} bytes · ${dl.expiresInSec}초 유효 · ${dl.filename}`);

  const got = Buffer.from(await (await fetch(dl.url)).arrayBuffer());
  const digest = createHash("sha256").update(got).digest("hex");
  check(digest === dl.sha256, `진짜 내려받아 sha256 일치(${digest.slice(0, 16)}…)`, `내려받은 파일의 sha256 이 다르다(${digest.slice(0, 16)} ≠ ${String(dl.sha256).slice(0, 16)})`);

  const [audit] = await q(sql`SELECT action FROM audit_logs WHERE tenant_id = ${tid} AND action = 'runner_downloaded' ORDER BY id DESC LIMIT 1`);
  check(audit, "감사 runner_downloaded 1행", "감사가 안 남았다(누가 받았는지 알 수 없다)");

  /* ───── ② 새 폴더에 풀고 그 러너로 하트비트 ───── */
  console.log("\n② 받은 zip 을 **새 폴더**에 풀고 그 러너로 하트비트");
  const home = path.join(os.tmpdir(), `ac-runner-dist-${Date.now()}`);
  const files = zipRead(got);
  const top = files[0]?.name.split("/")[0] ?? "";
  for (const f of files) {
    const rel = f.name.startsWith(`${top}/`) ? f.name.slice(top.length + 1) : f.name;
    const dest = path.join(home, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, f.data, { mode: f.mode & 0o777 });
  }
  ok(`${path.basename(home)} 에 ${files.length}개 풀림(zip 안이 «${top}» 한 폴더로 감싸져 있다)`);
  // playwright 는 고객이 run.bat 에서 npm install 로 깐다. 실증에서는 개발 폴더 것을 이어 준다(19MB 복사 안 함).
  try { symlinkSync(path.join(RUNNER_SRC, "node_modules"), path.join(home, "node_modules"), "junction"); } catch { /* 이미 있거나 권한 없음 */ }

  const reg = await registerDevice(tid, "실증 PC(배포판)", "own");
  check(String(reg.install.url).endsWith("/api/runner-download"), "등록 안내가 실제 내려받기 경로를 가리킨다", `등록 안내가 아직 엉뚱하다: ${reg.install.url}`);
  check(!/npx ac-runner/.test(reg.install.cmd), "안내 문구에서 없는 npm 패키지가 사라졌다", `안내에 «npx ac-runner» 가 남아 있다: ${reg.install.cmd}`);

  /* 🔴 `spawnSync` 를 쓰면 안 된다(실측: 전 항목 타임아웃). 함수 서버가 **이 프로세스 안**에 있어서
     동기 spawn 이 이벤트 루프를 붙잡는 동안 러너의 요청을 아무도 받지 못한다 — 러너는 «서버에 연결하지 못했어요»,
     나는 «러너가 고장났나» 를 한참 들여다보게 된다. 비동기로 띄우고 종료를 기다린다. */
  const run = (args: string[], extraEnv: Record<string, string> = {}) => new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
    const p = spawn(process.execPath, ["ac-runner.mjs", ...args], {
      cwd: home, env: { ...process.env, AC_SERVER: base, ...extraEnv },
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += String(d); });
    p.stderr.on("data", (d) => { err += String(d); });
    const timer = setTimeout(() => p.kill(), 120_000);
    p.on("close", (code) => { clearTimeout(timer); resolve({ status: code ?? -1, stdout: out, stderr: err }); });
  });

  // 고객이 하는 그대로: 토큰을 **한 번** 넣어 `.token` 에 저장시키고, 그 뒤로는 파일에서 읽게 둔다.
  const save = await run(["--token", reg.device.token, "--peek"]);   // --peek 를 같이 줘야 저장만 하고 나온다(안 주면 계속 돌기로 들어간다)
  check(save.status === 0 && existsSync(path.join(home, ".token")), "토큰을 넣자 .token 에 저장됐다", `토큰 저장 실패: ${(save.stdout + save.stderr).slice(-200)}`);
  const peek = await run(["--peek"]);
  check(peek.status === 0 && /서버 연결 확인/.test(peek.stdout), "받은 폴더의 러너가 서버에 붙었다(--peek)", `러너가 못 붙었다: ${(peek.stdout + peek.stderr).slice(-300)}`);

  const [dev] = await q(sql`SELECT version, fingerprint, last_seen_at FROM runner_devices WHERE token_hash = ${hashRunnerToken(reg.device.token)}`);
  check(String(dev?.version ?? "") === dl.version, `하트비트가 버전을 알렸다(${dev?.version})`, `버전이 안 왔다(${dev?.version ?? "없음"})`);
  check(/^[0-9a-f]{64}$/.test(String(dev?.fingerprint ?? "")), "기기 지문이 처음 켠 값으로 묶였다", "지문이 안 묶였다(복사 방어가 작동하지 않는다)");

  /* ───── ③ 복사본 방어 ───── */
  console.log("\n③ 같은 토큰을 **다른 PC 지문**으로 쓰면");
  const otherFp = createHash("sha256").update("남의 PC").digest("hex");
  const denied = await fetch(`${base}/api/runner-heartbeat`, {
    method: "POST", headers: { "content-type": "application/json", "x-runner-token": reg.device.token, "x-runner-fp": otherFp },
    body: JSON.stringify({ version: dl.version }),
  });
  const deniedBody = await denied.json() as { step?: string; error?: string };
  check(denied.status === 401 && deniedBody.step === "other_device", `거절당한다(401 · ${deniedBody.step})`, `거절되지 않았다(${denied.status} ${deniedBody.step ?? ""})`);
  const [note] = await q(sql`SELECT title FROM notifications WHERE tenant_id = ${tid} AND kind = 'runner_other_device' ORDER BY id DESC LIMIT 1`);
  check(note, `고객에게 알림이 간다(«${String(note?.title ?? "")}»)`, "알림이 없다 — 토큰을 도둑맞아도 주인이 모른다");
  const still = await run(["--peek"]);
  check(still.status === 0, "원래 PC 는 그대로 잘 된다(애먼 사람 막지 않는다)", "원래 PC 까지 막혔다");

  /* ───── ③-b 토큰 재발급(PC 교체·유출 수습) ───── */
  console.log("\n③-b 토큰 재발급 — 옛 토큰은 죽고, 새 PC 는 다시 묶일 수 있어야 한다");
  const rot = await fetch(`${base}/api/runner-rotate`, {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ id: reg.device.id }),
  });
  const rotBody = await rot.json() as { ok?: boolean; device?: { token?: string } };
  const newToken = String(rotBody.device?.token ?? "");
  check(rot.ok && /^acr_/.test(newToken) && newToken !== reg.device.token, "새 토큰이 나왔다(옛 것과 다르다)", `재발급 실패(${rot.status})`);
  const oldTry = await fetch(`${base}/api/runner-heartbeat`, {
    method: "POST", headers: { "content-type": "application/json", "x-runner-token": reg.device.token, "x-runner-fp": createHash("sha256").update("원래 PC").digest("hex") },
    body: JSON.stringify({ version: dl.version }),
  });
  check(oldTry.status === 401, "옛 토큰은 그 즉시 죽는다(돌아다니던 복사본 무력화)", `옛 토큰이 아직 산다(${oldTry.status})`);
  const newFp = createHash("sha256").update("새로 산 PC").digest("hex");
  const newTry = await fetch(`${base}/api/runner-heartbeat`, {
    method: "POST", headers: { "content-type": "application/json", "x-runner-token": newToken, "x-runner-fp": newFp },
    body: JSON.stringify({ version: dl.version }),
  });
  check(newTry.status === 200, "새 토큰은 **다른 PC** 에서도 처음처럼 묶인다(PC 교체가 된다)", `새 토큰이 새 PC 에서 거절당했다(${newTry.status}) — 재발급이 무의미하다`);
  /* 방금 그 확인이 새 토큰을 **가짜 PC** 에 묶어 버렸다 — 이 폴더로 ④ 를 이어가려면 한 번 더 돌려야 한다.
     (이 자리에서 한 번 더 도는 것 자체가 «재발급은 몇 번이든 된다» 의 확인이기도 하다.) */
  const rot2 = await fetch(`${base}/api/runner-rotate`, {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ id: reg.device.id }),
  });
  const token2 = String(((await rot2.json()) as { device?: { token?: string } }).device?.token ?? "");
  check(/^acr_/.test(token2), "다시 한 번 재발급해도 잘 된다(몇 번이든 된다)", "두 번째 재발급이 실패했다");
  writeFileSync(path.join(home, ".token"), `${token2}\n`);          // 아래 ④ 는 이 폴더로 계속 간다

  /* ───── ④ 자동 업데이트 ───── */
  console.log("\n④ 옛 판으로 돌려놓고 돌리면 스스로 새 판을 받는가");
  const pkgPath = path.join(home, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  writeFileSync(pkgPath, JSON.stringify({ ...pkg, version: "1.0.0" }, null, 2) + "\n");
  const tokenBefore = readFileSync(path.join(home, ".token"), "utf8");
  const apiBefore = readFileSync(path.join(home, "lib", "api.mjs"), "utf8");
  writeFileSync(path.join(home, "lib", "api.mjs"), apiBefore + "\n// 옛 판 표시(갱신되면 사라진다)\n");
  const upd = await run([]);                            // 계속 돌기 모드 — 갱신하면 75 로 나간다
  check(upd.status === 75, `스스로 갱신하고 재시작을 요청했다(종료코드 ${upd.status})`, `갱신이 안 됐다(코드 ${upd.status}) — ${(upd.stdout + upd.stderr).slice(-400)}`);
  check(/v1\.0\.0 → v/.test(upd.stdout), "무엇에서 무엇으로 올라가는지 말한다", "업데이트 로그가 비어 있다");
  const after = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  check(after.version === dl.version, `폴더의 판이 v${after.version} 로 바뀌었다`, `파일이 안 바뀌었다(${after.version})`);
  /* 🔴 «버전 숫자만» 보고 갱신됐다고 하면 안 된다 — package.json 한 줄만 바뀌어도 통과한다.
     그래서 다른 파일에 표시를 심어 두고 **그 표시가 사라졌는지**로 본다(코드가 정말 갈렸나). */
  check(!readFileSync(path.join(home, "lib", "api.mjs"), "utf8").includes("옛 판 표시"),
    "우리 코드가 정말 갈렸다(심어 둔 옛 판 표시가 사라졌다)", "package.json 만 바뀌고 코드는 옛것 그대로다");
  check(existsSync(path.join(home, ".token")) && readFileSync(path.join(home, ".token"), "utf8") === tokenBefore,
    ".token 은 손대지 않았다(다시 로그인 필요 없음)", ".token 이 사라졌거나 바뀌었다 — 고객이 토큰을 다시 넣어야 한다");

  /* ───── ⑤ 음성 대조: 해시가 틀리면 ───── */
  console.log("\n⑤ 음성 대조 — 서버가 준 해시가 틀리면 (반쪽 업데이트 방지)");
  const { applyUpdate } = await import(pathToFileURL(path.join(home, "lib/update.mjs")).href) as {
    applyUpdate: (o: unknown, log?: (s: string) => void) => Promise<{ ok: boolean; reason?: string }>;
  };
  const badHash = await applyUpdate({ version: "9.9.9", url: dl.url, sha256: "0".repeat(64), bytes: dl.bytes }, () => {});
  check(!badHash.ok && /sha256/.test(String(badHash.reason)), `해시가 다르면 갈아 끼우지 않는다(«${badHash.reason}»)`, "해시가 달라도 그냥 설치했다 — 위험");
  const badUrl = await applyUpdate({ version: "9.9.9", url: `${base}/api/nope`, sha256: "0".repeat(64), bytes: 10 }, () => {});
  check(!badUrl.ok, `못 받아도 조용히 옛 판을 지킨다(«${String(badUrl.reason).slice(0, 40)}…»)`, "못 받았는데 성공이라 했다");

  close();
  rmSync(home, { recursive: true, force: true });
  console.log(`\n── ${failures ? `✗ ${failures}건 어긋남` : "✓ 전 항목 통과"} ──\n`);
  await pgClient.end({ timeout: 5 });
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(`\n  ✗ ${String((e as Error)?.stack ?? e)}\n`);
  await pgClient.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
