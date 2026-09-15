/**
 * lib/recipe.ts — **셀렉터 표(recipe)의 서버 쪽 정본**(계약 P1R8 §3.3 · 설계 `docs/active/2026-09-15-recipe-canary-design.md`).
 *   AC 신규 2026-09-15(B2).
 *
 *   ══ 무엇을 푸는가 ══
 *     네이버·티스토리는 API 가 없어 **브라우저 화면을 눌러서** 올린다. 그 «무엇을 누를까»(셀렉터)는 지금 러너 zip 안에 박혀 있어서,
 *     채널이 화면을 바꾸면 **러너를 다시 배포해야** 고칠 수 있다. 그 사이 고객 발행은 멈춘다.
 *     ⇒ 표를 서버가 내려 주면 **재배포 없이** 고칠 수 있다. 그게 이 파일이다.
 *
 *   ══ 🔴 이 파일이 지키는 네 줄 ══
 *     1. **서명이 안 맞으면 러너는 안 쓴다** — 대신 zip 에 묶여 온 표로 **계속 일한다**(멈추지 않는다).
 *        recipe 는 «남의 브라우저에서 무엇을 누를지»를 정하는 값이라, 못 믿을 표를 쓰느니 어제 것이 낫다.
 *     2. **Ed25519** 로 서명한다(HMAC 이 아니다). HMAC 이면 **검증하려고 러너가 비밀을 들고 있어야** 하고,
 *        고객 PC 에 있는 비밀은 비밀이 아니다. 공개키만 zip 에 넣고 **개인키는 서버에만** 둔다.
 *     3. **한 번 올린 버전의 내용은 안 바꾼다** — «같은 버전인데 다른 표»가 돌면 사고 때 무엇이 돌았는지 영영 모른다
 *        (러너 zip 과 같은 규율).
 *     4. **`rollbackTo` 를 만들 때 채운다** — «되돌릴 판을 그때 찾자»는 사고 한가운데서 제일 안 되는 일이다.
 *
 *   🔴 **순수 리프**: 이 파일은 DB 를 모른다(서명·검증·형태만). 저장·배포 단계는 `lib/recipe-store.ts`.
 *      가르는 이유 = 러너 쪽 검증기(`runner/lib/recipe.mjs`)와 **같은 규칙을 두 번 쓰지 않으려고** —
 *      규칙이 두 곳에 있으면 언젠가 갈라지고, 갈라진 날 러너가 전부 폴백으로 내려앉는다.
 */
import crypto from "node:crypto";

/** 지금 표를 내려 주는 채널(러너 발행 채널 중 셀렉터가 있는 것). */
export const RECIPE_CHANNELS: readonly string[] = ["naver_blog", "tistory"];

/** 배포 단계(설계 §4). 숫자가 클수록 넓다. */
export type RecipeStage = "canary" | "own" | "volunteer" | "all";
export const STAGE_ORDER: Readonly<Record<RecipeStage, number>> = { canary: 0, own: 1, volunteer: 2, all: 3 };

export interface RecipeBody {
  /** `채널@KST날짜.연번` — 🔴 **사람이 입으로 말할 수 있어야 한다**(사고 통화에서 «티스토리 구일육 일번» 이라고 부를 값). */
  version: string;
  channel: string;
  /** 이 판 **미만** 러너는 이 표를 무시한다 — 새 표가 옛 실행기를 깨지 않게. */
  minRunner: string;
  selectors: Record<string, string>;
  waits?: Record<string, number>;
  /** 차단 감지용 «보이는 글자»(캡차·보안문자). */
  blockText?: string[];
  /** 🔴 판정 기준이 **표와 함께** 온다(설계 §2) — 러너 코드에 두면 표를 고칠 때마다 재배포가 필요해져서 만든 이유가 사라진다. */
  assertions?: { titleMaxLen?: number; publicCheck?: boolean };
  /** 되돌릴 판(없으면 «처음 판»). */
  rollbackTo?: string | null;
}

/** 서명까지 붙은, 러너에게 실제로 내려가는 모양. */
export interface SignedRecipe extends RecipeBody {
  /** base64url Ed25519 서명 — `canonical(body)` 에 대한 것. */
  sig: string;
}

/**
 * 🔴 **정규화** — 서명하는 바이트와 검증하는 바이트가 **글자 하나까지** 같아야 한다.
 *   `JSON.stringify` 는 키 순서를 **넣은 순서대로** 쓴다. 서버가 만든 순서와 러너가 받은 순서가 달라지는 경로가
 *   하나라도 있으면(DB jsonb 왕복이 실제로 키를 재배열한다) 서명이 **조용히 전부 실패**하고
 *   전 러너가 폴백으로 내려앉는다 — 그리고 그건 «표가 안 먹네»로만 보인다.
 *   ⇒ 키를 **재귀적으로 정렬**해서 직렬화한다. `sig` 는 당연히 뺀다.
 */
export function canonicalRecipe(body: RecipeBody): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o).sort()) { if (k === "sig") continue; out[k] = sort(o[k]); }
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(body));
}

const env = (k: string) => String(process.env[k] ?? "").trim();

/** 개인키(PKCS#8 PEM · env `RECIPE_SIGN_KEY` · 줄바꿈은 `\n` 이스케이프도 받는다). 없으면 null — **서명 없이 내보내지 않는다**. */
function privateKey(): crypto.KeyObject | null {
  const pem = env("RECIPE_SIGN_KEY").replace(/\\n/g, "\n");
  if (!pem) return null;
  try { return crypto.createPrivateKey(pem); } catch { return null; }
}
/** 공개키(SPKI PEM · env `RECIPE_PUBLIC_KEY`). 러너 zip 에도 같은 값이 들어간다. */
export function recipePublicKeyPem(): string {
  return env("RECIPE_PUBLIC_KEY").replace(/\\n/g, "\n");
}
/** 서명 열쇠가 꽂혀 있나 — 없으면 recipe 배포 자체를 **안 켠다**(키 꽂으면 가동 · CLAUDE §8). */
export function recipeSigningConfigured(): boolean {
  return !!privateKey() && !!recipePublicKeyPem();
}

/** 서명. 열쇠가 없으면 **null** — 서명 없는 표를 만들어 내지 않는다(그건 러너가 어차피 거절한다). */
export function signRecipe(body: RecipeBody): SignedRecipe | null {
  const key = privateKey();
  if (!key) return null;
  const sig = crypto.sign(null, Buffer.from(canonicalRecipe(body), "utf8"), key).toString("base64url");
  return { ...body, sig };
}

/** 검증(서버 쪽 자기 점검 — 러너는 `runner/lib/recipe.mjs` 가 **같은 규칙으로** 한다). */
export function verifyRecipe(r: SignedRecipe, publicPem = recipePublicKeyPem()): boolean {
  if (!r?.sig || !publicPem) return false;
  try {
    return crypto.verify(null, Buffer.from(canonicalRecipe(r), "utf8"), crypto.createPublicKey(publicPem), Buffer.from(r.sig, "base64url"));
  } catch { return false; }
}

/* ─────────────────────────── 버전 ─────────────────────────── */

/** `1.1.9` → 비교 가능한 수. 모양이 아니면 -1(비교에서 **항상 미달**로 떨어진다 — 모르면 안 준다). */
export function verNum(v: unknown): number {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? "").trim());
  return m ? Number(m[1]) * 1_000_000 + Number(m[2]) * 1_000 + Number(m[3]) : -1;
}
/** 이 러너가 이 표를 쓸 수 있나(`minRunner` 이상인가). 🔴 러너 판을 모르면 **안 준다**. */
export function runnerMeetsMin(runnerVersion: unknown, minRunner: unknown): boolean {
  const a = verNum(runnerVersion); const b = verNum(minRunner);
  if (a < 0) return false;
  if (b < 0) return true;          // minRunner 를 안 적었으면 제한이 없는 것이다
  return a >= b;
}

/** `tistory@2026-09-16.1` 꼴인가 — 🔴 사고 통화에서 부를 수 있는 이름만 받는다. */
export function isRecipeVersion(v: unknown): boolean {
  return /^[a-z_]+@\d{4}-\d{2}-\d{2}\.\d+$/.test(String(v ?? ""));
}

/* ─────────────────────────── 시간 게이트 ─────────────────────────── */

/**
 * 🔴 **넓히는 것은 사람이 볼 때만, 좁히는 것은 언제나**(설계 §8 — ⑤번 답).
 *   승격(더 많은 러너에게 퍼뜨리기)은 **KST 평일 10~18시**에만. 롤백은 **시간 제한 없음**.
 *   AI 모델 카나리엔 이 게이트가 없는데 여기만 조이는 이유: AI 는 우리 서버 안이고,
 *   **recipe 는 남의 계정에서 버튼을 누른다.**
 */
export function canPromoteAt(now: Date): { ok: boolean; why: string } {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const day = kst.getUTCDay();          // 0 일 · 6 토
  const hour = kst.getUTCHours();
  if (day === 0 || day === 6) return { ok: false, why: "주말이에요 — 아무도 안 볼 때 퍼뜨리지 않아요" };
  if (hour < 10 || hour >= 18) return { ok: false, why: "업무시간(평일 10~18시)이 아니에요" };
  return { ok: true, why: "" };
}

/** 다음 단계. `all` 다음은 없다(null). */
export function nextStage(s: RecipeStage): RecipeStage | null {
  return s === "canary" ? "own" : s === "own" ? "volunteer" : s === "volunteer" ? "all" : null;
}

/**
 * 단계별 **최소 체류 시간**(시간 단위 · 설계 §4).
 *   🔴 `volunteer` 자원자가 0명이면 그 단계를 **건너뛰지 않고** 앞 단계를 두 배로 잡는다 —
 *      관문을 없애는 게 아니라 길게 잡는다(설계 §4 ⚠️).
 */
export function minDwellHours(stage: RecipeStage, volunteers: number): number {
  if (stage === "canary") return 0;                       // 드라이런은 즉시 다음으로 갈 수 있다
  if (stage === "own") return volunteers > 0 ? 24 : 48;
  if (stage === "volunteer") return 24;
  return 0;
}
