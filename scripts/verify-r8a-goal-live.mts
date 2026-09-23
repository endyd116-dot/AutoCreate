/**
 * scripts/verify-r8a-goal-live.mts — **R8-A §1.1 «수익 목적이 글을 진짜로 바꾸나»**(C · 🔴 **실호출 3편** · 메인 승인 2026-09-15).
 *   `npx tsx --env-file=.env scripts/verify-r8a-goal-live.mts --tid <테스트 테넌트>`
 *
 *   사장님 질문: «같은 네이버라도 수익 목적에 따라 글 구성을 다 달리해야 하나?» → 우리는 «달라집니다» 라고 답했다.
 *   그 답이 참인지 **산출물로** 확인한다. 같은 소재·같은 채널(naver_blog)·같은 format 으로 **수익 목적만** 바꿔 3편을 만든다:
 *     ① goal=adpost(brief) ② goal=affiliate(제휴가 붙은 글) ③ brief=mixed(→ 내 수리로 채널 기본 adpost 로 떨어져야 한다)
 *   ①↔② 는 **달라야** 하고, ①↔③ 은 **같은 규칙**을 받아야 한다(수리가 mixed 를 adpost 로 보냈다는 증거).
 *
 *   🔴 돈이 드는 자리다. 지키는 것:
 *     · AC-53/54 — 이 프로브는 **서버를 안 거친다**(배경 함수 dispatch 0 · `generatePiece` 는 전 구간 in-process).
 *       그래서 «옛 서버와 이야기하는» 사고가 원천적으로 없다. 대신 **디스크의 코드**를 그대로 불러 쓴다(tsx).
 *     · 테스트 테넌트(@autocreate.test)에서만 · 보존 4집 거부 · 만든 행은 끝에서 전부 지운다.
 *     · 🔴 `ai_usage` 는 **지우지 않는다**(쓴 돈은 남아야 한다 · AC-54-③). 실제 금액을 원장에서 읽어 보고한다(추정 금지).
 *     · 예산 가드 — 시작 전 잔액·건수를 읽고, 편당 상한을 넘으면 즉시 멈춘다.
 */
import "./_lib/load-env.mjs";   // [R17-B2] 🔴 맨 위 — 없으면 db/index 가 빈 URL 로 풀을 만들어 `read ECONNRESET` 이라는 **가짜 빨강**을 낸다
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { jsonb } from "../lib/db-util";
import { generatePiece } from "../lib/content-gen";
import { normKey } from "../lib/topics";   // 🔴 norm_key 규칙은 제품에서 가져온다(내가 다시 적으면 규칙이 두 벌이 된다)
import { htmlToPlain } from "../lib/blocks";
import { structurePrint, structureHash } from "../lib/structure-print";
import { maxSimilarity } from "../lib/similarity";
import type { Block } from "../lib/blocks";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const out = (step: string, ok: boolean | "WARN", note: string) => console.log(`RESULT ${JSON.stringify({ step, ok, note })}`);
const N = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const TID = Number(process.argv[process.argv.indexOf("--tid") + 1] || 0);
const KEEP = new Set([3, 13, 109, 116, 198]);
const MAX_USD_TOTAL = 1.0;   // 🔴 3편 예상 $0.3 안팎(B-1 2편 $0.2147). 넘으면 사고다.

const TOPIC = "가을 이불 세탁, 코인빨래방에서 3천 원에 끝낸 방법";
/** 이 글들이 «재방문 유도»(adpost 규칙)를 실제로 말하나 — 말 그대로의 낱말이 아니라 **뜻**으로 센다. */
const REVISIT_RE = /다음\s*(글|편|이야기)|이웃\s*추가|구독|또\s*(올릴|쓸|들려)|다음에는|저장해\s*두|다시\s*찾아/;

async function spend(): Promise<{ usd: number; calls: number }> {
  const [r] = await q(sql`SELECT COALESCE(SUM(cost_usd), 0)::float AS usd, COUNT(*)::int AS calls FROM ai_usage WHERE tenant_id = ${TID}`);
  return { usd: Number(r?.usd ?? 0), calls: N(r?.calls) };
}

async function main() {
  if (!TID || KEEP.has(TID)) { out("프로브 인자", false, `--tid <테스트 테넌트> 필요 · 보존집(${[...KEEP].join(",")})은 거부`); return; }
  const [t] = await q(sql`SELECT (SELECT email FROM users WHERE tenant_id = t.id ORDER BY id LIMIT 1) AS email FROM tenants t WHERE id = ${TID}`);
  if (!String(t?.email ?? "").endsWith("@autocreate.test")) { out("테스트 테넌트 가드", false, `tid ${TID} 은 테스트 집이 아니다(${t?.email})`); return; }

  const before = await spend();
  const made: { topics: number[]; pieces: number[]; briefs: number[] } = { topics: [], pieces: [], briefs: [] };
  try {
    /* 소재 1개 — 세 편이 **같은 소재**를 쓴다(변수는 수익 목적 하나뿐). */
    const [tp] = await q(sql`INSERT INTO topics (tenant_id, title, norm_key, angle, source, status, factors, score)
      VALUES (${TID}, ${TOPIC}, ${normKey(TOPIC)}, ${"직접 해보고 비용·시간을 적는다"}, ${"manual"}, ${"ready"}, ${jsonb({ intent: "informational" })}, ${70}) RETURNING id`);
    const topicId = N(tp?.id); made.topics.push(topicId);

    const mk = async (label: string, briefGoal: string | null, affiliate: boolean) => {
      let briefId: number | null = null;
      if (briefGoal) {
        const [b] = await q(sql`INSERT INTO briefs (tenant_id, topic_id, goal, pieces, reasons, mode, status, coin_cost)
          VALUES (${TID}, ${topicId}, ${briefGoal}, ${jsonb([])}, ${jsonb([])}, ${"reviewed"}, ${"approved"}, ${0}) RETURNING id`);
        briefId = N(b?.id); made.briefs.push(briefId);
      }
      const meta = affiliate ? { affiliate: { provider: "coupang", productQuery: "가을 이불 세탁세제", slot: "mid" } } : {};
      const [p] = await q(sql`INSERT INTO pieces (tenant_id, topic_id, brief_id, channel, kind, format, status, title, meta)
        VALUES (${TID}, ${topicId}, ${briefId}, ${"naver_blog"}, ${"post"}, ${"story"}, ${"generating"}, ${TOPIC}, ${jsonb(meta)}) RETURNING id`);
      const pieceId = N(p?.id); made.pieces.push(pieceId);
      const t0 = Date.now();
      const r = await generatePiece(TID, pieceId);
      const [row] = await q(sql`SELECT body, blocks, meta, title FROM pieces WHERE id = ${pieceId}`);
      const blocks = (Array.isArray(row?.blocks) ? row.blocks : []) as Block[];
      const m = (row?.meta ?? {}) as Row;
      const plain = htmlToPlain(String(row?.body ?? ""));
      return {
        label, pieceId, ok: r.ok, status: r.status, reason: r.reason, ms: Date.now() - t0,
        title: String(row?.title ?? ""), plain, chars: plain.replace(/\s+/g, "").length, blocks,
        goal: String(m.goal ?? ""), goalSource: String(m.goalSource ?? ""), ignored: m.briefGoalIgnored ? String(m.briefGoalIgnored) : null,
        firstBlock: String(blocks[0]?.type ?? ""), ending: String(blocks[blocks.length - 1]?.type ?? ""),
        hash: structureHash(structurePrint(blocks)),
      };
    };

    const a = await mk("① adpost(brief)", "adpost", false);
    /* 🔴 예산 가드 — 한 편 만들고 바로 확인한다. 새는 중이면 두 편째를 안 만든다. */
    const mid = await spend();
    if (mid.usd - before.usd > MAX_USD_TOTAL / 2) {
      out("🔴 예산 가드 — 1편에 상한 절반을 넘겨 중단", false, `1편에 $${(mid.usd - before.usd).toFixed(4)} · 상한 $${MAX_USD_TOTAL}`);
      return;
    }
    const b = await mk("② affiliate(제휴 붙은 글)", null, true);
    const c = await mk("③ brief=mixed(→ 채널 기본으로 떨어져야)", "mixed", false);

    const all = [a, b, c];
    const failed = all.filter((x) => !x.ok);
    out("§1.1 세 편이 실제로 만들어졌다(실호출)", failed.length === 0,
      all.map((x) => `${x.label} piece ${x.pieceId} ${x.ok ? "ok" : `실패(${x.reason})`} ${Math.round(x.ms / 1000)}초 ${x.chars}자`).join(" · "));
    if (failed.length) return;

    /* ── 목적이 실제로 그 값으로 읽혔나(내 수리의 산출물) ── */
    out("🔴 §1.1 목적이 의도대로 읽혔다 — ①adpost(brief) ②affiliate ③mixed→adpost(채널 기본)",
      a.goal === "adpost" && a.goalSource === "brief" && b.goal === "affiliate" && c.goal === "adpost" && c.goalSource === "channel_default" && c.ignored === "mixed",
      all.map((x) => `${x.label}: goal=${x.goal} 출처=${x.goalSource}${x.ignored ? ` 무시=${x.ignored}` : ""}`).join(" · "));

    /* ── 🔴 본론: 글이 **다른가** ── */
    const simAB = maxSimilarity(a.plain, [b.plain]).score;
    const simAC = maxSimilarity(a.plain, [c.plain]).score;
    out("🔴 §1.1 ①adpost 와 ②affiliate 의 **글이 다르다**(같으면 사장님께 드린 답이 거짓이 된다)",
      simAB < 0.6, `본문 겹침 ${simAB.toFixed(3)}(낮을수록 다른 글) · 골격 ${a.hash === b.hash ? "같음" : "다름"}`);

    out("🔴 §1.1 ②affiliate 만 **고지가 첫 블록**이다(법 · §16B)",
      b.firstBlock === "disclosure" && a.firstBlock !== "disclosure" && c.firstBlock !== "disclosure",
      `① 첫 블록 ${a.firstBlock} · ② ${b.firstBlock} · ③ ${c.firstBlock}`);

    const revisit = all.map((x) => ({ l: x.label, hit: REVISIT_RE.test(x.plain) }));
    out("🔴 §1.1 adpost 목적 글은 **다시 오게 하는 유도**가 실제 본문에 있다(그 규칙이 닿았다는 증거)",
      revisit[0].hit && revisit[2].hit, revisit.map((r) => `${r.l} ${r.hit ? "있음" : "없음"}`).join(" · "));

    out("§1.1 ①adpost 와 ③mixed→adpost 는 **같은 규칙**을 받았다(다른 소재가 아니라 같은 목적)",
      a.goal === c.goal, `goal ${a.goal} = ${c.goal} · 본문 겹침 ${simAC.toFixed(3)}(같은 규칙이어도 글은 매번 다르게 나온다)`);

    /* ── 🔴 AC-63 — 블록을 늘린 내 수리가 **실제 글자 수**를 줄이지 않았나(메인 요청) ── */
    const avgChars = Math.round(all.reduce((s, x) => s + x.chars, 0) / all.length);
    const avgBlocks = Math.round(all.reduce((s, x) => s + x.blocks.length, 0) / all.length);
    out("🔴 §1.1 AC-63 — 골격을 늘린 뒤 **실제 글자 수**(추정이 아니라 실측)", avgChars >= 1200 ? true : "WARN",
      `평균 ${avgChars}자 · 평균 블록 ${avgBlocks}개 · 편당 ${all.map((x) => `${x.chars}자/${x.blocks.length}블록`).join(" ")} · naver_blog 하한 1,500자(life 군 1,000)`);

    out("§1.1 끝맺음이 faq 가 아니다(실물 대조 · §1.8 의 실호출판)",
      all.every((x) => x.ending !== "faq"), all.map((x) => `${x.label} 끝=${x.ending}`).join(" · "));

    const after = await spend();
    out("🔴 §1.1 실제로 쓴 돈 — `ai_usage` **원장에서 읽은 값**(추정 아님)", after.usd - before.usd <= MAX_USD_TOTAL,
      `3편에 $${(after.usd - before.usd).toFixed(4)} · 호출 ${after.calls - before.calls}건 · 상한 $${MAX_USD_TOTAL} · 🔴 이 원장 행은 지우지 않는다(AC-54-③)`);
  } finally {
    /* 🔴 만든 행만 지운다. `ai_usage` 는 **지우지 않는다** — 테넌트가 사라져도 «쓴 돈»은 남아야 한다. */
    /* 🔴 자식 표를 먼저 — piece_assets 가 piece 를 잡고 있어 첫 판에서 teardown 이 FK 로 멈췄다(그 바람에 글이 남았다). */
    for (const id of made.pieces) await q(sql`DELETE FROM piece_assets WHERE piece_id = ${id} AND tenant_id = ${TID}`);
    for (const id of made.pieces) await q(sql`DELETE FROM pieces WHERE id = ${id} AND tenant_id = ${TID}`);
    for (const id of made.briefs) await q(sql`DELETE FROM briefs WHERE id = ${id} AND tenant_id = ${TID}`);
    for (const id of made.topics) await q(sql`DELETE FROM topics WHERE id = ${id} AND tenant_id = ${TID}`);
    const [left] = await q(sql`SELECT COUNT(*)::int AS n FROM pieces WHERE tenant_id = ${TID}`);
    const [usage] = await q(sql`SELECT COUNT(*)::int AS n FROM ai_usage WHERE tenant_id = ${TID}`);
    out("프로브 정리(글·브리프·소재만 · ai_usage 는 보존)", N(left) === 0, `남은 글 ${left?.n}편 · ai_usage ${usage?.n}행 **그대로 둔다**`);
    await pgClient.end().catch(() => {});
  }
}
await main();
