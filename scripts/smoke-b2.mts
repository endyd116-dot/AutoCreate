/**
 * scripts/smoke-b2.mts — B2(러너 큐 · 발행 커넥터 · 발행 멱등) 실DB 스모크.
 *   실행: `npx tsx --env-file=.env scripts/smoke-b2.mts`  (전용 테스트 테넌트를 만들고 끝나면 지운다)
 *
 *   🔴 남의 계정·실서비스에 글을 남기지 않는다 — 발행은 **러너 채널**(잡 적재까지)만 태우고,
 *      API 채널(blogger·wordpress)은 자격이 없는 상태의 «정직한 실패» 경로만 확인한다.
 *   증거로 남기는 것: 테넌트 id · 잡 id · piece id · posts 행 수 · audit action 목록.
 */
import "./_lib/load-env.mjs";   // [R17-B2] 🔴 맨 위 — 없으면 db/index 가 빈 URL 로 풀을 만들어 `read ECONNRESET` 이라는 **가짜 빨강**을 낸다
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { jsonb } from "../lib/db-util";
import { encryptObj } from "../lib/creds-crypto";
import {
  registerDevice, listDevices, removeDevice, hashRunnerToken, claimJobs, reportJob, releaseJob,
  reapStaleJobs, heartbeat, fleetState, latestSessionJob, enqueueJob, type DeviceRow,
} from "../lib/runner-jobs";
import { publish, loadPublishPiece, loadPublishAccount } from "../lib/publish/index";
import { finalizePublish } from "../lib/publish/finalize";
import { runPublishGate } from "../lib/publish/gate";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, note = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}${note ? ` — ${note}` : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${note ? ` — ${note}` : ""}`); }
};

const BODY_OK = `<div class="disclosure">이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</div>
<p>동네 세탁소에 맡길지 직접 할지 한참 고민했어요.</p>
<h2>결론부터</h2>
<p>겨울 이불은 코인워시가 싸게 먹혔습니다.</p>
<blockquote>물세탁 표시가 있으면 집에서도 됩니다.</blockquote>
<hr>
<ul class="check"><li>세탁 표시 확인</li><li>건조까지 한 번에</li></ul>
<div class="adsense"></div>
<p class="tags">#겨울이불 #코인워시</p>`;

async function main() {
  const stamp = Date.now();
  const key = `b2smoke${stamp}`.slice(0, 40);
  console.log(`\n── B2 스모크 (테넌트 key=${key}) ──\n`);

  const [t] = await q(sql`INSERT INTO tenants (key, name, plan_key, status) VALUES (${key}, ${"B2스모크"}, ${"starter"}, ${"active"}) RETURNING id`);
  const tid = n(t?.id);
  const other = await q(sql`INSERT INTO tenants (key, name, plan_key, status) VALUES (${key + "-x"}, ${"타테넌트"}, ${"starter"}, ${"active"}) RETURNING id`);
  const tidOther = n(other[0]?.id);
  console.log(`테넌트 ${tid}(대조군 ${tidOther})`);

  try {
    /* ── 1. 기기 등록·토큰 ───────────────────────────── */
    const reg = await registerDevice(tid, "스모크 PC", "own");
    ok("기기 등록 + 토큰 1회 반환", !!reg.device.id && reg.device.token.startsWith("acr_"), `device=${reg.device.id}`);
    const [dev] = await q(sql`SELECT token_hash FROM runner_devices WHERE id = ${reg.device.id}`);
    ok("토큰은 평문 저장 0(해시만)", String(dev?.token_hash) === hashRunnerToken(reg.device.token) && !String(dev?.token_hash).includes(reg.device.token));
    const device: DeviceRow = { id: reg.device.id, tenantId: tid, name: "스모크 PC", kind: "own" };

    let devices = await listDevices(tid);
    ok("등록 직후 offline(하트비트 전)", devices[0]?.status === "offline");
    const hb = await heartbeat(device, { version: "1.0.0", jobs: 0 });
    devices = await listDevices(tid);
    ok("하트비트 후 online + sleepSec", devices[0]?.status === "online" && hb.sleepSec > 0, `sleepSec=${hb.sleepSec}`);

    /* ── 2. 계정·자격 ────────────────────────────────── */
    const [acc] = await q(sql`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key, daily_cap, min_gap_min)
      VALUES (${tid}, 'naver_blog', ${"b2smoke_blog"}, 'session', 'active', ${`t${tid}-naver`}, 3, 60) RETURNING id`);
    const accountId = n(acc?.id);
    await q(sql`INSERT INTO account_creds (tenant_id, account_id, kind, enc) VALUES (${tid}, ${accountId}, 'password', ${encryptObj({ loginId: "smokeid", password: "smokepw" })})`);

    /* ── 3. 발행 직전 게이트(§16B) ───────────────────── */
    const gBad = runPublishGate({ channel: "naver_blog", title: "최저가 정리", bodyHtml: "<p>본문</p>", affiliate: { provider: "coupang" } });
    ok("게이트 — 고지 없으면 복원", gBad.bodyHtml.startsWith('<div class="disclosure">'), "복원됨");
    ok("게이트 — 금칙어 잡음", gBad.report.checks.find((c) => c.key === "banned_words")?.pass === false, "«최저가»");
    const gAds = runPublishGate({ channel: "tistory", title: "제목", bodyHtml: BODY_OK, affiliate: { provider: "coupang" } }, { adsensePub: "ca-pub-123" });
    ok("게이트 — 애드센스 실체화 + «광고» 라벨", gAds.bodyHtml.includes("adsbygoogle") && gAds.bodyHtml.includes(">광고<"));
    const gNaver = runPublishGate({ channel: "naver_blog", title: "제목", bodyHtml: BODY_OK, affiliate: { provider: "coupang" } }, { adsensePub: "ca-pub-123" });
    ok("게이트 — 네이버는 애드센스 자리 제거", !gNaver.bodyHtml.includes("adsbygoogle") && !gNaver.bodyHtml.includes('class="adsense"'));

    /* ── 4. publish() — 게이트 실패 경로 ─────────────── */
    const mkPiece = async (body: string, status = "scheduled") => {
      const [p] = await q(sql`INSERT INTO pieces (tenant_id, account_id, channel, kind, format, title, body, blocks, meta, status)
        VALUES (${tid}, ${accountId}, 'naver_blog', 'post', 'info', ${"겨울 이불 세탁 정리"}, ${body}, ${jsonb([])},
                ${jsonb({ tags: ["겨울이불", "코인워시"], disclosure: "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.", affiliate: { provider: "coupang", url: "https://link.coupang.com/x", subId: "piece_0" } })},
                ${status}) RETURNING id`);
      return n(p?.id);
    };
    const badId = await mkPiece(`<p>이건 무조건 최저가입니다.</p>`);
    const badPiece = await loadPublishPiece(tid, badId);
    const account = await loadPublishAccount(tid, accountId);
    const rBad = await publish(badPiece!, account!, { actor: "cron" });
    ok("publish() — 금칙어면 reason:gate(발행 금지)", rBad.ok === false && rBad.reason === "gate", !rBad.ok ? rBad.gate?.checks.filter((c) => !c.pass).map((c) => c.key).join(",") : "");

    /* ── 5. publish() — 러너 채널 잡 적재 ────────────── */
    const pieceId = await mkPiece(BODY_OK);
    const piece = await loadPublishPiece(tid, pieceId);
    const rOk = await publish(piece!, account!, { actor: "cron" });
    ok("publish() — 러너 채널은 잡 적재 + via:runner", rOk.ok === true && rOk.via === "runner" && !!rOk.jobId, rOk.ok ? `job=${rOk.jobId}` : "");
    ok("publish() — 러너 상태 동봉(B 의 awaiting_runner 판정 재료)", rOk.ok === true && !!rOk.runner && rOk.runner.devices === 1, rOk.ok ? `online=${rOk.runner?.online}` : "");
    const [afterQueue] = await q(sql`SELECT status, body FROM pieces WHERE id = ${pieceId}`);
    ok("publish() — piece publishing 승격", String(afterQueue?.status) === "publishing");
    ok("publish() — 게이트가 고친 본문 저장(«올린 것 = 저장된 것»)", !String(afterQueue?.body).includes('class="adsense"'));

    const rTwice = await publish((await loadPublishPiece(tid, pieceId))!, account!, { actor: "cron" });
    const jobRows = await q(sql`SELECT id FROM runner_jobs WHERE tenant_id = ${tid} AND piece_id = ${pieceId}`);
    ok("잡 적재 멱등 — 두 번 불러도 1건", jobRows.length === 1, `jobs=${jobRows.length} · via=${rTwice.ok ? rTwice.via : rTwice.reason}`);

    /* ── 6. claim — 원자 선점 · 자격 · 테넌트 격리 ───── */
    const otherDevice: DeviceRow = { id: -1, tenantId: tidOther, name: "남의 PC", kind: "own" };
    const stolen = await claimJobs(otherDevice, ["publish.naver_blog"], 3);
    ok("claim — 타 테넌트 잡은 안 보인다", stolen.length === 0);

    const claimed = await claimJobs(device, ["publish.naver_blog"], 3);
    ok("claim — 잡 1건 선점", claimed.length === 1, `job=${claimed[0]?.id}`);
    ok("claim — 자격 평문 동봉(유일한 표면)", claimed[0]?.account?.login?.id === "smokeid");
    ok("claim — payload 에는 자격 0", !JSON.stringify(claimed[0]?.payload ?? {}).includes("smokepw"));
    const again = await claimJobs(device, ["publish.naver_blog"], 3);
    ok("claim — 이미 선점된 잡은 두 번 안 나온다", again.length === 0);
    const [credAudit] = await q(sql`SELECT count(*) c FROM audit_logs WHERE tenant_id = ${tid} AND action = 'runner_creds_issued'`);
    ok("claim — 자격 발급 감사 1행(risk high)", n(credAudit?.c) === 1);

    /* ── 7. report 실패 → 분류 · 계정 전이 신호 ──────── */
    const jobId = claimed[0]!.id;
    const rFail = await reportJob(device, jobId, { ok: false, errorKind: "captcha", detail: "캡차가 떴어요", shotKey: "job-x" });
    ok("report 실패 — captcha 분류", rFail.block?.kind === "captcha", `status=${rFail.status}`);
    const [accAfter] = await q(sql`SELECT last_error_kind, status FROM accounts WHERE id = ${accountId}`);
    ok("report 실패 — last_error_kind 기록", String(accAfter?.last_error_kind) === "captcha");
    ok("report 실패 — 계정 전이는 account-health 가(pending_login)", String(accAfter?.status) === "pending_login", `status=${accAfter?.status}`);

    /* ── 8. finalizePublish — 멱등(posts 1행) ────────── */
    await q(sql`UPDATE accounts SET status = 'active' WHERE id = ${accountId}`);
    const url = `https://blog.naver.com/b2smoke_blog/${stamp}`;
    const f1 = await finalizePublish(pieceId, { via: "runner", externalUrl: url, channelRef: `naverblog:${stamp}`, accountId, tenantId: tid });
    ok("finalize — 첫 호출 성공", f1.ok === true && f1.already === false, f1.ok ? `post=${f1.postId}` : f1.reason);
    const f2 = await finalizePublish(pieceId, { via: "runner", externalUrl: url + "-dup", accountId, tenantId: tid });
    ok("finalize — 두 번째는 already(재발행 0)", f2.ok === true && f2.already === true);
    const posts = await q(sql`SELECT id, external_url FROM posts WHERE tenant_id = ${tid} AND piece_id = ${pieceId}`);
    ok("🔴 발행 멱등 — posts 정확히 1행", posts.length === 1, `url=${String(posts[0]?.external_url).slice(-24)}`);
    const [pubPiece] = await q(sql`SELECT status, external_url, published_at FROM pieces WHERE id = ${pieceId}`);
    ok("finalize — piece published + external_url", String(pubPiece?.status) === "published" && !!pubPiece?.external_url);
    const [accCnt] = await q(sql`SELECT posts_today, last_post_at FROM accounts WHERE id = ${accountId}`);
    ok("finalize — 계정 카운터 1회만 증가", n(accCnt?.posts_today) === 1 && !!accCnt?.last_post_at);

    const rePub = await publish((await loadPublishPiece(tid, pieceId))!, account!, {});
    ok("🔴 publish() — 이미 발행된 글은 already(재게시 0)", rePub.ok === true && rePub.already === true);

    /* ── 9. release · reap ───────────────────────────── */
    const sess = await enqueueJob({ tenantId: tid, kind: "session.login", accountId, payload: { channel: "naver_blog" } });
    const sessClaim = await claimJobs(device, ["session.login"], 1);
    ok("claim — 우선순위/종류 필터", sessClaim[0]?.id === sess.id);
    await releaseJob(device, sess.id, "테스트");
    const [relRow] = await q(sql`SELECT status, attempts FROM runner_jobs WHERE id = ${sess.id}`);
    ok("release — queued 로 되돌림(attempts 유지)", String(relRow?.status) === "queued" && n(relRow?.attempts) === 1);

    await claimJobs(device, ["session.login"], 1);
    await q(sql`UPDATE runner_jobs SET claimed_at = NOW() - INTERVAL '30 minutes' WHERE id = ${sess.id}`);
    const reaped = await reapStaleJobs(15);
    const [reapRow] = await q(sql`SELECT status FROM runner_jobs WHERE id = ${sess.id}`);
    ok("reap — 무보고 잡 회수", reaped.released + reaped.failed >= 1 && ["queued", "failed"].includes(String(reapRow?.status)), `released=${reaped.released} failed=${reaped.failed}`);

    const rel = await latestSessionJob(tid, accountId);
    ok("§6B — 세션 잡 상태 매핑", !!rel && ["queued", "running", "done", "failed"].includes(rel.status), `status=${rel?.status}`);

    /* ── 9B. API 채널 — 키 없는 상태의 «정직한 실패»(B2-5) ── */
    const mkApiPiece = async (channel: string, accId: number) => {
      const [p] = await q(sql`INSERT INTO pieces (tenant_id, account_id, channel, kind, format, title, body, blocks, meta, status)
        VALUES (${tid}, ${accId}, ${channel}, 'post', 'info', ${"API 채널 시험"}, ${"<p>본문입니다.</p>"}, ${jsonb([])}, ${jsonb({ tags: [] })}, 'scheduled') RETURNING id`);
      return n(p?.id);
    };
    const [bAcc] = await q(sql`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key)
      VALUES (${tid}, 'blogger', ${"b2smoke.blogspot.com"}, 'oauth', 'active', ${`t${tid}-blogger`}) RETURNING id`);
    const bAccId = n(bAcc?.id);
    const bPieceId = await mkApiPiece("blogger", bAccId);
    const rNoCred = await publish((await loadPublishPiece(tid, bPieceId))!, (await loadPublishAccount(tid, bAccId))!, {});
    ok("블로거 — 토큰 없으면 no_creds(코드는 완성 · 조용한 성공 0)", rNoCred.ok === false && rNoCred.reason === "no_creds", !rNoCred.ok ? rNoCred.reason : "");

    // 앱 키가 없을 때의 «준비 중» 경로 — 토큰은 있는데 provider 미설정.
    await q(sql`INSERT INTO account_creds (tenant_id, account_id, kind, enc, expires_at)
      VALUES (${tid}, ${bAccId}, 'oauth', ${encryptObj({ accessToken: "fake-at", refreshToken: "fake-rt", externalId: "b1", handle: "b", expiresAt: new Date(Date.now() - 60_000).toISOString(), extra: { blogId: "b1" } })},
              ${new Date(Date.now() - 60_000).toISOString()}::timestamptz AT TIME ZONE 'UTC')`);
    const hadGoogleKey = !!process.env.GOOGLE_OAUTH_CLIENT_ID;
    const rNotConfigured = await publish((await loadPublishPiece(tid, bPieceId))!, (await loadPublishAccount(tid, bAccId))!, {});
    ok("블로거 — 앱 키 없으면 provider_not_configured(키 꽂으면 가동 · CLAUDE §8)",
      hadGoogleKey || (rNotConfigured.ok === false && rNotConfigured.reason === "provider_not_configured"),
      hadGoogleKey ? "(키 있음 — 이 검사 건너뜀)" : "");

    /* 🔴 «갱신 실패 → disconnected + 알림» 은 실제로 돌려 본다 — 가짜 앱 키로 Google 토큰 엔드포인트를 진짜 때린다
       (400 이 정답이다). 남의 계정·데이터에 닿지 않는다. */
    if (!hadGoogleKey) {
      process.env.GOOGLE_OAUTH_CLIENT_ID = "b2smoke-not-a-real-client.apps.googleusercontent.com";
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = "b2smoke-not-a-real-secret";
      const rRefreshFail = await publish((await loadPublishPiece(tid, bPieceId))!, (await loadPublishAccount(tid, bAccId))!, {});
      delete process.env.GOOGLE_OAUTH_CLIENT_ID; delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      ok("블로거 — 토큰 갱신 실패는 auth_failed(재시도 금지)", rRefreshFail.ok === false && rRefreshFail.reason === "auth_failed" && rRefreshFail.retriable === false,
        !rRefreshFail.ok ? String(rRefreshFail.detail ?? "").slice(0, 40) : "");
      const [bAccAfter] = await q(sql`SELECT status FROM accounts WHERE id = ${bAccId}`);
      ok("블로거 — 갱신 실패면 계정 disconnected", String(bAccAfter?.status) === "disconnected");
      const [note] = await q(sql`SELECT count(*) c FROM notifications WHERE tenant_id = ${tid} AND kind = 'account_disconnected'`);
      ok("블로거 — «다시 연결해 주세요» 알림 1행(침묵 금지)", n(note?.c) === 1);
    }

    const [wAcc] = await q(sql`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key)
      VALUES (${tid}, 'wordpress', ${"b2smoke.example.com"}, 'app_password', 'active', ${`t${tid}-wp`}) RETURNING id`);
    const wPieceId = await mkApiPiece("wordpress", n(wAcc?.id));
    const rWp = await publish((await loadPublishPiece(tid, wPieceId))!, (await loadPublishAccount(tid, n(wAcc?.id)))!, {});
    ok("워드프레스 — 자격 없으면 no_creds", rWp.ok === false && rWp.reason === "no_creds");

    const [xAcc] = await q(sql`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key)
      VALUES (${tid}, 'threads', ${"b2smoke_threads"}, 'oauth', 'active', ${`t${tid}-th`}) RETURNING id`);
    const xPieceId = await mkApiPiece("threads", n(xAcc?.id));
    const rX = await publish((await loadPublishPiece(tid, xPieceId))!, (await loadPublishAccount(tid, n(xAcc?.id)))!, {});
    ok("미지원 채널 — unsupported_channel(조용히 성공 0)", rX.ok === false && rX.reason === "unsupported_channel");

    /* ── 9C. fetchStats — «못 물어봤다»는 null · 없는 값은 안 싣는다(AC-9) ── */
    const { fetchStats } = await import("../lib/publish/stats");
    ok("fetchStats — post 행 없으면 null", (await fetchStats(tid, 999999999)) === null);
    // 러너 채널(네이버) 발행물 — 이 함수 몫이 아니다 → null(0 이 아니다)
    ok("fetchStats — 러너 채널은 null(revenue.stats 잡의 몫)", (await fetchStats(tid, pieceId)) === null);
    // 블로거 발행물인데 토큰이 끊긴 계정(위에서 disconnected) → null
    await q(sql`INSERT INTO posts (tenant_id, piece_id, account_id, channel, external_url, channel_ref, published_via)
      VALUES (${tid}, ${bPieceId}, ${bAccId}, 'blogger', ${"https://b2smoke.blogspot.com/p1"}, ${"123"}, 'api')`);
    const bs = await fetchStats(tid, bPieceId);
    ok("fetchStats — 블로거 자격 실패면 null(0 으로 안 채움)", bs === null, JSON.stringify(bs));
    // 워드프레스 — 존재하지 않는 사이트(네트워크 실패) → null
    await q(sql`INSERT INTO account_creds (tenant_id, account_id, kind, enc)
      VALUES (${tid}, ${n(wAcc?.id)}, 'app_password', ${encryptObj({ siteUrl: "https://b2smoke-no-such-site.invalid", loginId: "u", appPassword: "p" })})`);
    await q(sql`INSERT INTO posts (tenant_id, piece_id, account_id, channel, external_url, channel_ref, published_via)
      VALUES (${tid}, ${wPieceId}, ${n(wAcc?.id)}, 'wordpress', ${"https://b2smoke-no-such-site.invalid/?p=7"}, ${"7"}, 'api')`);
    const ws = await fetchStats(tid, wPieceId);
    ok("fetchStats — 워드프레스 접속 불가면 null(0 으로 안 채움)", ws === null, JSON.stringify(ws));

    /* ── 9D. 수익 스크랩 report(P1R3 §2.1) — upsert 한 함수 · parse 는 0 금지 · 상태 기록 ── */
    await q(sql`UPDATE accounts SET status = 'active', last_error_kind = NULL WHERE id = ${accountId}`);
    await q(sql`INSERT INTO revenue_sources (tenant_id, source, account_id, method, status) VALUES (${tid}, 'adpost', ${accountId}, 'runner', 'connected')`);
    const rj = await enqueueJob({ tenantId: tid, kind: "revenue.adpost", accountId, payload: { verify: true } });
    const [rc] = await claimJobs(device, ["revenue.adpost"], 1);
    ok("수익 잡 — 적재·선점(우선순위 60)", rc?.id === rj.id && rc?.kind === "revenue.adpost");
    const rr1 = await reportJob(device, rj.id, { ok: true, revenueRows: [{ source: "adpost", day: "2026-09-13", amountKrw: 1200, currency: "KRW" }], adpostState: "approved" });
    const rd1 = await q(sql`SELECT amount_krw, freshness, account_id FROM revenue_daily WHERE tenant_id = ${tid} AND source = 'adpost'`);
    ok("수익 report — upsertRevenueRows 로 1행(freshness runner · 계정 귀속 보정)", rr1.status === "done" && rd1.length === 1 && n(rd1[0]?.amount_krw) === 1200 && String(rd1[0]?.freshness) === "runner" && n(rd1[0]?.account_id) === accountId, rr1.reason ?? "");
    const [accM] = await q(sql`SELECT monetize->>'adpostState' AS st FROM accounts WHERE id = ${accountId}`);
    ok("수익 report — adpostState 가 accounts.monetize 에", String(accM?.st) === "approved");
    const [rs1] = await q(sql`SELECT status, last_ok_at, fail_count FROM revenue_sources WHERE tenant_id = ${tid} AND source = 'adpost'`);
    ok("수익 report — revenue_sources connected · last_ok_at", String(rs1?.status) === "connected" && !!rs1?.last_ok_at);

    // 재수집 = 덮어쓰기(멱등 · 1행 유지)
    const rj2 = await enqueueJob({ tenantId: tid, kind: "revenue.adpost", accountId, payload: {}, dedupe: false });
    await claimJobs(device, ["revenue.adpost"], 1);
    await reportJob(device, rj2.id, { ok: true, revenueRows: [{ source: "adpost", day: "2026-09-13", amountKrw: 1350, currency: "KRW" }] });
    const rd2 = await q(sql`SELECT amount_krw FROM revenue_daily WHERE tenant_id = ${tid} AND source = 'adpost' AND day = '2026-09-13'::date`);
    ok("🔴 수익 멱등 — 같은 날 재수집은 1행 덮어쓰기(1200→1350)", rd2.length === 1 && n(rd2[0]?.amount_krw) === 1350);

    // 파싱 실패 — 행 0 · 계정 전이 0 · 소스 error · audit high
    const rj3 = await enqueueJob({ tenantId: tid, kind: "revenue.adpost", accountId, payload: {}, dedupe: false });
    await claimJobs(device, ["revenue.adpost"], 1);
    const rr3 = await reportJob(device, rj3.id, { ok: false, errorKind: "parse", detail: "수입 표를 찾지 못했어요", shotKey: "job-x" });
    const [j3] = await q(sql`SELECT status, error_kind FROM runner_jobs WHERE id = ${rj3.id}`);
    const rd3 = await q(sql`SELECT count(*) c FROM revenue_daily WHERE tenant_id = ${tid} AND source = 'adpost'`);
    const [acc3] = await q(sql`SELECT status FROM accounts WHERE id = ${accountId}`);
    const [rs3] = await q(sql`SELECT status, last_error_kind, fail_count FROM revenue_sources WHERE tenant_id = ${tid} AND source = 'adpost'`);
    ok("🔴 parse — 잡 failed(error_kind parse) · 행 그대로 1(0 으로 안 채움)", rr3.reason === "parse" && String(j3?.status) === "failed" && String(j3?.error_kind) === "parse" && n(rd3[0]?.c) === 1);
    ok("parse — 계정 전이 0(우리 버그 · 계정 문제 아님)", String(acc3?.status) === "active");
    ok("parse — revenue_sources error · last_error_kind parse · fail_count 1", String(rs3?.status) === "error" && String(rs3?.last_error_kind) === "parse" && n(rs3?.fail_count) === 1);
    const [pa] = await q(sql`SELECT risk_level FROM audit_logs WHERE tenant_id = ${tid} AND action = 'runner_job_failed' AND detail->>'errorKind' = 'parse' ORDER BY id DESC LIMIT 1`);
    ok("parse — audit risk high(우리가 볼 신호)", String(pa?.risk_level) === "high");

    // 미등록(행 0 · 상태 none)은 성공이다
    const rj4 = await enqueueJob({ tenantId: tid, kind: "revenue.adpost", accountId, payload: {}, dedupe: false });
    await claimJobs(device, ["revenue.adpost"], 1);
    const rr4 = await reportJob(device, rj4.id, { ok: true, revenueRows: [], adpostState: "none" });
    const [accM4] = await q(sql`SELECT monetize->>'adpostState' AS st FROM accounts WHERE id = ${accountId}`);
    ok("미등록 — 행 0 이어도 done · adpostState none(«없음»은 실패가 아니다)", rr4.status === "done" && String(accM4?.st) === "none");

    /* ── 10. 자격 평문 누출 검사 ─────────────────────── */
    const fleet = await fleetState(tid);
    const surfaces = JSON.stringify({ devices: await listDevices(tid), fleet, rel, rOk, rBad });
    ok("🔴 자격 평문은 claim 응답 밖 0", !surfaces.includes("smokepw") && !surfaces.includes("smokeid"));
    const audits = await q(sql`SELECT action, detail FROM audit_logs WHERE tenant_id = ${tid} ORDER BY id`);
    ok("🔴 감사 detail 에 평문 0", !JSON.stringify(audits).includes("smokepw"));
    console.log(`  · audit: ${audits.map((a) => String(a.action)).join(", ")}`);

    await removeDevice(tid, device.id);
    ok("기기 해제", (await listDevices(tid)).length === 0);
  } finally {
    /* ── 정리 ─────────────────────────────────────────── */
    for (const id of [tid, tidOther]) {
      await q(sql`DELETE FROM revenue_daily WHERE tenant_id = ${id}`);
      await q(sql`DELETE FROM revenue_sources WHERE tenant_id = ${id}`);
      await q(sql`DELETE FROM posts WHERE tenant_id = ${id}`);
      await q(sql`DELETE FROM runner_jobs WHERE tenant_id = ${id}`);
      await q(sql`DELETE FROM runner_devices WHERE tenant_id = ${id}`);
      await q(sql`DELETE FROM account_creds WHERE tenant_id = ${id}`);
      await q(sql`DELETE FROM pieces WHERE tenant_id = ${id}`);
      await q(sql`DELETE FROM accounts WHERE tenant_id = ${id}`);
      await q(sql`DELETE FROM notifications WHERE tenant_id = ${id}`);
      await q(sql`DELETE FROM audit_logs WHERE tenant_id = ${id}`);
      await q(sql`DELETE FROM tenants WHERE id = ${id}`);
    }
    console.log(`\n── 결과: ${pass} 통과 · ${fail} 실패 ──\n`);
    await pgClient.end({ timeout: 5 });
    process.exit(fail ? 1 : 0);
  }
}

main().catch(async (e) => { console.error("\n스모크 예외:", e); await pgClient.end({ timeout: 5 }); process.exit(1); });
