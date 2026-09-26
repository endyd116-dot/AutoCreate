/**
 * scripts/verify-r18-reuse.mts — 🔴 **R18 «한 번 만들어 여러 곳에»의 자**(C · 2026-09-26 · 트리거 R18 §7 C).
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
 *     npx --yes tsx scripts/verify-r18-reuse.mts                    ← 순수 팔(DB 0 · 돈 0 · 언제나)
 *     npx --yes tsx scripts/verify-r18-reuse.mts --db               ← + 라이브 **읽기 전용**(`BEGIN read only` 안에서 SELECT 만)
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
 *   ══ stdout 의 주인(AC-240) ══  지금 이 자의 stdout 을 먹는 것은 `verify-r18-reuse-mutants.mjs` 하나다 —
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
  let calls = 0, threw = 0;
  const threwAt: string[] = [];
  for (const origin of cands) for (const seconds of VIDEO_SECONDS) for (const connected of [undefined, every, [] as string[]]) for (const channels of [undefined, every]) {
    let r: { seconds?: number; go?: { channel: string }[]; skip?: { channel: string; why?: string; line?: string; how?: string }[] };
    try { r = reuse.reuseFit({ originChannel: origin, seconds, channels, connected }); calls++; }
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
  report("③ 재사용 목록 — `youtube_long` 어디에도 없음 · 원본 채널 안 뜸 · 길이대로 가고 빠짐(결정 ②)", judgeReuse(rows, { maxOf }), `호출(원본 ${cands.length} × 길이 ${VIDEO_SECONDS.length} × 연결 3 × 후보 2)`);
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
      const derived = await sql`SELECT id, tenant_id, origin_piece_id, channel, status, scheduled_for, published_at FROM pieces WHERE origin_piece_id IS NOT NULL ORDER BY id`;
      rec("⓪ DB 모수 — 라이브의 파생 piece", derived.length ? "pass" : "unmeasured", derived.length ? `${derived.length}개 · 집 ${new Set(derived.map((d) => d.tenant_id)).size}곳` : "🔴 0개 — 아래 ①②③ 은 ⊘(트리거 §0-b · 영상 채널이 아직 전부 planned)");
      if (!derived.length) {
        rec("① 코인 — 파생의 원장 0행(DB)", "unmeasured", "표본 0");
        rec("② 같은 분에 N곳 없음(DB)", "unmeasured", "표본 0");
        rec("③ 나간 채널에 youtube_long 없음(DB)", "unmeasured", "표본 0");
        return;
      }
      const originIds = [...new Set(derived.map((d) => Number(d.origin_piece_id)))];
      const origins = await sql`SELECT id, tenant_id, channel, scheduled_for, published_at, (meta->'video'->>'seconds') AS secs FROM pieces WHERE id = ANY(${originIds})`;
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
      const at = (r: Record<string, unknown>) => (r.published_at ?? r.scheduled_for ?? null) as string | null;
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
    await pgClient.end({ timeout: 5 }).catch(() => {});
  }
}

/* ═══ 합계 ═══ */
const fail = lines.filter((l) => l.v === "fail").length, un = lines.filter((l) => l.v === "unmeasured").length, ok = lines.filter((l) => l.v === "pass").length;
console.log(`\n■ ✅ ${ok} · ❌ ${fail} · ⊘ ${un}  (줄 ${lines.length})`);
if (un && !fail) console.log("   🔴 ⊘ 는 «못 쟀다»다 — 통과가 아니다(AC-9).");
process.exit(fail ? 1 : un ? 2 : 0);
