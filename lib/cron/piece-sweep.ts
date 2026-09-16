/**
 * lib/cron/piece-sweep.ts — 스텝 `piece.sweep`(5m). **새 Netlify 함수 0** — `cron-tick-5m` 우산의 스텝으로 등록.
 *   🔴 `video-sweep.ts` 의 **글 판**이다(AC-69 — 그 파일이 AM 교훈을 헤더에 적어 놓고도 영상만 만들었다).
 *   같은 처치 · 같은 이름 · 같은 기본값으로 간다(AC-75 — 새 모양을 짓지 않는다).
 *
 *   ══ 왜 필요한가(2026-09-16 · 사장님 신고 «제자리에 머무는 증상» · 라이브 실측) ══
 *   piece 25·40·42 가 `status='generating' · meta.stage='writing'` 인 채 **3,299분(≈55시간)**,
 *   `created_at == updated_at` — 배경 생성 함수가 **한 번도 못 건드렸다**.
 *   호출 실패는 `director.failTrigger` 가, 생성 중 예외는 `content-gen` 의 catch 가 이미 덮는다.
 *   덮이지 않는 자리는 하나다 — **배경 함수가 프로세스째 사라질 때**(15분 한도·크래시). try/catch 가 돌지 못한다.
 *   그때 글은 영원히 `generating` 이고, 종전엔 **줍는 크론이 0개**라 고객이 «다시 만들기»를 누를 때만 살아났다.
 *
 *   ══ 🔴 왜 20분이면 «확실히 죽었다»인가(이 스텝이 안전한 까닭) ══
 *   Netlify background 함수의 **최대 수명이 15분**이다. 그래서 «20분째 아무 갱신이 없다» = **그 글을 붙들고 있는 일꾼이
 *   존재할 수 없다**는 뜻이다(살아 있으면 `setStage` 가 매 단계 `updated_at = NOW()` 를 찍는다 · content-gen:281).
 *   ⇒ 도는 글을 뺏을 위험이 없다. 서버의 `pieces-regenerate` 재점화 기준·화면의 «멈춘 것 같아요»도 **같은 20분**이다.
 *
 *   대상: pieces kind <> 'video' AND status = 'generating' AND updated_at < now() - 20분 (이미 표시한 행은 제외).
 *   판정: 🔴 **①산출물이 이미 있으면 손대지 않고 표시만**(아래 «AM 장부» 주석) → ②`triggerGenerate` 로 다시 건다(상한 `RESUME_MAX`)
 *        → ③상한 초과 → failed + 환급 + 알림 + 슬롯 표시.
 *   🔴 환급은 `refundPieceDetailed` **하나만** 쓴다 — 이미 멱등이다(소비 합 − 기환급 합 = 순액 · `refund:piece:{id}:c{누적}`).
 *      `failTrigger`·`content-gen` 이 먼저 환급했으면 net ≤ 0 이라 **두 번 돌려주지 않는다**.
 *   🔴 막지 않는다(§9) — 상한을 넘겨도 «영원히 만드는 중»으로 두는 대신 `failed` 로 **내려놓고 말해 주는 것**이다.
 *   회차 상한 5건(비용 폭주 0 — 한 편 재시작 = 글값 + 사진값).
 *   🔎 AM 원본: 없음 — `video-sweep.ts`(AC 신규 2026-09-15)의 글 판 · AC 신규 2026-09-16
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../db-util";
import { refundPieceDetailed, refundLine } from "../coin-ledger";
import { triggerGenerate } from "../director";
import { NOOP, type CronStep, type StepOutcome, type TenantCtx } from "./base";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** 한 회차에 손대는 최대 편 수(= video-sweep). */
export const SWEEP_MAX = 5;
/** 이만큼 갱신이 없으면 «일꾼이 없다»(= 배경 함수 수명 15분 < 20분 · video 의 CHAIN_STALE_MIN 과 같은 수). */
export const STALE_MIN = 20;
/** 다시 걸어 보는 횟수 상한(= video 의 CHAIN_RESUME_MAX). 넘으면 정직하게 내려놓는다. */
export const RESUME_MAX = 3;

/* 🔴 고객이 읽는 문장에 칸 이름(`writing`·`images`…)을 넣지 않는다(AC-91). 화면(`pieces.html` STAGES)과 **같은 낱말**이다. */
const STAGE_SAY: Record<string, string> = { writing: "글 쓰는 중", images: "사진 만드는 중", checking: "검사 중" };
const staySay = (s: string): string => STAGE_SAY[s] ?? "글 쓰는 중";

export const pieceSweepStep: CronStep = {
  key: "piece.sweep",
  every: "5m",
  // 사람이 만든 글도 멈추면 주워야 한다 — 자동 편성과 무관(publisher·reap·video.sweep 과 같은 부류).
  needsAutoSchedule: false,
  async run(ctx: TenantCtx): Promise<StepOutcome> {
    const rows = await q(sql`SELECT p.id, p.slot_id, p.meta, p.updated_at,
        (COALESCE(length(btrim(p.body)), 0) > 0) AS has_body,
        EXISTS (SELECT 1 FROM piece_assets a WHERE a.piece_id = p.id) AS has_assets
      FROM pieces p
      WHERE p.tenant_id = ${ctx.tid} AND p.kind <> 'video' AND p.status = 'generating'
        AND p.updated_at < NOW() - (${STALE_MIN} || ' minutes')::interval
        -- 표시는 «영구 제외»가 아니라 «그때 본 것»이다 — 그 뒤에 글이 움직였으면 다시 본다(까닭은 아래 주석).
        AND (p.meta -> 'sweepSkipped' IS NULL OR (p.meta -> 'sweepSkipped' ->> 'at')::timestamptz < p.updated_at)
      ORDER BY p.updated_at LIMIT ${SWEEP_MAX}`);
    if (!rows.length) return NOOP;
    let changed = 0, skipped = 0;
    const detail: Record<string, unknown> = { restarted: 0, failed: 0, hasOutput: 0 };
    for (const r of rows) {
      if (Date.now() > ctx.deadline) { skipped++; continue; }
      const pieceId = n(r.id); const meta = (r.meta ?? {}) as Record<string, unknown>;
      const stage = String(meta.stage ?? "writing");
      const resume = n((meta.sweepResume as { count?: number } | undefined)?.count);
      /* 🔴 [C 가 찾음 · 2026-09-16] 위 WHERE 의 `sweepSkipped` 줄이 왜 «IS NULL» 이 아닌가 —
         표시를 «영영 제외»로 두면 **안전망에 구멍이 난다**: ①산출물 있는 글이 표시돼 빠짐 → ②고객이 «다시 시작» →
         ③그 생성이 또 멎음 ⇒ **다시 걸릴 가능성이 제일 큰 글**이 크론 밖으로 나가고 55시간 증상이 거기서만 되살아난다
         (그리고 아무 검사도 안 빨개진다). ⇒ 표시 **뒤에 글이 움직였으면** 다시 후보로 돌아온다.
         🔴 그래서 아래 표시 UPDATE 는 `updated_at` 을 **일부러 안 올린다** — 올리면 방금 쓴 표시를 스스로 무효로 만든다(자기 꼬리 물기).
         🔴 이 줄은 `netlify/functions/pieces.ts`(B 파일)를 안 건드리고 내 파일 안에서 끝난다(AC-101).
      */
      /* 🔴 [2026-09-16 · AM 장부가 알려 준 구멍] **다시 걸기 전에 «이미 만들어진 것이 있나»를 본다.**
         AM 은 배경 실행 장부(`bg_runs`)로 갈랐더니 멈춘 행 중 흔적이 남은 17건이 **전부 `phase='done'`** 이었다 —
         함수는 **정상 완료**했는데 상태만 안 넘어간 것이다. 그 행은 `created_at == updated_at` 과 **같은 모양으로 위장한다.**
         ⇒ 우리에겐 장부가 없으니 **산출물 존재**가 그 자를 대신한다. 이걸 안 보고 다시 걸면 **①AI 를 또 불러 돈이 두 번 나가고 ②중복 산출물**이 생긴다.
         («도는 글을 뺏지 않는다»는 배경 수명 15분 증명은 맞지만, **이미 끝난 글**은 그 증명이 안 덮는 자리다.)
         🔴 **상태를 대신 넘겨 주지 않는다** — «완료 뒤 누가 넘기는가»를 우리가 아직 모른다. 지금 지어내면 그게 또 다른 사고다(AC-92).
         🔴 **알림도 안 보낸다** — «만들지 못했어요»는 **틀린 말**이다(만들어졌다). 환급도 없다(나간 값에 물건이 있다).
         🔴 그럼 고객은 어떻게 아나 — **화면이 말한다.** `pieces.html` 이 «N분째 멈춘 것 같아요 · 다시 시작»을 띄우고,
            다시 걸지 말지는 **고객이 고른다**(§9 — 우리가 자동으로 돈을 쓰지 않고, 대신 또렷하게 말한다).
         표시만 남기고 SQL 에서 제외한다 — 안 그러면 이 행이 `ORDER BY updated_at LIMIT 5` 맨 앞을 **영영 차지해** 뒤의 진짜 멈춘 글이 굶는다.
         🔴 다만 «영구 제외»는 아니다 — 위 WHERE 가 «표시 뒤에 글이 움직였으면 다시 본다»로 되어 있다.
            그래서 이 UPDATE 는 `updated_at` 을 **올리지 않는다**: 올리면 `at ≈ updated_at` 이 되어 자기가 방금 쓴 표시를 스스로 무효로 만든다. */
      if (r.has_body === true || r.has_assets === true) {
        await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ sweepSkipped: { why: "already_has_output", at: new Date().toISOString(), body: r.has_body === true, assets: r.has_assets === true, stage } })} WHERE id = ${pieceId}`);
        detail.hasOutput = n(detail.hasOutput) + 1; skipped++;
        console.warn(`[piece.sweep] tid=${ctx.tid} piece=${pieceId} stage=${stage} 이미 산출물 있음(body=${r.has_body} assets=${r.has_assets}) — 다시 걸지 않는다`);
        continue;
      }
      if (resume >= RESUME_MAX) {
        const rf = await refundPieceDetailed(ctx.tid, pieceId); const refunded = rf.granted;
        const reason = `글을 만들다 멈춰서 멈춤 처리했어요(마지막 단계: ${staySay(stage)}).`;
        await q(sql`UPDATE pieces SET status = 'failed', meta = meta || ${jsonb({ stage: "failed", failReason: reason, refunded })}, updated_at = NOW() WHERE id = ${pieceId}`);
        if (r.slot_id) await q(sql`UPDATE slots SET status = 'failed', note = ${reason}, updated_at = NOW() WHERE id = ${n(r.slot_id)}`);
        await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${ctx.tid}, ${"piece_failed"}, ${"글을 만들지 못했어요"}, ${`${reason} ${refundLine(rf)}`}, ${"/app/pieces.html?status=failed"})`);
        detail.failed = n(detail.failed) + 1; changed++; continue;
      }
      /* 🔴 **먼저 `updated_at` 을 찍고** 건다 — 이 한 줄이 잠금이다(video 의 `chainLock` 과 같은 몫).
         안 찍으면 5분 뒤 다음 틱이 같은 글을 또 집어 **한 편을 두 번 만든다**(= 돈이 두 배). */
      await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ sweepResume: { count: resume + 1, at: new Date().toISOString() } })}, updated_at = NOW() WHERE id = ${pieceId}`);
      const fired = await triggerGenerate(pieceId, ctx.tid);
      if (fired) { detail.restarted = n(detail.restarted) + 1; changed++; }
      else skipped++;   // 실패해도 `triggerGenerate` 안의 `failTrigger` 가 failed + 환급 + 알림까지 끝냈다(조용한 0건 아님)
      console.warn(`[piece.sweep] tid=${ctx.tid} piece=${pieceId} stage=${stage} 처음부터 ${resume + 1}/${RESUME_MAX} fired=${fired}`);
    }
    return { changed, skipped, detail };
  },
};
