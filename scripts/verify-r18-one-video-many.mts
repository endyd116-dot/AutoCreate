/**
 * scripts/verify-r18-one-video-many.mts — 🔴 **R18 «한 번 만들어 여러 곳에»의 자**(C · 2026-09-26 · 트리거 R18 §7 C).
 *
 *   ══ 무엇을 재나 — 여섯(메인이 준 넷 + B 가 찾은 구멍 둘 · 2026-09-26) ══
 *     ① 코인은 한 번   — 파생 piece 가 코인 원장에 **0행**인가 · 파생을 만드는 사이 그 집의 차감 행이 **안 늘었나**
 *     ② 같은 분에 N곳 없음 — 한 영상 가족(원본 + 파생)의 예약 시각이 **같은 분**에 둘 이상 없나(+ 멈췄다 깨도)
 *     ③ `youtube_long` 이 재사용 목록에 없나 — 대상에도 **«빠진 채널»에도** 안 뜬다(트리거 §3 «화면에도 안 띄운다»)
 *     ④ 빠진 채널 문구가 §3 말투인가 — «실패»·«불가»·«오류» 0 · 사실 한 줄 · 어떻게 하면 되는지
 *     ⑤ 원본을 다시 만들면 — 그 사이 안 나간 파생은 시각이 없고 · 다시 승인되면 **새 영상**으로 갈아 끼운다 · 파생에서 다시 만들기는 원본으로
 *     ⑥ 원본을 버리면 — 안 나간 파생도 같이 내리고 · 이미 나간 파생은 안 건드린다
 *     🔴 ⑤⑥ 은 «고객이 원본에 한 결정이 파생에 안 닿는» 모양이다 — 트리거에 없던 구멍을 B 가 찾아 막았다(메인이 여섯으로 늘렸다).
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
/* 🔴 **돈 퓨즈** — 제품 모듈을 부르기 **전에** 건다(제품은 전부 아래에서 동적 import 한다 · 정적 import 는 load-env 뿐).
   리허설 팔은 실제 문(`pieces-regenerate`)을 두드린다. 그 문 끝의 `triggerVideo` 는 `INTERNAL_SECRET` 과 `backgroundBase()` 로 배경 함수를 부르는데,
   2026-09-26 전 판의 `backgroundBase` 는 스크립트에서 `.env` 의 `SITE_URL`(라이브)을 그대로 돌려줬다(C 가 찾고 a1d0c77 로 막음).
   🔴 **재는 나무가 그 수리 전 판일 수 있다**(남의 가지 · 옛 커밋) — 그래서 자가 스스로 끊는다: 비밀값 0 · 주소는 127.0.0.1 · 메일 0 · AI 0.
   `triggerVideo` 는 비밀값이 없으면 부르지 않고 `failPiece`(환급·알림 — 시드 집 안)로 끝난다.
   🔴 [2026-09-26 · 둘째 판] **리허설에서는 «로컬 스텁 + 가짜 비밀값»으로 바꾼다.** 비밀값을 비우면 판이 **즉시 failed** 가 되는데,
   B 의 «30초 판 새로 만들기» 수리는 «잡았던 판이 failed 면 다시 잡는다»(생성이 실패했으면 다시 만들 수 있어야 한다)라서
   **퓨즈가 만든 failed** 때문에 둘째 요청이 합법적으로 다시 잡혀 «새 영상 2»가 나올 수 있다 — 제품이 아니라 **내 퓨즈의 상태**다(AC-236).
   ⇒ 127.0.0.1 에 202 만 돌려주는 스텁을 세우고 `URL` 을 그리로(옛·새 `backgroundBase` 둘 다 `URL` 을 먼저 본다 · 로컬 주소라 둘 다 통과),
      비밀값은 **가짜**(`r18-local-stub` — 혹시 라이브에 닿아도 401). 판은 라이브처럼 `generating` 에 머문다. 스텁이 받은 호출 수를 찍는다. */
for (const k of ["URL", "DEPLOY_PRIME_URL"]) delete process.env[k];
Object.assign(process.env, { INTERNAL_SECRET: "", SITE_URL: "http://127.0.0.1:1", RESEND_API_KEY: "", GEMINI_API_KEY: "" });
const STUB = { calls: 0, paths: new Map<string, number>(), close: async () => {} };
if (REHEARSE) {
  const { createServer } = await import("node:http");
  const srv = createServer((req, res) => {
    STUB.calls++; const p = String(req.url ?? "").split("?")[0]; STUB.paths.set(p, (STUB.paths.get(p) ?? 0) + 1);
    req.resume(); res.statusCode = /-background$/.test(p) ? 202 : 404; res.end();
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", () => ok()));
  const port = (srv.address() as { port: number }).port;
  Object.assign(process.env, { URL: `http://127.0.0.1:${port}`, SITE_URL: `http://127.0.0.1:${port}`, INTERNAL_SECRET: "r18-local-stub" });
  STUB.close = () => new Promise<void>((ok) => srv.close(() => ok()));
}

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
    console.log(`     [${f.axis} ${f.code}] ${[f.source ? `원본 ${f.source}` : "", f.seconds ? `${f.seconds}초` : "", f.channel ? `→ ${f.channel}` : "", f.reason && f.reason !== "too_long" ? `(${f.reason})` : "", f.at ? `@${f.at}` : ""].filter(Boolean).join(" ")} — ${f.why}${f.text ? `  «${f.text}»` : ""}`);
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
  remake: { file: "lib/director.ts", names: ["remakeVideoFor"], who: "B" },
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

/** 파생 가족을 DB 에서 읽어 ①②③ + §4.6 을 잰다 — 🔴 라이브(`--db`)와 리허설 집(`--rehearse`)이 **같은 몸통**을 쓴다.
 *   리허설에서 한 번 돌려야 이 접합부(SQL·묶기·to_char)가 **실제 행으로** 산다 — 라이브는 파생이 0개라 여기가 늘 ⊘ 였다(AC-236). */
async function liveArm(sql: any, scopeTid: number | null, tag: string): Promise<void> {
  const derived = await sql`SELECT p.id, p.tenant_id, p.origin_piece_id, p.channel, p.status, to_char(COALESCE(p.published_at, p.scheduled_for), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at,
      t.is_internal, (t.key LIKE 'r18%') AS seed FROM pieces p JOIN tenants t ON t.id = p.tenant_id
    WHERE p.origin_piece_id IS NOT NULL AND (${scopeTid}::bigint IS NULL OR p.tenant_id = ${scopeTid}) ORDER BY p.id`;
  rec(`⓪ ${tag} 모수 — 파생 piece`, derived.length ? "pass" : "unmeasured", derived.length ? (() => { const all = new Set(derived.map((d) => d.tenant_id)); const seeds = new Set(derived.filter((d) => d.seed || d.is_internal).map((d) => d.tenant_id)); /* 🔴 무엇을 세었나(AC-114) — 도는 중인 리허설의 시드 집도 여기 잡힌다. 고객 집과 갈라 적는다. */ return `${derived.length}개 · 집 ${all.size}곳(그중 시드·내부 집 ${seeds.size}곳 · 고객 집 ${all.size - seeds.size}곳)`; })() : "🔴 0개 — 아래 ①②③ 은 ⊘(트리거 §0-b · 영상 채널이 아직 전부 planned)");
  if (!derived.length) {
    rec(`① 코인 — 파생의 원장 0행(${tag})`, "unmeasured", "표본 0");
    rec(`② 같은 분에 N곳 없음(${tag})`, "unmeasured", "표본 0");
    rec(`③ 나간 채널에 youtube_long 없음(${tag})`, "unmeasured", "표본 0");
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
  report(`① 코인 — 파생 piece 가 원장에 0행(${tag})`, coin, "파생");

  /* ② 가족 — 원본 + 파생 · 나갔으면 나간 시각, 아니면 예약 시각 */
  const at = (r: Record<string, unknown>) => (r.at ?? null) as string | null;   // SQL 이 UTC 문자열로 준다(to_char)
  const fams = originIds.map((oid) => {
    const o = oById.get(oid);
    const kids = derived.filter((d) => Number(d.origin_piece_id) === oid);
    return { originId: oid, members: [...(o ? [{ pieceId: oid, channel: String(o.channel), at: at(o) }] : []), ...kids.map((d) => ({ pieceId: Number(d.id), channel: String(d.channel), at: at(d) }))] };
  });
  report(`② 같은 분에 N곳 없음(${tag} · 원본+파생 가족)`, judgeMinutes(fams), "가족");

  /* ③ 나간/잡힌 채널 */
  const rows = originIds.map((oid) => {
    const o = oById.get(oid);
    return { source: String(o?.channel ?? ""), seconds: Number(o?.secs) || 0, targets: derived.filter((d) => Number(d.origin_piece_id) === oid).map((d) => String(d.channel)), skipped: [] };
  });
  const MAXDB = Object.keys(MAX).length ? MAX : null;
  report(`③ 파생 채널에 youtube_long 없음 · 원본 채널 다시 없음(${tag})`, judgeReuse(rows, { maxOf: MAXDB ? maxOf : () => 1e9 }), `가족${MAXDB ? "" : " (상한 표를 못 읽어 길이 판정은 빼고)"}`);

  /* 덤 — §4.6 파생이 원본과 **같은 집**인가(교차 누수는 코인·편성 어느 축보다 크다) */
  const cross = derived.filter((d) => { const o = oById.get(Number(d.origin_piece_id)); return !o || Number(o.tenant_id) !== Number(d.tenant_id); });
  rec(`덤 — 파생이 원본과 같은 집이다(§4.6 · ${tag})`, cross.length ? "fail" : "pass", cross.length ? `[덤 cross_tenant] 🔴 ${cross.length}개: ${cross.slice(0, 5).map((d) => `piece ${d.id}(집 ${d.tenant_id}) ← 원본 ${d.origin_piece_id}`).join(" · ")}` : `파생 ${derived.length}개 전부`);
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
      await liveArm(sql, null, "DB");
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

    /* ── 앞 판이 끊겨 남긴 시드 집 — 있으면 먼저 말한다(죽은 판은 teardown 을 못 한다 · 2026-09-26 856 을 손으로 치웠다) ── */
    const stale = await sql`SELECT id, key FROM tenants WHERE key LIKE 'r18-%' AND is_internal = true`;
    rec("리허설 ⓪ 앞 판이 남긴 시드 집", stale.length ? "unmeasured" : "pass", stale.length ? `🔴 ${stale.length}곳(${stale.map((t) => `${t.id}:${t.key}`).join(" · ")}) — 도는 다른 판의 것일 수도, 끊긴 판의 것일 수도 있다 · 끊긴 것이면 teardownRun 으로 치운다` : "0곳");

    /* ── 시드 ── */
    const STAMP = Date.now().toString(36);
    const [t] = await sql`INSERT INTO tenants (key, name, plan_key, status, settings, is_internal)
      VALUES (${`r18-${STAMP}`.slice(0, 40)}, ${`R18 재사용 리허설 ${STAMP}`}, 'pro', 'active', ${JSON.stringify({ kinds: ["video"], channels: ["youtube_shorts"] })}::jsonb, true) RETURNING id`;
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
      /* 🔴 과녁을 살린다(AC-236): 두 가족이 **함께** 멈춰 있으면 60초 가족의 틱톡이 19:00 을 먼저 차지해서 30초 가족이 **우연히** 안 부딪힐 수 있다
         (가족을 모르는 길이어도 초록이 나는 시드). ⇒ 60초 가족은 깨는 시각 한참 뒤로 비켜 두고, 틱톡·클립이 **둘 다** 있는 30초 가족만 멈춤에 걸린다. */
      const o60 = origins.find((o) => o.seconds === 60);
      /* 🔴 **각자 +30일**로 민다 — 한 값으로 옮기면 가족 셋이 **내 손으로** 같은 분에 앉는다(2026-09-26 첫 판이 그렇게 대조군을 빨갛게 했다 · AC-236 을 내 시드에서). */
      if (o60) await sql`UPDATE pieces SET scheduled_for = scheduled_for + interval '30 days'
        WHERE tenant_id = ${TID} AND origin_piece_id = ${o60.id} AND status = 'scheduled' AND scheduled_for IS NOT NULL`;
      const held = await pause.holdBacklog(TID, wake);
      const moved = await pause.releaseBacklog(TID, wake);
      const r = judgeMinutes(await readFamilies());
      report(`② 멈췄다 깨도 같은 분에 안 모인다(리허설 · 깨는 시각 KST ${wakeKst} 13:00 · 모은 ${held} · 다시 잡은 ${moved})`, held ? r : { ...r, verdict: "unmeasured", note: "모인 글 0 — 깨기 경로가 안 돌았다" }, "가족");
      /* 빨가면 **무엇이·언제**를 찍는다 — «같은 분»만으로는 제품 탓인지 내 시드 탓인지 못 가른다 */
      if (r.verdict === "fail") for (const row of await sql`SELECT id, origin_piece_id, channel, status, to_char(scheduled_for, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at FROM pieces WHERE tenant_id = ${TID} AND origin_piece_id IS NOT NULL ORDER BY origin_piece_id, id`) console.log(`       · piece ${row.id} ← ${row.origin_piece_id} ${row.channel} ${row.status} @${row.at}`);
    }
    /* ═══ ⑤⑥ 고객이 **원본에** 한 결정이 파생에 닿나 — B 가 찾은 구멍 둘(메인 2026-09-26 «자 넷 → 여섯») ═══
     *   ⑤ 원본 다시 만들기: 안 나간 파생은 그 사이 **시각이 없고**(옛 영상이 먼저 나가는 틈 0) · 다시 승인되면 **새 영상**으로 갈아 끼운다
     *   ⑥ 원본 버리기: 안 나간 파생도 **같이 내린다** · 이미 나간 파생은 **안 건드린다**(내리기의 몫)
     *   🔴 함수가 아니라 **실제 문**(`/api/pieces-reuse`·`pieces-regenerate`·`pieces-reject` 핸들러)을 두드린다 — 함수만 부르면 «손이 붙어 있나»를 못 잰다(AC-242).
     *   🔴 재승인은 `approvePiece` 의 **마지막 두 줄**(UPDATE scheduled → `onOriginApproved`)을 그대로 부른다 — 그 앞의 `recheckPiece` 는
     *      가짜 영상 파일이라 못 돈다(알고 둔다 · 여기서 재는 것은 «승인 뒤 파생이 따라오나»다). */
    const o30 = origins.find((o) => o.seconds === 30);
    const piecesFn = await imp("netlify/functions/pieces.ts").catch(() => null);
    const authLib = await imp("lib/auth.ts").catch(() => null);
    if (!o30 || !piecesFn?.default || !authLib?.signUserToken || typeof reuse.onOriginApproved !== "function") {
      rec("⑤ 원본 다시 만들기 — 파생이 따라오나", "unmeasured", "과녁 없음 — pieces 핸들러·signUserToken·onOriginApproved 중 없는 것이 있다");
      rec("⑥ 원본 버리기 — 파생이 따라오나", "unmeasured", "과녁 없음");
    } else {
      const [u] = await sql`INSERT INTO users (tenant_id, email, password_hash, name, role) VALUES (${TID}, ${`c+r18-${STAMP}@autocreate.test`}, 'x', 'R18 리허설', 'owner') RETURNING id`;
      const token = authLib.signUserToken({ uid: n(u?.id), tid: TID, role: "owner" });
      const door = async (p: string, body: Record<string, unknown>) => {
        const res = await piecesFn.default(new Request(`http://127.0.0.1/api/${p}`, { method: "POST", headers: { "content-type": "application/json", cookie: `${authLib.USER_COOKIE}=${token}` }, body: JSON.stringify(body) }));
        let j: Record<string, unknown> = {};
        try { j = await res.json(); } catch { /* 몸통 없음 */ }
        return { status: res.status, j };
      };
      const kids = async () => (await sql`SELECT id, status, to_char(scheduled_for, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at, meta->'reuse'->>'waitOrigin' AS wait
        FROM pieces WHERE tenant_id = ${TID} AND origin_piece_id = ${o30.id} ORDER BY id`) as { id: number; status: string; at: string | null; wait: string | null }[];
      const videoKey = async (id: number) => ((await sql`SELECT r2_key FROM piece_assets WHERE tenant_id = ${TID} AND piece_id = ${id} AND kind = 'video' ORDER BY id DESC LIMIT 1`)[0]?.r2_key ?? null) as string | null;

      /* 준비 — 고객의 답(첫 한 번)을 **실제 문**으로. 이 글에 채널이 적혀야 재승인 때 파생이 다시 만들어진다(`onOriginApproved`). */
      const ans = await door("pieces-reuse", { id: o30.id, channels: cands, remember: false });
      rec("⑤ 준비 — 고객의 답(`/api/pieces-reuse`)이 문으로 들어간다", ans.status < 300 && ans.j.ok ? "pass" : "unmeasured", `HTTP ${ans.status}${ans.j.ok ? "" : ` · ${String(ans.j.step ?? "")} ${String(ans.j.error ?? "")}`}`);

      /* ⑤-0 파생에서 «다시 만들기»는 원본으로 돌려보낸다 — 다시 구우면 코인 0 인 글에 생성비가 든다(§4.7 을 거꾸로 뚫는다) */
      const k0 = await kids();
      const c0 = await consumeCount();
      if (k0.length) {
        const r = await door("pieces-regenerate", { id: n(k0[0].id) });
        const c1 = await consumeCount();
        const ok = r.status === 400 && r.j.step === "derived" && c1 === c0;
        rec("⑤ 파생에서 «다시 만들기»는 원본으로 돌려보낸다(다시 안 굽는다 · 코인 0)", ok ? "pass" : "fail",
          ok ? `HTTP 400 · «${String(r.j.error ?? "").slice(0, 60)}»` : `[⑤ derived_regen_open] HTTP ${r.status} · step ${String(r.j.step)} · 차감 행 ${c0} → ${c1}`);
      }

      /* ⑤-1 원본 다시 만들기 — 실제 문(퓨즈가 굽기를 끊는다 · 원본은 «시작 못 함»으로 failed + 환급, 시드 집 안) */
      const K1 = await videoKey(o30.id);
      const rg = await door("pieces-regenerate", { id: o30.id });
      const k1 = await kids();
      const unsent = k1.filter((k) => ["scheduled", "awaiting_manual"].includes(String(k.status)));
      const timedNow = unsent.filter((k) => k.at);
      const noWait = unsent.filter((k) => k.wait !== "true");
      rec("⑤ 원본을 다시 만드는 사이 안 나간 파생은 **시각이 없다**(옛 영상이 먼저 나가는 틈 0)",
        rg.status >= 300 ? "fail" : !unsent.length ? "unmeasured" : timedNow.length || noWait.length ? "fail" : "pass",
        rg.status >= 300 ? `[⑤ regen_door] HTTP ${rg.status} · ${String(rg.j.step)} ${String(rg.j.error ?? "")}`
          : timedNow.length || noWait.length ? `[⑤ timed_while_regen] 안 나간 ${unsent.length} 중 시각 남음 ${timedNow.length} · waitOrigin 없음 ${noWait.length}`
            : `안 나간 파생 ${unsent.length}개 전부 시각 없음 · waitOrigin`);

      /* ⑤-2 새 영상이 나왔다 치고(굽기는 퓨즈로 안 돈다) 재승인 — approvePiece 의 마지막 두 줄 그대로 */
      const K2 = `r18/${TID}/${o30.id}-regen.mp4`;
      await sql`DELETE FROM piece_assets WHERE tenant_id = ${TID} AND piece_id = ${o30.id} AND kind IN ('video','thumb')`;
      await sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, meta, sort) VALUES
        (${TID}, ${o30.id}, 'video', ${K2}, ${JSON.stringify({ durationMs: 30000 })}::jsonb, 0), (${TID}, ${o30.id}, 'thumb', ${`r18/${TID}/${o30.id}-regen.jpg`}, '{}'::jsonb, 1)`;
      await sql`UPDATE pieces SET status = 'scheduled', scheduled_for = ${at10}::timestamptz AT TIME ZONE 'UTC',
        meta = meta || ${JSON.stringify({ stage: "done", video: { seconds: 30, format: "graphic" } })}::jsonb, updated_at = NOW() WHERE tenant_id = ${TID} AND id = ${o30.id}`;
      const [orow] = await sql`SELECT * FROM pieces WHERE tenant_id = ${TID} AND id = ${o30.id}`;
      await reuse.onOriginApproved(TID, orow);
      const c3 = await consumeCount();
      const keys = await Promise.all(unsent.map(async (k) => ({ id: n(k.id), key: await videoKey(n(k.id)) })));
      const stale = keys.filter((k) => k.key !== K2);
      rec("⑤ 다시 승인되면 안 나간 파생이 **새 영상**으로 갈아 끼워진다", !keys.length ? "unmeasured" : stale.length ? "fail" : "pass",
        stale.length ? `[⑤ stale_video] ${stale.map((k) => `piece ${k.id} → ${k.key}`).join(" · ")} (새 ${K2} · 옛 ${K1})` : `${keys.length}개 전부 ${K2}(옛 ${K1})`);
      report("⑤ 원본 다시 만들기 ~ 재승인 동안 파생 몫 코인 0(파생 id 행 + 전후 차감 행)", judgeCoin({ derivedIds: k1.map((k) => n(k.id)), ledger: await ledgerRows(), consumeBefore: c0, consumeAfter: c3 }), "파생");

      /* ⑥ 원본 버리기 — 파생 하나는 **이미 나간 것**으로 둔다(건드리면 안 되는 쪽의 과녁) */
      const k2 = await kids();
      const pubId = n(k2.find((k) => k.status === "scheduled")?.id);
      if (pubId) await sql`UPDATE pieces SET status = 'published', published_at = NOW() AT TIME ZONE 'UTC', external_url = 'https://r18.invalid/x', channel_ref = 'r18x' WHERE tenant_id = ${TID} AND id = ${pubId}`;
      const rj = await door("pieces-reject", { id: o30.id });
      const k3 = await kids();
      const left = k3.filter((k) => n(k.id) !== pubId && k.status !== "rejected");
      const pubNow = k3.find((k) => n(k.id) === pubId);
      rec("⑥ 원본을 버리면(`/api/pieces-reject`) 안 나간 파생도 같이 내린다", rj.status >= 300 ? "fail" : k3.length < 2 ? "unmeasured" : left.length ? "fail" : "pass",
        rj.status >= 300 ? `[⑥ reject_door] HTTP ${rj.status} · ${String(rj.j.step)} ${String(rj.j.error ?? "")}` : left.length ? `[⑥ derived_left_scheduled] ${left.map((k) => `piece ${k.id}(${k.status})`).join(" · ")}` : `안 나간 ${k3.length - 1}개 전부 rejected`);
      rec("⑥ 이미 나간 파생은 안 건드린다(«내리기»의 몫)", !pubId ? "unmeasured" : pubNow?.status === "published" ? "pass" : "fail",
        pubNow?.status === "published" ? `piece ${pubId} published 그대로` : `[⑥ published_touched] piece ${pubId} → ${pubNow?.status}`);
    }

    /* ═══ ①-b «30초로 다시 만들 길»(트리거 §6-6) — 새 영상이라 **한 번** 받는다 · 🔴 차례로든 **동시에**든 두 번 눌러도 한 번 ═══
     *   C 반례(2026-09-26 · B 1be9d16): 멱등 검사(`meta.remakeOf`)가 차감(confirm) **앞**, 표시는 **뒤**라 동시에 두 번이면 새 영상 2 · 차감 2 였다.
     *   B 의 라이브 자는 «차례로»만 쟀다 — 그건 맞다. 두 탭·재시도·더블탭이 여는 창은 **동시에**다. */
    if (!alive.remakeVideoFor) rec("①-b 30초로 다시 만들기 — 두 번 눌러도 한 번", "unmeasured", `과녁 없음 — ${TARGETS.remake.file} remakeVideoFor (B)`);
    else {
      const dir = await imp(TARGETS.remake.file);
      const yt = acc.youtube_shorts;
      /* 원본의 지시서 — «새로 만들기»가 이 spec 을 복제한다(B 의 라이브 자와 같은 모양 · 필요한 칸만) */
      const spec = { key: `youtube_shorts:${yt}`, channel: "youtube_shorts", accountId: yt, accountHandle: "yt", kind: "video", emotionKey: "script", format: "story", composition: "60초 그래픽 스토리",
        images: { count: 0, aiCount: 0, style: "photo", heroNeeded: false }, monetize: { affiliate: null, sponsored: false, gift: false, adDisclosure: false },
        schedule: { at: at10, slotReason: "R18 리허설" }, lengthHint: { words: 0 }, coinCost: 28, angle: "R18 리허설",
        video: { format: "graphic", seconds: 60, cuts: 9, provider: { tier: "standard", key: "omni" }, voice: { provider: "gemini", voiceId: "Kore" }, variant: { palette: "warm", hookType: "question", voiceId: "Kore" }, disclosure: { badge: false, descriptionFirstLine: false } } };
      const [tp] = await sql`INSERT INTO topics (tenant_id, title, norm_key, status) VALUES (${TID}, ${"R18 리허설 소재"}, ${`r18reh${STAMP}`}, 'used') RETURNING id`;
      const [br] = await sql`INSERT INTO briefs (tenant_id, topic_id, goal, pieces, reasons, mode, status, coin_cost) VALUES (${TID}, ${n(tp?.id)}, 'adsense', ${JSON.stringify([spec])}::jsonb, '[]'::jsonb, 'reviewed', 'confirmed', 28) RETURNING id`;
      /* 🔴 경쟁은 타이밍이다 — **한 번 초록은 증거가 약하다**(메인). 판마다 원본을 새로 심고 **동시에 세 번**을 ROUNDS 판 넣는다. */
      const ROUNDS = 5, AT_ONCE = 3;
      const seedOrigin = async (i: number) => {
        const [p] = await sql`INSERT INTO pieces (tenant_id, origin, account_id, channel, kind, format, title, body, blocks, meta, status, scheduled_for, brief_id, topic_id)
          VALUES (${TID}, 'manual', ${yt}, 'youtube_shorts', 'video', 'story', ${`R18 리허설 원본(다시 만들기 ${i})`}, ${"설명"}, '[]'::jsonb,
                  ${JSON.stringify({ stage: "done", video: { format: "graphic", seconds: 60 }, coinItem: "video_60", key: `youtube_shorts:${yt}` })}::jsonb,
                  'scheduled', ${at10}::timestamptz AT TIME ZONE 'UTC', ${n(br?.id)}, ${n(tp?.id)}) RETURNING id`;
        const id = n(p?.id);
        await sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, meta, sort) VALUES (${TID}, ${id}, 'video', ${`r18/${TID}/${id}.mp4`}, ${JSON.stringify({ durationMs: 60000 })}::jsonb, 0)`;
        await coin.consume(TID, "video_60", `piece:${id}`, { reason: "R18 리허설 원본(다시 만들기)" });
        return id;
      };
      const madeOf = async (oid: number) => (await sql`SELECT id FROM pieces WHERE tenant_id = ${TID} AND meta->>'remakeOf' = ${String(oid)} AND channel = 'naver_clip'`).length;
      let o3 = 0, bad = 0, okRounds = 0, noneOk = 0;
      const badNotes: string[] = [];
      const seconds: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        o3 = await seedOrigin(i);
        const cA = await consumeCount();
        const rs = await Promise.all(Array.from({ length: AT_ONCE }, () => dir.remakeVideoFor(TID, o3, "naver_clip", null)));
        const cB = await consumeCount(); const mB = await madeOf(o3);
        if (!rs.some((r) => r?.ok)) { noneOk++; badNotes.push(`판${i + 1}: 다 안 됐다 ${rs.map((r) => String(r?.step)).join("/")}`); continue; }
        if (mB === 1 && cB - cA === 1) { okRounds++; seconds.push(rs.filter((r) => !r?.ok || r?.already).map((r) => (r?.already ? "already" : String(r?.step))).join("·")); }
        else { bad++; badNotes.push(`판${i + 1}: 새 영상 ${mB} · 차감 행 +${cB - cA}`); }
      }
      rec(`①-b 🔴 «30초로 다시 만들기»를 **동시에 ${AT_ONCE}번** × ${ROUNDS}판 — 판마다 새 영상 1개 · 차감 1번`, bad ? "fail" : okRounds ? "pass" : "unmeasured",
        bad ? `[①b remake_twice] ${bad}/${ROUNDS}판에서 두 번 이상 · ${badNotes.join(" | ")}`
          : okRounds ? `${okRounds}/${ROUNDS}판 전부 1·1 · 나머지 요청은 ${[...new Set(seconds)].join(" / ")}${noneOk ? ` · ⊘ ${noneOk}판` : ""}`
            : `판 ${ROUNDS} 전부 안 됐다 — ${badNotes.join(" | ")}`.slice(0, 240));
      const made = () => madeOf(o3);
      const mB = await made();
      /* 차례로 — 마지막 판의 원본에 한 번 더. 스텁 덕에 판은 `generating` 이지만, 스텁이 못 받았을 때도 같은 답이 나오게 «다 만들어졌다»(in_review)로 둔다(B 의 라이브 자와 같은 방식) */
      await sql`UPDATE pieces SET status = 'in_review' WHERE tenant_id = ${TID} AND meta->>'remakeOf' = ${String(o3)} AND channel = 'naver_clip'`;
      const cC = await consumeCount();
      const rc = await dir.remakeVideoFor(TID, o3, "naver_clip", null);
      const cD = await consumeCount(); const mD = await made();
      rec("①-b 한 번 만든 뒤 또 누르면 새로 0 · 차감 0(already)", rc?.ok && rc.already && cD === cC && mD === mB ? "pass" : "fail",
        rc?.ok && rc.already && cD === cC && mD === mB ? "already · 차감 행 그대로" : `[①b remake_again] ok ${rc?.ok} already ${rc?.already} · 차감 행 ${cC}→${cD} · 새 영상 ${mB}→${mD}`);
      const rf = await dir.remakeVideoFor(TID, o3, "reels", null);
      const ry = await dir.remakeVideoFor(TID, o3, "youtube_long", null);
      rec("①-b 대조군 — 이미 들어가는 채널(릴스)은 새로 안 만든다 · youtube_long 은 없는 길", !rf?.ok && rf.step === "fits" && !ry?.ok && ry.step === "channel" ? "pass" : "fail", `릴스 ${String(rf?.step)} · youtube_long ${String(ry?.step)}`);
    }

    /* DB 팔의 접합부를 리허설 집의 **실제 행**으로 한 번 돌린다(라이브엔 파생이 0개라 거기선 늘 ⊘) */
    await liveArm(sql, TID, "리허설 집 · DB 팔 몸통");
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
    rec("리허설 — 돈 퓨즈: 배경 호출은 로컬 스텁만 받았다(라이브 0)", "pass", `스텁이 받은 호출 ${STUB.calls}(${[...STUB.paths].map(([p, c]) => `${p} ${c}`).join(" · ") || "없음"}) · 비밀값은 가짜 · URL=127.0.0.1`);
    await STUB.close();
  }
}

/* ═══ 합계 ═══ */
const fail = lines.filter((l) => l.v === "fail").length, un = lines.filter((l) => l.v === "unmeasured").length, ok = lines.filter((l) => l.v === "pass").length;
console.log(`\n■ ✅ ${ok} · ❌ ${fail} · ⊘ ${un}  (줄 ${lines.length})`);
if (un && !fail) console.log("   🔴 ⊘ 는 «못 쟀다»다 — 통과가 아니다(AC-9).");
process.exit(fail ? 1 : un ? 2 : 0);
