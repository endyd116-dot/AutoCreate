/**
 * 운영센터 — **집필 계약(감성 프로파일) 무배포 조정**(DESIGN §5.4 「운영자가 화면에서 조정 · 재배포 0」 · AC-258).
 *   GET  /api/ops-emotion            → { ok, profiles:[…], keys:[오버레이 가능한 칸], cacheSeconds }
 *   POST /api/ops-emotion-save       { key, overlay:{…} } → { ok, key, applied:[], ignored:[{key,why,expected,got}] }
 *   POST /api/ops-emotion-reset      { key }              → { ok, key, removed:boolean }
 *
 *   ══ 왜 이 문이 필요했나 ══
 *     `emotion_profiles.contract` 는 **읽는 코드만 있었다**(`lib/writing-contracts.ts contractFor`).
 *     쓰는 API 0 · 화면 0 ⇒ 🔴 **운영자가 말투를 고치려면 사람이 손으로 SQL 을 쳐야 했다.**
 *     설계가 «재배포 0» 이라고 적어 둔 자리인데 실제로는 «배포는 안 해도 되지만 DBA 가 필요한» 자리였다.
 *     ⚠️ AI 모델 오버레이(`ops-ai`)와 **똑같은 모양의 빚**이다 — 읽는 길만 만들고 쓰는 길을 안 만든 것
 *        (`scripts/verify-write-path-missing.mjs` 가 잡던 그 병).
 *
 *   ══ 🔴 지키는 것 넷 ══
 *     ① **판정기는 한 벌** — 얹는 규칙은 `applyOverlay` 하나이고 생성 경로(`contractFor`)가 **같은 함수**를 쓴다.
 *        두 벌이면 «화면은 먹었다는데 글은 안 바뀐» 자리가 생긴다(PITFALLS #11-b).
 *     ② 🔴 **무시된 칸을 말해 준다** — 종전 merge 는 모양이 다르면 **소리 없이** 넘어갔다.
 *        `length: "1200"`(문자열)을 저장하면 저장은 성공하고 글은 그대로다. 그게 제일 나쁜 모양이다(조용한 0건).
 *        ⚠️ **막지는 않는다**(§9) — 저장은 되고, **무엇이 안 먹었는지 그 자리에서 보인다.**
 *     ③ **바로는 아니다** — `contractFor` 가 60초 캐시를 쓴다. 화면이 «최대 N초» 를 **서버 값**으로 말한다(AC-52).
 *        🔴 «즉시 반영»이라고 적으면 그게 거짓말이다.
 *     ④ **되돌릴 길**(§9-③) — `reset` 이 오버레이 행을 지운다 ⇒ 코드 기본값으로 돌아온다. 되돌릴 수 없는 저장은 만들지 않는다.
 *
 *   권한: 조회 operator+ · 변경 **super_admin 전용**(집필 계약은 전 고객의 글 모양을 바꾼다 — 플랫폼 설정이다).
 *   🔎 출처: AC 신규(R17 · 2026-09-23) — AM 원본 없음.
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireAdmin } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { q } from "../../lib/accounts";
import { jsonb, utcDate } from "../../lib/db-util";
import { sql } from "drizzle-orm";
import { WRITING_CONTRACTS, OVERLAY_KEYS, OVERLAY_CACHE_SECONDS, applyOverlay, type WritingContract } from "../../lib/writing-contracts";

export const config = { path: ["/api/ops-emotion", "/api/ops-emotion-save", "/api/ops-emotion-reset"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");

/** 화면이 그대로 그리는 **요약 넉 줄** — 🔴 화면이 계약에서 무엇을 뽑을지 고르지 않는다(AC-52). */
function summaryOf(c: WritingContract): { k: string; v: string }[] {
  return [
    { k: "독자", v: String(c.reader ?? "") },
    { k: "말투", v: String(c.register ?? "") },
    { k: "분량", v: c.length ? `${c.length.min}~${c.length.max}자` : "—" },
    { k: "사진", v: c.images ? `${c.images.min}~${c.images.max}장(기본 ${c.images.default})` : "—" },
  ];
}

/** `{channel}.{emotionKey}` — `contractFor` 가 쓰는 **그 열쇠 규칙 그대로**(두 벌이면 화면과 생성이 다른 행을 본다). */
const keyOf = (c: WritingContract) => `${c.channel}.${c.emotionKey}`;

export default async (req: Request): Promise<Response> => {
  const path = routeOf(req);
  try {
    if (path.endsWith("/ops-emotion")) {
      const o = await requireAdmin(req); if (!o.ok) return o.res;   // 조회는 operator+
      const rows = await q(sql`SELECT key, contract, updated_at FROM emotion_profiles`);
      const byKey = new Map(rows.map((r) => [String(r.key), r]));
      const profiles = Object.values(WRITING_CONTRACTS).map((base) => {
        const key = keyOf(base);
        const row = byKey.get(key);
        const overlay = (row?.contract && typeof row.contract === "object" ? row.contract : null) as Record<string, unknown> | null;
        const rep = applyOverlay(base, overlay);
        return {
          key, channel: base.channel, emotionKey: base.emotionKey, label: base.label,
          hasOverlay: !!overlay && Object.keys(overlay).length > 0,
          overlay: overlay ?? {},
          applied: rep.applied, ignored: rep.ignored,
          /* 🔴 «지금 실제로 도는 값»을 같이 준다 — 오버레이만 보여 주면 운영자가 머릿속에서 합쳐야 한다(그러면 틀린다). */
          effective: summaryOf(rep.merged),
          base: summaryOf(base),
          updatedAt: utcDate(row?.updated_at)?.toISOString() ?? null,
        };
      });
      /* 🔴 표에 없는 행이 DB 에 있으면 **말해 준다** — 채널을 지우거나 이름을 바꾸면 그 행은 영영 안 읽히는 유령이 된다. */
      const known = new Set(profiles.map((p) => p.key));
      const orphans = rows.map((r) => String(r.key)).filter((k) => !known.has(k));
      return json({ ok: true, profiles, keys: OVERLAY_KEYS, cacheSeconds: OVERLAY_CACHE_SECONDS, orphans });
    }

    if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);
    const o = await requireAdmin(req, ["super_admin"]); if (!o.ok) return o.res;
    const b = await readJson<{ key?: unknown; overlay?: unknown }>(req);
    const key = String(b.key ?? "").trim();
    const base = Object.values(WRITING_CONTRACTS).find((c) => keyOf(c) === key);
    if (!base) return badRequest("그런 집필 계약이 없어요.", "key");

    if (path.endsWith("/ops-emotion-reset")) {
      const del = await q(sql`DELETE FROM emotion_profiles WHERE key = ${key} RETURNING key`);
      await writeAudit({ tenantId: null, action: "ops_emotion_reset", actorType: "operator", actorId: o.ops.oid, ip: clientIp(req),
        target: `emotion:${key}`, detail: { removed: del.length > 0 }, riskLevel: "medium" });
      return json({ ok: true, key, removed: del.length > 0, cacheSeconds: OVERLAY_CACHE_SECONDS });
    }

    /* ───── 저장 ───── */
    const overlay = b.overlay;
    if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) return badRequest("바꿀 내용을 객체로 보내 주세요.", "overlay");
    const rep = applyOverlay(base, overlay as Record<string, unknown>);
    /* 🔴 **한 칸도 안 먹으면 저장하지 않는다** — 저장해 봐야 «바꿨는데 그대로»가 되고, 그 행이 남으면 다음 사람이 «바꿔 뒀구나»로 읽는다.
       ⚠️ 이건 §9 의 게이트가 아니다 — 고객을 막는 게 아니라 **아무 일도 안 하는 저장을 «했다»고 말하지 않는 것**이다. */
    if (!rep.applied.length) {
      return json({ ok: false, step: "nothing_applied", error: "바뀌는 칸이 하나도 없어요. 아래에서 까닭을 확인해 주세요.", ignored: rep.ignored, keys: OVERLAY_KEYS }, 400);
    }
    await q(sql`INSERT INTO emotion_profiles (key, channel, label, contract, updated_at)
      VALUES (${key}, ${base.channel}, ${base.label.slice(0, 60)}, ${jsonb(overlay as Record<string, unknown>)}, NOW())
      ON CONFLICT (key) DO UPDATE SET contract = EXCLUDED.contract, channel = EXCLUDED.channel, updated_at = NOW()`);
    /* 쓴 직후 확인까지가 쓰기다(PITFALLS #1) — jsonb 가 아니면 `contractFor` 가 조용히 코드 기본값으로 돈다. */
    const [chk] = await q(sql`SELECT jsonb_typeof(contract) AS t FROM emotion_profiles WHERE key = ${key}`);
    if (chk?.t !== "object") console.error("[ops-emotion] contract jsonb_typeof !== object", chk);
    await writeAudit({ tenantId: null, action: "ops_emotion_save", actorType: "operator", actorId: o.ops.oid, ip: clientIp(req),
      target: `emotion:${key}`, detail: { applied: rep.applied, ignored: rep.ignored.map((x) => x.key), jsonbOk: chk?.t === "object" }, riskLevel: "medium" });
    return json({ ok: true, key, applied: rep.applied, ignored: rep.ignored, effective: summaryOf(rep.merged), cacheSeconds: OVERLAY_CACHE_SECONDS });
  } catch (err) { return jsonError("ops_emotion", err); }
};
