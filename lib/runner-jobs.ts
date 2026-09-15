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
import { jobKindOf as registryJobKindOf } from "./channel-registry";   // [P1R8 §5.2] 러너 잡 이름 정본(순수 리프 · 순환 0)
import crypto from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db/index";
import { jsonb, utcDate } from "./db-util";
import { decryptObj, encryptObj } from "./creds-crypto";
import { writeAudit } from "./audit";
import { pieceLink } from "./manual-upload";
import { publicBase } from "./site-url";
import { classifyRunnerBlock, type RunnerBlock } from "./runner-block";
import { classifyAndApply } from "./account-health";
import { finalizePublish } from "./publish/finalize";
// 🔴 수익 행을 쓰는 유일한 함수(계약 P1R3 §5). lib/revenue/** 는 runner-jobs 를 보지 않는다(AC-17 · 방향 한쪽).
import { upsertRevenueRows } from "./revenue/upsert";
import { r2Head, r2Configured, r2PresignGet, r2PresignPut, safeKey } from "./r2";
// 배포판 정보(R2 latest.json)는 한 파일에서만 읽는다 — 하트비트·다운로드가 같은 판을 말해야 한다.
import { updateOfferFor, type RunnerUpdateOffer } from "./runner-release";
import type { RenderPayload, RenderReport } from "./video/types";
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
  // [R8 §3 · DESIGN §5E] 🔴 올린 글을 **내린다** — 고객이 «내려 줘»를 눌렀을 때만(우리가 임의로 부르지 않는다).
  | "publish.retract"
  | "revenue.adpost" | "revenue.adfit" | "revenue.clip"
  | "ads.setup_tistory" | "ads.status_blogger"
  | "ads.setup_blogger" | "ads.revert_blogger"
  // P1R5 §0.2 — 영상: 렌더(러너가 굽는다) · 유튜브 쇼츠 · 네이버 클립(스텁).
  | "render.video" | "publish.youtube_shorts" | "publish.naver_clip";
export const RUNNER_JOB_KINDS: readonly RunnerJobKind[] = [
  "publish.naver_blog", "publish.tistory", "session.login", "session.verify", "verify.post_alive", "revenue.stats", "publish.retract",
  "revenue.adpost", "revenue.adfit", "revenue.clip", "ads.setup_tistory", "ads.status_blogger",
  "ads.setup_blogger", "ads.revert_blogger",
  "render.video", "publish.youtube_shorts", "publish.naver_clip",
];
export function isRunnerJobKind(v: unknown): v is RunnerJobKind { return RUNNER_JOB_KINDS.includes(String(v) as RunnerJobKind); }
/** 수익 스크랩 잡(report 에 `revenueRows` 가 실린다). `revenue.stats` 는 글 통계라 여기 안 든다. */
export const REVENUE_SCRAPE_KINDS: ReadonlySet<string> = new Set(["revenue.adpost", "revenue.adfit", "revenue.clip"]);

/** 우선순위 — 숫자가 작을수록 먼저(계약 §2 «발행 10 > 세션 20 > 통계 50» · DESIGN §8.3 «수익 스크랩 > 렌더»). */
export const JOB_PRIORITY: Readonly<Record<RunnerJobKind, number>> = Object.freeze({
  "publish.naver_blog": 10, "publish.tistory": 10,
  /* 🔴 내리기는 **발행보다 먼저**다(5). 잘못 나간 글이 떠 있는 시간을 줄이는 게 새 글을 올리는 것보다 급하다. */
  "publish.retract": 5,
  // P1R5 §0.2 «발행 > 세션 > 수익 > 렌더» — 렌더는 오래 걸리므로 가장 뒤(70).
  "publish.youtube_shorts": 10, "publish.naver_clip": 10,
  "render.video": 70,
  "session.login": 20, "session.verify": 20,
  "ads.setup_tistory": 30, "ads.status_blogger": 30,
  "ads.setup_blogger": 30, "ads.revert_blogger": 30,
  "verify.post_alive": 40,
  "revenue.stats": 50,
  "revenue.adpost": 60, "revenue.adfit": 60, "revenue.clip": 60,
});
export function priorityOf(kind: RunnerJobKind): number { return JOB_PRIORITY[kind] ?? 50; }

/** 채널 → 발행 잡 이름. 러너 채널이 아니면 null. */
export function publishJobKindOf(channel: string): RunnerJobKind | null {
  /* [P1R8 §5.2] 🔴 채널 목록을 여기서 또 적지 않는다 — 정본은 `lib/channel-registry.ts CHANNELS` 의 `jobKind` 칸이다.
     예전엔 이 함수가 채널 이름을 직접 나열해서, 채널 하나를 켤 때 맞춰야 할 자리가 네 곳이었다(그 파일 헤더에 실측 근거).
     표의 값이 우리 잡 이름 목록(`RunnerJobKind`)에 없는 글자면 **null** 이다 — 모르는 잡 이름을 만들어 내지 않는다.
     (네이버 클립은 표에 `publish.naver_clip` 이 있고, 실제 러너 채널은 스텁이라 정직하게 막힌다 · §2.3.) */
  const kind = registryJobKindOf(channel);
  return kind && (PUBLISH_JOB_KINDS as readonly string[]).includes(kind) ? (kind as RunnerJobKind) : null;
}
/** 발행 잡 이름 화이트리스트 — 표의 글자가 이 중 하나일 때만 잡을 만든다(오타·새 채널의 임시값 차단). */
const PUBLISH_JOB_KINDS = ["publish.naver_blog", "publish.tistory", "publish.naver_clip"] as const;

/** 잡 상태(스키마 varchar(12)). */
export type RunnerJobStatus = "queued" | "claimed" | "done" | "failed" | "released";

/** 발행 잡 payload(계약 §2 RunnerPayload). 자격은 여기 없다 — claim 때 account 에 실린다. */
export interface RunnerPublishPayload {
  title: string;
  bodyHtml: string;
  blocks: Block[];
  /** caption = 독자가 보는 한 줄(대부분 없다) · alt = 안 보이는 접근성 설명(§5C · B-1 84a2372). 둘은 다른 칸이다. */
  images: { url: string; caption?: string; alt?: string }[];
  tags: string[];
  disclosure: string | null;
  scheduledFor?: string;
  /** 슬롯에서 온 발행이면(실패 종결 때 슬롯을 닫는다). */
  slotId?: number;
  /** 티스토리 카테고리·공개설정 등 채널 옵션. */
  options?: Record<string, unknown>;
}
/* ─────────────────────────── 영상 렌더(P1R5 §2.1) ───────────────────────────
 *   🔴 러너는 **payload 만 보고 굽는다**(서버에 다시 묻지 않는다).
 *      `clipKey`/`imageKey`/`audio.*.key` 는 claim 시 서버가 **presigned GET URL 로 치환해** 내려준다 —
 *      러너에 R2 자격을 주지 않는다(자격 표면 2곳 규칙 · CLAUDE §4.7).
 *   결과 mp4 는 `upload` 의 presigned PUT 으로 러너가 직접 올린다(함수 본문 6MB 벽 우회).
 */
/**
 * 러너에게 **실제로 내려가는** 모양 — B 의 `RenderPayload`(lib/video/types.ts 정본)에 presigned `upload` 가 채워진 상태.
 *   🔴 타입을 여기서 다시 정의하지 않는다. 두 벌이 되면 B 가 보내는 모양과 러너가 기대하는 모양이 **조용히 갈라진다**
 *      (같은 사고를 `PublishFailReason` 이중 정의에서 이미 봤다). 정본은 `lib/video/types.ts` 한 곳.
 */
export type RunnerRenderPayload = RenderPayload & { upload: NonNullable<RenderPayload["upload"]> };
/** 러너가 렌더를 마치고 싣는 결과 = B-1 `RenderReport` 그대로. 🔴 서버는 이 주장을 믿지 않고 **R2 HEAD 로 실존 확인** 후에만 성공 처리한다. */
export type RunnerRenderResult = RenderReport;
export const RENDER_ERROR_KINDS: ReadonlySet<string> = new Set(["ffmpeg_missing", "font_missing", "clip_fetch", "encode", "upload"]);

export type RunnerPayload = RunnerPublishPayload | RunnerRenderPayload | Record<string, unknown>;

/** claim 응답의 계정 — 🔴 평문 자격이 실리는 유일한 자리. */
export interface RunnerJobAccount {
  id: number;
  handle: string;
  channel: string;
  profileKey: string;
  proxyUrl?: string;
  /** 이 프록시의 기대 출구 IP — 러너가 실측 IP 와 다르면 발행을 멈춘다(계약 §2.5-4). */
  expectExitIp?: string;
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
  /** 이 기기가 «내 PC» 로 묶였나(처음 켠 PC 가 정해졌나). 화면이 «열쇠 다시 받기» 를 권할지 판단한다. */
  bound?: boolean;
  /** 다른 PC 에서 이 토큰으로 접속을 시도한 마지막 시각·횟수(계약 «묶기» ②).
   *  🔴 **지문 값 자체는 절대 내보내지 않는다** — 화면이 알아야 할 것은 «있었나/몇 번»뿐이다. */
  otherDeviceAt?: string; otherDeviceCount?: number;
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

/* 🔴 여기서 만드는 주소는 고객에게 **주고 남는다**(설치 안내에 박히고, 고객이 복사해 둔다) → 정본 우선 `publicBase()`.
   종전엔 `URL` 을 먼저 봐서 **배포 프리뷰에서 등록하면 며칠 뒤 죽는 주소**가 안내에 박혔다.
   자기 호출용 `backgroundBase()`(이 배포)와 **일부러 다른 함수**다 — 하나로 합치면 둘 중 하나가 반드시 틀린다(AC-53). */
const siteBase = publicBase;

export interface RegisteredDevice {
  device: { id: number; name: string; token: string };
  /** 화면이 그대로 그릴 수 있는 설치 안내. `token` 은 여기서도 1회만 나간다(다시 볼 수 없다). */
  install: { cmd: string; url: string; token: string; steps: string[] };
}

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
    /* 🔴 2026-09-15 실측(사장님): 여기 있던 안내가 **둘 다 가짜였다** —
       `${siteBase()}/runner/install.md` 는 404(`runner/` 는 `public/` 밖이라 Netlify 가 서빙하지 않는다),
       `npx ac-runner` 는 **존재하지 않는 npm 패키지**. 즉 고객은 러너를 받을 길이 자체가 없었다.
       이제 zip 을 우리가 만들어 R2 에 올리고(`scripts/build-runner.mts`), 로그인·플랜을 통과한 사람에게만
       `/api/runner-download` 가 10분짜리 링크로 내준다. 안내 문구도 «받은 걸 실행하는» 실제 순서로 바꾼다. */
    install: {
      cmd: `run.bat (Windows) · ./run.sh (Mac·Linux)`,
      url: `${siteBase()}/api/runner-download`,
      token,
      // 🔴 낱말은 **화면을 따른다**(runner.html 은 «열쇠»라고 한다). 서버·안내문·화면이 다른 말을 쓰면
      //    고객은 세 낱말을 각각 배워야 한다 — 안내가 갈리는 데서 «어디에 넣으라는 거지»가 나온다.
      steps: ["내려받은 zip 을 압축 풀기", "run.bat 두 번 클릭(Mac·Linux 는 ./run.sh)", "열쇠 붙여넣기"],
    },
  };
}

/** 기기 목록 — status 는 저장값이 아니라 **조회 시 계산**한다(5분 무응답 = offline). */
export async function listDevices(tid: number): Promise<RunnerDevice[]> {
  const rows = await q(sql`
    SELECT d.id, d.name, d.kind, d.last_seen_at, d.version,
           (d.fingerprint IS NOT NULL) AS bound, d.fp_mismatch_at, d.fp_mismatch_count,
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
    if (r.bound === true) o.bound = true;
    /* 🔴 «없음»과 «0번»을 구분해서 보낸다 — 시도가 있었던 기기만 화면에 경고가 뜨게(AC-9 3값 규율의 같은 정신).
       횟수만 0으로 늘 보내면 화면이 «0번 있었어요» 같은 말을 하게 되거나, 조건을 화면이 또 짜야 한다. */
    const fp = iso(r.fp_mismatch_at);
    if (fp) { o.otherDeviceAt = fp; o.otherDeviceCount = n(r.fp_mismatch_count); }
    return o;
  });
}

/**
 * 토큰 재발급(계약 «묶기» ③) — 기기는 그대로 두고 **열쇠만 바꾼다.**
 *   쓰는 자리 둘: ①PC 를 바꿨다(지문이 묶여 있어 새 PC 가 거절당한다) ②토큰이 새어 나간 것 같다.
 *   🔴 옛 토큰은 **이 순간 죽는다**(token_hash 를 덮어쓴다) — 돌아다니던 복사본은 다음 요청에서 401 이다.
 *   🔴 지문도 함께 지운다. 안 지우면 새 토큰을 받아도 **옛 PC 에 묶인 채**라 새 PC 가 또 거절당한다
 *      («재발급했는데 그대로예요» 가 여기서 나온다).
 */
export async function rotateDeviceToken(tid: number, id: number): Promise<{ id: number; name: string; token: string } | null> {
  const token = newRunnerToken();
  const [row] = await q(sql`UPDATE runner_devices
    SET token_hash = ${hashRunnerToken(token)}, fingerprint = NULL, fingerprint_at = NULL,
        fp_mismatch_at = NULL, fp_mismatch_count = 0, status = 'offline'
    WHERE tenant_id = ${tid} AND id = ${id} RETURNING id, name`);
  if (!row) return null;
  await writeAudit({
    tenantId: tid, action: "runner_token_rotate", actorType: "user", target: `runner_device:${id}`,
    detail: { name: String(row.name ?? "") }, riskLevel: "medium",   // 평문 토큰은 감사에 남기지 않는다
  });
  return { id: n(row.id), name: String(row.name ?? ""), token };
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
export type RunnerAuth =
  | { ok: true; device: DeviceRow }
  | { ok: false; reason: "no_token" | "bad_token" | "other_device"; message: string };

/**
 * 🔴 **기기 묶기(계약 «묶기» ②)를 여기서 한다** — 하트비트가 아니라 **인증 자리**다(AC-35).
 *    하트비트에서만 보면 복사본은 하트비트를 건너뛰고 `claim` 만 때리면 그만이다. 관문은 모든 문에 있어야 관문이다.
 *    · 지문이 아직 없으면(처음 켠 기기 · 이 기능 이전부터 쓰던 기기) **처음 온 값을 그대로 묶는다** —
 *      쓰던 사람이 업데이트 하나로 갑자기 못 쓰게 되는 일은 만들지 않는다.
 *    · 이미 묶인 값과 다르면 거절하고 횟수를 센다(알림 문구는 호출부가 — 여기선 DB 를 한 번만 만진다).
 *    · `kind='managed'`(우리 팜)은 묶지 않는다 — 우리가 옮기고 다시 띄우는 기계라 지문이 정당하게 바뀐다.
 *    · 🔴 **지문 없는 요청은 «이미 묶인 기기»면 거절한다**(R8 §3.1 · 2026-09-15).
 *      종전엔 «안 보내면 검사하지 않는다 — 다 올라온 뒤에 조여도 늦지 않다»였는데, 그 문이 **닫히지 않았다**:
 *      토큰을 복사한 사람이 헤더를 빼기만 하면 구속을 피하고, 그 토큰으로 claim 하면 자격이 평문으로 나간다.
 *      **아직 안 묶인 기기**(지문 이전 판)는 종전대로 통과 — 쓰던 사람이 업데이트 하나로 멈추지 않게.
 */
export async function authRunner(req: Request): Promise<RunnerAuth> {
  const token = String(req.headers.get("x-runner-token") ?? "").trim();
  if (!token) return { ok: false, reason: "no_token", message: "러너 열쇠가 올바르지 않아요." };
  let hash: string;
  try { hash = hashRunnerToken(token); } catch { return { ok: false, reason: "bad_token", message: "러너 열쇠가 올바르지 않아요." }; }
  const [row] = await q(sql`SELECT id, tenant_id, name, kind, fingerprint FROM runner_devices WHERE token_hash = ${hash} LIMIT 1`);
  if (!row) return { ok: false, reason: "bad_token", message: "러너 열쇠가 올바르지 않아요. 앱에서 기기를 다시 등록해 주세요." };

  const device: DeviceRow = { id: n(row.id), tenantId: n(row.tenant_id), name: String(row.name ?? ""), kind: String(row.kind ?? "own") };
  if (device.kind === "managed") return { ok: true, device };          // 우리 팜 — 옮겨 다니는 기계라 안 묶는다

  const d = classifyFpBinding(String(row.fingerprint ?? ""), req.headers.get("x-runner-fp"));
  switch (d.action) {
    case "pass": return { ok: true, device };
    case "bind":
      await q(sql`UPDATE runner_devices SET fingerprint = ${d.fp}, fingerprint_at = NOW() WHERE id = ${device.id} AND fingerprint IS NULL`);
      return { ok: true, device };
    case "refuse_missing":
      await q(sql`UPDATE runner_devices SET fp_mismatch_at = NOW(), fp_mismatch_count = fp_mismatch_count + 1 WHERE id = ${device.id}`);
      // 🔴 거절은 조용하면 안 된다 — 진짜 복제 시도면 이 기록이 **유일한 신호**다(메인 지시).
      await writeAudit({
        tenantId: device.tenantId, action: "runner_fp_missing", actorType: "system",
        target: `runner_device:${device.id}`, detail: { name: device.name, fpState: d.fpState }, riskLevel: "high",
      });
      return { ok: false, reason: "other_device", message: d.message };
    case "refuse_other":
      await q(sql`UPDATE runner_devices SET fp_mismatch_at = NOW(), fp_mismatch_count = fp_mismatch_count + 1 WHERE id = ${device.id}`);
      await onOtherDevice(device);
      return { ok: false, reason: "other_device", message: d.message };
  }
}

/** 지문 헤더의 상태 — 🔴 «아예 없음»과 «형식이 틀림»을 **가른다**(메인 지시 2026-09-15).
    뭉쳐 두면 나중에 지문 형식만 바뀌었을 때(해시 길이 변경 등) 원인을 못 찾는다 — 둘은 전혀 다른 사건이다. */
export type FpState = "ok" | "absent" | "malformed";
export type FpDecision =
  | { action: "pass"; fpState: FpState }
  | { action: "bind"; fpState: "ok"; fp: string }
  | { action: "refuse_missing"; fpState: "absent" | "malformed"; message: string }
  | { action: "refuse_other"; fpState: "ok"; message: string };

/**
 * classifyFpBinding — «이 요청을 받아 줄 것인가»를 **순수하게** 가른다(R8 §3.1 · 2026-09-15).
 *
 *   🔴 **호환을 위해 열어 둔 문이 닫히지 않고 있었다.** 종전 한 줄:
 *        `if (managed || !/^[0-9a-f]{64}$/.test(fp)) return { ok: true, device }`
 *      «지문을 안 보내면 **구속을 통째로 건너뛴다**»는 뜻이었다. 그래서 `.token` 을 복사한 사람이
 *      **헤더를 빼기만 하면** 묶임을 피했고, 그 토큰으로 `claim` 하면 서버가 **계정 자격을 평문으로** 내려 준다
 *      (설계상 평문 표면 2곳 중 하나). 즉 세션 파일이 암호화돼 있어도 **토큰 하나면 새 세션을 받아 간다.**
 *
 *   이제: **이미 묶인 기기**는 지문 없는 요청을 거절한다(v1.1.x 러너는 모든 요청에 싣는다 — 안 싣는 건 우리 러너가 아니다).
 *        **아직 안 묶인 기기**(지문 이전 판)는 종전대로 통과 — 쓰던 사람이 업데이트 하나로 멈추지 않게.
 *   ⚠️ 2026-09-15 실측: 등록 16대 중 **묶인 기기 0대** — 이 문을 닫아도 **오늘 멈추는 기기는 없다**.
 *      바꿔 말하면 이 구속은 **여태 한 번도 실제로 작동한 적이 없다** — 라이브로는 «되는지» 못 본다.
 *      그래서 순수 함수로 뽑았다: `scripts/verify-runner-fp.mts` 가 DB 없이 전부 먹여 본다(AC-33).
 */
export function classifyFpBinding(boundRaw: string | null | undefined, header: string | null | undefined): FpDecision {
  const raw = String(header ?? "").trim();
  const fp = raw.toLowerCase();
  const fpState: FpState = !raw ? "absent" : /^[0-9a-f]{64}$/.test(fp) ? "ok" : "malformed";
  const bound = String(boundRaw ?? "").trim().toLowerCase();

  if (bound && fpState !== "ok") {
    return {
      action: "refuse_missing", fpState,
      message: fpState === "absent"
        ? "이 열쇠는 특정 PC에 연결돼 있어요. 최신 프로그램으로 실행해 주세요(옛 버전은 기기 확인 정보를 보내지 않아요)."
        : "기기 확인 정보가 올바르지 않아요. 프로그램을 다시 설치해 주세요.",
    };
  }
  if (fpState !== "ok") return { action: "pass", fpState };            // 안 묶인 옛 기기 — 묶을 값이 없으니 그대로 통과
  if (!bound) return { action: "bind", fpState, fp };
  if (bound !== fp) {
    return { action: "refuse_other", fpState, message: "이 열쇠는 다른 PC에 연결돼 있어요. 이 컴퓨터에서 쓰시려면 앱에서 기기를 지우고 다시 등록해 주세요." };
  }
  return { action: "pass", fpState };
}

/**
 * «다른 PC 에서 같은 프로그램이 켜졌어요» — 고객에게 **알린다**(계약 «묶기» ②).
 *   🔴 조용히 막기만 하면 두 가지가 다 나쁘다: 복사해 쓴 사람은 왜 안 되는지 모르고,
 *      **토큰을 도둑맞은 사람은 도둑맞은 줄을 모른다.** 알림이 이 기능의 절반이다.
 *   🔴 시끄럽지 않게: 같은 기기로 1시간에 한 번만 알린다(복사본은 1분마다 두드린다).
 */
async function onOtherDevice(device: DeviceRow): Promise<void> {
  try {
    const [recent] = await q(sql`SELECT 1 AS hit FROM notifications
      WHERE tenant_id = ${device.tenantId} AND kind = 'runner_other_device'
        AND link = ${`/app/settings.html?runner=${device.id}`} AND created_at > NOW() - INTERVAL '1 hour' LIMIT 1`);
    if (recent) return;
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
      VALUES (${device.tenantId}, ${"runner_other_device"}, ${"다른 PC에서 내 프로그램이 켜졌어요"},
              ${`«${device.name}» 토큰으로 다른 컴퓨터에서 접속을 시도했어요. 그 컴퓨터에서는 아무 일도 하지 않았습니다. 내가 한 게 아니라면 기기를 지우고 다시 등록해 주세요(옛 토큰은 그 즉시 못 쓰게 돼요).`},
              ${`/app/settings.html?runner=${device.id}`})`);
    await writeAudit({
      tenantId: device.tenantId, action: "runner_other_device", actorType: "system",
      target: `runner_device:${device.id}`, detail: { name: device.name }, riskLevel: "high",
    });
  } catch (e) {
    console.error("[runner] other_device 알림", (e as Error)?.message ?? e);   // 알림 실패로 거절 자체를 막지는 않는다
  }
}

/** 하트비트 — last_seen_at·version 갱신 후 다음 폴링 간격을 알려 준다. */
export async function heartbeat(device: DeviceRow, body: { version?: unknown; jobs?: unknown; canary?: unknown; caps?: unknown; updateFailed?: unknown }): Promise<{ sleepSec: number; jobsWaiting: number; update?: RunnerUpdateOffer }> {
  const version = String(body.version ?? "").slice(0, 20) || null;
  /* P1R5 §2.4 — 러너 «능력»(caps). 지금은 ffmpeg 유무. 🔴 ffmpeg 가 없으면 러너는 렌더 잡을 **집지 않고**
     여기로 알린다 — 화면이 «ffmpeg 없음» 칩을 띄운다(조용히 잡이 안 도는 상황을 만들지 않는다 · PITFALLS #7). */
  let caps: { ffmpeg: boolean; ffmpegVersion?: string } | null = null;
  if (body.caps && typeof body.caps === "object") {
    const c = body.caps as Record<string, unknown>;
    caps = { ffmpeg: c.ffmpeg === true, ...(c.ffmpegVersion ? { ffmpegVersion: String(c.ffmpegVersion).slice(0, 40) } : {}) };
  }
  await q(sql`UPDATE runner_devices SET last_seen_at = NOW(), status = 'online',
    version = COALESCE(${version}, version)${caps ? sql`, caps = ${jsonb(caps)}` : sql``} WHERE id = ${device.id}`);
  const [r] = await q(sql`SELECT COUNT(*) AS c FROM runner_jobs WHERE tenant_id = ${device.tenantId} AND status = 'queued' AND (due_at IS NULL OR due_at <= NOW())`);
  const jobsWaiting = n(r?.c);
  /* 카나리 결과(DESIGN §19)는 큐가 아니라 하트비트로 온다 — 셀렉터 변경을 고객보다 먼저 알기 위한 운영 신호다.
     고객 화면·계정 상태는 건드리지 않는다(자사 테스트 계정의 드라이런이므로). */
  if (body.canary && typeof body.canary === "object") {
    const c = body.canary as Record<string, unknown>;
    const channel = String(c.channel ?? "").slice(0, 24);
    // 🔴 ok 는 3값(AC-9): true(정상)·false(깨짐)·null(판정 불가 — 세션 없음 등). c.ok 가 boolean 이 아니면 null 로 둔다.
    const ok = c.ok === true ? true : c.ok === false ? false : null;
    const step = String(c.step ?? "").slice(0, 40);
    const detail = String(c.detail ?? "").slice(0, 300);
    const shotKey = c.shotKey ? String(c.shotKey).slice(0, 80) : null;
    await writeAudit({
      tenantId: device.tenantId, action: "runner_canary", actorType: "system", target: `runner_device:${device.id}`,
      detail: { ok, channel, step, detail }, riskLevel: ok === false ? "high" : "low",
    });
    // 🔴 P1R4 §2.2 — canary_runs 에 적재(ops-canary·크론 runner.canary 평가가 읽는다). 하루·채널당 1행(KST 오늘 · UPSERT 덮어쓰기).
    if (channel) {
      await q(sql`INSERT INTO canary_runs (day, channel, ok, step, detail, shot_key, ran_at)
        VALUES ((NOW() AT TIME ZONE 'Asia/Seoul')::date, ${channel}, ${ok}, ${step || null}, ${detail || null}, ${shotKey}, NOW())
        ON CONFLICT (day, channel) DO UPDATE SET ok = EXCLUDED.ok, step = EXCLUDED.step, detail = EXCLUDED.detail, shot_key = EXCLUDED.shot_key, ran_at = NOW()`).catch((e) => console.error("[canary] upsert", e));
    }
  }
  /* 🔴 러너가 «업데이트 하다 실패했다»고 말하면 **반드시 남긴다**(계약 «러너 배포» ③).
     러너는 옛 판으로 계속 돌기 때문에 겉으로는 아무 일도 없어 보인다 —
     기록이 없으면 «다들 최신인 줄 알았는데 절반이 옛 판»인 상태를 아무도 모른 채 몇 주가 간다. */
  if (body.updateFailed && typeof body.updateFailed === "object") {
    const u = body.updateFailed as Record<string, unknown>;
    await writeAudit({
      tenantId: device.tenantId, action: "runner_update_failed", actorType: "system", target: `runner_device:${device.id}`,
      detail: { from: version, to: String(u.version ?? "").slice(0, 20), reason: String(u.reason ?? "").slice(0, 200) },
      riskLevel: "medium",
    });
  }

  /* 새 판이 있으면 제안을 실어 보낸다(같거나 낮으면 아무것도 안 싣는다 · lib/runner-release.ts).
     🔴 여기서 실패해도 하트비트는 성공이어야 한다 — 배포 편의가 발행을 멈추게 두지 않는다. */
  let update: RunnerUpdateOffer | undefined;
  try { update = (await updateOfferFor(version)) ?? undefined; }
  catch (e) { console.error("[runner] update offer", (e as Error)?.message ?? e); }

  return { sleepSec: jobsWaiting > 0 ? 5 : 60, jobsWaiting, ...(update ? { update } : {}) };
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
  /* 프록시는 두 자리에서 온다(계약 §2.5): 새 방식 `accounts.proxy_id → proxies`(암호문) · 옛 방식 `accounts.proxy_url`(평문 칸).
     🔴 옛 칸을 지우지 않는다 — 쓰던 계정이 그대로 돌아야 한다(소급 0). 새 배정이 있으면 그것을 **우선**한다. */
  const [a] = await q(sql`SELECT a.id, a.channel, a.handle, a.browser_profile_key, a.proxy_url, a.proxy_id,
      p.url_enc AS p_enc, p.last_exit_ip AS p_ip, p.status AS p_status
    FROM accounts a LEFT JOIN proxies p ON p.id = a.proxy_id
    WHERE a.tenant_id = ${tid} AND a.id = ${accountId} LIMIT 1`);
  if (!a) return null;
  const out: RunnerJobAccount = {
    id: n(a.id), handle: String(a.handle ?? ""), channel: String(a.channel ?? ""),
    profileKey: String(a.browser_profile_key || `t${tid}-a${n(a.id)}`),
  };
  if (a.p_enc) {
    const dec = decryptObj<{ url?: string }>(String(a.p_enc));
    // 🔴 복호화가 안 되면 **직결로 내려앉히지 않는다** — 프록시를 배정받은 계정이 집 IP 로 나가는 게 이 기능이 막으려는 바로 그것이다.
    if (dec?.url) out.proxyUrl = String(dec.url);
    else throw Object.assign(new Error("proxy_decrypt_failed"), { code: "PROXY_DECRYPT" });
    // 기대 출구 IP — 러너가 실제 IP 와 대조해 다르면 멈춘다(프록시가 죽고 조용히 우회한 상태를 여기서 잡는다).
    if (a.p_ip) out.expectExitIp = String(a.p_ip);
  } else if (a.proxy_url) {
    out.proxyUrl = String(a.proxy_url);   // 러너용 원문(마스킹 안 함 — 이 응답 밖으로 나가면 안 된다)
  }
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
/**
 * 렌더 payload 를 러너가 쓸 수 있는 모양으로 바꾼다(계약 §2.1).
 *   🔴 러너에 **R2 자격을 주지 않는다** — 읽을 것은 presigned GET, 올릴 곳은 presigned PUT «URL 만» 쥐여 준다.
 *      키 자리(clipKey·imageKey·srtKey·audio.*.key)를 **URL 로 치환**하고, 결과를 올릴 `upload` 를 서버가 만들어 붙인다.
 *   유효시간 2시간 — 렌더가 오래 걸려도 만료되지 않게(그러나 영원하지 않게).
 */
const PRESIGN_SEC = 2 * 3600;
async function presignRenderPayload(tid: number, pieceId: number, raw: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!r2Configured()) return null;   // 저장소가 없으면 렌더가 성립하지 않는다 — 잡을 내보내지 않는다(정직)
  const p = JSON.parse(JSON.stringify(raw ?? {})) as Record<string, unknown>;
  const get = async (k: unknown) => (k && typeof k === "string" ? await r2PresignGet(k, PRESIGN_SEC) : k);

  const scenes = Array.isArray(p.scenes) ? p.scenes as Record<string, unknown>[] : [];
  for (const s of scenes) {
    if (s.clipKey) s.clipKey = await get(s.clipKey);
    if (s.imageKey) s.imageKey = await get(s.imageKey);
  }
  const captions = (p.captions && typeof p.captions === "object" ? p.captions : null) as Record<string, unknown> | null;
  if (captions?.srtKey) captions.srtKey = await get(captions.srtKey);
  const audio = (p.audio && typeof p.audio === "object" ? p.audio : null) as Record<string, unknown> | null;
  if (audio) {
    for (const a of (Array.isArray(audio.narration) ? audio.narration : []) as Record<string, unknown>[]) a.key = await get(a.key);
    for (const a of (Array.isArray(audio.sfx) ? audio.sfx : []) as Record<string, unknown>[]) a.key = await get(a.key);
    const bgm = (audio.bgm && typeof audio.bgm === "object" ? audio.bgm : null) as Record<string, unknown> | null;
    if (bgm?.key) bgm.key = await get(bgm.key);
  }

  // 결과물 자리는 **서버가 정한다**(러너가 키를 지어내면 남의 자리에 쓸 수 있다).
  const key = safeKey(`pieces/${tid}/${pieceId}/video`, "mp4");
  const posterKey = safeKey(`pieces/${tid}/${pieceId}/poster`, "jpg");
  p.upload = {
    key, posterKey,
    putUrl: await r2PresignPut(key, "video/mp4", PRESIGN_SEC),
    posterPutUrl: await r2PresignPut(posterKey, "image/jpeg", PRESIGN_SEC),
  };
  return p;
}

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

  /* 🔴 렌더는 **회당 1건**(계약 §2.1 타임박스) — 한 번에 여러 개를 물면 러너 PC 가 몇십 분 묶여
     그 사이 들어온 «발행»이 늦는다. 우선순위(70)로 뒤로 밀리긴 하지만, 렌더만 여러 개 쌓인 날엔 다 물 수 있다.
     더 물린 건 즉시 큐로 돌려놓는다(attempts 도 되돌린다 — 집었다 놓은 것으로 재시도를 깎지 않는다). */
  const extraRender = rows.filter((r) => String(r.kind) === "render.video").slice(1).map((r) => n(r.id));
  if (extraRender.length) {
    await q(sql`UPDATE runner_jobs SET status = 'queued', claimed_by = NULL, claimed_at = NULL,
      attempts = GREATEST(0, attempts - 1), updated_at = NOW()
      WHERE id IN (${sql.join(extraRender.map((i) => sql`${i}`), sql`, `)})`);
  }
  const skip = new Set(extraRender);

  const jobs: RunnerJob[] = [];
  const servedAccounts: number[] = [];
  for (const r of rows) {
    if (skip.has(n(r.id))) continue;
    const accountId = n(r.account_id);
    const job: RunnerJob = {
      id: n(r.id), kind: String(r.kind) as RunnerJobKind,
      payload: (r.payload && typeof r.payload === "object" ? r.payload : {}) as RunnerPayload,
      account: null, priority: n(r.priority), attempts: n(r.attempts),
    };
    if (accountId) job.accountId = accountId;
    if (n(r.piece_id)) job.pieceId = n(r.piece_id);
    /* 렌더 잡은 키를 **presigned URL 로 치환**해 내려준다(러너에 R2 자격 0 · §2.1).
       저장소가 미설정이면 굽더라도 올릴 곳이 없다 — 잡을 큐로 돌려놓고 정직하게 남긴다(조용한 실패 금지). */
    if (job.kind === "render.video") {
      const signed = await presignRenderPayload(device.tenantId, n(r.piece_id), job.payload as Record<string, unknown>);
      if (!signed) {
        await q(sql`UPDATE runner_jobs SET status='queued', claimed_by=NULL, claimed_at=NULL,
          attempts = GREATEST(0, attempts - 1), updated_at = NOW() WHERE id = ${job.id}`);
        await writeAudit({ tenantId: device.tenantId, action: "render_blocked", actorType: "system", target: `runner_job:${job.id}`,
          detail: { reason: "r2_not_configured" }, riskLevel: "high" });
        continue;
      }
      job.payload = signed as RunnerPayload;
    }
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
  /** `ads.setup_blogger`/`ads.revert_blogger` — 블로거 템플릿 광고 삽입/복원 결과(계약 P1R4 §2.2 · 백업 원문 포함). */
  monetize?: { bloggerTemplateBackup?: string; adsenseInserted?: boolean; reverted?: boolean; detail?: string };
  /** `render.video`(P1R5 §2.1) — 러너가 구운 mp4. 🔴 서버가 R2 HEAD 로 확인하기 전엔 «성공»이 아니다. */
  render?: RunnerRenderResult;
  /** 이 잡이 실제로 나간 IP(계약 §2.5-4 · 프록시 배정 계정만). 서버가 `accounts.last_exit_ip` 에 적는다. */
  exitIp?: string;
  shotKey?: string;
  /* 🔴 **`notes` 는 여기 없다 — 러너가 보내도 서버가 버린다.** 일부러 그렇다(메인 판정 2026-09-15).
     러너 노트를 저장할 자리를 새로 파면 «러너가 하는 말»이 또 하나의 진실 원천이 되고,
     화면 문구가 러너 판(zip)에 묶여 버린다(고치려면 러너를 다시 배포해야 한다).
     ⇒ **러너는 «사실»만 구조화해 보낸다**(예: `revenueRows[].raw.amountEstimated`·`amountHead`·`rowsDropped`)
        **문장은 서버가 만든다**(`lib/revenue/aggregate.ts`). 화면에 가야 할 것을 `notes` 에 담지 마라 — 사라진다.
     (러너 콘솔 로그로는 여전히 쓸모 있어서 러너 쪽 `notes` 자체는 남겨 뒀다.) */
}
/**
 * 실패 보고. `errorKind` 는 계약 P1R2 §2 의 7종 **또는 `"parse"`**(P1R3 §2.1 — 파싱 실패를 0 으로 채우지 않는다 · AC-9).
 *   🔴 "parse" 는 전이표(`lib/account-health.ts` 7종) **밖**이다 — 계정 문제가 아니라 **우리 버그**(화면이 바뀌었거나 파서가 틀렸다).
 *      계정 전이 0 · 재시도 무의미 · audit high 로 종결한다(전이표에 넣지 않는다 — 표는 B 의 정본).
 */
export interface RunnerReportFail { ok: false; errorKind?: unknown; detail?: string; shotKey?: string; exitIp?: string }
export type RunnerReportBody = RunnerReportOk | RunnerReportFail;

export interface ReportOutcome { ok: boolean; status: RunnerJobStatus; reason?: string; postId?: number; verified?: "server" | "unverified" | "not_found" | "private"; block?: RunnerBlock }

/**
 * 러너 주장을 믿지 않는다(계약 §2 · DESIGN §8.3) — 보고된 URL 을 서버가 직접 확인한다.
 *   found     → 발행 확정(도장 server).
 *   not_found → 404/410 → 확정하지 않는다(awaiting_manual · 사람이 확인).
 *   unknown   → 우리가 못 읽은 것(가용성·iframe 본문) — 발행 «사실»을 뒤집지 않는다(확정하되 unverified 도장).
 *   ⚠️ AM 교훈: 네이버 본문은 iframe 안이라 제목 대조가 실패해도 «없다»고 단정하면 오판이 된다.
 */
/**
 * 🔴 **«비공개로 올라간 글»을 가려내는 표식**(2026-09-15 · AC-55 뒷정리).
 *
 *   왜 필요한가: `button:has-text('공개')` 가 **«비공개»를 집을 수 있다**(부분일치 · AC-55). 그러면 글은
 *   올라가고 주소도 생기지만 **아무도 못 본다.** 그런데 이 확인은 제목으로 판정하므로, 비공개 안내 페이지에는
 *   제목이 없어서 `unknown` 이 되고 — `unknown` 은 **«확정하되 unverified 도장»** 이라 **발행이 성공으로 끝난다.**
 *   즉 지금까지 «틀린 성공»이 그대로 통과했다. 여기서 끊는다.
 *
 *   ⚠️ **이 낱말 목록은 아직 실물로 확인하지 못했다**(우리 티스토리 계정이 `pending_login` 이라 비공개 글을 못 만들어 봤다).
 *      그래서 **넓게 잡지 않았다** — 표식이 안 걸리면 종전대로 `unknown` 이다(오탐으로 멀쩡한 발행을 막지 않는다).
 *      첫 실발행 때 «탐침 1회»로 실제 비공개 페이지를 한 번 열어 이 목록을 확정해야 한다(사장님 체크리스트 2번).
 */
const PRIVATE_MARKS = [
  "비공개글입니다", "비공개포스트", "비공개로설정", "비공개상태",
  "보호되어있는글", "보호된글입니다", "비밀글입니다",
  "권한이없습니다", "접근권한이없",
];

/**
 * 러너 주장을 믿지 않는다(계약 §2 · DESIGN §8.3) — 보고된 URL 을 서버가 직접 확인한다.
 *
 *   🔴 **이 확인이 곧 «로그아웃한 남의 눈»이다.** 서버 `fetch` 에는 그 계정의 쿠키가 없다 —
 *      러너(= 글쓴이 본인의 브라우저)로는 **절대 못 보는 것**을 여기서만 볼 수 있다.
 *      비공개 글은 글쓴이 눈에는 멀쩡해 보이므로, 공개 여부를 판정할 수 있는 자리는 **여기 하나뿐**이다.
 */
export async function verifyPublishedUrl(url: string, title?: string | null): Promise<"found" | "not_found" | "private" | "unknown"> {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) return "not_found";
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(u, { redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoCreate/1.0)" } });
    if (r.status === 404 || r.status === 410) return "not_found";
    /* 🔴 403 은 «없다»가 아니라 «못 본다»다 — 비공개의 전형이라 본문까지 읽어 본다(`!r.ok` 로 뭉뚱그리지 않는다). */
    const body = r.status === 403 || r.ok ? await r.text().catch(() => "") : "";
    if (!r.ok && !body) return "unknown";
    if (!body) return "unknown";
    const flat = body.replace(/\s+/g, "");
    /* 🔴 제목 검사보다 **먼저** 본다. 비공개 안내 페이지가 어쩌다 제목을 품고 있어도(목록·og:title 등)
       «찾았다»로 넘어가면 그게 바로 «틀린 성공»이다. 못 보는 쪽이 이긴다. */
    if (PRIVATE_MARKS.some((m) => flat.includes(m))) return "private";
    if (!r.ok) return "unknown";
    const tt = String(title ?? "").replace(/\s+/g, "").slice(0, 20);
    if (!tt) return "found";
    return flat.includes(tt) ? "found" : "unknown";
  } catch { return "unknown"; }
  finally { clearTimeout(t); }
}

/** 계정 전이 신호 기록 — 필드만 쓴다. 전이 로직(B `lib/account-health.ts`)이 있으면 넘겨준다(없으면 graceful). */
/** @returns 이 piece 가 **다른 계정으로 넘어갔나**(suspend 승계) — 넘어갔으면 호출자가 piece 를 실패로 닫으면 안 된다. */
async function signalAccountError(tid: number, accountId: number, block: RunnerBlock, pieceId?: number | null): Promise<{ handedOver: boolean }> {
  try {
    await q(sql`UPDATE accounts SET last_error_kind = ${block.kind}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${accountId}`);
  } catch (e) { console.error("[runner-jobs] last_error_kind write failed", e); }
  if (block.accountAction === "none") return { handedOver: false };
  /* 🔴 전이는 B 의 정본이 한다(정적 배선 · main 192a417 머지 후 2026-09-14).
     실패해도 보고 자체는 성공시킨다 — 전이가 안 됐다고 잡 결과를 잃으면 안 된다. */
  try {
    const r = await classifyAndApply(accountId, block.kind, { tenantId: tid, detail: block.detail ?? block.message, pieceId });
    // 승계가 이 piece 를 실제로 옮겼는지 — 새 슬롯이 이 piece 를 물고 있으면 넘어간 것이다.
    if (r.action === "suspend" && pieceId) {
      const [p] = await q(sql`SELECT account_id FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId} LIMIT 1`);
      return { handedOver: !!p && n(p.account_id) !== accountId };
    }
  } catch (e) { console.error("[runner-jobs] classifyAndApply failed", e); }
  return { handedOver: false };
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
/**
 * 러너가 실제로 나간 IP 를 적는다(계약 §2.5-4) — 성공·실패 모두.
 *   🔴 «프록시를 걸었다»가 아니라 **«그 IP 로 나갔다»의 유일한 증거**다. 여기 안 적으면 아무도 확인할 수 없다.
 *   🔴 두 계정이 같은 IP 로 나가면 그 자체가 연좌제 위험이라 **운영 감사에 남긴다**(고객 알림은 아니다 —
 *      프록시를 안 산 고객에겐 정상 상태이고, 판단은 운영이 한다).
 */
async function recordExitIp(tid: number, accountId: number | null, ip: unknown): Promise<void> {
  const v = String(ip ?? "").trim();
  if (!accountId || !/^[0-9a-f.:]{3,45}$/i.test(v)) return;
  try {
    await q(sql`UPDATE accounts SET last_exit_ip = ${v}, last_exit_ip_at = NOW() WHERE id = ${accountId}`);
    await q(sql`UPDATE proxies SET last_exit_ip = ${v}, last_check_at = NOW(), status = 'active', updated_at = NOW()
      WHERE id = (SELECT proxy_id FROM accounts WHERE id = ${accountId})`);
    const shared = await q(sql`SELECT id, handle FROM accounts
      WHERE tenant_id = ${tid} AND last_exit_ip = ${v} AND id <> ${accountId} AND status <> 'disconnected' LIMIT 5`);
    if (shared.length) {
      await writeAudit({
        tenantId: tid, action: "accounts_share_exit_ip", actorType: "system", riskLevel: "medium",
        target: `account:${accountId}`,
        detail: { ip: v, withAccountIds: shared.map((r) => n(r.id)), note: "같은 IP 로 나가는 계정이 둘 이상 — 한 계정이 정지되면 같이 묶일 수 있다" },
      });
    }
  } catch (e) {
    console.error("[runner-jobs] exit ip 기록", (e as Error)?.message ?? e);   // 기록 실패로 보고 자체를 막지 않는다
  }
}

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

  // 🔴 성공·실패를 가르기 **전에** 적는다 — 실패한 잡의 출구 IP 야말로 알아야 하는 값이다(§2.5-4).
  await recordExitIp(tid, accountId || null, (result as { exitIp?: unknown }).exitIp);

  /* ── 실패(parse) — 계약 P1R3 §2.1 · 우리 버그 · 계정 전이 0 · 0 으로 채우지 않는다(AC-9) ── */
  /* `"proxy"`(계약 P1R7 §2.5) — `"parse"` 와 **같은 부류**다: 전이표 7종 밖 · 계정 잘못 아님(전이 0) · **우리가 고친다**.
     프록시가 죽었거나 주소가 깨졌거나, 걸긴 걸었는데 다른 IP 로 나갔다. 재시도해도 같은 답이 오므로 종결하고 감사에 남긴다.
     🔴 이걸 `login_fail`·`captcha` 로 분류하면 고객에게 «다시 로그인하세요» 라고 **거짓 안내**를 하게 된다(AC-10). */
  if (result.ok !== true && String((result as RunnerReportFail).errorKind) === "proxy") {
    const fail = result as RunnerReportFail;
    await q(sql`UPDATE runner_jobs SET status = 'failed', claimed_by = NULL, claimed_at = NULL, error_kind = 'proxy',
        result = ${jsonb({ ok: false, errorKind: "proxy", detail: String(fail.detail ?? "").slice(0, 300), shotKey: fail.shotKey ?? null, attempts: n(j.attempts) })},
        due_at = NULL, updated_at = NOW() WHERE id = ${jobId}`);
    if (accountId) {
      await q(sql`UPDATE proxies SET status = 'down', last_check_at = NOW(), updated_at = NOW()
        WHERE id = (SELECT proxy_id FROM accounts WHERE id = ${accountId})`).catch(() => {});
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
        VALUES (${tid}, ${"proxy_down"}, ${"IP 연결이 끊겨 잠시 멈췄어요"},
                ${"이 계정 전용 IP 가 응답하지 않아 글을 올리지 않았어요. 다른 계정과 같은 IP 로 나가지 않도록 일부러 멈춘 거예요 — 저희가 바로 손보겠습니다."},
                ${"/app/accounts.html"})`).catch(() => {});
    }
    await writeAudit({
      tenantId: tid, action: "runner_job_failed", actorType: "system", riskLevel: "high", target: `runner_job:${jobId}`,
      detail: { kind, errorKind: "proxy", ourBug: true, accountId, detail: String(fail.detail ?? "").slice(0, 200) },
    });
    return { ok: true, status: "failed", reason: "proxy" };
  }

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
        WHERE tenant_id = ${tid} AND source = ${source} ${accountId ? sql`AND account_id = ${accountId}` : sql``}`).catch((e) => console.warn("[runner-jobs] 보조 갱신 실패(비치명)", String((e as Error)?.message ?? e).slice(0, 120)));
    }
    await writeAudit({
      tenantId: tid, action: "runner_job_failed", actorType: "system", target: `runner_job:${jobId}`,
      detail: { kind, errorKind: "parse", ourBug: true, shotKey: fail.shotKey ?? null, detail: String(fail.detail ?? "").slice(0, 200) },
      riskLevel: "high",
    });
    return { ok: true, status: "failed", reason: "parse" };
  }

  /* ── 네이버 클립(P1R5 §2.3) — 아직 올릴 길이 없다. **재시도하지 않고** 사람에게 넘긴다. ──
       분류기(`classifyRunnerBlock`)에 맡기면 `not_supported_yet` 이 «unknown» 으로 떨어져 3번 헛돈다.
       길이 막힌 것은 계정 문제도 우리 버그도 아니므로 계정 상태를 건드리지 않는다. 조용한 0건 금지(PITFALLS #7). */
  /* ── 🔴 내리기 실패 중 «이미 없었다»는 **실패가 아니다**(DESIGN §5E.3) ──
     러너가 그 글을 못 찾았다면(404·삭제됨 화면) 그건 **우리가 원한 상태**다. 실패로 세면:
       ① 재시도가 돌면서 없는 글을 계속 찾으러 가고 ② 고객 화면엔 «내리지 못했어요»가 뜨는데 실제로는 내려가 있다.
     ⚠️ 방향을 헷갈리지 말 것 — AC-9 은 «없음을 0·정상으로 읽지 마라»인데, 여기서는 **없음이 목표**다.
        무엇을 물었는가가 다르다(«얼마 벌었나» vs «내려갔나»). */
  if (result.ok !== true && kind === "publish.retract") {
    const fail = result as RunnerReportFail;
    const gone = String(fail.errorKind ?? "") === "already_gone";
    if (gone) {
      const postId = n(payload.postId);
      if (postId) {
        const { afterRetracted } = await import("./publish/retract");
        await afterRetracted(tid, postId, {
          channel: String(payload.channel ?? ""), externalUrl: String(payload.externalUrl ?? ""),
          pieceId: pieceId ?? null, accountId: accountId ?? null,
        });
      }
      await q(sql`UPDATE runner_jobs SET status='done', error_kind = NULL,
        result = ${jsonb({ ok: true, alreadyGone: true })}, updated_at = NOW() WHERE id = ${jobId}`);
      return { ok: true, status: "done", reason: "already_gone" };
    }
    /* 진짜 실패 — 🔴 **표식을 걷어낸다.** 안 걷으면 «내렸다»가 남아 그 글을 **영영 다시 못 내린다**
       (`retractPost` 가 표식을 보고 «이미 내렸어요»로 돌려보낸다). */
    const postId = n(payload.postId);
    if (postId) { const { unmarkRetract } = await import("./publish/retract"); await unmarkRetract(tid, postId); }
    await q(sql`UPDATE runner_jobs SET status='failed', claimed_by=NULL, claimed_at=NULL, error_kind=${String(fail.errorKind ?? "unknown").slice(0, 24)},
      result = ${jsonb({ ok: false, detail: String(fail.detail ?? "").slice(0, 300) })}, updated_at = NOW() WHERE id = ${jobId}`);
    await notify(tid, "retract_failed", "글을 내리지 못했어요",
      `${String(fail.detail ?? "").slice(0, 120)} 직접 내려 주셔야 해요.`,
      String(payload.externalUrl ?? "") || "/app/pieces.html");
    await writeAudit({
      tenantId: tid, action: "post_retract_failed", actorType: "system", target: `post:${postId || jobId}`,
      detail: { kind, errorKind: fail.errorKind ?? null, detail: String(fail.detail ?? "").slice(0, 200) }, riskLevel: "high",
    });
    return { ok: true, status: "failed", reason: "retract_failed" };
  }

  if (result.ok !== true && kind === "publish.naver_clip") {
    const fail = result as RunnerReportFail;
    await q(sql`UPDATE runner_jobs SET status='failed', claimed_by=NULL, claimed_at=NULL, error_kind='not_supported_yet',
      result = ${jsonb({ ok: false, errorKind: "not_supported_yet", detail: String(fail.detail ?? "").slice(0, 300) })},
      due_at = NULL, updated_at = NOW() WHERE id = ${jobId}`);
    if (pieceId) {
      await q(sql`UPDATE pieces SET status = 'awaiting_manual',
        meta = meta || ${jsonb({ failReason: "네이버 클립은 아직 자동 업로드를 지원하지 않아요", manualChannel: "naver_clip" })},
        updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${pieceId}`);
    }
    /* 🔴 알림은 **그 글로** 보낸다(R8 §3.2). 종전엔 목록(`/app/pieces.html`)으로 보냈는데,
       이 알림의 다음 걸음은 **폰에서 그 영상을 받는 것**이라 목록에 떨어뜨리면 고객이 다시 찾아 들어가야 한다.
       푸시를 탭하면 그 글 화면으로 바로 가고, 거기서 «영상 받기»가 보인다(`/api/piece-video` 의 `handoff`). */
    await notify(tid, "manual_upload", "클립은 앱에서 올려 주세요",
      "영상은 다 만들어 뒀어요. 네이버 클립은 휴대폰 앱에서만 올릴 수 있어서, 휴대폰에서 이 알림을 눌러 영상을 받은 뒤 올려 주세요.",
      pieceLink(pieceId));
    await writeAudit({ tenantId: tid, action: "publish_not_supported", actorType: "system", target: `piece:${pieceId || jobId}`,
      detail: { kind, channel: "naver_clip" }, riskLevel: "low" });
    return { ok: true, status: "failed", reason: "not_supported_yet" };
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
    const sig = accountId ? await signalAccountError(tid, accountId, block, pieceId || null) : { handedOver: false };
    /* 🔴 정지 승계로 piece 가 **다른 계정에 넘어갔으면** 실패로 닫지 않는다 — 2026-09-14 승계 실증(verify-failover)에서
       B 의 reassignSlots 가 만든 **새 슬롯을 내 failPublishPiece 가 awaiting_manual 로 덮어썼다**(순서 사고).
       실패는 계정의 것이지 글의 것이 아니다. 넘어가지 못한 piece(받을 계정 없음)만 awaiting_manual 로 남긴다. */
    if (!canRetry && kind.startsWith("publish.") && pieceId && !sig.handedOver) await failPublishPiece(tid, pieceId, block, fail.shotKey);
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
    const verified: "server" | "unverified" | "private" = v === "found" ? "server" : v === "private" ? "private" : "unverified";
    const fin = await finalizePublish(pieceId, {
      via: "runner", externalUrl, tenantId: tid,
      ...(channelRef ? { channelRef } : {}),
      ...(accountId ? { accountId } : {}),
    });
    /* 🔴 **비공개로 올라갔다** — 여기서 «실패»로만 끝내면 안 된다.
       글은 **이미 채널에 존재한다.** 확정(finalizePublish)을 건너뛰면 `external_url` 이 안 남고,
       그러면 발행 멱등 게이트(«주소 있으면 재게시 금지»)가 붙잡을 것이 없어져 **같은 글이 두 번 올라간다.**
       그래서 순서는 «확정 먼저 → 그다음 정직하게 표시»다:
         ① 주소를 남겨 중복을 막고  ② 글은 «공개 아님»으로 도장 찍고  ③ 고객에게 할 일을 알리고  ④ 운영 감사에 남긴다.
       고객이 할 일은 **재발행이 아니라 «공개로 바꾸기»** — 알림 문구가 그걸 정확히 말해야 한다. */
    if (v === "private" && fin.ok) {
      const postId = n(fin.postId);
      if (postId) {
        /* jsonb 부분갱신 금지(PITFALLS #1) — read→merge→write. `public:false` 는 «모른다»가 아니라 «확인했고 아니다»다. */
        const [p] = await q(sql`SELECT stats FROM posts WHERE tenant_id = ${tid} AND id = ${postId} LIMIT 1`);
        const cur = (p?.stats && typeof p.stats === "object" ? { ...(p.stats as Record<string, unknown>) } : {}) as Record<string, unknown>;
        await q(sql`UPDATE posts SET stats = ${jsonb({ ...cur, public: false, publicCheckedAt: new Date().toISOString() })}
          WHERE tenant_id = ${tid} AND id = ${postId}`).catch((e) => console.error("[runner-jobs] private stamp failed", e));
      }
      /* 🔴 `void` 로 던지지 않는다 — 알림·감사는 **기다린다**(안 그러면 함수가 끝나며 조용히 사라진다).
         ⚠️ 문구를 «비공개입니다»로 단정하지 않는다. 낱말로 가리는 방식이라 **오탐이 가능하다** —
            «글을 비공개로 설정하는 방법» 같은 글은 본문에 그 말이 있어서 걸린다(실측으로 확인 · `verify-public-check.mts`).
            그래도 이 방향을 고른 이유: **조용한 «틀린 성공»보다 시끄러운 헛경보가 낫다.**
            헛경보는 고객이 글을 열어 보면 5초에 끝나고, 틀린 성공은 아무도 모른 채 남는다. */
      await notify(tid, "publish", "글이 비공개로 보여요 — 확인해 주세요",
        "로그인하지 않은 상태로 열어 보니 **글이 안 보였어요**(비공개일 수 있어요). 다시 올리지 마시고(중복이 됩니다) 채널에서 공개 설정을 확인해 주세요.", externalUrl);
      await writeAudit({
        tenantId: tid, action: "publish_not_public", actorType: "system", target: `piece:${pieceId ?? 0}`,
        detail: { externalUrl, channel: kind.replace("publish.", ""), accountId: accountId ?? null },
        riskLevel: "high",
      });
    }
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
      WHERE tenant_id = ${tid} AND source = ${source} ${accountId ? sql`AND account_id = ${accountId}` : sql``}`).catch((e) => console.warn("[runner-jobs] 보조 갱신 실패(비치명)", String((e as Error)?.message ?? e).slice(0, 120)));
    // 계정의 매체 상태(계약 §1.5b · monetize.adpostState) — 화면이 «미등록/심사중/승인»을 그리는 값.
    if (okBody.adpostState && accountId) {
      await q(sql`UPDATE accounts SET monetize = monetize || ${jsonb({ adpostState: okBody.adpostState, adpostCheckedAt: new Date().toISOString() })}, updated_at = NOW()
        WHERE tenant_id = ${tid} AND id = ${accountId}`).catch((e) => console.warn("[runner-jobs] 보조 갱신 실패(비치명)", String((e as Error)?.message ?? e).slice(0, 120)));
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
  /* ── 내리기 성공(DESIGN §5E) ──
     🔴 **«없음»이 성공이다.** 러너가 «그 글이 이미 없었다»고 돌려줘도 우리가 원한 상태이므로 성공으로 센다.
        ⚠️ 이게 AC-9 의 **반대 얼굴**이다: 수집·발행에서는 «없다»를 «0·정상»으로 읽으면 거짓이 되는데,
        내리기에서는 «없다»가 정확히 목표다. 같은 «없음»인데 방향이 반대라 여기 적어 둔다.
     🔴 그리고 **«지웠다»는 러너의 주장이다** — 내린 뒤 `verify.post_alive` 를 걸어
        **쿠키 없는 서버 눈으로** 정말 없는지 본다(AC-54 · «버튼을 눌렀다»는 증거가 아니다). */
  if (kind === "publish.retract") {
    const postId = n(payload.postId);
    if (postId) {
      const { afterRetracted } = await import("./publish/retract");
      await afterRetracted(tid, postId, {
        channel: String(payload.channel ?? ""),
        externalUrl: String(payload.externalUrl ?? ""),
        pieceId: pieceId ?? null,
        accountId: accountId ?? null,
      });
    }
    await q(sql`UPDATE runner_jobs SET status='done', error_kind = NULL,
      result = ${jsonb({ ok: true, alreadyGone: okBody.stats?.alreadyGone === true })}, updated_at = NOW() WHERE id = ${jobId}`);
    return { ok: true, status: "done" };
  }

  if (kind === "ads.setup_tistory" || kind === "ads.status_blogger") {
    if (okBody.adsense && accountId) {
      await q(sql`UPDATE accounts SET monetize = monetize || ${jsonb({ adsenseLinked: !!okBody.adsense.linked, adsenseState: okBody.adsense.state ?? null, adsenseCheckedAt: new Date().toISOString() })}, updated_at = NOW()
        WHERE tenant_id = ${tid} AND id = ${accountId}`).catch((e) => console.warn("[runner-jobs] 보조 갱신 실패(비치명)", String((e as Error)?.message ?? e).slice(0, 120)));
    }
    await q(sql`UPDATE runner_jobs SET status='done', error_kind = NULL,
      result = ${jsonb({ ok: true, adsense: okBody.adsense ?? null, shotKey: okBody.shotKey ?? null })}, updated_at = NOW() WHERE id = ${jobId}`);
    return { ok: true, status: "done" };
  }

  /* ── 블로거 광고 삽입/복원(P1R4 §2.2 · DESIGN §9.0) — 🔴 계정 monetize 만 쓴다(§5 경계). 템플릿 백업 원문은
        setup 때 저장하고 revert 때 지운다(revert 는 그 백업을 «썼다»는 뜻). result 에는 원문을 싣지 않는다(크다 · hasBackup 플래그만). ── */
  if (kind === "ads.setup_blogger" || kind === "ads.revert_blogger") {
    const m = okBody.monetize ?? {};
    const inserted = kind === "ads.setup_blogger" && !!m.adsenseInserted;
    const reverted = kind === "ads.revert_blogger" && !!m.reverted;
    const hasBackup = typeof m.bloggerTemplateBackup === "string" && !!m.bloggerTemplateBackup;
    if (accountId) {
      const patch: Record<string, unknown> = { adsenseInserted: kind === "ads.setup_blogger" ? inserted : false, bloggerAdsAt: new Date().toISOString() };
      if (kind === "ads.setup_blogger" && hasBackup) patch.bloggerTemplateBackup = m.bloggerTemplateBackup;   // 복원용 원문
      if (kind === "ads.revert_blogger") patch.bloggerTemplateBackup = null;                                  // 백업 소진
      await q(sql`UPDATE accounts SET monetize = monetize || ${jsonb(patch)}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${accountId}`).catch((e) => console.warn("[runner-jobs] 보조 갱신 실패(비치명)", String((e as Error)?.message ?? e).slice(0, 120)));
    }
    await q(sql`UPDATE runner_jobs SET status='done', error_kind = NULL,
      result = ${jsonb({ ok: true, monetize: { adsenseInserted: inserted, reverted, hasBackup, detail: m.detail ?? null }, shotKey: okBody.shotKey ?? null })}, updated_at = NOW() WHERE id = ${jobId}`);
    await writeAudit({ tenantId: tid, action: kind === "ads.setup_blogger" ? "ads_setup_blogger" : "ads_revert_blogger", actorType: "system",
      target: accountId ? `account:${accountId}` : `runner_job:${jobId}`, detail: { inserted, reverted, hasBackup }, riskLevel: "medium" });
    return { ok: true, status: "done" };
  }

  /* ── 영상 렌더(P1R5 §2.1) ─────────────────────────────────────────────
     🔴 **러너 주장을 믿지 않는다**(§2.1 · DESIGN §8.3 발행 관례와 같은 원칙):
        «구웠다»는 보고만으로 성공 처리하면, 파일이 없는데 심사·발행으로 넘어가 빈 영상이 올라간다.
        R2 HEAD 로 **실존과 크기**를 확인한 뒤에만 다음 단계로 보낸다. bytes 도 러너 값이 아니라 **HEAD 실측**을 쓴다.
     🔴 AC-17 순환 0 — `render-queue` 는 이 파일을 import 한다. 그래서 여기서는 **함수 안에서** 동적으로 부른다. */
  if (kind === "render.video") {
    const r = okBody.render;
    const failRender = async (reason: string, detail: string) => {
      await q(sql`UPDATE runner_jobs SET status='failed', claimed_by=NULL, claimed_at=NULL, error_kind='encode',
        result = ${jsonb({ ok: false, reason, detail })}, updated_at = NOW() WHERE id = ${jobId}`);
      await writeAudit({ tenantId: tid, action: "render_verify_failed", actorType: "system", target: `piece:${pieceId}`,
        detail: { jobId, reason, detail, claimed: r ?? null }, riskLevel: "high" });
      return { ok: true, status: "failed" as RunnerJobStatus, reason };
    };
    if (!r?.key) return await failRender("no_key", "렌더는 성공이라는데 파일 키가 없어요.");
    const head = await r2Head(r.key);
    if (!head || head.bytes <= 0) {
      return await failRender("not_found", `올렸다는 영상이 저장소에 없어요(key=${String(r.key).slice(0, 80)}).`);
    }
    /* 🔴 [2026-09-15 C · 라이브 실증에서 잡음] 러너의 **ffprobe 실측**(containerMs·videoMs·audioMs·measured)을 여기서 흘리면
       `finalizeRender` → `judgeVideo` 가 그 값을 영영 못 봐서 «꼬리» 판정이 보류로 주저앉는다(AC-33 의 재발).
       이 자리는 필드를 **골라 담는 경계**라, 새 측정값을 추가할 때마다 여기 한 줄을 같이 고쳐야 한다.
       🔴 `bytes` 만은 계속 서버 HEAD 실측을 쓴다(러너 주장 불신 · §2.1). */
    const num = (v: unknown) => Math.max(0, Math.trunc(Number(v) || 0));
    const measured = r.measured === true;
    const { finalizeRender } = await import("./video/render-queue");
    const fin = await finalizeRender(pieceId, {
      key: r.key, posterKey: String(r.posterKey ?? ""),
      durationMs: num(r.durationMs),
      bytes: head.bytes,                                   // 🔴 실측값(러너 주장 아님)
      frameCount: num(r.frameCount),
      ...(measured ? { containerMs: num(r.containerMs), videoMs: num(r.videoMs), audioMs: num(r.audioMs), plannedMs: num(r.plannedMs), measured: true } : {}),
      /* [R7 §1.5 · B-1] 프레임 지문 — 위 경고 그대로다. 여기서 안 담으면 러너가 보내도 **이 줄에서 사라지고**
         심사 `similarity` 는 영영 «판정 보류»로 주저앉는다(AC-33 재발). 모양이 아니면 아예 안 담는다(빈 값으로 채우지 않는다). */
      ...(typeof r.thumbGray === "string" && r.thumbGray.length >= 1_000 && r.thumbGray.length <= 8_192 ? { thumbGray: r.thumbGray } : {}),
      ...(typeof r.framePhash === "string" && /^[0-9a-f]{16}$/i.test(r.framePhash) ? { framePhash: r.framePhash.toLowerCase() } : {}),
    });
    await q(sql`UPDATE runner_jobs SET status='done', error_kind = NULL,
      result = ${jsonb({ ok: true, key: r.key, posterKey: r.posterKey ?? null, bytes: head.bytes, durationMs: r.durationMs ?? null, frameCount: r.frameCount ?? null,
        ...(measured ? { containerMs: r.containerMs ?? null, videoMs: r.videoMs ?? null, audioMs: r.audioMs ?? null, measured: true } : {}),
        // 지문 원문(1.3KB)은 잡 결과에 싣지 않는다 — «왔나»만 남긴다(러너 버전별 배포 확인용).
        fingerprint: (typeof r.thumbGray === "string" && r.thumbGray.length >= 1_000) ? "gray" : (typeof r.framePhash === "string" ? "phash" : null),
        ffmpegVersion: r.ffmpegVersion ?? null, next: fin.next })},
      updated_at = NOW() WHERE id = ${jobId}`);
    return { ok: fin.ok, status: "done", reason: fin.next };
  }

  // 통계·생존 확인 잡 — posts.stats 에 병합(read→merge→write · jsonb 부분갱신 금지).
  if ((kind === "verify.post_alive" || kind === "revenue.stats") && okBody.stats) {
    const postId = n(payload.postId);
    if (postId) {
      const extra: Record<string, unknown> = {};
      /* 🔴 **러너의 «살아 있다»는 공개 여부의 증거가 아니다**(2026-09-15 · AC-55 뒷정리).
         이 잡은 **그 계정의 로그인된 프로필**에서 돈다(`runner/core.mjs` 가 `profileKey` + `applyCookies`).
         글쓴이 자신의 눈으로 열면 **비공개 글도 멀쩡하게 보인다** — 러너의 «비공개입니다» 검사는
         구조적으로 **남의 글에만** 걸린다. 그래서 «올렸는데 비공개»는 발행 때도, 7일 뒤 확인 때도 안 잡혔다.
         공개 여부를 판정할 수 있는 자리는 **쿠키가 없는 서버**뿐이라(위 `verifyPublishedUrl` 주석) 여기서 한 번 더 본다.
         ⚠️ 발행 잡이 아니라 **확인 잡**이므로 결과를 뒤집지 않는다 — 도장만 찍고 알린다(AC-9: 모르면 아무 키도 안 남긴다). */
      if (kind === "verify.post_alive" && okBody.stats.alive !== false) {
        const u = String(payload.externalUrl ?? "");
        const ttl = String(payload.title ?? "").trim();
        if (u) {
          const v = await verifyPublishedUrl(u, ttl || null);
          if (v === "private") {
            extra.public = false;
            extra.publicCheckedAt = new Date().toISOString();
            await notify(tid, "publish", "7일 전 올린 글이 안 보여요 — 확인해 주세요",
              "로그인하지 않은 상태로 열어 보니 **글이 안 보였어요**(비공개일 수 있어요). 다시 올리지 마시고(중복이 됩니다) 채널에서 공개 설정을 확인해 주세요.", u);
            await writeAudit({
              tenantId: tid, action: "publish_not_public", actorType: "system", target: `post:${postId}`,
              detail: { externalUrl: u, at: "alive7", accountId: accountId ?? null }, riskLevel: "high",
            });
          } else if (v === "found" && ttl) {
            /* 🔴 `ttl` 을 **반드시** 같이 본다. 제목이 없으면 `verifyPublishedUrl` 은 200 이기만 해도 «found» 라
               (블로그 첫 화면으로 튕긴 것도 통과한다) — 그 «found» 로 `public:true` 를 찍으면
               우리가 막으려던 바로 그 **틀린 초록**을 우리 손으로 찍는 셈이다. 제목이 맞았을 때만 공개로 본다. */
            extra.public = true;
            extra.publicCheckedAt = new Date().toISOString();
          }
          // `unknown`·`not_found`·제목 없음 은 **아무 키도 안 남긴다** — «못 읽었다»를 «비공개»로도 «공개»로도 바꾸지 않는다(AC-9).
        }
      }
      const [p] = await q(sql`SELECT stats FROM posts WHERE tenant_id = ${tid} AND id = ${postId} LIMIT 1`);
      const cur = (p?.stats && typeof p.stats === "object" ? { ...(p.stats as Record<string, unknown>) } : {}) as Record<string, unknown>;
      const merged = { ...cur, ...okBody.stats, ...extra, lastSyncAt: new Date().toISOString() };
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
