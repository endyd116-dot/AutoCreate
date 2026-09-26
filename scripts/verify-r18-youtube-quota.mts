/**
 * scripts/verify-r18-youtube-quota.mts — 🔴 **영상 재사용 때문에 유튜브 쿼터가 늘어나는 길이 없는가**(R18 · B2 · 2026-09-26 · 트리거 §3·§6-4)
 *   사용: npx --yes tsx scripts/verify-r18-youtube-quota.mts          · DB 0 · 네트워크 0
 *
 *   ══ 왜 ══
 *     유튜브 업로드는 **구글 프로젝트(= 우리 OAuth 앱) 하나의 하루 통 100건**이다(설계 §2.2 · R19 · 사장님 결정 2026-09-27).
 *     한 영상을 여러 곳에 보내면서 유튜브에 **두 번** 보내면 — 쇼츠가 하나 더 생기고(세로 3분 이하는 전부 쇼츠) 통을 두 배로 먹는다.
 *     그리고 그 수는 **`youtubeDailyCap()` 하나뿐인 문**에서만 나와야 한다(R17-B2 · 여기 말고 수를 적는 곳이 생기면 둘이 갈린다).
 *
 *   ══ 재는 것 ══
 *     ① 하나뿐인 문 — `YOUTUBE_DAILY_INSERT_CAP`·업로드 주소가 `lib/publish/youtube.ts` **밖 0곳** · 편성이 수를 베끼지 않고 `youtubeDailyCap()` 을 부른다 · 기본값 100
 *     ② 🔴 [R19] 세는 법 — `insertCallsLast24h` 가 **프로젝트 전체**(tenant_id 0) · **24시간 굴림**(date_trunc·KST 0) · `noteInsertCall` 이
 *        `videos.insert` 를 부르는 **유일한 자리(`start`) 안 fetch 직전** · 올리기 전에 센다 · 🔴 `posts` 를 안 읽는다(AC-266) ·
 *        배경 함수를 부르기 **전** 문(`publish-one`)도 같은 함수로 세고 시도 횟수를 안 늘린다
 *     ③ 한 통 — «유튜브 채널» 목록이 **한 벌**이다: `youtube.ts YOUTUBE_CHANNELS`(정본) = 편성이 내보내는 것(같은 객체) = 커넥터 표 = 채널 표
 *     ④ 🔴 가족당 유튜브 ≤ 1 — B `reuseFit` 을 **모든 원본 채널 × 모든 길이 × 전 대상**으로 돌린다 + B2 `triageFresh`(둘째 줄)
 *     ⑤ 🔴 변이 — ④의 검사기가 **B 의 계약 v1 규칙**(«원본 채널 자신만 뺀다»)을 **무는가**(그 규칙이 실제로 새던 병이다)
 *     ⑥ [R19] 말 — 찬 날의 말·계정 화면 한 줄 = 글자표 그대로(숫자 0 · 나눠 쓰는 수 · §4.6) · 서버 코드에 `dailyPublishCap` 0
 *     ⑦ 🔴 [R19] 변이 — ② 판정기가 **글자를 바꿔 넣은 소스**에서 운다(집 조건 · KST 달력 · 기록 빼기 · 성공 뒤에만 세기 · 수 되넣기 ·
 *        posts 되살리기 · 배경 전 문 빼기 · 그 문이 시도 횟수 쓰기). 🔴 **파일은 안 건드린다** — 메모리에서 글자만 바꿔
 *        같은 판정기에 넣는다(AC-276 · 다른 자와 나란히 돌아도 정본이 안 변한다).
 *
 *   ⚠️ 이 자가 **못 보는 것**(범위를 말한다 · AC-262): 실제 호출 수(라이브 audit_logs) · 구글이 돌려준 쿼터 오류 · 화면(`public/` — A 몫 · C 가 잰다).
 *      라이브 한 바퀴(시드 집 · fetch 스텁)는 `scripts/verify-r19-threads-derived-live.mts` ⑥⑦ 이 잰다.
 *   종료코드: 0 = 지켜진다 · 1 = 어긋난다 · 2 = 못 쟀다.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { reuseFit, reuseTargetsFor, VIDEO_REUSE_TARGETS } from "../lib/video/reuse";
import { YOUTUBE_CHANNELS, isYoutubeChannel, triageFresh } from "../lib/derived-schedule";
import { YOUTUBE_CHANNELS as YT_CHANNELS_CANON, YOUTUBE_FULL_SAY, YOUTUBE_LIMIT_NOTE, youtubeDailyCap } from "../lib/publish/youtube";
import { CHANNELS } from "../lib/channel-registry";
import { VIDEO_SECONDS } from "../lib/video/types";
import { stripComments, blockOf, orderIn, tally } from "./_lib/block.mjs";

const T = tally();
const counts: Record<string, string> = {};
const say = (s: string) => console.log(s);
const read = (f: string) => existsSync(f) ? stripComments(readFileSync(f, "utf8")) : null;
const YT = "lib/publish/youtube.ts", DS = "lib/derived-schedule.ts", IDX = "lib/publish/index.ts", PO = "lib/publish-one.ts", ACC = "lib/accounts.ts";

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
    T.ok("① 편성에 유튜브 하루 수를 **숫자로** 적은 곳 0(`cap: () => 100` 같은 베낌)", !/cap:\s*\(\)\s*=>\s*\d/.test(ds));
  }
  /* [R19] 기본값은 설계 §2.2 의 100 — env 가 없으면(넷리파이엔 없다) 이 값이 산다. */
  const dflt = read(YT)?.match(/YOUTUBE_DAILY_INSERT_CAP\)\s*\|\|\s*(\d+)\)/)?.[1] ?? null;
  const envSet = !!process.env.YOUTUBE_DAILY_INSERT_CAP;
  if (dflt == null) T.unmeasured("① 기본값", "`|| N` 을 못 찾았다");
  else T.ok(`① 기본값 = 100(설계 §2.2 · 옛 5 아님) — 소스 ${dflt} · youtubeDailyCap() ${envSet ? "(env 가 있어 값 비교는 건너뜀)" : youtubeDailyCap()}`,
    dflt === "100" && (envSet || youtubeDailyCap() === 100));
  counts["문"] = `코드 파일 ${files.length}개 중 env ${envHits.length}곳 · 업로드 주소 ${urlHits.length}곳`;
}

/* ═══ ② [R19] 세는 법 ═══ */
/**
 * 🔴 판정기 — 소스 글자(주석 걷음)를 받아 판정 목록을 낸다. ⑦ 변이가 **같은 함수**에 바꾼 글자를 넣는다.
 *   `ok: null` = 덩이를 못 잡았다(⊘ · «맞다»로 세지 않는다 · AC-216).
 */
type Verdict = { key: string; name: string; ok: boolean | null };
function judgeCount(yt: string | null, po: string | null): Verdict[] {
  const v: Verdict[] = [];
  const blk = (text: string | null, anchor: string, enders: string[]) => (text ? blockOf(text, anchor, enders)?.body ?? null : null);
  const has = (x: string | null, f: (t: string) => boolean): boolean | null => (x == null ? null : f(x));
  const pub = blk(yt, "export async function publishYoutube(", ["\nexport const publishYoutubeShorts"]);
  const cnt = blk(yt, "export async function insertCallsLast24h(", ["\n}"]);
  const note = blk(yt, "export async function noteInsertCall(", ["\n}"]);
  const full = blk(yt, "export async function youtubeFullNow(", ["\n}"]);
  const start = blk(pub, "const start = async (", ["\n  };"]);
  const sqlTxt = cnt?.match(/sql`([^`]*)`/)?.[1] ?? null;
  v.push({ key: "project", name: "r19.yt.project — 세는 SQL 이 audit_logs · `tenant_id` 조건 0(프로젝트 전체 · §4.6 예외 «수만 합친다»)",
    ok: has(sqlTxt, (t) => /FROM audit_logs/.test(t) && !/tenant_id/.test(t)) });
  v.push({ key: "rolling", name: "r19.yt.rolling — 최근 24시간 굴림(`NOW() - interval '24 hours'`) · `date_trunc`·KST 달력 0",
    ok: has(sqlTxt, (t) => /created_at > NOW\(\) - interval '24 hours'/.test(t) && !/date_trunc|Asia\/Seoul/.test(t)) });
  const sqlAction = sqlTxt?.match(/action = '([^']+)'/)?.[1] ?? null;
  const noteAction = note?.match(/action:\s*"([^"]+)"/)?.[1] ?? null;
  v.push({ key: "action", name: "세는 글자 = 적는 글자(SQL 의 action = `noteInsertCall` 의 writeAudit action = 'youtube.insert_call')",
    ok: sqlAction == null || noteAction == null ? null : sqlAction === noteAction && sqlAction === "youtube.insert_call" });
  v.push({ key: "calls", name: "r19.yt.calls — `start` 안에서 `noteInsertCall(` 이 `fetch(uploadUrlWith(` **앞**(부를 때마다 · 실패 포함 · 성공 뒤에만 세지 않는다)",
    ok: start == null ? null : orderIn(start, /await noteInsertCall\(/, /fetch\(uploadUrlWith\(/)?.ok ?? false });
  v.push({ key: "one-door", name: "`fetch(uploadUrlWith(` 은 파일에 **한 곳** · 그것이 `start` 안(그래서 부르는 세 자리 — 첫 호출·401 재시도·유료 칸 빼고 — 가 전부 세어진다)",
    ok: yt == null ? null : (yt.match(/fetch\(uploadUrlWith\(/g) ?? []).length === 1 && !!start && /fetch\(uploadUrlWith\(/.test(start) });
  v.push({ key: "before", name: "`publishYoutube` 가 첫 `await start(` **앞**에서 `youtubeFullNow()` 로 센다(맞고 나서 배우지 않는다)",
    ok: pub == null ? null : orderIn(pub, /await youtubeFullNow\(\)/, /await start\(/)?.ok ?? false });
  v.push({ key: "full-return", name: "찼으면 **올리지 않고** 돌아간다 — retriable · 말 = `YOUTUBE_FULL_SAY`",
    ok: has(pub, (t) => /if \(room\.full\)\s*\{[\s\S]{0,200}?retriable: true, error: YOUTUBE_FULL_SAY/.test(t)) });
  v.push({ key: "no-posts", name: "🔴 AC-266 — `youtube.ts` 가 `posts` 를 안 읽는다(옛 `todayUploads` 는 없는 칸 `posts.created_at` 을 읽었다)",
    ok: has(yt, (t) => !/FROM posts/.test(t) && !/todayUploads/.test(t)) });
  v.push({ key: "soft", name: "세다 실패하면 «안 찼다»(§9 — 우리 장부 때문에 막지 않는다)",
    ok: has(full, (t) => /catch[\s\S]*full: false/.test(t)) });
  v.push({ key: "quota-say", name: "구글 `quotaExceeded` 도 같은 말(`YOUTUBE_FULL_SAY`) · `rateLimitExceeded`·429 는 «잠시 후»(내일이 아니다)",
    ok: has(yt, (t) => /why === "quotaExceeded"\)\s*\{\s*return \{[^}]*error: YOUTUBE_FULL_SAY/.test(t) && /why === "rateLimitExceeded" \|\| status === 429\)\s*\{\s*return \{[^}]*error: "[^"]*잠시 후/.test(t)) });
  v.push({ key: "say-no-num", name: "r19.yt.say — `error:` 템플릿에 센 수(`used`·`cap`·`room.`·`DAILY_CAP`) 0",
    ok: has(yt, (t) => !/error:\s*`[^`]*\$\{\s*(used|cap|room\.|DAILY_CAP)/.test(t)) });
  const fullSay = yt?.match(/export const YOUTUBE_FULL_SAY = "([^"]*)"/)?.[1] ?? null;
  const limitNote = yt?.match(/export const YOUTUBE_LIMIT_NOTE = "([^"]*)"/)?.[1] ?? null;
  v.push({ key: "say", name: "r19.yt.say — `YOUTUBE_FULL_SAY`·`YOUTUBE_LIMIT_NOTE` 에 숫자 0 · «실패·오류·불가·정지·불이익» 0(§3)",
    ok: fullSay == null || limitNote == null ? null : !/\d/.test(fullSay + limitNote) && !/실패|오류|불가|정지|불이익/.test(fullSay + limitNote) });
  const vb = blk(po, 'if (String(p.kind) === "video") {', ["\n  const r = await publishPiece("]);
  const fullBlk = blk(vb, "if (room.full) {", ["\n      }"]);
  v.push({ key: "pre-bg", name: "배경 함수 부르기 **전** 문(`publish-one`) — `youtubeFullNow()` 가 `triggerVideoPublish(` 앞(찬 동안 5분마다·글마다 배경 함수를 안 띄운다)",
    ok: vb == null ? null : orderIn(vb, /await youtubeFullNow\(\)/, /triggerVideoPublish\(/)?.ok ?? false });
  v.push({ key: "pre-bg-attempts", name: "그 문이 찼으면 `retry` + `YOUTUBE_FULL_SAY` · 🔴 `publishAttempts` 를 안 쓴다(우리 사정이 «직접 올려 주세요»로 새지 않게)",
    ok: has(fullBlk, (t) => /return \{ kind: "retry"/.test(t) && /YOUTUBE_FULL_SAY/.test(t) && !/publishAttempts:/.test(t)) });
  return v;
}
say("■ ② 🔴 [R19] 세는 법 — 프로젝트 전체 · 24시간 굴림 · 부른 횟수 · 올리기 전에");
const YT_SRC = read(YT), PO_SRC = read(PO);
for (const x of judgeCount(YT_SRC, PO_SRC)) (x.ok == null ? T.unmeasured(x.name, "덩이를 못 잡았다 — 닻이 바뀌었나") : T.ok(x.name, x.ok));
{
  const idx = read(IDX);
  const conn = idx ? blockOf(idx, "const API_CONNECTORS", ["\n};"])?.body ?? null : null;
  T.okOr("② 유튜브 커넥터 둘 다 `publishYoutube*` 로 간다(회로를 비껴가는 커넥터 0)", conn,
    (x) => /youtube_shorts:\s*publishYoutubeShorts/.test(x) && /youtube_long:\s*publishYoutubeLong/.test(x));
}

/* ═══ ③ 한 통 — 목록이 한 벌 ═══ */
say("■ ③ 한 통 — «유튜브 채널» 목록이 한 벌이다");
{
  const idx = read(IDX);
  const conn = idx ? blockOf(idx, "const API_CONNECTORS", ["\n};"])?.body ?? null : null;
  const connList = conn ? [...conn.matchAll(/([a-z_]+):\s*publishYoutube/g)].map((m) => m[1]).sort() : null;
  const regList = CHANNELS.filter((c) => c.key.startsWith("youtube")).map((c) => c.key).sort();
  const canon = [...YT_CHANNELS_CANON].sort();
  const same = (a: string[]) => JSON.stringify(a) === JSON.stringify(regList);
  if (!connList?.length) T.unmeasured("③ 목록", "커넥터 표를 못 읽었다");
  else {
    T.ok(`③ 정본 youtube.ts YOUTUBE_CHANNELS [${canon}] = 채널 표 [${regList}]`, same(canon));
    T.ok(`③ 커넥터 표의 publishYoutube* [${connList}] = 채널 표`, same(connList));
  }
  T.ok("③ 편성의 YOUTUBE_CHANNELS 는 정본을 **다시 내보낸 같은 객체**다(두 벌 0)", YOUTUBE_CHANNELS === YT_CHANNELS_CANON);
  T.okOr("③ 편성 소스에 유튜브 목록을 **다시 적은 곳** 0", read(DS),
    (x) => !/export const YOUTUBE_CHANNELS/.test(x) && !/\[\s*"youtube_shorts",\s*"youtube_long"\s*\]/.test(x));
  T.okOr("③ 계정 목록도 정본 판정(`isYoutubeChannel`)으로 가른다 — 채널 키를 손으로 다시 적은 곳 0", read(ACC),
    (x) => /isYoutubeChannel\(key\)\s*\?\s*\{\s*publishLimitNote:\s*YOUTUBE_LIMIT_NOTE/.test(x) && !/key === "youtube_shorts" \|\| key === "youtube_long"/.test(x));
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

/* ═══ ⑥ [R19] 말 — 계정 화면 한 줄 · 서버 응답 칸 ═══ */
say("■ ⑥ [R19] 말 — 숫자 없는 한 줄 · 서버 코드에 `dailyPublishCap` 0");
{
  T.ok("⑥ 찬 날의 말 = 글자표 그대로", YOUTUBE_FULL_SAY === "오늘은 유튜브에 올릴 수 있는 수가 다 찼어요. 내일 순서대로 이어서 올릴게요(따로 하실 건 없어요).");
  T.ok("⑥ 계정 화면 한 줄 = 글자표 그대로", YOUTUBE_LIMIT_NOTE === "유튜브는 하루에 올릴 수 있는 수가 정해져 있어요. 다 찬 날은 다음 날 순서대로 이어서 올려요.");
  const server = codeFiles().filter((f) => !f.startsWith("public/"));
  const capHits = server.filter((f) => /dailyPublishCap/.test(read(f) ?? ""));
  T.ok(`⑥ 서버 코드(lib·netlify·runner ${server.length}개)에 \`dailyPublishCap\` 0 — 나눠 쓰는 100 을 한 고객에게 «N개까지»로 싣지 않는다`, capHits.length === 0, capHits.join(", "));
  counts["말"] = `서버 코드 ${server.length}개 중 dailyPublishCap ${capHits.length}곳 · 화면(public)은 A 몫(C 가 잰다)`;
}

/* ═══ ⑦ [R19] 변이 — 글자를 바꿔 넣으면 ② 판정기가 운다 ═══ */
say("■ ⑦ 🔴 [R19] 변이 — ② 판정기가 **바꾼 글자**에서 운다(파일은 안 건드린다 · AC-276)");
{
  type Mut = { name: string; key: string; file: "yt" | "po"; from: RegExp | string; to: string };
  const MUTS: Mut[] = [
    { name: "M4 집 조건을 넣는다(`tenant_id = …`)", key: "project", file: "yt", from: "WHERE action = 'youtube.insert_call'", to: "WHERE tenant_id = ${tid} AND action = 'youtube.insert_call'" },
    { name: "M5 KST 달력으로 되돌린다(`date_trunc`)", key: "rolling", file: "yt", from: "created_at > NOW() - interval '24 hours'", to: "created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul')" },
    { name: "M6 부른 기록을 뺀다", key: "calls", file: "yt", from: "await noteInsertCall(tid, piece.id, channel);", to: "" },
    { name: "M7 성공 뒤에만 센다(fetch 뒤로)", key: "calls", file: "yt", from: /await noteInsertCall\(tid, piece\.id, channel\);([\s\S]*?let json: Record<string, unknown> \| null = null;)/, to: "$1 await noteInsertCall(tid, piece.id, channel);" },
    { name: "M8 찬 날의 말에 수를 되넣는다", key: "say-no-num", file: "yt", from: "retriable: true, error: YOUTUBE_FULL_SAY,\n      detail", to: "retriable: true, error: `다 올렸어요(${room.used}/${room.cap})`,\n      detail" },
    { name: "M9 찬 날의 말 상수에 숫자", key: "say", file: "yt", from: /export const YOUTUBE_FULL_SAY = "[^"]*"/, to: 'export const YOUTUBE_FULL_SAY = "오늘 100개를 다 올렸어요."' },
    { name: "M10 posts 로 세던 옛 줄을 되살린다", key: "no-posts", file: "yt", from: "export async function insertCallsLast24h(", to: "async function todayUploads(tid: number) { return q(sql`SELECT COUNT(*) c FROM posts WHERE tenant_id = ${tid}`); }\nexport async function insertCallsLast24h(" },
    { name: "M11 배경 전 문을 뺀다", key: "pre-bg", file: "po", from: "const room = await youtubeFullNow();", to: "const room = { full: false };" },
    { name: "M12 배경 전 문이 시도 횟수를 쓴다", key: "pre-bg-attempts", file: "po", from: /(if \(room\.full\) \{)/, to: "$1\n        await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ publishAttempts: 1 })}`);" },
  ];
  let bit = 0, applied = 0;
  for (const m of MUTS) {
    const src = m.file === "yt" ? YT_SRC : PO_SRC;
    if (src == null) { T.unmeasured(`⑦ ${m.name}`, "소스를 못 읽었다"); continue; }
    const mutated = typeof m.from === "string" ? src.split(m.from).join(m.to) : src.replace(m.from, m.to);
    if (mutated === src) { T.unmeasured(`⑦ ${m.name}`, "변이 글자가 안 들어갔다 — 닻이 바뀌었나(«안 울었다»로 세지 않는다)"); continue; }
    applied++;
    const r = judgeCount(m.file === "yt" ? mutated : YT_SRC, m.file === "po" ? mutated : PO_SRC).find((x) => x.key === m.key);
    const cried = r?.ok === false;
    if (cried) bit++;
    T.ok(`⑦ ${m.name} → «${m.key}» 가 운다`, cried, `판정 ${String(r?.ok)}`);
  }
  counts["R19 변이"] = `${bit}/${MUTS.length} 울었다(심긴 것 ${applied})`;
}

const code = T.done("verify-r18-youtube-quota");
console.log("\n  ── 검산 수(무엇을 · 어디서 · 몇) ──");
for (const [k, v] of Object.entries(counts)) console.log(`   · ${k}: ${v}`);
console.log("   · 범위: 소스(lib·netlify·runner·public 코드 파일) + 순수 함수(B reuseFit · B2 triageFresh) — 라이브 호출 수는 이 자 밖(verify-r19-threads-derived-live ⑥⑦)");
process.exit(code);
