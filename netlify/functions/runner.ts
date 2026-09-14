/**
 * 러너 API(계약 §2 + §6B · 7경로 · 한 파일 · 폭발 반경 최소):
 *   [로그인 세션]
 *   POST /api/runner-register        { name, kind:"own" }                → { device:{ id, name, token }, install:{ cmd, url } }   // token 평문 1회
 *   GET  /api/runner-list                                                 → { devices:[RunnerDevice] }
 *   POST /api/runner-remove          { id }                               → { ok:true }
 *   POST /api/accounts-relogin       { id }                               → { job:{ id, status, updatedAt? } }      // §6B
 *   GET  /api/accounts-relogin?id=                                        → { job:{...}|null, account:AccountRow }
 *   [러너 토큰 x-runner-token]
 *   POST /api/runner-heartbeat       { version, jobs, canary? }           → { sleepSec }
 *   POST /api/runner-queue           { action:"claim"|"report"|"release" }→ claim { jobs:[RunnerJob] } · report/release { ok:true }
 *   POST /api/runner-session-upload  { accountId, cookies, verifiedAt }   → { ok:true }
 *
 *   🔴 claim 응답에만 계정 자격 평문이 실린다(DESIGN §7.1) — 다른 응답·로그에 평문 0.
 *   🔴 러너 경로는 쿠키 인증을 쓰지 않는다(기기 토큰만) — 브라우저 세션과 섞지 않는다.
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { writeAudit } from "../../lib/audit";
import { getAccount } from "../../lib/accounts";
import { checkLimit } from "../../lib/plans";
import {
  registerDevice, listDevices, removeDevice, authRunner, heartbeat,
  claimJobs, reportJob, releaseJob, saveRunnerSession, enqueueJob, fleetState, latestSessionJob,
  isRunnerJobKind, type RunnerJobKind, type DeviceRow, type RunnerReportBody,
} from "../../lib/runner-jobs";

export const config = {
  path: [
    "/api/runner-register", "/api/runner-list", "/api/runner-remove",
    "/api/runner-heartbeat", "/api/runner-queue", "/api/runner-session-upload",
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
      const device = await authRunner(req);
      if (!device) return json({ ok: false, error: "러너 토큰이 올바르지 않아요.", step: "runner_auth" }, 401);

      if (path.endsWith("/runner-heartbeat")) {
        const b = await readJson<Record<string, unknown>>(req);
        const hb = await heartbeat(device, b);
        return json({ ok: true, sleepSec: hb.sleepSec, jobsWaiting: hb.jobsWaiting });
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
        const jobs = await claimJobs(device, kinds, n(b.max) || 3);
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
