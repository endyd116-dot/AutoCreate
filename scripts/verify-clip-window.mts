/**
 * scripts/verify-clip-window.mts — [R17-B2 · 2026-09-23] 🔴 **클립 모집창이 «넣으면 읽힌다»를 왕복으로 증명한다.**
 *
 *   ══ 왜 이 자가 필요한가 ══
 *   R16 재측정에서 이 기능은 **오류 0인 채로 9일 동안 죽어 있었다**:
 *     `lib/ad-eligibility.ts` 가 `monetize->'clipOpen'` 을 읽는데 `channel_registry.monetize` 는 **배열**이었고
 *     `ops-channels.ts` 는 그 칸을 배열로 **통째 덮어썼다.** 배열에 `->'clipOpen'` 을 하면 **언제나 NULL** 이다.
 *   🔴 **아무것도 안 터지고 알림만 안 떴다** — 그래서 사람도 검사도 못 봤다. «조용한 죽음»은 자가 없으면 못 잡는다.
 *   ⇒ 이 자는 **뜻**을 잰다: «운영자가 넣은 날짜를 알림 로직이 그대로 읽나».
 *
 *   ══ 무엇을 하나(라이브 · 스스로 치운다) ══
 *     ① 지금 값을 적어 둔다(있으면)              ④ 지우기 SQL(`- 'clipOpen'`) → `clipWindow()` 가 null 인가
 *     ② 넣기 SQL(핸들러와 **같은 글자**) → 넣는다  ⑤ ①의 값을 그대로 되돌린다
 *     ③ `clipWindow()` 가 그 날짜를 읽나          ⑥ 🔴 `monetize`(배열)가 **안 다쳤나** — 원래 사고가 그 자리였다
 *
 *   🔴 **알림은 안 나간다** — 알림은 `judgeAndNotify` 가 «그 채널 계정을 가진 테넌트»에만 보내는데
 *      이 자는 `channel_registry` 한 행만 건드리고 계정·크론을 안 부른다. 그리고 넣은 값을 **바로 되돌린다.**
 *
 *   쓰기: node --import tsx scripts/verify-clip-window.mts   (또는 npx tsx)
 */
import "./_lib/load-env.mjs";
import { sql } from "drizzle-orm";
import { db } from "../db/index";
import { jsonb } from "../lib/db-util";
import { clipWindow } from "../lib/ad-eligibility";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

const KEY = "naver_clip";
const fails: string[] = [];
const ok = (cond: boolean, say: string) => { console.log(`   ${cond ? "✓" : "✗"} ${say}`); if (!cond) fails.push(say); };

console.log("\n── 클립 모집창 왕복 실증(라이브 · 스스로 치운다) ──");

/* ① 지금 값 */
const [before] = await q(sql`SELECT monetize::text AS mon, monetize_meta::text AS meta, monetize_meta->'clipOpen' AS clip FROM channel_registry WHERE key = ${KEY}`);
if (!before) { console.log(`   ✗ ${KEY} 행이 레지스트리에 없다 — 못 쟀다`); process.exit(2); }
const monBefore = String(before.mon);
const clipBefore = before.clip as { from?: string; to?: string } | null;
console.log(`   시작 상태: monetize=${monBefore} · clipOpen=${clipBefore ? JSON.stringify(clipBefore) : "없음"}`);

try {
  /* ② 넣기 — `netlify/functions/ops-channels.ts` 의 SQL 과 **같은 글자**여야 이 자가 그 경로를 잰 것이 된다. */
  const win = { from: "2099-01-02", to: "2099-01-09" };   // 🔴 먼 미래 — 혹시라도 알림 판정에 걸리지 않게
  await q(sql`UPDATE channel_registry SET monetize_meta = COALESCE(monetize_meta, '{}'::jsonb) || ${jsonb({ clipOpen: win })} WHERE key = ${KEY}`);

  /* 🔴 jsonb 는 쓴 직후 `jsonb_typeof` 까지 봐야 쓴 것이다(PITFALLS #1). */
  const [t] = await q(sql`SELECT jsonb_typeof(monetize_meta) AS tt FROM channel_registry WHERE key = ${KEY}`);
  ok(String(t?.tt) === "object", `monetize_meta 가 object 다(지금 «${t?.tt}») — 배열이면 옛 사고가 그대로 돌아온 것이다`);

  /* ③ 알림 로직이 읽나 — 🔴 이게 이 자의 본론이다(«칸에 있다»가 아니라 «읽는 쪽이 본다»). */
  const got = await clipWindow();
  ok(!!got && got.from === win.from && got.to === win.to, `clipWindow() 가 넣은 날짜를 그대로 읽는다(받은 값: ${JSON.stringify(got)})`);

  /* ⑥ 🔴 원래 사고 자리 — 모집창을 넣었는데 수익 매체 목록이 다치면 안 된다(반대로 종전엔 목록 저장이 모집창을 지웠다). */
  const [m] = await q(sql`SELECT monetize::text AS mon, jsonb_typeof(monetize) AS tt FROM channel_registry WHERE key = ${KEY}`);
  ok(String(m?.mon) === monBefore && String(m?.tt) === "array", `monetize(수익 매체 목록)가 안 다쳤다 — 여전히 array 이고 값도 그대로다`);

  /* ④ 지우기 — 화면에서 둘 다 비우고 저장했을 때의 경로. */
  await q(sql`UPDATE channel_registry SET monetize_meta = monetize_meta - 'clipOpen' WHERE key = ${KEY}`);
  const gone = await clipWindow();
  ok(gone === null, `지우면 clipWindow() 가 null 이다(«안 알림»으로 돌아간다 · 받은 값: ${JSON.stringify(gone)})`);

  /* 🔴 뒤집힌 창은 읽는 쪽도 안 믿는다 — 서버 검증을 우회해 직접 박아 넣어도 `clipWindow()` 가 걸러야 한다. */
  await q(sql`UPDATE channel_registry SET monetize_meta = COALESCE(monetize_meta, '{}'::jsonb) || ${jsonb({ clipOpen: { from: "2099-02-10", to: "봄" } })} WHERE key = ${KEY}`);
  const bad = await clipWindow();
  ok(bad === null, `날짜 모양이 아니면 null 이다 — 반쪽짜리 값으로 알림을 보내지 않는다(받은 값: ${JSON.stringify(bad)})`);
} finally {
  /* ⑤ 되돌린다 — 이 자가 만든 것은 이 자가 지운다(조사 규율 그대로). */
  await q(sql`UPDATE channel_registry SET monetize_meta = monetize_meta - 'clipOpen' WHERE key = ${KEY}`);
  if (clipBefore) await q(sql`UPDATE channel_registry SET monetize_meta = COALESCE(monetize_meta, '{}'::jsonb) || ${jsonb({ clipOpen: clipBefore })} WHERE key = ${KEY}`);
  const [after] = await q(sql`SELECT monetize::text AS mon, monetize_meta->'clipOpen' AS clip FROM channel_registry WHERE key = ${KEY}`);
  const same = String(after?.mon) === monBefore && JSON.stringify(after?.clip ?? null) === JSON.stringify(clipBefore ?? null);
  console.log(`   ${same ? "✓" : "✗"} 시작 상태로 되돌렸다(monetize·clipOpen 둘 다)`);
  if (!same) fails.push("되돌리기 실패 — 라이브 값이 바뀐 채로 남았다");
}

console.log(fails.length ? `\n🔴 ${fails.length}건 실패\n` : "\n✅ 넣으면 읽히고, 지우면 안 읽히고, 수익 매체 목록은 안 다친다\n");
process.exit(fails.length ? 1 : 0);
