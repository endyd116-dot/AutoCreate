// scripts/gen-recipe-key.mjs — 셀렉터 표(recipe) 서명 열쇠 한 쌍을 만든다(P1R8 §3.3).
//   사용: node scripts/gen-recipe-key.mjs
//
//   🔴 **Ed25519** 다. HMAC 이 아닌 이유: HMAC 이면 검증하려고 **러너가 비밀을 들고 있어야** 하고,
//      고객 PC 에 있는 비밀은 비밀이 아니다(AC-65 «뒷문이 먼저다»).
//      공개키만 zip 에 넣으면, 새어 나가도 표를 **만들** 수는 없다.
//
//   🔴 이 스크립트는 **찍기만 한다** — 파일에 쓰지도, env 에 넣지도 않는다.
//      비밀을 어디에 둘지는 사람이 정하는 일이고, 스크립트가 대신 정하면 언젠가 리포에 들어간다.
import crypto from "node:crypto";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim();
const pub = publicKey.export({ type: "spki", format: "pem" }).toString().trim();

console.log("\n── 셀렉터 표 서명 열쇠 ──\n");
console.log("① Netlify env `RECIPE_SIGN_KEY` (개인키 · 🔴 서버에만 · 리포에 넣지 마세요)");
/* ⚠️ 여기 «백슬래시 n» 은 **글자 그대로** 보여야 한다 — 줄바꿈이 되면 안내문이 깨진다.
   (이 줄을 heredoc 으로 쓰다가 실제로 한 번 깨뜨렸다 · AC-67 «이스케이프와 싸우지 말고 피해라»
    — 그래서 문자열을 나누고 `String.raw` 로 박아 둔다.) */
console.log("   줄바꿈을 못 넣는 칸이면 " + String.raw`\n` + " 으로 바꿔 한 줄로 붙이세요(코드가 되돌립니다).");
console.log("");
console.log(priv);
console.log("\n② Netlify env `RECIPE_PUBLIC_KEY` **그리고** 러너의 `runner/recipe-key.pem`(같은 값)\n");
console.log(pub);
console.log("\n③ 확인: node scripts/verify-recipe.mjs 는 자기 열쇠로 돌아 이 값과 무관합니다.");
console.log("   실제로 꽂았는지는 GET /api/ops-recipe 의 `signing:true` 로 봅니다.\n");
