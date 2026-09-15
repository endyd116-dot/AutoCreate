/**
 * scripts/verify-recipe.mts — 셀렉터 표(recipe)의 **판정**을 실제로 돌려 본다(P1R8 §3.3 · 네트워크 0 · DB 0).
 *   사용: npx --yes tsx scripts/verify-recipe.mts
 *
 *   🔴 왜 하니스가 필요한가 — 이 판정이 조용히 틀리면 **어느 쪽으로든 나쁘다**:
 *     · 못 믿을 표를 쓴다      → 남의 브라우저에서 엉뚱한 버튼을 누른다(제일 나쁜 실패)
 *     · 멀쩡한 표를 전부 버린다 → 전 러너가 폴백으로 내려앉는데 화면엔 «표를 배포했다»로 보인다
 *   둘 다 라이브로는 «그냥 잘 안 되네»로만 보여서 여기서만 잡힌다(AC-68 — 막을 것과 통과시킬 것을 같은 수만큼).
 *
 *   🔴 그리고 **서버와 러너가 같은 규칙인지**를 실제로 맞춰 본다 — 정규화가 한 글자만 갈려도
 *      «서명이 다 틀렸다»가 되고, 그건 코드를 읽어서는 절대 안 보인다.
 */
import crypto from "node:crypto";
import { canonicalRecipe, canPromoteAt, minDwellHours, nextStage, runnerMeetsMin, isRecipeVersion, verNum, type RecipeBody } from "../lib/recipe";
import { audienceGetsCandidate } from "../lib/recipe-store";
import { canonicalRecipe as runnerCanonical, decideRecipe } from "../runner/lib/recipe.mjs";

let pass = 0; let fail = 0;
const t = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got); const w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      받은 값: ${g}\n      기대값: ${w}`); }
};
const ok = (name: string, cond: boolean) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };

/* 시험용 열쇠 한 쌍(이 프로세스 안에서만 산다 — 라이브 열쇠를 쓰지 않는다). */
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "pem" }).toString();
const other = crypto.generateKeyPairSync("ed25519");
const OTHER_PUB = other.publicKey.export({ type: "spki", format: "pem" }).toString();

const body: RecipeBody = {
  version: "tistory@2026-09-16.1", channel: "tistory", minRunner: "1.1.9",
  selectors: { title: "#t", publish: "#p" }, waits: { editor: 3000 },
  assertions: { titleMaxLen: 120 }, rollbackTo: "tistory@2026-09-15.2",
};
const sign = (b: RecipeBody, key = privateKey) =>
  ({ ...b, sig: crypto.sign(null, Buffer.from(canonicalRecipe(b), "utf8"), key).toString("base64url") });
const signed = sign(body);

/* 🔴 **라이브 postgres 로 실측했다**(2026-09-15 · `SELECT $1::jsonb` 읽기 전용 프로브):
     보낸 키 순서 `version,channel,minRunner,selectors,waits,assertions,rollbackTo,sig`
     → 돌아온 순서 `sig,waits,channel,version,minRunner,selectors,assertions,rollbackTo`
     중첩까지 뒤섞인다 — `selectors` 의 `title,publish,zzz,aaa` → `aaa,zzz,title,publish`.
   즉 **정규화가 없으면 표를 저장했다 꺼내는 순간 모든 서명이 깨진다** — 그리고 그건
   «표가 안 먹네»로만 보이고 전 러너가 조용히 폴백된다. 아래 ①이 그 자리를 지킨다. */
console.log("① 🔴 서버와 러너의 정규화가 **글자 하나까지** 같은가(여기가 갈리면 전 러너가 폴백된다)");
t("서버 정규화 = 러너 정규화", runnerCanonical(signed), canonicalRecipe(body));
/* 키 순서를 뒤집어도 같은 글자가 나와야 한다 — DB(jsonb) 왕복이 실제로 키를 재배열한다. */
const shuffled = { rollbackTo: body.rollbackTo, selectors: { publish: "#p", title: "#t" }, assertions: body.assertions,
  waits: body.waits, minRunner: body.minRunner, channel: body.channel, version: body.version } as RecipeBody;
t("키 순서를 뒤집어도 같은 글자", canonicalRecipe(shuffled), canonicalRecipe(body));
ok("`sig` 는 정규화에서 빠진다", !canonicalRecipe(signed as RecipeBody).includes("sig"));

console.log("② 🔴 통과해야 하는 것");
t("바른 표 · 러너 판이 충분", decideRecipe({ recipe: signed, runnerVersion: "1.1.9", publicPem: PUB }).use, true);
t("러너 판이 더 높아도 통과", decideRecipe({ recipe: signed, runnerVersion: "2.0.0", publicPem: PUB }).use, true);
t("키 순서가 뒤집혀 와도 통과(jsonb 왕복)", decideRecipe({ recipe: { ...shuffled, sig: signed.sig }, runnerVersion: "1.1.9", publicPem: PUB }).use, true);

console.log("③ 🔴 떨어져야 하는 것 — 같은 수만큼");
t("서명이 없다", decideRecipe({ recipe: { ...body }, runnerVersion: "1.1.9", publicPem: PUB }).use, false);
t("남의 열쇠로 서명됐다(위조)", decideRecipe({ recipe: sign(body, other.privateKey), runnerVersion: "1.1.9", publicPem: PUB }).use, false);
t("우리 공개키가 아니다", decideRecipe({ recipe: signed, runnerVersion: "1.1.9", publicPem: OTHER_PUB }).use, false);
t("내용이 한 글자 바뀌었다", decideRecipe({ recipe: { ...signed, selectors: { title: "#TAMPERED", publish: "#p" } }, runnerVersion: "1.1.9", publicPem: PUB }).use, false);
t("러너 판이 낮다", decideRecipe({ recipe: signed, runnerVersion: "1.1.8", publicPem: PUB }).use, false);
t("표가 비었다(받았다고 쓰면 아무 데도 못 누른다)", decideRecipe({ recipe: sign({ ...body, selectors: {} }), runnerVersion: "1.1.9", publicPem: PUB }).use, false);
t("공개키가 아직 없다(기능이 안 켜진 정상 상태)", decideRecipe({ recipe: signed, runnerVersion: "1.1.9", publicPem: "" }).use, false);
t("표가 아예 안 왔다", decideRecipe({ recipe: null, runnerVersion: "1.1.9", publicPem: PUB }).use, false);

console.log("④ 청중 — 🔴 **좁은 쪽이 먼저**(퍼센트가 아니라 순서)");
t("canary 단계: 우리 드라이런만", [
  audienceGetsCandidate("canary", { canary: true }), audienceGetsCandidate("canary", { managed: true }),
  audienceGetsCandidate("canary", { volunteer: true }), audienceGetsCandidate("canary", {}),
], [true, false, false, false]);
t("own 단계: 우리 기기까지", [
  audienceGetsCandidate("own", { managed: true }), audienceGetsCandidate("own", { volunteer: true }), audienceGetsCandidate("own", {}),
], [true, false, false]);
t("volunteer 단계: 켠 고객까지", [
  audienceGetsCandidate("volunteer", { volunteer: true }), audienceGetsCandidate("volunteer", {}),
], [true, false]);
t("all 단계: 전부", audienceGetsCandidate("all", {}), true);
/* 🔴 이 한 줄이 설계의 약속이다 — 옵트인 안 한 고객은 **어느 단계에서도** 먼저 맞지 않는다. */
ok("옵트인 안 한 고객은 all 전까지 후보를 절대 안 받는다",
  (["canary", "own", "volunteer"] as const).every((s) => !audienceGetsCandidate(s, {})));

console.log("⑤ 시간 게이트 — 넓히는 건 사람이 볼 때만, 좁히는 건 언제나");
const at = (iso: string) => canPromoteAt(new Date(iso)).ok;
t("평일 KST 14시 → 넓힐 수 있다", at("2026-09-16T05:00:00Z"), true);          // 수 14:00 KST
t("평일 KST 09시 → 안 된다", at("2026-09-16T00:00:00Z"), false);              // 수 09:00 KST
t("평일 KST 22시 → 안 된다", at("2026-09-16T13:00:00Z"), false);              // 수 22:00 KST
t("토요일 KST 14시 → 안 된다", at("2026-09-19T05:00:00Z"), false);            // 토 14:00 KST
t("일요일 KST 14시 → 안 된다", at("2026-09-20T05:00:00Z"), false);

console.log("⑥ 단계·체류");
t("다음 단계 사슬", ["canary", "own", "volunteer", "all"].map((s) => nextStage(s as never)), ["own", "volunteer", "all", null]);
t("🔴 자원자 0명이면 앞 단계를 두 배로(건너뛰지 않는다)", [minDwellHours("own", 1), minDwellHours("own", 0)], [24, 48]);
t("판 비교", [verNum("1.1.9"), verNum("1.2.0"), verNum("x")], [1001009, 1002000, -1]);
t("🔴 러너 판을 모르면 안 준다", runnerMeetsMin("", "1.0.0"), false);
t("minRunner 를 안 적었으면 제한 없음", runnerMeetsMin("1.0.0", ""), true);
t("이름 모양", ["tistory@2026-09-16.1", "tistory", "tistory@2026-9-16.1"].map(isRecipeVersion), [true, false, false]);

console.log(`\n${fail ? "🔴" : "✅"} ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
