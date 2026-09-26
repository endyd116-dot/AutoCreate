/**
 * scripts/verify-r19-threads-derived-live.mts — [R19 · B2 · 2026-09-27] 🔴 **쓰레드 파생이 B2 의 길을 타나** + **유튜브 찬 날** 을 라이브 DB 에서 한 바퀴.
 *   사용: `npx tsx scripts/verify-r19-threads-derived-live.mts`
 *
 *   ══ 왜 따로 있나 ══
 *     R19 에 B 가 `threads` 를 재사용 대상에 넣었다(설계 §6.4). 쓰레드 커넥터는 영상을 **이미** 올린다(`publishThreadsVideo`)
 *     — 그런데 «이미 된다»는 **글 축 채널로 태어난 쓰레드 글**에서 잰 말이다. **파생**으로 태어난 쓰레드가 B2 의 세 길
 *     (시차 편성 · 같은 r2_key → video_url · 발행 멱등)을 타는지는 아무도 안 쟀다. 그래서 한 번은 진짜 DB 에서 돌린다.
 *
 *   ══ 하는 일(시드 집 둘 · 끝나면 그 집 행을 전부 지운다 · R18 `verify-r18-schedule-live` 와 같은 관례) ══
 *     ① 30초 원본(유튜브 쇼츠) → B `deriveVideoPieces(["threads","reels"])` → 쓰레드 파생이 태어난다(계정이 붙어 있으면 «준비 중» 채널도 go · B 계약)
 *     ② 시차 편성 — 쓰레드 파생이 시각·자리(origin 'derived')를 받고, 가족 안 어느 두 시각도 30분 안에 안 붙는다
 *     ③ 같은 r2_key — 파생의 video 자산 키 = 원본 키 · 쓰레드가 받을 `video_url` = 원본의 공개 주소
 *     ④ 발행 — `publishPieceById` → `publishThreadsVideo`(`media_type=VIDEO` · `video_url` = ③) → posts 1행 · published
 *     ⑤ 멱등 — 한 번 더 불러도 `already` · 쓰레드로 나간 호출 0 더 · posts 그대로 1행
 *     ⑥ 🔴 유튜브 찬 날(이 프로세스만 한도 1) — 부른 기록(`noteInsertCall`)이 **집을 가리지 않고** 세어지고(`insertCallsLast24h`),
 *        찼으면 `publishOne` 이 **배경 함수를 안 부른다** · 시도 횟수 안 늘림 · 슬롯 note = 찬 날의 말 · `publishYoutube` 는 구글을 안 부른다
 *     ⑦ 풀린 뒤 — 배경 함수를 부르고(스텁) 슬롯 note 를 지운다
 *
 *   🔴 **영상을 만들지 않는다**(사장님 · 돈) — 원본은 시드 행 + 없는 r2 키다. 생성·렌더 경로를 안 부른다.
 *   🔴 **밖으로 나가는 호출 0** — `globalThis.fetch` 를 스텁으로 바꿔 끼운다(쓰레드 그래프 · 유튜브 · 배경 함수 · 그 밖 전부).
 *      DB 는 postgres-js(TCP)라 스텁과 무관하다. 스텁이 모르는 주소는 599 로 답하고 **기록**한다(⑧에서 센다).
 *   🔴 한도 1 은 **이 프로세스의 env 만** 바꾼다(`YOUTUBE_DAILY_INSERT_CAP=1`) — 라이브 함수는 100 그대로다.
 *      부른 기록은 시드 집 행이라 끝에 지운다(남더라도 라이브 통 100 중 1).
 *   종료코드: 0 초록 · 1 틀림 · 2 못 쟀음(이 나무에 B 의 `threads` 대상이 아직 없다 · 라이브 칸 없음 · 남의 기록이 이미 통을 채움).
 */
import "./_lib/load-env.mjs";

/* ── import 보다 먼저: 한도 1(이 프로세스만) · 배경 함수 주소 = 로컬 스텁 · 내부 비밀 = 가짜 ── */
process.env.YOUTUBE_DAILY_INSERT_CAP = "1";
process.env.URL = "http://localhost:8888";
process.env.INTERNAL_SECRET = "r19-stub-secret";

type Call = { url: string; method: string; body: string };
const calls: Call[] = [];
const J = (status: number, obj: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...headers } });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = String(init?.method ?? "GET").toUpperCase();
  const b = init?.body;
  const body = b instanceof URLSearchParams ? b.toString() : typeof b === "string" ? b : "";
  calls.push({ url, method, body });
  if (url.startsWith("https://graph.threads.net/")) {
    const path = new URL(url).pathname;
    if (method === "POST" && path.endsWith("/threads")) return J(200, { id: "r19-container-1" });
    if (method === "GET" && url.includes("fields=status")) return J(200, { status: "FINISHED" });
    if (method === "POST" && path.endsWith("/threads_publish")) return J(200, { id: "r19-media-1" });
  }
  if (url.includes("/api/publish-video-background")) return new Response("", { status: 202 });
  return new Response("r19 stub: unexpected", { status: 599 });
}) as typeof fetch;

const { sql } = await import("drizzle-orm");
const { db, pgClient } = await import("../db/index");
const { jsonb, utcDate } = await import("../lib/db-util");
const reuse = await import("../lib/video/reuse");
const { staggerClashes, DERIVED_STAGGER_MIN, DERIVED_SLOT_ORIGIN } = await import("../lib/derived-schedule");
const { publishPieceById } = await import("../lib/publish");
const { videoPublicUrlOf } = await import("../lib/publish/instagram");
const { saveOAuthToken } = await import("../lib/publish/tokens");
const { r2PublicUrl } = await import("../lib/r2");
const yt = await import("../lib/publish/youtube");
const { publishOne } = await import("../lib/publish-one");

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
let fail = 0, pass = 0, unmeasured = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (cond) { pass++; console.log(`  ✅ ${name}${detail ? `  — ${detail}` : ""}`); } else { fail++; console.log(`  🔴 ${name}${detail ? ` — ${detail}` : ""}`); } };
const skip = (name: string, why: string) => { unmeasured++; console.log(`  ⊘ ${name} — ${why}`); };
const kst = (d: Date | null) => d ? new Date(d.getTime() + 9 * 3600_000).toISOString().slice(5, 16).replace("T", " ") : "없음";
const since = (i: number, pred: (c: Call) => boolean) => calls.slice(i).filter(pred).length;
const isThreads = (c: Call) => c.url.startsWith("https://graph.threads.net/");
const isBackground = (c: Call) => c.url.includes("/api/publish-video-background");
const isGoogleUpload = (c: Call) => c.url.startsWith("https://www.googleapis.com/upload/youtube/");

async function seedTenant(key: string, name: string): Promise<number> {
  const [t] = await q(sql`INSERT INTO tenants (key, name, plan_key, status) VALUES (${key.slice(0, 40)}, ${name}, 'pro', 'active') RETURNING id`);
  return n(t?.id);
}
async function seedAccount(tid: number, channel: string, handle: string): Promise<number> {
  /* 워밍업을 끈다 — 새 계정은 이번 주 1건이라 가족 판이 «자리 없음»으로만 끝난다. 여기서 재는 것은 시차·길이다(R18 관례). */
  const [a] = await q(sql`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, daily_cap, min_gap_min, warmup_off)
    VALUES (${tid}, ${channel}, ${handle}, 'oauth', 'active', 3, 180, true) RETURNING id`);
  return n(a?.id);
}

async function main() {
  const stamp = Date.now();
  if (!reuse.VIDEO_REUSE_TARGETS.includes("threads")) {
    console.log("⊘ 못 쟀음 — 이 나무의 `VIDEO_REUSE_TARGETS` 에 threads 가 없다(B R19 §0-C 머지 전). B 를 합친 나무에서 돌린다.");
    await pgClient.end({ timeout: 5 }); process.exit(2);
  }
  if (yt.youtubeDailyCap() !== 1) {
    console.log(`⊘ 못 쟀음 — 한도 env 가 안 먹었다(youtubeDailyCap=${yt.youtubeDailyCap()}) · import 순서를 본다`);
    await pgClient.end({ timeout: 5 }); process.exit(2);
  }
  const [col] = await q(sql`SELECT 1 AS x FROM pg_indexes WHERE tablename = 'audit_logs' AND indexname = 'audit_logs_yt_insert_idx'`);
  if (!col) { console.log("⊘ 못 쟀음 — 라이브에 audit_logs_yt_insert_idx 가 없다(B2 0093 미적용)"); await pgClient.end({ timeout: 5 }); process.exit(2); }

  const tid = await seedTenant(`r19t${stamp}`, "R19 쓰레드 파생 실증");
  const tid2 = await seedTenant(`r19u${stamp}`, "R19 유튜브 통 실증(다른 집)");
  console.log(`\n── R19 쓰레드 파생 · 유튜브 찬 날 — 라이브 한 바퀴 (시드 집 ${tid} · ${tid2}) ──`);
  try {
    const ytAcc = await seedAccount(tid, "youtube_shorts", "yt_r19");
    const thAcc = await seedAccount(tid, "threads", "th_r19");
    await seedAccount(tid, "reels", "rl_r19");
    const key = `autocreate/${tid}/r19t/o1.mp4`;
    const meta = { stage: "done", video: { format: "graphic", seconds: 30 }, render: { scenes: [] }, coinItem: "video_30" };
    const [o] = await q(sql`INSERT INTO pieces (tenant_id, account_id, channel, kind, format, title, body, blocks, meta, status, gate_report, scheduled_for)
      VALUES (${tid}, ${ytAcc}, 'youtube_shorts', 'video', 'story', ${"[R19 실증] 30초 원본"}, ${"설명란 한 줄"}, ${jsonb([])}, ${jsonb(meta)}, 'scheduled',
              ${jsonb({ ok: true, checks: [], rewritten: false })}, NOW() + interval '3 hours') RETURNING id`);
    const o1 = n(o?.id);
    await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, meta, sort) VALUES (${tid}, ${o1}, 'video', ${key}, ${jsonb({ durationMs: 30_000, bytes: 999999 })}, 0)`);

    console.log("\n① 쓰레드 파생이 태어난다(B deriveVideoPieces)");
    const d = await reuse.deriveVideoPieces(tid, o1, { channels: ["threads", "reels"] });
    const thCreated = d.ok ? d.created.find((c) => c.channel === "threads") : undefined;
    ok("threads 파생 created(계정이 붙어 있으면 «준비 중» 채널도 go)", !!thCreated, JSON.stringify(d.ok ? { created: d.created.map((c) => c.channel), skip: d.skip.map((s) => `${s.channel}:${s.why}`) } : d));
    if (!thCreated) throw new Error("threads 파생이 없어 뒤를 잴 수 없다");
    const thId = n(thCreated.pieceId);

    console.log("\n② 시차 편성");
    const fam = await q(sql`SELECT id, channel, status, scheduled_for, slot_id FROM pieces WHERE tenant_id = ${tid} AND (id = ${o1} OR origin_piece_id = ${o1}) ORDER BY id`);
    const times = fam.map((r) => ({ pieceId: n(r.id), channel: String(r.channel), at: utcDate(r.scheduled_for) }));
    console.log(`     ${times.map((x) => `${x.channel} ${kst(x.at)}`).join(" · ")}`);
    const th = fam.find((r) => n(r.id) === thId);
    ok("쓰레드 파생이 시각을 받았다(scheduled · scheduled_for 있음)", th?.status === "scheduled" && !!utcDate(th?.scheduled_for));
    const clashes = staggerClashes(times.filter((x) => x.at).map((x) => ({ pieceId: x.pieceId, at: x.at! })));
    ok(`가족(원본+쓰레드+릴스) 어느 두 시각도 ${DERIVED_STAGGER_MIN}분 안에 안 붙는다`, clashes.length === 0 && times.every((x) => !!x.at), JSON.stringify(clashes));
    const [slot] = await q(sql`SELECT id, origin, status, publish_at, channel FROM slots WHERE tenant_id = ${tid} AND piece_id = ${thId}`);
    ok(`편성표 자리 — origin '${DERIVED_SLOT_ORIGIN}' · channel threads · 자리 시각 = 글 시각 · piece.slot_id 연결`,
      !!slot && slot.origin === DERIVED_SLOT_ORIGIN && slot.channel === "threads" && utcDate(slot.publish_at)?.getTime() === utcDate(th?.scheduled_for)?.getTime() && n(th?.slot_id) === n(slot.id),
      `slot ${n(slot?.id)}`);

    console.log("\n③ 같은 r2_key → 같은 video_url");
    const [ta] = await q(sql`SELECT r2_key FROM piece_assets WHERE tenant_id = ${tid} AND piece_id = ${thId} AND kind = 'video' ORDER BY id DESC LIMIT 1`);
    ok("쓰레드 파생의 video 자산 키 = 원본 키", String(ta?.r2_key ?? "") === key, String(ta?.r2_key ?? "없음"));
    const thUrl = await videoPublicUrlOf(tid, thId), oUrl = await videoPublicUrlOf(tid, o1);
    ok("쓰레드가 받을 video_url = 원본 공개 주소 = r2PublicUrl(원본 키)", !!thUrl && thUrl === oUrl && thUrl === r2PublicUrl(key), String(thUrl));

    console.log("\n④ 발행 — publishThreadsVideo(스텁)");
    await saveOAuthToken(tid, thAcc, { accessToken: "r19-fake-token", externalId: "r19-th-user", handle: "th_r19", extra: { threadsUserId: "r19-th-user" } });
    const c4 = calls.length;
    const r4 = await publishPieceById(tid, thId);
    const posted = calls.slice(c4).find((c) => isThreads(c) && c.method === "POST" && new URL(c.url).pathname.endsWith("/threads"));
    const form = new URLSearchParams(posted?.body ?? "");
    ok("ok · via api · 주소가 쓰레드", r4.ok === true && r4.via === "api" && /threads/.test(String((r4 as { externalUrl?: string }).externalUrl ?? "")), JSON.stringify(r4));
    ok("컨테이너 요청이 영상이다(media_type=VIDEO · 글 길 아님)", form.get("media_type") === "VIDEO", form.get("media_type") ?? "요청 없음");
    ok("요청의 video_url = ③ 의 원본 공개 주소", form.get("video_url") === r2PublicUrl(key), String(form.get("video_url")));
    const [p4] = await q(sql`SELECT status, external_url, channel_ref FROM pieces WHERE id = ${thId}`);
    const [posts4] = await q(sql`SELECT COUNT(*)::int AS c FROM posts WHERE tenant_id = ${tid} AND piece_id = ${thId}`);
    ok("piece published · external_url · posts 1행", p4?.status === "published" && !!p4?.external_url && n(posts4?.c) === 1, `${p4?.status} · posts ${n(posts4?.c)}`);

    console.log("\n⑤ 멱등 — 한 번 더");
    const c5 = calls.length;
    const r5 = await publishPieceById(tid, thId);
    const [posts5] = await q(sql`SELECT COUNT(*)::int AS c FROM posts WHERE tenant_id = ${tid} AND piece_id = ${thId}`);
    ok("already:true", r5.ok === true && (r5 as { already?: boolean }).already === true, JSON.stringify(r5));
    ok("쓰레드로 나간 호출 0 더 · posts 그대로 1행", since(c5, isThreads) === 0 && n(posts5?.c) === 1, `threads 호출 +${since(c5, isThreads)} · posts ${n(posts5?.c)}`);

    console.log("\n⑥ 🔴 유튜브 찬 날(이 프로세스만 한도 1)");
    const before = await yt.insertCallsLast24h();
    if (before >= 1) {
      skip("⑥⑦ 전부", `라이브 통에 이미 최근 24시간 기록 ${before}건(남의 것) — 한도 1 판을 못 만든다`);
    } else {
      ok("시작 — 통이 비어 있다 · full false", !(await yt.youtubeFullNow()).full, `used ${before}`);
      /* 다른 집(tid2)이 한 번 불렀다 — 🔴 집을 가리지 않고 세어야 tid 가 «찼다»를 본다. */
      await yt.noteInsertCall(tid2, 0, "youtube_long");
      const after = await yt.insertCallsLast24h();
      ok("부른 기록 한 줄이 세어진다(noteInsertCall → insertCallsLast24h +1)", after - before === 1, `${before} → ${after}`);
      const room = await yt.youtubeFullNow();
      ok("🔴 다른 집의 호출로 이 집이 «찼다»를 본다(프로젝트 전체 · 집 조건 없음)", room.full === true && room.cap === 1, JSON.stringify(room));

      const [sl] = await q(sql`INSERT INTO slots (tenant_id, rule_id, slot_date, channel, kind, account_id, piece_id, publish_at, status, origin, note)
        VALUES (${tid}, NULL, (NOW() AT TIME ZONE 'Asia/Seoul')::date, 'youtube_shorts', 'shorts', ${ytAcc}, ${o1}, NOW() - interval '1 minute', 'scheduled', 'manual', NULL) RETURNING id`);
      const slotId = n(sl?.id);
      await q(sql`UPDATE pieces SET slot_id = ${slotId}, scheduled_for = NOW() - interval '1 minute' WHERE id = ${o1}`);
      const [row] = await q(sql`SELECT p.id, p.title, p.channel, p.kind, p.account_id, p.slot_id, p.meta, p.scheduled_for, p.body FROM pieces p WHERE p.id = ${o1}`);
      const c6 = calls.length;
      const out = await publishOne(tid, row, { actor: "cron" });
      ok("publishOne → retry · 말 = YOUTUBE_FULL_SAY · 시도 0", out.kind === "retry" && out.error === yt.YOUTUBE_FULL_SAY && out.attempts === 0, JSON.stringify(out));
      ok("🔴 배경 함수를 부르지 않았다", since(c6, isBackground) === 0, `배경 호출 +${since(c6, isBackground)}`);
      const [p6] = await q(sql`SELECT status, meta->'publishAttempts' AS a FROM pieces WHERE id = ${o1}`);
      const [s6] = await q(sql`SELECT status, note FROM slots WHERE id = ${slotId}`);
      ok("piece scheduled 그대로 · publishAttempts 안 늘었다", p6?.status === "scheduled" && (p6?.a === null || p6?.a === undefined), `${p6?.status} · attempts ${String(p6?.a)}`);
      ok("슬롯 note = 찬 날의 말(편성표가 그 줄을 그린다) · 상태 그대로", s6?.note === yt.YOUTUBE_FULL_SAY && s6?.status === "scheduled", `${s6?.status} · ${String(s6?.note)}`);
      ok("찬 날의 말에 숫자 0(다른 집 수를 안 낸다)", !/\d/.test(yt.YOUTUBE_FULL_SAY) && !/\d/.test(yt.YOUTUBE_LIMIT_NOTE));

      /* 발행 직전 문(publishYoutube) — 배경 함수 안에서 사이에 찬 경우. 구글을 안 부르고 · 기록도 안 는다. */
      await saveOAuthToken(tid, ytAcc, { accessToken: "r19-fake-yt", externalId: "r19-yt-ch", handle: "yt_r19" });
      const c6b = calls.length, n6b = await yt.insertCallsLast24h();
      const r6 = await publishPieceById(tid, o1);
      ok("publishYoutube → channel_error · retriable · FULL_SAY · detail «daily_cap project_24h 1/1»",
        !r6.ok && r6.reason === "channel_error" && r6.retriable === true && r6.error === yt.YOUTUBE_FULL_SAY && /^daily_cap project_24h 1\/1/.test(String(r6.detail ?? "")), JSON.stringify(r6));
      ok("구글 업로드 호출 0 · 부른 기록 그대로", since(c6b, isGoogleUpload) === 0 && (await yt.insertCallsLast24h()) === n6b, `google +${since(c6b, isGoogleUpload)}`);

      console.log("\n⑦ 풀린 뒤 — 배경 함수를 부르고 note 를 지운다");
      await q(sql`DELETE FROM audit_logs WHERE tenant_id = ${tid2} AND action = 'youtube.insert_call'`);
      const freed = await yt.youtubeFullNow();
      if (freed.full) skip("⑦", `그 사이 남의 기록이 들어왔다(used ${freed.used})`);
      else {
        const [row7] = await q(sql`SELECT p.id, p.title, p.channel, p.kind, p.account_id, p.slot_id, p.meta, p.scheduled_for, p.body FROM pieces p WHERE p.id = ${o1}`);
        const c7 = calls.length;
        const out7 = await publishOne(tid, row7, { actor: "cron" });
        const [s7] = await q(sql`SELECT status, note FROM slots WHERE id = ${slotId}`);
        ok("queued · 배경 함수 1번(스텁) · 슬롯 publishing · note 지워짐", out7.kind === "queued" && since(c7, isBackground) === 1 && s7?.status === "publishing" && s7?.note === null,
          `${out7.kind} · 배경 +${since(c7, isBackground)} · ${s7?.status} · ${String(s7?.note)}`);
      }
    }

    console.log("\n⑧ 밖으로 나간 호출");
    const odd = calls.filter((c) => !isThreads(c) && !isBackground(c) && !isGoogleUpload(c));
    console.log(`     전체 ${calls.length} · 쓰레드 ${calls.filter(isThreads).length} · 배경 ${calls.filter(isBackground).length} · 유튜브 ${calls.filter(isGoogleUpload).length} · 그 밖 ${odd.length}${odd.length ? ` (${[...new Set(odd.map((c) => new URL(c.url).host))].join(",")})` : ""}`);
    ok("전부 스텁이 받았다(진짜 네트워크 0 — 스텁 밖으로 못 나간다)", true);
  } catch (e) {
    fail++; console.log(`  🔴 중단 — ${String((e as Error)?.message ?? e)}`);
  } finally {
    for (const t of [tid, tid2]) {
      for (const table of ["posts", "runner_jobs", "slots", "piece_assets", "pieces", "account_creds", "accounts", "notifications", "audit_logs", "coin_ledger"]) {
        await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${t}`).catch(() => {});
      }
      await q(sql`DELETE FROM tenants WHERE id = ${t}`).catch(() => {});
    }
    const [left] = await q(sql`SELECT (SELECT COUNT(*)::int FROM tenants WHERE id IN (${tid}, ${tid2})) AS t, (SELECT COUNT(*)::int FROM pieces WHERE tenant_id IN (${tid}, ${tid2})) AS p,
      (SELECT COUNT(*)::int FROM audit_logs WHERE action = 'youtube.insert_call' AND tenant_id IN (${tid}, ${tid2})) AS y`);
    console.log(`\n   (시드 집 ${tid} · ${tid2} 정리 — 남은 tenant ${n(left?.t)} · piece ${n(left?.p)} · 유튜브 부른 기록 ${n(left?.y)})`);
    await pgClient.end({ timeout: 5 });
  }
  console.log(`\n${fail ? "🔴" : unmeasured ? "⊘" : "✅"} R19 쓰레드 파생 · 유튜브 찬 날 — 통과 ${pass} · 실패 ${fail} · 못 잼 ${unmeasured}`);
  process.exit(fail ? 1 : unmeasured ? 2 : 0);
}
main().catch(async (e) => { console.error(e); await pgClient.end({ timeout: 5 }).catch(() => {}); process.exit(2); });
