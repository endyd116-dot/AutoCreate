/**
 * lib/video/render-notify.ts — «내 PC 프로그램을 켜 주세요» 알림 한 곳(계약 P1R5 §7-2).
 *   렌더는 고객 PC 가 한다. 꺼져 있으면 **말해 줘야** 한다 — 조용히 멈춰 있으면 고객은 이유를 모른다.
 *   🔴 같은 말을 하루에 여러 번 하지 않는다(알림이 곧 «끄는 이유»가 된다 · cron/base notifyOnce 와 같은 관례).
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

/** 20시간 안에 같은 종류 알림이 있으면 새로 쓰지 않는다. */
const WITHIN_HOURS = 20;

export async function notifyRunnerNeeded(tid: number, why: string): Promise<boolean> {
  try {
    const [dup] = await q(sql`SELECT 1 FROM notifications
      WHERE tenant_id = ${tid} AND kind = 'render_runner_off'
        AND created_at > NOW() - (${WITHIN_HOURS} || ' hours')::interval LIMIT 1`);
    if (dup) return false;
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
      VALUES (${tid}, ${"render_runner_off"}, ${"영상을 만들려면 내 PC 프로그램이 필요해요"},
              ${`${why}. 프로그램을 켜 두시면 만들어 둔 대본으로 영상을 이어서 만들어요.`}, ${"/app/runner.html"})`);
    return true;
  } catch (e) {
    console.error("[render-notify] 실패", String((e as Error)?.message ?? e).slice(0, 120));
    return false;   // 알림 실패가 렌더 흐름을 멈추지 않는다
  }
}
