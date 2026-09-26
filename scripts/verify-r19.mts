/**
 * scripts/verify-r19.mts — 🔴 **R19 여섯 축을 «다른 모양의 자»로 잰다**(C · 2026-09-27 · 트리거 R19 §0-E · §2 C1)
 *
 *   ══ 왜 «다른 모양»인가(PARALLEL_GUIDE §2.7 ② · §2.9) ══
 *   B·B2 의 자는 대개 **글자**를 본다(«SQL 에 tenant_id 가 없다» · «start 안에 noteInsertCall 이 있다»).
 *   이 자는 **코드를 돌려서** 본다 — 글자가 맞아도 동작이 틀리면(또는 글자가 달라도 동작이 맞으면) 이 자가 가른다.
 *     · yt.project · yt.rolling  — 🔴 **라이브 DB 에서 진짜 함수**(`noteInsertCall` → `insertCallsLast24h`)를 돌린다(`--db`).
 *                                   시드 집 둘 · 뒤로 당긴 기록을 KST 자정·UTC 자정 **앞뒤**에 심고 «몇이 세어지나»를 본다. 끝나면 치운다.
 *     · yt.calls · yt.say         — 🔴 **진짜 `publishYoutube` 본문**을 돌린다. 기댄 모듈(DB·토큰·R2·감사)만 스텁으로 갈고,
 *                                   `fetch` 를 대본대로 답하게 해(401 · 유료 칸 거부 · 연결 끊김 · 찬 날) **«부른 수 = 적은 수»**를 센다.
 *     · reuse.targets             — 서버 두 표를 **불러서** 집합을 맞대고, 모의 후보와 **차례까지** 맞댄다.
 *     · reuse.honest              — `reuseFit` 을 **전수로** 돌린다(원본 × 길이) · 🔴 메인 결정(2026-09-27): **«계정 없음 ∧ 창구 닫힘»에서만** 잰다.
 *                                   대조군(창구 열림)에서는 «연결하시면»이 **나와야** 한다 — 안 나오면 이 축은 눈이 먼 것이다.
 *   💰 돈 축은 여기서 안 잰다 — 배포 체인(`gate-parallel.mjs`)이 체인 앞뒤로 따로 센다(ai_usage 새 행 · 시드 집 남은 것).
 *
 *   ══ 🔴 지키는 셋 ══
 *   ① **과녁부터 센다**(AC-236) — 재려는 이름이 나무에 없으면 그 축은 ⊘ 다(초록이 아니다).
 *   ② **스텁은 실제 모듈의 export 에서 짓는다**(§2.9 ②) — `youtube.ts` 의 import 줄에서 이름을 뽑고, 그 이름이 **진짜 모듈에 있나**를 먼저 본다.
 *      흉내 낼 이름이 진짜에 없으면 ⊘ · 새 import 가 생기면 스텁이 «부르지 않을 줄 알았다»로 던져 ⊘(조용히 초록 금지).
 *   ③ 🔴 **네트워크 0** — `fetch` 스텁은 대본에 없는 주소를 **던진다**. 이 자가 구글·R2 를 칠 길은 없다. 돈 0(생성 경로를 안 부른다).
 *
 *   ══ stdout 의 주인(AC-240) ══ `scripts/verify-r19-mutants.mjs` 가 **종료코드 + 줄머리 `[축]`** 을 읽는다 — 줄머리 모양을 바꾸면 그쪽도 본다.
 *
 *   쓰는 법:
 *     npx tsx scripts/verify-r19.mts            ← 순수 팔(yt.calls · yt.say · reuse.targets · reuse.honest) · DB 0 · 네트워크 0
 *     npx tsx scripts/verify-r19.mts --db       ← + yt.project · yt.rolling(🔴 라이브 DB · 시드 집 둘 → 치운다 · 돈 0)
 *   🔴 제품 경로는 **작업 폴더(`cwd`) 기준**이다 — 변이 하니스가 사본 폴더에서 돌린다.
 *   종료코드: 0 = 전부 ✅ · 1 = ❌ 있음 · 2 = ⊘ 있고 ❌ 없음(«못 쟀음»은 통과가 아니다).
 */
import "./_lib/load-env.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.cwd();
const ARGS = new Set(process.argv.slice(2));
const DB = ARGS.has("--db");
type V = "pass" | "fail" | "unmeasured";
type Row = Record<string, any>;
const lines: { v: V; axis: string }[] = [];
const icon = (v: V) => (v === "pass" ? "✅" : v === "fail" ? "❌" : "⊘");
/** 🔴 줄머리 `[축]` — 변이 하니스가 «그 축이 울었나»를 이걸로 본다(AC-121). */
const rec = (axis: string, step: string, v: V, note = "") => { lines.push({ v, axis }); console.log(`${icon(v)} [${axis}] ${step}${note ? `  — ${note}` : ""}`); return v; };
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
const read = (rel: string) => { try { return readFileSync(path.join(ROOT, rel), "utf8"); } catch { return null; } };
const HAS_DIGIT = /[0-9０-９]/;

/* ═══ ⓪ 과녁 ═══ */
const YT_FILE = "lib/publish/youtube.ts", REUSE_FILE = "lib/video/reuse.ts", TABLE_FILE = "lib/writing-contracts.ts", MOCK_FILE = "public/js/mock.js";
const ytSrc = read(YT_FILE) ?? "";
const want = (src: string, name: string) => new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${name}\\b`).test(src);
const YT_NAMES = ["insertCallsLast24h", "noteInsertCall", "YOUTUBE_FULL_SAY", "YOUTUBE_LIMIT_NOTE", "publishYoutube", "youtubeDailyCap"];
const ytMissing = YT_NAMES.filter((x) => !want(ytSrc, x));
rec("과녁", `\`${YT_FILE}\` 이 R19 이름 ${YT_NAMES.length}개를 낸다`, ytMissing.length ? "unmeasured" : "pass", ytMissing.length ? `없음: ${ytMissing.join(" · ")} — 유튜브 축 넷은 ⊘` : YT_NAMES.join(" · "));
const reuseSrc = read(REUSE_FILE) ?? "";
const reuseAlive = want(reuseSrc, "reuseFit") && /VIDEO_REUSE_TARGETS/.test(reuseSrc) && /not_connectable/.test(reuseSrc);
rec("과녁", `\`${REUSE_FILE}\` 에 reuseFit · VIDEO_REUSE_TARGETS · not_connectable`, reuseAlive ? "pass" : "unmeasured", reuseAlive ? "" : "재사용 축 둘은 ⊘");

/* ═══ yt.calls · yt.say — 진짜 publishYoutube 본문 + 스텁 + 대본 fetch ═══ */
type Scene = { name: string; script: string[]; paid?: boolean; full?: boolean; auditFails?: boolean; expect: number; wantOk?: boolean; wantReason?: string; say?: "full" | "notFull" };
const SC: { used: number; audits: Row[]; auditFails: boolean; script: string[]; insertFetches: number; bgCalls: number; unexpected: string[] } =
  { used: 0, audits: [], auditFails: false, script: [], insertFetches: 0, bgCalls: 0, unexpected: [] };
const UPLOAD_PREFIX = "https://www.googleapis.com/upload/youtube/v3/videos";
const BG_BASE = "http://127.0.0.1:9";   /* 배경 함수 주소 흉내 — `fetch` 스텁만 받는다(아무 데도 안 나간다) */

/**
 * 제품 모듈 하나를 사본 상자에 옮기고 **로컬 import 만** 스텁으로 간다. 반환: 상자 안 모듈 경로 · 스텁 이름 · 못 지은 까닭.
 *   스텁 값은 `globalThis.__R19STUB[ns][이름]` — 🔴 안 준 이름은 **던진다**(제품이 새 것을 부르기 시작하면 조용히 초록이 되지 않게).
 *   진짜 값을 그대로 쓰고 싶은 이름(순수 함수 · 상수)은 부르는 쪽이 진짜 모듈에서 꺼내 **손으로** 넣는다(무엇을 진짜로 뒀는지 보이게).
 */
const BOX = path.join(ROOT, `.r19c-box-${process.pid}`);
process.on("exit", () => { try { rmSync(BOX, { recursive: true, force: true }); } catch { /* */ } });   /* 사본 상자는 **어떻게 끝나든** 치운다(나무를 더럽히지 않는다) */
function buildBox(rel: string, ns: string): { modPath: string; stubbed: string[]; problems: string[] } {
  const src = read(rel) ?? "";
  const dir = path.join(BOX, path.dirname(rel));
  mkdirSync(dir, { recursive: true });
  const problems: string[] = [], stubbed: string[] = [];
  let n = 0;
  const out = src.replace(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)";/gm, (whole, isType, names, spec) => {
    if (isType || !spec.startsWith(".")) return whole;   /* 타입만 가져오는 줄은 esbuild 가 지운다 · 패키지(drizzle-orm)는 그대로 */
    /* 줄 안의 `type X` 는 값이 아니다 — esbuild 가 지우므로 스텁이 낼 필요가 없다 */
    const list = String(names).split(",").map((s) => s.trim()).filter((s) => s && !/^type\s/.test(s)).map((s) => s.split(/\s+as\s+/)[0].trim());
    /* 🔴 흉내 낼 이름이 **진짜 모듈에 있나** — 없으면 스텁이 없는 것을 흉내 내는 것이다(§2.9 ② «스텁은 실제 export 에서») */
    const base = path.resolve(path.dirname(path.join(ROOT, rel)), spec);
    const realFile = [`${base}.ts`, path.join(base, "index.ts")].find((p) => existsSync(p));
    const realSrc = realFile ? readFileSync(realFile, "utf8") : "";
    for (const x of list) if (!realFile || !(want(realSrc, x) || new RegExp(`export\\s*\\{[^}]*\\b${x}\\b`).test(realSrc))) problems.push(`${spec} 에 \`${x}\` export 가 없다`);
    const file = `__stub_${ns}_${n++}.ts`;
    writeFileSync(path.join(dir, file), list.map((x) => {
      stubbed.push(x);
      return `export const ${x}: any = (globalThis as any).__R19STUB?.${ns}?.${x} ?? (() => { throw new Error("스텁 없음: ${x} — ${path.basename(rel)} 가 새로 부른다(자를 넓혀라)"); });`;
    }).join("\n") + "\n");
    return `import { ${String(names).trim()} } from "./${file}";`;
  });
  const modPath = path.join(dir, path.basename(rel));
  writeFileSync(modPath, out);
  return { modPath, stubbed, problems };
}
function sqlText(s: unknown): string {
  try { return JSON.stringify((s as { queryChunks?: unknown })?.queryChunks ?? s); } catch { return String(s); }
}
async function fakeFetch(input: unknown, init?: { method?: string }): Promise<Response> {
  const url = String((input as { url?: string })?.url ?? input);
  const method = String(init?.method ?? "GET").toUpperCase();
  if (url.startsWith(UPLOAD_PREFIX) && method === "POST") {
    SC.insertFetches++;
    const step = SC.script.shift() ?? "ok";
    if (step === "throw") throw new TypeError("fetch failed (대본: 연결 끊김)");
    if (step === "401") return new Response(null, { status: 401 });
    if (step === "paidReject") return new Response(JSON.stringify({ error: { message: "paidProductPlacementDetails is not writable", errors: [{ reason: "badRequest" }] } }), { status: 400, headers: { "content-type": "application/json" } });
    if (step === "quota") return new Response(JSON.stringify({ error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } }), { status: 403, headers: { "content-type": "application/json" } });
    if (step === "rate") return new Response(JSON.stringify({ error: { message: "slow down", errors: [{ reason: "rateLimitExceeded" }] } }), { status: 429, headers: { "content-type": "application/json" } });
    return new Response(null, { status: 200, headers: { location: "https://upload.stub/session" } });
  }
  if (url === `${BG_BASE}/api/publish-video-background` && method === "POST") { SC.bgCalls++; return new Response(null, { status: 202 }); }
  if (url === "https://r2.stub/get") return new Response("stub-bytes", { status: 200 });
  if (url === "https://upload.stub/session" && method === "PUT") return new Response(JSON.stringify({ id: "stubVideo1" }), { status: 200, headers: { "content-type": "application/json" } });
  SC.unexpected.push(`${method} ${url.slice(0, 80)}`);
  throw new Error(`🔴 대본에 없는 주소 — 자가 밖으로 나가려 했다: ${method} ${url.slice(0, 80)}`);
}

let FULL_SAY = "", LIMIT_NOTE = "";
(globalThis as any).__R19STUB = {};
if (!ytMissing.length) {
  const { modPath, stubbed, problems } = buildBox(YT_FILE, "yt");
  (globalThis as any).__R19STUB.yt = {
    db: { execute: async (s: unknown) => {
      const t = sqlText(s);
      if (/COUNT\(\*\)/i.test(t) && t.includes("youtube.insert_call")) return [{ c: SC.used }];
      if (t.includes("piece_assets")) return [{ key: "stub/video.mp4", r2_key: "stub/video.mp4" }];
      return [];
    } },
    ensureFreshToken: async () => ({ ok: true, token: { accessToken: "stub-token" } }),
    r2Head: async () => ({ bytes: 1000 }),
    r2PresignGet: async () => "https://r2.stub/get",
    disclosureTextFor: () => "",
    writeAudit: async (e: Row) => { SC.audits.push(e); return SC.auditFails ? null : SC.audits.length; },
  };
  rec("yt.calls", `스텁은 진짜 모듈의 export 로만 지었다(${stubbed.length}개)`, problems.length ? "unmeasured" : "pass", problems.length ? problems.join(" · ") : stubbed.join(" · "));
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = fakeFetch;
  const quiet = { error: console.error, warn: console.warn };
  try {
    const yt = await import(pathToFileURL(modPath).href);
    FULL_SAY = String(yt.YOUTUBE_FULL_SAY ?? ""); LIMIT_NOTE = String(yt.YOUTUBE_LIMIT_NOTE ?? "");
    const cap = Number(yt.youtubeDailyCap?.()) || 0;
    const scenes: Scene[] = [
      { name: "한 번에 받음", script: ["ok"], expect: 1, wantOk: true },
      { name: "401 → 새 토큰으로 한 번 더", script: ["401", "ok"], expect: 2, wantOk: true },
      { name: "유료 칸 거부 → 칸 빼고 한 번 더", script: ["paidReject", "ok"], paid: true, expect: 2, wantOk: true },
      { name: "401 → 유료 칸 거부 → 한 번 더(세 번)", script: ["401", "paidReject", "ok"], paid: true, expect: 3, wantOk: true },
      { name: "연결 끊김(실패도 센다)", script: ["throw"], expect: 1, wantReason: "network" },
      { name: "401 → 연결 끊김", script: ["401", "throw"], expect: 2, wantReason: "network" },
      { name: "기록이 실패해도 그대로 올린다(§9)", script: ["ok"], auditFails: true, expect: 1, wantOk: true },
      { name: "찬 날 — 부르지 않는다", script: [], full: true, expect: 0, wantReason: "channel_error", say: "full" },
      /* [B2 해석 ③ · 메인 수용] 구글이 «하루 통이 찼다»고 답하면 찬 날의 말 · «잠깐 빨랐다»(429)는 **다른 사실**이라 다른 말 */
      { name: "403 quotaExceeded — 하루 통이 찼다", script: ["quota"], expect: 1, wantReason: "channel_error", say: "full" },
      { name: "429 rateLimitExceeded — 잠깐 빨랐다", script: ["rate"], expect: 1, wantReason: "channel_error", say: "notFull" },
    ];
    const says: { scene: string; want: "full" | "notFull"; got: string }[] = [];
    for (const sc of scenes) {
      Object.assign(SC, { used: sc.full ? cap : 0, audits: [], auditFails: !!sc.auditFails, script: [...sc.script], insertFetches: 0 });
      console.error = () => {}; console.warn = () => {};
      let res: Row = {};
      try {
        res = await yt.publishYoutube(
          { id: 101, tenantId: 9, title: "R19 자", body: "본문", tags: [], disclosure: sc.paid ? "광고 · 대가를 받았어요" : null, compensationKinds: sc.paid ? ["sponsored"] : [] },
          { id: 7, handle: "stub_handle" }, "youtube_shorts");
      } catch (e) { res = { threw: String((e as Error)?.message ?? e).slice(0, 160) }; }
      finally { console.error = quiet.error; console.warn = quiet.warn; }
      const notes = SC.audits.filter((a) => a.action === "youtube.insert_call").length;
      const resOk = sc.wantOk ? res.ok === true : res.reason === sc.wantReason;
      const good = !res.threw && notes === SC.insertFetches && SC.insertFetches === sc.expect && resOk;
      rec("yt.calls", `«${sc.name}» — 부른 수 = 적은 수 = ${sc.expect}`, res.threw && /스텁 없음/.test(String(res.threw)) ? "unmeasured" : good ? "pass" : "fail",
        `부름 ${SC.insertFetches} · 적음 ${notes}${sc.auditFails ? "(기록 실패 흉내)" : ""} · 결과 ${res.threw ? `던짐 ${res.threw}` : res.ok ? "ok" : `${res.reason}`}`);
      if (sc.say) says.push({ scene: sc.name, want: sc.say, got: String(res.error ?? "") });
    }
    /* ── yt.say ── */
    rec("yt.say", "찬 날의 말(`YOUTUBE_FULL_SAY`)에 숫자 0", FULL_SAY && !HAS_DIGIT.test(FULL_SAY) ? "pass" : "fail", `«${FULL_SAY}»`);
    rec("yt.say", "화면에 싣는 한 줄(`YOUTUBE_LIMIT_NOTE`)에 숫자 0", LIMIT_NOTE && !HAS_DIGIT.test(LIMIT_NOTE) ? "pass" : "fail", `«${LIMIT_NOTE}»`);
    for (const s of says) {
      const ok = s.want === "full" ? s.got === FULL_SAY && !HAS_DIGIT.test(s.got) : !!s.got && s.got !== FULL_SAY && !HAS_DIGIT.test(s.got);
      rec("yt.say", s.want === "full" ? `🔴 «${s.scene}» → 고객에게 주는 말 = 찬 날의 말 · 숫자 0(다른 고객 수를 안 낸다 · §4.6)` : `«${s.scene}» → 찬 날의 말이 **아니다**(몇 분이면 풀리는데 «내일»이라 하지 않는다)`,
        ok ? "pass" : "fail", `«${s.got}»`);
    }
    rec("yt.calls", "🔴 네트워크 0 — 대본 밖 주소를 친 적 없다", SC.unexpected.length ? "fail" : "pass", SC.unexpected.join(" · ") || "0");
  } catch (e) {
    rec("yt.calls", "상자 안 `publishYoutube` 를 못 불렀다", "unmeasured", String((e as Error)?.message ?? e).slice(0, 200));
  } finally {
    (globalThis as any).fetch = realFetch;
  }

  /* ── yt.gate — 🔴 [B2 · 메인 알림 ②] 배경 함수를 부르기 **전** 문(`lib/publish-one.ts`): 찼으면 **안 부른다** · 시도 횟수 그대로 · 슬롯에 말 한 줄 ── */
  const PO_FILE = "lib/publish-one.ts";
  const poSrc = read(PO_FILE) ?? "";
  if (!/youtubeFullNow/.test(poSrc) || !want(poSrc, "publishOne")) rec("yt.gate", "배경 함수 전 문", "unmeasured", `과녁 없음 — ${PO_FILE} 에 youtubeFullNow/publishOne`);
  else {
    const realYt = await imp(YT_FILE);                 /* 진짜로 두는 것: 채널 판정 · 찬 날의 말(글자 그대로) */
    const realDbUtil = await imp("lib/db-util.ts");    /* 진짜로 두는 것: jsonb 싸개(순수) */
    const po = { full: false, sqls: [] as string[], slots: [] as unknown[][] };
    const box = buildBox(PO_FILE, "po");
    (globalThis as any).__R19STUB.po = {
      q: async (s: unknown) => { po.sqls.push(sqlText(s)); return []; },
      writeAudit: async () => 1, backgroundBase: () => BG_BASE, jsonb: realDbUtil.jsonb, utcDate: realDbUtil.utcDate,
      classifyAndApply: async () => null, kstTimeText: () => "", notifyOnce: async () => null,
      setSlot: async (...a: unknown[]) => { po.slots.push(a); },
      publishPiece: async () => { throw new Error("글 발행 길 — 이 자는 영상만 잰다"); }, runnerOffline: async () => false,
      takedownBlock: async () => ({ blocked: false }),
      isYoutubeChannel: realYt.isYoutubeChannel, YOUTUBE_FULL_SAY: realYt.YOUTUBE_FULL_SAY,
      youtubeFullNow: async () => ({ full: po.full, used: po.full ? 100 : 0, cap: 100 }),
    };
    rec("yt.gate", `스텁은 진짜 모듈의 export 로만 지었다(${box.stubbed.length}개)`, box.problems.length ? "unmeasured" : "pass", box.problems.join(" · ") || box.stubbed.join(" · "));
    const realFetch = globalThis.fetch;
    const oldSecret = process.env.INTERNAL_SECRET;
    (globalThis as any).fetch = fakeFetch; process.env.INTERNAL_SECRET = "r19c-stub-secret";
    try {
      const mod = await import(pathToFileURL(box.modPath).href);
      const cases: { name: string; channel: string; account: number | null; full: boolean; wantBg: number }[] = [
        { name: "유튜브 · 계정 있음 · 찼다 → 배경 함수 안 부름", channel: "youtube_shorts", account: 5, full: true, wantBg: 0 },
        { name: "유튜브 긴 영상 · 찼다 → 안 부름", channel: "youtube_long", account: 5, full: true, wantBg: 0 },
        { name: "대조군 — 유튜브 · 안 찼다 → 부름", channel: "youtube_shorts", account: 5, full: false, wantBg: 1 },
        { name: "대조군 — 릴스 · 찼다 → 부름(유튜브 통과 무관)", channel: "reels", account: 5, full: true, wantBg: 1 },
        { name: "대조군 — 유튜브 · 계정 없음 · 찼다 → 부름(«직접 올려 주세요» 길 · 유튜브를 안 부른다)", channel: "youtube_shorts", account: null, full: true, wantBg: 1 },
      ];
      for (const c of cases) {
        Object.assign(po, { full: c.full, sqls: [], slots: [] }); SC.bgCalls = 0;
        let out: Row = {};
        try { out = await mod.publishOne(9, { id: 201, slot_id: 301, meta: { publishAttempts: 1 }, title: "R19 자", kind: "video", channel: c.channel, account_id: c.account }); }
        catch (e) { out = { threw: String((e as Error)?.message ?? e).slice(0, 160) }; }
        const note = po.sqls.some((t) => /UPDATE slots SET note/i.test(t) && t.includes(realYt.YOUTUBE_FULL_SAY));
        const heldOk = c.wantBg === 0 ? out.kind === "retry" && out.error === realYt.YOUTUBE_FULL_SAY && out.attempts === 1 && note : out.kind === "queued";
        rec("yt.gate", c.name, out.threw && /스텁 없음/.test(String(out.threw)) ? "unmeasured" : SC.bgCalls === c.wantBg && heldOk ? "pass" : "fail",
          `배경 호출 ${SC.bgCalls} · 결과 ${out.threw ? `던짐 ${out.threw}` : `${out.kind}${out.error ? ` «${String(out.error).slice(0, 24)}…»` : ""}${out.attempts !== undefined ? ` · 시도 ${out.attempts}` : ""}`}${c.wantBg === 0 ? ` · 슬롯에 말 ${note ? "○" : "×"}` : ""}`);
      }
    } catch (e) {
      rec("yt.gate", "상자 안 `publishOne` 을 못 불렀다", "unmeasured", String((e as Error)?.message ?? e).slice(0, 200));
    } finally {
      (globalThis as any).fetch = realFetch;
      if (oldSecret === undefined) delete process.env.INTERNAL_SECRET; else process.env.INTERNAL_SECRET = oldSecret;
    }
  }
} else {
  rec("yt.calls", "부른 수 = 적은 수", "unmeasured", "과녁 없음");
  rec("yt.say", "숫자 없는 말", "unmeasured", "과녁 없음");
}

/* ── yt.say 둘째 겹 — `dailyPublishCap` 이 코드에서 사라졌나 · 화면이 서버 한 줄을 읽나 · 모의가 같은 글자인가 ── */
{
  const hits: string[] = [];
  const walk = (dir: string) => {
    const abs = path.join(ROOT, dir);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs)) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      const rel = `${dir}/${e}`; const st = statSync(path.join(ROOT, rel));
      if (st.isDirectory()) walk(rel);
      else if (/\.(ts|mjs|js|html|txt)$/.test(e)) {
        const code = codeOnly(readFileSync(path.join(ROOT, rel), "utf8").replace(/<!--[\s\S]*?-->/g, ""));
        if (/\bdailyPublishCap\b/.test(code)) hits.push(rel);
      }
    }
  };
  for (const d of ["lib", "netlify", "public/app", "public/js"]) walk(d);
  rec("yt.say", "🔴 `dailyPublishCap`(«하루에 N개») 가 서버·화면 코드에 0곳", hits.length ? "fail" : "pass", hits.join(" · ") || "lib · netlify · public/app · public/js");
  const tpl = read("public/app/_tpl.txt") ?? "";
  rec("yt.say", "화면이 서버 한 줄(`publishLimitNote`)을 읽는다(베껴 적지 않는다)", /publishLimitNote/.test(codeOnly(tpl)) ? "pass" : "fail", "public/app/_tpl.txt");
  const mock = read(MOCK_FILE) ?? "";
  const mNote = (mock.match(/YT_LIMIT_NOTE\s*=\s*"([^"]+)"/) || [])[1] ?? "";
  if (LIMIT_NOTE) rec("yt.say", "모의가 싣는 한 줄 = 서버 글자 그대로(AC-270)", mNote === LIMIT_NOTE ? "pass" : "fail", mNote ? (mNote === LIMIT_NOTE ? "같다" : `모의 «${mNote}»`) : "모의에 그 줄이 없다");
}

/* ═══ reuse.targets · reuse.honest ═══ */
const TARGETS: string[] = [];
if (reuseAlive) {
  try {
    const reuse = await imp(REUSE_FILE);
    const wc = await imp(TABLE_FILE);
    const targets: string[] = [...(reuse.VIDEO_REUSE_TARGETS as string[])];
    TARGETS.push(...targets);
    const maxKeys = Object.keys(wc.VIDEO_CHANNEL_MAX_SEC as Record<string, number>);
    const onlyT = targets.filter((c) => !maxKeys.includes(c)), onlyM = maxKeys.filter((c) => !targets.includes(c));
    rec("reuse.targets", "🔴 set(VIDEO_REUSE_TARGETS) = set(keys(VIDEO_CHANNEL_MAX_SEC)) — 대상 = «영상 길이가 있는 채널»(설계 §6.4)",
      onlyT.length || onlyM.length ? "fail" : "pass", onlyT.length || onlyM.length ? `대상에만 ${onlyT.join(",") || "-"} · 길이 표에만 ${onlyM.join(",") || "-"}` : targets.join(" · "));
    rec("reuse.targets", "쓰레드가 대상에 있다(사장님 결정 ③)", targets.includes("threads") ? "pass" : "fail", "");
    const mock = read(MOCK_FILE) ?? "";
    const m = mock.match(/const\s+REUSE_CANDS\s*=\s*\[([^\]]*)\]/);
    const cands = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
    rec("reuse.targets", "모의 후보 = 서버 후보(차례까지 · 화면 차례)", !cands ? "unmeasured" : cands.join(",") === targets.join(",") ? "pass" : "fail", cands ? `모의 ${cands.join(",")}` : "모의에서 REUSE_CANDS 를 못 찾았다");

    /* ── reuse.honest — 🔴 «계정 없음 ∧ 창구 닫힘»에서만(메인 결정) · 전수(원본 × 길이) ── */
    const origins = [...new Set([...maxKeys, "youtube_long"])];
    const seconds = [15, 30, 60];
    const allOf = (v: boolean) => Object.fromEntries(targets.map((c) => [c, v]));
    type Skip = { channel: string; why: string; line?: string; how?: string; connected?: boolean; connectable?: boolean };
    const run = (connected: Record<string, boolean>, connectable: Record<string, boolean>) => {
      const skips: Skip[] = [], gos: string[] = []; let calls = 0; const threw: string[] = [];
      for (const originChannel of origins) for (const s of seconds) {
        try { const r = reuse.reuseFit({ originChannel, seconds: s, channels: targets, connected, connectable }); calls++; skips.push(...(r.skip ?? [])); gos.push(...(r.go ?? []).map((g: { channel: string }) => g.channel)); }
        catch (e) { threw.push(`${originChannel}/${s}: ${String((e as Error)?.message ?? e).slice(0, 60)}`); }
      }
      return { skips, gos, calls, threw };
    };
    const SAYS_CONNECT = /연결하시면/;
    const text = (s: Skip) => `${s.line ?? ""} ${s.how ?? ""}`;
    const closed = run(allOf(false), allOf(false));
    const lies = closed.skips.filter((s) => SAYS_CONNECT.test(text(s)));
    const noAcc = closed.skips.filter((s) => s.why === "no_account");
    const nc = closed.skips.filter((s) => s.why === "not_connectable");
    rec("reuse.honest", `🔴 계정 없음 ∧ 창구 닫힘 — «연결하시면» 0 (reuseFit ${closed.calls}번 · 빠진 줄 ${closed.skips.length})`, closed.threw.length ? "unmeasured" : lies.length ? "fail" : "pass",
      lies.length ? `${lies.length}줄: ${lies.slice(0, 3).map((s) => `${s.channel}/${s.why} «${text(s).trim().slice(0, 50)}»`).join(" | ")}` : closed.threw.join(" | ") || "0줄");
    rec("reuse.honest", "계정 없음 ∧ 창구 닫힘 — 사유가 `no_account`(«연결하시면» 갈래)로 새지 않는다", noAcc.length ? "fail" : "pass", noAcc.length ? noAcc.slice(0, 4).map((s) => s.channel).join(",") : "0");
    rec("reuse.honest", "과녁 — 길이는 맞는데 창구가 닫혀 빠진 줄(`not_connectable`)이 실제로 나왔다", nc.length ? "pass" : "unmeasured", nc.length ? `${nc.length}줄 · 예 «${text(nc[0]).trim()}»` : "🔴 0줄 — 이 축의 초록은 아무것도 안 잰 것");
    const ncWords = nc.filter((s) => !/준비 중/.test(String(s.line ?? "")));
    rec("reuse.honest", "`not_connectable` 문장이 «준비 중»을 말한다(글자표 §0-C)", ncWords.length ? "fail" : nc.length ? "pass" : "unmeasured", ncWords.length ? ncWords.slice(0, 2).map((s) => `«${s.line}»`).join(" | ") : "");
    const flagOff = closed.skips.filter((s) => s.connectable !== false);
    rec("reuse.honest", "빠진 줄마다 `connectable:false` 가 실린다(화면이 «준비 중»을 그릴 재료)", flagOff.length ? "fail" : "pass", flagOff.length ? `${flagOff.length}줄 빠짐 · 예 ${flagOff[0].channel}/${flagOff[0].why}` : `${closed.skips.length}줄`);
    /* 대조군 — 창구가 열렸고 계정이 없으면 «연결하시면»이 **나와야** 한다(안 나오면 위 초록은 눈먼 초록) */
    const open = run(allOf(false), allOf(true));
    const openSay = open.skips.filter((s) => s.why === "no_account" && SAYS_CONNECT.test(text(s)));
    rec("reuse.honest", "대조군 — 창구 열림 ∧ 계정 없음이면 «연결하시면»이 나온다(자가 눈멀지 않았다)", openSay.length ? "pass" : "unmeasured", `${openSay.length}줄`);
    /* B 해석(메인 수용 2026-09-27) — 계정이 붙어 있으면 창구가 닫혀도 go(올릴 길이 있다 · «준비 중»은 그 집에 거짓) */
    const acct = run(allOf(true), allOf(false));
    const ncWithAcc = acct.skips.filter((s) => s.why === "not_connectable");
    rec("reuse.acct-go", "계정 있음 ∧ 창구 닫힘 — `not_connectable` 0 · 길이 맞는 곳은 go(B 해석 · 메인 수용)", ncWithAcc.length ? "fail" : acct.gos.length ? "pass" : "unmeasured", ncWithAcc.length ? `${ncWithAcc.length}줄` : `go ${acct.gos.length}`);
  } catch (e) {
    rec("reuse.targets", "재사용 모듈을 못 불렀다", "unmeasured", String((e as Error)?.message ?? e).slice(0, 200));
  }
} else {
  rec("reuse.targets", "대상 = 길이 있는 채널", "unmeasured", "과녁 없음");
  rec("reuse.honest", "창구 닫힌 채널에 «연결하시면» 0", "unmeasured", "과녁 없음");
}

/* ═══ reuse.honest 화면 겹 — 🔴 브라우저로(--screen) · 트리거 §0-E «서버 문장 · 화면 둘 다» ═══
   모의 기본 = 라이브 모양(영상 채널 여섯 전부 `planned` → `connectable:false` · 영상 계정 0). 그 판의 영상 글 화면에 «연결하시면»이 **0** 이어야 한다.
   대조군 `chOpen=1`(창구 다 열림)에서는 «연결하시면»이 **나와야** 한다 — 안 나오면 이 겹은 눈먼 초록이다.
   재는 화면: 510(계정 없는 쇼츠 — «올릴 채널이 아직 없어요» 상자) · 509(계정 있는 쇼츠 — «다른 곳에도 올릴까요» 재사용 줄) · 509 + `vr=on`. */
if (ARGS.has("--screen")) {
  const SAY = "연결하시면";
  try {
    const { requirePlaywright } = await import("./_lib/find-playwright.mjs");
    const { chromium } = await requirePlaywright();
    const { createServer } = await import("node:http");
    const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
    const srv = createServer((req, res) => {
      let f = path.join(ROOT, "public", decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
      if (existsSync(f) && statSync(f).isDirectory()) f = path.join(f, "index.html");
      if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream" }); res.end(readFileSync(f));
    });
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", () => ok()));
    const port = (srv.address() as { port: number }).port;
    const browser = await chromium.launch();
    /** 화면을 열고 **글이 멈출 때까지**(0.6초 동안 길이 그대로 · 최대 10초) 기다린 뒤 본문 글자를 준다 — 늦게 오는 재사용 줄까지 잡는다. */
    const pageText = async (q: string, must: string) => {
      const pg = await browser.newPage(); const errs: string[] = [];
      pg.on("pageerror", (e: Error) => errs.push(String(e.message)));
      await pg.goto(`http://127.0.0.1:${port}/app/piece.html?mock=1&${q}`);
      await pg.waitForFunction((t: string) => document.body.innerText.includes(t), must, { timeout: 12000 }).catch(() => {});
      let last = -1, text = "";
      for (let i = 0; i < 20; i++) { text = await pg.evaluate(() => document.body.innerText); if (text.length === last) break; last = text.length; await pg.waitForTimeout(600); }
      await pg.close();
      return { text, errs, seen: text.includes(must) };
    };
    const SCREENS = [
      { q: "id=510", must: "밥솥 내솥 얼룩", name: "계정 없는 쇼츠(510) — «올릴 채널이 아직 없어요»" },
      { q: "id=509", must: "전자레인지 냄새", name: "계정 있는 쇼츠(509) — 재사용 줄" },
      { q: "id=509&vr=on", must: "전자레인지 냄새", name: "509 + 여러 곳에 올리기 켬" },
    ];
    let controlSays = 0;
    for (const s of SCREENS) {
      const closed = await pageText(s.q, s.must);
      const open = await pageText(`${s.q}&chOpen=1`, s.must);
      controlSays += open.text.split(SAY).length - 1;
      const n = closed.text.split(SAY).length - 1;
      const ctx = n ? closed.text.slice(Math.max(0, closed.text.indexOf(SAY) - 40), closed.text.indexOf(SAY) + 30).replace(/\s+/g, " ") : "";
      rec("reuse.honest", `🔴 화면 — ${s.name}: 창구 닫힘 ∧ 계정 없음에서 «${SAY}» 0`, !closed.seen ? "unmeasured" : closed.errs.length ? "fail" : n ? "fail" : "pass",
        !closed.seen ? `화면이 안 떴다(«${s.must}» 못 봄)` : closed.errs.length ? `pageerror ${closed.errs[0].slice(0, 80)}` : n ? `${n}곳 — «…${ctx}…»` : "0곳");
    }
    rec("reuse.honest", `화면 대조군 — 창구가 열린 판(chOpen=1)에서는 «${SAY}»가 나온다(이 겹이 눈멀지 않았다)`, controlSays ? "pass" : "unmeasured", `${controlSays}곳`);
    await browser.close(); srv.close();
  } catch (e) {
    rec("reuse.honest", "화면 겹을 못 쟀다", "unmeasured", String((e as Error)?.message ?? e).slice(0, 200));
  }
}

/* ═══ yt.project · yt.rolling — 🔴 라이브 DB 에서 진짜 함수(--db) ═══ */
if (!DB) {
  rec("yt.project", "프로젝트 전체를 센다(라이브 DB)", "unmeasured", "`--db` 없이 돌렸다");
  rec("yt.rolling", "최근 24시간 굴림(라이브 DB)", "unmeasured", "`--db` 없이 돌렸다");
} else if (ytMissing.length) {
  rec("yt.project", "프로젝트 전체", "unmeasured", "과녁 없음"); rec("yt.rolling", "24시간 굴림", "unmeasured", "과녁 없음");
} else {
  const { pgClient: sql } = await imp("db/index.ts") as { pgClient: any };
  const yt = await imp(YT_FILE);
  const { teardownRun } = await import("./_teardown.mjs");
  const made: number[] = [];
  try {
    const stamp = Date.now().toString(36);
    for (const tag of ["a", "b"]) {
      const [t] = await sql`INSERT INTO tenants (key, name, plan_key, status, is_internal) VALUES (${`r19c-${tag}-${stamp}`}, ${`R19 C 유튜브 한도 자 ${tag}`}, 'pro', 'active', true) RETURNING id` as Row[];
      made.push(Number(t.id));
    }
    const [A, B] = made;
    /* ① 프로젝트 전체 — 두 집에서 부른 기록이 **다** 세어지나 */
    const base = Number(await yt.insertCallsLast24h());
    await yt.noteInsertCall(A, 0, "youtube_shorts"); await yt.noteInsertCall(A, 0, "youtube_long"); await yt.noteInsertCall(B, 0, "youtube_shorts");
    const after = Number(await yt.insertCallsLast24h());
    rec("yt.project", `🔴 두 집(${A}·${B})에서 3번 부르면 셈이 3 는다(집을 가르지 않는다)`, after - base === 3 ? "pass" : "fail", `${base} → ${after} (차 ${after - base})`);
    /* ② 24시간 굴림 — 자정 **앞**에 심은 기록이 세어지나(달력이면 빠진다) · 24시간 **넘은** 기록은 빠지나 */
    const [clock] = await sql`SELECT EXTRACT(EPOCH FROM (NOW() - (date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')))::float AS kst_s,
                                     EXTRACT(EPOCH FROM (NOW() - (date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')))::float AS utc_s` as Row[];
    const plant: { label: string; agoS: number; inWindow: boolean }[] = [
      { label: "23시간 50분 전", agoS: 23 * 3600 + 50 * 60, inWindow: true },
      { label: "KST 자정 1분 전", agoS: Number(clock.kst_s) + 60, inWindow: Number(clock.kst_s) + 60 < 23.9 * 3600 },
      { label: "UTC 자정 1분 전", agoS: Number(clock.utc_s) + 60, inWindow: Number(clock.utc_s) + 60 < 23.9 * 3600 },
      { label: "24시간 10분 전", agoS: 24 * 3600 + 10 * 60, inWindow: false },
    ];
    const base2 = Number(await yt.insertCallsLast24h());
    for (const p of plant) {
      /* `detail` 은 안 싣는다(비워도 세는 데 상관없다) — jsonb 를 글자로 넣는 함정(PITFALLS #1)을 아예 안 밟는다. 표식은 `target` 에 */
      await sql`INSERT INTO audit_logs (tenant_id, actor_type, action, target, risk_level, created_at)
        VALUES (${A}, 'system', 'youtube.insert_call', ${`piece:0:r19c:${p.label}`}, 'low', NOW() - make_interval(secs => ${p.agoS}))`;
    }
    const after2 = Number(await yt.insertCallsLast24h());
    const expectIn = plant.filter((p) => p.inWindow).length;
    const calendarEdge = plant.filter((p) => p.inWindow && /자정/.test(p.label)).length;
    rec("yt.rolling", `🔴 굴림 — 심은 ${plant.length}개 중 24시간 안 ${expectIn}개만 세어진다(자정 앞 ${calendarEdge}개 포함 · 달력으로 세면 빠진다)`,
      calendarEdge === 0 ? "unmeasured" : after2 - base2 === expectIn ? "pass" : "fail",
      `${base2} → ${after2} (차 ${after2 - base2}) · ${plant.map((p) => `${p.label}${p.inWindow ? "○" : "×"}`).join(" · ")} · 지금 KST 자정에서 ${Math.round(Number(clock.kst_s) / 60)}분`);
  } catch (e) {
    rec("yt.project", "라이브 DB 팔이 던졌다", "unmeasured", String((e as Error)?.message ?? e).slice(0, 200));
  } finally {
    const note = await teardownRun(sql, { tenants: made, label: "R19 C" });
    rec("yt.project", "시드 집 치우기(teardown)", note.failed ? "fail" : "pass", note.text);
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

/* ═══ 끝 ═══ */
const cnt = (v: V) => lines.filter((l) => l.v === v).length;
console.log(`\n■ ✅ ${cnt("pass")} · ❌ ${cnt("fail")} · ⊘ ${cnt("unmeasured")}  (줄 ${lines.length})`);
if (cnt("unmeasured")) console.log("   🔴 ⊘ 는 «못 쟀다»다 — 통과가 아니다(AC-9).");
process.exit(cnt("fail") ? 1 : cnt("unmeasured") ? 2 : 0);
