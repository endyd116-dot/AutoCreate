/**
 * 테넌트 설정 묶음:
 *   POST /api/onboarding { kinds: ["text","video"], channels: [...] } — settings 병합(read→merge→full write · AM jsonb 규율)
 *   GET  /api/tenant-settings                                        → { settings, kinds:["text"|"video"…], kindsSet } — [R7 §1.1] 화면이 토글 상태를 읽는다
 *   POST /api/tenant-settings { autoSchedule?: boolean, kinds?, ... } — 화이트리스트 키만 병합 · kinds 는 정규화(«글»은 항상 · 영상만 토글)
 *   🔴 `recipeVolunteer` 는 settings(jsonb) 가 아니라 **`tenants` 의 칸**이다(B2 §3.3 · drizzle/0051) — 배포 판정이 SQL 로 그 칸을 세기 때문.
 *      그래서 위 화이트리스트를 타지 않고 따로 받는다.
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { jsonb } from "../../lib/db-util";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/onboarding", "/api/tenant-settings"] };
const ALLOWED_SETTINGS = new Set(["autoSchedule", "kinds", "channels", "produceLeadDays", "reviewPolicy", "bestTimeMode", "weeklyCoinCap", "quietDays", "horizonDays", "topicLeadDays", "produceHour", "coinAutoUsePurchased", "onboardedAt", "teamApproval",
  /* 🔴 [2026-09-16 · A2 가 화면 만들기 전에 찾음] `goal` 이 여기 없어서 **POST 해도 조용히 버려졌다** —
     고객이 «목표 매체»를 고르고 저장한 뒤 새로고침하면 사라지는 상태였다. 화이트리스트가 값을 먹는 자리다. */
  "goal"]);
const CHANNELS = new Set(["naver_blog", "tistory", "blogger", "wordpress", "threads", "instagram", "youtube_shorts", "naver_clip", "reels", "tiktok"]);

/* [R7 §1.1] `kinds` 정규화·보기는 **`lib/tenant-kinds.ts` 정본**이다(2026-09-21 B 가 옮김 —
   `lib/director.ts` 가 같은 규칙을 쓰는데 lib → netlify/functions 임포트는 층이 거꾸로였다).
   🔴 여기서 재수출한다 — 이 이름으로 부르던 자리(rules.ts·onboarding 등)가 그대로 돌아야 한다(소급 0). */
import { normalizeKinds, kindsView } from "../../lib/tenant-kinds";
import { loadPause } from "../../lib/tenant-pause";   // 🔴 [AC-220] 쉼의 한 곳
export { normalizeKinds, kindsView };

/** [v1.1 P1-2] tenants.settings 병합의 단일 경로 — rules-settings(netlify/functions/rules.ts)도 이 함수를 쓴다(같은 jsonb 두 경로 금지). */
export async function mergeSettings(tid: number, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const rows = (await db.execute(sql`SELECT settings FROM tenants WHERE id = ${tid}`)) as unknown as { settings: Record<string, unknown> }[];
  const cur = (rows[0]?.settings && typeof rows[0].settings === "object") ? rows[0].settings : {};
  const next = { ...cur, ...patch };
  await db.execute(sql`UPDATE tenants SET settings = ${jsonb(next)}, updated_at = NOW() WHERE id = ${tid}`);
  // 쓴 직후 모양 확인(PITFALLS #1)
  const chk = (await db.execute(sql`SELECT jsonb_typeof(settings) AS t FROM tenants WHERE id = ${tid}`)) as unknown as { t: string }[];
  if (chk[0]?.t !== "object") console.error("[tenant-settings] jsonb_typeof !== object", chk[0]);
  return next;
}

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const path = new URL(req.url).pathname;
  try {
    /* [R7 §1.1] 읽기 — 화면이 토글의 현재 상태를 알아야 그린다(종전엔 설정을 **읽는 API 가 없었다**).
       `kinds` 는 정규형으로 주고 `kindsSet` 으로 «저장된 적 있나»를 구분한다(꺼짐 표시 vs 아직 안 정함). */
    if (req.method === "GET" && path.endsWith("/tenant-settings")) {
      const rows = (await db.execute(sql`SELECT settings, recipe_volunteer FROM tenants WHERE id = ${auth.tid}`)) as unknown as { settings: Record<string, unknown>; recipe_volunteer: boolean }[];
      const settings = (rows[0]?.settings && typeof rows[0].settings === "object") ? rows[0].settings : {};
      /* 🔴 [AC-220 · DESIGN §5B.11(1-c)] «잠깐 멈춤» — `home-summary` 와 **같은 객체**를 싣는다(두 벌로 만들지 않는다).
         `days`·`daysLeft`·`reasons[].label` 을 **서버가** 주는 것이 핵심이다 — 안 주면 화면이 날짜를 셈하고 말을 지어낸다(AC-52·AC-74). */
      return json({ ok: true, settings, ...kindsView(settings), recipeVolunteer: rows[0]?.recipe_volunteer === true, pause: await loadPause(auth.tid) });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    if (path.endsWith("/onboarding")) {
      const b = await readJson<{ kinds?: string[]; channels?: string[] }>(req);
      // 🔴 «하나는 골라 주세요»는 **정규화 전 원본**으로 잰다 — normalizeKinds 는 늘 ["text"] 를 돌려주므로 정규화 뒤에 재면 이 검사가 죽는다.
      if (!(b.kinds || []).some((k) => k === "text" || k === "video")) return badRequest("글 또는 영상 중 하나는 골라 주세요.", "kinds");
      const kinds = normalizeKinds(b.kinds);   // [R7 §1.1] 정규형 한 곳(온보딩·설정이 같은 규칙)
      const channels = (b.channels || []).filter((c) => CHANNELS.has(c));
      const settings = await mergeSettings(auth.tid, { kinds, channels, onboardedAt: new Date().toISOString() });
      await writeAudit({ tenantId: auth.tid, action: "onboarding_done", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: { kinds, channels } });
      return json({ ok: true, settings });
    }
    const b = await readJson<Record<string, unknown>>(req);
    /* ── [R8 §3.3 · B2 칸] «새 방식을 먼저 써 볼래요» ──
       🔴 이건 **settings jsonb 가 아니라 `tenants` 의 칸**이다(배포가 «자원자 몇 집»을 SQL 로 센다).
       🔴 그리고 이 토글은 **좋은 것만 있는 스위치가 아니다** — 아직 검증 안 된 셀렉터 표로 **그 집 계정이 먼저 돈다.**
          잘못되면 그 집 발행이 실패한다. 그래서 화면 문구는 «더 빨리 좋아지지만, 드물게 발행이 한 번 실패할 수 있어요»여야 한다(A 계약).
       🔴 켜고 끈 것을 **감사에 남긴다** — 나중에 «왜 우리 집만 실패했지»를 되짚을 때 이 한 줄이 답이다. */
    let volunteerChanged: boolean | null = null;
    if (typeof b.recipeVolunteer === "boolean") {
      const [cur] = (await db.execute(sql`SELECT recipe_volunteer FROM tenants WHERE id = ${auth.tid}`)) as unknown as { recipe_volunteer: boolean }[];
      if ((cur?.recipe_volunteer === true) !== b.recipeVolunteer) {
        await db.execute(sql`UPDATE tenants SET recipe_volunteer = ${b.recipeVolunteer}, updated_at = NOW() WHERE id = ${auth.tid}`);
        volunteerChanged = b.recipeVolunteer;
        await writeAudit({ tenantId: auth.tid, action: b.recipeVolunteer ? "recipe_volunteer_on" : "recipe_volunteer_off", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: { recipeVolunteer: b.recipeVolunteer } });
      } else volunteerChanged = b.recipeVolunteer;   // 같은 값 = 멱등(감사 도배 0)
    }
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(b)) if (ALLOWED_SETTINGS.has(k)) patch[k] = v;
    if (!Object.keys(patch).length) {
      if (volunteerChanged !== null) {
        const rows = (await db.execute(sql`SELECT settings FROM tenants WHERE id = ${auth.tid}`)) as unknown as { settings: Record<string, unknown> }[];
        const settings = (rows[0]?.settings && typeof rows[0].settings === "object") ? rows[0].settings : {};
        return json({ ok: true, settings, ...kindsView(settings), recipeVolunteer: volunteerChanged });
      }
      return badRequest("바꿀 값이 없어요.");
    }
    // [R7 §1.1] `kinds` 는 정규화해서 저장한다 — 화면이 무엇을 보내든 «글은 항상 · 영상은 토글» 한 모양으로 수렴(덮어쓰기 금지).
    if ("kinds" in patch) patch.kinds = normalizeKinds(patch.kinds);
    /* 🔴 [R8 §4.5] «팀 승인»은 **요금제 기능**이다(Agency) — 없는 요금제에서 켜지면 «켰는데 안 되는» 상태가 된다.
       끄는 것은 언제나 되게 둔다(되돌릴 길은 막지 않는다). */
    if (patch.teamApproval === true) {
      const { requireFeature } = await import("../../lib/plans");
      const f = await requireFeature(auth.tid, "teamApproval");
      if (!f.ok) return f.res!;
    }
    if ("teamApproval" in patch) patch.teamApproval = patch.teamApproval === true;
    const settings = await mergeSettings(auth.tid, patch);
    await writeAudit({ tenantId: auth.tid, action: "tenant_settings_update", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: patch });
    return json({ ok: true, settings, ...kindsView(settings), ...(volunteerChanged !== null ? { recipeVolunteer: volunteerChanged } : {}) });
  } catch (err) { return jsonError("tenant_settings", err); }
};
