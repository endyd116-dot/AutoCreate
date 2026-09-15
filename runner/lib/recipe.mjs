/**
 * runner/lib/recipe.mjs — 서버가 내려 준 **셀렉터 표**를 믿을지 정하고, 채널 모듈에 값을 준다(계약 P1R8 §3.3).
 *   서버 짝: `lib/recipe.ts`(서명·정규화) · `lib/recipe-store.ts`(누구에게 어느 판을).
 *
 *   ══ 🔴 이 파일의 규율 — **못 믿으면 어제 것으로 일한다** ══
 *     서명이 안 맞거나 · 공개키가 없거나 · 판이 낮거나 · 모양이 이상하면 **묶여 온 표**(zip 안의 상수)로 그대로 일한다.
 *     **배포는 편의고 발행이 본업이다**(자동 업데이트에서 세운 규율과 같다).
 *     🔴 그리고 **조용히 내려앉지 않는다** — 어느 표로 돌았는지를 보고에 실어, 운영이 «몇 대가 되돌아갔나»를 본다.
 *        안 실으면 «전부 새 표를 쓰는 줄» 안다(설계 §6.2 ⚠️).
 *
 *   ══ 왜 HMAC 이 아니라 Ed25519 인가 ══
 *     HMAC 이면 **검증하려고 러너가 비밀을 들고 있어야 한다.** 고객 PC 에 있는 비밀은 비밀이 아니다 —
 *     지문·토큰에서 이미 배운 것과 같다(AC-65 «뒷문이 먼저다»).
 *     ⇒ **공개키만** zip 에 넣고 개인키는 서버에만 둔다. 공개키가 새어도 표를 **만들** 수는 없다.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

/**
 * 표 서명을 검증할 공개키(SPKI PEM).
 *   🔴 **아직 비어 있을 수 있다** — 열쇠를 만들기 전에는 서버도 표를 안 만들고 러너도 안 받는다.
 *      그 상태가 «고장»이 아니라 **지금 정상**이다(묶여 온 표로 돈다 · 키 꽂으면 즉시 가동).
 */
export function publicKeyPem() {
  try {
    const p = path.join(HERE, "..", "recipe-key.pem");
    const s = fs.readFileSync(p, "utf8").trim();
    return s.includes("BEGIN PUBLIC KEY") ? s : "";
  } catch { return ""; }
}

/** 서버(`lib/recipe.ts canonicalRecipe`)와 **글자 하나까지 같은** 정규화. 여기가 갈리면 전 러너가 폴백으로 내려앉는다. */
export function canonicalRecipe(body) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v).sort()) { if (k === "sig") continue; out[k] = sort(v[k]); }
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(body));
}

const verNum = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? "").trim());
  return m ? Number(m[1]) * 1_000_000 + Number(m[2]) * 1_000 + Number(m[3]) : -1;
};

/**
 * 🔴 **판정 — 순수 함수.** 이게 조용히 틀리면 ①못 믿을 표를 쓰거나 ②멀쩡한 표를 전부 버린다.
 *   둘 다 라이브로는 «그냥 잘 안 되네»로만 보여서, 하니스로만 잡힌다(`scripts/verify-recipe.mjs`).
 * @returns {{use:boolean, why:string}}
 */
export function decideRecipe({ recipe, runnerVersion, publicPem }) {
  if (!recipe || typeof recipe !== "object") return { use: false, why: "서버가 표를 안 줬어요(묶여 온 표로 갑니다)" };
  if (!publicPem) return { use: false, why: "표를 검증할 공개키가 없어요(아직 이 기능이 안 켜졌습니다)" };
  if (!recipe.sig) return { use: false, why: "표에 서명이 없어요" };
  if (!recipe.selectors || typeof recipe.selectors !== "object" || !Object.keys(recipe.selectors).length) {
    /* 🔴 빈 표를 «받았다»고 쓰면 러너가 **아무 데도 못 누른다** — 없는 것보다 나쁘다. */
    return { use: false, why: "표가 비어 있어요" };
  }
  const min = verNum(recipe.minRunner);
  const mine = verNum(runnerVersion);
  if (min >= 0 && mine >= 0 && mine < min) return { use: false, why: `이 표는 러너 v${recipe.minRunner} 이상이 필요해요(지금 v${runnerVersion})` };

  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(canonicalRecipe(recipe), "utf8"), crypto.createPublicKey(publicPem), Buffer.from(String(recipe.sig), "base64url"));
  } catch { ok = false; }
  if (!ok) return { use: false, why: "표의 서명이 맞지 않아요(위조이거나 전송 중 바뀌었어요)" };
  return { use: true, why: "" };
}

/**
 * 채널 모듈이 쓰는 손잡이.
 *   `bundled` = zip 에 묶여 온 상수 표(= 지금까지 하던 그 값). **서버 표가 없거나 그 칸이 없으면 이쪽으로 내려앉는다** —
 *   그래서 표가 한 칸만 와도 나머지는 종전 그대로 돈다(전부 아니면 전무가 아니다).
 */
export function makeRecipe(serverRecipe, bundled, runnerVersion) {
  const pem = publicKeyPem();
  const d = decideRecipe({ recipe: serverRecipe, runnerVersion, publicPem: pem });
  const sel = d.use ? (serverRecipe.selectors ?? {}) : {};
  const waits = d.use ? (serverRecipe.waits ?? {}) : {};
  return {
    /** 실제로 쓴 표의 이름. **묶여 온 표면 null** — 보고가 이 값으로 실패를 되짚는다. */
    version: d.use ? String(serverRecipe.version ?? "") || null : null,
    /** 서버 표를 안 쓴 이유(쓴 경우 ""). 운영 화면이 «되돌아간 러너»를 세는 값. */
    fellBackWhy: d.use ? "" : d.why,
    assertions: d.use ? (serverRecipe.assertions ?? {}) : {},
    blockText: d.use && Array.isArray(serverRecipe.blockText) ? serverRecipe.blockText : [],
    /** 셀렉터 한 칸 — 서버 값이 있으면 그것, 없으면 묶여 온 값. */
    sel(name) {
      const v = sel[name];
      return typeof v === "string" && v.trim() ? v : (bundled?.[name] ?? "");
    },
    /** 대기값 한 칸(밀리초). */
    wait(name, fallback) {
      const v = Number(waits[name]);
      return Number.isFinite(v) && v > 0 ? v : fallback;
    },
  };
}
