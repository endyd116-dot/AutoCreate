/**
 * lib/runner-block.ts — 러너가 «무엇에 막혔는지»를 가르는 단일 출처(계약 §2 RunnerErrorKind · DESIGN §7.2 실패 분류 6종).
 *   AM 원본: ../AutoMarketing/lib/runner-block.ts (구조·마커 규약·«억지 분류 금지» 원칙 이식 2026-09-14 · AC 어휘 7종으로 개작).
 *
 *   ── AM 이 피 흘려 배운 것(그대로 가져온다) ──────────────────────────────────
 *   ① **순수 함수**(DB·네트워크 0) — 러너가 만든 문구와 서버가 저장한 문구 양쪽에서 같은 답이 나온다.
 *   ② **명시 마커 우선**(`[block:captcha]`) — 러너가 아는 것을 서버가 문자열 추측으로 뒤집지 않는다.
 *   ③ **모르면 unknown** — 억지 분류 금지. 틀린 안내가 침묵보다 나쁘다(«사람이 1회 로그인하세요»를 셋에 똑같이
 *      말하면 둘에서 거짓말이 된다 — AM 이 4일을 서 있던 사고의 정체).
 *   ④ **«우리 문제»와 «계정 문제»를 섞지 않는다** — `selector_changed`(우리가 고친다)를 따로 둔다.
 *
 *   ── AC 어휘(계약 §2) ────────────────────────────────────────────────────────
 *   AM 은 11종(device_confirm·two_factor·console_api…)이었다. AC 계약은 7종으로 고정돼 있어 **좁은 원인은
 *   `detail` 에 원문으로 남기고 kind 는 계약 어휘로만** 낸다(어휘를 늘리면 B·A·DB 가 같이 흔들린다).
 *   좁은 원인이 처방을 가르는 자리(2단계 인증 = 자동화 구조적 불가)는 `humanOnly` 플래그로 표시한다.
 *
 *   ── 🔴 경계(메인 확정 2026-09-14 · 방향은 하나) ──────────────────────────────
 *     이 파일(B2)  : **날것의 실패**(셀렉터·HTTP·본문·러너 마커) → `RunnerErrorKind`
 *     account-health(B): `RunnerErrorKind` → 계정 status·action(전이표 **정본**)
 *   그래서 어휘·전이표는 여기서 **정의하지 않고 import 한다**(사본 0 · 순환 0).
 */

/* 어휘·전이표 정본 = `lib/account-health.ts`(계약 §4 가 거기에 배정했다). 여기서는 **읽기만** 한다. */
import { ACCOUNT_ACTION_OF, RUNNER_ERROR_LABEL, isRunnerErrorKind, type RunnerErrorKind, type AccountAction } from "./account-health";
export { ACCOUNT_ACTION_OF, RUNNER_ERROR_LABEL, isRunnerErrorKind };
export type { RunnerErrorKind, AccountAction };

/** 계약 §2 의 7종 — 표(정본)에서 뽑는다(두 벌이 되지 않게). */
export const RUNNER_ERROR_KINDS: readonly RunnerErrorKind[] = Object.freeze(Object.keys(ACCOUNT_ACTION_OF) as RunnerErrorKind[]);

export interface RunnerBlock {
  kind: RunnerErrorKind;
  /** 콕핏·칩용 짧은 한국어. */
  label: string;
  /** 사용자에게 그대로 보여 주는 한 문장(사람말 · 내부어 금지). */
  message: string;
  /** 사람이 직접 해야만 풀리나(자동 재시도로는 안 풀린다). */
  needsHuman: boolean;
  /** 자동 재시도가 의미 있나. */
  retryable: boolean;
  /** 계정 상태 전이 신호(계약 §4). */
  accountAction: AccountAction;
  /** 🔴 우리(개발)가 고쳐야 하는 것인가 — 고객에게 «다시 로그인»을 시키면 안 되는 부류. */
  ourBug: boolean;
  /** 사람이 로그인해도 자동화가 다시 막히나(2단계 인증 등) — 안내 문구가 거짓이 되지 않게. */
  humanOnly?: boolean;
  /** 분류 근거 원문(120자 · 자격 평문 금지). */
  detail?: string;
}

type BlockSpec = Pick<RunnerBlock, "message" | "needsHuman" | "retryable" | "ourBug">;
const BLOCKS: Record<RunnerErrorKind, BlockSpec> = {
  login_fail: {
    message: "계정에 로그인하지 못했어요. 비밀번호가 바뀌었거나 추가 확인이 필요해요 — «다시 로그인»을 눌러 주세요.",
    needsHuman: true, retryable: false, ourBug: false,
  },
  captcha: {
    /* AM 2026-08-12 정정을 그대로 계승 — «로그인해도 또 걸립니다»는 사람이 할 일을 막는 거짓 안내였다.
       실측: 사람이 한 번 풀어 준 세션을 저장하자 다음 실행부터 로그인 단계 자체가 사라졌다. */
    message: "자동 로그인을 봇으로 보고 «자동입력 방지»가 떴어요. 창을 띄워 드릴 테니 한 번만 직접 로그인해 주세요 — 그 세션을 저장해 다음부터는 건너뜁니다.",
    needsHuman: true, retryable: false, ourBug: false,
  },
  rate_limited: {
    message: "이 계정에 글이 너무 잦다고 채널이 막았어요. 24시간 쉬었다가 하루 발행 수를 한 건 줄일게요.",
    needsHuman: false, retryable: true, ourBug: false,
  },
  suspended: {
    message: "이 계정이 채널에서 제한됐어요. 예약된 글은 같은 채널의 다른 계정으로 옮길게요.",
    needsHuman: true, retryable: false, ourBug: false,
  },
  selector_changed: {
    message: "로그인은 됐는데 글쓰기 화면에서 입력 자리를 찾지 못했어요. 채널이 화면을 바꾼 것으로 보여요 — 저희가 고칠 부분이라 담당이 확인합니다.",
    needsHuman: false, retryable: true, ourBug: true,
  },
  network: {
    message: "연결이 끊기거나 응답이 너무 느렸어요. 다음 차례에 다시 시도할게요.",
    needsHuman: false, retryable: true, ourBug: false,
  },
  unknown: {
    message: "원인을 아직 분류하지 못했어요 — 남긴 사유를 그대로 보관했고 담당이 확인합니다.",
    needsHuman: true, retryable: true, ourBug: false,
  },
};

/** 러너가 실패 문구에 박는 마커 — 서버는 마커가 있으면 추측하지 않는다(문구를 바꿔도 분류가 안 깨진다). */
export const BLOCK_MARK = "[block:";
export function markBlock(kind: RunnerErrorKind): string { return `${BLOCK_MARK}${kind}]`; }

/** 2단계 인증처럼 «사람이 로그인해도 자동화가 또 막히는» 신호 — 안내 문구를 바꾼다(거짓 안내 금지). */
const HUMAN_ONLY_SIGNAL = /otp|2단계|two[_-]?factor|일회용\s?번호|인증번호/i;

/**
 * classifyRunnerBlock — 러너 보고(errorKind·detail) → 막힌 지점.
 *   ① 러너가 계약 어휘로 errorKind 를 실었으면 그대로 신뢰.
 *   ② 없으면 detail 의 마커 → 문구 신호 순으로 추정(좁은 것부터).
 *   ③ 아무것도 안 맞으면 unknown(원문 보존).
 */
export function classifyRunnerBlock(errorKind: unknown, detail?: string | null): RunnerBlock {
  const raw = String(detail ?? "").slice(0, 400);
  const mk = (kind: RunnerErrorKind, extra?: Partial<RunnerBlock>): RunnerBlock => {
    const o: RunnerBlock = { kind, label: RUNNER_ERROR_LABEL[kind], accountAction: ACCOUNT_ACTION_OF[kind], ...BLOCKS[kind], ...extra };
    if (raw.trim()) o.detail = raw.slice(0, 120);
    return o;
  };

  // ① 러너가 계약 어휘로 말했다
  if (isRunnerErrorKind(errorKind)) {
    if (errorKind === "login_fail" && HUMAN_ONLY_SIGNAL.test(raw)) {
      return mk("login_fail", {
        message: "이 계정은 2단계 인증(휴대폰 확인)이 켜져 있어요. 로그인할 때마다 필요해서 자동 발행이 되지 않습니다 — 2단계를 끄거나 다른 계정을 연결해 주세요.",
        humanOnly: true, retryable: false,
      });
    }
    return mk(errorKind);
  }

  // ② 마커
  const m = raw.match(/\[block:([a-z_]+)\]/);
  if (m && isRunnerErrorKind(m[1])) return mk(m[1] as RunnerErrorKind);
  if (!raw.trim()) return mk("unknown");

  /* ★AM 교훈 이식 — 여러 원인을 한 문장에 나열한 구 문구(«추가 인증(캡차·기기등록·2단계)»)는
     «셋 중 무엇인지 모른다»가 정직한 답이다. 개별 신호보다 **먼저** 걸러낸다(«캡차» 글자 하나로 단정 금지). */
  if (/추가\s?인증\s*\(/.test(raw)) {
    return mk("login_fail", { message: "채널이 로그인에 추가 확인을 요구했어요 — 무엇인지는 이 기록만으로 알 수 없어요. «다시 로그인»으로 창을 띄워 확인해 주세요.", retryable: true });
  }

  // ③ 문구 신호(좁은 것부터)
  const has = (re: RegExp) => re.test(raw);
  if (has(/정지|이용\s?제한|블라인드|suspend|ban(ned)?|disabled/i)) return mk("suspended");
  if (has(/너무\s?(자주|많)|잦|rate[_\s-]?limit|429|too many/i)) return mk("rate_limited");
  if (HUMAN_ONLY_SIGNAL.test(raw)) return mk("login_fail", { message: BLOCKS.login_fail.message, humanOnly: true, retryable: false });
  if (has(/기기\s?등록|새로운\s?기기|device[_\s-]?confirm|idSafetyRelease/i)) return mk("login_fail");
  if (has(/captcha|캡차|자동입력\s?방지|보안\s?문자/i)) return mk("captcha");
  if (has(/아이디\/비밀번호|아이디\s?또는\s?비밀번호|로그인\s?실패|비밀번호를\s?확인|login[_\s-]?fail|401|403/i)) return mk("login_fail");
  if (has(/세션.*만료|session.*expire|재로그인|logged\s?out/i)) return mk("login_fail");
  if (has(/찾지\s?못했|입력을\s?찾지|셀렉터|selector|화면\s?구조|DOM|editor not found/i)) return mk("selector_changed");
  if (has(/타임아웃|timeout|시간\s?초과|제한\s?시간|ECONN|ENOTFOUND|ETIMEDOUT|network|net::/i)) return mk("network");

  return mk("unknown", { message: `${BLOCKS.unknown.message}` });
}
