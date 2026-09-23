/**
 * scripts/verify-ai-models-sync.mts — 🔴 **«정본 동기화»가 진짜 파일을 제대로 고치는가**(AC-256).
 *   `applyToSource` 는 **소스 코드를 글자로 고쳐서 PR 로 내보낸다.** 틀리면 남의 저장소에 깨진 파일이 올라간다.
 *   ⇒ 진짜 `lib/ai-models.ts` 를 읽어 **열한 역할을 전부 구워 보고** 견준다. DB·네트워크·키 **0**(순수 계산이라 언제든 돈다).
 *
 *   ══ 이 자가 무엇을 재고 무엇을 못 재나(AC-178 — 이름을 붙여 둔다) ══
 *     재는 것: 「닻 자리의 문자열이 새 값으로 정확히 바뀌었나 · 딴 자리는 그대로인가 · 못 찾으면 말하는가」
 *     뜻하는 것: 「PR 이 올라가도 파일이 안 깨지나」
 *     🔴 **갈리는 자리**: 이 자는 **바뀐 파일을 파싱하지 않는다.** 따옴표 안만 갈아 끼우므로 문법이 깨질 길이 좁지만
 *        «좁다»는 «없다»가 아니다. 모델 이름에 `"` 가 들어오면 `JSON.stringify` 가 이스케이프하는 것까지가 이 자의 범위다.
 *
 *   ══ 만들면서 잡은 것 둘(이 자가 없었으면 둘 다 조용했다) ══
 *     ① 🔴 `declOf("MODEL_VEO")` 가 `MODEL_VEO_FAST`·`MODEL_VEO_LITE` 를 **같은 이름**으로 읽어 `videoVeo` 를 통째로 놓쳤다.
 *     ② 🔴 그 탓에 ⑦ 변이 시험이 **거짓 통과**했다 — 대조군이 이미 빨강이면 변이가 아무것도 안 바꾼다(AC-161).
 *        ⇒ 변이 시험을 믿으려면 **대조군이 초록인지 먼저** 봐야 한다. 지금은 초록이다(①이 11/11).
 */
import "./_lib/load-env.mjs";   // 🔴 첫 줄이어야 한다 — 아래 import 가 본문보다 먼저 평가된다(B2 · `verify-load-env-first`)
import fs from "node:fs";
import { applyToSource, declOf, type DriftReport, type DriftRow } from "../lib/ai-models-sync";
import { AI_ROLE_SPECS } from "../lib/ai-models";

const SRC = fs.readFileSync("lib/ai-models.ts", "utf8");
let bad = 0;
const ok = (n: string, c: boolean, got?: unknown) => { if (!c) bad++; console.log(`${c ? "  ✅" : "  ❌"} ${n}${got === undefined ? "" : " — " + JSON.stringify(got)}`); };

/* 가짜 오버레이: 역할마다 사슬 길이를 코드값과 같게 두고 이름만 바꾼다(길이가 다르면 «반만 굽기»를 시험 못 한다). */
const rows: DriftRow[] = AI_ROLE_SPECS.map((s) => ({
  role: s.role, label: s.label, code: [...s.codeChain],
  db: s.codeChain.map((_, i) => `ZZZ-${s.role}-${i}`),
  candidate: null, canaryPct: 100, same: false,
  envSet: false, envName: "", envNames: [], bakeable: true, probeNone: s.probe === "none",
}));
const drift: DriftReport = { drifted: true, rows, canaryRoles: [], envMasked: [], unbakeable: [], roleCount: rows.length };

const r = applyToSource(SRC, drift);
console.log(`모수: 역할 ${rows.length} · 바꿨다 ${r.changed.length} · 못 찾았다 ${r.missed.length}`);
ok("① 열한 역할 전부 구웠다", r.changed.length === rows.length, { changed: r.changed, missed: r.missed });
ok("② 표의 env 이름이 소스와 어긋난 곳 0", r.envTableDrift.length === 0, r.envTableDrift);

/* 🔴 ③④ 는 «그 역할의 닻 자리»만 본다.
   처음엔 «파일 어디에도 옛 이름이 없나»로 쟀는데 **그게 틀린 자다** — `MODEL_DEFAULT` 처럼 역할이 아닌 상수와
   주석이 같은 모델 이름을 그대로 들고 있고, 그건 **남아 있는 게 맞다.** 과녁이 넓으면 옳은 것도 빨강이 된다. */
const ANCH: Record<string, { consts: string[]; shape: "chain" | "single" }> = {
  high: { consts: ["CHAIN_HIGH"], shape: "chain" }, low: { consts: ["CHAIN_LOW"], shape: "chain" },
  director: { consts: ["CHAIN_DIRECTOR"], shape: "chain" }, landing: { consts: ["CHAIN_LANDING_GEN"], shape: "chain" },
  image: { consts: ["CHAIN_IMAGE"], shape: "chain" }, tts: { consts: ["MODEL_TTS"], shape: "single" },
  vision: { consts: ["MODEL_VISION"], shape: "single" }, videoRead: { consts: ["MODEL_VIDEO_READ"], shape: "single" },
  videoOmni: { consts: ["MODEL_OMNI"], shape: "single" },
  videoVeo: { consts: ["MODEL_VEO", "MODEL_VEO_FAST", "MODEL_VEO_LITE"], shape: "single" },
  videoFal: { consts: ["FAL_MODEL_WAN", "FAL_MODEL_HAILUO", "FAL_MODEL_KLING"], shape: "single" },
};
const slotValue = (text: string, c: string, shape: "chain" | "single"): string | null => {
  const d = declOf(text, c); if (!d) return null;
  const lits = [...d.text.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  return lits.length ? (shape === "chain" ? lits[0] : lits[lits.length - 1]) : null;
};
const miss: string[] = [], stillOld: string[] = [];
for (const row of rows) {
  const a = ANCH[row.role];
  if (a.shape === "chain") {
    const got = slotValue(r.text, a.consts[0], "chain");
    if (got !== row.db!.join(",")) miss.push(`${row.role}=${got}`);
    if (got === row.code.join(",")) stillOld.push(row.role);
  } else {
    a.consts.forEach((c, i) => {
      const got = slotValue(r.text, c, "single");
      if (got !== row.db![i]) miss.push(`${c}=${got}`);
      if (got === row.code[i]) stillOld.push(c);
    });
  }
}
ok("③ 닻 자리마다 새 값이 정확히 들어갔다", miss.length === 0, miss.slice(0, 6));
ok("④ 닻 자리에 옛 값이 안 남았다", stillOld.length === 0, stillOld.slice(0, 6));
ok("④ ⚠️ 역할이 아닌 상수(MODEL_DEFAULT)는 **안 건드렸다**", slotValue(r.text, "MODEL_DEFAULT", "single") === slotValue(SRC, "MODEL_DEFAULT", "single"));

/* ⑤ 🔴 대조군 — 파일이 통째로 새로 쓰이지 않았나(주석의 «이유»가 살아 있어야 한다) */
const keepers = ["lite 를 헤드에 두는", "12곳이 각자", "AI_ROLE_SPECS"];
const lost = keepers.filter((k) => SRC.includes(k) && !r.text.includes(k));
ok("⑤ 주석·이유가 그대로 있다(파일을 다시 쓰지 않았다)", lost.length === 0, lost);
ok("⑤ 길이 변화가 값 길이 차이뿐(줄 수 동일)", SRC.split("\n").length === r.text.split("\n").length, [SRC.split("\n").length, r.text.split("\n").length]);

/* ⑥ 🔴 declOf 자기시험 — 없는 이름·두 번 나오는 이름은 null 이어야 한다 */
ok("⑥ 없는 상수 → null", declOf(SRC, "NOPE_NOT_HERE") === null);
ok("⑥ 두 번 나오는 상수 → null", declOf(SRC + "\nexport const CHAIN_HIGH = 1;", "CHAIN_HIGH") === null);
ok("⑥ 두 줄짜리 chain() 선언을 통째로 잡는다", (declOf(SRC, "CHAIN_HIGH")?.text.includes("chain(")) === true && (declOf(SRC, "CHAIN_HIGH")?.text.split("\n").length ?? 0) >= 2);

/* ⑦ 🔴 변이 — 닻 하나를 망가뜨리면 우는가(안 울면 이 탐침이 대용물이다) */
const mutated = SRC.replace("export const MODEL_VEO_FAST", "export const MODEL_VEO_FASTX");
const m = applyToSource(mutated, drift);
ok("⑦ 상수 이름이 어긋나면 그 역할을 missed 로 낸다", m.missed.includes("videoVeo") && !m.changed.includes("videoVeo"), { missed: m.missed });
ok("⑦ 🔴 그리고 **반만 굽지 않는다** — 형제 둘도 안 바뀐다", !m.text.includes('"ZZZ-videoVeo-0"'), m.text.includes('"ZZZ-videoVeo-0"'));

/* ⑧ 카나리 중인 역할은 굽지 않는다 */
const canary = { ...drift, rows: rows.map((x) => (x.role === "high" ? { ...x, candidate: ["c"], canaryPct: 10 } : x)) };
ok("⑧ 카나리 중(<100%)이면 안 굽는다", !applyToSource(SRC, canary).changed.includes("high"));

console.log(bad === 0 ? "\n전부 통과" : `\n🔴 ${bad}개 실패`);
process.exit(bad === 0 ? 0 : 1);
