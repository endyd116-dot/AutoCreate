/**
 * scripts/check-backup.mts — 백업·복구 **확인**(계약 P1R6 §3.3 · DESIGN §19 운영).
 *
 *   `npx --yes tsx --env-file=.env scripts/check-backup.mts`
 *
 *   하는 일: ① Neon **PITR 보존 기간** ② R2 **버전 관리** 를 **실제로 조회**하고,
 *   결과를 감사 1행(`ops_backup_check`)으로 남긴다. 운영센터가 그 마지막 행을 «상태 한 줄»로 그린다.
 *
 *   🔴 **자동 복구는 범위 밖**이다(계약). 여기서 하는 건 «되어 있나 확인»까지 —
 *      복구를 자동화해 두면 사고 때 사람이 판단할 자리를 기계가 먼저 밟는다.
 *   🔴 **추측 금지**: 권한이 없거나 못 물어보면 «확인 필요»로 남긴다. «아마 켜져 있을 것»은 상태가 아니다.
 *   키: Neon 은 `NEON_API_KEY` env 또는 `~/.neon-am-key` 파일(neon-migrate 와 같은 자리) · R2 는 `.env` R2_*.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { GetBucketVersioningCommand } from "@aws-sdk/client-s3";
import { getR2Client, r2Configured, R2_BUCKET } from "../lib/r2";
import { writeAudit } from "../lib/audit";
import { pgClient } from "../db/index";

const NEON_PROJECT = process.env.NEON_PROJECT_ID || "old-tree-90235056";
const KEY_PATH = [`${homedir()}/.neon-am-key`, "C:/Users/Administrator/.neon-am-key"].find(existsSync);

export interface BackupStatus {
  neon: { ok: boolean; retentionDays: number | null; detail: string };
  r2: { ok: boolean; versioning: string | null; detail: string };
}

function neonKey(): string {
  const env = String(process.env.NEON_API_KEY ?? "").trim();
  if (env) return env;
  try { return KEY_PATH ? readFileSync(KEY_PATH, "utf8").trim() : ""; } catch { return ""; }
}

/** Neon 프로젝트의 PITR 보존 기간(history_retention_seconds). 못 물어보면 ok:false + 사람말 사유. */
export async function checkNeon(): Promise<BackupStatus["neon"]> {
  const key = neonKey();
  if (!key) return { ok: false, retentionDays: null, detail: "Neon API 키가 없어 확인하지 못했어요(NEON_API_KEY 또는 ~/.neon-am-key)." };
  try {
    const r = await fetch(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(NEON_PROJECT)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return { ok: false, retentionDays: null, detail: `Neon 이 응답하지 않았어요(HTTP ${r.status}).` };
    const j = await r.json() as { project?: { history_retention_seconds?: number } };
    const sec = Number(j?.project?.history_retention_seconds ?? NaN);
    if (!Number.isFinite(sec)) return { ok: false, retentionDays: null, detail: "보존 기간 값을 읽지 못했어요." };
    const days = Math.round((sec / 86_400) * 10) / 10;
    // 🔴 «켜져 있다»의 기준은 0 초과다. 0 이면 시점 복구가 **안 된다** — 그걸 «설정됨»으로 적으면 거짓 안심이다.
    return { ok: sec > 0, retentionDays: days, detail: sec > 0 ? `시점 복구 ${days}일 보존` : "시점 복구가 꺼져 있어요(보존 0)." };
  } catch (e) {
    return { ok: false, retentionDays: null, detail: `Neon 조회 실패: ${String((e as Error)?.message ?? e).slice(0, 80)}` };
  }
}

/** R2 버킷 버전 관리(GetBucketVersioning). Enabled 가 아니면 «덮어쓰면 끝»이라는 뜻이다. */
export async function checkR2(): Promise<BackupStatus["r2"]> {
  if (!r2Configured()) return { ok: false, versioning: null, detail: "R2 설정이 없어 확인하지 못했어요(.env R2_*)." };
  try {
    const r = await getR2Client().send(new GetBucketVersioningCommand({ Bucket: R2_BUCKET }));
    const status = String(r.Status ?? "").trim() || "Disabled";   // 미설정이면 응답에 Status 가 없다 = 꺼짐
    return { ok: status === "Enabled", versioning: status, detail: status === "Enabled" ? "버전 관리 켜짐(덮어써도 이전 판이 남아요)" : "버전 관리가 꺼져 있어요(덮어쓰면 이전 판이 사라져요)." };
  } catch (e) {
    const err = e as { message?: string; name?: string; $metadata?: { httpStatusCode?: number } };
    const msg = String(err?.message ?? e);
    const code = Number(err?.$metadata?.httpStatusCode ?? 0);
    /* 🔴 «권한이 없어 못 물어봤다»와 «꺼져 있다»는 **다르다** — 섞으면 거짓 안심이 된다.
       ⚠️ 실측(2026-09-15): S3 오류 문구가 `Access Denied`(**공백 있음**)라 `AccessDenied` 패턴이 빗나가
          권한 문제가 «조회 실패»로 뭉뚱그려졌다. 이름·상태코드도 같이 본다(문구 한 가지에 기대지 않는다). */
    const denied = /access\s*denied|forbidden|notimplemented|unauthor/i.test(`${msg} ${err?.name ?? ""}`) || code === 401 || code === 403;
    return { ok: false, versioning: null,
      detail: denied ? "버전 관리를 조회할 권한이 없어요 — **확인 필요**(토큰 권한을 올리거나 콘솔에서 직접 확인)." : `R2 조회 실패: ${msg.slice(0, 80)}` };
  }
}

export async function runBackupCheck(): Promise<BackupStatus> {
  const [neon, r2] = await Promise.all([checkNeon(), checkR2()]);
  // 🔴 감사에 남기는 것이 곧 «마지막 확인 시각»이다(운영 화면이 이 행을 읽는다). await(계약 §0).
  await writeAudit({
    tenantId: null, action: "ops_backup_check", actorType: "system", target: "backup",
    detail: { neon, r2, project: NEON_PROJECT, bucket: R2_BUCKET },
    riskLevel: neon.ok && r2.ok ? "low" : "medium",
  });
  return { neon, r2 };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("check-backup.mts")) {
  const s = await runBackupCheck();
  const mark = (ok: boolean) => (ok ? "✓" : "✗");
  console.log(`\n── 백업·복구 확인 ──`);
  console.log(`  ${mark(s.neon.ok)} Neon 시점 복구(PITR): ${s.neon.detail}`);
  console.log(`  ${mark(s.r2.ok)} R2 버전 관리: ${s.r2.detail}`);
  console.log(`\n  (감사 ops_backup_check 1행 기록 — 운영센터가 이 시각을 «마지막 확인»으로 그린다)\n`);
  await pgClient.end({ timeout: 5 });
  process.exit(s.neon.ok && s.r2.ok ? 0 : 1);
}
