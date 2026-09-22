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
import { selectorLooksDead } from "./selector-guard.mjs";   // [AC-205] 🔴 서버가 민 셀렉터가 «죽은 모양»이면 안 쓴다
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* 🔴 **`fileURLToPath` 를 쓴다 — 손으로 자르지 않는다.**
   처음엔 `new URL(import.meta.url).pathname` 에서 앞 슬래시만 떼었는데, 그 값은 **퍼센트 인코딩된 URL 경로**다
   (한글 폴더는 `%EC%9E%91%EC%97%85`, 공백은 `%20`). 그래서 열쇠 파일이 zip 안 제자리에 **멀쩡히 들어 있는데도**
   러너가 못 읽었다 — 그리고 «못 읽음 = 없음 = 정상»이라 **오류 한 줄 없이 영영 폴백**이었다.
   zip 을 실제로 풀어서 돌려 보고서야 잡혔다(2026-09-15 · 코드를 읽어서는 안 보인다). */
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 표 서명을 검증할 공개키(SPKI PEM).
 *
 *   🔴 **이 파일은 «없는 것이 정상»이다.** 리포에는 두지 않는다 —
 *      `scripts/build-runner.mts` 가 env `RECIPE_PUBLIC_KEY` 를 읽어 **zip 을 묶을 때 써 넣는다**.
 *      열쇠를 아직 안 만들었으면 zip 에 이 파일이 **아예 안 들어가고**, 그러면 러너는
 *      **묶여 온 셀렉터로 그대로 잘 돈다**(발행에 지장 0). 그건 «고장»이 아니라 **키 꽂기 전의 정상 상태**다.
 *      ⇒ 여기서 «파일이 없다»를 오류로 다루지 않는 이유가 그것이다. 조용히 빈 문자열을 돌려주고,
 *         **왜 서버 표를 안 썼는지는 `decideRecipe` 가 문장으로 말한다**(그 문장이 보고·화면까지 간다).
 *
 *   🔴 개인키를 여기 두지 마라 — 이 폴더는 **고객 PC** 다. 빌드가 «PUBLIC KEY» 인지 확인하고 아니면 멈춘다.
 */
export function publicKeyPem() {
  try {
    const p = path.join(HERE, "..", "recipe-key.pem");
    const s = fs.readFileSync(p, "utf8").trim();
    /* 내용이 공개키가 아니면(주석만 있거나 개인키가 붙었거나) **안 쓴다** — 있는 척하지 않는다. */
    return s.includes("BEGIN PUBLIC KEY") ? s : "";
  } catch { return ""; }   // 없음 = 정상(위 주석)
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
  /* [AC-205] 서버 값 중 **죽은 모양**이라 안 쓴 칸들 — `sel()` 이 여기 쌓는다. */
  const rejected = [];
  const waits = d.use ? (serverRecipe.waits ?? {}) : {};
  return {
    /** 실제로 쓴 표의 이름. **묶여 온 표면 null** — 보고가 이 값으로 실패를 되짚는다. */
    version: d.use ? String(serverRecipe.version ?? "") || null : null,
    /** 서버 표를 안 쓴 이유(쓴 경우 ""). 운영 화면이 «되돌아간 러너»를 세는 값. */
    fellBackWhy: d.use ? "" : d.why,
    assertions: d.use ? (serverRecipe.assertions ?? {}) : {},
    blockText: d.use && Array.isArray(serverRecipe.blockText) ? serverRecipe.blockText : [],
    /**
     * 셀렉터 한 칸 — 서버 값이 있으면 그것, 없으면 묶여 온 값.
     *
     *   🔴 [AC-205 · 2026-09-23] **서버 값이 «죽은 모양»이면 안 쓴다.** 종전엔 «비어 있지 않으면» 그대로 썼다.
     *      어제 소스에서 잡은 그 병(`text=A, text=B` 가 조용히 한 문자열이 된다)이 **여기로도 들어올 수 있다** —
     *      레시피는 「러너를 다시 배포하지 않고 셀렉터를 고치는 길」이라 **오타 한 번이면 그대로 나간다.**
     *      그리고 호출부가 거의 다 `.catch(() => 0)` 이라 **터져도 «없네»로 읽힌다.**
     *   🔴 거부는 **묶여 온 값으로 되돌리는 것**이지 잡을 멈추는 게 아니다(§9 — 막지 않는다). 글은 그대로 나간다.
     *   🔴 다만 **조용하지 않다** — `rejected` 에 쌓아 보고에 싣는다. 안 적으면 서버 표가 깨진 채로 돌고 아무도 모른다.
     *   ⚠️ 거부 규칙은 **브라우저로 재서 죽은 것만**이다(`scripts/probe-selector-guard.mjs` 13/0).
     *      「의심스럽다」로 거부하면 **서버가 고쳐 보낸 수리가 묻힌다** — 거짓 빨강은 조용한 초록만큼 나쁘다.
     */
    sel(name) {
      const v = sel[name];
      if (typeof v === "string" && v.trim()) {
        const bad = selectorLooksDead(v);
        if (!bad.dead) return v;
        /* 같은 칸을 여러 번 물어도 한 번만 적는다(보고가 같은 말로 도배되지 않게). */
        if (!rejected.some((r) => r.name === name)) rejected.push({ name, why: bad.why, sample: v.slice(0, 60) });
      }
      return bundled?.[name] ?? "";
    },
    /** 🔴 거부한 서버 칸들 — `[{ name, why, sample }]`. 비어 있으면 거부 0(«안 쟀다»가 아니다 · 늘 잰다). */
    rejected,
    /** 대기값 한 칸(밀리초). */
    wait(name, fallback) {
      const v = Number(waits[name]);
      return Number.isFinite(v) && v > 0 ? v : fallback;
    },
  };
}
