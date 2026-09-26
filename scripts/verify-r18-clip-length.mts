/**
 * scripts/verify-r18-clip-length.mts — 🔴 **60초 영상이 30초 채널(네이버 클립)로 러너까지 가는 «조용한 실패» 길이 없는가**(R18 · B2 · 2026-09-26)
 *   사용: npx --yes tsx scripts/verify-r18-clip-length.mts          · DB 0 · 네트워크 0
 *
 *   ══ 왜 ══
 *     클립은 러너 **스텁**이다(`runner/channels/naver-clip.mjs`) — 잡을 집자마자 «앱에서 올려 주세요»로 돌려보낸다.
 *     60초 영상이 거기까지 가면 고객은 폰에서 올리다 **네이버에게 거절당하고**, 우리 화면엔 길이가 까닭이라는 말이 **어디에도 없다.**
 *     ⇒ 러너 **전에** 세 겹이 거른다: ㉮ B `reuseFit`(파생을 안 만든다) ㉯ B2 `scheduleDerived`(편성 안 한다) ㉰ B2 `publish()`(넘기지 않는다).
 *
 *   ══ 재는 것 ══
 *     ① `videoFitsChannel` 표 — 채널 × 길이 경계(여유 1초 = 심사 축과 같은 선) · 모르면 막지 않는다(§9)
 *     ② 말투 — ①사실 ②어떻게 하면 되는지 · «실패·오류·불가» 0 · 🔴 B `reuseFit` 문장과 **글자 그대로 같다**(두 곳이 따로 지으면 말이 갈린다)
 *     ③ 여유 1초 = `lib/video/judge.ts duration_fit`(«≤ maxSeconds+1s») — 심사가 통과시킨 것을 여기서 «넘는다»고 하지 않는다
 *     ④ 🔴 세 겹이 **러너 전에** 선다 — ㉮ `deriveVideoPieces` 가 `fit.go` 만 만든다 ㉯ `scheduleDerived` 가 박기 전에 거른다
 *        ㉰ `publish()` 가 `enqueueRunnerJob`·커넥터·계정 검사보다 **앞**에서 잰다 · 발행 잡을 쌓는 곳은 `publish()` 한 곳뿐
 *        ㉱ 배경 함수가 그 경우를 «직접 올리기»가 아니라 `failed` 로 둔다(직접 올려도 안 올라간다)
 *     ⑤ 🔴 소스 변이 4종 — `video-fit.ts` **사본**(임시 폴더)을 틀어 ①표가 우는가 · 경로 변이 3종 — ④가 우는가
 *   종료코드: 0 = 지켜진다 · 1 = 어긋난다 · 2 = 못 쟀다.
 */
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import * as FIT from "../lib/publish/video-fit";
import { reuseFit, VIDEO_REUSE_TARGETS } from "../lib/video/reuse";
import { VIDEO_CHANNEL_MAX_SEC } from "../lib/writing-contracts";
import { VIDEO_SECONDS } from "../lib/video/types";
import { CHANNELS } from "../lib/channel-registry";
import { stripComments, blockOf, orderIn, tally } from "./_lib/block.mjs";

const T = tally();
const counts: Record<string, string> = {};
const say = (s: string) => console.log(s);
const read = (f: string) => existsSync(f) ? stripComments(readFileSync(f, "utf8")) : null;
const FORBID = /실패|오류|불가|정지|불이익|책임/;

type FitMod = Pick<typeof FIT, "videoFitsChannel" | "FIT_TOLERANCE_MS">;
/** 🔴 표 — 이 목록이 곧 «자»다. ⑤ 소스 변이가 같은 표를 사본 모듈에 돌린다. */
const ROWS: { ch: string; ms: unknown; fits: boolean; note: string }[] = [
  { ch: "naver_clip", ms: 30_000, fits: true, note: "30초 클립 = 딱 상한" },
  { ch: "naver_clip", ms: 31_000, fits: true, note: "31.0초 = 여유 1초 안(심사와 같은 선)" },
  { ch: "naver_clip", ms: 31_001, fits: false, note: "31.001초 = 여유 밖" },
  { ch: "naver_clip", ms: 60_000, fits: false, note: "🔴 60초 영상 → 클립" },
  { ch: "naver_clip", ms: 90_000, fits: false, note: "90초 영상 → 클립" },
  { ch: "youtube_shorts", ms: 60_000, fits: true, note: "60초 쇼츠" },
  { ch: "youtube_shorts", ms: 90_000, fits: false, note: "90초 → 쇼츠(60)" },
  { ch: "reels", ms: 90_000, fits: true, note: "90초 릴스" },
  { ch: "facebook_reels", ms: 90_000, fits: true, note: "90초 페북 릴스(API 상한 90)" },
  { ch: "facebook_reels", ms: 92_000, fits: false, note: "92초 → 페북 릴스" },
  { ch: "tiktok", ms: 90_000, fits: true, note: "90초 틱톡(180)" },
  { ch: "youtube_long", ms: 60_000, fits: true, note: "표에 없는 채널 = 잣대 없음 → 막지 않는다" },
  { ch: "naver_clip", ms: 0, fits: true, note: "길이 모름(0) → 막지 않는다(§9 «아직 모른다로 막지 않는다»)" },
  { ch: "naver_clip", ms: null, fits: true, note: "길이 모름(null)" },
  { ch: "naver_clip", ms: "abc", fits: true, note: "길이 모름(문자)" },
];
function tableMisses(m: FitMod): string[] {
  const bad: string[] = [];
  for (const r of ROWS) { const v = m.videoFitsChannel(r.ch, r.ms); if (v.fits !== r.fits) bad.push(`${r.ch} ${String(r.ms)}ms → fits=${v.fits}(기대 ${r.fits}) · ${r.note}`); }
  return bad;
}

/* ═══ ① 표 ═══ */
say("■ ① `videoFitsChannel` 표 — 채널 × 길이 경계");
{
  for (const r of ROWS) { const v = FIT.videoFitsChannel(r.ch, r.ms); T.ok(`① ${r.note}: ${r.ch} ${String(r.ms)} → ${r.fits ? "들어간다" : "안 들어간다"}`, v.fits === r.fits, `fits=${v.fits}`); }
  const unk = FIT.videoFitsChannel("naver_clip", 0);
  T.ok("① 모르면 `measured:false` 로 **«못 쟀다»를 남긴다**(«맞다»로 접지 않는다 · AC-9)", unk.fits === true && unk.measured === false);
  T.ok("① 상한은 `VIDEO_CHANNEL_MAX_SEC` 에서만 — `channelMaxSec` 이 표 값 그대로", Object.entries(VIDEO_CHANNEL_MAX_SEC).every(([c, v]) => FIT.channelMaxSec(c) === v));
  counts["표"] = `${ROWS.length}행 · 채널 ${new Set(ROWS.map((r) => r.ch)).size}`;
}

/* ═══ ② 말투 · B 와 같은 문장 ═══ */
say("■ ② 말투 — §3 · B `reuseFit` 과 글자 그대로 같은 문장");
{
  const v = FIT.videoFitsChannel("naver_clip", 60_000);
  const s = v.fits ? "" : v.say;
  T.ok("② 사실 한 줄 — «60초라 … 최대 30초 … 안 올라가요»", /60초라 .*\(최대 30초\)엔 안 올라가요/.test(s), s);
  T.ok("② 어떻게 하면 되는지 — «만들 때 30초를 골라 주세요»", /만들 때 30초를 골라 주세요/.test(s), s);
  T.ok("② «실패·오류·불가·정지·불이익·책임» 0", !FORBID.test(s), s);
  /* 🔴 두 문장 짓개가 **같은 말**을 하나 — 채널 × 길이 전수. */
  let pairs = 0; const diff: string[] = [];
  for (const ch of VIDEO_REUSE_TARGETS) for (const sec of VIDEO_SECONDS) {
    const b = reuseFit({ originChannel: "youtube_long", seconds: sec, channels: [ch] });
    const bSkip = b.skip.find((x) => x.channel === ch && x.why === "too_long");
    const mine = FIT.videoFitsChannel(ch, sec * 1000);
    if (!b.go.length && !bSkip) continue;   // 후보 밖(원본과 같은 가족) — 말할 것이 없다
    pairs++;
    if (!!bSkip !== !mine.fits) { diff.push(`${ch}·${sec}초: B ${bSkip ? "뺌" : "넣음"} ↔ B2 ${mine.fits ? "넣음" : "뺌"}`); continue; }
    if (bSkip && !mine.fits && `${bSkip.line} ${bSkip.how}` !== mine.say) diff.push(`${ch}·${sec}초 문장: «${bSkip.line} ${bSkip.how}» ↔ «${mine.say}»`);
  }
  T.ok(`② B reuseFit ↔ B2 videoFitsChannel — ${pairs}쌍에서 «뺀다/넣는다»와 문장이 같다`, diff.length === 0 && pairs > 0, diff.slice(0, 3).join(" / "));
  counts["B↔B2 문장"] = `${pairs}쌍 · 어긋남 ${diff.length}`;
}

/* ═══ ③ 여유 1초 = 심사 축 ═══ */
say("■ ③ 여유 1초 = 심사 축(`duration_fit`)과 같은 선");
{
  const judge = read("lib/video/judge.ts");
  T.ok("③ `FIT_TOLERANCE_MS` = 1000", FIT.FIT_TOLERANCE_MS === 1000);
  if (!judge) T.unmeasured("③ judge.ts", "파일이 없다");
  else T.ok("③ 심사 축이 «≤ (maxSeconds + 1) × 1000» 을 쓴다(같은 선)", /dur <= \(p\.out\.maxSeconds \+ 1\) \* 1000/.test(judge));
}

/* ═══ ④ 세 겹이 러너 전에 ═══ */
say("■ ④ 🔴 세 겹이 **러너 전에** 선다");
type Src = Record<"IDX" | "DS" | "REUSE" | "BG", string>;
const FILES_OF: Record<keyof Src, string> = { IDX: "lib/publish/index.ts", DS: "lib/derived-schedule.ts", REUSE: "lib/video/reuse.ts", BG: "netlify/functions/publish-video-background.ts" };
const pub = (s: Src) => blockOf(s.IDX, "export async function publish(", ["\nexport function publishViaOf("])?.body ?? null;
const RULES: { key: string; name: string; judge: (s: Src) => boolean | null }[] = [
  { key: "reuse-go", name: "㉮ B `deriveVideoPieces` 가 `reuseFit` 을 부르고 **`fit.go` 만** 만든다(빠진 채널은 파생 0)",
    judge: (s) => { const b = blockOf(s.REUSE, "export async function deriveVideoPieces(", ["\nexport async function "])?.body; return b == null ? null : /reuseFit\(/.test(b) && /for \(const g of fit\.go\)/.test(b); } },
  { key: "sched", name: "㉯ `scheduleDerived` 가 박기 **전에** 길이를 잰다(`triageFresh` → `videoFitsChannel`)",
    judge: (s) => { const b = blockOf(s.DS, "export async function scheduleDerived(", ["\nexport async function restaggerFamily("])?.body; const tf = blockOf(s.DS, "export function triageFresh(", ["\n}\n"])?.body;
      return b == null || tf == null ? null : /videoFitsChannel\(/.test(tf) && (orderIn(b, /triageFresh\(/, /UPDATE pieces SET status = 'scheduled', scheduled_for/)?.ok ?? false); } },
  { key: "pub-runner", name: "㉰ `publish()` 가 러너 잡(`enqueueRunnerJob`)보다 **앞**에서 잰다",
    judge: (s) => { const b = pub(s); return b == null ? null : orderIn(b, /videoFitsChannel\(/, /enqueueRunnerJob\(/)?.ok ?? false; } },
  { key: "pub-api", name: "㉰ `publish()` 가 API 커넥터(`API_CONNECTORS[`)보다 **앞**에서 잰다",
    judge: (s) => { const b = pub(s); return b == null ? null : orderIn(b, /videoFitsChannel\(/, /API_CONNECTORS\[/)?.ok ?? false; } },
  { key: "pub-account", name: "㉰ `publish()` 가 계정 검사(`if (!account)`)보다 **앞**에서 잰다(계정이 없어도 «직접 올려 주세요»로 안 보낸다)",
    judge: (s) => { const b = pub(s); return b == null ? null : orderIn(b, /videoFitsChannel\(/, /if \(!account\)/)?.ok ?? false; } },
  { key: "pub-terminal", name: "㉰ 안 들어가면 `not_publishable` · `retriable:false` · `LENGTH_OVER_DETAIL` 로 돌려준다(다시 해도 같은 답)",
    judge: (s) => { const b = pub(s); return b == null ? null : /reason: "not_publishable", retriable: false, error: fit\.say, detail: `\$\{LENGTH_OVER_DETAIL\}/.test(b); } },
  { key: "bg-failed", name: "㉱ 배경 함수가 그 경우를 `awaiting_manual`(직접 올리기)이 아니라 `failed` 로 둔다",
    judge: (s) => /startsWith\(LENGTH_OVER_DETAIL\)/.test(s.BG) && /lengthOver \? "failed"/.test(s.BG) },
];
const missing = Object.values(FILES_OF).filter((f) => !existsSync(f));
const SRC: Src | null = missing.length ? null : Object.fromEntries(Object.entries(FILES_OF).map(([k, f]) => [k, stripComments(readFileSync(f, "utf8"))])) as Src;
if (!SRC) T.unmeasured("④ 파일", `없다: ${missing.join(", ")}`);
else for (const r of RULES) { const v = r.judge(SRC); if (v === null) T.unmeasured(`④ ${r.name}`, "덩이를 못 잡았다"); else T.ok(`④ ${r.name}`, v); }
/* 발행 잡을 쌓는 곳이 `publish()` 한 곳뿐인가 — 다른 곳에서 `publish.*` 잡을 쌓으면 ㉰를 비껴간다. 모수를 찍는다. */
{
  const files: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d)) { const p = path.join(d, e); if (statSync(p).isDirectory()) { if (e !== "node_modules") walk(p); } else if (/\.ts$/.test(e)) files.push(p.replace(/\\/g, "/")); } };
  walk("lib"); walk("netlify");
  /* 🔴 **올리기 잡**만 겨눈다 — 목록은 제품의 채널 표(`jobKind`)에서 받는다. 처음엔 `kind: "publish.` 로 넓게 잡아
     `publish.retract`(**내리기** 잡 · `lib/publish/retract.ts`)를 올리기로 읽고 거짓 빨강을 냈다(AC-141 «넓게 보면 틀린 것을 본다»). */
  const UPLOAD_KINDS = new Set(CHANNELS.map((c) => c.jobKind).filter((k): k is string => !!k));
  /** 한 파일의 적재 호출 수와 «올리기 잡» 적재 목록 — 🔴 아래 합성 조각으로 **이 함수가 무는지** 먼저 대 본다(AC-236). */
  const uploadSitesIn = (t: string): { sites: number; uploads: string[] } => {
    let sites = 0; const uploads: string[] = [];
    for (const m of t.matchAll(/\benqueue(?:Runner)?Job\(\s*(?:tid,\s*)?\{/g)) {
      const arg = blockOf(t.slice(m.index!), m[0], ["});", "})"], { unique: false, maxChars: 800 })?.body ?? t.slice(m.index!, m.index! + 400);
      sites++;
      const lit = arg.match(/kind:\s*"([a-z_.]+)"/)?.[1];
      if ((lit && UPLOAD_KINDS.has(lit)) || (/\bkind,/.test(arg) && /publishJobKindOf/.test(t))) uploads.push(lit ?? "kind");
    }
    return { sites, uploads };
  };
  const probeHit = uploadSitesIn('await enqueueJob({ tenantId: 1, kind: "publish.naver_clip", pieceId: 2 });');
  const probeMiss = uploadSitesIn('await enqueueJob({ tenantId: 1, kind: "publish.retract", pieceId: 2 });');
  T.ok("④ 적재 검사기가 합성 «클립 올리기 잡»은 물고 «내리기 잡»은 안 문다(검사기의 과녁이 산다)", probeHit.uploads.length === 1 && probeMiss.uploads.length === 0 && probeMiss.sites === 1);
  let sites = 0; const outside: string[] = [];
  for (const f of files) {
    const r = uploadSitesIn(read(f) ?? "");
    sites += r.sites;
    if (r.uploads.length && f !== "lib/publish/index.ts") outside.push(`${f}(${r.uploads.join(",")})`);
  }
  T.ok(`④ 올리기 잡(${[...UPLOAD_KINDS].join("·")})을 쌓는 곳 = lib/publish/index.ts 한 곳(적재 호출 ${sites}곳 · ts ${files.length}파일 중)`, outside.length === 0 && sites > 0, outside.join(", "));
  T.ok("④ 네이버 클립의 잡 이름이 그 목록에 있다(과녁이 산다)", UPLOAD_KINDS.has("publish.naver_clip"));
  counts["적재 호출"] = `ts ${files.length}파일 · enqueue 호출 ${sites}곳 · 올리기 잡을 publish() 밖에서 쌓는 곳 ${outside.length}`;
}

/* ═══ ⑤ 변이 ═══ */
say("■ ⑤ 🔴 변이 — 소스 사본(임시 폴더)을 틀어 ①표가 우는가 · 경로를 틀어 ④가 우는가");
let srcCaught = 0, pathCaught = 0;
const SRC_MUTANTS: { name: string; from: RegExp; to: string }[] = [
  { name: "여유를 없앤다(`+ FIT_TOLERANCE_MS` 삭제)", from: /\s*\+\s*FIT_TOLERANCE_MS\)/, to: ")" },
  { name: "상한을 못 읽는다(`channelMaxSec` 이 늘 null)", from: /return Number\.isFinite\(v\) && v > 0 \? v : null;/, to: "return null;" },
  { name: "모르면 막는다(`!measured` → 안 들어간다)", from: /if \(!measured\) return \{ fits: true, measured: false, maxSec \};/, to: "if (!measured) return { fits: false, measured: true, maxSec, sec: 0, say: \"x\" } as never;" },
  { name: "초/밀리초를 헷갈린다(`maxSec * 1000` → `maxSec * 100`)", from: /maxSec \* 1000/, to: "maxSec * 100" },
];
{
  const orig = readFileSync("lib/publish/video-fit.ts", "utf8");
  const abs = (rel: string) => pathToFileURL(path.resolve("lib", rel)).href;
  /* 🔴 사본은 **임시 폴더**에만 쓴다(제품 폴더에 흔적 0) — 상대 수입을 절대 주소로 바꿔 같은 모듈을 부른다. */
  const rewired = orig
    .replace(/from "\.\.\/writing-contracts"/, `from "${abs("writing-contracts.ts")}"`)
    .replace(/from "\.\.\/video\/types"/, `from "${abs("video/types.ts")}"`)
    .replace(/from "\.\.\/channel-url"/, `from "${abs("channel-url.ts")}"`);
  const dir = mkdtempSync(path.join(os.tmpdir(), "r18-fit-"));
  try {
    /* 과녁이 살아 있나(AC-236) — **안 튼 사본**이 표를 통과해야 변이가 «운다»를 믿을 수 있다. */
    const base = path.join(dir, "base.ts"); writeFileSync(base, rewired);
    const baseMod = await import(pathToFileURL(base).href) as FitMod;
    const baseMiss = tableMisses(baseMod);
    T.ok("⑤ 안 튼 사본은 표를 통과한다(사본을 부르는 길이 산다)", baseMiss.length === 0, baseMiss.join(" / "));
    for (const [i, m] of SRC_MUTANTS.entries()) {
      if (!m.from.test(rewired)) { T.unmeasured(`⑤ 소스 «${m.name}»`, "변이할 글자가 video-fit.ts 에 없다"); continue; }
      const f = path.join(dir, `m${i}.ts`); writeFileSync(f, rewired.replace(m.from, m.to));
      const mod = await import(pathToFileURL(f).href) as FitMod;
      const miss = tableMisses(mod);
      T.ok(`⑤ 소스 «${m.name}» → ①표가 운다(${miss.length}행)`, miss.length > 0, "안 울었다");
      if (miss.length) srcCaught++;
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }

  const PATH_MUTANTS: { name: string; file: keyof Src; from: RegExp; to: string; rule: string }[] = [
    { name: "publish() 의 길이 검사를 러너 잡 뒤로 민다(검사 삭제)", file: "IDX", from: /const fit = videoFitsChannel\(piece\.channel, piece\.videoDurationMs\);/, to: "const fit = { fits: true } as const;", rule: "pub-runner" },
    { name: "B 가 빠진 채널까지 만든다(`fit.go` → 전 대상)", file: "REUSE", from: /for \(const g of fit\.go\)/, to: "for (const g of [...fit.go, ...fit.skip])", rule: "reuse-go" },
    { name: "배경 함수가 길이도 «직접 올리기»로 보낸다", file: "BG", from: /lengthOver \? "failed"/, to: "false ? \"failed\"", rule: "bg-failed" },
  ];
  if (SRC) for (const m of PATH_MUTANTS) {
    if (!m.from.test(SRC[m.file])) { T.unmeasured(`⑤ 경로 «${m.name}»`, `변이할 글자가 ${FILES_OF[m.file]} 에 없다`); continue; }
    const mutated: Src = { ...SRC, [m.file]: SRC[m.file].replace(m.from, m.to) };
    const v = RULES.find((r) => r.key === m.rule)!.judge(mutated);
    T.ok(`⑤ 경로 «${m.name}» → ④ «${m.rule}» 가 운다`, v === false, `판정 ${v}`);
    if (v === false) pathCaught++;
  }
  counts["변이"] = `소스 ${srcCaught}/${SRC_MUTANTS.length} · 경로 ${pathCaught}/3 물었다`;
}

const code = T.done("verify-r18-clip-length");
console.log("\n  ── 검산 수(무엇을 · 어디서 · 몇) ──");
for (const [k, v] of Object.entries(counts)) console.log(`   · ${k}: ${v}`);
console.log("   · 범위: 순수 함수(B2 videoFitsChannel · B reuseFit) + 소스(publish·편성·reuse·배경 함수) — 러너 스텁의 실제 거절은 이 자 밖(러너가 안 받으니 잴 것이 없다)");
process.exit(code);
