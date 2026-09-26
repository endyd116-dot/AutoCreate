/**
 * scripts/verify-r18-one-video-many.mts — 🔴 **R18 «한 번 만들어 여러 곳에»의 자**(C · 2026-09-26 · 트리거 R18 §7 C).
 *
 *   ══ 무엇을 재나 — 넷(메인이 준 몫) ══
 *     ① 코인은 한 번   — 파생 piece 가 코인 원장에 **0행**인가 · 파생을 만드는 사이 그 집의 차감 행이 **안 늘었나**
 *     ② 같은 분에 N곳 없음 — 한 영상 가족(원본 + 파생)의 예약 시각이 **같은 분**에 둘 이상 없나
 *     ③ `youtube_long` 이 재사용 목록에 없나 — 대상에도 **«빠진 채널»에도** 안 뜬다(트리거 §3 «화면에도 안 띄운다»)
 *     ④ 빠진 채널 문구가 §3 말투인가 — «실패»·«불가»·«오류» 0 · 사실 한 줄 · 어떻게 하면 되는지
 *   판정 자체는 `scripts/_lib/r18-judge.mjs`(순수)에 있다 — 재는 법과 틀리는 방향은 **거기 머리말**에 적었다.
 *
 *   ══ 🔴 제품보다 먼저 섰다 — 그래서 셋을 먼저 찍는다 ══
 *     ⓪ **자기시험** — 판정이 오늘 살아 있나(좋은 재료 초록 · 나쁜 재료가 **그 코드로** 빨강). 깨졌으면 제품을 안 잰다(exit 2).
 *     ⓪ **과녁 세기**(AC-236) — 재려는 이름이 나무에 **몇 곳** 있나. 0 이면 그 축은 ⊘(«못 쟀다»)다. 🔴 **초록이 아니다.**
 *     ⓪ **모수**(AC-114) — 몇 개를 쟀는지 축마다 찍는다. «통과»는 «N개를 재서 통과»로만 말한다.
 *
 *   ══ 쓰는 법(한 줄씩 따로 · AC-67) ══
 *     npx --yes tsx scripts/verify-r18-one-video-many.mts                    ← 순수 팔(DB 0 · 돈 0 · 언제나)
 *     npx --yes tsx scripts/verify-r18-one-video-many.mts --db               ← + 라이브 **읽기 전용**(`BEGIN read only` 안에서 SELECT 만)
 *     npx --yes tsx scripts/verify-r18-one-video-many.mts --rehearse         ← + 🔴 시드 테넌트에 원본 둘을 만들고 파생·편성·멈췄다 깨기까지 **실제로** 돌린 뒤 치운다(돈 0 · 발행 0)
 *
 *   ══ 팔마다 무엇을 보나 ══
 *     순수 팔 : `lib/video/reuse.ts reuseFit()` 을 **원본 채널 × 길이(15·30·60·90) × 연결(전부/없음) × 후보(기본/`youtube_long` 억지로 넣기)**
 *               전수로 돌려 ③④ 를 잰다. + `VIDEO_REUSE_TARGETS` 에 `youtube_long` 이 없나 · 후보마다 상한이 있나.
 *     DB 팔   : `pieces.origin_piece_id IS NOT NULL` 인 파생을 전부 모아 ①(원장 행) ②(가족의 분) ③(나간 채널) 를 잰다.
 *               🔴 **라이브에 파생이 0개면 ⊘ 다**(트리거 §0-b — 영상 채널 여섯이 전부 `planned`). 통과로 안 쓴다.
 *               ⚠️ DB 팔의 ①은 «파생 id 행»만 잰다 — «원본 ref 에 꼬리를 달아 받는» 병은 전후를 알아야 보여서 **리허설 팔**의 몫이다(아래).
 *
 *   ══ 🔴 이 자가 못 하는 것(AC-9 — 비워 두지 않는다) ══
 *     · 화면(A)이 문장을 **제 손으로 다시 지으면** 이 자는 못 본다 — 서버 문장만 잰다.
 *     · ① 의 «전후 차이»는 시드 테넌트에 파생을 실제로 만들어 봐야 안다(리허설 팔 · B 코드가 들어온 뒤 붙인다).
 *     · ② 는 «같은 분»만 판정한다(트리거 글자 그대로). 얼마나 벌렸는지는 `minGap` 으로 **찍기만** 한다.
 *
 *   ══ stdout 의 주인(AC-240) ══  지금 이 자의 stdout 을 먹는 것은 `verify-r18-one-video-many-mutants.mjs` 하나다 —
 *     그 하니스는 **종료코드 + 줄 머리의 `[축 코드]`** 를 읽는다. 줄 머리 모양을 바꾸면 그쪽도 같이 본다.
 *
 *   종료코드: 0 = 전부 ✅ · 1 = ❌ 있음 · 2 = ⊘ 있고 ❌ 없음(«못 쟀음»도 통과가 아니다) — 자기시험이 깨져도 2.
 *   🔴 제품 경로는 **작업 폴더(`cwd`) 기준**이다 — 변이 하니스가 사본 폴더에서 돌린다.
 */
import "./_lib/load-env.mjs";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { codeOnly } from "./_lib/code-only.mjs";
import { selfTest, judgeWords, judgeReuse, judgeCoin, judgeMinutes, FORBIDDEN_REUSE } from "./_lib/r18-judge.mjs";

const ROOT = process.cwd();
const ARGS = new Set(process.argv.slice(2));
const DB = ARGS.has("--db");
const REHEARSE = ARGS.has("--rehearse");

type V = "pass" | "fail" | "unmeasured";
const lines: { v: V; step: string }[] = [];
const icon = (v: V) => (v === "pass" ? "✅" : v === "fail" ? "❌" : "⊘");
const rec = (step: string, v: V, note = "") => { lines.push({ v, step }); console.log(`${icon(v)} ${step}${note ? `  — ${note}` : ""}`); return v; };
/** 판정 결과 한 벌을 찍는다 — 🔴 빨강은 **줄마다 `[축 코드]`** 를 머리에 단다(변이 하니스가 «그 축이 울었나»를 이걸로 본다 · AC-121). */
function report(step: string, r: { verdict: V; measured: number; findings: Record<string, unknown>[]; note?: string; minGapMin?: number | null; untimed?: number }, what: string) {
  const extra = [`${what} ${r.measured}`, r.minGapMin != null ? `가장 가까운 두 곳 ${r.minGapMin}분` : "", r.untimed ? `시각 없음 ${r.untimed}` : "", r.note ?? ""].filter(Boolean).join(" · ");
  rec(step, r.verdict, extra);
  const seen = new Set<string>();
  for (const f of r.findings) {
    const key = `${f.code}|${f.channel ?? ""}|${f.text ?? f.why ?? ""}`;
    if (seen.has(key)) continue; seen.add(key);
    console.log(`     [${f.axis} ${f.code}] ${[f.source ? `원본 ${f.source}` : "", f.seconds ? `${f.seconds}초` : "", f.channel ? `→ ${f.channel}` : "", f.reason && f.reason !== "too_long" ? `(${f.reason})` : ""].filter(Boolean).join(" ")} — ${f.why}${f.text ? `  «${f.text}»` : ""}`);
  }
}

console.log(`\n── R18 한 번 만들어 여러 곳에 — 자 · ${new Date().toISOString()} · ${DB ? "순수 + DB 읽기" : "순수"} ──\n`);

/* ═══ ⓪ 자기시험 ═══ */
{
  const st = selfTest();
  const bad = st.lines.filter((l) => !l.ok);
  rec(`⓪ 자기시험 — 판정 넷이 오늘 살아 있나(양팔 ${st.lines.length}칸)`, st.ok ? "pass" : "unmeasured",
    st.ok ? "좋은 재료 초록 · 나쁜 재료는 그 코드로 빨강" : `🔴 자가 고장 ${bad.length}칸 — 제품을 재지 않는다: ${bad.map((l) => `${l.name} → ${l.got}`).join(" | ")}`);
  if (!st.ok) process.exit(2);
}

/* ═══ ⓪ 과녁 세기(AC-236) — 이름이 나무에 **정의로** 몇 곳 있나 ═══ */
const TARGETS = {
  reuse: { file: "lib/video/reuse.ts", names: ["reuseFit", "VIDEO_REUSE_TARGETS", "deriveVideoPieces"], who: "B" },
  table: { file: "lib/writing-contracts.ts", names: ["VIDEO_CHANNEL_MAX_SEC"], who: "B" },
  registry: { file: "lib/channel-registry.ts", names: ["VIDEO_CHANNEL_KEYS"], who: "—" },
  schedule: { file: "lib/derived-schedule.ts", names: ["scheduleDerived", "staggerDerived", "DERIVED_STAGGER_MIN"], who: "B2" },
} as const;
const alive: Record<string, number> = {};
{
  const got: string[] = [];
  for (const t of Object.values(TARGETS)) {
    const p = path.join(ROOT, t.file);
    const src = existsSync(p) ? codeOnly(readFileSync(p, "utf8")) : "";
    for (const n of t.names) {
      const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let)\\s+${n}\\b`, "g");
      alive[n] = (src.match(re) ?? []).length;
      got.push(`${n} ${alive[n]}`);
    }
  }
  const zero = Object.entries(alive).filter(([, c]) => c === 0).map(([n]) => n);
  rec("⓪ 과녁 — 재려는 이름이 나무에 정의로 있나", zero.length ? "unmeasured" : "pass", `${got.join(" · ")}${zero.length ? ` — 🔴 0곳: ${zero.join(", ")} (그 축은 ⊘)` : ""}`);
}

/* ═══ 순수 팔 — ③ ④ ═══ */
const VIDEO_SECONDS = [15, 30, 60, 90];
let MAX: Record<string, number> = {};
const maxOf = (c: string) => MAX[c] ?? null;
if (alive.reuseFit && alive.VIDEO_REUSE_TARGETS && alive.VIDEO_CHANNEL_MAX_SEC) {
  const imp = (f: string) => import(pathToFileURL(path.join(ROOT, f)).href);
  const reuse = await imp(TARGETS.reuse.file);
  const wc = await imp(TARGETS.table.file);
  const reg = alive.VIDEO_CHANNEL_KEYS ? await imp(TARGETS.registry.file) : { VIDEO_CHANNEL_KEYS: [] };
  MAX = { ...(wc.VIDEO_CHANNEL_MAX_SEC as Record<string, number>) };
  const cands: string[] = [...(reuse.VIDEO_REUSE_TARGETS as string[])];

  /* ③ 목록 자체 */
  const inList = cands.filter((c) => FORBIDDEN_REUSE.includes(c));
  rec("③ `VIDEO_REUSE_TARGETS` 에 `youtube_long` 이 없다", inList.length ? "fail" : "pass", `후보 ${cands.length}: ${cands.join(" · ")}${inList.length ? ` — [③ forbidden_target] 🔴 ${inList.join(",")}` : ""}`);
  const noMax = cands.filter((c) => !(Number(MAX[c]) > 0));
  rec("③ 후보마다 채널 상한이 있다(없으면 판정 자체가 안 된다 · 트리거 §2)", noMax.length ? "fail" : "pass", noMax.length ? `[③ no_spec] 🔴 상한 없음: ${noMax.join(",")}` : `후보 ${cands.length}개 전부 · ${cands.map((c) => `${c} ${MAX[c]}`).join(" · ")}`);

  /* ③ ④ 전수 — 원본 × 길이 × 연결 × 후보 */
  const every = [...new Set([...cands, ...(reg.VIDEO_CHANNEL_KEYS as string[]), ...FORBIDDEN_REUSE])];
  const rows: Parameters<typeof judgeReuse>[0] = [];
  const words: Parameters<typeof judgeWords>[0] = [];
  const wordSeen = new Set<string>();
  let calls = 0, threw = 0, forcedOk = 0;
  const threwAt: string[] = [];
  /* 🔴 B 계약 v1(2026-09-26): `channels` 는 **필수 배열** · `connected` 는 **`{채널: boolean}`**(배열 아님 · 안 주면 길이만 잰다).
     배열로 넘기면 `connected[channel]` 이 늘 undefined 라 «전부 연결»을 «전부 미연결»로 잰다 — 자가 제 손으로 만드는 가짜 빨강(AC-236). */
  const allOn = Object.fromEntries(every.map((c) => [c, true]));
  const CONNECTED: (Record<string, boolean> | undefined)[] = [undefined, allOn, {}];
  const CHANNELS: string[][] = [cands, every];   // 기본 후보 · `youtube_long` 을 억지로 넣은 것
  for (const origin of cands) for (const seconds of VIDEO_SECONDS) for (const connected of CONNECTED) for (const channels of CHANNELS) {
    let r: { seconds?: number; go?: { channel: string }[]; skip?: { channel: string; why?: string; line?: string; how?: string }[] };
    try { r = reuse.reuseFit({ originChannel: origin, seconds, channels, connected }); calls++; if (channels.some((c) => FORBIDDEN_REUSE.includes(c))) forcedOk++; }
    catch (e) { threw++; if (threwAt.length < 3) threwAt.push(`${origin}/${seconds}: ${String((e as Error)?.message ?? e).slice(0, 80)}`); continue; }
    const secs = Number(r?.seconds) > 0 ? Number(r.seconds) : seconds;
    rows.push({ source: origin, seconds: secs, targets: (r?.go ?? []).map((g) => g.channel), skipped: (r?.skip ?? []).map((s) => ({ channel: s.channel, why: s.why, line: s.line, how: s.how })) });
    for (const s of r?.skip ?? []) {
      const key = `${s.channel}|${secs}|${s.why}|${s.line}|${s.how}`;
      if (wordSeen.has(key)) continue; wordSeen.add(key);
      words.push({ channel: s.channel, seconds: secs, max: maxOf(s.channel), why: s.why, line: s.line ?? "", how: s.how ?? "" });
    }
  }
  if (threw) rec("③④ `reuseFit` 이 던지지 않는다", "fail", `[③ threw] ${threw}/${calls + threw}번 던졌다 — ${threwAt.join(" | ")}`);
  report("③ 재사용 목록 — `youtube_long` 어디에도 없음 · 원본 채널 안 뜸 · 길이대로 가고 빠짐(결정 ②)", judgeReuse(rows, { maxOf }), `호출(원본 ${cands.length} × 길이 ${VIDEO_SECONDS.length} × 연결 ${CONNECTED.length} × 후보 ${CHANNELS.length})`);
  /* 과녁이 살아 있나 — «억지로 넣은 youtube_long» 판이 실제로 돌았나(안 돌았으면 ③ 의 초록은 아무것도 안 잰 것이다) */
  rec("③ 과녁 — `youtube_long` 을 후보에 억지로 넣은 호출이 실제로 돌았다", forcedOk ? "pass" : "unmeasured", forcedOk ? `${forcedOk}번` : "🔴 0번 — ③ 의 초록은 아무것도 안 잰 것");
  const reasons = [...new Set(words.map((w) => w.why ?? "too_long"))];
  report("④ 빠진 채널 문구 — §3 말투(금칙 0 · 사실 한 줄 · 어떻게)", judgeWords(words), `서로 다른 문장(사유: ${reasons.join("·") || "없음"})`);
  if (!words.some((w) => (w.why ?? "too_long") === "too_long")) rec("④ 길이로 빠진 문장이 한 번은 나왔다(과녁이 살아 있나)", "unmeasured", "🔴 전수를 돌렸는데 «길이 때문에 빠짐»이 0번 — ④의 사실·어떻게 판정이 한 번도 안 돌았다");
} else {
  rec("③ 재사용 목록", "unmeasured", `과녁 없음 — ${TARGETS.reuse.file} 의 reuseFit/VIDEO_REUSE_TARGETS (B)`);
  rec("④ 빠진 채널 문구", "unmeasured", `과녁 없음 — ${TARGETS.reuse.file} reuseFit().skip[].line/how (B)`);
}

/* ═══ DB 팔 — 라이브 **읽기 전용** ①②③ ═══ */
if (!DB) {
  rec("①② DB 팔", "unmeasured", "`--db` 없이 돌렸다 — 코인 원장·가족의 분은 데이터가 있어야 잰다");
} else {
  const { pgClient } = await import(pathToFileURL(path.join(ROOT, "db/index.ts")).href);
  try {
    await pgClient.begin("read only", async (sql: typeof pgClient) => {
      const [col] = await sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pieces' AND column_name = 'origin_piece_id'`;
      if (!col?.n) { rec("①②③ DB 팔 — 과녁 칸 `pieces.origin_piece_id`", "unmeasured", "과녁 없음 — 라이브에 칸이 아직 없다(DDL 0088 · B)"); return; }
      const derived = await sql`SELECT id, tenant_id, origin_piece_id, channel, status, to_char(COALESCE(published_at, scheduled_for), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at FROM pieces WHERE origin_piece_id IS NOT NULL ORDER BY id`;
      rec("⓪ DB 모수 — 라이브의 파생 piece", derived.length ? "pass" : "unmeasured", derived.length ? `${derived.length}개 · 집 ${new Set(derived.map((d) => d.tenant_id)).size}곳` : "🔴 0개 — 아래 ①②③ 은 ⊘(트리거 §0-b · 영상 채널이 아직 전부 planned)");
      if (!derived.length) {
        rec("① 코인 — 파생의 원장 0행(DB)", "unmeasured", "표본 0");
        rec("② 같은 분에 N곳 없음(DB)", "unmeasured", "표본 0");
        rec("③ 나간 채널에 youtube_long 없음(DB)", "unmeasured", "표본 0");
        return;
      }
      const originIds = [...new Set(derived.map((d) => Number(d.origin_piece_id)))];
      const origins = await sql`SELECT id, tenant_id, channel, to_char(COALESCE(published_at, scheduled_for), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at, (meta->'video'->>'seconds') AS secs FROM pieces WHERE id = ANY(${originIds})`;
      const oById = new Map(origins.map((o) => [Number(o.id), o]));
      const tids = [...new Set(derived.map((d) => Number(d.tenant_id)))];
      const ledger = await sql`SELECT tenant_id, kind, ref, delta FROM coin_ledger WHERE kind = 'consume' AND tenant_id = ANY(${tids}) AND ref LIKE 'piece:%'`;

      /* ① 집마다 */
      const coin = { verdict: "pass" as V, measured: 0, findings: [] as Record<string, unknown>[], note: "" };
      for (const tid of tids) {
        const r = judgeCoin({ derivedIds: derived.filter((d) => Number(d.tenant_id) === tid).map((d) => Number(d.id)), ledger: ledger.filter((l) => Number(l.tenant_id) === tid) });
        coin.measured += r.measured; coin.findings.push(...r.findings); coin.note = r.note ?? "";
      }
      coin.verdict = coin.findings.length ? "fail" : "pass";
      report("① 코인 — 파생 piece 가 원장에 0행(DB)", coin, "파생");

      /* ② 가족 — 원본 + 파생 · 나갔으면 나간 시각, 아니면 예약 시각 */
      const at = (r: Record<string, unknown>) => (r.at ?? null) as string | null;   // SQL 이 UTC 문자열로 준다(to_char)
      const fams = originIds.map((oid) => {
        const o = oById.get(oid);
        const kids = derived.filter((d) => Number(d.origin_piece_id) === oid);
        return { originId: oid, members: [...(o ? [{ pieceId: oid, channel: String(o.channel), at: at(o) }] : []), ...kids.map((d) => ({ pieceId: Number(d.id), channel: String(d.channel), at: at(d) }))] };
      });
      report("② 같은 분에 N곳 없음(DB · 원본+파생 가족)", judgeMinutes(fams), "가족");

      /* ③ 나간/잡힌 채널 */
      const rows = originIds.map((oid) => {
        const o = oById.get(oid);
        return { source: String(o?.channel ?? ""), seconds: Number(o?.secs) || 0, targets: derived.filter((d) => Number(d.origin_piece_id) === oid).map((d) => String(d.channel)), skipped: [] };
      });
      const MAXDB = Object.keys(MAX).length ? MAX : null;
      report("③ 파생 채널에 youtube_long 없음 · 원본 채널 다시 없음(DB)", judgeReuse(rows, { maxOf: MAXDB ? maxOf : () => 1e9 }), `가족${MAXDB ? "" : " (상한 표를 못 읽어 길이 판정은 빼고)"}`);

      /* 덤 — §4.6 파생이 원본과 **같은 집**인가(교차 누수는 코인·편성 어느 축보다 크다) */
      const cross = derived.filter((d) => { const o = oById.get(Number(d.origin_piece_id)); return !o || Number(o.tenant_id) !== Number(d.tenant_id); });
      rec("덤 — 파생이 원본과 같은 집이다(§4.6)", cross.length ? "fail" : "pass", cross.length ? `[덤 cross_tenant] 🔴 ${cross.length}개: ${cross.slice(0, 5).map((d) => `piece ${d.id}(집 ${d.tenant_id}) ← 원본 ${d.origin_piece_id}`).join(" · ")}` : `파생 ${derived.length}개 전부`);
    });
  } catch (e) {
    rec("①②③ DB 팔", "unmeasured", `DB 를 못 읽었다 — ${String((e as Error)?.message ?? e).slice(0, 160)}`);
  } finally {
    if (!REHEARSE) await pgClient.end({ timeout: 5 }).catch(() => {});   // 리허설 팔이 같은 연결을 쓴다 — 거기서 닫는다
  }
}

/* ═══ 리허설 팔 — 시드 테넌트에 **실제로** 파생을 만들어 본다(쓰고 치운다) ①②③④ + 멱등 ═══
 *   🔴 지키는 선(`verify-e2e-rehearsal.mts` 와 같다 · 사장님 승인 2026-09-19 의 범위 안):
 *     · 새 집(`is_internal=true`)을 만든다 · 보존 테넌트는 **쓰기 전에** 막는다 · 끝나면(성공·실패·예외 모두) `teardownRun` 으로 치운다.
 *     · 돈 0 — AI·영상 굽기 0(원본의 영상 파일은 가짜 `r2_key` 한 줄이다). 발행 0 — 모든 시각을 **엿새 뒤**로 둔다(발행 크론이 안 줍는다).
 *   🔴 과녁을 살려 두는 것(AC-236): 코인을 **넉넉히 넣고** 원본을 **실제로 차감**한다 — 잔액 0 이면 «받으려다 못 받은» 파생이 0행으로 보여 초록이 된다.
 *     `youtube_long` 계정도 **연결해 둔다** — 계정이 없어서 빠진 것을 «규칙대로 빠졌다»로 읽지 않게.
 */
if (!REHEARSE) {
  rec("①②③ 리허설 팔", "unmeasured", "`--rehearse` 없이 돌렸다 — «파생 전후 원장 차이»·«가족의 분»·«멈췄다 깨기»는 실제로 만들어 봐야 안다");
} else {
  const imp = (f: string) => import(pathToFileURL(path.join(ROOT, f)).href);
  const { pgClient: sql } = await imp("db/index.ts");
  const PROTECT = new Set([3, 13, 109, 116, 198, 451]);
  let TID = 0;
  try {
    const [col] = await sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pieces' AND column_name = 'origin_piece_id'`;
    if (!col?.n) throw Object.assign(new Error("과녁 없음 — 라이브에 `pieces.origin_piece_id` 칸이 아직 없다(DDL 0088 · B)"), { unmeasured: true });
    if (!alive.deriveVideoPieces || !alive.VIDEO_REUSE_TARGETS) throw Object.assign(new Error(`과녁 없음 — ${TARGETS.reuse.file} deriveVideoPieces (B)`), { unmeasured: true });
    const reuse = await imp(TARGETS.reuse.file);
    const coin = await imp("lib/coin-ledger.ts");
    const ct = await imp("lib/coin-table.ts");
    const wc = await imp(TARGETS.table.file);
    const MAXR: Record<string, number> = { ...(wc.VIDEO_CHANNEL_MAX_SEC as Record<string, number>) };
    const cands: string[] = [...(reuse.VIDEO_REUSE_TARGETS as string[])];
    const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

    /* ── 시드 ── */
    const STAMP = Date.now().toString(36);
    const [t] = await sql`INSERT INTO tenants (key, name, plan_key, status, settings, is_internal)
      VALUES (${`r18-${STAMP}`.slice(0, 40)}, ${`R18 재사용 리허설 ${STAMP}`}, 'starter', 'active', ${JSON.stringify({ kinds: ["video"], channels: ["youtube_shorts"] })}::jsonb, true) RETURNING id`;
    TID = n(t?.id);
    if (!TID || PROTECT.has(TID)) throw new Error(`🔴 시드 집 id 가 이상하다(${TID}) — 멈춘다`);
    const acc: Record<string, number> = {};
    for (const ch of [...new Set([...cands, ...FORBIDDEN_REUSE])]) {
      const [a] = await sql`INSERT INTO accounts (tenant_id, channel, handle, auth_method, status, daily_cap, min_gap_min)
        VALUES (${TID}, ${ch}, ${`r18_${ch}_${STAMP}`}, 'oauth', 'active', 3, 60) RETURNING id`;
      acc[ch] = n(a?.id);
    }
    const g = await coin.grant(TID, 500, "R18 리허설 시드", null, `r18:seed:${STAMP}`);
    rec("리허설 ⓪ 시드 — 새 집 · 계정(youtube_long 포함) · 코인", TID > 0 && g.granted === 500 ? "pass" : "unmeasured", `tid=${TID} · 계정 ${Object.keys(acc).length}(${Object.keys(acc).join("·")}) · 코인 ${g.granted}`);

    /* 원본 둘 — 60초(클립이 빠진다) · 30초(클립이 간다) · 둘 다 **엿새 뒤 KST 10:00** */
    const day6 = new Date(Date.now() + 6 * 86400_000);
    const kstDate = new Date(day6.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
    const at10 = `${kstDate}T01:00:00.000Z`;   // KST 10:00 · 🔴 Date 객체를 바인딩하면 postgres-js 가 터진다(AC-5) — ISO 문자열로
    const origins: { id: number; seconds: number }[] = [];
    for (const seconds of [60, 30]) {
      /* 60초 원본은 **이미 나간 것**으로 둔다 — 발행 흔적(external_url·channel_ref·meta ytVideoId/fbReelId)을 파생이 물려받지 않나 보려고(§6-2 발행 멱등). */
      const published = seconds === 60;
      const meta = { video: { seconds, format: "graphic" }, coinItem: ct.videoCoinItem(seconds), ...(published ? { ytVideoId: "r18fake", fbReelId: "r18fake", publishAttempts: 1 } : {}) };
      const [p] = await sql`INSERT INTO pieces (tenant_id, origin, account_id, channel, kind, format, title, body, meta, status, scheduled_for, external_url, channel_ref, published_at)
        VALUES (${TID}, 'manual', ${acc.youtube_shorts}, 'youtube_shorts', 'video', 'graphic', ${`R18 리허설 원본 ${seconds}초`}, '', ${JSON.stringify(meta)}::jsonb,
                ${published ? "published" : "approved"}, ${at10}::timestamptz AT TIME ZONE 'UTC', ${published ? "https://youtube.com/shorts/r18fake" : null}, ${published ? "r18fake" : null},
                ${published ? at10 : null}::timestamptz AT TIME ZONE 'UTC') RETURNING id`;
      const id = n(p?.id);
      await sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, meta, sort) VALUES
        (${TID}, ${id}, 'video', ${`r18/${TID}/${id}.mp4`}, ${JSON.stringify({ durationMs: seconds * 1000 })}::jsonb, 0),
        (${TID}, ${id}, 'thumb', ${`r18/${TID}/${id}.jpg`}, ${JSON.stringify({})}::jsonb, 1)`;
      const c = await coin.consume(TID, ct.videoCoinItem(seconds), `piece:${id}`, { reason: `R18 리허설 원본 ${seconds}초` });
      origins.push({ id, seconds });
      rec(`리허설 ⓪ 원본 ${seconds}초 — 만들고 **실제로 차감**(과녁: 원장에 쓰기가 되는 집이다)`, c.ok && c.charged > 0 ? "pass" : "unmeasured", `piece ${id} · ${ct.videoCoinItem(seconds)} ${c.ok ? c.charged : "✗ " + c.reason}코인${published ? " · 이미 나간 원본(발행 흔적 있음)" : ""}`);
    }
    const [mt] = await sql`SELECT jsonb_typeof(meta) AS t FROM pieces WHERE tenant_id = ${TID} AND id = ${origins[0].id}`;
    if (mt?.t !== "object") throw new Error(`🔴 시드 meta 가 ${mt?.t} 로 들어갔다(PITFALLS #1) — 자가 제 손으로 틀린 재료를 만들었다`);

    const consumeCount = async () => n((await sql`SELECT count(*)::int AS c FROM coin_ledger WHERE tenant_id = ${TID} AND kind = 'consume'`)[0]?.c);
    const ledgerRows = async () => (await sql`SELECT kind, ref, delta FROM coin_ledger WHERE tenant_id = ${TID}`) as { kind: string; ref: string; delta: number }[];
    const want = [...cands, ...FORBIDDEN_REUSE];

    for (const o of origins) {
      const before = await consumeCount();
      const r = await reuse.deriveVideoPieces(TID, o.id, { channels: want });
      const after = await consumeCount();
      if (!r?.ok) { rec(`리허설 원본 ${o.seconds}초 — 파생 만들기`, "fail", `[① derive_failed] ${r?.reason}: ${r?.error}`); continue; }
      const created = (r.created ?? []) as { pieceId: number; channel: string }[];
      report(`① 코인 — ${o.seconds}초 원본에서 파생 ${created.length}개 · 원장 0행 · 파생 전후 차감 행 같음(리허설)`,
        judgeCoin({ derivedIds: created.map((c) => c.pieceId), ledger: await ledgerRows(), consumeBefore: before, consumeAfter: after }), "파생");
      report(`③ 실제로 만든 파생 채널 — ${o.seconds}초(youtube_long 계정이 **연결돼 있어도** 안 간다)`,
        judgeReuse([{ source: "youtube_shorts", seconds: o.seconds, targets: created.map((c) => c.channel), skipped: (r.skip ?? []).map((s: { channel: string; why?: string }) => ({ channel: s.channel, why: s.why })) }], { maxOf: (c) => MAXR[c] ?? null }), "가족");
      if ((r.skip ?? []).length) report(`④ 파생 결과의 «빠진 채널» 문구 — ${o.seconds}초(리허설)`, judgeWords((r.skip ?? []).map((s: { channel: string; why?: string; line?: string; how?: string }) => ({ channel: s.channel, seconds: o.seconds, max: MAXR[s.channel] ?? null, why: s.why, line: s.line ?? "", how: s.how ?? "" }))), "문장");

      /* 멱등 — 한 번 더 불러도 새로 안 만들고 원장도 그대로 */
      const r2 = await reuse.deriveVideoPieces(TID, o.id, { channels: want });
      const after2 = await consumeCount();
      const idem = r2?.ok && (r2.created ?? []).length === 0 && (r2.existing ?? []).length === created.length && after2 === after;
      rec(`멱등 — ${o.seconds}초 원본에 파생을 두 번 불러도 새로 0 · 원장 그대로`, idem ? "pass" : "fail", idem ? `existing ${r2.existing.length}` : `[① not_idempotent] 두 번째: created ${(r2?.created ?? []).length} · existing ${(r2?.existing ?? []).length} · 차감 행 ${after} → ${after2}`);

      /* 덤 — 같은 r2_key(다시 안 굽는다 · 트리거 §5) · 발행·코인 흔적을 안 물려받는다(§6-2) */
      const ids = created.map((c) => c.pieceId);
      if (ids.length) {
        const keys = await sql`SELECT piece_id, r2_key FROM piece_assets WHERE tenant_id = ${TID} AND kind = 'video' AND piece_id = ANY(${[o.id, ...ids]})`;
        const ok = keys.find((k) => n(k.piece_id) === o.id)?.r2_key;
        const off = ids.filter((id) => keys.find((k) => n(k.piece_id) === id)?.r2_key !== ok);
        rec(`덤 — ${o.seconds}초 파생이 원본과 **같은 영상 파일**(r2_key)을 가리킨다`, off.length ? "fail" : "pass", off.length ? `[덤 other_r2_key] ${off.join(",")}` : `${ids.length}개 전부 ${ok}`);
        const marks = await sql`SELECT id, external_url, channel_ref, published_at, meta FROM pieces WHERE tenant_id = ${TID} AND id = ANY(${ids})`;
        const leak = marks.filter((m) => m.external_url || m.channel_ref || m.published_at || Object.keys((m.meta ?? {}) as object).some((k) => /^(chain|render|publish|fb|tt|th|ig|yt)[A-Z]/.test(k) || ["coinItem", "refunded", "regenCount"].includes(k)));
        rec(`덤 — ${o.seconds}초 파생이 원본의 발행·코인 흔적을 안 물려받는다(§6-2 · 물려받으면 «이미 나감»으로 영영 안 나간다)`, leak.length ? "fail" : "pass",
          leak.length ? `[덤 inherited_marks] ${leak.map((m) => `piece ${m.id}`).join(",")}` : `${ids.length}개${o.seconds === 60 ? " · 원본은 이미 나간 것(흔적 있음)" : ""}`);
      }
    }

    /* ② 가족의 분 — B2 가 시각을 박은 뒤 */
    const readFamilies = async () => {
      const oids = origins.map((o) => o.id);
      const rows = await sql`SELECT id, origin_piece_id, channel, status, to_char(COALESCE(published_at, scheduled_for), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at FROM pieces WHERE tenant_id = ${TID} AND (id = ANY(${oids}) OR origin_piece_id = ANY(${oids}))`;
      const iso = (v: unknown) => (v ? String(v) : null);   // SQL 이 UTC 문자열로 준다(to_char)
      return origins.map((o) => ({ originId: o.id, members: rows.filter((r) => n(r.id) === o.id || n(r.origin_piece_id) === o.id).map((r) => ({ pieceId: n(r.id), channel: String(r.channel), at: iso(r.at) })) }));
    };
    if (alive.scheduleDerived) {
      const sch = await imp(TARGETS.schedule.file);
      for (const o of origins) await sch.scheduleDerived(TID, o.id);
      report("② 같은 분에 N곳 없음 — 파생에 시각을 박은 뒤(리허설 · 원본 둘의 가족)", judgeMinutes(await readFamilies()), "가족");
    } else {
      const f = judgeMinutes(await readFamilies());
      rec("② 같은 분에 N곳 없음 — 파생에 시각을 박은 뒤(리허설)", "unmeasured", `과녁 없음 — ${TARGETS.schedule.file} scheduleDerived (B2) · 지금 파생은 시각 없이 선다(시각 없음 ${f.untimed})`);
    }

    /* ② 멈췄다 깨기 — 예약이 지나간 채 멈춰 있다가 깨면 `releaseBacklog` 가 다시 잡는다(C 반례 2026-09-26: 틱톡·클립 19:00 같은 분) */
    const fam0 = await readFamilies();
    const timed = fam0.flatMap((f) => f.members).filter((m) => m.at);
    const pause = await imp("lib/tenant-pause.ts").catch(() => null);
    if (!alive.scheduleDerived || timed.length < 2 || !pause?.holdBacklog || !pause?.releaseBacklog) {
      rec("② 멈췄다 깨도 같은 분에 안 모인다(리허설)", "unmeasured", !alive.scheduleDerived ? "파생에 시각이 없다(B2 scheduleDerived 전) — 깨기 경로를 걸 재료가 없다" : "재료 없음");
    } else {
      const last = Math.max(...timed.map((m) => new Date(m.at as string).getTime()));
      const wakeKst = new Date(last + 86400_000 + 9 * 3600_000).toISOString().slice(0, 10);
      const wake = new Date(`${wakeKst}T04:00:00Z`);   // 🔴 KST 13:00 — 릴스 12시 후보가 지나 있고 틱톡·클립이 둘 다 19시를 첫 후보로 갖는 시각
      const held = await pause.holdBacklog(TID, wake);
      const moved = await pause.releaseBacklog(TID, wake);
      const r = judgeMinutes(await readFamilies());
      report(`② 멈췄다 깨도 같은 분에 안 모인다(리허설 · 깨는 시각 KST ${wakeKst} 13:00 · 모은 ${held} · 다시 잡은 ${moved})`, held ? r : { ...r, verdict: "unmeasured", note: "모인 글 0 — 깨기 경로가 안 돌았다" }, "가족");
    }
  } catch (e) {
    const un = (e as { unmeasured?: boolean })?.unmeasured;
    rec("리허설 팔", un ? "unmeasured" : "fail", `${un ? "" : "[리허설 threw] "}${String((e as Error)?.message ?? e).slice(0, 240)}`);
  } finally {
    if (TID && !PROTECT.has(TID)) {
      const { teardownRun } = await import("./_teardown.mjs");
      const note = await teardownRun(sql, { tenants: [TID], label: "R18" });
      rec("리허설 — 치우기(teardown)", note.failed ? "fail" : "pass", note.text);
    }
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

/* ═══ 합계 ═══ */
const fail = lines.filter((l) => l.v === "fail").length, un = lines.filter((l) => l.v === "unmeasured").length, ok = lines.filter((l) => l.v === "pass").length;
console.log(`\n■ ✅ ${ok} · ❌ ${fail} · ⊘ ${un}  (줄 ${lines.length})`);
if (un && !fail) console.log("   🔴 ⊘ 는 «못 쟀다»다 — 통과가 아니다(AC-9).");
process.exit(fail ? 1 : un ? 2 : 0);
