/**
 * lib/runner-jobs.ts — 러너 큐 서버측 단일 출처(계약 §2 · DESIGN §8.3).
 *   AM 원본: ../AutoMarketing/lib/content-runner.ts(claim/report/release 상태기계 · «러너 주장을 믿지 않는다» 재확인 규율)
 *            + ../AutoMarketing/lib/runner-jobs.ts(기기·하트비트 관례) — 구조 이식 2026-09-14.
 *            AM 은 content_pieces 를 직접 선점했지만 AC 는 `runner_jobs` 테이블이 있어 **잡 단위**로 다시 짰다.
 *
 *   🔴 이 파일이 유일하게 하는 위험한 일: **claim 응답에 계정 자격 평문을 싣는다**(DESIGN §7.1 평문 표면 2곳 중 하나).
 *      그 외 어떤 응답·로그·audit detail 에도 평문 0. claim 은 자격이 실린 계정마다 감사 1행(`runner_creds_issued` · risk high)을 남기고,
 *      **유효한 쿠키가 있으면 id/pw 는 싣지 않는다**(필요할 때만 열리는 표면).
 *
 *   🔴 상태를 쓰는 자리 분담(계약 §10 «두 곳에서 상태를 쓰지 않는다»):
 *      · 발행 **성공** → `lib/publish/finalize.ts finalizePublish` 만(posts·piece·slot·계정 카운터).
 *      · 발행 **실패**(러너 보고) → 이 파일이 종결한다(piece·slot `awaiting_manual` · job failed · accounts.last_error_kind).
 *        B 의 publisher 는 잡을 넘긴 뒤로는 그 piece 의 상태를 쓰지 않는다.
 *      · 계정 status 전이(cooldown/suspended/pending_login) → B 의 `lib/account-health.ts classifyAndApply`(정적 배선).
 *        여기선 신호(last_error_kind)만 쓰고 그 함수에 넘긴다 — status 를 직접 쓰지 않는다.
 */
import crypto from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db/index";
import { jsonb, utcDate } from "./db-util";
import { decryptObj, encryptObj } from "./creds-crypto";
import { writeAudit } from "./audit";
import { classifyRunnerBlock, type RunnerBlock } from "./runner-block";
import { classifyAndApply } from "./account-health";
import { finalizePublish } from "./publish/finalize";
// 🔴 수익 행을 쓰는 유일한 함수(계약 P1R3 §5). lib/revenue/** 는 runner-jobs 를 보지 않는다(AC-17 · 방향 한쪽).
import { upsertRevenueRows } from "./revenue/upsert";
import type { RevenueRow } from "./revenue/types";
import type { Block } from "./blocks";
import type { RunnerFleetState } from "./publish/contract";

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const iso = (v: unknown): string | undefined => utcDate(v)?.toISOString() ?? undefined;

/* ─────────────────────────── 어휘 ─────────────────────────── */

/**
 * 계약 P1R2 §2 + P1R3 §2.1(수익 스크랩 3종)·§2.2(`ads.setup_tistory`) — union 확장 2026-09-14.
 *   DESIGN §8.2 의 나머지(publish.naver_clip·brunch·render.video)는 Phase 3.
 */
export type RunnerJobKind =
  | "publish.naver_blog" | "publish.tistory"
  | "session.login" | "session.verify"
  | "verify.post_alive" | "revenue.stats"
  | "revenue.adpost" | "revenue.adfit" | "revenue.clip"
  | "ads.setup_tistory" | "ads.status_blogger";
export const RUNNER_JOB_KINDS: readonly RunnerJobKind[] = [
  "publish.naver_blog", "publish.tistory", "session.login", "session.verify", "verify.post_alive", "revenue.stats",
  "revenue.adpost", "revenue.adfit", "revenue.clip", "ads.setup_tistory", "ads.status_blogger",
];
export function isRunnerJobKind(v: unknown): v is RunnerJobKind { return RUNNER_JOB_KINDS.includes(String(v) as RunnerJobKind); }
/** 수익 스크랩 잡(report 에 `revenueRows` 가 실린다). `revenue.stats` 는 글 통계라 여기 안 든다. */
export const REVENUE_SCRAPE_KINDS: ReadonlySet<string> = new Set(["revenue.adpost", "revenue.adfit", "revenue.clip"]);

/** 우선순위 — 숫자가 작을수록 먼저(계약 §2 «발행 10 > 세션 20 > 통계 50» · DESIGN §8.3 «수익 스크랩 > 렌더»). */
export const JOB_PRIORITY: Readonly<Record<RunnerJobKind, number>> = Object.freeze({
  "publish.naver_blog": 10, "publish.tistory": 10,
  "session.login": 20, "session.verify": 20,
  "ads.setup_tistory": 30, "ads.status_blogger": 30,
  "verify.post_alive": 40,
  "revenue.stats": 50,
  "revenue.adpost": 60, "revenue.adfit": 60, "revenue.clip": 60,
});
export function priorityOf(kind: RunnerJobKind): number { return JOB_PRIORITY[kind] ?? 50; }

/** 채널 → 발행 잡 이름. 러너 채널이 아니면 null. */
export function publishJobKindOf(channel: string): RunnerJobKind | null {
  if (channel === "naver_blog") return "publish.naver_blog";
  if (channel === "tistory") return "publish.tistory";
  return null;
}

/** 잡 상태(스키마 varchar(12)). */
export type RunnerJobStatus = "queued" | "claimed" | "done" | "failed" | "released";

/** 발행 잡 payload(계약 §2 RunnerPayload). 자격은 여기 없다 — claim 때 account 에 실린다. */
export interface RunnerPublishPayload {
  title: string;
  bodyHtml: string;
  blocks: Block[];
  images: { url: string; caption?: string }[];
  tags: string[];
  disclosure: string | null;
  scheduledFor?: string;
  /** 슬롯에서 온 발행이면(실패 종결 때 슬롯을 닫는다). */
  slotId?: number;
  /** 티스토리 카테고리·공개설정 등 채널 옵션. */
  options?: Record<string, unknown>;
}
export type RunnerPayload = RunnerPublishPayload | Record<string, unknown>;

/** claim 응답의 계정 — 🔴 평문 자격이 실리는 유일한 자리. */
export interface RunnerJobAccount {
  id: number;
  handle: string;
  channel: string;
  profileKey: string;
  proxyUrl?: string;
  /** 저장된 세션 쿠키(있으면 로그인 단계를 건너뛴다). */
  cookies?: unknown[];
  /** 자동 로그인용 아이디/비밀번호(쿠키가 없거나 만료됐을 때).
   *   method — 로그인 방식. 티스토리는 «카카오 계정» 경유가 다수라 러너가 길을 갈라야 한다(실측 2026-09-14). */
  login?: { id: string; pw: string; method?: "self" | "kakao" };
}

export interface RunnerJob {
  id: number;
  kind: RunnerJobKind;
  accountId?: number;
  pieceId?: number;
  payload: RunnerPayload;
  account: RunnerJobAccount | null;
  priority: number;
  attempts: number;
}

export interface RunnerDevice {
  id: number; name: string; kind: string;
  status: "online" | "offline";
  lastSeenAt?: string; version?: string;
  jobsWaiting: number;
}

/* ─────────────────────────── 기기·토큰 ─────────────────────────── */

/** 최근 이 시간 안에 하트비트가 있으면 online(계약 §2). */
export const ONLINE_WINDOW_MIN = 5;
/** claim 후 이 시간 무보고면 회수(계약 §1 runner.reap). */
export const STALE_CLAIM_MIN = 15;
/** 실패 재시도 상한(넘으면 awaiting_manual 로 종결 — 무한 재시도 금지). */
export const MAX_ATTEMPTS = 3;

function tokenSecret(): string {
  const s = String(process.env.RUNNER_TOKEN_SECRET ?? "").trim();
  if (!s) throw Object.assign(new Error("RUNNER_TOKEN_SECRET 미설정 — 러너 토큰을 만들 수 없어요."), { code: "RUNNER_TOKEN_SECRET_MISSING" });
  return s;
}
/** 토큰 해시 = HMAC-SHA256(secret, token) hex(64자 · varchar(80) 안). 평문 토큰은 저장하지 않는다. */
export function hashRunnerToken(token: string): string {
  return crypto.createHmac("sha256", tokenSecret()).update(String(token), "utf8").digest("hex");
}
function newRunnerToken(): string { return `acr_${crypto.randomBytes(24).toString("base64url")}`; }

function siteBase(): string {
  return String(process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.SITE_URL || "https://autocreate-endyd.netlify.app").replace(/\/$/, "");
}

export interface RegisteredDevice { device: { id: number; name: string; token: string }; install: { cmd: string; url: string } }

/** 기기 등록 — 토큰 평문은 **이때 1회만** 나간다(다시 볼 수 없다). */
export async function registerDevice(tid: number, name: string, kind = "own"): Promise<RegisteredDevice> {
  const token = newRunnerToken();
  const hash = hashRunnerToken(token);
  const nm = String(name || "내 PC").trim().slice(0, 80);
  const [row] = await q(sql`INSERT INTO runner_devices (tenant_id, name, token_hash, kind, status)
    VALUES (${tid}, ${nm}, ${hash}, ${String(kind || "own").slice(0, 10)}, 'offline') RETURNING id, name`);
  const id = n(row?.id);
  await writeAudit({ tenantId: tid, action: "runner_device_register", actorType: "user", target: `runner_device:${id}`, detail: { name: nm, kind } });
  return {
    device: { id, name: String(row?.name ?? nm), token },
    install: { cmd: `npx ac-runner --token ${token}`, url: `${siteBase()}/runner/install.md` },
  };
}

/** 기기 목록 — status 는 저장값이 아니라 **조회 시 계산**한다(5분 무응답 = offline). */
export async function listDevices(tid: number): Promise<RunnerDevice[]> {
  const rows = await q(sql`
    SELECT d.id, d.name, d.kind, d.last_seen_at, d.version,
           (d.last_seen_at IS NOT NULL AND d.last_seen_at > NOW() - (${ONLINE_WINDOW_MIN} * INTERVAL '1 minute')) AS is_online,
           (SELECT COUNT(*) FROM runner_jobs j WHERE j.tenant_id = d.tenant_id AND j.status = 'queued') AS jobs_waiting
      FROM runner_devices d WHERE d.tenant_id = ${tid} ORDER BY d.id`);
  return rows.map((r) => {
    const o: RunnerDevice = {
      id: n(r.id), name: String(r.name ?? ""), kind: String(r.kind ?? "own"),
      status: r.is_online === true ? "online" : "offline",
      jobsWaiting: n(r.jobs_waiting),
    };
    const s = iso(r.last_seen_at); if (s) o.lastSeenAt = s;
    if (r.version) o.version = String(r.version);
    return o;
  });
}

export async function removeDevice(tid: number, id: number): Promise<boolean> {
  const rows = await q(sql`DELETE FROM runner_devices WHERE tenant_id = ${tid} AND id = ${id} RETURNING id`);
  if (rows.length) await writeAudit({ tenantId: tid, action: "runner_device_remove", actorType: "user", target: `runner_device:${id}` });
  return rows.length > 0;
}

/** 이 테넌트의 러너 상태 — publish() 가 반환에 실어 B 가 awaiting_runner 를 판정한다(조회 중복 0). */
export async function fleetState(tid: number): Promise<RunnerFleetState> {
  const [r] = await q(sql`SELECT COUNT(*) AS devices, MAX(last_seen_at) AS last_seen FROM runner_devices WHERE tenant_id = ${tid}`);
  const devices = n(r?.devices);
  const lastSeenAt = iso(r?.last_seen);
  const out: RunnerFleetState = { online: false, devices };
  if (lastSeenAt) {
    out.lastSeenAt = lastSeenAt;
    const min = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 60000);
    out.offlineMin = Math.max(0, min);
    out.online = min < ONLINE_WINDOW_MIN;
  }
  return out;
}

export interface DeviceRow { id: number; tenantId: number; name: string; kind: string }

/** x-runner-token 헤더 → 기기. 토큰은 해시로만 대조한다. */
export async function authRunner(req: Request): Promise<DeviceRow | null> {
  const token = String(req.headers.get("x-runner-token") ?? "").trim();
  if (!token) return null;
  let hash: string;
  try { hash = hashRunnerToken(token); } catch { return null; }
  const [row] = await q(sql`SELECT id, tenant_id, name, kind FROM runner_devices WHERE token_hash = ${hash} LIMIT 1`);
  if (!row) return null;
  return { id: n(row.id), tenantId: n(row.tenant_id), name: String(row.name ?? ""), kind: String(row.kind ?? "own") };
}

/** 하트비트 — last_seen_at·version 갱신 후 다음 폴링 간격을 알려 준다. */
export async function heartbeat(device: DeviceRow, body: { version?: unknown; jobs?: unknown; canary?: unknown }): Promise<{ sleepSec: number; jobsWaiting: number }> {
  const version = String(body.version ?? "").slice(0, 20) || null;
  await q(sql`UPDATE runner_devices SET last_seen_at = NOW(), status = 'online',
    version = COALESCE(${version}, version) WHERE id = ${device.id}`);
  const [r] = await q(sql`SELECT COUNT(*) AS c FROM runner_jobs WHERE tenant_id = ${device.tenantId} AND status = 'queued' AND (due_at IS NULL OR due_at <= NOW())`);
  const jobsWaiting = n(r?.c);
  /* 카나리 결과(DESIGN §19)는 큐가 아니라 하트비트로 온다 — 셀렉터 변경을 고객보다 먼저 알기 위한 운영 신호다.
     고객 화면·계정 상태는 건드리지 않는다(자사 테스트 계정의 드라이런이므로). */
  if (body.canary && typeof body.canary === "object") {
    const c = body.canary as Record<string, unknown>;
    await writeAudit({
      tenantId: device.tenantId, action: "runner_canary", actorType: "system", target: `runner_device:${device.id}`,
      detail: { ok: c.ok === true, channel: String(c.channel ?? "").slice(0, 24), step: String(c.step ?? "").slice(0, 40), detail: String(c.detail ?? "").slice(0, 200) },
      riskLevel: c.ok === true ? "low" : "high",
    });
  }
  return { sleepSec: jobsWaiting > 0 ? 5 : 60, jobsWaiting };
}

/* ─────────────────────────── 적재 ─────────────────────────── */

export interface EnqueueInput {
  tenantId: number;
  kind: RunnerJobKind;
  accountId?: number | null;
  pieceId?: number | null;
  payload?: RunnerPayload;
  priority?: number;
  /** 이 시각 전에는 안 집어 간다(ISO). */
  dueAt?: string;
  /** 같은 (kind, pieceId|accountId) 로 살아 있는 잡이 있으면 새로 만들지 않고 그 id 를 돌려준다(기본 true). */
  dedupe?: boolean;
}

/** 잡 적재. 🔴 발행 잡은 기본 멱등 — 같은 piece 로 queued/claimed 가 있으면 그 잡을 그대로 쓴다(이중 발행 방지). */
export async function enqueueJob(inp: EnqueueInput): Promise<{ id: number; created: boolean }> {
  const dedupe = inp.dedupe !== false;
  const pieceId = inp.pieceId ? n(inp.pieceId) : null;
  const accountId = inp.accountId ? n(inp.accountId) : null;
  if (dedupe) {
    const rows = pieceId
      ? await q(sql`SELECT id FROM runner_jobs WHERE tenant_id = ${inp.tenantId} AND kind = ${inp.kind} AND piece_id = ${pieceId} AND status IN ('queued','claimed') ORDER BY id LIMIT 1`)
      : accountId
        ? await q(sql`SELECT id FROM runner_jobs WHERE tenant_id = ${inp.tenantId} AND kind = ${inp.kind} AND account_id = ${accountId} AND status IN ('queued','claimed') ORDER BY id LIMIT 1`)
        : [];
    if (rows[0]) return { id: n(rows[0].id), created: false };
  }
  const [row] = await q(sql`
    INSERT INTO runner_jobs (tenant_id, kind, account_id, piece_id, payload, status, priority, due_at)
    VALUES (${inp.tenantId}, ${inp.kind}, ${accountId}, ${pieceId}, ${jsonb(inp.payload ?? {})}, 'queued',
            ${Number.isFinite(Number(inp.priority)) ? Math.floor(Number(inp.priority)) : priorityOf(inp.kind)},
            ${inp.dueAt ? sql`${inp.dueAt}::timestamptz AT TIME ZONE 'UTC'` : null})
    RETURNING id`);
  return { id: n(row?.id), created: true };
}

/* ─────────────────────────── 선점(claim) ─────────────────────────── */

/** 계정 자격 복호화 — 🔴 claim 전용. 반환값은 응답 본문 외 어디에도 쓰지 않는다(로그 금지). */
async function loadAccountForRunner(tid: number, accountId: number): Promise<RunnerJobAccount | null> {
  const [a] = await q(sql`SELECT id, channel, handle, browser_profile_key, proxy_url FROM accounts WHERE tenant_id = ${tid} AND id = ${accountId} LIMIT 1`);
  if (!a) return null;
  const out: RunnerJobAccount = {
    id: n(a.id), handle: String(a.handle ?? ""), channel: String(a.channel ?? ""),
    profileKey: String(a.browser_profile_key || `t${tid}-a${n(a.id)}`),
  };
  if (a.proxy_url) out.proxyUrl = String(a.proxy_url);   // 러너용 원문(마스킹 안 함 — 이 응답 밖으로 나가면 안 된다)
  const creds = await q(sql`SELECT kind, enc, expires_at FROM account_creds
    WHERE account_id = ${accountId} AND purged_at IS NULL AND kind IN ('cookies','password') ORDER BY id DESC`);

  // ① 유효한 쿠키가 있으면 그것만 준다.
  for (const c of creds) {
    if (String(c.kind) !== "cookies" || out.cookies) continue;
    const exp = utcDate(c.expires_at);
    if (exp && exp.getTime() < Date.now()) continue;     // 만료 쿠키는 주지 않는다(러너가 자동 로그인으로 간다)
    const o = decryptObj<{ cookies?: unknown[] }>(String(c.enc ?? ""));
    if (o && Array.isArray(o.cookies) && o.cookies.length) out.cookies = o.cookies;
  }
  /* ② 🔴 쿠키가 유효하면 id/pw 는 **싣지 않는다**(메인 조건 (나) 2026-09-14).
        평문 표면은 «필요할 때만» 열린다 — 세션이 살아 있는데 비밀번호까지 내보낼 이유가 없다. */
  if (!out.cookies) {
    for (const c of creds) {
      if (String(c.kind) !== "password" || out.login) continue;
      const o = decryptObj<{ loginId?: string; password?: string; method?: string }>(String(c.enc ?? ""));
      if (o?.loginId && o?.password) {
        out.login = { id: String(o.loginId), pw: String(o.password) };
        if (o.method === "kakao") out.login.method = "kakao";
      }
    }
  }
  return out;
}

/**
 * claimJobs — 원자 선점(`FOR UPDATE SKIP LOCKED`).
 *   한 문장(CTE + UPDATE … FROM)이라 러너 여러 대가 동시에 집어도 같은 잡을 두 번 가져가지 않는다.
 *   우선순위 오름차순 → id 오름차순(오래된 것 먼저) · 테넌트 스코프는 기기 토큰이 정한다.
 */
export async function claimJobs(device: DeviceRow, kinds: RunnerJobKind[], max = 3): Promise<RunnerJob[]> {
  const want = (kinds.length ? kinds : [...RUNNER_JOB_KINDS]).filter(isRunnerJobKind);
  if (!want.length) return [];
  const lim = Math.min(Math.max(1, Math.floor(Number(max) || 1)), 10);
  const kindList = sql.join(want.map((k) => sql`${k}`), sql`, `);
  const rows = await q(sql`
    WITH picked AS (
      SELECT id FROM runner_jobs
       WHERE tenant_id = ${device.tenantId} AND status = 'queued' AND kind IN (${kindList})
         AND (due_at IS NULL OR due_at <= NOW())
       ORDER BY priority ASC, id ASC
       LIMIT ${lim}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE runner_jobs j
       SET status = 'claimed', claimed_by = ${device.id}, claimed_at = NOW(), attempts = j.attempts + 1, updated_at = NOW()
      FROM picked WHERE j.id = picked.id
    RETURNING j.id, j.kind, j.account_id, j.piece_id, j.payload, j.priority, j.attempts`);

  const jobs: RunnerJob[] = [];
  const servedAccounts: number[] = [];
  for (const r of rows) {
    const accountId = n(r.account_id);
    const job: RunnerJob = {
      id: n(r.id), kind: String(r.kind) as RunnerJobKind,
      payload: (r.payload && typeof r.payload === "object" ? r.payload : {}) as RunnerPayload,
      account: null, priority: n(r.priority), attempts: n(r.attempts),
    };
    if (accountId) job.accountId = accountId;
    if (n(r.piece_id)) job.pieceId = n(r.piece_id);
    if (accountId) {
      job.account = await loadAccountForRunner(device.tenantId, accountId);
      /* 🔴 자격 평문이 실제로 실린 건에 대해서만 **계정 1건당 1행** 감사(메인 조건 (가) 2026-09-14).
            무엇이 나갔는지는 남기지 않는다 — 나갔다는 «사실»과 종류(cookies/login)만. */
      if (job.account && (job.account.cookies || job.account.login)) {
        servedAccounts.push(accountId);
        await writeAudit({
          tenantId: device.tenantId, action: "runner_creds_issued", actorType: "system", target: `account:${accountId}`,
          detail: { deviceId: device.id, jobId: job.id, kind: job.kind, creds: job.account.cookies ? "cookies" : "login" },
          riskLevel: "high",
        });
      }
    }
    jobs.push(job);
  }
  if (jobs.length) {
    await writeAudit({
      tenantId: device.tenantId, action: "runner_jobs_claimed", actorType: "system", target: `runner_device:${device.id}`,
      detail: { jobIds: jobs.map((j) => j.id), accountIds: servedAccounts, kinds: jobs.map((j) => j.kind) },
      riskLevel: "low",
    });
  }
  return jobs;
}

/* ─────────────────────────── 보고(report) ─────────────────────────── */

export interface RunnerReportOk {
  ok: true;
  externalUrl?: string; channelRef?: string;
  stats?: Record<string, unknown>;
  /** 수익 스크랩 잡(계약 P1R3 §2.1) — 서버가 `upsertRevenueRows(tid, rows, "runner")` 로 쓴다. 러너는 DB 를 안 본다. */
  revenueRows?: RevenueRow[];
  /** 애드포스트 «미등록/심사중/승인» 같은 매체 상태(계약 §1.5b · 없으면 키 없음). */
  adpostState?: "none" | "pending" | "approved";
  /** `ads.setup_tistory` — 애드센스 연결 상태 읽기 결과(계약 §2.2 · 변경은 안 한다). */
  adsense?: { linked: boolean; state?: string; detail?: string };
  shotKey?: string;
}
/**
 * 실패 보고. `errorKind` 는 계약 P1R2 §2 의 7종 **또는 `"parse"`**(P1R3 §2.1 — 파싱 실패를 0 으로 채우지 않는다 · AC-9).
 *   🔴 "parse" 는 전이표(`lib/account-health.ts` 7종) **밖**이다 — 계정 문제가 아니라 **우리 버그**(화면이 바뀌었거나 파서가 틀렸다).
 *      계정 전이 0 · 재시도 무의미 · audit high 로 종결한다(전이표에 넣지 않는다 — 표는 B 의 정본).
 */
export interface RunnerReportFail { ok: false; errorKind?: unknown; detail?: string; shotKey?: string }
export type RunnerReportBody = RunnerReportOk | RunnerReportFail;

export interface ReportOutcome { ok: boolean; status: RunnerJobStatus; reason?: string; postId?: number; verified?: "server" | "unverified" | "not_found"; block?: RunnerBlock }

/**
 * 러너 주장을 믿지 않는다(계약 §2 · DESIGN §8.3) — 보고된 URL 을 서버가 직접 확인한다.
 *   found     → 발행 확정(도장 server).
 *   not_found → 404/410 → 확정하지 않는다(awaiting_manual · 사람이 확인).
 *   unknown   → 우리가 못 읽은 것(가용성·iframe 본문) — 발행 «사실»을 뒤집지 않는다(확정하되 unverified 도장).
 *   ⚠️ AM 교훈: 네이버 본문은 iframe 안이라 제목 대조가 실패해도 «없다»고 단정하면 오판이 된다.
 */
async function verifyPublishedUrl(url: string, title?: string | null): Promise<"found" | "not_found" | "unknown"> {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) return "not_found";
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(u, { redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoCreate/1.0)" } });
    if (r.status === 404 || r.status === 410) return "not_found";
    if (!r.ok) return "unknown";
    const body = await r.text();
    if (!body) return "unknown";
    const tt = String(title ?? "").replace(/\s+/g, "").slice(0, 20);
    if (!tt) return "found";
    return body.replace(/\s+/g, "").includes(tt) ? "found" : "unknown";
  } catch { return "unknown"; }
  finally { clearTimeout(t); }
}

/** 계정 전이 신호 기록 — 필드만 쓴다. 전이 로직(B `lib/account-health.ts`)이 있으면 넘겨준다(없으면 graceful). */
async function signalAccountError(tid: number, accountId: number, block: RunnerBlock, pieceId?: number | null): Promise<void> {
  try {
    await q(sql`UPDATE accounts SET last_error_kind = ${block.kind}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${accountId}`);
  } catch (e) { console.error("[runner-jobs] last_error_kind write failed", e); }
  if (block.accountAction === "none") return;
  /* 🔴 전이는 B 의 정본이 한다(정적 배선 · main 192a417 머지 후 2026-09-14).
     실패해도 보고 자체는 성공시킨다 — 전이가 안 됐다고 잡 결과를 잃으면 안 된다. */
  try { await classifyAndApply(accountId, block.kind, { tenantId: tid, detail: block.detail ?? block.message, pieceId }); }
  catch (e) { console.error("[runner-jobs] classifyAndApply failed", e); }
}

async function notify(tid: number, kind: string, title: string, body: string, link?: string): Promise<void> {
  try {
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
      VALUES (${tid}, ${kind.slice(0, 32)}, ${title.slice(0, 160)}, ${body}, ${link ? link.slice(0, 200) : null})`);
  } catch (e) { console.error("[runner-jobs] notify failed", e); }
}

/** 발행 실패 종결 — piece·slot 을 awaiting_manual 로(조용히 0건 금지 · 사람이 직접 올릴 수 있게 남긴다). */
async function failPublishPiece(tid: number, pieceId: number, block: RunnerBlock, shotKey?: string): Promise<void> {
  const [p] = await q(sql`SELECT id, title, slot_id, meta, status FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId} LIMIT 1`);
  if (!p) return;
  if (String(p.status) === "published") return;   // 이미 확정 — 손대지 않는다(멱등)
  const meta = (p.meta && typeof p.meta === "object" ? { ...(p.meta as Record<string, unknown>) } : {}) as Record<string, unknown>;
  meta.publishFail = { errorKind: block.kind, at: new Date().toISOString(), detail: block.detail ?? null, shotKey: shotKey ?? null };
  await q(sql`UPDATE pieces SET status = 'awaiting_manual', meta = ${jsonb(meta)}, updated_at = NOW() WHERE id = ${pieceId}`);
  const slotId = n(p.slot_id);
  if (slotId) await q(sql`UPDATE slots SET status = 'awaiting_manual', note = ${block.message.slice(0, 400)}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${slotId}`);
  await notify(tid, "publish_failed", "글을 올리지 못했어요", `«${String(p.title ?? "").slice(0, 40)}» — ${block.message}`, "/app/posts.html?status=awaiting_manual");
}

/** 러너 보고 반영. 잡이 claimed 가 아니면 무시(이중 report 안전 · 멱등). */
export async function reportJob(device: DeviceRow, jobId: number, result: RunnerReportBody): Promise<ReportOutcome> {
  const [j] = await q(sql`SELECT id, tenant_id, kind, account_id, piece_id, payload, status, attempts FROM runner_jobs
    WHERE id = ${jobId} AND tenant_id = ${device.tenantId} LIMIT 1`);
  if (!j) return { ok: false, status: "failed", reason: "not_found" };
  if (String(j.status) !== "claimed") return { ok: true, status: String(j.status) as RunnerJobStatus, reason: `not_claimed(${String(j.status)})` };

  const tid = n(j.tenant_id);
  const kind = String(j.kind) as RunnerJobKind;
  const pieceId = n(j.piece_id);
  const accountId = n(j.account_id);
  const payload = (j.payload && typeof j.payload === "object" ? j.payload : {}) as Record<string, unknown>;

  /* ── 실패(parse) — 계약 P1R3 §2.1 · 우리 버그 · 계정 전이 0 · 0 으로 채우지 않는다(AC-9) ── */
  if (result.ok !== true && String((result as RunnerReportFail).errorKind) === "parse") {
    const fail = result as RunnerReportFail;
    await q(sql`UPDATE runner_jobs SET status = 'failed', claimed_by = NULL, claimed_at = NULL, error_kind = 'parse',
        result = ${jsonb({ ok: false, errorKind: "parse", detail: String(fail.detail ?? "").slice(0, 300), shotKey: fail.shotKey ?? null, attempts: n(j.attempts) })},
        due_at = NULL, updated_at = NOW() WHERE id = ${jobId}`);
    // 수익 소스 행에 «못 읽었다»를 남긴다(행을 만들지 않는다 · 계약 §0). 소스 행이 없으면 넘어간다.
    const source = kind === "revenue.adpost" ? "adpost" : kind === "revenue.adfit" ? "adfit" : kind === "revenue.clip" ? "clip" : null;
    if (source) {
      await q(sql`UPDATE revenue_sources SET status = 'error', last_error = ${String(fail.detail ?? "파싱 실패").slice(0, 300)}, last_error_kind = 'parse',
        fail_count = fail_count + 1, updated_at = NOW()
        WHERE tenant_id = ${tid} AND source = ${source} ${accountId ? sql`AND account_id = ${accountId}` : sql``}`).catch(() => {});
    }
    await writeAudit({
      tenantId: tid, action: "runner_job_failed", actorType: "system", target: `runner_job:${jobId}`,
      detail: { kind, errorKind: "parse", ourBug: true, shotKey: fail.shotKey ?? null, detail: String(fail.detail ?? "").slice(0, 200) },
      riskLevel: "high",
    });
    return { ok: true, status: "failed", reason: "parse" };
  }

  /* ── 실패 ───────────────────────────────────────────────── */
  if (result.ok !== true) {
    const fail = result as RunnerReportFail;
    const block = classifyRunnerBlock(fail.errorKind, fail.detail);
    const attempts = n(j.attempts);
    const canRetry = block.retryable && attempts < MAX_ATTEMPTS;
    await q(sql`UPDATE runner_jobs SET status = ${canRetry ? "queued" : "failed"},
        claimed_by = NULL, claimed_at = NULL, error_kind = ${block.kind},
        result = ${jsonb({ ok: false, errorKind: block.kind, detail: block.detail ?? null, shotKey: fail.shotKey ?? null, attempts })},
        due_at = ${canRetry ? sql`NOW() + (${Math.min(30, attempts * 5)} * INTERVAL '1 minute')` : sql`NULL`},
        updated_at = NOW() WHERE id = ${jobId}`);
    if (accountId) await signalAccountError(tid, accountId, block, pieceId || null);
    if (!canRetry && kind.startsWith("publish.") && pieceId) await failPublishPiece(tid, pieceId, block, fail.shotKey);
    if (!canRetry && block.needsHuman && accountId && !kind.startsWith("publish.")) {
      await notify(tid, "account_relogin", "계정 확인이 필요해요", block.message, "/app/accounts.html");
    }
    await writeAudit({
      tenantId: tid, action: "runner_job_failed", actorType: "system", target: `runner_job:${jobId}`,
      detail: { kind, errorKind: block.kind, attempts, retry: canRetry, shotKey: fail.shotKey ?? null, ourBug: block.ourBug },
      riskLevel: block.ourBug ? "high" : "low",
    });
    return { ok: true, status: canRetry ? "queued" : "failed", block };
  }

  /* ── 성공 ───────────────────────────────────────────────── */
  const okBody = result as RunnerReportOk;
  const externalUrl = okBody.externalUrl ? String(okBody.externalUrl).slice(0, 300) : undefined;
  const channelRef = okBody.channelRef ? String(okBody.channelRef).slice(0, 160) : undefined;

  if (kind.startsWith("publish.")) {
    if (!externalUrl) {
      // 성공이라는데 글 주소가 없다 = 확정할 수 없다(정직).
      const block = classifyRunnerBlock("unknown", "내 PC 프로그램이 성공을 알렸지만 글 주소를 싣지 않았어요.");
      await q(sql`UPDATE runner_jobs SET status='failed', claimed_by=NULL, claimed_at=NULL, error_kind='unknown',
        result = ${jsonb({ ok: false, detail: "no_external_url" })}, updated_at = NOW() WHERE id = ${jobId}`);
      if (pieceId) await failPublishPiece(tid, pieceId, block);
      return { ok: true, status: "failed", reason: "no_external_url", block };
    }
    const title = String(payload.title ?? "");
    const v = await verifyPublishedUrl(externalUrl, title);
    if (v === "not_found") {
      const block = classifyRunnerBlock("unknown", `올렸다는 주소에서 글을 찾지 못했어요(${externalUrl.slice(0, 80)}).`);
      await q(sql`UPDATE runner_jobs SET status='failed', claimed_by=NULL, claimed_at=NULL, error_kind='unknown',
        result = ${jsonb({ ok: false, detail: "verify_not_found", externalUrl })}, updated_at = NOW() WHERE id = ${jobId}`);
      if (pieceId) await failPublishPiece(tid, pieceId, block);
      return { ok: true, status: "failed", reason: "verify_not_found", verified: "not_found", block };
    }
    const verified: "server" | "unverified" = v === "found" ? "server" : "unverified";
    const fin = await finalizePublish(pieceId, {
      via: "runner", externalUrl, tenantId: tid,
      ...(channelRef ? { channelRef } : {}),
      ...(accountId ? { accountId } : {}),
    });
    await q(sql`UPDATE runner_jobs SET status='done', error_kind = NULL,
      result = ${jsonb({ ok: true, externalUrl, channelRef: channelRef ?? null, verified })}, updated_at = NOW() WHERE id = ${jobId}`);
    if (!fin.ok) {
      console.error("[runner-jobs] finalizePublish failed", fin.reason, fin.detail ?? "");
      return { ok: false, status: "done", reason: fin.reason, verified };
    }
    return { ok: true, status: "done", postId: fin.postId, verified };
  }

  /* ── 수익 스크랩 잡(P1R3 §2.1) — 🔴 DB 쓰기는 `upsertRevenueRows` 하나뿐(§5). 행이 0개면 «없음»이지 «0원»이 아니다. ── */
  if (REVENUE_SCRAPE_KINDS.has(kind)) {
    const source = kind === "revenue.adpost" ? "adpost" : kind === "revenue.adfit" ? "adfit" : "clip";
    const rows = Array.isArray(okBody.revenueRows) ? okBody.revenueRows : [];
    // 러너가 accountId 를 안 실었으면 잡의 계정으로 귀속한다(러너는 자기 계정 id 를 잡에서 받는다).
    const stamped = rows.map((r) => ({ ...r, source: r.source || source, ...(accountId && !r.accountId ? { accountId } : {}) }));
    const up = stamped.length ? await upsertRevenueRows(tid, stamped, "runner") : { written: 0, rejected: 0, rejectedReasons: [] as string[] };
    // 소스 행 갱신 — 성공(행 0개여도 «읽긴 읽었다»는 성공이다 · 애드포스트 미등록이 그 예).
    await q(sql`UPDATE revenue_sources SET status = 'connected', last_sync_at = NOW(), last_ok_at = NOW(), last_error = NULL, last_error_kind = NULL, fail_count = 0,
        ${okBody.adpostState ? sql`config = config || ${jsonb({ adpostState: okBody.adpostState })},` : sql``} updated_at = NOW()
      WHERE tenant_id = ${tid} AND source = ${source} ${accountId ? sql`AND account_id = ${accountId}` : sql``}`).catch(() => {});
    // 계정의 매체 상태(계약 §1.5b · monetize.adpostState) — 화면이 «미등록/심사중/승인»을 그리는 값.
    if (okBody.adpostState && accountId) {
      await q(sql`UPDATE accounts SET monetize = monetize || ${jsonb({ adpostState: okBody.adpostState, adpostCheckedAt: new Date().toISOString() })}, updated_at = NOW()
        WHERE tenant_id = ${tid} AND id = ${accountId}`).catch(() => {});
    }
    await q(sql`UPDATE runner_jobs SET status='done', error_kind = NULL,
      result = ${jsonb({ ok: true, rows: stamped.length, written: up.written, rejected: up.rejected, rejectedReasons: up.rejectedReasons, adpostState: okBody.adpostState ?? null, shotKey: okBody.shotKey ?? null })},
      updated_at = NOW() WHERE id = ${jobId}`);
    if (up.rejected) {
      await writeAudit({ tenantId: tid, action: "revenue_rows_rejected", actorType: "system", target: `runner_job:${jobId}`,
        detail: { kind, rejected: up.rejected, reasons: up.rejectedReasons }, riskLevel: "medium" });
    }
    return { ok: true, status: "done", reason: `rows=${stamped.length} written=${up.written} rejected=${up.rejected}` };
  }

  /* ── 애드센스 연결 상태 읽기(P1R3 §2.2 · 읽기만) ── */
  if (kind === "ads.setup_tistory" || kind === "ads.status_blogger") {
    if (okBody.adsense && accountId) {
      await q(sql`UPDATE accounts SET monetize = monetize || ${jsonb({ adsenseLinked: !!okBody.adsense.linked, adsenseState: okBody.adsense.state ?? null, adsenseCheckedAt: new Date().toISOString() })}, updated_at = NOW()
        WHERE tenant_id = ${tid} AND id = ${accountId}`).catch(() => {});
    }
    await q(sql`UPDATE runner_jobs SET status='done', error_kind = NULL,
      result = ${jsonb({ ok: true, adsense: okBody.adsense ?? null, shotKey: okBody.shotKey ?? null })}, updated_at = NOW() WHERE id = ${jobId}`);
    return { ok: true, status: "done" };
  }

  // 통계·생존 확인 잡 — posts.stats 에 병합(read→merge→write · jsonb 부분갱신 금지).
  if ((kind === "verify.post_alive" || kind === "revenue.stats") && okBody.stats) {
    const postId = n(payload.postId);
    if (postId) {
      const [p] = await q(sql`SELECT stats FROM posts WHERE tenant_id = ${tid} AND id = ${postId} LIMIT 1`);
      const cur = (p?.stats && typeof p.stats === "object" ? { ...(p.stats as Record<string, unknown>) } : {}) as Record<string, unknown>;
      const merged = { ...cur, ...okBody.stats, lastSyncAt: new Date().toISOString() };
      await q(sql`UPDATE posts SET stats = ${jsonb(merged)} WHERE tenant_id = ${tid} AND id = ${postId}`);
    }
  }
  await q(sql`UPDATE runner_jobs SET status='done', error_kind = NULL,
    result = ${jsonb({ ok: true, ...(externalUrl ? { externalUrl } : {}), ...(okBody.stats ? { stats: okBody.stats } : {}) })},
    updated_at = NOW() WHERE id = ${jobId}`);
  return { ok: true, status: "done" };
}

/** 되돌림 — 러너가 «못 하겠다»고 놓을 때(attempts 는 claim 에서 이미 올랐다). */
export async function releaseJob(device: DeviceRow, jobId: number, reason?: string): Promise<{ ok: boolean }> {
  const rows = await q(sql`UPDATE runner_jobs SET status = 'queued', claimed_by = NULL, claimed_at = NULL,
      result = ${jsonb({ released: String(reason ?? "").slice(0, 200) })}, updated_at = NOW()
    WHERE id = ${jobId} AND tenant_id = ${device.tenantId} AND status = 'claimed' RETURNING id`);
  return { ok: rows.length > 0 };
}

/**
 * reapStaleJobs — claim 후 무보고 잡 회수(계약 §1 `runner.reap` 5분 스텝에서 B 가 호출).
 *   전 테넌트 대상(크론) · 시도 상한을 넘긴 건은 failed 로 종결하고 발행 잡이면 awaiting_manual 로 남긴다.
 */
export async function reapStaleJobs(staleMin = STALE_CLAIM_MIN): Promise<{ released: number; failed: number }> {
  const stale = await q(sql`SELECT id, tenant_id, kind, piece_id, attempts FROM runner_jobs
    WHERE status = 'claimed' AND claimed_at IS NOT NULL AND claimed_at < NOW() - (${Math.max(1, Math.floor(staleMin))} * INTERVAL '1 minute')`);
  let released = 0, failed = 0;
  for (const j of stale) {
    const id = n(j.id), tid = n(j.tenant_id), attempts = n(j.attempts);
    if (attempts < MAX_ATTEMPTS) {
      await q(sql`UPDATE runner_jobs SET status='queued', claimed_by=NULL, claimed_at=NULL, updated_at=NOW() WHERE id = ${id} AND status='claimed'`);
      released++;
    } else {
      await q(sql`UPDATE runner_jobs SET status='failed', claimed_by=NULL, claimed_at=NULL, error_kind='unknown',
        result = ${jsonb({ ok: false, detail: "reaped_no_report" })}, updated_at=NOW() WHERE id = ${id} AND status='claimed'`);
      failed++;
      if (String(j.kind).startsWith("publish.") && n(j.piece_id)) {
        await failPublishPiece(tid, n(j.piece_id), classifyRunnerBlock("network", "내 PC 프로그램이 글을 올리다 응답이 끊겼어요."));
      }
    }
  }
  if (released || failed) await writeAudit({ tenantId: null, action: "runner_reap", actorType: "system", detail: { released, failed, staleMin }, riskLevel: "low" });
  return { released, failed };
}

/* ─────────────────────────── 세션 업로드 ─────────────────────────── */

/** 헤드풀 로그인 결과 저장 — 쿠키는 암호화해 `account_creds(kind 'cookies')` 로. 계정은 active 승격. */
export async function saveRunnerSession(device: DeviceRow, accountId: number, cookies: unknown[], verifiedAt?: string): Promise<{ ok: boolean; reason?: string }> {
  const [a] = await q(sql`SELECT id FROM accounts WHERE tenant_id = ${device.tenantId} AND id = ${accountId} LIMIT 1`);
  if (!a) return { ok: false, reason: "not_found" };
  if (!Array.isArray(cookies) || !cookies.length) return { ok: false, reason: "empty" };
  const enc = encryptObj({ cookies });
  // 가장 이른 쿠키 만료를 expires_at 으로(없으면 30일).
  const exps = cookies.map((c) => Number((c as Record<string, unknown>)?.expires ?? 0)).filter((x) => Number.isFinite(x) && x > 0);
  const expMs = exps.length ? Math.min(...exps) * 1000 : Date.now() + 30 * 86400_000;
  const expIso = new Date(expMs).toISOString();
  await q(sql`UPDATE account_creds SET purged_at = NOW() WHERE account_id = ${accountId} AND kind = 'cookies' AND purged_at IS NULL`);
  await q(sql`INSERT INTO account_creds (tenant_id, account_id, kind, enc, expires_at, verified_at)
    VALUES (${device.tenantId}, ${accountId}, 'cookies', ${enc}, ${expIso}::timestamptz AT TIME ZONE 'UTC',
            ${verifiedAt ? sql`${verifiedAt}::timestamptz AT TIME ZONE 'UTC'` : sql`NOW()`})`);
  await q(sql`UPDATE accounts SET status = 'active', last_error_kind = NULL, updated_at = NOW() WHERE tenant_id = ${device.tenantId} AND id = ${accountId}`);
  // 이 계정의 대기 중 session.* 잡을 닫는다(화면 폴링이 done 을 본다).
  await q(sql`UPDATE runner_jobs SET status='done', result = ${jsonb({ ok: true, via: "session_upload" })}, updated_at = NOW()
    WHERE tenant_id = ${device.tenantId} AND account_id = ${accountId} AND kind IN ('session.login','session.verify') AND status IN ('queued','claimed')`);
  await writeAudit({
    tenantId: device.tenantId, action: "runner_session_saved", actorType: "system", target: `account:${accountId}`,
    detail: { deviceId: device.id, cookies: cookies.length, expiresAt: expIso }, riskLevel: "medium",
  });
  await notify(device.tenantId, "account_ready", "계정 로그인이 끝났어요", "이제 예약된 글이 자동으로 올라갑니다.", "/app/accounts.html");
  return { ok: true };
}

/* ─────────────────────── 다시 로그인(계약 §6B) ─────────────────────── */

/** job.status 매핑: queued→queued · claimed→running · done→done · failed/released→failed. */
export type ReloginJobStatus = "queued" | "running" | "done" | "failed";
export interface ReloginJob { id: number; status: ReloginJobStatus; updatedAt?: string }
export function toReloginStatus(dbStatus: string): ReloginJobStatus {
  if (dbStatus === "queued") return "queued";
  if (dbStatus === "claimed") return "running";
  if (dbStatus === "done") return "done";
  return "failed";
}
export async function latestSessionJob(tid: number, accountId: number): Promise<ReloginJob | null> {
  const [r] = await q(sql`SELECT id, status, updated_at FROM runner_jobs
    WHERE tenant_id = ${tid} AND account_id = ${accountId} AND kind IN ('session.login','session.verify')
    ORDER BY id DESC LIMIT 1`);
  if (!r) return null;
  const o: ReloginJob = { id: n(r.id), status: toReloginStatus(String(r.status)) };
  const u = iso(r.updated_at); if (u) o.updatedAt = u;
  return o;
}
