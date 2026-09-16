/**
 * 레퍼런스로 구조 배우기(계약 P1R5 §1.11):
 *   POST /api/topics-reference { url }        → { ok:true, template:{ id, name, structure:[string], hook, style } }
 *   GET  /api/topics-templates                 → { ok:true, templates:[…] }   // 화면 «구조: …» 부제 재료
 *   코인 0 · 🔴 **이번 달 N회**(요금제 `plans.limits.videoRefsPerMonth` · 감사 `topics_reference` COUNT) · AI 일 상한(§1.5)을 탄다.
 *   [R11-11 · 설계 R11 §6-②] 종전 «하루 3회»에서 옮겼다 — 글 레퍼런스가 «달에 N개»라 **같은 그룹에서 둘이 다른 말을 했다.**
 *   응답에 `quota:{used,limit,left,resetAt}` 를 **성공·실패 모두** 싣는다(글 쪽 `style-reference` 와 같은 모양 · 화면이 «이번 달 3 / 10 남음»을 그린다).
 *   🔴 저작권 게이트는 `lib/video/reference.ts sanitizeTemplate` 한 곳 — 여기서는 통과시키지 않는다.
 */
import { sql } from "drizzle-orm";
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, requireWritable } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { q } from "../../lib/accounts";
import { analyzeReference, videoRefQuota, listTemplates, isYoutubeUrl } from "../../lib/video/reference";   // [R11-11] 하루 3개 → **이번 달 N개**(글 레퍼런스와 같은 단위)

export const config = { path: ["/api/topics-reference", "/api/topics-templates"] };
/** netlify dev 정적 폴백(`.html` 재시도) 대비 — 꼬리를 떼고 맞춘다(AC-7). */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const path = routeOf(req);
  try {
    if (path.endsWith("/topics-templates")) {
      const templates = await listTemplates(tid);
      /* [R11-11] 🔴 목록에도 한도를 싣는다 — 화면의 «배워 올 곳» 그룹이 **줄을 그리기 전에** 남은 수를 알아야 한다.
         🔴 못 읽으면 키를 안 싣는다(«남음»을 지어내지 않는다 · AC-9 · A 트리거 A-3). */
      const quota = await videoRefQuota(tid).catch(() => null);
      return json({ ok: true, templates, ...(quota ? { quota } : {}) });
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
      }, ...(await videoRefQuota(tid).then((x) => ({ quota: x })).catch(() => ({}))) });   // [R11-11] 이미 배운 URL 은 횟수를 안 쓴다 — 그래도 남은 수는 말해 준다
    }

    { const { requireAiBudget } = await import("../../lib/billing/ai-cost-cap"); const bgt = await requireAiBudget(tid); if (!bgt.ok) return json({ ok: false, step: "ai_cost_cap", error: bgt.error }, 400); }
    const quota = await videoRefQuota(tid);
    /* 🔴 이건 «우리 판단으로 막는 것»이 아니라 **요금제 한도**다 — CLAUDE §9 의 «이 규칙 밖»(돈·계약)에 그대로 해당한다.
       문구도 겁주지 않는다(§3): 무엇이 그런지 · 언제 열리는지 · 지금 할 수 있는 것. */
    if (quota.left <= 0) return json({ ok: false, step: "quota", quota,
      error: `이번 달 구조 배우기(${quota.limit}번)를 다 썼어요. 다음 달 1일에 다시 열려요.` }, 400);
    // 감사 행이 곧 횟수 — 분석 전에 먼저 적는다(실패해도 AI 원가는 나갔다 · topics-refresh 관례).
    await writeAudit({ tenantId: tid, action: "topics_reference", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: { n: quota.used + 1, url: url.slice(0, 200) } });

    const r = await analyzeReference(tid, url);
    const after = { ...quota, used: quota.used + 1, left: Math.max(0, quota.left - 1) };   // 감사 행을 이미 적었으니 응답의 남은 수도 그만큼 줄어 있어야 한다
    if (!r.ok) return json({ ok: false, step: r.step, error: r.error, quota: after }, r.step === "url" ? 400 : 502);
    return json({ ok: true, template: r.template, quota: after });
  } catch (err) {
    return jsonError("topics_reference", err);
  }
};
