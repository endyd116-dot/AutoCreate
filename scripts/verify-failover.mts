/**
 * scripts/verify-failover.mts — 🔴 정지 감지 → 승계 **실증**(계약 P1R3 §2.3 · DESIGN §7.2·§7.3).
 *   실행: `npx tsx --env-file=.env scripts/verify-failover.mts [--keep]`
 *
 *   R2 에서 전이표(`lib/account-health.ts`)·`reassignSlots` 는 완성됐다. 여기서는 **실제로 돌려 보인다** — 증거는 row id.
 *   시나리오 ①~⑤(계약 그대로):
 *     ① 테스트 계정 @a 를 `suspended` 로 강제 전이 — 두 길 다 태운다: (가) 러너 report(`errorKind:"suspended"`) → 서버 분류 → 전이 /
 *        (나) `classifyAndApply` 직접. 실제 제품에서 오는 길은 (가)다.
 *     ② 미발행 슬롯(scheduled)이 @b 로 넘어간다 — **행 유지 · 계정만 교체**(slot id 그대로 · piece.account_id 도 @b).
 *     ③ 이미 `publishing` 인 자리만 **종결(reassigned) + 새 행 생성**(새 slot 이 @b · scheduled · piece 는 새 slot 으로).
 *     ④ 달력에 «넘김»(옛 행 reassigned)·«예약»(새 행 scheduled) **둘 다** 보인다 — slots-list 가 같은 날짜에 두 행을 돌려준다.
 *     ⑤ 감사 1건(`account_transition` · reassigned 포함) + 알림 1건(`account_suspended`).
 *   덧: published 슬롯은 건드리지 않는다 · 받을 계정이 없으면 unmoved 로 정직하게 남는다(0 으로 «옮겼다» 하지 않는다).
 *
 *   스냅샷: 전/후 슬롯 표를 `runner/_shots/failover-<stamp>.txt` 에 남긴다(row id 동반 — CLAUDE §6 «증거 없는 실증 금지»).
 */
import "./_lib/load-env.mjs";   // [R17-B2] 🔴 맨 위 — 없으면 db/index 가 빈 URL 로 풀을 만들어 `read ECONNRESET` 이라는 **가짜 빨강**을 낸다
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { jsonb } from "../lib/db-util";
import { classifyAndApply } from "../lib/account-health";
import { registerDevice, claimJobs, reportJob, enqueueJob, type DeviceRow } from "../lib/runner-jobs";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0, fail = 0;
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };
const ok = (name: string, cond: boolean, note = "") => {
  if (cond) { pass++; say(`  ✓ ${name}${note ? ` — ${note}` : ""}`); }
  else { fail++; say(`  ✗ ${name}${note ? ` — ${note}` : ""}`); }
};

async function slotTable(tid: number, title: string) {
  const rows = await q(sql`SELECT s.id, s.slot_date, s.status, s.account_id, a.handle, s.piece_id, s.note FROM slots s LEFT JOIN accounts a ON a.id = s.account_id WHERE s.tenant_id = ${tid} ORDER BY s.id`);
  say(`\n  [${title}]`);
  say("   slot  날짜        상태          계정            piece  비고");
  for (const r of rows) say(`   #${String(r.id).padEnd(4)} ${String(r.slot_date).slice(0, 10)}  ${String(r.status).padEnd(12)}  @${String(r.handle ?? "-").padEnd(14)} ${String(r.piece_id ?? "-").padEnd(6)} ${String(r.note ?? "")}`);
  return rows;
}

async function main() {
  const keep = process.argv.includes("--keep");
  const stamp = Date.now();
  const [t] = await q(sql`INSERT INTO tenants (key, name, plan_key, status) VALUES (${`failover${stamp}`.slice(0, 40)}, ${"승계실증"}, 'starter', 'active') RETURNING id`);
  const tid = n(t?.id);
  say(`\n── 정지 감지 → 승계 실증 (테넌트 ${tid}) ──`);

  try {
    /* ── 준비: 같은 채널·같은 그룹 계정 @a(정지될 쪽) · @b(받을 쪽) · @c(다른 채널 · 받으면 안 됨) ── */
    const [g] = await q(sql`INSERT INTO account_groups (tenant_id, name) VALUES (${tid}, ${"세탁 니치"}) RETURNING id`).catch(() => [{ id: null }]);
    const groupId = g?.id ? n(g.id) : null;
    const mkAcc = async (channel: string, handle: string) => n((await q(sql`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key, daily_cap, min_gap_min, group_id, health_score)
      VALUES (${tid}, ${channel}, ${handle}, 'session', 'active', ${`t${tid}-${handle}`}, 3, 60, ${groupId}, 100) RETURNING id`))[0]?.id);
    const A = await mkAcc("naver_blog", "fo_a_suspended");
    const B = await mkAcc("naver_blog", "fo_b_receiver");
    const C = await mkAcc("tistory", "fo_c_other_channel");

    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const mkPiece = async (accountId: number, status: string) => n((await q(sql`INSERT INTO pieces (tenant_id, account_id, channel, kind, format, title, body, blocks, meta, status)
      VALUES (${tid}, ${accountId}, 'naver_blog', 'post', 'info', ${`승계 실증 ${status}`}, ${"<p>본문</p>"}, ${jsonb([])}, ${jsonb({ tags: [] })}, ${status}) RETURNING id`))[0]?.id);
    const mkSlot = async (accountId: number, status: string, pieceId: number | null, hoursAhead: number) => n((await q(sql`INSERT INTO slots (tenant_id, slot_date, channel, kind, account_id, piece_id, publish_at, status, origin)
      VALUES (${tid}, ${today}::date, 'naver_blog', 'post', ${accountId}, ${pieceId}, NOW() + (${hoursAhead} * INTERVAL '1 hour'), ${status}, 'auto') RETURNING id`))[0]?.id);

    const pSched = await mkPiece(A, "scheduled");
    const pPub = await mkPiece(A, "publishing");
    const pDone = await mkPiece(A, "published");
    const sSched = await mkSlot(A, "scheduled", pSched, 3);      // ② 미발행 — 행 유지·계정 교체
    const sPub = await mkSlot(A, "publishing", pPub, 1);         // ③ 발행 중 — 종결 + 새 행
    const sDone = await mkSlot(A, "published", pDone, -5);       // 건드리면 안 됨
    const sPlanned = await mkSlot(A, "planned", null, 30);       // 소재 미배정 — 이것도 넘어간다(미발행)
    await slotTable(tid, "전(before)");

    /* ── ① (가) 러너 report 경로 — 실제 제품이 오는 길 ── */
    const reg = await registerDevice(tid, "승계실증 PC", "own");
    const device: DeviceRow = { id: reg.device.id, tenantId: tid, name: "승계실증 PC", kind: "own" };
    const job = await enqueueJob({ tenantId: tid, kind: "publish.naver_blog", accountId: A, pieceId: pPub, payload: { title: "승계 실증 publishing", bodyHtml: "<p>본문</p>", blocks: [], images: [], tags: [], disclosure: null, slotId: sPub } });
    const claimed = await claimJobs(device, ["publish.naver_blog"], 1);
    ok("① 러너가 발행 잡 선점", claimed[0]?.id === job.id, `job=${job.id}`);
    const rep = await reportJob(device, job.id, { ok: false, errorKind: "suspended", detail: "이 블로그는 네이버에서 이용이 제한된 상태예요.", shotKey: "failover-test" });
    ok("① report(errorKind:suspended) → 잡 failed", rep.status === "failed" && rep.block?.kind === "suspended", `status=${rep.status}`);

    const [accA] = await q(sql`SELECT status, last_error_kind FROM accounts WHERE id = ${A}`);
    ok("① @a → suspended(전이표 · account-health)", String(accA?.status) === "suspended" && String(accA?.last_error_kind) === "suspended", `status=${accA?.status}`);

    const after = await slotTable(tid, "후(after) — 러너 report 1건으로 전이+승계까지");

    /* ── ② 미발행 슬롯: 행 유지 · 계정만 @b ── */
    const r2 = after.find((r) => n(r.id) === sSched);
    ok("② scheduled 슬롯 행 유지(같은 id) + 계정 @b 로 교체", !!r2 && n(r2.account_id) === B && String(r2.status) === "scheduled", `slot #${sSched} → @${r2?.handle}`);
    const [pc2] = await q(sql`SELECT account_id, status FROM pieces WHERE id = ${pSched}`);
    ok("② 그 piece 도 @b 로(코인 무접촉)", n(pc2?.account_id) === B && String(pc2?.status) === "scheduled");
    const rPlanned = after.find((r) => n(r.id) === sPlanned);
    ok("② planned(소재 미배정) 슬롯도 @b 로", !!rPlanned && n(rPlanned.account_id) === B);

    /* ── ③ publishing: 종결(reassigned) + 새 행 ── */
    const r3old = after.find((r) => n(r.id) === sPub);
    ok("③ publishing 옛 행 → reassigned · piece 분리", !!r3old && String(r3old.status) === "reassigned" && r3old.piece_id == null, `slot #${sPub}`);
    const r3new = after.find((r) => n(r.id) !== sPub && n(r.piece_id) === pPub);
    ok("③ 새 행 생성 · @b · scheduled · 같은 piece", !!r3new && n(r3new.account_id) === B && String(r3new.status) === "scheduled", r3new ? `new slot #${r3new.id}` : "새 행 없음");
    const [pc3] = await q(sql`SELECT account_id, status, slot_id FROM pieces WHERE id = ${pPub}`);
    ok("③ piece → @b · scheduled · slot_id = 새 행", n(pc3?.account_id) === B && String(pc3?.status) === "scheduled" && !!r3new && n(pc3?.slot_id) === n(r3new.id));

    /* ── ④ 달력: 같은 날짜에 «넘김»(reassigned) + «예약»(scheduled) 둘 다 ── */
    const dayRows = await q(sql`SELECT id, status, account_id FROM slots WHERE tenant_id = ${tid} AND slot_date = ${today}::date ORDER BY id`);
    const hasHandoff = dayRows.some((r) => String(r.status) === "reassigned" && n(r.account_id) === A);
    const hasNew = dayRows.some((r) => String(r.status) === "scheduled" && n(r.account_id) === B && n(r.id) === n(r3new?.id));
    ok("④ 달력 같은 날짜에 «넘김»·«예약» 둘 다", hasHandoff && hasNew, `${dayRows.length}행`);

    /* ── 건드리면 안 되는 것 ── */
    const rDone = after.find((r) => n(r.id) === sDone);
    ok("published 슬롯은 그대로(@a · published)", !!rDone && n(rDone.account_id) === A && String(rDone.status) === "published");
    const cSlots = await q(sql`SELECT count(*) c FROM slots WHERE tenant_id = ${tid} AND account_id = ${C}`);
    ok("다른 채널 계정 @c 는 받지 않는다", n(cSlots[0]?.c) === 0);

    /* ── ⑤ 감사 1 + 알림 1 ── */
    const audits = await q(sql`SELECT action, detail FROM audit_logs WHERE tenant_id = ${tid} AND action = 'account_transition' ORDER BY id`);
    const tr = audits.find((a) => (a.detail as Record<string, unknown>)?.to === "suspended");
    ok("⑤ 감사 account_transition 1건(reassigned 포함)", !!tr && !!(tr.detail as Record<string, unknown>)?.reassigned, tr ? `moved=${((tr.detail as Record<string, unknown>).reassigned as Record<string, unknown>)?.moved}` : "");
    const notes = await q(sql`SELECT kind, title, body FROM notifications WHERE tenant_id = ${tid} AND kind = 'account_suspended'`);
    ok("⑤ 알림 account_suspended 1건", notes.length === 1, notes[0] ? `«${String(notes[0].title)} · ${String(notes[0].body).slice(0, 40)}…»` : "");

    /* ── 멱등: 같은 report 가 또 와도 두 번 옮기지 않는다 ── */
    const again = await classifyAndApply(A, "suspended", { tenantId: tid });
    const notes2 = await q(sql`SELECT count(*) c FROM notifications WHERE tenant_id = ${tid} AND kind = 'account_suspended'`);
    ok("멱등 — 두 번째 suspended 는 무동작(알림 그대로 1건)", again.ok && n(notes2[0]?.c) === 1, again.note ?? "");

    /* ── (나) 받을 계정이 없을 때 — 0 으로 «옮겼다» 하지 않는다 ── */
    await q(sql`UPDATE accounts SET status = 'active', last_error_kind = NULL WHERE id = ${B}`);
    const pB = await mkPiece(B, "scheduled");
    const sB = await mkSlot(B, "scheduled", pB, 6);
    await q(sql`UPDATE accounts SET status = 'suspended' WHERE id = ${A}`);   // @a 는 이미 정지 · 받을 곳 없음
    const rB = await classifyAndApply(B, "suspended", { tenantId: tid });
    const [sBrow] = await q(sql`SELECT account_id, status FROM slots WHERE id = ${sB}`);
    // @b 는 이 시점에 넘겨받은 슬롯(#131·#134·새 행)까지 미발행 4건을 들고 있다 — 전부 unmoved 여야 한다(0 으로 «옮겼다» 금지).
    ok("(나) 받을 계정이 없으면 unmoved 로 정직 · 슬롯은 @b 에 그대로", rB.reassigned?.moved === 0 && (rB.reassigned?.unmoved ?? 0) >= 1 && n(sBrow?.account_id) === B, `moved=${rB.reassigned?.moved} unmoved=${rB.reassigned?.unmoved}`);
    const noteB = await q(sql`SELECT body FROM notifications WHERE tenant_id = ${tid} AND kind = 'account_suspended' ORDER BY id DESC LIMIT 1`);
    ok("(나) 알림이 «옮길 계정이 없다»고 말한다", /옮길 수 있는|대기 중/.test(String(noteB[0]?.body ?? "")), String(noteB[0]?.body ?? "").slice(0, 50));

    /* ── (다) [C · 2026-09-14] 한 주치 9자리 · 받는 계정 daily_cap 2 — 여유는 **날짜별**이다.
         종전 코드는 «오늘 남은 칸(daily_cap−posts_today)»을 앞으로의 슬롯 전체 예산으로 써서 2건만 옮기고 7건을 정지 계정에 남겼다(C 실측 · P1R2). */
    try {
    const D = await mkAcc("naver_blog", "fo_d_weekly_suspended");
    const E = await mkAcc("naver_blog", "fo_e_cap2_receiver");
    await q(sql`UPDATE accounts SET daily_cap = 2, posts_today = 0 WHERE id = ${E}`);
    const weekSlots: number[] = [];
    for (let d = 1; d <= 7; d++) {
      const copies = d === 3 || d === 5 ? 2 : 1;   // 9자리: 하루 2건인 날 둘(3일·5일) + 나머지 1건
      for (let k = 0; k < copies; k++) weekSlots.push(n((await q(sql`INSERT INTO slots (tenant_id, slot_date, channel, kind, account_id, publish_at, status, origin)
        VALUES (${tid}, ${today}::date + ${d}::int, 'naver_blog', 'post', ${D}, NOW() + (${d * 24 + k} * INTERVAL '1 hour'), 'planned', 'auto') RETURNING id`))[0]?.id));
    }
    const rD = await classifyAndApply(D, "suspended", { tenantId: tid });
    const movedRows = await q(sql`SELECT id, account_id, slot_date::text AS d FROM slots WHERE tenant_id = ${tid} AND id IN (${sql.join(weekSlots.map((i) => sql`${i}`), sql`, `)})`);
    const perDay = new Map<string, number>(); for (const r of movedRows) if (n(r.account_id) === E) perDay.set(String(r.d), (perDay.get(String(r.d)) ?? 0) + 1);
    ok("(다) 한 주치 9자리 · daily_cap 2 → 전부 @e 로(날짜별 여유 · 하루 ≤2)", rD.reassigned?.moved === 9 && (rD.reassigned?.unmoved ?? 0) === 0 && movedRows.every((r) => n(r.account_id) === E) && [...perDay.values()].every((c) => c <= 2), `moved=${rD.reassigned?.moved} unmoved=${rD.reassigned?.unmoved} 하루 최대 ${Math.max(0, ...perDay.values())}`);
    // 하루 3건이면 그 날 1건은 못 옮긴다 — 0 으로 «옮겼다» 하지 않고 unmoved 로 정직 + 알림에 건수
    await q(sql`UPDATE accounts SET status = 'active', last_error_kind = NULL WHERE id = ${D}`);
    const F = await mkAcc("naver_blog", "fo_f_three_a_day");
    const G = await mkAcc("naver_blog", "fo_g_cap2_receiver2");
    await q(sql`UPDATE accounts SET daily_cap = 2, posts_today = 0 WHERE id = ${G}`);
    await q(sql`UPDATE accounts SET status = 'suspended' WHERE id IN (${D}, ${E})`);   // 받을 곳은 @g 하나뿐
    for (let k = 0; k < 3; k++) await q(sql`INSERT INTO slots (tenant_id, slot_date, channel, kind, account_id, publish_at, status, origin)
      VALUES (${tid}, ${today}::date + 2::int, 'naver_blog', 'post', ${F}, NOW() + (${48 + k} * INTERVAL '1 hour'), 'planned', 'auto')`);
    const rF = await classifyAndApply(F, "suspended", { tenantId: tid });
    const noteF = await q(sql`SELECT body FROM notifications WHERE tenant_id = ${tid} AND kind = 'account_suspended' ORDER BY id DESC LIMIT 1`);
    ok("(다) 하루 3건 · 받는 쪽 cap 2 → moved 2 · unmoved 1 · 알림에 «1건 대기»", rF.reassigned?.moved === 2 && rF.reassigned?.unmoved === 1 && /1건/.test(String(noteF[0]?.body ?? "")), `moved=${rF.reassigned?.moved} unmoved=${rF.reassigned?.unmoved} · ${String(noteF[0]?.body ?? "").slice(0, 60)}`);

    } catch (e) { ok("(다) 실행 자체", false, String((e as Error)?.message ?? e).slice(0, 200)); }
    say(`\n  증거 row id — tenant ${tid} · accounts A=${A} B=${B} C=${C} · slots sched=${sSched} pub=${sPub} done=${sDone} planned=${sPlanned} new=${r3new?.id ?? "-"} · pieces ${pSched}/${pPub}/${pDone} · job ${job.id}`);
  } finally {
    const shotDir = path.join(ROOT, "runner", "_shots");
    fs.mkdirSync(shotDir, { recursive: true });
    const file = path.join(shotDir, `failover-${stamp}.txt`);
    lines.push(`\n── 결과: ${pass} 통과 · ${fail} 실패 ──`);
    fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
    console.log(`\n── 결과: ${pass} 통과 · ${fail} 실패 ── 스냅샷 runner/_shots/${path.basename(file)}`);
    if (!keep) {
      for (const table of ["posts", "runner_jobs", "runner_devices", "account_creds", "pieces", "slots", "accounts", "account_groups", "notifications", "audit_logs"]) {
        await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${tid}`).catch(() => {});
      }
      await q(sql`DELETE FROM tenants WHERE id = ${tid}`);
      console.log(`   (테넌트 ${tid} 정리 완료 — 남기려면 --keep)`);
    }
    await pgClient.end({ timeout: 5 });
    process.exit(fail ? 1 : 0);
  }
}

main().catch(async (e) => { console.error("\n실증 예외:", e); await pgClient.end({ timeout: 5 }); process.exit(1); });
