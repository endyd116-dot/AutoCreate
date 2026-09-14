/**
 * POST /api/export-background { tenantId, retry? } — Netlify **background**(파일명 -background · 202 즉시 · 15분). 계약 P1R6 §2.1.
 *   호출 = `export-start`(사람) · 내부 재시도(자기 자신). 둘 다 서버 내부(`x-internal-secret` · 폴백 0).
 *
 *   R5 체인 규율 그대로:
 *     · **하트비트** — `settings.export.progress{step,done,total,at}`(«영상 3/12»)를 단계마다 찍는다.
 *     · **잠금** — 살아 있는 실행(20분)이 있으면 즉시 반환. 같은 ZIP 을 두 번 굽지 않는다(R2 요금·시간 두 배 금지).
 *     · **다시 걸기** — 🔴 ZIP 은 **부분 재개가 불가능**하다(스트림 한 줄기). 그래서 «이어달리기» 대신
 *       «처음부터 다시»(상한 `RETRY_MAX`)다. 상한을 넘으면 사람말 사유로 끝낸다 — **조용한 정지 0**(AC-16).
 *   끝: 알림 `export_ready`(홈 «해야 할 일» 이 이 알림을 읽는다) + presigned 7일 URL 을 상태에 남긴다.
 */
import { buildExport } from "../../lib/export/build";
import { readExportState, writeExportState, humanExportError, RETRY_MAX, EXPORT_KINDS, type ExportKind } from "../../lib/export/state";
import { writeAudit } from "../../lib/audit";
import { q } from "../../lib/accounts";
import { sql } from "drizzle-orm";

export const config = { path: "/api/export-background" };

const jres = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export default async (req: Request): Promise<Response> => {
  const secret = String(process.env.INTERNAL_SECRET ?? "").trim();
  if (!secret) { console.error("[export-background] INTERNAL_SECRET 미설정"); return jres({ ok: false, step: "config" }, 500); }
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if ((req.headers.get("x-internal-secret") || "") !== secret) return jres({ ok: false, step: "auth" }, 401);

  let body: { tenantId?: number; retry?: boolean } = {};
  try { body = await req.json(); } catch { /* */ }
  const tid = Number(body.tenantId || 0);
  if (!tid) return jres({ ok: false, step: "validate" }, 400);

  const st = await readExportState(tid);
  /* 잠금 — `running` 은 «살아 있는 실행»을 뜻한다(고아 20분은 state 가 읽을 때 접는다).
     다시 걸기(retry)는 자기 자신이 부른 것이므로 이 잠금을 통과해야 한다. */
  if (!body.retry && st.running && st.progress && Date.now() - Date.parse(st.progress.at || "") < 60_000) {
    console.log(`[export-background] t${tid} 이미 실행 중 — 건너뜀`);
    return jres({ ok: true, skipped: "running" });
  }
  const kinds = (st.kinds ?? []).filter((k): k is ExportKind => (EXPORT_KINDS as readonly string[]).includes(k));
  const from = st.from ?? "", to = st.to ?? "";
  if (!kinds.length || !from || !to) {
    await writeExportState(tid, { running: false, finishedAt: new Date().toISOString(), error: "무엇을·언제 것을 담을지 정보가 없어요. 다시 시작해 주세요." });
    return jres({ ok: false, step: "state" }, 200);
  }

  const t0 = Date.now();
  try {
    const r = await buildExport({ tenantId: tid, kinds, from, to });
    await writeExportState(tid, { running: false, finishedAt: new Date().toISOString(), url: r.url, expiresAt: r.expiresAt, key: r.key, bytes: r.bytes, files: r.files, error: undefined,
      progress: { step: "완료", done: 1, total: 1, at: new Date().toISOString() } });
    // 알림 — 홈 «해야 할 일» 이 이 행을 읽는다(조용한 완료 0). 🔴 await(`void` 금지 · AC 신규 규율).
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"export_ready"}, ${"내보낼 자료가 준비됐어요"},
      ${`${from} ~ ${to} 자료 ${r.files}개(${Math.round(r.bytes / (1024 * 1024))}MB) · 7일 안에 받아 주세요.`}, ${"/app/settings.html#export"})`);
    await writeAudit({ tenantId: tid, action: "export_ready", actorType: "system", detail: { key: r.key, bytes: r.bytes, files: r.files, kinds, from, to, sec: Math.round((Date.now() - t0) / 1000) } });
    console.log(`[export-background] t${tid} 완료 ${r.files}개 · ${Math.round(r.bytes / (1024 * 1024))}MB · ${Math.round((Date.now() - t0) / 1000)}s`);
    return jres({ ok: true, bytes: r.bytes, files: r.files });
  } catch (e) {
    const human = humanExportError(e);
    const retried = Number(st.retry ?? 0);
    /* 🔴 «기간을 좁혀 주세요» 류(용량·시간 초과)는 **다시 걸어도 같은 결과**다 — 재시도하지 않고 바로 사람에게 말한다.
       그 밖(네트워크·일시 오류)만 상한 안에서 다시 건다. */
    const retriable = !/기간을 좁혀/.test(human) && retried < RETRY_MAX;
    console.error(`[export-background] t${tid} 실패(${retried + 1}/${RETRY_MAX + 1}): ${String((e as Error)?.message ?? e).slice(0, 200)}`);
    if (retriable) {
      await writeExportState(tid, { retry: retried + 1, progress: { step: "다시 시도", done: 0, total: 0, at: new Date().toISOString() } });
      const fired = await startExport(tid, true);
      if (fired.started) return jres({ ok: false, retrying: true }, 200);
    }
    await writeExportState(tid, { running: false, finishedAt: new Date().toISOString(), error: human,
      progress: { step: "실패", done: 0, total: 0, at: new Date().toISOString() } });
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"export_failed"}, ${"내보내기를 마치지 못했어요"}, ${human.slice(0, 200)}, ${"/app/settings.html#export"})`);
    await writeAudit({ tenantId: tid, action: "export_failed", actorType: "system", riskLevel: "medium", detail: { error: human, retried, kinds, from, to } });
    return jres({ ok: false, error: human }, 200);
  }
};

/**
 * 배경 함수 착수(계약 §2.1 · AC-16: **실패를 삼키지 않는다**).
 *   netlify dev 는 background 를 동기 실행하므로 타임아웃은 «닿았다»로 본다(AC-12 · R5 `triggerVideo` 와 같은 관례).
 */
export async function startExport(tid: number, retry: boolean): Promise<{ started: boolean; error?: string }> {
  const secret = String(process.env.INTERNAL_SECRET ?? "").trim();
  const site = String(process.env.SITE_URL ?? "").replace(/\/$/, "");
  if (!secret || !site) {
    const missing = !secret ? "INTERNAL_SECRET" : "SITE_URL";
    console.error(`[export] ${missing} 미설정 — 배경 호출 불가`);
    return { started: false, error: "서버 설정이 아직이라 내보내기를 시작하지 못했어요." };
  }
  try {
    const r = await fetch(`${site}/api/export-background`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({ tenantId: tid, retry }), signal: AbortSignal.timeout(6_000),
    });
    if (r.status !== 202 && !r.ok) { console.error(`[export] 배경 함수 호출 ${r.status}`); return { started: false, error: "내보내기를 시작하지 못했어요. 잠시 뒤 다시 해 주세요." }; }
    return { started: true };
  } catch (e) {
    const err = e as Error;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") return { started: true };   // 배경은 오래 돈다 — 닿은 것으로 본다
    console.error("[export] 배경 함수 호출 실패", String(err?.message ?? e).slice(0, 160));
    return { started: false, error: "내보내기를 시작하지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
}
