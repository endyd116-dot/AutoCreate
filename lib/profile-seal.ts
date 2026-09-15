/**
 * lib/profile-seal.ts — **러너 프로필 봉인 열쇠를 서버가 쥔다**(P1R8 §3.1 / ④11 · 설계 `docs/active/2026-09-15-runner-profile-seal-design.md` §4).
 *   AC 신규 2026-09-15(B2). 메인 승인 2026-09-15(설계 §8 네 가지).
 *
 *   ══ 🔴 이 파일이 파는 것은 **딱 한 가지**다 ══
 *     **«러너 폴더를 복사해 가면 안 열린다.»** 그 이상은 못 만든다(설계 §1):
 *     그 PC 에서 그 사용자로 코드를 돌릴 수 있는 사람은 **원리상 못 막는다** — 러너가 풀 수 있으면 그 사람도 푼다.
 *     그래도 이건 진짜 값이 있다. 그리고 **DPAPI 로는 못 하는 것이 하나 더 있다**:
 *     🔴 **폐기**. 기기를 잃어버리면 그 집의 열쇠를 지운다 → 훔쳐 간 `.sealed` 는 **영원히 안 열린다.**
 *
 *   ══ 왜 «계정당» 인가(기기당이 아니라) ══
 *     같은 계정을 두 PC 에서 굴릴 수 있어야 한다(집·노트북). 기기당 키면 한쪽에서 봉한 걸 다른 쪽이 못 연다.
 *
 *   ══ 어디로 내려가나 ══
 *     claim 응답 — **쿠키가 이미 가는 그 길**이다. 평문 표면을 **늘리지 않는다**(DESIGN §7.1 «평문 표면 2곳»).
 *
 *   ══ 🔴 누구에게 내려가나 — 측정으로 고른다(설계 §5) ══
 *     Windows·맥은 OS 가 이미 기기에 묶어 잠근다. 거기에 봉인을 켜면 얻는 건 «폐기 가능성»뿐이고
 *     **잃을 것(봉인이 깨져 로그인을 잃는 위험)은 그대로**다. 그래서 **러너가 «약하다»고 잰 기기부터** 켠다
 *     (`caps.profileSeal.state === "weak"` = 크로미움이 공개된 고정 키로 잠갔다 = 복사하면 열린다).
 *     🔴 «리눅스면» 이 아니라 «**약하다고 쟀으면**» 이다 — 추정이 아니라 측정으로 고른다(AC-57).
 */
import { sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../db/index";
import { encryptObj, decryptObj, credsEncConfigured } from "./creds-crypto";
import { writeAudit } from "./audit";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

/** `account_creds.kind` — varchar(16) 이라 DDL 이 필요 없다(기존 어휘 cookies|password|oauth|app_password 옆). */
const KIND = "profile_key";

/**
 * 🔴 **봉인을 켤 기기인가.** 러너가 잰 값으로만 판단한다.
 *   `weak`  = 크로미움이 **공개된 고정 키**로 잠갔다(리눅스·키링 없음) → 복사하면 열린다 → **여기가 값이다**
 *   `os`·`keyring` = OS 가 이미 기기에 묶었다 → 지금은 안 켠다(설계 §5 우선순위)
 *   `unknown`·`none` = **모른다 → 안 켠다**(모르는 기기에 새 위험을 먼저 심지 않는다 · AC-9)
 *   `PROFILE_SEAL_ALL=1` 이면 전 기기(단계 배포 3단계 · 설계 §6).
 */
export function sealWantedFor(caps: unknown): boolean {
  if (String(process.env.PROFILE_SEAL_ALL ?? "") === "1") return true;
  const ps = (caps && typeof caps === "object" ? (caps as Record<string, unknown>).profileSeal : null) as Record<string, unknown> | null;
  return !!ps && String(ps.state ?? "") === "weak";
}

/**
 * 이 계정의 봉인 열쇠(hex 64자 = 32바이트). 없으면 **만들어서** 준다.
 *   🔴 `CREDS_ENC_KEY` 가 없으면 **만들지 않는다** — 금고 없이 열쇠를 만들면 그 열쇠가 평문으로 남는다.
 *   🔴 반환값은 **평문 열쇠**다. 이 함수를 부르는 자리는 `loadAccountForRunner` **하나**여야 한다.
 */
export async function ensureProfileKey(tid: number, accountId: number): Promise<string | null> {
  if (!credsEncConfigured()) return null;
  const [row] = await q(sql`SELECT enc FROM account_creds
    WHERE account_id = ${accountId} AND kind = ${KIND} AND purged_at IS NULL ORDER BY id DESC LIMIT 1`);
  if (row?.enc) {
    const o = decryptObj<{ key?: string }>(String(row.enc));
    if (o?.key && /^[0-9a-f]{64}$/i.test(o.key)) return o.key.toLowerCase();
    /* 복호화가 안 되거나 모양이 틀렸다 — 🔴 **새로 만들지 않는다**. 새로 만들면 이미 봉해 둔 프로필이
       영영 안 열리고, 그건 고객이 전 계정을 재로그인하는 일이다(우리가 제일 피하려는 것 · AC-19).
       대신 «모른다»로 두고 러너는 봉인 없이 돈다(fail-open) — 사람이 볼 수 있게 감사에 남긴다. */
    await writeAudit({ tenantId: tid, action: "profile_key_unreadable", actorType: "system", target: `account:${accountId}`,
      detail: { note: "봉인 열쇠를 복호화하지 못했다 — 새로 만들지 않고 봉인을 건너뛴다(기존 봉인본을 못 열게 되므로)" }, riskLevel: "high" });
    return null;
  }
  const key = crypto.randomBytes(32).toString("hex");
  await q(sql`INSERT INTO account_creds (tenant_id, account_id, kind, enc, verified_at)
    VALUES (${tid}, ${accountId}, ${KIND}, ${encryptObj({ key })}, NOW())`);
  await writeAudit({ tenantId: tid, action: "profile_key_created", actorType: "system", target: `account:${accountId}`,
    detail: { note: "러너 프로필 봉인 열쇠 발급(값은 남기지 않는다)" }, riskLevel: "medium" });
  return key;
}

/**
 * 🔴 **폐기** — 기기를 잃어버렸을 때. 이 순간부터 그 집의 `.sealed` 는 **영원히 안 열린다.**
 *   DPAPI 로는 못 하는 일이고, 이 설계의 진짜 값이다(설계 §4.3).
 *   ⚠️ 되돌릴 수 없다 — 그 PC 에 남은 봉인본도 같이 죽는다. 고객은 **다시 로그인**해야 한다.
 *      그래서 부르는 자리는 «기기를 잃었다»가 확실할 때뿐이고, 사람이 누른다.
 */
export async function purgeProfileKeys(tid: number, accountId?: number): Promise<number> {
  const rows = await q(sql`UPDATE account_creds SET purged_at = NOW()
    WHERE tenant_id = ${tid} AND kind = ${KIND} AND purged_at IS NULL
      ${accountId ? sql`AND account_id = ${accountId}` : sql``} RETURNING id`);
  if (rows.length) {
    await writeAudit({ tenantId: tid, action: "profile_key_purged", actorType: "user", target: accountId ? `account:${accountId}` : "tenant",
      detail: { keys: rows.length, note: "훔쳐 간 프로필 봉인본은 이제 영영 안 열린다 · 고객은 다시 로그인해야 한다" }, riskLevel: "high" });
  }
  return rows.length;
}
