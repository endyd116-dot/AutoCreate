/**
 * lib/ai-budget.ts — 테넌트·일 AI 원가 상한 «상태»(계약 P1R4 §2.2 · DESIGN §10 · `ai_settings.cost_cap_krw`).
 *   오늘(KST) 그 테넌트의 `ai_usage.cost_usd` 합 → KRW 환산(`USD_KRW_RATE` · 기본 1350) vs 상한.
 *   🔴 여기서 «막지»는 않는다 — 상태만 돌려준다(재사용 가능한 원시 함수). 강제(생성 차단)는 호출부가 결정한다.
 *      범위 지도: 상한 «집행»(content-gen 체결)은 메인 조율 후 다음 단계 — 이 파일은 «키 꽂으면 즉시» 상태다.
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";

/** USD→KRW 환산율(환경변수로 조정 · 기본 1350). 원가 표시·상한 비교 전용 — 정산이 아니다. */
const USD_KRW = Math.max(500, Number(process.env.USD_KRW_RATE) || 1350);

export interface AiCostCapState {
  capKrw: number | null;      // NULL = 무제한
  spentKrw: number;           // 오늘(KST) 이 테넌트가 쓴 AI 원가(원)
  remainingKrw: number | null;
  over: boolean;              // 상한이 있고 이미 도달/초과했나
}

export async function aiCostCapState(tid: number): Promise<AiCostCapState> {
  const [s] = await q(sql`SELECT cost_cap_krw FROM ai_settings WHERE id = 'global'`);
  const capKrw = s?.cost_cap_krw == null ? null : Math.max(0, Math.trunc(Number(s.cost_cap_krw)));
  // 오늘(KST) 자정 이후. base.ts kstTodayStartUtc 와 같은 경계(SQL 안에서 만든다 · 드라이버 tz 무관 · AC-5).
  const [u] = await q(sql`SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM ai_usage
    WHERE tenant_id = ${tid}
      AND created_at >= ((date_trunc('day', (NOW() AT TIME ZONE 'Asia/Seoul')) AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC')`);
  const spentKrw = Math.round(Number(u?.usd ?? 0) * USD_KRW);
  const over = capKrw != null && spentKrw >= capKrw;
  return { capKrw, spentKrw, remainingKrw: capKrw == null ? null : Math.max(0, capKrw - spentKrw), over };
}
