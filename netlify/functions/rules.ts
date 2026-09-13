/**
 * 편성 규칙·슬롯 API(계약 P1R1 §5 v1.1):
 *   GET  /api/rules-list                      → { rules:[Rule], settings:ScheduleSettings, coinsPerWeek, maxRules }
 *   POST /api/rules-save { rules:[RuleInput] } → { rules, coinsPerWeek, slotsCreated }   // 전체 교체(있는 id 갱신 · 없는 id 비활성) → rollSlots 1회 · 활성 > maxRules 면 step limit
 *   POST /api/rules-settings Partial<ScheduleSettings> → { settings }                   // tenant-settings.mergeSettings 재사용(같은 jsonb 한 경로)
 *   GET  /api/slots-list?from=&to=            → { slots:[Slot] }
 *   POST /api/slots-skip { id }               → { ok }
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { jsonb } from "../../lib/db-util";
import { planOf } from "../../lib/plans";
import { q, isChannel } from "../../lib/accounts";
import { listRules, coinsPerWeek, rollSlots, readScheduleSettings, sanitizeSchedulePatch, scheduleSettingsOf, listSlots, type Rule } from "../../lib/slots";
import { mergeSettings } from "./tenant-settings";
import { kstDateStr, addDays } from "../../lib/best-time";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/rules-list", "/api/rules-save", "/api/rules-settings", "/api/slots-list", "/api/slots-skip"] };
/** netlify dev 는 함수가 404 를 내면 같은 경로에 `.html`·`.htm`·`/index.html` 을 붙여 다시 부른다(마지막 시도의 응답이 클라이언트에 간다)(정적 폴백) — 그 재시도가 경로 매칭에서 빠지면 엉뚱한 405 가 보인다. 꼬리를 떼고 맞춘다. */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Number(v || 0);

async function maxRulesOf(tid: number): Promise<number | null> {
  const [t] = await q(sql`SELECT plan_key FROM tenants WHERE id = ${tid}`);
  const plan = await planOf(String(t?.plan_key || "trial"));
  return plan.limits.maxRules ?? null;
}

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const url = new URL(req.url); const path = routeOf(req);
  try {
    if (path.endsWith("/rules-list")) {
      const [rules, settings, maxRules] = await Promise.all([listRules(tid), readScheduleSettings(tid), maxRulesOf(tid)]);
      return json({ ok: true, rules, settings, coinsPerWeek: coinsPerWeek(rules), maxRules });
    }
    if (path.endsWith("/slots-list")) {
      const today = kstDateStr(new Date());
      const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") || "") ? url.searchParams.get("from")! : today;
      const to = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("to") || "") ? url.searchParams.get("to")! : addDays(from, 30);
      return json({ ok: true, slots: await listSlots(tid, from, to) });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

    if (path.endsWith("/rules-save")) {
      const b = await readJson<{ rules?: Record<string, unknown>[] }>(req);
      const input = Array.isArray(b.rules) ? b.rules : [];
      const clean: (Omit<Rule, "id"> & { id?: number })[] = [];
      for (const r of input) {
        const channel = String(r.channel || "");
        if (!isChannel(channel)) return badRequest("채널을 확인해 주세요.", "channel");
        const every = (["day", "week", "month"].includes(String(r.every)) ? String(r.every) : "week") as Rule["every"];
        const count = Math.max(1, Math.min(every === "month" ? 31 : every === "week" ? 7 : 1, Math.trunc(n(r.count)) || 1));
        const weekdays = Array.isArray(r.weekdays) ? [...new Set((r.weekdays as unknown[]).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
        const accountMode = r.accountMode === "fixed" ? "fixed" : "auto";
        let accountId: number | undefined;
        if (accountMode === "fixed") {
          const [a] = await q(sql`SELECT id FROM accounts WHERE tenant_id = ${tid} AND id = ${n(r.accountId)} AND channel = ${channel} AND COALESCE(last_error_kind,'') <> 'removed'`);
          if (!a) return badRequest("고정 계정이 그 채널에 없어요.", "account");
          accountId = n(a.id);
        }
        const ph = r.preferredHour === null || r.preferredHour === undefined || r.preferredHour === "" ? undefined : Math.trunc(n(r.preferredHour));
        const o: Omit<Rule, "id"> & { id?: number } = { channel, kind: "post", accountMode, every, count, active: r.active !== false };
        if (n(r.id)) o.id = n(r.id);
        if (accountId) o.accountId = accountId;
        if (weekdays.length) o.weekdays = weekdays;
        if (ph !== undefined && ph >= 0 && ph <= 23) o.preferredHour = ph;
        if (r.formatHint) o.formatHint = String(r.formatHint).slice(0, 24);
        clean.push(o);
      }
      const maxRules = await maxRulesOf(tid);
      const activeCount = clean.filter((r) => r.active).length;
      if (maxRules !== null && activeCount > maxRules) return json({ ok: false, step: "limit", error: `이 요금제에서는 규칙을 ${maxRules}개까지 만들 수 있어요.` }, 403);
      const existing = await listRules(tid);
      const keep = new Set<number>();
      for (const r of clean) {
        if (r.id && existing.some((e) => e.id === r.id)) {
          await q(sql`UPDATE cadence_rules SET channel = ${r.channel}, kind = ${"post"}, account_mode = ${r.accountMode}, account_id = ${r.accountId ?? null}, every = ${r.every}, count = ${r.count},
            weekdays = ${r.weekdays ? jsonb(r.weekdays) : null}, preferred_hour = ${r.preferredHour ?? null}, format_hint = ${r.formatHint ?? null}, active = ${r.active} WHERE tenant_id = ${tid} AND id = ${r.id}`);
          keep.add(r.id);
        } else {
          const [row] = await q(sql`INSERT INTO cadence_rules (tenant_id, channel, kind, account_mode, account_id, every, count, weekdays, preferred_hour, format_hint, active)
            VALUES (${tid}, ${r.channel}, ${"post"}, ${r.accountMode}, ${r.accountId ?? null}, ${r.every}, ${r.count}, ${r.weekdays ? jsonb(r.weekdays) : null}, ${r.preferredHour ?? null}, ${r.formatHint ?? null}, ${r.active}) RETURNING id`);
          keep.add(n(row?.id));
        }
      }
      // 없는 id 는 비활성 + 그 규칙의 미래 planned 슬롯 정리
      for (const e of existing) if (!keep.has(e.id)) {
        await q(sql`UPDATE cadence_rules SET active = false WHERE tenant_id = ${tid} AND id = ${e.id}`);
        await q(sql`DELETE FROM slots WHERE tenant_id = ${tid} AND rule_id = ${e.id} AND status = 'planned' AND piece_id IS NULL`);
      }
      // 비활성으로 바뀐 규칙의 미래 planned 슬롯도 정리(«주 0회로 뒀는데 계속» 방지 · AC-2)
      for (const r of clean) if (r.id && !r.active) await q(sql`DELETE FROM slots WHERE tenant_id = ${tid} AND rule_id = ${r.id} AND status = 'planned' AND piece_id IS NULL`);
      const [chk] = await q(sql`SELECT jsonb_typeof(weekdays) AS t FROM cadence_rules WHERE tenant_id = ${tid} AND weekdays IS NOT NULL ORDER BY id DESC LIMIT 1`);
      if (chk && chk.t !== "array") console.error("[rules-save] weekdays jsonb_typeof !== array", chk);
      const settings = await readScheduleSettings(tid);
      const roll = await rollSlots(tid, settings.horizonDays);
      const rules = await listRules(tid);
      await writeAudit({ tenantId: tid, action: "rules_save", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: { rules: rules.length, active: activeCount, slotsCreated: roll.created } });
      return json({ ok: true, rules, coinsPerWeek: coinsPerWeek(rules), slotsCreated: roll.created });
    }

    if (path.endsWith("/rules-settings")) {
      const b = await readJson<Record<string, unknown>>(req);
      const patch = sanitizeSchedulePatch(b);
      if (!Object.keys(patch).length) return badRequest("바꿀 값이 없어요.");
      const merged = await mergeSettings(tid, patch as Record<string, unknown>);
      const settings = scheduleSettingsOf(merged);
      // horizon·quietDays 가 바뀌면 달력을 다시 채운다(멱등)
      if ("horizonDays" in patch || "quietDays" in patch || "bestTimeMode" in patch) {
        if ("quietDays" in patch && settings.quietDays.length) await q(sql`DELETE FROM slots WHERE tenant_id = ${tid} AND status = 'planned' AND piece_id IS NULL AND slot_date = ANY(${settings.quietDays}::date[])`);
        await rollSlots(tid, settings.horizonDays);
      }
      await writeAudit({ tenantId: tid, action: "rules_settings", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: patch });
      return json({ ok: true, settings });
    }

    if (path.endsWith("/slots-skip")) {
      const b = await readJson<{ id?: number }>(req);
      const id = n(b.id); if (!id) return badRequest("id");
      const [s] = await q(sql`SELECT id, status, piece_id FROM slots WHERE tenant_id = ${tid} AND id = ${id}`);
      if (!s) return json({ ok: false, error: "슬롯을 찾을 수 없어요.", step: "not_found" }, 404);
      if (["published", "publishing"].includes(String(s.status))) return json({ ok: false, step: "state", error: "이미 나간 글은 건너뛸 수 없어요." }, 400);
      await q(sql`UPDATE slots SET status = 'skipped', updated_at = NOW() WHERE id = ${id}`);
      if (s.piece_id) await q(sql`UPDATE pieces SET status = 'rejected', meta = meta || ${jsonb({ rejectReason: "편성표에서 건너뜀" })}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${n(s.piece_id)} AND status IN ('generating','draft','in_review','approved','scheduled')`);
      await writeAudit({ tenantId: tid, action: "slot_skip", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `slot:${id}` });
      return json({ ok: true });
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (err) { return jsonError("rules", err); }
};
