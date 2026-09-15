/**
 * lib/ai-key.ts — **AI 키를 고르는 자리 하나**(DESIGN §3.3 «`ai-key`(키 로테이션)는 R8» · 메인 발주 2026-09-15).
 *   🔎 출처: AC 신규(B-1 · 2026-09-15) — AM 원본 없음. 🔴 **순수 리프**(DB·네트워크·import 0).
 *
 *   ══ 왜 «고르는 자리»가 하나여야 하나 ══
 *     🔴 키를 읽는 곳이 **여덟**이었다(발주서는 셋이라고 했는데 세 보니 여덟이다):
 *       `lib/ai.ts` · `lib/ai-image.ts` · `lib/ai-verify.ts` · `lib/video/judge.ts` · `lib/video/tts.ts` ·
 *       `lib/video/providers/index.ts` · `lib/video/providers/registry.ts`(`geminiAvailable`) · `lib/cron/ai-model-watch.ts`
 *     각자 고르면 ①**한 키가 429 를 맞은 것을 나머지가 모른다**(쉬게 해도 다른 길로 계속 때린다)
 *     ②🔴 더 나쁜 것 — 한 곳이라도 빠뜨리면 `GEMINI_API_KEYS` 만 꽂는 순간 **그 기능만 조용히 «키 없음»으로** 죽는다.
 *     (같은 모양으로 코인 식이 세 곳에 흩어져 새던 사고가 오늘 있었다 · AC-74.)
 *
 *   ══ 🔴 키가 1개면 **오늘과 한 글자도 다르지 않다** ══
 *     이 파일의 첫 번째 요구사항이다(메인 발주). 키 1개일 때:
 *       · `leaseAiKey()` 는 늘 그 키를 준다 · 키가 없으면 `null`(호출부의 `no_api_key` 가 그대로 산다)
 *       · 429 로 쉬게 해도 **쉴 키가 그것뿐**이라 «제일 먼저 풀리는 키»로 바로 다시 준다 — **기다리지 않는다**
 *     즉 «되는 척 하는 틀»이 아니라 **키가 1개면 퇴화해서 지금 동작이 되는** 구조다.
 *
 *   ══ 🔴 막지 않는다(CLAUDE §9) ══
 *     키가 **전부 쉬는 중이어도 그냥 준다**(가장 먼저 풀리는 것). 우리 안전장치가 고객 공장을 세우면 그건 보호가 아니라 고장이다.
 *     쉼은 «이 키를 피하자»는 **힌트**이지 잠금이 아니다.
 *
 *   ══ 🔴 키 값은 어디에도 남기지 않는다 ══
 *     로그·오류·감사·응답 전부. 구분이 필요하면 **순번**(`key#2`)만 쓴다 —
 *     끝 4자도 «어느 키인지»를 말해 주지만 **순번이면 충분하고**(운영자는 `GEMINI_API_KEYS` 의 몇 번째인지 알면 된다)
 *     남기지 않은 것은 새지도 않는다. 제공사 오류 본문이 키를 되비칠 수 있어 `redactKeys()` 로 걷어 낸다.
 *
 *   ══ [R8 §4.4] 고객이 자기 키를 꽂으면(BYO) ══
 *     🔴 **고르는 자리는 여전히 여기 하나다.** 다만 이 파일은 **순수 리프**(DB·import 0)이고 `leaseAiKey()` 는 **동기**라,
 *        테넌트 키를 **가져오는 일**은 밖(`lib/ai-key-byo.ts` · DB+복호화)에서 하고 **값만 넘겨받는다**(메인 승인 2026-09-15).
 *        갈래를 밖에 하나 더 내면 «고르는 자리가 둘»이 되고, 그게 오늘 카드뉴스가 1코인으로 샌 사고의 모양이다(AC-74).
 *     🔴 고객 키도 **우리 키와 똑같이** 429 면 쉰다. 다만 쉰다고 **우리 풀로 넘어가지 않는다** —
 *        그건 «키를 고르는 일»이 아니라 **«남의 요금을 대신 낼까»라는 돈 결정**이라 호출부(`lib/ai.ts`)가 정한다.
 *     🔴 `redactKeys()` 는 **고객 키도** 걷어 낸다 — 빌려 준 키를 기억해 뒀다가 지운다(우리 풀만 지우면 고객 키가 오류 본문으로 샌다).
 *
 *   ══ 못 하는 것(정직 · AC-9) ══
 *     쉼 상태는 **함수 인스턴스 메모리**다 — 콜드 스타트마다 비워지고 인스턴스끼리 공유되지 않는다.
 *     즉 «완벽한 배분»이 아니라 **같은 인스턴스가 방금 맞은 429 를 되풀이하지 않는** 정도다.
 *     그 이상을 하려면 표가 필요한데, 키 하나로 도는 지금 그 값은 없다(필요해지면 `stock_cache` 처럼 표로 올린다).
 */

/** 429 를 맞은 키를 쉬게 하는 시간. 🔴 짧게 — 길면 키 하나가 오래 노는데, 우리는 편수를 못 만들면 그게 손해다. */
export const KEY_COOLDOWN_MS = 60_000;

export interface AiKeyLease {
  /** 실제 키 — 🔴 **로그·오류·응답에 절대 싣지 마라.** 부르는 자리에서 URL 에만 쓴다. */
  key: string;
  /** 사람이 보는 이름. `key#1` 꼴(순번) — 키 값이 아니다. 고객 키는 `내 키`. */
  label: string;
  /** 0-based 순번(내부용). 🔴 고객 키는 **-1**(우리 풀의 자리가 아니다). */
  index: number;
  /** 🔴 [R8 §4.4] **고객 키로 나갔나** — `ai_usage.byo` 에 그대로 적는다(의도가 아니라 사실 · AC-71). */
  byo?: true;
}

/** [R8 §4.4] 고객이 꽂은 키 — 값은 `lib/ai-key-byo.ts` 가 DB 에서 꺼내 복호화해 넘긴다. */
export interface ByoKey { key: string; label?: string; restingUntil?: number | null }

interface KeyState { key: string; label: string; cooldownUntil: number; rested: number; lastRestedAt: number; used: number }

let pool: KeyState[] = [];
/* 🔴 «아직 안 읽음» 표시 — 진짜 서명은 늘 숫자로 시작하므로(`3:20,20:...`) 이 값과 겹칠 수 없다.
   ⚠️ 여기에 제어문자를 쓰면 **git 이 이 파일을 binary 로 본다** — diff 도 머지도 안 된다(2026-09-15 실측). */
let poolSig = "(none)";
let cursor = 0;

/** env 를 읽어 키 목록으로. `GEMINI_API_KEYS`(쉼표)가 먼저 · 없으면 **지금 그대로** `GEMINI_API_KEY` 하나. */
function readKeys(): string[] {
  const many = String(process.env.GEMINI_API_KEYS ?? "").trim();
  const raw = many ? many.split(",") : [String(process.env.GEMINI_API_KEY ?? "")];
  const out: string[] = [];
  for (const x of raw) {
    const k = String(x ?? "").trim();
    /* 🔴 같은 키를 두 번 적으면 «쉬게 했는데 바로 그 키를 또 고르는» 일이 난다 — 중복은 하나로 본다. */
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** env 가 바뀌었을 때만 풀을 다시 만든다 — 매번 만들면 쉼 상태(이 파일의 전부)가 사라진다. */
function ensurePool(): void {
  const keys = readKeys();
  const sig = `${keys.length}:${keys.map((k) => k.length).join(",")}:${keys.map((k) => k.slice(0, 3)).join("")}`;
  if (sig === poolSig) return;
  poolSig = sig;
  cursor = 0;
  pool = keys.map((key, i) => ({ key, label: `key#${i + 1}`, cooldownUntil: 0, rested: 0, lastRestedAt: 0, used: 0 }));
}

/** 키가 하나라도 있나 — 호출부의 «키 없음» 판정과 같은 뜻. */
export function aiKeysConfigured(): boolean { ensurePool(); return pool.length > 0; }
/** 몇 개인가(운영 표시·하니스). */
export function aiKeyCount(): number { ensurePool(); return pool.length; }

/* 🔴 빌려 준 **고객 키**를 기억해 둔다 — `redactKeys()` 가 지울 수 있게. 값은 여기서 절대 밖으로 안 나간다.
   ⚠️ 무한정 쌓이지 않게 상한을 둔다(오래된 것부터 버린다 · 지워도 다음 호출에서 다시 들어온다). */
const byoSeen = new Set<string>();
const BYO_SEEN_MAX = 50;

/**
 * 쓸 키 하나를 빌린다(라운드로빈 · 쉬는 키는 건너뛴다).
 *   🔴 [R8 §4.4] **고객이 자기 키를 꽂았으면 그 키를 준다** — 우리 풀은 안 본다.
 *      쉬는 중이어도 준다(위 헤더의 «막지 않는다»와 같은 결). «우리 키로 대신 돌릴까»는 **돈 결정**이라 호출부가 정한다.
 *   🔴 전부 쉬는 중이면 **가장 먼저 풀리는 키를 그냥 준다** — 기다리지 않고, 막지도 않는다.
 *   @returns 키가 하나도 없으면 `null` — 호출부는 지금처럼 `no_api_key` 로 답한다.
 */
export function leaseAiKey(byo?: ByoKey | null): AiKeyLease | null {
  const bk = String(byo?.key ?? "").trim();
  if (bk) {
    if (bk.length >= 8) {
      byoSeen.add(bk);
      if (byoSeen.size > BYO_SEEN_MAX) byoSeen.delete(byoSeen.values().next().value as string);
    }
    return { key: bk, label: String(byo?.label ?? "내 키").slice(0, 40), index: -1, byo: true };
  }
  ensurePool();
  if (!pool.length) return null;
  const now = Date.now();
  for (let n = 0; n < pool.length; n++) {
    const s = pool[cursor % pool.length];
    cursor = (cursor + 1) % pool.length;
    if (s.cooldownUntil <= now) { s.used++; return { key: s.key, label: s.label, index: pool.indexOf(s) }; }
  }
  /* 전부 쉬는 중 — 제일 먼저 풀리는 것으로 간다(공장을 세우지 않는다). */
  const soonest = pool.reduce((a, b) => (b.cooldownUntil < a.cooldownUntil ? b : a), pool[0]);
  soonest.used++;
  return { key: soonest.key, label: soonest.label, index: pool.indexOf(soonest) };
}

export type AiKeyOutcome = "ok" | "rate_limited" | "error";

/**
 * 그 키로 부른 결과를 알려 준다 — **이 함수가 이 기능의 값 전부**다(안 부르면 쉬는 키가 영영 안 생긴다).
 *   · `rate_limited` — 그 키를 잠깐 쉬게 한다.
 *   · `ok` — 쉼을 푼다(된다는 걸 방금 봤다).
 *   · `error` — 🔴 **아무것도 안 한다.** 503·타임아웃·모델 오류는 **키 잘못이 아니다** — 그걸로 키를 쉬게 하면
 *     제공사가 잠깐 흔들릴 때 멀쩡한 키를 전부 쉬게 만든다.
 */
export function reportAiKeyOutcome(lease: AiKeyLease | null | undefined, outcome: AiKeyOutcome): void {
  if (!lease) return;
  /* 🔴 [R8 §4.4] 고객 키는 **우리 풀의 자리가 아니다**(index -1) — 쉼은 `tenant_ai_keys.rested_until` 에 남는다.
     여기서 `pool[-1]` 을 건드리면 **엉뚱한 우리 키가 쉰다**(고객 한 명의 429 로 우리 공장이 느려진다). */
  if (lease.byo || lease.index < 0) return;
  const s = pool[lease.index];
  if (!s || s.key !== lease.key) return;   // 풀이 그새 바뀌었다 — 옛 임대는 조용히 버린다
  if (outcome === "rate_limited") {
    s.cooldownUntil = Date.now() + KEY_COOLDOWN_MS;
    s.rested++; s.lastRestedAt = Date.now();
    console.warn(`[ai-key] ${s.label} 할당량에 걸려 ${KEY_COOLDOWN_MS / 1000}초 쉽니다(쉰 횟수 ${s.rested}).`);
  } else if (outcome === "ok") {
    s.cooldownUntil = 0;
  }
}

/**
 * 실패 사유가 **그 키의 할당량 문제**인가.
 *   🔴 `503`·`overloaded`·`UNAVAILABLE` 은 **여기 넣지 않는다** — 제공사가 바쁜 것이지 우리 키 잘못이 아니다.
 *      그걸로 키를 쉬게 하면 흔들릴 때마다 멀쩡한 키가 전부 쉰다(`lib/ai.ts` 의 `busy` 판정과 **다른 것**을 재는 자리다).
 */
export function isRateLimitReason(reason: unknown): boolean {
  const s = String(reason ?? "");
  return /(^|\D)429(\D|$)/.test(s) || /RESOURCE_EXHAUSTED|quota|rate[\s_-]?limit/i.test(s);
}

/**
 * 로그·오류 문자열에서 키를 걷어 낸다.
 *   제공사 오류 본문이 우리가 보낸 주소를 **되비칠 수 있다**(`?key=…`). 그대로 로그에 남으면 키가 로그에 사는 것이다.
 *   ①`key=` 뒤 값을 지우고 ②우리가 아는 키 문자열 자체도 지운다(주소가 아닌 자리에 실려 와도 잡게).
 */
export function redactKeys(text: unknown): string {
  let s = String(text ?? "").replace(/([?&]key=)[^&\s"']+/gi, "$1***");
  ensurePool();
  for (const k of pool) if (k.key.length >= 8) s = s.split(k.key).join("***");
  /* 🔴 [R8 §4.4] **고객 키도 걷어 낸다.** 우리 풀만 지우면 BYO 를 붙이는 순간 **고객 키가 오류 본문으로 샌다** —
     제공사가 우리가 보낸 주소를 되비치기 때문이다. 남의 키를 우리 로그에 살게 두는 건 제일 나쁜 종류다. */
  for (const k of byoSeen) s = s.split(k).join("***");
  return s;
}

export interface AiKeyStat { label: string; resting: boolean; restsUntilSec: number; rested: number; used: number }
/**
 * 운영이 보는 숫자 — «어느 키가 몇 번 쉬었나».
 *   🔴 **키 값도 끝 4자도 없다.** 순번이면 운영자가 `GEMINI_API_KEYS` 의 몇 번째인지 알 수 있고, 그 이상은 남길 이유가 없다.
 */
export function aiKeyStats(): AiKeyStat[] {
  ensurePool();
  const now = Date.now();
  return pool.map((s) => ({
    label: s.label,
    resting: s.cooldownUntil > now,
    restsUntilSec: s.cooldownUntil > now ? Math.ceil((s.cooldownUntil - now) / 1000) : 0,
    rested: s.rested, used: s.used,
  }));
}

/** 하니스 전용 — 쉼·셈을 지운다(env 를 바꿔 가며 재려면 필요하다). 제품 코드는 부르지 않는다. */
export function _resetAiKeysForTest(): void { poolSig = "(none)"; pool = []; cursor = 0; byoSeen.clear(); }
