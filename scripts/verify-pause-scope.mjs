/**
 * scripts/verify-pause-scope.mjs — 🔴 **«멈춤»이 «잠김»이 되지 않았는가**(DESIGN §5B.11(6) · AC-220 · B 2026-09-23)
 *
 *   ══ 왜 이 자인가 ══
 *     사장님이 원한 것은 «**잠깐** 멈춤»이다. 그런데 이 기능은 **조용히 «잠김»으로 자라기 쉽다** —
 *     `tenants.status` 에 한 글자 끼우거나, 스텝 하나에 표식을 더 달면 그날로 보기·고치기·손으로 올리기까지 막힌다.
 *     그러면 손님은 «쉬려다 계정이 잠긴» 셈이고, 이 기능이 막으려던 **해지**가 오히려 앞당겨진다.
 *     🔴 설계가 자 이름까지 적어 둔 까닭이 그것이다(§5B.11(6)).
 *
 *   ══ 재는 것 ══
 *     ① 잠김 아님 — 🔴 `NON_WRITABLE` 에 `paused` 가 **없나** · `requireWritable` 이 `paused_at` 을 **안 보나**
 *     ② 멈추는 것 — 설계 (1) 왼쪽 넷(`roll`·`assign`·`produce`·`publisher`)만 `stopsWhenPaused` 인가
 *     ③ 관문     — 그 표식을 **한 곳**(`runner.ts`)에서 보나 · 쉬어서 건너뛴 것을 **따로 세나**(조용한 0건 금지)
 *     ④ 안 멈추는 것 — 🔴 «손으로 지금 올리기»가 **쉼을 안 보나**(이 설계의 핵심) · 깨우는 스텝이 **쉬는 집을 보나**
 *     ⑤ 밀린 글 — 🔴 `skipped`·`rejected` 를 **재사용하지 않나** · 깰 때 **모으고 나서** 깨우나(순서) · 캐던스를 지키나
 *     ⑥ 셈       — 🔴 `days` 가 **KST 로, 첫날 = 1일째**로 세나(제품 함수를 **실제로 돌려** 경계 시각을 먹인다)
 *
 *   🔴 ⑥은 글자 대조가 아니라 **실행**이다. `pauseViewOf` 는 순수 함수라 소스에서 떼어 돌릴 수 있다(그러라고 순수하게 짰다).
 *   `--mutants` = 제품 사본에 변이를 넣고 이 자를 다시 돌려 **내가 정말 무는지** 본다.
 *   종료코드: 0 = 지켜진다 · 1 = 어긋난다 · 2 = 못 쟀다.
 */
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { codeOnly } from "./_lib/code-only.mjs";
import { blockOf } from "./_lib/block.mjs";   // 🔴 자르개는 한 곳(B2 · AC-216)

const ROOT = process.cwd();
const GUARDS = "lib/guards.ts", PAUSE = "lib/tenant-pause.ts", RUNNER = "lib/cron/runner.ts", BASE = "lib/cron/base.ts";
const PUBLISHER = "lib/cron/publisher.ts", ROLL = "lib/cron/roll.ts", ASSIGN = "lib/cron/assign-topics.ts", PRODUCE = "lib/cron/produce.ts";
const WATCH = "lib/cron/pause-watch.ts", NOW_API = "netlify/functions/publish-now.ts", API = "netlify/functions/tenant-pause.ts";
const SETTINGS = "netlify/functions/tenant-settings.ts", HOME = "netlify/functions/home-summary.ts";
const FILES = [GUARDS, PAUSE, RUNNER, BASE, PUBLISHER, ROLL, ASSIGN, PRODUCE, WATCH, NOW_API, API, SETTINGS, HOME];

const rawRead = (f) => { const p = path.join(ROOT, f); return existsSync(p) ? readFileSync(p, "utf8") : null; };
/* 🔴 주석을 걷고 본다 — 안 그러면 **내가 쓴 설명이 과녁에 걸려 거짓 초록**이 된다(AC-191 · 어제 세 자리에서 값을 치렀다). */
const read = (f) => { const t = rawRead(f); return t === null ? null : codeOnly(t); };

const fails = [], notes = [];
const ok  = (ax, m) => notes.push(`  ✓ ${ax} ${m}`);
const bad = (ax, m) => { notes.push(`  ✗ ${ax} ${m}`); fails.push(`${ax} ${m}`); };
const unk = (ax, m) => { notes.push(`  ⊘ ${ax} 못 쟀음 — ${m}`); fails.push(`${ax} 못 쟀음`); };

const T = {}; for (const f of FILES) T[f] = read(f);
const gone = FILES.filter((f) => T[f] === null);
if (gone.length) { console.error(`⊘ 못 쟀어요 — ${gone.join(", ")} 가 없다.`); process.exit(2); }

/* ───────── ① 🔴 잠김이 아니다 — 이 자의 첫 줄 ───────── */
notes.push("■ ① 🔴 «멈춤»이 «잠김»이 아니다(설계 §5B.11(2) · 이 설계가 뒤집히는 자리)");
{
  const blk = blockOf(T[GUARDS], "export const NON_WRITABLE", [";"]);
  if (!blk) unk("①", "`NON_WRITABLE` 을 못 찾았다(이름이 바뀌었나)");
  /* 🔴 **부정형 단언이지만 과녁이 살아 있다** — 위에서 `NON_WRITABLE` 덩이를 **찾은 뒤**에만 이 줄이 돈다.
     과녁이 사라지면 ⊘ 가 먼저 나므로 «공짜로 참»이 되지 않는다(AC-121 을 피하는 모양). */
  else (/pause/i.test(blk.body) ? bad : ok)("①", "`NON_WRITABLE` 에 쉼이 **안 들어 있다**(들어가면 보기·고치기까지 막힌다)");
  const rw = blockOf(T[GUARDS], "export async function requireWritable", ["\n}"]);
  if (!rw) unk("①", "`requireWritable` 을 못 찾았다");
  else (/paused/i.test(rw.body) ? bad : ok)("①", "`requireWritable` 이 `paused_at` 을 **안 본다**(쉼은 계약이 아니라 고객의 선택이다)");
  /* 🔴 과녁을 `/pause/i` 로 넓게 잡았다가 **거짓 빨강**을 받았다 — 그 파일엔 `pausedAccountIds`(코인이 모자라 쉬는 **계정**)가 있고
     그건 **다른 쉼**이다(§7.3 슬롯 `paused`). ⇒ **«집의 쉼»만** 겨눈다: `paused_at`·`tenant-pause`·`isPausedRow`.
     어제 배운 그대로다 — «넓게 보면 못 보던 것이 아니라 **틀린 것**을 본다»(AC-141). */
  /* 🔴 **«이름이 있나»가 아니라 «그 모듈을 들여오나»로 잰다.** 처음엔 낱말 몇 개를 늘어놓았는데,
     변이가 `isPausedNow` 라는 **내가 안 적은 이름**을 쓰자 조용히 초록이었다 — 과녁이 «내가 아는 철자»뿐이었던 것이다.
     집의 쉼을 보려면 **반드시 `lib/tenant-pause` 를 거친다**(칸이 거기 있다) ⇒ 그 수입을 겨눈다. 철자를 안 센다. */
  (/lib\/tenant-pause|paused_at/.test(T[NOW_API]) ? bad : ok)("①", "🔴 «손으로 지금 올리기»가 **집의 쉼**을 안 본다(설계 (1) 오른쪽 칸 · 이 기능의 핵심)");
  (/requireWritable/.test(T[API]) ? bad : ok)("①", "쉼 API 가 `requireWritable` 을 **안 쓴다**(쓰면 체험 끝난 집이 자기 쉼을 못 끈다)");
}

/* ───────── ② 멈추는 것 — 설계 (1) 왼쪽 넷«만» ───────── */
notes.push("■ ② 멈추는 것 — 설계 (1) 표 왼쪽 넷만 `stopsWhenPaused`");
{
  const STOPS = [["자동 편성(roll)", ROLL], ["소재 배정(assign)", ASSIGN], ["자동 제작(produce)", PRODUCE], ["자동 발행(publisher)", PUBLISHER]];
  for (const [name, f] of STOPS) (/stopsWhenPaused: true/.test(T[f]) ? ok : bad)("②", `${name} 는 쉰다`);
  /* 🔴 **더 중요한 쪽** — 안 멈춰야 하는 스텝에 표식이 붙으면 «쉼»이 «잠김»이 된다. 모수를 찍어 «몇 개를 봤나»를 말한다. */
  const all = readdirSync(path.join(ROOT, "lib/cron")).filter((x) => x.endsWith(".ts") && x !== "base.ts" && x !== "runner.ts");
  const stopping = all.filter((x) => /stopsWhenPaused: true/.test(read(`lib/cron/${x}`) ?? ""));
  const want = new Set(["roll.ts", "assign-topics.ts", "produce.ts", "publisher.ts"]);
  const extra = stopping.filter((x) => !want.has(x));
  (extra.length ? bad : ok)("②", extra.length
    ? `🔴 설계에 없는 스텝 ${extra.length}개가 쉰다(${extra.join(", ")}) — 하나만 늘어도 «쉼»이 «잠김»이 된다`
    : `스텝 ${all.length}개 중 쉬는 것은 **설계의 넷뿐**이다(나머지 ${all.length - stopping.length}개는 그대로 돈다)`);
}

/* ───────── ③ 관문 — 한 곳에서 보나 ───────── */
notes.push("■ ③ 관문 — 표식을 **한 곳**에서 보나 · 조용한 0건이 아닌가");
{
  (/stopsWhenPaused\?: boolean/.test(T[BASE]) ? ok : bad)("③", "스텝 계약에 칸이 있다(`base.ts`)");
  const loop = blockOf(T[RUNNER], "for (const t of ordered)", ["\n    }"]);
  if (!loop) unk("③", "테넌트 루프를 못 찾았다");
  else {
    (/step\.stopsWhenPaused && t\.paused/.test(loop.body) ? ok : bad)("③", "🔴 관문이 **루프 한 줄**이다(스텝마다 흩뿌리지 않았다)");
    (/pausedSkipped/.test(loop.body) ? ok : bad)("③", "쉬어서 건너뛴 집을 **센다**");
  }
  (/detail\.paused = pausedSkipped\.length/.test(T[RUNNER]) ? ok : bad)("③", "🔴 그 수를 **보고에 적는다**(조용한 0건 금지 · `autoOff` 와 따로)");
  (/paused_at FROM tenants WHERE status IN \('trial','active'\)/.test(T[RUNNER]) ? ok : bad)("③", "🔴 쉬는 집도 **여전히 활성 목록에 있다**(안 멈추는 것들이 그대로 돌아야 한다)");
}

/* ───────── ④ 안 멈추는 것 ───────── */
notes.push("■ ④ 안 멈추는 것 — 🔴 여기가 더 중요하다");
{
  (/stopsWhenPaused: false/.test(T[WATCH]) ? ok : bad)("④", "🔴 깨우는 스텝은 **쉬는 집을 본다**(켜면 영영 안 깨운다 · 이 파일에서 가장 조용히 틀릴 수 있는 줄)");
  (/pause_until/.test(T[WATCH]) && /pause_notified_at/.test(T[WATCH]) ? ok : bad)("④", "깨우는 스텝이 기한과 알림 멱등 키를 본다");
}

/* ───────── ⑤ 밀린 글 — 우리가 정하지 않는다 ───────── */
notes.push("■ ⑤ 밀린 글(설계 (1-b)) — 🔴 버리지도, 몰아 올리지도, 조용히 넘기지도 않는다");
{
  (/BACKLOG_STATUS = "pending_resume"/.test(T[PAUSE]) ? ok : bad)("⑤", "새 상태를 쓴다(`pending_resume`)");
  const hold = blockOf(T[PAUSE], "export async function holdBacklog", ["\n}"]);
  if (!hold) unk("⑤", "`holdBacklog` 를 못 찾았다");
  else (/'skipped'|'rejected'/.test(hold.body) ? bad : ok)("⑤", "🔴 `skipped`·`rejected` 를 **재사용하지 않는다**(뜻이 다르다 — 앞은 «우리가 넘겼다», 뒤는 «손님이 버렸다»)");
  const rel = blockOf(T[PAUSE], "export async function releaseBacklog", ["\n}"]);
  if (!rel) unk("⑤", "`releaseBacklog` 를 못 찾았다");
  else {
    /* 🔴 **이름이 아니라 «어디서 왔나»를 본다.** 처음엔 `/pickPublishAt/` 로 쟀는데, 변이가 **같은 이름의 지역 스텁**을
       두자 조용히 초록이었다 — 이름은 그대로 있었기 때문이다. «캐던스를 지킨다»는 «그 이름을 쓴다»가 아니라
       «**정본 모듈에서 받아 쓴다**»이다. 어제 배운 그 줄이 여기서 또 값을 했다. */
    (/await import\("\.\/best-time"\)/.test(rel.body) ? ok : bad)("⑤", "🔴 «차례로»가 **캐던스 정본**(`best-time.pickPublishAt`)에서 **받아** 쓴다(한 번에 쏟지 않는다)");
    (/gapMinFor/.test(rel.body) ? ok : bad)("⑤", "계정 간격도 정본(`gapMinFor`)에서 받는다");
  }
  /* 🔴 **순서가 뜻이다** — 깨우기 전에 모아야 한다. 거꾸로면 그 한 틱 사이에 `publisher` 가 돌아 **한꺼번에 나간다.** */
  const wake = blockOf(T[WATCH], "if (until && until.getTime() <= now.getTime())", ["return {"]);
  if (!wake) unk("⑤", "저절로 깨우는 갈래를 못 찾았다");
  else {
    const a = wake.body.indexOf("holdBacklog"), b = wake.body.indexOf("paused_at = NULL");
    (a >= 0 && b >= 0 && a < b ? ok : bad)("⑤", "🔴 저절로 깰 때 **모으고 나서** 깨운다(순서가 거꾸로면 한꺼번에 나간다)");
  }
  /* 🔴 닻을 `'/tenant-resume'` 로 잡았다가 **⊘** 를 받았다 — 그 글자는 `config.path` 목록에도 있어 **둘**이었고,
     `blockOf` 의 `unique`(기본 켬 · B2 AC-216)가 «어느 것인지 말할 수 없다»며 멈춘 것이다. **자가 제 일을 한 것**이다.
     ⇒ 갈래를 가리키는 **유일한 글자**로 바꾼다. */
  const api = blockOf(T[API], 'path.endsWith("/tenant-resume")', ["return json"]);
  if (!api) unk("⑤", "`tenant-resume` 갈래를 못 찾았다(닻 `path.endsWith(\"/tenant-resume\")`)");
  else (/releaseBacklog/.test(api.body) ? bad : ok)("⑤", "🔴 깨우기가 **올리지 않는다**(고르는 것은 고객이다 · §9)");
  (/action !== "publish" && action !== "leave"/.test(T[API]) ? ok : bad)("⑤", "고를 문이 있다(`tenant-backlog`)");
}

/* ───────── ⑥ 셈 — 🔴 제품 함수를 **실제로 돌린다** ───────── */
notes.push("■ ⑥ 셈 — `days` 가 KST 로, **첫날 = 1일째**인가(글자 대조가 아니라 실행)");
{
  const src = T[PAUSE];
  const plain = src.replace(/: Date\b/g, "").replace(/: number\b/g, "");
  const day = /const kstDayNo = \(d\) => ([^;]+);/.exec(plain);
  /* 🔴 **상수도 제품에서 떼어 온다.** 자가 `KST_MS` 를 스스로 적으면 제품이 그 값을 바꿔도 이 축은 **옛 값으로 계속 초록**이다
     — «자가 제품을 보는 것»이 아니라 «자가 자기를 보는 것»이 된다(어제 종일 잡은 그 병). */
  const kstConst = /const KST_MS = ([^;]+);/.exec(plain);
  const viewBlk = blockOf(src, "export function pauseViewOf", ["\n}"]);
  if (!day || !kstConst || !viewBlk) unk("⑥", `제품에서 못 떼었다(${!day ? "kstDayNo" : !kstConst ? "KST_MS" : "pauseViewOf"})`);
  else {
    /* 순수 산술만 떼어 돌린다 — `utcDate` 는 자가 대신 준다(그 함수는 이 축의 과녁이 아니다). */
    const kstDayNo = new Function("d", `const KST_MS = ${kstConst[1]}; return ${day[1]};`);
    const daysOf = (fromIso, nowIso) => kstDayNo(new Date(nowIso)) - kstDayNo(new Date(fromIso)) + 1;
    const CASES = [
      ["같은 KST 날 = 1일째",            "2026-09-23T01:00:00Z", "2026-09-23T02:00:00Z", 1],
      ["🔴 KST 자정을 넘으면 2일째",     "2026-09-22T05:00:00Z", "2026-09-22T16:00:00Z", 2],   // KST 14시 → 다음날 01시
      ["🔴 UTC 로 세면 틀리는 표본",     "2026-09-22T20:00:00Z", "2026-09-22T23:00:00Z", 1],   // 둘 다 KST 9/23 → 1일째(UTC 로도 1이라 무해)
      ["🔴 UTC 자정을 넘어도 같은 KST 날", "2026-09-22T16:00:00Z", "2026-09-23T01:00:00Z", 1], // 둘 다 KST 9/23 — UTC 로 세면 2가 나온다
      ["12일째(설계 (4) 의 그 숫자)",    "2026-09-22T03:00:00Z", "2026-10-03T03:00:00Z", 12],
    ];
    for (const [name, from, now, want] of CASES) {
      const got = daysOf(from, now);
      (got === want ? ok : bad)("⑥", `${name} — 기대 ${want} · 나온 것 ${got}`);
    }
    (/\+ 1;/.test(viewBlk.body) || /\+ 1\b/.test(viewBlk.body) ? ok : bad)("⑥", "«첫날 = 1일째»가 코드에 있다(+1)");
    (/daysLeft/.test(viewBlk.body) && /Math\.max\(0,/.test(viewBlk.body) ? ok : bad)("⑥", "`daysLeft` 는 음수로 안 내려간다");
  }
}

/* ───────── ⑦ 두 문이 같은 것을 싣나(설계 (1-c) «두 벌로 만들지 않는다») ───────── */
notes.push("■ ⑦ 두 문 — `tenant-settings` 와 `home-summary` 가 **같은 `pause` 객체**를 싣나");
{
  for (const [name, f] of [["설정", SETTINGS], ["홈 첫 화면", HOME]]) {
    (/pause: await loadPause\(/.test(T[f]) ? ok : bad)("⑦", `${name} 이 \`loadPause\` 를 그대로 싣는다(두 벌이 아니다)`);
  }
  /* 🔴 말(label)·숫자를 **서버가** 준다 — 안 주면 화면이 날짜를 셈하고 말을 지어낸다(AC-52·AC-74). */
  const v = blockOf(T[PAUSE], "export const PAUSE_REASONS", ["];"]);
  if (!v) unk("⑦", "`PAUSE_REASONS` 를 못 찾았다");
  else {
    const keys = [...v.body.matchAll(/key: "([a-z_]+)"/g)].map((m) => m[1]);
    const want = ["vacation", "editing", "channel_penalty", "cost", "other"];
    (want.every((k) => keys.includes(k)) ? ok : bad)("⑦", `까닭 다섯이 다 있다(${keys.join(", ")})`);
    (/label: "/.test(v.body) ? ok : bad)("⑦", "🔴 **말(label)을 서버가 준다**(화면이 지어내지 않는다 · AC-52)");
    /* 🔴 **겁주지 않는다**(§3) — 이 목록은 손님이 읽는 글이다. */
    (/줄어|불이익|정지됩니다|위험/.test(v.body) ? bad : ok)("⑦", "🔴 겁주는 말이 없다(§3 · «수익이 줄어요» 같은 말)");
  }
}

/* ───────── ⑧ 🔴 **저절로 깬 손님에게 닿나** — 이 기능의 마지막 구멍(설계 §5B.11(1-d)②) ─────────
   🔴 **이 축이 없어서 33축이 전부 초록인 채로 구멍이 열려 있었다**(2026-09-23 메인이 열어 보고 찾았다).
      `backlog` 가 `POST /api/tenant-resume` **응답에만** 있었고, `pause_until` 이 지나 크론이 **저절로 깨운 집**은
      그 문을 **아예 안 부른다** ⇒ 그 손님은 «밀린 글 N건»을 **영영 못 보고 영영 못 고른다.**
   ⇒ «구조가 맞나»를 아무리 꼼꼼히 재도 **«화면 값까지 닿나»를 안 재면 초록인 채로 고장 난다.** 오늘 종일 잡은 그 모양이다. */
notes.push("■ ⑧ 🔴 저절로 깬 손님 — 화면 값에 `backlog` 가 닿나(33축이 초록인 채 열려 있던 구멍)");
{
  (/backlog: \{ count: number \}/.test(T[PAUSE]) ? ok : bad)("⑧", "🔴 `PauseView` 가 `backlog` 를 **계약에 적는다**(타입만 보는 사람도 안다)");
  const lp = blockOf(T[PAUSE], "export async function loadPause", ["\n}"]);
  if (!lp) unk("⑧", "`loadPause` 를 못 찾았다");
  else {
    (/countBacklog\(tid\)/.test(lp.body) ? ok : bad)("⑧", "🔴 `loadPause` 가 **밀린 글을 같이 센다**(두 문이 그걸 그대로 싣는다)");
    /* 🔴 **«쉬는 집에서만» 세면 안 된다** — 저절로 깬 손님은 `paused=false` 다. 조건이 붙으면 그 손님이 다시 못 본다. */
    (/if \(.*paused/.test(lp.body) ? bad : ok)("⑧", "🔴 그 셈에 **`paused` 조건이 안 붙었다**(깬 손님이 `paused=false` 라 조건이 붙으면 못 본다)");
  }
  const pv = blockOf(T[PAUSE], "export function pauseViewOf", ["\n}"]);
  if (!pv) unk("⑧", "`pauseViewOf` 를 못 찾았다");
  else {
    /* 🔴 **이른 반환에도 실리나** — 안 쉬는 집의 갈래가 바로 그 «저절로 깬 손님»이다. 거기서 빠지면 기능이 통째로 안 닿는다. */
    const early = pv.body.slice(0, pv.body.indexOf("const days"));
    (/backlog: \{ count: backlog \}/.test(early) ? ok : bad)("⑧", "🔴 **안 쉬는 갈래(이른 반환)에도** `backlog` 가 실린다 — 여기가 그 손님의 유일한 통로다");
    (/backlog: \{ count: backlog \}/.test(pv.body.slice(early.length)) ? ok : bad)("⑧", "쉬는 갈래에도 실린다(두 갈래가 같은 모양)");
  }
  /* 🔴 **모양이 `resume` 응답과 같나** — 두 벌이면 화면이 갈린다(설계 (1-c)). */
  (/backlog: \{ count: r\.backlog \}/.test(T[API]) ? ok : bad)("⑧", "`tenant-resume` 응답도 `{ count }` 로 같은 모양이다");
}

/* ───────── 찍기 ───────── */
console.log("─".repeat(100));
console.log(`잠깐 멈춤 — 축 ${notes.filter((l) => /^  [✓✗⊘]/.test(l)).length}개 · 어긋난 곳 ${fails.length}`);
for (const l of notes) console.log(l);
console.log("─".repeat(100));
if (!process.argv.includes("--mutants")) process.exit(fails.length ? 1 : 0);

/* ═════════ 🔴 변이 — 제품 무접촉(사본에서만) ═════════ */
const SELF = path.join(ROOT, "scripts", "verify-pause-scope.mjs");
function runIn(transform) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ac-pause-"));
  try {
    const box = {}; for (const f of FILES) box[f] = rawRead(f);
    /* 🔴 ②축이 `lib/cron` 을 통째로 읽으므로 **그 폴더를 다 복사한다** — 안 그러면 사본에서 «스텝 0개»가 되어
       대조군이 이상한 초록을 내고, 변이 결과를 못 믿게 된다. */
    const extra = readdirSync(path.join(ROOT, "lib/cron")).filter((x) => x.endsWith(".ts")).map((x) => `lib/cron/${x}`);
    for (const f of extra) if (!(f in box)) box[f] = rawRead(f);
    const before = JSON.stringify(box);
    if (transform) transform(box);
    const changed = JSON.stringify(box) !== before;
    for (const f of Object.keys(box)) { mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); writeFileSync(path.join(dir, f), box[f]); }
    for (const sub of [["scripts", "_lib", "code-only.mjs"], ["scripts", "lib", "block.mjs"]]) {
      mkdirSync(path.join(dir, ...sub.slice(0, -1)), { recursive: true });
      writeFileSync(path.join(dir, ...sub), readFileSync(path.join(ROOT, ...sub), "utf8"));
    }
    let out = "", code = 0;
    try { out = execFileSync(process.execPath, [SELF], { cwd: dir, encoding: "utf8" }); }
    catch (e) { code = e.status ?? -1; out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
    return { code, out, changed };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log("\n■ 🔴 변이 — 내가 정말 무는가(대조군을 먼저 · AC-161)");
const ctrl = runIn(null);
if (ctrl.code !== 0) { console.log("  ⊘ 못 쟀음 — 대조군(맨 판)이 이미 빨갛다. 변이 탓을 말할 수 없다."); console.log(ctrl.out.split("\n").filter((l) => /✗|⊘/.test(l)).slice(0, 6).join("\n")); process.exit(2); }
console.log("  ✓ 대조군(맨 판) 초록");
const MUT = [
  /* 🔴 이 설계가 뒤집히는 자리 — 설계 §5B.11(6) 이 이름까지 적어 둔 그 변이다. */
  ["🔴 `NON_WRITABLE` 에 쉼을 끼운다", (b) => { b[GUARDS] = b[GUARDS].replace('new Set(["readonly", "suspended", "cancelled"])', 'new Set(["readonly", "suspended", "cancelled", "paused"])'); }, "①"],
  ["🔴 `requireWritable` 이 쉼을 본다", (b) => { b[GUARDS] = b[GUARDS].replace("SELECT status, closed_at, purge_at FROM tenants", "SELECT status, closed_at, purge_at, paused_at FROM tenants"); }, "①"],
  /* 🔴 변이를 **사람이 진짜 할 법한 모양**으로 쓴다 — 처음엔 내가 지어낸 이름(`isPausedNow`)을 썼다가
     «안 운다»를 받았는데, 그건 제품이 아니라 **내 과녁이 철자만 보던 탓**이었다. 진짜로 막으려면 그 모듈을 들여온다. */
  ["🔴 «지금 올리기»가 쉼에 막힌다",   (b) => { b[NOW_API] = b[NOW_API]
    .replace('import { pausedAccountIds } from "../../lib/account-slots";', 'import { pausedAccountIds } from "../../lib/account-slots";\nimport { loadPause } from "../../lib/tenant-pause";')
    .replace("const w = await requireWritable(tid); if (!w.ok) return w.res;", "const w = await requireWritable(tid); if (!w.ok) return w.res;\n    if ((await loadPause(tid)).paused) return json({ ok: false, error: \"쉬는 중이에요\" }, 403);"); }, "①"],
  ["자동 발행이 안 쉰다",              (b) => { b[PUBLISHER] = b[PUBLISHER].replace("  stopsWhenPaused: true,", ""); }, "②"],
  ["🔴 안 멈춰야 할 스텝이 쉰다",      (b) => { b["lib/cron/revenue-sync.ts"] = b["lib/cron/revenue-sync.ts"].replace("  needsAutoSchedule: false,", "  needsAutoSchedule: false,\n  stopsWhenPaused: true,"); }, "②"],
  ["관문을 뗀다",                      (b) => { b[RUNNER] = b[RUNNER].replace("if (step.stopsWhenPaused && t.paused) { pausedSkipped.push(t.tid); continue; }", ""); }, "③"],
  ["쉬어서 건너뛴 수를 안 적는다",      (b) => { b[RUNNER] = b[RUNNER].replace("if (pausedSkipped.length) detail.paused = pausedSkipped.length;", ""); }, "③"],
  ["🔴 깨우는 스텝이 쉬는 집을 안 본다", (b) => { b[WATCH] = b[WATCH].replace("stopsWhenPaused: false,", "stopsWhenPaused: true,"); }, "④"],
  ["🔴 밀린 글을 `skipped` 로 넘긴다",  (b) => { b[PAUSE] = b[PAUSE].replace('const BACKLOG_STATUS = "pending_resume"', 'const BACKLOG_STATUS = "skipped"'); }, "⑤"],
  ["🔴 «차례로»가 캐던스를 안 지킨다",  (b) => { b[PAUSE] = b[PAUSE].replace("const { pickPublishAt } = await import(\"./best-time\");", "const pickPublishAt = (a) => ({ at: a.now, reason: \"\" });"); }, "⑤"],
  ["🔴 깨우고 나서 모은다(순서 뒤집기)", (b) => {
    b[WATCH] = b[WATCH]
      .replace("      const held = await holdBacklog(ctx.tid, now);\n", "")
      .replace("      const total = await countBacklog(ctx.tid);", "      const held = await holdBacklog(ctx.tid, now);\n      const total = await countBacklog(ctx.tid);");
  }, "⑤"],
  ["🔴 깨우기가 밀린 글을 올려 버린다", (b) => { b[API] = b[API].replace("const r = await resumeTenant(tid);", "const r = await resumeTenant(tid); await releaseBacklog(tid);"); }, "⑤"],
  ["🔴 «N일째»를 0일째부터 센다",       (b) => { b[PAUSE] = b[PAUSE].replace("kstDayNo(now) - kstDayNo(pausedAt) + 1", "kstDayNo(now) - kstDayNo(pausedAt)"); }, "⑥"],
  ["🔴 «N일째»를 UTC 로 센다",          (b) => { b[PAUSE] = b[PAUSE].replace("const kstDayNo = (d: Date): number => Math.floor((d.getTime() + KST_MS) / 86400_000);", "const kstDayNo = (d: Date): number => Math.floor(d.getTime() / 86400_000);"); }, "⑥"],
  /* 🔴 **어제까지 열려 있던 그 구멍 셋** — 33축이 전부 초록인 채로 손님에게 안 닿던 자리다. */
  ["🔴 `loadPause` 가 밀린 글을 안 센다", (b) => { b[PAUSE] = b[PAUSE].replace("    countBacklog(tid),\n", "    Promise.resolve(0),\n"); }, "⑧"],
  ["🔴 쉬는 집에서만 센다(깬 손님이 못 본다)", (b) => {
    b[PAUSE] = b[PAUSE].replace("    countBacklog(tid),", "    (async () => { const v = await q(sql`SELECT paused_at FROM tenants WHERE id = ${tid}`); if (!v[0]?.paused_at) return 0; return countBacklog(tid); })(),");
  }, "⑧"],
  ["🔴 안 쉬는 갈래에서 `backlog` 를 뺀다", (b) => {
    b[PAUSE] = b[PAUSE].replace("reasons: PAUSE_REASONS, backlog: { count: backlog } };", "reasons: PAUSE_REASONS };");
  }, "⑧"],
];
let silent = 0;
for (const [name, tf, axis] of MUT) {
  const r = runIn(tf);
  if (!r.changed) { console.log(`  ⊘ ${name} — 🔴 **변이가 안 먹었다**(과녁 글자가 바뀐 듯). 통과로 세지 않는다.`); silent++; continue; }
  const cried = r.code !== 0 && new RegExp(`✗ ${axis}`).test(r.out);
  if (cried) console.log(`  ✓ ${name} → ${axis}축이 운다`);
  else { console.log(`  ✗ ${name} → 🔴 **안 운다**(종료 ${r.code}) — 이 자가 그 자리를 못 본다`); silent++; }
}
console.log("─".repeat(100));
console.log(silent ? `🔴 변이 ${silent}종이 안 울었다 — 자를 고쳐야 한다` : `✓ 변이 ${MUT.length}종이 모두 제 축을 울렸다`);
process.exit(fails.length || silent ? 1 : 0);
