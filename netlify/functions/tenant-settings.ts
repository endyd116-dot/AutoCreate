/**
 * 테넌트 설정 묶음:
 *   POST /api/onboarding { kinds: ["text","video"], channels: [...] } — settings 병합(read→merge→full write · AM jsonb 규율)
 *   POST /api/tenant-settings { autoSchedule?: boolean, ... }        — 화이트리스트 키만 병합
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
const ALLOWED_SETTINGS = new Set(["autoSchedule", "kinds", "channels", "produceLeadDays", "reviewPolicy", "bestTimeMode", "weeklyCoinCap", "quietDays", "horizonDays", "topicLeadDays", "produceHour", "coinAutoUsePurchased", "onboardedAt"]);
const CHANNELS = new Set(["naver_blog", "tistory", "blogger", "wordpress", "threads", "instagram", "youtube_shorts", "naver_clip", "reels", "tiktok"]);

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
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const path = new URL(req.url).pathname;
  try {
    if (path.endsWith("/onboarding")) {
      const b = await readJson<{ kinds?: string[]; channels?: string[] }>(req);
      const kinds = (b.kinds || []).filter((k) => k === "text" || k === "video");
      const channels = (b.channels || []).filter((c) => CHANNELS.has(c));
      if (!kinds.length) return badRequest("글 또는 영상 중 하나는 골라 주세요.", "kinds");
      const settings = await mergeSettings(auth.tid, { kinds, channels, onboardedAt: new Date().toISOString() });
      await writeAudit({ tenantId: auth.tid, action: "onboarding_done", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: { kinds, channels } });
      return json({ ok: true, settings });
    }
    const b = await readJson<Record<string, unknown>>(req);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(b)) if (ALLOWED_SETTINGS.has(k)) patch[k] = v;
    if (!Object.keys(patch).length) return badRequest("바꿀 값이 없어요.");
    const settings = await mergeSettings(auth.tid, patch);
    await writeAudit({ tenantId: auth.tid, action: "tenant_settings_update", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: patch });
    return json({ ok: true, settings });
  } catch (err) { return jsonError("tenant_settings", err); }
};
