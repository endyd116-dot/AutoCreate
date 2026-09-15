/**
 * lib/ai-key-byo.ts — **고객이 꽂은 AI 키**를 꺼내 오는 곳(계약 P1R8-B §4.4 · DESIGN §3.3 · 메인 승인 2026-09-15).
 *
 *   ══ 🔴 여기는 «고르는 자리»가 아니다 ══
 *     키를 **고르는 일**은 `lib/ai-key.ts leaseAiKey()` 한 곳 그대로다. 이 파일은 **값을 가져오는 일**만 한다.
 *     왜 갈렸나: `ai-key.ts` 는 **순수 리프**(DB·import 0)이고 `leaseAiKey()` 는 **동기**인데, 고객 키는 테넌트별이라 DB 가 필요하다.
 *     갈래를 여기 또 만들면 «고르는 자리가 둘»이 되고, 그게 오늘 카드뉴스가 1코인으로 샌 사고의 모양이다(AC-74).
 *
 *   ══ 🔴 키 값은 여기서만 산다 ══
 *     저장은 AES-256-GCM(`CREDS_ENC_KEY` · 폴백 없음 — 계정 자격과 **같은 취급** · CLAUDE §4.7).
 *     밖으로 나가는 것은 **가려진 모양**(`maskSecret`)뿐이고, 평문은 `leaseAiKey()` 로 넘기는 그 한 줄에만 실린다.
 *     로그·오류·응답·감사 어디에도 안 찍는다. 오류 본문은 `redactKeys()` 가 걷어 낸다(그 함수가 고객 키도 알게 해 뒀다).
 *
 *   ══ 🔴 안 되는 키를 «등록됨»으로 두지 않는다 ══
 *     꽂을 때 **그 키로 한 번 실제로 걸어 본다**(§4.9 «목록에 있다고 쓰지 않는다»와 같은 결).
 *     안 하면 그 집 공장은 **그날 밤 조용히 선다**. 🔴 확인 호출은 **그 키로만** 한다 — 우리 키로 새면 우리가 남의 확인 비용을 낸다.
 *     실패 사유는 셋으로 가른다: `invalid`(키가 틀림) · `quota`(한도) · `forbidden`(권한). 고객이 할 일이 다르기 때문이다.
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { encrypt, decrypt, credsEncConfigured, maskSecret } from "./creds-crypto";
import { redactKeys, type ByoKey } from "./ai-key";
import { featureOn } from "./ops/features";   // [2026-09-16] BYO 는 지금 **안 판다** — 입구만 닫고 코드는 재워 둔다(CLAUDE §8)

const n = (v: unknown) => Number(v || 0);

/** 키 조회 캐시 — 글 한 편에 모델을 여러 번 부르는데 매번 DB 를 치면 낭비다. 짧게(30초) 둔다. */
const CACHE_MS = 30_000;
const cache = new Map<number, { at: number; key: ByoKey | null; id: number }>();
/** 하니스 전용 — 캐시를 비운다(키를 바꿔 가며 재려면 필요하다). */
export function _clearByoCache(): void { cache.clear(); }

export type ByoErrorKind = "invalid" | "quota" | "forbidden";

export interface ByoKeyView {
  id: number; label: string; provider: string; status: string; masked: string;
  lastOkAt: string | null; lastErrorAt: string | null; lastErrorKind: ByoErrorKind | null; resting: boolean;
}

/** 화면이 보는 모양 — 🔴 **평문은 없다**. `masked` 는 «앞 4자 + … » 수준(어느 키인지 고객이 알아볼 정도). */
function toView(r: Record<string, unknown>): ByoKeyView {
  const rest = r.rested_until ? new Date(String(r.rested_until) + (String(r.rested_until).endsWith("Z") ? "" : "Z")).getTime() : 0;
  return {
    id: n(r.id), label: String(r.label ?? "내 키"), provider: String(r.provider ?? "gemini"), status: String(r.status ?? "active"),
    masked: String(r.masked ?? ""),
    lastOkAt: r.last_ok_at ? new Date(String(r.last_ok_at) + "Z").toISOString() : null,
    lastErrorAt: r.last_error_at ? new Date(String(r.last_error_at) + "Z").toISOString() : null,
    lastErrorKind: (r.last_error_kind ? String(r.last_error_kind) : null) as ByoErrorKind | null,
    resting: rest > Date.now(),
  };
}

/**
 * byoKeyFor — 이 집이 꽂아 둔 키(쓸 수 있는 것 하나). 없으면 `null` → 호출부는 **우리 풀**로 간다.
 *   🔴 쉬는 중인 키도 **그대로 준다** — 막지 않는다(CLAUDE §9). «우리 키로 대신 돌릴까»는 호출부의 **돈 결정**이다.
 *   🔴 `status='invalid'` 인 키는 **안 준다** — 틀린 키로 계속 때리면 제공사가 그 집을 막는다(그건 «막지 않는다»의 대상이 아니다).
 */
export async function byoKeyFor(tenantId?: number | null): Promise<ByoKey | null> {
  const tid = Math.floor(Number(tenantId) || 0);
  if (!tid || !credsEncConfigured()) return null;
  /* 🔴 기능이 꺼져 있으면 **이미 꽂아 둔 키도 안 쓴다** — 꺼진 기능이 뒤에서 도는 게 제일 나쁘다(고객은 우리 키로 도는 줄 안다).
     표의 행은 **안 지운다**: 다시 켜면 그 자리에서 이어진다(고객이 다시 꽂게 만들지 않는다). */
  if (!(await featureOn("byoAiKey"))) return null;
  const hit = cache.get(tid);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.key;
  try {
    const [r] = await q(sql`SELECT id, label, key_enc, rested_until FROM tenant_ai_keys
      WHERE tenant_id = ${tid} AND status = 'active' ORDER BY (rested_until IS NULL OR rested_until <= NOW()) DESC, id LIMIT 1`);
    const plain = r ? decrypt(String(r.key_enc ?? "")) : null;
    const out: ByoKey | null = plain ? { key: plain, label: String(r.label ?? "내 키") } : null;
    cache.set(tid, { at: Date.now(), key: out, id: r ? n(r.id) : 0 });
    return out;
  } catch (e) {
    console.warn("[ai-key-byo] 키 조회 실패 — 우리 키로 간다", String((e as Error)?.message ?? e).slice(0, 100));
    return null;
  }
}

/** 방금 쓴 그 키의 행 id(결과를 적으려면 필요하다). `byoKeyFor` 가 캐시에 같이 담아 둔다. */
export function byoKeyIdOf(tenantId?: number | null): number {
  return cache.get(Math.floor(Number(tenantId) || 0))?.id ?? 0;
}

/**
 * markByoOutcome — 고객 키로 부른 결과를 표에 적는다.
 *   🔴 `quota` 만 쉬게 한다(60초). **503·타임아웃은 키 탓이 아니다** — 그걸로 쉬게 하면 제공사가 흔들릴 때 멀쩡한 키가 쉰다(B-1 규율).
 *   🔴 `invalid`·`forbidden` 이면 **꺼 둔다** — 틀린 키로 계속 때리면 그 집이 제공사에서 막힌다. 고객이 고쳐 꽂으면 다시 산다.
 */
export async function markByoOutcome(tenantId: number, outcome: "ok" | ByoErrorKind): Promise<void> {
  const tid = Math.floor(Number(tenantId) || 0);
  const id = byoKeyIdOf(tid);
  if (!tid || !id) return;
  try {
    if (outcome === "ok") {
      await q(sql`UPDATE tenant_ai_keys SET last_ok_at = NOW(), rested_until = NULL, last_error_kind = NULL, updated_at = NOW() WHERE id = ${id}`);
    } else if (outcome === "quota") {
      await q(sql`UPDATE tenant_ai_keys SET rested_until = NOW() + interval '60 seconds', last_error_at = NOW(), last_error_kind = ${"quota"}, updated_at = NOW() WHERE id = ${id}`);
    } else {
      await q(sql`UPDATE tenant_ai_keys SET status = ${"invalid"}, last_error_at = NOW(), last_error_kind = ${outcome}, updated_at = NOW() WHERE id = ${id}`);
      cache.delete(tid);   // 다음 호출은 우리 풀로(꺼진 키를 캐시가 계속 주지 않게)
    }
  } catch (e) { console.warn("[ai-key-byo] 결과 기록 실패", String((e as Error)?.message ?? e).slice(0, 100)); }
}

/** 실패 사유 → 고객이 할 일이 갈리는 셋. 🔴 «오류»로 뭉치지 않는다. */
export function byoErrorKind(reason: unknown): ByoErrorKind | null {
  const s = String(reason ?? "");
  if (/API[_\s-]?KEY[_\s-]?INVALID|api key not valid|invalid[_\s-]api[_\s-]key|\b400\b.*key/i.test(s)) return "invalid";
  if (/(^|\D)429(\D|$)|RESOURCE_EXHAUSTED|quota|rate[\s_-]?limit/i.test(s)) return "quota";
  if (/(^|\D)40[13](\D|$)|PERMISSION_DENIED|forbidden|not authorized/i.test(s)) return "forbidden";
  return null;
}
/** 사유 셋을 사람말로 — 고객이 **무엇을 해야 하는지**가 달라서 문구도 달라야 한다. */
export const BYO_ERROR_TEXT: Record<ByoErrorKind, string> = {
  invalid: "키가 맞지 않아요. 구글 AI 스튜디오에서 키를 다시 복사해 주세요.",
  quota: "키가 이번 한도에 걸렸어요. 한도가 풀리면 다시 만들어요.",
  forbidden: "이 키에 권한이 없어요. 키를 만든 프로젝트에서 Generative Language API 를 켜 주세요.",
};

/**
 * verifyByoKey — 🔴 **그 키로 한 번 실제로 걸어 본다.** 제일 싼 호출(`models.list`)만 쓴다.
 *   🔴 **우리 키로 새지 않는다** — 넘겨받은 키만 쓴다(우리가 남의 확인 비용을 내지 않는다).
 *   반환: `{ ok: true }` 또는 `{ ok: false, kind, error }`(사람말).
 */
export async function verifyByoKey(key: string): Promise<{ ok: true } | { ok: false; kind: ByoErrorKind; error: string }> {
  const k = String(key ?? "").trim();
  if (!k) return { ok: false, kind: "invalid", error: BYO_ERROR_TEXT.invalid };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12_000);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}`, { signal: ctl.signal }).finally(() => clearTimeout(timer));
    if (res.ok) return { ok: true };
    const body = redactKeys(await res.text().catch(() => ""));   // 🔴 본문이 키를 되비칠 수 있다
    const kind = byoErrorKind(`${res.status} ${body}`) ?? (res.status === 403 ? "forbidden" : "invalid");
    return { ok: false, kind, error: BYO_ERROR_TEXT[kind] };
  } catch (e) {
    /* 🔴 못 잰 것을 «틀린 키»라고 하지 않는다(AC-9) — 네트워크가 막힌 것일 수 있다. 그때는 «한도»도 «권한»도 아니다. */
    const msg = redactKeys(String((e as Error)?.message ?? e));
    console.warn("[ai-key-byo] 확인 호출 실패", msg.slice(0, 120));
    return { ok: false, kind: "invalid", error: "지금은 키를 확인하지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
}

/** 이 집이 꽂아 둔 키 목록(가려진 모양). */
export async function listByoKeys(tenantId: number): Promise<ByoKeyView[]> {
  const rows = await q(sql`SELECT id, label, provider, status, masked, last_ok_at, last_error_at, last_error_kind, rested_until
    FROM tenant_ai_keys WHERE tenant_id = ${Math.floor(tenantId)} ORDER BY id`);
  return rows.map(toView);
}

/**
 * saveByoKey — 꽂는다. 🔴 **확인에 성공해야 저장한다**(안 되는 키를 «등록됨»으로 두지 않는다).
 */
export async function saveByoKey(tenantId: number, key: string, label?: string): Promise<{ ok: true; id: number } | { ok: false; kind: ByoErrorKind | "not_configured"; error: string }> {
  const tid = Math.floor(Number(tenantId) || 0);
  if (!(await featureOn("byoAiKey"))) return { ok: false, kind: "not_configured", error: "지금은 내 키를 꽂는 기능을 쓰지 않아요." };
  const k = String(key ?? "").trim();
  if (!credsEncConfigured()) return { ok: false, kind: "not_configured", error: "지금은 키를 안전하게 보관할 수 없어요. 운영팀에 알려 주세요." };
  if (k.length < 20) return { ok: false, kind: "invalid", error: BYO_ERROR_TEXT.invalid };
  const v = await verifyByoKey(k);
  if (!v.ok) return { ok: false, kind: v.kind, error: v.error };
  const [r] = await q(sql`INSERT INTO tenant_ai_keys (tenant_id, provider, label, key_enc, masked, status, last_ok_at)
    VALUES (${tid}, ${"gemini"}, ${String(label ?? "내 키").slice(0, 40)}, ${encrypt(k)}, ${maskSecret(k)}, ${"active"}, NOW()) RETURNING id`);
  cache.delete(tid);
  return { ok: true, id: n(r?.id) };
}

/** 뺀다. 🔴 **그 키로 쓴 `ai_usage` 는 남긴다** — 돈 쓴 기록은 어떤 정리에서도 안 지운다(행 자신이 `byo` 를 들고 있다). */
export async function deleteByoKey(tenantId: number, id: number): Promise<boolean> {
  const tid = Math.floor(Number(tenantId) || 0);
  const rows = await q(sql`DELETE FROM tenant_ai_keys WHERE tenant_id = ${tid} AND id = ${Math.floor(id)} RETURNING id`);
  cache.delete(tid);
  return rows.length > 0;
}

/**
 * noteFallback — 🔴 **대신 돈 사실을 반드시 알린다**(메인 조건 3). 이게 없으면 «조용히 우리 키로 넘어가기»(=반대한 (다)안)와 같아진다.
 *   · 감사 `ai_key_fallback_used`(medium) — 돈이 우리 쪽에서 나간 자리라 반드시 남긴다.
 *   · 알림은 **하루 한 번**(KST) — 글 한 편에 모델을 여러 번 부르므로 매번 알리면 알림함이 도배된다.
 *   🔴 문구에 «코인 N개»를 쓰지 않는다 — **지금은 코인을 더 받지 않기 때문**이다(편당 코인은 이미 받았다).
 *      «BYO 면 코인 0» 을 정하시면 그때 대신 차감이 말이 되고, 그때 이 문구도 같이 바뀐다(메인에 올려 둔 항목).
 */
export async function noteFallback(tenantId: number, kind: ByoErrorKind, model: string): Promise<void> {
  const tid = Math.floor(Number(tenantId) || 0);
  if (!tid) return;
  try {
    const { writeAudit } = await import("./audit");
    await writeAudit({ tenantId: tid, action: "ai_key_fallback_used", actorType: "system", riskLevel: "medium",
      detail: { kind, model, note: "고객 키가 안 되어 우리 키로 대신 돌림(고객이 미리 켜 둔 경우만)" } });
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
      SELECT ${tid}, ${"ai_key_fallback"}, ${"내 키가 안 되어 대신 만들었어요"},
             ${`${BYO_ERROR_TEXT[kind]} 그래서 이번에는 저희 키로 대신 만들었어요(«내 키가 안 될 때 대신 돌리기»를 켜 두셔서요). 끄고 싶으시면 설정에서 언제든 끄실 수 있어요.`},
             ${"/app/settings.html#ai-key"}
      WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE tenant_id = ${tid} AND kind = 'ai_key_fallback'
        AND created_at >= (date_trunc('day', (NOW() AT TIME ZONE 'Asia/Seoul')) AT TIME ZONE 'Asia/Seoul'))`);
  } catch (e) { console.warn("[ai-key-byo] 대신 돌림 알림 실패", String((e as Error)?.message ?? e).slice(0, 100)); }
}

/** 🔴 «내 키가 안 되면 코인으로 대신 돌려 주세요» — **기본 꺼짐**. 고객이 직접 켤 때만 참이다. */
export async function fallbackAllowed(tenantId?: number | null): Promise<boolean> {
  const tid = Math.floor(Number(tenantId) || 0);
  if (!tid) return false;
  try {
    const [r] = await q(sql`SELECT ai_key_fallback FROM tenants WHERE id = ${tid}`);
    return r?.ai_key_fallback === true;
  } catch { return false; }
}
