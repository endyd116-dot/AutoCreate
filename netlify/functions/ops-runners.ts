/**
 * 운영센터 — 러너 팜(계약 P1R4 §2.2 · DESIGN §8·§19). 관리형 러너(tenant_id NULL) + 고객 러너를 가로질러 본다.
 *   GET  /api/ops-runners            → { ok, requests:[…], runners:[{ …, version, upToDate:true|false|null }], release:{ measured, version, releasedAt, bytes, sha256, zipOk, bytesMatch, reason? }, farm:{ … } }
 *        🔴 `release` = **R2 의 실판**(고객이 받아 가는 것). 종전엔 화면이 기기 `version` 만 보여 줘서 «그게 최신인가»를 운영자가 알 길이 없었다.
 *   POST /api/ops-runner-assign      { action, id, tenantId? }   → 액션별
 *        · action="request-reject" { requestId, note? } — 관리형 러너 «신청» 거절(P1R6 §3.1)
 *        · action="rebind"  { id, tenantId|null } — 관리형 러너를 테넌트에 배정(또는 NULL=팜 복귀)
 *        · action="release" { id }               — 그 기기가 물고 있는 claimed 잡을 큐로 되돌린다(수동 페일오버)
 *        · action="remove"  { id }               — 기기 제거(물던 잡은 먼저 큐로)
 *   GET  /api/ops-canary?days=14     → { ok, days, channels:[{ channel, today:{ok,step,shotKey,ranAt}|null, history:[{ day, ok, step }] }] }  // §19 셀렉터 카나리 결과
 *   GET  /api/ops-recipe             → { ok, signing, fellBack24h, channels:[{ channel, current, candidate, stage, heldHours, why, harm, canary }] }
 *   POST /api/ops-recipe             { action:"put"|"promote"|"rollback", … }   // super_admin
 *        · put      { recipe:{version,channel,minRunner,selectors,…}, note? } — 서명해서 넣고 **0단계(카나리)부터** 시작
 *        · promote  { channel } — 🔴 **한 단계만** 넓힌다(시간 게이트·체류·카나리 전부 통과 시 · 안 되면 **왜인지** 돌려준다)
 *        · rollback { channel, reason } — 🔴 **언제나 된다**(좁히는 것은 시간 제한 없음)
 *   권한: 조회 operator+ · 변경 admin+.
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireAdmin } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
/* [AC-214 · B2 2026-09-22] 🔴 **운영자가 잡을 되돌리기 전에** 채널에 «이미 올라갔나»를 묻는다.
   ⚠️ 이 파일은 B 영역이다 — B(`autocreate-b-f8`) 에게 물어 «안 겹친다 · 그냥 넣어라»를 받고 넣었다(보고에 적었다). */
import { reconcileLostPublish } from "../../lib/publish/reconcile";
import { q } from "../../lib/accounts";
import { utcDate, jsonb } from "../../lib/db-util";
import { ONLINE_WINDOW_MIN } from "../../lib/runner-jobs";
// [P1R8 §3.3] 셀렉터 표 — 등록·배포 상태·되돌리기. 🔴 «만들어 놓고 부르는 자리가 없는 것»이 제일 안 보인다(AC-69).
import { RECIPE_CHANNELS, recipeSigningConfigured, type RecipeBody } from "../../lib/recipe";
import { getRollout, promoteCandidate, putRecipe, rollbackCandidate, candidateHarmSignal } from "../../lib/recipe-store";
import { sql } from "drizzle-orm";
// [수리라운드 2026-09-19 · B2] 🔴 «고객 PC 에 실제로 내려가는 판»을 운영 화면까지 데려온다 — 읽는 자리는 lib 한 곳(scripts/read-runner-live.mts 와 같은 값).
import { releaseHealth, runnerUpToDate } from "../../lib/runner-release";

export const config = { path: ["/api/ops-runners", "/api/ops-runner-assign", "/api/ops-canary", "/api/ops-recipe"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url); const path = routeOf(req);
  try {
    if (path.endsWith("/ops-runners") && req.method === "GET") {
      const g = await requireAdmin(req, ["operator", "admin", "super_admin"]); if (!g.ok) return g.res;
      const runners = await q(sql`
        SELECT d.id, d.name, d.kind, d.tenant_id, d.version, d.last_seen_at,
               (d.last_seen_at IS NOT NULL AND d.last_seen_at > NOW() - (${ONLINE_WINDOW_MIN} * INTERVAL '1 minute')) AS online,
               t.key AS tenant_key,
               (SELECT COUNT(*) FROM runner_jobs j WHERE j.claimed_by = d.id AND j.status = 'claimed') AS active,
               (SELECT COUNT(*) FROM runner_jobs j WHERE (j.tenant_id = d.tenant_id OR d.tenant_id IS NULL) AND j.status = 'queued' AND (j.due_at IS NULL OR j.due_at <= NOW())) AS queued
          FROM runner_devices d LEFT JOIN tenants t ON t.id = d.tenant_id
         ORDER BY d.tenant_id NULLS FIRST, d.id`);
      const [f] = await q(sql`
        SELECT (SELECT COUNT(*) FROM runner_devices WHERE tenant_id IS NULL) AS managed,
               (SELECT COUNT(*) FROM runner_devices WHERE last_seen_at > NOW() - (${ONLINE_WINDOW_MIN} * INTERVAL '1 minute')) AS online,
               (SELECT COUNT(*) FROM runner_jobs WHERE status = 'queued' AND (due_at IS NULL OR due_at <= NOW())) AS queued,
               (SELECT COUNT(*) FROM runner_jobs WHERE status = 'claimed') AS claimed,
               (SELECT EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))/60 FROM runner_jobs WHERE status = 'queued' AND (due_at IS NULL OR due_at <= NOW())) AS oldest_queued_min`);
      /* P1R6 §3.1 — 관리형 러너 **신청서** 목록. 기기 목록과 **따로** 싣는다:
         신청은 아직 기기가 아니다(실기기 프로비저닝은 범위 밖 · 운영자가 아래 rebind 로 손수 배정한다).
         한 배열에 섞으면 «신청만 했는데 기기가 있는 것처럼» 보인다. */
      /* 🔴 R2 의 라이브 판(`latest.json`). 던지지 않으므로 이것 때문에 이 화면이 500 나지 않는다.
         못 읽으면 `measured:false` 로 내려가고 화면이 «못 쟀어요»라고 말한다(AC-9). */
      const release = await releaseHealth();
      const requests = await q(sql`SELECT r.id, r.tenant_id, r.devices, r.plan_key, r.amount_krw, r.vat_krw, r.total_krw,
             r.note, r.created_at, t.key AS tenant_key, t.name AS tenant_name,
             (SELECT COUNT(*) FROM runner_devices d WHERE d.tenant_id = r.tenant_id AND d.kind = 'managed') AS assigned
        FROM managed_runner_requests r LEFT JOIN tenants t ON t.id = r.tenant_id
        WHERE r.status = 'requested' ORDER BY r.created_at`);
      return json({ ok: true, requests: requests.map((r) => ({
        id: n(r.id), tenantId: n(r.tenant_id), tenantKey: r.tenant_key ? String(r.tenant_key) : null,
        tenantName: r.tenant_name ? String(r.tenant_name) : null, devices: n(r.devices), planKey: r.plan_key ? String(r.plan_key) : null,
        amountKrw: n(r.amount_krw), vatKrw: n(r.vat_krw), totalKrw: n(r.total_krw),
        note: r.note ? String(r.note) : null, assigned: n(r.assigned),
        requestedAt: utcDate(r.created_at)?.toISOString() ?? null,
      })), runners: runners.map((r) => ({
        id: n(r.id), name: String(r.name ?? ""), kind: String(r.kind ?? "own"),
        tenantId: r.tenant_id ? n(r.tenant_id) : null, tenantKey: r.tenant_key ? String(r.tenant_key) : null,
        online: r.online === true, lastSeenAt: utcDate(r.last_seen_at)?.toISOString() ?? null,
        version: r.version ? String(r.version) : null, active: n(r.active), queued: n(r.queued),
        /* 🔴 판정은 **서버가** 한다(화면이 다시 짜면 갈린다 · AC-74). null = 못 쟀다. */
        upToDate: runnerUpToDate(r.version ? String(r.version) : null, release),
      })), release, farm: { managed: n(f?.managed), online: n(f?.online), queued: n(f?.queued), claimed: n(f?.claimed), oldestQueuedMin: f?.oldest_queued_min == null ? null : Math.round(Number(f.oldest_queued_min)) } });
    }

    if (path.endsWith("/ops-canary") && req.method === "GET") {
      const g = await requireAdmin(req, ["operator", "admin", "super_admin"]); if (!g.ok) return g.res;
      const days = Math.max(1, Math.min(60, n(url.searchParams.get("days")) || 14));
      const rows = await q(sql`SELECT day, channel, ok, step, detail, shot_key, ran_at FROM canary_runs
        WHERE channel <> '__eval__' AND day >= ((NOW() AT TIME ZONE 'Asia/Seoul')::date - ${days}::int)   -- ★C(P1R4) fix: date - $1 은 바인딩 타입이 없어 «operator does not exist: date >= integer» 500(AC-23) — ::int + 괄호
        ORDER BY day DESC, channel`);
      const today = String((await q(sql`SELECT (NOW() AT TIME ZONE 'Asia/Seoul')::date AS d`))[0]?.d ?? "");
      const byChannel = new Map<string, { channel: string; today: unknown; history: unknown[] }>();
      for (const r of rows) {
        const ch = String(r.channel);
        if (!byChannel.has(ch)) byChannel.set(ch, { channel: ch, today: null, history: [] });
        const entry = byChannel.get(ch)!;
        const day = String(r.day ?? "").slice(0, 10);
        const rec = { day, ok: r.ok === null ? null : r.ok === true, step: r.step ? String(r.step) : null, shotKey: r.shot_key ? String(r.shot_key) : null, ranAt: utcDate(r.ran_at)?.toISOString() ?? null };
        entry.history.push({ day: rec.day, ok: rec.ok, step: rec.step });
        if (day === today && !entry.today) entry.today = { ok: rec.ok, step: rec.step, shotKey: rec.shotKey, ranAt: rec.ranAt };
      }
      return json({ ok: true, days, channels: [...byChannel.values()] });
    }

    /* [P1R8 §3.3] 셀렉터 표 — 지금 어느 판이 어디까지 퍼졌나 · **왜 아직 대기 중인가**(설계 §9).
       🔴 «대기 중»의 이유를 안 보여 주면 멈춰 있는 것과 도는 것을 구분할 수 없다 — 이 프로젝트가 제일 싫어하는 모양. */
    if (path.endsWith("/ops-recipe") && req.method === "GET") {
      const g = await requireAdmin(req, ["operator", "admin", "super_admin"]); if (!g.ok) return g.res;
      const out: unknown[] = [];
      /* 🔴 **묶여 온 표로 되돌아간 러너 수** — 조용한 복귀를 드러낸다(설계 §6.2 «안 보이면 전부 새 표를 쓰는 줄 안다»). */
      const [fb] = await q(sql`SELECT COUNT(*) c FROM audit_logs
        WHERE action = 'recipe_fell_back' AND created_at > NOW() - INTERVAL '24 hours'`);
      for (const channel of RECIPE_CHANNELS) {
        const ro = await getRollout(channel);
        const harm = ro?.candidateVersion ? await candidateHarmSignal(channel) : { rollback: false, why: "", fails: 0, tenants: 0 };
        /* 🔴 «왜 아직 대기 중인가»를 **실제 판정 함수로** 묻는다 — 화면이 조건을 다시 짜면 서버와 갈린다(AC-74).
           `new Date(0)` 은 «절대 승격되지 않는 시각»이라 조회가 부작용을 내지 않는다(조회가 배포를 일으키면 안 된다). */
        const p = ro?.candidateVersion ? await promoteCandidate(channel, new Date(0)) : null;
        const [c] = await q(sql`SELECT COUNT(*) FILTER (WHERE ok = true) AS good, COUNT(*) FILTER (WHERE ok = false) AS bad,
            COUNT(*) FILTER (WHERE ok IS NULL) AS unknown
          FROM canary_runs WHERE channel = ${channel} AND recipe_version = ${ro?.candidateVersion ?? ""}`);
        const heldH = ro?.stageSince ? (Date.now() - Date.parse(ro.stageSince)) / 3_600_000 : 0;
        out.push({
          channel, current: ro?.currentVersion ?? null, candidate: ro?.candidateVersion ?? null,
          stage: ro?.stage ?? null, stageSince: ro?.stageSince ?? null, heldHours: Math.round(heldH * 10) / 10,
          why: p && !p.ok ? p.why : "", rolledBackAt: ro?.rolledBackAt ?? null, rollbackReason: ro?.rollbackReason ?? null,
          harm: { fails: harm.fails, tenants: harm.tenants, wouldRollback: harm.rollback, why: harm.why },
          canary: { good: n(c?.good), bad: n(c?.bad), unknown: n(c?.unknown) },
        });
      }
      return json({ ok: true, signing: recipeSigningConfigured(), fellBack24h: n(fb?.c), channels: out });
    }

    if (path.endsWith("/ops-recipe")) {
      const g = await requireAdmin(req, ["super_admin"]); if (!g.ok) return g.res;
      if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);
      const b = await readJson<Record<string, unknown>>(req);
      const action = String(b.action ?? "");

      if (action === "put") {
        const r = await putRecipe((b.recipe ?? {}) as RecipeBody, String(b.note ?? ""));
        if (!r.ok) return badRequest(r.error, "recipe");
        await writeAudit({ tenantId: null, action: "ops_recipe_put", actorType: "user",
          target: `recipe:${r.version}`, detail: { note: String(b.note ?? "").slice(0, 200) }, riskLevel: "medium" });
        return json({ ok: true, version: r.version, stage: "canary" });
      }
      if (action === "promote") {
        const channel = String(b.channel ?? "");
        if (!RECIPE_CHANNELS.includes(channel)) return badRequest("표를 내려 주는 채널이 아니에요.", "channel");
        const r = await promoteCandidate(channel);
        /* 🔴 못 넓혔으면 **왜인지 그대로 돌려준다** — «안 됩니다»만 주면 운영자가 추측하게 된다. */
        if (!r.ok) return json({ ok: false, step: "hold", error: r.why }, 409);
        return json({ ok: true, stage: r.stage ?? "all" });
      }
      if (action === "rollback") {
        const channel = String(b.channel ?? "");
        const reason = String(b.reason ?? "").slice(0, 300) || "운영자가 되돌렸어요";
        if (!RECIPE_CHANNELS.includes(channel)) return badRequest("표를 내려 주는 채널이 아니에요.", "channel");
        /* 🔴 되돌리기는 **시간 게이트가 없다**(설계 §8) — 좁히는 것은 언제나. */
        const done = await rollbackCandidate(channel, reason);
        if (!done) return json({ ok: false, step: "no_candidate", error: "되돌릴 후보가 없어요." }, 409);
        return json({ ok: true });
      }
      return badRequest("action 은 put·promote·rollback 중 하나예요.", "action");
    }

    if (path.endsWith("/ops-runner-assign")) {
      // 러너 팜 변경 = super_admin 전용(플랫폼 설정 · 메인 결정 4).
      const g = await requireAdmin(req, ["super_admin"]); if (!g.ok) return g.res;
      if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);
      const b = await readJson<Record<string, unknown>>(req);
      const id = n(b.id); const action = String(b.action ?? "");

      /* 🔴 «신청 거절»은 **기기가 없는** 동작이다(신청서만 닫는다). 아래 기기 조회보다 **먼저** 가른다 —
         안 그러면 기기 id 를 요구하는 검사에 걸려 영영 못 부른다(가드가 엉뚱한 것을 막는 자리). */
      if (action === "request-reject") {
        const reqId = n(b.requestId);
        if (!reqId) return badRequest("requestId");
        const [r] = await q(sql`UPDATE managed_runner_requests SET status = 'rejected', decided_by = ${g.ops.oid}, decided_at = NOW(),
            note = COALESCE(${String(b.note ?? "").slice(0, 500) || null}, note), updated_at = NOW()
          WHERE id = ${reqId} AND status = 'requested' RETURNING id, tenant_id`);
        if (!r) return json({ ok: false, error: "그 신청을 찾을 수 없어요(이미 처리됐을 수 있어요).", step: "not_found" }, 404);
        const rtid = n(r.tenant_id);
        await writeAudit({ tenantId: rtid, action: "managed_runner_rejected", actorType: "operator", actorId: g.ops.oid, target: `tenant:${rtid}`, detail: { requestId: reqId }, riskLevel: "medium" });
        await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
          VALUES (${rtid}, ${"managed_runner"}, ${"관리형 러너 신청을 처리했어요"},
                  ${"지금은 배정이 어려워요. 자세한 내용은 문의로 알려 드릴게요."}, ${"/app/runner.html"})`);
        return json({ ok: true, requestId: reqId, status: "rejected" });
      }

      if (!id) return badRequest("id");
      const [dev] = await q(sql`SELECT id, name, tenant_id FROM runner_devices WHERE id = ${id} LIMIT 1`);
      if (!dev) return json({ ok: false, error: "러너를 찾을 수 없어요.", step: "not_found" }, 404);

      if (action === "rebind") {
        const tenantId = b.tenantId == null || b.tenantId === "" ? null : n(b.tenantId);
        if (tenantId != null) { const [t] = await q(sql`SELECT id FROM tenants WHERE id = ${tenantId} LIMIT 1`); if (!t) return json({ ok: false, error: "그 테넌트가 없어요.", step: "tenant" }, 404); }
        // 관리형으로 배정하는 것이므로 기기 종류도 같이 바꾼다(자기 PC 로 등록된 기기를 팜에 넣는 경우).
        const [row] = await q(sql`UPDATE runner_devices SET tenant_id = ${tenantId}${tenantId != null ? sql`, kind = 'managed'` : sql``} WHERE id = ${id} RETURNING id, tenant_id`);
        /* 🔴 배정이 곧 신청의 «끝»이다 — 열린 신청을 여기서 닫는다.
           안 닫으면 배정이 끝났는데도 운영 목록에 계속 남아 «아직 처리 안 된 것»처럼 보인다(조용한 잔여). */
        let closed = 0;
        if (tenantId != null) {
          const done = await q(sql`UPDATE managed_runner_requests SET status = 'active', decided_by = ${g.ops.oid}, decided_at = NOW(), updated_at = NOW()
            WHERE tenant_id = ${tenantId} AND status = 'requested' RETURNING id`);
          closed = done.length;
        }
        await writeAudit({ tenantId, action: "ops_runner_rebind", actorType: "operator", actorId: g.ops.oid, target: `runner_device:${id}`, detail: { from: dev.tenant_id ? n(dev.tenant_id) : null, to: tenantId, requestClosed: closed }, riskLevel: "high" });
        return json({ ok: true, id, tenantId: row?.tenant_id ? n(row.tenant_id) : null, requestClosed: closed });
      }


      /* ═══ [AC-214] 🔴 **되돌리기 전에 채널에 묻는다** — 운영자 문이 크론보다 위험하다 ═══
       *
       *   사람이 이 단추를 누르는 때는 「잡이 멈춰 보일 때」다. 그런데 **«올렸는데 보고를 못 했다»가
       *   정확히 그 «멈춰 보이는» 모양**이다. `reapStaleJobs` 는 15분을 기다리지만 **운영자는 즉시 누른다.**
       *   되돌리면 다른 러너가 집어 **같은 글을 또 올린다**(AC-200 그 사고) — 그리고 그 두 번째 시도는
       *   잡이 payload 째 큐에 있어 **`publish()` 를 다시 안 타므로** 멱등 검사도 안 걸린다.
       *
       *   🔴 **막는 게 아니다**(CLAUDE §9). 되돌리기를 거부하는 것이 아니라, **이미 올라간 잡만** 골라
       *      «되돌릴 것이 아니라 끝난 것»으로 닫고 **운영자에게 그 사실과 주소를 돌려준다.**
       *   🔴 **운영자 문이니 운영자에게 보인다** — 응답과 감사 `detail` 에 `recovered` 를 싣는다.
       *      (새 감사 액션을 파지 않는다 — 파면 운영 화면이 또 갈린다 · B 제안 2026-09-22.)
       */
      const reconcileClaimed = async () => {
        const jobs = await q(sql`SELECT id, tenant_id, kind, piece_id, claimed_at FROM runner_jobs
          WHERE claimed_by = ${id} AND status = 'claimed'`);
        const recovered: { jobId: number; pieceId: number; externalUrl: string | null }[] = [];
        for (const j of jobs) {
          if (!String(j.kind ?? "").startsWith("publish.") || !n(j.piece_id)) continue;
          /* `claimed_at` 이 «언제부터 이 러너가 들고 있었나»다 — 그 뒤에 생긴 글만 «우리 것»으로 본다.
             🔴 `utcDate` 를 쓴다(손으로 «Z» 를 붙이지 않는다) — `+00` 두 자리 오프셋에서 Invalid Date 가 나고,
                그게 조용히 새어 나가면 `since` 가 없는 것과 같아져 **`found_after` 가 영영 안 난다**(PITFALLS #4). */
          const since = utcDate(j.claimed_at);
          const rec = await reconcileLostPublish({
            tenantId: n(j.tenant_id), pieceId: n(j.piece_id), jobId: n(j.id),
            since: since ? since.toISOString() : null,
          }).catch((e) => { console.error("[ops-runners] already-check 실패(비치명)", (e as Error)?.message ?? e); return null; });
          if (!rec?.recovered) continue;
          /* 🔴 되돌리지 않는다 — 되돌리면 그게 중복 게시다. «끝난 것»으로 닫는다. */
          await q(sql`UPDATE runner_jobs SET status = 'done', claimed_by = NULL, claimed_at = NULL,
              result = ${jsonb({ ok: true, via: "channel_reconcile", externalUrl: rec.externalUrl ?? null, note: "운영자가 되돌리려 했지만 채널에는 올라가 있었다(AC-214)" })},
              updated_at = NOW() WHERE id = ${n(j.id)} AND status = 'claimed'`);
          recovered.push({ jobId: n(j.id), pieceId: n(j.piece_id), externalUrl: rec.externalUrl ?? null });
        }
        return recovered;
      };

      if (action === "release") {
        const recovered = await reconcileClaimed();
        const released = await q(sql`UPDATE runner_jobs SET status = 'queued', claimed_by = NULL, claimed_at = NULL, updated_at = NOW()
          WHERE claimed_by = ${id} AND status = 'claimed' RETURNING id`);
        await writeAudit({ tenantId: dev.tenant_id ? n(dev.tenant_id) : null, action: "ops_runner_release", actorType: "operator", actorId: g.ops.oid, target: `runner_device:${id}`, detail: { released: released.length, recovered }, riskLevel: "high" });
        return json({ ok: true, id, released: released.length, recovered });
      }
      if (action === "remove") {
        /* 🔴 **`DELETE` 보다 먼저** 묻는다(B 지적 2026-09-22): `remove` 는 되돌린 **직후 기기를 지운다** —
           채널엔 올라갔는데 되돌아간 잡이 있으면 **누가 물고 있었는지조차 사라진다.** `release` 보다 센 문이다. */
        const recovered = await reconcileClaimed();
        /* 🔴 `RETURNING` 을 붙였다(B 지적) — 종전엔 **되돌린 수조차 감사에 안 남았다.** */
        const requeued = await q(sql`UPDATE runner_jobs SET status = 'queued', claimed_by = NULL, claimed_at = NULL, updated_at = NOW()
          WHERE claimed_by = ${id} AND status = 'claimed' RETURNING id`);
        await q(sql`DELETE FROM runner_devices WHERE id = ${id}`);
        await writeAudit({ tenantId: dev.tenant_id ? n(dev.tenant_id) : null, action: "ops_runner_remove", actorType: "operator", actorId: g.ops.oid, target: `runner_device:${id}`, detail: { name: String(dev.name ?? ""), requeued: requeued.map((r) => n(r.id)), recovered }, riskLevel: "high" });
        return json({ ok: true, id, removed: true, requeued: requeued.length, recovered });
      }
      return badRequest("action 은 rebind|release|remove|request-reject", "action");
    }

    return json({ ok: false, error: "not_found", step: "route" }, 404);
  } catch (err) {
    return jsonError("ops_runners", err);
  }
};
