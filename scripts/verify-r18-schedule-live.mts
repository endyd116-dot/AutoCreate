/**
 * scripts/verify-r18-schedule-live.mts — [R18 · B2 · 2026-09-26] 파생 편성을 **라이브 DB 에서 한 바퀴** 돌린다(SQL 이 실제로 도나).
 *   사용: `npx tsx scripts/verify-r18-schedule-live.mts`
 *
 *   ══ 왜 따로 있나 ══
 *     `verify-r18-stagger`(순수·소스)는 `scheduleDerived` 의 **SQL 을 한 줄도 안 돌린다.** 그 SQL 이 틀리면
 *     B2 SEAM 이 삼키고 감사만 남는다 — **조용한 실패**다. 그래서 한 번은 진짜 DB 에서 돌린다.
 *
 *   ══ 하는 일(시드 집 하나 · 끝나면 그 집 행을 전부 지운다 · B `verify-r18-reuse-live` 와 같은 관례) ══
 *     ① 30초 원본 → B `deriveVideoPieces`(→ SEAM → `scheduleDerived`) → 파생 넷이 시각·자리를 받는다 · 가족 시차 ≥ 30분 · slots origin 'derived'
 *     ② 다시 불러도 새로 0(멱등)
 *     ③ 새서 온 파생(B 를 비껴 손으로 넣은 60초 클립 · 유튜브 두 번) → `failed` + 사유 한 줄 · 감사 high
 *     ④ `waitOrigin` 파생은 안 얹는다
 *     ⑤ 🔴 쉬다 깨기(`holdBacklog` → `releaseBacklog`) 뒤에도 가족이 같은 분에 안 모인다(C 가 짚은 길)
 *     ⑥ `publish()`(dryRun) 가 60초 클립을 러너 잡 전에 `not_publishable` 로 돌려보낸다
 *     ⑦ 고객이 원본을 형제 옆으로 옮기면 형제만 다시 맞추고 · 파생을 직접 붙이면 안 옮기고 말한다(`restaggerFamily`)
 *   🔴 발행은 하지 않는다 — 시각은 전부 지금+2시간 뒤라 라이브 발행 크론이 안 줍고, 이 스크립트는 publish 를 dryRun 으로만 부른다.
 */
import "./_lib/load-env.mjs";
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { jsonb, utcDate } from "../lib/db-util";
import { deriveVideoPieces } from "../lib/video/reuse";
import { scheduleDerived, restaggerFamily, staggerClashes, DERIVED_STAGGER_MIN, DERIVED_SLOT_ORIGIN } from "../lib/derived-schedule";
import { holdBacklog, releaseBacklog } from "../lib/tenant-pause";
import { publishPieceById } from "../lib/publish";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
let fail = 0, pass = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (cond) { pass++; console.log(`  ✅ ${name}${detail ? `  — ${detail}` : ""}`); } else { fail++; console.log(`  🔴 ${name}${detail ? ` — ${detail}` : ""}`); } };
const kst = (d: Date | null) => d ? new Date(d.getTime() + 9 * 3600_000).toISOString().slice(5, 16).replace("T", " ") : "없음";

async function seedAccount(tid: number, channel: string, handle: string): Promise<number> {
  /* 워밍업을 끈다(`warmup_off`) — 새 계정은 이번 주 1건이라 가족 판이 «자리 없음»으로만 끝난다. 여기서 재는 것은 시차·SQL 이다. */
  const [a] = await q(sql`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, daily_cap, min_gap_min, warmup_off)
    VALUES (${tid}, ${channel}, ${handle}, 'oauth', 'active', 3, 180, true) RETURNING id`);
  return n(a?.id);
}
async function seedOrigin(tid: number, accountId: number, seconds: number, key: string, atSql: ReturnType<typeof sql>): Promise<number> {
  const meta = { stage: "done", video: { format: "graphic", seconds }, render: { scenes: [] }, coinItem: `video_${seconds}` };
  const [p] = await q(sql`INSERT INTO pieces (tenant_id, account_id, channel, kind, format, title, body, blocks, meta, status, gate_report, scheduled_for)
    VALUES (${tid}, ${accountId}, 'youtube_shorts', 'video', 'story', ${`[R18 편성 실증] ${seconds}초 원본`}, ${"설명란"}, ${jsonb([])}, ${jsonb(meta)}, 'scheduled',
            ${jsonb({ ok: true, checks: [], rewritten: false })}, ${atSql}) RETURNING id`);
  const id = n(p?.id);
  await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, meta, sort) VALUES (${tid}, ${id}, 'video', ${key}, ${jsonb({ durationMs: seconds * 1000, bytes: 999999 })}, 0)`);
  return id;
}
const family = async (tid: number, originId: number) => q(sql`SELECT id, channel, status, scheduled_for, slot_id, meta FROM pieces
  WHERE tenant_id = ${tid} AND (id = ${originId} OR origin_piece_id = ${originId}) ORDER BY id`);

async function main() {
  const stamp = Date.now();
  const [col] = await q(sql`SELECT 1 AS x FROM information_schema.columns WHERE table_name = 'pieces' AND column_name = 'origin_piece_id'`);
  if (!col) { console.log("⊘ 못 쟀음 — 라이브에 pieces.origin_piece_id 가 없다(B 0088 미적용)"); await pgClient.end({ timeout: 5 }); process.exit(2); }
  const [t] = await q(sql`INSERT INTO tenants (key, name, plan_key, status) VALUES (${`r18s${stamp}`.slice(0, 40)}, ${"R18 편성 실증"}, 'pro', 'active') RETURNING id`);
  const tid = n(t?.id);
  console.log(`\n── R18 파생 편성 — 라이브 실증 (시드 집 ${tid}) ──`);
  try {
    const yt = await seedAccount(tid, "youtube_shorts", "yt_s");
    const accs: Record<string, number> = {};
    for (const c of ["reels", "tiktok", "naver_clip", "facebook_reels"]) accs[c] = await seedAccount(tid, c, `${c}_s`);

    console.log("\n① 30초 원본 → 파생 넷 → 시각·자리(SEAM)");
    const o1 = await seedOrigin(tid, yt, 30, `autocreate/${tid}/r18s/o1.mp4`, sql`NOW() + interval '3 hours'`);
    const d1 = await deriveVideoPieces(tid, o1, { channels: ["reels", "tiktok", "naver_clip", "facebook_reels"] });
    ok("B deriveVideoPieces 가 파생 넷을 만든다", d1.ok && d1.created.length === 4, JSON.stringify(d1.ok ? d1.created.map((c) => c.channel) : d1));
    const f1 = await family(tid, o1);
    const times = f1.map((r) => ({ pieceId: n(r.id), channel: String(r.channel), at: utcDate(r.scheduled_for) }));
    console.log(`     ${times.map((x) => `${x.channel} ${kst(x.at)}`).join(" · ")}`);
    ok("파생 넷 다 시각을 받았다(SEAM → scheduleDerived 의 SQL 이 실제로 돈다)", times.filter((x) => x.pieceId !== o1).every((x) => !!x.at));
    const clashes = staggerClashes(times.filter((x) => x.at).map((x) => ({ pieceId: x.pieceId, at: x.at! })));
    ok(`가족 안 어느 두 시각도 ${DERIVED_STAGGER_MIN}분 안에 안 붙는다`, clashes.length === 0, JSON.stringify(clashes));
    const slots = await q(sql`SELECT s.id, s.piece_id, s.origin, s.status, s.publish_at, p.scheduled_for, p.slot_id FROM slots s JOIN pieces p ON p.id = s.piece_id
      WHERE s.tenant_id = ${tid} AND p.origin_piece_id = ${o1}`);
    ok(`편성표 자리 넷 · origin '${DERIVED_SLOT_ORIGIN}' · status scheduled · 자리 시각 = 글 시각 · piece.slot_id 연결`, slots.length === 4
      && slots.every((s) => s.origin === DERIVED_SLOT_ORIGIN && s.status === "scheduled" && utcDate(s.publish_at)?.getTime() === utcDate(s.scheduled_for)?.getTime() && n(s.slot_id) === n(s.id)),
      `slot id ${slots.map((s) => n(s.id)).join(",")}`);
    const aud = await q(sql`SELECT COUNT(*)::int AS c FROM audit_logs WHERE tenant_id = ${tid} AND action = 'reuse_scheduled'`);
    ok("감사 reuse_scheduled 한 줄", n(aud[0]?.c) >= 1);
    const deferred = await q(sql`SELECT COUNT(*)::int AS c FROM audit_logs WHERE tenant_id = ${tid} AND action = 'reuse_schedule_deferred'`);
    ok("SEAM 이 오류를 삼킨 흔적 0(`reuse_schedule_deferred`)", n(deferred[0]?.c) === 0);

    console.log("\n② 다시 불러도 새로 0");
    const again = await scheduleDerived(tid, o1);
    ok("scheduleDerived 두 번째 — placed 0 · dropped 0", again.ok && again.placed.length === 0 && again.dropped.length === 0, JSON.stringify({ placed: again.placed.length, waiting: again.waiting.length }));

    console.log("\n③ 새서 온 파생 — 60초 클립 · 유튜브 두 번");
    const o2 = await seedOrigin(tid, yt, 60, `autocreate/${tid}/r18s/o2.mp4`, sql`NOW() + interval '5 hours'`);
    const d2 = await deriveVideoPieces(tid, o2, { channels: ["reels", "naver_clip"] });
    ok("B 가 60초 원본에서 클립을 뺀다(skip too_long) — 첫 겹", d2.ok && d2.created.every((c) => c.channel !== "naver_clip") && d2.skip.some((s) => s.channel === "naver_clip" && s.why === "too_long"));
    /* B 를 비껴 손으로 넣는다(새는 경우를 흉내) — 둘째 겹이 잡는가. */
    const leak = async (channel: string, accountId: number, ms: number) => {
      const [p] = await q(sql`INSERT INTO pieces (tenant_id, account_id, channel, kind, title, body, meta, status, origin_piece_id)
        VALUES (${tid}, ${accountId}, ${channel}, 'video', ${"[R18 편성 실증] 새서 온 파생"}, ${"설명란"}, ${jsonb({})}, 'scheduled', ${o2}) RETURNING id`);
      await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, meta, sort) VALUES (${tid}, ${n(p?.id)}, 'video', ${`autocreate/${tid}/r18s/o2.mp4`}, ${jsonb({ durationMs: ms })}, 0)`);
      return n(p?.id);
    };
    const clipLeak = await leak("naver_clip", accs.naver_clip, 60_000);
    const ytlAcc = await seedAccount(tid, "youtube_long", "ytl_s");
    const ytLeak = await leak("youtube_long", ytlAcc, 60_000);
    const r2 = await scheduleDerived(tid, o2);
    const rows2 = await q(sql`SELECT id, status, meta->>'failReason' AS why, scheduled_for FROM pieces WHERE id IN (${clipLeak}, ${ytLeak})`);
    const clipRow = rows2.find((r) => n(r.id) === clipLeak), ytRow = rows2.find((r) => n(r.id) === ytLeak);
    ok("60초 클립 파생 → failed · 시각 없음 · 사유 «60초라 … 30초를 골라 주세요»", clipRow?.status === "failed" && !clipRow?.scheduled_for && /60초라 .*30초를 골라 주세요/.test(String(clipRow?.why ?? "")), String(clipRow?.why ?? ""));
    ok("유튜브 두 번(원본 쇼츠 + youtube_long 파생) → failed · «유튜브에 한 번만»", ytRow?.status === "failed" && /유튜브에 한 번만/.test(String(ytRow?.why ?? "")), String(ytRow?.why ?? ""));
    ok("둘 다 dropped 로 돌려준다(why too_long · youtube_twice)", r2.dropped.some((d) => d.pieceId === clipLeak && d.why === "too_long") && r2.dropped.some((d) => d.pieceId === ytLeak && d.why === "youtube_twice"));
    const hi = await q(sql`SELECT action FROM audit_logs WHERE tenant_id = ${tid} AND action IN ('reuse_length_leak','reuse_youtube_twice') AND risk_level = 'high'`);
    ok("감사 high 둘(조용히 넘기지 않는다)", hi.length === 2, hi.map((h) => String(h.action)).join(","));

    console.log("\n⑥ publish()(dryRun) — 60초 클립을 러너 잡 전에 돌려보낸다");
    const pr = await publishPieceById(tid, clipLeak, { dryRun: true });
    const jobs = await q(sql`SELECT COUNT(*)::int AS c FROM runner_jobs WHERE tenant_id = ${tid}`);
    ok("not_publishable · retriable false · detail length_over_channel", !pr.ok && pr.reason === "not_publishable" && pr.retriable === false && String(pr.detail ?? "").startsWith("length_over_channel"), JSON.stringify(pr));
    ok("러너 잡 0행", n(jobs[0]?.c) === 0);

    console.log("\n④ waitOrigin 파생은 안 얹는다");
    const o3 = await seedOrigin(tid, yt, 30, `autocreate/${tid}/r18s/o3.mp4`, sql`NOW() + interval '7 hours'`);
    const [w] = await q(sql`INSERT INTO pieces (tenant_id, account_id, channel, kind, title, body, meta, status, origin_piece_id)
      VALUES (${tid}, ${accs.reels}, 'reels', 'video', ${"[R18 편성 실증] 다시 만드는 중"}, ${"설명란"}, ${jsonb({ reuse: { waitOrigin: true } })}, 'scheduled', ${o3}) RETURNING id`);
    const r3 = await scheduleDerived(tid, o3);
    const [wr] = await q(sql`SELECT scheduled_for, slot_id FROM pieces WHERE id = ${n(w?.id)}`);
    ok("waitOrigin 파생 — 시각 없음 · 자리 없음 · placed 0", !wr?.scheduled_for && !wr?.slot_id && r3.placed.length === 0);

    console.log("\n⑤ 🔴 쉬다 깨기 — hold → release 뒤에도 가족이 같은 분에 안 모인다");
    /* 원본 o1 가족을 «쉬는 사이 시각이 지나 버린» 상태로 만든다. */
    await q(sql`UPDATE pieces SET scheduled_for = NOW() - interval '30 minutes' WHERE tenant_id = ${tid} AND (id = ${o1} OR origin_piece_id = ${o1})`);
    const held = await holdBacklog(tid, new Date());
    ok("holdBacklog 가 원본+파생 다섯을 모은다(pending_resume)", held >= 5, `모은 수 ${held}`);
    const wakeAt = new Date();
    const moved = await releaseBacklog(tid, wakeAt);
    const f5 = await family(tid, o1);
    const t5 = f5.map((r) => ({ pieceId: n(r.id), channel: String(r.channel), status: String(r.status), at: utcDate(r.scheduled_for) }));
    console.log(`     ${t5.map((x) => `${x.channel} ${kst(x.at)}(${x.status})`).join(" · ")}`);
    ok("다섯 다 scheduled · 앞으로의 시각", t5.every((x) => x.status === "scheduled" && x.at && x.at.getTime() > wakeAt.getTime()), `moved ${moved}`);
    const c5 = staggerClashes(t5.filter((x) => x.at).map((x) => ({ pieceId: x.pieceId, at: x.at! })));
    ok(`깬 뒤에도 가족 시차 ≥ ${DERIVED_STAGGER_MIN}분(틱톡·클립이 19:00 같은 분으로 모이던 길)`, c5.length === 0, JSON.stringify(c5));
    const s5 = await q(sql`SELECT s.publish_at, p.scheduled_for FROM slots s JOIN pieces p ON p.id = s.piece_id WHERE s.tenant_id = ${tid} AND p.origin_piece_id = ${o1}`);
    ok("자리 시각도 글 시각을 따라왔다(편성표가 다른 말을 안 한다)", s5.length === 4 && s5.every((s) => utcDate(s.publish_at)?.getTime() === utcDate(s.scheduled_for)?.getTime()));

    console.log("\n⑦ 고객이 시각을 옮길 때(`restaggerFamily`)");
    /* ㉮ 원본을 틱톡 파생 10분 옆으로 옮긴다 → 틱톡 파생만 다시 맞춰진다(원본은 고객이 고른 것이라 그대로). */
    const tk = t5.find((x) => x.channel === "tiktok")!;
    const newOriginAt = new Date(tk.at!.getTime() + 10 * 60_000);
    await q(sql`UPDATE pieces SET scheduled_for = ${newOriginAt.toISOString()}::timestamptz AT TIME ZONE 'UTC' WHERE id = ${o1}`);
    const rsA = await restaggerFamily(tid, o1, { keepPieceId: o1 });
    const f7 = await family(tid, o1);
    const t7 = f7.map((r) => ({ pieceId: n(r.id), channel: String(r.channel), at: utcDate(r.scheduled_for) }));
    console.log(`     ${t7.map((x) => `${x.channel} ${kst(x.at)}`).join(" · ")}`);
    ok("원본은 고객이 고른 시각 그대로", utcDate(f7.find((r) => n(r.id) === o1)?.scheduled_for)?.getTime() === newOriginAt.getTime());
    ok("깨진 형제를 다시 맞춰 가족 시차가 돌아왔다", rsA.moved >= 1 && staggerClashes(t7.filter((x) => x.at).map((x) => ({ pieceId: x.pieceId, at: x.at! }))).length === 0, `moved ${rsA.moved}`);
    /* ㉯ 고객이 클립 파생을 원본 5분 옆에 **직접** 붙인다 → 안 옮기고 말한다. */
    const clip = t7.find((x) => x.channel === "naver_clip")!;
    await q(sql`UPDATE pieces SET scheduled_for = ${new Date(newOriginAt.getTime() + 5 * 60_000).toISOString()}::timestamptz AT TIME ZONE 'UTC' WHERE id = ${clip.pieceId}`);
    const rsB = await restaggerFamily(tid, clip.pieceId, { keepPieceId: clip.pieceId });
    const [clipAfter] = await q(sql`SELECT scheduled_for FROM pieces WHERE id = ${clip.pieceId}`);
    ok("고객이 붙인 파생은 그대로 둔다", utcDate(clipAfter?.scheduled_for)?.getTime() === newOriginAt.getTime() + 5 * 60_000);
    ok("대신 한 줄 말한다(«5분 떨어져 있어요 … 이대로 두셔도 그 시각에 올라가요»)", rsB.say.some((s) => /5분 떨어져 있어요/.test(s) && /이대로 두셔도/.test(s)), JSON.stringify(rsB.say));
  } finally {
    for (const table of ["posts", "runner_jobs", "slots", "piece_assets", "pieces", "accounts", "notifications", "audit_logs", "coin_ledger"]) {
      await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${tid}`).catch(() => {});
    }
    await q(sql`DELETE FROM tenants WHERE id = ${tid}`).catch(() => {});
    const left = n((await q(sql`SELECT COUNT(*)::int AS c FROM pieces WHERE tenant_id = ${tid}`))[0]?.c);
    const leftT = n((await q(sql`SELECT COUNT(*)::int AS c FROM tenants WHERE id = ${tid}`))[0]?.c);
    console.log(`\n   (시드 집 ${tid} 정리 완료 · 남은 piece ${left} · 남은 tenant ${leftT})`);
    await pgClient.end({ timeout: 5 });
  }
  console.log(`\n${fail ? "🔴" : "✅"} R18 파생 편성 라이브 실증 — 통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pgClient.end({ timeout: 5 }).catch(() => {}); process.exit(2); });
