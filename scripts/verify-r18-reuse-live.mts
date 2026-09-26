/**
 * scripts/verify-r18-reuse-live.mts — [R18 · B · 2026-09-26] «한 영상 여러 곳»을 **라이브 DB 에서 한 바퀴** 돌린다.
 *   사용: `npx tsx scripts/verify-r18-reuse-live.mts`
 *   시드 집 둘을 만들고(끝나면 치운다) 실제 경로를 부른다: 설정 저장 → 처음 한 번 답(검수 중) → 승인(`approvePiece` — 사람·크론 같은 한 곳)
 *   → 파생 · 두 번 불러도 새로 0 · 원장 0행 · 같은 r2_key · 원본 다시 만들기(멈춤 → 새 영상으로 갈아 끼움) · 원본 버리기(같이 버림)
 *   · 안 물은 집의 알림 한 번(두 번째 승인엔 안 나간다).
 *   🔴 발행은 하지 않는다 — 파생은 `scheduled_for NULL` 이라 발행 크론이 안 줍고, 이 스크립트도 publish 를 안 부른다.
 *   🔴 **영상 생성도 하지 않는다** — «30초 판 새로 만들기»는 `confirm` → `triggerVideo` 를 부르는데, `.env` 에 라이브 주소와
 *      `INTERNAL_SECRET` 이 있으면 **라이브 배경 함수를 불러 진짜 Veo·TTS 가 돈다**(AC-53 · $3.63 실측). 그래서 맨 위에서
 *      `INTERNAL_SECRET` 을 비운다 → `triggerVideo` 가 네트워크 전에 멈추고 failed + 환급 + 알림으로 남긴다(돈 경로만 잰다).
 */
import "./_lib/load-env.mjs";
process.env.INTERNAL_SECRET = "";   // 🔴 위 머리말 — 라이브 배경 함수를 절대 부르지 않게(모듈이 값을 읽는 건 호출 때라 여기서 비우면 된다)
delete process.env.SITE_URL; delete process.env.URL; delete process.env.DEPLOY_PRIME_URL;   // 🔴 이중으로 — 비밀이 남아도 부를 주소가 없다(`backgroundBase` 가 던진다)
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { jsonb } from "../lib/db-util";
import { approvePiece } from "../lib/content-approve";
import { answerReuse, deriveVideoPieces, holdDerivedFor, pieceReuseView, saveVideoReuse, videoReuseView } from "../lib/video/reuse";
import { remakeVideoFor } from "../lib/director";
import { coinCostOf, videoCoinItem } from "../lib/coin-table";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
let fail = 0, pass = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (cond) { pass++; console.log(`  ✅ ${name}${detail ? `  — ${detail}` : ""}`); } else { fail++; console.log(`  🔴 ${name}${detail ? ` — ${detail}` : ""}`); } };

async function seedTenant(stamp: number, tag: string): Promise<number> {
  const [t] = await q(sql`INSERT INTO tenants (key, name, plan_key, status) VALUES (${`r18${tag}${stamp}`.slice(0, 40)}, ${`R18 재사용 실증 ${tag}`}, 'pro', 'active') RETURNING id`);
  return n(t?.id);
}
async function seedAccount(tid: number, channel: string, handle: string, personaId: number | null = null): Promise<number> {
  const [a] = await q(sql`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, persona_id) VALUES (${tid}, ${channel}, ${handle}, 'oauth', 'active', ${personaId}) RETURNING id`);
  return n(a?.id);
}
async function seedOrigin(tid: number, accountId: number, seconds: number, key: string, briefId: number | null = null): Promise<number> {
  const meta = { stage: "done", video: { format: "graphic", seconds }, render: { scenes: [] }, youtube: { title: "실증", tags: [] }, coinItem: `video_${seconds}`, regenCount: 0,
    chainLock: null, chainStage: "done", renderJobId: 1 };
  const [p] = await q(sql`INSERT INTO pieces (tenant_id, account_id, channel, kind, format, title, body, blocks, meta, status, gate_report, scheduled_for, brief_id)
    VALUES (${tid}, ${accountId}, 'youtube_shorts', 'video', 'story', ${"[R18 실증] 원본 영상"}, ${"설명란"}, ${jsonb([])}, ${jsonb({ ...meta, key: "youtube_shorts:" + accountId })}, 'in_review',
            ${jsonb({ ok: true, checks: [], rewritten: false, judge: { grade: "OK", pass: true, axes: [] } })}, NOW() + interval '2 hours', ${briefId}) RETURNING id`);
  const id = n(p?.id);
  await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, meta, sort) VALUES (${tid}, ${id}, 'video', ${key}, ${jsonb({ durationMs: seconds * 1000, bytes: 999999 })}, 0)`);
  await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, meta, sort) VALUES (${tid}, ${id}, 'thumb', ${`${key}.jpg`}, ${jsonb({ from: "render" })}, 1)`);
  // 원본의 코인 한 번(원장 행을 실제로 만든다 — 파생 전후 «차감 행 수가 같다»를 재려면 원본 행이 있어야 한다)
  await q(sql`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, item, ref, reason) VALUES (${tid}, 'consume', 'included', -28, ${`video_${seconds}`}, ${`piece:${id}`}, ${"R18 실증 원본"})`);
  return id;
}
const consumeRows = async (tid: number) => n((await q(sql`SELECT COUNT(*)::int AS c FROM coin_ledger WHERE tenant_id = ${tid} AND kind = 'consume'`))[0]?.c);

async function main() {
  const stamp = Date.now();
  const tA = await seedTenant(stamp, "a"), tB = await seedTenant(stamp, "b");
  console.log(`\n── R18 한 영상 여러 곳 — 라이브 실증 (시드 집 ${tA} · ${tB}) ──`);
  try {
    /* ── 집 A: 계정 — 쇼츠(원본) · 릴스 · 틱톡 · 클립 · 페북 릴스 · + youtube_long(🔴 연결돼 있어도 안 가야 한다) ── */
    const acc = await seedAccount(tA, "youtube_shorts", "yt_a");
    for (const [c, h] of [["reels", "ig_a"], ["tiktok", "tt_a"], ["naver_clip", "clip_a"], ["facebook_reels", "fb_a"], ["youtube_long", "ytl_a"]]) await seedAccount(tA, c, h);
    /* 원본의 지시서 — «30초 판 새로 만들기»가 이 spec 을 복제한다(실제 director 가 쓰는 모양 그대로 · 필요한 칸만). */
    const spec = { key: `youtube_shorts:${acc}`, channel: "youtube_shorts", accountId: acc, accountHandle: "yt_a", kind: "video", emotionKey: "script", format: "story", composition: "60초 그래픽 스토리",
      images: { count: 0, aiCount: 0, style: "photo", heroNeeded: false }, monetize: { affiliate: null, sponsored: false, gift: false, adDisclosure: false },
      schedule: { at: new Date(Date.now() + 3 * 3600_000).toISOString(), slotReason: "실증" }, lengthHint: { words: 0 }, coinCost: 28, angle: "R18 실증",
      video: { format: "graphic", seconds: 60, cuts: 9, provider: { tier: "standard", key: "omni" }, voice: { provider: "gemini", voiceId: "Kore" }, variant: { palette: "warm", hookType: "question", voiceId: "Kore" }, disclosure: { badge: false, descriptionFirstLine: false } } };
    const [tp] = await q(sql`INSERT INTO topics (tenant_id, title, norm_key, status) VALUES (${tA}, ${"R18 실증 소재"}, ${`r18smoke${stamp}`}, 'used') RETURNING id`);
    const [br] = await q(sql`INSERT INTO briefs (tenant_id, topic_id, goal, pieces, reasons, mode, status, coin_cost) VALUES (${tA}, ${n(tp?.id)}, 'adsense', ${jsonb([spec])}, ${jsonb([])}, 'reviewed', 'confirmed', 28) RETURNING id`);
    const origin = await seedOrigin(tA, acc, 60, `autocreate/${tA}/r18/origin-v1.mp4`, n(br?.id));
    await q(sql`UPDATE pieces SET topic_id = ${n(tp?.id)} WHERE id = ${origin}`);

    console.log("\n① 설정 · 처음 한 번");
    const view0 = await videoReuseView(tA);
    ok("안 물은 집 — 꺼짐 · asked false", view0.on === false && view0.asked === false);
    ok("후보 다섯 · youtube_long 없음 · 연결 여부는 서버가 준다", view0.targets.map((t) => t.channel).join() === "youtube_shorts,reels,tiktok,naver_clip,facebook_reels" && view0.targets.every((t) => t.connected), JSON.stringify(view0.targets.map((t) => [t.channel, t.maxSeconds, t.connected])));
    const pv0 = await pieceReuseView(tA, (await q(sql`SELECT * FROM pieces WHERE id = ${origin}`))[0]);
    ok("검수 중 원본 — ask true · basis all", pv0?.role === "origin" && pv0.ask === true && pv0.basis === "all", JSON.stringify(pv0 && pv0.role === "origin" ? { ask: pv0.ask, basis: pv0.basis, places: pv0.fit.places } : pv0));

    const ans = await answerReuse(tA, origin, { channels: ["reels", "tiktok", "naver_clip", "facebook_reels", "youtube_long"], remember: true }, null);
    ok("답(검수 중) — 설정 켜짐 · youtube_long 은 걸러져 저장 · 아직 파생 0(승인 때 만든다)",
      ans.ok && ans.setting.on && !ans.setting.channels.includes("youtube_long") && ans.derive === null, JSON.stringify(ans.ok ? { on: ans.setting.on, ch: ans.setting.channels, derive: ans.derive } : ans));

    console.log("\n② 승인(approvePiece — 사람·마감 크론 같은 한 곳) → 파생");
    const before = await consumeRows(tA);
    const [p0] = await q(sql`SELECT * FROM pieces WHERE id = ${origin}`);
    const ap = await approvePiece(tA, p0, { by: { uid: 1, role: "owner" } });
    ok("원본 승인 → scheduled", ap.ok === true, JSON.stringify(ap.ok ? { at: ap.scheduledFor } : ap));
    const der = await q(sql`SELECT p.id, p.channel, p.status, p.scheduled_for, p.slot_id, p.external_url, p.channel_ref, p.meta, a.channel AS acc_channel
      FROM pieces p LEFT JOIN accounts a ON a.id = p.account_id WHERE p.tenant_id = ${tA} AND p.origin_piece_id = ${origin} ORDER BY p.id`);
    ok("60초 → 릴스·틱톡·페북 릴스 세 곳(클립은 30초라 빠진다)", der.map((d) => d.channel).join() === "reels,tiktok,facebook_reels", der.map((d) => d.channel).join());
    ok("🔴 youtube_long 계정이 연결돼 있어도 안 간다", !der.some((d) => String(d.channel).startsWith("youtube_")));
    ok("파생 = scheduled · 시각 NULL · 자리 NULL · 발행 흔적 NULL", der.every((d) => d.status === "scheduled" && d.scheduled_for == null && d.slot_id == null && d.external_url == null && d.channel_ref == null));
    ok("계정은 그 채널 계정", der.every((d) => d.acc_channel === d.channel));
    const after = await consumeRows(tA);
    ok("🔴 코인 — 파생 전후 consume 행 수가 같다", before === after, `${before} → ${after}`);
    const dIds = der.map((d) => n(d.id));
    const dLedger = n((await q(sql`SELECT COUNT(*)::int AS c FROM coin_ledger WHERE tenant_id = ${tA} AND (${sql.join(dIds.map((i) => sql`ref = ${`piece:${i}`} OR ref LIKE ${`piece:${i}:%`}`), sql` OR `)})`))[0]?.c);
    ok("🔴 파생 ref 로 찍힌 원장 행 = 0", dLedger === 0, `${dLedger}행`);
    const keys = await q(sql`SELECT piece_id, kind, r2_key, meta->>'reusedFrom' AS rf, meta->>'durationMs' AS ms FROM piece_assets WHERE tenant_id = ${tA} AND piece_id IN (${sql.join(dIds.map((i) => sql`${i}`), sql`, `)}) ORDER BY piece_id, kind`);
    ok("파일 — 파생마다 video·thumb, 원본과 **같은 r2_key**, reusedFrom·durationMs 실림",
      keys.length === dIds.length * 2 && keys.filter((k) => k.kind === "video").every((k) => k.r2_key === `autocreate/${tA}/r18/origin-v1.mp4` && n(k.rf) === origin && n(k.ms) === 60000), JSON.stringify(keys.slice(0, 2)));
    const m0 = (der[0]?.meta ?? {}) as Row;
    ok("파생 meta — reuse.coin 0 · 체인·코인 흔적 없음", (m0.reuse as Row)?.coin === 0 && !("coinItem" in m0) && !("chainLock" in m0) && !("renderJobId" in m0), JSON.stringify(m0.reuse));
    const ty = await q(sql`SELECT jsonb_typeof(meta) AS t, jsonb_typeof(meta->'reuse') AS r FROM pieces WHERE id = ${dIds[0]}`);
    ok("jsonb 모양(PITFALLS #1) — meta object · reuse object", ty[0]?.t === "object" && ty[0]?.r === "object");
    const [o1] = await q(sql`SELECT meta->'reuseResult' AS rr FROM pieces WHERE id = ${origin}`);
    const rr = (o1?.rr ?? {}) as { skip?: { channel: string; why: string; line: string }[] };
    ok("원본이 «빠진 곳»을 들고 있다 — 클립 · too_long · 문장", rr.skip?.length === 1 && rr.skip[0].channel === "naver_clip" && rr.skip[0].why === "too_long", rr.skip?.[0]?.line ?? "");

    console.log("\n③ 멱등 — 두 번 불러도 새로 0");
    const again = await deriveVideoPieces(tA, origin);
    ok("다시 불러도 created 0 · existing 3", again.ok && again.created.length === 0 && again.existing.length === 3, JSON.stringify(again.ok ? { c: again.created.length, e: again.existing.length } : again));
    const again2 = await approvePiece(tA, (await q(sql`SELECT * FROM pieces WHERE id = ${origin}`))[0], { by: { uid: 1, role: "owner" } });
    const cnt = n((await q(sql`SELECT COUNT(*)::int AS c FROM pieces WHERE tenant_id = ${tA} AND origin_piece_id = ${origin}`))[0]?.c);
    ok("승인을 한 번 더 눌러도(alreadyScheduled) 파생 수 그대로 3", again2.ok && cnt === 3, `${cnt}`);

    console.log("\n④ 화면이 읽는 모양");
    const pvO = await pieceReuseView(tA, (await q(sql`SELECT * FROM pieces WHERE id = ${origin}`))[0]);
    ok("원본 — ask false · derived 3 · skipped 1", pvO?.role === "origin" && !pvO.ask && pvO.derived.length === 3 && pvO.skipped.length === 1,
      JSON.stringify(pvO && pvO.role === "origin" ? { ask: pvO.ask, basis: pvO.basis, places: pvO.fit.places, derived: pvO.derived.map((d) => `${d.channel}:${d.status}:${d.handle}`) } : pvO));
    const pvD = await pieceReuseView(tA, (await q(sql`SELECT * FROM pieces WHERE id = ${dIds[0]}`))[0]);
    ok("파생 — role derived · coin 0 · 사람말 한 줄", pvD?.role === "derived" && pvD.coin === 0 && pvD.origin.pieceId === origin, pvD?.role === "derived" ? pvD.line : "");

    console.log("\n④-b 🔴 «30초로 다시 만들 길»(트리거 §6-6) — 빠진 클립용 30초 판을 새로");
    const clipSkip = pvO?.role === "origin" ? pvO.fit.skip.find((x) => x.channel === "naver_clip") : undefined;
    ok("빠진 줄에 값이 먼저 실린다 — remake {30초 · 코인}", clipSkip?.remake?.seconds === 30 && clipSkip.remake.coins === coinCostOf(videoCoinItem(30)), JSON.stringify(clipSkip?.remake));
    const short = await remakeVideoFor(tA, origin, "naver_clip", null);
    ok("코인이 모자라면 402 사유 — 조용히 0건 아님(시드 집 잔액 0)", !short.ok && short.step === "coin_short", JSON.stringify(short).slice(0, 160));
    await q(sql`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, reason, ref) VALUES (${tA}, 'grant', 'included', 200, ${"R18 실증 지급"}, ${`r18smoke:${stamp}`})`);
    const c0 = await consumeRows(tA);
    const rm = await remakeVideoFor(tA, origin, "naver_clip", null);
    const [np] = rm.ok ? await q(sql`SELECT id, channel, status, origin_piece_id, meta, account_id FROM pieces WHERE id = ${rm.pieceIds[0]}`) : [];
    const nm = (np?.meta ?? {}) as Row;
    ok("새 영상 — 네이버 클립 · 30초 · 파생 아님(origin_piece_id NULL) · remakeOf 원본", rm.ok && np?.channel === "naver_clip" && ((nm.video as Row)?.seconds === 30) && np?.origin_piece_id == null && n(nm.remakeOf) === origin,
      JSON.stringify(rm.ok ? { id: rm.pieceIds, coins: rm.coinsCharged, st: np?.status, sec: (nm.video as Row)?.seconds, alsoTo: rm.alsoTo } : rm).slice(0, 200));
    ok("🔴 새 영상이라 코인은 그 길이 값 한 번(원장 consume +1행)", rm.ok && rm.coinsCharged === coinCostOf(videoCoinItem(30)) && (await consumeRows(tA)) === c0 + 1, `charged ${rm.ok ? rm.coinsCharged : "-"}`);
    ok("같이 덮을 다른 빠진 채널 없음 → reuseChannels [] 로 적힌다(승인 때 릴스·틱톡에 두 번 안 간다)", Array.isArray(nm.reuseChannels) && (nm.reuseChannels as unknown[]).length === 0);
    ok("생성은 안 불렀다(INTERNAL_SECRET 비움) → failed + 환급으로 정직하게 남는다", np?.status === "failed", String(np?.status));
    await q(sql`UPDATE pieces SET status = 'in_review' WHERE id = ${n(np?.id)}`);   // 만들어졌다고 친다(멱등을 재려고)
    const rm2 = await remakeVideoFor(tA, origin, "naver_clip", null);
    ok("🔴 두 번 눌러도 새로 0 · 코인 0 — 같은 id", rm2.ok && rm2.already === true && rm2.coinsCharged === 0 && rm2.pieceIds[0] === n(np?.id));
    const fitsNo = await remakeVideoFor(tA, origin, "reels", null);
    ok("🔴 대조군 · 이미 들어가는 채널(릴스)은 새로 안 만든다", !fitsNo.ok && fitsNo.step === "fits");
    const ytl = await remakeVideoFor(tA, origin, "youtube_long", null);
    ok("🔴 대조군 · 후보 밖(youtube_long)은 없는 길", !ytl.ok && ytl.step === "channel");

    console.log("\n⑤ 원본 다시 만들기 → 파생 멈춤 → 다시 승인하면 새 영상으로 갈아 끼움");
    const held = await holdDerivedFor(tA, origin, "regenerate");
    ok("안 나간 파생 3개 멈춤(시각 NULL · waitOrigin)", held.length === 3);
    // 원본이 새로 구워졌다고 친다(finalizeRender 가 하는 일: 옛 video 행을 지우고 새 key)
    await q(sql`DELETE FROM piece_assets WHERE tenant_id = ${tA} AND piece_id = ${origin} AND kind IN ('video','thumb')`);
    await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, meta, sort) VALUES (${tA}, ${origin}, 'video', ${`autocreate/${tA}/r18/origin-v2.mp4`}, ${jsonb({ durationMs: 60000 })}, 0)`);
    const re = await deriveVideoPieces(tA, origin);
    const nk = await q(sql`SELECT DISTINCT r2_key FROM piece_assets WHERE tenant_id = ${tA} AND kind = 'video' AND piece_id IN (${sql.join(dIds.map((i) => sql`${i}`), sql`, `)})`);
    ok("🔴 파생이 새 영상(v2)을 가리킨다 — 옛 영상이 안 나간다", re.ok && nk.length === 1 && String(nk[0].r2_key).endsWith("origin-v2.mp4"), nk.map((k) => k.r2_key).join());
    const w = await q(sql`SELECT COUNT(*)::int AS c FROM pieces WHERE tenant_id = ${tA} AND origin_piece_id = ${origin} AND (meta->'reuse'->>'waitOrigin') = 'true'`);
    ok("갈아 끼운 뒤 waitOrigin 이 풀린다", n(w[0]?.c) === 0);

    console.log("\n⑥ 원본 버리기 → 안 나간 파생도 같이");
    await q(sql`UPDATE pieces SET status = 'published', external_url = 'https://example.invalid/x' WHERE id = ${dIds[0]}`);   // 하나는 이미 나갔다고 친다
    const rej = await holdDerivedFor(tA, origin, "reject");
    const st = await q(sql`SELECT id, status FROM pieces WHERE tenant_id = ${tA} AND origin_piece_id = ${origin} ORDER BY id`);
    ok("안 나간 둘만 rejected · 이미 나간 하나는 그대로", rej.length === 2 && st.filter((s) => s.status === "rejected").length === 2 && st.find((s) => n(s.id) === dIds[0])?.status === "published", st.map((s) => `${s.id}:${s.status}`).join(" "));

    console.log("\n⑦ 안 물은 집 — 승인 때 알림 한 번(모르면 안 켠다)");
    const accB = await seedAccount(tB, "youtube_shorts", "yt_b");
    await seedAccount(tB, "reels", "ig_b");
    const oB1 = await seedOrigin(tB, accB, 30, `autocreate/${tB}/r18/b1.mp4`);
    const oB2 = await seedOrigin(tB, accB, 30, `autocreate/${tB}/r18/b2.mp4`);
    await approvePiece(tB, (await q(sql`SELECT * FROM pieces WHERE id = ${oB1}`))[0], {});   // 크론 경로(by 없음)
    await approvePiece(tB, (await q(sql`SELECT * FROM pieces WHERE id = ${oB2}`))[0], {});
    const nt = await q(sql`SELECT title, body, link FROM notifications WHERE tenant_id = ${tB} AND kind = 'video_reuse_ask'`);
    ok("알림 딱 한 번(두 번째 승인엔 안 나간다)", nt.length === 1, nt[0] ? `${nt[0].title} · ${nt[0].link}` : "0건");
    ok("알림 링크가 첫 원본 시트로 간다", nt[0]?.link === `/app/piece.html?id=${oB1}&reuse=ask`);
    const dB = n((await q(sql`SELECT COUNT(*)::int AS c FROM pieces WHERE tenant_id = ${tB} AND origin_piece_id IS NOT NULL`))[0]?.c);
    ok("🔴 답이 없으니 파생 0(꺼진 채로 둔다)", dB === 0);
    const vB = await videoReuseView(tB);
    ok("알림은 «물었다»가 아니다 — asked 는 여전히 false(시트가 여전히 뜬다)", vB.asked === false && vB.on === false);
    const sB = await saveVideoReuse(tB, { on: true, channels: ["reels"] });
    ok("설정 저장 한 번이면 asked", !!sB.askedAt && sB.on);
    const tyB = await q(sql`SELECT jsonb_typeof(settings) AS s, jsonb_typeof(settings->'videoReuse'->'channels') AS c FROM tenants WHERE id = ${tB}`);
    ok("settings 모양(PITFALLS #1) — object · channels array", tyB[0]?.s === "object" && tyB[0]?.c === "array");

    console.log("\n⑧ 🔴 제공사 돈 — 코인 원장 0 ≠ 제공사 돈 0(메인 지적) · `ai_usage` 도 센다");
    const ai = n((await q(sql`SELECT COUNT(*)::int AS c FROM ai_usage WHERE tenant_id IN (${tA}, ${tB})`))[0]?.c);
    ok("시드 집 두 곳의 ai_usage = 0행(생성 호출 전에 멈췄다)", ai === 0, `${ai}행`);
    const gen = n((await q(sql`SELECT COUNT(*)::int AS c FROM runner_jobs WHERE tenant_id IN (${tA}, ${tB})`))[0]?.c);
    ok("렌더 잡 0건(러너가 구울 것도 없다)", gen === 0, `${gen}건`);
  } finally {
    for (const tid of [tA, tB]) {
      for (const table of ["posts", "runner_jobs", "slots", "piece_assets", "pieces", "briefs", "topics", "accounts", "notifications", "audit_logs", "coin_ledger", "ai_usage"]) {
        await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${tid}`).catch(() => {});
      }
      await q(sql`DELETE FROM tenants WHERE id = ${tid}`).catch(() => {});
    }
    const left = n((await q(sql`SELECT COUNT(*)::int AS c FROM pieces WHERE tenant_id IN (${tA}, ${tB})`))[0]?.c);
    console.log(`\n   (시드 집 ${tA}·${tB} 정리 완료 · 남은 piece ${left})`);
    await pgClient.end({ timeout: 5 });
  }
  console.log(`\n${fail ? "🔴" : "✅"} R18 라이브 실증 — 통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pgClient.end({ timeout: 5 }).catch(() => {}); process.exit(2); });
