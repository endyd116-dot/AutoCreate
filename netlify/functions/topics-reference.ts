/**
 * 레퍼런스로 구조 배우기(계약 P1R5 §1.11):
 *   POST /api/topics-reference { url }        → { ok:true, template:{ id, name, structure:[string], hook, style } }
 *   GET  /api/topics-templates                 → { ok:true, templates:[…] }   // 화면 «구조: …» 부제 재료
 *   코인 0 · 하루 3회(감사 `topics_reference` COUNT · `topics-refresh` 와 같은 패턴) · AI 일 상한(§1.5)을 탄다.
 *   🔴 저작권 게이트는 `lib/video/reference.ts sanitizeTemplate` 한 곳 — 여기서는 통과시키지 않는다.
 */
import { sql } from "drizzle-orm";
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, requireWritable } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { q } from "../../lib/accounts";
import { analyzeReference, referenceCountToday, listTemplates, isYoutubeUrl } from "../../lib/video/reference";

export const config = { path: ["/api/topics-reference", "/api/topics-templates"] };
/** netlify dev 정적 폴백(`.html` 재시도) 대비 — 꼬리를 떼고 맞춘다(AC-7). */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const PER_DAY = 3;

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const path = routeOf(req);
  try {
    if (path.endsWith("/topics-templates")) {
      const templates = await listTemplates(tid);
      return json({ ok: true, templates });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

    const w = await requireWritable(tid); if (!w.ok) return w.res;
    const b = await readJson<{ url?: string }>(req);
    const url = String(b.url ?? "").trim();
    if (!url) return badRequest("url");
    if (!isYoutubeUrl(url)) return json({ ok: false, step: "url", error: "유튜브 주소를 넣어 주세요(youtube.com · youtu.be)." }, 400);

    // 같은 URL 을 이미 배웠으면 다시 분석하지 않는다(횟수·원가 0 · 멱등).
    const [dup] = await q(sql`SELECT id, name, structure, hook_type, style FROM shorts_templates
      WHERE tenant_id = ${tid} AND source_url = ${url} ORDER BY id DESC LIMIT 1`);
    if (dup) {
      return json({ ok: true, already: true, template: {
        id: Number(dup.id), name: String(dup.name),
        structure: Array.isArray(dup.structure) ? (dup.structure as unknown[]).map(String) : [],
        hook: String(dup.hook_type ?? "curiosity_gap"), style: dup.style ?? {},
      } });
    }

    { const { requireAiBudget } = await import("../../lib/billing/ai-cost-cap"); const bgt = await requireAiBudget(tid); if (!bgt.ok) return json({ ok: false, step: "ai_cost_cap", error: bgt.error }, 400); }
    const used = await referenceCountToday(tid);
    if (used >= PER_DAY) return json({ ok: false, step: "rate_limit", error: `구조 배우기는 하루 ${PER_DAY}번까지예요. 내일 다시 할 수 있어요.` }, 429);
    // 감사 행이 곧 횟수 — 분석 전에 먼저 적는다(실패해도 AI 원가는 나갔다 · topics-refresh 관례).
    await writeAudit({ tenantId: tid, action: "topics_reference", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: { n: used + 1, url: url.slice(0, 200) } });

    const r = await analyzeReference(tid, url);
    if (!r.ok) return json({ ok: false, step: r.step, error: r.error }, r.step === "url" ? 400 : 502);
    return json({ ok: true, template: r.template });
  } catch (err) {
    return jsonError("topics_reference", err);
  }
};
