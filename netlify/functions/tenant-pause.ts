/**
 * netlify/functions/tenant-pause.ts — 🔴 **잠깐 멈춤**(DESIGN §5B.11(1-c) 계약 · 사장님 승인 2026-09-22 · AC-220)
 *
 *   POST /api/tenant-pause   { until: "2w"|"1m"|"manual", reason? }  → { ok, pause }
 *   POST /api/tenant-resume  { }                                     → { ok, pause, backlog: { count } }
 *   POST /api/tenant-backlog { action: "publish"|"leave" }           → { ok, moved, backlog: { count } }
 *
 *   ══ 왜 문이 셋인가 — **깨우기와 고르기를 가른다** ══
 *     설계 (1-b): 깰 때 «밀린 글이 N건 있어요» + [지금부터 차례로 올릴게요] [이건 그냥 둘게요].
 *     🔴 `tenant-resume` 만으로는 그 단추 둘을 못 그린다. 게다가 **저절로 깬 집**(`pause_until` 이 지나 크론이 깨운 집)은
 *        `tenant-resume` 를 **아예 안 부른다** — 손님은 알림을 보고 화면에 들어온다. 그 길에도 고를 문이 있어야 한다.
 *     ⇒ `tenant-resume` = 깨우고 **세기만** · `tenant-backlog` = 고른 것을 **집행**.
 *
 *   🔴 **`until` 은 필수**다(없으면 400) — 설계 (3) «멈추는 순간 **반드시 고르게 한다**».
 *      «안 고르고 쉬기»를 만들면 그 집이 **영영 안 깨는 쪽**으로 조용히 굳는다(사장님 «까먹으면?» 의 반대편).
 *   🔴 실제 시각은 **서버가** 만든다(`untilFrom`) — 화면이 날짜를 만들지 않는다.
 *   🔴 `requireWritable` 를 **안 쓴다** — 쉼은 `status` 와 무관하고, 오히려 «쉬는 중에도 되돌릴 수 있어야» 한다.
 *      (쓰면 체험 끝난 집이 **자기가 켠 쉼을 못 끄는** 상태가 된다 — «멈춤»이 «잠김»이 되는 그 얼굴이다.)
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import {
  pauseTenant, resumeTenant, loadPause, countBacklog, releaseBacklog,
  isUntilKind, isPauseReason,
} from "../../lib/tenant-pause";

export const config = { path: ["/api/tenant-pause", "/api/tenant-resume", "/api/tenant-backlog"] };

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const path = new URL(req.url).pathname;
  const ip = clientIp(req);
  if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);
  try {
    if (path.endsWith("/tenant-pause")) {
      const b = await readJson<{ until?: unknown; reason?: unknown }>(req);
      /* 🔴 설계 (3) «반드시 고르게 한다» — 빈 값으로 못 들어온다. 사람말로 돌려준다(§3). */
      if (!isUntilKind(b.until)) return badRequest("언제까지 쉴지 골라 주세요.", "until");
      if (b.reason !== undefined && b.reason !== null && !isPauseReason(b.reason)) return badRequest("고르신 까닭을 알 수 없어요.", "reason");
      const pause = await pauseTenant(tid, b.until, typeof b.reason === "string" ? b.reason : null);
      /* 되돌릴 수 있는 일이라 `low` 다 — 다만 **남긴다**(손님이 «언제 껐더라»를 물을 수 있고, 운영도 봐야 한다). */
      await writeAudit({ tenantId: tid, action: "tenant_pause", actorType: "user", actorId: auth.user.uid, ip,
        target: `tenant:${tid}`, detail: { until: b.until, pauseUntil: pause.pauseUntil, reason: pause.reason }, riskLevel: "low" });
      return json({ ok: true, pause });
    }

    if (path.endsWith("/tenant-resume")) {
      const r = await resumeTenant(tid);
      await writeAudit({ tenantId: tid, action: "tenant_resume", actorType: "user", actorId: auth.user.uid, ip,
        target: `tenant:${tid}`, detail: { backlog: r.backlog }, riskLevel: "low" });
      /* 🔴 **여기서 올리지 않는다** — 올릴지 두고 볼지는 손님이 고른다(§9 · 설계 (1-b)).
         `backlog.count` 만 준다: 화면은 숫자를 **받아** 그리고 **세지 않는다**(AC-52). */
      return json({ ok: true, pause: r.pause, backlog: { count: r.backlog } });
    }

    /* ───────── 밀린 글을 어떻게 할까 — 🔴 고르는 것은 고객이다 ───────── */
    const b = await readJson<{ action?: unknown }>(req);
    const action = String(b.action ?? "");
    if (action !== "publish" && action !== "leave") return badRequest("«차례로 올리기»인지 «그냥 두기»인지 골라 주세요.", "action");
    if (action === "leave") {
      /* 🔴 **아무것도 안 한다**(버리지 않는다). 손님이 나중에 마음을 바꿀 수 있다 — `rejected` 로 내리면 그 길이 막힌다. */
      return json({ ok: true, moved: 0, backlog: { count: await countBacklog(tid) } });
    }
    const moved = await releaseBacklog(tid);
    await writeAudit({ tenantId: tid, action: "tenant_backlog_release", actorType: "user", actorId: auth.user.uid, ip,
      target: `tenant:${tid}`, detail: { moved }, riskLevel: "low" });
    /* 🔴 «차례로»는 **캐던스를 지켜** 앞으로의 시각에 다시 예약한 것이다(§7.4) — 지금 한꺼번에 나간 것이 아니다.
       화면이 «지금 올라가요»라고 쓰지 않게 `moved`(다시 예약한 수)라는 이름으로 준다. */
    return json({ ok: true, moved, backlog: { count: await countBacklog(tid) }, pause: await loadPause(tid) });
  } catch (err) { return jsonError("tenant_pause", err); }
};
