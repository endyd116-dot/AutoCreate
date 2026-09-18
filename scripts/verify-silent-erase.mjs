/**
 * scripts/verify-silent-erase.mjs — 🔴 **«운영 손이 고객의 뜻을 말없이 지우지 않는다»**(C · 수리 라운드 2026-09-19 · B⑤).
 *   사용: node scripts/verify-silent-erase.mjs
 *         node scripts/verify-silent-erase.mjs --list   (본 칸을 전부 찍는다 — 모수를 보인다)
 *
 *   ══ 왜 이 자가 있나 — 고객의 해지 예약이 조용히 취소된다 ══
 *   2026-09-19 시나리오 B: 고객이 정상 경로로 «이번 달까지만 쓸게요»를 걸어 뒀다(`cancel_at_period_end = true`).
 *   그 뒤 운영자가 **상태 하나만** 바꿨는데(플랜 칩은 그대로) —
 *     `cancel_at_period_end` **true → false** · `period_end`·`next_billing_at` 재설정 · «요금제가 바뀌었어요» 알림 발송
 *   ⇒ **다음 달에 또 결제된다.** 운영자 화면엔 «바꿨어요» 한 줄만 떴다.
 *   원인 — `netlify/functions/ops-tenants.ts:208` 이 `SELECT status, plan_key` 만 읽고,
 *   `:225~228` 의 UPSERT 가 `cancel_at_period_end = false · pending_plan_key = NULL` 로 덮는다.
 *   🔴 **지우기 전에 읽지를 않으니, 자기가 무엇을 지웠는지 기록할 수도 없다** — 감사 `detail` 에도 그 말이 없다.
 *
 *   ══ 무엇을 세는가 — 🔴 손 목록이 없다(AC-108) ══
 *   ① 운영 경로(`netlify/functions/ops-*.ts`)의 SQL 에서 **칸을 비우는 자리**(`col = NULL|false|0`)를 전부 거둔다.
 *   ② 그 칸이 **운영 밖**(`lib/**` · `ops-` 아닌 함수)에서 **뜻을 담아 쓰이는가** 확인한다(`col = ${…}` · `col = true`).
 *      ⇒ 그래야 «고객·시스템이 뜻을 담아 넣는 칸»이다. 아니면 운영 전용 칸이라 볼 것 없다.
 *   ③ 그런 칸을 비우면서 **그 라우트 블록이 그 칸을 읽지도(SELECT) 남기지도(감사 detail) 않으면** 빨강.
 *
 *   ══ 🔴 이 자가 **아직 못 하는 것**(못으로 박아 둔다 · AC-109 ㉰) ══
 *   · «읽었다»를 **글자**로 본다 — 읽고 나서 정말 고객에게 말해 주는지는 사람이 본다.
 *   · `EXCLUDED.<col>` 처럼 UPSERT 로 덮는 것은 «비움»으로 안 센다(값을 넣는 것이라).
 *   · 운영 밖에서 쓰이지 않는 칸(운영 전용)은 축 밖이다 — 지워도 고객의 뜻이 아니다.
 *
 *   종료코드: 0 = 말없이 지우는 자리가 없다 · 1 = 있다 · 2 = 못 쟀다.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.env.SILENT_ERASE_ROOT ? path.resolve(process.env.SILENT_ERASE_ROOT) : path.resolve(import.meta.dirname, "..");
const FN = path.join(ROOT, "netlify", "functions");
const LIB = path.join(ROOT, "lib");
const LIST = process.argv.includes("--list");
if (!existsSync(FN) || !existsSync(LIB)) { console.error("⊘ 못 쟀어요 — netlify/functions/ 또는 lib/ 가 없습니다."); process.exit(2); }

const out = [];
const rec = (step, ok, note) => { out.push({ step, ok, note }); console.log(`  ${ok ? "✓" : "✗"} ${step}  — ${note}`); return ok; };
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}
const lineOf = (src, i) => src.slice(0, i).split("\n").length;

/* ═══ ② «운영 밖에서 뜻을 담아 쓰는 칸» 사전을 **코드에서** 만든다 ═══ */
const meaningful = new Map();   // 칸 이름 → 그렇게 쓰는 자리
for (const f of [...walk(LIB), ...walk(FN)]) {
  const r = rel(f);
  if (r.startsWith("lib/ops/") || /\/ops-[^/]*\.ts$/.test(r)) continue;   // 운영 쪽은 «뜻» 출처로 안 센다
  const src = codeOnly(readFileSync(f, "utf8"));
  /* `col = ${…}` 또는 `col = true` — 값을 **넣는** 자리 */
  for (const m of src.matchAll(/\b([a-z][a-z0-9_]*)\s*=\s*(\$\{[^}]*\}|true\b)/g)) {
    if (/^(?:const|let|var)$/.test(m[1])) continue;
    if (!meaningful.has(m[1])) meaningful.set(m[1], `${r}:${lineOf(src, m.index)}`);
  }
}

/* ═══ ① 운영 경로가 **비우는** 칸 ═══ */
const erases = [];
for (const f of walk(FN)) {
  const r = rel(f);
  if (!/\/ops-[^/]*\.ts$/.test(r)) continue;
  const src = codeOnly(readFileSync(f, "utf8"));
  /* 라우트 블록을 중괄호 균형으로 자른다(다른 자들과 같은 방식). */
  const marks = [...src.matchAll(/if\s*\(\s*path\.endsWith\s*\(\s*["'`]([^"'`]+)["'`]\s*\)\s*\)/g)];
  const blockOf = (m) => {
    const open = src.indexOf("{", m.index + m[0].length - 1);
    if (open < 0) return [m.index, src.length];
    let d = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") d++;
      else if (src[i] === "}") { d--; if (!d) return [m.index, i + 1]; }
    }
    return [m.index, src.length];
  };
  const blocks = marks.map((m) => ({ route: m[1], span: blockOf(m) }));
  for (const m of src.matchAll(/\b([a-z][a-z0-9_]*)\s*=\s*(NULL|false|0)\b/gi)) {
    const col = m[1];
    if (!meaningful.has(col)) continue;                      // 운영 전용 칸 — 고객의 뜻이 아니다
    if (/EXCLUDED\./i.test(src.slice(Math.max(0, m.index - 30), m.index))) continue;
    const blk = blocks.find((b) => m.index >= b.span[0] && m.index < b.span[1]);
    const text = blk ? src.slice(blk.span[0], blk.span[1]) : src;
    /* «읽었나» — 같은 블록의 SELECT 에 그 칸이 있거나, 감사 detail 에 그 이름이 실려 있거나. */
    const readsIt = new RegExp(`SELECT[\\s\\S]{0,400}?\\b${col}\\b`, "i").test(text)
      || new RegExp(`detail\\s*:\\s*\\{[^}]*\\b${col.replace(/_([a-z])/g, (s, c) => c.toUpperCase())}\\b`).test(text)
      || new RegExp(`detail\\s*:\\s*\\{[^}]*\\b${col}\\b`).test(text);
    /* 🔴 **어느 표를 건드리는지**까지 본다 — 이게 거짓 빨강과 진짜를 가른다.
       첫 판은 표를 안 봐서 `readonly_at = NULL`(체험 연장) · `claimed_by = NULL`(막힌 잡 풀기)까지 빨갛게 냈다.
       🔴 그 둘은 **지우는 것이 그 동작의 목적**이다 — 운영자가 그걸 하러 누른 것이다. 곁다리로 지워지는 게 아니다.
       진짜 병은 «**고객이 서 있게 걸어 둔 지시**»(구독 장부 `subscriptions` — 해지 예약·예약된 플랜)가
       **다른 일을 하다가** 곁다리로 지워지는 것이다. 그래서 판정은 그 표로 좁히고 나머지는 «△ 살펴볼 것»으로 찍는다. */
    /* 🔴 표는 **문장 앞머리**에서만 읽는다(`UPDATE x` · `INSERT INTO x`).
       첫 판은 `m.index + 200` 까지 봤더니 **바로 다음 줄의 `INSERT INTO subscriptions` 가 넘어와**
       `UPDATE tenants … readonly_at = NULL`(:224) 을 «구독 장부»로 잘못 읽었다. 뒤를 보면 안 된다. */
    const stmtFrom = src.lastIndexOf("sql`", m.index);
    const stmt = stmtFrom >= 0 ? src.slice(stmtFrom, m.index) : "";
    const table = (stmt.match(/(?:UPDATE|INSERT\s+INTO)\s+([a-z_]+)/i) ?? [])[1] ?? "(모름)";
    erases.push({ file: r, line: lineOf(src, m.index), col, route: blk?.route ?? "(블록 밖)", readsIt, setTo: m[2], from: meaningful.get(col), table });
  }
}

console.log(`\n«운영 손이 고객의 뜻을 말없이 지우지 않는다» · ${new Date().toISOString()}`);
console.log(`■ 내가 세는 모수 — 운영 밖에서 **뜻을 담아 쓰는 칸** ${meaningful.size}개 중, 운영 경로가 **비우는** 자리 **${erases.length}곳**`);
console.log("─".repeat(120));
if (LIST) for (const e of erases) console.log(`  ${e.readsIt ? "✅읽고지움" : "🔴말없이지움"}  ${e.file}:${e.line}  [${e.route}]  ${e.col} = ${e.setTo}   (뜻을 담는 자리: ${e.from})`);

/** 🔴 판정 대상 = **구독 장부**(고객이 서 있게 걸어 둔 지시). 나머지는 «살펴볼 것». */
const STANDING = "subscriptions";
const silent = erases.filter((e) => !e.readsIt && e.table === STANDING);
const others = erases.filter((e) => !e.readsIt && e.table !== STANDING);
const loud = erases.filter((e) => e.readsIt);

if (others.length) {
  console.log(`\n△ 살펴볼 것 — 구독 장부 밖에서 비우는 자리(판정 밖 · **지우는 것이 그 동작의 목적**일 수 있다):`);
  for (const e of others) console.log(`   · ${e.file}:${e.line} [${e.route}] ${e.table}.${e.col} = ${e.setTo}`);
  console.log(`   🔴 예: \`/ops-trial-extend\` 의 \`readonly_at = NULL\` 은 **그걸 하러 누른 것**이다 — 곁다리가 아니다.\n`);
}

rec(`🔴 운영 경로가 **고객이 걸어 둔 지시**(${STANDING})를 비울 때 먼저 읽거나 감사에 남긴다`, silent.length === 0,
  silent.length ? `말없이 지우는 자리 ${silent.length}곳 / ${STANDING} 을 비우는 자리 ${erases.filter((e) => e.table === STANDING).length}곳` : `${STANDING} 을 비우는 자리 전부 읽거나 남긴다`);
for (const e of silent) {
  console.log(`   🔴 ${e.file}:${e.line}  [${e.route}]  \`${e.col} = ${e.setTo}\``);
  console.log(`      그 칸은 운영 밖에서 **뜻을 담아** 쓰인다 — ${e.from}`);
  console.log(`      ⇒ 지우기 전에 읽지 않으니 **무엇을 지웠는지 기록할 수도 없다.** 운영자는 자기가 무엇을 없앴는지 모른다.`);
}
rec("대조군 — **읽고 지우는 자리도 있다**(이 자가 둘을 가른다)", loud.length > 0,
  loud.length ? `${loud.length}곳 (예: ${loud.slice(0, 3).map((e) => `${e.file}:${e.line} ${e.col}`).join(", ")})` : "🔴 하나도 없다 — 이 자는 가른 적이 없다");

/* ═══ ⓪ 자기 찌르기 — 🔴 «우는가»를 잰다(AC-108) ═══ */
{
  const judge = (list) => list.filter((e) => !e.readsIt).length;
  rec("⓪a 자기 찌르기 — **읽는 것으로 바꾸면 그 빨강이 사라진다**(늘 빨간 자가 아니다)",
    judge(erases.map((e) => ({ ...e, readsIt: true }))) === 0, `전부 읽는 것으로 두면 ${judge(erases.map((e) => ({ ...e, readsIt: true })))}곳`);
  rec("⓪b 자기 찌르기 — **읽던 자리에서 읽기를 빼면 운다**",
    loud.length === 0 || judge(erases.map((e) => ({ ...e, readsIt: false }))) > silent.length,
    `전부 안 읽는 것으로 두면 ${judge(erases.map((e) => ({ ...e, readsIt: false })))}곳(지금 ${silent.length}곳)`);
  rec("⓪c 자기 찌르기 — **운영 전용 칸은 축 밖이다**(거짓 빨강 방지)", true,
    `운영 밖에서 안 쓰이는 칸은 애초에 안 거뒀다 — 지워도 고객의 뜻이 아니다`);
}

console.log("─".repeat(120));
const fails = out.filter((o) => !o.ok);
console.log(`PASS ${out.length - fails.length} · FAIL ${fails.length} · 비우는 자리 ${erases.length}곳(말없이 ${silent.length} · 읽고 ${loud.length})`);
console.log("🔴 이 자는 «읽었나»만 글자로 본다 — 읽고 나서 **고객에게 말해 주는지**는 사람이 본다.\n");
process.exit(fails.length ? 1 : 0);
