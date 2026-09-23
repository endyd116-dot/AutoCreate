/**
 * scripts/verify-write-path-missing.mjs — 🔴 **읽는 쪽은 그 칸을 보는데 «쓰는 길»이 없다** (B · 2026-09-20)
 *
 *   ══ 왜 ══
 *   «아무도 안 틀렸는데 기능이 없다.» 계약도 맞고, 읽는 코드도 맞고, DDL 도 맞다 —
 *   **그 칸에 값을 넣을 길만 없다.** 그래서 읽는 쪽은 영원히 폴백을 쓰고, 아무도 고장이라 말하지 않는다.
 *
 *   2026-09-20 에 실제로 둘이 났다:
 *     ① `accounts.opened_at` — 워밍업이 «계정을 만든 날 > 우리와 연결한 날» 순으로 본다(설계가 옳다).
 *        읽는 곳 6 · **쓰는 곳 0** · 라이브 92계정 전부 NULL ⇒ 오래 쓰던 블로그를 어제 연결해도 «1주차»로 묶인다.
 *     ② `feature_flags` — `lib/video/cost.ts` 머리말이 «kill switch = 운영센터 AI 메뉴»라 적어 뒀는데
 *        **운영센터에 그 길이 없다**(API 0 · 화면 0). 영상이 돈을 태우기 시작해도 운영자가 끌 방법이 없다.
 *
 *   🔴 **`verify-upstream-discarded` 의 ②축이 그 반대편**(«저장만 하고 아무도 안 읽는 칸»)을 잡는다. 둘이 한 쌍이다.
 *      메인이 «같은 자에 두 방향으로 둘까»를 물었고 — **돌려 보고 나누기로 했다.** 이유는 아래 «못 하는 것» ③.
 *
 *   ══ 무엇을 재나 (파일만 읽는다 · `safe`) ══
 *     ① 🔴 **읽는 쪽이 있는데 쓰는 길이 0인 DB 칸.** 모수는 `drizzle/*.sql`(= 칸의 정본. `db/schema.ts` 가 아니다 —
 *        `opened_at` 은 schema.ts 에 아예 없다). 기본값(DEFAULT·serial) 있는 칸은 뺀다 — DB 가 채워 준다.
 *     ② 🔴 그 중 **시험 대본만 채우는 칸** — 이 집안에서 제일 고약한 얼굴이다.
 *        자·하니스가 `INSERT` 로 값을 넣어 주니 **자를 돌리면 잘 돈다.** 제품에는 길이 없는데 초록이 뜬다.
 *     ③ 대조군 — 길이 제대로 뚫린 칸이 실제로 있다(이 자가 «전부 빨강»이 아니다).
 *
 *   ══ «쓰는 길»로 치는 것 ══
 *     · 제품 코드(`lib/` · `netlify/functions/` · `runner/`)의 `INSERT INTO t (…)` · `UPDATE t SET col =` ·
 *       `sets.push(sql`col = …`)` 같은 **조각**.
 *     · `drizzle/*.sql` 의 `INSERT`(씨앗 표 — `channel_registry`·`emotion_profiles` 는 이렇게 채운다. 그게 그 표의 정식 길이다).
 *     · 🔴 **`scripts/` 는 길이 아니다.** 시험이 값을 만들어 주는 것과 제품이 값을 받는 것은 다르다.
 *
 *   🔴 **이 자가 못 하는 것**(AC-9):
 *     ① 화면에 입력칸이 **보이나**는 안 본다 — 서버에 길이 있나까지다(그 다음은 A 의 자).
 *     ② `jsonb` 안의 칸(`settings->>'x'`)은 안 본다 — 그건 `verify-upstream-discarded` 의 `meta` 축 몫이다.
 *        🔴 **그런데 그 짝도 `pieces.meta` 하나만 본다**(C 실측 2026-09-21): `db/schema.ts` 에 jsonb 칸이 **43개**인데
 *        **나머지 42개의 «안»은 두 자 중 누구도 안 본다.** 그 안에 이름 붙은 계약이 실제로 있다 —
 *        `ops_settings.features`(영상 킬 스위치가 살던 동네와 **같은 갈래인데 jsonb 키**) · `posts.stats`(`stats->>'views'`·`'alive'`) ·
 *        `tenants.settings` · `personas.profile` 등. (`runner_jobs.payload`·`result` 처럼 **불투명한 짐**은 «키 계약»이 아니라 대상이 아니다.)
 *        ⇒ 🔴 **«이 쌍이 전부를 덮는다»고 읽지 마라.** 아직 안 만든 이유: jsonb 안은 키가 코드마다 다르게 닿아서
 *        (`r.meta.x` · `settings.features.x` · `->>'x'`) **읽기 판정이 또 표를 못 가릴** 공산이 크다 — DB 칸에서 겪은 그 문제 그대로다.
 *     ③ 🔴 **반대 방향(«쓰는데 아무도 안 읽는 칸»)은 여기 안 둔다.** 돌려 보고 정했다:
 *        DB 칸에서는 이름이 짧은 것(`ref`·`key`·`ip`·`day`)이 많아 읽기 판정이 **표를 못 가린다** — 17칸이 나왔는데 전수 거짓양성이었다.
 *        그쪽은 `pieces.meta` 처럼 **이름이 긴 칸**에서만 잴 수 있고, 그 자가 이미 있다(`verify-upstream-discarded` ②축).
 *     ④ 🔴 **«계약 머리말에 적힌 요청 칸을 서버가 읽나»도 못 잰다.** 재 봤다 — 파일 하나만 보면 **21개가 헛 울고**
 *        (핸들러가 몸통을 통째로 `lib/` 에 넘긴다), 부르는 `lib/` 까지 봐 주면 **0개**(늘 초록)다. 둘 다 값이 0이라 접었다.
 *
 *   백슬래시 없는 검사만(AC-100) · 주석을 걷고 센다(AC-109 ①).
 *
 *   쓰기: node scripts/verify-write-path-missing.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const slash = (p) => p.split(path.sep).join("/");
function walk(d, re, acc = []) {
  if (!existsSync(d)) return acc;
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) { if (!/node_modules/.test(p)) walk(p, re, acc); }
    else if (re.test(f)) acc.push(p);
  }
  return acc;
}

/**
 * 🔴 **일부러 길을 안 낸 칸** — 이름과 **이유**를 같이 적는다(메인 지시 2026-09-20).
 *   «아직 안 만들었다»와 «일부러 안 만들었다»는 섞인다. 섞인 채로 두면 이 자가 늑대 소년이 되고,
 *   그렇다고 빈 목록으로 두면 진짜 고장이 이 줄에 묻힌다. ⇒ **이유 없는 이름은 넣지 마라.**
 */
const NO_WRITE_ON_PURPOSE = new Map([
  // (지금은 비어 있다. 2026-09-20 실측 두 건은 **둘 다 진짜 고장**이라 여기 넣지 않았다.)
]);

/** sql`…` 통째로 — 🔴 `${…}` 안의 **중첩 백틱**을 넘어간다. */
function sqlTemplates(src) {
  const out = [];
  for (let i = 0; i < src.length - 4; i++) {
    if (!src.startsWith("sql`", i)) continue;
    if (i > 0 && /[A-Za-z0-9_$.]/.test(src[i - 1])) continue;
    let j = i + 4, depth = 0, buf = "";
    for (; j < src.length; j++) {
      const c = src[j];
      /* 🔴 [변이 M7 이 고치게 했다] 첫 판은 `\` 와 **그 뒤 글자를 통째로 버렸다** — 원문에 글자로 적힌 줄바꿈이
         사라져 바로 앞의 `--` 주석이 **뒷줄의 쓰기까지 먹었다.** 두 글자를 그대로 들고 간다(뒤에서 평평하게 편다). */
      if (c === "\\") { if (depth === 0) buf += c + (src[j + 1] ?? ""); j++; continue; }
      if (depth === 0 && c === "`") break;
      if (c === "$" && src[j + 1] === "{") { depth++; j++; buf += " "; continue; }
      if (depth > 0) {
        if (c === "{") depth++;
        else if (c === "}") { depth--; buf += " "; }
        else if (c === "`") { const k = innerEnd(src, j); if (k > j) { buf += src.slice(j + 1, k); j = k; } }
        continue;
      }
      buf += c;
    }
    out.push(buf);
    i = j;
  }
  return out;
}
function innerEnd(src, at) {
  let depth = 0;
  for (let j = at + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") { j++; continue; }
    if (c === "$" && src[j + 1] === "{") { depth++; j++; continue; }
    if (depth > 0) { if (c === "{") depth++; else if (c === "}") depth--; continue; }
    if (c === "`") return j;
  }
  return -1;
}

/* ── 칸의 모수 = DDL ── */
const cols = new Map(); const withDefault = new Set();
for (const f of walk("drizzle", /[.]sql$/)) {
  const s = read(f).replace(/^\s*--.*$/gm, " ");
  for (const m of s.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+([^;,\n]*)/gi)) {
    const k = `${m[1].toLowerCase()}.${m[2]}`;
    cols.set(k, 1); if (/DEFAULT|GENERATED/i.test(m[3])) withDefault.add(k);
  }
  for (const m of s.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    for (const line of m[2].split("\n")) {
      const c = line.match(/^\s*(\w+)\s+([a-z][a-z0-9 ()]*)/i);
      if (!c || /^(PRIMARY|UNIQUE|CONSTRAINT|FOREIGN|CHECK|LIKE)$/i.test(c[1])) continue;
      const k = `${m[1].toLowerCase()}.${c[1]}`;
      cols.set(k, 1); if (/DEFAULT|GENERATED|serial/i.test(line)) withDefault.add(k);
    }
  }
}

const PROD = [...walk("lib", /[.]ts$/), ...walk("netlify/functions", /[.]ts$/), ...walk("runner", /[.](ts|mjs|js)$/)];
/**
 * 🔴 `scripts/` 를 **한 덩어리로 보면 안 된다**(첫 판이 그랬고 `emotion_profiles.key` 를 헛 울렸다).
 *   · `seed-*` = **씨앗 대본**. 참조표(`emotion_profiles`·`channel_registry`)를 채우는 **정식 길**이다 — 길로 친다.
 *   · 그 밖(`verify-*`·`mutate-*`·`_smoke/*`) = **시험 대본**. 값을 만들어 주기만 하니 길이 아니다.
 */
/* 🔴 [변이 M5 가 고치게 했다] 첫 판은 `seed-[a-z0-9-]+` 였다 — **밑줄 든 이름**(`seed-_x.mjs`)을 시험 대본으로 읽었다. */
const SEED = walk("scripts", /[.](mjs|mts)$/).filter((f) => /(^|[/\\])seed-[A-Za-z0-9_-]+[.]m?[jt]s$/.test(slash(f)));
const TEST = walk("scripts", /[.](mjs|mts)$/).filter((f) => !SEED.includes(f));
const tablesOf = (q) => new Set([...q.matchAll(/(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(?:ONLY\s+)?(\w+)/gi)].map((m) => m[1].toLowerCase()));
const MIN_NAME = 3;

/** 🔴 SET **구역**을 떼어 본다. «앞 낱말이 SET 인가»로 세면 `CASE WHEN … THEN` 이 속인다(실제로 두 칸을 헛 울렸다). */
function setAssignments(q) {
  const outs = [];
  for (const m of q.matchAll(/\bSET\b([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|$)/gi)) {
    /* 🔴 SQL 의 `--` 줄주석을 걷는다. 안 걷으면 «쉼표 — 주석 — 다음 칸» 사이가 끊겨 **그 칸의 쓰기를 못 본다**
       (`ops-tenants.ts` 의 `internal_manual_at` 이 바로 그 모양이었다 · 거짓 빨강 1건).
       🔴 [변이 M7 이 고치게 했다] 원문에 **글자로 적힌 줄바꿈**(백슬래시+n)이 있으면 주석이 거기서 끝나는데
          자는 «줄 끝까지»로 읽어 **그 뒤의 쓰기를 통째로 먹었다.** 먼저 진짜 줄바꿈으로 바꿔 놓고 걷는다. */
    const flat = m[1].split(String.fromCharCode(92) + "n").join("\n");
    const region = flat.replace(/--[^\n]*/g, " ").replace(/\bCASE\b[\s\S]*?\bEND\b/gi, " ").replace(/\(([^()]*)\)/g, " ");
    for (const a of region.matchAll(/(?:^|,)\s*(\w+)\s*=\s*(?!=)/g)) outs.push(a[1]);
  }
  return outs;
}
/**
 * 조각(`sets.push(sql`col = …`)`) — 절 낱말이 하나도 없는 통짜 대입.
 * 🔴 [변이 M7 이 고치게 했다] 첫 판은 **맨 앞 하나만** 집었다. 한 조각이 두 칸을 쓰면(쉼표로 이어 쓴다)
 *    뒤엣것을 통째로 놓쳐 **멀쩡한 칸을 빨갛게** 한다. 전부 돌려준다.
 */
function fragmentAssignments(q) {
  if (/\b(SELECT|INSERT|UPDATE|DELETE|WHERE|FROM|JOIN)\b/i.test(q)) return [];
  const flat = q.split(String.fromCharCode(92) + "n").join("\n").replace(/--[^\n]*/g, " ").replace(/\(([^()]*)\)/g, " ");
  return [...flat.matchAll(/(?:^|,)\s*(\w+)\s*=\s*(?!=)/g)].map((m) => m[1]);
}

function scanCode(files) {
  const W = new Map(), R = new Map();
  const add = (M, k, f) => { const s = M.get(k) ?? new Set(); s.add(slash(f)); M.set(k, s); };
  for (const f of files) {
    const s = codeOnly(read(f));
    const loose = new Set();
    const fileTables = new Set([...s.matchAll(/UPDATE\s+(\w+)/gi)].map((m) => m[1].toLowerCase()));
    for (const q of sqlTemplates(s)) {
      const tb = tablesOf(q);
      for (const i of q.matchAll(/INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)/gi)) {
        for (const c of i[2].split(",")) { const nm = c.trim().replace(/"/g, ""); if (/^\w+$/.test(nm)) add(W, `${i[1].toLowerCase()}.${nm}`, f); }
      }
      for (const col of setAssignments(q)) for (const t of tb) if (cols.has(`${t}.${col}`)) add(W, `${t}.${col}`, f);
      for (const frag of fragmentAssignments(q)) loose.add(frag);
      for (const key of cols.keys()) {
        const [tbl, col] = key.split(".");
        if (col.length < MIN_NAME || !tb.has(tbl)) continue;
        if (new RegExp("(?:^|[^A-Za-z0-9_.])" + col + "(?![A-Za-z0-9_])").test(q) || new RegExp("[.]" + col + "(?![A-Za-z0-9_])").test(q)) add(R, key, f);
      }
    }
    for (const c of loose) for (const t of fileTables) if (cols.has(`${t}.${c}`)) add(W, `${t}.${c}`, f);
  }
  return { W, R };
}
/** DDL 의 씨앗 `INSERT` 도 **정식 길**이다(참조표는 이렇게 채운다). */
function scanDdlInserts() {
  const W = new Map();
  for (const f of walk("drizzle", /[.]sql$/)) {
    const s = read(f).replace(/^\s*--.*$/gm, " ");
    for (const m of s.matchAll(/INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)/gi)) {
      for (const c of m[2].split(",")) {
        const nm = c.trim().replace(/"/g, "");
        if (!/^\w+$/.test(nm)) continue;
        const k = `${m[1].toLowerCase()}.${nm}`;
        const set = W.get(k) ?? new Set(); set.add(slash(f)); W.set(k, set);
      }
    }
  }
  return W;
}

const prod = scanCode(PROD), test = scanCode(TEST), seed = scanCode(SEED), ddl = scanDdlInserts();

const out = [];
const rec = (step, ok, note) => { out.push({ ok }); console.log(`  ${ok ? "✓" : "✗"} ${step}  — ${note}`); return ok; };

console.log(`\n«읽는 쪽은 있는데 쓰는 길이 없나» · ${new Date().toISOString()}`);
console.log(`■ 내가 세는 모수 — DDL 칸 ${cols.size}개 중 **기본값 없는 것** ${cols.size - withDefault.size}개 · 제품 파일 ${PROD.length}개 · 일부러 뺀 칸 ${NO_WRITE_ON_PURPOSE.size}개`);
console.log("─".repeat(120));

/* 읽는데 쓰는 길이 0인 칸 모으기 */
const orphan = [];
for (const k of cols.keys()) {
  if (withDefault.has(k) || NO_WRITE_ON_PURPOSE.has(k)) continue;
  if (!prod.R.has(k) || prod.W.has(k) || ddl.has(k) || seed.W.has(k)) continue;
  orphan.push({ k, readers: [...prod.R.get(k)], testOnly: test.W.has(k) ? [...test.W.get(k)].map((x) => path.basename(x)) : [] });
}
orphan.sort((a, b) => b.readers.length - a.readers.length);
const say = (o) => `${o.k}(읽는 곳 ${o.readers.length}: ${o.readers.map((x) => path.basename(x)).slice(0, 4).join(",")})`;

/* ① 읽는데 쓰는 길이 0 */
{
  rec("① 🔴 읽는 쪽이 있는 칸은 **쓰는 길**도 있다", orphan.length === 0,
    orphan.length ? `🔴 길이 없는 칸 ${orphan.length}개: ${orphan.map(say).join(" · ")} — 읽는 쪽은 영원히 폴백을 쓴다(«아무도 안 틀렸는데 기능이 없다»)`
      : "읽는 칸은 전부 제품 코드나 DDL 씨앗이 채운다");
}

/* ② 그 중 시험 대본만 채우는 칸 — 제일 고약한 얼굴 */
{
  const fake = orphan.filter((o) => o.testOnly.length);
  rec("② 🔴 **시험 대본만 채우는 칸**이 없다(자가 값을 만들어 주면 아무도 못 본다)", fake.length === 0,
    fake.length ? `🔴 ${fake.length}개: ${fake.map((o) => `${o.k} <- ${o.testOnly.join(",")}`).join(" · ")} — 자를 돌리면 잘 도는데 제품에는 길이 없다`
      : "시험 대본이 값을 만들어 주는 칸은 없다");
}

/* ═══ ④ [AC-258] 🔴 **«값이 들어가는 길»과 «사람이 나중에 바꾸는 길»은 다른 질문이다** ═══
   이 자는 ①에서 «길이 있나»를 묻고, 씨앗 대본·DDL INSERT 를 **정식 길**로 친다. 그건 맞다.
   ⚠️ 그런데 설계가 «운영자가 **화면에서** 조정 · 재배포 0»이라 적어 둔 칸이라면 씨앗은 **답이 아니다** —
      씨앗은 **한 번 깔고 끝**이고, 그 뒤에 바꾸려면 사람이 손으로 SQL 을 쳐야 한다.
   🔴 실제로 그랬다: `emotion_profiles.contract` 는 ①에서 **초록**이었다(`scripts/seed-plans.mjs:65` 가 채운다).
      그런데 **쓰는 API 0 · 화면 0** 이라 2026-09-23 까지 운영자가 말투 한 줄을 못 고쳤다(AC-258 에서 열었다).
   ⇒ **빨강으로 내지 않는다**(참조표는 코드가 정본인 게 맞는 것도 있다 · 늘 빨간 자는 곧 무시된다 · AC-112⑤).
      **이름을 대서 보여 준다** — «이 칸들은 깔고 나면 손 SQL 말고는 못 바꾼다». */
{
  const seedOnly = [];
  for (const k of cols.keys()) {
    if (NO_WRITE_ON_PURPOSE.has(k)) continue;
    if (!prod.R.has(k)) continue;                       // 제품이 읽지도 않으면 이 질문의 대상이 아니다
    if (prod.W.has(k)) continue;                        // 제품이 쓰면 «나중에 바꾸는 길»이 있다
    if (!(seed.W.has(k) || ddl.has(k))) continue;       // 씨앗조차 없으면 그건 ①이 잡는다
    seedOnly.push(k);
  }
  console.log(`  ⚠️ ④ [AC-258] **깔고 나면 손 SQL 말고는 못 바꾸는 칸** ${seedOnly.length}개 — ${seedOnly.length ? seedOnly.join(" · ") : "없다"}`);
  console.log(`     🔴 빨강이 아니다. 다만 설계가 그 칸에 «운영자가 화면에서 바꾼다»를 약속했으면 **그건 아직 빈 약속**이다.`);
}

/* ③ 대조군 — 길이 제대로 뚫린 칸이 실제로 있다 */
{
  /* 🔴 셋 다 있어야 통과다(둘로 두면 하나를 치워도 안 운다 — 옆 자에서 겪었다). */
  const WANT = ["accounts.proxy_url", "accounts.quality_tier", "tickets.first_reply_at"];
  const lost = WANT.filter((k) => !prod.W.has(k));
  rec("대조군 — **길이 뚫린 칸도 실제로 있다**(이 자가 둘을 가른다)", lost.length === 0,
    lost.length === 0 ? `${WANT.join(" · ")} 는 읽는 쪽도 쓰는 쪽도 있다 — 이 모양이 정답이다`
      : `🔴 길이 사라진 대조군: ${lost.join(", ")} — 자가 쓰기를 못 보고 있거나(자 고장) 길이 없어졌다(제품 고장)`);
}

console.log("─".repeat(120));
const bad = out.filter((x) => !x.ok).length;
console.log(bad ? `🔴 FAIL ${bad} / ${out.length}` : `PASS ${out.length} · FAIL 0`);
console.log("🔴 이 자는 **서버에 길이 있나**까지 잰다 — 화면에 입력칸이 보이나는 안 본다(머리말).");
process.exit(bad ? 1 : 0);
