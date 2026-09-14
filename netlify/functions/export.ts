/**
 * 내보내기 API(계약 P1R6 §2.1):
 *   POST /api/export-start { kinds:["post","video","revenue"], from, to } → **202** { ok:true, started:true }
 *        · 이미 만드는 중이면 { ok:true, started:false, running:true }(횟수·자원을 갉아먹지 않는다 · topics-refresh 관례)
 *   GET  /api/export-status → { ok:true, export:{ running, startedAt, finishedAt, progress, url, expiresAt, bytes, files, error } }
 *   코인 0 · 하루 3회(감사 `export_start` COUNT · topics-refresh 와 같은 패턴) · `requireWritable`.
 *   🔴 만든 ZIP 은 **presigned 7일** — 만료된 링크는 `export-status` 가 아예 주지 않는다(죽은 «받기» 버튼 금지 · state.ts).
 */
import { sql } from "drizzle-orm";
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, requireWritable } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { q } from "../../lib/accounts";
import { readExportState, writeExportState, EXPORT_KINDS, type ExportKind } from "../../lib/export/state";
import { startExport } from "./export-background";

export const config = { path: ["/api/export-start", "/api/export-status"] };
/** netlify dev 정적 폴백(`.html` 재시도) 대비 — 꼬리를 떼고 맞춘다(AC-7). */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const PER_DAY = 3;
/** 한 번에 담을 수 있는 기간(일) — 넘으면 «기간을 좁혀 주세요»를 **시작 전에** 말한다(15분 쓰고 실패하지 않게). */
const MAX_RANGE_DAYS = 400;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 오늘(KST) 시작 횟수 — 감사 행이 곧 횟수. */
async function startsToday(tid: number): Promise<number> {
  const [r] = await q(sql`SELECT COUNT(*)::int AS c FROM audit_logs WHERE tenant_id = ${tid} AND action = 'export_start'
    AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date = (NOW() AT TIME ZONE 'Asia/Seoul')::date`);
  return Number(r?.c || 0);
}

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const path = routeOf(req);
  try {
    if (path.endsWith("/export-status")) {
      return json({ ok: true, export: await readExportState(tid) });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const w = await requireWritable(tid); if (!w.ok) return w.res;

    // 이미 만드는 중이면 횟수를 쓰지 않는다(중복 요청이 상한을 갉아먹지 않게 · topics-refresh 와 같은 모양).
    const cur = await readExportState(tid);
    if (cur.running) return json({ ok: true, started: false, running: true });

    const b = await readJson<{ kinds?: unknown; from?: unknown; to?: unknown }>(req);
    const kinds = (Array.isArray(b.kinds) ? b.kinds.map(String) : []).filter((k): k is ExportKind => (EXPORT_KINDS as readonly string[]).includes(k));
    if (!kinds.length) return badRequest("무엇을 내보낼지 골라 주세요.", "kinds");
    const from = String(b.from ?? ""), to = String(b.to ?? "");
    if (!DAY_RE.test(from) || !DAY_RE.test(to)) return badRequest("기간을 골라 주세요.", "range");
    if (from > to) return badRequest("시작일이 종료일보다 뒤예요.", "range");
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (days > MAX_RANGE_DAYS) return json({ ok: false, step: "range", error: `한 번에 ${MAX_RANGE_DAYS}일까지 담을 수 있어요. 기간을 좁혀 주세요.` }, 400);

    const used = await startsToday(tid);
    if (used >= PER_DAY) return json({ ok: false, step: "rate_limit", error: `내보내기는 하루 ${PER_DAY}번까지예요. 내일 다시 할 수 있어요.` }, 429);
    // 감사 행이 곧 횟수 — 시작 전에 먼저 적는다(실패해도 횟수는 쓴 것 · 자원이 나갔다). 🔴 await(AC 신규 규율 · `void writeAudit` 금지).
    await writeAudit({ tenantId: tid, action: "export_start", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: { n: used + 1, kinds, from, to, days } });

    // 🔴 이전 결과(url·bytes)를 지우고 시작한다 — 안 지우면 «만드는 중»인데 옛 링크가 같이 보인다(무엇을 받는지 헷갈린다).
    const startedAt = new Date().toISOString();
    await writeExportState(tid, { running: true, startedAt, kinds, from, to, retry: 0,
      progress: { step: "준비", done: 0, total: 0, at: startedAt },
      finishedAt: undefined, url: undefined, expiresAt: undefined, key: undefined, bytes: undefined, files: undefined, error: undefined });

    // 🔴 claim = 방금 쓴 startedAt — 배경 함수가 «내가 그 실행이다» 를 알아본다(안 넘기면 자기 잠금에 자기가 막힌다).
    const st = await startExport(tid, false, startedAt);
    if (!st.started) {
      await writeExportState(tid, { running: false, finishedAt: new Date().toISOString(), error: st.error ?? "내보내기를 시작하지 못했어요." });
      return json({ ok: false, step: "start", error: st.error ?? "내보내기를 시작하지 못했어요." }, 502);
    }
    return json({ ok: true, started: true, running: true }, 202);
  } catch (err) {
    return jsonError("export", err);
  }
};
