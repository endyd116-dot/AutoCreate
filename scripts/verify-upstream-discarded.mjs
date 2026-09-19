/**
 * scripts/verify-upstream-discarded.mjs — 🔴 **윗물이 만든 것을 아랫물이 버리는 자리** (B · 2026-09-20)
 *
 *   ══ 왜 ══
 *   2026-09-20 하루에 **같은 모양이 셋** 났다. 메인이 «셋이면 넷째가 있다»고 했고, 훑어 보니 있었다.
 *     ① `publish-one.ts` 가 `PublishFail.error`(사람말 한 문장)를 버리고 사유당 한 마디만 썼다 — 고침
 *     ② `blocks` 가 `bodyHtml` 을 이겨 **손님이 고친 글 대신 AI 원문이 나갔다** — B2 가 고치는 중
 *     ③ 서식이 조용히 사라졌다
 *     ④ 🔴 **이 자가 찾은 것** — `meta.scriptIssues`(광고법 금칙어·수익 약속 표현까지 들어 있다)가
 *        `pieces-get` 허용 목록에 없어 **화면까지 오는 길이 아예 없었다.** 읽는 데가 **0곳**이었다.
 *
 *   🔴 **이 병의 이름은 «허용 목록이 값을 먹는다»** 이고, 리포가 이미 세 번 겪었다(2026-09-16 하루에
 *      `ALLOWED_SETTINGS`·`sanitizeProfile`·`pieces-get meta`). `lib/publish/index.ts` 주석이
 *      «여기가 네 번째가 되지 않게 한다» 고 적어 뒀는데 — **네 번째는 다른 문에서 났다.**
 *      ⇒ 주석으로는 못 막는다. **자로 막는다.**
 *
 *   ══ 무엇을 재나 (파일만 읽는다 · `safe`) ══
 *     ① 🔴 **판정·위험을 담은 `pieces.meta` 키가 검수 화면까지 오는 길이 있나.**
 *        «판정을 담았다»는 내가 정하지 않는다 — **쓰는 자리의 값**으로 가른다(아래 `FINDING`).
 *        내부 살림(잠금·재시도수·단계 같은 것)은 **이름을 적어 빼 둔다** — 안 빼면 이 자가 늑대 소년이 된다.
 *     ② 🔴 **받아 놓고 아무 데서도 안 읽는 칸**(3중 죽은 통로) — API 가 받고 저장까지 하는데
 *        읽는 데가 0곳이면 그건 «있는 기능»이 아니다(AC-69 의 meta 판).
 *
 *   🔴 **반대편은 옆 자에 있다** — «읽는 쪽은 있는데 **쓰는 길**이 없다»(= 아무도 안 틀렸는데 기능이 없다)는
 *      `scripts/verify-write-path-missing.mjs` 가 잰다. 둘이 한 쌍이지만 **모수가 다르다**:
 *      여기는 `pieces.meta` 의 **키**(이름이 길다) · 저기는 DDL 의 **칸**(이름이 짧다).
 *      한 자에 두려다 재 보고 나눴다 — DB 칸에서 ②방향을 재면 `ref`·`key`·`ip` 같은 세 글자 이름 때문에
 *      **17칸이 전수 거짓양성**으로 나온다(2026-09-20 실측). 그 방향은 여기서만 잰다.
 *
 *   🔴 **이 자가 못 하는 것**(AC-9):
 *     · 화면이 그 값을 **그려 주나**는 안 본다(서버가 보내는 데까지만 잰다 — 그 다음은 A 의 자).
 *     · `meta` 밖의 «버림»(예: `blocks` ↔ `bodyHtml` 우선순위)은 안 본다 — 그건 B2 의 축이다.
 *     · 🔴 **«글자는 남았는데 죽은 길»은 못 본다** — `if (false && …)` 로 막아 놓으면 `meta.X =` 글자가 남아
 *       «길이 있다»로 읽는다(변이 M1b 가 실제로 안 울었다). 이 자가 잡는 것은 **«길을 안 낸 것»**이고,
 *       **«낸 길을 막은 것»**은 못 잡는다. 그 축은 `verify-r8-deadends`(호출이 있나) 쪽 몫이다.
 *
 *   백슬래시 없는 검사만(AC-100) · 주석을 걷고 센다(AC-109 ①).
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
function walk(dir, re, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, re, acc);
    else if (re.test(f)) acc.push(p);
  }
  return acc;
}

const SRC = [...walk("lib", /\.ts$/), ...walk("netlify/functions", /\.ts$/)];
const CODE = new Map(SRC.map((f) => [f, codeOnly(read(f))]));
const GET = codeOnly(read("netlify/functions/pieces.ts"));

/**
 * 🔴 **내부 살림** — 화면에 갈 값이 아니다(크론·러너·이어달리기가 쓰는 칸).
 *   이 목록은 «봐 줬다»가 아니라 **«왜 내부인지»를 이름으로 못 박은 것**이다. 새 칸을 여기 넣을 땐 이유를 적어라.
 */
const INTERNAL = new Set([
  // 이어달리기·잠금·재시도 — 크론이 자기끼리 쓴다
  "chainLock", "chainResume", "chainStage", "renderRetry", "renderJobId", "renderedAt", "sweepResume", "sweepSkipped",
  "publishAttempts", "stage", "at", "count", "assets", "body", "parts", "posted", "render", "script", "drafts",
  // 진단용(감사·로그로 간다 · 계약상 «개발용 한 줄»)
  "lastPublishError", "error", "detail", "reason", "publishFail", "frameHash", "provider", "field", "why", "say",
  // 이미 다른 사람말로 화면에 가는 값의 **분류표**(등급·상태 코드)
  "judgeGrade", "factcheck", "sentences", "tts", "hook", "description", "youtube", "sponsored", "affiliate",
  "refunded", "regenCount", "editedAt", "editedByUser", "rejectReason", "failReason", "manualChannel", "crossSimilarity",
]);

/** 🔴 «판정·위험을 담았다»의 증거 — 쓰는 자리에서 **이런 것**을 넣으면 손님이 알아야 하는 값이다. */
const FINDING = /\bissues\b|\bwarnings\b|\bviolations\b|금칙|위반|위험|경고|누락|못\s|미달/;

const out = [];
const rec = (step, ok, note) => { out.push({ ok }); console.log(`  ${ok ? "✓" : "✗"} ${step}  — ${note}`); return ok; };

console.log(`\n«윗물이 만든 것을 아랫물이 버리나» · ${new Date().toISOString()}`);

/* 쓰는 키 모으기 */
const written = new Map();
for (const [f, s] of CODE) {
  for (const m of s.matchAll(/meta\s*=\s*(?:\([^)]*\)\s*\|\|\s*)?meta?\s*\|\|\s*\$\{jsonb\(\{([^}]*)\}/g)) {
    for (const km of m[1].matchAll(/(\w+)\s*:\s*([^,]*)/g)) {
      const k = km[1];
      const v = (km[2] || "").slice(0, 120);
      const prev = written.get(k) ?? { files: new Set(), vals: [] };
      prev.files.add(f); prev.vals.push(v);
      written.set(k, prev);
    }
  }
}
/** 그 키를 **읽는** 데가 있나(쓰는 파일은 뺀다). */
function readSomewhere(k, writers) {
  const pats = [new RegExp(`meta\\.${k}\\b`), new RegExp(`\\bm\\.${k}\\b`), new RegExp(`\\bm2\\.${k}\\b`),
    new RegExp(`meta\\[\\s*["']${k}["']\\s*\\]`), new RegExp(`->>\\s*'${k}'`), new RegExp(`->\\s*'${k}'`)];
  for (const [f, s] of CODE) { if (writers.has(f)) continue; for (const p of pats) if (p.test(s)) return f; }
  return null;
}
/** `pieces-get` 이 화면으로 내보내나. */
const surfaced = new Set([...GET.matchAll(/\bmeta\.(\w+)\s*=/g)].map((m) => m[1]));

console.log(`■ 내가 세는 모수 — pieces.meta 에 쓰는 키 ${written.size}개(내부 살림으로 뺀 것 ${INTERNAL.size}개 · 화면까지 가는 길이 있는 키 ${surfaced.size}개)`);
console.log("─".repeat(120));

/* ① 판정을 담은 키가 화면까지 오는 길이 있나 */
{
  const blind = [];
  for (const [k, info] of written) {
    if (INTERNAL.has(k) || surfaced.has(k)) continue;
    if (!info.vals.some((v) => FINDING.test(v)) && !FINDING.test(k)) continue;
    blind.push(`${k}(${[...info.files].map((f) => path.basename(f)).join(",")})`);
  }
  rec("① 🔴 판정·위험을 담은 `meta` 키가 검수 화면까지 오는 길이 있다", blind.length === 0,
    blind.length ? `🔴 길이 없는 키 ${blind.length}개: ${blind.join(" · ")} — 검사는 도는데 결과가 아무에게도 안 간다(§9)`
      : "판정을 담은 키는 전부 `pieces-get` 을 지나간다");
}

/* ② 받아 놓고 아무도 안 읽는 칸 */
{
  const dead = [];
  for (const [k, info] of written) {
    if (INTERNAL.has(k)) continue;
    if (surfaced.has(k)) continue;
    if (readSomewhere(k, info.files)) continue;
    dead.push(`${k}(${[...info.files].map((f) => path.basename(f)).join(",")})`);
  }
  rec("② 🔴 저장만 하고 **아무 데서도 안 읽는** 칸이 없다(AC-69 의 meta 판)", dead.length === 0,
    dead.length ? `🔴 ${dead.length}개: ${dead.join(" · ")} — 받아서 쓰기까지 하는데 읽는 데가 0곳이다`
      + (dead.some((d) => d.startsWith("regenNote")) ? `
       └ regenNote: 계약(\`pieces-regenerate { id, note? }\`)에 적혀 있는데 **세 곳이 다 죽었다** —
         화면은 \`{ id }\` 만 보내고(A) · 서버는 저장만 하고(B) · 생성기는 안 읽는다(B-1·B2).
         이웃 \`pieces-reject { reason? }\` 는 슬롯 note 로 **보여 주기까지** 한다 — 그게 정답 모양이다.
         🔴 반쪽으로 고치면 «초록인데 고장»이 된다. 세 창이 같이 고칠 일이라 **메인이 나눌 몫**이다.` : "")
      : "쓰는 칸은 전부 어딘가에서 읽힌다");
}

/* ═══ ③ 🔴 글을 **이름으로 부르는 자리**가 글 제목을 쓰나 ═══
   2026-09-20 A 실측: 편성표가 손님이 고친 제목 대신 **디렉터가 배정했던 소재 제목**을 말했다.
   홈은 처음부터 `pieces.title` 을 썼으니 **두 화면이 다른 이름을 말하고 있었다.**
   🔴 규칙: 글이 걸린 자리를 **이름으로 부를 때는 `pieces.title`**. `topics.title` 은 «무엇을 쓰기로 했나»라는 다른 뜻이라
      **같이 실을 수는 있어도 대신 쓸 수는 없다.** */
{
  /* 🔴 **일부러 소재 이름을 쓰는 자리**는 이름으로 적어 둔다 — 안 적으면 이 자가 늑대 소년이 된다.
     `lib/outcomes.ts` = «잘 먹힌 **소재**»(어떤 주제가 통했나)를 묻는 자리다. 글 이름이 답이 아니다. */
  const BY_TOPIC_ON_PURPOSE = new Map([["lib/outcomes.ts", "«잘 먹힌 소재» — 주제별 성과라 글 이름이 답이 아니다"]]);
  const bad = [];
  for (const [f, src] of CODE) {
    for (const m of src.matchAll(/sql`([^`]{40,1600})`/g)) {
      const qy = m[1];
      if (!/\bJOIN\s+pieces\b|\bFROM\s+pieces\b/i.test(qy)) continue;
      const usesTopicTitle = /\bt\.title\b/.test(qy);
      /* 🔴 [거짓양성 → 과잉교정 → 좁히기 · 변이가 두 번 고치게 했다]
         ① 첫 판: `p.*` 가 제목을 포함하는 걸 몰라 **멀쩡한 자리를 빨갛게** 했다(`pieces.ts` 의 `PIECE_SELECT`).
         ② 고친 판: `${…}` 가 있으면 봐 주게 했더니 — 🔴 **거의 모든 질의에 `${tid}` 파라미터가 있어 이 축이 통째로 죽었다**
            (변이 M4·M6 이 «안 운다»로 그걸 잡았다. 자를 넓게 봐 주면 «늘 초록»이 된다).
         ③ 지금: **SELECT 절만** 본다 — 이름을 고르는 곳은 거기다. WHERE 의 파라미터는 판정과 상관없다. */
      const sel = (qy.match(/SELECT([\s\S]*?)\bFROM\b/i) || [, ""])[1];
      const usesPieceTitle = /\b(p|pc)\.title\b/.test(sel) || /\b(p|pc)\.\*/.test(sel) || sel.includes("${");
      if (usesTopicTitle && !usesPieceTitle && !BY_TOPIC_ON_PURPOSE.has(f.split(path.sep).join("/"))) {
        bad.push(`${f}: ${qy.slice(0, 60).replace(/\s+/g, " ")}`);
      }
    }
  }
  rec("③ 🔴 글을 이름으로 부르는 자리가 **글 제목**을 쓴다(소재 제목으로 대신하지 않는다)", bad.length === 0,
    bad.length ? `🔴 소재 제목으로 대신 부르는 자리 ${bad.length}곳: ${bad.join(" · ")} — 손님이 고친 제목이 화면에 안 뜬다`
      : `일부러 소재로 부르는 자리(${[...BY_TOPIC_ON_PURPOSE.keys()].join(",")})만 빼고 전부 글 제목을 쓴다`);
}

/* ═══ ④ 🔴 홈과 편성표가 **같은 이름**을 말하나 ═══ */
{
  const slots = read("lib/slots.ts");
  const home = read("netlify/functions/home-summary.ts");
  const slotsHas = /pc\.title AS piece_title/.test(slots) && /o\.title = String\(r\.piece_title\)/.test(slots);
  const homeHas = /p\.title/.test(home);
  rec("④ 🔴 홈과 편성표가 그 자리를 **같은 이름**으로 부른다", slotsHas && homeHas,
    slotsHas && homeHas ? "둘 다 글 제목을 싣는다(편성표는 `topicTitle` 도 같이 — 판정이 그 값을 쓴다)"
      : !slotsHas ? "🔴 편성표가 글 제목을 안 싣는다 — 손님 눈엔 딴 글이 걸린 것처럼 보인다"
        : "🔴 홈이 글 제목을 안 쓴다");
}

/* 대조군 — 제대로 지나가는 자리가 실제로 있다 */
{
  /* 🔴 [변이가 고치게 한 것] 첫 판은 «셋 중 둘»이면 통과였다 — 그래서 `refUnused` 를 통째로 치워도 **안 울었다.**
     문턱을 느슨하게 두면 대조군이 «대조»를 못 한다. **셋 다** 있어야 통과다. */
  const WANT = ["refUnused", "formatUnused", "numberClaims"];
  const good = WANT.filter((k) => surfaced.has(k));
  const lost = WANT.filter((k) => !surfaced.has(k));
  rec("대조군 — **길이 뚫린 자리도 실제로 있다**(이 자가 둘을 가른다)", lost.length === 0,
    lost.length === 0 ? `${good.join(" · ")} 는 허용 목록을 지나 화면까지 간다 — 이 모양이 정답이다`
      : `🔴 길이 사라진 대조군: ${lost.join(" · ")} — 허용 목록이 값을 먹었다(또 났다)`);
}

console.log("─".repeat(120));
const bad = out.filter((x) => !x.ok).length;
console.log(bad ? `🔴 FAIL ${bad} / ${out.length}` : `PASS ${out.length} · FAIL 0`);
console.log("🔴 이 자는 «서버가 보내나»까지 잰다 — **화면이 그리나**는 안 본다(머리말).");
process.exit(bad ? 1 : 0);
