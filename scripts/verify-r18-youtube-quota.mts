/**
 * scripts/verify-r18-youtube-quota.mts — 🔴 **영상 재사용 때문에 유튜브 쿼터가 늘어나는 길이 없는가**(R18 · B2 · 2026-09-26 · 트리거 §3·§6-4)
 *   사용: npx --yes tsx scripts/verify-r18-youtube-quota.mts          · DB 0 · 네트워크 0
 *
 *   ══ 왜 ══
 *     유튜브 업로드(`videos.insert` 1,600u)는 **구글 프로젝트 하나의 하루 통**이다(설계 §2.2 · 운영 기본 5건).
 *     한 영상을 여러 곳에 보내면서 유튜브에 **두 번** 보내면 — 쇼츠가 하나 더 생기고(세로 3분 이하는 전부 쇼츠) 통을 두 배로 먹는다.
 *     그리고 그 수는 **`youtubeDailyCap()` 하나뿐인 문**에서만 나와야 한다(R17-B2 · 여기 말고 5 를 적는 곳이 생기면 둘이 갈린다).
 *
 *   ══ 재는 것 ══
 *     ① 하나뿐인 문 — `YOUTUBE_DAILY_INSERT_CAP`·업로드 주소가 `lib/publish/youtube.ts` **밖 0곳** · 편성이 5 를 베끼지 않고 `youtubeDailyCap()` 을 부른다
 *     ② 쿼터 회로 순서 — `publishYoutube` 가 **올리기 전에** `todayUploads` 로 센다(맞고 나서 배우지 않는다)
 *     ③ 한 통 — «유튜브 채널» 목록 넷이 **글자 그대로 같다**: `todayUploads` SQL · `YOUTUBE_CHANNELS`(편성) · 커넥터 표 · 채널 표
 *     ④ 🔴 가족당 유튜브 ≤ 1 — B `reuseFit` 을 **모든 원본 채널 × 15/30/60/90 × 전 대상**으로 돌린다 + B2 `triageFresh`(둘째 줄)
 *     ⑤ 🔴 변이 — ④의 검사기가 **B 의 계약 v1 규칙**(«원본 채널 자신만 뺀다»)을 **무는가**(그 규칙이 실제로 새던 병이다)
 *
 *   ⚠️ 이 자가 **못 보는 것**(범위를 말한다 · AC-262): 실제 업로드 수(라이브 posts) · 구글이 돌려준 쿼터 오류. 그건 발행 후 `posts` 로 센다.
 *   종료코드: 0 = 지켜진다 · 1 = 어긋난다 · 2 = 못 쟀다.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { reuseFit, reuseTargetsFor, VIDEO_REUSE_TARGETS } from "../lib/video/reuse";
import { YOUTUBE_CHANNELS, isYoutubeChannel, triageFresh } from "../lib/derived-schedule";
import { CHANNELS } from "../lib/channel-registry";
import { VIDEO_SECONDS } from "../lib/video/types";
import { stripComments, blockOf, orderIn, tally } from "./_lib/block.mjs";

const T = tally();
const counts: Record<string, string> = {};
const say = (s: string) => console.log(s);
const read = (f: string) => existsSync(f) ? stripComments(readFileSync(f, "utf8")) : null;
const YT = "lib/publish/youtube.ts", DS = "lib/derived-schedule.ts", IDX = "lib/publish/index.ts";

/** 코드 파일 전부(lib·netlify·runner·public) — 🔴 모수를 찍는다(«몇 개를 봤나»). node_modules·dist 제외. */
function codeFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|mts|mjs|js|html)$/.test(e)) out.push(p.replace(/\\/g, "/"));
    }
  };
  for (const r of ["lib", "netlify", "runner", "public"]) if (existsSync(r)) walk(r);
  return out;
}

/* ═══ ① 하나뿐인 문 ═══ */
say("■ ① 하나뿐인 문 — 유튜브 하루 수는 `youtubeDailyCap()` 에서만 나온다");
{
  const files = codeFiles();
  const envHits = files.filter((f) => /YOUTUBE_DAILY_INSERT_CAP/.test(read(f) ?? ""));
  const urlHits = files.filter((f) => /upload\/youtube\/v3\/videos/.test(read(f) ?? ""));
  T.ok(`① env \`YOUTUBE_DAILY_INSERT_CAP\` 을 읽는 코드 = ${YT} 한 곳(코드 파일 ${files.length}개 중)`, envHits.length === 1 && envHits[0] === YT, envHits.join(", "));
  T.ok(`① 유튜브 업로드 주소 = ${YT} 한 곳(다른 길로 올리는 코드 0)`, urlHits.length === 1 && urlHits[0] === YT, urlHits.join(", "));
  const ds = read(DS);
  if (!ds) T.unmeasured("① 편성 파일", `${DS} 가 없다`);
  else {
    T.ok("① 편성이 유튜브 통을 `youtubeDailyCap()` 으로 잰다", /cap:\s*\(\)\s*=>\s*youtubeDailyCap\(\)/.test(ds));
    T.ok("① 편성에 유튜브 하루 수를 **숫자로** 적은 곳 0(`cap: () => 5` 같은 베낌)", !/cap:\s*\(\)\s*=>\s*\d/.test(ds));
  }
  counts["문"] = `코드 파일 ${files.length}개 중 env ${envHits.length}곳 · 업로드 주소 ${urlHits.length}곳`;
}

/* ═══ ② 쿼터 회로 순서 ═══ */
say("■ ② 쿼터 회로 — 올리기 **전에** 센다");
{
  const yt = read(YT);
  const b = yt ? blockOf(yt, "export async function publishYoutube(", ["\nexport const publishYoutubeShorts"])?.body ?? null : null;
  T.okOr("② `publishYoutube` 가 첫 `fetch(` 보다 앞에서 `todayUploads(` 로 센다", b, (x) => orderIn(x, /todayUploads\(/, /fetch\(/)?.ok ?? false);
  T.okOr("② 센 수를 `DAILY_CAP` 과 견주고 넘으면 **올리지 않고** 돌아간다(retriable)", b, (x) => /if \(used >= DAILY_CAP\)\s*\{[\s\S]{0,300}?retriable: true/.test(x));
  const idx = read(IDX);
  const conn = idx ? blockOf(idx, "const API_CONNECTORS", ["\n};"])?.body ?? null : null;
  T.okOr("② 유튜브 커넥터 둘 다 `publishYoutube*` 로 간다(회로를 비껴가는 커넥터 0)", conn,
    (x) => /youtube_shorts:\s*publishYoutubeShorts/.test(x) && /youtube_long:\s*publishYoutubeLong/.test(x));
}

/* ═══ ③ 한 통 — 목록 넷이 같다 ═══ */
say("■ ③ 한 통 — «유튜브 채널» 목록 넷이 글자 그대로 같다");
{
  const yt = read(YT);
  const tu = yt ? blockOf(yt, "async function todayUploads(", ["\n}"])?.body ?? null : null;
  const sqlList = tu ? [...(tu.match(/channel IN \(([^)]*)\)/)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort() : null;
  const idx = read(IDX);
  const conn = idx ? blockOf(idx, "const API_CONNECTORS", ["\n};"])?.body ?? null : null;
  const connList = conn ? [...conn.matchAll(/([a-z_]+):\s*publishYoutube/g)].map((m) => m[1]).sort() : null;
  const regList = CHANNELS.filter((c) => c.key.startsWith("youtube")).map((c) => c.key).sort();
  const dsList = [...YOUTUBE_CHANNELS].sort();
  if (!sqlList?.length || !connList?.length) T.unmeasured("③ 목록", "todayUploads SQL 또는 커넥터 표를 못 읽었다");
  else {
    const same = (a: string[]) => JSON.stringify(a) === JSON.stringify(regList);
    T.ok(`③ todayUploads SQL [${sqlList}] = 채널 표 [${regList}]`, same(sqlList));
    T.ok(`③ 편성 YOUTUBE_CHANNELS [${dsList}] = 채널 표`, same(dsList));
    T.ok(`③ 커넥터 표의 publishYoutube* [${connList}] = 채널 표`, same(connList));
  }
}

/* ═══ ④ 가족당 유튜브 ≤ 1 ═══ */
say("■ ④ 🔴 가족당 유튜브 ≤ 1 — B `reuseFit` 전수 + B2 `triageFresh`");
type Fit = (i: { originChannel: string; seconds: 15 | 30 | 60 | 90; channels: readonly string[] }) => { go: { channel: string }[]; skip: { channel: string }[] };
/** 🔴 이 함수가 «자»다 — ⑤ 변이가 같은 함수를 쓴다. 위반 목록을 돌려준다. */
function familyYoutubeViolations(fit: Fit, origins: string[]): { cases: number; bad: string[] } {
  const bad: string[] = []; let cases = 0;
  const ask = [...new Set([...VIDEO_REUSE_TARGETS, "youtube_long", "youtube_shorts", "threads"])];
  for (const o of origins) for (const s of VIDEO_SECONDS) {
    cases++;
    const r = fit({ originChannel: o, seconds: s, channels: ask });
    const ytGo = r.go.filter((g) => isYoutubeChannel(g.channel)).length;
    const total = ytGo + (isYoutubeChannel(o) ? 1 : 0);
    if (total > 1) bad.push(`${o}·${s}초 → 가족 유튜브 ${total}건(${r.go.map((g) => g.channel).join(",")})`);
    if ([...r.go, ...r.skip].some((x) => x.channel === "youtube_long")) bad.push(`${o}·${s}초 → youtube_long 이 목록에 떴다`);
  }
  return { cases, bad };
}
const ORIGINS = [...new Set([...CHANNELS.filter((c) => c.axis === "video").map((c) => c.key), ...VIDEO_REUSE_TARGETS, "youtube_long"])];
{
  const r = familyYoutubeViolations(reuseFit as unknown as Fit, ORIGINS);
  T.ok(`④ B reuseFit — 원본 ${ORIGINS.length}채널 × 길이 ${VIDEO_SECONDS.length} = ${r.cases}판 · 가족 유튜브 > 1 인 판 0 · youtube_long 이 뜬 판 0`, r.bad.length === 0, r.bad.slice(0, 3).join(" / "));
  T.ok("④ youtube_long 은 재사용 대상 후보에 **없다**(트리거 §3 · 없는 길)", !VIDEO_REUSE_TARGETS.includes("youtube_long"));
  T.ok("④ 원본이 youtube_long 이면 후보에 youtube_* 0개(B 계약 v1 의 구멍 · B2 지적으로 닫힘)", reuseTargetsFor("youtube_long").every((c) => !isYoutubeChannel(c)), reuseTargetsFor("youtube_long").join(","));
  counts["reuseFit 전수"] = `원본 ${ORIGINS.length} × 길이 ${VIDEO_SECONDS.length} = ${r.cases}판 · 위반 ${r.bad.length}`;

  /* B2 둘째 줄 — B 가 새서 넘겨도 편성에서 한 번 더 거른다. */
  const f = (id: number, ch: string, ms = 30_000) => ({ pieceId: id, channel: ch, durationMs: ms });
  const t1 = triageFresh("youtube_long", [], [f(1, "youtube_shorts"), f(2, "reels")]);
  T.ok("④ triageFresh — 원본이 youtube_long 이면 youtube_shorts 파생은 빠진다(`youtube_twice`)", t1.drop.some((d) => d.pieceId === 1 && d.why === "youtube_twice") && t1.keep.some((k) => k.pieceId === 2));
  const t2 = triageFresh("reels", [], [f(1, "youtube_shorts"), f(2, "youtube_long"), f(3, "tiktok")]);
  T.ok("④ triageFresh — 원본이 유튜브가 아니면 **첫 한 건만** 남는다", t2.keep.filter((k) => isYoutubeChannel(k.channel)).length === 1 && t2.drop.filter((d) => d.why === "youtube_twice").length === 1);
  const t3 = triageFresh("reels", ["youtube_shorts"], [f(1, "youtube_shorts")]);
  T.ok("④ triageFresh — 이미 자리를 가진 유튜브 형제가 있으면 새 유튜브 파생은 빠진다", t3.drop.length === 1 && t3.keep.length === 0);
  const t4 = triageFresh("reels", [], [f(1, "youtube_shorts", 90_000), f(2, "youtube_long", 30_000)]);
  T.ok("④ triageFresh — 길이로 빠진 유튜브 파생은 유튜브 자리를 **안 먹는다**(순서: 길이 먼저)",
    t4.drop.some((d) => d.pieceId === 1 && d.why === "too_long") && t4.keep.some((k) => k.pieceId === 2));
  const t5 = triageFresh("youtube_shorts", [], [f(1, "reels"), f(2, "tiktok"), f(3, "naver_clip", 30_000)]);
  T.ok("④ triageFresh — 유튜브가 아닌 파생은 건드리지 않는다", t5.keep.length === 3 && t5.drop.length === 0);
  T.ok("④ 빠진 까닭 문장에 «실패·오류·불가» 0(§3 말투)", [...t1.drop, ...t2.drop, ...t3.drop].every((d) => !/실패|오류|불가|정지|불이익/.test(d.say)));

  /* 편성이 그 둘째 줄을 실제로 부른다(부르지 않으면 순수 함수가 아무리 맞아도 소용없다). */
  const ds = read(DS);
  const sd = ds ? blockOf(ds, "export async function scheduleDerived(", ["\nexport async function restaggerFamily("])?.body ?? null : null;
  T.okOr("④ `scheduleDerived` 가 박기 **전에** `triageFresh` 를 부르고 빠진 것을 `failed` + 감사 high 로 둔다", sd,
    (b) => (orderIn(b, /triageFresh\(/, /UPDATE pieces SET status = 'scheduled', scheduled_for/)?.ok ?? false) && /dropDerived\(/.test(b));
}

/* ═══ ⑤ 변이 — B 의 계약 v1 규칙을 무는가 ═══ */
say("■ ⑤ 🔴 변이 — ④ 검사기가 **실제로 새던 규칙**을 무는가(AC-236 · 과녁이 산다)");
let caught = 0; const MUT = 3;
{
  const mkFit = (targetsFor: (o: string) => string[]): Fit => (i) => {
    const go: { channel: string }[] = [];
    for (const c of targetsFor(i.originChannel)) if (i.channels.includes(c)) go.push({ channel: c });
    return { go, skip: [] };
  };
  // M1 = B 계약 v1: «원본 채널 자신만 뺀다» — youtube_long 원본에서 youtube_shorts 가 남는다
  const m1 = familyYoutubeViolations(mkFit((o) => VIDEO_REUSE_TARGETS.filter((c) => c !== o)), ORIGINS);
  T.ok("⑤ M1 «원본 채널 자신만 뺀다»(B 계약 v1)를 문다 — youtube_long 원본 판에서 운다", m1.bad.some((b) => b.startsWith("youtube_long")), m1.bad[0] ?? "안 울었다");
  if (m1.bad.length) caught++;
  // M2 = youtube_long 을 후보에 넣는다
  const m2 = familyYoutubeViolations(mkFit((o) => [...VIDEO_REUSE_TARGETS, "youtube_long"].filter((c) => c !== o)), ORIGINS);
  T.ok("⑤ M2 «youtube_long 을 후보에 넣는다»를 문다", m2.bad.length > 0, m2.bad[0] ?? "안 울었다");
  if (m2.bad.length) caught++;
  // M3 = 아무것도 안 뺀다(원본 채널까지 대상)
  const m3 = familyYoutubeViolations(mkFit(() => [...VIDEO_REUSE_TARGETS]), ORIGINS);
  T.ok("⑤ M3 «원본도 안 뺀다»를 문다", m3.bad.length > 0, m3.bad[0] ?? "안 울었다");
  if (m3.bad.length) caught++;
  counts["변이"] = `${caught}/${MUT} 물었다`;
}

const code = T.done("verify-r18-youtube-quota");
console.log("\n  ── 검산 수(무엇을 · 어디서 · 몇) ──");
for (const [k, v] of Object.entries(counts)) console.log(`   · ${k}: ${v}`);
console.log("   · 범위: 소스(lib·netlify·runner·public 코드 파일) + 순수 함수(B reuseFit · B2 triageFresh) — 라이브 업로드 수는 이 자 밖(posts 로 센다)");
process.exit(code);
