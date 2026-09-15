/**
 * 러너 API(계약 §2 + §6B + «러너 배포» · 9경로 · 한 파일 · 폭발 반경 최소):
 *   [로그인 세션]
 *   POST /api/runner-register        { name, kind:"own" }                → { device:{ id, name, token }, install:{ cmd, url, token, steps } }  // token 평문 1회
 *   GET  /api/runner-list                                                 → { devices:[RunnerDevice] }
 *   GET  /api/runner-download                                             → { version, bytes, sha256, filename, url(10분), expiresInSec }
 *   POST /api/runner-rotate          { id }                               → { device:{ id, name, token } }          // 옛 토큰 즉사 · 지문 초기화
 *   POST /api/runner-remove          { id }                               → { ok:true }
 *   POST /api/accounts-relogin       { id }                               → { job:{ id, status, updatedAt? } }      // §6B
 *   GET  /api/accounts-relogin?id=                                        → { job:{...}|null, account:AccountRow }
 *   [러너 토큰 x-runner-token · 지문 x-runner-fp]
 *   POST /api/runner-heartbeat       { version, jobs, canary?, caps?, updateFailed? } → { sleepSec, jobsWaiting, update? }
 *   POST /api/runner-queue           { action:"claim"|"report"|"release" }→ claim { jobs:[RunnerJob] } · report/release { ok:true }
 *   POST /api/runner-session-upload  { accountId, cookies, verifiedAt }   → { ok:true }
 *
 *   🔴 claim 응답에만 계정 자격 평문이 실린다(DESIGN §7.1) — 다른 응답·로그에 평문 0.
 *      평문 토큰이 나가는 자리는 **등록·재발급 두 곳뿐**이고, 둘 다 1회성이다(다시 볼 수 없다).
 *   🔴 러너 경로는 쿠키 인증을 쓰지 않는다(기기 토큰만) — 브라우저 세션과 섞지 않는다.
 *   🔴 기기 묶기는 `authRunner` 안에 있다 — 러너 3경로 **전부**가 같은 관문을 지난다(AC-35).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, requireWritable } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { writeAudit } from "../../lib/audit";
import { getAccount } from "../../lib/accounts";
import { checkLimit, tenantPlan } from "../../lib/plans";
import { presignLatest, releaseFilename } from "../../lib/runner-release";
import {
  registerDevice, listDevices, removeDevice, rotateDeviceToken, authRunner, heartbeat,
  claimJobs, reportJob, releaseJob, saveRunnerSession, enqueueJob, fleetState, latestSessionJob,
  isRunnerJobKind, type RunnerJobKind, type DeviceRow, type RunnerReportBody,
} from "../../lib/runner-jobs";

export const config = {
  path: [
    "/api/runner-register", "/api/runner-list", "/api/runner-remove", "/api/runner-rotate",
    "/api/runner-heartbeat", "/api/runner-queue", "/api/runner-session-upload",
    "/api/runner-download",
    "/api/accounts-relogin",
  ],
};

/** netlify dev 의 정적 폴백(.html 재시도)이 경로 매칭에서 빠지면 엉뚱한 405 가 보인다(PITFALLS AC-7) — 꼬리를 떼고 맞춘다. */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const RUNNER_PATHS = ["/runner-heartbeat", "/runner-queue", "/runner-session-upload"];

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = routeOf(req);

  try {
    /* ───────── 러너(기기 토큰) 경로 ───────── */
    if (RUNNER_PATHS.some((p) => path.endsWith(p))) {
      if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);
      const a = await authRunner(req);
      /* 🔴 «토큰이 틀렸다»와 «다른 PC 다»는 고객이 할 일이 다르다(다시 등록 vs 여기서 쓰려면 다시 등록 + 도난 확인).
         한 문구로 뭉치면 토큰을 도둑맞은 사람이 그걸 «내 토큰이 만료됐나 보다»로 읽는다. */
      if (!a.ok) return json({ ok: false, error: a.message, step: a.reason === "other_device" ? "other_device" : "runner_auth" }, 401);
      const device = a.device;

      if (path.endsWith("/runner-heartbeat")) {
        const b = await readJson<Record<string, unknown>>(req);
        const hb = await heartbeat(device, b);
        // `update` 는 새 판이 있을 때만 실린다(러너가 «잡 집기 직전»에만 받아서 스스로 갈아 끼운다).
        return json({ ok: true, sleepSec: hb.sleepSec, jobsWaiting: hb.jobsWaiting, ...(hb.update ? { update: hb.update } : {}) });
      }

      if (path.endsWith("/runner-session-upload")) {
        const b = await readJson<{ accountId?: unknown; cookies?: unknown; verifiedAt?: unknown }>(req);
        const accountId = n(b.accountId);
        if (!accountId) return badRequest("accountId");
        if (!Array.isArray(b.cookies)) return badRequest("cookies");
        const r = await saveRunnerSession(device, accountId, b.cookies, b.verifiedAt ? String(b.verifiedAt) : undefined);
        if (!r.ok) return json({ ok: false, error: r.reason === "empty" ? "로그인 정보를 받지 못했어요." : "계정을 찾을 수 없어요.", step: r.reason ?? "session_upload" }, r.reason === "not_found" ? 404 : 400);
        return json({ ok: true });
      }

      // /runner-queue
      const b = await readJson<Record<string, unknown>>(req);
      const action = String(b.action ?? "");

      if (action === "claim") {
        const kinds = (Array.isArray(b.kinds) ? b.kinds : []).filter(isRunnerJobKind) as RunnerJobKind[];
        /* [P1R8 §3.3 · B2] `canary` = 러너의 드라이런이라는 **러너만 아는 사실**. 셀렉터 표를 «시험 단계»로 줄지 가른다.
           🔴 이 값으로 잡을 고르지는 않는다 — 큐·선점은 그대로다(시험과 진짜가 **같은 길**을 지나야 카나리가 대용물이 아니다). */
        const jobs = await claimJobs(device, kinds, n(b.max) || 3, { canary: b.canary === true });
        return json({ ok: true, jobs });
      }
      if (action === "report") {
        const jobId = n(b.jobId);
        if (!jobId) return badRequest("jobId");
        const result = (b.result && typeof b.result === "object" ? b.result : { ok: false }) as RunnerReportBody;
        const out = await reportJob(device, jobId, result);
        const body: Record<string, unknown> = { ok: true, status: out.status };
        if (out.postId) body.postId = out.postId;
        if (out.verified) body.verified = out.verified;
        if (out.reason) body.reason = out.reason;
        if (out.block) body.block = { kind: out.block.kind, label: out.block.label, retryable: out.block.retryable };
        return json(body);
      }
      if (action === "release") {
        const jobId = n(b.jobId);
        if (!jobId) return badRequest("jobId");
        const r = await releaseJob(device, jobId, String(b.reason ?? ""));
        return json({ ok: r.ok });
      }
      return badRequest("action", "action");
    }

    /* ───────── 고객(로그인 세션) 경로 ───────── */
    const auth = requireUser(req);
    if (!auth.ok) return auth.res;
    const tid = auth.tid;

    if (path.endsWith("/runner-list")) {
      const devices = await listDevices(tid);
      return json({ ok: true, devices });
    }

    /* ───────── 러너 내려받기(계약 «러너 배포» ②) ─────────
       🔴 이 프로그램은 우리 자동화의 알맹이다 — **공개 URL 로 두지 않는다.**
          로그인 + 쓰기 가능 + 플랜에 러너가 있는 사람에게만, 그때그때 만든 **10분짜리** 링크를 준다.
          그게 «받아서 열 명이 나눠 쓰기» 의 1차 관문이다(2차는 토큰-기기 묶기 · lib/runner-jobs authRunner).
       🔴 플랜 판정은 **`checkLimit` 이 아니라 한도값 자체**로 한다 —
          checkLimit 은 «지금 몇 대 켜져 있나»라서, 1대 한도인 고객이 이미 1대를 등록했으면
          «프로그램을 다시 받는 것»까지 막힌다(PC 를 바꾸면 영영 못 받는다). 여기서 물을 것은
          «이 플랜에 내 PC 러너가 있나»(한도 > 0) 뿐이다. */
    if (path.endsWith("/runner-download")) {
      if (req.method !== "GET") return json({ ok: false, error: "method", step: "method" }, 405);
      const w = await requireWritable(tid);
      if (!w.ok) return w.res;
      const { plan, planKey } = await tenantPlan(tid);
      if (!(plan.limits.runnerDevices > 0)) {
        return json({ ok: false, step: "plan", planKey, error: "지금 요금제에는 «내 PC에서 켜기»가 없어요. 요금제를 바꾸면 바로 받을 수 있어요." }, 403);
      }
      const got = await presignLatest();
      // 🔴 «아직 안 올렸다»를 «오류»로 말하지 않는다 — 고칠 사람이 다르다(우리가 올리면 된다).
      if (!got) return json({ ok: false, step: "no_release", error: "프로그램을 준비 중이에요. 잠시 뒤 다시 눌러 주세요." }, 503);
      await writeAudit({
        tenantId: tid, action: "runner_downloaded", actorType: "user", actorId: auth.user.uid, ip: clientIp(req),
        target: `runner_release:${got.rel.version}`, detail: { version: got.rel.version, bytes: got.rel.bytes, planKey },
      });
      // 파일명을 우리가 정해 준다(브라우저가 presigned 키 이름으로 저장하지 않게).
      const filename = releaseFilename(got.rel.version);   // 🔴 서명에 담은 이름과 **같은 값**이어야 한다(lib/runner-release.ts)
      return json({ ok: true, version: got.rel.version, bytes: got.rel.bytes, sha256: got.rel.sha256, filename, url: got.url, expiresInSec: 600, ...(got.rel.notes ? { notes: got.rel.notes } : {}) });
    }

    if (path.endsWith("/accounts-relogin") && req.method === "GET") {
      const id = n(url.searchParams.get("id"));
      if (!id) return badRequest("id");
      const account = await getAccount(tid, id);
      if (!account) return json({ ok: false, error: "계정을 찾을 수 없어요.", step: "not_found" }, 404);
      const job = await latestSessionJob(tid, id);
      return json({ ok: true, job, account });
    }

    if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);

    if (path.endsWith("/runner-register")) {
      const b = await readJson<{ name?: unknown; kind?: unknown }>(req);
      const name = String(b.name ?? "").trim();
      if (!name) return badRequest("이름을 입력해 주세요.", "name");
      { const c = await checkLimit(tid, "runnerDevices"); if (!c.ok) return c.res!; }   // ★C(P1R4) fix: 플랜 기기 한도(Starter 1 · Pro 2 · 계약 §1.4) — 안 재고 있었다
      let out: Awaited<ReturnType<typeof registerDevice>>;
      try { out = await registerDevice(tid, name, String(b.kind ?? "own")); }
      catch (e) {
        if ((e as { code?: string })?.code === "RUNNER_TOKEN_SECRET_MISSING") {
          return json({ ok: false, error: "러너 기능이 아직 준비 중이에요.", step: "not_configured" }, 503);
        }
        throw e;
      }
      return json({ ok: true, device: out.device, install: out.install });
    }

    /* 토큰 재발급 — 기기는 두고 열쇠만 바꾼다(PC 교체 · 토큰 유출). 옛 토큰은 이 순간 죽는다.
       평문 토큰은 등록 때와 마찬가지로 **여기서 1회만** 나간다(다시 볼 수 없다 · DESIGN §7.1). */
    if (path.endsWith("/runner-rotate")) {
      const b = await readJson<{ id?: unknown }>(req);
      const id = n(b.id);
      if (!id) return badRequest("id");
      const w = await requireWritable(tid);
      if (!w.ok) return w.res;
      const out = await rotateDeviceToken(tid, id);
      if (!out) return json({ ok: false, error: "기기를 찾을 수 없어요.", step: "not_found" }, 404);
      await writeAudit({ tenantId: tid, action: "runner_token_rotate_request", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `runner_device:${id}` });
      return json({ ok: true, device: { id: out.id, name: out.name, token: out.token }, install: { steps: ["받은 폴더에서 run.bat 을 다시 실행", "새 토큰 붙여넣기"] } });
    }

    if (path.endsWith("/runner-remove")) {
      const b = await readJson<{ id?: unknown }>(req);
      const id = n(b.id);
      if (!id) return badRequest("id");
      const removed = await removeDevice(tid, id);
      if (!removed) return json({ ok: false, error: "기기를 찾을 수 없어요.", step: "not_found" }, 404);
      return json({ ok: true });
    }

    if (path.endsWith("/accounts-relogin")) {
      const b = await readJson<{ id?: unknown }>(req);
      const id = n(b.id);
      if (!id) return badRequest("id");
      const account = await getAccount(tid, id);
      if (!account) return json({ ok: false, error: "계정을 찾을 수 없어요.", step: "not_found" }, 404);

      // 이미 대기 중인 잡이 있으면 그대로 돌려준다(중복 적재 0 · 계약 §6B).
      const cur = await latestSessionJob(tid, id);
      if (cur && (cur.status === "queued" || cur.status === "running")) return json({ ok: true, job: cur });

      const fleet = await fleetState(tid);
      if (!fleet.online) {
        return json({ ok: false, step: "runner_offline", error: "먼저 내 PC 프로그램을 켜 주세요.", runner: fleet }, 409);
      }
      const { id: jobId } = await enqueueJob({
        tenantId: tid, kind: "session.login", accountId: id,
        payload: { channel: account.channel, handle: account.handle, reason: account.lastErrorKind ?? "manual" },
      });
      await writeAudit({ tenantId: tid, action: "account_relogin_request", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `account:${id}`, detail: { jobId, channel: account.channel } });
      const job = await latestSessionJob(tid, id);
      return json({ ok: true, job: job ?? { id: jobId, status: "queued" } });
    }

    return json({ ok: false, error: "not_found", step: "route" }, 404);
  } catch (err) {
    return jsonError("runner", err);
  }
};
