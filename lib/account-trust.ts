/**
 * lib/account-trust.ts — «이 계정을 믿고 **사람 없이** 내보내도 되나»(DESIGN §4.2 «자동승인(**신뢰 계정**)» · 계약 P1R8 §5.2).
 *   🔎 출처: AC 신규(계약 P1R8 §5.2 · 생성 2026-09-15) — AM 원본 없음.
 *
 *   ══ 무엇이 빠져 있었나 ══
 *     설계는 자동 승인을 **계정 단위 신뢰**로 말하는데, 코드에는 **테넌트 단위 스위치**(`settings.reviewPolicy`)와
 *     **요금제 게이트**(`autoApproveAllowed`)뿐이었다 — 즉 «어제 연결한 새 계정»도 스위치 하나면 사람 없이 나갔다.
 *
 *   ══ 🔴 `health_score` 만으로는 못 판단한다(AC-9) ══
 *     `recomputeHealth` 는 기록이 없으면 **100 을 준다**(«아직 모른다 = 깎지 않는다»). 그래서 **한 번도 안 써 본 계정도 100점**이다.
 *     점수가 높다 ≠ 믿을 만하다 — 신뢰는 **성공한 적이 있다**는 증거로만 선다. 그래서 이 판정기는 «없음»을 «좋음»으로 읽지 않는다.
 *
 *   ══ 신뢰의 조건(전부 참이어야 한다) ══
 *     ① **성공 발행이 {TRUST_MIN_SUCCESS}건 이상**(`posts` 행 · 실제로 나간 글)
 *     ② `health_score >= {TRUST_MIN_HEALTH}`
 *     ③ 계정 상태가 `active`(다시 로그인·정지·쿨다운이 아니다)
 *     ④ **워밍업 중이 아니다**(새 계정을 천천히 올리는 기간엔 사람이 본다)
 *   🔴 조건을 못 채우면 «나쁜 계정»이 아니라 **«아직 모르는 계정»**이다 — 문구도 그렇게 쓴다(고객을 나무라지 않는다).
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { warmupState } from "./warmup";   // [P1R8 §5.2] 워밍업은 표가 아니라 «열린 날 + 끔 스위치»에서 계산한다(lib/warmup.ts 정본)

/** 성공 발행 몇 건부터 믿나 — 작게 잡는다(3건이면 이틀이면 넘는다 · 새 고객의 자동 발행을 오래 막지 않으려고). */
export const TRUST_MIN_SUCCESS = 3;
/** 건강도 하한(100 만점 · 실패가 섞이면 바로 내려간다). */
export const TRUST_MIN_HEALTH = 70;

export interface AccountTrust {
  accountId: number;
  trusted: boolean;
  /** 왜 아직 아닌가 — 사람이 읽는 한 줄(신뢰면 빈 배열). */
  reasons: string[];
  evidence: { successes: number; health: number; status: string; warmingUp: boolean };
}

/**
 * accountsTrust — 계정 여러 개를 한 번에(글마다 질의하지 않게).
 *   🔴 워밍업 판정은 **`lib/warmup.ts warmupState` 한 곳**을 부른다 — 여기서 다시 계산하지 않는다(판정기 두 벌 금지).
 *      처음엔 `account_warmup` 이라는 **없는 표**를 읽는 SQL 을 적었다가 실측에서 잡았다(표는 없고 `accounts.warmup_off` + `opened_at` 이 정본 · 2026-09-15).
 *      tsc 는 SQL 안을 못 본다 — «적어 두면 그렇게 된다»가 아니라 **돌려 봐야 안다**(AC-54).
 */
export async function accountsTrust(tid: number, accountIds: number[]): Promise<Map<number, AccountTrust>> {
  const out = new Map<number, AccountTrust>();
  const ids = [...new Set(accountIds.map((x) => Math.floor(Number(x) || 0)).filter((x) => x > 0))];
  if (!ids.length) return out;
  const rows = await q(sql`
    SELECT a.id, a.status, a.health_score, COALESCE(a.warmup_off, false) AS warmup_off, a.opened_at, a.created_at,
           (SELECT COUNT(*)::int FROM posts po WHERE po.tenant_id = a.tenant_id AND po.account_id = a.id) AS successes
    FROM accounts a
    WHERE a.tenant_id = ${tid} AND a.id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  for (const r of rows) {
    const id = Math.floor(Number(r.id) || 0);
    const successes = Math.floor(Number(r.successes) || 0);
    const health = Math.floor(Number(r.health_score) ?? 0);
    const status = String(r.status ?? "");
    const warmingUp = warmupState({ off: r.warmup_off === true, openedAt: r.opened_at as string | null, createdAt: r.created_at as string | null }).active;
    const reasons: string[] = [];
    if (successes < TRUST_MIN_SUCCESS) reasons.push(`아직 ${successes}건만 나갔어요(${TRUST_MIN_SUCCESS}건부터 자동으로 내보내요)`);
    if (health < TRUST_MIN_HEALTH) reasons.push(`계정 상태 점수가 ${health}점이에요(${TRUST_MIN_HEALTH}점부터)`);
    if (status !== "active") reasons.push("계정이 아직 연결을 기다리고 있어요");
    if (warmingUp) reasons.push("천천히 올리는 기간(워밍업)이라 처음 몇 편은 직접 봐 주세요");
    out.set(id, { accountId: id, trusted: reasons.length === 0, reasons, evidence: { successes, health, status, warmingUp } });
  }
  /* 🔴 표에 없는 계정 id(지워졌거나 남의 것)는 **신뢰하지 않는다** — 조회에 안 잡혔다는 이유로 통과시키면 그게 구멍이다. */
  for (const id of ids) {
    if (!out.has(id)) out.set(id, { accountId: id, trusted: false, reasons: ["계정을 찾지 못했어요"], evidence: { successes: 0, health: 0, status: "unknown", warmingUp: false } });
  }
  return out;
}

/** 한 계정만. */
export async function accountTrust(tid: number, accountId: number): Promise<AccountTrust> {
  const m = await accountsTrust(tid, [accountId]);
  return m.get(Math.floor(Number(accountId) || 0)) ?? { accountId, trusted: false, reasons: ["계정을 찾지 못했어요"], evidence: { successes: 0, health: 0, status: "unknown", warmingUp: false } };
}
