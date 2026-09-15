/**
 * 편성 규칙·슬롯 API(계약 P1R1 §5 v1.1):
 *   GET  /api/rules-list                      → { rules:[Rule], settings:ScheduleSettings, coinsPerWeek, maxRules }
 *   [P1R5 B-1 수정] Rule.kind = "post" | "shorts" — 영상 채널(youtube_shorts·naver_clip·reels·threads)이면 shorts 로 저장하고 슬롯도 그 kind 로 굴러간다(글 크론이 영상 슬롯을 집지 않는다).
 *   POST /api/rules-estimate { rules:[RuleInput] } → { coinsPerWeek, coinsPerMonth, rules, limit, overLimit, shortfallNote? }   // 🔴 아무것도 쓰지 않는다 · rules-save 와 **같은 검사·같은 식**
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
import { planOf, checkLimit, tenantPlan, autoApproveAllowed } from "../../lib/plans";
import { q, isChannel } from "../../lib/accounts";
import { isVideoChannel } from "../../lib/video/types";
import { listRules, coinsPerWeek, rollSlots, readScheduleSettings, sanitizeSchedulePatch, scheduleSettingsOf, listSlots, type Rule, type RuleKind } from "../../lib/slots";
import { mergeSettings } from "./tenant-settings";
import { kstDateStr, addDays } from "../../lib/best-time";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/rules-list", "/api/rules-save", "/api/rules-estimate", "/api/rules-settings", "/api/slots-list", "/api/slots-skip"] };
/** netlify dev 는 함수가 404 를 내면 같은 경로에 `.html`·`.htm`·`/index.html` 을 붙여 다시 부른다(마지막 시도의 응답이 클라이언트에 간다)(정적 폴백) — 그 재시도가 경로 매칭에서 빠지면 엉뚱한 405 가 보인다. 꼬리를 떼고 맞춘다. */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Number(v || 0);

/**
 * 규칙이 꺼지거나 지워질 때 그 규칙이 잡아 둔 «앞으로의» 빈 슬롯을 치운다.
 *   ★C4 fix: status='planned' 만 지우면 편성자가 소재를 배정한 뒤(topic_assigned)·소재를 못 찾은 뒤(no_topic)·코인이 모자란(coin_short) 슬롯이 남아,
 *   새 규칙이 만든 슬롯과 같은 날에 겹쳐 중복 편성이 된다(실측 2026-09-14: 09-17·09-19 각 2건). 글이 붙은 슬롯(piece_id)과 지난 날짜는 건드리지 않는다.
 */
function clearFutureSlots(tid: number, ruleId: number) {
  return sql`DELETE FROM slots WHERE tenant_id = ${tid} AND rule_id = ${ruleId} AND piece_id IS NULL
    AND slot_date >= CURRENT_DATE AND status IN ('planned','topic_assigned','no_topic','coin_short')`;
}

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
      const [rules, settings, maxRules, planInfo] = await Promise.all([listRules(tid), readScheduleSettings(tid), maxRulesOf(tid), tenantPlan(tid)]);
      /* [P1R7 B3 · §5B.8] 코인 미리보기는 «주 N코인»만으로는 못 읽는다 — **플랜 포함분과 견줘야** «이 편성이면 포함분 안에서 되나»를 안다.
         화면(A)은 `coinsPerWeek` 와 `includedCoins` 를 나란히 쓴다. 포함분이 0(체험)이면 0 그대로 — 숨기지 않는다. */
      return json({ ok: true, rules, settings, coinsPerWeek: coinsPerWeek(rules), maxRules,
        includedCoins: n(planInfo.plan.limits.coinsIncluded), planKey: planInfo.planKey, autoApprove: autoApproveAllowed(planInfo.planKey, planInfo.plan) });
    }
    if (path.endsWith("/slots-list")) {
      const today = kstDateStr(new Date());
      const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") || "") ? url.searchParams.get("from")! : today;
      const to = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("to") || "") ? url.searchParams.get("to")! : addDays(from, 30);
      return json({ ok: true, slots: await listSlots(tid, from, to) });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

    if (path.endsWith("/rules-estimate") || path.endsWith("/rules-save")) {
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
        /* [R8] 분까지 못 박기(사장님 안 «10:05»). 🔴 시각을 안 정한 규칙에는 분을 받지 않는다 — «분만 5분»은 뜻이 없다. */
        const pm = r.preferredMinute === null || r.preferredMinute === undefined || r.preferredMinute === "" ? undefined : Math.trunc(n(r.preferredMinute));
        /* [P1R5 B-1 수정] kind — 영상 채널이면 shorts(요청이 말하지 않아도 채널이 정한다 · 글 채널에 shorts 를 넣지 않는다).
           🔴 플랜 한도(maxRules)는 kind 와 무관한 «규칙 개수» 합산이다 — 아래 activeCount 가 그대로 센다(채널·종류별 한도 아님). */
        const kind: RuleKind = isVideoChannel(channel) ? "shorts" : (String(r.kind) === "shorts" ? "shorts" : "post");
        if (kind === "shorts" && !isVideoChannel(channel)) return badRequest("이 채널은 영상 편성을 지원하지 않아요.", "kind");
        const o: Omit<Rule, "id"> & { id?: number } = { channel, kind, accountMode, every, count, active: r.active !== false };
        if (n(r.id)) o.id = n(r.id);
        if (accountId) o.accountId = accountId;
        if (weekdays.length) o.weekdays = weekdays;
        if (ph !== undefined && ph >= 0 && ph <= 23) o.preferredHour = ph;
        if (o.preferredHour !== undefined && pm !== undefined && pm >= 0 && pm <= 59) o.preferredMinute = pm;
        if (r.formatHint) o.formatHint = String(r.formatHint).slice(0, 24);
        clean.push(o);
      }
      const maxRules = await maxRulesOf(tid);
      const activeCount = clean.filter((r) => r.active).length;
      /* ── [R8] 견적은 **여기서 끝난다** — 검사는 저장과 똑같이 받고, 쓰기는 하나도 안 한다.
         🔴 화면이 «편수 × 단가»를 스스로 셈하면 단가를 바꾸는 날 화면만 옛 셈으로 남는다(A 지적 · AC-47).
            그래서 `coinsPerWeek` 를 **저장 경로와 같은 함수**에서 준다. ── */
      if (path.endsWith("/rules-estimate")) {
        const perWeek = coinsPerWeek(clean as Rule[]);
        const perMonth = Math.round(perWeek * 52 / 12);
        const included = (await tenantPlan(tid)).plan.limits.coinsIncluded;
        const out: Record<string, unknown> = { ok: true, coinsPerWeek: perWeek, coinsPerMonth: perMonth, rules: activeCount, limit: maxRules,
          overLimit: maxRules !== null && activeCount > maxRules };
        /* 🔴 요금제에 든 코인으로 이 계획을 **끝까지 못 미는** 경우를 **저장 전에** 말해 준다.
           §3b 에서 «막혔다가 아니라 속았다로 읽힌다»고 적은 그 자리다 — 달 중간에 멈추는 걸 나중에 알면 그게 속은 것이다. */
        if (included > 0 && perMonth > included) {
          const days = Math.max(1, Math.floor(included / Math.max(1, perWeek / 7)));
          out.shortfallNote = `이 계획대로면 한 달에 ${perMonth}코인이 들어요. 요금제에 든 ${included}코인으로는 약 ${days}일치예요 — 코인을 채우거나 횟수를 줄여 주세요.`;
        }
        return json(out);
      }
      // P1R4 §1.4 — 402 plan_limit 모양(used/limit/planKey). «저장하려는 활성 규칙 수»가 한도를 넘나(checkLimit 는 현재 수 기준이라 여기선 요청값으로 직접 잰다).
      if (maxRules !== null && activeCount > maxRules) { const [t] = await q(sql`SELECT plan_key FROM tenants WHERE id = ${tid}`); return json({ ok: false, reason: "plan_limit", step: "plan_limit", resource: "rules", used: activeCount, limit: maxRules, planKey: String(t?.plan_key ?? "trial"), error: `편성 규칙은 ${maxRules}개까지예요. Pro 로 바꾸면 제한이 없어요.` }, 402); }
      const existing = await listRules(tid);
      const keep = new Set<number>();
      for (const r of clean) {
        if (r.id && existing.some((e) => e.id === r.id)) {
          await q(sql`UPDATE cadence_rules SET channel = ${r.channel}, kind = ${r.kind}, account_mode = ${r.accountMode}, account_id = ${r.accountId ?? null}, every = ${r.every}, count = ${r.count},
            weekdays = ${r.weekdays ? jsonb(r.weekdays) : null}, preferred_hour = ${r.preferredHour ?? null}, preferred_minute = ${r.preferredMinute ?? null}, format_hint = ${r.formatHint ?? null}, active = ${r.active} WHERE tenant_id = ${tid} AND id = ${r.id}`);
          keep.add(r.id);
        } else {
          const [row] = await q(sql`INSERT INTO cadence_rules (tenant_id, channel, kind, account_mode, account_id, every, count, weekdays, preferred_hour, preferred_minute, format_hint, active)
            VALUES (${tid}, ${r.channel}, ${r.kind}, ${r.accountMode}, ${r.accountId ?? null}, ${r.every}, ${r.count}, ${r.weekdays ? jsonb(r.weekdays) : null}, ${r.preferredHour ?? null}, ${r.preferredMinute ?? null}, ${r.formatHint ?? null}, ${r.active}) RETURNING id`);
          keep.add(n(row?.id));
        }
      }
      // 없는 id 는 비활성 + 그 규칙의 미래 planned 슬롯 정리
      for (const e of existing) if (!keep.has(e.id)) {
        await q(sql`UPDATE cadence_rules SET active = false WHERE tenant_id = ${tid} AND id = ${e.id}`);
        await q(clearFutureSlots(tid, e.id));
      }
      // 비활성으로 바뀐 규칙의 미래 planned 슬롯도 정리(«주 0회로 뒀는데 계속» 방지 · AC-2)
      for (const r of clean) if (r.id && !r.active) await q(clearFutureSlots(tid, r.id));
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
      if (patch.horizonDays !== undefined) { const c = await checkLimit(tid, "horizonDays", patch.horizonDays); if (!c.ok) return c.res!; }   // P1R4 §1.4 달력 기간 상한
      /* [P1R7 B3 · DESIGN §5B.9] 자동 승인(«조용하면 발행»)은 Pro 부터.
         🔴 **소급 금지** — 이미 그렇게 저장해 둔 집은 그대로 둔다(«검수를 안 누르면 글이 안 나가는» 상태로 조용히 바뀌면 고객은 모른다).
            그래서 «저장된 값이 이미 silence_approves 인가»로 가른다(기본값이 아니라 **저장된 값**). 새로 바꾸는 것만 막는다. */
      if (patch.reviewPolicy === "silence_approves") {
        const [trow] = await q(sql`SELECT settings FROM tenants WHERE id = ${tid}`);
        const storedPolicy = ((trow?.settings ?? {}) as Record<string, unknown>).reviewPolicy;
        if (storedPolicy !== "silence_approves") {
          const { planKey, plan } = await tenantPlan(tid);
          if (!autoApproveAllowed(planKey, plan)) {
            await writeAudit({ tenantId: tid, action: "rules_settings_auto_approve_blocked", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: { planKey } });
            return json({ ok: false, reason: "plan_limit", step: "plan_feature", feature: "autoApprove", planKey,
              error: "«조용하면 발행»은 Pro 요금제부터 쓸 수 있어요. 지금 요금제에서는 발행 전에 한 번 확인해 주세요." }, 402);
          }
        }
      }
      const merged = await mergeSettings(tid, patch as Record<string, unknown>);
      const settings = scheduleSettingsOf(merged);
      // horizon·quietDays 가 바뀌면 달력을 다시 채운다(멱등)
      if ("horizonDays" in patch || "quietDays" in patch || "bestTimeMode" in patch) {
        // ★C4 fix: JS 배열을 `= ANY(${arr}::date[])` 로 바인딩하면 postgres-js 가 문자열 하나로 보내 22P02(malformed array literal)로 죽는다 — 날짜를 하나씩 캐스팅해 IN 으로.
        if ("quietDays" in patch && settings.quietDays.length) {
          await q(sql`DELETE FROM slots WHERE tenant_id = ${tid} AND status = 'planned' AND piece_id IS NULL
            AND slot_date IN (${sql.join(settings.quietDays.map((d) => sql`${d}::date`), sql`, `)})`);
        }
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
