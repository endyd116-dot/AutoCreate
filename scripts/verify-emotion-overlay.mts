/**
 * scripts/verify-emotion-overlay.mts — 🔴 **집필 계약 오버레이가 «먹은 것»과 «안 먹은 것»을 정직하게 말하는가**(AC-258).
 *   `applyOverlay` 는 **생성 경로(`contractFor`)와 운영 화면(`ops-emotion`)이 같이 쓰는 한 벌**이다.
 *   여기가 틀리면 «화면은 바꿨다는데 글은 그대로»가 되고, 그건 재현이 제일 어려운 종류다(PITFALLS #11-b).
 *
 *   ══ 이 자가 지키는 것 ══
 *     ① 모양이 다른 값은 **덮지 않는다**(스모크 실사고: `length` 배열이 객체를 덮어 **NaN 코인**이 나갔다)
 *     ② 🔴 그리고 **덮지 않았다고 말한다** — 종전 merge 는 `continue` 로 **소리 없이** 넘어갔다(조용한 0건).
 *     ③ 옛 시드 모양(`length:[min,max]` · `tone`)을 계속 받는다 — 받던 것을 깨면 라이브 행 넷이 조용히 죽는다
 *
 *   ══ ⚠️ 이 자가 **못 재는 것**(AC-178 — 이름을 붙여 둔다) ══
 *     «운영자가 화면에서 저장했을 때 실제로 글이 바뀌는가»는 **안 잰다**. 60초 캐시와 생성 한 판이 사이에 있다.
 *     여기서 재는 것은 **판정기 한 벌이 두 곳에서 같은 답을 내는가**까지다.
 */
import "./_lib/load-env.mjs";
const { WRITING_CONTRACTS, applyOverlay, contractFor, OVERLAY_KEYS } = await import("../lib/writing-contracts");
const { q } = await import("../lib/accounts");
const { sql } = await import("drizzle-orm");
let bad = 0;
const ok = (n: string, c: boolean, got?: unknown) => { if (!c) bad++; console.log(`${c ? "  ✅" : "  ❌"} ${n}${got === undefined ? "" : " — " + JSON.stringify(got)}`); };

const keys = Object.values(WRITING_CONTRACTS).map((c) => `${c.channel}.${c.emotionKey}`);
console.log("코드 계약:", keys.length, "개 ·", keys.join(" · "));
const live = await q(sql`SELECT key, jsonb_typeof(contract) AS t FROM emotion_profiles ORDER BY key`);
console.log("라이브 emotion_profiles 행:", live.length, live.map((r) => `${r.key}(${r.t})`).join(" · "));
/* 🔴 **유령 행** — 코드 표에 없는 열쇠는 `contractFor` 가 영영 안 읽는다. 채널 이름·감성 키를 바꾸면 조용히 생긴다.
   ⚠️ 빨강으로 안 낸다(**있어도 아무것도 안 깨진다**) — 다만 **수를 적어** 운영 화면(`ops-emotion.orphans`)이 그 이름을 대게 한다. */
const orphans = live.map((r) => String(r.key)).filter((k) => !keys.includes(k));
console.log(orphans.length ? `⚠️ 아무도 안 읽는 행 ${orphans.length}개: ${orphans.join(" · ")}` : "유령 행 0");
/* jsonb 가 아닌 행은 **빨강이다** — `contractFor` 가 조용히 코드 기본값으로 돌아 «바꿨는데 그대로»가 된다(PITFALLS #1). */
const notObj = live.filter((r) => r.t !== "object").map((r) => String(r.key));
if (notObj.length) { bad++; console.log(`  ❌ jsonb_typeof 가 object 가 아닌 행: ${notObj.join(" · ")}`); }

const base = WRITING_CONTRACTS.naver_blog;
/* ① 정상 오버레이가 먹나 */
let r = applyOverlay(base, { register: "바뀐 말투" });
ok("① 문자열 칸이 먹는다", r.merged.register === "바뀐 말투" && r.applied.includes("register"), { applied: r.applied });
/* ② 🔴 모양이 다르면 «무시»를 말하나 — 종전엔 소리 없이 넘어갔다 */
r = applyOverlay(base, { length: "1200" });
ok("② 모양이 다르면 ignored 에 뜬다", r.ignored.some((x) => x.key === "length" && x.expected === "object" && x.got === "string"), r.ignored);
ok("② 그리고 값은 안 바뀐다", r.merged.length.min === base.length.min);
/* ③ 계약에 없는 칸도 말하나 */
r = applyOverlay(base, { regsiter: "오타" });
ok("③ 없는 칸을 이름 대고 말한다", r.ignored.some((x) => x.key === "regsiter"), r.ignored);
/* ④ 짧은 모양(시드) 호환 — length [min,max] */
r = applyOverlay(base, { length: [900, 1100] });
ok("④ [min,max] 짧은 모양이 먹는다", r.merged.length.min === 900 && r.merged.length.max === 1100, r.merged.length);
/* ⑤ tone → register 승계 */
r = applyOverlay(base, { tone: "옛 시드 말투" });
ok("⑤ tone 이 register 로 간다", r.merged.register === "옛 시드 말투");
ok("⑤ 그리고 tone 자체는 «없는 칸»으로 안 운다", !r.ignored.some((x) => x.key === "tone"), r.ignored);
/* ⑥ 객체는 «필드 단위»로 덮는다(통째 교체 아님) */
r = applyOverlay(base, { images: { default: 9 } });
ok("⑥ 객체는 필드 단위로 덮는다", r.merged.images.default === 9 && r.merged.images.max === base.images.max, r.merged.images);
/* ⑦ 🔴 생성 경로와 같은 함수인가 — contractFor 가 오버레이 없는 채널에서 코드 기본값을 그대로 낸다 */
const fromGen = await contractFor("naver_blog");
ok("⑦ contractFor 가 돈다(같은 판정기)", fromGen.channel === "naver_blog" && !!fromGen.register, { emotionKey: fromGen.emotionKey });
ok("⑧ OVERLAY_KEYS 가 밖으로 나온다(화면이 목록을 지어내지 않는다)", OVERLAY_KEYS.length === 14, OVERLAY_KEYS.length);
console.log(bad === 0 ? "\n전부 통과" : `\n🔴 ${bad}개 실패`);
process.exit(bad === 0 ? 0 : 1);
