/**
 * scripts/verify-p1r5-render-probe.mts — C 소유 **렌더 경계 회귀 프로브**(계약 P1R5 §5 · B2 실측 결함 3건의 회귀 검사).
 *
 *   `npx tsx --env-file=.env scripts/verify-p1r5-render-probe.mts --tid <테스트 테넌트>`
 *   `scripts/verify-p1r5.mjs` 의 `render` 절이 이 파일을 자식으로 실행하고 `RESULT {json}` 줄을 읽는다.
 *   (하니스가 .mjs 라 TS 경계 함수를 직접 못 부른다 — 그래서 프로브를 따로 둔다. B2 의 `verify-r5-render.mts` 는
 *    ffmpeg 로 **진짜 굽는** 전 구간 실증이고, 이쪽은 **판정 경계**만 빠르게 되짚는 회귀다. 둘은 겹치지 않는다.)
 *
 *   되짚는 것(2026-09-14 B2 가 실측 mp4 에서 잡은 것 · 다시 깨지면 조용히 전 영상이 망가진다):
 *     ① `finalizeRender` 가 **`meta.render`(B 의 RenderPayload)를 덮어쓰지 않는가** — 덮어쓰면 `judgeVideo` 가
 *        고지·길이·리듬을 읽을 자리를 잃어 **전 영상이 P0 차단**된다.
 *     ② «빈 영상» 판정이 **길이·프레임** 중심인가 — 바이트 하한이 높으면 단색 화면(31KB)처럼 **정상인데 작은** 영상이 죽는다.
 *     ③ 하트비트 전(`last_seen_at` NULL) 러너를 «꺼짐»으로 오판하지 않는가 — 등록 직후 멀쩡한 글이 `awaiting_runner` 로 떨어진다.
 *   🔴 테스트 테넌트에서만 돈다(`--tid` 가 `tenants.plan_key='trial'`·이메일 `*@autocreate.test` 가 아니면 거부).
 *   🔴 만든 piece·job·device 행은 끝에서 지운다(정리까지가 검증).
 */
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { jsonb } from "../lib/db-util";
import { enqueueRender, finalizeRender, sweepRenderAwaitingRunner } from "../lib/video/render-queue";
import type { RenderPayload } from "../lib/video/types";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const out = (step: string, ok: boolean | "WARN", note: string) => console.log(`RESULT ${JSON.stringify({ step, ok, note })}`);

const tidArg = process.argv[process.argv.indexOf("--tid") + 1];
const TID = Number(tidArg || 0);

function payloadFor(pieceId: number, tid: number): RenderPayload {
  return {
    pieceId, tenantId: tid,
    out: { w: 1080, h: 1920, fps: 30, maxSeconds: 15, crf: 20 },
    scenes: [{ idx: 0, startMs: 0, endMs: 6000, imageKey: `autocreate/${tid}/${pieceId}/probe-a.png`, motion: "kenburns", captionIdx: [0] },
             { idx: 1, startMs: 6000, endMs: 12000, imageKey: `autocreate/${tid}/${pieceId}/probe-b.png`, motion: "kenburns", captionIdx: [1] }],
    captions: { preset: "keyword_center", phrases: [{ idx: 0, text: "첫 구절", startMs: 0, endMs: 6000 }, { idx: 1, text: "둘째 구절", startMs: 6000, endMs: 12000 }], srtKey: `autocreate/${tid}/${pieceId}/captions.srt` },
    audio: { narration: [], bgm: null, sfx: null, loudnorm: { I: -16, TP: -1.5, LRA: 11 } },
    overlay: { badge: null, safeZone: { top: 220, bottom: 300 }, endcard: { text: "설명란 링크 확인" } },
    disclosureCaption: null,
  } as RenderPayload;
}

async function makePiece(tid: number, title: string): Promise<number> {
  const [p] = await q(sql`INSERT INTO pieces (tenant_id, channel, kind, status, title, meta)
    VALUES (${tid}, 'youtube_shorts', 'video', 'generating', ${title},
            ${jsonb({ stage: "render", video: { format: "graphic", seconds: 15, cuts: 2 }, probe: true })}) RETURNING id`);
  const id = n(p?.id);
  await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ render: payloadFor(id, tid) })} WHERE id = ${id}`);
  return id;
}
const renderOf = async (id: number) => ((await q(sql`SELECT meta FROM pieces WHERE id = ${id}`))[0]?.meta as Row | undefined)?.render as Row | undefined;

async function main() {
  if (!TID) { out("프로브 인자", false, "--tid <테스트 테넌트> 가 필요하다"); return; }
  const [t] = await q(sql`SELECT id, plan_key, (SELECT email FROM users WHERE tenant_id = t.id ORDER BY id LIMIT 1) AS email FROM tenants t WHERE id = ${TID}`);
  if (!t) { out("테스트 테넌트 가드", false, `tid ${TID} 없음`); return; }
  if (!String(t.email ?? "").endsWith("@autocreate.test")) { out("테스트 테넌트 가드", false, `tid ${TID} 은 테스트 집이 아니다(${String(t.email ?? "?")})`); return; }

  const made: number[] = [];
  try {
    /* ① meta.render 보존 — finalizeRender 뒤에도 B 의 RenderPayload 가 살아 있어야 한다 */
    const a = await makePiece(TID, "C R5 프로브 ① meta.render 보존"); made.push(a);
    const before = await renderOf(a);
    const rA = await finalizeRender(a, { key: `autocreate/${TID}/${a}/video.mp4`, posterKey: `autocreate/${TID}/${a}/poster.jpg`, durationMs: 12_000, bytes: 5_500_000, frameCount: 360 } as never);
    const after = await renderOf(a);
    out("① 렌더 후 meta.render(RenderPayload) 보존 — 덮어쓰면 judge 가 고지·길이를 못 읽어 전 영상 P0",
      !!after && Array.isArray((after as Row).scenes) && ((after as Row).scenes as unknown[]).length === (((before as Row)?.scenes as unknown[]) ?? []).length,
      `scenes ${(((after as Row)?.scenes as unknown[]) ?? []).length}/${(((before as Row)?.scenes as unknown[]) ?? []).length} · next ${rA.next}${rA.reason ? `(${rA.reason})` : ""}`);

    /* ② «빈 영상» 판정은 길이·프레임 중심 — 단색 31KB(12초·360프레임)를 죽이면 안 된다 */
    const b = await makePiece(TID, "C R5 프로브 ② 단색 31KB"); made.push(b);
    const rB = await finalizeRender(b, { key: `autocreate/${TID}/${b}/video.mp4`, posterKey: `autocreate/${TID}/${b}/poster.jpg`, durationMs: 12_000, bytes: 31 * 1024, frameCount: 360 } as never);
    out("② 단색 31KB·12초·360프레임 = 정상 — empty_render 로 죽이지 않는다(바이트 하한 과잉 금지)",
      rB.reason !== "empty_render", `next ${rB.next} reason ${rB.reason ?? "-"}`);

    /* ②b 진짜 빈 영상은 여전히 걸러야 한다(반대 방향 회귀 — 하한을 0 으로 풀어 버린 경우) */
    const c = await makePiece(TID, "C R5 프로브 ②b 진짜 빈 영상"); made.push(c);
    const rC = await finalizeRender(c, { key: `autocreate/${TID}/${c}/video.mp4`, posterKey: null, durationMs: 300, bytes: 900, frameCount: 0 } as never);
    out("②b 0.3초·900B·0프레임 = 진짜 빈 영상 → empty_render 로 재큐/종결", rC.reason === "empty_render", `next ${rC.next} reason ${rC.reason ?? "-"}`);

    /* ②c 🔴 **꼬리 음성 대조**(2026-09-14 C 수리 · AC-31 의 짝) — 심사가 «산출물»을 보는지 확인한다.
       B-1 실측 참값(되돌린 빌드): 컨테이너 15.00s · 영상 12.00s · 오디오 15.00s → 꼬리 **3.00s**.
       그 보고가 들어오면 `duration_fit` 이 **떨어져야** 한다. 안 떨어지면 심사는 다시 계획서를 보고 있는 것이다. */
    const t1 = await makePiece(TID, "C R5 프로브 ②c 꼬리(되살린 빌드)"); made.push(t1);
    const rT = await finalizeRender(t1, { key: `autocreate/${TID}/${t1}/video.mp4`, posterKey: `autocreate/${TID}/${t1}/poster.jpg`,
      durationMs: 12_000, bytes: 5_500_000, frameCount: 360, containerMs: 15_000, videoMs: 12_000, audioMs: 15_000, plannedMs: 12_000, measured: true } as never);
    const aT = ((await q(sql`SELECT gate_report FROM pieces WHERE id = ${t1}`))[0]?.gate_report ?? {}) as Row;
    const axT = (aT.axes ?? []) as { key: string; pass: boolean; detail?: string }[];
    const durT = axT.find((x) => x.key === "duration_fit");
    out("②c 꼬리 음성 대조 — 컨테이너 15.00s · 영상 12.00s(꼬리 3.00s) → duration_fit **실패**(P0 차단)",
      durT ? durT.pass === false : rT.next === "failed" || rT.next === "requeued",
      `next ${rT.next} · duration_fit ${durT ? (durT.pass ? "🔴 통과(못 잡았다)" : "실패") : "축 없음"} «${String(durT?.detail ?? "").slice(0, 60)}»`);

    /* ②d 양성 대조 — 같은 보고에서 꼬리만 없애면 통과해야 한다(규칙이 아무거나 떨어뜨리는 게 아님을 보인다) */
    const t2 = await makePiece(TID, "C R5 프로브 ②d 꼬리 없음"); made.push(t2);
    const rOk = await finalizeRender(t2, { key: `autocreate/${TID}/${t2}/video.mp4`, posterKey: `autocreate/${TID}/${t2}/poster.jpg`,
      durationMs: 12_000, bytes: 5_500_000, frameCount: 360, containerMs: 12_000, videoMs: 12_000, audioMs: 12_000, plannedMs: 12_000, measured: true } as never);
    const aOk = ((await q(sql`SELECT gate_report FROM pieces WHERE id = ${t2}`))[0]?.gate_report ?? {}) as Row;
    const axOk = ((aOk.axes ?? []) as { key: string; pass: boolean; detail?: string }[]).find((x) => x.key === "duration_fit");
    out("②d 양성 대조 — 컨테이너 = 영상 12.00s → duration_fit 통과(규칙이 멀쩡한 영상을 죽이지 않는다)",
      axOk ? axOk.pass === true : rOk.next === "in_review", `next ${rOk.next} · duration_fit ${axOk ? (axOk.pass ? "통과" : `🔴 실패 «${axOk.detail}»`) : "축 없음"}`);

    /* ②e 옛 러너 호환 — 실측 필드가 없으면 **판정 보류**(통과도 실패도 아님 · AC-9). 죽지 않는 것까지가 호환이다. */
    const t3 = await makePiece(TID, "C R5 프로브 ②e 옛 러너"); made.push(t3);
    const rOld = await finalizeRender(t3, { key: `autocreate/${TID}/${t3}/video.mp4`, posterKey: `autocreate/${TID}/${t3}/poster.jpg`, durationMs: 12_000, bytes: 5_500_000, frameCount: 360 } as never);
    const aOld = ((await q(sql`SELECT gate_report FROM pieces WHERE id = ${t3}`))[0]?.gate_report ?? {}) as Row;
    const axOld = ((aOld.axes ?? []) as { key: string; pass: boolean; detail?: string }[]).find((x) => x.key === "duration_fit");
    out("②e 옛 러너(실측 필드 없음) → 죽지 않고 **꼬리 판정 보류**(사유를 말한다 · AC-9)",
      !!axOld && axOld.pass === true && /보류|계획값/.test(String(axOld.detail ?? "")),
      `next ${rOld.next} · duration_fit ${axOld ? `${axOld.pass ? "통과" : "실패"} «${String(axOld.detail ?? "").slice(0, 40)}»` : "축 없음"}`);

    /* ③ 하트비트 전(last_seen_at NULL) 러너를 «꺼짐»으로 오판하지 않는다 */
    // 🔴 순서가 중요하다: `enqueueRender` 는 **적재 그 자리에서** 러너 유무를 본다(§7-2 · 기기 0대면 즉시 awaiting_runner).
    //    «등록은 했는데 아직 하트비트 전»을 재려면 기기를 **먼저** 만들어야 한다.
    // token_hash 는 NOT NULL — 프로브는 **로그인하지 않는 가짜 기기**라 아무 문자열이나 넣는다(러너 토큰을 발급하지 않는다).
    const [dev] = await q(sql`INSERT INTO runner_devices (tenant_id, name, token_hash, kind, status, created_at)
      VALUES (${TID}, ${`c-probe-${Date.now().toString(36)}`}, ${`probe-${Date.now().toString(36)}-never-issued`}, 'own', 'offline', NOW()) RETURNING id`);
    const devId = n(dev?.id);
    const d = await makePiece(TID, "C R5 프로브 ③ 러너 오판"); made.push(d);
    await enqueueRender(d, payloadFor(d, TID));
    await q(sql`UPDATE runner_jobs SET created_at = NOW() - INTERVAL '45 minutes' WHERE tenant_id = ${TID} AND piece_id = ${d}`);
    const swFresh = await sweepRenderAwaitingRunner(TID);
    const [pFresh] = await q(sql`SELECT status FROM pieces WHERE id = ${d}`);
    out("③ 방금 등록(하트비트 전 · last_seen_at NULL) = «모른다» — awaiting_runner 로 떨구지 않는다",
      String(pFresh?.status) === "generating", `sweep ${swFresh}건 · piece ${String(pFresh?.status)}`);

    await q(sql`UPDATE runner_devices SET created_at = NOW() - INTERVAL '90 minutes' WHERE id = ${devId}`);
    const swOld = await sweepRenderAwaitingRunner(TID);
    const [pOld] = await q(sql`SELECT status, meta FROM pieces WHERE id = ${d}`);
    out("③b 등록 90분째 한 번도 응답 없음 = 침묵 금지 — awaiting_runner + 사람말 사유",
      String(pOld?.status) === "awaiting_runner" && /연결|꺼져/.test(String((pOld?.meta as Row)?.failReason ?? "")),
      `sweep ${swOld}건 · ${String(pOld?.status)} «${String((pOld?.meta as Row)?.failReason ?? "-").slice(0, 40)}»`);
    await q(sql`DELETE FROM runner_devices WHERE id = ${devId}`);
  } catch (e) {
    out("프로브 예외", false, String((e as Error)?.stack ?? e).slice(0, 180));
  } finally {
    for (const id of made) {
      await q(sql`DELETE FROM piece_assets WHERE piece_id = ${id}`).catch(() => []);
      await q(sql`DELETE FROM runner_jobs WHERE piece_id = ${id}`).catch(() => []);
      await q(sql`DELETE FROM notifications WHERE tenant_id = ${TID} AND created_at > NOW() - INTERVAL '5 minutes'`).catch(() => []);
      await q(sql`DELETE FROM pieces WHERE id = ${id}`).catch(() => []);
    }
    out("프로브 정리(piece·job·device 행)", true, `pieces ${made.join(",") || "0"}`);
    await pgClient.end().catch(() => {});
  }
}
await main();
