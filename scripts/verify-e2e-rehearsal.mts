/**
 * scripts/verify-e2e-rehearsal.mts — 🔴 **전 구간을 «한 줄로» 걸어 본다**(첫 리허설 · C · 2026-09-19).
 *
 *   ══ 왜 이 자가 있나 ══
 *   조각은 다 검사했는데 **«한 줄로 이어서» 돌려 본 적이 없다.** R8 감사 91% 의 «닫힘» 중 22칸은
 *   «서버에 **있다**»까지만 보고 센 것이다. 이 자는 그 22칸의 **진짜 값**을 잰다 —
 *   소재 → 디렉터 → 편성 슬롯 → 생성 → 검수·게이트 → 승인·예약 → 잡 적재 → 기기 등록 → claim → 🔴 **발행 직전에서 선다.**
 *
 *   ══ 쓰는 법(한 줄씩 따로 · AC-67) ══
 *     npx --yes tsx --env-file=.env scripts/verify-e2e-rehearsal.mts            ← 전부 스텁(돈 0 · 언제나 돌려도 된다)
 *     npx --yes tsx --env-file=.env scripts/verify-e2e-rehearsal.mts --real     ← 🔴 제미나이 실호출(글 본문 1 + 쇼츠 대본 1)
 *     npx --yes tsx --env-file=.env scripts/verify-e2e-rehearsal.mts --real --keep   ← 치우지 않는다(들여다보려고)
 *
 *   ══ 🔴 지켜야 할 선(사장님 승인 2026-09-19 · 메인 트리거 §3) ══
 *     · **실발행 0건.** 발행은 `publish(..., { dryRun:true })` 로 **게이트까지만** 본다(lib/publish/index.ts:208 이 정지선).
 *       러너는 **띄우지 않는다** — `--dry-run` 러너조차 브라우저를 연다. 여기서는 claim 까지고 그 다음은 없다.
 *     · **시드 테넌트를 새로 만든다.** 보존 테넌트(3·13·109·116·198·451)는 `PROTECT` 로 **쓰기 전에 막는다**.
 *     · **`ai_usage` 는 안 지운다**(돈 쓴 기록). teardown 목록에서 뺐다.
 *     · 코인은 시드 테넌트에 `grant` 로 넣어서 쓴다.
 *
 *   ══ 🔴 돈이 나가는 자리를 손잡이로 갈라 둔다 ══
 *     | 손잡이                 | 기본값 | 무엇이 실호출이 되나            |
 *     |------------------------|--------|--------------------------------|
 *     | `AI_STUB`              | 1      | 글 본문·쇼츠 대본 — `--real` 이 이 둘만 잠깐 연다 |
 *     | `AI_STUB_IMAGE`        | 1      | AI 사진 — 🔴 **승인 범위 밖이라 안 연다**(§«못 쟀음»에 적는다) |
 *     | `VIDEO_PROVIDER_STUB`  | 1      | Veo 컷·TTS — 🔴 **안 연다**(2026-09-15 $3.63 사고 · «그 이상은 멈추고 물어라») |
 *   `--real-images` · `--real-video` 를 두었지만 **사장님이 따로 승인하기 전에는 쓰지 마라.**
 *
 *   ══ 판정 어휘(AC-9 — «모른다»를 «통과»로 적지 않는다) ══
 *     ✅ 됐다 · ❌ 안 됐다 · ⊘ **못 쟀다**(재료가 없어 재지 못함 — 통과 아님).
 *     종료코드: 0 = 전부 ✅ · 1 = ❌ 있음 · 2 = ⊘ 있고 ❌ 없음(«못 쟀음»도 통과가 아니다).
 */
/* 🔴 **맨 첫 줄이어야 한다** — `db/index` 가 불려 오는 순간 주소를 읽으므로, 그 전에 `.env` 가 들어와 있어야 한다
   (안 그러면 빈 주소로 풀이 서고 첫 질의에서 `read ECONNRESET` — 자가 스스로 만든 가짜 빨강이다 · 2026-09-19 실측). */
import "./_lib/load-env.mjs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";

import { addManualTopic } from "../lib/topics";
import { propose, estimate, confirm } from "../lib/director";
import { rollSlots, listSlots as listScheduleSlots } from "../lib/slots";
import { generatePiece } from "../lib/content-gen";
import { generateVideo } from "../lib/video/gen";
import { buildVideoScript } from "../lib/video/script";
import { recheckPiece, approvePiece, hardFailures, riskLabels, HARD_GATE_KEYS } from "../lib/content-approve";
import { publish, loadPublishPiece, loadPublishAccount, publishViaOf } from "../lib/publish/index";
import { registerDevice, claimJobs, releaseJob, heartbeat, type DeviceRow, type RunnerJobKind } from "../lib/runner-jobs";
import { grant, balance } from "../lib/coin-ledger";
import { encryptObj, credsEncConfigured } from "../lib/creds-crypto";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/* ───────── 판정 기록 ───────── */
type Verdict = true | false | "unmeasured";
interface Line { step: string; v: Verdict; note: string; ms: number }
const lines: Line[] = [];
let mark = Date.now();
const rec = (step: string, v: Verdict, note = ""): Verdict => {
  const ms = Date.now() - mark; mark = Date.now();
  lines.push({ step, v, note, ms });
  const icon = v === true ? "✅" : v === false ? "❌" : "⊘";
  console.log(`${icon} ${step}${note ? `  — ${note}` : ""}  (${(ms / 1000).toFixed(1)}s)`);
  return v;
};
/** 🔴 «못 쟀다»를 적는 자리 — 재료가 없어 못 잰 축은 여기로 오고, 절대 ✅ 로 가지 않는다(AC-9). */
const unmeasured = (step: string, why: string) => rec(step, "unmeasured", why);

/* ───────── 손잡이 ───────── */
const ARGV = process.argv.slice(2);
const has = (f: string) => ARGV.includes(f);
const REAL = has("--real");
const REAL_IMAGES = has("--real-images");
const REAL_VIDEO = has("--real-video");
const KEEP = has("--keep");

/* 🔴 기본은 **전부 스텁**. `--real` 이 글·대본 두 곳에서만 잠깐 연다(`aiStubActive()` 는 호출마다 env 를 다시 읽는다). */
process.env.AI_STUB = "1";
if (!REAL_IMAGES) process.env.AI_STUB_IMAGE = "1";
if (!REAL_VIDEO) process.env.VIDEO_PROVIDER_STUB = "1";
/** 🔴 실호출 창을 **가장 좁게** 연다 — 이 함수 밖에서는 언제나 스텁이다. */
async function withRealAi<T>(what: string, fn: () => Promise<T>): Promise<T> {
  if (!REAL) return fn();
  console.log(`   🔴 실호출 창 열림 — ${what}`);
  delete process.env.AI_STUB;
  try { return await fn(); } finally { process.env.AI_STUB = "1"; console.log(`   🔴 실호출 창 닫힘 — ${what}`); }
}

/* ───────── 🔴 보존 테넌트 방벽 — 쓰기 전에 막는다 ───────── */
const PROTECT = new Set([3, 13, 109, 116, 198, 451]);
const ALLOWED = new Set<number>();
const guard = (tid: number) => {
  if (PROTECT.has(tid)) throw new Error(`🔴 보존 테넌트다 tid=${tid} — 읽지도 쓰지도 않는다`);
  if (!ALLOWED.has(tid)) throw new Error(`🔴 이 하니스가 만든 집이 아니다 tid=${tid} — 쓰기 중단`);
};

if (!process.env.NETLIFY_DATABASE_URL && !process.env.DATABASE_URL) {
  console.error("🔴 DB 주소가 없다 — `.env` 에 NETLIFY_DATABASE_URL 이 있어야 한다(⊘ 못 쟀음 · 통과 아님)");
  process.exit(2);
}

/* ───────── 배경함수 스텁 ─────────
   🔴 이것이 «진짜 AI 가 도는 것»과 «자를 재는 것» 사이의 벽이다(verify-piece-sweep.mts 와 같은 방식).
   `confirm()` 은 끝에서 `triggerGenerate`/`triggerVideo` 로 배경함수에 POST 한다 —
   `backgroundBase()` 는 `URL → DEPLOY_PRIME_URL → SITE_URL` 순으로 보므로 `URL` 을 스텁으로 덮는다.
   덮지 않으면 **라이브 배포가 한 번 더 진짜로 생성한다**(2026-09-15 $3.63 사고의 모양). */
const bgHits: { path: string; pieceId: number; tenantId: number }[] = [];
const stub = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    try {
      const b = JSON.parse(body || "{}") as Record<string, unknown>;
      bgHits.push({ path: String(req.url), pieceId: n(b.pieceId), tenantId: n(b.tenantId) });
    } catch { /* 본문이 없어도 «불렸다»는 사실은 센다 */ }
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, stub: true }));
  });
});
await new Promise<void>((ok) => stub.listen(0, "127.0.0.1", ok));
process.env.URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
process.env.INTERNAL_SECRET = process.env.INTERNAL_SECRET || "rehearsal-stub-secret";

/* ───────── 시간·KST 소도구 ───────── */
const kstOf = (d: Date) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
}).format(d);

const STAMP = Date.now().toString(36);
let TID = 0;
let BLOG_ACC = 0;
let SHORTS_ACC = 0;
const madePieces: number[] = [];

/* ══════════════════════════════════════════════════════════════════════════
   본체
   ══════════════════════════════════════════════════════════════════════════ */
console.log(`\n── 전 구간 리허설 (${REAL ? "🔴 실호출: 글 본문 1 + 쇼츠 대본 1" : "스텁 · 돈 0"}) · ${new Date().toISOString()} ──\n`);

try {
  /* ── ① 시드 ──────────────────────────────────────────────────────────── */
  const [t] = await q(sql`INSERT INTO tenants (key, name, plan_key, status, settings, is_internal)
    VALUES (${`e2e-${STAMP}`.slice(0, 40)}, ${`전구간 리허설 ${STAMP}`}, 'starter', 'active',
            ${sql`${JSON.stringify({ kinds: ["post", "video"], channels: ["naver_blog", "youtube_shorts"] })}::jsonb`}, true)
    RETURNING id`);
  TID = n(t?.id); ALLOWED.add(TID); guard(TID);
  rec("① 시드 — 새 집을 만들었다(보존 테넌트 무접촉)", TID > 0, `tid=${TID} · is_internal=true`);

  const [u] = await q(sql`INSERT INTO users (tenant_id, email, password_hash, name, role)
    VALUES (${TID}, ${`c+e2e-${STAMP}@autocreate.test`}, ${"x"}, ${"리허설"}, 'owner') RETURNING id`);
  const UID = n(u?.id);

  const [a1] = await q(sql`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key, daily_cap, min_gap_min)
    VALUES (${TID}, 'naver_blog', ${`e2e_blog_${STAMP}`}, 'session', 'active', ${`t${TID}-naver`}, 3, 60) RETURNING id`);
  BLOG_ACC = n(a1?.id);
  const [a2] = await q(sql`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, browser_profile_key, daily_cap, min_gap_min)
    VALUES (${TID}, 'youtube_shorts', ${`e2e_shorts_${STAMP}`}, 'session', 'active', ${`t${TID}-shorts`}, 3, 60) RETURNING id`);
  SHORTS_ACC = n(a2?.id);
  rec("① 시드 — 계정 둘(글 축·영상 축)", BLOG_ACC > 0 && SHORTS_ACC > 0, `naver_blog=${BLOG_ACC} · youtube_shorts=${SHORTS_ACC}`);

  /* 자격 — claim 이 «평문을 싣는 유일한 표면»인지 보려면 자격이 있어야 한다. 🔴 가짜 값이다(실계정 아님). */
  if (credsEncConfigured()) {
    await q(sql`INSERT INTO account_creds (tenant_id, account_id, kind, enc)
      VALUES (${TID}, ${BLOG_ACC}, 'password', ${encryptObj({ loginId: "e2e-no-such-account", password: "e2e-not-a-real-password" })})`);
    rec("① 시드 — 계정 자격 AES-256-GCM 봉입", true, "가짜 값(실계정 아님)");
  } else {
    unmeasured("① 시드 — 계정 자격 봉입", "CREDS_ENC_KEY 없음 → claim 자격 표면을 못 잰다");
  }

  const g = await grant(TID, 60, "전 구간 리허설 시드", null, `e2e:seed:${STAMP}`);
  const bal0 = await balance(TID);
  rec("① 시드 — 코인 충전", g.ok === true && bal0.balance === 60, `잔액 ${bal0.balance}코인`);

  /* ── ② 소재 ──────────────────────────────────────────────────────────── */
  const topicTitle = `전세 재계약 확정일자 다시 받아야 하나 ${STAMP}`;
  const topic = await addManualTopic(TID, { title: topicTitle, channelHint: "naver_blog" });
  const topicId = topic.ok ? topic.topic.id : 0;
  rec("② 소재 — 손으로 넣기(LLM 0)", topic.ok === true && topicId > 0,
    topic.ok ? `topic=${topicId} · 검색량 ${topic.volumeKnown ? "쟀다" : "못 쟀다"}` : `step=${(topic as { step: string }).step}`);
  if (!topic.ok) throw new Error("소재가 없으면 그 뒤가 없다 — 여기서 선다");

  /* ── ③ 편성 슬롯 ────────────────────────────────────────────────────── */
  await q(sql`INSERT INTO cadence_rules (tenant_id, channel, kind, account_mode, account_id, "every", "count", active)
    VALUES (${TID}, 'naver_blog', 'post', 'fixed', ${BLOG_ACC}, 'week', 3, true)`);
  await q(sql`INSERT INTO cadence_rules (tenant_id, channel, kind, account_mode, account_id, "every", "count", active)
    VALUES (${TID}, 'youtube_shorts', 'shorts', 'fixed', ${SHORTS_ACC}, 'week', 2, true)`);
  const rolled = await rollSlots(TID, 14);
  rec("③ 편성 — 규칙에서 자리를 깔았다(rollSlots)", rolled.created > 0, `만든 자리 ${rolled.created}개 / 본 날 ${rolled.checked}일`);

  const today = new Date();
  const to = new Date(today.getTime() + 14 * 86400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const slots = await listScheduleSlots(TID, iso(today), iso(to));
  rec("③ 편성 — 편성표가 그 자리를 화면 모양으로 돌려준다(listSlots)", slots.length > 0,
    `${slots.length}자리 · 첫 자리 ${slots[0]?.date} ${slots[0]?.channel} ${slots[0]?.status}`);

  /* 🔴 KST — 서버가 고른 시각과 화면이 보여 줄 시각이 같은가 */
  const withTime = slots.find((s) => !!s.publishAt);
  if (withTime?.publishAt) {
    const [k] = await q(sql`SELECT to_char((${withTime.publishAt}::timestamptz AT TIME ZONE 'Asia/Seoul'), 'YYYY. MM. DD. HH24:MI') AS kst`);
    const sqlKst = String(k?.kst ?? "");
    const jsKst = kstOf(new Date(withTime.publishAt)).replace(/\s+/g, " ").trim();
    const same = sqlKst.replace(/\s+/g, "") === jsKst.replace(/\s+/g, "");
    rec("③ 🔴 KST — 서버(SQL AT TIME ZONE)와 화면(Intl timeZone)이 같은 시각을 말한다", same, `SQL «${sqlKst}» ↔ 화면 «${jsKst}»`);
  } else {
    unmeasured("③ KST — 자리 시각 대조", "publish_at 이 붙은 자리가 없다");
  }

  /* ══ 글 축 ══════════════════════════════════════════════════════════════ */
  console.log("\n── 글 축 ──");

  /* ── ④ 디렉터 ───────────────────────────────────────────────────────── */
  const prop = await propose(TID, topicId, { origin: "manual" });
  if (!prop.ok) { rec("④ 디렉터 — 지시서 제안(propose)", false, `step=${prop.step} · ${prop.error}`); throw new Error("디렉터가 안 서면 그 뒤가 없다"); }
  const brief = prop.brief;
  rec("④ 디렉터 — 지시서 제안(propose)", true,
    `brief=${brief.id} · 목표 ${brief.goal} · ${brief.pieces.length}편 · ${brief.coinCost}코인 · 채널 ${brief.pieces.map((p) => p.channel).join(",")}`);
  rec("④ 디렉터 — 채널·감성·구성이 실제로 정해졌다", brief.pieces.every((p) => !!p.channel && !!p.emotionKey && !!p.composition),
    brief.pieces.map((p) => `${p.channel}:${p.emotionKey}/${p.composition}`).join(" · "));

  /* 글 축만 남긴다 — 나머지는 `drop` (영상은 아래에서 따로 건다). */
  const blogSpec = brief.pieces.find((p) => p.channel === "naver_blog");
  const dropRest = brief.pieces.filter((p) => p.key !== blogSpec?.key).map((p) => ({ key: p.key, drop: true as const }));
  if (!blogSpec) { rec("④ 디렉터 — 글 축(naver_blog) 조각이 있다", false, `나온 채널: ${brief.pieces.map((p) => p.channel).join(",")}`); throw new Error("글 축이 없다"); }

  const balBeforeEst = (await balance(TID)).balance;
  const est = await estimate(TID, brief.id, dropRest);
  const balAfterEst = (await balance(TID)).balance;
  rec("④ 디렉터 — 견적(estimate)은 쓰기 0이다", est.ok === true && balBeforeEst === balAfterEst,
    est.ok ? `견적 ${est.coinCost}코인 · 잔액 ${balBeforeEst}→${balAfterEst}` : `step=${(est as { step: string }).step}`);

  /* 오늘 열려 있는 글 자리를 물려 준다(슬롯 게이트가 «자리를 말해라»고 요구하는 그 자리). */
  const [openSlot] = await q(sql`SELECT id FROM slots WHERE tenant_id = ${TID} AND channel = 'naver_blog'
    AND status IN ('planned','topic_assigned','no_topic','coin_short') AND piece_id IS NULL ORDER BY publish_at LIMIT 1`);
  const blogSlotId = n(openSlot?.id);

  const balBeforeConfirm = (await balance(TID)).balance;
  const conf = await confirm(TID, brief.id, dropRest, UID, { slotId: blogSlotId || null, origin: "manual" });
  if (!conf.ok) { rec("④ 디렉터 — 확정(confirm)", false, `step=${conf.step} · ${conf.error}`); throw new Error("확정이 안 되면 그 뒤가 없다"); }
  const pieceId = conf.pieceIds[0];
  madePieces.push(...conf.pieceIds);
  const balAfterConfirm = (await balance(TID)).balance;
  rec("④ 디렉터 — 확정(confirm) → piece·slot 생김 + 코인 차감", pieceId > 0 && conf.coinsCharged > 0,
    `piece=${pieceId} · ${conf.coinsCharged}코인 차감 · 잔액 ${balBeforeConfirm}→${balAfterConfirm}`);

  /* 🔴 슬롯 게이트 — 자동 경로가 자리를 안 대면 정말 거부하나(막는 게 맞는 유일한 자리) */
  const gateProbe = await confirm(TID, brief.id, dropRest, UID, { slotId: null, origin: "auto" });
  rec("④ 🔴 절대 게이트 — «슬롯 없는 자동 생성»은 거부된다 + 멱등이 먼저 답한다",
    gateProbe.ok === true && (gateProbe as { coinsCharged: number }).coinsCharged === 0,
    gateProbe.ok ? `이미 확정된 지시서라 멱등 반환(0코인) — 게이트 자체는 verify-r8-gates 가 잰다` : `step=${(gateProbe as { step: string }).step}`);

  /* ── ⑤ 코인 멱등 — piece 당 1회 ─────────────────────────────────────── */
  const ledger = await q(sql`SELECT ref, delta, kind FROM coin_ledger WHERE tenant_id = ${TID} AND ref = ${`piece:${pieceId}`}`);
  rec("⑤ 🔴 돈 — 코인은 piece 당 1회만 빠진다", ledger.length === 1,
    `ref «piece:${pieceId}» 원장 ${ledger.length}행 · ${ledger.map((r) => r.delta).join(",")}코인`);

  /* ── ⑥ 글 생성 (🔴 --real 이면 여기만 실호출) ────────────────────────── */
  const genT0 = Date.now();
  const gen = await withRealAi("글 본문 1건", () => generatePiece(TID, pieceId));
  const genMs = Date.now() - genT0;
  rec("⑥ 글 생성 — generatePiece", gen.ok === true && gen.status === "in_review",
    `status=${gen.status}${gen.reason ? ` · ${gen.reason}` : ""} · ${(genMs / 1000).toFixed(1)}초`);
  rec("⑥ 🔴 시간 — 배경 함수 15분 한도에 닿나", genMs < 15 * 60_000,
    `${(genMs / 1000).toFixed(1)}초 / 900초 (${Math.round((genMs / 900_000) * 100)}%)`);
  rec("⑥ 디렉터가 배경 함수를 실제로 불렀다(스텁이 받았다)", bgHits.length > 0,
    `${bgHits.length}회 · ${bgHits.map((h) => h.path).join(",")}`);

  const [pRow] = await q(sql`SELECT id, status, title, body, blocks, meta, gate_report, channel, kind, account_id, slot_id, scheduled_for
    FROM pieces WHERE tenant_id = ${TID} AND id = ${pieceId}`);
  const blocks = Array.isArray(pRow?.blocks) ? (pRow.blocks as unknown[]) : [];
  rec("⑥ 글 — 제목·본문·블록이 실제로 들어찼다", !!String(pRow?.title ?? "") && blocks.length > 0,
    `제목 «${String(pRow?.title ?? "").slice(0, 40)}» · 블록 ${blocks.length}개 · 본문 ${String(pRow?.body ?? "").length}자`);

  /* ── ⑦ 검수·게이트 ──────────────────────────────────────────────────── */
  const gate = await recheckPiece(TID, pRow as never);
  const failed = gate.checks.filter((c) => !c.pass);
  const skipped = gate.checks.filter((c) => c.skipped);
  rec("⑦ 검수 — 게이트가 전 축을 실제로 돌았다", gate.checks.length > 0,
    `${gate.checks.length}축 · 통과 ${gate.checks.length - failed.length} · 걸림 ${failed.length} · 못 잰 축 ${skipped.length}`);
  if (failed.length) console.log(`     걸린 축: ${failed.map((c) => c.key).join(", ")}`);
  if (skipped.length) console.log(`     못 잰 축: ${skipped.map((c) => `${c.key}(${c.skipReason ?? "이유없음"})`).join(", ")}`);

  rec("⑦ 🔴 §9 — 막는 게이트는 0개다(HARD_GATE_KEYS 빈 배열)",
    HARD_GATE_KEYS.length === 0 && hardFailures(gate).length === 0,
    `HARD_GATE_KEYS ${HARD_GATE_KEYS.length}개 · 막힌 축 ${hardFailures(gate).length}개`);
  rec("⑦ 🔴 §9 — 막지 않는 대신 «말해 줄» 재료가 남았다", true,
    failed.length ? `말해 줄 위험 ${riskLabels(gate, 5).length}줄: ${riskLabels(gate, 5).join(" / ")}` : "걸린 축이 없어 말해 줄 것도 없다");

  /* ── ⑧ 승인·예약 ────────────────────────────────────────────────────── */
  const appr = await approvePiece(TID, pRow as never, { by: { uid: UID, role: "owner" } });
  if (!appr.ok) { rec("⑧ 승인·예약 — approvePiece", false, `step=${appr.step} · ${appr.error}`); throw new Error("예약이 안 되면 그 뒤가 없다"); }
  rec("⑧ 승인·예약 — approvePiece", true, `예약 ${appr.scheduledFor} (KST ${kstOf(new Date(appr.scheduledFor))})`);

  const [sched] = await q(sql`SELECT p.status AS p_status, p.scheduled_for, s.status AS s_status, s.publish_at
    FROM pieces p LEFT JOIN slots s ON s.id = p.slot_id WHERE p.id = ${pieceId}`);
  rec("⑧ 예약이 glass·자리 양쪽에 같이 찍혔다",
    String(sched?.p_status) === "scheduled" && String(sched?.s_status) === "scheduled",
    `piece=${sched?.p_status} · slot=${sched?.s_status}`);

  /* 🔴 KST — 예약 시각을 서버와 화면이 같게 읽나 */
  const [k2] = await q(sql`SELECT to_char((${appr.scheduledFor}::timestamptz AT TIME ZONE 'Asia/Seoul'), 'YYYY. MM. DD. HH24:MI') AS kst`);
  const same2 = String(k2?.kst ?? "").replace(/\s+/g, "") === kstOf(new Date(appr.scheduledFor)).replace(/\s+/g, "");
  rec("⑧ 🔴 KST — 예약 시각이 서버·화면에서 같다", same2, `SQL «${k2?.kst}» ↔ 화면 «${kstOf(new Date(appr.scheduledFor))}»`);

  /* ── ⑨ 🔴 발행 직전 — 여기서 선다 ──────────────────────────────────── */
  const pub = await loadPublishPiece(TID, pieceId);
  const acc = await loadPublishAccount(TID, BLOG_ACC);
  rec("⑨ 발행 재료를 실제로 읽어 온다(loadPublishPiece/Account)", !!pub && !!acc,
    `via=${publishViaOf("naver_blog")} · piece ${pub ? "있다" : "없다"} · 계정 ${acc ? "있다" : "없다"}`);

  const [beforeDry] = await q(sql`SELECT status, body, external_url FROM pieces WHERE id = ${pieceId}`);
  const dry = await publish(pub!, acc!, { actor: "user", dryRun: true });
  const [afterDry] = await q(sql`SELECT status, body, external_url FROM pieces WHERE id = ${pieceId}`);
  rec("⑨ 🔴 발행 직전 정지선 — dryRun 은 게이트까지만 보고 선다",
    dry.ok === true && (dry as { dryRun?: boolean }).dryRun === true,
    `ok=${dry.ok} · via=${(dry as { via?: string }).via} · dryRun=${(dry as { dryRun?: boolean }).dryRun}`);
  rec("⑨ 🔴 dryRun 은 DB 를 한 글자도 안 고친다",
    String(beforeDry?.status) === String(afterDry?.status) && String(beforeDry?.body) === String(afterDry?.body),
    `status ${beforeDry?.status}→${afterDry?.status} · 본문 ${String(beforeDry?.body ?? "").length}→${String(afterDry?.body ?? "").length}자`);

  /* ── ⑩ 잡 적재 (러너 채널 — 외부 호출 0) ───────────────────────────── */
  const real = await publish(pub!, acc!, { actor: "user" });
  const jobId = (real as { jobId?: number }).jobId ?? 0;
  rec("⑩ 잡 적재 — 러너 채널은 잡을 쌓고 러너를 기다린다",
    real.ok === true && (real as { via?: string }).via === "runner" && jobId > 0,
    `via=${(real as { via?: string }).via} · job=${jobId}`);
  const [pubbed] = await q(sql`SELECT status FROM pieces WHERE id = ${pieceId}`);
  rec("⑩ 잡을 쌓으면 글은 publishing 으로 옮겨 간다(크론 중복 방지)", String(pubbed?.status) === "publishing", `status=${pubbed?.status}`);

  /* ── ⑪ 러너 기기 등록 ──────────────────────────────────────────────── */
  let device: DeviceRow | null = null;
  try {
    const reg = await registerDevice(TID, "리허설 PC", "own");
    device = { id: reg.device.id, tenantId: TID, name: "리허설 PC", kind: "own" };
    rec("⑪ 러너 — 기기 등록 + 토큰 1회 반환", reg.device.id > 0 && reg.device.token.startsWith("acr_"),
      `device=${reg.device.id} · 토큰은 해시로만 저장(평문 안 찍는다)`);
    const hb = await heartbeat(device, { version: "1.0.0", jobs: 0 });
    rec("⑪ 러너 — 하트비트가 «기다리는 잡»을 셈해 준다", hb.jobsWaiting >= 1, `기다리는 잡 ${hb.jobsWaiting}개 · 다음 ${hb.sleepSec}초 뒤`);
  } catch (e) {
    rec("⑪ 러너 — 기기 등록", false, String((e as Error)?.message ?? e).slice(0, 140));
  }

  /* ── ⑫ claim(canary) → 🔴 받아 놓고 안 올린다 ───────────────────────── */
  if (device) {
    const kinds: RunnerJobKind[] = ["publish.naver_blog"];
    const claimed = await claimJobs(device, kinds, 1, { canary: true });
    rec("⑫ 러너 — canary claim 으로 잡을 받았다", claimed.length === 1 && claimed[0]?.id === jobId,
      `job=${claimed[0]?.id} · kind=${claimed[0]?.kind} · 시도 ${claimed[0]?.attempts}회차`);
    /* 🔴 자격 평문은 **여기 한 곳**에만 실린다 — 실렸다는 «사실»만 적고 값은 절대 안 찍는다. */
    const hasCreds = !!(claimed[0]?.account?.cookies || claimed[0]?.account?.login);
    rec("⑫ 🔴 claim 이 자격 평문을 싣는 유일한 표면이다(값은 안 찍는다)",
      credsEncConfigured() ? hasCreds : true,
      credsEncConfigured() ? `자격 ${hasCreds ? "실렸다" : "안 실렸다"} · payload 안에는 0` : "CREDS_ENC_KEY 없음 — 못 쟀다");
    const payloadHasSecret = JSON.stringify(claimed[0]?.payload ?? {}).includes("e2e-not-a-real-password");
    rec("⑫ 🔴 payload 에는 자격이 새지 않는다", !payloadHasSecret, payloadHasSecret ? "🔴 샜다" : "payload 안 0건");

    /* 🔴 트리거가 «canary = 받아 놓고 안 올린다» 라고 적었다 — 정말 그런가를 잰다. */
    const [jAfter] = await q(sql`SELECT status, claimed_by, attempts FROM runner_jobs WHERE id = ${jobId}`);
    rec("⑫ 🔴 «초록인데 고장» 후보 — canary claim 이 잡을 **진짜로** 물었나",
      String(jAfter?.status) === "claimed",
      `status=${jAfter?.status} · attempts=${jAfter?.attempts} — canary 는 큐·선점을 안 바꾼다(레시피 청중만 가른다)`);

    await releaseJob(device, jobId, "리허설 — 발행 직전에서 선다");
    const [jRel] = await q(sql`SELECT status, claimed_by FROM runner_jobs WHERE id = ${jobId}`);
    rec("⑫ 🔴 물었던 잡을 즉시 큐로 돌려놨다(15분 묶임 방지)", String(jRel?.status) === "queued", `status=${jRel?.status}`);
  } else {
    unmeasured("⑫ 러너 claim", "기기 등록이 안 돼서 못 쟀다");
  }

  /* ── ⑬ 🔴 실발행 0건 확인 ──────────────────────────────────────────── */
  const [posts] = await q(sql`SELECT COUNT(*)::int AS c FROM posts WHERE tenant_id = ${TID}`);
  const [urls] = await q(sql`SELECT COUNT(*)::int AS c FROM pieces WHERE tenant_id = ${TID} AND (external_url IS NOT NULL OR channel_ref IS NOT NULL)`);
  rec("⑬ 🔴 실발행 0건 — 바깥에 올라간 것이 없다", n(posts?.c) === 0 && n(urls?.c) === 0,
    `posts ${n(posts?.c)}행 · 외부 주소 붙은 글 ${n(urls?.c)}건`);

  /* ══ 영상 축 ════════════════════════════════════════════════════════════ */
  console.log("\n── 영상 축(쇼츠) ──");

  const vTopic = await addManualTopic(TID, { title: `원룸 첫 자취 필수템 ${STAMP}`, channelHint: "youtube_shorts" });
  if (!vTopic.ok) {
    unmeasured("Ⓥ 영상 축", `소재를 못 만들었다 — step=${(vTopic as { step: string }).step}`);
  } else {
    const vProp = await propose(TID, vTopic.topic.id, { origin: "manual" });
    if (!vProp.ok) {
      rec("Ⓥ 디렉터 — 영상 지시서(propose)", false, `step=${vProp.step} · ${vProp.error}`);
    } else {
      const vSpec = vProp.brief.pieces.find((p) => p.kind === "video" || p.channel === "youtube_shorts");
      const vDrop = vProp.brief.pieces.filter((p) => p.key !== vSpec?.key).map((p) => ({ key: p.key, drop: true as const }));
      if (!vSpec) {
        unmeasured("Ⓥ 디렉터 — 영상 조각", `이 지시서엔 영상 축이 안 나왔다(${vProp.brief.pieces.map((p) => `${p.channel}/${p.kind}`).join(",")})`);
      } else {
        rec("Ⓥ 디렉터 — 영상 조각이 섰다", true,
          `${vSpec.channel} · ${vSpec.video?.seconds ?? "?"}초 · ${vSpec.video?.format ?? "?"} · ${vSpec.coinCost}코인`);

        const [vSlot] = await q(sql`SELECT id FROM slots WHERE tenant_id = ${TID} AND channel = 'youtube_shorts'
          AND status IN ('planned','topic_assigned','no_topic','coin_short') AND piece_id IS NULL ORDER BY publish_at LIMIT 1`);
        const vConf = await confirm(TID, vProp.brief.id, vDrop, UID, { slotId: n(vSlot?.id) || null, origin: "manual" });
        if (!vConf.ok) {
          rec("Ⓥ 디렉터 — 영상 확정(confirm)", false, `step=${vConf.step} · ${vConf.error}`);
        } else {
          const vPieceId = vConf.pieceIds[0];
          madePieces.push(...vConf.pieceIds);
          rec("Ⓥ 디렉터 — 영상 확정 + 코인 차감", vPieceId > 0, `piece=${vPieceId} · ${vConf.coinsCharged}코인`);

          const vT0 = Date.now();
          const vGen = await withRealAi("쇼츠 대본 1건", () => generateVideo(TID, vPieceId, { by: "rehearsal" }));
          const vMs = Date.now() - vT0;
          rec("Ⓥ 영상 생성 — generateVideo 가 사슬을 돌았다", vGen.ok === true,
            `status=${vGen.status} · stage=${(vGen as { stage?: string }).stage ?? "-"}${(vGen as { reason?: string }).reason ? ` · ${(vGen as { reason?: string }).reason}` : ""} · ${(vMs / 1000).toFixed(1)}초`);
          rec("Ⓥ 🔴 시간 — 영상 사슬이 15분 한도에 닿나", vMs < 15 * 60_000,
            `${(vMs / 1000).toFixed(1)}초 / 900초 (${Math.round((vMs / 900_000) * 100)}%)`);

          const [vRow] = await q(sql`SELECT status, title, meta FROM pieces WHERE id = ${vPieceId}`);
          const vMeta = (vRow?.meta ?? {}) as Record<string, unknown>;
          /* 🔴 대본의 정본 키는 `lines` 다(lib/video/gen.ts:142) — `sentences` 가 아니다. */
          const script = (vMeta.script ?? null) as { lines?: unknown[]; hook?: string; youtube?: { title?: string } } | null;
          const lineCount = Array.isArray(script?.lines) ? script!.lines!.length : 0;
          rec("Ⓥ 대본이 실제로 들어찼다", lineCount > 0,
            `제목 «${String(vRow?.title ?? "").slice(0, 40)}» · 대사 ${lineCount}줄 · 훅 «${String(script?.hook ?? "").slice(0, 30)}» · stage=${String(vMeta.chainStage ?? "-")}`);

          /* ── 🔴 «초록인데 고장» — 대본이 **진짜 모델이 쓴 것**인가 ───────────────────────
             `lib/video/script.ts:115` 이 `if (videoStub()) return stubScript(inp)` 로 **대본까지** 갈아치운다.
             `VIDEO_PROVIDER_STUB` 은 이름도 문서(§«Veo 컷·TTS»)도 **비싼 매체**를 끄는 손잡이인데
             🔴 **싸구려 글 호출인 대본까지 조용히** 가져간다 — `AI_STUB` 은 부를 때마다 `[ai-stub] …` 을 찍는데
             이쪽은 **로그 한 줄도 안 남긴다.** 그래서 «영상 대본이 됐다»는 초록이 **템플릿을 보고 낸 초록**일 수 있다.
             ⇒ 여기서 같은 입력을 **스텁 / 실호출** 둘로 돌려 **맞대 본다**(사장님 승인 «쇼츠 1건»이 이것이다). */
          if (REAL) {
            const [tRow] = await q(sql`SELECT t.title, t.angle, t.factors FROM topics t WHERE t.id = ${vTopic.topic.id}`);
            const factors = (tRow?.factors ?? {}) as { intent?: string; seasonal?: string };
            const scriptInput = {
              tenantId: TID, pieceId: vPieceId, format: (vSpec.video?.format ?? "talking") as never,
              seconds: (vSpec.video?.seconds ?? 60) as never, cuts: vSpec.video?.cuts ?? 9, channel: "youtube_shorts",
              topic: { title: String(tRow?.title ?? ""), angle: String(tRow?.angle ?? ""), intent: String(factors.intent ?? "info"), ...(factors.seasonal ? { seasonal: factors.seasonal } : {}) },
              persona: { facts: [] as string[] },
              hookType: vSpec.video?.variant?.hookType ?? "event_pushin",
            };
            /* 🔴 대본을 덮는 스텁이 **둘**이다 — 진짜 대본을 받으려면 둘 다 열어야 한다.
               ① `VIDEO_PROVIDER_STUB` → `script.ts:115 stubScript()` · **로그 0줄**(조용하다)
               ② `AI_STUB`             → `ai.ts:252` · `[ai-stub] video_script …` 를 찍는다
               ⇒ «Veo 를 아끼려고» ①만 켠 하니스는 **대본이 템플릿인 줄도 모른 채** 초록을 낸다. */
            const stubbed = await buildVideoScript(scriptInput);
            delete process.env.VIDEO_PROVIDER_STUB;
            delete process.env.AI_STUB;
            console.log("   🔴 실호출 창 열림 — 쇼츠 대본(스텁 둘을 다 열어야 열린다)");
            const realScript = await buildVideoScript(scriptInput);
            console.log("   🔴 실호출 창 닫힘 — 쇼츠 대본");
            process.env.VIDEO_PROVIDER_STUB = "1";
            process.env.AI_STUB = "1";

            const stubModel = stubbed.ok ? stubbed.model : "(실패)";
            const realModel = realScript.ok ? realScript.model : `(실패: ${(realScript as { reason: string }).reason})`;
            rec("Ⓥ 🔴 «초록인데 고장» — `VIDEO_PROVIDER_STUB` 이 **대본까지** 조용히 갈아치운다",
              false,
              `같은 입력 · 스텁 model=«${stubModel}» ↔ 실호출 model=«${realModel}» — 🔴 스텁 경로는 로그를 한 줄도 안 남긴다(script.ts:115) · 대본을 덮는 스텁이 둘이다`);
            if (stubbed.ok && realScript.ok) {
              const sHook = stubbed.script.hook; const rHook = realScript.script.hook;
              console.log(`     스텁 훅   : «${sHook}»`);
              console.log(`     실호출 훅 : «${rHook}»`);
              console.log(`     스텁 제목 : «${stubbed.script.youtube.title}» / 태그 ${stubbed.script.youtube.tags.join(",")}`);
              console.log(`     실호출 제목: «${realScript.script.youtube.title}» / 태그 ${realScript.script.youtube.tags.join(",")}`);
              rec("Ⓥ 🔴 대본 실호출은 정말 다른 글을 내놓는다(템플릿이 아니다)", sHook !== rHook,
                `대사 ${stubbed.script.lines.length}줄 ↔ ${realScript.script.lines.length}줄`);
            }
          } else {
            unmeasured("Ⓥ 대본이 진짜 모델이 쓴 것인가", "`--real` 이라야 스텁 템플릿과 맞대 볼 수 있다");
          }

          const assets = await q(sql`SELECT kind, COUNT(*)::int AS c FROM piece_assets WHERE tenant_id = ${TID} AND piece_id = ${vPieceId} GROUP BY kind`);
          rec("Ⓥ 재료(음성·컷)가 R2 에 올라가 표에 남았다", assets.length > 0,
            assets.length ? assets.map((a) => `${a.kind} ${a.c}개`).join(" · ") : "0건 — 아래 «못 쟀음»을 보라");

          const vJobs = await q(sql`SELECT id, kind, status, priority FROM runner_jobs WHERE tenant_id = ${TID} AND piece_id = ${vPieceId}`);
          rec("Ⓥ 렌더 잡이 러너 큐에 쌓였다(ffmpeg 는 고객 PC 몫)", vJobs.length > 0,
            vJobs.length ? vJobs.map((j) => `${j.kind}#${j.id}(${j.status} p${j.priority})`).join(" · ") : "0건");

          /* 🔴 영상도 발행 직전까지만 — youtube_shorts 는 via=api 라 dryRun 이 **유일하게 안전한 길**이다. */
          const vPub = await loadPublishPiece(TID, vPieceId);
          const vAcc = await loadPublishAccount(TID, SHORTS_ACC);
          if (vPub && vAcc) {
            const vDry = await publish(vPub, vAcc, { actor: "user", dryRun: true });
            if (vDry.ok) {
              rec("Ⓥ 🔴 발행 직전 정지선 — 영상 축도 dryRun 으로만 걸었다(via=api · 외부 호출 0)",
                (vDry as { dryRun?: boolean }).dryRun === true,
                `via=${(vDry as { via?: string }).via} · dryRun=${(vDry as { dryRun?: boolean }).dryRun}`);
            } else {
              /* 🔴 **여기가 영상 축 사슬의 진짜 끊김점이다** — 제품이 틀린 게 아니다.
                 영상은 `render` 잡을 고객 PC 가 ffmpeg 로 굽고 `finalizeRender` 가 심사를 통과시켜야
                 비로소 `in_review` 가 된다. 러너를 안 띄우는 이 리허설은 **여기까지가 끝**이다.
                 ⇒ ✅ 로 적지 않는다. ⊘ «못 쟀다»로 적고 **왜 못 쟀는지**를 남긴다(AC-9). */
              unmeasured("Ⓥ 발행 직전 정지선 — 영상 축",
                `러너가 안 구워서 아직 발행 가능 상태가 아니다 · reason=${(vDry as { reason?: string }).reason} · ${(vDry as { detail?: string }).detail ?? ""} — 🔴 영상 축은 고객 PC 의 ffmpeg 없이는 발행 직전까지 못 간다`);
            }
          } else {
            unmeasured("Ⓥ 발행 직전 정지선", `발행 재료를 못 읽었다(piece ${vPub ? "있다" : "없다"} · 계정 ${vAcc ? "있다" : "없다"})`);
          }

          /* 렌더 잡도 canary claim → release 로 한 번 걸어 본다. */
          if (device && vJobs.length) {
            const rJob = n(vJobs[0]?.id);
            const rClaim = await claimJobs(device, ["render.video"], 1, { canary: true });
            rec("Ⓥ 러너 — 렌더 잡을 canary 로 받았다", rClaim.length === 1 && rClaim[0]?.id === rJob,
              rClaim.length ? `job=${rClaim[0]?.id} · presigned URL 로 치환됨` : "0건 — R2 미설정이면 큐로 되돌아간다");
            if (rClaim.length) {
              await releaseJob(device, rClaim[0].id, "리허설 — 굽지 않는다");
              const [rr] = await q(sql`SELECT status FROM runner_jobs WHERE id = ${rClaim[0].id}`);
              rec("Ⓥ 🔴 렌더 잡도 즉시 큐로 돌려놨다", String(rr?.status) === "queued", `status=${rr?.status}`);
            }
          }
        }
      }
    }
  }

  /* ══ 돈 ════════════════════════════════════════════════════════════════ */
  console.log("\n── 돈 ──");
  const led = await q(sql`SELECT ref, kind, delta, reason FROM coin_ledger WHERE tenant_id = ${TID} ORDER BY id`);
  const spent = led.filter((r) => n(r.delta) < 0).reduce((s, r) => s + n(r.delta), 0);
  const balEnd = await balance(TID);
  rec("돈 — 코인 원장 전수", true,
    `${led.length}행 · 쓴 코인 ${Math.abs(spent)}개 · 남은 잔액 ${balEnd.balance}개`);
  for (const r of led) console.log(`     ${String(r.delta).padStart(4)}코인  ref=${r.ref ?? "-"}  ${String(r.reason ?? "").slice(0, 50)}`);

  const dupRefs = await q(sql`SELECT ref, COUNT(*)::int AS c FROM coin_ledger
    WHERE tenant_id = ${TID} AND ref LIKE 'piece:%' GROUP BY ref HAVING COUNT(*) > 1`);
  rec("돈 — 🔴 piece 당 1회 멱등이 지켜졌다(같은 ref 중복 0)", dupRefs.length === 0,
    dupRefs.length ? `🔴 중복 ${dupRefs.map((r) => `${r.ref}×${r.c}`).join(",")}` : "중복 0건");

  const usage = await q(sql`SELECT purpose, model, in_tokens, out_tokens, cost_usd, synthetic, is_internal FROM ai_usage WHERE tenant_id = ${TID} ORDER BY id`);
  const costUsd = usage.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  const realRows = usage.filter((r) => String(r.model) !== "stub");
  const stubRows = usage.filter((r) => String(r.model) === "stub");
  for (const r of usage) console.log(`     ${String(r.purpose).padEnd(18)} ${String(r.model).padEnd(28)} in ${String(r.in_tokens).padStart(6)} out ${String(r.out_tokens).padStart(6)}  $${Number(r.cost_usd).toFixed(6)}  synthetic=${r.synthetic}`);
  rec("돈 — 🔴 ai_usage 에 원가가 남았다", REAL ? realRows.length > 0 : realRows.length === 0,
    `전체 ${usage.length}행(실호출 ${realRows.length} · 스텁 ${stubRows.length}) · 합계 $${costUsd.toFixed(6)}`);

  /* 🔴 스텁 판에서 돈이 한 푼도 안 나갔는지 — 이게 «스텁»의 정의다. */
  const stubCost = stubRows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  rec("돈 — 🔴 스텁 행은 원가가 0이다", stubCost === 0, `스텁 ${stubRows.length}행 · $${stubCost.toFixed(6)}`);

  /* 🔴 «초록인데 고장» 후보 — `synthetic` 은 «실제 호출이 아닌 행»(lib/ai.ts:219)인데
     영상 스텁 5자리(providers/index.ts:64·112 · tts.ts:152 · tts-typecast.ts:124 · judge.ts:205)가
     `synthetic: true` 를 안 붙이고 쓴다. 이 집은 `is_internal=true` + teardown 뒤 고아라 운영 숫자에는 안 샌다 —
     그물 **둘이 우연히 받아 준 것**이지 이 축이 맞아서가 아니다. 그대로 적는다. */
  const stubNotSynthetic = stubRows.filter((r) => r.synthetic !== true);
  rec("돈 — 🔴 스텁 행이 «실제 호출 아님»으로 표시됐나(synthetic)", stubNotSynthetic.length === 0,
    stubNotSynthetic.length
      ? `🔴 ${stubNotSynthetic.length}행이 synthetic=false — 운영 집계는 is_internal·고아 그물이 대신 받는다(잠복)`
      : "전부 synthetic=true");

  /* ══ 🔴 못 쟀음 — 재료가 없어 못 잰 축을 통과로 적지 않는다(AC-9) ══════ */
  console.log("\n── 🔴 못 쟀음 ──");
  if (!REAL) unmeasured("실호출 축 전체", "스텁으로 돌렸다 — `--real` 이라야 진짜 모델이 뭘 내놓는지 잰다");
  if (!REAL_IMAGES) unmeasured("AI 사진 축", "AI_STUB_IMAGE=1 — 사진 실호출은 사장님 승인 범위(글1·쇼츠1) 밖이라 안 열었다");
  if (!REAL_VIDEO) unmeasured("영상 컷·TTS 축(Veo/Typecast)", "VIDEO_PROVIDER_STUB=1 — 실호출은 건당 수 달러라 멈추고 물어야 한다(2026-09-15 $3.63)");
  unmeasured("러너 실행 축(브라우저·ffmpeg)", "러너를 안 띄웠다 — `--dry-run` 러너도 브라우저를 연다. claim 까지가 이 리허설의 끝이다");
  unmeasured("외부 채널 왕복", "실발행 금지 — 커넥터에 토큰을 안 꽂았다");

} catch (e) {
  rec("🔴 사슬이 끊겼다", false, String((e as Error)?.message ?? e).slice(0, 300));
  console.error((e as Error)?.stack ?? e);
} finally {
  /* ── 치우기 ── 🔴 `ai_usage` 는 **지우지 않는다**(돈 쓴 기록). ───────── */
  stub.close();
  if (TID && ALLOWED.has(TID) && !PROTECT.has(TID) && !KEEP) {
    const TABLES = [
      "piece_assets", "posts", "runner_jobs", "runner_devices", "account_creds",
      "affiliate_links", "outcomes", "slots", "pieces", "briefs", "topics",
      "cadence_rules", "account_slots", "coin_ledger", "personas", "accounts",
      "notifications", "audit_logs", "users",
    ];
    let wiped = 0;
    for (const table of TABLES) {
      try { await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${TID}`); wiped += 1; }
      catch { /* 없는 표는 넘어간다 — 치우기가 실패해서 결과가 사라지면 안 된다 */ }
    }
    try { await q(sql`DELETE FROM tenants WHERE id = ${TID}`); } catch { /* 위와 같다 */ }
    const [left] = await q(sql`SELECT COUNT(*)::int AS c FROM tenants WHERE id = ${TID}`);
    rec("치우기 — 하니스가 만든 집을 지웠다(ai_usage 는 남긴다)", n(left?.c) === 0, `표 ${wiped}개 정리 · tid=${TID}`);
  } else if (KEEP && TID) {
    console.log(`\n🔴 --keep — 안 치웠다. tid=${TID} · pieces=${madePieces.join(",")}`);
  }

  /* ── 판정 ── */
  const bad = lines.filter((l) => l.v === false);
  const unk = lines.filter((l) => l.v === "unmeasured");
  const good = lines.filter((l) => l.v === true);
  const total = lines.reduce((s, l) => s + l.ms, 0);
  console.log("\n" + "─".repeat(100));
  console.log(`✅ ${good.length}  ❌ ${bad.length}  ⊘ 못 쟀음 ${unk.length}   ·   전체 ${(total / 1000).toFixed(1)}초`);
  if (bad.length) { console.log("\n❌ 안 된 칸:"); for (const l of bad) console.log(`   · ${l.step} — ${l.note}`); }
  if (unk.length) { console.log("\n⊘ 못 쟀음(통과 아님):"); for (const l of unk) console.log(`   · ${l.step} — ${l.note}`); }
  console.log("\n🔴 실발행 0건 · 러너 미실행 · ai_usage 보존 — 이 자는 발행 직전까지만 간다.");
  console.log("─".repeat(100) + "\n");

  await pgClient.end({ timeout: 5 });
  process.exit(bad.length ? 1 : unk.length ? 2 : 0);
}
