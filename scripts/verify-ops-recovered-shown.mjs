/**
 * scripts/verify-ops-recovered-shown.mjs — 🔴 **운영자 문에서 «맞춘 결과»가 운영자에게 보이나**
 *   (AC-214 · B2 · 2026-09-22 · `verify-ops-requeue-doors.mjs` 를 **줄여서** 이 이름으로 옮겼다)
 *   사용: `node scripts/verify-ops-recovered-shown.mjs` · 네트워크 0 · DB 0 · 소스만 읽는다
 *
 *   ══ 🔴 왜 줄였나 — **재 보니 대부분 C 와 겹쳤다** ══
 *     어제 이 자를 낼 때는 C 의 `verify-requeue-guarded.mjs` 가 화살표 함수 경계를 몰라서
 *     `ops-runners.ts` 의 두 문이 **`import` 한 줄만으로 초록**이었다(내가 변이로 확인했다).
 *     그 사각을 메우려고 네 축을 쟀다: ①순서 ②`remove` 는 `DELETE` 앞 ③운영자에게 보이나 ④호출이 있나.
 *     🔴 **C 가 자기 자를 고쳤다.** 그래서 「겹치나」를 **말로 받지 않고 변이로 쟀다**
 *        (`_tmp/overlap-c-vs-b2.mjs` · 축마다 따로 깨서 둘을 나란히 돌렸다):
 *
 *     | 축 | C | B2 | |
 *     |---|---|---|---|
 *     | ①되돌린 **뒤에** 묻는다(호출은 그대로) | 빨강 | 빨강 | 겹침 |
 *     | ②`remove` 가 `DELETE` **뒤에** 묻는다   | 빨강 | 빨강 | 겹침 |
 *     | ③**운영자에게 안 보여 준다**            | **초록** | 빨강 | 🔴 **B2 만 잡는다** |
 *     | ④호출 자체를 뺀다(대조군)               | 빨강 | 빨강 | 겹침 |
 *
 *     C 는 **일부러** 순서를 잰다(「그 문보다 앞서는 부분만 본다 · 함수 경계에서 멈춘다 ·
 *     `return` 으로 끝나는 옆 갈래의 가드는 안 센다」) — **우연이 아니라 설계다.**
 *     ⇒ ①②④ 를 여기 남겨 두면 **같은 사실을 두 벌**로 두는 것이고, 갈라지면 아무도 못 잡는다.
 *        **지웠다.** 문을 세는 정본은 `scripts/verify-requeue-guarded.mjs`(C) 하나다.
 *
 *   ══ 남긴 축 하나 — 이건 C 의 일이 아니다 ══
 *     C 는 「문이 막혔나」를 센다. 이 자는 「**막고 나서 사람에게 말했나**」를 본다 — CLAUDE §9 의 몫이다.
 *     운영자가 「되돌리기」를 눌렀는데 우리가 **말없이** 「이미 올라간 잡이라 안 되돌렸다」고 처리하면,
 *     🔴 운영자는 **자기가 누른 것이 먹혔다고 믿는다.** 막지 않는 대신 말해 주기로 했으면(§9)
 *        **그 말이 실제로 그 화면에 닿아야** 한다. 응답과 감사 `detail` 둘 다 본다(둘 중 하나만이면 한쪽 눈이 먼다).
 *
 *   🔴 판정은 셋이다: `✓` · `✗`(제품이 틀렸다) · **`⊘`(자가 못 쟀다 · 종료 2)** — `scripts/lib/block.mjs` 규율.
 */
import { readFileSync } from "node:fs";
import { blockOf, stripComments, tally } from "./lib/block.mjs";

const FILE = "netlify/functions/ops-runners.ts";
/* 🔴 **주석을 걷고 본다** — 「찾긴 찾았는데 **주석에서** 찾았다」가 넷째 꼴이다(2026-09-22 · B2·B 둘 다 겪었다).
   `codeOnlyKeepIndex` 는 주석을 **공백으로** 바꿔 자리를 보존하므로 아래 순서 판정이 살아 있다. */
const src = stripComments(readFileSync(FILE, "utf8"));
const t = tally();

/** `action === "x"` 갈래의 몸통. 🔴 끝 표식을 못 찾으면 **`null`**(⊘) — 파일 끝까지 넓히지 않는다. */
const branch = (action) => blockOf(src, `action === "${action}"`, [
  'if (action === "', 'return badRequest("action 은', 'return json({ ok: false, error: "not_found"',
])?.body ?? null;

/**
 * 🔴 **감사 호출 «그 자체»만 본다** — 창을 열어 두지 않는다.
 *   처음엔 `writeAudit\([\s\S]{0,400}recovered` 로 썼다. **바로 그 400자 고정 창이 이 판의 병(②꼴)이다** —
 *   `writeAudit(...)` 바로 뒤에 `return json({ …, recovered })` 가 있어서, 감사에서 `recovered` 를 빼도
 *   **응답 쪽 낱말을 주워 와** 초록이 났다(2026-09-22 · 내 변이 M2 가 잡았다).
 *   🔴 **병을 고치려고 쓴 자에 그 병을 또 썼다.** 옛 코드에서 정규식을 옮겨 오면서 창을 같이 옮겨 온 것이다.
 *   ⇒ `blockOf` 로 **호출 괄호 안**만 잘라 본다. 못 자르면 `null`(⊘).
 */
const auditHas = (body) => {
  const call = blockOf(body, "writeAudit(", ["});"])?.body ?? null;
  return call == null ? false : call.includes("recovered");
};

console.log("① 🔴 운영자가 누른 문에서 «안 되돌리고 맞췄다»가 **그 응답에** 실리나");
for (const a of ["release", "remove"]) {
  const b = branch(a);
  if (b == null) { t.unmeasured(`action="${a}" — 응답에 recovered`, "갈래를 못 잡았다(닻이나 끝 표식이 바뀌었나)"); continue; }
  t.ok(`action="${a}" — 응답에 recovered 를 돌려준다`, /return json\(\{[^}]*recovered/.test(b.replace(/\n/g, " ")),
    "🔴 안 실으면 운영자는 자기가 누른 것이 그대로 먹혔다고 믿는다");
}

console.log("\n② 🔴 감사에도 남나 — 화면을 안 본 사람이 나중에 되짚을 재료");
for (const a of ["release", "remove"]) {
  const b = branch(a);
  if (b == null) { t.unmeasured(`action="${a}" — 감사 detail 에 recovered`, "갈래를 못 잡았다"); continue; }
  t.ok(`action="${a}" — 감사 detail 에 실린다(새 감사 액션을 파지 않았다)`, auditHas(b),
    "🔴 새 액션을 파면 운영 화면이 갈린다 — 기존 high 감사의 detail 에 얹는다(B 제안)");
}

console.log("\n③ 🔴 변이 — 위 못을 빼면 이 자가 우는가(안 울면 이 자도 있으나 마나다)");
{
  const MUT = [
    { name: "M1 응답에서 recovered 를 뺀다", f: (x) => x.replace(/, recovered \}\);/g, " });") },
    { name: "M2 감사 detail 에서 recovered 를 뺀다", f: (x) => x.replace(/, recovered \}, riskLevel/g, " }, riskLevel") },
    { name: "🔴 M3 **둘 다** 뺀다(조용히 처리한다 — §9 가 막으려는 바로 그것)",
      f: (x) => x.replace(/, recovered \}\);/g, " });").replace(/, recovered \}, riskLevel/g, " }, riskLevel") },
  ];
  const shown = (text, a) => {
    const b = blockOf(text, `action === "${a}"`, ['if (action === "', 'return badRequest("action 은', 'return json({ ok: false, error: "not_found"'])?.body ?? null;
    if (b == null) return null;
    /* 🔴 여기도 `auditHas` 를 쓴다 — 위와 **같은 눈**이어야 한다.
       종전엔 이 줄만 400자 고정 창이었고, 그래서 M2 가 «못 잡힘»으로 나왔다(자가 자기 결함을 잡은 것이다). */
    return /return json\(\{[^}]*recovered/.test(b.replace(/\n/g, " ")) && auditHas(b);
  };
  for (const m of MUT) {
    const mutated = m.f(src);
    if (mutated === src) { t.unmeasured(`${m.name} — 잡힘`, "변이가 아무것도 안 바꿨다(자리를 못 찾았다)"); continue; }
    const caught = ["release", "remove"].some((a) => shown(mutated, a) === false);
    t.ok(`${m.name} — 잡힘`, caught, "🔴 이 변이를 못 잡는다 = 그 못은 지금 아무도 안 지키고 있다");
  }
}

console.log("\n④ 🔴 덩이 잡기 자체 — **못 잡게 만들면** ⊘ 가 나오는가(자가 «멈추는» 쪽 · 칸을 나눠 둔다)");
{
  const SAMPLE = 'if (action === "aa") { return json({ ok: true, recovered }); }\nif (action === "bb") { return 1; }';
  t.ok("정상 — 갈래 하나만 잡는다", (blockOf(SAMPLE, 'action === "aa"', ['if (action === "'])?.body ?? "").includes("recovered"));
  t.ok("🔴 닻을 지우면 null(«못 쟀음»이지 «가드 없음»이 아니다)", blockOf(SAMPLE, 'action === "zz"', ['if (action === "']) === null);
  t.ok("🔴 끝 표식을 지우면 null — 파일 끝까지 넓히지 않는다", blockOf(SAMPLE, 'action === "aa"', ["NOTHING_LIKE_THIS"]) === null);
  t.ok("🔴 주석에 적힌 이름은 안 센다(넷째 꼴)",
    !(blockOf(stripComments('if (action === "aa") { /* recovered 를 싣는다 */ return 1; }\nif (action === "bb") {'), 'action === "aa"', ['if (action === "'])?.body ?? "").includes("recovered"));
}

console.log("\n⊘ 이 자가 **원리적으로 못 재는 것**: 운영자가 그 숫자를 **읽었나**는 화면·사람이 답한다 — 여기는 «실려 보내나»까지다.");
console.log("📌 문이 막혔나(7개)를 세는 정본은 `scripts/verify-requeue-guarded.mjs`(C) 다 — 여기서 또 세지 않는다.");
process.exit(t.done("운영자에게 보이나"));
