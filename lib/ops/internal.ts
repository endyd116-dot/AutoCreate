/**
 * lib/ops/internal.ts — «내부 테스트» 구분(계약 P1R7 §3.4 · 사장님 질문 «AI 원가 15,820원이 뭐냐»에 대한 답).
 *   우리가 만든 검증·하니스·데모 테넌트가 운영 숫자(매출·MRR·가입·AI 원가·수익 회수·발행 수)에 섞이면 **숫자를 못 믿는다.**
 *   그래서 `tenants.is_internal` 한 칸으로 가르고, 운영 화면의 **기본 집계에서 뺀다**(«내부 포함» 토글을 켜면 보인다 · 숨기지 않는다).
 *
 *   ══ 누가 내부인가 ══
 *     ① 우리 도메인 메일(owner 기준 · `autocreate.kr`·`autocreate.test`·`autocreate.dev`·`test.local`·`example.invalid`)
 *     ② 하니스가 만든 키 모양(`verify…`·`smoke…`·`r6…`·`skip…` 등 · `INTERNAL_KEY_RE`)
 *     ③ **사용자가 0명**인 집(하니스가 중간에 죽어 남은 껍데기 — 고객일 수 없다)
 *     ④ **보존 4집 + 사장님 테스트 계정**(`INTERNAL_TENANT_IDS`) — 지우지 않고 **숫자에서만 뺀다**(메인 지시 2026-09-15)
 *     ⑤ 운영자가 손으로 켠 것(`POST /api/ops-tenant-update { id, isInternal }`) — ①~④로 자동으로 켜진 것도 끌 수 있다(손이 이긴다).
 *   🔴 ①~④는 **켜기만 한다**(자동으로 끄지 않는다) · 운영자가 손으로 지정한 집(`internal_manual_at` 이 있는 집)은 **아예 건드리지 않는다** —
 *      끈 것을 크론이 다시 켜면 손이 진다(2026-09-15 스모크에서 실제로 그랬다).
 *   🔴 보호 테넌트(3·13·109·116·198)도 규칙에 걸리면 내부로 **표시**될 뿐이다 — 데이터는 건드리지 않는다(삭제·정지 아님).
 */
import { sql, type SQL } from "drizzle-orm";
import { q } from "../accounts";

/** owner 메일 도메인이 이것이면 내부. 사장님 테스트 계정(`test@autocreate.kr`)도 여기 든다 — 실카드 실측 결제가 매출로 잡히면 안 된다. */
export const INTERNAL_EMAIL_DOMAINS: readonly string[] = ["autocreate.kr", "autocreate.test", "autocreate.dev", "test.local", "example.invalid", "example.com"];
/** 하니스가 만드는 테넌트 키 모양(가입 이메일 앞부분에서 온다 · `lib/validate.ts tenantKeyFrom`). */
export const INTERNAL_KEY_RE = /^(verify|smoke|test|harness|demo|skip|r[0-9]|ac-?test|p1r[0-9]|live-?c[0-9]|c\+)/i;
/**
 * 손으로 지정하는 내부 집(메인 지시 2026-09-15) — **보존 4집**(3 C검증 · 13 C검증 · 109 B2실증 · 116 애드포스트 실증)과
 * 198(사장님 테스트 계정 `test@autocreate.kr` · 실카드 실측 결제가 매출로 잡히면 안 된다 · 도메인 규칙으로도 잡힌다).
 * 🔴 이 목록은 «지운다»가 아니라 «숫자에서 뺀다»다 — 데이터는 그대로 있고 운영 화면 토글로 언제든 보인다.
 */
export const INTERNAL_TENANT_IDS: readonly number[] = [3, 13, 109, 116, 198];

/** 내부 여부를 **자동으로 켠다**(끄지 않는다). 반환 = 이번에 새로 켜진 수. 크론 `tenant.purge` 가 하루 1번 부른다 + 가입 때 1건씩. */
export async function syncInternalFlags(): Promise<{ marked: number }> {
  const domains = INTERNAL_EMAIL_DOMAINS.map((d) => `@${d}`);
  const rows = await q(sql`UPDATE tenants t SET is_internal = true, updated_at = NOW()
    WHERE t.is_internal = false AND t.internal_manual_at IS NULL AND (
      EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.id AND (${sql.join(domains.map((d) => sql`LOWER(u.email) LIKE ${"%" + d}`), sql` OR `)}))
      OR t.key ~* ${INTERNAL_KEY_RE.source}
      OR NOT EXISTS (SELECT 1 FROM users u2 WHERE u2.tenant_id = t.id)
      OR t.id IN (${sql.join(INTERNAL_TENANT_IDS.map((i) => sql`${i}`), sql`, `)})
    ) RETURNING t.id`);
  return { marked: rows.length };
}

/** 이 메일·키가 내부로 보이나(가입 시점 판정 — DB 를 타지 않는다). */
export function looksInternal(email: string | null | undefined, key: string | null | undefined, tid?: number): boolean {
  if (tid && INTERNAL_TENANT_IDS.includes(tid)) return true;
  const e = String(email ?? "").toLowerCase();
  if (INTERNAL_EMAIL_DOMAINS.some((d) => e.endsWith(`@${d}`))) return true;
  return INTERNAL_KEY_RE.test(String(key ?? ""));
}

/**
 * 집계에서 내부를 빼는 조각. `include` 가 true 면 빈 조각(전부 포함).
 *   쓰는 법: `WHERE status = 'paid' ${excludeInternal(sql\`tenant_id\`, include)}` — **AND 를 포함해서** 돌려준다.
 *   tenants 표 자체를 셀 때는 `excludeInternalOn(sql\`t\`)` 처럼 별칭을 준다.
 */
export function excludeInternal(tenantIdCol: SQL, include: boolean): SQL {
  return include ? sql`` : sql` AND NOT EXISTS (SELECT 1 FROM tenants zi WHERE zi.id = ${tenantIdCol} AND zi.is_internal)`;
}
/** tenants 표를 직접 셀 때(별칭 지정). 역시 AND 를 포함해 돌려준다. */
export function excludeInternalSelf(alias: SQL, include: boolean): SQL {
  return include ? sql`` : sql` AND ${alias}.is_internal = false`;
}
/** 운영 화면의 «내부 포함» 토글 — `?internal=1`(또는 `includeInternal=1`) 이면 포함. 기본은 제외. */
export function includeInternalOf(url: URL): boolean {
  const v = url.searchParams.get("internal") ?? url.searchParams.get("includeInternal") ?? "";
  return v === "1" || v === "true";
}
