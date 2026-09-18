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
 *   🔎 출처: AC 신규(계약 P1R7-B §3 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { sql, type SQL } from "drizzle-orm";
import { q } from "../accounts";

/** owner 메일 도메인이 이것이면 내부. 사장님 테스트 계정(`test@autocreate.kr`)도 여기 든다 — 실카드 실측 결제가 매출로 잡히면 안 된다. */
export const INTERNAL_EMAIL_DOMAINS: readonly string[] = ["autocreate.kr", "autocreate.test", "autocreate.dev", "test.local", "example.invalid", "example.com"];
/**
 * 하니스가 만드는 테넌트 키 모양(가입 이메일 앞부분에서 온다 · `lib/validate.ts tenantKeyFrom`).
 *
 * 🔴 [2026-09-19 수리 · 시나리오 B ①] **끝 경계를 막았다 — 옛 판은 «앞글자만 같으면» 삼켰다.**
 *   옛 판 `/^(verify|smoke|test|…|r[0-9]|…)/i` 은 **진짜 상호**를 내부로 켰다(실측):
 *     `smokehouse-…`(고깃집) · `demolition-…`(철거) · `skipper-…` · `testkim-…` · `r3design-…` · `r2coffee-…`
 *   그 집은 운영 목록에서 **사라지고**(기본 집계에서 빠진다), 운영자는 «가입 기록이 없는데요» 라고 말하게 된다.
 *   🔴 **표시어는 낱말이어야 한다** — 바로 뒤가 **숫자나 구분자**(`[0-9-]`)일 때만 하니스로 본다.
 *     `tenantKeyFrom` 이 `<메일앞부분 12자>-<무작위 6자>` 로 만들므로 **앞부분이 표시어 그 자체면 뒤에 `-` 가 온다** —
 *     그래서 `test-56j02y`·`smoke6178942-…`·`verify1789…` 는 그대로 잡히고, `smokehouse-…` 는 놓아준다.
 *   🔴 `c\+` 갈래는 **지웠다 — 죽은 갈래였다**: 키는 영숫자만 남기므로(`replace(/[^a-z0-9]/g,"")`) `+` 가 키에 올 수 없다.
 *   🔴 **둘째 갈래 — 표시어 뒤에 글자가 더 붙어도 «시계 도장»이 찍혀 있으면 하니스다.**
 *     첫 판(경계만 막기)은 `r8ta17894918-29buhy` 같은 **진짜 하니스 키를 놓쳤다**(자가 잡아 줬다 · 2026-09-19).
 *     우리 하니스는 메일에 `Date.now()` 를 박고, 그 앞부분이 12자로 잘려 **숫자 네 자리 이상이 이어진 채** 남는다.
 *     그래서 «표시어 + 글자 몇 + 숫자4» 도 하니스로 본다 — `r8ta1789…` ✅ · `r4smokea1789` ✅.
 *     진짜 상호는 `-`(무작위 꼬리) 가 먼저 와서 숫자4에 못 닿는다 — `smokehouse-…` · `demoday-…` · `r3design-…` 는 놓아준다.
 *   ⚠️ **남는 위험은 적어 둔다**(AC-9): `test2024@…` 처럼 «표시어 + 숫자»인 진짜 상호는 여전히 삼킨다.
 *      그 대신 ㉡ 로 **화면이 «N곳 숨겼어요»를 말하고 한 번에 꺼낼 수 있게** 했고, 운영자가 손으로 끄면 크론이 다시 안 켠다.
 *      «삼킬 수 있다»를 «안 삼킨다»로 적지 않는다 — 대신 **보이게** 만든 것이다.
 *   🔴 이 정규식의 `source` 는 아래 SQL 이 `~*` 로 **그대로** 쓴다 — 그래서 **POSIX 로도 도는 모양만** 쓴다
 *      (앞보기 `(?!…)` 금지 · 역참조 금지). 자(`verify-ops-contract.mjs`)가 상호 표·하니스 표로 양쪽을 대조한다.
 */
export const INTERNAL_KEY_RE = /^(verify|smoke|test|harness|demo|skip|r[0-9]|ac-?test|p1r[0-9]|live-?c[0-9])([0-9-]|[a-z]*[0-9]{4})/i;
/**
 * 손으로 지정하는 내부 집(메인 지시 2026-09-15) — **보존 4집**(3 C검증 · 13 C검증 · 109 B2실증 · 116 애드포스트 실증)과
 * 198(사장님 테스트 계정 `test@autocreate.kr` · 실카드 실측 결제가 매출로 잡히면 안 된다 · 도메인 규칙으로도 잡힌다).
 * 🔴 이 목록은 «지운다»가 아니라 «숫자에서 뺀다»다 — 데이터는 그대로 있고 운영 화면 토글로 언제든 보인다.
 */
export const INTERNAL_TENANT_IDS: readonly number[] = [3, 13, 109, 116, 198];

/**
 * 🔴 [2026-09-19 수리 · 시나리오 B ①] **돈을 낸 집은 자동 규칙이 못 건드린다.**
 *   추측 규칙(도메인·키 모양·사용자 0명)이 아무리 잘 맞아도 **결제한 집은 우리 시험용 집일 수 없다.**
 *   그래서 «돈 흔적»이 있으면 자동으로는 안 켠다 — 켜야 하면 운영자가 손으로 켠다(`internal_manual_at`).
 *   ⚠️ **보존 id 목록에는 이 안전선을 걸지 않는다** — 198(사장님 테스트 계정)은 **실카드로 실제 결제**를 했고
 *      그 돈이 매출로 잡히면 안 되는 것이 애초에 그 목록의 이유다(메인 지시 2026-09-15).
 */
const PAID_TRACE = sql`(
     EXISTS (SELECT 1 FROM invoices iv WHERE iv.tenant_id = t.id AND iv.paid_at IS NOT NULL)
  OR EXISTS (SELECT 1 FROM billing_keys bk WHERE bk.tenant_id = t.id AND bk.active = true)
  OR EXISTS (SELECT 1 FROM subscriptions sb WHERE sb.tenant_id = t.id AND sb.status = 'active')
)`;

/** 내부 여부를 **자동으로 켠다**(끄지 않는다). 반환 = 이번에 새로 켜진 수. 크론 `tenant.purge` 가 하루 1번 부른다 + 가입 때 1건씩. */
export async function syncInternalFlags(): Promise<{ marked: number }> {
  const domains = INTERNAL_EMAIL_DOMAINS.map((d) => `@${d}`);
  const rows = await q(sql`UPDATE tenants t SET is_internal = true, updated_at = NOW()
    WHERE t.is_internal = false AND t.internal_manual_at IS NULL AND (
      t.id IN (${sql.join(INTERNAL_TENANT_IDS.map((i) => sql`${i}`), sql`, `)})
      OR ((
           EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.id AND (${sql.join(domains.map((d) => sql`LOWER(u.email) LIKE ${"%" + d}`), sql` OR `)}))
        OR t.key ~* ${INTERNAL_KEY_RE.source}
        OR NOT EXISTS (SELECT 1 FROM users u2 WHERE u2.tenant_id = t.id)
      ) AND NOT ${PAID_TRACE})
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
