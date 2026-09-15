/**
 * lib/cron/managed-runner-watch.ts — 관리형 러너(우리 기기)가 꺼지면 **우리가** 안다(계약 P1R7 §2.4).
 *
 *   🔴 왜 따로 만드나: 내 PC 러너가 꺼지면 **고객이** 안다(앱 홈 «해야 할 일» · 자기 PC 니까 자기가 켠다).
 *      그런데 관리형은 **우리 기기**다 — 고객은 켤 수도 없고 켜야 하는지도 모른다.
 *      지금 구조대로면 관리형 팜이 죽어도 «고객 화면에만 조용히» 뜨고 **우리는 영영 모른다.**
 *      그래서 이 스텝은 고객이 아니라 **운영에게** 알린다.
 *
 *   🔴 **global 스텝**이다(테넌트 루프 밖). 관리형 기기는 `tenant_id IS NULL`(우리 풀)이라
 *      테넌트를 도는 루프에서는 **아예 안 보인다** — 테넌트 스텝으로 만들면 영원히 0건이다.
 *
 *   판정: 등록된 적은 있는데(`last_seen_at IS NOT NULL`) 30분 넘게 조용하면 «꺼짐».
 *   🔴 «한 번도 안 켠 기기»(last_seen_at IS NULL)는 **꺼진 게 아니라 아직 안 켠 것**이다 — 섞으면
 *      기기를 등록하자마자 장애 알림이 뜬다(AC-9 «없음 ≠ 0»).
 *   시끄럽지 않게: 같은 기기는 6시간에 한 번만 남긴다(죽어 있는 동안 매시간 쌓지 않는다).
 *   🔎 출처: AC 신규(계약 P1R7-B2 2.4 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { writeAudit } from "../audit";
import type { GlobalStep, StepOutcome } from "./base";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** 이 시간 넘게 조용하면 «꺼짐»으로 본다(고객 러너와 같은 30분 기준 · DESIGN §8.3). */
export const MANAGED_OFFLINE_MIN = 30;
/** 같은 기기에 대해 이 시간 안에 이미 남겼으면 또 남기지 않는다. */
const QUIET_HOURS = 6;

export const managedRunnerWatchStep: GlobalStep = {
  key: "managed.watch",
  every: "5m",
  scope: "global",
  async run(): Promise<StepOutcome> {
    /* 꺼진 관리형 기기 — 마지막 감사 이후 조용한 시간이 지난 것만.
       `audit_logs` 를 조건에 직접 넣어 «최근에 이미 알렸나»를 한 번의 질의로 판정한다(상태 칸을 새로 만들지 않는다). */
    const down = await q(sql`
      SELECT d.id, d.name, d.last_seen_at,
             FLOOR(EXTRACT(EPOCH FROM (NOW() - d.last_seen_at)) / 60)::int AS quiet_min
        FROM runner_devices d
       WHERE d.kind = 'managed'
         AND d.last_seen_at IS NOT NULL
         AND d.last_seen_at < NOW() - (${MANAGED_OFFLINE_MIN} * INTERVAL '1 minute')
         AND NOT EXISTS (
           SELECT 1 FROM audit_logs a
            WHERE a.action = 'managed_runner_down'
              AND a.target = 'runner_device:' || d.id
              AND a.created_at > NOW() - (${QUIET_HOURS} * INTERVAL '1 hour')
         )
       ORDER BY d.last_seen_at
       LIMIT 20`);

    for (const r of down) {
      await writeAudit({
        tenantId: null, action: "managed_runner_down", actorType: "system", riskLevel: "high",
        target: `runner_device:${n(r.id)}`,
        detail: {
          name: String(r.name ?? ""), quietMin: n(r.quiet_min),
          note: "우리 관리형 러너가 조용하다 — 고객은 이걸 켤 수 없다. 우리가 가서 켜야 한다.",
        },
      });
    }

    /* «한 번도 안 켠» 관리형 기기 수도 같이 센다 — 장애가 아니라 **아직 설치 안 한 것**이라 알림은 없다.
       숫자만 남겨 두면 «등록만 해 놓고 몇 주째 안 켠 기기»를 운영이 볼 수 있다. */
    const [never] = await q(sql`SELECT COUNT(*)::int AS c FROM runner_devices WHERE kind = 'managed' AND last_seen_at IS NULL`);

    const out: StepOutcome = { changed: down.length, skipped: 0 };
    if (down.length || n(never?.c)) out.detail = { down: down.length, neverStarted: n(never?.c) };
    return out;
  },
};
