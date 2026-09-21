/**
 * scripts/verify-ops-requeue-doors.mjs — 🔴 **운영자 문 둘**이 정말로 채널에 묻고 되돌리는가(AC-214 · B2 · 2026-09-22).
 *   사용: `node scripts/verify-ops-requeue-doors.mjs` · 네트워크 0 · DB 0 · 소스만 읽는다
 *
 *   ══ 🔴 이 자가 왜 따로 있나 — C 의 자에 **사각**이 있다(무르게 하려는 게 아니라 메우려는 것) ══
 *     `scripts/verify-requeue-guarded.mjs`(C) 는 문 7개를 세는 **정본**이고, 이 자는 그걸 대신하지 않는다.
 *     다만 그 자의 `guardNear` 는 「위로 올라가 `function 이름` 을 찾고 아래로 다음 `function` 까지」를 함수 몸통으로 본다.
 *     🔴 `netlify/functions/ops-runners.ts` 의 핸들러는 **화살표 함수**(`export default async (req) => {…}`)라
 *        위아래 어디에도 `function 이름` 이 없다 ⇒ 몸통이 **파일 전체**가 된다 ⇒
 *        **`import { reconcileLostPublish }` 한 줄만 있어도 그 파일의 모든 문이 초록**이다.
 *     실측(2026-09-22 · `_tmp/mutate-doors.mjs`): 두 문의 **호출을 빼도** C 의 자는 **종료코드 0**(못 잡는다).
 *        다른 두 문(`releaseJob`·`reapStaleJobs`)은 같은 변이로 **잡힌다**(1) — 그 자는 거기선 멀쩡하다.
 *     ⇒ C 의 자를 고치는 것은 C 의 몫이라 **건드리지 않았다.** 대신 그때까지 이 자가 그 둘을 지킨다.
 *        🔴 **C 의 자가 화살표 함수를 배우면 이 파일은 지워도 된다.**
 *
 *   ══ 재는 것 — «있나»가 아니라 «**어디에** 있나» ══
 *     ① 두 갈래(`release`·`remove`) 각각이 **되돌리는 SQL 앞에** 화해기를 부르나
 *     ② 🔴 `remove` 는 **`DELETE FROM runner_devices` 보다도 앞**이어야 한다(B 지적 2026-09-22) —
 *        기기를 지우고 나면 **누가 그 잡을 물고 있었는지조차 사라진다.**
 *     ③ 운영자에게 **보이나** — 응답과 감사 `detail` 에 결과가 실리나(운영자 문이니 운영자가 봐야 한다)
 *     ④ 🔴 자기 변이 — 위 못들을 하나씩 빼 보고 **이 자가 우는지**(안 울면 이 자도 있으나 마나다)
 */
import { readFileSync } from "node:fs";

const FILE = "netlify/functions/ops-runners.ts";
const src = readFileSync(FILE, "utf8");

let pass = 0; let fail = 0; let unmeasured = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ""}`); } };
/* 🔴 [AC-216] «못 쟀다»를 «틀렸다»에 섞지 않는다 — 자가 깨진 것이 제품이 틀린 것으로 보이면 엉뚱한 데를 판다. */
const gone = (name, why = "갈래를 못 잡았다 — 닻이나 끝 표식이 바뀌었나") => { unmeasured++; console.log(`  ⊘ ${name} — 못 쟀음(${why})`); };

/**
 * `action === "x"` 갈래의 몸통.
 *   🔴 [AC-216] 종전엔 「다음 갈래를 못 찾으면 **`rest`(파일 끝까지)**」였다 — B 가 세운 잣대의 ①꼴이다.
 *      `remove` 는 **마지막 갈래**라 창이 늘 EOF 까지였다. 지금 이 자는 «순서»를 재서 안 속았지만
 *      («호출이 되돌리기보다 앞인가»), **그건 운이지 규율이 아니다.** 끝 표식을 못 찾으면 **`null`**(⊘) 이다.
 */
function branch(text, action) {
  const i = text.indexOf(`action === "${action}"`);
  if (i < 0) return null;                                  // 닻이 없다 = ⊘(«가드 없음»이 아니다)
  const rest = text.slice(i);
  const ends = [/if \(action === "/, /return badRequest\("action 은/, /return json\(\{ ok: false, error: "not_found"/];
  let end = -1;
  for (const re of ends) { const k = rest.slice(1).search(re); if (k > 0 && (end < 0 || k < end)) end = k; }
  return end > 0 ? rest.slice(0, end + 1) : null;          // 🔴 끝을 못 찾으면 **넓히지 않고 못 쟀다고 한다**
}

/** 그 몸통 안에서 «채널에 묻기»가 «되돌리기»보다 앞인가. 🔴 순서가 이 기능의 전부다. */
function asksBeforeRequeue(body) {
  if (!body) return { ok: false, why: "갈래를 못 찾음" };
  const ask = body.search(/reconcileClaimed\s*\(|reconcileLostPublish\s*\(/);
  const requeue = body.search(/UPDATE runner_jobs SET status = 'queued'/);
  if (ask < 0) return { ok: false, why: "화해기를 아예 안 부른다" };
  if (requeue < 0) return { ok: false, why: "되돌리는 SQL 을 못 찾음(모양이 바뀌었나)" };
  return { ok: ask < requeue, why: ask < requeue ? "" : "🔴 되돌린 **뒤에** 묻는다 — 이미 늦었다" };
}

console.log("① 두 운영자 갈래가 되돌리기 **전에** 채널에 묻나");
{
  for (const a of ["release", "remove"]) {
    const b = branch(src, a);
    if (b == null) { gone(`action="${a}" — 묻고 나서 되돌린다`); continue; }
    const r = asksBeforeRequeue(b);
    ok(`action="${a}" — 묻고 나서 되돌린다`, r.ok, r.why);
  }
}

console.log("\n② 🔴 remove 는 **기기를 지우기 전에** 물어야 한다(지우면 누가 물고 있었는지도 사라진다)");
{
  const b = branch(src, "remove");
  const ask = b ? b.search(/reconcileClaimed\s*\(/) : -1;
  const del = b ? b.search(/DELETE FROM runner_devices/) : -1;
  ok("remove — 화해기가 DELETE 보다 앞", ask >= 0 && del >= 0 && ask < del, `ask=${ask} delete=${del}`);
  ok("remove — 되돌린 잡 id 를 RETURNING 으로 잡는다(종전엔 수조차 안 남았다)",
    !!b && /UPDATE runner_jobs SET status = 'queued'[\s\S]{0,300}RETURNING id/.test(b));
}

console.log("\n③ 운영자 문이니 **운영자에게 보인다**");
{
  for (const a of ["release", "remove"]) {
    const b = branch(src, a) ?? "";
    ok(`action="${a}" — 응답에 recovered 를 돌려준다`, /return json\(\{[^}]*recovered/.test(b.replace(/\n/g, " ")), b.slice(-260));
    ok(`action="${a}" — 감사 detail 에도 실린다(새 감사 액션을 파지 않았다)`, /writeAudit\([\s\S]{0,400}recovered/.test(b));
  }
}

console.log("\n④ 🔴 자기 변이 — 위 못을 빼면 이 자가 우는가");
{
  const MUT = [
    { name: "M1 화해기 호출을 뺀다", f: (t) => t.replace(/const recovered = await reconcileClaimed\(\);/g, "const recovered = [];") },
    { name: "🔴 M2 되돌린 **뒤에** 묻는다(순서만 바꾼다 — 제일 그럴듯한 실수)",
      f: (t) => { const b = branch(t, "release"); if (!b) return t;
        const moved = b.replace("const recovered = await reconcileClaimed();\n        const released", "const released")
          .replace("await writeAudit(", "const recovered = await reconcileClaimed();\n        await writeAudit(");
        return t.replace(b, moved); } },
    { name: "M3 remove 가 DELETE 뒤에 묻는다",
      f: (t) => { const b = branch(t, "remove"); if (!b) return t;
        const moved = b.replace("const recovered = await reconcileClaimed();", "")
          .replace("await q(sql`DELETE FROM runner_devices", "const recovered = await reconcileClaimed();\n        await q(sql`DELETE FROM runner_devices");
        return t.replace(b, moved); } },
    { name: "M4 운영자에게 안 보여 준다(응답·감사에서 뺀다)",
      f: (t) => t.replace(/, recovered \}/g, " }").replace(/recovered \}\);/g, "});") },
  ];
  for (const m of MUT) {
    const mutated = m.f(src);
    if (mutated === src) { fail++; console.log(`  ✗ ${m.name} — 🔴 변이가 **아무것도 안 바꿨다**(자리를 못 찾았다)`); continue; }
    const r1 = asksBeforeRequeue(branch(mutated, "release"));
    const r2 = asksBeforeRequeue(branch(mutated, "remove"));
    const bR = branch(mutated, "remove") ?? "";
    const askD = bR.search(/reconcileClaimed\s*\(/), delD = bR.search(/DELETE FROM runner_devices/);
    const shown = ["release", "remove"].every((a) => {
      const b = (branch(mutated, a) ?? "").replace(/\n/g, " ");
      return /return json\(\{[^}]*recovered/.test(b) && /writeAudit\([\s\S]{0,400}recovered/.test(branch(mutated, a) ?? "");
    });
    const caught = !r1.ok || !r2.ok || !(askD >= 0 && delD >= 0 && askD < delD) || !shown;
    ok(`${m.name} — 잡힘`, caught, "🔴 이 변이를 못 잡는다 = 그 못은 지금 아무도 안 지키고 있다");
  }
}

console.log(`\n${fail > 0 ? "🔴" : unmeasured > 0 ? "⊘" : "🟢"} pass ${pass} · fail ${fail} · 못 쟀음 ${unmeasured}`);
if (unmeasured > 0 && fail === 0) console.log("🔴 자가 갈래를 못 잡았다 — 그건 «맞다»가 아니다(종료 2).");
console.log("⊘ 이 자가 **원리적으로 못 재는 것**: 실제로 안 올라가는지는 라이브 발행이 답한다 — 여기는 «순서가 맞나»까지다.");
process.exit(fail > 0 ? 1 : unmeasured > 0 ? 2 : 0);
