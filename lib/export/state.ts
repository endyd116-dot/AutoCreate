/**
 * lib/export/state.ts — 내보내기 **배경 실행 상태** 정본(계약 P1R6 §2.1 · `lib/topics-refresh-state.ts` 관례 그대로).
 *   상태는 `tenants.settings.export` 한 칸(jsonb). 새 표를 만들지 않은 이유는 소재 뽑기와 같다 —
 *   테넌트당 항상 1건이고 화면은 `export-status` 하나만 폴링한다. (R6 DDL 0010 은 B 몫이라 그쪽과 겹치지도 않는다.)
 *
 *   🔴 **고아 방지**: 배경 함수가 죽어도 «만드는 중»이 영원히 남으면 버튼이 다시 안 눌린다.
 *      `startedAt` 이 `STALE_MIN` 을 넘으면 **읽을 때** running=false 로 접는다(저장값은 고치지 않는다).
 *   🔴 **잠금**(§1.4 R5 규율): 살아 있는 실행(20분 안)이 있으면 두 번째 착수는 즉시 반환 — 같은 ZIP 을 두 번 굽지 않는다.
 *   🔴 `error` 는 **사람말 한 문장**만 담는다(화면이 그대로 띄운다).
 *   ⚠️ ZIP 은 **부분 재개가 불가능**하다(스트림 한 줄기라 중간부터 이어 붙일 수 없다) —
 *      R5 의 «이어달리기» 자리에 해당하는 것은 «처음부터 다시 걸기»(상한 `RETRY_MAX`)다. 조용한 정지는 없다.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { jsonb } from "../db-util";

/** 이만큼 지나면 «죽은 것»으로 본다(화면도 같은 값으로 스스로 멈춘다). */
export const STALE_MIN = 20;
/** 다시 걸기 상한(R5 `CHAIN_RESUME_MAX` 와 같은 결). */
export const RETRY_MAX = 2;
/** 배경 함수 15분 벽 − 업로드 마무리 여유. 넘으면 «기간을 좁혀 주세요». */
export const EXPORT_BUDGET_MS = (() => { const v = Number(process.env.EXPORT_BUDGET_MS); return Number.isFinite(v) && v >= 10_000 ? Math.floor(v) : 11 * 60_000; })();

export type ExportKind = "post" | "video" | "revenue";
export const EXPORT_KINDS: readonly ExportKind[] = ["post", "video", "revenue"];

export interface ExportState {
  running: boolean;
  startedAt?: string;
  finishedAt?: string;
  /** 사람이 읽는 진행(«영상 3/12») — 하트비트. */
  progress?: { step: string; done: number; total: number; at: string };
  kinds?: ExportKind[];
  from?: string;
  to?: string;
  /** presigned GET(7일). 만료되면 화면이 «다시 만들기» 로 돌아간다. */
  url?: string;
  expiresAt?: string;
  key?: string;
  bytes?: number;
  files?: number;
  retry?: number;
  error?: string;
}

/** 저장된 원시값 → 화면이 쓰는 모양. 고아·만료는 여기서 접는다. */
export function toExportState(raw: unknown): ExportState {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const startedAt = typeof r.startedAt === "string" ? r.startedAt : undefined;
  let running = r.running === true;
  if (running && startedAt) {
    const t = Date.parse(startedAt);
    if (!Number.isFinite(t) || Date.now() - t > STALE_MIN * 60_000) running = false;      // 고아
  } else if (running && !startedAt) running = false;
  const out: ExportState = { running };
  if (startedAt) out.startedAt = startedAt;
  if (typeof r.finishedAt === "string") out.finishedAt = r.finishedAt;
  if (r.progress && typeof r.progress === "object") {
    const p = r.progress as Record<string, unknown>;
    out.progress = { step: String(p.step ?? ""), done: Number(p.done ?? 0) || 0, total: Number(p.total ?? 0) || 0, at: String(p.at ?? "") };
  }
  if (Array.isArray(r.kinds)) out.kinds = (r.kinds as unknown[]).map(String).filter((k): k is ExportKind => (EXPORT_KINDS as readonly string[]).includes(k));
  if (typeof r.from === "string") out.from = r.from;
  if (typeof r.to === "string") out.to = r.to;
  if (typeof r.key === "string") out.key = r.key;
  if (Number.isFinite(Number(r.bytes))) out.bytes = Number(r.bytes);
  if (Number.isFinite(Number(r.files))) out.files = Number(r.files);
  if (Number.isFinite(Number(r.retry))) out.retry = Number(r.retry);
  if (typeof r.error === "string" && r.error.trim()) out.error = r.error.slice(0, 300);
  // 🔴 만료된 링크는 **주지 않는다** — 화면이 죽은 주소로 «받기» 를 그리면 사용자가 우리를 못 믿게 된다.
  const exp = typeof r.expiresAt === "string" ? Date.parse(r.expiresAt) : NaN;
  if (typeof r.url === "string" && Number.isFinite(exp) && exp > Date.now()) { out.url = r.url; out.expiresAt = String(r.expiresAt); }
  else if (Number.isFinite(exp)) out.expiresAt = String(r.expiresAt);
  return out;
}

export async function readExportState(tid: number): Promise<ExportState> {
  try {
    const [t] = await q(sql`SELECT settings->'export' AS s FROM tenants WHERE id = ${tid}`);
    return toExportState(t?.s);
  } catch { return { running: false }; }
}

/** 상태 쓰기 — `settings.export` 한 칸만 바꾼다(다른 설정을 덮어쓰지 않게 jsonb 병합 · PITFALLS #1). */
export async function writeExportState(tid: number, patch: Partial<ExportState>): Promise<void> {
  const cur = (await q(sql`SELECT settings->'export' AS s FROM tenants WHERE id = ${tid}`))[0]?.s;
  const base = (cur && typeof cur === "object" && !Array.isArray(cur) ? cur : {}) as Record<string, unknown>;
  const next = { ...base, ...patch };
  await q(sql`UPDATE tenants SET settings = COALESCE(settings, '{}'::jsonb) || ${jsonb({ export: next })}, updated_at = NOW() WHERE id = ${tid}`);
  const [chk] = await q(sql`SELECT jsonb_typeof(settings->'export') AS t FROM tenants WHERE id = ${tid}`);
  if (chk?.t !== "object") console.error("[export/state] jsonb_typeof(settings->export) !== object", chk);
}

/** 하트비트 — 단계·진행을 남긴다(화면이 «영상 3/12» 를 그린다). */
export async function stampProgress(tid: number, step: string, done: number, total: number): Promise<void> {
  await writeExportState(tid, { progress: { step, done, total, at: new Date().toISOString() } });
}

/** 실패 사유 → 사람말 한 문장(화면이 그대로 띄운다). 🔴 「fetch failed」 같은 건 넣지 않는다. */
export function humanExportError(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  if (/기간을 좁혀|ZIP64|용량|한도/.test(msg)) return msg.replace(/^\[[^\]]+\]\s*/, "").slice(0, 200);
  if (/R2|멀티파트|업로드|파트/i.test(msg)) return "파일을 저장하는 중에 문제가 생겼어요. 잠시 뒤 다시 해 주세요.";
  if (/fetch|ENOTFOUND|ECONNRESET|network|timeout|abort/i.test(msg)) return "네트워크가 불안정해서 자료를 다 모으지 못했어요. 잠시 뒤 다시 해 주세요.";
  return "내보내기 중에 문제가 생겼어요. 잠시 뒤 다시 해 주세요.";
}
