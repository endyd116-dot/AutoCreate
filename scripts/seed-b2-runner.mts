/**
 * scripts/seed-b2-runner.mts — 러너 왕복 검증용 시드/정리(검증 하니스 · 로컬 전용).
 *   실행: `npx tsx --env-file=.env scripts/seed-b2-runner.mts seed`    → 테넌트·계정·잡을 만들고 **토큰을 출력**
 *         `npx tsx --env-file=.env scripts/seed-b2-runner.mts show <tid>`
 *         `npx tsx --env-file=.env scripts/seed-b2-runner.mts clean <tid>`
 *
 *   ⚠️ 자격은 **가짜**다(`b2-dryrun-no-such-account`). 남의 계정·실서비스에 글을 남기지 않는다 —
 *      이 시드로 도는 왕복은 «로그인 실패까지»가 정상이고, 그것이 곧 파이프라인 실증이다.
 */
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { jsonb } from "../lib/db-util";
import { encryptObj } from "../lib/creds-crypto";
import { registerDevice } from "../lib/runner-jobs";
import { publish, loadPublishPiece, loadPublishAccount } from "../lib/publish/index";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

const BODY = `<div class="disclosure">이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</div>
<p>겨울 이불, 집에서 빨까 맡길까 한참 고민했어요.</p>
<h2>결론부터</h2>
<p>코인워시가 싸게 먹혔습니다. 이불 두 채에 6천 원이었어요.</p>
<blockquote>물세탁 표시가 있으면 집에서도 됩니다.</blockquote>
<hr>
<ul class="check"><li>세탁 표시 확인</li><li>건조까지 한 번에</li></ul>
<p class="tags">#겨울이불 #코인워시</p>`;

async function seed() {
  const stamp = Date.now();
  const [t] = await q(sql`INSERT INTO tenants (key, name, plan_key, status)
    VALUES (${`b2run${stamp}`.slice(0, 40)}, ${"B2러너왕복"}, 'starter', 'active') RETURNING id`);
  const tid = n(t?.id);
  const [a] = await q(sql`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key, daily_cap, min_gap_min)
    VALUES (${tid}, 'naver_blog', ${"b2_dryrun_blog"}, 'session', 'active', ${`t${tid}-naver`}, 3, 60) RETURNING id`);
  const accountId = n(a?.id);
  await q(sql`INSERT INTO account_creds (tenant_id, account_id, kind, enc)
    VALUES (${tid}, ${accountId}, 'password', ${encryptObj({ loginId: "b2-dryrun-no-such-account", password: "b2-dryrun-not-a-real-password" })})`);
  const [p] = await q(sql`INSERT INTO pieces (tenant_id, account_id, channel, kind, format, title, body, blocks, meta, status)
    VALUES (${tid}, ${accountId}, 'naver_blog', 'post', 'info', ${"겨울 이불 세탁, 집에서 할까 맡길까"}, ${BODY}, ${jsonb([])},
            ${jsonb({ tags: ["겨울이불", "코인워시"], disclosure: "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.", affiliate: { provider: "coupang", url: "https://link.coupang.com/x", subId: `piece_0` } })},
            'scheduled') RETURNING id`);
  const pieceId = n(p?.id);

  const r = await publish((await loadPublishPiece(tid, pieceId))!, (await loadPublishAccount(tid, accountId))!, { actor: "cron" });
  const reg = await registerDevice(tid, "검증 PC", "own");

  console.log(JSON.stringify({ tenantId: tid, accountId, pieceId, publish: r, token: reg.device.token, deviceId: reg.device.id }, null, 2));
}

async function show(tid: number) {
  console.log("jobs   :", JSON.stringify(await q(sql`SELECT id, kind, status, attempts, error_kind, result FROM runner_jobs WHERE tenant_id = ${tid} ORDER BY id`)));
  console.log("pieces :", JSON.stringify(await q(sql`SELECT id, status, external_url FROM pieces WHERE tenant_id = ${tid}`)));
  console.log("account:", JSON.stringify(await q(sql`SELECT id, status, last_error_kind, posts_today FROM accounts WHERE tenant_id = ${tid}`)));
  console.log("posts  :", JSON.stringify(await q(sql`SELECT id, external_url FROM posts WHERE tenant_id = ${tid}`)));
  console.log("notify :", JSON.stringify(await q(sql`SELECT kind, title FROM notifications WHERE tenant_id = ${tid} ORDER BY id`)));
  console.log("audit  :", JSON.stringify((await q(sql`SELECT action FROM audit_logs WHERE tenant_id = ${tid} ORDER BY id`)).map((r) => r.action)));
}

async function clean(tid: number) {
  for (const table of ["posts", "runner_jobs", "runner_devices", "account_creds", "pieces", "accounts", "notifications", "audit_logs"]) {
    await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${tid}`);
  }
  await q(sql`DELETE FROM tenants WHERE id = ${tid}`);
  console.log(`테넌트 ${tid} 정리 완료`);
}

/**
 * seedReal — **자사 테스트 계정**으로 드라이런 잡을 만든다(`.env` 의 TEST_* · git 미추적).
 *   🔴 이 잡은 반드시 `--dry-run` 으로만 돌린다(임시저장까지 · 발행 금지). 러너의 dry-run 은 report 하지 않고 release 한다.
 */
async function seedReal(channel: string) {
  const env = (k: string) => String(process.env[k] ?? "").trim();
  const cfg = channel === "tistory"
    ? { id: env("TEST_TISTORY_ID"), pw: env("TEST_TISTORY_PW"), handle: env("TEST_TISTORY_BLOG"), method: env("TEST_TISTORY_LOGIN") || "self" }
    : { id: env("TEST_NAVER_ID"), pw: env("TEST_NAVER_PW"), handle: env("TEST_NAVER_BLOG") || env("TEST_NAVER_ID"), method: "self" };
  if (!cfg.id || !cfg.pw || !cfg.handle) { console.error(`${channel}: TEST_* 환경변수가 없어요(.env 확인).`); process.exit(2); }

  const stamp = Date.now();
  const [t] = await q(sql`INSERT INTO tenants (key, name, plan_key, status)
    VALUES (${`b2real${channel}${stamp}`.slice(0, 40)}, ${"B2드라이런"}, 'starter', 'active') RETURNING id`);
  const tid = n(t?.id);
  const [a] = await q(sql`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key, daily_cap, min_gap_min)
    VALUES (${tid}, ${channel}, ${cfg.handle}, 'session', 'active', ${`t${tid}-${channel}`}, 3, 60) RETURNING id`);
  const accountId = n(a?.id);
  await q(sql`INSERT INTO account_creds (tenant_id, account_id, kind, enc)
    VALUES (${tid}, ${accountId}, 'password', ${encryptObj({ loginId: cfg.id, password: cfg.pw, method: cfg.method })})`);
  const [p] = await q(sql`INSERT INTO pieces (tenant_id, account_id, channel, kind, format, title, body, blocks, meta, status)
    VALUES (${tid}, ${accountId}, ${channel}, 'post', 'info', ${`[드라이런] 겨울 이불 세탁 ${stamp}`}, ${BODY}, ${jsonb([])},
            ${jsonb({ tags: ["겨울이불", "코인워시"], disclosure: "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.", affiliate: { provider: "coupang", url: "https://link.coupang.com/x", subId: "piece_0" } })},
            'scheduled') RETURNING id`);
  const pieceId = n(p?.id);
  const r = await publish((await loadPublishPiece(tid, pieceId))!, (await loadPublishAccount(tid, accountId))!, { actor: "user" });
  const reg = await registerDevice(tid, "드라이런 PC", "own");
  console.log(JSON.stringify({ channel, tenantId: tid, accountId, pieceId, handle: cfg.handle, loginMethod: cfg.method, publish: r, token: reg.device.token }, null, 2));
}

const [cmd, arg] = process.argv.slice(2);
const run = cmd === "show" ? show(n(arg)) : cmd === "clean" ? clean(n(arg)) : cmd === "real" ? seedReal(String(arg)) : seed();
run.then(async () => { await pgClient.end({ timeout: 5 }); }).catch(async (e) => { console.error(e); await pgClient.end({ timeout: 5 }); process.exit(1); });
