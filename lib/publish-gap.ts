/**
 * lib/publish-gap.ts — **계정 사이 발행 간격**을 정하는 한 곳(사장님 지시 2026-09-15 · R8).
 *   🔎 출처: AC 신규(계약 P1R8-B2 · 생성 커밋 `6d762a7` 2026-09-15) — AM 원본 없음(`../AutoMarketing/lib/` 에 같은 이름 없음 · 2026-09-16 확인).
 *
 *   ══ 사장님이 원하시는 것 ══
 *     «글1은 A계정 10:00 · 글2는 B계정 10:05 · 글3은 A계정 11:00 — 이렇게 세부적으로 정하고 싶다.
 *      그래야 광고 수익 하는 사람들이 여러 계정으로 동시에 올리지 않겠나.»
 *   지금은 `ACCOUNT_GAP_MIN = 30` 이 **채널 단위로** 걸려 있어 10:00 / 10:05 를 시스템이 자동으로 밀어낸다.
 *
 *   ══ 🔴 먼저: «30분»에는 **근거가 없다** ══
 *     코드에 그냥 상수 30 이었고 주석에도 근거가 없었다. 실물에 대 본 적 없는 값이다.
 *     그래서 이번에 **찾아봤고, 찾은 것과 못 찾은 것을 갈라 적는다**(R8-A 조사 규율):
 *
 *     · ✅ **확인된 것**: 네이버는 약관(2018-05-01 개정)에서 **«매크로 프로그램·로봇 등 자동화된 수단으로
 *       회원 가입·로그인·게시물 게재·검색»을 금지**한다. ⚠️ 이건 **뉴스 기사 기준**이고 `policy.naver.com` 원문은
 *       열지 못했다(접근 차단). 즉 **간격이 문제가 아니라 자동 게재 자체가 약관상 금지**다.
 *     · ❌ **못 찾은 것**: «여러 계정이 **동시에**(또는 N분 안에) 올리면 제재»라는 **공식 문장은 없다.**
 *       ⇒ 그러므로 **«30분»도 «5분»도 추정이다.** 통설이지 근거가 아니다.
 *     · ❌ **못 찾은 것**: «IP 가 다르면 위험이 얼마나 줄어드나»도 공식 근거 0. **추정.**
 *
 *   ══ 🔴 그래서 상수를 내리지 않는다 — «무엇을 아는가»에 따라 다르게 준다 ══
 *     추정 위에 새 상수를 박으면 지금 30 이 그랬던 것처럼 **또 근거 없는 값**이 하나 생긴다.
 *     대신 **우리가 실제로 잰 것**에만 기대어 폭을 준다:
 *       · 계정마다 **실제로 다른 IP 로 나간 기록**(`accounts.last_exit_ip` — 러너가 잡마다 확인해 적는다)이 있으면
 *         → 고객이 **5분까지 내릴 수 있게** 한다(우리가 자동으로 좁히지는 않는다 · 고객이 고른다).
 *       · 프록시가 **배정만** 돼 있고 나간 IP 를 **아직 못 쟀으면** → 30분 그대로.
 *         🔴 «배정됐다»를 «다르다»의 **대용물로 쓰지 않는다**(AC-57 · 프록시는 죽어 있을 수 있다 — 그래서 우리가 출구 IP 를 잰다).
 *       · 프록시가 없으면(= 같은 집 IP) → 30분 그대로. fail-closed 와 같은 결.
 *
 *   ⚠️ **이 값이 나오는 곳은 여기 하나여야 한다** — 각자 30 을 적으면 하나가 썩는다(메인 지시).
 *      🔴 그런데 내가 그렇게 **적어 놓고 두 자리를 안 고쳤다**(C 검증 2026-09-15 · AC-59 — **내 주석이 거짓이었다**):
 *        `netlify/functions/slots.ts`(고객이 **시각 바꾸기**) · `netlify/functions/publish-now.ts`(**지금 올리기**).
 *        하필 **고객이 손으로 만지는 두 자리**라, 편성만 고치고 두면 사장님이 원하신 «10:00 / 10:05» 가
 *        **바로 그 문에서 옛 30분으로 거절**된다. 지금은 넷 다 여기를 읽는다.
 *      ⚠️ `best-time.ts ACCOUNT_GAP_MIN` 은 **남아 있다** — `pickPublishAt` 이 `gapMin` 을 못 받았을 때의 폴백이다.
 *         없애면 순수 함수가 DB 를 알아야 해서 더 나쁘다. **폴백이라는 사실을 그 상수 주석에 적어 뒀다.**
 *   🔴 고객이 손으로 만지는 자리는 `gapMin`(자동 편성의 안전 기본)이 아니라 **`floorMin`**(고객이 내릴 수 있는 바닥)을 쓴다 —
 *      우리 기본값으로 고객의 선택을 거절하면 그게 §9 가 금지한 «우리 판단으로 막는 것»이다.
 *   🔴 **판단은 고객에게 넘기되 위험은 말한다** — `risk` 한 줄이 그 용도다. 화면이 그대로 보여 준다.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/index";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** 기본(안전) — 지금까지 쓰던 값. 근거는 통설이다(위 주석). */
export const ACCOUNT_GAP_MIN_DEFAULT = 30;
/** 🔴 **고객이 내릴 수 있는 바닥** — 우리가 여기까지 자동으로 좁히지 않는다. 사장님이 말씀하신 «10:00 / 10:05»가 이 안에 든다. */
export const ACCOUNT_GAP_MIN_FLOOR = 5;

/** 무엇을 근거로 이 폭을 줬나 — 화면·로그가 그대로 쓴다(«왜 5분까지 되나»를 사람이 알 수 있게). */
export type GapBasis =
  | "measured_distinct_ip"        // 실제로 다른 IP 로 나간 기록이 있다 → 폭을 준다
  | "proxy_assigned_unverified"   // 프록시는 배정됐지만 아직 안 쟀다 → 안 준다
  | "shared_ip"                   // 같은 IP(프록시 없음) → 안 준다
  | "only_account";               // 그 채널에 이 계정뿐 → 애초에 부딪힐 상대가 없다

export interface GapDecision {
  /** 시스템이 쓰는 기본 간격(분). */
  gapMin: number;
  /** 🔴 고객이 여기까지 내릴 수 있다(분). `gapMin` 과 같으면 «못 내린다»는 뜻. */
  floorMin: number;
  basis: GapBasis;
  /** 고객에게 보여 줄 한 줄 — 🔴 판단은 고객이 하되 위험은 우리가 말한다. */
  risk: string;
}

export interface GapInput {
  /** 이 계정에 전용 IP 가 배정돼 있나. */
  hasProxy: boolean;
  /** 러너가 **실제로 재서 적은** 이 계정의 출구 IP(없으면 아직 못 쟀다). */
  myExitIp: string | null;
  /** 같은 채널의 다른 계정들 — `exitIp` 는 잰 값(못 쟀으면 null). */
  others: { accountId: number; exitIp: string | null }[];
}

/**
 * decideGap — 순수 판정(DB 0). 🔴 호출부가 **왜 그 값인지**를 같이 받아야 화면이 설명할 수 있다.
 */
export function decideGap(inp: GapInput): GapDecision {
  const others = inp.others ?? [];
  if (!others.length) {
    return {
      gapMin: ACCOUNT_GAP_MIN_DEFAULT, floorMin: ACCOUNT_GAP_MIN_FLOOR, basis: "only_account",
      risk: "이 채널에는 계정이 하나뿐이라 다른 계정과 겹칠 일이 없어요.",
    };
  }
  if (!inp.hasProxy) {
    return {
      gapMin: ACCOUNT_GAP_MIN_DEFAULT, floorMin: ACCOUNT_GAP_MIN_DEFAULT, basis: "shared_ip",
      risk: "이 계정들은 같은 인터넷 주소로 나가요. 시간을 벌려 두면 계정마다 따로 움직이는 것처럼 보여서, 30분 간격을 기본으로 지켜 드려요.",
    };
  }
  /* 🔴 **«배정됐다»가 «다르다»가 아니다.** 프록시가 죽어 있으면 우리 집 IP 로 나간다 —
     그래서 러너가 잡마다 출구 IP 를 실제로 확인해 적는다. 그 **잰 값**이 있을 때만 폭을 준다. */
  if (!inp.myExitIp) {
    return {
      gapMin: ACCOUNT_GAP_MIN_DEFAULT, floorMin: ACCOUNT_GAP_MIN_DEFAULT, basis: "proxy_assigned_unverified",
      risk: "전용 인터넷 주소를 배정했지만 아직 실제로 그 주소로 나갔는지 확인하지 못했어요. 한 번 발행해서 확인되면 간격을 더 좁힐 수 있어요.",
    };
  }
  /* 같은 IP 로 나간 기록이 있는 계정이 하나라도 있으면 폭을 주지 않는다.
     «아직 못 잰» 계정(null)은 **다르다고 치지 않는다** — 모르는 것을 유리하게 읽지 않는다(AC-9). */
  const sameIp = others.some((o) => o.exitIp && o.exitIp === inp.myExitIp);
  const unmeasured = others.some((o) => !o.exitIp);
  if (sameIp) {
    return {
      gapMin: ACCOUNT_GAP_MIN_DEFAULT, floorMin: ACCOUNT_GAP_MIN_DEFAULT, basis: "shared_ip",
      risk: "이 계정과 같은 인터넷 주소를 쓰는 계정이 있어요. 서로 시간을 벌려 두는 편이 안전해서 30분 간격을 기본으로 지켜 드려요.",
    };
  }
  if (unmeasured) {
    return {
      gapMin: ACCOUNT_GAP_MIN_DEFAULT, floorMin: ACCOUNT_GAP_MIN_DEFAULT, basis: "proxy_assigned_unverified",
      risk: "같은 채널의 다른 계정이 어떤 주소로 나가는지 아직 확인하지 못했어요. 확인되면 간격을 더 좁힐 수 있어요.",
    };
  }
  return {
    gapMin: ACCOUNT_GAP_MIN_DEFAULT, floorMin: ACCOUNT_GAP_MIN_FLOOR, basis: "measured_distinct_ip",
    risk: "이 계정들은 서로 다른 인터넷 주소로 나가는 것이 확인됐어요. 시간을 붙여도 «같은 사람»으로 묶일 위험이 낮아 최소 5분까지 줄일 수 있어요. ⚠️ 위험이 0은 아니에요 — 글이 서로 비슷하면 시간과 상관없이 묶일 수 있어요.",
  };
}

/**
 * gapMinFor — 그 계정의 간격 정책. **이 값의 정본은 여기다.**
 *   지금 읽는 곳 넷: `lib/director.ts`(발행 예약) · `lib/slots.ts`(편성) ·
 *   `netlify/functions/slots.ts`(고객이 시각 바꾸기) · `netlify/functions/publish-now.ts`(지금 올리기).
 *   ⚠️ `best-time.ts ACCOUNT_GAP_MIN` 은 **`pickPublishAt` 이 `gapMin` 을 못 받았을 때의 폴백**으로 남아 있다
 *      (그 함수는 순수라 DB 를 못 본다). «여기 하나»라고 적어 두면 그게 거짓이 되므로 **실제를 적는다**(AC-59).
 *   같은 테넌트·같은 채널의 다른 계정만 본다(남의 테넌트와는 겹칠 일이 없다).
 */
export async function gapMinFor(tid: number, accountId: number): Promise<GapDecision> {
  const [me] = await q(sql`SELECT channel, proxy_id, last_exit_ip FROM accounts WHERE tenant_id = ${tid} AND id = ${n(accountId)} LIMIT 1`);
  if (!me) {
    return { gapMin: ACCOUNT_GAP_MIN_DEFAULT, floorMin: ACCOUNT_GAP_MIN_DEFAULT, basis: "shared_ip", risk: "계정을 찾지 못해 가장 안전한 간격(30분)을 씁니다." };
  }
  const others = await q(sql`SELECT id, last_exit_ip FROM accounts
    WHERE tenant_id = ${tid} AND channel = ${String(me.channel ?? "")} AND id <> ${n(accountId)} AND status <> 'disconnected'`);
  return decideGap({
    hasProxy: !!me.proxy_id,
    myExitIp: me.last_exit_ip ? String(me.last_exit_ip) : null,
    others: others.map((o) => ({ accountId: n(o.id), exitIp: o.last_exit_ip ? String(o.last_exit_ip) : null })),
  });
}
