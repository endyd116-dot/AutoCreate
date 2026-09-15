/**
 * lib/slot-gate.ts — 🔴 **슬롯 없는 자동 생성 차단 게이트**(CLAUDE §4.7 절대 게이트 · DESIGN §5B.6 · PITFALLS AC-2).
 *   AM 원본: ../AutoMarketing/lib/content-slot-gate.ts (이식 2026-09-14 · 표 이름 topic_slots→slots · 상태 어휘를 §5B.6 로 교체 · SlotPool·loadOpenSlots 는 AC 의 produce 가 슬롯에서 출발하므로 불필요해 뺐다)
 *
 *   ══ 왜 있나 ══
 *     AM 에서 «주 0회로 뒀는데 글이 계속 만들어지는» 사고가 났다. 원인은 «몇 회·어느 채널»의 정본이 여러 곳에
 *     흩어져 서로를 모른 것. AC 는 정본이 슬롯 하나다 — 그래서 문을 하나로 좁힌다:
 *       **자동 경로가 piece 1행을 만들려면 «어느 편성 슬롯의 몫인지» 말해야 한다. 말하지 못하면 거부하고 사유를 남긴다.**
 *
 *   ══ 거부를 조용히 하지 않는다 ══
 *     거부 로그가 곧 «아직 살아 있는 구 경로»의 증거다. 세 곳에 동시에 남는다:
 *       ① `audit_logs`(action `piece_slotless_blocked` · risk high) ② 크론 콘솔 ③ 홈 «해야 할 일»(`pendingSlotGateBlocks`).
 *     «조용히 0건» 은 이 프로젝트가 반복해 당한 사고 클래스다(PITFALLS #7).
 *
 *   ══ 사람 경로는 예외 ══
 *     사람이 «이대로 만들기»를 누른 건 편성표의 통제 대상이 아니다(사람이 곧 편성자다) — `origin:"manual"` 통과.
 *     ⚠️ 기본값은 `"auto"`(fail-closed). 새 호출부가 아무 말 안 하면 게이트를 **탄다**. 빼먹으면 열리는 설계는 결국 열린다.
 *
 *   ══ 되돌리기 레버 ══
 *     env `SLOT_GATE=off` — 끈다. 단 **조용히 열리지 않는다**: 통과할 때마다 `piece_slotless_bypassed`(risk critical).
 *     배포 없이 콘텐츠 침묵을 되돌리는 안전핀이지 상시 우회로가 아니다.
 *
 *   graceful: 어떤 함수도 throw 하지 않는다(게이트 장애가 콘텐츠를 죽이면 안 된다).
 *     ⚠️ 단 «조회 실패»는 통과로 접지 않는다 — 판정 불가는 `gate_unavailable` 로 **닫는다**(열어 두면 DB 가 흔들릴 때마다 구 경로가 부활한다).
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { writeAudit } from "./audit";

/** 이 생성이 «사람이 시킨 것»인가 «시스템이 스스로 도는 것»인가. 기본 auto(fail-closed). */
/**
 * 글이 만들어진 길(DESIGN §5D) — `auto`(편성표가 만든다) · `manual`(사람이 «만들기»를 눌러 AI 가 쓴다) · `self`(**사람이 직접 쓴다** · AI 0).
 *   🔴 `self` 는 성과 원장에서 «사람이 쓴 글»과 «AI 가 쓴 글»을 가르는 값이기도 하다(§5F).
 */
export type PieceOrigin = "auto" | "manual" | "self";

export interface SlotGateInput {
  tenantId: number;
  channel: string;
  /** 기본 'auto' — 명시하지 않으면 게이트를 탄다. */
  origin?: PieceOrigin;
  /** 편성 슬롯 id. auto 인데 없으면 거부. */
  slotId?: number | null;
  /** 어느 코드 경로가 불렀나 — 거부 로그의 핵심 정보. */
  source: string;
  topic?: string | null;
}

export type SlotGateCode = "no_slot" | "slot_not_found" | "slot_taken" | "slot_wrong_channel" | "slot_bad_status" | "gate_unavailable";

export interface SlotGateResult {
  ok: boolean;
  slotId: number | null;
  /** 거부 사유(사람이 읽는 한국어). ok=true 면 undefined. */
  reason?: string;
  code?: SlotGateCode;
  /** 안전핀(env)으로 통과했나 — true 면 «정상 통과»가 아니다. */
  bypassed?: boolean;
}

/** 게이트가 살아 있는가(env 안전핀). 기본 on. */
export function slotGateEnabled(): boolean {
  return String(process.env.SLOT_GATE ?? "on").trim().toLowerCase() !== "off";
}

/**
 * 아직 글이 안 붙은 편성 자리로 볼 수 있는 상태(§5B.6).
 *   `coin_short`·`no_topic` 은 «보류»지 «끝난 칸»이 아니다 — 코인이 차거나 소재가 생기면 그 자리에서 다시 만든다.
 *   `producing` 이후(in_review·approved·scheduled·publishing·published·skipped·failed·reassigned·awaiting_*)는 받지 않는다.
 */
export const OPEN_SLOT_STATUS: ReadonlySet<string> = new Set(["planned", "topic_assigned", "coin_short", "no_topic"]);

/**
 * guardSlot — 자동 생성 1건이 편성표의 몫인지 판정한다(**piece INSERT 직전에** 부른다).
 *   ⚠️ 생성(LLM·이미지)까지 다 해 놓고 저장 직전에 막으면 돈만 쓴다 — 크론은 슬롯에서 출발하므로 시작점에서도 한 번 본다(이중 확인).
 */
export async function guardSlot(input: SlotGateInput): Promise<SlotGateResult> {
  const tenantId = Math.floor(Number(input.tenantId) || 0);
  /* 🔴 `self` 도 사람 경로다 — 슬롯이 붙어 있으면 존중하고 없으면 없는 대로 통과(자동 생성 게이트는 «자동»만 막는다). */
  const origin: PieceOrigin = input.origin === "manual" ? "manual" : input.origin === "self" ? "self" : "auto";
  const channel = String(input.channel ?? "").trim();
  const slotId = Math.floor(Number(input.slotId) || 0) || null;

  // 사람 경로 = 예외. 슬롯이 붙어 있으면 그대로 존중하고, 없으면 없는 대로 통과.
  if (origin === "manual" || origin === "self") return { ok: true, slotId };

  if (tenantId <= 0) return { ok: false, slotId: null, code: "gate_unavailable", reason: "어느 집 글인지 알 수 없어 편성표와 대조하지 못했어요." };

  if (!slotId) {
    const reason = "편성표에 없는 자동 생성이에요 — 편성 슬롯의 몫만 만듭니다.";
    if (!slotGateEnabled()) return await bypass(tenantId, input, "no_slot", reason);
    await logBlock(tenantId, input, "no_slot", reason);
    return { ok: false, slotId: null, code: "no_slot", reason };
  }

  let row: Record<string, unknown> | undefined;
  try {
    [row] = await q(sql`SELECT id, channel, status, piece_id FROM slots WHERE id = ${slotId} AND tenant_id = ${tenantId} LIMIT 1`);
  } catch (e) {
    // 판정 불가는 «통과»가 아니다 — 닫는다.
    const reason = `편성 대조를 못 했어요(${String((e as Error)?.message ?? e).slice(0, 60)}).`;
    if (!slotGateEnabled()) return await bypass(tenantId, input, "gate_unavailable", reason);
    await logBlock(tenantId, input, "gate_unavailable", reason);
    return { ok: false, slotId: null, code: "gate_unavailable", reason };
  }

  let bad: { code: SlotGateCode; reason: string } | null = null;
  if (!row) bad = { code: "slot_not_found", reason: `편성 자리 #${slotId} 이 없어요(다른 집 것이거나 지워졌어요).` };
  else if (channel && String(row.channel) !== channel) bad = { code: "slot_wrong_channel", reason: `편성 자리 #${slotId} 은 ${row.channel} 자리인데 ${channel} 글을 넣으려 했어요.` };
  else if (row.piece_id) bad = { code: "slot_taken", reason: `편성 자리 #${slotId} 은 이미 다른 글이 차지했어요.` };
  else if (!OPEN_SLOT_STATUS.has(String(row.status))) bad = { code: "slot_bad_status", reason: `편성 자리 #${slotId} 은 '${row.status}' 라 새 글을 받지 않아요.` };

  if (bad) {
    if (!slotGateEnabled()) return await bypass(tenantId, input, bad.code, bad.reason);
    await logBlock(tenantId, input, bad.code, bad.reason);
    return { ok: false, slotId: null, code: bad.code, reason: bad.reason };
  }
  return { ok: true, slotId };
}

/** 거부 1건 기록 — 원장 + 콘솔. 감사 실패해도 판정은 그대로(감사 장애가 게이트를 열지 않는다). */
async function logBlock(tenantId: number, input: SlotGateInput, code: string, reason: string): Promise<void> {
  console.warn(`[slot-gate] BLOCKED source=${input.source} tenant=${tenantId} channel=${input.channel} code=${code} — ${reason}`);
  await writeAudit({
    tenantId, action: "piece_slotless_blocked", actorType: "system", target: `channel:${input.channel || "?"}`, riskLevel: "high",
    detail: { source: input.source, channel: input.channel, code, reason, topic: String(input.topic ?? "").slice(0, 200) || null, slotId: input.slotId ?? null },
  }).catch(() => { /* 비치명 */ });
}

/** 안전핀(env=off) 통과 — 통과시키되 **크게** 남긴다. 조용한 우회로를 만들지 않는다. */
async function bypass(tenantId: number, input: SlotGateInput, code: string, reason: string): Promise<SlotGateResult> {
  console.warn(`[slot-gate] BYPASSED(env SLOT_GATE=off) source=${input.source} tenant=${tenantId} code=${code}`);
  await writeAudit({
    tenantId, action: "piece_slotless_bypassed", actorType: "system", target: `channel:${input.channel || "?"}`, riskLevel: "critical",
    detail: { source: input.source, channel: input.channel, code, reason },
  }).catch(() => { /* 비치명 */ });
  return { ok: true, slotId: Math.floor(Number(input.slotId) || 0) || null, bypassed: true };
}

export interface SlotBlockSummary {
  blocked: number;
  /** 안전핀으로 통과한 수 — 0 이 아니면 게이트가 사실상 꺼져 있다는 뜻. */
  bypassed: number;
  /** 어떤 경로가 몇 번 막혔나 — «아직 살아 있는 구 경로» 목록. */
  bySource: { source: string; count: number; lastReason: string }[];
  sinceIso: string;
}

/**
 * summarizeSlotBlocks — 거부 로그 집계(홈 «해야 할 일»·운영 브리핑 공용 단일 출처).
 *   조회 실패는 blocked=0 으로 돌아온다 — 호출부는 blocked>0 일 때만 줄을 만든다(«못 셌다»를 «0건»으로 그리지 않는다).
 */
export async function summarizeSlotBlocks(tenantId: number, sinceDays = 7): Promise<SlotBlockSummary> {
  const tid = Math.floor(Number(tenantId) || 0);
  const days = Math.max(1, Math.min(Math.floor(Number(sinceDays) || 7), 90));
  const out: SlotBlockSummary = { blocked: 0, bypassed: 0, bySource: [], sinceIso: new Date(Date.now() - days * 86400_000).toISOString() };
  if (tid <= 0) return out;
  try {
    const rows = await q(sql`
      SELECT action, COALESCE(detail->>'source','?') AS source, COUNT(*)::int AS n,
             (ARRAY_AGG(COALESCE(detail->>'reason','') ORDER BY created_at DESC))[1] AS last_reason
        FROM audit_logs
       WHERE tenant_id = ${tid} AND action IN ('piece_slotless_blocked','piece_slotless_bypassed')
         AND created_at > NOW() - (${days} || ' days')::interval
       GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20`);
    for (const r of rows) {
      const c = Number(r.n) || 0;
      if (String(r.action) === "piece_slotless_bypassed") { out.bypassed += c; continue; }
      out.blocked += c;
      out.bySource.push({ source: String(r.source), count: c, lastReason: String(r.last_reason ?? "") });
    }
  } catch { /* graceful — 빈 요약 */ }
  return out;
}
