/**
 * scripts/verify-piece-sweep.mts — 🔴 **«멈춘 글을 줍는 스텝이 정말 도나» — 스텝을 직접 불러 잰다**(2026-09-16 · fix/piece-sweep).
 *   사용: `npx tsx --env-file=.env scripts/verify-piece-sweep.mts`
 *
 *   ══ «있나»가 아니라 «도나» ══
 *   STEPS 에 줄이 있는 것과 그 줄이 **옳은 행을 집어 옳게 바꾸는 것**은 다른 일이다(AC-100).
 *   그래서 이 자는 `pieceSweepStep.run()` 을 **직접 부르고**, 판정 뒤의 **DB 행을 다시 읽어** 맞춘다.
 *
 *   ══ 🔴 대조군이 본체다 ══
 *   주울 것을 줍는지보다 **안 주워야 할 것을 안 줍는지**가 더 위험하다 — 잘못 주우면 **만드는 중인 글을 죽인다**.
 *     · B = 5분 전에 갱신된 글(도는 중) · D = 영상(`video-sweep` 자리) → 둘 다 **손대면 빨강**.
 *
 *   ══ 🔴 돈이 두 번 나가지 않는가 ══
 *     · C = 7코인 나갔고 아직 환급 전 → 스윕이 7 을 돌려준다.
 *     · E = 7코인 나갔고 **이미 환급됨**(`failTrigger` 가 먼저 돈 경우) → 스윕은 **0** 을 더한다(합 7 · 14 아님).
 *       알림 문장도 «0개 돌려드렸어요»가 아니라 **«빠져나간 코인은 없어요»** 여야 한다(AC-9 · `refundLine`).
 *
 *   ══ 🔴 돈을 한 푼도 안 쓴다 ══
 *   배경 함수 자리에 **스텁**을 세우고 `URL` 을 그리로 돌린다(`backgroundBase()` 가 `process.env.URL` 을 먼저 본다).
 *   스텁은 202 만 돌려주고 아무것도 만들지 않는다 — 진짜 LLM·이미지는 **0회**(끝에 `ai_usage` 로 확인 · AC-53/54 실측 $3.63 의 교훈).
 *
 *   ══ 🔴 왜 스텁이어야 하나(첫 판이 가짜 초록이었다) ══
 *   처음엔 `INTERNAL_SECRET` 을 비워 «호출이 못 붙게» 만들고 쟀다. 그러면 A 도 `failed` 가 되어
 *   **2회차에 남는 `generating` 글이 하나도 없다** — 그래서 «두 번째 회차는 할 일이 없다» 축이
 *   **잠금이 돌아서가 아니라 잴 것이 없어서** 초록이었다. 변이표(`updated_at = NOW()` 제거)가 그걸 잡았다.
 *   ⇒ 스텁이 202 를 주면 A 는 **`generating` 인 채로 남는다.** 그제야 «2회차가 또 집나»가 **진짜 질문**이 된다.
 *   §2 는 반대로 **일부러 무장해제**해서 «트리거가 못 붙으면 조용히 넘어가지 않는다»를 따로 잰다.
 *
 *   ⚠️ 라이브 DB 에 **하니스 전용 테넌트**를 하나 만들고 끝에 지운다(집안 관례 · `verify-p1r5.mjs`).
 *      🔴 자기가 만든 tid 밖은 **한 행도** 건드리지 않는다(ALLOWED 가드 · 끝에 finally 로 정리).
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { db } from "../db/index";
import { sql } from "drizzle-orm";
import { jsonb } from "../lib/db-util";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const out: { step: string; ok: boolean; note: string }[] = [];
const rec = (step: string, ok: boolean, note = "") => { out.push({ step, ok, note }); return ok; };

if (!process.env.NETLIFY_DATABASE_URL && !process.env.DATABASE_URL) {
  console.error("🔴 DB 주소가 없다 — `npx tsx --env-file=.env scripts/verify-piece-sweep.mts` 로 돌려라");
  process.exit(2);
}
/* 🔴 스텁 — 이것이 «진짜 AI 가 도는 것»과 «자를 재는 것» 사이의 유일한 벽이다. 지우지 마라.
   `backgroundBase()` 는 `URL` → `DEPLOY_PRIME_URL` → `SITE_URL` 순으로 본다 ⇒ `URL` 을 스텁으로 덮는다. */
const hits: { pieceId: number; tenantId: number }[] = [];
const stub = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    if (String(req.url).includes("generate-piece-background")) {
      try { const b = JSON.parse(body || "{}"); hits.push({ pieceId: Number(b.pieceId), tenantId: Number(b.tenantId) }); } catch { /* empty */ }
      res.writeHead(202, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, stub: true })); return;
    }
    res.writeHead(404); res.end("");
  });
});
await new Promise<void>((ok) => stub.listen(0, "127.0.0.1", ok));
const STUB_PORT = (stub.address() as AddressInfo).port;
process.env.URL = `http://127.0.0.1:${STUB_PORT}`;
process.env.INTERNAL_SECRET = "harness-stub-secret";

const STAMP = Date.now().toString(36);
const ALLOWED = new Set<number>();
const guard = (tid: number) => { if (!ALLOWED.has(tid)) throw new Error(`🔴 하니스 테넌트가 아니다 tid=${tid} — 쓰기 중단`); };
let TID = 0;

/* ── S0 🔴 «표시 뒤에 움직였나» 한 줄을 **네 시간대에서** 잰다 ──
   그 줄은 `at`(timestamptz)과 `updated_at`(**timestamp without time zone**)을 섞는다. 섞으면 Postgres 가 **세션 TZ 로** 맞춘다.
   ⇒ 세션 TZ 하나로 판정이 뒤집히고, **뒤집히는 방향이 «조용히 제외»**다(구멍이 그대로 다시 열린다).
   🔴 **소스 파일에서 그 줄을 그대로 떼어다** 잰다 — 여기에 베껴 쓰면 원본을 고쳐도 자는 옛 줄을 계속 초록으로 재운다.
   🔴 그리고 세 판을 **다 재야** 한다: 움직인 글(뽑혀야) · 안 움직인 글(안 뽑혀야) · `at` 이 없는 글(뽑혀야 — 모르면 보는 쪽). */
{
  const src = readFileSync(join(ROOT_DIR, "lib", "cron", "piece-sweep.ts"), "utf8");
  const line = (src.split("\n").find((l) => l.includes("p.meta -> 'sweepSkipped' IS NULL")) ?? "").trim();
  const pred = line.replace(/^AND\s*/, "");
  if (!pred.startsWith("(")) rec("S0 소스에서 «표시 뒤 움직였나» 줄을 떼어 냈다", false, `🔴 못 찾았다 — 자를 고쳐라(줄 모양이 바뀌었다): «${line.slice(0, 60)}»`);
  else {
    const CASES = [
      { name: "표시 뒤 **움직인** 글", meta: `{"sweepSkipped":{"at":"2026-09-16T09:00:00Z"}}`, up: "2026-09-16 10:00:00", want: true },
      { name: "표시 뒤 **안 움직인** 글", meta: `{"sweepSkipped":{"at":"2026-09-16T11:00:00Z"}}`, up: "2026-09-16 10:00:00", want: false },
      { name: "표시는 있는데 **`at` 이 없는** 글", meta: `{"sweepSkipped":{}}`, up: "2026-09-16 10:00:00", want: true },
    ];
    const TZS = ["GMT", "Asia/Seoul", "America/New_York", "Pacific/Kiritimati"];
    const bad: string[] = [];
    for (const tz of TZS) {
      const c = postgres(process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL || "", { ssl: "require", max: 1 });
      await c.unsafe(`SET TIME ZONE '${tz}'`);
      for (const k of CASES) {
        const [r] = await c.unsafe(`WITH p AS (SELECT '${k.meta}'::jsonb AS meta, '${k.up}'::timestamp AS updated_at) SELECT ${pred} AS picked FROM p`);
        if (r.picked !== k.want) bad.push(`${tz}/${k.name}=${r.picked}(기대 ${k.want})`);
      }
      await c.end();
    }
    rec("🔴 S0 «표시 뒤 움직였나» 판정이 **네 시간대에서 다 같다**(세션 TZ 기본값에 안 기댄다)", bad.length === 0,
      bad.length ? `🔴 ${bad.join(" · ")}` : `${TZS.join("·")} × 세 판 모두 기대대로`);
    rec("🔴 S0 `at` 이 없으면 **«다시 본다» 쪽으로 넘어진다**(모를 때 막지 않는다 · AC-9)",
      !bad.some((b) => b.includes("at` 이 없는")), bad.filter((b) => b.includes("at")).join(" · ") || "COALESCE 로 epoch 취급");
  }
}

try {
  const [t] = await q(sql`INSERT INTO tenants (key, name, status, plan_key)
    VALUES (${"sweepharness-" + STAMP}, ${"AC 스윕 하니스 " + STAMP}, ${"trial"}, ${"trial"}) RETURNING id`);
  TID = n(t?.id); ALLOWED.add(TID); guard(TID);
  rec("준비: 하니스 테넌트를 만들었다", TID > 0, `tid=${TID}`);

  /** 글 한 편 심기 — `updated_at` 을 과거로 밀어 «몇 분째 조용한지»를 만든다(스윕이 보는 그 칸). */
  const seed = async (o: { kind: string; mins: number; meta: Record<string, unknown>; slot?: boolean; body?: string; asset?: boolean }) => {
    const [p] = await q(sql`INSERT INTO pieces (tenant_id, channel, kind, status, title, body, meta, created_at, updated_at)
      VALUES (${TID}, ${"naver_blog"}, ${o.kind}, ${"generating"}, ${"하니스 " + STAMP}, ${o.body ?? null}, ${jsonb(o.meta)},
              NOW() - (${o.mins} || ' minutes')::interval, NOW() - (${o.mins} || ' minutes')::interval) RETURNING id`);
    const id = n(p?.id);
    if (o.asset) await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key) VALUES (${TID}, ${id}, ${"image"}, ${"harness/" + STAMP + "/" + id + ".webp"})`);
    if (o.slot) {
      const [s] = await q(sql`INSERT INTO slots (tenant_id, slot_date, channel, status) VALUES (${TID}, CURRENT_DATE, ${"naver_blog"}, ${"producing"}) RETURNING id`);
      await q(sql`UPDATE pieces SET slot_id = ${n(s?.id)} WHERE id = ${id}`);
    }
    return id;
  };
  const spend = async (pieceId: number, coins: number) =>
    q(sql`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, ref, reason) VALUES (${TID}, ${"consume"}, ${"included"}, ${-coins}, ${"piece:" + pieceId}, ${"하니스"})`);

  const A = await seed({ kind: "post", mins: 60, meta: { stage: "writing", angle: "갇힌 글" } });                       // 주워야 한다
  const B = await seed({ kind: "post", mins: 5, meta: { stage: "images", angle: "도는 글" } });                         // 🔴 손대면 빨강
  const C = await seed({ kind: "post", mins: 60, meta: { stage: "checking", angle: "상한 초과", sweepResume: { count: 3 } }, slot: true });
  const D = await seed({ kind: "video", mins: 60, meta: { stage: "script", angle: "영상" } });                          // 🔴 손대면 빨강
  const E = await seed({ kind: "post", mins: 60, meta: { stage: "writing", angle: "이미 환급됨", sweepResume: { count: 3 } } });
  /* 🔴 [AM 장부가 알려 준 것] «끝났는데 상태만 안 넘어간 글» — `created_at == updated_at` 과 **같은 모양으로 위장한다**.
     다시 걸면 AI 를 또 불러 **돈이 두 번** 나가고 중복 산출물이 생긴다. 두 모양을 다 심는다: 본문이 있는 것 · 사진만 있는 것. */
  const G = await seed({ kind: "post", mins: 60, meta: { stage: "checking", angle: "끝났는데 상태만" }, body: "<p>이미 다 써 놓은 본문이에요.</p>" });
  const H = await seed({ kind: "post", mins: 60, meta: { stage: "images", angle: "사진까지 만들고 죽음" }, asset: true });
  await spend(C, 7); await spend(E, 7); await spend(G, 7); await spend(H, 7);
  await q(sql`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, ref, reason) VALUES (${TID}, ${"grant"}, ${"included"}, ${7}, ${"refund:piece:" + E + ":c7"}, ${"하니스 · 먼저 환급된 셈"})`);
  rec("준비: 글 7편을 심었다(갇힘·도는중·상한초과·영상·이미환급·본문있음·사진있음)",
    [A, B, C, D, E, G, H].every((x) => x > 0), `A=${A} B=${B} C=${C} D=${D} E=${E} G=${G} H=${H}`);

  const before = await q(sql`SELECT id, updated_at FROM pieces WHERE tenant_id = ${TID}`);
  const upAt = (id: number, rows: Row[]) => String(rows.find((r) => n(r.id) === id)?.updated_at ?? "");

  /* ── 돌린다 ── */
  const { pieceSweepStep } = await import("../lib/cron/piece-sweep");
  const ctx = { tid: TID, key: "sweepharness", planKey: "trial", settings: {}, raw: {}, now: new Date(), deadline: Date.now() + 120_000, manual: true };
  const r1 = await pieceSweepStep.run(ctx as never);
  rec("스텝이 돌았다 — A 재시작 · C·E 종결 · G·H 는 손 안 댐", n(r1.changed) === 3 && n(r1.skipped) === 2,
    `changed=${r1.changed} skipped=${r1.skipped} detail=${JSON.stringify(r1.detail)}`);

  const after = await q(sql`SELECT id, status, slot_id, meta FROM pieces WHERE tenant_id = ${TID}`);
  const upAfter = await q(sql`SELECT id, updated_at FROM pieces WHERE tenant_id = ${TID}`);
  const row = (id: number) => after.find((x) => n(x.id) === id) ?? {};
  const meta = (id: number) => ((row(id).meta ?? {}) as Record<string, unknown>);
  const resumeOf = (id: number) => n((meta(id).sweepResume as { count?: number } | undefined)?.count);

  /* ── A: 집어서 세고 **정말 발사했다** ── */
  rec("🔴 A 를 진짜로 다시 걸었다 — 배경 함수가 그 pieceId 로 호출됐다(«있나»가 아니라 «도나»)",
    hits.length === 1 && hits[0].pieceId === A && hits[0].tenantId === TID, `호출=${JSON.stringify(hits)}`);
  rec("A 재시작 횟수를 1로 세었다", resumeOf(A) === 1, `sweepResume.count=${resumeOf(A)}`);
  rec("A 는 «만드는 중» 그대로다(스윕이 상태를 건드리지 않는다)", String(row(A).status) === "generating", `status=${row(A).status}`);
  /* 🔴 «지금인가»는 **SQL 에 묻는다** — 드라이버가 주는 문자열엔 timezone 이 없어서 `new Date(...)` 로 재면
     로컬 오프셋만큼 어긋난다(첫 판이 여기서 빨갛게 섰다 · CLAUDE §4.5b «timezone 없는 값으로 업무 판정 금지»). */
  const [fresh] = await q(sql`SELECT (updated_at > NOW() - interval '2 minutes') AS now_ish FROM pieces WHERE id = ${A}`);
  rec("🔴 A 의 updated_at 이 지금으로 당겨졌다 — 이 한 줄이 잠금이다",
    fresh?.now_ish === true && upAt(A, before) !== upAt(A, upAfter),
    `SQL «지금이다»=${fresh?.now_ish} · before=${upAt(A, before).slice(0, 19)} after=${upAt(A, upAfter).slice(0, 19)}`);

  /* ── 🔴 이미 만들어진 글은 다시 걸지 않는다(AM 장부가 알려 준 구멍) ── */
  for (const [key, id, what] of [["G", G, "본문이 있는"], ["H", H, "사진이 있는"]] as [string, number, string][]) {
    const sk = (meta(id).sweepSkipped ?? null) as { why?: string } | null;
    rec(`🔴 ${key} ${what} 글은 **다시 걸지 않는다**(AI 두 번 부르지 않는다)`,
      sk?.why === "already_has_output" && String(row(id).status) === "generating" && !meta(id).sweepResume && !hits.some((h) => h.pieceId === id),
      `sweepSkipped=${JSON.stringify(sk)} status=${row(id).status} 배경함수 호출=${hits.filter((h) => h.pieceId === id).length}회`);
    const ref = n((await q(sql`SELECT COALESCE(SUM(delta),0) AS g FROM coin_ledger WHERE tenant_id = ${TID} AND kind = 'grant' AND ref LIKE ${"refund:piece:" + id + "%"}`))[0]?.g);
    rec(`🔴 ${key} 는 환급 0 이다 — 나간 값에 **물건이 있다**`, ref === 0, `환급=${ref}`);
    /* 🔴 표시는 `updated_at` 을 **올리지 않는다.** 올리면 «표시 뒤에 움직였나» 비교가 자기 꼬리를 물어
       20분마다 다시 찍고 다시 빼는 **왕복**이 된다(메인: «그냥 표시를 지운다»로 가지 마라 — 같은 병).
       🔴 이 축이 없을 때 변이표에서 그 변이만 **안 잡혔다** — 주석이 주장만 하고 재지 않던 자리였다. */
    rec(`🔴 ${key} 표시는 updated_at 을 올리지 않는다(왕복 0)`, upAt(id, before) === upAt(id, upAfter),
      `before=${upAt(id, before).slice(0, 19)} after=${upAt(id, upAfter).slice(0, 19)}`);
  }

  /* ── 🔴 대조군: 안 주워야 할 둘 ── */
  rec("🔴 B 도는 글(5분 전 갱신)은 **손대지 않았다**", String(row(B).status) === "generating" && !meta(B).sweepResume && upAt(B, before) === upAt(B, upAfter),
    `status=${row(B).status} sweepResume=${JSON.stringify(meta(B).sweepResume ?? null)} updated_at 그대로=${upAt(B, before) === upAt(B, upAfter)}`);
  rec("🔴 D 영상은 **손대지 않았다**(video-sweep 자리)", String(row(D).status) === "generating" && !meta(D).sweepResume && upAt(D, before) === upAt(D, upAfter),
    `status=${row(D).status} updated_at 그대로=${upAt(D, before) === upAt(D, upAfter)}`);

  /* ── C: 상한 초과 → 내려놓고 말해 준다 ── */
  const [cslot] = await q(sql`SELECT status, note FROM slots WHERE tenant_id = ${TID} AND id = ${n(row(C).slot_id)}`);
  rec("C 상한 초과는 failed 로 내려놓았다", String(row(C).status) === "failed", `status=${row(C).status}`);
  rec("C 사유에 칸 이름(checking)이 안 새고 사람말이다(AC-91)",
    /검사 중/.test(String(meta(C).failReason ?? "")) && !/checking/.test(String(meta(C).failReason ?? "")),
    `«${String(meta(C).failReason ?? "")}»`);
  rec("C 슬롯도 같이 표시됐다", String(cslot?.status) === "failed", `slot=${cslot?.status}`);

  /* ── 🔴 돈: 두 번 돌려주지 않는다 ── */
  const sumRefund = async (pieceId: number) => n((await q(sql`SELECT COALESCE(SUM(delta),0) AS g FROM coin_ledger
    WHERE tenant_id = ${TID} AND kind = 'grant' AND ref LIKE ${"refund:piece:" + pieceId + "%"}`))[0]?.g);
  const cRef = await sumRefund(C), eRef = await sumRefund(E);
  rec("C 7코인을 돌려줬다", cRef === 7, `환급 합=${cRef}`);
  rec("🔴 E 는 이미 환급돼 있어 **더 안 돌려줬다**(7 · 14 아님)", eRef === 7, `환급 합=${eRef}`);

  const notes = await q(sql`SELECT title, body FROM notifications WHERE tenant_id = ${TID} ORDER BY id`);
  const bodyOf = (kw: string) => String(notes.find((x) => String(x.body).includes(kw))?.body ?? "");
  rec("C 알림이 «7개 돌려드렸어요»라고 말한다", /코인 7개는 돌려드렸어요/.test(bodyOf("7개")), `«${bodyOf("7개").slice(0, 60)}»`);
  rec("🔴 E 알림은 «0개 돌려드렸어요»가 아니라 «빠져나간 코인은 없어요»다(AC-9)",
    notes.some((x) => /빠져나간 코인은 없어요/.test(String(x.body))) && !notes.some((x) => /코인 0개/.test(String(x.body))),
    `알림 ${notes.length}건`);
  /* 🔴 알림은 **딱 둘**(C·E)이어야 한다 — G·H 에도 «만들지 못했어요»가 가면 **거짓말**이다(만들어졌다). 수로 못 박는다. */
  rec("🔴 알림은 C·E 둘뿐이다 — 이미 만들어진 G·H 에는 «만들지 못했어요»가 안 간다", notes.length === 2, `알림 ${notes.length}건`);

  /* ── 두 번째 회차: 방금 건 글을 5분 뒤 또 집지 않는다(= 한 편을 두 번 만들지 않는다 = 돈이 두 배가 아니다) ──
     🔴 A 가 아직 `generating` **인 채로 남아 있어야** 이 질문이 성립한다 — 그래서 위에서 스텁으로 202 를 줬다. */
  const r2 = await pieceSweepStep.run(ctx as never);
  const cRef2 = await sumRefund(C), eRef2 = await sumRefund(E);
  rec("🔴 2회차가 A 를 또 집지 않는다(돈이 두 배가 아니다)", n(r2.changed) === 0 && n(r2.skipped) === 0 && hits.length === 1,
    `changed=${r2.changed} skipped=${r2.skipped} 배경함수 호출=${hits.length}회`);
  rec("🔴 두 번 돌려도 환급 합이 안 늘었다", cRef2 === 7 && eRef2 === 7, `C=${cRef2} E=${eRef2}`);

  /* ── 🔴 [C 가 찾은 구멍] 표시는 «영구 제외»가 아니라 «그때 본 것»이다 ──
     ①산출물 있어 표시됨 → ②고객이 «다시 시작» → ③또 멎음 ⇒ 종전 판이면 이 글은 **크론이 영영 안 줍는다**.
     = **다시 걸릴 가능성이 제일 큰 글**이 안전망 밖으로 나간다. 표시 뒤 글이 «움직인» 두 경우를 심어 가른다.
     🔴 앞 장면이 끝난 **뒤에** 심는다 — 앞에 같이 심으면 후보가 7편이라 `LIMIT 5`(SWEEP_MAX)에 걸려
        «자가 못 본 것»과 «스텝이 안 한 것»이 섞인다(그 표는 읽을 수가 없다). */
  const skippedAt = new Date(Date.now() - 90 * 60000).toISOString();
  const I = await seed({ kind: "post", mins: 60, meta: { stage: "checking", angle: "표시 뒤 또 멎음(산출물 남음)", sweepSkipped: { why: "already_has_output", at: skippedAt } }, body: "<p>아직 본문이 있다</p>" });
  const J = await seed({ kind: "post", mins: 60, meta: { stage: "writing", angle: "표시 뒤 또 멎음(이제 빈 글)", sweepSkipped: { why: "already_has_output", at: skippedAt } } });
  const hitsBefore = hits.length;
  const rIJ = await pieceSweepStep.run(ctx as never);
  const ij = await q(sql`SELECT id, status, meta FROM pieces WHERE tenant_id = ${TID} AND id IN (${I}, ${J})`);
  const ijMeta = (id: number) => ((ij.find((x) => n(x.id) === id)?.meta ?? {}) as Record<string, unknown>);
  rec("🔴 J 표시 뒤 움직였고 이제 빈 글 — **안전망으로 돌아온다**(다시 걸린다)",
    hits.some((h) => h.pieceId === J) && n((ijMeta(J).sweepResume as { count?: number } | undefined)?.count) === 1,
    `배경함수 호출=${hits.filter((h) => h.pieceId === J).length}회 sweepResume=${JSON.stringify(ijMeta(J).sweepResume ?? null)}`);
  rec("🔴 I 는 다시 봤지만 **여전히 산출물이 있어** 안 건다(표시 시각만 새로 적는다)",
    !hits.some((h) => h.pieceId === I) && String((ijMeta(I).sweepSkipped as { at?: string } | undefined)?.at ?? "") > skippedAt,
    `배경함수 호출=${hits.filter((h) => h.pieceId === I).length}회 at=${(ijMeta(I).sweepSkipped as { at?: string } | undefined)?.at}`);
  rec("이 장면에서 손댄 것은 I·J 둘뿐이다(앞 장면 글을 다시 집지 않았다)",
    n(rIJ.changed) === 1 && n(rIJ.skipped) === 1 && hits.length === hitsBefore + 1,
    `changed=${rIJ.changed} skipped=${rIJ.skipped} detail=${JSON.stringify(rIJ.detail)}`);

  /* ── §2 무장해제: 트리거가 못 붙는 날에도 «조용한 0건»이 아니다 ── */
  process.env.INTERNAL_SECRET = "";
  const F = await seed({ kind: "post", mins: 60, meta: { stage: "writing", angle: "트리거 못 붙는 글" } });
  /* 🔴 **절대값이 아니라 증가분**으로 잰다 — 앞 장면이 늘 때마다 «호출 총합 N» 단언이 낡아서 빨개진다.
     (실제로 I·J 장면을 넣자 여기가 빨개졌다. 코드가 아니라 자가 틀린 것이었다.) */
  const hitsBeforeF = hits.length;
  const r3 = await pieceSweepStep.run(ctx as never);
  const [fRow] = await q(sql`SELECT status, meta FROM pieces WHERE id = ${F}`);
  const fMeta = (fRow?.meta ?? {}) as Record<string, unknown>;
  rec("§2 트리거가 못 붙자 failed + 사유를 남겼다(조용히 넘어가지 않는다)",
    String(fRow?.status) === "failed" && /INTERNAL_SECRET/.test(String(fMeta.failReason ?? "")) && hits.length === hitsBeforeF,
    `status=${fRow?.status} why=«${String(fMeta.failReason ?? "").slice(0, 36)}» 배경함수 추가호출=${hits.length - hitsBeforeF}회 (r3 changed=${r3.changed})`);

  /* ── 돈을 안 썼다 ── */
  const [usage] = await q(sql`SELECT COUNT(*) AS c FROM ai_usage WHERE tenant_id = ${TID}`);
  rec("🔴 진짜 AI 는 한 번도 안 돌았다(ai_usage 0행)", n(usage?.c) === 0, `ai_usage=${n(usage?.c)}행`);
} catch (e) {
  rec("하니스가 끝까지 돌았다", false, `🔴 ${String((e as Error)?.message ?? e).slice(0, 200)}`);
} finally {
  if (TID && ALLOWED.has(TID)) {
    guard(TID);
    /* 🔴 **자식 표를 먼저** 지운다 — `piece_assets.piece_id` 에 FK 가 있어서 pieces 를 먼저 지우면 23503 으로 튕긴다.
       첫 판이 여기서 죽었고, **죽은 자리가 finally 안이라 나머지 정리가 통째로 안 돌아** 라이브에 하니스 테넌트가 남았다(손으로 치웠다).
       ⇒ 지우는 순서를 고치고, **한 줄이 실패해도 다음 줄은 돌게** 감싼다 — 정리는 «되도록»이 아니라 «반드시»다. */
    const del = async (label: string, s: ReturnType<typeof sql>) => { try { await q(s); } catch (e) { console.error(`[정리] ${label} 실패 — ${String((e as Error)?.message ?? e).slice(0, 80)}`); } };
    await del("piece_assets", sql`DELETE FROM piece_assets WHERE tenant_id = ${TID}`);
    await del("notifications", sql`DELETE FROM notifications WHERE tenant_id = ${TID}`);
    await del("coin_ledger", sql`DELETE FROM coin_ledger WHERE tenant_id = ${TID}`);
    await del("pieces", sql`DELETE FROM pieces WHERE tenant_id = ${TID}`);
    await del("slots", sql`DELETE FROM slots WHERE tenant_id = ${TID}`);
    await del("tenants", sql`DELETE FROM tenants WHERE id = ${TID}`);
    const [left] = await q(sql`SELECT COUNT(*) AS c FROM pieces WHERE tenant_id = ${TID}`);
    const [tleft] = await q(sql`SELECT COUNT(*) AS c FROM tenants WHERE id = ${TID}`);
    const [aleft] = await q(sql`SELECT COUNT(*) AS c FROM piece_assets WHERE tenant_id = ${TID}`);
    rec("정리: 하니스 테넌트를 지웠다(라이브에 흔적 0)", n(left?.c) === 0 && n(tleft?.c) === 0 && n(aleft?.c) === 0,
      `tid=${TID} pieces=${n(left?.c)} assets=${n(aleft?.c)} tenants=${n(tleft?.c)}`);
  }
}

const bad = out.filter((o) => !o.ok);
for (const o of out) console.log(`${o.ok ? "✅" : "🔴"} ${o.step}${o.note ? ` — ${o.note}` : ""}`);
console.log(`\n${out.length - bad.length}/${out.length} 통과`);
process.exit(bad.length ? 1 : 0);
