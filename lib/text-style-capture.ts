/**
 * lib/text-style-capture.ts — **러너 캡처 보고 → AI 비전 읽기 → 스타일 저장 → 캡처 폐기**(R10-1·2 · 설계 §3.1~§3.5 · B · 2026-09-16).
 *   🔎 출처: AC 신규(AM 원본 없음). 잡 계약(B2↔B): kind `reference.capture` · payload `{url, accountId, width:430, maxShots:6, overlapPct:12, viewportsPerShot:1.5}` ·
 *   보고 OK `{ ok:true, shots:[{ i, mime, data(base64), w, h, y0, y1 }], page:{ height, finalUrl, count, quality, overlapPct } }` · FAIL `{ ok:false, errorKind: login_wall|blocked|not_found|timeout|nav, detail }`.
 *
 *   ══ 🔴 안전선 셋 ══
 *     ① **캡처는 여기서 읽고 즉시 버린다** — 이 함수가 끝나면 base64 는 사라진다. `runner_jobs.result` 엔 `{ ok, styleId, shots: n, page }` 만(그림 0) · R2 0 · 로그엔 장수·크기만.
 *     ② 저장은 `createTextStyle` 한 곳(소독기 강제) — 문장 0.
 *     ③ 못 열었으면 «못 열었어요»를 사유 그대로 잡에 남긴다(login_wall 이면 화면이 «화면을 찍어 올려 주세요»로 안내 · 막지 않는다).
 *   🔴 이 잡은 발행 전이표를 타지 않는다 — 남의 글을 못 연 것은 **계정 잘못이 아니다**(계정 상태·건강 점수 무변경).
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { jsonb } from "./db-util";
import { writeAudit } from "./audit";
import { readTextStyleFromShots, type StyleShot } from "./text-style-read";
import { createTextStyle } from "./text-style-store";

type Row = Record<string, unknown>;
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** B2 와 합의한 크기 벽(Netlify 본문 6MB) — 넘으면 «너무 커요»로 정직하게 실패(자르지 않는다 · 반쪽 캡처는 틀린 값이다). */
export const SHOT_MAX_B64 = 800_000;
export const SHOTS_MAX_TOTAL_B64 = 4_500_000;
export const SHOTS_MAX = 6;
export const CAPTURE_FAIL_KINDS: readonly string[] = ["login_wall", "blocked", "not_found", "timeout", "nav", "bad_shots", "ai", "store"];

export interface CaptureJob { id: number; tenantId: number; accountId: number | null; payload: Record<string, unknown>; attempts: number }
export interface CaptureOutcome { ok: boolean; status: "done" | "failed"; reason?: string }

/** 러너 보고의 shots 를 **믿지 않고** 잰다 — 장수·mime·크기. 어긋나면 사유와 함께 null. */
export function validateShots(raw: unknown): { shots: StyleShot[] } | { error: string } {
  if (!Array.isArray(raw) || !raw.length) return { error: "찍은 화면이 없어요." };
  if (raw.length > SHOTS_MAX) return { error: `화면이 너무 많아요(${raw.length}장 · 최대 ${SHOTS_MAX}장).` };
  const shots: StyleShot[] = [];
  let total = 0;
  for (const s of raw) {
    const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const mime = String(o.mime ?? "").toLowerCase();
    const data = String(o.data ?? "");
    if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") return { error: "화면 파일 형식이 맞지 않아요(jpeg·png·webp)." };
    if (!data || !/^[A-Za-z0-9+/=\r\n]+$/.test(data.slice(0, 200))) return { error: "화면 데이터를 읽지 못했어요." };
    if (data.length > SHOT_MAX_B64) return { error: "화면 한 장이 너무 커요." };
    total += data.length;
    if (total > SHOTS_MAX_TOTAL_B64) return { error: "화면 합계가 너무 커요." };
    shots.push({ mime, data, ...(Number.isFinite(Number(o.h)) ? { h: Number(o.h) } : {}), ...(Number.isFinite(Number(o.i)) ? { i: Number(o.i) } : {}) });
  }
  shots.sort((a, b) => (a.i ?? 0) - (b.i ?? 0));
  return { shots };
}

async function failJob(job: CaptureJob, errorKind: string, detail: string): Promise<CaptureOutcome> {
  const kind = CAPTURE_FAIL_KINDS.includes(errorKind) ? errorKind : "nav";
  await q(sql`UPDATE runner_jobs SET status = 'failed', claimed_by = NULL, claimed_at = NULL, error_kind = ${kind},
      result = ${jsonb({ ok: false, errorKind: kind, detail: detail.slice(0, 300), attempts: job.attempts })}, due_at = NULL, updated_at = NOW() WHERE id = ${job.id}`);
  await writeAudit({ tenantId: job.tenantId, action: "style_reference_failed", actorType: "system", target: `runner_job:${job.id}`,
    detail: { errorKind: kind, detail: detail.slice(0, 200), accountId: job.accountId }, riskLevel: "low" }).catch(() => {});
  return { ok: true, status: "failed", reason: kind };
}

/**
 * 러너 보고 처리 — `reportJob` 이 kind 로 갈라 여기로 넘긴다. 🔴 캡처 base64 는 이 함수 밖으로 나가지 않는다.
 *   성공: 읽기 → 저장 → 잡 done(`{ ok, styleId, shots: n, page }`) → 감사 → 알림(«스타일을 배웠어요»).
 */
export async function handleReferenceCaptureReport(job: CaptureJob, result: Record<string, unknown>): Promise<CaptureOutcome> {
  const url = String(job.payload.url ?? "").trim();
  if (result.ok !== true) {
    const ek = String(result.errorKind ?? "nav");
    const detail = String(result.detail ?? "");
    return failJob(job, ek, detail || "그 주소를 열지 못했어요.");
  }
  const v = validateShots(result.shots);
  if ("error" in v) return failJob(job, "bad_shots", v.error);
  const page = (result.page && typeof result.page === "object" ? result.page : {}) as Record<string, unknown>;
  console.info(`[text-style] 캡처 ${v.shots.length}장 받음(합계 ${Math.round(v.shots.reduce((a, s) => a + s.data.length, 0) / 1024)}KB · 페이지 ${n(page.height)}px) — 읽고 버린다`);

  const read = await readTextStyleFromShots(job.tenantId, v.shots, { ref: `style:${job.tenantId}:${job.id}` });
  if (!read.ok) return failJob(job, "ai", read.error);
  const saved = await createTextStyle({ tenantId: job.tenantId, accountId: job.accountId, from: "url", sourceUrl: url, raw: read.raw, shots: v.shots.length });
  if (!saved.ok) return failJob(job, "store", saved.error);

  /* 🔴 result 에 그림은 없다 — 장수·높이·품질 숫자만. */
  await q(sql`UPDATE runner_jobs SET status = 'done', error_kind = NULL,
      result = ${jsonb({ ok: true, styleId: saved.row.id, shots: v.shots.length, page: { height: n(page.height), count: n(page.count) || v.shots.length, quality: n(page.quality), overlapPct: n(page.overlapPct) } })},
      updated_at = NOW() WHERE id = ${job.id}`);
  await writeAudit({ tenantId: job.tenantId, action: "style_reference_done", actorType: "system", target: `text_style:${saved.row.id}`,
    detail: { jobId: job.id, shots: v.shots.length, accountId: job.accountId, already: saved.already === true }, riskLevel: "low" }).catch(() => {});
  try {
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
      VALUES (${job.tenantId}, ${"style_learned"}, ${"글 스타일을 배웠어요"},
              ${`«${saved.row.name}» — ${saved.row.summary.slice(0, 3).join(" · ") || "모양을 숫자로 적어 뒀어요"}. 계정에 걸어 두면 다음 글부터 이 모양으로 써요.`},
              ${"/app/accounts.html"})`);
  } catch (e) { console.error("[text-style] 알림 실패(비치명)", String((e as Error)?.message ?? e).slice(0, 100)); }
  return { ok: true, status: "done" };
}
