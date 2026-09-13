/**
 * lib/audit.ts — 감사 로그 단일 헬퍼. AM 원본: ../AutoMarketing/lib/audit.ts (복사 2026-09-14 · actor_type 추가·bg_runs 미러 제거)
 *   실패는 비치명적(throw 금지). 반환 = 기입한 행 id(실패 null). jsonb 는 sql.json (PITFALLS #1).
 */
import { db } from "../db/index";
import { sql } from "drizzle-orm";
import { jsonb } from "./db-util";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export interface AuditEntry {
  tenantId: number | null;
  action: string;
  actorType?: "user" | "operator" | "system";
  actorId?: number | null;
  target?: string | null;
  detail?: Record<string, unknown> | null;
  riskLevel?: RiskLevel;
  ip?: string | null;
}

export async function writeAudit(e: AuditEntry): Promise<number | null> {
  const { tenantId, action, actorType = "system", actorId = null, target = null, detail = null, riskLevel = "low", ip = null } = e;
  try {
    const rows = await db.execute(sql`
      INSERT INTO audit_logs (tenant_id, actor_type, actor_id, action, target, detail, risk_level, ip, created_at)
      VALUES (${tenantId}, ${actorType}, ${actorId}, ${action}, ${target},
              ${detail === null ? null : jsonb(detail)}, ${riskLevel}, ${ip}, NOW())
      RETURNING id`);
    const row = (rows as unknown as Record<string, unknown>[])[0];
    return row ? Number(row.id) : null;
  } catch (err) {
    console.error(`[audit] write failed action=${action}:`, err);
    return null;
  }
}
